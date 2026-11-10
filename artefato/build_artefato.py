"""Monta a página do artefato a partir da interface do app (app/static), trocando o servidor pela camada local.

Uso: python3 build_artefato.py saida/   (depois de build_dados.py)
"""
import re
import sys
from pathlib import Path

AQUI = Path(__file__).parent
STATIC = AQUI.parent / 'app' / 'static'
OUT = Path(sys.argv[1] if len(sys.argv) > 1 else AQUI / 'saida')


def trocar(texto, pares, nome):
    for velho, novo in pares:
        if velho not in texto:
            raise SystemExit(f'[{nome}] trecho não encontrado: {velho[:80]!r}')
        texto = texto.replace(velho, novo)
    return texto


app = (STATIC / 'app.js').read_text(encoding='utf-8')
app = re.sub(r'async function api\(url\) \{.*?\n\}\n', 'async function api(url) { return LOCAL.req(url); }\n', app, count=1, flags=re.S)
# no artefato não há download de arquivo: o menu "Exportar" vira "Copiar para o Excel"
app, n = re.subn(r'/\*EXPORTAR-COMP\*/.*?/\*FIM-EXPORTAR-COMP\*/',
                 "function exportarComposicao() { return '<button type=\"button\" class=\"botao\" data-copiar>Copiar para o Excel</button>'; }",
                 app, count=1, flags=re.S)
assert n == 1, 'menu de exportação não encontrado em app.js'
app = trocar(app, [
    ("const rotaItem = (tipo, base, codigo) => `#/${tipo === 'servico' ? 'composicao' : 'insumo'}/${base}/${codigo}`;",
     "const rotaItem = (tipo, base, codigo) => `#${tipo === 'servico' ? 'c' : 'i'}-${base}-${codigo}`;"),
    ("const rotaComparar = (lista) => `#/comparar/${lista.map((x) => `${x.base}-${x.codigo}`).join(',')}`;",
     "const rotaComparar = (lista) => `#comparar=${lista.map((x) => `${x.base}-${x.codigo}`).join(',')}`;"),
    ("const m = location.hash.match(/^#\\/comparar\\/(.+)/); return m ? m[1] : null;",
     "const m = location.hash.match(/^#comparar=(.+)/); return m ? m[1] : null;"),
    ("const rotaOrc = (id, aba) => `#/orcamento/${id}${aba ? '/' + aba : ''}`;",
     "const rotaOrc = (id, aba) => `#orc-${id}${aba ? '-' + aba : ''}`;"),
    ("const emOrc = /^#\\/orcamento/.test(location.hash);", "const emOrc = /^#orc/.test(location.hash);"),
    ("const m = location.hash.match(/^#\\/(composicao|insumo)\\/(ORSE|SINAPI)\\/(\\w+)/);",
     "const m = location.hash.match(/^#(c|i)-(ORSE|SINAPI)-(\\w+)$/);"),
    ("const [, tipo, base, codigo] = m;", "const [, t, base, codigo] = m; const tipo = t === 'c' ? 'composicao' : 'insumo';"),
    ("const emVar = /^#\\/comparativo/.test(location.hash);", "const emVar = /^#comparativo/.test(location.hash);"),
    ("const emEnc = /^#\\/encargos/.test(location.hash);", "const emEnc = /^#encargos/.test(location.hash);"),
    ("const emAp = /^#\\/apresentacao/.test(location.hash);", "const emAp = /^#apresentacao/.test(location.hash);"),
], 'app.js')
app = app.replace('href="#/orcamentos"', 'href="#orcamentos"')

orc = (STATIC / 'orcamento.js').read_text(encoding='utf-8')
orc = re.sub(r'async function req\(url, metodo = .GET., corpo\) \{.*?\n\}\n',
             "async function req(url, metodo = 'GET', corpo) { return LOCAL.req(url, metodo, corpo || {}); }\n", orc, count=1, flags=re.S)
orc = trocar(orc, [
    ("location.hash.match(/^#\\/orcamento\\/(\\d+)(?:\\/(planilha|abc-servicos|abc-insumos|relatorio))?/)",
     "location.hash.match(/^#orc-(\\d+)(?:-(planilha|abc-servicos|abc-insumos|relatorio))?$/)"),
    ('`<a role="menuitem" href="/api/orcamentos/${o.id}/exportar.xlsx">Planilha do Excel (.xlsx)</a>`',
     "'<button type=\"button\" role=\"menuitem\" data-copiar>Copiar para o Excel</button>'"),
    ('<div><h1>Orçamentos</h1><p class="sub" id="orc-resumo"></p></div>',
     '<div><h1>Orçamentos</h1><p class="sub" id="orc-resumo"></p><p class="sub nota-teste">Versão de teste: os orçamentos ficam salvos só neste navegador.</p></div>'),
], 'orcamento.js')
orc = orc.replace("'#/orcamentos'", "'#orcamentos'").replace('"#/orcamentos"', '"#orcamentos"')
# telas novas: painel do orçamento, comparação e relatório (usam as rotas e as funções já trocadas acima)
extras = ''
for nome in ('movimento.js', 'painel.js', 'comparar.js', 'relatorio.js', 'paleta.js', 'apresentacao.js'):
    t = (STATIC / nome).read_text(encoding='utf-8').replace('href="#/"', 'href="#inicio"')
    t = t.replace('href="#/orcamentos"', 'href="#orcamentos"')
    for velho, novo in (("'#/orcamentos'", "'#orcamentos'"), ("'#/encargos'", "'#encargos'"), ("'#/comparativo'", "'#comparativo'"), ("'#/apresentacao'", "'#apresentacao'"), ("'#/'", "'#inicio'")):
        t = t.replace(velho, novo)
    assert '#/' not in t, f'sobrou rota antiga em {nome}'
    extras += f'\n/* ---- {nome} ---- */\n' + t
