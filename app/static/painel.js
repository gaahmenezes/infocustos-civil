'use strict';
/* Painel visual do orçamento (custo por etapa, curva ABC, divisão do custo) e arrastar para reordenar. */

// ---------- painel ----------
const PAINEL_PARTES = [['mo', 'Mão de obra', '--c-mo'], ['mat', 'Material', '--c-mat'], ['equip', 'Equipamento', '--c-equip'], ['terc', 'Serviço de terceiro', '--c-terc']];

function curvaABC(o) {
  // mesma regra da aba "Curva ABC de serviços": soma por código, ordena pelo total com BDI
  const m = new Map();
  for (const e of o.etapas) for (const i of e.itens) {
    const k = `${i.tipo}|${i.base}|${i.codigo}`;
    const a = m.get(k) || { chave: k, base: i.base, codigo: i.codigo, descricao: i.descricao, total: 0 };
    a.total += i.total; m.set(k, a);
  }
  const l = [...m.values()].filter((x) => x.total > 0).sort((a, b) => b.total - a.total);
  const soma = l.reduce((s, x) => s + x.total, 0) || 1;
  let acum = 0;
  l.forEach((x, n) => {
    const antes = acum / soma; acum += x.total;
    Object.assign(x, { posicao: n + 1, percentual: x.total / soma, acumulado: acum / soma, classe: antes < 0.8 ? 'A' : antes < 0.95 ? 'B' : 'C' });
  });
  return l;
}

