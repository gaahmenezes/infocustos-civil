import sys, re, json, collections
BASE = sys.argv[3] if len(sys.argv) > 3 else 'ORSE'
N = r'-?[\d.]*,\d+'
def num(s): return float(s.replace('.', '').replace(',', '.'))
RE_COMP = re.compile(r'^\s*(\d{3,7})\s*/\s*' + BASE + r'\s*(?:(' + N + r')\s+)?(\S+)?\s*$')
RE_ITEM = re.compile(r'^\s*(\d{3,7})\s*/\s*([A-Z]+)(?:\s+(.*?))?\s+(\S+(?:\s+' + N + r')?)\s+(' + N + r')\s+(' + N + r')\s*$')
RE_ITEM2 = re.compile(r'^\s*(\d{3,7})\s*/\s*([A-Z]+)(?:\s+(.*?))?\s+(' + N + r')\s+([^\d\s]\S*)\s+(' + N + r')\s+(' + N + r')\s*$')
RE_GLUE = re.compile(r'^\s*(\d{3,7})\s*/\s*([A-Z]+)(?:\s+(.*?))?\s+([^\d\s]\S*)\s+(\d+,\d+?)(\d{1,3}(?:\.\d{3})*,\d{2})\s+(' + N + r')\s*$')
RE_GLUE2 = re.compile(r'^\s*(\d{3,7})\s*/\s*([A-Z]+)(?:\s+(.*?))?\s+([^\d\s]\S*)\s+(\d+,\d+)\s*$')
def glued(l):
    m = re.match(r'^\s*(\d{3,7})\s*/\s*([A-Z]+)(?:\s+(.*?))?\s+([^\d\s]\S*?)\s*([\d.,]+,\d{2})\s+(' + N + r')\s*$', l)
    if not m: return None
    tok, ct = m.group(5), num(m.group(6)); best = None
    for i in range(1, len(tok)):
        a, b = tok[:i], tok[i:]
        if re.fullmatch(r'\d+,\d+', a) and re.fullmatch(r'\d{1,3}(?:\.\d{3})*,\d{2}', b):
            err = abs(num(a) * num(b) - ct) / max(ct, 0.01)
            if best is None or err < best[0]: best = (err, num(a), num(b))
    if best is None or best[0] > 0.05: return None
    return m.group(1), m.group(2), (m.group(3) or '').strip(), m.group(4), best[1], best[2], ct
RE_START = re.compile(r'^\s*(\d{3,7})\s*/\s*([A-Z]+)\b')
RE_NUMS = re.compile(r'^\s*(' + N + r'\s+){1,2}' + N + r'\s*$')
def split_un_qty(tok, cu, ct):
    tok = tok.strip()
    m = re.fullmatch(r'(\S+)\s+(' + N + r')', tok)
    if m: return m.group(1), num(m.group(2))
    if not re.search(r'\d', tok): return tok, None
    best = None
    for i in range(1, len(tok)):
        un, q = tok[:i], tok[i:]
        if re.fullmatch(N, q) and not re.fullmatch(r'[\d.,-]+', un):
            err = abs(num(q) * cu - ct)
            if best is None or err < best[0]: best = (err, un, num(q))
    return (best[1], best[2]) if best else (None, None)
RE_DNIT = re.compile(r'^\s*(\d{3,7})\s*/\s*([A-Z]+)\s+(.*?)\s+(\S+)\s+(' + N + r')\s+(' + N + r')\s+(' + N + r')\s+(' + N + r')\s+(' + N + r')\s+(' + N + r')\s*$')
SECTIONS = {'MÃO-DE-OBRA': 'MAO_DE_OBRA', 'MATERIAL': 'MATERIAL', 'EQUIPAMENTO': 'EQUIPAMENTO',
            'SERVIÇO DE TERCEIRO': 'SERVICO_TERCEIRO', 'SERVIÇO AUXILIAR': 'SERVICO_AUXILIAR'}
