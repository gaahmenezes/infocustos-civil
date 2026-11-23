"""Atualização das bases oficiais pela tela: enviar os relatórios de um mês, conferir e publicar.

Fluxo:
  1. "lote": a tela cria um lote (ORSE ou SINAPI) e envia os arquivos, um por pedido;
  2. "processar": em segundo plano, o servidor lê os arquivos com os mesmos leitores usados até aqui (os PDFs da
     CEHOP pelo pdfium, que dá o mesmo texto do pdftotext; a planilha da CAIXA pelo openpyxl), monta o banco do mês e
     confere: cada composição fecha com o total, o preço do serviço é o da composição, os insumos SINAPI dentro da
     ORSE batem com a SINAPI da CAIXA do mesmo mês, o mês é o mesmo em todos os relatórios...;
  3. o mês conferido fica guardado no banco dos orçamentos (tabela base_mensal), como "pendente";
  4. "publicar": a base de preços é remontada com ele (extratores/montar_base.py) e trocada sem reiniciar.
     Com bloqueio na conferência, só publica com "publicar mesmo assim".
O build da publicação (build.sh) também inclui os meses publicados, e ao iniciar o servidor remonta se faltar algum.
"""
import collections
import gzip
import json
import os
import re
import shutil
import sqlite3
import statistics
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import zipfile
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request

import banco_orc
import orcamento as orc_mod

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
EXTR = os.path.join(RAIZ, 'extratores')
if EXTR not in sys.path:
    sys.path.insert(0, EXTR)

router = APIRouter(prefix='/api/bases-oficiais')
MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
PAPEIS = {'ORSE': ('composicoes', 'insumos', 'servicos'), 'SINAPI': ('caixa',)}
UF = 'SE'

# ligações com o servidor (definidas por server.py): banco atual e troca do banco no ar
banco_atual = lambda: None  # noqa: E731
trocar = None

LOTES = {}
TAREFA = {'estado': 'livre', 'etapa': '', 'pct': 0, 'lote': None, 'envio': None, 'erro': '', 'inicio': None, 'log': []}
_TRAVA = threading.Lock()
PASTA = os.path.join(tempfile.gettempdir(), 'infocustos_bases')


def agora():
    return datetime.now().isoformat(timespec='seconds')


def orc():
    return orc_mod.orc()


def _etapa(texto, pct=None):
    TAREFA['etapa'] = texto
    if pct is not None:
        TAREFA['pct'] = max(0, min(100, round(pct)))
    TAREFA['log'].append(f'{time.strftime("%H:%M:%S")} {texto}')
    TAREFA['log'] = TAREFA['log'][-40:]


def _rodar(args, **kw):
    r = subprocess.run([sys.executable] + args, capture_output=True, text=True, **kw)
    if r.returncode:
        raise RuntimeError((r.stderr or r.stdout or '').strip().splitlines()[-1] if (r.stderr or r.stdout) else 'falhou')
    return r.stdout


def nome_mes(ref, sufixo=''):
    a, m = ref.split('-')
    return f'{MESES[int(m) - 1]}/{a}{sufixo}'


# ---------- lotes e arquivos ----------
@router.post('/lote')
def novo_lote(dados: dict):
    base = str(dados.get('base', '')).upper()
    if base not in PAPEIS:
        raise HTTPException(422, 'Base desconhecida: use ORSE ou SINAPI.')
    lid = str(int(time.time() * 1000))
    pasta = os.path.join(PASTA, lid)
    os.makedirs(pasta, exist_ok=True)
    LOTES[lid] = {'id': lid, 'base': base, 'pasta': pasta, 'arquivos': {p: [] for p in PAPEIS[base]}}
    return LOTES[lid] | {'pasta': None}


