"""Bases de encargos sociais da empresa.

A empresa monta o seu próprio quadro de encargos (horistas e mensalistas), a partir do modelo da CEHOP (ORSE) ou em
branco, e edita item a item. As composições próprias com "encargos da empresa" podem usar o total de uma dessas bases
no lugar de um percentual digitado: ao mudar um item da base, todas as composições que a usam acompanham.

Cada quadro é uma lista de linhas {grupo, item, descricao, valor}; a linha com item == grupo é o título do grupo
(o valor dela é a soma dos itens do grupo). O total é a soma de todos os itens.
"""
import json
import re
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

import orcamento as orc_mod
import proprias

router = APIRouter(prefix='/api')
TIPOS = ('horista', 'mensalista')
GRUPOS_CEHOP = (('A', 'ENCARGOS INSTITUCIONAIS'), ('B', 'ENCARGOS TRABALHISTAS'), ('C', 'ENCARGOS INDENIZATÓRIOS'), ('D', 'INCIDÊNCIAS OU EFEITOS'))


def _ler(txt):
    try:
        l = json.loads(txt) if txt else []
    except ValueError:
        return []
    return [{'grupo': str(x.get('grupo') or ''), 'item': str(x.get('item') or ''), 'descricao': str(x.get('descricao') or ''),
             'valor': float(x.get('valor') or 0)} for x in l if isinstance(x, dict)]


def quadro(linhas):
    """Linhas com o valor de cada grupo somado, e o total."""
    soma = {}
    for l in linhas:
        if l['item'] != l['grupo']:
            soma[l['grupo']] = soma.get(l['grupo'], 0.0) + l['valor']
    out = [dict(l, valor=round(soma.get(l['grupo'], 0.0), 4)) if l['item'] == l['grupo'] else l for l in linhas]
    return {'total': round(sum(soma.values()), 4), 'linhas': out}


def _resumo(r):
    return {'id': r['id'], 'nome': r['nome'], 'descricao': r['descricao'] or '', 'origem': r['origem'] or '',
            'atualizado_em': r['atualizado_em'], **{f'total_{t}': quadro(_ler(r[t]))['total'] for t in TIPOS}}


def totais():
    """{id: {'nome', 'horista', 'mensalista'}} de todas as bases (para o cálculo das composições)."""
    with orc_mod.orc() as c:
        return {r['id']: {'nome': r['nome'], **{t: quadro(_ler(r[t]))['total'] for t in TIPOS}}
                for r in c.execute('SELECT * FROM encargo_base').fetchall()}


def _cehop():
    """Quadros da CEHOP no mês mais recente da ORSE que tem o detalhamento."""
    with orc_mod._base_conn() as b:
        r = b.execute('SELECT MAX(referencia) FROM encargo').fetchone()
        ref = r[0] if r else None
        if not ref:
            return None, {t: [] for t in TIPOS}
        out = {t: [{'grupo': x['grupo'], 'item': x['item'], 'descricao': x['descricao'], 'valor': x['valor'] or 0.0}
                   for x in b.execute('SELECT grupo, item, descricao, valor FROM encargo WHERE referencia = ? AND tipo = ? ORDER BY grupo, item = grupo DESC, item',
                                      (ref, t))] for t in TIPOS}
        nome = b.execute('SELECT descricao FROM referencia WHERE id = ?', (ref,)).fetchone()
    return (nome['descricao'].removesuffix('-1') if nome else ref), out


def _vazio():
    return [{'grupo': g, 'item': g, 'descricao': n, 'valor': 0.0} for g, n in GRUPOS_CEHOP]


# ---------- API ----------
class Linha(BaseModel):
    grupo: str = Field(min_length=1, max_length=10)
    item: str = Field(min_length=1, max_length=20)
    descricao: str = Field('', max_length=300)
    valor: float = Field(0, ge=0, le=1000)


class NovaBase(BaseModel):
    nome: str = Field(min_length=1, max_length=120)
    modelo: str = 'cehop'  # "cehop", "vazio" ou o id de outra base de encargos (copiar)


