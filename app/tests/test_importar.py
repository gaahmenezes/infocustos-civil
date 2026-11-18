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


def test_sienge_mesmo_codigo_com_detalhes_e_data_do_preco():
    """No SIENGE o código 24 vale para vários cimentos ("Cimento / Detalhe: CP-II F-40", "... CP-V ARI"): cada variação
    é um insumo, e as composições acham a variação certa pelo detalhe."""
    from openpyxl import Workbook
    import io
    w = Workbook(); ws = w.active
    for ln in [('EMPRESA',), ('Relatório de insumos',), (), (), ('Código', 'Descrição', None, None, None, 'Un.', None, 'Preço unitário', None, None, 'Data do preço'),
               (1, 'Servente', None, None, None, 'h', None, 15.87, None, None, '12/02/2025'),
               (24, 'Cimento / Detalhe: CP-II F-40', None, None, None, 'kg', None, 0.5908, None, None, '25/04/2022'),
               (24, 'Cimento / Detalhe: CP-V ARI', None, None, None, 'kg', None, 0.6925, None, None, '22/06/2021'),
               (24, 'Cimento / Detalhe: CP-II F-32', None, None, None, 'kg', None, 0.6774, None, None, '02/08/2023'),
               (26, 'Areia / Detalhe: Media posto em obra', None, None, None, 'm3', None, 64, None, None, '24/05/2024')]:
        ws.append(list(ln))
    b = io.BytesIO(); w.save(b)
    f = ler('insumos_sienge.xlsx', b.getvalue())['folhas'][0]
    assert f['colunas'].get('data') == 10 and f['colunas'].get('preco') == 7 and f['colunas'].get('unidade') == 5
    r = c.post('/api/importar/insumos', json=pedido(f, nova_base='SIENGE detalhes')).json()
    assert r['novos'] == 5 and r['codigos_com_variacoes'] == 1 and r['variacoes'] == 3, r
    bid = r['base_id']
    ins = {i['codigo_origem']: i for i in c.get(f'/api/proprias?base_id={bid}').json()['insumos']}
    assert ins['24#cp v ari']['preco'] == 0.6925 and ins['24#cp v ari']['data_preco'] == '2021-06-22'
    assert ins['1']['data_preco'] == '2025-02-12' and ins['26']['codigo_origem'] == '26'
    # de novo: atualiza as 5, não duplica
    assert c.post('/api/importar/insumos', json=pedido(f, base_id=bid)).json()['atualizados'] == 5
    # composição que usa o cimento CP-V ARI: liga à variação certa
    w = Workbook(); ws = w.active
    for ln in [('Código', 'Descrição', 'Unid.', 'Índice'), ('S-1', 'Argamassa de alta resistência', 'm3', None),
               (24, 'Cimento / Detalhe: CP-V ARI', 'kg', 400), (26, 'Areia / Detalhe: Media posto em obra', 'm3', 1.1), (1, 'Servente', 'h', 8)]:
        ws.append(list(ln))
    b = io.BytesIO(); w.save(b)
    f = ler('comp.xlsx', b.getvalue())['folhas'][0]
    r = c.post('/api/importar/composicoes', json=pedido(f, base_id=bid)).json()
    assert r['composicoes_novas'] == 1 and r['insumos_criados'] == 0, r
    comp = c.get(f'/api/proprias?base_id={bid}').json()['composicoes'][0]
    assert abs(comp['custo_total'] - (400 * 0.6925 + 1.1 * 64 + 8 * 15.87)) < 0.01
    c.delete(f'/api/proprias/bases/{bid}')


def _pdf_celulas(paginas):
    """PDF em que cada célula é escrita separada e na ordem da linha, como nos relatórios do SIENGE."""
    import io
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas
    b = io.BytesIO(); cv = canvas.Canvas(b, pagesize=A4)
    for linhas in paginas:
        y = 800; cv.setFont('Helvetica', 7)
        for ln in linhas:
            x = 30
            for cel in ln:
                cv.drawString(x, y, cel); x += max(60, 4 * len(cel) + 14)
            y -= 11
        cv.showPage()
    cv.save()
    return b.getvalue()


