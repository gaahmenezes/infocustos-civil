"""Servidor do InfoCustos Civil: consulta ORSE/SINAPI por mês de referência, orçamento e comparativo entre meses.

Rodar:  uvicorn server:app --port 8000   (dentro da pasta app/)
Banco:  variável ORSE_DB ou ../dados/orse_sinapi.sqlite (todas as referências)

Cada consulta trabalha com UM mês (parâmetro `ref`, padrão: o mais recente). Dados de meses
diferentes só aparecem juntos em /api/comparativo.
"""
import io
import os
import re
import sqlite3
import unicodedata
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

AQUI = Path(__file__).parent
DB = os.environ.get('ORSE_DB', str(AQUI.parent / 'dados' / 'orse_sinapi.sqlite'))
BASES = {'ORSE', 'SINAPI'}
SECOES = {
    'MAO_DE_OBRA': 'Mão de obra', 'MATERIAL': 'Material', 'EQUIPAMENTO': 'Equipamento',
    'SERVICO_TERCEIRO': 'Serviço de terceiro', 'SERVICO_AUXILIAR': 'Serviço auxiliar',
}

app = FastAPI(title='InfoCustos Civil')


def conn():
    c = sqlite3.connect(f'file:{DB}?mode=ro', uri=True, check_same_thread=False)
    c.row_factory = sqlite3.Row
    return c


def referencias(c):
    return [dict(r) for r in c.execute('SELECT * FROM referencia ORDER BY id')]


def referencia_atual(c):
    return referencias(c)[-1]


def mes(c, ref: Optional[str]):
    """Valida o mês pedido; sem mês, usa o mais recente."""
    todas = referencias(c)
    if not ref:
        return todas[-1]
    for r in todas:
        if r['id'] == ref:
            return r
    raise HTTPException(404, f'O mês {ref} não está carregado. Meses disponíveis: ' + ', '.join(r['id'] for r in todas) + '.')


def nome_mes(r):
    return r['descricao'].removesuffix('-1')


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
    palavras = re.findall(r'[a-z0-9]+', sem_acento(r['descricao']))
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
    return ' '.join(f'"{t}"*' for t in termos) if termos else None


# ---------- consulta (um mês) ----------
@app.get('/api/referencia')
def api_referencia(ref: Optional[str] = None):
    with conn() as c:
        r = mes(c, ref)
        tot = c.execute('SELECT tipo, base, COUNT(*) n FROM item_busca WHERE referencia = ? GROUP BY 1, 2', (r['id'],)).fetchall()
        tem_enc = {row[0] for row in c.execute('SELECT DISTINCT tipo FROM encargo WHERE referencia = ?', (r['id'],))}
        return r | {'totais': [dict(t) for t in tot], 'referencias': referencias(c), 'atual': referencia_atual(c)['id'],
                    'encargos_detalhados': sorted(tem_enc)}