function graficoABC(l) {
  // curva do valor acumulado: um eixo só (0 a 100%), com as faixas A, B e C marcadas
  const L = 44, R = 12, T = 12, B = 26, W = 420, H = 190, pw = W - L - R, ph = H - T - B;
  const x = (n) => L + (l.length === 1 ? pw / 2 : ((n - 1) / (l.length - 1)) * pw);
  const y = (v) => T + (1 - v) * ph;
  const linha = l.map((p, k) => `${k ? 'L' : 'M'}${x(p.posicao).toFixed(1)} ${y(p.acumulado).toFixed(1)}`).join(' ');
  const grade = [[0, '0%'], [0.5, '50%'], [0.8, '80%'], [0.95, '95%']].map(([v, t]) =>
    `<line class="g-grade${v === 0 ? ' g-base' : ''}" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" /><text class="g-eixo" x="${L - 7}" y="${y(v) + 3.5}" text-anchor="end">${t}</text>`).join('');
  // o nome da faixa fica logo abaixo do limite dela, no canto direito (a curva termina no alto, então não cruza)
  const faixas = [['classe A', 0.8], ['classe B', 0.95]].map(([c, lim]) => `<text class="g-faixa" x="${W - R - 2}" y="${y(lim) + 12}" text-anchor="end">${c}</text>`).join('');
  const pontos = l.length <= 40 ? l.map((p) => `<circle class="g-ponto" cx="${x(p.posicao).toFixed(1)}" cy="${y(p.acumulado).toFixed(1)}" r="4" />`).join('') : '';
  const larg = l.length === 1 ? pw : pw / (l.length - 1);
  const alvos = l.map((p, k) => `<rect class="g-alvo" data-k="${k}" x="${(x(p.posicao) - larg / 2).toFixed(1)}" y="${T}" width="${larg.toFixed(1)}" height="${ph}" tabindex="0" role="button" aria-label="${p.posicao}º: ${esc(p.codigo)}/${esc(p.base)}, ${brl.format(p.total)}, acumulado ${pct.format(p.acumulado)}, classe ${p.classe}" />`).join('');
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="group" aria-label="Curva ABC: valor acumulado dos itens, do mais caro para o mais barato">
    ${grade}${faixas}
    <text class="g-eixo" x="${L}" y="${H - 7}">1º item</text><text class="g-eixo" x="${W - R}" y="${H - 7}" text-anchor="end">${l.length}º item</text>
    <path class="g-linha" d="${linha}" /><line class="g-mira" x1="0" x2="0" y1="${T}" y2="${T + ph}" hidden />${pontos}
    <circle class="g-foco" r="5.5" hidden />${alvos}</svg>`;
}

window.desenharPainel = function (o) {
  const d = $('#orc-painel'); if (!d) return;
  if (!o.qtd_itens || !o.total) { d.innerHTML = ''; return; }
  const aberto = PREF.ler('infocustos-painel', 'aberto') === 'aberto';
  const max = Math.max(...o.etapas.map((e) => e.total), 0.01);
  const etapas = o.etapas.map((e) => `<li><button type="button" class="pe-linha" data-etapa="${e.id}" aria-pressed="${ORC.filtro === e.id}" title="Mostrar só esta etapa na planilha">
      <span class="pe-nome"><b>${e.numero}</b> ${esc(e.titulo)}</span><span class="pe-valor">${brl.format(e.total)}</span>
      <span class="pe-trilho"><i style="width:${Math.max(e.total > 0 ? 1.5 : 0, (e.total / max) * 100)}%"></i></span><span class="pe-pct">${pct.format(e.peso)}</span></button></li>`).join('');
  const abc = curvaABC(o);
  const cont = (c) => abc.filter((x) => x.classe === c).length;
  const dv = o.divisao;
  const barras = dv ? PAINEL_PARTES.filter(([k]) => dv[k] > 0).map(([k, n, cor]) => `<span style="flex-grow:${dv[k]};background:var(${cor})" title="${n}: ${pct.format(dv[k])}"></span>`).join('') : '';
  const legenda = dv ? PAINEL_PARTES.map(([k, n, cor]) => `<div style="--cor:var(${cor})">${n}<b>${brl.format(o.custo_total * dv[k])}</b><span class="pct">${pct.format(dv[k])}</span></div>`).join('') : '';
  d.innerHTML = `<section class="painel-orc" aria-label="Resumo visual do orçamento">
    <button type="button" class="painel-alternar" aria-expanded="${aberto}" data-painel-alternar>Resumo visual${SETA}</button>
    <div class="painel-grade"${aberto ? '' : ' hidden'}>
      <article class="pcartao"><h3>Custo por etapa <span class="sub">com BDI · clique para filtrar a planilha</span></h3><ul class="pe-lista">${etapas}</ul></article>
      <article class="pcartao"><h3>Curva ABC <span class="sub">valor acumulado dos itens</span></h3>
        <div class="grafico-caixa" id="abc-caixa">${graficoABC(abc)}<div class="dica" id="abc-dica" hidden></div></div>
        <p class="pcartao-nota"><b>A</b> ${cont('A')} ${cont('A') === 1 ? 'item' : 'itens'} · <b>B</b> ${cont('B')} · <b>C</b> ${cont('C')} · clique num ponto para achar o item</p></article>
      <article class="pcartao"><h3>Divisão do custo direto <span class="sub">sem BDI</span></h3>
        ${dv ? `<div class="custo"><div class="barra">${barras}</div><div class="legenda legenda-2">${legenda}</div></div>` : '<p class="sub">Sem dados para dividir.</p>'}</article>
    </div></section>`;

  d.querySelector('[data-painel-alternar]').addEventListener('click', (e) => {
    const abrir = e.currentTarget.getAttribute('aria-expanded') !== 'true';
    PREF.gravar('infocustos-painel', abrir ? 'aberto' : 'fechado'); window.desenharPainel(ORC.atual);
  });
  d.querySelectorAll('.pe-linha').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.dataset.etapa);
    ORC.filtro = ORC.filtro === id ? null : id; ORC.destaque = null;
    if (ORC.aba !== 'planilha') { location.hash = rotaOrc(o.id); return; }
    abrirOrcamento(o.id, ORC.atual);
  }));
  const caixa = $('#abc-caixa'); if (!caixa) return;
  const svg = caixa.querySelector('svg'), dica = $('#abc-dica'), mira = svg.querySelector('.g-mira'), foco = svg.querySelector('.g-foco');
  const mostrar = (alvo) => {
    const p = abc[Number(alvo.dataset.k)]; const cx = Number(alvo.getAttribute('x')) + Number(alvo.getAttribute('width')) / 2;
    const cy = 12 + (1 - p.acumulado) * (190 - 12 - 26);
    mira.setAttribute('x1', cx); mira.setAttribute('x2', cx); mira.hidden = false;
    foco.setAttribute('cx', cx); foco.setAttribute('cy', cy); foco.hidden = false;
    dica.innerHTML = `<b>${p.posicao}º · ${esc(p.codigo)} ${esc(p.base)} · classe ${p.classe}</b><span>${esc(p.descricao)}</span>
      <span class="dica-num">${brl.format(p.total)} · ${pct.format(p.percentual)} do total · acumulado ${pct.format(p.acumulado)}</span>`;
    dica.hidden = false;
    const r = svg.getBoundingClientRect(), esq = (cx / 420) * r.width;
    dica.style.left = `${Math.min(Math.max(esq, 110), r.width - 110)}px`;
    dica.style.top = `${(cy / 190) * r.height}px`;
  };
  const esconder = () => { dica.hidden = true; mira.hidden = true; foco.hidden = true; };
  svg.addEventListener('pointermove', (e) => { const a = e.target.closest('.g-alvo'); if (a) mostrar(a); });
  svg.addEventListener('pointerleave', esconder);
  svg.addEventListener('focusin', (e) => { const a = e.target.closest('.g-alvo'); if (a) mostrar(a); });
  svg.addEventListener('focusout', esconder);
  const escolher = (a) => {
    const p = abc[Number(a.dataset.k)];
    ORC.destaque = p.chave; ORC.filtro = null;
    const depois = () => { const tr = document.querySelector('tr.item.destaque'); if (tr) tr.scrollIntoView({ block: 'center', behavior: semMovimento() ? 'auto' : 'smooth' }); };
    if (ORC.aba !== 'planilha') { location.hash = rotaOrc(o.id); setTimeout(depois, 400); return; }
    abrirOrcamento(o.id, ORC.atual).then(depois);
  };
  svg.addEventListener('click', (e) => { const a = e.target.closest('.g-alvo'); if (a) escolher(a); });
  svg.addEventListener('keydown', (e) => { const a = e.target.closest('.g-alvo'); if (a && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); escolher(a); } });
};

// ---------- arrastar para reordenar ----------
window.ligarArrastar = function (corpo, o, atualizar) {
  let arr = null;  // { tipo, id, linha, marca, alvo }
  const limpar = () => {
    if (!arr) return;
    arr.linha.classList.remove('arrastando'); arr.marca.remove(); document.body.classList.remove('arrastando-algo'); arr = null;
  };
  const acharAlvo = (x, y) => {
    const el = document.elementFromPoint(x, y); if (!el) return null;
    if (arr.tipo === 'etapa') {
      const tb = el.closest('tbody.etapa'); if (!tb) return null;
      const r = tb.getBoundingClientRect(); const depois = y > r.top + r.height / 2;
      return { tbody: tb, depois, yLinha: depois ? r.bottom : r.top, esq: r.left, larg: r.width };
    }
    const tr = el.closest('tr.item, tr.etapa-cab, tr.add-linha'); if (!tr) return null;
    const tb = tr.closest('tbody.etapa'); const r = tr.getBoundingClientRect();
    if (tr.classList.contains('etapa-cab')) return { tbody: tb, antesDe: tb.querySelector('tr.item'), yLinha: r.bottom, esq: r.left, larg: r.width };
    if (tr.classList.contains('add-linha')) return { tbody: tb, antesDe: null, yLinha: r.top, esq: r.left, larg: r.width };
    const depois = y > r.top + r.height / 2;
    let prox = tr.nextElementSibling; if (prox && !prox.classList.contains('item')) prox = null;
    return { tbody: tb, antesDe: depois ? prox : tr, yLinha: depois ? r.bottom : r.top, esq: r.left, larg: r.width };
  };
  corpo.addEventListener('pointerdown', (e) => {
    const p = e.target.closest('.pega'); if (!p || e.button > 0) return;
    e.preventDefault();
    const linha = p.dataset.pega === 'etapa' ? p.closest('tbody') : p.closest('tr');
    const marca = document.createElement('div'); marca.className = 'solta-aqui'; marca.hidden = true; document.body.appendChild(marca);
    arr = { tipo: p.dataset.pega, id: Number(p.dataset.id), linha, marca, alvo: null, pega: p };
    linha.classList.add('arrastando'); document.body.classList.add('arrastando-algo');
    p.setPointerCapture(e.pointerId);
  });
  corpo.addEventListener('pointermove', (e) => {
    if (!arr) return;
    const a = acharAlvo(e.clientX, e.clientY); arr.alvo = a;
    if (!a) { arr.marca.hidden = true; return; }
    arr.marca.hidden = false;
    Object.assign(arr.marca.style, { left: `${a.esq + window.scrollX}px`, top: `${a.yLinha + window.scrollY - 1.5}px`, width: `${a.larg}px` });
    // perto das bordas da janela, rola a página para alcançar o destino
    if (e.clientY < 90) window.scrollBy(0, -14); else if (e.clientY > window.innerHeight - 60) window.scrollBy(0, 14);
  });
  const soltar = async () => {
    if (!arr) return;
    const { tipo, id, alvo, pega } = arr; limpar();
    if (!alvo) return;
    try {
      if (tipo === 'etapa') {
        const ids = o.etapas.map((x) => x.id).filter((x) => x !== id);
        const ref = Number(alvo.tbody.dataset.etapa); if (ref === id) return;
        const pos = ids.indexOf(ref) + (alvo.depois ? 1 : 0);
        if (o.etapas.findIndex((x) => x.id === id) === pos) return;
        await atualizar(await req(`/api/etapas/${id}/posicionar?posicao=${pos}`, 'POST'));
      } else {
        const eid = Number(alvo.tbody.dataset.etapa);
        const ids = o.etapas.find((x) => x.id === eid).itens.map((x) => x.id).filter((x) => x !== id);
        const antes = alvo.antesDe ? Number(alvo.antesDe.dataset.item) : null;
        if (antes === id) return;
        const pos = antes === null ? ids.length : ids.indexOf(antes);
        const origem = o.etapas.find((x) => x.itens.some((i) => i.id === id));
        if (origem.id === eid && origem.itens.findIndex((i) => i.id === id) === pos) return;
        await atualizar(await req(`/api/itens/${id}/posicionar?etapa_id=${eid}&posicao=${pos}`, 'POST'));
      }
      const nova = document.querySelector(`.pega[data-pega="${tipo}"][data-id="${id}"]`); if (nova) nova.focus();
    } catch (err) { avisar(esc(err.message)); pega.focus(); }
  };
  corpo.addEventListener('pointerup', soltar);
  corpo.addEventListener('pointercancel', limpar);
  // pelo teclado: com o foco na alça, as setas sobem e descem uma posição
  corpo.addEventListener('keydown', async (e) => {
    const p = e.target.closest('.pega'); if (!p || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    try { await atualizar(await req(`/api/${p.dataset.pega === 'etapa' ? 'etapas' : 'itens'}/${p.dataset.id}/mover?direcao=${e.key === 'ArrowUp' ? 'cima' : 'baixo'}`, 'POST')); }
    catch (err) { avisar(esc(err.message)); }
  });
};