comps = []; partial = None; cur = None; sec = None; last = None; pending_desc = []; state = None; unhandled = collections.Counter(); samples = []
lines = open(sys.argv[1], encoding='utf-8').read().split('\n')
for raw in lines:
    l = raw.rstrip('\f').rstrip(); s = l.strip()
    if not s: continue
    if (s.startswith('Viva Construções') or s.startswith('Rua Ulysses') or re.match(r'^\d{2}/\d{2}/\d{4} \d', s) or s.startswith('12.997.101')
        or s.startswith('Ref :') or 'RptRelacaoComposicoes' in s): continue
    m = re.match(r'^CÓDIGO\s+(.*?)\s{2,}(?:PROD\. EQUIPE\s+)?UNID$', s) or re.match(r'^CÓDIGO\s+(.*?)\s+(?:PROD\. EQUIPE\s+)?UNID$', s)
    if m and not any(s[6:].lstrip().startswith(k) for k in SECTIONS):
        pending_desc = [m.group(1).strip()]; state = 'head'; continue
    if s.startswith('CÓDIGO') and not any(s[6:].lstrip().startswith(k) for k in SECTIONS):
        state = 'head'; continue
    m = RE_COMP.match(l)
    if m:
        if True:
            cur = {'codigo': m.group(1), 'descricao': pending_desc, 'prod_equipe': num(m.group(2)) if m.group(2) else None,
                   'unidade': m.group(3) or '', 'tipo': None, 'encargo_social': None, 'itens': [], 'resumo': None}
            comps.append(cur); state = 'compline'; sec = None; last = None; continue
    if state == 'compline' and not s.startswith('COMPOSIÇÃO'):
        continue
    if state == 'head': continue
    if cur is None: continue
    if s in ('COMPOSIÇÃO ANALÍTICA', 'COMPOSIÇÃO PADRÃO DNIT'):
        state = 'body'
        cur['tipo'] = 'ANALITICA' if 'ANAL' in s else 'DNIT'; continue
    hs = re.sub(r'^CÓDIGO\s+', '', s)
    hit = next((k for k in SECTIONS if hs.startswith(k)), None)
    if hit and (s.startswith('CÓDIGO') or re.fullmatch(re.escape(hit) + r'(\s*\(.*\))?', hs) or hs.startswith(hit + ' ')) and not RE_ITEM.match(l):
        sec = SECTIONS[hit]; partial = None
        e = re.search(r'Encargo Social:\s*([\d.,]+)%', s)
        if e: cur['encargo_social'] = num(e.group(1))
        continue
    if s.startswith('EQUIPAMENTO') and 'CUSTO TOTAL' in s and 'MÃO-DE-OBRA' in s: continue
    if s == 'RESUMO DA COMPOSIÇÃO': state = 'resumo'; rbuf = []; rchunks = []; continue
    if state == 'resumo':
        vals = re.findall(N, s); rchunks.append(vals); rbuf.extend(vals); v = rbuf
        if len(v) >= 6 and len(rchunks) >= 2 and len(rchunks[0]) == 1 and len(rchunks[1]) == 5: v = rchunks[1] + rchunks[0]
        if len(v) >= 6:
            cur['resumo'] = dict(zip(['equipamento', 'mao_de_obra', 'encargo_social', 'material', 'servico_terceiro', 'total'], map(num, v)))
            state = 'done'; continue
        continue
    if partial is not None and RE_NUMS.match(l):
        l = partial + '   ' + s; partial = None
    m = RE_DNIT.match(l) if cur.get('tipo') == 'DNIT' and sec == 'EQUIPAMENTO' else None
    if m:
        last = {'secao': sec, 'codigo': m.group(1), 'base': m.group(2), 'descricao': m.group(3).strip(), 'unidade': m.group(4),
                'qtd': num(m.group(5)), 'prod': num(m.group(6)), 'impr': num(m.group(7)), 'custo_prod': num(m.group(8)),
                'custo_impr': num(m.group(9)), 'custo_total': num(m.group(10))}
        cur['itens'].append(last); continue
    m = RE_ITEM.match(l)
    if m:
        cu, ct = num(m.group(5)), num(m.group(6)); un, q = split_un_qty(m.group(4), cu, ct)
        desc = (m.group(3) or '').strip()
        if un is None and re.fullmatch(N, m.group(4).strip()) and desc and len(desc) <= 6 and ' ' not in desc:
            un, q, desc = desc, num(m.group(4).strip()), ''
        if un is not None:
            last = {'secao': sec, 'codigo': m.group(1), 'base': m.group(2), 'descricao': desc, 'unidade': un,
                    'qtd': q, 'custo_unit': cu, 'custo_total': ct}
            cur['itens'].append(last); partial = None; continue
    g = glued(l)
    if g:
        last = {'secao': sec, 'codigo': g[0], 'base': g[1], 'descricao': g[2], 'unidade': g[3], 'qtd': g[4], 'custo_unit': g[5], 'custo_total': g[6]}
        cur['itens'].append(last); partial = None; continue
    m = RE_ITEM2.match(l)
    if m:
        last = {'secao': sec, 'codigo': m.group(1), 'base': m.group(2), 'descricao': (m.group(3) or '').strip(), 'unidade': m.group(5),
                'qtd': num(m.group(4)), 'custo_unit': num(m.group(6)), 'custo_total': num(m.group(7))}
        cur['itens'].append(last); partial = None; continue
    if RE_START.match(l):
        partial = l; continue
    if partial is not None and not RE_START.match(l) and re.search(N + r'\s*$', s):
        l2 = partial + '   ' + s; partial = None
        m = RE_ITEM.match(l2) or None
        if m:
            cu, ct = num(m.group(5)), num(m.group(6)); un, q = split_un_qty(m.group(4), cu, ct)
            if un is not None:
                last = {'secao': sec, 'codigo': m.group(1), 'base': m.group(2), 'descricao': (m.group(3) or '').strip(), 'unidade': un,
                        'qtd': q, 'custo_unit': cu, 'custo_total': ct}
                cur['itens'].append(last); continue
        m = RE_ITEM2.match(l2)
        if m:
            last = {'secao': sec, 'codigo': m.group(1), 'base': m.group(2), 'descricao': (m.group(3) or '').strip(), 'unidade': m.group(5),
                    'qtd': num(m.group(4)), 'custo_unit': num(m.group(6)), 'custo_total': num(m.group(7))}
            cur['itens'].append(last); continue
    if last is not None and not re.search(N + r'\s*$', s):
        last['descricao'] += '\n' + s; continue
    unhandled[s[:60]] += 1
    if len(samples) < 40: samples.append((cur['codigo'], l))
json.dump(comps, open(sys.argv[2], 'w'), ensure_ascii=False)
print('comps', len(comps), 'unhandled', sum(unhandled.values()))
for c, l in samples[:40]: print(c, '|', l)