@app.get('/api/busca')
def api_busca(q: str = '', base: str = 'todas', tipo: str = 'todos', limite: int = Query(60, le=500), ref: Optional[str] = None):
    with conn() as c:
        r = mes(c, ref)
        filtros, args = ['i.referencia = ?'], [r['id']]
        if base.upper() in BASES:
            filtros.append('i.base = ?'); args.append(base.upper())
        if tipo in ('servico', 'insumo'):
            filtros.append('i.tipo = ?'); args.append(tipo)
        q = q.strip()
        grade = []  # contagem por tipo × base para o termo, sem os filtros de tipo/base (para os números dos filtros)
        if re.fullmatch(r'\d{1,7}', q):
            cond = '(i.codigo = ? OR ltrim(i.codigo, "0") = ltrim(?, "0") OR i.codigo LIKE ?)'
            grade = c.execute(f'SELECT i.tipo, i.base, COUNT(*) n FROM item_busca i WHERE i.referencia = ? AND {cond} GROUP BY 1, 2',
                              [r['id'], q, q, q + '%']).fetchall()
            w = ' AND '.join(filtros + [cond])
            rows = c.execute(f'''SELECT i.*, NULL AS trecho FROM item_busca i WHERE {w}
                ORDER BY (ltrim(i.codigo,'0') = ltrim(?,'0')) DESC, i.tipo DESC, i.codigo LIMIT ?''',
                args + [q, q, q + '%', q, limite]).fetchall()
            total = len(rows)
        elif q:
            fts = montar_fts(q)
            if not fts:
                return {'total': 0, 'itens': [], 'referencia': r['id']}
            grade = c.execute('''SELECT i.tipo, i.base, COUNT(*) n FROM busca JOIN item_busca i ON i.id = busca.rowid
                WHERE busca MATCH ? AND i.referencia = ? GROUP BY 1, 2''', [fts, r['id']]).fetchall()
            w = ' AND '.join(['busca MATCH ?'] + filtros)
            base_sql = f'FROM busca JOIN item_busca i ON i.id = busca.rowid WHERE {w}'
            total = c.execute(f'SELECT COUNT(*) {base_sql}', [fts] + args).fetchone()[0]
            cand = c.execute(f'''SELECT i.*, highlight(busca, 0, '\u0001', '\u0002') AS trecho, bm25(busca, 1.0, 4.0) AS rel {base_sql}
                ORDER BY rel LIMIT 400''', [fts] + args).fetchall()
            rows = sorted(cand, key=lambda x: pontuar(x, q))[:limite]
        else:
            w = 'WHERE ' + ' AND '.join(filtros)
            total = c.execute(f'SELECT COUNT(*) FROM item_busca i {w}', args).fetchone()[0]
            rows = c.execute(f'SELECT i.*, NULL AS trecho FROM item_busca i {w} ORDER BY i.usos DESC LIMIT ?', args + [limite]).fetchall()
        return {'total': total, 'referencia': r['id'], 'grade': [dict(g) for g in grade],
                'itens': [{k: x[k] for k in x.keys() if k != 'rel'} for x in rows]}


def ler_composicao(c, base, codigo, ref):
    comp = c.execute('''SELECT c.*, s.descricao, s.grupo, s.subgrupo, s.tipo AS categoria FROM composicao c
        LEFT JOIN servico s ON s.base = c.base AND s.codigo = c.codigo AND s.referencia = c.referencia
        WHERE c.base = ? AND c.referencia = ? AND (c.codigo = ? OR ltrim(c.codigo,'0') = ltrim(?,'0'))''',
                     (base, ref, codigo, codigo)).fetchone()
    if not comp:
        return None
    # Códigos de insumo e de composição se repetem na mesma base; só item marcado como serviço tem composição.
    itens = c.execute('''SELECT i.*, (i.eh_servico = 1 AND EXISTS (SELECT 1 FROM composicao x WHERE x.base = i.base
            AND x.codigo = i.codigo AND x.referencia = i.referencia)) AS tem_composicao
        FROM composicao_item i WHERE i.composicao_base = ? AND i.composicao = ? AND i.referencia = ?
        ORDER BY i.ordem''', (comp['base'], comp['codigo'], ref)).fetchall()
    return dict(comp) | {'itens': [dict(i) | {'tem_composicao': bool(i['tem_composicao'])} for i in itens]}


@app.get('/api/composicao/{base}/{codigo}')
def api_composicao(base: str, codigo: str, ref: Optional[str] = None):
    base = checar_base(base)
    with conn() as c:
        r = mes(c, ref)
        d = ler_composicao(c, base, codigo, r['id'])
        if not d:
            raise HTTPException(404, f'A composição {codigo}/{base} não existe em {nome_mes(r)}.')
        d['usada_em'] = c.execute('''SELECT COUNT(DISTINCT composicao_base || composicao) FROM composicao_item
            WHERE base = ? AND codigo = ? AND eh_servico = 1 AND referencia = ?''', (base, d['codigo'], r['id'])).fetchone()[0]
        return d


