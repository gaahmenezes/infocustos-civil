"""Servidor do InfoCustos Civil: consulta ORSE/SINAPI por mês de referência, orçamento e comparativo entre meses.

Rodar:  uvicorn server:app --port 8000   (dentro da pasta app/)
Banco:  variável ORSE_DB ou ../dados/orse_sinapi.sqlite (todas as referências)

Cada consulta trabalha com UM mês (parâmetro `ref`, padrão: o mais recente). Dados de meses
diferentes só aparecem juntos em /api/comparativo.
"""
import base64
from functools import lru_cache
import threading
from collections import OrderedDict
import hashlib
import hmac
import io
import os
import secrets
import re
import sqlite3
import time
import unicodedata
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

AQUI = Path(__file__).parent
DB = os.environ.get('ORSE_DB', str(AQUI.parent / 'dados' / 'orse_sinapi.sqlite'))
BASES = {'ORSE', 'SINAPI', 'SICRO'}
ORDEM_BASES = ['ORSE', 'SINAPI', 'SICRO']
SECOES = {
    'MAO_DE_OBRA': 'Mão de obra', 'MATERIAL': 'Material', 'EQUIPAMENTO': 'Equipamento',
    'SERVICO_TERCEIRO': 'Serviço de terceiro', 'SERVICO_AUXILIAR': 'Serviço auxiliar',
}

app = FastAPI(title='InfoCustos Civil')

# Senha única do site publicado: só vale quando INFOCUSTOS_SENHA está definida (no computador local fica aberto).
# Quem acerta a senha na tela de entrada recebe um cookie assinado; nada de caixinha de senha do navegador.
USUARIO = os.environ.get('INFOCUSTOS_USUARIO', 'infocustos')
SENHA = os.environ.get('INFOCUSTOS_SENHA', '')
COOKIE, VALIDADE = 'infocustos_sessao', 30 * 24 * 3600
# entram sem senha: a tela de entrada e o que ela usa, o monitor que mantém o site acordado e o manifesto/ícones
LIVRES = {'/saude', '/manifest.webmanifest', '/entrar', '/api/entrar', '/api/entrada',
          '/static/entrar.css', '/static/entrar.js'}
_tentativas = {}  # ip -> (quantas erradas, até quando esperar)


def _assinar(validade: int) -> str:
    chave = hashlib.sha256(('sessao:' + SENHA).encode()).digest()
    return hmac.new(chave, str(validade).encode(), hashlib.sha256).hexdigest()


def _sessao_valida(valor: str) -> bool:
    validade, _, assinatura = (valor or '').partition('.')
    return validade.isdigit() and int(validade) > time.time() and secrets.compare_digest(assinatura, _assinar(int(validade)))


def _basic_valido(cabecalho: str) -> bool:
    # continua aceito para scripts e testes; o navegador não é mais convidado a usá-lo
    if not cabecalho.startswith('Basic '):
        return False
    try:
        usuario, _, senha = base64.b64decode(cabecalho[6:]).decode('utf-8').partition(':')
    except Exception:
        return False
    return secrets.compare_digest(usuario.encode(), USUARIO.encode()) & secrets.compare_digest(senha.encode(), SENHA.encode())


@app.middleware('http')
async def conferir_versao(request: Request, seguir):
    """Arquivos do site (JS/CSS): o navegador sempre confere se há versão nova (responde 304 se não mudou).
    Sem isso, depois de uma atualização ele podia misturar arquivo novo com antigo."""
    resposta = await seguir(request)
    if request.url.path.startswith('/static/') and 'cache-control' not in resposta.headers:
        # endereço com a marca da versão (?v=...) nunca muda de conteúdo: o navegador guarda por um ano e nem pergunta.
        # Sem a marca (ícones, acesso direto), continua conferindo.
        com_versao = request.query_params.get('v') == VERSAO and resposta.status_code == 200
        resposta.headers['Cache-Control'] = 'public, max-age=31536000, immutable' if com_versao else 'no-cache'
    return resposta


# ---------- respostas guardadas ----------
# A base de preços não muda com o servidor no ar: a mesma pergunta tem sempre a mesma resposta. As consultas que só
# dependem dela ficam guardadas em memória (as mais recentes), e a segunda vez sai sem tocar no banco.
GUARDAVEIS = re.compile(r'^/api/(composicao/(ORSE|SINAPI|SICRO)/|insumo/(ORSE|SINAPI|SICRO)/|encargos|comparativo|entrada)', re.I)
_GUARDADAS, _GUARDADAS_MAX, _GUARDADAS_TRAVA = OrderedDict(), 400, threading.Lock()


@app.middleware('http')
async def respostas_guardadas(request: Request, seguir):
    if request.method != 'GET' or not GUARDAVEIS.match(request.url.path):
        return await seguir(request)
    chave = request.url.path + '?' + request.url.query
    with _GUARDADAS_TRAVA:
        achada = _GUARDADAS.get(chave)
        if achada:
            _GUARDADAS.move_to_end(chave)
    if achada:
        return Response(achada[0], media_type=achada[1])
    resposta = await seguir(request)
    if resposta.status_code != 200:
        return resposta
    corpo = b''.join([parte async for parte in resposta.body_iterator])
    tipo = resposta.headers.get('content-type', 'application/json')
    if len(corpo) < 400_000:
        with _GUARDADAS_TRAVA:
            _GUARDADAS[chave] = (corpo, tipo)
            while len(_GUARDADAS) > _GUARDADAS_MAX:
                _GUARDADAS.popitem(last=False)
    return Response(corpo, media_type=tipo)


