"""Gera os arquivos de dados do artefato (consulta estática), um conjunto por mês de referência.

Uso: python3 build_dados.py ../dados/orse_sinapi.sqlite saida/

saida/dados/meses.json          lista de meses, com os encargos sociais de cada um
saida/dados/AAAA-MM/itens.json  serviços e insumos do mês (busca)
saida/dados/AAAA-MM/comp_NN.json, usos_NN.json   composições e "onde é usado", em partes
"""
import json
import os
import sqlite3
import sys
from collections import defaultdict

DB, OUT = sys.argv[1], sys.argv[2]
N_SHARDS = 24
SECOES = ['MAO_DE_OBRA', 'MATERIAL', 'EQUIPAMENTO', 'SERVICO_TERCEIRO', 'SERVICO_AUXILIAR']
BASES = ['ORSE', 'SINAPI']


def shard(base, codigo):
    return sum(map(ord, base + '|' + codigo)) % N_SHARDS


def dump(rel, obj):
    p = os.path.join(OUT, 'dados', rel)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, separators=(',', ':'))
    return os.path.getsize(p)


c = sqlite3.connect(DB)
c.row_factory = sqlite3.Row
# só os meses da CEHOP (ORSE e SINAPI juntas); SICRO e SINAPI da CAIXA têm calendário próprio e não entram na versão de teste
meses = [dict(r) for r in c.execute("SELECT * FROM referencia WHERE id IN (SELECT DISTINCT referencia FROM servico WHERE base = 'ORSE') ORDER BY id")]
for m in meses:
    m['encargos'] = {t: [dict(r) for r in c.execute('SELECT grupo, item, descricao, valor FROM encargo WHERE referencia = ? AND tipo = ? ORDER BY grupo, item = grupo DESC, item',
                                                  (m['id'], t))] for t in ('horista', 'mensalista')}
tam = {'meses.json': dump('meses.json', {'meses': meses, 'n_shards': N_SHARDS})}

for m in meses:
    REF = m['id']
    itens, desc_ins, desc_srv = [], {}, {}
    for r in c.execute('''SELECT i.*, COALESCE(s.subgrupo, n.subgrupo) AS subgrupo, n.marcador FROM item_busca i
            LEFT JOIN servico s ON i.tipo = 'servico' AND s.base = i.base AND s.codigo = i.codigo AND s.referencia = i.referencia
            LEFT JOIN insumo n ON i.tipo = 'insumo' AND n.base = i.base AND n.codigo = i.codigo AND n.referencia = i.referencia
            WHERE i.referencia = ? ORDER BY i.id''', (REF,)):
        t = 0 if r['tipo'] == 'servico' else 1
        itens.append([t, BASES.index(r['base']), r['codigo'], r['descricao'] or '', r['unidade'] or '', r['preco'], r['grupo'] or '',
                      r['subgrupo'] or '', r['categoria'] or '', r['usos'] or 0, r['tem_composicao'] or 0, r['marcador'] or '',
                      [round(r[k], 4) for k in ('pct_mo', 'pct_mat', 'pct_equip', 'pct_terc')] if r['pct_mo'] is not None else 0])
        (desc_srv if t == 0 else desc_ins)[(r['base'], r['codigo'])] = r['descricao'] or ''

    usada_em = defaultdict(set)
    for r in c.execute('SELECT DISTINCT composicao_base, composicao, base, codigo FROM composicao_item WHERE eh_servico = 1 AND referencia = ?', (REF,)):
        usada_em[(r['base'], r['codigo'])].add((r['composicao_base'], r['composicao']))
    comps = [dict(r) for r in c.execute('SELECT * FROM composicao WHERE referencia = ?', (REF,))]
    info = {(x['base'], x['codigo']): x for x in comps}
    itens_comp = defaultdict(list)
    for r in c.execute('SELECT * FROM composicao_item WHERE referencia = ? ORDER BY composicao_base, composicao, ordem', (REF,)):
        tab = desc_srv if r['eh_servico'] else desc_ins
        d = r['descricao'] or ''
        itens_comp[(r['composicao_base'], r['composicao'])].append([
            SECOES.index(r['secao']), BASES.index(r['base']), r['codigo'], r['eh_servico'], r['unidade'] or '',
            r['qtd'], r['custo_unit'], r['custo_total'], r['custo_prod'], 0 if tab.get((r['base'], r['codigo'])) == d else d])
    shards = [dict() for _ in range(N_SHARDS)]
    for x in comps:
        k = (x['base'], x['codigo'])
        shards[shard(*k)][x['base'] + '|' + x['codigo']] = [
            x['modelo'], x['unidade'], x['prod_equipe'], x['encargo_social'], x['custo_equipamento'], x['custo_mao_de_obra'],
            x['custo_encargo_social'], x['custo_material'], x['custo_servico_terceiro'], x['custo_total'], len(usada_em.get(k, ())), itens_comp[k]]

    usos = defaultdict(list)
    for (cb, cc), lst in itens_comp.items():
        h = info[(cb, cc)]
        for it in lst:
            if it[3]:
                continue
            sec, b, cod, qtd, ct = SECOES[it[0]], BASES[it[1]], it[2], it[5] or 0, it[7] or 0
            if h['modelo'] == 'DNIT' and sec in ('EQUIPAMENTO', 'MAO_DE_OBRA') and h['prod_equipe']:
                qtd, ct = qtd / h['prod_equipe'], ct / h['prod_equipe']
            usos[(b, cod)].append([BASES.index(cb), cc, qtd, ct, h['custo_total']])
    ushards = [dict() for _ in range(N_SHARDS)]
    for k, lst in usos.items():
        n = len({(x[0], x[1]) for x in lst})
        lst.sort(key=lambda x: -(x[3] / x[4]) if x[4] else 0)
        ushards[shard(*k)][k[0] + '|' + k[1]] = [n, [[x[0], x[1], round(x[2], 8), round(x[3], 4), x[4]] for x in lst[:80]]]

    tam[f'{REF}/itens.json'] = dump(f'{REF}/itens.json', {'ref': REF, 'itens': itens})
    for i in range(N_SHARDS):
        tam[f'{REF}/comp_{i:02d}.json'] = dump(f'{REF}/comp_{i:02d}.json', shards[i])
        tam[f'{REF}/usos_{i:02d}.json'] = dump(f'{REF}/usos_{i:02d}.json', ushards[i])
    print(f'{REF}: {len(itens)} itens, {len(comps)} composições')

total = sum(tam.values())
print(f'{len(tam)} arquivos, {total / 1e6:.1f} MB no total; maior: {max(tam.values()) / 1e6:.2f} MB ({max(tam, key=tam.get)})')
