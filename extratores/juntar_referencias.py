"""Junta os bancos mensais (orse_sinapi_AAAA-MM.sqlite) num banco único com todas as referências.

Uso: python3 juntar_referencias.py dados/orse_sinapi.sqlite dados/orse_sinapi_2026-05.sqlite dados/sicro_2026-07.sqlite ...

Cada tabela já traz a coluna `referencia`, então as linhas de meses diferentes convivem sem conflito.
Depois rode app/build_index.py no banco único para recriar o índice de busca e o histórico.
"""
import os
import sqlite3
import sys

TABELAS = ['referencia', 'insumo', 'servico', 'composicao', 'composicao_item', 'encargo']
REF_COLUNAS = ['id', 'descricao', 'encargo_social_horista', 'encargo_social_mensalista']

destino, origens = sys.argv[1], sys.argv[2:]
if not origens:
    raise SystemExit(__doc__)
if os.path.exists(destino):
    os.remove(destino)

con = sqlite3.connect(destino)
con.execute('CREATE TABLE referencia (id TEXT PRIMARY KEY, descricao TEXT, encargo_social_horista REAL, encargo_social_mensalista REAL)')
con.execute("""CREATE TABLE encargo (referencia TEXT, tipo TEXT, grupo TEXT, item TEXT, descricao TEXT, valor REAL,
    PRIMARY KEY (referencia, tipo, item))""")
primeiro = sqlite3.connect(origens[0])
for (sql,) in primeiro.execute("""SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND tbl_name IN
        ('insumo', 'servico', 'composicao', 'composicao_item') ORDER BY type = 'index'"""):
    con.execute(sql)
primeiro.close()

for caminho in origens:
    con.execute('ATTACH DATABASE ? AS o', (caminho,))
    ref = con.execute('SELECT id, descricao FROM o.referencia').fetchone()
    tem = {t for (t,) in con.execute("SELECT name FROM o.sqlite_master WHERE type = 'table'")}
    # o mesmo mês pode vir em arquivos diferentes (ORSE/SINAPI num, SICRO noutro), desde que cada base apareça uma vez
    bases = {b for (b,) in con.execute('SELECT DISTINCT base FROM o.servico UNION SELECT DISTINCT base FROM o.insumo')}
    repetidas = {b for (b,) in con.execute('SELECT DISTINCT base FROM servico WHERE referencia = ? UNION SELECT DISTINCT base FROM insumo WHERE referencia = ?', (ref[0], ref[0]))} & bases
    if repetidas:
        raise SystemExit(f'A referência {ref[0]} da base {", ".join(sorted(repetidas))} aparece em mais de um arquivo.')
    cols_ref = [c[1] for c in con.execute('PRAGMA o.table_info(referencia)')]
    cols = [c for c in REF_COLUNAS if c in cols_ref]
    if con.execute('SELECT 1 FROM referencia WHERE id = ?', (ref[0],)).fetchone():
        # mês já existe: completa só os encargos que faltarem
        for c in cols[2:]:
            con.execute(f'UPDATE referencia SET {c} = COALESCE({c}, (SELECT {c} FROM o.referencia)) WHERE id = ?', (ref[0],))
    else:
        con.execute(f"INSERT INTO referencia ({', '.join(cols)}) SELECT {', '.join(cols)} FROM o.referencia")
    for t in TABELAS[1:]:
        if t in tem:
            con.execute(f'INSERT INTO {t} SELECT * FROM o.{t}')
    con.commit()
    con.execute('DETACH DATABASE o')
    print(f'{caminho}: referência {ref[0]} ({ref[1]})' + ('' if 'encargo' in tem else ' — sem detalhamento de encargos'))

print('referencia', con.execute('SELECT * FROM referencia').fetchall())
for t in TABELAS[1:]:
    print(t, con.execute(f'SELECT referencia, COUNT(*) FROM {t} GROUP BY 1').fetchall())
con.execute('VACUUM')
con.close()
