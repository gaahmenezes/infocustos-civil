"""Monta o banco de um mês da SINAPI a partir dos relatórios em PDF publicados pela CAIXA.

Uso: python3 extratores/build_sinapi_caixa.py <pasta com os PDFs> <UF> dados/sinapi_AAAA-MM.sqlite [banco anterior]

Lê da pasta (nomes como a CAIXA publica):
  SINAPI_Preco_Ref_Insumos_<UF>_AAAAMM.pdf       -> preços dos insumos na capital do estado
  SINAPI_Custo_Ref_Composicoes_<UF>_AAAAMM.pdf   -> custo de cada composição no estado (conferência)
  SINAPI_Analitico_Ref_Composicoes_AAAAMM.pdf    -> itens e coeficientes de cada composição (nacional)

Preços e custos SEM desoneração (como nos meses vindos da CEHOP). O tipo de cada insumo (material, mão de obra,
equipamento, serviço de terceiro) não vem no relatório da CAIXA: é herdado do mês anterior, se o banco anterior for
informado; insumo novo é classificado pela unidade e pela descrição.

Diferente do relatório da CEHOP, que abre as composições até os insumos, aqui a composição fica como a CAIXA publica:
insumos (I) e composições auxiliares (C), cada um com o seu coeficiente.
"""
import os
import re
import sqlite3
import subprocess
import sys
import tempfile

BASE = 'SINAPI'
MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
ESQUEMA = '''
CREATE TABLE referencia (id TEXT PRIMARY KEY, descricao TEXT, encargo_social_horista REAL, encargo_social_mensalista REAL);
CREATE TABLE insumo (base TEXT, codigo TEXT, referencia TEXT, descricao TEXT, unidade TEXT, preco REAL, marcador TEXT,
  tipo TEXT, grupo TEXT, subgrupo TEXT, PRIMARY KEY (base, codigo, referencia));
CREATE TABLE servico (base TEXT, codigo TEXT, referencia TEXT, descricao TEXT, unidade TEXT, preco REAL,
  tipo TEXT, grupo TEXT, subgrupo TEXT, PRIMARY KEY (base, codigo, referencia));
CREATE TABLE composicao (base TEXT, codigo TEXT, referencia TEXT, modelo TEXT, unidade TEXT, prod_equipe REAL, encargo_social REAL,
  custo_equipamento REAL, custo_mao_de_obra REAL, custo_encargo_social REAL, custo_material REAL, custo_servico_terceiro REAL,
  custo_total REAL, PRIMARY KEY (base, codigo, referencia));
CREATE TABLE composicao_item (composicao_base TEXT, composicao TEXT, referencia TEXT, ordem INTEGER, secao TEXT, base TEXT, codigo TEXT, eh_servico INTEGER,
  descricao TEXT, unidade TEXT, qtd REAL, custo_unit REAL, prod REAL, impr REAL, custo_prod REAL, custo_impr REAL, custo_total REAL);
'''
SECAO_DO_TIPO = {'PESSOAL': 'MAO_DE_OBRA', 'EQUIPAMENTOS': 'EQUIPAMENTO', 'SERVIÇOS DE TERCEIROS': 'SERVICO_TERCEIRO', 'MATERIAIS': 'MATERIAL'}
PARTE_DA_SECAO = {'MAO_DE_OBRA': 'mo', 'EQUIPAMENTO': 'e', 'SERVICO_TERCEIRO': 't', 'MATERIAL': 'mat'}


def num(t):
    t = (t or '').strip()
    if t in ('', '-'):
        return None
    return float(t.replace('.', '').replace(',', '.'))


def cod(t):
    """Mesmo formato dos meses anteriores: sem zeros à esquerda e com pelo menos 5 dígitos (000119 -> 00119)."""
    return str(int(t)).zfill(5)


def frase(t):
    """Caixa alta da CAIXA -> como nos meses anteriores ("Argamassa colante ac ii")."""
    t = re.sub(r'\s+', ' ', t).strip()
    return t[:1].upper() + t[1:].lower() if t else t


