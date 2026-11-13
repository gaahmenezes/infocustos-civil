"""Importação de insumos, composições e orçamentos de outros sistemas (SIENGE, planilhas próprias, PDF de relatório).

Duas etapas:
1. `POST /api/importar/ler`: recebe o arquivo (XLSX, XLSM, CSV, TXT ou PDF) e devolve as linhas de cada folha, com um
   palpite de qual linha é o cabeçalho e de qual coluna é o código, a descrição, a unidade, o preço...
2. `POST /api/importar/{insumos|composicoes|orcamento}`: recebe as linhas e a correspondência das colunas escolhida
   na tela, e grava numa base própria (existente ou nova). Com `simular`, só conta o que seria feito.

Os itens importados guardam o código que tinham no sistema de origem (`codigo_origem`). É por ele que o orçamento
importado encontra as composições e os insumos da base, e que uma segunda importação atualiza em vez de duplicar.
"""
import csv
import io
import re
import unicodedata
from typing import Literal, Optional
from urllib.parse import unquote

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import orcamento as orc_mod
import proprias

router = APIRouter(prefix='/api/importar')
LIMITE_BYTES = 25 * 1024 * 1024
LIMITE_LINHAS = 40000
LIMITE_COLUNAS = 40


# ---------- leitura do arquivo ----------
def _celula(v):
    if v is None:
        return ''
    if isinstance(v, float) and v.is_integer() and abs(v) < 1e15:
        return int(v)
    if isinstance(v, (int, float)):
        return v
    return str(v).strip()


def _aparar(linhas):
    """Tira colunas vazias do fim e linhas totalmente vazias."""
    out = []
    for ln in linhas:
        ln = [_celula(v) for v in ln][:LIMITE_COLUNAS]
        while ln and ln[-1] == '':
            ln.pop()
        if any(v != '' for v in ln):
            out.append(ln)
        if len(out) >= LIMITE_LINHAS:
            break
    return out


def ler_xlsx(dados):
    from openpyxl import load_workbook
    wb = load_workbook(io.BytesIO(dados), read_only=True, data_only=True)
    folhas = []
    for ws in wb.worksheets:
        linhas = _aparar(ws.iter_rows(values_only=True))
        if linhas:
            folhas.append({'nome': ws.title, 'linhas': linhas})
    return folhas


def ler_csv(dados):
    for cod in ('utf-8-sig', 'cp1252', 'latin-1'):
        try:
            texto = dados.decode(cod)
            break
        except UnicodeDecodeError:
            continue
    amostra = texto[:20000]
    sep = max([';', '\t', ',', '|'], key=lambda s: amostra.count(s))
    return [{'nome': 'Planilha', 'linhas': _aparar(csv.reader(io.StringIO(texto), delimiter=sep))}]


def _linhas_por_posicao(paginas):
    """Tabela a partir da posição das palavras: palavras próximas formam uma célula; o início de cada célula é
    encaixado na coluna mais próxima, achada pelos inícios que se repetem em muitas linhas (alinhamento do relatório)."""
    linhas = []
    for palavras in paginas:
        palavras = sorted(palavras, key=lambda w: (round(w['top']), w['x0']))
        atual, topo = [], None
        for w in palavras:
            if topo is None or abs(w['top'] - topo) > 3:
                if atual:
                    linhas.append(atual)
                atual, topo = [], w['top']
            atual.append(w)
        if atual:
            linhas.append(atual)
    celulas = []
    for ln in linhas:
        ln.sort(key=lambda w: w['x0'])
        cs, ult = [], None
        for w in ln:
            altura = max(w['bottom'] - w['top'], 6)
            if ult and w['x0'] - ult['x1'] < altura * 0.9:  # mesma célula: espaço de uma palavra
                cs[-1]['t'] += ' ' + w['text']; cs[-1]['x1'] = w['x1']
            else:
                cs.append({'t': w['text'], 'x0': w['x0'], 'x1': w['x1']})
            ult = w
        celulas.append(cs)
    # colunas: faixas horizontais formadas pela união das células que se sobrepõem (vale para texto alinhado à esquerda
    # e números alinhados à direita). Linhas com uma ou duas células (títulos, rodapés) não entram na conta.
    faixas = []
    for c in sorted((c for cs in celulas if len(cs) >= 3 for c in cs), key=lambda c: c['x0']):
        if faixas and c['x0'] < faixas[-1][1] - 1:
            faixas[-1][1] = max(faixas[-1][1], c['x1'])
        else:
            faixas.append([c['x0'], c['x1']])
    if not faixas:
        return [[c['t'] for c in cs] for cs in celulas]
    out = []
    for cs in celulas:
        ln = [''] * len(faixas)
        for c in cs:
            sob = [min(c['x1'], f1) - max(c['x0'], f0) for f0, f1 in faixas]
            j = max(range(len(faixas)), key=lambda k: (sob[k], -abs(faixas[k][0] - c['x0'])))
            ln[j] = (ln[j] + ' ' + c['t']).strip()
        out.append(ln)
    return out


