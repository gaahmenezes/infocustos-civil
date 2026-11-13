"""Composições e insumos próprios da empresa.

Uma composição própria é uma lista de itens com coeficiente. Cada item é um insumo ou uma composição de qualquer base
(ORSE, SINAPI, SICRO) ou próprio. O preço não fica gravado: é calculado na hora, com a data-base escolhida para cada
base. Trocar o mês da SINAPI atualiza todas as composições próprias que usam itens dela.

Códigos: composição própria P0001, P0002...; insumo próprio I0001, I0002... (base "PROPRIA").
"""
import contextvars
import re
import threading
import unicodedata
from contextlib import contextmanager
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

import banco_orc
import orcamento as orc_mod

router = APIRouter(prefix='/api')
BASE = 'PROPRIA'
BASES_OFICIAIS = ('ORSE', 'SINAPI', 'SICRO')
SECAO_DO_TIPO = {'MATERIAIS': 'MATERIAL', 'MATERIAL': 'MATERIAL', 'PESSOAL': 'MAO_DE_OBRA', 'MÃO DE OBRA': 'MAO_DE_OBRA', 'MAO_DE_OBRA': 'MAO_DE_OBRA',
                 'EQUIPAMENTOS': 'EQUIPAMENTO', 'EQUIPAMENTO': 'EQUIPAMENTO', 'SERVIÇOS DE TERCEIROS': 'SERVICO_TERCEIRO', 'SERVICO_TERCEIRO': 'SERVICO_TERCEIRO'}
PARTE = {'MAO_DE_OBRA': 'mo', 'MATERIAL': 'mat', 'EQUIPAMENTO': 'equip', 'SERVICO_TERCEIRO': 'terc'}
TIPOS_INSUMO = ('MATERIAL', 'MAO_DE_OBRA', 'EQUIPAMENTO', 'SERVICO_TERCEIRO')


def orc():
    return orc_mod.orc()


def cod_comp(i):
    return f'P{i:04d}'


def cod_ins(i):
    return f'I{i:04d}'


def id_de(codigo, letra):
    m = re.fullmatch(fr'{letra}0*(\d+)', (codigo or '').upper())
    if not m:
        raise HTTPException(404, f'Código próprio inválido: {codigo}.')
    return int(m.group(1))


def sem_acento(t):
    return ''.join(ch for ch in unicodedata.normalize('NFD', (t or '').lower()) if unicodedata.category(ch) != 'Mn')


def ler_refs(refs: str):
    return dict(x.split(':', 1) for x in (refs or '').split(',') if ':' in x)


# ---------- acervo em memória ----------
# As composições e os insumos próprios mudam pouco e são lidos o tempo todo (a busca os consulta a cada letra digitada,
# o orçamento a cada cálculo). Em vez de ir ao banco a cada leitura, o servidor guarda uma cópia e a descarta sempre
# que algo é gravado (`gravando`). Junto ficam os cálculos já feitos para cada combinação de meses.
_ACERVO = None
_TRAVA = threading.RLock()
NOME_PADRAO = 'Base própria'


def acervo():
    global _ACERVO
    a = _ACERVO
    if a is None:
        with _TRAVA:
            if _ACERVO is None:
                with orc() as c:
                    comps = {r['id']: dict(r) for r in c.execute('SELECT * FROM composicao_propria').fetchall()}
                    itens = {}
                    for r in c.execute('SELECT * FROM composicao_propria_item ORDER BY composicao_id, ordem, id').fetchall():
                        itens.setdefault(r['composicao_id'], []).append(dict(r))
                    insumos = {r['id']: dict(r) for r in c.execute('SELECT * FROM insumo_proprio').fetchall()}
                    n = c.execute("SELECT valor FROM config WHERE chave = 'nome_base_propria'").fetchone()
                _ACERVO = {'comps': comps, 'itens': itens, 'insumos': insumos, 'calcs': {},
                           'nome': (n['valor'] if n and n['valor'] else NOME_PADRAO)}
            a = _ACERVO
    return a


def invalidar():
    global _ACERVO
    _ACERVO = None


@contextmanager
def gravando():
    """Conexão para gravar: ao terminar (com sucesso ou não), a cópia em memória é descartada."""
    try:
        with orc() as c:
            yield c
    finally:
        invalidar()


def calculo_guardado(refs: dict):
    """Cálculo reaproveitado entre pedidos, para a mesma combinação de meses, enquanto nada for gravado."""
    a = acervo()
    k = tuple(sorted((refs or {}).items()))
    calc = a['calcs'].get(k)
    if calc is None:
        if len(a['calcs']) > 24:
            a['calcs'].clear()
        calc = a['calcs'][k] = Calculo(None, dict(refs or {}), a)
    return calc