@router.post('/lote/{lid}/arquivo')
async def enviar_arquivo(lid: str, papel: str, request: Request):
    lote = LOTES.get(lid)
    if not lote:
        raise HTTPException(404, 'Envio não encontrado (o servidor pode ter reiniciado): comece de novo.')
    if papel not in lote['arquivos']:
        raise HTTPException(422, 'Tipo de arquivo desconhecido.')
    from urllib.parse import unquote
    nome = re.sub(r'[^\w.\- ]', '_', unquote(request.headers.get('X-Nome-Arquivo', 'arquivo')))[:120] or 'arquivo'
    dados = await request.body()
    if not dados:
        raise HTTPException(422, 'Arquivo vazio.')
    if papel != 'caixa' and not dados.startswith(b'%PDF'):
        raise HTTPException(422, f'{nome} não é um PDF. Envie o relatório em PDF tirado do programa ORSE.')
    if papel == 'caixa' and not dados.startswith(b'PK'):
        raise HTTPException(422, f'{nome} não é o zip nem a planilha (xlsx) da CAIXA.')
    destino = os.path.join(lote['pasta'], f'{papel}_{len(lote["arquivos"][papel])}_{nome}')
    with open(destino, 'wb') as f:
        f.write(dados)
    lote['arquivos'][papel].append({'nome': nome, 'caminho': destino, 'tamanho': len(dados)})
    return {'papel': papel, 'arquivos': [{'nome': a['nome'], 'tamanho': a['tamanho']} for a in lote['arquivos'][papel]]}


@router.post('/lote/{lid}/processar')
def processar(lid: str):
    lote = LOTES.get(lid)
    if not lote:
        raise HTTPException(404, 'Envio não encontrado (o servidor pode ter reiniciado): comece de novo.')
    faltam = [p for p, l in lote['arquivos'].items() if not l]
    if faltam:
        nomes = {'composicoes': 'Relatório de Composições', 'insumos': 'Relatório de Insumos', 'servicos': 'Relatório de Serviços',
                 'caixa': 'zip ou planilha da CAIXA'}
        raise HTTPException(422, 'Falta: ' + ', '.join(nomes[p] for p in faltam) + '.')
    _comecar(lote['base'], lambda: (_processar_orse if lote['base'] == 'ORSE' else _processar_sinapi)(lote), lid)
    return TAREFA


def _comecar(nome, fn, lid=None):
    with _TRAVA:
        if TAREFA['estado'] == 'rodando':
            raise HTTPException(409, 'Já há uma conferência ou publicação em andamento. Espere terminar.')
        TAREFA.update(estado='rodando', etapa='Começando', pct=0, lote=lid, envio=None, erro='', inicio=time.time(), log=[], base=nome)

    def rodar():
        try:
            fn()
            TAREFA['estado'] = 'pronto'; TAREFA['pct'] = 100
        except Exception as e:  # o erro vai para a tela
            traceback.print_exc()
            TAREFA['estado'] = 'erro'; TAREFA['erro'] = str(e) or e.__class__.__name__
        finally:
            if lid and lid in LOTES:
                shutil.rmtree(LOTES[lid]['pasta'], ignore_errors=True); LOTES.pop(lid, None)
    threading.Thread(target=rodar, daemon=True).start()


@router.get('/tarefa')
def tarefa():
    return TAREFA | {'duracao': round(time.time() - TAREFA['inicio']) if TAREFA.get('inicio') else 0}


# ---------- ORSE: relatórios do programa da CEHOP ----------
RE_REF = re.compile(r'Ref\s*:\s*([a-zç]+)/(\d{4})(-\d+)?', re.I)


def _ref_do_texto(texto):
    m = RE_REF.search(texto or '')
    if not m:
        return None, None
    mes = m.group(1).lower()
    if mes not in MESES:
        return None, None
    return f'{m.group(2)}-{MESES.index(mes) + 1:02d}', f'{mes}/{m.group(2)}{m.group(3) or ""}'


