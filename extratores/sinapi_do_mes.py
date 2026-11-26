"""Busca na CAIXA a SINAPI do mês seguinte ao último carregado, confere e grava dados/sinapi_AAAA-MM.sqlite.gz.

Uso (tarefa agendada .github/workflows/sinapi-mensal.yml, ou à mão):
  python3 extratores/sinapi_do_mes.py                 # o mês seguinte ao último sinapi_AAAA-MM.sqlite.gz em dados/
  python3 extratores/sinapi_do_mes.py --mes 2026-11   # um mês escolhido
  python3 extratores/sinapi_do_mes.py --arquivo SINAPI-2026-11-formato-xlsx.zip   # sem baixar (zip já em mãos)

O zip público da CAIXA ("formato xlsx", todas as UF) fica em
  https://www.caixa.gov.br/Downloads/sinapi-a-vista-composicoes/SINAPI-AAAA-MM-formato-xlsx.zip
Lê com build_sinapi_caixa_xlsx.py (Sergipe, sem desoneração) e confere a soma dos itens de cada composição com o custo
publicado. Só grava se a conferência passar (no máximo 1% das composições com diferença).

Saída (código de saída e a linha "resultado=..." para a tarefa agendada):
  0  mês gravado em dados/            resultado=publicado
  0  o mês ainda não saiu (404)       resultado=ainda-nao-saiu
  0  o mês já está carregado          resultado=ja-carregado   (--mes de um mês carregado: baixa e confere, sem gravar)
  2  a CAIXA barrou o download (429, página em vez do zip...)   resultado=bloqueado
  3  a conferência não passou                                   resultado=conferencia-falhou
"""
import argparse
import glob
import gzip
import io
import json
import os
import re
import shutil
import sys
import tempfile
import http.cookiejar
import urllib.error
import urllib.request
import zipfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
DADOS = os.environ.get('SINAPI_DADOS', os.path.join(RAIZ, 'dados'))  # outra pasta, para testar
URL = 'https://www.caixa.gov.br/Downloads/sinapi-a-vista-composicoes/SINAPI-{ano}-{mes}-formato-xlsx.zip'
UF = 'SE'
LIMITE_DIVERGENCIA = 0.01  # até 1% das composições com soma dos itens diferente do custo publicado


def saida(resultado, codigo, **extra):
    """Registra o resultado para a tarefa agendada (GITHUB_OUTPUT) e encerra."""
    linhas = {'resultado': resultado, **extra}
    destino = os.environ.get('GITHUB_OUTPUT')
    if destino:
        with open(destino, 'a', encoding='utf-8') as f:
            for k, v in linhas.items():
                f.write(f'{k}={v}\n')
    print('\n'.join(f'{k}={v}' for k, v in linhas.items()))
    sys.exit(codigo)


def meses_carregados():
    return sorted(re.search(r'sinapi_(\d{4}-\d{2})\.sqlite\.gz$', f).group(1) for f in glob.glob(os.path.join(DADOS, 'sinapi_20*.sqlite.gz')))


def seguinte(ref):
    a, m = map(int, ref.split('-'))
    return f'{a + (m == 12)}-{(m % 12) + 1:02d}'


def baixar(ref, destino):
    ano, mes = ref.split('-')
    url = URL.format(ano=ano, mes=mes)
    print('baixando', url)
    # o site da CAIXA redireciona para gravar um cookie e só então entrega o arquivo: guardar os cookies entre os pulos
    abrir = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    abrir.addheaders = [('Accept', 'application/zip,application/octet-stream,*/*')]
    try:
        with abrir.open(url, timeout=300) as r:
            dados = r.read()
            final = r.geturl()
    except urllib.error.HTTPError as e:
        if e.code == 404:
            saida('ainda-nao-saiu', 0, mes=ref, detalhe=f'{url} ainda não existe (404)')
        saida('bloqueado', 2, mes=ref, detalhe=f'a CAIXA respondeu {e.code} ao baixar {url}')
    except (urllib.error.URLError, TimeoutError) as e:
        saida('bloqueado', 2, mes=ref, detalhe=f'sem resposta da CAIXA: {e}')
    if not dados.startswith(b'PK'):
        # a CAIXA devolveu uma página no lugar do arquivo (arquivo inexistente ou proteção do site)
        saida('bloqueado', 2, mes=ref, detalhe=f'a CAIXA devolveu uma página no lugar do zip (endereço final: {final})')
    with open(destino, 'wb') as f:
        f.write(dados)
    return destino