# ---------- preço de cada item ----------
class Calculo:
    """Calcula composições próprias com a data-base de cada base. Guarda o que já calculou e impede ciclos.
    Com conexão `c`, lê o banco na hora (usado logo depois de gravar); sem ela, lê o acervo em memória."""

    def __init__(self, c, refs: dict, dados=None):
        self.c, self.refs, self.memo, self.pilha, self.memo_oficial = c, refs, {}, set(), {}
        self.dados = dados if c is None else None
        if c is None and dados is None:
            self.dados = acervo()
        self.trava = threading.RLock()
        with orc_mod._base_conn() as b:
            self.ultimos = orc_mod.ultimo_por_base(b)

    def mes(self, base):
        with orc_mod._base_conn() as b:
            return orc_mod.mes_para_base(b, base, self.refs.get(base) or self.ultimos.get(base))

    def oficial(self, tipo, base, codigo):
        """Preço e divisão do custo de um item oficial no mês escolhido para a base."""
        k = (tipo, base, codigo)
        if k not in self.memo_oficial:
            self.memo_oficial[k] = self._oficial(tipo, base, codigo)
        return self.memo_oficial[k]

    def _oficial(self, tipo, base, codigo):
        mes = self.mes(base)
        p = orc_mod.preco_na_base(tipo, base, codigo, mes)
        if not p:
            return None
        with orc_mod._base_conn() as b:
            r = b.execute('''SELECT categoria, pct_mo, pct_mat, pct_equip, pct_terc, tem_composicao FROM item_busca
                WHERE tipo = ? AND base = ? AND codigo = ? AND referencia = ?''', (tipo, base, p['codigo'], p['referencia'])).fetchone()
        if tipo == 'insumo':
            secao = SECAO_DO_TIPO.get((r['categoria'] if r else '') or '', 'MATERIAL')
            div = {PARTE[secao]: 1.0}
        else:
            secao = 'SERVICO_AUXILIAR'
            div = {'mo': (r['pct_mo'] or 0), 'mat': (r['pct_mat'] or 0), 'equip': (r['pct_equip'] or 0), 'terc': (r['pct_terc'] or 0)} if r and r['pct_mo'] is not None else {'mat': 1.0}
        return {'codigo': p['codigo'], 'descricao': p['descricao'], 'unidade': p['unidade'], 'preco': p['preco'], 'referencia': p['referencia'],
                'compl': orc_mod.complementares(tipo, base, p['codigo'], p['referencia'], p['descricao'], p['preco']) if p['preco'] is not None else 0.0,
                'secao': secao, 'div': div, 'tem_composicao': bool(r and r['tem_composicao']) if tipo == 'servico' else False}

    def insumo_proprio(self, codigo):
        iid = id_de(codigo, 'I')
        i = self.dados['insumos'].get(iid) if self.c is None else self.c.execute('SELECT * FROM insumo_proprio WHERE id = ?', (iid,)).fetchone()
        if not i:
            return None
        secao = i['tipo'] if i['tipo'] in TIPOS_INSUMO else 'MATERIAL'
        return {'codigo': cod_ins(i['id']), 'descricao': i['descricao'], 'unidade': i['unidade'], 'preco': i['preco'], 'referencia': i['data_preco'] or None,
                'secao': secao, 'div': {PARTE[secao]: 1.0}, 'tem_composicao': False}

    def composicao(self, codigo):
        """Composição própria inteira: itens com preço, total e divisão do custo."""
        cid = id_de(codigo, 'P')
        r = self.memo.get(cid)
        if r is not None:
            return r
        with self.trava:  # o mesmo cálculo pode servir a vários pedidos ao mesmo tempo
            if cid in self.memo:
                return self.memo[cid]
            if cid in self.pilha:
                raise HTTPException(422, f'{cod_comp(cid)} usa a si mesma (direta ou indiretamente).')
            cp = self.dados['comps'].get(cid) if self.c is None else self.c.execute('SELECT * FROM composicao_propria WHERE id = ?', (cid,)).fetchone()
            if not cp:
                raise HTTPException(404, f'A composição própria {codigo} não existe.')
            self.pilha.add(cid)
            try:
                return self._montar(cid, cp)
            finally:
                self.pilha.discard(cid)

    def _itens(self, cid):
        if self.c is None:
            return self.dados['itens'].get(cid, [])
        return self.c.execute('SELECT * FROM composicao_propria_item WHERE composicao_id = ? ORDER BY ordem, id', (cid,)).fetchall()

    def _montar(self, cid, cp):
        itens, total, div, faltam = [], 0.0, {'mo': 0.0, 'mat': 0.0, 'equip': 0.0, 'terc': 0.0}, 0
        compl = 0.0  # encargos complementares embutidos nos itens oficiais
        for it in self._itens(cid):
            if it['base'] == BASE:
                if it['tipo'] == 'servico':
                    sub = self.composicao(it['codigo'])
                    d = {'codigo': sub['codigo'], 'descricao': sub['descricao'], 'unidade': sub['unidade'], 'preco': sub['custo_total'],
                         'referencia': None, 'secao': 'SERVICO_AUXILIAR', 'tem_composicao': True, 'compl': sub['compl'],
                         'div': {k: (sub['divisao'][k] if sub['custo_total'] else 0) for k in div}}
                else:
                    d = self.insumo_proprio(it['codigo'])
            else:
                d = self.oficial(it['tipo'], it['base'], it['codigo'])
            preco = d['preco'] if d else None
            custo = round(it['qtd'] * preco, 4) if preco is not None else None
            if custo is None:
                faltam += 1
            else:
                total += custo
                compl += it['qtd'] * (d.get('compl') or 0.0)
                for k, v in (d['div'] or {}).items():
                    div[k] += custo * v
            itens.append({'id': it['id'], 'ordem': it['ordem'], 'tipo': it['tipo'], 'base': it['base'], 'codigo': d['codigo'] if d else it['codigo'],
                          'eh_servico': int(it['tipo'] == 'servico'), 'secao': d['secao'] if d else ('SERVICO_AUXILIAR' if it['tipo'] == 'servico' else 'MATERIAL'),
                          'descricao': d['descricao'] if d else (it['descricao'] or '') + ' — não encontrado na data-base escolhida',
                          'unidade': d['unidade'] if d else it['unidade'], 'qtd': it['qtd'], 'custo_unit': preco, 'custo_total': custo,
                          'referencia': d['referencia'] if d else None, 'tem_composicao': bool(d and d['tem_composicao'])})
        total = round(total, 2)
        fr = {k: (v / total if total else 0) for k, v in div.items()}
        r = {'base': BASE, 'codigo': cod_comp(cid), 'id': cid, 'descricao': cp['descricao'], 'unidade': cp['unidade'], 'grupo': cp['grupo'] or 'Composições próprias',
             'subgrupo': '', 'observacoes': cp['observacoes'] or '', 'modelo': 'PROPRIA', 'prod_equipe': None, 'encargo_social': None, 'referencia': None,
             'custo_total': total, 'compl': round(compl, 4), 'custo_mao_de_obra': round(div['mo'], 4), 'custo_encargo_social': 0.0, 'custo_material': round(div['mat'], 4),
             'custo_equipamento': round(div['equip'], 4), 'custo_servico_terceiro': round(div['terc'], 4), 'divisao': fr,
             'itens_sem_preco': faltam, 'itens': itens, 'origem_base': cp['origem_base'] or '', 'origem_codigo': cp['origem_codigo'] or '',
             'atualizado_em': cp['atualizado_em'], 'fonte': 'PROPRIA'}
        self.memo[cid] = r
        return r


