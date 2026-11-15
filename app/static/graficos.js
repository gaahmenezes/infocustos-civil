'use strict';
/* Gráficos com assinatura própria: histórico de preço (curva dos meses carregados), placar do comparativo
   (altas e quedas em barras divergentes que se reordenam) e composição em anéis (seções por dentro, itens por fora). */

const MESES_CURTOS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const mesCurto = (id) => `${MESES_CURTOS[Number(id.slice(5, 7)) - 1]}/${id.slice(2, 4)}`;
const ordinal = (id) => Number(id.slice(0, 4)) * 12 + Number(id.slice(5, 7));

// ---------- histórico de preço ----------
window.graficoHistorico = function (meses, { unidade, atual, base, titulo = 'Histórico de preço' } = {}) {
  const pts = meses.filter((m) => m.preco != null);
  if (pts.length < 2) return '';
  const fontes = (estado.ref && estado.ref.bases && estado.ref.bases[base] && estado.ref.bases[base].fontes) || {};
  const W = 640, H = 196, pe = 40, pd = 26, pt = 34, pb = 34;
  const o0 = ordinal(meses[0].referencia), o1 = ordinal(meses[meses.length - 1].referencia) || o0 + 1;
  const vals = pts.map((m) => m.preco), mn = Math.min(...vals), mx = Math.max(...vals), folga = (mx - mn) * 0.18 || mx * 0.08 || 1;
  const ymin = Math.max(0, mn - folga), ymax = mx + folga;
  const X = (id) => pe + ((ordinal(id) - o0) / Math.max(1, o1 - o0)) * (W - pe - pd);
  const Y = (v) => pt + (1 - (v - ymin) / (ymax - ymin)) * (H - pt - pb);
  // trechos contínuos (um mês sem preço interrompe a linha); trocar de fonte deixa o trecho tracejado
  const segs = [];
  for (let k = 1; k < meses.length; k += 1) {
    const a = meses[k - 1], b = meses[k];
    if (a.preco == null || b.preco == null) continue;
    segs.push({ a, b, troca: fontes[a.referencia] && fontes[b.referencia] && fontes[a.referencia] !== fontes[b.referencia] });
  }
  const linha = segs.map((s) => `<path class="gh-seg${s.troca ? ' gh-troca' : ''}" d="M${X(s.a.referencia).toFixed(1)},${Y(s.a.preco).toFixed(1)} L${X(s.b.referencia).toFixed(1)},${Y(s.b.preco).toFixed(1)}" />`).join('');
  const area = `M${X(pts[0].referencia)},${H - pb} ` + pts.map((m) => `L${X(m.referencia).toFixed(1)},${Y(m.preco).toFixed(1)}`).join(' ') + ` L${X(pts[pts.length - 1].referencia)},${H - pb} Z`;
  const variacoes = meses.map((m, k) => { const ant = meses.slice(0, k).reverse().find((x) => x.preco != null); return m.preco != null && ant ? m.preco / ant.preco - 1 : null; });
  const pontos = meses.map((m, k) => {
    const x = X(m.referencia), sel = m.referencia === atual, fonte = fontes[m.referencia] || '';
    const rot = `<text class="gh-mes${sel ? ' sel' : ''}" x="${x.toFixed(1)}" y="${H - 12}">${mesCurto(m.referencia)}</text>`;
    if (m.preco == null) return `${rot}<text class="gh-fora" x="${x.toFixed(1)}" y="${H - pb - 6}">fora da base</text>`;
    const y = Y(m.preco), v = variacoes[k];
    return `${rot}<g class="gh-pt${sel ? ' sel' : ''}${fonte === 'CEHOP' ? ' oco' : ''}" style="--i:${k}" tabindex="0" role="img"
        aria-label="${esc(nomeRef(m.referencia))}: ${brl.format(m.preco)}${v == null ? '' : `, ${v > 0 ? 'alta' : 'queda'} de ${pct.format(Math.abs(v))}`}${fonte ? `, fonte ${fonte}` : ''}">
      ${sel ? `<circle class="gh-halo" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" />` : ''}<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${sel ? 5.5 : 4.2}" />
      <text class="gh-val" x="${x.toFixed(1)}" y="${(y - 12).toFixed(1)}">${brl.format(m.preco)}</text>
      ${v != null && Math.abs(v) >= 0.0005 ? `<text class="gh-var ${v > 0 ? 'alta' : 'baixa'}" x="${x.toFixed(1)}" y="${(y + 21).toFixed(1)}">${v > 0 ? '+' : '−'}${pct.format(Math.abs(v))}</text>` : ''}</g>`;
  }).join('');
  const prim = pts[0], ult = pts[pts.length - 1], vt = ult.preco / prim.preco - 1;
  const temTroca = segs.some((s) => s.troca), temOco = pts.some((m) => fontes[m.referencia] === 'CEHOP') && pts.some((m) => fontes[m.referencia] && fontes[m.referencia] !== 'CEHOP');
  return `<section class="gh" aria-label="${esc(titulo)}">
    <div class="gh-cab"><h3>${esc(titulo)} <span class="sub">por ${esc(unidade || '')}, nos meses carregados</span></h3>
      ${Math.abs(vt) >= 0.0005 ? `<span class="gh-total ${vt > 0 ? 'alta' : 'baixa'}">${vt > 0 ? '+' : '−'}${pct.format(Math.abs(vt))} de ${mesCurto(prim.referencia)} a ${mesCurto(ult.referencia)}</span>` : '<span class="gh-total">sem variação no período</span>'}</div>
    <svg class="gh-svg" viewBox="0 0 ${W} ${H}" role="group" aria-label="Preço em cada mês">
      <defs><linearGradient id="gh-grad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--acao)" stop-opacity="0.28" /><stop offset="1" stop-color="var(--acao)" stop-opacity="0" /></linearGradient></defs>
      <line class="gh-base" x1="${pe - 12}" x2="${W - pd + 12}" y1="${H - pb}" y2="${H - pb}" />
      <path class="gh-area" d="${area}" />${linha}${pontos}
    </svg>
    ${temTroca || temOco ? `<p class="gh-nota">${temOco ? '<span class="gh-leg"><i class="cheio"></i> CAIXA <i class="oco"></i> CEHOP</span> ' : ''}${temTroca ? 'O tracejado marca a troca de fonte: parte da diferença é de método de cálculo, não de preço.' : ''}</p>` : ''}
  </section>`;
};

window.carregarHistoricoFicha = async function (tipo, base, codigo, atual, unidade) {
  const caixa = $('#ficha-hist'); if (!caixa || base === 'PROPRIA') return;
  try {
    const r = await api(`/api/comparativo/item/${tipo}/${base}/${codigo}`);
    if (!document.body.contains(caixa)) return;
    caixa.innerHTML = window.graficoHistorico(r.meses, { unidade: unidade || r.unidade, atual, base });
  } catch (_) { /* sem histórico: a ficha segue sem o gráfico */ }
};

// ---------- placar do comparativo ----------
const PLACAR = { antes: new Map() };
window.placarComparativo = function (altas, quedas, de, para) {
  const lado = (lista, qual) => lista.filter((i) => i.preco_de > 0 && i.preco_para != null).slice(0, 7).map((i) => ({ ...i, v: i.preco_para / i.preco_de - 1, lado: qual }));
  const a = lado(altas, 'alta').filter((x) => x.v > 0.00005), q = lado(quedas, 'baixa').filter((x) => x.v < -0.00005);
  if (!a.length && !q.length) return '';
  const max = Math.max(...[...a, ...q].map((x) => Math.abs(x.v)), 0.0001);
  const linha = (x) => `<a class="pl-linha ${x.lado}" data-pl="${esc(x.lado + x.base + x.codigo)}" href="${rotaItem(x.tipo, esc(x.base), esc(x.codigo))}"
      title="${esc(x.descricao)}: ${brl.format(x.preco_de)} → ${brl.format(x.preco_para)}">
      <span class="pl-cod">${esc(x.codigo)} <i class="cb-base cb-${esc(x.base)}">${esc(x.base)}</i></span><span class="pl-desc">${esc(x.descricao)}</span>
      <span class="pl-trilho"><i style="--w:${((Math.abs(x.v) / max) * 100).toFixed(1)}%"></i></span>
      <b class="pl-v">${x.v > 0 ? '+' : '−'}${pct.format(Math.abs(x.v))}</b></a>`;
  return `<section class="placar" aria-label="Maiores altas e quedas de ${esc(de)} para ${esc(para)}">
    <div class="pl-col"><h3><span class="pl-sinal alta">▲</span> Maiores altas</h3>${a.map(linha).join('') || '<p class="sub">Nenhuma alta.</p>'}</div>
    <div class="pl-col"><h3><span class="pl-sinal baixa">▼</span> Maiores quedas</h3>${q.map(linha).join('') || '<p class="sub">Nenhuma queda.</p>'}</div>
  </section>`;
};
// as linhas que continuam no placar deslizam do lugar antigo para o novo; as barras crescem do tamanho antigo
window.animarPlacar = function () {
  const els = [...document.querySelectorAll('.placar .pl-linha')];
  if (!semMovimento()) els.forEach((el) => {
    const a = PLACAR.antes.get(el.dataset.pl), r = el.getBoundingClientRect(), barra = el.querySelector('.pl-trilho i');
    if (a) {
      el.animate([{ transform: `translate(${a.x - r.left}px, ${a.y - r.top}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
      barra.animate([{ width: a.w }, { width: getComputedStyle(barra).width }], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
    } else {
      el.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 30 * els.indexOf(el), easing: 'ease-out', fill: 'backwards' });
      barra.animate([{ width: '0px' }, { width: getComputedStyle(barra).width }], { duration: 520, delay: 30 * els.indexOf(el), easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' });
    }
  });
  PLACAR.antes = new Map(els.map((el) => { const r = el.getBoundingClientRect(); return [el.dataset.pl, { x: r.left, y: r.top, w: getComputedStyle(el.querySelector('.pl-trilho i')).width }]; }));
};
window.lembrarPlacar = function () {
  PLACAR.antes = new Map([...document.querySelectorAll('.placar .pl-linha')].map((el) => { const r = el.getBoundingClientRect(); return [el.dataset.pl, { x: r.left, y: r.top, w: getComputedStyle(el.querySelector('.pl-trilho i')).width }]; }));
};

// ---------- composição em anéis ----------
function arco(cx, cy, r0, r1, a0, a1) {
  // volta inteira: o SVG não desenha um arco que começa e termina no mesmo ponto, então vira duas metades
  if (a1 - a0 > Math.PI * 2 - 0.05) { // coroa inteira: círculo de fora num sentido, o de dentro no outro (o miolo fica vazado)
    const c = (r, s) => `M${cx},${cy - r} A${r},${r} 0 1 ${s} ${cx},${cy + r} A${r},${r} 0 1 ${s} ${cx},${cy - r} Z`;
    return `${c(r1, 1)} ${c(r0, 0)}`;
  }
  const p = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const g = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = p(r1, a0), [x1, y1] = p(r1, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r1},${r1} 0 ${g} 1 ${x1.toFixed(2)},${y1.toFixed(2)} L${x2.toFixed(2)},${y2.toFixed(2)} A${r0},${r0} 0 ${g} 0 ${x3.toFixed(2)},${y3.toFixed(2)} Z`;
}
window.htmlAneis = function (c) {
  const d = typeof dadosDoFluxo === 'function' ? dadosDoFluxo(c) : null;
  if (!d) return '<p class="sub fluxo-vazio">Esta composição não traz custos por item para desenhar os anéis.</p>';
  const S = 360, cx = S / 2, cy = S / 2, folga = 0.006;
  let a = 0, k = 0, n = 0;
  const partes = [];
  // cada categoria com uma cor só sua (na tabela, serviço auxiliar repete a do equipamento)
  const usadas = new Set(), reserva = ['--c-terc', '--c-mat', '--c-enc', '--c-mo', '--tinta-3'];
  d.secoes.forEach((s) => { let cor = s.cor; if (usadas.has(cor)) cor = reserva.find((r) => !usadas.has(r)) || cor; usadas.add(cor); s.corAnel = cor; });
  d.secoes.forEach((s, si) => {
    const as = (s.v / d.total) * Math.PI * 2;
    partes.push(`<path class="an-sec" d="${arco(cx, cy, 62, 104, a + folga, a + as - folga)}" style="--cor:var(${s.corAnel});--i:${si}" data-an="s${si}" tabindex="0" role="img"
      aria-label="${esc(s.nome)}: ${brl.format(s.v)}, ${pct.format(s.v / d.total)}" />`);
    let b = a;
    s.linhas.forEach((l) => {
      const al = (l.v / d.total) * Math.PI * 2, id = n++;
      const nome = l.outros ? `Outros ${l.outros} itens de ${s.nome.toLowerCase()}` : l.item.descricao;
      partes.push(`<path class="an-item${l.item && l.item.tem_composicao ? ' sub' : ''}" d="${arco(cx, cy, 108, l.item && l.item.tem_composicao ? 168 : 150, b + folga, b + al - folga)}" style="--cor:var(${s.corAnel});--i:${k}"
        data-an="i${id}" data-sec="s${si}" tabindex="0" role="img" aria-label="${esc(nome)}: ${brl.format(l.v)}, ${pct.format(l.v / d.total)}" />`);
      b += al; k += 1;
    });
    a += as;
  });
  const lista = d.secoes.map((s, si) => `<li style="--cor:var(${s.corAnel})" data-an-leg="s${si}"><i></i><span>${esc(s.nome)}</span><b>${pct.format(s.v / d.total)}</b></li>`).join('');
  ANEIS.mapa = {};
  n = 0;
  d.secoes.forEach((s, si) => {
    ANEIS.mapa[`s${si}`] = { nome: s.nome, v: s.v, de: 'seção' };
    s.linhas.forEach((l) => { ANEIS.mapa[`i${n++}`] = { nome: l.outros ? `Outros ${l.outros} itens de ${s.nome.toLowerCase()}` : l.item.descricao, v: l.v, de: s.nome, item: l.outros ? null : l.item }; });
  });
  ANEIS.total = d.total;
  return `<div class="aneis">
    <div class="an-palco"><svg class="an-svg" viewBox="0 0 ${S} ${S}" role="group" aria-label="Composição em anéis: por dentro as categorias, por fora os itens">${partes.join('')}</svg>
      <div class="an-centro" aria-live="polite"><span class="an-rot">Custo da composição</span><b>${brl.format(d.total)}</b><span class="an-sub">por ${esc(c.unidade)}</span></div></div>
    <div class="an-lado"><ul class="an-leg">${lista}</ul>
      <p class="sub">Por dentro, as categorias de custo; por fora, cada item no tamanho do seu valor. Os mais salientes são composições auxiliares. Passe o mouse ou use Tab para ver cada um; clique para abrir.</p></div>
  </div>`;
};
const ANEIS = { mapa: {}, total: 0 };
function centroAneis(id) {
  const c = document.querySelector('.an-centro'); if (!c) return;
  const x = id && ANEIS.mapa[id];
  c.innerHTML = x ? `<span class="an-rot">${esc(x.de === 'seção' ? 'Categoria' : x.de)}</span><b>${brl.format(x.v)}</b><span class="an-nome">${esc(x.nome)}</span><span class="an-sub">${pct.format(x.v / ANEIS.total)} do custo</span>`
    : `<span class="an-rot">Custo da composição</span><b>${brl.format(ANEIS.total)}</b><span class="an-sub">por ${esc((estado.comp && estado.comp.unidade) || '')}</span>`;
  document.querySelectorAll('.an-svg path').forEach((p) => p.classList.toggle('apagado', !!id && p.dataset.an !== id && p.dataset.sec !== id));
}
document.addEventListener('mouseover', (e) => { const p = e.target.closest && e.target.closest('.an-svg [data-an], [data-an-leg]'); if (p) centroAneis(p.dataset.an || p.dataset.anLeg); });
document.addEventListener('mouseout', (e) => { if (e.target.closest && e.target.closest('.an-svg, .an-leg') && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.an-svg, .an-leg'))) centroAneis(null); });
document.addEventListener('focusin', (e) => { const p = e.target.closest && e.target.closest('.an-svg [data-an]'); if (p) centroAneis(p.dataset.an); });
document.addEventListener('focusout', (e) => { if (e.target.closest && e.target.closest('.an-svg')) centroAneis(null); });
const abrirDoAnel = (p) => { const x = ANEIS.mapa[p.dataset.an]; if (x && x.item) location.hash = rotaItem(x.item.tem_composicao ? 'servico' : 'insumo', x.item.base, x.item.codigo); };
document.addEventListener('click', (e) => { const p = e.target.closest && e.target.closest('.an-svg [data-an]'); if (p) abrirDoAnel(p); });
document.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const p = e.target.closest && e.target.closest('.an-svg [data-an]'); if (p) abrirDoAnel(p); } });
