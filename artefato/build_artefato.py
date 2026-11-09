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
app = trocar(app, [
    ("const h = `#/${tipo === 'servico' ? 'composicao' : 'insumo'}/${base}/${codigo}`;",
     "const h = `#${tipo === 'servico' ? 'c' : 'i'}-${base}-${codigo}`;"),
    ("const emOrc = /^#\\/orcamento/.test(location.hash);", "const emOrc = /^#orc/.test(location.hash);"),
    ("const m = location.hash.match(/^#\\/(composicao|insumo)\\/(ORSE|SINAPI)\\/(\\w+)/);",
     "const m = location.hash.match(/^#(c|i)-(ORSE|SINAPI)-(\\w+)$/);"),
    ("const [, tipo, base, codigo] = m;", "const [, t, base, codigo] = m; const tipo = t === 'c' ? 'composicao' : 'insumo';"),
    ("href=\"#/${tipoLink === 'servico' ? 'composicao' : 'insumo'}/${esc(i.base)}/${esc(i.codigo)}\"",
     "href=\"#${tipoLink === 'servico' ? 'c' : 'i'}-${esc(i.base)}-${esc(i.codigo)}\""),
    ('<a class="botao" href="/api/exportar/composicao/${esc(c.base)}/${esc(c.codigo)}.xlsx?ref=${esc(c.referencia)}">Exportar Excel</a>\n'
     '        <button type="button" class="botao" onclick="window.print()">Imprimir ou PDF</button>',
     '<button type="button" class="botao" data-copiar>Copiar para o Excel</button>'),
    ('} catch (e) { alert(e.message); }', '} catch (e) { avisar(esc(e.message)); }'),
    ('href="#/composicao/${esc(u.base)}/${esc(u.codigo)}"', 'href="#c-${esc(u.base)}-${esc(u.codigo)}"'),
    ("const emVar = /^#\\/comparativo/.test(location.hash);", "const emVar = /^#comparativo/.test(location.hash);"),
    ("const emEnc = /^#\\/encargos/.test(location.hash);", "const emEnc = /^#encargos/.test(location.hash);"),
], 'app.js')

orc = (STATIC / 'orcamento.js').read_text(encoding='utf-8')
orc = re.sub(r'async function req\(url, metodo = .GET., corpo\) \{.*?\n\}\n',
             "async function req(url, metodo = 'GET', corpo) { return LOCAL.req(url, metodo, corpo || {}); }\n", orc, count=1, flags=re.S)
orc = trocar(orc, [
    ("location.hash.match(/^#\\/orcamento\\/(\\d+)(?:\\/(planilha|abc-servicos|abc-insumos))?/)",
     "location.hash.match(/^#orc-(\\d+)(?:-(planilha|abc-servicos|abc-insumos))?$/)"),
    ('href="#/orcamento/${o.id}/${k}"', 'href="#orc-${o.id}-${k}"'),
    ('<a class="botao primario" href="/api/orcamentos/${o.id}/exportar.xlsx">Exportar Excel</a>',
     '<button type="button" class="botao primario" data-copiar>Copiar para o Excel</button>'),
    ("""  $('#orc-excluir').addEventListener('click', async () => {
    if (!confirm(`Excluir o orçamento "${o.nome}"? Isso não pode ser desfeito.`)) return;""",
     """  $('#orc-excluir').addEventListener('click', async (ev) => {
    const bt = ev.currentTarget;
    if (bt.dataset.confirmar !== '1') {
      bt.dataset.confirmar = '1'; bt.textContent = 'Confirmar exclusão';
      setTimeout(() => { bt.dataset.confirmar = ''; bt.textContent = 'Excluir'; }, 5000); return;
    }"""),
    ("if (et.itens.length && !confirm(`Excluir a etapa \"${et.titulo}\" e seus ${et.itens.length} itens?`)) return;",
     "if (et.itens.length && b.dataset.confirmar !== '1') { b.dataset.confirmar = '1'; b.textContent = '?'; "
     "avisar(`Clique de novo no ✕ para excluir a etapa \"${esc(et.titulo)}\" e seus ${et.itens.length} itens.`); "
     "setTimeout(() => { b.dataset.confirmar = ''; b.textContent = '✕'; }, 5000); return; }"),
    ("href=\"#/${i.tipo === 'servico' ? 'composicao' : 'insumo'}/${esc(i.base)}/${esc(i.codigo)}\"",
     "href=\"#${i.tipo === 'servico' ? 'c' : 'i'}-${esc(i.base)}-${esc(i.codigo)}\""),
    ("href=\"#/${tipo === 'servicos' && l.tipo === 'servico' ? 'composicao' : 'insumo'}/${esc(l.base)}/${esc(l.codigo)}\"",
     "href=\"#${tipo === 'servicos' && l.tipo === 'servico' ? 'c' : 'i'}-${esc(l.base)}-${esc(l.codigo)}\""),
], 'orcamento.js')
orc = orc.replace('#/orcamento/${', '#orc-${').replace("'#/orcamentos'", "'#orcamentos'").replace('"#/orcamentos"', '"#orcamentos"')
orc = orc.replace("""<div class="orc-topo"><h2>Orçamentos</h2></div>""",
                  """<div class="orc-topo"><h2>Orçamentos</h2><p class="sub">Versão de teste: os orçamentos ficam salvos só neste navegador.</p></div>""")
assert '#/' not in orc.replace('#/orcamentos', ''), 'sobrou rota antiga em orcamento.js'
assert '#/' not in app.replace("'#/'", ''), 'sobrou rota antiga em app.js'

html = (STATIC / 'index.html').read_text(encoding='utf-8')
corpo = re.search(r'<body>(.*?)<script src=', html, re.S).group(1)
corpo = trocar(corpo, [
    ('<a href="#/" data-aba="consulta">', '<a href="#inicio" data-aba="consulta">'),
    ('<a href="#/orcamentos" data-aba="orcamentos">', '<a href="#orcamentos" data-aba="orcamentos">'),
    ('<a href="#/encargos" data-aba="encargos">', '<a href="#encargos" data-aba="encargos">'),
    ('<a href="#/comparativo" data-aba="comparativo">', '<a href="#comparativo" data-aba="comparativo">'),
    ('<a id="exportar-busca" class="link-acao" href="#" download>Exportar resultado</a>',
     '<button type="button" id="exportar-busca" class="link-acao" data-copiar-lista>Copiar para o Excel</button>'),
    ('e pode ser exportada para Excel.', 'e pode ser copiada para o Excel.'),
], 'index.html')
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
      const inp = td.querySelector('input');
      const t = inp ? inp.value : td.innerText;
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
    const tab = document.querySelector('#detalhe table.arvore, #detalhe table.planilha');
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
.orc-topo .sub { margin: -8px 0 14px; }
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
{copiar_js}
</script>
'''
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'index.html').write_text(pagina, encoding='utf-8')
print('página:', round(len(pagina.encode()) / 1024), 'KB')
