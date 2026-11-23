"""Acerta o banco de um mês da ORSE montado por build_db.py quando a SINAPI do mesmo mês vem da CAIXA.

Uso: python3 extratores/orse_mes_sem_sinapi.py <novo orse_sinapi_AAAA-MM.sqlite> <comp_raw.json> [banco anterior do mês]

- tira a SINAPI do arquivo (ela vem do banco da CAIXA do mesmo mês, sinapi_AAAA-MM.sqlite);
- o preço de cada serviço ORSE passa a ser o custo da composição do relatório de composições (o relatório de serviços
  pode ser de antes da correção);
- composição nova, que o relatório de serviços ainda não tinha, ganha a linha de serviço com a descrição do relatório;
- insumo ORSE usado nas composições e ausente do relatório de insumos entra na lista com o preço das composições;
  com --precos-das-composicoes (relatório de insumos de antes da correção), o preço dos insumos usados também sai delas;
- do banco anterior do mês, mantém o encargo social de mensalistas e o detalhamento dos encargos;
- item sem quantidade no relatório (a quantidade quebrou para outra linha) recebe a quantidade que sai do total e do
  custo unitário, só na mão de obra e no material (no equipamento do modelo DNIT o relatório não traz quantidade).
"""
import json
import sqlite3
import sys

DAS_COMPOSICOES = '--precos-das-composicoes' in sys.argv
args = [x for x in sys.argv[1:] if not x.startswith('--')]
novo, comp_json = args[0], args[1]
anterior = args[2] if len(args) > 2 else None
c = sqlite3.connect(novo)
ref = c.execute('SELECT id FROM referencia').fetchone()[0]
if anterior:
    c.execute('ATTACH DATABASE ? AS a', (anterior,))
    cols = [x[1] for x in c.execute('PRAGMA a.table_info(referencia)')]
    if 'encargo_social_mensalista' in cols:
        if 'encargo_social_mensalista' not in [x[1] for x in c.execute('PRAGMA table_info(referencia)')]:
            c.execute('ALTER TABLE referencia ADD COLUMN encargo_social_mensalista REAL')
        c.execute('UPDATE referencia SET encargo_social_mensalista = (SELECT encargo_social_mensalista FROM a.referencia WHERE id = ?)', (ref,))
    if c.execute("SELECT 1 FROM a.sqlite_master WHERE name = 'encargo'").fetchone():
        sql = c.execute("SELECT sql FROM a.sqlite_master WHERE name = 'encargo'").fetchone()[0]
        c.execute('DROP TABLE IF EXISTS main.encargo')  # "main.": sem ele, o DROP acharia a tabela do banco anterior
        c.execute(sql)
        c.execute('INSERT INTO main.encargo SELECT * FROM a.encargo')
    c.commit(); c.execute('DETACH DATABASE a')

for t in ('insumo', 'servico', 'composicao'):
    c.execute(f"DELETE FROM {t} WHERE base = 'SINAPI'")
c.execute("DELETE FROM composicao_item WHERE composicao_base = 'SINAPI'")

c.execute("""UPDATE servico SET preco = (SELECT custo_total FROM composicao p WHERE p.base = servico.base AND p.codigo = servico.codigo
    AND p.referencia = servico.referencia) WHERE base = 'ORSE' AND EXISTS (SELECT 1 FROM composicao p WHERE p.base = servico.base
    AND p.codigo = servico.codigo AND p.referencia = servico.referencia)""")
comps = None  # o JSON do relatório (pesado) só é lido se faltar a linha de serviço de alguma composição
faltam = [r[0] for r in c.execute("""SELECT codigo FROM composicao p WHERE base = 'ORSE' AND NOT EXISTS
    (SELECT 1 FROM servico s WHERE s.base = 'ORSE' AND s.codigo = p.codigo AND s.referencia = p.referencia)""")]
antigos = {}
if anterior:  # composição que saiu do relatório de serviços mas continua no de composições: descrição e grupo de antes
    a = sqlite3.connect(anterior)
    antigos = {r[0]: r[1:] for r in a.execute("SELECT codigo, descricao, unidade, tipo, grupo, subgrupo FROM servico WHERE base = 'ORSE'")}
    a.close()
