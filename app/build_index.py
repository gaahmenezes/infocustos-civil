"""Cria o índice de busca (FTS5) dentro do banco de dados da referência.

Uso: python3 build_index.py ../dados/orse_sinapi_2026-05.sqlite
"""
import sqlite3
import sys

db = sys.argv[1] if len(sys.argv) > 1 else '../dados/orse_sinapi_2026-05.sqlite'
con = sqlite3.connect(db)
cur = con.cursor()
cur.executescript('''
DROP TABLE IF EXISTS item_busca;
DROP TABLE IF EXISTS busca;
CREATE TABLE item_busca (
  id INTEGER PRIMARY KEY, tipo TEXT, base TEXT, codigo TEXT, referencia TEXT,
  descricao TEXT, unidade TEXT, preco REAL, categoria TEXT, grupo TEXT,
  tem_composicao INTEGER DEFAULT 0, usos INTEGER DEFAULT 0
);
INSERT INTO item_busca (tipo, base, codigo, referencia, descricao, unidade, preco, categoria, grupo)
  SELECT 'servico', base, codigo, referencia, descricao, unidade, preco, tipo, grupo FROM servico;
INSERT INTO item_busca (tipo, base, codigo, referencia, descricao, unidade, preco, categoria, grupo)
  SELECT 'insumo', base, codigo, referencia, descricao, unidade, preco, tipo, grupo FROM insumo;

UPDATE item_busca SET tem_composicao = 1
  WHERE tipo = 'servico' AND EXISTS (
    SELECT 1 FROM composicao c WHERE c.base = item_busca.base AND c.codigo = item_busca.codigo
      AND c.referencia = item_busca.referencia);

CREATE TEMP TABLE uso AS
  SELECT base, codigo, eh_servico, COUNT(DISTINCT composicao_base || composicao) AS n
  FROM composicao_item GROUP BY base, codigo, eh_servico;
UPDATE item_busca SET usos = COALESCE((
  SELECT n FROM uso WHERE uso.base = item_busca.base AND uso.codigo = item_busca.codigo
    AND uso.eh_servico = (item_busca.tipo = 'servico')), 0);

CREATE VIRTUAL TABLE busca USING fts5(
  descricao, codigo, content='item_busca', content_rowid='id',
  tokenize="unicode61 remove_diacritics 2", prefix='2 3 4'
);
INSERT INTO busca(rowid, descricao, codigo) SELECT id, descricao, codigo FROM item_busca;
CREATE INDEX IF NOT EXISTS ix_item_busca_cod ON item_busca(codigo);
CREATE INDEX IF NOT EXISTS ix_comp_item_ref ON composicao_item(base, codigo, eh_servico);
''')
con.commit()
print(cur.execute('SELECT tipo, base, COUNT(*) FROM item_busca GROUP BY 1, 2').fetchall())
con.close()