def test_sienge_pdf_insumos_orcados_e_composicoes_de_servicos():
    cab = [['Insumos Orçados'], ['Obra', '9 - OBRA TESTE'], ['Tipo de obra', '1 - Construção Civil']]
    col = ['Código', 'Insumo', 'Un.', 'Quantidade', 'Preço unitário', 'Preço total', 'Data do preço']
    ins = _pdf_celulas([cab + [['Grupo', '01 - Mão-de-obra'], ['Família', '01.001 - Mão-de-Obra Própria (Horista)'], col,
                               ['1', 'Servente', 'h', '100,0000', '15,8700', '1.587,00', '12/02/2025'], ['Total Família', '1.587,00'],
                               ['Família', '01.008 - Serviços de Terceiros'], col, ['5', 'Pintor', 'm2', '10,0000', '3,5231', '35,23', '26/03/2024'],
                               ['Total Família', '35,23'], ['Total Grupo', '1.622,23']],
                        cab + [['Grupo', '02 - Materiais'], ['Família', '02.001 - Aglomerantes'], col,
                               ['24', 'Cimento / Detalhe: CP-II F-40', 'kg', '1.000,0000', '0,5908', '590,80', '25/04/2022'],
                               ['24', 'Cimento / Detalhe: CP-V ARI para', 'concreto de alta resistência', 'kg', '200,0000', '0,6925', '138,50', '22/06/2021'],
                               ['Total Família', '729,30'], ['Total Grupo', '729,30'], ['Total da obra', '2.351,53']]])
    r = ler('insumos_orcados.pdf', ins)
    sg = r['sienge']
    assert r['formato'] == 'SIENGE' and sg['relatorio'] == 'insumos' and sg['insumos'] == 4 and sg['familias_diferentes'] == 0
    assert abs(sg['soma'] - sg['total_obra']) < 0.01 and sg['tipos'] == {'MAO_DE_OBRA': 1, 'SERVICO_TERCEIRO': 1, 'MATERIAL': 2}
    s = c.post('/api/importar/sienge?nova_base=SIENGE%20PDF&simular=true', content=ins).json()
    assert s['novos'] == 4 and s['simulado'] and s['base_id'] is None
    r = c.post('/api/importar/sienge?nova_base=SIENGE%20PDF', content=ins).json()
    bid = r['base_id']
    lista = {i['codigo_origem']: i for i in c.get(f'/api/proprias?base_id={bid}').json()['insumos']}
    ari = lista['24#cpvariparaconcretodealtaresistencia']
    assert ari['preco'] == 0.6925 and ari['data_preco'] == '2021-06-22' and ari['grupo'] == 'Materiais › Aglomerantes' and ari['tipo'] == 'MATERIAL'
    assert lista['1']['tipo'] == 'MAO_DE_OBRA' and lista['5']['tipo'] == 'SERVICO_TERCEIRO' and lista['5']['grupo'] == 'Mão-de-obra › Serviços de Terceiros'
    # composições: etapa > subetapa > serviço > itens; um serviço usa o outro (SE); a página de rosto se repete
    topo = [['Composições de Serviços da Obra'], ['Obra', '9 - OBRA TESTE']]
    colc = ['Tipo', 'Código', 'Descrição', 'Unidade', 'Quantidade', 'Preço unitário', 'Mão-de-obra', 'Materiais']
    srv = _pdf_celulas([topo + [['Etapa', '006 - FUNDAÇÕES'], ['Subetapa', '006.016 - LASTRO DE CONCRETO'],
                                ['Serviço', '1547 - Concreto magro para lastro', 'Unidade', 'm3'], ['Preço total por grupo'], colc,
                                ['MO', '1', 'Servente', 'h', '10,000000', '15,8700', '158,7000'],
                                ['MC', '24', 'Cimento / CP-V ARI para', 'concreto de alta resistência', 'kg', '100,000000', '0,6925', '69,2500'],
                                ['Total do serviço', '158,7000', '69,2500'], ['Percentual por grupo', '69,6205%', '30,3795%']],
                        topo + [['Etapa', '007 - ESTRUTURA'], ['Subetapa', '007.001 - PISO'],
                                ['Serviço', '2000 - Piso em concreto', 'Unidade', 'm2'], ['Preço total por grupo'], colc,
                                ['SE', '1547', 'Concreto magro para lastro', 'm3', '0,050000', '227,9500', '7,9350', '3,4625'],
                                ['MC', '999', 'Tela / Q-92', 'm2', '1,000000', '20,0000', '20,0000'],
                                ['Total do serviço', '7,9350', '23,4625'],
                                ['Serviço', '1547 - Concreto magro para lastro', 'Unidade', 'm3'], colc,
                                ['MO', '1', 'Servente', 'h', '10,000000', '15,8700', '158,7000'],
                                ['MC', '24', 'Cimento / CP-V ARI para', 'concreto de alta resistência', 'kg', '100,000000', '0,6925', '69,2500'],
                                ['Total do serviço', '158,7000', '69,2500']]])
    sg = ler('servicos.pdf', srv)['sienge']
    assert sg['relatorio'] == 'servicos' and sg['servicos'] == 2 and sg['ocorrencias'] == 3 and sg['etapas'] == 2
    r = c.post(f'/api/importar/sienge?base_id={bid}&criar_orcamento=true&nome_orcamento=Obra%20teste', content=srv).json()
    assert r['composicoes_novas'] == 2 and r['n_diferentes'] == 0 and r['conferidas'] == 2, r
    assert r['origem_dos_itens'] == {'insumo_da_base': 2, 'servico': 1, 'insumo_criado': 1, 'servico_sem_composicao': 0}
    comps = {x['codigo_origem']: x for x in c.get(f'/api/proprias?base_id={bid}').json()['composicoes']}
    assert comps['1547']['grupo'] == 'FUNDAÇÕES › LASTRO DE CONCRETO' and abs(comps['1547']['custo_total'] - 227.95) < 0.01
    assert abs(comps['2000']['custo_total'] - (0.05 * 227.95 + 20)) < 0.01
    o = c.get(f"/api/orcamentos/{r['orcamento_id']}").json()
    assert [(e['numero'], e['titulo']) for e in o['etapas']] == [('1', 'FUNDAÇÕES'), ('1.1', 'LASTRO DE CONCRETO'), ('2', 'ESTRUTURA'), ('2.1', 'PISO')]
    assert o['qtd_itens'] == 3 and o['total'] == 0
    # de novo: atualiza, não duplica
    r2 = c.post(f'/api/importar/sienge?base_id={bid}', content=srv).json()
    assert r2['composicoes_novas'] == 0 and r2['composicoes_atualizadas'] == 2 and r2['origem_dos_itens']['insumo_criado'] == 0
    c.delete(f"/api/orcamentos/{r['orcamento_id']}")
    assert c.delete(f'/api/proprias/bases/{bid}').json()['composicoes'] == 2


