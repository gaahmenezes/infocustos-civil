"""Mão de obra e prazo do orçamento: horas de cada profissional por serviço e por etapa, e o prazo estimado.

As horas vêm das composições: quantidade do item x coeficiente de cada profissional (em h por unidade), com as
composições auxiliares abertas até o fim. Os encargos complementares (alimentação, transporte, curso de capacitação...)
ficam de fora: não são tempo de trabalho na obra. Profissional em "mês" (encarregado, engenheiro) não entra na conta
do prazo: aparece à parte, como acompanhamento.

Prazo de um grupo de serviços = o maior entre os profissionais de (horas / (equipe x jornada x produtividade)).
As etapas correm em sequência, na ordem do orçamento: o prazo de cada nível é a soma dos de dentro.
"""
import io
import json
import math
import re
import unicodedata
from collections import defaultdict
from datetime import date, timedelta

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font

import orcamento as orc_mod

router = APIRouter(prefix='/api')
UNIDADE_HORA = {'h'}
UNIDADE_MES = {'mes', 'mês'}
CATEGORIA_MO = {'PESSOAL', 'MÃO DE OBRA', 'MAO_DE_OBRA'}
_LIMPAR = re.compile(r'\((?:horista|mensalista)\)|-\s*(?:horista|mensalista)\b|com encargos complementares', re.I)


def _sem_acento(t):
    return ''.join(ch for ch in unicodedata.normalize('NFKD', t) if not unicodedata.combining(ch))


def profissional(descricao):
    """Nome do profissional sem "(horista)" e afins, e a chave que junta o mesmo profissional vindo de bases diferentes."""
    nome = re.sub(r'\s+', ' ', _LIMPAR.sub('', descricao or '')).strip(' ,-')
    nome = nome[:1].upper() + nome[1:].lower() if nome.isupper() else nome[:1].upper() + nome[1:]
    return _sem_acento(nome.lower()), nome


def _somar(destino, descricao, unidade, qtd):
    if not qtd:
        return
    chave, nome = profissional(descricao)
    un = (unidade or '').strip().lower()
    tipo = 'h' if un in UNIDADE_HORA else ('mes' if un in UNIDADE_MES else None)
    if not tipo:
        return
    d = destino.setdefault(chave, {'nome': nome, 'h': 0.0, 'mes': 0.0})
    d[tipo] += qtd


def _oficial(b, base, codigo, fator, ref, destino):
    acc = defaultdict(lambda: {'qtd': 0.0, 'custo': 0.0})
    if not orc_mod.explodir(b, base, codigo, fator, acc, ref=ref, sem_compl=True):
        return False
    for (_, _, secao), a in acc.items():
        if secao == 'MAO_DE_OBRA':
            _somar(destino, a['descricao'], a['unidade'], a['qtd'])
    return True


def _propria(b, calc, codigo, fator, destino, prof=0):
    import proprias
    comp = calc.composicao(codigo)
    for it in comp['itens']:
        q = fator * (it['qtd'] or 0)
        if it['base'] == proprias.BASE:
            if it['eh_servico'] and prof < 6:
                _propria(b, calc, it['codigo'], q, destino, prof + 1)
            elif it['secao'] == 'MAO_DE_OBRA':
                _somar(destino, it['descricao'], it['unidade'], q)
        elif it['eh_servico']:
            _oficial(b, it['base'], it['codigo'], q, it['referencia'], destino)
        elif it['secao'] == 'MAO_DE_OBRA':
            _somar(destino, it['descricao'], it['unidade'], q)
    return True


def horas_do_item(b, i, ref_orc):
    """{chave: {nome, h, mes}} de um item do orçamento; None se o item não tem como dizer (serviço sem composição)."""
    destino = {}
    ref = i['referencia'] or ref_orc
    if i['base'] == 'PROPRIA':
        import proprias
        try:
            with proprias._calculo(ref) as calc:
                if i['tipo'] == 'servico':
                    _propria(b, calc, i['codigo'], i['quantidade'], destino)
                else:
                    ins = calc.insumo_proprio(i['codigo'])
                    if ins and ins['secao'] == 'MAO_DE_OBRA':
                        _somar(destino, ins['descricao'], ins['unidade'], i['quantidade'])
        except Exception:  # composição própria apagada ou com erro: fica sem dados
            return None
        return destino
    if i['tipo'] == 'servico':
        return destino if _oficial(b, i['base'], i['codigo'], i['quantidade'], i['referencia'], destino) else None
    r = b.execute('SELECT categoria FROM item_busca WHERE tipo = ? AND base = ? AND codigo = ? AND referencia = ?',
                  ('insumo', i['base'], i['codigo'], ref)).fetchone()
    if r and (r['categoria'] or '').upper() in CATEGORIA_MO:
        _somar(destino, i['descricao'], i['unidade'], i['quantidade'])
    return destino