def ler_pdf(dados):
    """Tabelas do PDF. Primeiro as tabelas desenhadas (com linhas); sem elas, as colunas pela posição das palavras."""
    import pdfplumber
    tabelas, paginas = [], []
    with pdfplumber.open(io.BytesIO(dados)) as pdf:
        if len(pdf.pages) > 400:
            raise HTTPException(413, 'PDF com mais de 400 páginas. Exporte o relatório em Excel ou divida o arquivo.')
        for pg in pdf.pages:
            for t in pg.extract_tables() or []:
                tabelas.extend(t)
            paginas.append(pg.extract_words(keep_blank_chars=False, use_text_flow=False))
    folhas = []
    if sum(1 for t in tabelas if t and len(t) >= 3) >= 5:
        folhas.append({'nome': 'Tabelas do PDF', 'linhas': _aparar([[(c or '').replace('\n', ' ') for c in ln] for ln in tabelas])})
    folhas.append({'nome': 'Texto do PDF (colunas pela posição)', 'linhas': _aparar(_linhas_por_posicao(paginas))})
    return folhas


def normal(t):
    t = unicodedata.normalize('NFD', str(t or '').lower())
    return re.sub(r'\s+', ' ', ''.join(ch for ch in t if unicodedata.category(ch) != 'Mn')).strip()


# palavras de cabeçalho de cada papel, da mais específica para a mais genérica
PALAVRAS = [
    ('total', ['preco total', 'valor total', 'custo total', 'total']),
    ('comp_codigo', ['codigo do servico', 'cod servico', 'codigo servico', 'codigo da composicao', 'cod composicao', 'codigo composicao']),
    ('comp_descricao', ['descricao do servico', 'descricao da composicao', 'servico', 'composicao']),
    ('preco', ['preco unitario', 'preco unit', 'custo unitario', 'custo unit', 'valor unitario', 'vl unit', 'vlr unit', 'pr unit', 'p unit', 'unitario', 'preco', 'custo', 'valor']),
    ('coeficiente', ['coeficiente', 'coef', 'indice', 'consumo', 'quant unit']),
    ('quantidade', ['quantidade', 'qtde', 'qtd', 'quant']),
    ('unidade', ['unidade', 'unid', 'und', 'un']),
    ('codigo', ['codigo do insumo', 'cod insumo', 'codigo', 'cod', 'referencia']),
    ('descricao', ['descricao', 'discriminacao', 'especificacao', 'insumo', 'nome']),
    ('tipo', ['tipo', 'classe', 'categoria', 'natureza']),
    ('item', ['item', 'nivel', 'n', 'no', 'seq']),
]


def _papel(celula):
    t = re.sub(r'[^a-z0-9 ]', ' ', normal(celula)).strip()
    t = re.sub(r'\s+', ' ', t)
    if not t or len(t) > 40:
        return None
    for papel, palavras in PALAVRAS:
        for p in palavras:
            if t == p or t.startswith(p + ' ') or (len(p) > 3 and p in t):
                return papel
    return None


def adivinhar(linhas):
    """Linha do cabeçalho (a que mais parece ter títulos de coluna, entre as primeiras) e o papel de cada coluna."""
    melhor, idx = 0, None
    for k, ln in enumerate(linhas[:60]):
        n = len({p for p in map(_papel, ln) if p})
        textos = sum(1 for v in ln if isinstance(v, str) and v)
        if n >= 2 and n >= melhor and textos >= n:
            if n > melhor:
                melhor, idx = n, k
    if idx is None:
        return {'cabecalho': None, 'colunas': {}}
    colunas = {}
    for j, v in enumerate(linhas[idx]):
        p = _papel(v)
        if p and p not in colunas:
            colunas[p] = j
    return {'cabecalho': idx, 'colunas': colunas}


