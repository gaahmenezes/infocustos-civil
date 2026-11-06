"""Servidor do protótipo de consulta ORSE/SINAPI.

Rodar:  uvicorn server:app --port 8000   (dentro da pasta app/)
Banco:  variável ORSE_DB ou ../dados/orse_sinapi_2026-05.sqlite
"""
import io
import os
import re
import unicodedata
import sqlite3
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

AQUI = Path(__file__).parent
DB = os.environ.get('ORSE_DB', str(AQUI.parent / 'dados' / 'orse_sinapi_2026-05.sqlite'))
BASES = {'ORSE', 'SINAPI'}
SECOES = {
    'MAO_DE_OBRA': 'Mão de obra', 'MATERIAL': 'Material', 'EQUIPAMENTO': 'Equipamento',
    'SERVICO_TERCEIRO': 'Serviço de terceiro', 'SERVICO_AUXILIAR': 'Serviço auxiliar',
}

app = FastAPI(title='Consulta ORSE/SINAPI')


def conn():
    c = sqlite3.connect(f'file:{DB}?mode=ro', uri=True, check_same_thread=False)
    c.row_factory = sqlite3.Row
    return c


def referencia_atual(c):
    r = c.execute('SELECT id, descricao, encargo_social_horista FROM referencia ORDER BY id DESC LIMIT 1').fetchone()
    return dict(r)


def checar_base(base):
    base = base.upper()
    if base not in BASES:
        raise HTTPException(404, 'Base não encontrada. Use ORSE ou SINAPI.')
    return base


def sem_acento(t):
    return unicodedata.normalize('NFKD', t or '').encode('ascii', 'ignore').decode().lower()


def pontuar(r, q):
    """Ordem dos resultados: relevância do texto, mais bônus para o que o orçamentista costuma procurar."""
    termos = re.findall(r'[a-z0-9]+', sem_acento(q))
    desc = sem_acento(r['descricao'])
    palavras = re.findall(r'[a-z0-9]+', desc)
    s = r['rel']  # bm25: quanto menor, melhor
    if termos and palavras and palavras[0].startswith(termos[0]):
        s -= 6  # a descrição começa pelo que foi digitado
    elif termos and any(w.startswith(termos[0]) for w in palavras[:4]):
        s -= 2
    if r['tipo'] == 'servico':
        s -= 1.5
    s -= min(r['usos'] or 0, 2000) / 1000
    s += len(palavras) / 200  # descrições enxutas primeiro, em empate
    return s


def montar_fts(q):
    termos = re.findall(r'[\wÀ-ÿ]+', q)
    if not termos:
        return None
    return ' '.join(f'"{t}"*' for t in termos)


@app.get('/api/referencia')
def api_referencia():
    with conn() as c:
        ref = referencia_atual(c)
        tot = c.execute('SELECT tipo, base, COUNT(*) n FROM item_busca GROUP BY 1, 2').fetchall()
        ref['totais'] = [dict(t) for t in tot]
        return ref


@app.get('/api/busca')
def api_busca(q: str = '', base: str = 'todas', tipo: str = 'todos', limite: int = Query(60, le=500)):
    filtros, args = [], []
    if base.upper() in BASES:
        filtros.append('i.base = ?'); args.append(base.upper())
    if tipo in ('servico', 'insumo'):
        filtros.append('i.tipo = ?'); args.append(tipo)
    q = q.strip()
    with conn() as c:
        so_codigo = re.fullmatch(r'\d{1,7}', q)
        if so_codigo:
            w = ' AND '.join(filtros + ['(i.codigo = ? OR ltrim(i.codigo, "0") = ltrim(?, "0") OR i.codigo LIKE ?)'])
            rows = c.execute(f'''SELECT i.*, NULL AS trecho FROM item_busca i WHERE {w}
                ORDER BY (ltrim(i.codigo,'0') = ltrim(?,'0')) DESC, i.tipo DESC, i.codigo LIMIT ?''',
                args + [q, q, q + '%', q, limite]).fetchall()
            total = len(rows)
        elif q:
            fts = montar_fts(q)
            if not fts:
                return {'total': 0, 'itens': []}
            w = ' AND '.join(['busca MATCH ?'] + filtros)
            base_sql = f'FROM busca JOIN item_busca i ON i.id = busca.rowid WHERE {w}'
            total = c.execute(f'SELECT COUNT(*) {base_sql}', [fts] + args).fetchone()[0]
            cand = c.execute(f'''SELECT i.*, highlight(busca, 0, '\u0001', '\u0002') AS trecho,
                    bm25(busca, 1.0, 4.0) AS rel {base_sql}
                ORDER BY rel LIMIT 400''', [fts] + args).fetchall()
            rows = sorted(cand, key=lambda r: pontuar(r, q))[:limite]
        else:
            w = ('WHERE ' + ' AND '.join(filtros)) if filtros else ''
            total = c.execute(f'SELECT COUNT(*) FROM item_busca i {w}', args).fetchone()[0]
            rows = c.execute(f'SELECT i.*, NULL AS trecho FROM item_busca i {w} ORDER BY i.usos DESC LIMIT ?',
                             args + [limite]).fetchall()
        return {'total': total, 'itens': [{k: r[k] for k in r.keys() if k != 'rel'} for r in rows]}