def mao_de_obra(o):
    """Horas por item, por etapa (com o que está dentro) e por profissional, do orçamento já calculado `o`."""
    profs, itens, sem_dados = {}, [], 0
    por_etapa = defaultdict(lambda: defaultdict(float))
    with orc_mod._base_conn() as b:
        for e in o['etapas']:
            for i in e['itens']:
                h = horas_do_item(b, i, o['referencia'])
                if h is None:
                    sem_dados += 1
                horas = {}
                for k, v in (h or {}).items():
                    p = profs.setdefault(k, {'chave': k, 'nome': v['nome'], 'horas': 0.0, 'meses': 0.0})
                    p['horas'] += v['h']; p['meses'] += v['mes']
                    if v['h']:
                        horas[k] = round(v['h'], 4)
                        por_etapa[e['id']][k] += v['h']
                itens.append({'id': i['id'], 'numero': i['numero'], 'etapa_id': e['id'], 'tipo': i['tipo'], 'base': i['base'],
                              'codigo': i['codigo'], 'descricao': i['descricao'], 'unidade': i['unidade'], 'quantidade': i['quantidade'],
                              'horas': horas, 'sem_dados': h is None})
    # cada nível soma o que está dentro (as etapas vêm na ordem da planilha: as de dentro logo depois da mãe)
    etapas = [{'id': e['id'], 'numero': e['numero'], 'nivel': e['nivel'], 'titulo': e['titulo'], 'pai_id': e.get('pai_id'),
               'horas_proprias': {k: round(v, 4) for k, v in por_etapa[e['id']].items()}} for e in o['etapas']]
    soma = {e['id']: defaultdict(float, por_etapa[e['id']]) for e in etapas}
    for e in reversed(etapas):
        if e['pai_id'] in soma:
            for k, v in soma[e['id']].items():
                soma[e['pai_id']][k] += v
    for e in etapas:
        e['horas'] = {k: round(v, 4) for k, v in soma[e['id']].items() if v}
    lista = sorted(profs.values(), key=lambda p: (-p['horas'], -p['meses']))
    for p in lista:
        p['horas'], p['meses'] = round(p['horas'], 2), round(p['meses'], 4)
    return {'profissionais': [p for p in lista if p['horas'] > 0],
            'mensais': [p for p in lista if p['meses'] > 0 and p['horas'] == 0],
            'etapas': etapas, 'itens': itens, 'sem_dados': sem_dados,
            'horas_total': round(sum(p['horas'] for p in lista), 2)}


def dias(horas, equipe, jornada, produtividade):
    """Dias úteis de um grupo de horas {chave: h} e o profissional que define o prazo."""
    pior, quem = 0.0, None
    capacidade = jornada * produtividade / 100
    for k, h in horas.items():
        n = max(int(equipe.get(k) or 1), 1)
        d = h / (n * capacidade) if capacidade > 0 else 0
        if d > pior:
            pior, quem = d, k
    return pior, quem


def prazos(dados, equipe, jornada, produtividade, paralelas=frozenset()):
    """Cronograma: cada etapa começa quando a anterior (no mesmo nível) termina, ou junto com ela se estiver em
    `paralelas`; dentro da etapa, primeiro os itens diretos, depois as de dentro. Devolve {id: (dias, gargalo, início, fim)}
    e o total, em dias úteis. É a mesma conta da tela (prazo.js)."""
    filhas = defaultdict(list)
    for e in dados['etapas']:
        filhas[e['pai_id']].append(e)
    res = {}

    def grupo(lista, ini):
        cursor = fim = ini
        ini_ant = None
        for f in lista:
            s0 = ini_ant if f['id'] in paralelas and ini_ant is not None else cursor
            fe = agenda(f, s0)
            ini_ant, cursor, fim = s0, max(cursor, fe), max(fim, fe)
        return fim

    def agenda(e, ini):
        d, quem = dias(e['horas_proprias'], equipe, jornada, produtividade)
        fim = grupo(filhas[e['id']], ini + d)
        if quem is None:  # a etapa não tem itens diretos: o gargalo é o da filha mais longa
            maior = max(filhas[e['id']], key=lambda f: res[f['id']][0], default=None)
            quem = res[maior['id']][1] if maior else None
        res[e['id']] = (fim - ini, quem, ini, fim)
        return fim

    total = grupo(filhas[None], 0)
    return res, total


def data_util(inicio, dias_uteis):
    """Data do dia útil número `dias_uteis` (0 = o primeiro), contando de segunda a sexta, sem feriados."""
    d = inicio
    while d.weekday() >= 5:
        d += timedelta(days=1)
    falta = int(math.floor(dias_uteis + 1e-9))
    while falta > 0:
        d += timedelta(days=1)
        if d.weekday() < 5:
            falta -= 1
    return d


@router.get('/orcamentos/{oid}/mao-de-obra')
def obter(oid: int):
    with orc_mod.orc() as c:
        o = orc_mod.calcular(c, oid)
    return mao_de_obra(o)