def datas_usadas(calc, comp):
    """Mês de cada base que entrou no cálculo (para mostrar na ficha)."""
    out = {}
    for it in comp['itens']:
        if it['base'] in BASES_OFICIAIS and it['referencia']:
            out.setdefault(it['base'], set()).add(it['referencia'])
    return {b: sorted(v) for b, v in out.items()}


# ---------- usado pela consulta e pelo orçamento ----------
def ficha_composicao(codigo, refs: str = ''):
    calc = calculo_guardado(ler_refs(refs))
    comp = dict(calc.composicao(codigo))  # cópia: o cálculo guardado não é alterado
    comp['datas'] = datas_usadas(calc, comp)
    if comp['origem_base'] in BASES_OFICIAIS and comp['origem_codigo']:
        o = calc.oficial('servico', comp['origem_base'], comp['origem_codigo'])
        comp['origem'] = o and {'base': comp['origem_base'], 'codigo': o['codigo'], 'descricao': o['descricao'], 'custo': o['preco'], 'referencia': o['referencia']}
    comp['usada_em'] = sum(1 for itens in acervo()['itens'].values()
                           if any(it['base'] == BASE and it['tipo'] == 'servico' and it['codigo'] == comp['codigo'] for it in itens))
    return comp


def ficha_insumo(codigo):
    with orc() as c:
        i = c.execute('SELECT * FROM insumo_proprio WHERE id = ?', (id_de(codigo, 'I'),)).fetchone()
        if not i:
            raise HTTPException(404, f'O insumo próprio {codigo} não existe.')
        usos = c.execute("""SELECT DISTINCT cp.id, cp.descricao, cp.unidade, it.qtd FROM composicao_propria_item it
            JOIN composicao_propria cp ON cp.id = it.composicao_id WHERE it.base = ? AND it.tipo = 'insumo' AND it.codigo = ?""",
                         (BASE, cod_ins(i['id']))).fetchall()
        return {'base': BASE, 'codigo': cod_ins(i['id']), 'descricao': i['descricao'], 'unidade': i['unidade'], 'preco': i['preco'],
                'tipo': i['tipo'], 'categoria': i['tipo'], 'grupo': 'Insumos próprios', 'marcador': '', 'referencia': None,
                'data_preco': i['data_preco'] or '', 'fonte': i['fonte'] or '', 'usado_em': len(usos),
                'usos': [{'base': BASE, 'codigo': cod_comp(u['id']), 'descricao': u['descricao'], 'unidade': u['unidade'], 'qtd': u['qtd'],
                          'custo_total': (u['qtd'] * i['preco']) if i['preco'] is not None else None, 'preco_composicao': None} for u in usos]}


