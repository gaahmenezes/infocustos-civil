"""Texto de um PDF com o leiaute das colunas, como o `pdftotext -layout`, usando só o pdfium (pypdfium2).

O servidor não tem o poppler (pdftotext); os leitores dos relatórios da CEHOP foram escritos para o texto com as
colunas separadas por espaços. Aqui:
  - cada caractere usa a caixa "solta" do pdfium (a da fonte: mesma altura para todas as letras da linha, e largura
    com o avanço, de modo que as letras de uma palavra ficam coladas);
  - letra repetida na mesma posição (texto desenhado duas vezes) conta uma vez só;
  - as linhas saem da altura da caixa; as palavras, dos espaços do PDF e dos vãos entre letras;
  - cada palavra vai para a coluna da sua posição na página.

Uso: python3 extratores/texto_pdf.py arquivo.pdf saida.txt
"""
import bisect
import sys


def paginas(caminho_ou_bytes):
    """Gera o texto de cada página (com '\\f' no fim, como o pdftotext)."""
    import pypdfium2 as pdfium
    pdf = pdfium.PdfDocument(caminho_ou_bytes)
    try:
        for i in range(len(pdf)):
            pg = pdf[i]
            tp = pg.get_textpage()
            chars, espacos = [], []
            for k in range(tp.count_chars()):
                ch = tp.get_text_range(k, 1)
                if not ch or ch in '\r\n':
                    continue
                x0, y0, x1, y1 = tp.get_charbox(k, loose=True)
                if ch.isspace():  # o espaço do próprio PDF separa palavras, mesmo estreito
                    espacos.append(((x0 + x1) / 2, (y0 + y1) / 2)); continue
                chars.append((ch, x0, x1, (y0 + y1) / 2, y1 - y0, k))
            tp.close(); pg.close()
            yield montar(chars, espacos) + '\f'
    finally:
        pdf.close()


def _mediana(v, padrao):
    v = sorted(x for x in v if x > 0)
    return v[len(v) // 2] if v else padrao


def montar(chars, espacos=()):
    if not chars:
        return ''
    h = _mediana([c[4] for c in chars], 9.0)
    # letra repetida no mesmo lugar (negrito simulado, texto desenhado duas vezes): uma vez só
    vistos, unicos = set(), []
    for c in chars:
        k = (c[0], round(c[1] / 1.2), round(c[3] / 1.2))
        if k not in vistos:
            vistos.add(k); unicos.append(c)
    linhas = []
    for c in sorted(unicos, key=lambda c: (-c[3], c[1])):
        if linhas and abs(linhas[-1]['m'] - c[3]) <= h * 0.3:
            linhas[-1]['cs'].append(c)
        else:
            linhas.append({'m': c[3], 'cs': [c], 'esp': []})
    for ex, ey in espacos:
        if linhas:
            l = min(linhas, key=lambda l: abs(l['m'] - ey))
            if abs(l['m'] - ey) <= h * 0.5:
                l['esp'].append(ex)
    # largura de uma coluna: o passo típico entre letras vizinhas
    passos = []
    for l in linhas:
        cs = sorted(l['cs'], key=lambda c: c[1])
        passos += [b[1] - a[1] for a, b in zip(cs, cs[1:]) if 0 < b[1] - a[1] < h]
    w = _mediana(passos, h * 0.5)
    out = []
    for l in linhas:
        # palavras na ordem em que o PDF escreve o texto (um número longo que invade a coluna vizinha não se mistura
        # com ela); depois, as palavras em ordem de posição na linha
        cs = sorted(l['cs'], key=lambda c: c[5])
        esp = sorted(l['esp'])
        palavras, atual = [], None
        for c in cs:
            if atual is not None and c[5] == atual['k'] + 1:
                i = bisect.bisect_left(esp, atual['x1'] - w * 0.3)
                separa = i < len(esp) and esp[i] <= c[1] + w * 0.3
                if not separa and -w * 0.3 <= c[1] - atual['x1'] <= w * 0.12:
                    atual['t'] += c[0]; atual['x1'] = max(atual['x1'], c[2]); atual['k'] = c[5]; continue
            atual = {'t': c[0], 'x0': c[1], 'x1': c[2], 'k': c[5]}; palavras.append(atual)
        # letras soltas da mesma palavra que o PDF escreveu fora de ordem: junta pela posição
        palavras.sort(key=lambda p: p['x0'])
        juntas = []
        for p in palavras:
            q = juntas[-1] if juntas else None
            if q and 0 <= p['x0'] - q['x1'] <= w * 0.12 and not any(q['x1'] - w * 0.3 <= e <= p['x0'] + w * 0.3 for e in esp[bisect.bisect_left(esp, q['x1'] - w * 0.3):][:2]):
                q['t'] += p['t']; q['x1'] = max(q['x1'], p['x1'])
            else:
                juntas.append(dict(p))
        palavras = juntas
        s, fim = '', None
        for p in palavras:
            col = int(round(p['x0'] / w))
            if fim is not None:
                col = max(col, len(s) + (2 if p['x0'] - fim > w * 1.6 else 1))  # vão largo vira pelo menos dois espaços
            if col > len(s):
                s += ' ' * (col - len(s))
            s += p['t']; fim = p['x1']
        out.append(s.rstrip())
    return '\n'.join(out)


if __name__ == '__main__':
    with open(sys.argv[2], 'w', encoding='utf-8') as f:
        for t in paginas(sys.argv[1]):
            f.write(t)
