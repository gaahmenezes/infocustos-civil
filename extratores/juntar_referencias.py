"""Junta os bancos mensais (orse_sinapi_AAAA-MM.sqlite) num banco único com todas as referências.

Uso: python3 juntar_referencias.py dados/orse_sinapi.sqlite dados/orse_sinapi_2026-05.sqlite dados/orse_sinapi_2026-08.sqlite ...

Cada tabela já traz a coluna `referencia`, então as linhas de meses diferentes convivem sem conflito.
Depois rode app/build_index.py no banco único para recriar o índice de busca e o histórico.
"""
import os
import sqlite3
import sys

TABELAS = ['referencia', 'insumo', 'servico', 'composicao', 'composicao_item']

destino, origens = sys.argv[1], sys.argv[2:]
if not origens:
    raise SystemExit(__doc__)
if os.path.exists(destino):
    os.remove(destino)

con = sqlite3.connect(destino)
primeiro = sqlite3.connect(origens[0])
for (sql,) in primeiro.execute(
        "SELECT sql FROM sqlite_master WHERE type IN ('table', 'index') AND sql IS NOT NULL "
        "AND name IN ({}) OR (type = 'index' AND tbl_name IN ({}) AND sql IS NOT NULL)".format(
            ','.join('?' * len(TABELAS)), ','.join('?' * len(TABELAS))), TABELAS + TABELAS):
    con.execute(sql)
primeiro.close()

for caminho in origens:
    con.execute('ATTACH DATABASE ? AS o', (caminho,))
    ref = con.execute('SELECT id, descricao FROM o.referencia').fetchone()
    if con.execute('SELECT 1 FROM referencia WHERE id = ?', (ref[0],)).fetchone():
        raise SystemExit(f'A referência {ref[0]} aparece em mais de um arquivo.')
    for t in TABELAS:
        con.execute(f'INSERT INTO {t} SELECT * FROM o.{t}')
    con.commit()
    con.execute('DETACH DATABASE o')
    print(f'{caminho}: referência {ref[0]} ({ref[1]})')

for t in TABELAS:
    print(t, con.execute(f'SELECT referencia, COUNT(*) FROM {t} GROUP BY 1'.replace('referencia,', 'referencia,' if t != 'referencia' else 'id,')).fetchall())
con.execute('VACUUM')
con.close()
