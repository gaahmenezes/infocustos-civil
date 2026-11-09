"""Lê os relatórios "Modelo de Encargo Social Horista/Mensalista" do programa ORSE (PDF) e grava no banco do mês.

Uso: python3 parse_encargos.py dados/orse_sinapi_AAAA-MM.sqlite <horista.pdf> <mensalista.pdf>

Cria (ou recria) a tabela `encargo` e preenche referencia.encargo_social_horista/mensalista com o total do relatório.
Confere que a soma dos itens de cada grupo é igual ao total do grupo, e que a soma dos grupos é igual ao total geral.
"""
import re
import sqlite3
import subprocess
import sys

N = r'\d{1,3},\d{2}'


def num(s):
    return float(s.replace('.', '').replace(',', '.'))


def ler(pdf):
    txt = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True, check=True).stdout
    ref = re.search(r'Ref\s*:\s*(\S+)', txt).group(1)
    tipo = 'mensalista' if 'MENSALISTA' in txt.upper().split('ITEM')[0] else 'horista'
    total = num(re.search(r'VALOR TOTAL DO ENCARGO SOCIAL\s*:\s*(' + N + ')%', txt).group(1))
    grupos, itens, ultimo = {}, [], None
    for linha in txt.split('\n'):
        s = linha.strip()
        m = re.match(r'^([A-D])\s{2,}(.+?)\s{2,}(' + N + r')\s*\+', s)
        if m:
            grupos[m.group(1)] = {'grupo': m.group(1), 'descricao': m.group(2).strip(), 'valor': num(m.group(3))}
            continue
        m = re.match(r'^([A-D])(\d{1,2})\s{2,}(.+?)\s{2,}%\s{2,}(' + N + r')', s)
        if m:
            ultimo = {'grupo': m.group(1), 'item': f'{m.group(1)}{int(m.group(2)):02d}', 'descricao': m.group(3).strip(), 'valor': num(m.group(4))}
            itens.append(ultimo)
            continue
        if ultimo and re.match(r'^[A-Za-zÀ-ÿ]', s) and not s.startswith(('VALOR', 'ORSE', 'Rpt', 'Viva', 'Rua')) and len(linha) - len(linha.lstrip()) > 5:
            # descrição que quebrou de linha; o PDF corta no meio da palavra ("FGT" + "S sobre...")
            cola = re.match(r'^[A-Za-z]\s', s) and re.search(r'[A-Z]$', ultimo['descricao'])
            ultimo['descricao'] += ('' if cola else ' ') + s
    for g in grupos.values():
        soma = round(sum(i['valor'] for i in itens if i['grupo'] == g['grupo']), 2)
        if abs(soma - g['valor']) > 0.011:
            raise SystemExit(f'{pdf}: grupo {g["grupo"]} soma {soma} e o relatório diz {g["valor"]}')
    if abs(sum(g['valor'] for g in grupos.values()) - total) > 0.011:
        raise SystemExit(f'{pdf}: soma dos grupos diferente do total {total}')
    return ref, tipo, total, grupos, sorted(itens, key=lambda i: i['item'])


def main(db, *pdfs):
    con = sqlite3.connect(db)
    ref_db = con.execute('SELECT id, descricao FROM referencia').fetchone()
    con.execute('''CREATE TABLE IF NOT EXISTS encargo (referencia TEXT, tipo TEXT, grupo TEXT, item TEXT, descricao TEXT, valor REAL,
        PRIMARY KEY (referencia, tipo, item))''')
    for col in ('encargo_social_mensalista',):
        if col not in [r[1] for r in con.execute('PRAGMA table_info(referencia)')]:
            con.execute(f'ALTER TABLE referencia ADD COLUMN {col} REAL')
    for pdf in pdfs:
        ref, tipo, total, grupos, itens = ler(pdf)
        if ref != ref_db[1]:
            raise SystemExit(f'{pdf} é da referência {ref}, mas o banco é de {ref_db[1]}.')
        con.execute('DELETE FROM encargo WHERE referencia = ? AND tipo = ?', (ref_db[0], tipo))
        for g in grupos.values():
            con.execute('INSERT INTO encargo VALUES (?,?,?,?,?,?)', (ref_db[0], tipo, g['grupo'], g['grupo'], g['descricao'], g['valor']))
        for i in itens:
            con.execute('INSERT INTO encargo VALUES (?,?,?,?,?,?)', (ref_db[0], tipo, i['grupo'], i['item'], i['descricao'], i['valor']))
        con.execute(f'UPDATE referencia SET encargo_social_{tipo} = ?', (total,))
        print(f'{ref} {tipo}: {total:.2f}% | grupos ' + ', '.join(f"{g['grupo']} {g['valor']:.2f}" for g in grupos.values()) + f' | {len(itens)} itens')
    con.commit()


if __name__ == '__main__':
    main(*sys.argv[1:])