@app.middleware('http')
async def exigir_senha(request: Request, seguir):
    caminho = request.url.path
    if (not SENHA or caminho in LIVRES or caminho.startswith('/static/icones/')
            or _sessao_valida(request.cookies.get(COOKIE, '')) or _basic_valido(request.headers.get('authorization', ''))):
        return await seguir(request)
    if request.method == 'GET' and not caminho.startswith(('/api/', '/static/')):
        return RedirectResponse('/entrar', status_code=303)  # página: vai para a tela de entrada
    return JSONResponse({'detail': 'Sessão encerrada. Entre de novo.'}, status_code=401)


class Entrada(BaseModel):
    senha: str = ''


@app.get('/entrar')
def tela_entrar(request: Request):
    if not SENHA or _sessao_valida(request.cookies.get(COOKIE, '')):
        return RedirectResponse('/', status_code=303)
    return HTMLResponse(_com_versao('entrar.html'), headers={'Cache-Control': 'no-store'})


@app.get('/api/entrada')
def api_entrada():
    """Números da base para a tela de entrada (só contagens do mês mais recente)."""
    with conn() as c:
        escolha = ler_refs(c)  # cada base no seu mês mais recente
        cond, args = filtro_meses(escolha)
        tot = dict(c.execute(f'SELECT tipo, COUNT(*) FROM item_busca i WHERE {cond} GROUP BY 1', args).fetchall())
        return {'mes': nome_mes(referencia_atual(c)), 'composicoes': tot.get('servico', 0), 'insumos': tot.get('insumo', 0),
                'meses': len(referencias(c)), 'bases': [b for b in ORDEM_BASES if b in escolha]}


@app.post('/api/entrar')
def api_entrar(d: Entrada, request: Request):
    ip = (request.headers.get('x-forwarded-for', '').split(',')[0].strip() or (request.client.host if request.client else '?'))
    erradas, espera = _tentativas.get(ip, (0, 0))
    if espera > time.time():
        raise HTTPException(429, f'Muitas tentativas. Aguarde {int(espera - time.time()) + 1} s e tente de novo.')
    if not SENHA or secrets.compare_digest(d.senha.encode(), SENHA.encode()):
        _tentativas.pop(ip, None)
        validade = int(time.time()) + VALIDADE
        r = JSONResponse({'ok': True})
        r.set_cookie(COOKIE, f'{validade}.{_assinar(validade)}', max_age=VALIDADE, httponly=True, samesite='lax',
                     secure=request.headers.get('x-forwarded-proto', request.url.scheme) == 'https')
        return r
    erradas += 1
    # a partir da 5ª senha errada seguida, cada nova tentativa espera mais (até 5 min)
    _tentativas[ip] = (erradas, time.time() + min(300, 2 ** (erradas - 4)) if erradas >= 5 else 0)
    time.sleep(0.4)
    raise HTTPException(401, 'Senha incorreta.')


@app.post('/api/sair')
def api_sair():
    r = JSONResponse({'ok': True}); r.delete_cookie(COOKIE); return r


@app.api_route('/saude', methods=['GET', 'HEAD'])
def saude():
    """Resposta curta para o monitor que visita o site e não o deixa dormir."""
    return PlainTextResponse('ok')


def conn():
    c = sqlite3.connect(f'file:{DB}?mode=ro', uri=True, check_same_thread=False)
    c.row_factory = sqlite3.Row
    return c


def referencias(c):
    return [dict(r) for r in c.execute('SELECT * FROM referencia ORDER BY id')]


def referencia_atual(c):
    return referencias(c)[-1]


def mes(c, ref: Optional[str]):
    """Valida o mês pedido; sem mês, usa o mais recente."""
    todas = referencias(c)
    if not ref:
        return todas[-1]
    for r in todas:
        if r['id'] == ref:
            return r
    raise HTTPException(404, f'O mês {ref} não está carregado. Meses disponíveis: ' + ', '.join(r['id'] for r in todas) + '.')


def nome_mes(r):
    return r['descricao'].removesuffix('-1')


# ---------- cada base tem os seus meses (ORSE e SINAPI vêm juntas da CEHOP; o SICRO vem do DNIT, noutro calendário) ----------
_MESES_BASE = {}


def meses_da_base(c):
    """{base: [meses em ordem]} — o banco é só leitura, então basta ler uma vez."""
    if not _MESES_BASE:
        for b, ref in c.execute('SELECT DISTINCT base, referencia FROM item_busca ORDER BY referencia'):
            _MESES_BASE.setdefault(b, []).append(ref)
    return _MESES_BASE


_FONTES = {}


