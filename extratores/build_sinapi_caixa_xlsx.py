"""Monta o banco de um mês da SINAPI a partir da planilha publicada pela CAIXA (SINAPI_Referência_AAAA_MM.xlsx).

Uso: python3 extratores/build_sinapi_caixa_xlsx.py <SINAPI_Referência_AAAA_MM.xlsx> <UF> dados/sinapi_AAAA-MM.sqlite [banco anterior]

Lê as abas da própria planilha da CAIXA:
  ISD        -> preços dos insumos na capital de cada estado, encargos sociais SEM desoneração
  CSD        -> custo de cada composição em cada estado, SEM desoneração (conferência)
  Analítico  -> itens e coeficientes de cada composição (nacional)
Depois segue exatamente como a leitura dos relatórios em PDF (build_sinapi_caixa.py): insumo sem coleta no estado
recebe o preço de São Paulo (AS), composição auxiliar sem custo é calculada pelos itens, e a soma dos itens é
conferida com o custo publicado.
"""
import os
import re
import sys

from openpyxl import load_workbook

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_sinapi_caixa as caixa  # noqa: E402

CLASSE_TIPO = {'MATERIAL': 'MATERIAIS', 'MAO DE OBRA': 'PESSOAL', 'EQUIPAMENTO (AQUISIÇÃO)': 'MATERIAIS',
               'EQUIPAMENTO (LOCAÇÃO)': 'EQUIPAMENTOS', 'ENCARGOS COMPLEMENTARES': 'MATERIAIS', 'SERVIÇOS': 'SERVIÇOS DE TERCEIROS',
               'ESPECIAIS': 'MATERIAIS'}


def _cod(v):
    """Código da célula: número, texto ou fórmula HYPERLINK(...;104658)."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return caixa.cod(str(int(v)))
    m = re.search(r'(\d{1,6})\)?\s*$', str(v))
    return caixa.cod(m.group(1)) if m else None


def _num(v):
    if v is None or v == '' or v == '-':
        return None
    if isinstance(v, (int, float)):
        return float(v)
    return caixa.num(str(v))


def ler(xlsx, uf):
    wb = load_workbook(xlsx, read_only=True)
    # ---- insumos (ISD) ----
    ws = wb['ISD']
    linhas = list(ws.iter_rows(values_only=True))
    mes, ano = (int(x) for x in str(linhas[2][1]).split('/'))
    cab = list(linhas[9])
    col_uf, col_sp = cab.index(uf), cab.index('SP')
    local = linhas[4][col_uf] or uf
    enc_h, enc_m = (round(linhas[5][col_uf] * 100, 2) if linhas[5][col_uf] is not None else None,
                    round(linhas[6][col_uf] * 100, 2) if linhas[6][col_uf] is not None else None)
    insumos, sp, classe = {}, {}, {}
    for r in linhas[10:]:
        c = _cod(r[1])
        if not c:
            continue
        base = {'descricao': str(r[2] or ''), 'unidade': str(r[3] or '').lower(), 'origem': r[4] or '-', 'familia': c}
        insumos[c] = dict(base, preco=_num(r[col_uf]))
        sp[c] = dict(base, preco=_num(r[col_sp]))
        classe[c] = r[0]
    # ---- custos das composições (CSD): pares "Custo (R$)" e "%AS" por estado ----
    ws = wb['CSD']
    linhas = list(ws.iter_rows(values_only=True))
    col = list(linhas[8]).index(uf)
    custos = {}
    for r in linhas[10:]:
        c = _cod(r[1])
        if c:
            v = _num(r[col])
            custos[c] = {'unidade': str(r[3] or '').lower(), 'custo': v or None}  # custo zerado = sem custo (o hífen do PDF)
    # ---- analítico ----
    comps = {}
    for r in wb['Analítico'].iter_rows(min_row=11, values_only=True):
        c = _cod(r[1])
        if not c:
            continue
        if r[2] is None:  # linha da própria composição
            comps.setdefault(c, {'codigo': c, 'descricao': str(r[4] or ''), 'unidade': str(r[5] or '').lower(), 'grupo': str(r[0] or ''), 'itens': []})
            continue
        comp = comps.setdefault(c, {'codigo': c, 'descricao': '', 'unidade': '', 'grupo': str(r[0] or ''), 'itens': []})
        comp['itens'].append({'tipo': 'C' if r[2] == 'COMPOSICAO' else 'I', 'codigo': _cod(r[3]), 'descricao': str(r[4] or ''),
                              'unidade': str(r[5] or '').lower(), 'qtd': _num(r[6])})
    wb.close()
    return insumos, sp, classe, (enc_h, enc_m), (mes, ano), local, custos, comps


def main():
    xlsx, uf, destino = sys.argv[1], sys.argv[2].upper(), sys.argv[3]
    anterior = sys.argv[4] if len(sys.argv) > 4 else None
    insumos, sp, classe, (enc_h, enc_m), (mes, ano), local, custos, comps = ler(xlsx, uf)
    print(f'{local} {mes:02d}/{ano}: encargo social horista {enc_h}%, mensalista {enc_m}%')
    return caixa.montar(insumos, enc_h, enc_m, mes, ano, local, sp if uf != 'SP' else {}, custos, comps, uf, destino, anterior)


if __name__ == '__main__':
    main()