def _processar_orse(lote):
    import texto_pdf
    T = lote['pasta']
    d, s = os.path.join(T, 'd'), os.path.join(T, 's')
    os.makedirs(d, exist_ok=True); os.makedirs(s, exist_ok=True)
    comps = lote['arquivos']['composicoes']
    import pypdfium2 as pdfium
    total_pag = 0
    for a in comps:
        p = pdfium.PdfDocument(a['caminho']); total_pag += len(p); p.close()
    feitas, ref, desc = 0, None, None
    txt = os.path.join(T, 'comp.txt')
    with open(txt, 'w', encoding='utf-8') as f:
        for a in comps:
            for pg in texto_pdf.paginas(a['caminho']):
                if ref is None:
                    ref, desc = _ref_do_texto(pg)
                f.write(pg); feitas += 1
                if feitas % 50 == 0:
                    _etapa(f'Lendo as composições: página {feitas} de {total_pag}', 5 + 55 * feitas / max(total_pag, 1))
    if not ref:
        raise RuntimeError('Não achei o mês ("Ref : agosto/2026") no relatório de composições. É o relatório de composições da ORSE?')
    _etapa(f'Separando as composições de {desc}', 62)
    saida = _rodar([os.path.join(EXTR, 'parse_composicoes.py'), txt, os.path.join(s, 'comp_raw.json'), 'ORSE'])
    os.remove(txt)
    resumo_leitura = (saida.strip().splitlines() or [''])[0]
    refs = {'composicoes': ref}
    for papel, nome in (('insumos', 'orse_insumos'), ('servicos', 'orse_servicos')):
        _etapa(f'Lendo o relatório de {"insumos" if papel == "insumos" else "serviços"}', 66 if papel == 'insumos' else 74)
        raw = os.path.join(T, f'{papel}_raw.json')
        _rodar([os.path.join(EXTR, 'parse_insumos.py'), lote['arquivos'][papel][0]['caminho'], raw])
        refs[papel] = _ref_do_texto('Ref : ' + (json.load(open(raw)).get('ref') or ''))[0]
        _rodar([os.path.join(EXTR, f'build_{papel}.py'), raw, os.path.join(d, f'{nome}_{ref}')])
    for f in (f'sinapi_insumos_{ref}.json', f'sinapi_servicos_{ref}.json'):
        open(os.path.join(d, f), 'w').write('[]')
    open(os.path.join(s, 'comp_sinapi_raw.json'), 'w').write('[]')
    cr = json.load(open(os.path.join(s, 'comp_raw.json')))
    es = collections.Counter(c['encargo_social'] for c in cr if c.get('encargo_social')).most_common(1)
    _etapa('Montando o banco do mês', 80)
    env = dict(os.environ, DADOS=d, S=s, REF=ref, REF_DESCRICAO=desc, ENCARGO_HORISTA=str(es[0][0] if es else 111.51), SEM_PLANILHA='1')
    _rodar([os.path.join(EXTR, 'build_db.py')], env=env)
    novo = os.path.join(d, f'orse_sinapi_{ref}.sqlite')
    srv_report = {x['codigo']: x['preco'] for x in json.load(open(os.path.join(d, f'orse_servicos_{ref}.json')))}
    anterior = _mes_atual_minimo(ref, T)
    _rodar([os.path.join(EXTR, 'orse_mes_sem_sinapi.py'), novo, os.path.join(s, 'comp_raw.json')] + ([anterior] if anterior else []))
    _etapa('Conferindo', 90)
    rel = conferir_orse(novo, ref, desc, refs, srv_report, resumo_leitura)
    _guardar('ORSE', ref, desc, novo, rel)


def _mes_atual_minimo(ref, pasta):
    """Do banco no ar, o mês da ORSE que vai ser revisado (encargos, serviços): base para manter o que o relatório não traz."""
    atual = banco_atual()
    if not atual or not os.path.exists(atual):
        return None
    c = sqlite3.connect(atual)
    try:
        ok = c.execute("SELECT 1 FROM servico WHERE base = 'ORSE' AND referencia = ? LIMIT 1", (ref,)).fetchone()
        # sem o mês: o mais recente antes dele (encargo social de mensalistas)
        r = ref if ok else (c.execute("SELECT MAX(referencia) FROM servico WHERE base = 'ORSE' AND referencia < ?", (ref,)).fetchone() or [None])[0]
        if not r:
            return None
        destino = os.path.join(pasta, 'anterior.sqlite')
        n = sqlite3.connect(destino)
        n.execute('CREATE TABLE referencia (id TEXT PRIMARY KEY, descricao TEXT, encargo_social_horista REAL, encargo_social_mensalista REAL)')
        linha = c.execute('SELECT id, descricao, encargo_social_horista, encargo_social_mensalista FROM referencia WHERE id = ?', (r,)).fetchone()
        if linha:
            n.execute('INSERT INTO referencia VALUES (?,?,?,?)', (ref,) + tuple(linha[1:]))
        n.execute('CREATE TABLE servico (base TEXT, codigo TEXT, referencia TEXT, descricao TEXT, unidade TEXT, preco REAL, tipo TEXT, grupo TEXT, subgrupo TEXT)')
        n.executemany('INSERT INTO servico VALUES (?,?,?,?,?,?,?,?,?)', c.execute("SELECT * FROM servico WHERE base = 'ORSE' AND referencia = ?", (r,)).fetchall())
        if ok and c.execute("SELECT 1 FROM sqlite_master WHERE name = 'encargo'").fetchone():
            n.execute('CREATE TABLE encargo (referencia TEXT, tipo TEXT, grupo TEXT, item TEXT, descricao TEXT, valor REAL, PRIMARY KEY (referencia, tipo, item))')
            n.executemany('INSERT INTO encargo VALUES (?,?,?,?,?,?)', c.execute('SELECT * FROM encargo WHERE referencia = ?', (ref,)).fetchall())
        n.commit(); n.close()
        return destino
    finally:
        c.close()


