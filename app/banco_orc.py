"""Banco dos orçamentos: SQLite no computador local, PostgreSQL quando houver DATABASE_URL (site publicado).

O resto do código fala sempre do mesmo jeito (estilo sqlite3: `?` nos parâmetros, `cur.lastrowid`,
linha acessível por nome ou por posição). Aqui ficam as diferenças entre os dois bancos.
"""
import os
import sqlite3

URL = os.environ.get('DATABASE_URL', '').strip()
POSTGRES = URL.startswith(('postgres://', 'postgresql://'))

ESQUEMA_SQLITE = '''
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS orcamento (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, cliente TEXT DEFAULT '', local TEXT DEFAULT '',
  referencia TEXT NOT NULL, bdi REAL NOT NULL DEFAULT 25.0, observacoes TEXT DEFAULT '',
  criado_em TEXT, atualizado_em TEXT, sem_complementares INTEGER NOT NULL DEFAULT 0,
  bdi_no_total INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS etapa (
  id INTEGER PRIMARY KEY, orcamento_id INTEGER NOT NULL REFERENCES orcamento(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL, titulo TEXT NOT NULL, pai_id INTEGER REFERENCES etapa(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS item (
  id INTEGER PRIMARY KEY, orcamento_id INTEGER NOT NULL REFERENCES orcamento(id) ON DELETE CASCADE,
  etapa_id INTEGER NOT NULL REFERENCES etapa(id) ON DELETE CASCADE, ordem INTEGER NOT NULL,
  tipo TEXT NOT NULL, base TEXT NOT NULL, codigo TEXT NOT NULL, descricao TEXT, unidade TEXT,
  quantidade REAL NOT NULL DEFAULT 0, custo_unit REAL NOT NULL DEFAULT 0, referencia TEXT);
CREATE INDEX IF NOT EXISTS ix_item_orc ON item(orcamento_id, etapa_id, ordem);
-- composições e insumos próprios da empresa
CREATE TABLE IF NOT EXISTS insumo_proprio (
  id INTEGER PRIMARY KEY, descricao TEXT NOT NULL, unidade TEXT NOT NULL, tipo TEXT NOT NULL DEFAULT 'MATERIAL',
  preco REAL, data_preco TEXT DEFAULT '', fonte TEXT DEFAULT '', criado_em TEXT, atualizado_em TEXT);
CREATE TABLE IF NOT EXISTS composicao_propria (
  id INTEGER PRIMARY KEY, descricao TEXT NOT NULL, unidade TEXT NOT NULL, grupo TEXT DEFAULT '', observacoes TEXT DEFAULT '',
  origem_base TEXT DEFAULT '', origem_codigo TEXT DEFAULT '', criado_em TEXT, atualizado_em TEXT);
CREATE TABLE IF NOT EXISTS composicao_propria_item (
  id INTEGER PRIMARY KEY, composicao_id INTEGER NOT NULL REFERENCES composicao_propria(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL, tipo TEXT NOT NULL, base TEXT NOT NULL, codigo TEXT NOT NULL, qtd REAL NOT NULL DEFAULT 0,
  descricao TEXT DEFAULT '', unidade TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS ix_cp_item ON composicao_propria_item(composicao_id, ordem);
-- preferências da empresa (ex.: nome da base própria)
CREATE TABLE IF NOT EXISTS config (id INTEGER PRIMARY KEY, chave TEXT NOT NULL UNIQUE, valor TEXT);
-- bases próprias (a empresa pode ter várias: a sua, a importada do SIENGE, a de um cliente...)
CREATE TABLE IF NOT EXISTS base_propria (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, descricao TEXT DEFAULT '', criado_em TEXT);
'''