@router.post('/ler')
async def ler(request: Request):
    nome = unquote(request.headers.get('x-nome-arquivo', 'arquivo'))
    dados = await request.body()
    if not dados:
        raise HTTPException(422, 'Arquivo vazio.')
    if len(dados) > LIMITE_BYTES:
        raise HTTPException(413, 'Arquivo maior que 25 MB.')
    ext = nome.lower().rsplit('.', 1)[-1] if '.' in nome else ''
    try:
        if dados[:4] == b'%PDF' or ext == 'pdf':
            folhas, formato = ler_pdf(dados), 'PDF'
        elif dados[:2] == b'PK' or ext in ('xlsx', 'xlsm'):
            folhas, formato = ler_xlsx(dados), 'Excel'
        elif dados[:8] == b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1' or ext == 'xls':
            raise HTTPException(415, 'Arquivo .xls (Excel antigo). Abra no Excel e salve como .xlsx, ou exporte em CSV.')
        else:
            folhas, formato = ler_csv(dados), 'CSV'
    except HTTPException:
        raise
    except Exception as e:  # arquivo corrompido ou de outro tipo
        raise HTTPException(422, f'Não foi possível ler o arquivo ({type(e).__name__}). Confira se é XLSX, CSV ou PDF.')
    folhas = [f | adivinhar(f['linhas']) for f in folhas if f['linhas']]
    if not folhas:
        raise HTTPException(422, 'Nenhuma linha com conteúdo foi encontrada no arquivo.')
    aviso = ('PDF lido pelo espaçamento do texto: confira as colunas na prévia. Se o sistema de origem exportar em Excel, '
             'prefira o Excel.') if formato == 'PDF' else ''
    return {'arquivo': nome, 'formato': formato, 'folhas': folhas, 'aviso': aviso}


# ---------- números e textos ----------
def numero(v):
    """1.234,56 / 1,234.56 / 1234.56 / R$ 12,3 / 12,5% -> float (None se não for número)."""
    if v is None or v == '':
        return None
    if isinstance(v, (int, float)):
        return float(v)
    t = re.sub(r'[^\d,.\-]', '', str(v))
    if not re.search(r'\d', t):
        return None
    if ',' in t and '.' in t:
        t = t.replace('.', '').replace(',', '.') if t.rfind(',') > t.rfind('.') else t.replace(',', '')
    elif ',' in t:
        t = t.replace('.', '').replace(',', '.')
    elif t.count('.') > 1:
        t = t.replace('.', '')
    try:
        return float(t)
    except ValueError:
        return None


def texto(v):
    return ('' if v is None else str(int(v) if isinstance(v, float) and v.is_integer() else v)).strip()


def codigo(v):
    t = texto(v)
    return re.sub(r'\s+', '', t)[:40]


def tipo_insumo(v, descricao=''):
    t = normal(v) + ' ' + normal(descricao)[:0]
    if any(p in t for p in ('mao de obra', 'pessoal', 'salario', 'mo ')) or t.strip() in ('mo', 'm.o.', 'mao'):
        return 'MAO_DE_OBRA'
    if 'equip' in t or 'maquin' in t or 'ferrament' in t:
        return 'EQUIPAMENTO'
    if 'terceir' in t or 'servic' in t or 'empreit' in t:
        return 'SERVICO_TERCEIRO'
    return 'MATERIAL'


class Pedido(BaseModel):
    linhas: list[list] = Field(max_length=LIMITE_LINHAS)
    cabecalho: Optional[int] = None          # índice da linha de cabeçalho (as anteriores são ignoradas)
    colunas: dict[str, int] = {}             # papel -> índice da coluna
    base_id: Optional[int] = None            # base própria de destino
    nova_base: str = Field('', max_length=40)  # ou o nome de uma base nova
    fonte: str = Field('', max_length=200)   # ex.: "SIENGE, orçamento Edifício X"
    data_preco: str = Field('', max_length=10)
    oficiais: list[Literal['SINAPI', 'ORSE', 'SICRO']] = []  # códigos que podem ser de uma base oficial
    simular: bool = False