def test_pdf_grande_desconhecido_nao_trava():
    r = c.post('/api/importar/ler', content=_pdf_celulas([[['página', str(k)]] for k in range(70)]), headers={'X-Nome-Arquivo': 'grande.pdf'})
    assert r.status_code == 413 and 'Excel' in r.json()['detail']


def test_anexar_orcamento_do_sienge_liga_os_itens_pelo_nome():
    # base com duas composições: os nomes do orçamento batem com elas (uma com quebra de linha diferente e outra caixa)
    bid = c.post('/api/proprias/bases', json={'nome': 'Obra anexo'}).json()['id']
    i1 = c.post('/api/proprias/insumos', json={'descricao': 'Servente', 'unidade': 'h', 'preco': 9.6736, 'base_id': bid}).json()['codigo']
    comps = {}
    for nome, un, coef in (('Regularização Manual', 'm2', 1), ('Tela aço CA-60, Q-61, malha 15x15cm', 'm2', 2)):
        k = c.post('/api/proprias/composicoes', json={'descricao': nome, 'unidade': un, 'base_id': bid}).json()['codigo']
        c.post(f'/api/proprias/composicoes/{k}/itens', json={'tipo': 'insumo', 'base': 'PROPRIA', 'codigo': i1, 'qtd': coef})
        comps[nome] = k
    col = ['Código', 'Descrição', 'Un.', 'Quantidade orçada', 'Preço unitário', 'Preço total']
    topo = [['Orçamento'], ['Obra', '9 - OBRA ANEXO'], ['Data base', '16/09/2026'], ['BDI', 'não aplicado'], col]
    pdf = _pdf_celulas([topo + [['01', 'TORRES', '1.354,31'], ['01.001', 'FUNDAÇÃO', '1.354,31'], ['01.001.001', 'Radier', '1.160,83'],
                               ['01.001.001.001', 'REGULARIZAÇÃO MANUAL', 'm2', '100,0000', '9,6736', '967,36'],
                               ['01.001.001.002', 'Tela aço CA-60, Q-', '61, malha 15x15cm', 'm2', '10,0000', '19,3472', '193,47'],
                               ['01.001.000.001', 'Serviço que não existe em base nenhuma', 'vb', '1,0000', '193,4800', '193,48'],
                               ['Total da unidade construtiva', '1.354,31'], ['14/11/2026 - 16:12:21'], ['SIENGE / STARIAN'], ['1 de 1']]])
    assert ler('orcamento.pdf', pdf)['sienge']['relatorio'] == 'orcamento'
    assert c.post('/api/importar/sienge?base_id=1', content=pdf).status_code == 422  # não é relatório de base: vai pela aba Orçamentos
    antes = len(c.get('/api/orcamentos').json())
    s = c.post('/api/importar/orcamento-sienge?simular=true', content=pdf).json()
    assert s['itens'] == 3 and s['por_base'] == {'Obra anexo': 2} and s['n_faltam'] == 1 and s['n_diferentes'] == 0 and s['base_sugerida'] == bid
    assert abs(s['soma_arquivo'] - s['total_arquivo']) < 0.01 and len(c.get('/api/orcamentos').json()) == antes  # simular não grava
    r = c.post('/api/importar/orcamento-sienge?nome=Obra%20anexada', content=pdf).json()
    o = c.get(f"/api/orcamentos/{r['orcamento_id']}").json()
    # célula construtiva › etapa › subetapa, como no SIENGE
    assert [(e['numero'], e['titulo'], e['nivel']) for e in o['etapas']] == [('1', 'TORRES', 1), ('1.1', 'FUNDAÇÃO', 2), ('1.1.2', 'Radier', 3)] and o['bdi'] == 0
    itens = {i['numero']: i for e in o['etapas'] for i in e['itens']}
    assert itens['1.1.2.1']['codigo'] == comps['Regularização Manual'] and itens['1.1.2.1']['descricao'] == 'Regularização Manual'  # nome como está na base
    assert itens['1.1.2.2']['codigo'] == comps['Tela aço CA-60, Q-61, malha 15x15cm']
    assert itens['1.1.1']['tipo'] == 'insumo' and itens['1.1.1']['custo_unit'] == 193.48 and itens['1.1.1']['base_nome'] == 'Obra anexo'
    assert abs(o['total'] - 1354.31) < 0.01 and itens['1.1.2.1']['total'] == 967.36  # preço com 4 casas, total igual ao do arquivo
    c.delete(f"/api/orcamentos/{r['orcamento_id']}")
    c.delete(f'/api/proprias/bases/{bid}')