# ---------- uma sessão de cálculo por pedido ----------
# O orçamento pergunta preço, divisão e encargos de cada item próprio. Sem sessão, cada pergunta abria uma conexão e
# recalculava a composição inteira; com ela, tudo o que já foi calculado no mesmo pedido é reaproveitado.
_SESSAO = contextvars.ContextVar('sessao_proprias', default=None)


@contextmanager
def sessao(c):
    if _SESSAO.get() is not None:
        yield
        return
    marca = _SESSAO.set({'c': c, 'calcs': {}})
    try:
        yield
    finally:
        _SESSAO.reset(marca)


def _refs_do_mes(ref):
    if not ref:
        return {}
    with orc_mod._base_conn() as b:
        return {base: orc_mod.mes_para_base(b, base, ref) for base in BASES_OFICIAIS}


@contextmanager
def _calculo(ref):
    yield calculo_guardado(_refs_do_mes(ref))


def preco(tipo, codigo, ref=None):
    """Preço de um item próprio para o orçamento: cada base no mês do orçamento (ou o mais próximo dela)."""
    with _calculo(ref) as calc:
        if tipo == 'servico':
            comp = calc.composicao(codigo)
            return {'codigo': comp['codigo'], 'descricao': comp['descricao'], 'unidade': comp['unidade'],
                    'preco': comp['custo_total'] if comp['itens'] and not comp['itens_sem_preco'] else (comp['custo_total'] or None), 'referencia': ref}
        i = calc.insumo_proprio(codigo)
        return i and {'codigo': i['codigo'], 'descricao': i['descricao'], 'unidade': i['unidade'], 'preco': i['preco'], 'referencia': ref}


def complementares(tipo, codigo, ref=None):
    """Encargos complementares embutidos no custo de uma composição própria (vêm dos itens oficiais que ela usa)."""
    if tipo != 'servico':
        return 0.0
    with _calculo(ref) as calc:
        return calc.composicao(codigo)['compl']


def divisao(tipo, codigo, ref=None):
    """Divisão do custo (frações) de um item próprio, para o orçamento."""
    with _calculo(ref) as calc:
        try:
            if tipo == 'servico':
                return calc.composicao(codigo)['divisao']
            i = calc.insumo_proprio(codigo)
            return i['div'] if i else {'mat': 1.0}
        except HTTPException:
            return {'mat': 1.0}


def buscar(q: str, tipo: str, refs: str, limite: int = 40):
    """Itens próprios que batem com o texto (todas as palavras, sem acento), no formato dos resultados da busca."""
    termos = [t for t in re.findall(r'[a-z0-9]+', sem_acento(q))]
    out = []
    a = acervo()
    if not a['comps'] and not a['insumos']:
        return out
    if True:
        calc = calculo_guardado(ler_refs(refs))
        if tipo in ('todos', 'servico'):
            for cp in sorted(a['comps'].values(), key=lambda x: x['descricao']):
                alvo = sem_acento(f"{cp['descricao']} {cod_comp(cp['id'])}")
                if all(t in alvo for t in termos):
                    try:
                        comp = calc.composicao(cod_comp(cp['id']))
                    except HTTPException:
                        continue
                    d = comp['divisao']
                    out.append({'tipo': 'servico', 'base': BASE, 'codigo': comp['codigo'], 'descricao': cp['descricao'], 'unidade': cp['unidade'],
                                'preco': comp['custo_total'], 'categoria': 'COMPOSIÇÃO PRÓPRIA', 'grupo': cp['grupo'] or 'Composições próprias',
                                'tem_composicao': 1, 'usos': 0, 'pct_mo': d['mo'], 'pct_mat': d['mat'], 'pct_equip': d['equip'], 'pct_terc': d['terc'],
                                'referencia': None, 'trecho': None})
        if tipo in ('todos', 'insumo'):
            for i in sorted(a['insumos'].values(), key=lambda x: x['descricao']):
                if all(t in sem_acento(f"{i['descricao']} {cod_ins(i['id'])}") for t in termos):
                    out.append({'tipo': 'insumo', 'base': BASE, 'codigo': cod_ins(i['id']), 'descricao': i['descricao'], 'unidade': i['unidade'],
                                'preco': i['preco'], 'categoria': i['tipo'], 'grupo': 'Insumos próprios', 'tem_composicao': 0, 'usos': 0,
                                'pct_mo': None, 'pct_mat': None, 'pct_equip': None, 'pct_terc': None, 'referencia': None, 'trecho': None})
    return out[:limite]