class EdicaoBase(BaseModel):
    nome: Optional[str] = Field(None, min_length=1, max_length=120)
    descricao: Optional[str] = Field(None, max_length=400)
    horista: Optional[list[Linha]] = Field(None, max_length=200)
    mensalista: Optional[list[Linha]] = Field(None, max_length=200)


def _ficha(c, bid):
    r = c.execute('SELECT * FROM encargo_base WHERE id = ?', (bid,)).fetchone()
    if not r:
        raise HTTPException(404, 'Base de encargos não encontrada.')
    usam = [proprias.cod_comp(x['id']) for x in c.execute('SELECT id FROM composicao_propria WHERE encargo_base_id = ? ORDER BY id', (bid,)).fetchall()]
    return _resumo(r) | {t: quadro(_ler(r[t])) for t in TIPOS} | {'usada_em': usam}


@router.get('/bases-encargos')
def listar():
    with orc_mod.orc() as c:
        return [_resumo(r) for r in c.execute('SELECT * FROM encargo_base ORDER BY nome, id').fetchall()]


@router.post('/bases-encargos', status_code=201)
def criar(d: NovaBase):
    with proprias.gravando() as c:
        if d.modelo == 'vazio':
            origem, q = 'Em branco', {t: _vazio() for t in TIPOS}
        elif re.fullmatch(r'\d+', d.modelo or ''):
            o = c.execute('SELECT * FROM encargo_base WHERE id = ?', (int(d.modelo),)).fetchone()
            if not o:
                raise HTTPException(404, 'Base de encargos de origem não encontrada.')
            origem, q = f"Cópia de {o['nome']}", {t: _ler(o[t]) for t in TIPOS}
        else:
            mes, q = _cehop()
            if not any(q.values()):
                q = {t: _vazio() for t in TIPOS}
            origem = f'Modelo da CEHOP (ORSE), {mes}' if mes else 'Em branco'
        agora = orc_mod.agora()
        cur = c.execute('INSERT INTO encargo_base (nome, descricao, origem, horista, mensalista, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?)',
                        (d.nome.strip(), '', origem, json.dumps(q['horista'], ensure_ascii=False), json.dumps(q['mensalista'], ensure_ascii=False), agora, agora))
        return _ficha(c, cur.lastrowid)


@router.get('/bases-encargos/{bid}')
def ver(bid: int):
    with orc_mod.orc() as c:
        return _ficha(c, bid)


@router.patch('/bases-encargos/{bid}')
def editar(bid: int, d: EdicaoBase):
    campos = {}
    for k, v in d.model_dump(exclude_unset=True).items():
        if v is None:
            continue
        if k in TIPOS:
            vistos = set()
            for l in v:
                l['grupo'], l['item'] = l['grupo'].strip().upper(), l['item'].strip().upper()
                if (l['item'], l['grupo'] == l['item']) in vistos:
                    raise HTTPException(422, f"O item {l['item']} aparece duas vezes no quadro de {k}s.")
                vistos.add((l['item'], l['grupo'] == l['item']))
            campos[k] = json.dumps(v, ensure_ascii=False)
        else:
            campos[k] = v.strip()
    with proprias.gravando() as c:  # as composições que usam a base recalculam
        if not c.execute('SELECT 1 FROM encargo_base WHERE id = ?', (bid,)).fetchone():
            raise HTTPException(404, 'Base de encargos não encontrada.')
        if campos:
            c.execute(f"UPDATE encargo_base SET {', '.join(f'{k} = ?' for k in campos)}, atualizado_em = ? WHERE id = ?",
                      list(campos.values()) + [orc_mod.agora(), bid])
        return _ficha(c, bid)


@router.delete('/bases-encargos/{bid}')
def excluir(bid: int):
    with proprias.gravando() as c:
        f = _ficha(c, bid)
        if f['usada_em']:
            raise HTTPException(409, f"A base {f['nome']} é usada em {', '.join(f['usada_em'])}. Troque os encargos dessas composições antes de excluir.")
        c.execute('DELETE FROM encargo_base WHERE id = ?', (bid,))
        return {'ok': True}