if faltam:
    comps = {x['codigo']: {'descricao': x['descricao'], 'unidade': x['unidade']} for x in json.load(open(comp_json)) if x['codigo'] in set(faltam)}
for cod in faltam:
    x = comps[cod]
    if cod in antigos:
        d, un, t, g, sg = antigos[cod]
        tot = c.execute("SELECT custo_total FROM composicao WHERE base = 'ORSE' AND codigo = ?", (cod,)).fetchone()[0]
        c.execute('INSERT INTO servico VALUES (?,?,?,?,?,?,?,?,?)', ('ORSE', cod, ref, d, un, tot, t, g, sg))
        continue
    desc = ' '.join(x['descricao']).strip() if isinstance(x['descricao'], list) else x['descricao']
    tot = c.execute("SELECT custo_total FROM composicao WHERE base = 'ORSE' AND codigo = ?", (cod,)).fetchone()[0]
    c.execute('INSERT INTO servico VALUES (?,?,?,?,?,?,?,?,?)', ('ORSE', cod, ref, desc, x['unidade'], tot, '', '', ''))
# insumos ORSE que só aparecem nas composições entram na lista (e, com --precos-das-composicoes, o preço sai delas);
# na mão de obra, sem o encargo social da composição.
import collections
TIPO = {'MAO_DE_OBRA': 'PESSOAL', 'MATERIAL': 'MATERIAIS', 'EQUIPAMENTO': 'EQUIPAMENTOS', 'SERVICO_TERCEIRO': 'SERVIÇOS DE TERCEIROS'}
vistos = collections.defaultdict(collections.Counter); info = {}
for cod, sec, cu, desc, un, es in c.execute("""SELECT i.codigo, i.secao, i.custo_unit, i.descricao, i.unidade, p.encargo_social FROM composicao_item i
        JOIN composicao p ON p.base = i.composicao_base AND p.codigo = i.composicao AND p.referencia = i.referencia
        WHERE i.composicao_base = 'ORSE' AND i.base = 'ORSE' AND i.eh_servico = 0 AND i.custo_unit IS NOT NULL"""):
    preco = round(cu / (1 + (es or 0) / 100), 2) if sec == 'MAO_DE_OBRA' else cu
    vistos[cod][preco] += 1; info.setdefault(cod, (desc, un, TIPO.get(sec, 'MATERIAIS')))
lista = {r[0]: r[1] for r in c.execute("SELECT codigo, preco FROM insumo WHERE base = 'ORSE'")}
mudou = novos = 0
for cod, cont in vistos.items():
    preco = cont.most_common(1)[0][0]
    if cod in lista:
        if DAS_COMPOSICOES and (lista[cod] is None or abs(lista[cod] - preco) > 0.005):
            c.execute("UPDATE insumo SET preco = ? WHERE base = 'ORSE' AND codigo = ?", (preco, cod)); mudou += 1
    else:
        d, un, t = info[cod]
        c.execute('INSERT INTO insumo VALUES (?,?,?,?,?,?,?,?,?,?)', ('ORSE', cod, ref, d, un, preco, None, t, '', '')); novos += 1
print(f'insumos ORSE: {mudou} com o preço das composições corrigidas, {novos} novos; '
      f'{sum(1 for k in lista if k not in vistos)} que não entram em composição ficam com o preço do relatório de insumos')
n = c.execute("""UPDATE composicao_item SET qtd = round(custo_total / custo_unit, 8) WHERE composicao_base = 'ORSE' AND qtd IS NULL
    AND custo_unit > 0 AND custo_total > 0 AND secao IN ('MAO_DE_OBRA', 'MATERIAL')""").rowcount
c.commit()
print(f'{ref}: {len(faltam)} composições sem linha no relatório de serviços ganharam a linha ({", ".join(faltam[:20])}); {n} itens com a quantidade deduzida')
for t in ('insumo', 'servico', 'composicao', 'composicao_item'):
    print(t, c.execute(f'SELECT base, COUNT(*) FROM {t} GROUP BY 1' if t != 'composicao_item' else 'SELECT composicao_base, COUNT(*) FROM composicao_item GROUP BY 1').fetchall())
c.execute('VACUUM'); c.close()