def _linhas(d: Pedido):
    """Linhas de dados (depois do cabeçalho), cada uma como dicionário papel -> valor. Repetições do cabeçalho (comuns em
    PDF, uma por página) são puladas."""
    cab = d.linhas[d.cabecalho] if d.cabecalho is not None and d.cabecalho < len(d.linhas) else None
    ini = (d.cabecalho + 1) if d.cabecalho is not None else 0
    for k, ln in enumerate(d.linhas[ini:], ini):
        if cab and [normal(x) for x in ln] == [normal(x) for x in cab]:
            continue
        yield k, {p: (ln[j] if j is not None and 0 <= j < len(ln) else '') for p, j in d.colunas.items()}


def _base_destino(c, d: Pedido):
    if d.nova_base.strip():
        nome = proprias._nome_valido(c, d.nova_base)
        if d.simular:
            return None, nome
        cur = c.execute('INSERT INTO base_propria (nome, descricao, criado_em) VALUES (?,?,?)',
                        (nome, f'Importada{(" de " + d.fonte) if d.fonte else ""}', orc_mod.agora()))
        return cur.lastrowid, nome
    if not d.base_id:
        raise HTTPException(422, 'Escolha a base própria de destino ou dê o nome de uma base nova.')
    proprias.checar_base_propria(c, d.base_id)
    return d.base_id, proprias.nome_da_base(d.base_id)


def _proximo_id(c, tabela):
    return (c.execute(f'SELECT COALESCE(MAX(id), 0) FROM {tabela}').fetchone()[0] or 0) + 1


def _existentes(c, tabela, base_id):
    """codigo_origem -> id dos itens que a base já tem (para atualizar em vez de duplicar)."""
    if base_id is None:
        return {}
    return {r['codigo_origem']: r['id'] for r in c.execute(
        f"SELECT id, codigo_origem FROM {tabela} WHERE base_id = ? AND codigo_origem <> ''", (base_id,)).fetchall()}


# ---------- insumos ----------
def _gravar_insumos(c, base_id, novos, atualizar, agora):
    """novos/atualizar: listas de dicionários com descricao, unidade, tipo, preco, data_preco, fonte, codigo_origem (e id)."""
    if novos:
        prox = _proximo_id(c, 'insumo_proprio')
        for k, x in enumerate(novos):
            x['id'] = prox + k
        c.executemany('''INSERT INTO insumo_proprio (id, descricao, unidade, tipo, preco, data_preco, fonte, criado_em, atualizado_em, base_id, codigo_origem)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)''', [(x['id'], x['descricao'], x['unidade'], x['tipo'], x['preco'], x['data_preco'], x['fonte'], agora, agora,
                                                 base_id, x['codigo_origem']) for x in novos])
        c.ajustar_sequencia('insumo_proprio')
    if atualizar:
        c.executemany('UPDATE insumo_proprio SET descricao = ?, unidade = ?, tipo = ?, preco = ?, data_preco = ?, fonte = ?, atualizado_em = ? WHERE id = ?',
                      [(x['descricao'], x['unidade'], x['tipo'], x['preco'], x['data_preco'], x['fonte'], agora, x['id']) for x in atualizar])


@router.post('/insumos')
def importar_insumos(d: Pedido):
    if 'descricao' not in d.colunas:
        raise HTTPException(422, 'Indique a coluna da descrição.')
    agora = orc_mod.agora()
    with proprias.gravando() as c:
        base_id, nome = _base_destino(c, d)
        ja = _existentes(c, 'insumo_proprio', base_id)
        novos, atualizar, ignoradas, vistos = [], [], [], set()
        for k, r in _linhas(d):
            desc, cod = texto(r.get('descricao'))[:400], codigo(r.get('codigo'))
            if not desc:
                ignoradas.append(k + 1); continue
            if not cod and not texto(r.get('unidade')) and numero(r.get('preco')) is None:
                continue  # só texto: título, subtotal ou cabeçalho de página
            if cod and cod in vistos:
                continue
            vistos.add(cod)
            x = {'descricao': desc, 'unidade': texto(r.get('unidade'))[:20] or 'un', 'tipo': tipo_insumo(r.get('tipo')),
                 'preco': numero(r.get('preco')), 'data_preco': d.data_preco, 'fonte': d.fonte, 'codigo_origem': cod}
            if cod and cod in ja:
                atualizar.append(x | {'id': ja[cod]})
            else:
                novos.append(x)
        if not d.simular:
            _gravar_insumos(c, base_id, novos, atualizar, agora)
    return {'base_id': base_id, 'base': nome, 'novos': len(novos), 'atualizados': len(atualizar),
            'sem_preco': sum(1 for x in novos + atualizar if x['preco'] is None), 'ignoradas': ignoradas[:50], 'simulado': d.simular}