def _sinapi_do_mes(ref):
    """Preços da SINAPI (CAIXA) do mês, para conferir os insumos SINAPI dentro da ORSE: a enviada mais recente ou a do ar."""
    with orc() as c:
        r = c.execute("""SELECT arquivo FROM base_mensal WHERE base = 'SINAPI' AND referencia = ? AND status IN ('pendente', 'publicado')
            ORDER BY id DESC LIMIT 1""", (ref,)).fetchone()
    precos = {}
    if r and r['arquivo']:
        with tempfile.NamedTemporaryFile(suffix='.sqlite', delete=False) as f:
            f.write(gzip.decompress(bytes(r['arquivo']))); caminho = f.name
        try:
            k = sqlite3.connect(caminho)
            precos = dict(k.execute("SELECT codigo, preco FROM insumo WHERE base = 'SINAPI' AND referencia = ?", (ref,)).fetchall()); k.close()
        finally:
            os.remove(caminho)
        return precos, 'enviada pela tela'
    atual = banco_atual()
    if atual and os.path.exists(atual):
        k = sqlite3.connect(atual)
        precos = dict(k.execute("SELECT codigo, preco FROM insumo WHERE base = 'SINAPI' AND referencia = ? AND marcador IN ('C', 'CR', 'AS')", (ref,)).fetchall())
        k.close()
    return precos, 'publicada'


def n(x):
    """Número com ponto de milhar, como na tela (9.941)."""
    return f'{x:,}'.replace(',', '.')


def _check(nivel, titulo, detalhe='', exemplos=None):
    return {'nivel': nivel, 'titulo': titulo, 'detalhe': detalhe, 'exemplos': exemplos or []}


