"""Bases próprias e importação de insumos, composições e orçamento (formato dos relatórios do SIENGE)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi.testclient import TestClient  # noqa: E402

import fixtures_sienge as fx  # noqa: E402
import server  # noqa: E402

c = TestClient(server.app)


def ler(nome, dados):
    r = c.post('/api/importar/ler', content=dados, headers={'X-Nome-Arquivo': nome})
    assert r.status_code == 200, r.text
    return r.json()


def pedido(folha, **extra):
    return {'linhas': folha['linhas'], 'cabecalho': folha['cabecalho'], 'colunas': folha['colunas']} | extra


def test_varias_bases_proprias():
    bases = c.get('/api/proprias/bases').json()
    assert bases and bases[0]['id'] == 1
    nova = c.post('/api/proprias/bases', json={'nome': 'Cliente Alfa'}).json()
    assert nova['nome'] == 'Cliente Alfa' and nova['composicoes'] == 0
    assert c.post('/api/proprias/bases', json={'nome': 'cliente alfa'}).status_code == 409  # mesmo nome
    assert c.post('/api/proprias/bases', json={'nome': 'SINAPI'}).status_code == 422       # nome de base oficial
    i = c.post('/api/proprias/insumos', json={'descricao': 'Tijolo Alfa', 'unidade': 'un', 'preco': 1.1, 'base_id': nova['id']}).json()
    assert i['base_id'] == nova['id']
    f = c.get(f"/api/insumo/PROPRIA/{i['codigo']}").json()
    assert f['base_nome'] == 'Cliente Alfa'
    r = c.patch(f"/api/proprias/bases/{nova['id']}", json={'nome': 'Cliente Beta'}).json()
    assert r['nome'] == 'Cliente Beta' and r['insumos'] == 1
    assert c.get('/api/referencia').json()['bases_proprias'][-1]['nome'] == 'Cliente Beta'
    assert c.delete(f"/api/proprias/bases/{nova['id']}").json()['insumos'] == 1
    assert c.get(f"/api/insumo/PROPRIA/{i['codigo']}").status_code == 404


def test_le_excel_e_adivinha_as_colunas():
    ins, comp, orc = fx.planilhas()
    f = ler('insumos.xlsx', ins)['folhas'][0]
    assert f['linhas'][f['cabecalho']][0] == 'Código'  # pula o título da empresa e do relatório
    assert {k: f['colunas'].get(k) for k in ('codigo', 'descricao', 'unidade', 'tipo', 'quantidade', 'preco', 'total')} == \
        {'codigo': 0, 'descricao': 1, 'unidade': 2, 'tipo': 3, 'quantidade': 4, 'preco': 5, 'total': 6}
    f = ler('composicoes.xlsx', comp)['folhas'][0]
    assert f['colunas']['coeficiente'] == 3
    f = ler('orcamento.xlsx', orc)['folhas'][0]
    assert f['colunas']['item'] == 0 and f['colunas']['quantidade'] == 4


def test_le_pdf_com_tabela():
    r = ler('insumos.pdf', fx.pdf_insumos())
    f = r['folhas'][0]
    assert r['formato'] == 'PDF' and f['cabecalho'] is not None
    linhas = f['linhas'][f['cabecalho'] + 1:]
    assert [str(x[0]) for x in linhas] == [x[0] for x in fx.INSUMOS]
    assert f['colunas']['preco'] == 4


def test_xls_antigo_pede_xlsx():
    r = c.post('/api/importar/ler', content=b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1' + b'0' * 100, headers={'X-Nome-Arquivo': 'velho.xls'})
    assert r.status_code == 415 and 'xlsx' in r.json()['detail']


def test_sienge_completo_base_composicoes_e_orcamento():
    ins, comp, orc = fx.planilhas()
    # 1) base nova com os insumos (simular antes não grava nada)
    f = ler('insumos.xlsx', ins)['folhas'][0]
    s = c.post('/api/importar/insumos', json=pedido(f, nova_base='SIENGE Residencial', fonte='SIENGE', simular=True)).json()
    assert s['novos'] == 6 and s['simulado'] and all(b['nome'] != 'SIENGE Residencial' for b in c.get('/api/proprias/bases').json())
    r = c.post('/api/importar/insumos', json=pedido(f, nova_base='SIENGE Residencial', fonte='SIENGE', data_preco='2026-10-01')).json()
    bid = r['base_id']
    assert r['novos'] == 6 and r['sem_preco'] == 0
    lista = c.get(f'/api/proprias?base_id={bid}').json()
    tipos = {i['codigo_origem']: i['tipo'] for i in lista['insumos']}
    assert tipos['2001'] == 'MAO_DE_OBRA' and tipos['3001'] == 'EQUIPAMENTO' and tipos['1001'] == 'MATERIAL'
    # importar de novo atualiza, não duplica
    r2 = c.post('/api/importar/insumos', json=pedido(f, base_id=bid)).json()
    assert r2['novos'] == 0 and r2['atualizados'] == 6
    assert len(c.get(f'/api/proprias?base_id={bid}').json()['insumos']) == 6
    # 2) composições analíticas: título da composição e itens abaixo; uma composição usa outra; um código é da SINAPI
    f = ler('composicoes.xlsx', comp)['folhas'][0]
    r = c.post('/api/importar/composicoes', json=pedido(f, base_id=bid, oficiais=['SINAPI'], fonte='SIENGE')).json()
    assert r['composicoes_novas'] == 3 and r['insumos_criados'] == 0 and r['itens_de_base_oficial'] == 1, r
    assert r['conferidas'] == 3 and r['n_diferentes'] == 0, r['diferentes']
    comps = {x['codigo_origem']: x for x in c.get(f'/api/proprias?base_id={bid}').json()['composicoes']}
    assert abs(comps['S-020']['custo_total'] - fx.custo('S-020')) < 0.02
    alv = c.get(f"/api/composicao/PROPRIA/{comps['S-020']['codigo']}").json()
    assert alv['base_nome'] == 'SIENGE Residencial'
    assert any(i['base'] == 'PROPRIA' and i['eh_servico'] for i in alv['itens'])  # a argamassa S-010, como composição própria
    # 3) o orçamento: etapas, subetapas, itens ligados às composições da base; o que não tem composição vira insumo com o preço do arquivo
    f = ler('orcamento.xlsx', orc)['folhas'][0]
    r = c.post('/api/importar/orcamento', json=pedido(f, base_id=bid, nome='Residencial Exemplo', bdi=25, fonte='SIENGE')).json()
    assert r['etapas'] == 2 and r['subetapas'] == 2 and r['itens'] == 4
    assert r['origem_dos_itens'] == {'composicao_da_base': 3, 'insumo_da_base': 0, 'base_oficial': 0, 'criado_com_preco_do_arquivo': 1}
    # diferença só do arredondamento do preço com BDI de cada item (a planilha do arquivo não arredonda)
    assert r['n_precos_diferentes'] == 0 and abs(r['total_aplicativo'] - r['total_arquivo_com_bdi']) < r['total_arquivo_com_bdi'] * 1e-4, r
    o = c.get(f"/api/orcamentos/{r['orcamento_id']}").json()
    assert [e['numero'] for e in o['etapas']] == ['1', '2', '2.1', '2.2'] and o['bdi'] == 25
    verga = [i for e in o['etapas'] for i in e['itens'] if i['descricao'].startswith('Verga')][0]
    assert verga['custo_unit'] == fx.PRECO_VERGA and verga['base_nome'] == 'SIENGE Residencial'
    # a base não pode ser excluída enquanto está num orçamento
    assert c.delete(f'/api/proprias/bases/{bid}').status_code == 409
    c.delete(f"/api/orcamentos/{r['orcamento_id']}")
    assert c.delete(f'/api/proprias/bases/{bid}').json()['composicoes'] == 3


def test_numeros_em_formatos_diferentes():
    import importar
    assert importar.numero('1.234,56') == 1234.56 and importar.numero('1,234.56') == 1234.56
    assert importar.numero('R$ 12,3') == 12.3 and importar.numero('') is None and importar.numero('—') is None
    assert importar.numero(7) == 7.0 and importar.numero('1.000.000') == 1000000.0


def test_le_pdf_sem_linhas_de_tabela():
    """Relatório impresso sem grade, com título repetido em cada página e preço alinhado à direita."""
    import io
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    b = io.BytesIO(); cv = canvas.Canvas(b, pagesize=A4)
    for pg in range(2):
        y = 800; cv.setFont('Helvetica', 9)
        cv.drawString(40, 820, f'CONSTRUTORA EXEMPLO - Relatório de insumos   página {pg + 1}')
        for x, t in ((40, 'Código'), (90, 'Descrição do insumo'), (330, 'Unid.'), (380, 'Tipo'), (480, 'Preço unitário')):
            cv.drawString(x, y, t)
        for cod, d, u, tp, p in fx.INSUMOS[pg * 3:pg * 3 + 3]:
            y -= 14
            for x, t in ((40, cod), (90, d), (330, u), (380, tp)):
                cv.drawString(x, y, t)
            cv.drawRightString(540, y, f'{p:.2f}'.replace('.', ','))
        cv.showPage()
    cv.save()
    f = ler('sem_grade.pdf', b.getvalue())['folhas'][0]
    assert {k: f['colunas'].get(k) for k in ('codigo', 'descricao', 'unidade', 'tipo', 'preco')} == {'codigo': 0, 'descricao': 1, 'unidade': 2, 'tipo': 3, 'preco': 4}
    r = c.post('/api/importar/insumos', json=pedido(f, nova_base='PDF sem grade', simular=True)).json()
    assert r['novos'] == 6 and r['sem_preco'] == 0