def ler_composicao(c, base, codigo):
    comp = c.execute('''SELECT c.*, s.descricao, s.grupo, s.subgrupo, s.tipo AS categoria FROM composicao c
        LEFT JOIN servico s ON s.base = c.base AND s.codigo = c.codigo AND s.referencia = c.referencia
        WHERE c.base = ? AND (c.codigo = ? OR ltrim(c.codigo,'0') = ltrim(?,'0'))
        ORDER BY c.referencia DESC LIMIT 1''', (base, codigo, codigo)).fetchone()
    if not comp:
        return None
    # Códigos de insumo e de composição se repetem na mesma base; só item marcado como serviço tem composição.
    itens = c.execute('''SELECT i.*, (i.eh_servico = 1 AND EXISTS (SELECT 1 FROM composicao x WHERE x.base = i.base
            AND x.codigo = i.codigo AND x.referencia = i.referencia)) AS tem_composicao
        FROM composicao_item i WHERE i.composicao_base = ? AND i.composicao = ? AND i.referencia = ?
        ORDER BY i.ordem''', (comp['base'], comp['codigo'], comp['referencia'])).fetchall()
    d = dict(comp)
    d['itens'] = [dict(i) | {'tem_composicao': bool(i['tem_composicao'])} for i in itens]
    return d


@app.get('/api/composicao/{base}/{codigo}')
def api_composicao(base: str, codigo: str):
    base = checar_base(base)
    with conn() as c:
        d = ler_composicao(c, base, codigo)
        if not d:
            raise HTTPException(404, f'A composição {codigo}/{base} não existe nesta referência.')
        d['usada_em'] = c.execute('''SELECT COUNT(DISTINCT composicao_base || composicao) FROM composicao_item
            WHERE base = ? AND codigo = ? AND eh_servico = 1''', (base, d['codigo'])).fetchone()[0]
        return d


@app.get('/api/insumo/{base}/{codigo}')
def api_insumo(base: str, codigo: str, limite: int = Query(100, le=2000)):
    base = checar_base(base)
    with conn() as c:
        ins = c.execute('SELECT * FROM insumo WHERE base = ? AND codigo = ? ORDER BY referencia DESC LIMIT 1',
                        (base, codigo)).fetchone()
        if not ins:
            raise HTTPException(404, f'O insumo {codigo}/{base} não existe nesta referência.')
        total = c.execute('''SELECT COUNT(DISTINCT composicao_base || composicao) FROM composicao_item
            WHERE base = ? AND codigo = ? AND eh_servico = 0''', (base, codigo)).fetchone()[0]
        # No modelo DNIT, equipamento e mão de obra são custo horário da equipe: divide pela produção.
        usos = c.execute('''SELECT i.composicao_base AS base, i.composicao AS codigo, s.descricao, s.unidade,
                CASE WHEN c.modelo = 'DNIT' AND i.secao IN ('EQUIPAMENTO', 'MAO_DE_OBRA') AND c.prod_equipe > 0
                     THEN i.qtd / c.prod_equipe ELSE i.qtd END AS qtd,
                CASE WHEN c.modelo = 'DNIT' AND i.secao IN ('EQUIPAMENTO', 'MAO_DE_OBRA') AND c.prod_equipe > 0
                     THEN i.custo_total / c.prod_equipe ELSE i.custo_total END AS custo_item,
                c.custo_total AS preco_composicao
            FROM composicao_item i
            JOIN composicao c ON c.base = i.composicao_base AND c.codigo = i.composicao AND c.referencia = i.referencia
            LEFT JOIN servico s ON s.base = c.base AND s.codigo = c.codigo AND s.referencia = c.referencia
            WHERE i.base = ? AND i.codigo = ? AND i.eh_servico = 0
            ORDER BY (custo_item / NULLIF(c.custo_total, 0)) DESC LIMIT ?''', (base, codigo, limite)).fetchall()
        return dict(ins) | {'usado_em': total, 'usos': [dict(u) | {'custo_total': u['custo_item']} for u in usos]}


# ---------- Exportação ----------
AZUL = '1D5C8C'
FINO = Side(style='thin', color='C9D0D6')


def _cab(ws, linha, valores, larguras=None):
    for j, v in enumerate(valores, 1):
        cel = ws.cell(row=linha, column=j, value=v)
        cel.font = Font(bold=True, color='FFFFFF')
        cel.fill = PatternFill('solid', fgColor=AZUL)
        cel.alignment = Alignment(vertical='center', wrap_text=True)
    if larguras:
        for j, w in enumerate(larguras, 1):
            ws.column_dimensions[get_column_letter(j)].width = w


def _xlsx(wb, nome):
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    return StreamingResponse(buf, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                             headers={'Content-Disposition': f'attachment; filename="{nome}"'})