@router.get('/orcamentos/{oid}/mao-de-obra.xlsx')
def exportar(oid: int, jornada: float = Query(8, gt=0, le=24), produtividade: float = Query(100, gt=0, le=300),
             equipe: str = Query('{}'), paralelas: str = Query(''), inicio: str = Query('')):
    with orc_mod.orc() as c:
        o = orc_mod.calcular(c, oid)
    dados = mao_de_obra(o)
    try:
        eq = {k: int(v) for k, v in json.loads(equipe).items()}
    except (ValueError, AttributeError, TypeError):
        eq = {}
    par = frozenset(int(x) for x in paralelas.split(',') if x.strip().isdigit())
    try:
        dia0 = date.fromisoformat(inicio) if inicio else None
    except ValueError:
        dia0 = None
    res, total = prazos(dados, eq, jornada, produtividade, par)
    quando = (lambda ini, fim: (data_util(dia0, ini), data_util(dia0, max(math.ceil(fim - 1e-9) - 1, math.floor(ini + 1e-9))))) if dia0 else None
    nomes = {p['chave']: p['nome'] for p in dados['profissionais']}
    wb = Workbook()
    ws = wb.active; ws.title = 'Prazo'
    ws['A1'] = f"Mão de obra e prazo — {o['nome']}"; ws['A1'].font = Font(bold=True, size=14)
    ws['A2'] = (f'Jornada de {jornada:g} h por dia, produtividade de {produtividade:g}% da base. Etapas em sequência, na ordem do orçamento'
                + (', a não ser as marcadas para correr junto com a anterior. ' if par else '. ') + f'Prazo estimado: {total:.1f} dias úteis' + (f', de {data_util(dia0, 0):%d/%m/%Y} a {data_util(dia0, max(math.ceil(total - 1e-9) - 1, 0)):%d/%m/%Y}' if dia0 else '') + '.')
    orc_mod._cab(ws, 4, ['Profissional', 'Horas', 'Equipe', 'Dias úteis com essa equipe'], [44, 14, 10, 16])
    cap = jornada * produtividade / 100
    for k, p in enumerate(dados['profissionais'], 5):
        n = max(int(eq.get(p['chave']) or 1), 1)
        ws.cell(row=k, column=1, value=p['nome'])
        ws.cell(row=k, column=2, value=p['horas']).number_format = '#,##0.0'
        ws.cell(row=k, column=3, value=n)
        ws.cell(row=k, column=4, value=round(p['horas'] / (n * cap), 1)).number_format = '#,##0.0'
    linha = 6 + len(dados['profissionais'])
    if dados['mensais']:
        ws.cell(row=linha, column=1, value='Acompanhamento (em meses, fora da conta do prazo)').font = Font(bold=True)
        for p in dados['mensais']:
            linha += 1
            ws.cell(row=linha, column=1, value=p['nome']); ws.cell(row=linha, column=2, value=p['meses']).number_format = '#,##0.00'
        linha += 2
    orc_mod._cab(ws, linha, ['Item', 'Etapa / serviço', 'Horas de mão de obra', 'Dias úteis', 'Quem define o prazo', 'Começa no dia útil', 'Termina no dia útil']
                 + (['Início', 'Fim'] if quando else []), [10, 70, 18, 12, 30, 14, 14, 12, 12])
    ws.column_dimensions['A'].width = 44
    por_etapa = defaultdict(list)
    for i in dados['itens']:
        por_etapa[i['etapa_id']].append(i)
    for e in dados['etapas']:
        linha += 1
        d, quem, ini, fim = res[e['id']]
        vals = [e['numero'], ('   ' * (e['nivel'] - 1)) + e['titulo'], round(sum(e['horas'].values()), 1), round(d, 1), nomes.get(quem, ''),
                round(ini, 1) if d else None, round(fim, 1) if d else None]
        if quando and d:
            vals += list(quando(ini, fim))
        for j, v in enumerate(vals, 1):
            cel = ws.cell(row=linha, column=j, value=v); cel.font = Font(bold=True)
            if j > 7:
                cel.number_format = 'DD/MM/YYYY'
        for i in por_etapa[e['id']]:
            linha += 1
            ws.cell(row=linha, column=1, value=i['numero'])
            ws.cell(row=linha, column=2, value=('   ' * e['nivel']) + f"{i['codigo']} {i['descricao']}").alignment = Alignment(wrap_text=True)
            ws.cell(row=linha, column=3, value=round(sum(i['horas'].values()), 2)).number_format = '#,##0.00'
            ws.cell(row=linha, column=5, value='sem composição: não entra' if i['sem_dados'] else
                    ' · '.join(f"{nomes.get(k, k)} {v:,.1f} h".replace(',', 'X').replace('.', ',').replace('X', '.') for k, v in sorted(i['horas'].items(), key=lambda x: -x[1])))
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    return StreamingResponse(buf, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                             headers={'Content-Disposition': orc_mod.disposicao(f"prazo_{o['nome']}.xlsx")})