def conferir_orse(caminho, ref, desc, refs, srv_report, resumo_leitura):
    """Conferência do mês da ORSE, por consultas no banco do mês (sem carregar os 270 mil itens na memória)."""
    c = sqlite3.connect(caminho); c.row_factory = sqlite3.Row
    comps = {r['codigo']: (r['custo_total'] or 0) for r in c.execute("SELECT codigo, custo_total FROM composicao WHERE base = 'ORSE'")}
    checks = []
    # o mês é o mesmo nos três relatórios
    if len(set(refs.values())) > 1:
        checks.append(_check('bloqueio', 'Os relatórios são de meses diferentes',
                             ', '.join(f'{k}: {nome_mes(v) if v else "sem mês"}' for k, v in refs.items())))
    else:
        checks.append(_check('ok', f'Os três relatórios são de {desc}'))
    # cada composição fecha: grupos = total; nas analíticas, soma dos itens = total
    resumo_ruim = [r[0] for r in c.execute("""SELECT codigo FROM composicao WHERE base = 'ORSE' AND abs(custo_equipamento + custo_mao_de_obra
        + custo_encargo_social + custo_material + custo_servico_terceiro - custo_total) > 0.02""")]
    nao_fecha = [f'{r[0]}: itens somam {r[1]:.2f}, total {r[2]:.2f}' for r in c.execute("""SELECT p.codigo, COALESCE(SUM(i.custo_total), 0) s, p.custo_total
        FROM composicao p LEFT JOIN composicao_item i ON i.composicao_base = p.base AND i.composicao = p.codigo AND i.referencia = p.referencia
        WHERE p.base = 'ORSE' AND p.modelo = 'ANALITICA' GROUP BY p.codigo, p.custo_total
        HAVING abs(s - p.custo_total) > max(0.05, p.custo_total * 0.001)""")]
    if nao_fecha or resumo_ruim:
        checks.append(_check('bloqueio', f'{len(nao_fecha) + len(resumo_ruim)} composições não fecham com o total',
                             'A leitura do relatório pode ter falhado nessas composições.', nao_fecha[:8] + resumo_ruim[:8]))
    else:
        checks.append(_check('ok', f'{n(len(comps))} composições lidas, todas fechando com o total'))
    # preço do serviço = custo da composição
    dif = [f'{k}: serviço {v:.2f}, composição {comps[k]:.2f}' for k, v in srv_report.items()
           if k in comps and v is not None and abs(v - comps[k]) > 0.005]
    sem_srv = sorted(k for k in comps if k not in srv_report)
    if dif:
        checks.append(_check('alerta', f'{len(dif)} serviços com preço diferente da composição', 'Vale o custo da composição.', dif[:8]))
    else:
        checks.append(_check('ok', f'{n(len(srv_report))} serviços, com o preço igual ao custo da composição'))
    if sem_srv:
        checks.append(_check('alerta', f'{len(sem_srv)} composições não estão no relatório de serviços',
                             'Ficam na busca com a descrição e o grupo do mês anterior (ou do relatório de composições).', sem_srv[:12]))
    # insumos ORSE: preço na lista x nas composições (na mão de obra, sem o encargo social)
    lista = {r[0]: r[1] for r in c.execute("SELECT codigo, preco FROM insumo WHERE base = 'ORSE'")}
    vistos = collections.defaultdict(collections.Counter)
    for cod, sec, cu, es in c.execute("""SELECT i.codigo, i.secao, i.custo_unit, p.encargo_social FROM composicao_item i
            JOIN composicao p ON p.base = i.composicao_base AND p.codigo = i.composicao AND p.referencia = i.referencia
            WHERE i.composicao_base = 'ORSE' AND i.base = 'ORSE' AND i.eh_servico = 0 AND i.custo_unit IS NOT NULL"""):
        vistos[cod][round(cu / (1 + (es or 0) / 100), 2) if sec == 'MAO_DE_OBRA' else cu] += 1
    dif_ins = [f'{k}: lista {lista[k]:.2f}, composições {v.most_common(1)[0][0]:.2f}' for k, v in vistos.items()
               if lista.get(k) is not None and abs(lista[k] - v.most_common(1)[0][0]) > 0.005]
    vistos = None
    if len(dif_ins) > max(5, len(lista) * 0.01):
        checks.append(_check('alerta', f'{len(dif_ins)} insumos com preço na lista diferente do usado nas composições',
                             'O relatório de insumos pode ser de antes de uma revisão da CEHOP.', dif_ins[:8]))
    else:
        checks.append(_check('ok', f'{n(len(lista))} insumos; o preço da lista é o das composições' + (f' (exceto {len(dif_ins)})' if dif_ins else '')))
    # insumos SINAPI dentro da ORSE x SINAPI da CAIXA do mesmo mês (o caso de agosto/2026)
    caixa, origem = _sinapi_do_mes(ref)
    usados = c.execute("""SELECT COUNT(*) FROM composicao_item WHERE composicao_base = 'ORSE' AND base = 'SINAPI' AND eh_servico = 0
        AND custo_unit IS NOT NULL""").fetchone()[0]
    if not caixa:
        checks.append(_check('alerta', f'A SINAPI de {nome_mes(ref)} (CAIXA) não está carregada',
                             'Não deu para conferir os insumos SINAPI usados nas composições. Envie a SINAPI do mês antes, se puder.'))
    elif usados:
        dif_s, exemplos = 0, {}
        for cod, desc_i, sec, cu in c.execute("""SELECT codigo, descricao, secao, custo_unit FROM composicao_item WHERE composicao_base = 'ORSE'
                AND base = 'SINAPI' AND eh_servico = 0 AND custo_unit IS NOT NULL"""):
            p = caixa.get(cod)
            if p is not None and abs(cu - p) > (0.025 if sec == 'MAO_DE_OBRA' else 0.011):
                dif_s += 1
                exemplos.setdefault(cod, f'{cod} {(desc_i or "")[:50]}: ORSE {cu:.2f}, CAIXA {p:.2f}')
        pct = dif_s / usados
        if pct > 0.02:
            checks.append(_check('bloqueio', f'Insumos SINAPI dentro da ORSE diferentes da SINAPI da CAIXA ({pct:.0%} dos itens)',
                                 f'{n(dif_s)} de {n(usados)} itens. O programa da CEHOP pode estar com a tabela SINAPI desatualizada: '
                                 'atualize o programa e tire os relatórios de novo.', list(exemplos.values())[:8]))
        elif dif_s:
            checks.append(_check('alerta', f'{dif_s} itens SINAPI dentro da ORSE com preço diferente da CAIXA',
                                 f'De {n(usados)} itens (SINAPI {origem}). Fica como a CEHOP publicou.', list(exemplos.values())[:8]))
        else:
            checks.append(_check('ok', f'Os {n(usados)} itens SINAPI dentro da ORSE batem com a SINAPI da CAIXA'))
    c.close()
    return {'base': 'ORSE', 'referencia': ref, 'descricao': desc, 'checks': checks, 'comparacao': _comparar('ORSE', ref, comps),
            'numeros': {'composicoes': len(comps), 'insumos': len(lista), 'servicos': len(srv_report)}}


