"""Orçamentos: etapas, itens, BDI, curva ABC e exportação.

Os orçamentos ficam num banco próprio (ORCAMENTOS_DB, padrão app/orcamentos.sqlite).
A base de preços (ORSE/SINAPI) é só leitura.
"""
import io
import os
import sqlite3
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from pydantic import BaseModel, Field

AQUI = Path(__file__).parent
ORC_DB = os.environ.get('ORCAMENTOS_DB', str(AQUI / 'orcamentos.sqlite'))
LIMITE_A, LIMITE_B = 0.80, 0.95  # curva ABC: A até 80% acumulado, B até 95%, C o restante

router = APIRouter(prefix='/api')
_base_conn = None  # definido por server.py


def configurar(conn_base):
    global _base_conn
    _base_conn = conn_base
    with orc() as c:
        c.executescript('''
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS orcamento (
          id INTEGER PRIMARY KEY, nome TEXT NOT NULL, cliente TEXT DEFAULT '', local TEXT DEFAULT '',
          referencia TEXT NOT NULL, bdi REAL NOT NULL DEFAULT 25.0, observacoes TEXT DEFAULT '',
          criado_em TEXT, atualizado_em TEXT);
        CREATE TABLE IF NOT EXISTS etapa (
          id INTEGER PRIMARY KEY, orcamento_id INTEGER NOT NULL REFERENCES orcamento(id) ON DELETE CASCADE,
          ordem INTEGER NOT NULL, titulo TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS item (
          id INTEGER PRIMARY KEY, orcamento_id INTEGER NOT NULL REFERENCES orcamento(id) ON DELETE CASCADE,
          etapa_id INTEGER NOT NULL REFERENCES etapa(id) ON DELETE CASCADE, ordem INTEGER NOT NULL,
          tipo TEXT NOT NULL, base TEXT NOT NULL, codigo TEXT NOT NULL, descricao TEXT, unidade TEXT,
          quantidade REAL NOT NULL DEFAULT 0, custo_unit REAL NOT NULL DEFAULT 0, referencia TEXT);
        CREATE INDEX IF NOT EXISTS ix_item_orc ON item(orcamento_id, etapa_id, ordem);
        ''')


