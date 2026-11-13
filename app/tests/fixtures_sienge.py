"""Arquivos de exemplo no formato típico dos relatórios do SIENGE (insumos do orçamento, composições analíticas e
planilha orçamentária), em Excel e em PDF. Os números são inventados; servem para testar a importação."""
import io

INSUMOS = [  # código, descrição, unidade, tipo, preço
    ('1001', 'Cimento Portland CP II-E-32', 'kg', 'Material', 0.82),
    ('1002', 'Areia média lavada', 'm³', 'Material', 98.50),
    ('1003', 'Bloco cerâmico 9x19x19 cm', 'un', 'Material', 1.35),
    ('2001', 'Pedreiro', 'h', 'Mão de obra', 24.10),
    ('2002', 'Servente', 'h', 'Mão de obra', 18.40),
    ('3001', 'Betoneira 400 l', 'h', 'Equipamento', 3.75),
]

# composição: código, descrição, unidade, [(código do item, coeficiente)]
COMPOSICOES = [
    ('S-010', 'Argamassa de cimento e areia traço 1:4', 'm³', [('1001', 365.0), ('1002', 1.22), ('2002', 10.0), ('3001', 0.8)]),
    ('S-020', 'Alvenaria de vedação com bloco cerâmico 9 cm', 'm²', [('1003', 26.0), ('S-010', 0.012), ('2001', 0.95), ('2002', 0.48)]),
    ('S-030', 'Chapisco com argamassa 1:3', 'm²', [('1001', 2.3), ('1002', 0.0062), ('2002', 0.12), ('87878', 0.0)]),
]
PRECO = {c: p for c, _, _, _, p in INSUMOS}
UN = {c: u for c, _, u, _, _ in INSUMOS}
DESC = {c: d for c, d, _, _, _ in INSUMOS}


def custo(cod):
    for cc, _, _, itens in COMPOSICOES:
        if cc == cod:
            return round(sum(q * (custo(i) if i.startswith('S-') else PRECO.get(i, 0)) for i, q in itens), 2)
    return PRECO.get(cod, 0)


ORCAMENTO = [  # item, código, descrição, unidade, quantidade
    ('1', '', 'SERVIÇOS PRELIMINARES', '', None),
    ('1.1', 'S-030', 'Chapisco com argamassa 1:3', 'm²', 120),
    ('2', '', 'ALVENARIA', '', None),
    ('2.1', '', 'Alvenaria do térreo', '', None),
    ('2.1.1', 'S-020', 'Alvenaria de vedação com bloco cerâmico 9 cm', 'm²', 340),
    ('2.2', '', 'Alvenaria do pavimento superior', '', None),
    ('2.2.1', 'S-020', 'Alvenaria de vedação com bloco cerâmico 9 cm', 'm²', 280.5),
    ('2.2.2', '9999', 'Verga pré-moldada (preço de cotação)', 'm', 42),
]
PRECO_VERGA = 38.90


def planilhas():
    """Três arquivos .xlsx (bytes) como o SIENGE exporta: cabeçalho da empresa no topo, depois a tabela."""
    from openpyxl import Workbook

    def wb(linhas):
        w = Workbook(); ws = w.active
        for ln in linhas:
            ws.append(list(ln))
        b = io.BytesIO(); w.save(b); return b.getvalue()

    ins = [('CONSTRUTORA EXEMPLO LTDA',), ('Relatório de Insumos do Orçamento',), (),
           ('Código', 'Descrição do insumo', 'Unid.', 'Tipo', 'Quantidade', 'Preço unitário', 'Preço total')]
    ins += [(c, d, u, t, 100, p, 100 * p) for c, d, u, t, p in INSUMOS]
    comp = [('CONSTRUTORA EXEMPLO LTDA',), ('Composições de preço unitário (analítico)',), (),
            ('Código', 'Descrição', 'Unid.', 'Índice', 'Preço unitário', 'Preço total')]
    for cc, d, u, itens in COMPOSICOES:
        comp.append((cc, d, u, None, custo(cc), None))
        for i, q in itens:
            if i.startswith('S-'):
                comp.append((i, next(x[1] for x in COMPOSICOES if x[0] == i), next(x[2] for x in COMPOSICOES if x[0] == i), q, custo(i), round(q * custo(i), 2)))
            elif i in PRECO:
                comp.append((i, DESC[i], UN[i], q, PRECO[i], round(q * PRECO[i], 2)))
            else:  # código SINAPI dentro da composição do SIENGE
                comp.append((i, 'Chapisco SINAPI de referência', 'm²', q, 0, 0))
    orc = [('CONSTRUTORA EXEMPLO LTDA',), ('Planilha orçamentária',), ('Obra: Residencial Exemplo',), (),
           ('Item', 'Código', 'Descrição', 'Unid.', 'Quantidade', 'Preço unitário', 'Preço total')]
    for it, cod, d, u, q in ORCAMENTO:
        pu = PRECO_VERGA if cod == '9999' else (custo(cod) if cod else None)
        orc.append((it, cod, d, u, q, pu, round(q * pu, 2) if q else None))
    return wb(ins), wb(comp), wb(orc)


def pdf_insumos():
    """O relatório de insumos em PDF, com a tabela desenhada (como os relatórios impressos do SIENGE)."""
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph
    from reportlab.lib.styles import getSampleStyleSheet
    b = io.BytesIO()
    dados = [['Código', 'Descrição do insumo', 'Unid.', 'Tipo', 'Preço unitário']] + \
            [[c, d, u, t, f'{p:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')] for c, d, u, t, p in INSUMOS]
    t = Table(dados); t.setStyle(TableStyle([('GRID', (0, 0), (-1, -1), 0.5, colors.black)]))
    SimpleDocTemplate(b, pagesize=A4).build([Paragraph('Relatório de Insumos do Orçamento', getSampleStyleSheet()['Title']), t])
    return b.getvalue()