def _comparar(base, ref, novos):
    """Diferença para o mesmo mês no ar (revisão) ou para o mês anterior da base."""
    atual = banco_atual()
    if not atual or not os.path.exists(atual):
        return None
    c = sqlite3.connect(atual)
    try:
        mesmo = c.execute('SELECT 1 FROM composicao WHERE base = ? AND referencia = ? LIMIT 1', (base, ref)).fetchone()
        r = ref if mesmo else (c.execute('SELECT MAX(referencia) FROM composicao WHERE base = ? AND referencia < ?', (base, ref)).fetchone() or [None])[0]
        if not r:
            return {'tipo': 'novo', 'contra': None}
        velhos = dict(c.execute('SELECT codigo, custo_total FROM composicao WHERE base = ? AND referencia = ?', (base, r)).fetchall())
    finally:
        c.close()
    var = [(k, velhos[k], v, v / velhos[k] - 1) for k, v in novos.items() if k in velhos and velhos[k] and v is not None]
    mudaram = [x for x in var if abs(x[2] - x[1]) > 0.005]
    maiores = sorted(mudaram, key=lambda x: -abs(x[3]))[:8]
    return {'tipo': 'revisao' if mesmo else 'mes_novo', 'contra': r, 'contra_nome': nome_mes(r),
            'mudaram': len(mudaram), 'novas': len([k for k in novos if k not in velhos]), 'retiradas': len([k for k in velhos if k not in novos]),
            'mediana': statistics.median([x[3] for x in var]) if var else None,
            'maiores': [{'codigo': k, 'antes': a, 'depois': d, 'variacao': v} for k, a, d, v in maiores]}


# ---------- SINAPI: planilha da CAIXA ----------
def _processar_sinapi(lote):
    import build_sinapi_caixa_xlsx as xl
    a = lote['arquivos']['caixa'][0]['caminho']
    xlsx = a
    if zipfile.is_zipfile(a) and not a.lower().endswith('.xlsx'):
        with zipfile.ZipFile(a) as z:
            nomes = [n for n in z.namelist() if re.search(r'SINAPI_Refer.*\.xlsx$', n, re.I) or re.search(r'Refer[eê]ncia.*\.xlsx$', n, re.I)]
            if not nomes:
                raise RuntimeError('O zip não tem a planilha SINAPI_Referência_AAAA_MM.xlsx. Envie o zip "formato xlsx" da CAIXA.')
            xlsx = z.extract(nomes[0], lote['pasta'])
    _etapa('Lendo a planilha da CAIXA', 20)
    try:
        insumos, sp, classe, (enc_h, enc_m), (mes, ano), local, custos, comps = xl.ler(xlsx, UF)
    except KeyError as e:
        raise RuntimeError(f'A planilha não tem a aba {e}. É a SINAPI_Referência da CAIXA?')
    ref = f'{ano}-{mes:02d}'
    _etapa(f'Montando a SINAPI de {nome_mes(ref)} ({local}) e conferindo', 55)
    destino = os.path.join(lote['pasta'], f'sinapi_{ref}.sqlite')
    import build_sinapi_caixa as caixa
    r = caixa.montar(insumos, enc_h, enc_m, mes, ano, local, sp, custos, comps, UF, destino, banco_atual())
    checks = [_check('ok', f'SINAPI de {nome_mes(ref)}, {local}/{UF}, sem desoneração',
                     f'Encargo social: horista {enc_h}%, mensalista {enc_m}%.')]
    div = r['divergem']
    if r['conferidas'] and len(div) > r['conferidas'] * 0.01:
        checks.append(_check('bloqueio', f'{len(div)} composições com a soma dos itens diferente do custo da CAIXA',
                             f'De {n(r["conferidas"])} conferidas.', [f'{x[0]}: itens {x[1]}, CAIXA {x[2]}' for x in div[:8]]))
    else:
        checks.append(_check('ok' if not div else 'alerta', f'{n(r["conferidas"])} composições conferidas com o custo da CAIXA' +
                             (f'; {len(div)} com diferença de centavos' if div else ''), '', [f'{x[0]}: itens {x[1]}, CAIXA {x[2]}' for x in div[:8]]))
    checks.append(_check('ok', f'{n(r["insumos"])} insumos' +
                         (f'; {n(r["atribuidos_sp"])} sem coleta em {UF} recebem o preço de São Paulo, como a CAIXA faz' if r['atribuidos_sp'] else '')))
    k = sqlite3.connect(destino)
    novos = dict(k.execute("SELECT codigo, custo_total FROM composicao WHERE base = 'SINAPI'").fetchall()); k.close()
    rel = {'base': 'SINAPI', 'referencia': ref, 'descricao': nome_mes(ref), 'checks': checks, 'comparacao': _comparar('SINAPI', ref, novos),
           'numeros': {'composicoes': r['composicoes'], 'insumos': r['insumos']}}
    _guardar('SINAPI', ref, nome_mes(ref), destino, rel)