def _escrever_itens(ws, c, comp, linha, nivel, expandir, fator=1.0):
    for i in comp['itens']:
        ws.cell(row=linha, column=1, value=('    ' * nivel) + f"{i['codigo']}/{i['base']}")
        ws.cell(row=linha, column=2, value=SECOES.get(i['secao'], i['secao']))
        ws.cell(row=linha, column=3, value=('    ' * nivel) + (i['descricao'] or ''))
        ws.cell(row=linha, column=4, value=i['unidade'])
        ws.cell(row=linha, column=5, value=i['qtd']).number_format = '0.0000000'
        ws.cell(row=linha, column=6, value=i['custo_unit']).number_format = '#,##0.00'
        ws.cell(row=linha, column=7, value=i['custo_total']).number_format = '#,##0.00'
        if nivel:
            for j in range(1, 8):
                ws.cell(row=linha, column=j).font = Font(color='5B6875', italic=True)
        linha += 1
        if expandir and i['tem_composicao'] and nivel < 4:
            sub = ler_composicao(c, i['base'], i['codigo'])
            if sub:
                linha = _escrever_itens(ws, c, sub, linha, nivel + 1, expandir)
    return linha


@app.get('/api/exportar/composicao/{base}/{codigo}.xlsx')
def exportar_composicao(base: str, codigo: str, expandir: bool = True):
    base = checar_base(base)
    with conn() as c:
        comp = ler_composicao(c, base, codigo)
        if not comp:
            raise HTTPException(404, 'Composição não encontrada.')
        ref = referencia_atual(c)
        wb = Workbook(); ws = wb.active; ws.title = f"{comp['codigo']}-{base}"[:31]
        ws['A1'] = f"Composição {comp['codigo']}/{base}"; ws['A1'].font = Font(bold=True, size=14)
        ws['A2'] = comp['descricao']; ws['A2'].alignment = Alignment(wrap_text=True); ws.merge_cells('A2:G2')
        ws.row_dimensions[2].height = 32
        ws['A3'] = f"Unidade: {comp['unidade']}    Referência: {ref['descricao']}    Encargo social: {comp['encargo_social'] or '-'}%"
        if comp['prod_equipe']:
            ws['A3'] = ws['A3'].value + f"    Produção da equipe: {comp['prod_equipe']}"
        _cab(ws, 5, ['Código', 'Seção', 'Descrição', 'Un.', 'Coeficiente', 'Custo unit. (R$)', 'Custo total (R$)'],
             [16, 18, 70, 7, 14, 16, 16])
        linha = _escrever_itens(ws, c, comp, 6, 0, expandir)
        linha += 1
        resumo = [('Equipamento', comp['custo_equipamento']), ('Mão de obra', comp['custo_mao_de_obra']),
                  ('Encargo social', comp['custo_encargo_social']), ('Material', comp['custo_material']),
                  ('Serviço de terceiro', comp['custo_servico_terceiro']), ('Custo total', comp['custo_total'])]
        for nome, v in resumo:
            ws.cell(row=linha, column=6, value=nome).font = Font(bold=nome == 'Custo total')
            cel = ws.cell(row=linha, column=7, value=v); cel.number_format = '#,##0.00'
            cel.font = Font(bold=nome == 'Custo total'); linha += 1
        ws.cell(row=linha + 1, column=1, value=f"Fonte: {base}, referência {ref['descricao']}. Gerado pelo InfoCustos Civil.").font = Font(color='5B6875', size=9)
        ws.freeze_panes = 'A6'
        return _xlsx(wb, f"composicao_{comp['codigo']}_{base}.xlsx")


@app.get('/api/exportar/busca.xlsx')
def exportar_busca(q: str = '', base: str = 'todas', tipo: str = 'todos'):
    res = api_busca(q=q, base=base, tipo=tipo, limite=500)
    with conn() as c:
        ref = referencia_atual(c)
    wb = Workbook(); ws = wb.active; ws.title = 'Resultado'
    ws['A1'] = f"Busca: {q or '(todos)'}  |  Base: {base}  |  Tipo: {tipo}  |  Referência: {ref['descricao']}"
    ws['A1'].font = Font(bold=True)
    _cab(ws, 3, ['Tipo', 'Base', 'Código', 'Descrição', 'Un.', 'Preço (R$)', 'Grupo', 'Usado em'], [9, 8, 10, 80, 7, 14, 34, 10])
    for k, r in enumerate(res['itens'], 4):
        vals = ['Serviço' if r['tipo'] == 'servico' else 'Insumo', r['base'], r['codigo'], r['descricao'], r['unidade'],
                r['preco'], r['grupo'], r['usos']]
        for j, v in enumerate(vals, 1):
            cel = ws.cell(row=k, column=j, value=v)
            if j == 6: cel.number_format = '#,##0.00'
    ws.freeze_panes = 'A4'; ws.auto_filter.ref = f'A3:H{3 + len(res["itens"])}'
    return _xlsx(wb, 'busca_orse_sinapi.xlsx')


import orcamento  # noqa: E402
orcamento.configurar(conn)
app.include_router(orcamento.router)

app.mount('/static', StaticFiles(directory=AQUI / 'static'), name='static')


@app.get('/')
def index():
    return FileResponse(AQUI / 'static' / 'index.html')