def texto(pdf):
    with tempfile.NamedTemporaryFile(suffix='.txt', delete=False) as f:
        destino = f.name
    subprocess.run(['pdftotext', '-layout', pdf, destino], check=True)
    linhas = open(destino, encoding='utf-8').read().splitlines()
    os.remove(destino)
    return linhas


def cabecalho_ou_vazio(l):
    s = l.strip()
    return (not s or s.startswith(('SINAPI - Sistema Nacional', 'RELATÓRIO ', 'Localidade:', 'Código', 'Família', 'Insumo',
                                    'Coeficiente', 'SEM desoneração', 'Custo Total')) or re.match(r'^(Código|Família)\b', s) is not None)


def ler_insumos(pdf):
    linhas = texto(pdf)
    cab = ' '.join(linhas[:6])
    enc = re.search(r'SEM desoneração:\s*Horista:\s*([\d,]+)%\s*Mensalista:\s*([\d,]+)%', cab)
    mes = re.search(r'Mês de Referência:\s*(\d{2})/(\d{4})', cab)
    local = re.search(r'Localidade:\s*(.+?)\s{2,}\|', cab)
    item = re.compile(r'^(\d{6})\s+([\d,]+)\s+(\d{6})\s+(.*?)\s{2,}(\S+)\s+(C|CR|AS|-)\s+([\d.,]+|-)\s+([\d.,]+|-)\s*$')
    ins, ultimo, comecou = {}, None, False
    for l in linhas:
        m = item.match(l)
        if m:
            comecou = True
            fam, _, c, desc, un, origem, sem, _com = m.groups()
            ultimo = cod(c)
            ins[ultimo] = {'descricao': desc, 'unidade': un.lower(), 'preco': num(sem), 'origem': origem, 'familia': cod(fam)}
        elif comecou and ultimo and l.startswith(' ' * 20) and not cabecalho_ou_vazio(l):
            ins[ultimo]['descricao'] += ' ' + l.strip()  # descrição que continua na linha de baixo
        elif cabecalho_ou_vazio(l):
            ultimo = None if not l.strip() else ultimo
    return ins, (num(enc.group(1)), num(enc.group(2))) if enc else (None, None), (int(mes.group(1)), int(mes.group(2))), (local.group(1).strip() if local else '')


def ler_custos(pdf):
    linhas = texto(pdf)
    linha = re.compile(r'^(\d{1,6})\s+(.*?)\s{2,}(\S+)\s+([\d.,]+|-)\s+(\S+)\s+([\d.,]+|-)\s+(\S+)\s*$')
    custos = {}
    for l in linhas:
        m = linha.match(l)
        if m:
            custos[cod(m.group(1))] = {'unidade': m.group(3).lower(), 'custo': num(m.group(4))}
    return custos


def ler_analitico(pdf):
    """Cada composição: linha com código, descrição, unidade e situação; depois os itens I (insumo) e C (composição)."""
    linhas = texto(pdf)
    comp_re = re.compile(r'^(\d{1,6})\s+(.*?)\s+(\S+)\s+(COM|SEM) CUSTO\s*$')
    fim_item = re.compile(r'^(.*?)\s+(\S+)\s+([\d.,]+)\s+(COM|SEM) (PREÇO|CUSTO)\s*$')
    ini_item = re.compile(r'^\s{0,3}(I|C)\s+(\d{1,6})(.*)$')
    grupo_re = re.compile(r'^Grupo (.+?)(?: - continuação)?\s*\(clique')
    comps, atual, item, grupo, alvo = {}, None, None, '', None
    for l in linhas:
        if not l.strip() or cabecalho_ou_vazio(l) and not ini_item.match(l):
            continue
        g = grupo_re.match(l.strip())
        if g:
            grupo = g.group(1).strip(); continue
        m = comp_re.match(l)
        if m and not ini_item.match(l):
            c = cod(m.group(1))
            if c in comps:
                # a CAIXA às vezes reparte os itens de uma composição em blocos (intercalados com outra): junta os blocos
                atual = comps[c]; item = None; alvo = None; continue
            atual = comps[c] = {'codigo': c, 'descricao': m.group(2), 'unidade': m.group(3).lower(), 'grupo': grupo, 'itens': []}
            item = None; alvo = atual; continue
        m = ini_item.match(l)
        if m and atual is not None:
            tipo, c, resto = m.groups()
            item = {'tipo': tipo, 'codigo': cod(c), 'descricao': '', 'unidade': '', 'qtd': None}
            atual['itens'].append(item); alvo = item
            f = fim_item.match(resto)
            if f:
                item.update(descricao=f.group(1).strip(), unidade=f.group(2).lower(), qtd=num(f.group(3)))
            else:
                item['descricao'] = resto.strip()
            continue
        # linha de continuação: descrição longa, ou o resto de um item cujo código veio sozinho na linha anterior
        if alvo is item and item is not None and item['qtd'] is None:
            f = fim_item.match(l)
            if f:
                item.update(descricao=(item['descricao'] + ' ' + f.group(1).strip()).strip(), unidade=f.group(2).lower(), qtd=num(f.group(3)))
                continue
        if alvo is not None and l.startswith(' ' * 5):
            alvo['descricao'] += ' ' + l.strip()
    return comps