assert '#/' not in orc, 'sobrou rota antiga em orcamento.js'
assert '#/' not in app.replace("'#/'", ''), 'sobrou rota antiga em app.js'

html = (STATIC / 'index.html').read_text(encoding='utf-8')
corpo = re.search(r'<body[^>]*>(.*?)<script src=', html, re.S).group(1)
# o esqueleto do artefato traz o próprio <body>: aplica o estado inicial (busca vazia) antes da primeira pintura
corpo = "<script>document.body.classList.add('ocioso')</script>\n" + corpo
corpo = trocar(corpo, [
    ('<a href="#/" data-aba="consulta">', '<a href="#inicio" data-aba="consulta">'),
    ('<a href="#/orcamentos" data-aba="orcamentos">', '<a href="#orcamentos" data-aba="orcamentos">'),
    ('<a href="#/encargos" data-aba="encargos">', '<a href="#encargos" data-aba="encargos">'),
    ('<a href="#/comparativo" data-aba="comparativo">', '<a href="#comparativo" data-aba="comparativo">'),
    ('<a id="exportar-busca" class="link-acao" href="#" download>Exportar resultado</a>',
     '<button type="button" id="exportar-busca" class="link-acao" data-copiar-lista>Copiar para o Excel</button>'),
], 'index.html')
corpo = (corpo.replace('href="#/orcamentos"', 'href="#orcamentos"').replace('href="#/encargos"', 'href="#encargos"')
         .replace('href="#/comparativo"', 'href="#comparativo"').replace('href="#/apresentacao"', 'href="#apresentacao"').replace('href="#/"', 'href="#inicio"'))
assert 'href="#/' not in corpo, 'sobrou rota antiga no HTML'
corpo += '''
  <dialog id="dlg-copiar" class="dialogo" aria-labelledby="dlg-copiar-t">
    <form method="dialog">
      <h2 id="dlg-copiar-t">Copie a tabela</h2>
      <p class="sub">Este navegador não deixou copiar sozinho. O texto abaixo já está selecionado: aperte Ctrl+C (ou Cmd+C) e cole no Excel.</p>
      <textarea id="copiar-texto" rows="10" readonly></textarea>
      <div class="dlg-acoes"><button class="botao primario" value="ok">Fechar</button></div>
    </form>
  </dialog>
'''

copiar_js = r'''
/* "Copiar para o Excel": copia a tabela que está na tela em texto separado por tabulação. */
function tabelaParaTexto(tab) {
  const linhas = [];
  tab.querySelectorAll('tr').forEach((tr) => {
    if (tr.hidden || tr.classList.contains('add-linha')) return;
    const cel = [...tr.children].map((td) => {
      const inp = td.querySelector('input'), cb = td.querySelector('.cb');
      const t = inp ? inp.value : cb ? `${cb.querySelector('.cb-num').textContent}/${cb.querySelector('.cb-base').textContent}` : td.innerText;
      return t.replace(/\s+/g, ' ').replace(/[↑↓✕+−?]/g, '').trim();
    });
    if (cel.some(Boolean)) linhas.push(cel.join('\t'));
  });
  return linhas.join('\n');
}
async function copiarTexto(texto, rotulo) {
  try { await navigator.clipboard.writeText(texto); avisar(`${rotulo} copiada. Cole no Excel com Ctrl+V.`); }
  catch (_) { const d = $('#dlg-copiar'); $('#copiar-texto').value = texto; d.showModal(); $('#copiar-texto').select(); }
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-copiar]')) {
    const tab = document.querySelector('#detalhe table.arvore, #detalhe table.planilha, #detalhe table.uso');
    if (!tab) return;
    const cab = document.querySelector('#detalhe h2, #detalhe .orc-nome');
    const titulo = cab ? (cab.value || cab.innerText) : '';
    copiarTexto((titulo ? titulo + '\n' : '') + tabelaParaTexto(tab), 'Tabela');
  }
  if (e.target.closest('[data-copiar-lista]')) {
    const linhas = estado.itens.map((i) => [i.tipo === 'servico' ? 'Serviço' : 'Insumo', i.base, i.codigo, i.descricao, i.unidade,
      i.preco == null ? '' : num2.format(i.preco), i.grupo || ''].join('\t'));
    copiarTexto(['Tipo\tBase\tCódigo\tDescrição\tUn.\tPreço (R$)\tGrupo', ...linhas].join('\n'), 'Lista');
  }
});
'''

css = (STATIC / 'styles.css').read_text(encoding='utf-8')
css = css.replace('html, body { margin: 0; height: 100%; }', 'html, body { margin: 0; height: 100%; }\nbody { min-height: 0; }')
css += '''
button.link-acao { border: 0; background: none; cursor: pointer; padding: 0; font: inherit; font-size: 13px; }
#copiar-texto { width: 100%; font: 13px/1.4 ui-monospace, Menlo, Consolas, monospace; background: var(--concreto); color: var(--tinta);
  border: 1px solid var(--linha-forte); border-radius: var(--raio); padding: 8px; }
.nota-teste { margin-top: 2px; font-size: 12.5px; color: var(--tinta-3); }
'''

local = (AQUI / 'local.js').read_text(encoding='utf-8')
fontes = re.search(r'(<link rel="preconnect".*?rel="stylesheet">)\n', html, re.S).group(1)
pagina = f'''<title>InfoCustos Civil</title>
{fontes}
<style>
{css}
</style>
{corpo}
<script>
{local}
</script>
<script>
{app}
</script>
<script>
{orc}
{extras}
{copiar_js}
</script>
'''
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'index.html').write_text(pagina, encoding='utf-8')
print('página:', round(len(pagina.encode()) / 1024), 'KB')