def fonte_de(c, base, ref):
    """De onde vêm os preços de uma base num mês: ORSE e SINAPI pelo programa da CEHOP, SINAPI pelos relatórios da CAIXA
    (insumos com origem C/CR/AS) ou SICRO pelo DNIT."""
    if (base, ref) not in _FONTES:
        if base == 'SICRO':
            f = 'DNIT'
        elif base == 'SINAPI' and c.execute("SELECT 1 FROM insumo WHERE base = 'SINAPI' AND referencia = ? AND marcador IN ('C', 'CR', 'AS') LIMIT 1", (ref,)).fetchone():
            f = 'CAIXA'
        else:
            f = 'CEHOP'
        _FONTES[(base, ref)] = f
    return _FONTES[(base, ref)]


def mes_da_base(c, base, ref: Optional[str]):
    """Mês pedido para uma base; sem mês, o mais recente dela. Mês que a base não tem é erro (com os meses que ela tem)."""
    meses = meses_da_base(c).get(base, [])
    if not meses:
        raise HTTPException(404, f'A base {base} não está carregada.')
    alvo = ref or meses[-1]
    if alvo not in meses:
        nomes = {r['id']: nome_mes(r) for r in referencias(c)}
        raise HTTPException(404, f'A base {base} não tem o mês {nomes.get(alvo, alvo)}. Meses do {base}: ' + ', '.join(nomes.get(m, m) for m in meses) + '.')
    return next(r for r in referencias(c) if r['id'] == alvo)


def ler_refs(c, refs: str = '', ref: Optional[str] = None, bases: str = ''):
    """Mês de cada base. `refs` = "ORSE:2026-08,SICRO:2026-07"; base sem mês indicado usa `ref` (se ela o tiver) ou o mais recente dela.
    `bases` = "ORSE,SICRO" limita às bases escolhidas para a pesquisa (vazio: todas)."""
    pedido = dict(x.split(':', 1) for x in (refs or '').split(',') if ':' in x)
    todos = {m for v in meses_da_base(c).values() for m in v}
    for m in [ref, *pedido.values()]:
        if m and m not in todos:
            mes(c, m)  # erro com a lista dos meses carregados
    so = {x.strip().upper() for x in (bases or '').split(',') if x.strip()} & set(meses_da_base(c))
    escolha = {}
    for b, meses in meses_da_base(c).items():
        if so and b not in so:
            continue
        m = pedido.get(b)
        escolha[b] = m if m in meses else ref if ref in meses else meses[-1]
    return escolha


def filtro_meses(escolha, base='todas', alias='i'):
    """Condição SQL: cada base no seu mês (ou só a base filtrada)."""
    bases = [base.upper()] if base.upper() in escolha else list(escolha)
    cond = ' OR '.join(f'({alias}.base = ? AND {alias}.referencia = ?)' for _ in bases)
    return f'({cond})', [v for b in bases for v in (b, escolha[b])]


def checar_base(base):
    base = base.upper()
    if base not in BASES:
        raise HTTPException(404, 'Base não encontrada. Use ORSE ou SINAPI.')
    return base


def sem_acento(t):
    return unicodedata.normalize('NFKD', t or '').encode('ascii', 'ignore').decode().lower()


def pontuar(r, q):
    """Ordem dos resultados: relevância do texto, mais bônus para o que o orçamentista costuma procurar."""
    termos = re.findall(r'[a-z0-9]+', sem_acento(q))
    palavras = re.findall(r'[a-z0-9]+', sem_acento(r['descricao']))
    s = r['rel']  # bm25: quanto menor, melhor
    if termos and palavras and palavras[0].startswith(termos[0]):
        s -= 6  # a descrição começa pelo que foi digitado
    elif termos and any(w.startswith(termos[0]) for w in palavras[:4]):
        s -= 2
    if r['tipo'] == 'servico':
        s -= 1.5
    s -= min(r['usos'] or 0, 2000) / 1000
    s += len(palavras) / 200  # descrições enxutas primeiro, em empate
    return s


def montar_fts(q):
    termos = re.findall(r'[\wÀ-ÿ]+', q)
    return ' '.join(f'"{t}"*' for t in termos) if termos else None


# ---------- consulta (um mês) ----------
@app.get('/api/referencia')
def api_referencia(ref: Optional[str] = None, refs: str = '', bases: str = ''):
    """Meses de cada base e o tamanho de cada uma no mês escolhido. `ref` (mês principal: ORSE/SINAPI) segue valendo."""
    return _referencia(ref, refs, bases) | {'base_propria': proprias.nome_base()}


@lru_cache(maxsize=64)
def _referencia(ref, refs, bases):
    with conn() as c:
        todas_bases = ler_refs(c, refs, ref)
        escolha = ler_refs(c, refs, ref, bases)
        principal = todas_bases.get('ORSE') or next(iter(todas_bases.values()))
        r = mes(c, principal)
        cond, args = filtro_meses(escolha)
        tot = c.execute(f'SELECT tipo, base, COUNT(*) n FROM item_busca i WHERE {cond} GROUP BY 1, 2', args).fetchall()
        tem_enc = {row[0] for row in c.execute('SELECT DISTINCT tipo FROM encargo WHERE referencia = ?', (r['id'],))}
        todas = referencias(c)
        bases = {b: {'meses': [x for x in todas if x['id'] in meses], 'atual': meses[-1], 'fontes': {m: fonte_de(c, b, m) for m in meses}}
                 for b, meses in sorted(meses_da_base(c).items(), key=lambda kv: ORDEM_BASES.index(kv[0]) if kv[0] in ORDEM_BASES else 99)}
        return r | {'totais': [dict(t) for t in tot], 'referencias': todas, 'atual': referencia_atual(c)['id'], 'protegido': bool(SENHA),
                    'encargos_detalhados': sorted(tem_enc), 'bases': bases, 'refs': todas_bases, 'ativas': list(escolha)}


