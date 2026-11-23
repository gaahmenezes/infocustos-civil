"""Monta o banco único da consulta: bancos mensais do repositório + meses enviados pela tela e publicados.

Uso (build da publicação): python3 extratores/montar_base.py dados/orse_sinapi.sqlite
  - lê dados/orse_sinapi_AAAA-MM.sqlite(.gz), dados/sinapi_AAAA-MM.sqlite(.gz) e dados/sicro_AAAA-MM.sqlite(.gz);
  - com DATABASE_URL (ou ORCAMENTOS_DB), busca no banco dos orçamentos os meses publicados pela tela "Bases oficiais"
    (tabela base_mensal) e cada um deles substitui a mesma base e mês do repositório;
  - junta tudo (juntar_referencias.py), cria o índice (build_index.py) e grava na tabela `publicacao` quais envios
    entraram (o servidor compara com o banco dos orçamentos para saber se precisa remontar).

Também é chamado pelo servidor (função montar) para publicar um mês sem reiniciar.
"""
import glob
import gzip
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
PADROES = ('orse_sinapi_20*.sqlite', 'sinapi_20*.sqlite', 'sicro_20*.sqlite')


def arquivos_do_repositorio(dados):
    """Caminhos dos bancos mensais do repositório (descompacta os .gz para uma pasta temporária, se preciso)."""
    tmp = tempfile.mkdtemp(prefix='bases_')
    vistos, saida = set(), []
    for p in PADROES:
        # o .gz é o que está no repositório: vale mais que um .sqlite solto que tenha ficado na pasta
        for f in sorted(glob.glob(os.path.join(dados, p + '.gz'))) + sorted(glob.glob(os.path.join(dados, p))):
            nome = os.path.basename(f).removesuffix('.gz')
            if nome in vistos:
                continue
            vistos.add(nome)
            if f.endswith('.gz'):
                destino = os.path.join(tmp, nome)
                with gzip.open(f, 'rb') as a, open(destino, 'wb') as b:
                    shutil.copyfileobj(a, b)
                saida.append(destino)
            else:
                saida.append(f)
    return saida, tmp


def bases_do_arquivo(caminho):
    c = sqlite3.connect(caminho)
    try:
        ref = c.execute('SELECT id FROM referencia').fetchone()[0]
        bases = {b for (b,) in c.execute('SELECT DISTINCT base FROM servico UNION SELECT DISTINCT base FROM insumo')}
        return ref, bases
    finally:
        c.close()


def sem_bases(caminho, tirar, pasta):
    """Cópia do banco mensal sem as bases que foram substituídas por um envio."""
    destino = os.path.join(pasta, 'parcial_' + os.path.basename(caminho))
    shutil.copyfile(caminho, destino)
    c = sqlite3.connect(destino)
    for b in tirar:
        for t in ('insumo', 'servico', 'composicao'):
            c.execute(f'DELETE FROM {t} WHERE base = ?', (b,))
        c.execute('DELETE FROM composicao_item WHERE composicao_base = ?', (b,))
    c.commit(); c.close()
    return destino


def envios_publicados():
    """[(id, base, referencia, bytes do banco .gz)] dos meses publicados pela tela (mais recente por base e mês)."""
    sys.path.insert(0, os.path.join(RAIZ, 'app'))
    try:
        import banco_orc
    except Exception:
        return []
    if not banco_orc.POSTGRES and not os.environ.get('ORCAMENTOS_DB'):
        return []
    caminho = os.environ.get('ORCAMENTOS_DB', os.path.join(RAIZ, 'app', 'orcamentos.sqlite'))
    try:
        with banco_orc.conectar(caminho) as c:
            c.executescript(banco_orc.ESQUEMA_SQLITE)
            linhas = c.execute("""SELECT id, base, referencia, arquivo FROM base_mensal WHERE status = 'publicado'
                ORDER BY publicado_em DESC, id DESC""").fetchall()
    except Exception as e:  # sem banco dos orçamentos: só o repositório
        print('aviso: não deu para ler os meses publicados:', e)
        return []
    finally:
        if banco_orc.POSTGRES and __name__ == '__main__' and getattr(banco_orc, '_pool', None) is not None:
            banco_orc._pool.close()  # no build, fecha as conexões (no servidor, o pool continua em uso)
    vistos, out = set(), []
    for r in linhas:
        if (r['base'], r['referencia']) in vistos:
            continue
        vistos.add((r['base'], r['referencia']))
        out.append((r['id'], r['base'], r['referencia'], bytes(r['arquivo'])))
    return out


def montar(destino, dados=None, envios=None, log=print):
    """Monta o banco único em `destino` e devolve os ids dos envios que entraram."""
    dados = dados or os.path.join(RAIZ, 'dados')
    envios = envios_publicados() if envios is None else envios
    repo, tmp = arquivos_do_repositorio(dados)
    try:
        substitui = {}
        for eid, base, ref, gz in envios:
            f = os.path.join(tmp, f'envio_{eid}_{base}_{ref}.sqlite')
            with open(f, 'wb') as a:
                a.write(gzip.decompress(gz))
            substitui[(base, ref)] = f
        origens = []
        for f in repo:
            ref, bases = bases_do_arquivo(f)
            tirar = {b for b in bases if (b, ref) in substitui}
            if not tirar:
                origens.append(f)
            elif tirar != bases:
                origens.append(sem_bases(f, tirar, tmp))
            # (se todas as bases do arquivo foram substituídas, ele fica de fora)
        origens += list(substitui.values())
        novo = destino + '.novo'
        if os.path.exists(novo):
            os.remove(novo)
        log(f'juntando {len(origens)} bancos mensais ({len(envios)} enviados pela tela)')
        subprocess.run([sys.executable, os.path.join(AQUI, 'juntar_referencias.py'), novo] + origens, check=True,
                       stdout=subprocess.DEVNULL)
        log('criando o índice de busca')
        subprocess.run([sys.executable, os.path.join(RAIZ, 'app', 'build_index.py'), novo], check=True, stdout=subprocess.DEVNULL)
        c = sqlite3.connect(novo)
        c.execute('CREATE TABLE IF NOT EXISTS publicacao (envio INTEGER PRIMARY KEY, base TEXT, referencia TEXT)')
        c.executemany('INSERT INTO publicacao VALUES (?,?,?)', [(e[0], e[1], e[2]) for e in envios])
        c.commit(); c.close()
        os.replace(novo, destino)
        return [e[0] for e in envios]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    ids = montar(sys.argv[1] if len(sys.argv) > 1 else os.path.join(RAIZ, 'dados', 'orse_sinapi.sqlite'))
    print('meses enviados pela tela no banco:', ids or 'nenhum')
