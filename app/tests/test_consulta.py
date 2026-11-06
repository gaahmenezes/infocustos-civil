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
    assert d['custo_total'] == pytest.approx(4.90)
    assert sum(i['custo_total'] for i in d['itens']) == pytest.approx(4.90, abs=0.02)


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
    amostra = con.execute('SELECT base, codigo FROM composicao ORDER BY random() LIMIT 300').fetchall()
    for base, cod in amostra:
        assert c.get(f'/api/composicao/{base}/{cod}').status_code == 200, (base, cod)
