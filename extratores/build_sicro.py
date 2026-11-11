"""Monta o banco de um mês do SICRO (DNIT) a partir das planilhas oficiais de um estado.

Uso: python3 extratores/build_sicro.py <pasta com os .xlsx do SICRO> dados/sicro_AAAA-MM.sqlite

A pasta é a do arquivo publicado pelo DNIT para o estado (ex.: SE 07-2026.7z, já descompactado). São lidos:
  - Relatório Analítico de Composições de Custos.xlsx  -> composições e seus itens
  - Relatório Sintético de Composições de Custos.xlsx   -> conferência do custo de cada composição
  - Relatório Sintético de Materiais / Mão de Obra / Equipamentos.xlsx -> insumos
Preços sem desoneração, que são os usados nas composições analíticas.

O banco tem as mesmas tabelas dos bancos ORSE/SINAPI (base = 'SICRO', modelo = 'DNIT') e entra no banco único
por extratores/juntar_referencias.py.
"""
import glob
import os
import re
import sqlite3
import sys

import openpyxl

BASE = 'SICRO'
MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
SECAO = {'A': 'EQUIPAMENTO', 'B': 'MAO_DE_OBRA', 'C': 'MATERIAL', 'D': 'SERVICO_AUXILIAR', 'E': 'TEMPO_FIXO', 'F': 'TRANSPORTE'}

ESQUEMA = '''
CREATE TABLE referencia (id TEXT PRIMARY KEY, descricao TEXT, encargo_social_horista REAL, encargo_social_mensalista REAL);
CREATE TABLE insumo (base TEXT, codigo TEXT, referencia TEXT, descricao TEXT, unidade TEXT, preco REAL, marcador TEXT,
  tipo TEXT, grupo TEXT, subgrupo TEXT, PRIMARY KEY (base, codigo, referencia));
CREATE TABLE servico (base TEXT, codigo TEXT, referencia TEXT, descricao TEXT, unidade TEXT, preco REAL,
  tipo TEXT, grupo TEXT, subgrupo TEXT, PRIMARY KEY (base, codigo, referencia));
CREATE TABLE composicao (base TEXT, codigo TEXT, referencia TEXT, modelo TEXT, unidade TEXT, prod_equipe REAL, encargo_social REAL,
  custo_equipamento REAL, custo_mao_de_obra REAL, custo_encargo_social REAL, custo_material REAL, custo_servico_terceiro REAL,
  custo_total REAL, PRIMARY KEY (base, codigo, referencia));
CREATE TABLE composicao_item (composicao_base TEXT, composicao TEXT, referencia TEXT, ordem INTEGER, secao TEXT, base TEXT, codigo TEXT, eh_servico INTEGER,
  descricao TEXT, unidade TEXT, qtd REAL, custo_unit REAL, prod REAL, impr REAL, custo_prod REAL, custo_impr REAL, custo_total REAL);
'''


def num(v):
    if v in (None, '', '-'):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    t = str(v).strip()
    try:
        return float(t.replace('.', '').replace(',', '.')) if ',' in t else float(t)
    except ValueError:
        return None  # cabeçalho ou texto na coluna de valores


def txt(v):
    return re.sub(r'\s+', ' ', str(v)).strip() if v not in (None, '') else ''


def planilha(pasta, trecho):
    achados = [f for f in glob.glob(os.path.join(pasta, '*.xlsx')) if trecho in os.path.basename(f) and 'desoneração' not in f]
    if len(achados) != 1:
        raise SystemExit(f'Esperava um arquivo com "{trecho}" (sem desoneração) em {pasta}; achei {len(achados)}.')
    return openpyxl.load_workbook(achados[0], read_only=True, data_only=True).worksheets[0]


def ler_sintetico(pasta, trecho, col_preco):
    ws = planilha(pasta, trecho)
    return {txt(r[0]): (txt(r[1]), txt(r[2]), num(r[col_preco])) for r in ws.iter_rows(min_row=2, values_only=True) if r and r[0]}


