'use strict';
/* Mapa do orçamento: cada retângulo tem a área proporcional ao valor. Etapas por fora, subetapas e itens por dentro.
   Clicar numa etapa aproxima (o retângulo cresce até ocupar o mapa); o caminho no topo volta. Clicar num item leva à
   linha dele na planilha. */

const MAPA = { caminho: [], arvore: null, oid: null };
// cores das etapas: claras o bastante para o texto escuro e distintas entre si, nos dois temas
const MAPA_CORES = ['#F5B800', '#3987E5', '#199E70', '#D95926', '#9085E9', '#E0598B', '#2BA6B5', '#8D9B2F', '#C77D1E', '#5C6BC0', '#4E9F5D', '#B5568F'];

function arvoreDoOrcamento(o) {
  const raiz = { id: 'raiz', nome: o.nome, valor: 0, filhos: [] };
  const porId = new Map();
  o.etapas.forEach((e) => {
    const no = { id: `e${e.id}`, nome: e.titulo, numero: e.numero, valor: 0, filhos: [], etapa: true };
    porId.set(e.id, no);
    const pai = e.pai_id ? porId.get(e.pai_id) : raiz;
    (pai || raiz).filhos.push(no);
    e.itens.forEach((i) => { if (i.total > 0) no.filhos.push({ id: `i${i.id}`, nome: i.descricao, numero: i.numero, valor: i.total, item: i }); });
  });
  const somar = (n) => { if (n.filhos && n.filhos.length) n.valor = n.filhos.reduce((s, f) => s + somar(f), 0); return n.valor; };
  somar(raiz);
  const limpar = (n) => { if (n.filhos) { n.filhos = n.filhos.filter((f) => f.valor > 0).sort((a, b) => b.valor - a.valor); n.filhos.forEach(limpar); } };
  limpar(raiz);
  return raiz;
}

// treemap "squarified" (Bruls, Huizing e van Wijk): retângulos o mais próximo possível de quadrados
function quadricular(filhos, x, y, w, h) {
  const total = filhos.reduce((s, f) => s + f.valor, 0);
  if (!total || w <= 0 || h <= 0) return [];
  const area = (w * h) / total, saida = [];
  let resto = filhos.map((f) => ({ f, a: f.valor * area }));
  const pior = (linha, lado) => {
    const s = linha.reduce((t, r) => t + r.a, 0), mx = Math.max(...linha.map((r) => r.a)), mn = Math.min(...linha.map((r) => r.a));
    return Math.max((lado * lado * mx) / (s * s), (s * s) / (lado * lado * mn));
  };
  while (resto.length) {
    const lado = Math.min(w, h);
    let linha = [resto[0]], k = 1;
    while (k < resto.length && pior([...linha, resto[k]], lado) <= pior(linha, lado)) { linha.push(resto[k]); k += 1; }
    const s = linha.reduce((t, r) => t + r.a, 0);
    if (w >= h) { // coluna à esquerda
      const cw = s / h; let cy = y;
      linha.forEach((r) => { const ch = r.a / cw; saida.push({ f: r.f, x, y: cy, w: cw, h: ch }); cy += ch; });
      x += cw; w -= cw;
    } else { // faixa no topo
      const ch = s / w; let cx = x;
      linha.forEach((r) => { const cw = r.a / ch; saida.push({ f: r.f, x: cx, y, w: cw, h: ch }); cx += cw; });
      y += ch; h -= ch;
    }
    resto = resto.slice(k);
  }
  return saida;
}

function noAtual() {
  let n = MAPA.arvore;
  for (const id of MAPA.caminho) { const f = (n.filhos || []).find((x) => x.id === id); if (!f) { MAPA.caminho = []; return MAPA.arvore; } n = f; }
  return n;
}

