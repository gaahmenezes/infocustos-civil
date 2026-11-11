'use strict';
/* Fluxo do custo: de onde vem o preço da composição. Cada faixa sai de um item, passa pela sua seção
   (equipamento, mão de obra, material...) e chega ao preço; a espessura é proporcional ao valor. */

const FLUXO = { c: null, dados: null, obs: null };
const MAX_LINHAS = 12;

function dadosDoFluxo(c) {
  const dnit = c.modelo === 'DNIT';
  // no DNIT, equipamento e mão de obra são custo horário da equipe: entram divididos pela produção
  const valor = (i) => {
    const v = i.custo_total || 0;
    return dnit && c.prod_equipe && (i.secao === 'EQUIPAMENTO' || i.secao === 'MAO_DE_OBRA') ? v / c.prod_equipe : v;
  };
  let itens = c.itens.map((i) => ({ i, v: valor(i) })).filter((x) => x.v > 0);
  const bruto = itens.reduce((s, x) => s + x.v, 0);
  if (!bruto || !c.custo_total) return null;
  const k = c.custo_total / bruto;                  // a soma das faixas fecha com o preço da base
  itens.forEach((x) => { x.v *= k; });
  // só os maiores ganham linha própria; o resto de cada seção vira uma faixa "outros"
  const maiores = new Set([...itens].sort((a, b) => b.v - a.v).slice(0, MAX_LINHAS));
  const secoes = SECOES.map(([chave, nome, cor]) => {
    const meus = itens.filter((x) => x.i.secao === chave).sort((a, b) => b.v - a.v);
    if (!meus.length) return null;
    const linhas = meus.filter((x) => maiores.has(x)).map((x) => ({ v: x.v, item: x.i }));
    const resto = meus.filter((x) => !maiores.has(x));
    if (resto.length === 1) linhas.push({ v: resto[0].v, item: resto[0].i });
    else if (resto.length) linhas.push({ v: resto.reduce((s, x) => s + x.v, 0), outros: resto.length });
    return { chave, nome, cor, linhas, v: meus.reduce((s, x) => s + x.v, 0) };
  }).filter(Boolean);
  return { secoes, total: c.custo_total, ajustado: Math.abs(k - 1) > 0.01, n: itens.length };
}

function htmlFluxo(c) {
  const d = dadosDoFluxo(c); FLUXO.c = c; FLUXO.dados = d;
  if (!d) return '<p class="sub fluxo-vazio">Esta composição não traz custos por item para desenhar o fluxo.</p>';
  let n = 0;
  const linhas = d.secoes.map((s, si) => s.linhas.map((l) => {
    const id = n++, p = pct.format(l.v / d.total);
    const sub = !l.outros && l.item.tem_composicao;
    const dentro = `<span class="fx-txt"><span class="fx-desc">${l.outros ? `Outros ${l.outros} itens de ${esc(s.nome.toLowerCase())}` : esc(l.item.descricao)}</span>${
      sub ? '<span class="fx-sub">composição auxiliar</span>' : ''}</span>
      <span class="fx-val"><b>${brl.format(l.v)}</b> ${p}</span>`;
    const attrs = `class="fx-linha" data-l="${id}" data-s="${si}" style="--cor:var(${s.cor})"`;
    if (l.outros) return `<button type="button" ${attrs} data-fx-tabela="${s.chave}" title="Ver estes itens na tabela">${dentro}</button>`;
    return `<a ${attrs} href="${rotaItem(sub ? 'servico' : 'insumo', esc(l.item.base), esc(l.item.codigo))}" title="${sub ? 'Abrir o fluxo desta composição auxiliar' : 'Abrir este insumo'}">${dentro}</a>`;
  }).join('')).join('');
  const secoes = d.secoes.map((s, si) => `<div class="fx-secao" data-s="${si}" style="--cor:var(${s.cor})" tabindex="0">
      <span>${esc(s.nome)}</span><b>${brl.format(s.v)}</b><span class="fx-pct">${pct.format(s.v / d.total)}</span></div>`).join('');
  return `<div class="fluxo" id="fluxo" role="group" aria-label="Fluxo do custo: dos itens, pelas seções, até o preço de ${esc(brl.format(d.total))}">
      <div class="fx-topo"><ul class="fx-legenda">${d.secoes.map((s) => `<li style="--cor:var(${s.cor})">${esc(s.nome)} <b>${pct.format(s.v / d.total)}</b></li>`).join('')}</ul>
        <div class="fx-preco-topo"><b>${brl.format(d.total)}</b> por ${unid(c.unidade)}</div></div>
      <div class="fx-cab" aria-hidden="true"><span>Itens</span><span>Seções</span><span>Preço</span></div>
      <div class="fx-palco">
        <svg class="fx-svg" aria-hidden="true"></svg>
        <div class="fx-linhas">${linhas}</div>
        <div class="fx-secoes">${secoes}</div>
        <div class="fx-preco"><span>Preço</span><b>${brl.format(d.total)}</b><span>por ${unid(c.unidade)}</span></div>
      </div>
      <p class="fonte">A espessura de cada faixa é proporcional ao valor. ${d.n > MAX_LINHAS ? `Aparecem os ${MAX_LINHAS} itens de maior custo; os demais estão agrupados. ` : ''}${
        d.ajustado ? 'A soma dos itens foi ajustada ao preço informado pela base. ' : ''}${c.modelo === 'DNIT' ? 'No modelo DNIT, equipamento e mão de obra entram divididos pela produção da equipe.' : ''}</p>
    </div>`;
}

