"""Testes do orçamento: rodar com  python3 -m pytest tests -q  (dentro de app/)."""
import io
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from openpyxl import load_workbook  # noqa: E402

import server  # noqa: E402

c = TestClient(server.app)


@pytest.fixture()
def orc():
    o = c.post('/api/orcamentos', json={'nome': 'Escola teste', 'cliente': 'Prefeitura', 'bdi': 25}).json()
    yield o
    c.delete(f"/api/orcamentos/{o['id']}")


def test_criar_vem_com_uma_etapa(orc):
    assert orc['referencia'] == '2026-05' and len(orc['etapas']) == 1 and orc['total'] == 0


def test_item_usa_preco_da_base_e_aplica_bdi(orc):
    o = c.post(f"/api/orcamentos/{orc['id']}/itens", json={'tipo': 'servico', 'base': 'ORSE', 'codigo': '00003', 'quantidade': 100}).json()
    i = o['etapas'][0]['itens'][0]
    assert i['custo_unit'] == 4.90 and i['preco_unit'] == 6.13  # 4,90 × 1,25 = 6,125 → 6,13
    assert i['total'] == 613.00 and o['custo_total'] == 490.00 and o['valor_bdi'] == 123.00
    assert i['numero'] == '1.1'


def test_bdi_e_quantidade_recalculam(orc):
    o = c.post(f"/api/orcamentos/{orc['id']}/itens", json={'tipo': 'servico', 'base': 'ORSE', 'codigo': '00003', 'quantidade': 10}).json()
    iid = o['etapas'][0]['itens'][0]['id']
    o = c.patch(f"/api/itens/{iid}", json={'quantidade': 20}).json()
    assert o['etapas'][0]['itens'][0]['total'] == 122.60
    o = c.patch(f"/api/orcamentos/{orc['id']}", json={'bdi': 0}).json()
    assert o['total'] == 98.00


def test_codigo_inexistente_e_sem_preco(orc):
    r = c.post(f"/api/orcamentos/{orc['id']}/itens", json={'tipo': 'servico', 'base': 'ORSE', 'codigo': '999999'})
    assert r.status_code == 404
    r = c.post(f"/api/orcamentos/{orc['id']}/itens", json={'tipo': 'servico', 'base': 'ORSE', 'codigo': '14094'})
    assert r.status_code == 422


def test_etapas_numeracao_e_mover(orc):
    oid = orc['id']
    o = c.post(f'/api/orcamentos/{oid}/etapas', json={'titulo': 'Alvenaria'}).json()
    e2 = o['etapas'][1]['id']
    c.post(f'/api/orcamentos/{oid}/itens', json={'etapa_id': e2, 'tipo': 'insumo', 'base': 'SINAPI', 'codigo': '01379', 'quantidade': 50})
    o = c.post(f'/api/etapas/{e2}/mover', params={'direcao': 'cima'}).json()
    assert o['etapas'][0]['titulo'] == 'Alvenaria' and o['etapas'][0]['itens'][0]['numero'] == '1.1'


def test_curva_abc_servicos_e_insumos_fecham(orc):
    oid = orc['id']
    for cod, q in (('00003', 1000), ('00005', 2), ('00006', 30)):
        c.post(f'/api/orcamentos/{oid}/itens', json={'tipo': 'servico', 'base': 'ORSE', 'codigo': cod, 'quantidade': q})
    c.post(f'/api/orcamentos/{oid}/itens', json={'tipo': 'servico', 'base': 'ORSE', 'codigo': '00004', 'quantidade': 500})  # DNIT
    s = c.get(f'/api/orcamentos/{oid}/abc', params={'tipo': 'servicos'}).json()
    assert s['linhas'][0]['classe'] == 'A' and abs(s['linhas'][-1]['acumulado'] - 1) < 1e-9
    ins = c.get(f'/api/orcamentos/{oid}/abc', params={'tipo': 'insumos'}).json()
    # soma dos insumos desmontados ≈ custo direto (diferença só de arredondamento dos coeficientes)
    assert ins['total'] == pytest.approx(ins['custo_direto'], rel=0.01)
    assert any(l['codigo'] == '06111' for l in ins['linhas'])


def test_exportar_excel_tem_tres_abas_e_formulas(orc):
    c.post(f"/api/orcamentos/{orc['id']}/itens", json={'tipo': 'servico', 'base': 'SINAPI', 'codigo': '103335', 'quantidade': 120})
    r = c.get(f"/api/orcamentos/{orc['id']}/exportar.xlsx")
    wb = load_workbook(io.BytesIO(r.content))
    assert wb.sheetnames == ['Orçamento', 'Curva ABC serviços', 'Curva ABC insumos']
    ws = wb['Orçamento']
    assert ws['H7'].value.startswith('=ROUND(G7*(1+$H$2)')


def test_duplicar(orc):
    c.post(f"/api/orcamentos/{orc['id']}/itens", json={'tipo': 'servico', 'base': 'ORSE', 'codigo': '00003', 'quantidade': 5})
    d = c.post(f"/api/orcamentos/{orc['id']}/duplicar").json()
    assert d['nome'].endswith('(cópia)') and d['total'] == c.get(f"/api/orcamentos/{orc['id']}").json()['total']
    c.delete(f"/api/orcamentos/{d['id']}")
