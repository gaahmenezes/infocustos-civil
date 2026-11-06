import sys, re, json, collections, pdfplumber

def page_lines(page):
    words = page.extract_words(keep_blank_chars=True, x_tolerance=1.5)
    words.sort(key=lambda w: (w['top'], w['x0']))
    lines = []
    for w in words:
        if lines and abs(w['top'] - lines[-1]['top']) <= 3:
            lines[-1]['words'].append(w)
        else:
            lines.append({'top': w['top'], 'words': [w]})
    return lines

def cols(line, dx=0):
    c = {'code': [], 'desc': [], 'un': [], 'price': [], 'left': []}
    for w in sorted(line['words'], key=lambda w: w['x0']):
        x = w['x0'] - dx
        if x < 44: c['left'].append(w['text'])
        elif x < 90: c['code'].append(w['text'])
        elif x < 470: c['desc'].append(w['text'])
        elif x < 510: c['un'].append(w['text'])
        else: c['price'].append(w['text'])
    return {k: ' '.join(v).strip() for k, v in c.items()}

def main(pdf_path, out_json):
    recs, cat, cats = [], None, collections.OrderedDict()
    cur = None; total = None; ref = None
    with pdfplumber.open(pdf_path) as pdf:
        for pno, page in enumerate(pdf.pages, 1):
            lns = page_lines(page); dx = 0
            for ln in lns:
                for w in ln['words']:
                    if w['text'].startswith('CÓDIGO') and ln['top'] < 100: dx = w['x0'] - 50
            for ln in lns:
                ftxt = ' '.join(w['text'] for w in ln['words'])
                if 'RptTabela' in ftxt or 'Orçamentação de Obras de Sergipe' in ftxt: continue
                if ln['top'] < 98 or ln['top'] > 800:
                    t = ' '.join(w['text'] for w in ln['words'])
                    m = re.search(r'Ref\s*:\s*(\S+)', t)
                    if m: ref = m.group(1)
                    continue
                c = cols(ln, dx)
                full = ' '.join(w['text'] for w in ln['words'])
                if 'TOTAL GERAL' in full:
                    m2 = re.search(r'([\d.]+)\s*$', full); total = int(m2.group(1).replace('.', '')) if m2 else None; continue
                if c['left'] and not c['code']:
                    m = re.match(r'(.*)\(([\d.]+)\)\s*$', full.strip())
                    if m:
                        cat = m.group(1).strip(); cats.setdefault(cat, int(m.group(2).replace('.', ''))); continue
                if re.fullmatch(r'\d{3,7}', c['code']):
                    cur = {'codigo': c['code'], 'desc_lines': [c['desc']] if c['desc'] else [],
                           'unidade': c['un'], 'preco': c['price'], 'categoria': cat, 'pagina': pno}
                    recs.append(cur); continue
                if cur is not None and (c['desc'] or c['un'] or c['price']):
                    if c['desc']: cur['desc_lines'].append(c['desc'])
                    if c['un'] and not cur['unidade']: cur['unidade'] = c['un']
                    if c['price'] and not cur['preco']: cur['preco'] = c['price']
                    continue
                print('UNHANDLED p%d: %r' % (pno, full), file=sys.stderr)
    json.dump({'ref': ref, 'total': total, 'cats': cats, 'recs': recs}, open(out_json, 'w'), ensure_ascii=False)
    print('ref', ref, 'total declared', total, 'parsed', len(recs), 'cats', len(cats), 'sum cats', sum(cats.values()))

main(sys.argv[1], sys.argv[2])