def ler_composicoes(pasta):
    """Cada composição começa na linha 'SISTEMA DE CUSTOS REFERENCIAIS...' e vai até a próxima."""
    linhas = list(planilha(pasta, 'Relatório Analítico de Composições de Custos').iter_rows(values_only=True))
    inicios = [k for k, r in enumerate(linhas) if r and r[0] and str(r[0]).startswith('SISTEMA DE CUSTOS')] + [len(linhas)]
    estados, meses, comps = set(), set(), []
    for a, b in zip(inicios, inicios[1:]):
        cab1, cab2, cab3 = linhas[a], linhas[a + 1], linhas[a + 2]
        estados.add(txt(cab1[3])); meses.add(txt(cab2[3]))
        c = {'codigo': txt(cab3[0]), 'descricao': txt(cab3[1]), 'fic': num(cab1[7]) or 0.0, 'prod': num(cab2[7]), 'unidade': txt(cab2[8]),
             'itens': [], 'totais': {}}
        secao = None
        for r in linhas[a + 3:b]:
            r = list(r) + [None] * (9 - len(r))
            cab = txt(r[0])
            if re.match(r'^[A-F] - ', cab):
                secao = SECAO[cab[0]]; continue
            rot = next((txt(r[i]) for i in (2, 4, 6) if isinstance(r[i], str) and txt(r[i]).startswith(('Custo', 'Subtotal'))), '')
            if rot:
                c['totais'][rot] = num(r[8]); continue
            solto = txt(r[6]) if isinstance(r[6], str) and not cab and num(r[8]) else ''
            if solto and secao:
                # valor sem código dentro da seção (ex.: "Despesas diversas e manutenção do Estaleiro Padrão (5.00%)")
                c['itens'].append({'secao': secao, 'codigo': '', 'descricao': solto, 'unidade': '', 'qtd': None, 'custo_unit': None, 'custo_total': num(r[8])})
                continue
            if not cab or cab == 'Obs.' or secao is None or not r[1]:
                continue
            it = {'secao': secao, 'descricao': txt(r[1])}
            if secao == 'EQUIPAMENTO':
                it.update(codigo=cab, unidade='h', qtd=num(r[2]), prod=num(r[3]), impr=num(r[4]), custo_prod=num(r[5]), custo_impr=num(r[6]), custo_total=num(r[8]))
            elif secao in ('MAO_DE_OBRA', 'MATERIAL', 'SERVICO_AUXILIAR'):
                it.update(codigo=cab, unidade=txt(r[3]), qtd=num(r[2]), custo_unit=num(r[5]), custo_total=num(r[8]))
            elif secao == 'TEMPO_FIXO':
                # carga e descarga do material (col. 0) pela composição de tempo fixo (col. 2)
                it.update(codigo=txt(r[2]), material=cab, unidade=txt(r[4]), qtd=num(r[3]), custo_unit=num(r[6]), custo_total=num(r[8]))
            elif secao == 'TRANSPORTE':
                # o DNIT não fixa a distância: o custo depende da DMT da obra (leito natural, revestimento primário, pavimentado)
                vias = ', '.join(f'{n} {txt(r[i])}' for n, i in (('LN', 4), ('RP', 5), ('P', 6)) if txt(r[i]))
                it.update(codigo=txt(r[4]), material=cab, unidade=txt(r[3]), qtd=num(r[2]), custo_total=None,
                          descricao=f"{txt(r[1])} — distância definida no projeto" + (f' ({vias})' if vias else ''))
            c['itens'].append(it)
        comps.append(c)
    if len(estados) != 1:
        raise SystemExit(f'O relatório traz mais de um estado: {estados}. Use o arquivo de um estado só.')
    if len(meses) != 1:
        raise SystemExit(f'O relatório traz mais de um mês: {meses}.')
    return comps, estados.pop(), meses.pop()


def dividir(comps):
    """Divide o custo de cada composição em equipamento, mão de obra, material e terceiros (R$ por unidade).
    Atividades auxiliares e tempo fixo entram com a divisão da própria composição; o FIC acompanha a execução."""
    por_cod = {c['codigo']: c for c in comps}
    memo, pilha = {}, set()

    def de(cod):
        if cod in memo:
            return memo[cod]
        c = por_cod.get(cod)
        if c is None or cod in pilha:
            return None
        pilha.add(cod)
        p = c['prod'] or 1
        e = sum(i['custo_total'] or 0 for i in c['itens'] if i['secao'] == 'EQUIPAMENTO') / p
        mo = sum(i['custo_total'] or 0 for i in c['itens'] if i['secao'] == 'MAO_DE_OBRA') / p
        fic = c['totais'].get('Custo do FIC') or 0
        if e + mo > 0:
            e, mo = e + fic * e / (e + mo), mo + fic * mo / (e + mo)
        d = {'e': e, 'mo': mo, 'mat': sum(i['custo_total'] or 0 for i in c['itens'] if i['secao'] == 'MATERIAL'), 't': 0.0}
        for i in c['itens']:
            if i['secao'] not in ('SERVICO_AUXILIAR', 'TEMPO_FIXO') or not i['custo_total']:
                continue
            sub = de(i['codigo'])
            soma = sum(sub.values()) if sub else 0
            if not soma:
                d['t'] += i['custo_total']; continue
            for k in d:
                d[k] += i['custo_total'] * sub[k] / soma  # na proporção da composição auxiliar, com o custo que entrou aqui
        pilha.discard(cod)
        memo[cod] = d
        return d

    return {c['codigo']: de(c['codigo']) for c in comps}