@app.get('/api/insumo/{base}/{codigo}')
def api_insumo(base: str, codigo: str, limite: int = Query(100, le=2000), ref: Optional[str] = None):
    base = checar_base(base)
    with conn() as c:
        r = mes(c, ref)
        ins = c.execute('SELECT * FROM insumo WHERE base = ? AND codigo = ? AND referencia = ?', (base, codigo, r['id'])).fetchone()
        if not ins:
            raise HTTPException(404, f'O insumo {codigo}/{base} não existe em {nome_mes(r)}.')
        total = c.execute('''SELECT COUNT(DISTINCT composicao_base || composicao) FROM composicao_item
            WHERE base = ? AND codigo = ? AND eh_servico = 0 AND referencia = ?''', (base, codigo, r['id'])).fetchone()[0]
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
            WHERE i.base = ? AND i.codigo = ? AND i.eh_servico = 0 AND i.referencia = ?
            ORDER BY (custo_item / NULLIF(c.custo_total, 0)) DESC LIMIT ?''', (base, codigo, r['id'], limite)).fetchall()
        return dict(ins) | {'usado_em': total, 'usos': [dict(u) | {'custo_total': u['custo_item']} for u in usos]}


@app.get('/api/encargos')
def api_encargos(ref: Optional[str] = None):
    with conn() as c:
        r = mes(c, ref)
        out = {}
        for tipo in ('horista', 'mensalista'):
            linhas = [dict(x) for x in c.execute('SELECT grupo, item, descricao, valor FROM encargo WHERE referencia = ? AND tipo = ? ORDER BY grupo, item = grupo DESC, item',
                                                 (r['id'], tipo))]
            out[tipo] = {'total': r.get(f'encargo_social_{tipo}'), 'linhas': linhas}
        return {'referencia': r} | out


# ---------- comparativo entre meses (único lugar onde meses aparecem juntos) ----------
@app.get('/api/comparativo')
def api_comparativo(de: Optional[str] = None, para: Optional[str] = None, base: str = 'todas', tipo: str = 'servico',
                    sentido: str = 'alta', q: str = '', limite: int = Query(150, le=1000)):
    with conn() as c:
        refs = referencias(c)
        if len(refs) < 2:
            return {'de': None, 'para': refs[-1], 'referencias': refs, 'resumo': None, 'itens': []}
        a = mes(c, de or refs[-2]['id']); b = mes(c, para or refs[-1]['id'])
        if a['id'] == b['id']:
            raise HTTPException(422, 'Escolha dois meses diferentes para comparar.')
        tipo = tipo if tipo in ('servico', 'insumo') else 'servico'
        filtros, args = ['h1.tipo = ?'], [tipo]
        if base.upper() in BASES:
            filtros.append('h1.base = ?'); args.append(base.upper())
        juncao = f'''FROM historico h1 JOIN historico h2 ON h2.tipo = h1.tipo AND h2.base = h1.base AND h2.codigo = h1.codigo
            AND h2.referencia = ? WHERE h1.referencia = ? AND {' AND '.join(filtros)}'''
        jargs = [b['id'], a['id']] + args
        resumo = dict(c.execute(f'''SELECT COUNT(*) AS comparados,
                SUM(h2.preco > h1.preco + 0.005) AS subiram, SUM(h2.preco < h1.preco - 0.005) AS desceram,
                SUM(abs(h2.preco - h1.preco) <= 0.005) AS iguais
            {juncao} AND h1.preco > 0 AND h2.preco IS NOT NULL''', jargs).fetchone())
        so_em = lambda x, y: c.execute(f'''SELECT COUNT(*) FROM historico h1 WHERE h1.referencia = ? AND {' AND '.join(filtros)}
            AND NOT EXISTS (SELECT 1 FROM historico h2 WHERE h2.tipo = h1.tipo AND h2.base = h1.base AND h2.codigo = h1.codigo
            AND h2.referencia = ?)''', [x] + args + [y]).fetchone()[0]
        resumo['novos'] = so_em(b['id'], a['id']); resumo['retirados'] = so_em(a['id'], b['id'])
        extra, eargs = '', []
        if q.strip():
            extra = ' AND (i.descricao LIKE ? OR i.codigo = ?)'; eargs = [f'%{q.strip()}%', q.strip()]
        ordem = 'DESC' if sentido != 'baixa' else 'ASC'
        rows = c.execute(f'''SELECT h1.tipo, h1.base, h1.codigo, i.descricao, i.unidade, i.grupo,
                h1.preco AS preco_de, h2.preco AS preco_para, h2.preco / h1.preco - 1 AS variacao
            FROM historico h1
            JOIN historico h2 ON h2.tipo = h1.tipo AND h2.base = h1.base AND h2.codigo = h1.codigo AND h2.referencia = ?
            JOIN item_busca i ON i.tipo = h1.tipo AND i.base = h1.base AND i.codigo = h1.codigo AND i.referencia = h2.referencia
            WHERE h1.referencia = ? AND {' AND '.join(filtros)} AND h1.preco > 0 AND h2.preco IS NOT NULL{extra}
            ORDER BY variacao {ordem} LIMIT ?''', jargs + eargs + [limite]).fetchall()
        return {'de': a, 'para': b, 'referencias': refs, 'resumo': resumo, 'itens': [dict(x) for x in rows]}


@app.get('/api/comparativo/item/{tipo}/{base}/{codigo}')
def api_comparativo_item(tipo: str, base: str, codigo: str):
    """Preço do item em cada mês carregado."""
    base = checar_base(base)
    with conn() as c:
        linhas = [dict(x) for x in c.execute('''SELECT r.id AS referencia, r.descricao, h.preco FROM referencia r
            LEFT JOIN historico h ON h.referencia = r.id AND h.tipo = ? AND h.base = ? AND h.codigo = ? ORDER BY r.id''',
                                             (tipo, base, codigo))]
        if all(x['preco'] is None for x in linhas) and not c.execute('SELECT 1 FROM item_busca WHERE tipo = ? AND base = ? AND codigo = ?',
                                                                    (tipo, base, codigo)).fetchone():
            raise HTTPException(404, f'{codigo}/{base} não existe em nenhum mês carregado.')
        info = c.execute('SELECT descricao, unidade FROM item_busca WHERE tipo = ? AND base = ? AND codigo = ? ORDER BY referencia DESC LIMIT 1',
                         (tipo, base, codigo)).fetchone()
        return {'tipo': tipo, 'base': base, 'codigo': codigo, 'descricao': info['descricao'] if info else '', 'unidade': info['unidade'] if info else '',
                'meses': linhas}


# ---------- Exportação ----------
AZUL = '1D5C8C'


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


def _escrever_itens(ws, c, comp, linha, nivel, expandir):
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
            sub = ler_composicao(c, i['base'], i['codigo'], comp['referencia'])
            if sub:
                linha = _escrever_itens(ws, c, sub, linha, nivel + 1, expandir)
    return linha


@app.get('/api/exportar/composicao/{base}/{codigo}.xlsx')
def exportar_composicao(base: str, codigo: str, expandir: bool = True, ref: Optional[str] = None):
    base = checar_base(base)
    with conn() as c:
        r = mes(c, ref)
        comp = ler_composicao(c, base, codigo, r['id'])
        if not comp:
            raise HTTPException(404, f'A composição {codigo}/{base} não existe em {nome_mes(r)}.')
        wb = Workbook(); ws = wb.active; ws.title = f"{comp['codigo']}-{base}"[:31]
        ws['A1'] = f"Composição {comp['codigo']}/{base}"; ws['A1'].font = Font(bold=True, size=14)
        ws['A2'] = comp['descricao']; ws['A2'].alignment = Alignment(wrap_text=True); ws.merge_cells('A2:G2')
        ws.row_dimensions[2].height = 32
        ws['A3'] = f"Unidade: {comp['unidade']}    Referência: {r['descricao']}    Encargo social: {comp['encargo_social'] or '-'}%"
        if comp['prod_equipe']:
            ws['A3'] = ws['A3'].value + f"    Produção da equipe: {comp['prod_equipe']}"
        _cab(ws, 5, ['Código', 'Seção', 'Descrição', 'Un.', 'Coeficiente', 'Custo unit. (R$)', 'Custo total (R$)'], [16, 18, 70, 7, 14, 16, 16])
        linha = _escrever_itens(ws, c, comp, 6, 0, expandir) + 1
        for nome, v in [('Equipamento', comp['custo_equipamento']), ('Mão de obra', comp['custo_mao_de_obra']),
                        ('Encargo social', comp['custo_encargo_social']), ('Material', comp['custo_material']),
                        ('Serviço de terceiro', comp['custo_servico_terceiro']), ('Custo total', comp['custo_total'])]:
            ws.cell(row=linha, column=6, value=nome).font = Font(bold=nome == 'Custo total')
            cel = ws.cell(row=linha, column=7, value=v); cel.number_format = '#,##0.00'; cel.font = Font(bold=nome == 'Custo total')
            linha += 1
        ws.cell(row=linha + 1, column=1, value=f"Fonte: {base}, referência {r['descricao']}. Gerado pelo InfoCustos Civil.").font = Font(color='5B6875', size=9)
        ws.freeze_panes = 'A6'
        return _xlsx(wb, f"composicao_{comp['codigo']}_{base}_{r['id']}.xlsx")


@app.get('/api/exportar/busca.xlsx')
def exportar_busca(q: str = '', base: str = 'todas', tipo: str = 'todos', ref: Optional[str] = None):
    res = api_busca(q=q, base=base, tipo=tipo, limite=500, ref=ref)
    with conn() as c:
        r = mes(c, res['referencia'])
    wb = Workbook(); ws = wb.active; ws.title = 'Resultado'
    ws['A1'] = f"Busca: {q or '(todos)'}  |  Base: {base}  |  Tipo: {tipo}  |  Referência: {r['descricao']}"
    ws['A1'].font = Font(bold=True)
    _cab(ws, 3, ['Tipo', 'Base', 'Código', 'Descrição', 'Un.', 'Preço (R$)', 'Grupo', 'Usado em'], [9, 8, 10, 80, 7, 14, 34, 10])
    for k, x in enumerate(res['itens'], 4):
        for j, v in enumerate(['Serviço' if x['tipo'] == 'servico' else 'Insumo', x['base'], x['codigo'], x['descricao'], x['unidade'],
                               x['preco'], x['grupo'], x['usos']], 1):
            cel = ws.cell(row=k, column=j, value=v)
            if j == 6:
                cel.number_format = '#,##0.00'
    ws.freeze_panes = 'A4'; ws.auto_filter.ref = f'A3:H{3 + len(res["itens"])}'
    return _xlsx(wb, f"busca_{r['id']}.xlsx")


import orcamento  # noqa: E402

orcamento.configurar(conn)
app.include_router(orcamento.router)
app.mount('/static', StaticFiles(directory=AQUI / 'static'), name='static')


@app.get('/manifest.webmanifest')
def manifesto():
    """Permite instalar o site como aplicativo no celular e no computador."""
    icone = lambda n, uso='any': {'src': f'/static/icones/icone-{n}.png', 'sizes': f'{n}x{n}', 'type': 'image/png', 'purpose': uso}
    return JSONResponse({
        'name': 'InfoCustos Civil', 'short_name': 'InfoCustos', 'lang': 'pt-BR',
        'description': 'Consulta de preços ORSE e SINAPI, composições e orçamentos de obra.',
        'start_url': '/', 'scope': '/', 'display': 'standalone', 'background_color': '#17191C', 'theme_color': '#17191C',
        'icons': [icone(192), icone(512), {'src': '/static/icones/icone-mascara-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'}],
    }, media_type='application/manifest+json')


@app.get('/')
def index():
    return FileResponse(AQUI / 'static' / 'index.html')
