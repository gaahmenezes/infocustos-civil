"""Atualiza os insumos SINAPI dentro das composições ORSE de um mês com os preços oficiais da CAIXA.

Uso: python3 extratores/atualizar_sinapi_na_orse.py <orse_sinapi_AAAA-MM.sqlite> <SINAPI_Referência_AAAA_MM.xlsx> <UF> <destino.sqlite>

Por quê: as composições da ORSE usam insumos da SINAPI. O relatório tirado do programa da CEHOP pode vir com a tabela
SINAPI desatualizada (agosto/2026: placa de obra 04813 a R$ 432,00 e carpinteiro a R$ 11,52 sem encargo, quando a
CAIXA publicou R$ 300,00 e R$ 10,25), e a composição sai diferente da que a CEHOP publica no site.

O que faz, para cada composição ORSE do mês:
  - insumo SINAPI de mão de obra: preço SEM encargos sociais da CAIXA (aba ISE), e o encargo social da ORSE por cima,
    como a CEHOP faz: custo unitário = preço × (1 + ES), total = quantidade × preço × (1 + ES);
  - demais insumos SINAPI: preço da CAIXA (aba ISD; sem coleta no estado, o de São Paulo, como a CAIXA faz);
  - os grupos (equipamento, mão de obra, encargo social, material, terceiros) mudam só pela diferença dos itens
    trocados, para manter o arredondamento que a CEHOP já fez nos demais itens.
O arquivo de destino fica só com a ORSE (e os encargos do mês): a SINAPI do mês passa a vir do banco da CAIXA
(build_sinapi_caixa_xlsx.py), como nos outros meses.
"""
import shutil
import sqlite3
import sys
from decimal import ROUND_HALF_UP, Decimal

from openpyxl import load_workbook


def r2(v):
    return float(Decimal(str(v)).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP))


def precos_caixa(xlsx, uf):
    """{codigo: preço} das abas ISD (com encargos, sem desoneração) e ISE (sem encargos), no estado; sem coleta, SP."""
    wb = load_workbook(xlsx, read_only=True)
    out = {}
    for aba in ('ISD', 'ISE'):
        linhas = list(wb[aba].iter_rows(values_only=True))
        cab = list(linhas[9]); cu, csp = cab.index(uf), cab.index('SP')
        d = {}
        for r in linhas[10:]:
            if r[1] is None:
                continue
            c = str(int(r[1])).zfill(5)
            p = r[cu] if r[cu] not in (None, '') else r[csp]
            if p not in (None, ''):
                d[c] = float(p)
        out[aba] = d
    wb.close()
    return out['ISD'], out['ISE']