@app.get('/api/busca')
def api_busca(q: str = '', base: str = 'todas', tipo: str = 'todos', limite: int = Query(60, le=500), ref: Optional[str] = None,
              desde: int = Query(0, ge=0), ordem: str = 'usos', refs: str = '', bases: str = ''):
    """Cada base é procurada no seu mês (`refs`). Sem texto lista a base inteira: `ordem=codigo` na ordem da tabela, `desde` para as páginas seguintes."""
    if base.upper() == 'PROPRIA':
        props = proprias.buscar(q, tipo, refs, limite=500)
        lista = props[desde:desde + limite]
        grade = [{'tipo': t, 'base': 'PROPRIA', 'n': sum(1 for x in props if x['tipo'] == t)} for t in ('servico', 'insumo')]
        with conn() as c:
            ref0 = ler_refs(c, refs, ref, bases).get('ORSE')
        return {'total': len(props), 'referencia': ref0, 'refs': {}, 'grade': [g for g in grade if g['n']], 'itens': lista}
    with conn() as c:
        escolha = ler_refs(c, refs, ref, bases)
        r = mes(c, escolha.get(base.upper()) or escolha.get('ORSE') or next(iter(escolha.values())))
        cond_todas, args_todas = filtro_meses(escolha)          # para os números dos filtros (todas as bases)
        cond, args0 = filtro_meses(escolha, base)
        filtros, args = [cond], list(args0)
        if tipo in ('servico', 'insumo'):
            filtros.append('i.tipo = ?'); args.append(tipo)
        q = q.strip()
        grade = []  # contagem por tipo × base para o termo, sem os filtros de tipo/base (para os números dos filtros)
        if re.fullmatch(r'\d{1,7}', q):
            cond = '(i.codigo = ? OR ltrim(i.codigo, "0") = ltrim(?, "0") OR i.codigo LIKE ?)'
            grade = c.execute(f'SELECT i.tipo, i.base, COUNT(*) n FROM item_busca i WHERE {cond_todas} AND {cond} GROUP BY 1, 2',
                              args_todas + [q, q, q + '%']).fetchall()
            w = ' AND '.join(filtros + [cond])
            rows = c.execute(f'''SELECT i.*, NULL AS trecho FROM item_busca i WHERE {w}
                ORDER BY (ltrim(i.codigo,'0') = ltrim(?,'0')) DESC, i.tipo DESC, i.codigo LIMIT ?''',
                args + [q, q, q + '%', q, limite]).fetchall()
            total = len(rows)
        elif q:
            fts = montar_fts(q)
            if not fts:
                return {'total': 0, 'itens': [], 'referencia': r['id']}
            grade = c.execute(f'''SELECT i.tipo, i.base, COUNT(*) n FROM busca CROSS JOIN item_busca i ON i.id = busca.rowid
                WHERE busca MATCH ? AND {cond_todas} GROUP BY 1, 2''', [fts] + args_todas).fetchall()
            w = ' AND '.join(['busca MATCH ?'] + filtros)
            base_sql = f'FROM busca CROSS JOIN item_busca i ON i.id = busca.rowid WHERE {w}'
            total = c.execute(f'SELECT COUNT(*) {base_sql}', [fts] + args).fetchone()[0]
            cand = c.execute(f'''SELECT i.*, highlight(busca, 0, '\u0001', '\u0002') AS trecho, bm25(busca, 1.0, 4.0) AS rel {base_sql}
                ORDER BY rel LIMIT 400''', [fts] + args).fetchall()
            rows = sorted(cand, key=lambda x: pontuar(x, q))[:limite]
        else:
            w = 'WHERE ' + ' AND '.join(filtros)
            total = c.execute(f'SELECT COUNT(*) FROM item_busca i {w}', args).fetchone()[0]
            ordenar = 'i.base, i.tipo DESC, i.codigo' if ordem == 'codigo' else 'i.usos DESC'
            rows = c.execute(f'SELECT i.*, NULL AS trecho FROM item_busca i {w} ORDER BY {ordenar} LIMIT ? OFFSET ?',
                             args + [limite, desde]).fetchall()
        # itens próprios da empresa: aparecem primeiro (com texto ou na lista da base inteira, só na primeira página)
        if base.upper() not in BASES and desde == 0:
            props = proprias.buscar(q, tipo, refs, limite=20)
            if props:
                rows = props + list(rows)[:max(0, limite - len(props))]
                total += len(props)
            todos_props = proprias.buscar(q, 'todos', refs, limite=500)
            grade = [dict(g) for g in grade] + [{'tipo': t, 'base': 'PROPRIA', 'n': n} for t in ('servico', 'insumo')
                                                 if (n := sum(1 for x in todos_props if x['tipo'] == t))]
        return {'total': total, 'referencia': r['id'], 'refs': escolha, 'grade': [dict(g) for g in grade],
                'itens': [(dict(x) if isinstance(x, dict) else {k: x[k] for k in x.keys() if k != 'rel'}) for x in rows]}


