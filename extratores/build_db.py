import json, sqlite3, os
from pathlib import Path
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
# DADOS: pasta com os JSON extraídos das tabelas; S: pasta com comp_raw.json e comp_sinapi_raw.json; REF: AAAA-MM
D = os.environ.get('DADOS', str(Path(__file__).resolve().parents[1] / 'dados')) + '/'; S = os.environ['S']
REF = os.environ.get('REF', '2026-05')
CB = [('ORSE', json.load(open(S + '/comp_raw.json'))), ('SINAPI', json.load(open(S + '/comp_sinapi_raw.json')))]
L = lambda f: json.load(open(D + f))
oi, os_, si, ss = L(f'orse_insumos_{REF}.json'), L(f'orse_servicos_{REF}.json'), L(f'sinapi_insumos_{REF}.json'), L(f'sinapi_servicos_{REF}.json')
desc_ins = {('ORSE', x['codigo']): x['descricao'] for x in oi} | {('SINAPI', x['codigo']): x['descricao'] for x in si}
desc_srv = {'ORSE': {x['codigo']: x for x in os_}, 'SINAPI': {x['codigo']: x for x in ss}}
desc_srv['SINAPI'].update({x['codigo'].lstrip('0'): x for x in ss})
db = D + f'orse_sinapi_{REF}.sqlite'
if os.path.exists(db): os.remove(db)
con = sqlite3.connect(db); cur = con.cursor()
cur.executescript('''
CREATE TABLE referencia (id TEXT PRIMARY KEY, descricao TEXT, encargo_social_horista REAL);
CREATE TABLE insumo (base TEXT, codigo TEXT, referencia TEXT, descricao TEXT, unidade TEXT, preco REAL, marcador TEXT,
  tipo TEXT, grupo TEXT, subgrupo TEXT, PRIMARY KEY (base, codigo, referencia));
CREATE TABLE servico (base TEXT, codigo TEXT, referencia TEXT, descricao TEXT, unidade TEXT, preco REAL,
  tipo TEXT, grupo TEXT, subgrupo TEXT, PRIMARY KEY (base, codigo, referencia));
CREATE TABLE composicao (base TEXT, codigo TEXT, referencia TEXT, modelo TEXT, unidade TEXT, prod_equipe REAL, encargo_social REAL,
  custo_equipamento REAL, custo_mao_de_obra REAL, custo_encargo_social REAL, custo_material REAL, custo_servico_terceiro REAL,
  custo_total REAL, PRIMARY KEY (base, codigo, referencia));
CREATE TABLE composicao_item (composicao_base TEXT, composicao TEXT, referencia TEXT, ordem INTEGER, secao TEXT, base TEXT, codigo TEXT, eh_servico INTEGER,
  descricao TEXT, unidade TEXT, qtd REAL, custo_unit REAL, prod REAL, impr REAL, custo_prod REAL, custo_impr REAL, custo_total REAL);
CREATE INDEX ix_item_comp ON composicao_item(composicao_base, composicao, referencia);
CREATE INDEX ix_item_insumo ON composicao_item(base, codigo);
''')
cur.execute('INSERT INTO referencia VALUES (?,?,?)', (REF, os.environ.get('REF_DESCRICAO', 'maio/2026-1'), float(os.environ.get('ENCARGO_HORISTA', '111.51'))))
for base, rows in (('ORSE', oi), ('SINAPI', si)):
    cur.executemany('INSERT INTO insumo VALUES (?,?,?,?,?,?,?,?,?,?)', [(base, r['codigo'], REF, r['descricao'], r['unidade'], r['preco'], r['marcador'], r['tipo'], r['grupo'], r['subgrupo']) for r in rows])
for base, rows in (('ORSE', os_), ('SINAPI', ss)):
    cur.executemany('INSERT INTO servico VALUES (?,?,?,?,?,?,?,?,?)', [(base, r['codigo'], REF, r['descricao'], r['unidade'], r['preco'], r['tipo'], r['grupo'], r['subgrupo']) for r in rows])
wb = Workbook(write_only=True)
wc = wb.create_sheet('Composicoes'); wi = wb.create_sheet('Itens')
hc = ['Base', 'Código', 'Descrição', 'Unidade', 'Modelo', 'Prod. equipe', 'Encargo social %', 'Equipamento', 'Mão de obra', 'Encargo social', 'Material', 'Serv. terceiro', 'Custo total']
hi = ['Base comp.', 'Composição', 'Descrição da composição', 'Seção', 'Base', 'Código item', 'Descrição item', 'Unidade', 'Qtd', 'Custo unit.', 'Prod', 'Impr', 'Custo prod', 'Custo impr', 'Custo total']
wc.append(hc); wi.append(hi)
def sdesc(base, code):
    d = desc_srv[base]; return d.get(code) or d.get(code.lstrip('0')) or {}
for cb, C in CB:
  for c in C:
    r = c['resumo']; sv = sdesc(cb, c['codigo']); sd = sv.get('descricao', '')
    un = c['unidade'] or sv.get('unidade', '')
    cur.execute('INSERT INTO composicao VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', (cb, c['codigo'], REF, c['tipo'], un, c['prod_equipe'], c['encargo_social'],
        r['equipamento'], r['mao_de_obra'], r['encargo_social'], r['material'], r['servico_terceiro'], r['total']))
    wc.append([cb, c['codigo'], sd, un, c['tipo'], c['prod_equipe'], c['encargo_social'], r['equipamento'], r['mao_de_obra'], r['encargo_social'], r['material'], r['servico_terceiro'], r['total']])
    for k, i in enumerate(c['itens'], 1):
        aux = i['secao'] == 'SERVICO_AUXILIAR'
        d = (sdesc(i['base'], i['codigo']).get('descricao') if aux else desc_ins.get((i['base'], i['codigo']))) or i['descricao'].replace('\n', ' ')
        cur.execute('INSERT INTO composicao_item VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', (cb, c['codigo'], REF, k, i['secao'], i['base'], i['codigo'], int(aux), d, i['unidade'],
            i['qtd'], i.get('custo_unit'), i.get('prod'), i.get('impr'), i.get('custo_prod'), i.get('custo_impr'), i['custo_total']))
        wi.append([cb, c['codigo'], sd, i['secao'], i['base'], i['codigo'], d, i['unidade'], i['qtd'], i.get('custo_unit'), i.get('prod'), i.get('impr'), i.get('custo_prod'), i.get('custo_impr'), i['custo_total']])
con.commit()
for t in ('insumo', 'servico', 'composicao', 'composicao_item'): print(t, cur.execute(f'select count(*) from {t}').fetchone()[0])
con.close()
wb.save(D + f'composicoes_orse_sinapi_{REF}.xlsx')
