import sys, json, re, csv, collections
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

d = json.load(open(sys.argv[1])); out = sys.argv[2]
recs = d['recs']
WRAP = 77
WORD = re.compile(r"[A-Za-zÀ-ÿ]+")
vocab = collections.Counter()
for r in recs:
    for l in r['desc_lines']:
        vocab.update(w.lower() for w in WORD.findall(l))

def join(lines):
    raw = [l for l in lines if not re.fullmatch(r'Página \d+', l.strip())]
    lines = [re.sub(r'\s+', ' ', l).strip() for l in raw]
    if not lines: return ''
    s = lines[0]
    for prev_raw, nxt in zip(raw, lines[1:]):
        tail = re.search(r'([A-Za-zÀ-ÿ]+)$', s); head = re.match(r'([A-Za-zÀ-ÿ]+)', nxt)
        glue = ' '
        if len(prev_raw) >= WRAP - 1 and tail and head:
            t, h = tail.group(1).lower(), head.group(1).lower()
            joined = vocab.get(t + h, 0); sep = min(vocab.get(t, 0), vocab.get(h, 0))
            glue = '' if joined >= sep or (joined == 0 and sep == 0 and len(prev_raw) >= WRAP) else ' '
            if joined == 0 and sep > 0: glue = ' '
            if len(t) == 1 and t not in 'eaoy' and len(prev_raw) >= WRAP: glue = ''
        elif len(prev_raw) >= WRAP and not (s[-1:] in ',.;:)' ):
            glue = '' if re.match(r'[\w(]', nxt) and re.search(r'\w$', s) else ' '
        s = s + glue + nxt
    return s

def num(p):
    m = re.match(r'([\d.]+,\d+)', p or '')
    return float(m.group(1).replace('.', '').replace(',', '.')) if m else None

rows = []
for r in recs:
    parts = (r['categoria'] or '').split('/')
    rows.append({
        'codigo': r['codigo'], 'descricao': join(r['desc_lines']), 'unidade': r['unidade'],
        'preco': num(r['preco']), 'marcador': '#' if '#' in (r['preco'] or '') else '',
        'tipo': parts[0], 'grupo': parts[1] if len(parts) > 1 else '', 'subgrupo': '/'.join(parts[2:]),
        'categoria_completa': r['categoria'], 'pagina': r['pagina']})

hdr = ['codigo','descricao','unidade','preco','marcador','tipo','grupo','subgrupo','categoria_completa','pagina']
with open(out + '.csv', 'w', newline='', encoding='utf-8-sig') as f:
    w = csv.DictWriter(f, fieldnames=hdr, delimiter=';'); w.writeheader()
    for r in rows: w.writerow({**r, 'preco': '' if r['preco'] is None else f"{r['preco']:.2f}".replace('.', ',')})

wb = Workbook(); ws = wb.active; ws.title = 'Servicos'
names = ['Código','Descrição','Unidade','Preço (R$)','Marcador #','Tipo','Grupo','Subgrupo','Categoria completa','Página PDF']
ws.append(names)
for r in rows: ws.append([r[k] for k in hdr])
for c in ws[1]: c.font = Font(bold=True, color='FFFFFF'); c.fill = PatternFill('solid', fgColor='2B2A6B')
for i, wdt in enumerate([9, 90, 9, 14, 11, 22, 34, 34, 60, 10], 1): ws.column_dimensions[get_column_letter(i)].width = wdt
for c in ws['D'][1:]: c.number_format = '#,##0.00'
ws.freeze_panes = 'A2'; ws.auto_filter.ref = ws.dimensions

s = wb.create_sheet('Resumo')
s.append(['Referência', d['ref']]); s.append(['Total de serviços', len(rows)])
s.append(['Com marcador #', sum(1 for r in rows if r['marcador'])])
s.append(['Sem descrição na origem', sum(1 for r in rows if not r['descricao'])])
s.append(['Sem preço na origem', sum(1 for r in rows if r['preco'] is None)]); s.append([])
s.append(['Tipo', 'Qtd. serviços'])
for k, v in collections.Counter(r['tipo'] for r in rows).most_common(): s.append([k, v])
s.append([]); s.append(['Grupo (conferência com o PDF)', 'Qtd. no PDF', 'Qtd. extraída'])
cnt = collections.Counter(r['categoria_completa'] for r in rows)
for k, v in d['cats'].items():
    s.append([k, v, sum(n for kk, n in cnt.items() if kk == k or kk.startswith(k + '/'))])
s.column_dimensions['A'].width = 80; s.column_dimensions['B'].width = 14; s.column_dimensions['C'].width = 14
wb.save(out + '.xlsx')
json.dump(rows, open(out + '.json', 'w'), ensure_ascii=False)
print(len(rows))