# ---------- rotas ----------
class NovoInsumo(BaseModel):
    descricao: str = Field(min_length=1, max_length=400)
    unidade: str = Field(min_length=1, max_length=20)
    tipo: Literal['MATERIAL', 'MAO_DE_OBRA', 'EQUIPAMENTO', 'SERVICO_TERCEIRO'] = 'MATERIAL'
    preco: Optional[float] = Field(None, ge=0)
    data_preco: str = ''
    fonte: str = Field('', max_length=400)


class EdicaoInsumo(BaseModel):
    descricao: Optional[str] = Field(None, min_length=1, max_length=400)
    unidade: Optional[str] = Field(None, min_length=1, max_length=20)
    tipo: Optional[Literal['MATERIAL', 'MAO_DE_OBRA', 'EQUIPAMENTO', 'SERVICO_TERCEIRO']] = None
    preco: Optional[float] = Field(None, ge=0)
    data_preco: Optional[str] = None
    fonte: Optional[str] = Field(None, max_length=400)


class NovaComposicao(BaseModel):
    descricao: str = Field(min_length=1, max_length=400)
    unidade: str = Field(min_length=1, max_length=20)
    grupo: str = Field('', max_length=120)
    observacoes: str = Field('', max_length=2000)


class EdicaoComposicao(BaseModel):
    descricao: Optional[str] = Field(None, min_length=1, max_length=400)
    unidade: Optional[str] = Field(None, min_length=1, max_length=20)
    grupo: Optional[str] = Field(None, max_length=120)
    observacoes: Optional[str] = Field(None, max_length=2000)


class NovoItem(BaseModel):
    tipo: Literal['servico', 'insumo']
    base: Literal['ORSE', 'SINAPI', 'SICRO', 'PROPRIA']
    codigo: str = Field(min_length=1, max_length=20)
    qtd: float = Field(1.0, ge=0)


class EdicaoItem(BaseModel):
    qtd: float = Field(ge=0)


@router.get('/proprias')
def listar(refs: str = ''):
    a = acervo()
    if True:
        calc = calculo_guardado(ler_refs(refs))
        comps = []
        for cp in sorted(a['comps'].values(), key=lambda x: (x['atualizado_em'] or '', x['id']), reverse=True):
            try:
                k = calc.composicao(cod_comp(cp['id']))
                total, n, faltam = k['custo_total'], len(k['itens']), k['itens_sem_preco']
            except HTTPException:
                total, n, faltam = None, 0, 0
            comps.append({'codigo': cod_comp(cp['id']), 'descricao': cp['descricao'], 'unidade': cp['unidade'], 'grupo': cp['grupo'] or '',
                          'custo_total': total, 'qtd_itens': n, 'itens_sem_preco': faltam, 'atualizado_em': cp['atualizado_em'],
                          'origem_base': cp['origem_base'] or '', 'origem_codigo': cp['origem_codigo'] or ''})
        ins = [{'codigo': cod_ins(i['id']), 'descricao': i['descricao'], 'unidade': i['unidade'], 'tipo': i['tipo'], 'preco': i['preco'],
                'data_preco': i['data_preco'] or '', 'fonte': i['fonte'] or '', 'atualizado_em': i['atualizado_em']}
               for i in sorted(a['insumos'].values(), key=lambda x: x['descricao'])]
        return {'composicoes': comps, 'insumos': ins, 'nome_base': a['nome']}


# ---------- nome da base própria (a empresa escolhe como chamar) ----------
def nome_base(c=None):
    return acervo()['nome']


class NomeBase(BaseModel):
    nome: str = Field(min_length=1, max_length=40)


@router.patch('/proprias/base')
def renomear_base(d: NomeBase):
    nome = ' '.join(d.nome.split())
    if not nome:
        raise HTTPException(422, 'Dê um nome à base.')
    if nome.upper() in BASES_OFICIAIS:
        raise HTTPException(422, f'{nome.upper()} é o nome de uma base oficial. Escolha outro para a sua.')
    with gravando() as c:
        if c.execute("SELECT 1 FROM config WHERE chave = 'nome_base_propria'").fetchone():
            c.execute("UPDATE config SET valor = ? WHERE chave = 'nome_base_propria'", (nome,))
        else:
            c.execute("INSERT INTO config (chave, valor) VALUES ('nome_base_propria', ?)", (nome,))
    return {'nome_base': nome}


