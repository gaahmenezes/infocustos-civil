"""Cria o índice de busca (FTS5) e a tabela de histórico no banco com todas as referências.

Uso: python3 build_index.py ../dados/orse_sinapi.sqlite

- item_busca / busca: uma linha por item em cada referência. A consulta filtra sempre por um mês.
- historico: preço de cada serviço e insumo em cada referência; usado só no comparativo entre meses.
"""
import sqlite3
import sys

db = sys.argv[1] if len(sys.argv) > 1 else '../dados/orse_sinapi.sqlite'
con = sqlite3.connect(db)
cur = con.cursor()
refs = [r[0] for r in cur.execute('SELECT id FROM referencia ORDER BY id')]

cur.executescript('''
DROP TABLE IF EXISTS item_busca;
DROP TABLE IF EXISTS busca;
DROP TABLE IF EXISTS historico;
CREATE TABLE historico (tipo TEXT, base TEXT, codigo TEXT, referencia TEXT, preco REAL,
  PRIMARY KEY (tipo, base, codigo, referencia));
INSERT INTO historico SELECT 'servico', s.base, s.codigo, s.referencia, COALESCE(c.custo_total, s.preco)
  FROM servico s LEFT JOIN composicao c ON c.base = s.base AND c.codigo = s.codigo AND c.referencia = s.referencia;
INSERT INTO historico SELECT 'insumo', base, codigo, referencia, preco FROM insumo;

CREATE TABLE item_busca (
  id INTEGER PRIMARY KEY, tipo TEXT, base TEXT, codigo TEXT, referencia TEXT,
  descricao TEXT, unidade TEXT, preco REAL, categoria TEXT, grupo TEXT,
  tem_composicao INTEGER DEFAULT 0, usos INTEGER DEFAULT 0,
  pct_mo REAL, pct_mat REAL, pct_equip REAL, pct_terc REAL  -- divisão do custo da composição (0 a 1)
);
INSERT INTO item_busca (tipo, base, codigo, referencia, descricao, unidade, preco, categoria, grupo)
  SELECT 'servico', base, codigo, referencia, descricao, unidade, preco, tipo, grupo FROM servico;
INSERT INTO item_busca (tipo, base, codigo, referencia, descricao, unidade, preco, categoria, grupo)
  SELECT 'insumo', base, codigo, referencia, descricao, unidade, preco, tipo, grupo FROM insumo;
CREATE INDEX ix_item_busca_ref ON item_busca(referencia, tipo, base, codigo);

UPDATE item_busca SET tem_composicao = 1
  WHERE tipo = 'servico' AND EXISTS (SELECT 1 FROM composicao c WHERE c.base = item_busca.base
    AND c.codigo = item_busca.codigo AND c.referencia = item_busca.referencia);
-- preço exibido de serviço = custo da composição (igual ao da tabela, e cobre serviços sem preço na tabela)
UPDATE item_busca SET preco = (SELECT h.preco FROM historico h WHERE h.tipo = item_busca.tipo
  AND h.base = item_busca.base AND h.codigo = item_busca.codigo AND h.referencia = item_busca.referencia);

CREATE TEMP TABLE uso AS
  SELECT referencia, base, codigo, eh_servico, COUNT(DISTINCT composicao_base || composicao) AS n
  FROM composicao_item GROUP BY referencia, base, codigo, eh_servico;
CREATE INDEX temp.ix_uso ON uso(referencia, base, codigo, eh_servico);
UPDATE item_busca SET usos = COALESCE((SELECT n FROM uso WHERE uso.referencia = item_busca.referencia
  AND uso.base = item_busca.base AND uso.codigo = item_busca.codigo AND uso.eh_servico = (item_busca.tipo = 'servico')), 0);

-- divisão do custo: pelo resumo da composição; quando a base não traz o resumo (SINAPI no relatório da CEHOP), pelos itens
CREATE TEMP TABLE div AS
  SELECT c.base, c.codigo, c.referencia,
    c.custo_equipamento AS e, c.custo_mao_de_obra + c.custo_encargo_social AS mo, c.custo_material AS mat, c.custo_servico_terceiro AS t
  FROM composicao c
  WHERE c.custo_equipamento + c.custo_mao_de_obra + c.custo_encargo_social + c.custo_material + c.custo_servico_terceiro > 0
  UNION ALL
  SELECT c.base, c.codigo, c.referencia,
    SUM(CASE WHEN i.secao = 'EQUIPAMENTO' THEN i.custo_total ELSE 0 END),
    SUM(CASE WHEN i.secao = 'MAO_DE_OBRA' THEN i.custo_total ELSE 0 END),
    SUM(CASE WHEN i.secao IN ('MATERIAL', 'SERVICO_AUXILIAR') THEN i.custo_total ELSE 0 END),
    SUM(CASE WHEN i.secao = 'SERVICO_TERCEIRO' THEN i.custo_total ELSE 0 END)
  FROM composicao c JOIN composicao_item i ON i.composicao_base = c.base AND i.composicao = c.codigo AND i.referencia = c.referencia
  WHERE c.custo_equipamento + c.custo_mao_de_obra + c.custo_encargo_social + c.custo_material + c.custo_servico_terceiro = 0
  GROUP BY c.base, c.codigo, c.referencia;
CREATE INDEX temp.ix_div ON div(base, codigo, referencia);
UPDATE item_busca SET
  pct_mo = (SELECT mo / (e + mo + mat + t) FROM div d WHERE d.base = item_busca.base AND d.codigo = item_busca.codigo AND d.referencia = item_busca.referencia AND e + mo + mat + t > 0),
  pct_mat = (SELECT mat / (e + mo + mat + t) FROM div d WHERE d.base = item_busca.base AND d.codigo = item_busca.codigo AND d.referencia = item_busca.referencia AND e + mo + mat + t > 0),
  pct_equip = (SELECT e / (e + mo + mat + t) FROM div d WHERE d.base = item_busca.base AND d.codigo = item_busca.codigo AND d.referencia = item_busca.referencia AND e + mo + mat + t > 0),
  pct_terc = (SELECT t / (e + mo + mat + t) FROM div d WHERE d.base = item_busca.base AND d.codigo = item_busca.codigo AND d.referencia = item_busca.referencia AND e + mo + mat + t > 0)
WHERE tipo = 'servico' AND tem_composicao = 1;

CREATE VIRTUAL TABLE busca USING fts5(
  descricao, codigo, content='item_busca', content_rowid='id',
  tokenize="unicode61 remove_diacritics 2", prefix='2 3 4'
);
INSERT INTO busca(rowid, descricao, codigo) SELECT id, descricao, codigo FROM item_busca;
CREATE INDEX IF NOT EXISTS ix_comp_item_ref ON composicao_item(base, codigo, eh_servico, referencia);
''')
con.commit()
print('referências:', refs)
print(cur.execute('SELECT referencia, tipo, base, COUNT(*) FROM item_busca GROUP BY 1, 2, 3').fetchall())
con.execute('VACUUM')
con.close()