window.desenharMapa = function (o, animarDe) {
  const corpo = $('#orc-corpo'); if (!corpo) return;
  if (MAPA.oid !== o.id) { MAPA.caminho = []; MAPA.oid = o.id; }
  MAPA.arvore = arvoreDoOrcamento(o);
  if (!MAPA.arvore.valor) { corpo.innerHTML = vazio('grafico', 'O mapa aparece quando houver itens com valor', 'Adicione composições ou insumos na aba Planilha.'); return; }
  const atual = noAtual(), total = MAPA.arvore.valor;
  // cores pelo nível que está à vista: cada parte do que se vê tem a sua, e o que fica dentro dela herda
  (atual.filhos || []).forEach((f, k) => { const pintar = (n) => { n.cor = MAPA_CORES[k % MAPA_CORES.length]; (n.filhos || []).forEach(pintar); }; pintar(f); });
  const trilha = [['raiz', o.nome]];
  let n = MAPA.arvore;
  for (const id of MAPA.caminho) { n = n.filhos.find((x) => x.id === id); trilha.push([id, `${n.numero}. ${n.nome}`]); }
  corpo.innerHTML = `
    <div class="mapa-cab">
      <nav class="mapa-trilha" aria-label="Caminho no mapa">${trilha.map(([id, nome], k) => k < trilha.length - 1
        ? `<button type="button" data-mapa-ir="${k}">${esc(nome)}</button><span aria-hidden="true">›</span>` : `<b>${esc(nome)}</b>`).join('')}</nav>
      <p class="mapa-soma"><b>${brl.format(atual.valor)}</b>${atual === MAPA.arvore ? ' no total' : ` · ${pct.format(atual.valor / total)} do orçamento`}</p>
    </div>
    <div class="mapa" id="mapa" role="group" aria-label="Mapa do orçamento: área de cada retângulo proporcional ao valor"></div>
    <p class="fonte mapa-fonte">A área de cada retângulo é proporcional ao valor${o.bdi_no_total ? ' (a custo, sem BDI)' : ' com BDI'}. Clique numa etapa para aproximar; clique num item para vê-lo na planilha. <kbd>Esc</kbd> volta um nível.</p>`;
  const caixa = $('#mapa'), W = caixa.clientWidth, H = caixa.clientHeight;
  const blocos = quadricular(atual.filhos || [], 0, 0, W, H);
  const html = blocos.map(({ f, x, y, w, h }) => {
    const grande = w > 90 && h > 44, temFilhos = !!(f.filhos && f.filhos.length);
    const dentro = temFilhos && w > 60 && h > 60 ? quadricular(f.filhos, 4, grande ? 40 : 4, w - 8, h - (grande ? 44 : 8)) : [];
    return `<${temFilhos ? 'button type="button"' : 'button type="button"'} class="mapa-no${temFilhos ? ' grupo' : ' folha'}" data-mapa-no="${f.id}"
        style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;--cor:${f.cor}"
        aria-label="${esc(`${f.numero}. ${f.nome}`)}: ${brl.format(f.valor)}, ${pct.format(f.valor / total)} do total${temFilhos ? '. Aproximar' : '. Ver na planilha'}">
      ${grande ? `<span class="mapa-rot"><b>${esc(f.numero)}</b> ${esc(f.nome)}</span><span class="mapa-val">${brl.format(f.valor)} · ${pct.format(f.valor / total)}</span>` : ''}
      ${dentro.map((d) => `<i class="mapa-sub" style="left:${d.x}px;top:${d.y}px;width:${d.w}px;height:${d.h}px"></i>`).join('')}
    </button>`;
  }).join('');
  caixa.innerHTML = `<div class="mapa-camada">${html}</div><div class="mapa-dica" id="mapa-dica" hidden></div>`;
  // aproximar: a nova camada nasce no lugar e no tamanho do retângulo clicado e cresce até ocupar o mapa
  const camada = caixa.firstElementChild;
  if (animarDe && !semMovimento()) {
    const { x, y, w, h } = animarDe;
    camada.style.transformOrigin = '0 0';
    camada.style.transform = `translate(${x}px, ${y}px) scale(${w / W}, ${h / H})`; camada.style.opacity = '0.4';
    void camada.offsetWidth;
    camada.style.transition = `transform 420ms ${getComputedStyle(document.documentElement).getPropertyValue('--suave') || 'ease'}, opacity 300ms`;
    camada.style.transform = 'none'; camada.style.opacity = '1';
  } else if (!semMovimento()) camada.classList.add('mapa-entra');
  ligarMapa(o);
};