# mesmas tabelas; DOUBLE PRECISION porque REAL no Postgres guarda só 6 dígitos
ESQUEMA_POSTGRES = '''
CREATE TABLE IF NOT EXISTS orcamento (
  id SERIAL PRIMARY KEY, nome TEXT NOT NULL, cliente TEXT DEFAULT '', local TEXT DEFAULT '',
  referencia TEXT NOT NULL, bdi DOUBLE PRECISION NOT NULL DEFAULT 25.0, observacoes TEXT DEFAULT '',
  criado_em TEXT, atualizado_em TEXT, sem_complementares INTEGER NOT NULL DEFAULT 0,
  bdi_no_total INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS etapa (
  id SERIAL PRIMARY KEY, orcamento_id INTEGER NOT NULL REFERENCES orcamento(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL, titulo TEXT NOT NULL, pai_id INTEGER REFERENCES etapa(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS item (
  id SERIAL PRIMARY KEY, orcamento_id INTEGER NOT NULL REFERENCES orcamento(id) ON DELETE CASCADE,
  etapa_id INTEGER NOT NULL REFERENCES etapa(id) ON DELETE CASCADE, ordem INTEGER NOT NULL,
  tipo TEXT NOT NULL, base TEXT NOT NULL, codigo TEXT NOT NULL, descricao TEXT, unidade TEXT,
  quantidade DOUBLE PRECISION NOT NULL DEFAULT 0, custo_unit DOUBLE PRECISION NOT NULL DEFAULT 0, referencia TEXT);
CREATE INDEX IF NOT EXISTS ix_item_orc ON item(orcamento_id, etapa_id, ordem);
-- composições e insumos próprios da empresa
CREATE TABLE IF NOT EXISTS insumo_proprio (
  id SERIAL PRIMARY KEY, descricao TEXT NOT NULL, unidade TEXT NOT NULL, tipo TEXT NOT NULL DEFAULT 'MATERIAL',
  preco DOUBLE PRECISION, data_preco TEXT DEFAULT '', fonte TEXT DEFAULT '', criado_em TEXT, atualizado_em TEXT);
CREATE TABLE IF NOT EXISTS composicao_propria (
  id SERIAL PRIMARY KEY, descricao TEXT NOT NULL, unidade TEXT NOT NULL, grupo TEXT DEFAULT '', observacoes TEXT DEFAULT '',
  origem_base TEXT DEFAULT '', origem_codigo TEXT DEFAULT '', criado_em TEXT, atualizado_em TEXT);
CREATE TABLE IF NOT EXISTS composicao_propria_item (
  id SERIAL PRIMARY KEY, composicao_id INTEGER NOT NULL REFERENCES composicao_propria(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL, tipo TEXT NOT NULL, base TEXT NOT NULL, codigo TEXT NOT NULL, qtd DOUBLE PRECISION NOT NULL DEFAULT 0,
  descricao TEXT DEFAULT '', unidade TEXT DEFAULT '');
CREATE INDEX IF NOT EXISTS ix_cp_item ON composicao_propria_item(composicao_id, ordem);
-- preferências da empresa (ex.: nome da base própria)
CREATE TABLE IF NOT EXISTS config (id SERIAL PRIMARY KEY, chave TEXT NOT NULL UNIQUE, valor TEXT);
CREATE TABLE IF NOT EXISTS base_propria (id SERIAL PRIMARY KEY, nome TEXT NOT NULL, descricao TEXT DEFAULT '', criado_em TEXT);
'''

# colunas que entraram depois: bancos já criados recebem por aqui
COLUNAS_NOVAS = (('orcamento', 'sem_complementares', 'INTEGER NOT NULL DEFAULT 0'),
                 ('orcamento', 'bdi_no_total', 'INTEGER NOT NULL DEFAULT 0'),
                 ('etapa', 'pai_id', 'INTEGER REFERENCES etapa(id) ON DELETE CASCADE'),
                 # cada item próprio pertence a uma base; código de origem = o código do item no sistema de onde veio (SIENGE...)
                 ('composicao_propria', 'base_id', 'INTEGER NOT NULL DEFAULT 1'),
                 ('composicao_propria', 'codigo_origem', "TEXT DEFAULT ''"),
                 ('insumo_proprio', 'base_id', 'INTEGER NOT NULL DEFAULT 1'),
                 ('insumo_proprio', 'codigo_origem', "TEXT DEFAULT ''"),
                 ('insumo_proprio', 'grupo', "TEXT DEFAULT ''"))  # grupo e família de onde o insumo veio (SIENGE)