def _guardar(base, ref, desc, caminho, rel):
    _etapa('Guardando o mês conferido', 96)
    with open(caminho, 'rb') as f:
        gz = gzip.compress(f.read(), 6)
    rel['bloqueado'] = any(x['nivel'] == 'bloqueio' for x in rel['checks'])
    rel['tamanho'] = len(gz)
    with orc() as c:
        cur = c.execute('INSERT INTO base_mensal (base, referencia, descricao, arquivo, relatorio, status, criado_em) VALUES (?,?,?,?,?,?,?)',
                        (base, ref, desc, gz, json.dumps(rel, ensure_ascii=False), 'pendente', agora()))
        TAREFA['envio'] = cur.lastrowid
    _etapa('Conferência pronta' + (' — com bloqueio' if rel['bloqueado'] else ''), 100)


# ---------- envios: listar, ver, publicar, descartar, desfazer ----------
def _resumo(r):
    rel = json.loads(r['relatorio'] or '{}')
    return {'id': r['id'], 'base': r['base'], 'referencia': r['referencia'], 'descricao': (r['descricao'] or '').removesuffix('-1'),
            'status': r['status'], 'criado_em': r['criado_em'], 'publicado_em': r['publicado_em'], 'bloqueado': rel.get('bloqueado', False),
            'checks': rel.get('checks', []), 'comparacao': rel.get('comparacao'), 'numeros': rel.get('numeros', {})}


@router.get('')
def listar():
    with orc() as c:
        envios = [_resumo(r) for r in c.execute('''SELECT id, base, referencia, descricao, relatorio, status, criado_em, publicado_em
            FROM base_mensal WHERE status != 'descartado' ORDER BY id DESC LIMIT 40''').fetchall()]
    no_ar = {}
    atual = banco_atual()
    if atual and os.path.exists(atual):
        k = sqlite3.connect(atual)
        for b, r in k.execute('SELECT DISTINCT base, referencia FROM servico ORDER BY base, referencia'):
            no_ar.setdefault(b, []).append(r)
        try:
            incl = {x[0] for x in k.execute('SELECT envio FROM publicacao')}
        except sqlite3.OperationalError:
            incl = set()
        k.close()
    else:
        incl = set()
    for e in envios:
        e['no_ar'] = e['id'] in incl
    return {'no_ar': no_ar, 'envios': envios, 'tarefa': tarefa()}


def _envio(c, eid):
    r = c.execute('SELECT id, base, referencia, descricao, relatorio, status, criado_em, publicado_em FROM base_mensal WHERE id = ?', (eid,)).fetchone()
    if not r:
        raise HTTPException(404, 'Envio não encontrado.')
    return r