// mede a tela e desenha as faixas (refeito quando a largura muda)
function desenharFluxo(animar) {
  const raiz = $('#fluxo'), d = FLUXO.dados; if (!raiz || !d) return;
  const palco = raiz.querySelector('.fx-palco'), svg = raiz.querySelector('.fx-svg');
  const L = palco.clientWidth; if (!L) return;
  const estreito = L < 620;
  raiz.classList.toggle('fx-estreito', estreito);
  const xItem = Math.round(L * (estreito ? 0.58 : 0.4)), xSec = Math.round(L * (estreito ? 0.8 : 0.66)), xPreco = L - (estreito ? 12 : 132);
  const BI = 5, BS = 10, BP = 12;                               // larguras das barras de item, seção e preço
  const todas = d.secoes.flatMap((s) => s.linhas);
  const alvo = Math.max(200, Math.min(380, todas.length * 26)); // altura somada das faixas
  const px = alvo / d.total;
  const esp = (v) => Math.max(1.5, v * px);
  // coluna dos itens: cada linha tem altura para o texto e para a faixa
  let y = 0; const linhas = [];
  d.secoes.forEach((s, si) => {
    s.linhas.forEach((l) => { const t = esp(l.v), h = Math.max(estreito ? 58 : 42, t + 10); linhas.push({ si, t, y, h, c: y + h / 2 }); y += h; });
    y += 14;
  });
  const H = y - 14;
  // coluna das seções e do preço: empilhadas e centralizadas
  const somaSec = d.secoes.map((s, si) => linhas.filter((l) => l.si === si).reduce((a, l) => a + l.t, 0));
  const folga = 16, altSec = somaSec.reduce((a, b) => a + b, 0) + folga * (d.secoes.length - 1);
  let ys = Math.max(0, (H - altSec) / 2); const secY = somaSec.map((t) => { const r = ys; ys += t + folga; return r; });
  const altPreco = somaSec.reduce((a, b) => a + b, 0), yPreco = Math.max(0, (H - altPreco) / 2);
  const faixa = (x0, y0, x1, y1, t, cls, attrs) => {
    const m = (x0 + x1) / 2;
    return `<path class="${cls}" ${attrs} d="M${x0},${y0}C${m},${y0} ${m},${y1} ${x1},${y1}L${x1},${y1 + t}C${m},${y1 + t} ${m},${y0 + t} ${x0},${y0 + t}Z" />`;
  };
  let partes = '', k = 0, yp = yPreco;
  d.secoes.forEach((s, si) => {
    let dentro = secY[si];
    s.linhas.forEach(() => {
      const l = linhas[k];
      partes += faixa(xItem + BI, l.c - l.t / 2, xSec, dentro, l.t, 'fx-f', `data-l="${k}" data-s="${si}" style="--cor:var(${s.cor})"`);
      partes += `<rect class="fx-n" data-l="${k}" data-s="${si}" style="--cor:var(${s.cor})" x="${xItem}" y="${l.c - l.t / 2}" width="${BI}" height="${l.t}" rx="1.5" />`;
      dentro += l.t; k++;
    });
    partes += faixa(xSec + BS, secY[si], xPreco, yp, somaSec[si], 'fx-f fx-f2', `data-s="${si}" style="--cor:var(${s.cor})"`);
    partes += `<rect class="fx-n" data-s="${si}" style="--cor:var(${s.cor})" x="${xSec}" y="${secY[si]}" width="${BS}" height="${somaSec[si]}" rx="2" />`;
    yp += somaSec[si];
  });
  partes += `<rect class="fx-np" x="${xPreco}" y="${yPreco}" width="${BP}" height="${altPreco}" rx="2.5" />`;
  svg.setAttribute('viewBox', `0 0 ${L} ${H}`); svg.setAttribute('width', L); svg.setAttribute('height', H);
  svg.innerHTML = `<defs><clipPath id="fx-corte"><rect x="0" y="-4" width="${L}" height="${H + 8}" /></clipPath></defs><g clip-path="url(#fx-corte)">${partes}</g>`;
  palco.style.height = `${H}px`;
  // rótulos em HTML, alinhados às faixas
  raiz.querySelectorAll('.fx-linha').forEach((el, i) => { const l = linhas[i]; Object.assign(el.style, { top: `${l.y}px`, height: `${l.h}px`, width: `${xItem - 10}px` }); });
  raiz.querySelectorAll('.fx-secao').forEach((el, si) => { Object.assign(el.style, { top: `${secY[si] + somaSec[si] / 2}px`, left: `${xSec + BS + 8}px`, maxWidth: `${Math.max(90, xPreco - xSec - BS - 20)}px` }); });
  Object.assign(raiz.querySelector('.fx-preco').style, { top: `${yPreco + altPreco / 2}px`, left: `${xPreco + BP + 10}px` });
  const cab = raiz.querySelectorAll('.fx-cab span'); cab[0].style.width = `${xItem + BI}px`; cab[1].style.width = `${xSec - xItem - BI}px`;
  // as faixas correm da esquerda para a direita, uma única vez
  if (animar && !semMovimento()) {
    const r = svg.querySelector('#fx-corte rect');
    r.animate([{ width: '0px' }, { width: `${L}px` }], { duration: 900, easing: 'cubic-bezier(0.3, 0.7, 0.2, 1)' });
    raiz.classList.add('fx-chegando'); setTimeout(() => raiz.classList.remove('fx-chegando'), 950);
  }
}