def ler_composicao(c, base, codigo, ref):
    comp = c.execute('''SELECT c.*, s.descricao, s.grupo, s.subgrupo, s.tipo AS categoria FROM composicao c
        LEFT JOIN servico s ON s.base = c.base AND s.codigo = c.codigo AND s.referencia = c.referencia
        WHERE c.base = ? AND c.referencia = ? AND (c.codigo = ? OR ltrim(c.codigo,'0') = ltrim(?,'0'))''',
                     (base, ref, codigo, codigo)).fetchone()
    if not comp:
        return None
    # Códigos de insumo e de composição se repetem na mesma base; só item marcado como serviço tem composição.
    itens = c.execute('''SELECT i.*, (i.eh_servico = 1 AND EXISTS (SELECT 1 FROM composicao x WHERE x.base = i.base
            AND x.codigo = i.codigo AND x.referencia = i.referencia)) AS tem_composicao
        FROM composicao_item i WHERE i.composicao_base = ? AND i.composicao = ? AND i.referencia = ?
        ORDER BY i.ordem''', (comp['base'], comp['codigo'], ref)).fetchall()
    return dict(comp) | {'itens': [dict(i) | {'tem_composicao': bool(i['tem_composicao'])} for i in itens]}


@app.get('/api/composicao/{base}/{codigo}')
def api_composicao(base: str, codigo: str, ref: Optional[str] = None, refs: str = ''):
    if base.upper() == 'PROPRIA':
        return proprias.ficha_composicao(codigo, refs)  # calculada na hora, com a data-base de cada base
    base = checar_base(base)
    with conn() as c:
        r = mes_da_base(c, base, ref)
        d = ler_composicao(c, base, codigo, r['id'])
        if not d:
            raise HTTPException(404, f'A composição {codigo}/{base} não existe em {nome_mes(r)}.')
        d['fonte'] = fonte_de(c, base, r['id'])
        d['usada_em'] = c.execute('''SELECT COUNT(DISTINCT composicao_base || composicao) FROM composicao_item
            WHERE base = ? AND codigo = ? AND eh_servico = 1 AND referencia = ?''', (base, d['codigo'], r['id'])).fetchone()[0]
        return d


@app.get('/api/insumo/{base}/{codigo}')
def api_insumo(base: str, codigo: str, limite: int = Query(100, le=2000), ref: Optional[str] = None):
    if base.upper() == 'PROPRIA':
        return proprias.ficha_insumo(codigo)
    base = checar_base(base)
    with conn() as c:
        r = mes_da_base(c, base, ref)
        ins = c.execute('SELECT * FROM insumo WHERE base = ? AND codigo = ? AND referencia = ?', (base, codigo, r['id'])).fetchone()
        if not ins:
            raise HTTPException(404, f'O insumo {codigo}/{base} não existe em {nome_mes(r)}.')
        total = c.execute('''SELECT COUNT(DISTINCT composicao_base || composicao) FROM composicao_item
            WHERE base = ? AND codigo = ? AND eh_servico = 0 AND referencia = ?''', (base, codigo, r['id'])).fetchone()[0]
        # No modelo DNIT, equipamento e mão de obra são custo horário da equipe: divide pela produção.
        usos = c.execute('''SELECT i.composicao_base AS base, i.composicao AS codigo, s.descricao, s.unidade,
                CASE WHEN c.modelo = 'DNIT' AND i.secao IN ('EQUIPAMENTO', 'MAO_DE_OBRA') AND c.prod_equipe > 0
                     THEN i.qtd / c.prod_equipe ELSE i.qtd END AS qtd,
                CASE WHEN c.modelo = 'DNIT' AND i.secao IN ('EQUIPAMENTO', 'MAO_DE_OBRA') AND c.prod_equipe > 0
                     THEN i.custo_total / c.prod_equipe ELSE i.custo_total END AS custo_item,
                c.custo_total AS preco_composicao
            FROM composicao_item i
            JOIN composicao c ON c.base = i.composicao_base AND c.codigo = i.composicao AND c.referencia = i.referencia
            LEFT JOIN servico s ON s.base = c.base AND s.codigo = c.codigo AND s.referencia = c.referencia
            WHERE i.base = ? AND i.codigo = ? AND i.eh_servico = 0 AND i.referencia = ?
            ORDER BY (custo_item / NULLIF(c.custo_total, 0)) DESC LIMIT ?''', (base, codigo, r['id'], limite)).fetchall()
        return dict(ins) | {'usado_em': total, 'fonte': fonte_de(c, base, r['id']), 'usos': [dict(u) | {'custo_total': u['custo_item']} for u in usos]}