def test_anexar_nao_pega_preco_de_outra_obra_nem_perde_item_com_descricao_quebrada():
    # caso real (Loteamento Reserva Marupiá): "Aterro" existia na base de outra obra com outro preço e entrou com o preço
    # dela; e um "20" sozinho no fim de uma descrição ("... c/" + "20") virou título e levou o item junto
    obra = '72 - LOTEAMENTO TESTE'
    minha = c.post('/api/proprias/bases', json={'nome': 'Base teste', 'descricao': f'Importada de SIENGE, obra {obra}'}).json()['id']
    outra = c.post('/api/proprias/bases', json={'nome': 'Outra obra'}).json()['id']
    c.post('/api/proprias/insumos', json={'descricao': 'Servente', 'unidade': 'h', 'preco': 9.6736, 'base_id': minha})
    c.post('/api/proprias/insumos', json={'descricao': 'Aterro', 'unidade': 'm3', 'preco': 16.50, 'base_id': outra})
    col = ['Código', 'Descrição', 'Un.', 'Quantidade orçada', 'Preço unitário', 'Preço total']
    topo = [['Orçamento'], ['Obra', obra], ['Data base', '16/09/2026'], ['BDI', 'não aplicado'], col]
    pdf = _pdf_celulas([topo + [['01', 'LOTEAMENTO', '9.251,55'], ['01.001', 'Terraplenagem', '9.251,55'],
                               ['01.001.001', 'Servente', 'h', '10,0000', '9,6736', '96,74'],
                               ['01.001.002', 'Aterro', 'm3', '100,0000', '20,9805', '2.098,05'],
                               ['01.001.003', 'Alvenaria bloco concreto estrutural, armada vert. 3/8" c/13, hor. 5/16" c/', '20',
                                'm2', '39,2000', '179,5547', '7.038,54'],
                               ['Total da unidade construtiva', '9.233,33'], ['14/11/2026 - 16:12:21'], ['SIENGE / STARIAN'], ['1 de 1']]])
    s = c.post('/api/importar/orcamento-sienge?simular=true', content=pdf).json()
    assert s['itens'] == 3 and abs(s['soma_arquivo'] - 9233.33) < 0.01, s  # o item da alvenaria não se perde
    assert s['por_base'] == {'Base teste': 1} and s['n_faltam'] == 2, s  # o "Aterro" da outra obra (outro preço) não serve
    r = c.post('/api/importar/orcamento-sienge?nome=Marupia%20teste', content=pdf).json()
    o = c.get(f"/api/orcamentos/{r['orcamento_id']}").json()
    assert abs(o['total'] - 9233.33) < 0.02, o['total']  # o total do aplicativo bate com o do arquivo
    c.delete(f"/api/orcamentos/{r['orcamento_id']}")