def planilha(zip_path, pasta):
    with zipfile.ZipFile(zip_path) as z:
        nomes = [n for n in z.namelist() if re.search(r'SINAPI_Refer.*\.xlsx$', n, re.I)]
        if not nomes:
            saida('conferencia-falhou', 3, detalhe='o zip não tem a planilha SINAPI_Referência_AAAA_MM.xlsx')
        return z.extract(nomes[0], pasta)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--mes', help='AAAA-MM (padrão: o seguinte ao último carregado)')
    ap.add_argument('--arquivo', help='zip ou planilha já baixada (não baixa da CAIXA)')
    args = ap.parse_args()
    carregados = meses_carregados()
    if not carregados:
        sys.exit('nenhum dados/sinapi_AAAA-MM.sqlite.gz para servir de base')
    ref = args.mes or seguinte(carregados[-1])
    so_conferir = ref in carregados  # mês já carregado pedido com --mes: baixa e confere, mas não grava (teste do download)
    if so_conferir and not args.mes and not args.arquivo:
        saida('ja-carregado', 0, mes=ref)
    tmp = tempfile.mkdtemp(prefix='sinapi_')
    try:
        origem = args.arquivo or baixar(ref, os.path.join(tmp, f'SINAPI-{ref}-formato-xlsx.zip'))
        xlsx = origem if origem.lower().endswith('.xlsx') else planilha(origem, tmp)
        # banco do mês anterior: herda o tipo de cada insumo (a planilha não traz)
        anterior = os.path.join(tmp, 'anterior.sqlite')
        base_ant = max((m for m in carregados if m < ref), default=carregados[0])
        with gzip.open(os.path.join(DADOS, f'sinapi_{base_ant}.sqlite.gz'), 'rb') as a, open(anterior, 'wb') as b:
            shutil.copyfileobj(a, b)
        sys.path.insert(0, AQUI)
        import build_sinapi_caixa_xlsx as xl
        insumos, sp, classe, (enc_h, enc_m), (mes, ano), local, custos, comps = xl.ler(xlsx, UF)
        lido = f'{ano}-{mes:02d}'
        if lido != ref:
            saida('conferencia-falhou', 3, mes=ref, detalhe=f'a planilha é de {lido}, não de {ref}')
        destino = os.path.join(tmp, f'sinapi_{ref}.sqlite')
        import build_sinapi_caixa as caixa
        r = caixa.montar(insumos, enc_h, enc_m, mes, ano, local, sp, custos, comps, UF, destino, anterior)
        div = len(r['divergem'])
        resumo = (f"{r['composicoes']} composições, {r['conferidas']} conferidas com o custo da CAIXA, {div} com diferença; "
                  f"{r['insumos']} insumos; encargo social horista {r['encargo_horista']}%")
        if not r['conferidas'] or div > r['conferidas'] * LIMITE_DIVERGENCIA:
            saida('conferencia-falhou', 3, mes=ref, detalhe=resumo)
        if so_conferir:
            saida('ja-carregado', 0, mes=ref, detalhe='download e conferência ok; nada gravado (o mês já estava carregado). ' + resumo)
        final = os.path.join(DADOS, f'sinapi_{ref}.sqlite.gz')
        with open(destino, 'rb') as a, gzip.open(final, 'wb', compresslevel=9) as b:
            shutil.copyfileobj(a, b)
        saida('publicado', 0, mes=ref, detalhe=resumo)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