def main():
    pasta, destino = sys.argv[1], sys.argv[2]
    comps, estado, mes_txt = ler_composicoes(pasta)
    nome_mes, ano = mes_txt.lower().split('/')
    ref = f'{ano}-{MESES.index(nome_mes) + 1:02d}'
    sint = ler_sintetico(pasta, 'Relatório Sintético de Composições de Custos', 3)
    materiais = ler_sintetico(pasta, 'Relatório Sintético de Materiais', 3)
    mao = ler_sintetico(pasta, 'Relatório Sintético de Mão de Obra', 3)
    equip = ler_sintetico(pasta, 'Relatório Sintético de Equipamentos', 9)

    # conferência: a soma das partes fecha com o custo da composição, e o analítico bate com o sintético
    problemas = []
    for c in comps:
        t = c['totais']
        partes = sum(t.get(k) or 0 for k in ('Custo unitário de execução', 'Custo do FIC', 'Custo unitário total de material',
                                               'Custo total de atividades auxiliares', 'Custo unitário total de tempo fixo'))
        total = t.get('Custo unitário direto total')
        if total is None or abs(round(partes, 2) - total) > 0.011:
            problemas.append(f"{c['codigo']}: partes {partes:.4f} x total {total}")
        if c['codigo'] not in sint or abs((sint[c['codigo']][2] or 0) - (total or 0)) > 0.005:
            problemas.append(f"{c['codigo']}: analítico {total} x sintético {sint.get(c['codigo'], (0, 0, None))[2]}")
    if problemas:
        raise SystemExit('Conferência falhou:\n' + '\n'.join(problemas[:20]))

    div = dividir(comps)
    codigos_comp = {c['codigo'] for c in comps}
    if os.path.exists(destino):
        os.remove(destino)
    con = sqlite3.connect(destino)
    con.executescript(ESQUEMA)
    con.execute('INSERT INTO referencia (id, descricao) VALUES (?, ?)', (ref, f'{nome_mes}/{ano}'))
    for tipo, dados in (('MATERIAL', materiais), ('MÃO DE OBRA', mao), ('EQUIPAMENTO', equip)):
        con.executemany('INSERT INTO insumo VALUES (?,?,?,?,?,?,?,?,?,?)',
                        [(BASE, cod, ref, d, 'h' if tipo == 'EQUIPAMENTO' else u, p, '', tipo, '', '') for cod, (d, u, p) in dados.items()])
    for c in comps:
        total = c['totais']['Custo unitário direto total']
        con.execute('INSERT INTO servico VALUES (?,?,?,?,?,?,?,?,?)', (BASE, c['codigo'], ref, c['descricao'], c['unidade'], total, 'COMPOSIÇÃO DNIT', '', ''))
        d = div[c['codigo']]
        con.execute('INSERT INTO composicao VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                    (BASE, c['codigo'], ref, 'DNIT', c['unidade'], c['prod'], None, round(d['e'], 4), round(d['mo'], 4), 0.0,
                     round(d['mat'], 4), round(d['t'], 4), total))
        itens = list(c['itens'])
        fic = c['totais'].get('Custo do FIC')
        if fic:
            # o FIC (fator de influência de chuvas) entra como uma linha própria, para a soma da tabela fechar com o preço
            pos = next((k for k, i in enumerate(itens) if i['secao'] not in ('EQUIPAMENTO', 'MAO_DE_OBRA')), len(itens))
            itens.insert(pos, {'secao': 'FIC', 'codigo': '', 'descricao': f"Fator de influência de chuvas (FIC {c['fic']:.5f}".rstrip('0').replace('.', ',') + ' sobre a execução)',
                               'unidade': c['unidade'], 'qtd': None, 'custo_unit': None, 'custo_total': fic})
        for k, i in enumerate(itens, 1):
            servico = i['secao'] in ('SERVICO_AUXILIAR', 'TEMPO_FIXO', 'TRANSPORTE') and i['codigo'] in codigos_comp
            con.execute('INSERT INTO composicao_item VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                        (BASE, c['codigo'], ref, k, i['secao'], BASE, i['codigo'], int(servico), i['descricao'], i.get('unidade', ''),
                         i.get('qtd'), i.get('custo_unit'), i.get('prod'), i.get('impr'), i.get('custo_prod'), i.get('custo_impr'), i.get('custo_total')))
    con.commit()
    n = {t: con.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0] for t in ('insumo', 'servico', 'composicao', 'composicao_item')}
    print(f'SICRO {estado}, {nome_mes}/{ano} ({ref}): {n}')
    soma = con.execute('SELECT MAX(ABS(custo_equipamento + custo_mao_de_obra + custo_material + custo_servico_terceiro - custo_total)) FROM composicao').fetchone()[0]
    print(f'maior diferença entre a divisão do custo e o preço: R$ {soma:.4f}')
    con.execute('VACUUM'); con.close()


if __name__ == '__main__':
    main()