# ---------- composições ----------
def _oficial(tipo, base, cod):
    """Item de base oficial com esse código no mês mais recente dela (ou None)."""
    with orc_mod._base_conn() as b:
        mes = orc_mod.ultimo_por_base(b).get(base)
        tabela = 'servico' if tipo == 'servico' else 'insumo'
        r = b.execute(f"SELECT codigo, descricao, unidade FROM {tabela} WHERE base = ? AND referencia = ? AND (codigo = ? OR ltrim(codigo, '0') = ltrim(?, '0'))",
                      (base, mes, cod, cod)).fetchone()
        return dict(r) if r else None


def _agrupar_composicoes(d: Pedido):
    """Composições do arquivo: {codigo: {descricao, unidade, preco, itens: [...]}}, em dois formatos:
    - com coluna do código da composição em cada linha (uma linha por item);
    - composição como título (linha sem coeficiente) e os itens logo abaixo (como nos relatórios analíticos)."""
    comps, ordem, atual = {}, [], None
    plano = 'comp_codigo' in d.colunas
    for k, r in _linhas(d):
        coef = numero(r.get('coeficiente'))
        if plano:
            cc = codigo(r.get('comp_codigo'))
            if not cc:
                continue
            if cc not in comps:
                comps[cc] = {'descricao': texto(r.get('comp_descricao')) or cc, 'unidade': texto(r.get('comp_unidade')) or 'un', 'preco': None, 'itens': [], 'linha': k + 1}
                ordem.append(cc)
            atual = comps[cc]
            if coef is None:
                continue
        elif coef is None:
            cc = codigo(r.get('codigo'))
            desc = texto(r.get('descricao'))
            if not (cc or desc):
                continue
            cc = cc or f'L{k + 1}'
            comps[cc] = {'descricao': desc or cc, 'unidade': texto(r.get('unidade')) or 'un', 'preco': numero(r.get('preco')) or numero(r.get('total')),
                         'itens': [], 'linha': k + 1}
            ordem.append(cc); atual = comps[cc]
            continue
        if atual is None:
            continue
        atual['itens'].append({'codigo': codigo(r.get('codigo')), 'descricao': texto(r.get('descricao'))[:400], 'unidade': texto(r.get('unidade'))[:20] or 'un',
                               'coef': coef, 'preco': numero(r.get('preco')), 'tipo': r.get('tipo')})
    return comps, ordem