@app.get('/api/encargos')
def api_encargos(ref: Optional[str] = None):
    with conn() as c:
        r = mes(c, ref)
        out = {}
        for tipo in ('horista', 'mensalista'):
            linhas = [dict(x) for x in c.execute('SELECT grupo, item, descricao, valor FROM encargo WHERE referencia = ? AND tipo = ? ORDER BY grupo, item = grupo DESC, item',
                                                 (r['id'], tipo))]
            out[tipo] = {'total': r.get(f'encargo_social_{tipo}'), 'linhas': linhas}
        return {'referencia': r} | out


# ---------- comparativo entre meses (único lugar onde meses aparecem juntos) ----------
@app.get('/api/comparativo')
def api_comparativo(de: Optional[str] = None, para: Optional[str] = None, base: str = 'todas', tipo: str = 'servico',
                    sentido: str = 'alta', q: str = '', limite: int = Query(150, le=1000)):
    with conn() as c:
        meses = meses_da_base(c)
        validos = set(meses.get(base.upper(), [])) if base.upper() in BASES else {m for v in meses.values() for m in v}
        refs = [x for x in referencias(c) if x['id'] in validos]
        if len(refs) < 2:
            return {'de': None, 'para': refs[-1], 'referencias': refs, 'resumo': None, 'itens': []}
        ids = [x['id'] for x in refs]
        # sem meses indicados: os dois últimos de uma mesma base (a que tiver o mês mais recente entre as que têm dois ou mais)
        pares = [(b2, v[-2:]) for b2, v in meses.items() if len(v) >= 2 and (base.upper() not in BASES or b2 == base.upper())]
        # prefere dois meses da mesma fonte (sem misturar método de cálculo); entre esses, o par mais recente
        padrao = max(pares, key=lambda x: (fonte_de(c, x[0], x[1][0]) == fonte_de(c, x[0], x[1][1]), x[1][1]))[1] if pares else [ids[-2], ids[-1]]
        a = mes(c, de if de in ids else padrao[0]); b = mes(c, para if para in ids else padrao[1])
        if a['id'] == b['id']:
            raise HTTPException(422, 'Escolha dois meses diferentes para comparar.')
        tipo = tipo if tipo in ('servico', 'insumo') else 'servico'
        filtros, args = ['h1.tipo = ?'], [tipo]
        if base.upper() in BASES:
            filtros.append('h1.base = ?'); args.append(base.upper())
        juncao = f'''FROM historico h1 JOIN historico h2 ON h2.tipo = h1.tipo AND h2.base = h1.base AND h2.codigo = h1.codigo
            AND h2.referencia = ? WHERE h1.referencia = ? AND {' AND '.join(filtros)}'''
        jargs = [b['id'], a['id']] + args
        resumo = dict(c.execute(f'''SELECT COUNT(*) AS comparados,
                SUM(h2.preco > h1.preco + 0.005) AS subiram, SUM(h2.preco < h1.preco - 0.005) AS desceram,
                SUM(abs(h2.preco - h1.preco) <= 0.005) AS iguais
            {juncao} AND h1.preco > 0 AND h2.preco IS NOT NULL''', jargs).fetchone())
        so_em = lambda x, y: c.execute(f'''SELECT COUNT(*) FROM historico h1 WHERE h1.referencia = ? AND {' AND '.join(filtros)}
            AND NOT EXISTS (SELECT 1 FROM historico h2 WHERE h2.tipo = h1.tipo AND h2.base = h1.base AND h2.codigo = h1.codigo
            AND h2.referencia = ?)''', [x] + args + [y]).fetchone()[0]
        resumo['novos'] = so_em(b['id'], a['id']); resumo['retirados'] = so_em(a['id'], b['id'])
        extra, eargs = '', []
        if q.strip():
            extra = ' AND (i.descricao LIKE ? OR i.codigo = ?)'; eargs = [f'%{q.strip()}%', q.strip()]
        ordem = 'DESC' if sentido != 'baixa' else 'ASC'
        rows = c.execute(f'''SELECT h1.tipo, h1.base, h1.codigo, i.descricao, i.unidade, i.grupo,
                h1.preco AS preco_de, h2.preco AS preco_para, h2.preco / h1.preco - 1 AS variacao
            FROM historico h1
            JOIN historico h2 ON h2.tipo = h1.tipo AND h2.base = h1.base AND h2.codigo = h1.codigo AND h2.referencia = ?
            JOIN item_busca i ON i.tipo = h1.tipo AND i.base = h1.base AND i.codigo = h1.codigo AND i.referencia = h2.referencia
            WHERE h1.referencia = ? AND {' AND '.join(filtros)} AND h1.preco > 0 AND h2.preco IS NOT NULL{extra}
            ORDER BY variacao {ordem} LIMIT ?''', jargs + eargs + [limite]).fetchall()
        aviso = None
        if base.upper() in ('SINAPI', 'TODAS') and fonte_de(c, 'SINAPI', a['id']) != fonte_de(c, 'SINAPI', b['id']):
            fa, fb = fonte_de(c, 'SINAPI', a['id']), fonte_de(c, 'SINAPI', b['id'])
            aviso = (f"A SINAPI de {nome_mes(a)} vem {'dos relatórios da CAIXA' if fa == 'CAIXA' else 'do programa da CEHOP'} e a de {nome_mes(b)}, "
                     f"{'dos relatórios da CAIXA' if fb == 'CAIXA' else 'do programa da CEHOP'}. Parte da diferença é de método, não de preço: "
                     "a CEHOP abre as composições até os insumos e aplica os encargos sociais na composição; a CAIXA publica a mão de obra já com encargos "
                     "e mantém as composições auxiliares.")
        return {'de': a, 'para': b, 'referencias': refs, 'resumo': resumo, 'itens': [dict(x) for x in rows], 'aviso': aviso}


