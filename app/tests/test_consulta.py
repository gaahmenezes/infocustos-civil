"""Testes da consulta: rodar com  python3 -m pytest tests -q  (dentro de app/)."""
import io
import sqlite3
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server  # noqa: E402

c = TestClient(server.app)


def test_busca_sem_acento_e_por_prefixo():
    r = c.get('/api/busca', params={'q': 'alvenaria bloco ceramico'}).json()
    assert r['total'] > 0
    assert all('alvenaria' in i['descricao'].lower() for i in r['itens'][:10])


def test_busca_por_codigo_com_e_sem_zero():
    a = c.get('/api/busca', params={'q': '00003', 'tipo': 'servico', 'base': 'ORSE'}).json()['itens']
    b = c.get('/api/busca', params={'q': '3', 'tipo': 'servico', 'base': 'ORSE'}).json()['itens']
    assert a[0]['codigo'] == '00003' and b[0]['codigo'] == '00003'


def test_busca_texto_estranho_nao_quebra():
    for q in ['"', "'; drop table insumo; --", '***', 'a' * 300, 'NEAR(x y)', '-']:
        assert c.get('/api/busca', params={'q': q}).status_code == 200


def test_filtros():
    r = c.get('/api/busca', params={'q': 'cimento', 'base': 'SINAPI', 'tipo': 'insumo'}).json()
    assert r['itens'] and all(i['base'] == 'SINAPI' and i['tipo'] == 'insumo' for i in r['itens'])


def test_composicao_fecha_com_preco_da_tabela():
    d = c.get('/api/composicao/ORSE/00003').json()
    assert d['referencia'] == '2026-08' and d['custo_total'] == pytest.approx(5.17)
    assert sum(i['custo_total'] for i in d['itens']) == pytest.approx(5.17, abs=0.02)


def test_cada_mes_mostra_so_os_seus_precos():
    mai = c.get('/api/composicao/ORSE/00003', params={'ref': '2026-05'}).json()
    ago = c.get('/api/composicao/ORSE/00003').json()
    assert mai['referencia'] == '2026-05' and mai['custo_total'] == 4.90
    assert ago['referencia'] == '2026-08' and ago['custo_total'] == 5.17
    for d in (mai, ago):
        assert 'historico' not in d and 'preco_anterior' not in d
    b = c.get('/api/busca', params={'q': '00003', 'tipo': 'servico', 'base': 'ORSE', 'ref': '2026-05'}).json()
    assert b['referencia'] == '2026-05' and b['itens'][0]['preco'] == 4.90 and 'preco_anterior' not in b['itens'][0]
    assert c.get('/api/insumo/SINAPI/06111', params={'ref': '2026-05'}).json()['preco'] == 7.37
    assert c.get('/api/insumo/SINAPI/06111').json()['preco'] == 7.90


def test_mes_inexistente():
    r = c.get('/api/busca', params={'q': 'tijolo', 'ref': '2020-01'})
    assert r.status_code == 404 and '2026-05' in r.json()['detail']


def test_item_que_saiu_da_base_so_existe_no_seu_mes():
    assert c.get('/api/composicao/SINAPI/103335', params={'ref': '2026-05'}).status_code == 200
    r = c.get('/api/composicao/SINAPI/103335')
    assert r.status_code == 404 and 'agosto/2026' in r.json()['detail']


def test_encargos_de_agosto():
    e = c.get('/api/encargos', params={'ref': '2026-08'}).json()
    assert e['horista']['total'] == 111.51 and e['mensalista']['total'] == 69.72
    grupos = {l['item']: l['valor'] for l in e['mensalista']['linhas'] if l['item'] == l['grupo']}
    assert grupos == {'A': 36.80, 'B': 16.99, 'C': 9.35, 'D': 6.58}
    assert any('FGTS sobre Aviso Prévio Indenizado' in l['descricao'] for l in e['mensalista']['linhas'])
    mai = c.get('/api/encargos', params={'ref': '2026-05'}).json()
    assert mai['horista']['total'] == 111.51 and mai['horista']['linhas'] == []


def test_comparativo_entre_meses():
    v = c.get('/api/comparativo', params={'de': '2026-05', 'para': '2026-08', 'tipo': 'servico', 'base': 'ORSE', 'limite': 5}).json()
    assert v['de']['id'] == '2026-05' and v['para']['id'] == '2026-08'
    assert v['resumo']['novos'] == 31 and v['resumo']['retirados'] == 33
    assert v['itens'][0]['variacao'] >= v['itens'][-1]['variacao']
    item = c.get('/api/comparativo/item/servico/ORSE/00003').json()
    assert [(m['referencia'], m['preco']) for m in item['meses']] == [('2026-05', 4.90), ('2026-08', 5.17)]
    f = c.get('/api/comparativo', params={'q': 'chapisco', 'tipo': 'servico'}).json()
    assert f['itens'] and all('hapisco' in i['descricao'] or i['codigo'] == 'chapisco' for i in f['itens'])
    assert c.get('/api/comparativo', params={'de': '2026-08', 'para': '2026-08'}).status_code == 422


def test_servico_auxiliar_tem_arvore_e_insumo_homonimo_nao():
    d = c.get('/api/composicao/ORSE/00004').json()
    flags = {i['codigo']: i['tem_composicao'] for i in d['itens']}
    assert flags['10549'] is True and flags['02451'] is False


def test_404_amigavel():
    r = c.get('/api/composicao/ORSE/99999999')
    assert r.status_code == 404 and 'não existe' in r.json()['detail']
    assert c.get('/api/composicao/XYZ/1').status_code == 404


def test_participacao_do_insumo_nunca_passa_de_100():
    d = c.get('/api/insumo/SINAPI/06111', params={'limite': 2000}).json()
    excesso = [u for u in d['usos'] if u['preco_composicao'] and u['custo_total'] / u['preco_composicao'] > 1.30]
    assert len(excesso) <= 5, excesso[:5]


def test_exportacoes_abrem_no_excel():
    for url in ['/api/exportar/composicao/ORSE/00004.xlsx', '/api/exportar/busca.xlsx?q=tijolo']:
        r = c.get(url)
        assert r.status_code == 200
        wb = load_workbook(io.BytesIO(r.content))
        assert wb.active.max_row > 3


def test_todas_as_composicoes_abrem():
    con = sqlite3.connect(server.DB)
    amostra = con.execute('SELECT base, codigo, referencia FROM composicao ORDER BY random() LIMIT 300').fetchall()
    for base, cod, ref in amostra:
        r = c.get(f'/api/composicao/{base}/{cod}', params={'ref': ref})
        assert r.status_code == 200 and r.json()['referencia'] == ref, (base, cod, ref)


def test_busca_traz_contagem_por_tipo_e_base():
    r = c.get('/api/busca', params={'q': 'chapisco', 'tipo': 'servico', 'base': 'ORSE'}).json()
    g = {(x['tipo'], x['base']): x['n'] for x in r['grade']}
    assert r['total'] == g[('servico', 'ORSE')]  # a lista filtrada bate com a célula da grade
    assert ('insumo', 'SINAPI') in g and sum(g.values()) > r['total']  # a grade ignora os filtros