if POSTGRES:
    import psycopg
    from psycopg_pool import ConnectionPool

    ErroIntegridade = (sqlite3.IntegrityError, psycopg.IntegrityError)

    class Linha(dict):
        """Linha que aceita r['id'] e r[0], como sqlite3.Row."""
        def __getitem__(self, k):
            return list(self.values())[k] if isinstance(k, int) else super().__getitem__(k)

    def _linha(cur):
        nomes = [d.name for d in cur.description or []]
        return lambda valores: Linha(zip(nomes, valores))

    _pool = None

    def _piscina():
        global _pool
        if _pool is None:
            # conexões poucas e verificadas: o banco gratuito desliga as ociosas
            _pool = ConnectionPool(URL, min_size=0, max_size=4, kwargs={'row_factory': _linha},
                                   check=ConnectionPool.check_connection, open=True)
        return _pool

    class Cursor:
        def __init__(self, cur, insercao):
            self._cur, self._ins, self._id = cur, insercao, None

        @property
        def lastrowid(self):
            if self._ins and self._id is None:
                r = self._cur.fetchone()
                self._id = r[0] if r else None
            return self._id

        def fetchone(self):
            return self._cur.fetchone()

        def fetchall(self):
            return self._cur.fetchall()

        def __iter__(self):
            return iter(self._cur.fetchall())

    class Conexao:
        def __init__(self):
            self._p = _piscina()
            self._c = self._p.getconn()

        def execute(self, sql, params=()):
            sql = sql.replace('%', '%%').replace('?', '%s')
            insercao = sql.lstrip().upper().startswith('INSERT')
            if insercao:
                sql += ' RETURNING id'
            return Cursor(self._c.execute(sql, tuple(params)), insercao)

        def executemany(self, sql, linhas):
            """Muitas linhas de uma vez (em lote: uma ida ao banco em vez de uma por linha)."""
            sql = sql.replace('%', '%%').replace('?', '%s')
            with self._c.cursor() as cur:
                cur.executemany(sql, [tuple(x) for x in linhas])

        def executescript(self, _sqlite_ignorado):
            self._c.execute(ESQUEMA_POSTGRES)
            for tabela, coluna, tipo in COLUNAS_NOVAS:
                self._c.execute(f'ALTER TABLE {tabela} ADD COLUMN IF NOT EXISTS {coluna} {tipo}')

        def ajustar_sequencia(self, tabela):
            """Depois de gravar uma linha com id escolhido (desfazer), o próximo id automático pula para depois dele."""
            self._c.execute(f"SELECT setval(pg_get_serial_sequence('{tabela}', 'id'), GREATEST((SELECT MAX(id) FROM {tabela}), 1))")

        def __enter__(self):
            return self

        def __exit__(self, tipo, *_):
            try:
                (self._c.rollback if tipo else self._c.commit)()
            finally:
                self._p.putconn(self._c)
            return False

    def conectar(_caminho):
        return Conexao()
else:
    ErroIntegridade = (sqlite3.IntegrityError,)

    class _Sqlite(sqlite3.Connection):
        def ajustar_sequencia(self, _tabela):
            pass  # no SQLite o próximo id já é o maior + 1

        def executescript(self, sql):
            super().executescript(sql)
            for tabela, coluna, tipo in COLUNAS_NOVAS:
                if coluna not in [r[1] for r in self.execute(f'PRAGMA table_info({tabela})')]:
                    self.execute(f'ALTER TABLE {tabela} ADD COLUMN {coluna} {tipo}')

    def conectar(caminho):
        c = sqlite3.connect(caminho, check_same_thread=False, factory=_Sqlite)
        c.row_factory = sqlite3.Row
        c.execute('PRAGMA foreign_keys = ON')
        return c