def test_composicao_propria_com_preco_informado_por_proposta():
    bid = c.post('/api/proprias/bases', json={'nome': 'Base proposta'}).json()['id']
    ins = c.post('/api/proprias/insumos', json={'descricao': 'Servente proposta', 'unidade': 'h', 'preco': 10.0, 'base_id': bid}).json()['codigo']
    k = c.post('/api/proprias/composicoes', json={'descricao': 'Forro de gesso (proposta)', 'unidade': 'm2', 'base_id': bid}).json()['codigo']
    c.post(f'/api/proprias/composicoes/{k}/itens', json={'tipo': 'insumo', 'base': 'PROPRIA', 'codigo': ins, 'qtd': 2})
    assert c.get(f'/api/proprias/composicoes/{k}').json()['custo_total'] == 20.0  # composto: soma dos itens
    r = c.patch(f'/api/proprias/composicoes/{k}', json={'tipo_preco': 'informado', 'preco_inf_mo': 12.5, 'preco_inf_mat': 30, 'preco_inf_equip': 0,
                                                       'preco_inf_terc': 0, 'proposta': 'Gesso Forte, proposta 118', 'data_proposta': '2026-11-10'}).json()
    assert r['tipo_preco'] == 'informado' and r['custo_total'] == 42.5 and r['preco_composto'] == 20.0 and r['proposta'].startswith('Gesso')
    assert abs(r['divisao']['mo'] - 12.5 / 42.5) < 1e-9 and abs(r['divisao']['mat'] - 30 / 42.5) < 1e-9
    # vale na busca, no orçamento e na cópia
    achou = [x for x in c.get('/api/busca?q=forro%20gesso%20proposta').json()['itens'] if x['codigo'] == k]
    assert achou and achou[0]['preco'] == 42.5
    o = c.post('/api/orcamentos', json={'nome': 'Teste proposta', 'bdi': 0}).json()
    o = c.post(f"/api/orcamentos/{o['id']}/itens", json={'tipo': 'servico', 'base': 'PROPRIA', 'codigo': k, 'quantidade': 10}).json()
    assert o['custo_total'] == 425.0
    c.delete(f"/api/orcamentos/{o['id']}")
    d = c.post(f'/api/proprias/composicoes/{k}/duplicar').json()
    assert d['tipo_preco'] == 'informado' and d['custo_total'] == 42.5
    # volta a composto
    assert c.patch(f'/api/proprias/composicoes/{k}', json={'tipo_preco': 'composto'}).json()['custo_total'] == 20.0