def main():
    pasta, uf, destino = sys.argv[1], sys.argv[2].upper(), sys.argv[3]
    anterior = sys.argv[4] if len(sys.argv) > 4 else None
    achar = lambda prefixo: next((os.path.join(pasta, f) for f in sorted(os.listdir(pasta)) if f.startswith(prefixo) and f.endswith('.pdf')), None)
    p_ins, p_cus, p_ana = achar(f'SINAPI_Preco_Ref_Insumos_{uf}_'), achar(f'SINAPI_Custo_Ref_Composicoes_{uf}_'), achar('SINAPI_Analitico_Ref_Composicoes_')
    if not (p_ins and p_cus and p_ana):
        raise SystemExit(f'Faltam relatórios de {uf} em {pasta} (insumos: {p_ins}, custos: {p_cus}, analítico: {p_ana}).')
    insumos, (enc_h, enc_m), (mes, ano), local = ler_insumos(p_ins)
    # insumo sem preço coletado no estado: a CAIXA atribui o preço de São Paulo ("AS"; coluna %AS do relatório de custos)
    p_sp = achar('SINAPI_Preco_Ref_Insumos_SP_')
    sp = ler_insumos(p_sp)[0] if p_sp and uf != 'SP' else {}
    atribuidos = 0
    for c, i in insumos.items():
        if i['preco'] is None and sp.get(c, {}).get('preco') is not None:
            i['preco'] = sp[c]['preco']; i['origem'] = 'AS'; atribuidos += 1
    print(f'{atribuidos} insumos sem preço coletado no estado recebem o preço de São Paulo (AS), como a CAIXA faz' if sp else
          'aviso: relatório de insumos de SP não encontrado; insumos sem preço no estado ficam sem preço')
    custos = ler_custos(p_cus)
    comps = ler_analitico(p_ana)
    ref = f'{ano}-{mes:02d}'
    print(f'{local} {mes:02d}/{ano}: {len(insumos)} insumos, {len(custos)} custos de composição, {len(comps)} composições no analítico')

    # tipo dos insumos: do mês anterior; insumo novo, pela unidade e pela descrição
    tipos = {}
    if anterior:
        a = sqlite3.connect(anterior)
        for c, t, g in a.execute("SELECT codigo, tipo, grupo FROM insumo WHERE base = 'SINAPI' AND referencia = (SELECT MAX(referencia) FROM insumo WHERE base = 'SINAPI')"):
            tipos[c] = (t, g)
        a.close()

    def tipo_de(c, i):
        if c in tipos:
            return tipos[c]
        d = i['descricao'].upper()
        if i['unidade'] in ('h', 'mes') and not any(x in d for x in ('ALUGUEL', 'LOCACAO', 'EQUIPAMENTO')):
            return ('PESSOAL', 'Mão de obra - SINAPI')
        if any(x in d for x in ('LOCACAO', 'ALUGUEL', 'MAQUINA', 'CAMINHAO', 'TRATOR', 'BETONEIRA', 'COMPRESSOR')) and i['unidade'] in ('h', 'mes', 'dia'):
            return ('EQUIPAMENTOS', 'Equipamentos - SINAPI')
        return ('MATERIAIS', 'Materiais - SINAPI')

    # custo de cada item com os preços do estado; a conferência compara com o relatório de custos da CAIXA
    problemas, sem_preco_ref = [], set()
    for c, comp in comps.items():
        for it in comp['itens']:
            if it['qtd'] is None:
                problemas.append(f'{c}: item {it["codigo"]} sem coeficiente')
            if it['tipo'] == 'I':
                p = insumos.get(it['codigo'])
                if p is None:
                    sem_preco_ref.add(it['codigo'])  # a CAIXA não publicou preço deste insumo no estado
                it['custo_unit'] = p['preco'] if p else None
                it['secao'] = SECAO_DO_TIPO.get(tipo_de(it['codigo'], p or it)[0], 'MATERIAL')
            else:
                k = custos.get(it['codigo'])
                if k is None and it['codigo'] not in comps:
                    problemas.append(f'{c}: composição auxiliar {it["codigo"]} não encontrada')
                it['custo_unit'] = k['custo'] if k else None
                it['secao'] = 'SERVICO_AUXILIAR'
            it['custo_total'] = round(it['qtd'] * it['custo_unit'], 4) if it['qtd'] is not None and it['custo_unit'] is not None else None
    if sem_preco_ref:
        print(f'aviso: {len(sem_preco_ref)} insumos usados nas composições não aparecem no relatório de preços do estado (ficam sem preço)')
    if problemas:
        raise SystemExit('Leitura incompleta:\n' + '\n'.join(problemas[:30]) + (f'\n... e mais {len(problemas) - 30}' if len(problemas) > 30 else ''))

    # composição auxiliar sem custo publicado no estado: custo calculado pelos próprios itens (se todos tiverem preço)
    calc, pilha_c = {}, set()

    def custo_calculado(c):
        if c in calc:
            return calc[c]
        k = custos.get(c)
        if k and k['custo'] is not None:
            calc[c] = k['custo']; return calc[c]
        comp = comps.get(c)
        if comp is None or c in pilha_c:
            return None
        pilha_c.add(c)
        tot = 0.0
        for it in comp['itens']:
            u = it['custo_unit'] if it['tipo'] == 'I' else custo_calculado(it['codigo'])
            if u is None or it['qtd'] is None:
                tot = None; break
            tot += it['qtd'] * u
        pilha_c.discard(c)
        calc[c] = round(tot, 4) if tot is not None else None
        return calc[c]

    calculadas = 0
    for comp in comps.values():
        for it in comp['itens']:
            if it['tipo'] == 'C' and it['custo_unit'] is None:
                u = custo_calculado(it['codigo'])
                if u is not None:
                    it['custo_unit'] = u; it['calculado'] = True; calculadas += 1
                    it['custo_total'] = round(it['qtd'] * u, 4)
    print(f'{calculadas} itens usam composição auxiliar sem custo publicado no estado, com o custo calculado pelos itens dela')

    divergem, conferidas = [], 0
    for c, comp in comps.items():
        k = custos.get(c)
        oficial = k['custo'] if k else None
        if oficial is None:
            continue
        if any(it['custo_total'] is None for it in comp['itens']):
            divergem.append((c, 'item sem preço', oficial)); continue
        soma = sum(it['custo_total'] for it in comp['itens'])
        conferidas += 1
        # o relatório publica preços com 2 casas; a CAIXA calcula sem arredondar: tolera alguns centavos
        if abs(soma - oficial) > max(0.06, oficial * 0.003):
            divergem.append((c, round(soma, 2), oficial))
    com_falta = [x for x in divergem if x[1] == 'item sem preço']
    numericas = [x for x in divergem if x[1] != 'item sem preço']
    print(f'conferência: {conferidas} composições com todos os itens com preço; {len(numericas)} com soma diferente do relatório; '
          f'{len(com_falta)} com custo oficial mas algum item sem preço publicado no estado')
    for x in numericas[:12]:
        print('   ', x)

    # divisão do custo (mão de obra, material, equipamento, terceiros), descendo pelas composições auxiliares
    memo, pilha = {}, set()

    def dividir(c):
        if c in memo:
            return memo[c]
        comp = comps.get(c)
        if comp is None or c in pilha:
            return None
        pilha.add(c)
        d = {'e': 0.0, 'mo': 0.0, 'mat': 0.0, 't': 0.0}
        for it in comp['itens']:
            v = it['custo_total'] or 0
            if not v:
                continue
            if it['tipo'] == 'I':
                d[PARTE_DA_SECAO[it['secao']]] += v
            else:
                sub = dividir(it['codigo']); soma = sum(sub.values()) if sub else 0
                if soma:
                    for k2 in d:
                        d[k2] += v * sub[k2] / soma
                else:
                    d['mat'] += v
        pilha.discard(c)
        memo[c] = d
        return d

    if os.path.exists(destino):
        os.remove(destino)
    con = sqlite3.connect(destino)
    con.executescript(ESQUEMA)
    con.execute('INSERT INTO referencia VALUES (?, ?, ?, ?)', (ref, f'{MESES[mes - 1]}/{ano}', enc_h, enc_m))
    for c, i in insumos.items():
        t, g = tipo_de(c, i)
        con.execute('INSERT INTO insumo VALUES (?,?,?,?,?,?,?,?,?,?)', (BASE, c, ref, frase(i['descricao']), i['unidade'], i['preco'], i['origem'], t, g, ''))
    for c, comp in comps.items():
        k = custos.get(c)
        total = k['custo'] if k else None
        con.execute('INSERT INTO servico VALUES (?,?,?,?,?,?,?,?,?)', (BASE, c, ref, frase(comp['descricao']), comp['unidade'], total, 'SINAPI', comp['grupo'], ''))
        d = dividir(c) or {'e': 0, 'mo': 0, 'mat': 0, 't': 0}
        soma = sum(d.values())
        f = (total / soma) if total and soma else 0  # a divisão fecha com o custo oficial
        con.execute('INSERT INTO composicao VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
                    (BASE, c, ref, 'ANALITICA', comp['unidade'], None, enc_h, round(d['e'] * f, 4), round(d['mo'] * f, 4), 0.0,
                     round(d['mat'] * f, 4), round(d['t'] * f, 4), total))
        for n, it in enumerate(comp['itens'], 1):
            desc = it['descricao'] or (insumos.get(it['codigo'], {}).get('descricao') if it['tipo'] == 'I' else comps.get(it['codigo'], {}).get('descricao')) or ''
            desc = frase(desc)
            if it['tipo'] == 'I' and insumos.get(it['codigo'], {}).get('origem') == 'AS':
                desc += ' — preço de São Paulo (AS), sem coleta no estado'
            elif it.get('calculado'):
                desc += ' — custo calculado pelos itens (sem custo publicado no estado)'
            elif it['custo_unit'] is None:
                desc += ' — sem preço publicado pela CAIXA neste mês'
            con.execute('INSERT INTO composicao_item VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                        (BASE, c, ref, n, it['secao'], BASE, it['codigo'], int(it['tipo'] == 'C'), desc, it['unidade'], it['qtd'],
                         it['custo_unit'], None, None, None, None, it['custo_total']))
    con.commit()
    n = {t: con.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0] for t in ('insumo', 'servico', 'composicao', 'composicao_item')}
    sp = con.execute('SELECT COUNT(*) FROM servico WHERE preco IS NULL').fetchone()[0]
    print(f'SINAPI {uf} {MESES[mes - 1]}/{ano} ({ref}): {n}; composições sem custo no estado: {sp}')
    con.execute('VACUUM'); con.close()


if __name__ == '__main__':
    main()