@router.post('/composicoes')
def importar_composicoes(d: Pedido):
    for p in ('descricao', 'coeficiente'):
        if p not in d.colunas:
            raise HTTPException(422, f'Indique a coluna {"da descrição" if p == "descricao" else "do coeficiente"}.')
    comps, ordem = _agrupar_composicoes(d)
    if not ordem:
        raise HTTPException(422, 'Nenhuma composição encontrada. Confira a linha de cabeçalho e as colunas.')
    agora = orc_mod.agora()
    with proprias.gravando() as c:
        base_id, nome = _base_destino(c, d)
        comps_ja = _existentes(c, 'composicao_propria', base_id)
        ins_ja = _existentes(c, 'insumo_proprio', base_id)
        # 1) cabeçalhos das composições (novas recebem id já aqui, para os itens poderem apontar umas para as outras)
        prox = _proximo_id(c, 'composicao_propria')
        ids, novas, atualizadas = {}, [], []
        for cc in ordem:
            if cc in comps_ja:
                ids[cc] = comps_ja[cc]; atualizadas.append(cc)
            else:
                ids[cc] = prox; prox += 1; novas.append(cc)
        # 2) itens: composição do arquivo > composição/insumo da base > base oficial > insumo novo criado com os dados da linha
        ins_novos, itens, oficiais, criados = [], [], 0, {}
        prox_ins = _proximo_id(c, 'insumo_proprio')
        for cc in ordem:
            for n, it in enumerate(comps[cc]['itens'], 1):
                cod = it['codigo']
                if cod and cod in ids and cod != cc:
                    itens.append((ids[cc], n, 'servico', proprias.BASE, proprias.cod_comp(ids[cod]), it['coef'], it['descricao'], it['unidade'])); continue
                if cod and cod in comps_ja and cod != cc:
                    itens.append((ids[cc], n, 'servico', proprias.BASE, proprias.cod_comp(comps_ja[cod]), it['coef'], it['descricao'], it['unidade'])); continue
                if cod and cod in ins_ja:
                    itens.append((ids[cc], n, 'insumo', proprias.BASE, proprias.cod_ins(ins_ja[cod]), it['coef'], it['descricao'], it['unidade'])); continue
                achado = None
                for b in d.oficiais if cod else []:
                    for t in ('insumo', 'servico'):
                        o = _oficial(t, b, cod)
                        if o:
                            achado = (t, b, o['codigo']); break
                    if achado:
                        break
                if achado:
                    oficiais += 1
                    itens.append((ids[cc], n, achado[0], achado[1], achado[2], it['coef'], it['descricao'], it['unidade'])); continue
                chave = cod or (normal(it['descricao']) + '|' + it['unidade'])
                if chave not in criados:
                    criados[chave] = prox_ins + len(ins_novos)
                    ins_novos.append({'id': criados[chave], 'descricao': it['descricao'] or cod, 'unidade': it['unidade'], 'tipo': tipo_insumo(it['tipo']),
                                      'preco': it['preco'], 'data_preco': d.data_preco, 'fonte': d.fonte, 'codigo_origem': cod})
                itens.append((ids[cc], n, 'insumo', proprias.BASE, proprias.cod_ins(criados[chave]), it['coef'], it['descricao'], it['unidade']))
        resumo = {'base_id': base_id, 'base': nome, 'composicoes_novas': len(novas), 'composicoes_atualizadas': len(atualizadas),
                  'itens': len(itens), 'insumos_criados': len(ins_novos), 'itens_de_base_oficial': oficiais, 'simulado': d.simular,
                  'vazias': [cc for cc in ordem if not comps[cc]['itens']][:30]}
        if d.simular:
            return resumo
        if novas:
            c.executemany('''INSERT INTO composicao_propria (id, descricao, unidade, grupo, observacoes, criado_em, atualizado_em, base_id, codigo_origem)
                VALUES (?,?,?,?,?,?,?,?,?)''', [(ids[cc], comps[cc]['descricao'][:400], comps[cc]['unidade'][:20], '', f'Importada{(" de " + d.fonte) if d.fonte else ""}.',
                                                 agora, agora, base_id, cc) for cc in novas])
            c.ajustar_sequencia('composicao_propria')
        if atualizadas:
            c.executemany('UPDATE composicao_propria SET descricao = ?, unidade = ?, atualizado_em = ? WHERE id = ?',
                          [(comps[cc]['descricao'][:400], comps[cc]['unidade'][:20], agora, ids[cc]) for cc in atualizadas])
            c.executemany('DELETE FROM composicao_propria_item WHERE composicao_id = ?', [(ids[cc],) for cc in atualizadas])
        if ins_novos:
            _gravar_insumos(c, base_id, ins_novos, [], agora)
        c.executemany('INSERT INTO composicao_propria_item (composicao_id, ordem, tipo, base, codigo, qtd, descricao, unidade) VALUES (?,?,?,?,?,?,?,?)', itens)
    # 3) conferência: custo calculado x preço que o arquivo trazia na linha da composição
    calc = proprias.calculo_guardado({})
    difs = []
    for cc in ordem:
        p = comps[cc]['preco']
        if p:
            try:
                v = calc.composicao(proprias.cod_comp(ids[cc]))['custo_total']
            except HTTPException:
                continue
            if abs(v - p) > max(0.02, p * 0.001):
                difs.append({'codigo_origem': cc, 'codigo': proprias.cod_comp(ids[cc]), 'descricao': comps[cc]['descricao'][:120], 'arquivo': p, 'calculado': v})
    resumo['conferidas'] = sum(1 for cc in ordem if comps[cc]['preco'])
    resumo['diferentes'] = difs[:50]
    resumo['n_diferentes'] = len(difs)
    return resumo