@router.post('/proprias/insumos', status_code=201)
def criar_insumo(d: NovoInsumo):
    with gravando() as c:
        cur = c.execute('INSERT INTO insumo_proprio (descricao, unidade, tipo, preco, data_preco, fonte, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?)',
                        (d.descricao.strip(), d.unidade.strip(), d.tipo, d.preco, d.data_preco, d.fonte.strip(), orc_mod.agora(), orc_mod.agora()))
        return ficha_insumo_c(c, cur.lastrowid)


def ficha_insumo_c(c, iid):
    i = c.execute('SELECT * FROM insumo_proprio WHERE id = ?', (iid,)).fetchone()
    return {'codigo': cod_ins(i['id']), 'descricao': i['descricao'], 'unidade': i['unidade'], 'tipo': i['tipo'], 'preco': i['preco'],
            'data_preco': i['data_preco'] or '', 'fonte': i['fonte'] or ''}


@router.patch('/proprias/insumos/{codigo}')
def editar_insumo(codigo: str, d: EdicaoInsumo):
    iid = id_de(codigo, 'I')
    campos = {k: (v.strip() if isinstance(v, str) else v) for k, v in d.model_dump(exclude_unset=True).items()}
    with gravando() as c:
        if not c.execute('SELECT 1 FROM insumo_proprio WHERE id = ?', (iid,)).fetchone():
            raise HTTPException(404, f'O insumo próprio {codigo} não existe.')
        if campos:
            c.execute(f"UPDATE insumo_proprio SET {', '.join(f'{k} = ?' for k in campos)}, atualizado_em = ? WHERE id = ?", list(campos.values()) + [orc_mod.agora(), iid])
        return ficha_insumo_c(c, iid)


def _quem_usa(c, base_tipo, codigo):
    return [cod_comp(r['composicao_id']) for r in c.execute('SELECT DISTINCT composicao_id FROM composicao_propria_item WHERE base = ? AND tipo = ? AND codigo = ?',
                                                             (BASE, base_tipo, codigo)).fetchall()]


@router.delete('/proprias/insumos/{codigo}')
def excluir_insumo(codigo: str):
    iid = id_de(codigo, 'I')
    with gravando() as c:
        usam = _quem_usa(c, 'insumo', cod_ins(iid))
        if usam:
            raise HTTPException(409, f'O insumo {cod_ins(iid)} é usado em {", ".join(usam)}. Tire-o dessas composições antes de excluir.')
        c.execute('DELETE FROM insumo_proprio WHERE id = ?', (iid,))
        return {'ok': True}


@router.post('/proprias/composicoes', status_code=201)
def criar_composicao(d: NovaComposicao, refs: str = ''):
    with gravando() as c:
        cur = c.execute('INSERT INTO composicao_propria (descricao, unidade, grupo, observacoes, criado_em, atualizado_em) VALUES (?,?,?,?,?,?)',
                        (d.descricao.strip(), d.unidade.strip(), d.grupo.strip(), d.observacoes.strip(), orc_mod.agora(), orc_mod.agora()))
        novo = cur.lastrowid
    return ficha_composicao(cod_comp(novo), refs)


@router.get('/proprias/composicoes/{codigo}')
def obter_composicao(codigo: str, refs: str = ''):
    return ficha_composicao(codigo, refs)


@router.patch('/proprias/composicoes/{codigo}')
def editar_composicao(codigo: str, d: EdicaoComposicao, refs: str = ''):
    cid = id_de(codigo, 'P')
    campos = {k: v.strip() for k, v in d.model_dump(exclude_unset=True).items() if v is not None}
    with gravando() as c:
        if not c.execute('SELECT 1 FROM composicao_propria WHERE id = ?', (cid,)).fetchone():
            raise HTTPException(404, f'A composição própria {codigo} não existe.')
        if campos:
            c.execute(f"UPDATE composicao_propria SET {', '.join(f'{k} = ?' for k in campos)}, atualizado_em = ? WHERE id = ?", list(campos.values()) + [orc_mod.agora(), cid])
    return ficha_composicao(codigo, refs)


@router.delete('/proprias/composicoes/{codigo}')
def excluir_composicao(codigo: str):
    cid = id_de(codigo, 'P')
    with gravando() as c:
        usam = [x for x in _quem_usa(c, 'servico', cod_comp(cid)) if x != cod_comp(cid)]
        if usam:
            raise HTTPException(409, f'{cod_comp(cid)} é usada em {", ".join(usam)}. Tire-a dessas composições antes de excluir.')
        c.execute('DELETE FROM composicao_propria_item WHERE composicao_id = ?', (cid,))
        c.execute('DELETE FROM composicao_propria WHERE id = ?', (cid,))
        return {'ok': True}


