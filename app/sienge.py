"""Leitura dos relatórios em PDF do SIENGE: "Insumos Orçados" e "Composições de Serviços da Obra".

O PDF é lido com o pdfium (rápido e leve: 309 páginas em poucos segundos), célula a célula, na ordem em que o
relatório foi escrito. Essa ordem já é a lógica de cada linha (código, descrição em uma ou mais linhas, unidade,
quantidade, preços), então a leitura não depende da posição na página nem de a página estar deitada.

Insumos Orçados:   Grupo > Família > insumo (código, descrição "Nome / Detalhe: variação", unidade, quantidade,
                   preço unitário, preço total, data do preço). O grupo e a família dizem o que o insumo é.
Composições:       Etapa > Subetapa > Serviço (código, descrição, unidade) > itens (tipo MO/MC/EQ/SE/CL, código,
                   descrição, unidade, quantidade, preço unitário). A etapa e a subetapa qualificam o serviço.

Cada leitura é conferida com os totais que o próprio relatório traz (total da família, total do serviço).
"""
import hashlib
import re
import threading
import unicodedata
from collections import OrderedDict

NUM = re.compile(r'^-?\d{1,3}(?:\.\d{3})*,\d+$|^-?\d+,\d+$')
QTD6 = re.compile(r'^-?[\d.]+,\d{6}$')
DATA = re.compile(r'^\d{2}/\d{2}/\d{4}$')
INTEIRO = re.compile(r'^\d{1,7}$')
COD_TITULO = re.compile(r'^([\d.]+)\s+-\s+(.*)$', re.S)
TIPOS_ITEM = {'MO': 'MAO_DE_OBRA', 'MC': 'MATERIAL', 'MA': 'MATERIAL', 'EQ': 'EQUIPAMENTO', 'CL': 'MATERIAL', 'ST': 'SERVICO_TERCEIRO', 'SE': 'SERVICO'}
CABECALHO = {'Código', 'Insumo', 'Un.', 'Quantidade', 'Preço unitário', 'Preço total', 'Data do preço', 'Tipo', 'Descrição', 'Unidade',
             'Preço total por grupo', 'Obra', 'BDI', 'Tipo de obra', 'Encargos sociais'}


def num(t):
    return float(t.replace('.', '').replace(',', '.'))


def normal(t):
    t = unicodedata.normalize('NFD', str(t or '').lower())
    return re.sub(r'\s+', ' ', ''.join(ch for ch in t if unicodedata.category(ch) != 'Mn')).strip()


def celulas(dados):
    """Texto de cada célula do PDF, na ordem do relatório. Uma lista por página."""
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(dados)
    try:
        for i in range(len(pdf)):
            pg = pdf[i]; tp = pg.get_textpage(); cel = []
            for k in range(tp.count_rects()):
                l, b, r, t = tp.get_rect(k)
                tx = tp.get_text_bounded(l, b, r, t).strip()
                if tx:
                    cel.append(tx)
            tp.close(); pg.close()
            yield cel
    finally:
        pdf.close()


def _juntar_numeros(cel):
    """Valores grandes quebram em duas células ("8.505.291," e "1200"): junta de volta."""
    out = []
    for t in cel:
        if out and out[-1].endswith(',') and re.fullmatch(r'[\d.]+,', out[-1]) and t.isdigit():
            out[-1] += t
        else:
            out.append(t)
    return out


def separar_detalhe(descricao):
    """"Cimento / Detalhe: CP-II F-40" ou "Cimento / CP-II F-40" -> ("Cimento", "CP-II F-40")."""
    m = re.match(r'^(.*?)\s*/\s*Detalhe:\s*(.*)$', descricao, re.S | re.I)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    if ' / ' in descricao:
        a, b = descricao.split(' / ', 1)
        return a.strip(), b.strip()
    return descricao.strip(), ''


def chave_detalhe(det):
    return re.sub(r'[^a-z0-9]+', '', normal(det))[:120]


def tipo_do_grupo(grupo, familia):
    """O grupo e a família do SIENGE dizem o que o insumo é."""
    g, f = normal(grupo), normal(familia)
    if 'servico' in f and 'terceir' in f:
        return 'SERVICO_TERCEIRO'
    if 'mao' in g and 'obra' in g or 'mao-de-obra' in f or 'mao de obra' in f:
        return 'MAO_DE_OBRA'
    if 'equipamento' in g or 'maquina' in g or 'ferramenta' in g or 'locac' in g or 'aluguel' in f or 'locac' in f:
        return 'EQUIPAMENTO'
    if 'terceir' in g or 'servico' in g or 'empreit' in g or 'terceir' in f:
        return 'SERVICO_TERCEIRO'
    return 'MATERIAL'