# ---------- orçamento ----------
class PedidoOrcamento(Pedido):
    nome: str = Field(min_length=1, max_length=200)
    cliente: str = ''
    local: str = ''
    bdi: float = Field(0.0, ge=0, le=100)
    precos_com_bdi: bool = False   # os preços unitários do arquivo já incluem o BDI informado
    referencia: Optional[str] = None


def _nivel(item):
    t = texto(item).strip().strip('.')
    return len([p for p in re.split(r'[.\-]', t) if p.strip()]) if re.fullmatch(r'\d+([.\-]\d+)*\.?', t or 'x') else 0


@router.post('/orcamento')
def importar_orcamento(d: PedidoOrcamento):
    if 'descricao' not in d.colunas or 'quantidade' not in d.colunas:
        raise HTTPException(422, 'Indique as colunas da descrição e da quantidade.')
    fator = (1 + d.bdi / 100) if d.precos_com_bdi else 1.0
    # 1) estrutura: títulos viram etapas (nível 1) e subetapas (níveis 2 ou mais); linhas com quantidade viram itens
    etapas, itens, atual_e, atual_s = [], [], None, None
    for k, r in _linhas(d):
        qtd, desc = numero(r.get('quantidade')), texto(r.get('descricao'))
        nivel = _nivel(r.get('item'))
        if not desc and not codigo(r.get('codigo')):
            continue
        if not qtd:
            if not desc:
                continue
            titulo = desc[:200]
            if nivel <= 1 or atual_e is None:
                atual_e = {'titulo': titulo, 'subs': [], 'itens': []}; etapas.append(atual_e); atual_s = None
            else:
                atual_s = {'titulo': titulo, 'itens': []}; atual_e['subs'].append(atual_s)
            continue
        if atual_e is None:
            atual_e = {'titulo': 'Serviços', 'subs': [], 'itens': []}; etapas.append(atual_e)
        pu = numero(r.get('preco'))
        if pu is None and numero(r.get('total')) is not None and qtd:
            pu = numero(r.get('total')) / qtd
        it = {'codigo': codigo(r.get('codigo')), 'descricao': desc[:400], 'unidade': texto(r.get('unidade'))[:20] or 'un', 'qtd': qtd,
              'preco': (pu / fator) if pu is not None else None, 'total_arquivo': numero(r.get('total')) if numero(r.get('total')) is not None else (pu * qtd if pu is not None else None)}
        (atual_s or atual_e)['itens'].append(it); itens.append(it)
    if not itens:
        raise HTTPException(422, 'Nenhum item com quantidade foi encontrado. Confira a linha de cabeçalho e as colunas.')
    agora = orc_mod.agora()
    with orc_mod._base_conn() as b:
        ref = d.referencia or orc_mod.ref_principal(b)
    # 2) cada item: composição da base > insumo da base > base oficial > insumo novo com o preço do arquivo
    with proprias.gravando() as c:
        base_id, nome_base = _base_destino(c, d)
        comps_ja = _existentes(c, 'composicao_propria', base_id)
        ins_ja = _existentes(c, 'insumo_proprio', base_id)
        ins_novos, criados, contagem = [], {}, {'composicao_da_base': 0, 'insumo_da_base': 0, 'base_oficial': 0, 'criado_com_preco_do_arquivo': 0}
        prox_ins = _proximo_id(c, 'insumo_proprio')
        for it in itens:
            cod = it['codigo']
            if cod and cod in comps_ja:
                it['ref'] = ('servico', proprias.BASE, proprias.cod_comp(comps_ja[cod])); contagem['composicao_da_base'] += 1; continue
            if cod and cod in ins_ja:
                it['ref'] = ('insumo', proprias.BASE, proprias.cod_ins(ins_ja[cod])); contagem['insumo_da_base'] += 1; continue
            achado = None
            for bo in d.oficiais if cod else []:
                for t in ('servico', 'insumo'):
                    o = _oficial(t, bo, cod)
                    if o:
                        achado = (t, bo, o['codigo']); break
                if achado:
                    break
            if achado:
                it['ref'] = achado; contagem['base_oficial'] += 1; continue
            chave = cod or (normal(it['descricao']) + '|' + it['unidade'])
            if chave not in criados:
                criados[chave] = prox_ins + len(ins_novos)
                ins_novos.append({'id': criados[chave], 'descricao': it['descricao'] or cod, 'unidade': it['unidade'], 'tipo': 'SERVICO_TERCEIRO',
                                  'preco': round(it['preco'], 4) if it['preco'] is not None else None, 'data_preco': d.data_preco,
                                  'fonte': (d.fonte or 'Orçamento importado') + ' (preço unitário do orçamento, sem composição)', 'codigo_origem': cod})
            it['ref'] = ('insumo', proprias.BASE, proprias.cod_ins(criados[chave])); contagem['criado_com_preco_do_arquivo'] += 1
        resumo = {'base_id': base_id, 'base': nome_base, 'etapas': len(etapas), 'subetapas': sum(len(e['subs']) for e in etapas), 'itens': len(itens),
                  'origem_dos_itens': contagem, 'insumos_criados': len(ins_novos), 'simulado': d.simular,
                  'total_arquivo': round(sum(x['total_arquivo'] or 0 for x in itens), 2)}
        if d.simular:
            return resumo
        if ins_novos:
            _gravar_insumos(c, base_id, ins_novos, [], agora)
    # 3) o orçamento, com o preço que cada item tem no aplicativo (composições próprias calculadas, oficiais do mês)
    with orc_mod.orc() as c:
        cur = c.execute('INSERT INTO orcamento (nome, cliente, local, referencia, bdi, observacoes, criado_em, atualizado_em) VALUES (?,?,?,?,?,?,?,?)',
                        (d.nome.strip(), d.cliente.strip(), d.local.strip(), ref, d.bdi,
                         f'Importado{(" de " + d.fonte) if d.fonte else ""}. Base própria: {nome_base}.', agora, agora))
        oid = cur.lastrowid
        ordem, linhas_item, difs = 0, [], []
        with proprias.sessao(c):
            for e in etapas:
                ordem += 1
                eid = c.execute('INSERT INTO etapa (orcamento_id, ordem, titulo, pai_id) VALUES (?,?,?,?)', (oid, ordem, e['titulo'], None)).lastrowid
                grupos = [(eid, e['itens'])]
                for s in e['subs']:
                    ordem += 1
                    sid = c.execute('INSERT INTO etapa (orcamento_id, ordem, titulo, pai_id) VALUES (?,?,?,?)', (oid, ordem, s['titulo'], eid)).lastrowid
                    grupos.append((sid, s['itens']))
                for et_id, lista in grupos:
                    for n, it in enumerate(lista, 1):
                        tipo, base, cod = it['ref']
                        p = orc_mod.preco_na_base(tipo, base, cod, ref)
                        preco = p['preco'] if p and p['preco'] is not None else (it['preco'] or 0.0)
                        linhas_item.append((oid, et_id, n, tipo, base, (p or {}).get('codigo') or cod, (p or {}).get('descricao') or it['descricao'],
                                            (p or {}).get('unidade') or it['unidade'], it['qtd'], preco, (p or {}).get('referencia') or ref))
                        if it['preco'] is not None and abs(preco - it['preco']) > max(0.02, it['preco'] * 0.001):
                            difs.append({'codigo_origem': it['codigo'], 'descricao': it['descricao'][:120], 'arquivo': round(it['preco'], 2), 'aplicativo': round(preco, 2)})
        c.executemany('''INSERT INTO item (orcamento_id, etapa_id, ordem, tipo, base, codigo, descricao, unidade, quantidade, custo_unit, referencia)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)''', linhas_item)
        o = orc_mod.calcular(c, oid)
    total_arq = resumo['total_arquivo'] * (1 if d.precos_com_bdi else (1 + d.bdi / 100))
    return resumo | {'orcamento_id': oid, 'total_aplicativo': o['total'], 'custo_aplicativo': o['custo_total'],
                     'total_arquivo_com_bdi': round(total_arq, 2), 'precos_diferentes': difs[:50], 'n_precos_diferentes': len(difs)}
