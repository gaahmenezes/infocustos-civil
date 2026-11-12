'use strict';
/* Paleta de comandos (Ctrl+K ou Cmd+K): acha itens, abre orçamentos e executa ações sem tirar a mão do teclado. */

const PAL = { itens: [], sel: 0, seq: 0, orcs: null, t: 0 };
const palDlg = $('#dlg-paleta'), palQ = $('#paleta-q'), palLista = $('#paleta-lista');
const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function acoesDaPaleta() {
  const meses = [...((estado.ref && estado.ref.referencias) || [])].reverse();
  const ir = (h) => () => { location.hash = h; };
  return [
    { grupo: 'Ações', rotulo: 'Novo orçamento', dica: 'criar', acao: () => { location.hash = '#/orcamentos'; setTimeout(() => window.abrirNovoOrcamento && window.abrirNovoOrcamento(), 60); } },
    { grupo: 'Ir para', rotulo: 'Consulta', dica: 'pesquisar composições e insumos', acao: () => { location.hash = '#/'; setTimeout(() => $('#q').focus(), 60); } },
    { grupo: 'Ir para', rotulo: 'Orçamentos', dica: 'lista de orçamentos', acao: ir('#/orcamentos') },
    { grupo: 'Ações', rotulo: 'Nova composição própria', dica: 'montar com itens de qualquer base', acao: () => { location.hash = '#/proprias'; setTimeout(() => { const b = document.querySelector('[data-nova-propria]'); if (b) b.click(); }, 300); } },
    { grupo: 'Ir para', rotulo: 'Composições próprias', dica: 'composições e insumos da empresa', acao: ir('#/proprias') },
    { grupo: 'Ir para', rotulo: 'Encargos sociais', dica: 'horistas e mensalistas', acao: ir('#/encargos') },
    { grupo: 'Ir para', rotulo: 'Comparativo entre meses', dica: 'variação de preços', acao: ir('#/comparativo') },
    { grupo: 'Ir para', rotulo: 'Apresentação do InfoCustos Civil', dica: 'o que o sistema faz', acao: ir('#/apresentacao') },
    { grupo: 'Ações', rotulo: temaAtual() === 'dark' ? 'Usar tema claro' : 'Usar tema escuro', dica: 'aparência', acao: () => $('#tema').click() },
    ...(estado.ref && estado.ref.protegido ? [{ grupo: 'Ações', rotulo: 'Sair', dica: 'encerrar a sessão neste navegador', acao: () => fetch('/api/sair', { method: 'POST' }).finally(() => { location.href = '/entrar'; }) }] : []),
    ...basesCarregadas().flatMap((b) => mesesDaBase(b).filter((m) => m.id !== estado.meses[b]).map((m) => ({ grupo: 'Data-base', rotulo: `${b}: ver preços de ${m.descricao.replace(/-1$/, '')}`, dica: 'trocar o mês desta base', acao: () => trocarMes(m.id, b) }))),
  ];
}

function desenharPaleta() {
  let grupo = '';
  palLista.innerHTML = PAL.itens.length ? PAL.itens.map((x, k) => {
    const cab = x.grupo !== grupo ? `<li class="paleta-grupo" role="presentation">${esc(x.grupo)}</li>` : ''; grupo = x.grupo;
    return `${cab}<li role="option" id="pal-${k}" data-k="${k}" aria-selected="${k === PAL.sel}">
      ${x.codigo ? codigoBase(x.codigo, x.base) : ''}<span class="paleta-rotulo">${esc(x.rotulo)}</span><span class="paleta-dica">${x.dicaHtml || esc(x.dica || '')}</span></li>`;
  }).join('') : `<li class="paleta-vazio">Nada encontrado para "${esc(palQ.value.trim())}".</li>`;
  palQ.setAttribute('aria-activedescendant', PAL.itens.length ? `pal-${PAL.sel}` : '');
  const s = palLista.querySelector('[aria-selected="true"]'); if (s) s.scrollIntoView({ block: 'nearest' });
}

async function filtrarPaleta() {
  const q = palQ.value.trim(), termo = semAcento(q), meu = ++PAL.seq;
  const acoes = acoesDaPaleta().filter((a) => !termo || semAcento(`${a.rotulo} ${a.dica} ${a.grupo}`).includes(termo));
  const orcs = (PAL.orcs || []).filter((o) => !termo || semAcento(`${o.nome} ${o.cliente} ${o.local}`).includes(termo)).slice(0, termo ? 5 : 3)
    .map((o) => ({ grupo: 'Orçamentos', rotulo: o.nome, dicaHtml: `${brl.format(o.total)}`, acao: () => { location.hash = rotaOrc(o.id); } }));
  PAL.itens = [...(termo ? [] : acoes.slice(0, 1)), ...orcs, ...(termo ? acoes : acoes.slice(1))]; PAL.sel = 0; desenharPaleta();
  if (q.length < 2) return;
  try {
    const r = await api(`/api/busca?${new URLSearchParams({ q, base: 'todas', tipo: 'todos', limite: 6, refs: refsQs(), bases: basesQs() })}`);
    if (meu !== PAL.seq) return;
    const itens = r.itens.map((x) => ({ grupo: 'Composições e insumos', rotulo: x.descricao, codigo: x.codigo, base: x.base,
      dicaHtml: `${x.preco == null ? 'sem preço' : brl.format(x.preco)}${x.unidade ? `<span class="un">${unid(x.unidade)}</span>` : ''}`,
      acao: () => abrir(x.tipo, x.base, x.codigo) }));
    // itens da base primeiro: é o que mais se procura
    PAL.itens = [...itens, ...orcs, ...acoes]; PAL.sel = 0; desenharPaleta();
  } catch (_) { /* fica só com ações e orçamentos */ }
}

window.abrirPaleta = async function () {
  if (palDlg.open) return;
  palQ.value = ''; PAL.itens = []; palDlg.showModal(); palQ.focus(); filtrarPaleta();
  try { PAL.orcs = await api('/api/orcamentos'); if (palDlg.open && !palQ.value.trim()) filtrarPaleta(); } catch (_) { PAL.orcs = []; }
};
function executarPaleta(k) { const x = PAL.itens[k]; if (!x) return; palDlg.close(); x.acao(); }

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); window.abrirPaleta(); }
});
document.addEventListener('click', (e) => { if (e.target.closest('[data-paleta]')) window.abrirPaleta(); });
palQ.addEventListener('input', () => { clearTimeout(PAL.t); PAL.t = setTimeout(filtrarPaleta, 110); });
palQ.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); const n = PAL.itens.length; if (!n) return;
    PAL.sel = (PAL.sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n; desenharPaleta();
  }
  if (e.key === 'Enter') { e.preventDefault(); executarPaleta(PAL.sel); }
});
palLista.addEventListener('click', (e) => { const li = e.target.closest('li[data-k]'); if (li) executarPaleta(Number(li.dataset.k)); });
palLista.addEventListener('pointermove', (e) => {
  const li = e.target.closest('li[data-k]'); if (!li || Number(li.dataset.k) === PAL.sel) return;
  palLista.querySelectorAll('[aria-selected="true"]').forEach((x) => x.setAttribute('aria-selected', 'false'));
  PAL.sel = Number(li.dataset.k); li.setAttribute('aria-selected', 'true');
});
// clicar fora da caixa fecha
palDlg.addEventListener('click', (e) => { if (e.target === palDlg) palDlg.close(); });