@app.get('/api/comparativo/item/{tipo}/{base}/{codigo}')
def api_comparativo_item(tipo: str, base: str, codigo: str):
    """Preço do item em cada mês carregado."""
    base = checar_base(base)
    with conn() as c:
        meses = set(meses_da_base(c).get(base, []))
        linhas = [dict(x) for x in c.execute('''SELECT r.id AS referencia, r.descricao, h.preco FROM referencia r
            LEFT JOIN historico h ON h.referencia = r.id AND h.tipo = ? AND h.base = ? AND h.codigo = ? ORDER BY r.id''',
                                             (tipo, base, codigo)) if x['referencia'] in meses]
        if all(x['preco'] is None for x in linhas) and not c.execute('SELECT 1 FROM item_busca WHERE tipo = ? AND base = ? AND codigo = ?',
                                                                    (tipo, base, codigo)).fetchone():
            raise HTTPException(404, f'{codigo}/{base} não existe em nenhum mês carregado.')
        info = c.execute('SELECT descricao, unidade FROM item_busca WHERE tipo = ? AND base = ? AND codigo = ? ORDER BY referencia DESC LIMIT 1',
                         (tipo, base, codigo)).fetchone()
        return {'tipo': tipo, 'base': base, 'codigo': codigo, 'descricao': info['descricao'] if info else '', 'unidade': info['unidade'] if info else '',
                'meses': linhas}


# ---------- Exportação ----------
AZUL = '1D5C8C'


def _cab(ws, linha, valores, larguras=None):
    for j, v in enumerate(valores, 1):
        cel = ws.cell(row=linha, column=j, value=v)
        cel.font = Font(bold=True, color='FFFFFF')
        cel.fill = PatternFill('solid', fgColor=AZUL)
        cel.alignment = Alignment(vertical='center', wrap_text=True)
    if larguras:
        for j, w in enumerate(larguras, 1):
            ws.column_dimensions[get_column_letter(j)].width = w


def _xlsx(wb, nome):
    buf = io.BytesIO(); wb.save(buf); buf.seek(0)
    return StreamingResponse(buf, media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                             headers={'Content-Disposition': orcamento.disposicao(nome)})


def _escrever_itens(ws, c, comp, linha, nivel, expandir):
    for i in comp['itens']:
        ws.cell(row=linha, column=1, value=('    ' * nivel) + f"{i['codigo']}/{i['base']}")
        ws.cell(row=linha, column=2, value=SECOES.get(i['secao'], i['secao']))
        ws.cell(row=linha, column=3, value=('    ' * nivel) + (i['descricao'] or ''))
        ws.cell(row=linha, column=4, value=i['unidade'])
        ws.cell(row=linha, column=5, value=i['qtd']).number_format = '0.0000000'
        ws.cell(row=linha, column=6, value=i['custo_unit']).number_format = '#,##0.00'
        ws.cell(row=linha, column=7, value=i['custo_total']).number_format = '#,##0.00'
        if nivel:
            for j in range(1, 8):
                ws.cell(row=linha, column=j).font = Font(color='5B6875', italic=True)
        linha += 1
        if expandir and i['tem_composicao'] and nivel < 4:
            sub = ler_composicao(c, i['base'], i['codigo'], comp['referencia'])
            if sub:
                linha = _escrever_itens(ws, c, sub, linha, nivel + 1, expandir)
    return linha


@app.get('/api/exportar/composicao/{base}/{codigo}.xlsx')
def exportar_composicao(base: str, codigo: str, expandir: bool = True, ref: Optional[str] = None):
    base = checar_base(base)
    with conn() as c:
        r = mes_da_base(c, base, ref)
        comp = ler_composicao(c, base, codigo, r['id'])
        if not comp:
            raise HTTPException(404, f'A composição {codigo}/{base} não existe em {nome_mes(r)}.')
        wb = Workbook(); ws = wb.active; ws.title = f"{comp['codigo']}-{base}"[:31]
        ws['A1'] = f"Composição {comp['codigo']}/{base}"; ws['A1'].font = Font(bold=True, size=14)
        ws['A2'] = comp['descricao']; ws['A2'].alignment = Alignment(wrap_text=True); ws.merge_cells('A2:G2')
        ws.row_dimensions[2].height = 32
        ws['A3'] = f"Unidade: {comp['unidade']}    Referência: {r['descricao']}    Encargo social: {comp['encargo_social'] or '-'}%"
        if comp['prod_equipe']:
            ws['A3'] = ws['A3'].value + f"    Produção da equipe: {comp['prod_equipe']}"
        _cab(ws, 5, ['Código', 'Seção', 'Descrição', 'Un.', 'Coeficiente', 'Custo unit. (R$)', 'Custo total (R$)'], [16, 18, 70, 7, 14, 16, 16])
        linha = _escrever_itens(ws, c, comp, 6, 0, expandir) + 1
        for nome, v in [('Equipamento', comp['custo_equipamento']), ('Mão de obra', comp['custo_mao_de_obra']),
                        ('Encargo social', comp['custo_encargo_social']), ('Material', comp['custo_material']),
                        ('Serviço de terceiro', comp['custo_servico_terceiro']), ('Custo total', comp['custo_total'])]:
            ws.cell(row=linha, column=6, value=nome).font = Font(bold=nome == 'Custo total')
            cel = ws.cell(row=linha, column=7, value=v); cel.number_format = '#,##0.00'; cel.font = Font(bold=nome == 'Custo total')
            linha += 1
        ws.cell(row=linha + 1, column=1, value=f"Fonte: {base}, referência {r['descricao']}. Gerado pelo InfoCustos Civil.").font = Font(color='5B6875', size=9)
        ws.freeze_panes = 'A6'
        return _xlsx(wb, f"composicao_{comp['codigo']}_{base}_{r['id']}.xlsx")