// realce: passar o mouse (ou o foco) num item acende o caminho dele até o preço; numa seção, todos os seus itens
function realcar(alvo) {
  const raiz = $('#fluxo'); if (!raiz) return;
  const l = alvo && alvo.dataset.l, s = alvo && alvo.dataset.s;
  raiz.classList.toggle('fx-foco', !!alvo);
  raiz.querySelectorAll('[data-s]').forEach((el) => {
    const mesmoItem = l != null && (el.dataset.l === l || (el.dataset.l == null && el.dataset.s === s));
    const mesmaSecao = l == null && el.dataset.s === s;
    el.classList.toggle('fx-aceso', !!alvo && (mesmoItem || mesmaSecao));
  });
}
document.addEventListener('pointerover', (e) => { const a = e.target.closest && e.target.closest('#fluxo .fx-linha, #fluxo .fx-secao, #fluxo .fx-f, #fluxo .fx-n'); if (a || e.target.closest('#fluxo')) realcar(a); });
document.addEventListener('pointerout', (e) => { if (e.target.closest && e.target.closest('#fluxo') && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('#fluxo'))) realcar(null); });
document.addEventListener('focusin', (e) => { const a = e.target.closest && e.target.closest('#fluxo .fx-linha, #fluxo .fx-secao'); if (a) realcar(a); });
document.addEventListener('focusout', (e) => { if (e.target.closest && e.target.closest('#fluxo')) realcar(null); });

// ---------- alternância Tabela | Fluxo na ficha ----------
const vistaAtual = () => (PREF.ler('infocustos-vista', 'tabela') === 'fluxo' ? 'fluxo' : 'tabela');
window.seletorVista = () => `<div class="segmentos" role="radiogroup" aria-label="Como ver a composição" data-vista>
  <button type="button" role="radio" data-v="tabela" aria-checked="${vistaAtual() === 'tabela'}">Tabela</button>
  <button type="button" role="radio" data-v="fluxo" aria-checked="${vistaAtual() === 'fluxo'}">Fluxo</button></div>`;
function aplicarVista(animar) {
  const ficha = $('#detalhe .ficha'); if (!ficha || !ficha.querySelector('.arvore')) return;
  const v = vistaAtual();
  ficha.dataset.vista = v;
  ficha.querySelectorAll('.segmentos[data-vista] button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === v)));
  let caixa = ficha.querySelector('.fluxo-caixa');
  if (v === 'fluxo') {
    if (!caixa) { caixa = document.createElement('div'); caixa.className = 'fluxo-caixa'; ficha.querySelector('.arvore').before(caixa); }
    if (!caixa.firstChild || FLUXO.c !== estado.comp) { caixa.innerHTML = htmlFluxo(estado.comp); animar = true; }
    desenharFluxo(animar);
    if (FLUXO.obs) FLUXO.obs.disconnect();
    const palco = caixa.querySelector('.fx-palco');
    if (palco && window.ResizeObserver) { let larg = palco.clientWidth; FLUXO.obs = new ResizeObserver(() => { if (palco.clientWidth !== larg) { larg = palco.clientWidth; desenharFluxo(false); } }); FLUXO.obs.observe(palco); }
  }
}
window.montarFluxo = () => aplicarVista(true);
document.addEventListener('click', (e) => {
  const b = e.target.closest('.segmentos[data-vista] button');
  if (b) { PREF.gravar('infocustos-vista', b.dataset.v); aplicarVista(true); return; }
  const o = e.target.closest('[data-fx-tabela]');
  if (o) {
    PREF.gravar('infocustos-vista', 'tabela'); aplicarVista(false);
    const tb = document.querySelector(`.arvore tbody[data-secao="${o.dataset.fxTabela}"]`); if (tb) tb.scrollIntoView({ block: 'start', behavior: semMovimento() ? 'auto' : 'smooth' });
  }
});