def _tocar(c, cid):
    c.execute('UPDATE composicao_propria SET atualizado_em = ? WHERE id = ?', (orc_mod.agora(), cid))


@router.post('/proprias/composicoes/{codigo}/itens', status_code=201)
def novo_item(codigo: str, d: NovoItem, refs: str = ''):
    cid = id_de(codigo, 'P')
    with gravando() as c:
        if not c.execute('SELECT 1 FROM composicao_propria WHERE id = ?', (cid,)).fetchone():
            raise HTTPException(404, f'A composição própria {codigo} não existe.')
        calc = Calculo(c, ler_refs(refs))
        if d.base == BASE:
            alvo = calc.insumo_proprio(d.codigo) if d.tipo == 'insumo' else None
            if d.tipo == 'servico':
                if id_de(d.codigo, 'P') == cid:
                    raise HTTPException(422, 'Uma composição não pode usar a si mesma.')
                alvo = calc.composicao(d.codigo)
                # a composição que entra não pode usar esta (ciclo)
                if cod_comp(cid) in _todas_dependencias(c, id_de(d.codigo, 'P')):
                    raise HTTPException(422, f'{alvo["codigo"]} já usa {cod_comp(cid)}: incluir criaria um ciclo.')
            if not alvo:
                raise HTTPException(404, f'O item próprio {d.codigo} não existe.')
            desc, un, cod = alvo['descricao'], alvo['unidade'], alvo['codigo']
        else:
            o = calc.oficial(d.tipo, d.base, d.codigo)
            if not o:
                raise HTTPException(404, f'{d.codigo}/{d.base} não existe na data-base escolhida para a {d.base}.')
            desc, un, cod = o['descricao'], o['unidade'], o['codigo']
        ordem = c.execute('SELECT COALESCE(MAX(ordem), 0) + 1 FROM composicao_propria_item WHERE composicao_id = ?', (cid,)).fetchone()[0]
        cur = c.execute('INSERT INTO composicao_propria_item (composicao_id, ordem, tipo, base, codigo, qtd, descricao, unidade) VALUES (?,?,?,?,?,?,?,?)',
                        (cid, ordem, d.tipo, d.base, cod, d.qtd, desc, un))
        novo = cur.lastrowid
        _tocar(c, cid)
    r = ficha_composicao(codigo, refs); r['item_criado'] = novo
    return r


def _todas_dependencias(c, cid, vistos=None):
    vistos = vistos if vistos is not None else set()
    for r in c.execute("SELECT codigo FROM composicao_propria_item WHERE composicao_id = ? AND base = ? AND tipo = 'servico'", (cid, BASE)).fetchall():
        if r['codigo'] not in vistos:
            vistos.add(r['codigo'])
            _todas_dependencias(c, id_de(r['codigo'], 'P'), vistos)
    return vistos


def _item(c, iid):
    it = c.execute('SELECT * FROM composicao_propria_item WHERE id = ?', (iid,)).fetchone()
    if not it:
        raise HTTPException(404, 'Item não encontrado.')
    return it


@router.patch('/proprias/itens/{iid}')
def editar_item(iid: int, d: EdicaoItem, refs: str = ''):
    with gravando() as c:
        it = _item(c, iid)
        c.execute('UPDATE composicao_propria_item SET qtd = ? WHERE id = ?', (d.qtd, iid)); _tocar(c, it['composicao_id'])
    return ficha_composicao(cod_comp(it['composicao_id']), refs)


@router.delete('/proprias/itens/{iid}')
def excluir_item(iid: int, refs: str = ''):
    with gravando() as c:
        it = _item(c, iid)
        c.execute('DELETE FROM composicao_propria_item WHERE id = ?', (iid,)); _tocar(c, it['composicao_id'])
    r = ficha_composicao(cod_comp(it['composicao_id']), refs)
    r['desfazer'] = {'tipo': it['tipo'], 'base': it['base'], 'codigo': it['codigo'], 'qtd': it['qtd']}
    return r


@router.post('/proprias/itens/{iid}/mover')
def mover_item(iid: int, direcao: Literal['cima', 'baixo'], refs: str = ''):
    with gravando() as c:
        it = _item(c, iid)
        ids = [r['id'] for r in c.execute('SELECT id FROM composicao_propria_item WHERE composicao_id = ? ORDER BY ordem, id', (it['composicao_id'],)).fetchall()]
        k = ids.index(iid); j = k - 1 if direcao == 'cima' else k + 1
        if 0 <= j < len(ids):
            ids[k], ids[j] = ids[j], ids[k]
            for n, x in enumerate(ids, 1):
                c.execute('UPDATE composicao_propria_item SET ordem = ? WHERE id = ?', (n, x))
            _tocar(c, it['composicao_id'])
    return ficha_composicao(cod_comp(it['composicao_id']), refs)