@app.get('/api/exportar/busca.xlsx')
def exportar_busca(q: str = '', base: str = 'todas', tipo: str = 'todos', ref: Optional[str] = None, refs: str = '', bases: str = ''):
    res = api_busca(q=q, base=base, tipo=tipo, limite=500, ref=ref, refs=refs, desde=0, ordem='usos', bases=bases)
    with conn() as c:
        nomes = {x['id']: nome_mes(x) for x in referencias(c)}
    datas = ', '.join(f'{b} {nomes.get(m, m)}' for b, m in res['refs'].items() if base.upper() in ('TODAS', b))
    wb = Workbook(); ws = wb.active; ws.title = 'Resultado'
    ws['A1'] = f"Busca: {q or '(todos)'}  |  Base: {base}  |  Tipo: {tipo}  |  Data-base: {datas}"
    ws['A1'].font = Font(bold=True)
    _cab(ws, 3, ['Tipo', 'Base', 'Código', 'Descrição', 'Un.', 'Preço (R$)', 'Grupo', 'Usado em'], [9, 8, 10, 80, 7, 14, 34, 10])
    for k, x in enumerate(res['itens'], 4):
        for j, v in enumerate(['Serviço' if x['tipo'] == 'servico' else 'Insumo', x['base'], x['codigo'], x['descricao'], x['unidade'],
                               x['preco'], x['grupo'], x['usos']], 1):
            cel = ws.cell(row=k, column=j, value=v)
            if j == 6:
                cel.number_format = '#,##0.00'
    ws.freeze_panes = 'A4'; ws.auto_filter.ref = f'A3:H{3 + len(res["itens"])}'
    return _xlsx(wb, f"busca_{res['referencia']}.xlsx")


import orcamento  # noqa: E402
import proprias  # noqa: E402

orcamento.configurar(conn)
app.include_router(orcamento.router)
app.include_router(proprias.router)
app.mount('/static', StaticFiles(directory=AQUI / 'static'), name='static')


@app.get('/manifest.webmanifest')
def manifesto():
    """Permite instalar o site como aplicativo no celular e no computador."""
    icone = lambda n, uso='any': {'src': f'/static/icones/icone-{n}.png', 'sizes': f'{n}x{n}', 'type': 'image/png', 'purpose': uso}
    return JSONResponse({
        'name': 'InfoCustos Civil', 'short_name': 'InfoCustos', 'lang': 'pt-BR',
        'description': 'Consulta de preços ORSE, SINAPI e SICRO, composições e orçamentos de obra.',
        'start_url': '/', 'scope': '/', 'display': 'standalone', 'background_color': '#17191C', 'theme_color': '#17191C',
        'icons': [icone(192), icone(512), {'src': '/static/icones/icone-mascara-512.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'}],
    }, media_type='application/manifest+json')


@app.get('/apresentacao')
def apresentacao():
    """Endereço curto para divulgar: abre a tela de apresentação do sistema."""
    return RedirectResponse('/#/apresentacao')


def _versao_estaticos():
    """Etiqueta que muda quando qualquer JS/CSS muda: vai no endereço dos arquivos, e o navegador baixa o novo."""
    h = hashlib.sha1()
    for f in sorted((AQUI / 'static').glob('*.[jc]s*')):
        h.update(f.name.encode()); h.update(f.read_bytes())
    return h.hexdigest()[:10]


VERSAO = _versao_estaticos()


def _com_versao(nome):
    html = (AQUI / 'static' / nome).read_text(encoding='utf-8')
    html = html.replace('__VERSAO__', VERSAO)
    return re.sub(r'(/static/[\w-]+\.(?:js|css))"', rf'\1?v={VERSAO}"', html)


INDEX_HTML = _com_versao('index.html')


@app.get('/api/versao')
def api_versao():
    """A página compara com a versão que carregou: se mudou, ela se recarrega sozinha."""
    return JSONResponse({'versao': VERSAO}, headers={'Cache-Control': 'no-store'})


@app.get('/')
def index():
    # sem cache: depois de sair (ou de a sessão vencer), o navegador não mostra a página guardada
    return HTMLResponse(INDEX_HTML, headers={'Cache-Control': 'no-cache'})