function ligarMapa(o) {
  const caixa = $('#mapa'), dica = $('#mapa-dica'), total = MAPA.arvore.valor;
  const mostrar = (el, ev) => {
    const f = (noAtual().filhos || []).find((x) => x.id === el.dataset.mapaNo); if (!f) return;
    dica.innerHTML = `<b>${esc(f.numero)} ${esc(f.nome)}</b><span>${brl.format(f.valor)} · ${pct.format(f.valor / total)} do orçamento${MAPA.caminho.length ? ` · ${pct.format(f.valor / noAtual().valor)} desta etapa` : ''}</span>
      ${f.filhos ? `<span>${f.filhos.length} ${f.filhos.length === 1 ? 'parte' : 'partes'} · clique para aproximar</span>` : f.item ? `<span>${esc(qtdFmt.format(f.item.quantidade))} ${esc(f.item.unidade)} × ${brl.format(f.item.preco_unit)}</span>` : ''}`;
    dica.hidden = false;
    const rc = caixa.getBoundingClientRect(), r = el.getBoundingClientRect();
    const px = ev && ev.clientX ? ev.clientX - rc.left : r.left - rc.left + r.width / 2, py = ev && ev.clientY ? ev.clientY - rc.top : r.top - rc.top + r.height / 2;
    dica.style.left = `${Math.min(px + 14, rc.width - dica.offsetWidth - 4)}px`; dica.style.top = `${py + 16 + dica.offsetHeight > rc.height ? Math.max(4, py - dica.offsetHeight - 10) : py + 16}px`;
  };
  caixa.addEventListener('mousemove', (e) => { const el = e.target.closest('[data-mapa-no]'); if (el) mostrar(el, e); else dica.hidden = true; });
  caixa.addEventListener('mouseleave', () => { dica.hidden = true; });
  caixa.addEventListener('focusin', (e) => { const el = e.target.closest('[data-mapa-no]'); if (el) mostrar(el); });
  caixa.addEventListener('focusout', () => { dica.hidden = true; });
  caixa.addEventListener('click', (e) => {
    const el = e.target.closest('[data-mapa-no]'); if (!el) return;
    const f = (noAtual().filhos || []).find((x) => x.id === el.dataset.mapaNo); if (!f) return;
    if (f.filhos && f.filhos.length) {
      const rc = caixa.getBoundingClientRect(), r = el.getBoundingClientRect();
      MAPA.caminho.push(f.id);
      window.desenharMapa(o, { x: r.left - rc.left, y: r.top - rc.top, w: r.width, h: r.height });
      const prim = $('#mapa [data-mapa-no]'); if (prim) prim.focus({ preventScroll: true });
    } else if (f.item) {
      ORC.destaque = `${f.item.tipo}|${f.item.base}|${f.item.codigo}`; ORC.recolhidas.clear(); gravarRecolhidas();
      location.hash = rotaOrc(o.id, 'planilha');
      setTimeout(() => { const tr = document.querySelector(`tr.item[data-item="${f.item.id}"]`); if (tr) tr.scrollIntoView({ block: 'center', behavior: semMovimento() ? 'auto' : 'smooth' }); }, 350);
    }
  });
  $('.mapa-trilha').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mapa-ir]'); if (!b) return;
    MAPA.caminho = MAPA.caminho.slice(0, Number(b.dataset.mapaIr)); window.desenharMapa(o);
  });
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('#mapa') && MAPA.caminho.length && !document.querySelector('dialog[open]')) {
    MAPA.caminho.pop(); window.desenharMapa(ORC.atual); const prim = $('#mapa [data-mapa-no]'); if (prim) prim.focus({ preventScroll: true });
  }
});
let mapaLarg = 0;
window.addEventListener('resize', () => { const m = $('#mapa'); if (m && ORC.atual && Math.abs(m.clientWidth - mapaLarg) > 20) { mapaLarg = m.clientWidth; window.desenharMapa(ORC.atual); } });