def orc():
    c = sqlite3.connect(ORC_DB, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute('PRAGMA foreign_keys = ON')
    return c


def agora():
    return datetime.now().isoformat(timespec='seconds')


def r2(v):
    """Arredonda para 2 casas (meio para cima), como nas planilhas de obra pública."""
    from decimal import ROUND_HALF_UP, Decimal
    return float(Decimal(str(v)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))


# ---------- modelos ----------
class NovoOrcamento(BaseModel):
    nome: str = Field(min_length=1, max_length=200)
    cliente: str = ''
    local: str = ''
    bdi: float = Field(25.0, ge=0, le=100)
    referencia: Optional[str] = None  # mês de referência dos preços; padrão: o mais recente


class EdicaoOrcamento(BaseModel):
    nome: Optional[str] = Field(None, min_length=1, max_length=200)
    cliente: Optional[str] = None
    local: Optional[str] = None
    bdi: Optional[float] = Field(None, ge=0, le=100)
    observacoes: Optional[str] = None


class NovaEtapa(BaseModel):
    titulo: str = Field(min_length=1, max_length=200)


class NovoItem(BaseModel):
    etapa_id: Optional[int] = None
    tipo: Literal['servico', 'insumo']
    base: Literal['ORSE', 'SINAPI']
    codigo: str
    quantidade: float = Field(1.0, ge=0)


class EdicaoItem(BaseModel):
    quantidade: Optional[float] = Field(None, ge=0)
    etapa_id: Optional[int] = None
    ordem: Optional[int] = None


# ---------- leitura da base de preços ----------
def ref_atual(b):
    return dict(b.execute('SELECT id, descricao FROM referencia ORDER BY id DESC LIMIT 1').fetchone())


def preco_na_base(tipo, base, codigo, ref=None):
    with _base_conn() as b:
        ref = ref or ref_atual(b)['id']
        if tipo == 'servico':
            r = b.execute('''SELECT s.codigo, s.descricao, s.unidade, COALESCE(c.custo_total, s.preco) AS preco
                FROM servico s LEFT JOIN composicao c ON c.base = s.base AND c.codigo = s.codigo AND c.referencia = s.referencia
                WHERE s.base = ? AND (s.codigo = ? OR ltrim(s.codigo,'0') = ltrim(?,'0')) AND s.referencia = ?''',
                          (base, codigo, codigo, ref)).fetchone()
        else:
            r = b.execute('SELECT codigo, descricao, unidade, preco FROM insumo WHERE base = ? AND codigo = ? AND referencia = ?',
                          (base, codigo, ref)).fetchone()
        return (dict(r) | {'referencia': ref}) if r else None


def explodir(b, base, codigo, fator, acc, profundidade=0, ref=None):
    """Soma em `acc` os insumos de uma composição multiplicados por `fator` (quantidade do serviço).
    Usa a composição da referência `ref` (a do item no orçamento); sem ela, a mais recente."""
    comp = b.execute('''SELECT modelo, prod_equipe, referencia FROM composicao WHERE base = ? AND codigo = ?
        AND (? IS NULL OR referencia = ?) ORDER BY referencia DESC LIMIT 1''', (base, codigo, ref, ref)).fetchone()
    if not comp or profundidade > 6:
        return False
    itens = b.execute('''SELECT secao, base, codigo, eh_servico, descricao, unidade, qtd, custo_unit, custo_prod, custo_total
        FROM composicao_item WHERE composicao_base = ? AND composicao = ? AND referencia = ?''',
                      (base, codigo, comp['referencia'])).fetchall()
    for i in itens:
        q = i['qtd'] or 0
        if comp['modelo'] == 'DNIT' and i['secao'] in ('EQUIPAMENTO', 'MAO_DE_OBRA') and comp['prod_equipe']:
            q = q / comp['prod_equipe']
            cu = (i['custo_total'] / i['qtd']) if i['qtd'] else (i['custo_prod'] or 0)
        else:
            cu = i['custo_unit'] if i['custo_unit'] is not None else ((i['custo_total'] / i['qtd']) if i['qtd'] else 0)
        if i['eh_servico'] and explodir(b, i['base'], i['codigo'], fator * q, acc, profundidade + 1, comp['referencia']):
            continue
        k = (i['base'], i['codigo'], i['secao'])
        a = acc[k]
        a['descricao'], a['unidade'], a['secao'] = i['descricao'], i['unidade'], i['secao']
        a['qtd'] += fator * q
        a['custo'] += fator * q * (cu or 0)
    return True


# ---------- cálculo ----------
CATEGORIA_PARTE = {'PESSOAL': 'mo', 'EQUIPAMENTOS': 'equip', 'SERVIÇOS DE TERCEIROS': 'terc'}


def dividir_custo(b, itens, ref_orc):
    """Divisão do custo direto do orçamento em mão de obra, material, equipamento e terceiros (frações de 0 a 1).
    Serviço: usa a divisão da própria composição. Insumo: entra inteiro na parte da sua categoria."""
    partes = {'mo': 0.0, 'mat': 0.0, 'equip': 0.0, 'terc': 0.0}
    for i in itens:
        custo = i['custo_total']
        if not custo:
            continue
        r = b.execute('''SELECT categoria, pct_mo, pct_mat, pct_equip, pct_terc FROM item_busca
            WHERE tipo = ? AND base = ? AND codigo = ? AND referencia = ?''',
                      (i['tipo'], i['base'], i['codigo'], i['referencia'] or ref_orc)).fetchone()
        if i['tipo'] == 'servico' and r and r['pct_mo'] is not None:
            for k in partes:
                partes[k] += custo * (r['pct_' + k] or 0)
        elif i['tipo'] == 'insumo':
            partes[CATEGORIA_PARTE.get(r['categoria'] if r else '', 'mat')] += custo
        else:
            partes['mat'] += custo  # serviço sem composição detalhada
    soma = sum(partes.values())
    return {k: round(v / soma, 4) for k, v in partes.items()} if soma > 0 else None


def calcular(c, oid):
    o = c.execute('SELECT * FROM orcamento WHERE id = ?', (oid,)).fetchone()
    if not o:
        raise HTTPException(404, 'Orçamento não encontrado.')
    o = dict(o)
    fator_bdi = 1 + o['bdi'] / 100
    etapas = [dict(e) for e in c.execute('SELECT * FROM etapa WHERE orcamento_id = ? ORDER BY ordem, id', (oid,))]
    itens = [dict(i) for i in c.execute('SELECT * FROM item WHERE orcamento_id = ? ORDER BY ordem, id', (oid,))]
    por_etapa = defaultdict(list)
    for i in itens:
        i['preco_unit'] = r2(i['custo_unit'] * fator_bdi)
        i['custo_total'] = r2(i['quantidade'] * i['custo_unit'])
        i['total'] = r2(i['quantidade'] * i['preco_unit'])
        por_etapa[i['etapa_id']].append(i)
    total_custo = total = 0.0
    for n, e in enumerate(etapas, 1):
        e['numero'] = str(n)
        e['itens'] = por_etapa.get(e['id'], [])
        for m, i in enumerate(e['itens'], 1):
            i['numero'] = f'{n}.{m}'
        e['custo_total'] = r2(sum(i['custo_total'] for i in e['itens']))
        e['total'] = r2(sum(i['total'] for i in e['itens']))
        total_custo += e['custo_total']; total += e['total']
    o['etapas'] = etapas
    o['custo_total'] = r2(total_custo)
    o['total'] = r2(total)
    o['valor_bdi'] = r2(total - total_custo)
    o['qtd_itens'] = len(itens)
    refs_itens = sorted({i['referencia'] for i in itens if i['referencia']})
    o['referencias_itens'] = refs_itens
    with _base_conn() as b:
        atual = ref_atual(b)
        nomes = {r['id']: r['descricao'] for r in b.execute('SELECT id, descricao FROM referencia')}
        o['divisao'] = dividir_custo(b, itens, o['referencia'])
    o['referencia_atual'] = atual
    o['referencia_descricao'] = nomes.get(o['referencia'], o['referencia'])
    o['desatualizado'] = any(r < atual['id'] for r in refs_itens) or (not itens and o['referencia'] < atual['id'])
    for e in etapas:
        e['peso'] = (e['total'] / total) if total else 0
    return o


def classificar(linhas, chave):
    total = sum(l[chave] for l in linhas) or 1
    linhas.sort(key=lambda l: -l[chave])
    acum = 0.0
    for n, l in enumerate(linhas, 1):
        anterior = acum
        acum += l[chave]
        l['posicao'] = n
        l['percentual'] = l[chave] / total
        l['acumulado'] = acum / total
        l['classe'] = 'A' if anterior / total < LIMITE_A else ('B' if anterior / total < LIMITE_B else 'C')
    return linhas


def abc_servicos(o):
    agg = {}
    for e in o['etapas']:
        for i in e['itens']:
            k = (i['tipo'], i['base'], i['codigo'])
            a = agg.setdefault(k, {'tipo': i['tipo'], 'base': i['base'], 'codigo': i['codigo'], 'descricao': i['descricao'],
                                   'unidade': i['unidade'], 'quantidade': 0.0, 'preco_unit': i['preco_unit'], 'total': 0.0, 'itens': []})
            a['quantidade'] += i['quantidade']; a['total'] += i['total']; a['itens'].append(i['numero'])
    return classificar(list(agg.values()), 'total')


def abc_insumos(o):
    acc = defaultdict(lambda: {'qtd': 0.0, 'custo': 0.0})
    with _base_conn() as b:
        for e in o['etapas']:
            for i in e['itens']:
                if i['tipo'] == 'servico' and explodir(b, i['base'], i['codigo'], i['quantidade'], acc, ref=i['referencia']):
                    continue
                if i['tipo'] == 'servico':  # serviço sem composição: entra como ele mesmo
                    k = (i['base'], i['codigo'], 'SERVICO_SEM_COMPOSICAO')
                else:
                    k = (i['base'], i['codigo'], 'INSUMO_DIRETO')
                a = acc[k]
                a['descricao'], a['unidade'], a['secao'] = i['descricao'], i['unidade'], k[2]
                a['qtd'] += i['quantidade']; a['custo'] += i['quantidade'] * i['custo_unit']
    # junta o mesmo insumo vindo de seções diferentes
    junto = {}
    for (base, cod, secao), a in acc.items():
        j = junto.setdefault((base, cod), {'base': base, 'codigo': cod, 'descricao': a['descricao'], 'unidade': a['unidade'],
                                           'secao': secao, 'quantidade': 0.0, 'custo_total': 0.0})
        j['quantidade'] += a['qtd']; j['custo_total'] += a['custo']
    linhas = [j | {'custo_unit': (j['custo_total'] / j['quantidade']) if j['quantidade'] else 0} for j in junto.values() if j['custo_total'] > 0]
    return classificar(linhas, 'custo_total')


def resumo_abc(linhas, chave):
    out = {}
    for cl in 'ABC':
        g = [l for l in linhas if l['classe'] == cl]
        out[cl] = {'itens': len(g), 'valor': r2(sum(l[chave] for l in g))}
    return out


# ---------- rotas ----------
@router.get('/orcamentos')
def listar():
    with orc() as c:
        rows = c.execute('''SELECT o.*, (SELECT COUNT(*) FROM item i WHERE i.orcamento_id = o.id) AS qtd_itens
            FROM orcamento o ORDER BY atualizado_em DESC''').fetchall()
        out = []
        for r in rows:
            o = calcular(c, r['id'])
            out.append({k: o[k] for k in ('id', 'nome', 'cliente', 'local', 'referencia', 'bdi', 'total', 'qtd_itens', 'atualizado_em', 'desatualizado', 'custo_total', 'divisao')})
        return out


@router.post('/orcamentos', status_code=201)
def criar(d: NovoOrcamento):
    with _base_conn() as b:
        ref = d.referencia or ref_atual(b)['id']
        if not b.execute('SELECT 1 FROM referencia WHERE id = ?', (ref,)).fetchone():
            raise HTTPException(404, f'O mês {ref} não está carregado.')
    with orc() as c:
        cur = c.execute('INSERT INTO orcamento (nome, cliente, local, referencia, bdi, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?)',
                        (d.nome.strip(), d.cliente.strip(), d.local.strip(), ref, d.bdi, agora(), agora()))
        c.execute('INSERT INTO etapa (orcamento_id, ordem, titulo) VALUES (?, 1, ?)', (cur.lastrowid, 'Serviços preliminares'))
        return calcular(c, cur.lastrowid)


@router.get('/orcamentos/{oid}')
def obter(oid: int):
    with orc() as c:
        return calcular(c, oid)


@router.patch('/orcamentos/{oid}')
def editar(oid: int, d: EdicaoOrcamento):
    campos = {k: v for k, v in d.model_dump().items() if v is not None}
    with orc() as c:
        calcular(c, oid)
        if campos:
            sets = ', '.join(f'{k} = ?' for k in campos)
            c.execute(f'UPDATE orcamento SET {sets}, atualizado_em = ? WHERE id = ?', list(campos.values()) + [agora(), oid])
        return calcular(c, oid)


@router.delete('/orcamentos/{oid}')
def excluir(oid: int):
    with orc() as c:
        o = c.execute('SELECT * FROM orcamento WHERE id = ?', (oid,)).fetchone()
        if not o:
            raise HTTPException(404, 'Orçamento não encontrado.')
        desfazer = {'tipo': 'orcamento', 'orcamento': dict(o),
                    'etapas': [dict(r) for r in c.execute('SELECT * FROM etapa WHERE orcamento_id = ?', (oid,))],
                    'itens': [dict(r) for r in c.execute('SELECT * FROM item WHERE orcamento_id = ?', (oid,))]}
        c.execute('DELETE FROM orcamento WHERE id = ?', (oid,))
        return {'desfazer': desfazer}


@router.post('/orcamentos/{oid}/duplicar', status_code=201)
def duplicar(oid: int):
    with orc() as c:
        o = calcular(c, oid)
        cur = c.execute('INSERT INTO orcamento (nome, cliente, local, referencia, bdi, observacoes, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?)',
                        (o['nome'] + ' (cópia)', o['cliente'], o['local'], o['referencia'], o['bdi'], o['observacoes'], agora(), agora()))
        novo = cur.lastrowid
        for e in o['etapas']:
            eid = c.execute('INSERT INTO etapa (orcamento_id, ordem, titulo) VALUES (?,?,?)', (novo, e['ordem'], e['titulo'])).lastrowid
            for i in e['itens']:
                c.execute('''INSERT INTO item (orcamento_id, etapa_id, ordem, tipo, base, codigo, descricao, unidade, quantidade, custo_unit, referencia)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)''', (novo, eid, i['ordem'], i['tipo'], i['base'], i['codigo'], i['descricao'],
                                                     i['unidade'], i['quantidade'], i['custo_unit'], i['referencia']))
        return calcular(c, novo)


@router.post('/orcamentos/{oid}/etapas', status_code=201)
def nova_etapa(oid: int, d: NovaEtapa):
    with orc() as c:
        calcular(c, oid)
        ordem = c.execute('SELECT COALESCE(MAX(ordem), 0) + 1 FROM etapa WHERE orcamento_id = ?', (oid,)).fetchone()[0]
        c.execute('INSERT INTO etapa (orcamento_id, ordem, titulo) VALUES (?,?,?)', (oid, ordem, d.titulo.strip()))
        c.execute('UPDATE orcamento SET atualizado_em = ? WHERE id = ?', (agora(), oid))
        return calcular(c, oid)


@router.patch('/etapas/{eid}')
def editar_etapa(eid: int, d: NovaEtapa):
    with orc() as c:
        e = c.execute('SELECT orcamento_id FROM etapa WHERE id = ?', (eid,)).fetchone()
        if not e:
            raise HTTPException(404, 'Etapa não encontrada.')
        c.execute('UPDATE etapa SET titulo = ? WHERE id = ?', (d.titulo.strip(), eid))
        return calcular(c, e['orcamento_id'])


@router.post('/etapas/{eid}/mover')
def mover_etapa(eid: int, direcao: Literal['cima', 'baixo']):
    with orc() as c:
        e = c.execute('SELECT * FROM etapa WHERE id = ?', (eid,)).fetchone()
        if not e:
            raise HTTPException(404, 'Etapa não encontrada.')
        lista = [r['id'] for r in c.execute('SELECT id FROM etapa WHERE orcamento_id = ? ORDER BY ordem, id', (e['orcamento_id'],))]
        k = lista.index(eid); j = k - 1 if direcao == 'cima' else k + 1
        if 0 <= j < len(lista):
            lista[k], lista[j] = lista[j], lista[k]
            for n, x in enumerate(lista, 1):
                c.execute('UPDATE etapa SET ordem = ? WHERE id = ?', (n, x))
        return calcular(c, e['orcamento_id'])


@router.delete('/etapas/{eid}')
def excluir_etapa(eid: int):
    with orc() as c:
        e = c.execute('SELECT * FROM etapa WHERE id = ?', (eid,)).fetchone()
        if not e:
            raise HTTPException(404, 'Etapa não encontrada.')
        desfazer = {'tipo': 'etapa', 'etapas': [dict(e)], 'itens': [dict(r) for r in c.execute('SELECT * FROM item WHERE etapa_id = ?', (eid,))]}
        c.execute('DELETE FROM etapa WHERE id = ?', (eid,))
        c.execute('UPDATE orcamento SET atualizado_em = ? WHERE id = ?', (agora(), e['orcamento_id']))
        return calcular(c, e['orcamento_id']) | {'desfazer': desfazer}


@router.post('/orcamentos/{oid}/itens', status_code=201)
def novo_item(oid: int, d: NovoItem):
    with orc() as c:
        o = c.execute('SELECT referencia FROM orcamento WHERE id = ?', (oid,)).fetchone()
        if not o:
            raise HTTPException(404, 'Orçamento não encontrado.')
    # o item entra sempre com o preço do mês de referência do orçamento
    with _base_conn() as b:
        nome = b.execute('SELECT descricao FROM referencia WHERE id = ?', (o['referencia'],)).fetchone()
        nome = nome['descricao'].removesuffix('-1') if nome else o['referencia']
    p = preco_na_base(d.tipo, d.base, d.codigo, o['referencia'])
    if not p:
        raise HTTPException(404, f'{d.codigo}/{d.base} não existe em {nome}, a data-base deste orçamento.')
    if p['preco'] is None:
        raise HTTPException(422, f'{d.codigo}/{d.base} não tem preço em {nome} e não pode entrar no orçamento.')
    with orc() as c:
        calcular(c, oid)
        etapa = d.etapa_id
        if etapa is None:
            r = c.execute('SELECT id FROM etapa WHERE orcamento_id = ? ORDER BY ordem DESC, id DESC LIMIT 1', (oid,)).fetchone()
            etapa = r['id'] if r else c.execute('INSERT INTO etapa (orcamento_id, ordem, titulo) VALUES (?, 1, ?)', (oid, 'Serviços')).lastrowid
        elif not c.execute('SELECT 1 FROM etapa WHERE id = ? AND orcamento_id = ?', (etapa, oid)).fetchone():
            raise HTTPException(404, 'Etapa não encontrada neste orçamento.')
        ordem = c.execute('SELECT COALESCE(MAX(ordem), 0) + 1 FROM item WHERE etapa_id = ?', (etapa,)).fetchone()[0]
        cur = c.execute('''INSERT INTO item (orcamento_id, etapa_id, ordem, tipo, base, codigo, descricao, unidade, quantidade, custo_unit, referencia)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)''', (oid, etapa, ordem, d.tipo, d.base, p['codigo'], p['descricao'], p['unidade'],
                                             d.quantidade, p['preco'], p['referencia']))
        c.execute('UPDATE orcamento SET atualizado_em = ? WHERE id = ?', (agora(), oid))
        o = calcular(c, oid)
        o['item_criado'] = cur.lastrowid
        return o


@router.patch('/itens/{iid}')
def editar_item(iid: int, d: EdicaoItem):
    with orc() as c:
        i = c.execute('SELECT * FROM item WHERE id = ?', (iid,)).fetchone()
        if not i:
            raise HTTPException(404, 'Item não encontrado.')
        if d.quantidade is not None:
            c.execute('UPDATE item SET quantidade = ? WHERE id = ?', (d.quantidade, iid))
        if d.etapa_id is not None and d.etapa_id != i['etapa_id']:
            if not c.execute('SELECT 1 FROM etapa WHERE id = ? AND orcamento_id = ?', (d.etapa_id, i['orcamento_id'])).fetchone():
                raise HTTPException(404, 'Etapa não encontrada neste orçamento.')
            ordem = c.execute('SELECT COALESCE(MAX(ordem), 0) + 1 FROM item WHERE etapa_id = ?', (d.etapa_id,)).fetchone()[0]
            c.execute('UPDATE item SET etapa_id = ?, ordem = ? WHERE id = ?', (d.etapa_id, ordem, iid))
        c.execute('UPDATE orcamento SET atualizado_em = ? WHERE id = ?', (agora(), i['orcamento_id']))
        return calcular(c, i['orcamento_id'])


@router.post('/itens/{iid}/mover')
def mover_item(iid: int, direcao: Literal['cima', 'baixo']):
    with orc() as c:
        i = c.execute('SELECT * FROM item WHERE id = ?', (iid,)).fetchone()
        if not i:
            raise HTTPException(404, 'Item não encontrado.')
        lista = [r['id'] for r in c.execute('SELECT id FROM item WHERE etapa_id = ? ORDER BY ordem, id', (i['etapa_id'],))]
        k = lista.index(iid); j = k - 1 if direcao == 'cima' else k + 1
        if 0 <= j < len(lista):
            lista[k], lista[j] = lista[j], lista[k]
            for n, x in enumerate(lista, 1):
                c.execute('UPDATE item SET ordem = ? WHERE id = ?', (n, x))
        return calcular(c, i['orcamento_id'])


@router.delete('/itens/{iid}')
def excluir_item(iid: int):
    with orc() as c:
        i = c.execute('SELECT * FROM item WHERE id = ?', (iid,)).fetchone()
        if not i:
            raise HTTPException(404, 'Item não encontrado.')
        c.execute('DELETE FROM item WHERE id = ?', (iid,))
        c.execute('UPDATE orcamento SET atualizado_em = ? WHERE id = ?', (agora(), i['orcamento_id']))
        return calcular(c, i['orcamento_id']) | {'desfazer': {'tipo': 'item', 'etapas': [], 'itens': [dict(i)]}}


# ---------- arrastar: põe o item ou a etapa numa posição exata ----------
def _renumerar(c, tabela, ids):
    for n, x in enumerate(ids, 1):
        c.execute(f'UPDATE {tabela} SET ordem = ? WHERE id = ?', (n, x))


@router.post('/itens/{iid}/posicionar')
def posicionar_item(iid: int, etapa_id: int, posicao: int = Query(ge=0)):
    """Move o item para a etapa `etapa_id`, na posição `posicao` (0 = primeiro)."""
    with orc() as c:
        i = c.execute('SELECT * FROM item WHERE id = ?', (iid,)).fetchone()
        if not i:
            raise HTTPException(404, 'Item não encontrado.')
        if not c.execute('SELECT 1 FROM etapa WHERE id = ? AND orcamento_id = ?', (etapa_id, i['orcamento_id'])).fetchone():
            raise HTTPException(404, 'Etapa não encontrada neste orçamento.')
        destino = [r['id'] for r in c.execute('SELECT id FROM item WHERE etapa_id = ? AND id <> ? ORDER BY ordem, id', (etapa_id, iid))]
        destino.insert(min(posicao, len(destino)), iid)
        c.execute('UPDATE item SET etapa_id = ? WHERE id = ?', (etapa_id, iid))
        _renumerar(c, 'item', destino)
        if etapa_id != i['etapa_id']:
            _renumerar(c, 'item', [r['id'] for r in c.execute('SELECT id FROM item WHERE etapa_id = ? ORDER BY ordem, id', (i['etapa_id'],))])
        c.execute('UPDATE orcamento SET atualizado_em = ? WHERE id = ?', (agora(), i['orcamento_id']))
        return calcular(c, i['orcamento_id'])


@router.post('/etapas/{eid}/posicionar')
def posicionar_etapa(eid: int, posicao: int = Query(ge=0)):
    with orc() as c:
        e = c.execute('SELECT * FROM etapa WHERE id = ?', (eid,)).fetchone()
        if not e:
            raise HTTPException(404, 'Etapa não encontrada.')
        lista = [r['id'] for r in c.execute('SELECT id FROM etapa WHERE orcamento_id = ? AND id <> ? ORDER BY ordem, id', (e['orcamento_id'], eid))]
        lista.insert(min(posicao, len(lista)), eid)
        _renumerar(c, 'etapa', lista)
        c.execute('UPDATE orcamento SET atualizado_em = ? WHERE id = ?', (agora(), e['orcamento_id']))
        return calcular(c, e['orcamento_id'])


# ---------- desfazer uma exclusão ----------
class Desfazer(BaseModel):
    tipo: Literal['item', 'etapa', 'orcamento']
    orcamento: Optional[dict] = None
    etapas: list[dict] = []
    itens: list[dict] = []


COLUNAS = {
    'orcamento': ('id', 'nome', 'cliente', 'local', 'referencia', 'bdi', 'observacoes', 'criado_em', 'atualizado_em'),
    'etapa': ('id', 'orcamento_id', 'ordem', 'titulo'),
    'item': ('id', 'orcamento_id', 'etapa_id', 'ordem', 'tipo', 'base', 'codigo', 'descricao', 'unidade', 'quantidade', 'custo_unit', 'referencia'),
}


def _reinserir(c, tabela, linha):
    """Recoloca a linha com o mesmo id; se o id já foi reaproveitado, entra com um novo. Devolve o id final."""
    cols = [k for k in COLUNAS[tabela] if k in linha]
    if c.execute(f'SELECT 1 FROM {tabela} WHERE id = ?', (linha.get('id'),)).fetchone():
        cols.remove('id')
    cur = c.execute(f"INSERT INTO {tabela} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})", [linha[k] for k in cols])
    return cur.lastrowid


@router.post('/restaurar', status_code=201)
def restaurar(d: Desfazer):
    """Devolve ao orçamento o que a última exclusão tirou (o corpo é o `desfazer` que a exclusão retornou)."""
    try:
        with orc() as c:
            oid = None
            if d.tipo == 'orcamento':
                if not d.orcamento:
                    raise HTTPException(422, 'Faltam os dados do orçamento.')
                oid = _reinserir(c, 'orcamento', d.orcamento)
            mapa = {}
            for e in d.etapas:
                e = dict(e)
                if oid is not None:
                    e['orcamento_id'] = oid
                if not c.execute('SELECT 1 FROM orcamento WHERE id = ?', (e.get('orcamento_id'),)).fetchone():
                    raise HTTPException(404, 'O orçamento não existe mais.')
                mapa[e.get('id')] = _reinserir(c, 'etapa', e)
                oid = oid or e['orcamento_id']
            for i in d.itens:
                i = dict(i)
                if d.tipo == 'orcamento':
                    i['orcamento_id'] = oid
                i['etapa_id'] = mapa.get(i.get('etapa_id'), i.get('etapa_id'))
                if not c.execute('SELECT 1 FROM etapa WHERE id = ? AND orcamento_id = ?', (i['etapa_id'], i.get('orcamento_id'))).fetchone():
                    raise HTTPException(404, 'A etapa deste item não existe mais.')
                _reinserir(c, 'item', i)
                oid = oid or i['orcamento_id']
            if oid is None:
                raise HTTPException(422, 'Nada para restaurar.')
            c.execute('UPDATE orcamento SET atualizado_em = ? WHERE id = ?', (agora(), oid))
            return calcular(c, oid)
    except (sqlite3.IntegrityError, KeyError, TypeError):
        raise HTTPException(422, 'Não foi possível desfazer: os dados não conferem.')


def _simular(c, oid, ref=None):
    o = calcular(c, oid)
    with _base_conn() as b:
        ref = ref or ref_atual(b)['id']
        if not b.execute('SELECT 1 FROM referencia WHERE id = ?', (ref,)).fetchone():
            raise HTTPException(404, f'A referência {ref} não está carregada.')
    fator = 1 + o['bdi'] / 100
    linhas, sem = [], []
    novo_total = 0.0
    for e in o['etapas']:
        for i in e['itens']:
            p = preco_na_base(i['tipo'], i['base'], i['codigo'], ref)
            if not p or p['preco'] is None:
                sem.append({'id': i['id'], 'numero': i['numero'], 'codigo': i['codigo'], 'base': i['base'], 'descricao': i['descricao'],
                            'motivo': 'saiu da base' if not p else 'sem preço na nova referência'})
                novo_total += i['total']
                continue
            nt = r2(i['quantidade'] * r2(p['preco'] * fator))
            novo_total += nt
            linhas.append({'id': i['id'], 'numero': i['numero'], 'codigo': i['codigo'], 'base': i['base'], 'descricao': i['descricao'],
                           'unidade': i['unidade'], 'quantidade': i['quantidade'], 'de_referencia': i['referencia'],
                           'custo_unit_antes': i['custo_unit'], 'custo_unit_depois': p['preco'], 'total_antes': i['total'], 'total_depois': nt,
                           'variacao': (p['preco'] / i['custo_unit'] - 1) if i['custo_unit'] else None})
    linhas.sort(key=lambda l: -abs(l['total_depois'] - l['total_antes']))
    return {'referencia': ref, 'total_antes': o['total'], 'total_depois': r2(novo_total),
            'variacao': (novo_total / o['total'] - 1) if o['total'] else None, 'itens': linhas, 'sem_preco': sem}


@router.get('/orcamentos/{oid}/atualizacao')
def simular_atualizacao(oid: int, referencia: Optional[str] = None):
    """Mostra quanto o orçamento muda se os preços forem levados para outra referência (padrão: a mais recente)."""
    with orc() as c:
        return _simular(c, oid, referencia)


@router.post('/orcamentos/{oid}/atualizar')
def atualizar(oid: int, referencia: Optional[str] = None):
    """Leva os custos unitários para a referência escolhida. Itens que saíram da base ficam com o preço antigo."""
    with orc() as c:
        sim = _simular(c, oid, referencia)
        ref = sim['referencia']
        for l in sim['itens']:
            c.execute('UPDATE item SET custo_unit = ?, referencia = ? WHERE id = ?', (l['custo_unit_depois'], ref, l['id']))
        c.execute('UPDATE orcamento SET referencia = ?, atualizado_em = ? WHERE id = ?', (ref, agora(), oid))
        o = calcular(c, oid)
        o['atualizacao'] = {'referencia': ref, 'total_antes': sim['total_antes'], 'itens_atualizados': len(sim['itens']),
                            'sem_preco': sim['sem_preco']}
        return o


@router.get('/orcamentos/{oid}/abc')
def curva_abc(oid: int, tipo: Literal['servicos', 'insumos'] = 'servicos'):
    with orc() as c:
        o = calcular(c, oid)
    if tipo == 'servicos':
        linhas = abc_servicos(o)
        return {'tipo': tipo, 'total': o['total'], 'linhas': linhas, 'resumo': resumo_abc(linhas, 'total')}
    linhas = abc_insumos(o)
    soma = r2(sum(l['custo_total'] for l in linhas))
    return {'tipo': tipo, 'total': soma, 'custo_direto': o['custo_total'], 'linhas': linhas, 'resumo': resumo_abc(linhas, 'custo_total')}


# ---------- exportação ----------
AZUL = '1D5C8C'


def _cab(ws, linha, nomes, larguras):
    for j, (n, w) in enumerate(zip(nomes, larguras), 1):
        cel = ws.cell(row=linha, column=j, value=n)
        cel.font = Font(bold=True, color='FFFFFF'); cel.fill = PatternFill('solid', fgColor=AZUL)
        cel.alignment = Alignment(vertical='center', wrap_text=True)
        ws.column_dimensions[get_column_letter(j)].width = w


@router.get('/orcamentos/{oid}/exportar.xlsx')
def exportar(oid: int):
    with orc() as c:
        o = calcular(c, oid)
    wb = Workbook()
    ws = wb.active; ws.title = 'Orçamento'
    ws['A1'] = o['nome']; ws['A1'].font = Font(bold=True, size=14)
    ws['A2'] = f"Cliente: {o['cliente'] or '-'}    Local: {o['local'] or '-'}"
    ws['A3'] = f"Data-base: {o['referencia_descricao']} (ORSE e SINAPI, CEHOP/SE)"
    ws['G2'] = 'BDI'; ws['G2'].font = Font(bold=True)
    ws['H2'] = o['bdi'] / 100; ws['H2'].number_format = '0.00%'; ws['H2'].font = Font(bold=True, color=AZUL)
    _cab(ws, 5, ['Item', 'Código', 'Base', 'Descrição', 'Un.', 'Quant.', 'Custo unit. (R$)', 'Preço unit. c/ BDI (R$)', 'Total (R$)'],
         [7, 9, 8, 70, 6, 11, 14, 15, 16])
    linha = 6
    linhas_etapa = []
    for e in o['etapas']:
        ini = linha
        ws.cell(row=linha, column=1, value=e['numero']).font = Font(bold=True)
        ws.cell(row=linha, column=4, value=e['titulo']).font = Font(bold=True)
        tot_cel = ws.cell(row=linha, column=9); tot_cel.font = Font(bold=True); tot_cel.number_format = '#,##0.00'
        for j in range(1, 10):
            ws.cell(row=linha, column=j).fill = PatternFill('solid', fgColor='E3EDF5')
        linha += 1
        for i in e['itens']:
            ws.cell(row=linha, column=1, value=i['numero'])
            ws.cell(row=linha, column=2, value=i['codigo'])
            ws.cell(row=linha, column=3, value=i['base'])
            ws.cell(row=linha, column=4, value=i['descricao']).alignment = Alignment(wrap_text=True, vertical='top')
            ws.cell(row=linha, column=5, value=i['unidade'])
            ws.cell(row=linha, column=6, value=i['quantidade']).number_format = '#,##0.00'
            ws.cell(row=linha, column=7, value=i['custo_unit']).number_format = '#,##0.00'
            ws.cell(row=linha, column=8, value=f'=ROUND(G{linha}*(1+$H$2),2)').number_format = '#,##0.00'
            ws.cell(row=linha, column=9, value=f'=ROUND(F{linha}*H{linha},2)').number_format = '#,##0.00'
            linha += 1
        tot_cel.value = f'=SUM(I{ini + 1}:I{linha - 1})' if linha - 1 > ini else 0
        linhas_etapa.append(ini)
        linha += 1
    soma_etapas = '+'.join(f'I{x}' for x in linhas_etapa) or '0'
    ws.cell(row=linha, column=8, value='Custo direto').font = Font(bold=True)
    ws.cell(row=linha, column=9, value=f'=SUMPRODUCT(F6:F{linha - 1},G6:G{linha - 1})').number_format = '#,##0.00'
    ws.cell(row=linha + 1, column=8, value='BDI').font = Font(bold=True)
    ws.cell(row=linha + 1, column=9, value=f'=I{linha + 2}-I{linha}').number_format = '#,##0.00'
    ws.cell(row=linha + 2, column=8, value='Total geral').font = Font(bold=True, size=12)
    t = ws.cell(row=linha + 2, column=9, value=f'={soma_etapas}'); t.number_format = '#,##0.00'; t.font = Font(bold=True, size=12)
    ws.cell(row=linha + 4, column=1, value='Preço unitário com BDI e total por item arredondados em 2 casas. Altere o BDI na célula H2.').font = Font(color='5B6875', size=9)
    ws.freeze_panes = 'A6'

    for nome, tipo, chave in (('Curva ABC serviços', 'servicos', 'total'), ('Curva ABC insumos', 'insumos', 'custo_total')):
        abc = curva_abc(oid, tipo)
        s = wb.create_sheet(nome)
        s['A1'] = f"{nome} — {o['nome']}"; s['A1'].font = Font(bold=True, size=13)
        s['A2'] = ('Valores com BDI.' if tipo == 'servicos' else 'Custo direto, sem BDI, com as composições desmontadas até o insumo.') + \
            f' Classe A até {LIMITE_A:.0%} do valor acumulado, B até {LIMITE_B:.0%}, C o restante.'
        cab = ['Pos.', 'Código', 'Base', 'Descrição', 'Un.', 'Quant.', 'Unit. (R$)', 'Total (R$)', '%', '% acum.', 'Classe']
        _cab(s, 4, cab, [6, 9, 8, 66, 6, 13, 13, 15, 8, 9, 7])
        for k, l in enumerate(abc['linhas'], 5):
            unit = l.get('preco_unit', l.get('custo_unit'))
            vals = [l['posicao'], l['codigo'], l['base'], l['descricao'], l['unidade'], l['quantidade'], unit, l[chave],
                    l['percentual'], l['acumulado'], l['classe']]
            for j, v in enumerate(vals, 1):
                cel = s.cell(row=k, column=j, value=v)
                if j in (6,): cel.number_format = '#,##0.0000'
                if j in (7, 8): cel.number_format = '#,##0.00'
                if j in (9, 10): cel.number_format = '0.00%'
        s.freeze_panes = 'A5'
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    nome = ''.join(ch if ch.isalnum() or ch in '-_' else '_' for ch in o['nome'])[:60]
    return StreamingResponse(buf, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                             headers={'Content-Disposition': f'attachment; filename="orcamento_{nome}.xlsx"'})
