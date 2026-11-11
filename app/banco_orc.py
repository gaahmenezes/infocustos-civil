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
  criado_em TEXT, atualizado_em TEXT);
CREATE TABLE IF NOT EXISTS etapa (
  id INTEGER PRIMARY KEY, orcamento_id INTEGER NOT NULL REFERENCES orcamento(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL, titulo TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS item (
  id INTEGER PRIMARY KEY, orcamento_id INTEGER NOT NULL REFERENCES orcamento(id) ON DELETE CASCADE,
  etapa_id INTEGER NOT NULL REFERENCES etapa(id) ON DELETE CASCADE, ordem INTEGER NOT NULL,
  tipo TEXT NOT NULL, base TEXT NOT NULL, codigo TEXT NOT NULL, descricao TEXT, unidade TEXT,
  quantidade REAL NOT NULL DEFAULT 0, custo_unit REAL NOT NULL DEFAULT 0, referencia TEXT);
CREATE INDEX IF NOT EXISTS ix_item_orc ON item(orcamento_id, etapa_id, ordem);
'''

# mesmas tabelas; DOUBLE PRECISION porque REAL no Postgres guarda só 6 dígitos
ESQUEMA_POSTGRES = '''
CREATE TABLE IF NOT EXISTS orcamento (
  id SERIAL PRIMARY KEY, nome TEXT NOT NULL, cliente TEXT DEFAULT '', local TEXT DEFAULT '',
  referencia TEXT NOT NULL, bdi DOUBLE PRECISION NOT NULL DEFAULT 25.0, observacoes TEXT DEFAULT '',
  criado_em TEXT, atualizado_em TEXT);
CREATE TABLE IF NOT EXISTS etapa (
  id SERIAL PRIMARY KEY, orcamento_id INTEGER NOT NULL REFERENCES orcamento(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL, titulo TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS item (
  id SERIAL PRIMARY KEY, orcamento_id INTEGER NOT NULL REFERENCES orcamento(id) ON DELETE CASCADE,
  etapa_id INTEGER NOT NULL REFERENCES etapa(id) ON DELETE CASCADE, ordem INTEGER NOT NULL,
  tipo TEXT NOT NULL, base TEXT NOT NULL, codigo TEXT NOT NULL, descricao TEXT, unidade TEXT,
  quantidade DOUBLE PRECISION NOT NULL DEFAULT 0, custo_unit DOUBLE PRECISION NOT NULL DEFAULT 0, referencia TEXT);
CREATE INDEX IF NOT EXISTS ix_item_orc ON item(orcamento_id, etapa_id, ordem);
'''

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

        def executescript(self, _sqlite_ignorado):
            self._c.execute(ESQUEMA_POSTGRES)

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

    def conectar(caminho):
        c = sqlite3.connect(caminho, check_same_thread=False, factory=_Sqlite)
        c.row_factory = sqlite3.Row
        c.execute('PRAGMA foreign_keys = ON')
        return c