@router.post('/envios/{eid}/publicar')
def publicar(eid: int, forcar: bool = False):
    with orc() as c:
        r = _envio(c, eid)
        if r['status'] != 'pendente':
            raise HTTPException(409, 'Este envio não está aguardando publicação.')
        if json.loads(r['relatorio'] or '{}').get('bloqueado') and not forcar:
            raise HTTPException(409, 'A conferência encontrou bloqueio. Confira o relatório; para publicar assim mesmo, marque "publicar mesmo assim".')
        if TAREFA['estado'] == 'rodando':
            raise HTTPException(409, 'Já há uma conferência ou publicação em andamento. Espere terminar.')
        c.execute("UPDATE base_mensal SET status = 'substituido' WHERE base = ? AND referencia = ? AND status = 'publicado'", (r['base'], r['referencia']))
        c.execute("UPDATE base_mensal SET status = 'publicado', publicado_em = ? WHERE id = ?", (agora(), eid))
    _comecar('publicar', lambda: remontar(f'Publicando {r["base"]} de {(r["descricao"] or "").removesuffix("-1")}'))
    return TAREFA


@router.post('/envios/{eid}/descartar')
def descartar(eid: int):
    with orc() as c:
        r = _envio(c, eid)
        if r['status'] != 'pendente':
            raise HTTPException(409, 'Só um envio que aguarda publicação pode ser descartado.')
        c.execute("UPDATE base_mensal SET status = 'descartado', arquivo = NULL WHERE id = ?", (eid,))
    return {'ok': True}


@router.post('/envios/{eid}/desfazer')
def desfazer(eid: int):
    """Tira do ar um mês publicado pela tela: volta o envio anterior do mesmo mês, ou o do repositório."""
    with orc() as c:
        r = _envio(c, eid)
        if r['status'] != 'publicado':
            raise HTTPException(409, 'Este envio não está publicado.')
        if TAREFA['estado'] == 'rodando':
            raise HTTPException(409, 'Já há uma conferência ou publicação em andamento. Espere terminar.')
        c.execute("UPDATE base_mensal SET status = 'retirado' WHERE id = ?", (eid,))
        ant = c.execute("""SELECT id FROM base_mensal WHERE base = ? AND referencia = ? AND status = 'substituido' AND id < ?
            ORDER BY id DESC LIMIT 1""", (r['base'], r['referencia'], eid)).fetchone()
        if ant:
            c.execute("UPDATE base_mensal SET status = 'publicado' WHERE id = ?", (ant['id'],))
    _comecar('desfazer', lambda: remontar(f'Tirando do ar {r["base"]} de {(r["descricao"] or "").removesuffix("-1")}'))
    return TAREFA


# ---------- remontar a base e trocar no ar ----------
def remontar(titulo='Remontando a base de preços'):
    import montar_base
    _etapa(titulo, 10)
    atual = banco_atual()
    pasta = os.path.dirname(atual) if atual else os.path.join(RAIZ, 'dados')
    destino = os.path.join(pasta, f'orse_sinapi_ar_{int(time.time())}.sqlite')
    passos = {'juntando': 30, 'criando': 70}
    montar_base.montar(destino, envios=montar_base.envios_publicados(),
                       log=lambda t: _etapa(t[:1].upper() + t[1:], next((v for k, v in passos.items() if t.startswith(k)), None)))
    _etapa('Trocando a base no ar', 95)
    trocar(destino)
    # bancos montados antes pela tela, que já não estão em uso
    for f in os.listdir(pasta):
        if f.startswith('orse_sinapi_ar_') and os.path.join(pasta, f) != destino:
            try:
                os.remove(os.path.join(pasta, f))
            except OSError:
                pass
    _etapa('Pronto: a consulta e os orçamentos já usam a base atualizada', 100)


def sincronizar_no_inicio():
    """Ao iniciar: se o banco no ar não tem os meses publicados pela tela (publicados depois do último build), remonta."""
    def rodar():
        try:
            with orc() as c:
                publicados = {r['id'] for r in c.execute("SELECT id FROM base_mensal WHERE status = 'publicado'").fetchall()}
            atual = banco_atual()
            k = sqlite3.connect(atual)
            try:
                incl = {x[0] for x in k.execute('SELECT envio FROM publicacao')}
            except sqlite3.OperationalError:
                incl = set()
            k.close()
            if publicados != incl:
                print('bases oficiais: o banco no ar não tem os meses publicados pela tela; remontando')
                _comecar('sincronizar', lambda: remontar('Atualizando a base com os meses publicados'))
        except Exception as e:
            print('bases oficiais: não deu para conferir os meses publicados:', e)
    threading.Thread(target=rodar, daemon=True).start()