@router.post('/proprias/copiar/{base}/{codigo}', status_code=201)
def copiar_oficial(base: str, codigo: str, ref: Optional[str] = None, refs: str = ''):
    """Nova composição própria com os itens de uma composição oficial (para ajustar coeficientes, trocar ou tirar itens)."""
    base = base.upper()
    if base not in BASES_OFICIAIS:
        raise HTTPException(404, 'Base não encontrada.')
    with orc_mod._base_conn() as b:
        mes = orc_mod.mes_para_base(b, base, ref or orc_mod.ultimo_por_base(b).get(base))
        s = b.execute('''SELECT s.codigo, s.descricao, s.unidade, s.grupo FROM servico s WHERE s.base = ? AND s.referencia = ?
            AND (s.codigo = ? OR ltrim(s.codigo, '0') = ltrim(?, '0'))''', (base, mes, codigo, codigo)).fetchone()
        comp = b.execute('SELECT modelo, prod_equipe FROM composicao WHERE base = ? AND codigo = ? AND referencia = ?', (base, s['codigo'] if s else codigo, mes)).fetchone()
        if not s or not comp:
            raise HTTPException(404, f'A composição {codigo}/{base} não existe nesse mês.')
        itens = b.execute('''SELECT secao, base, codigo, eh_servico, descricao, unidade, qtd FROM composicao_item
            WHERE composicao_base = ? AND composicao = ? AND referencia = ? AND codigo != '' AND qtd IS NOT NULL ORDER BY ordem''', (base, s['codigo'], mes)).fetchall()
    # no modelo DNIT (equipe com produção), equipamento e mão de obra viram coeficiente por unidade (qtd ÷ produção)
    prod = comp['prod_equipe'] if comp['modelo'] == 'DNIT' and comp['prod_equipe'] else None
    with gravando() as c:
        cur = c.execute('''INSERT INTO composicao_propria (descricao, unidade, grupo, observacoes, origem_base, origem_codigo, criado_em, atualizado_em)
            VALUES (?,?,?,?,?,?,?,?)''', (f"{s['descricao']} (ajustada)", s['unidade'], s['grupo'] or '',
                                         f'Criada a partir de {s["codigo"]}/{base} de {mes}.' + (' Sem o FIC (fator de influência de chuvas), que o DNIT calcula sobre a execução e não é um item.' if base == 'SICRO' else ''),
                                         base, s['codigo'], orc_mod.agora(), orc_mod.agora()))
        novo = cur.lastrowid
        n = 0
        for it in itens:
            if it['secao'] in ('FIC', 'TRANSPORTE'):
                continue  # FIC e transporte do DNIT não são itens com preço próprio
            qtd = it['qtd'] / prod if prod and it['secao'] in ('EQUIPAMENTO', 'MAO_DE_OBRA') else it['qtd']
            n += 1
            c.execute('INSERT INTO composicao_propria_item (composicao_id, ordem, tipo, base, codigo, qtd, descricao, unidade) VALUES (?,?,?,?,?,?,?,?)',
                      (novo, n, 'servico' if it['eh_servico'] else 'insumo', it['base'], it['codigo'], qtd, it['descricao'], it['unidade']))
    return ficha_composicao(cod_comp(novo), refs)


@router.post('/proprias/composicoes/{codigo}/duplicar', status_code=201)
def duplicar(codigo: str, refs: str = ''):
    cid = id_de(codigo, 'P')
    with gravando() as c:
        cp = c.execute('SELECT * FROM composicao_propria WHERE id = ?', (cid,)).fetchone()
        if not cp:
            raise HTTPException(404, f'A composição própria {codigo} não existe.')
        cur = c.execute('''INSERT INTO composicao_propria (descricao, unidade, grupo, observacoes, origem_base, origem_codigo, criado_em, atualizado_em)
            VALUES (?,?,?,?,?,?,?,?)''', (f"{cp['descricao']} (cópia)", cp['unidade'], cp['grupo'], cp['observacoes'], cp['origem_base'], cp['origem_codigo'],
                                         orc_mod.agora(), orc_mod.agora()))
        novo = cur.lastrowid
        for it in c.execute('SELECT * FROM composicao_propria_item WHERE composicao_id = ? ORDER BY ordem, id', (cid,)).fetchall():
            c.execute('INSERT INTO composicao_propria_item (composicao_id, ordem, tipo, base, codigo, qtd, descricao, unidade) VALUES (?,?,?,?,?,?,?,?)',
                      (novo, it['ordem'], it['tipo'], it['base'], it['codigo'], it['qtd'], it['descricao'], it['unidade']))
    return ficha_composicao(cod_comp(novo), refs)