def main():
    origem, xlsx, uf, destino = sys.argv[1], sys.argv[2], sys.argv[3].upper(), sys.argv[4]
    isd, ise = precos_caixa(xlsx, uf)
    shutil.copyfile(origem, destino)
    c = sqlite3.connect(destino); c.row_factory = sqlite3.Row
    ref = c.execute('SELECT id FROM referencia').fetchone()[0]
    comps = {r['codigo']: dict(r) for r in c.execute("SELECT * FROM composicao WHERE base = 'ORSE' AND referencia = ?", (ref,))}
    itens = {}
    for r in c.execute("SELECT rowid AS rid, * FROM composicao_item WHERE composicao_base = 'ORSE' AND referencia = ? AND base = 'SINAPI' AND eh_servico = 0", (ref,)):
        itens.setdefault(r['composicao'], []).append(dict(r))
    GRUPO = {'EQUIPAMENTO': 'custo_equipamento', 'MATERIAL': 'custo_material', 'SERVICO_TERCEIRO': 'custo_servico_terceiro'}
    mudaram, itens_mudados, sem_preco = 0, 0, set()
    antes_depois = []
    for cod, its in itens.items():
        cp = comps.get(cod)
        if not cp:
            continue
        es = (cp['encargo_social'] or 0) / 100
        # modelo DNIT (com produção da equipe): os itens são por hora da equipe e a composição divide pela produção
        div = cp['prod_equipe'] if cp['modelo'] != 'ANALITICA' and cp['prod_equipe'] else 1.0
        novo = dict(cp)
        d_mo, mo_itens_d = 0.0, 0.0
        for it in its:
            q = it['qtd']
            if q is None and it['custo_total'] and it['custo_unit']:
                # o relatório às vezes quebra a quantidade para outra linha: ela sai do total e do custo unitário
                q = round(it['custo_total'] / it['custo_unit'], 8)
                c.execute('UPDATE composicao_item SET qtd = ? WHERE rowid = ?', (q, it['rid']))
            q = q or 0
            if it['secao'] == 'MAO_DE_OBRA':
                p = ise.get(it['codigo'])
                if p is None and it['codigo'] in isd:
                    p = r2(isd[it['codigo']] / (1 + (cp['encargo_social'] or 0) / 100))
                if p is None:
                    sem_preco.add(it['codigo']); continue
                unit, tot = r2(p * (1 + es)), r2(q * p * (1 + es))
                p_ant = (it['custo_unit'] or 0) / (1 + es) if es else (it['custo_unit'] or 0)
                d_mo += (r2(q * p) - r2(q * p_ant)) / div
                mo_itens_d += (tot - (it['custo_total'] or 0)) / div
            else:
                p = isd.get(it['codigo'])
                if p is None:
                    sem_preco.add(it['codigo']); continue
                unit, tot = p, r2(q * p)
                g = GRUPO.get(it['secao'], 'custo_material')
                novo[g] = r2(novo[g] + (tot - (it['custo_total'] or 0)) / div)
            if abs(unit - (it['custo_unit'] or 0)) > 1e-9 or abs(tot - (it['custo_total'] or 0)) > 1e-9:
                itens_mudados += 1
                c.execute('UPDATE composicao_item SET custo_unit = ?, custo_total = ? WHERE rowid = ?', (unit, tot, it['rid']))
        if d_mo or mo_itens_d:
            # mão de obra sem encargo muda pela diferença; o encargo social fecha com o total dos itens de mão de obra
            mo_ant = cp['custo_mao_de_obra'] + cp['custo_encargo_social']
            novo['custo_mao_de_obra'] = r2(cp['custo_mao_de_obra'] + d_mo)
            novo['custo_encargo_social'] = r2(mo_ant + mo_itens_d - novo['custo_mao_de_obra'])
        novo['custo_total'] = r2(sum(novo[k] for k in ('custo_equipamento', 'custo_mao_de_obra', 'custo_encargo_social', 'custo_material', 'custo_servico_terceiro')))
        if abs(novo['custo_total'] - cp['custo_total']) > 0.004:
            mudaram += 1
            antes_depois.append((cod, cp['custo_total'], novo['custo_total']))
        c.execute('''UPDATE composicao SET custo_equipamento = ?, custo_mao_de_obra = ?, custo_encargo_social = ?, custo_material = ?,
            custo_servico_terceiro = ?, custo_total = ? WHERE base = 'ORSE' AND codigo = ? AND referencia = ?''',
                  (novo['custo_equipamento'], novo['custo_mao_de_obra'], novo['custo_encargo_social'], novo['custo_material'],
                   novo['custo_servico_terceiro'], novo['custo_total'], cod, ref))
        c.execute("UPDATE servico SET preco = ? WHERE base = 'ORSE' AND codigo = ? AND referencia = ?", (novo['custo_total'], cod, ref))
    # a SINAPI deste mês passa a vir do banco da CAIXA
    for t in ('insumo', 'servico', 'composicao'):
        c.execute(f"DELETE FROM {t} WHERE base = 'SINAPI'")
    c.execute("DELETE FROM composicao_item WHERE composicao_base = 'SINAPI'")
    c.commit()
    antes_depois.sort(key=lambda x: -abs(x[2] - x[1]))
    print(f'{ref}: {mudaram} composições ORSE mudaram de custo; {itens_mudados} itens SINAPI com preço novo; '
          f'{len(sem_preco)} insumos SINAPI sem preço da CAIXA no estado (ficam como estavam)')
    for x in antes_depois[:15]:
        print(f'   {x[0]}: {x[1]:.2f} -> {x[2]:.2f}')
    c.execute('VACUUM'); c.close()


if __name__ == '__main__':
    main()