def ler_insumos(paginas):
    grupo = familia = ''
    insumos, familias, avisos = [], [], []
    total_obra = None
    soma_fam = 0.0
    obra = ''
    for cel in paginas:
        cel = _juntar_numeros(cel)
        i, n = 0, len(cel)
        while i < n:
            t = cel[i]
            if t == 'Obra' and i + 1 < n and not obra:
                obra = cel[i + 1]; i += 2; continue
            if t in ('Grupo', 'Família') and i + 1 < n and COD_TITULO.match(cel[i + 1]):
                nome = COD_TITULO.match(cel[i + 1]).group(2).strip()
                if t == 'Grupo':
                    grupo = nome
                else:
                    familia = nome; soma_fam = 0.0
                i += 2; continue
            if t == 'Total Família' and i + 1 < n and NUM.match(cel[i + 1]):
                tot = num(cel[i + 1])
                familias.append({'grupo': grupo, 'familia': familia, 'total': tot, 'soma': round(soma_fam, 2)})
                i += 2; continue
            if t == 'Total da obra' and i + 1 < n and NUM.match(cel[i + 1]):
                total_obra = num(cel[i + 1]); i += 2; continue
            if INTEIRO.match(t):
                # linha de insumo: código, descrição (uma ou mais células), unidade, quantidade, preço, total, data
                j = i + 1
                while j < n and not DATA.match(cel[j]) and j - i < 14:
                    j += 1
                corpo = cel[i + 1:j]
                if j < n and len(corpo) >= 4 and all(NUM.match(x) for x in corpo[-3:]):
                    qtd, preco, total = (num(x) for x in corpo[-3:])
                    desc = ' '.join(corpo[:-4]).strip()
                    nome, det = separar_detalhe(desc)
                    d, m, a = cel[j].split('/')
                    insumos.append({'codigo': t, 'descricao': desc, 'nome': nome, 'detalhe': det, 'unidade': corpo[-4], 'quantidade': qtd, 'preco': preco,
                                    'total': total, 'data': f'{a}-{m}-{d}', 'grupo': grupo, 'familia': familia, 'tipo': tipo_do_grupo(grupo, familia)})
                    soma_fam += total
                    i = j + 1; continue
                if len(corpo) >= 2 and j < n:
                    avisos.append(f'Linha do insumo {t} não reconhecida.')
            i += 1
    difs = [f for f in familias if abs(f['total'] - f['soma']) > 0.05]
    return {'relatorio': 'insumos', 'obra': obra, 'insumos': insumos, 'familias': familias, 'total_obra': total_obra,
            'soma': round(sum(x['total'] for x in insumos), 2), 'familias_diferentes': difs, 'avisos': avisos[:30]}


def ler_servicos(paginas):
    etapa = sub = ''
    obra = ''
    servicos, atual = [], None
    for cel in paginas:
        cel = _juntar_numeros(cel)
        i, n = 0, len(cel)
        while i < n:
            t = cel[i]
            prox = cel[i + 1] if i + 1 < n else ''
            if t == 'Obra' and prox and not obra:
                obra = prox; i += 2; continue
            if t in ('Etapa', 'Subetapa') and COD_TITULO.match(prox):
                cod, nome = COD_TITULO.match(prox).groups()
                if t == 'Etapa':
                    etapa = (cod, nome.strip())
                else:
                    sub = (cod, nome.strip())
                i += 2; continue
            if t == 'Serviço' and COD_TITULO.match(prox):
                cod, nome = COD_TITULO.match(prox).groups()
                j = i + 2
                # a descrição pode continuar em outras células até "Unidade"
                while j < n and cel[j] != 'Unidade' and j - i < 8:
                    nome += ' ' + cel[j]; j += 1
                un = cel[j + 1] if j + 1 < n and cel[j] == 'Unidade' else ''
                chave = (etapa, sub, cod)
                if not atual or atual['chave'] != chave:  # o mesmo serviço continua na página seguinte
                    atual = {'chave': chave, 'codigo': cod, 'descricao': ' '.join(nome.split()), 'unidade': un, 'etapa': etapa, 'subetapa': sub,
                             'itens': [], 'total': None}
                    servicos.append(atual)
                i = j + 2; continue
            if atual is not None and t in TIPOS_ITEM and INTEIRO.match(prox):
                j = i + 2
                while j < n and not QTD6.match(cel[j]) and j - i < 16:
                    j += 1
                if j + 1 < n and QTD6.match(cel[j]) and NUM.match(cel[j + 1]) and j - i >= 4:
                    atual['itens'].append({'tipo': t, 'codigo': prox, 'descricao': ' '.join(' '.join(cel[i + 2:j - 1]).split()), 'unidade': cel[j - 1],
                                           'qtd': num(cel[j]), 'preco': num(cel[j + 1])})
                    i = j + 2
                    while i < n and NUM.match(cel[i]):
                        i += 1
                    continue
            if atual is not None and t == 'Total do serviço':
                j, vals = i + 1, []
                while j < n and NUM.match(cel[j]):
                    vals.append(num(cel[j])); j += 1
                atual['total'] = round(sum(vals), 4)
                i = j; continue
            i += 1
    for s in servicos:
        s['calculado'] = round(sum(x['qtd'] * x['preco'] for x in s['itens']), 4)
        del s['chave']
    difs = [s for s in servicos if s['total'] is not None and abs(s['total'] - s['calculado']) > max(0.02, abs(s['total']) * 0.0005)]
    return {'relatorio': 'servicos', 'obra': obra, 'servicos': servicos, 'servicos_diferentes': difs}


_GUARDADOS, _TRAVA = OrderedDict(), threading.Lock()


def ler(dados):
    """Lê o PDF se for um relatório conhecido do SIENGE (senão devolve None). O resultado fica guardado por alguns
    arquivos, para a conferência e a importação do mesmo arquivo não lerem o PDF de novo."""
    chave = hashlib.sha1(dados).hexdigest()
    with _TRAVA:
        if chave in _GUARDADOS:
            _GUARDADOS.move_to_end(chave)
            return _GUARDADOS[chave]
    pags = list(celulas(dados))
    inicio = ' '.join(pags[0][:6]) if pags else ''
    if 'Insumos Orçados' in inicio:
        r = ler_insumos(pags)
    elif 'Composições de Serviços' in inicio:
        r = ler_servicos(pags)
    else:
        r = {'relatorio': None, 'paginas': pags}
    r['n_paginas'] = len(pags)
    with _TRAVA:
        _GUARDADOS[chave] = r
        while len(_GUARDADOS) > 3:
            _GUARDADOS.popitem(last=False)
    return r
