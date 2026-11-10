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
  const pontos = l.length <= 40 ? l.map((p, k) => `<circle class="g-ponto" style="--k:${k}" cx="${x(p.posicao).toFixed(1)}" cy="${y(p.acumulado).toFixed(1)}" r="4" />`).join('') : '';
  const larg = l.length === 1 ? pw : pw / (l.length - 1);
  const alvos = l.map((p, k) => `<rect class="g-alvo" data-k="${k}" x="${(x(p.posicao) - larg / 2).toFixed(1)}" y="${T}" width="${larg.toFixed(1)}" height="${ph}" tabindex="0" role="button" aria-label="${p.posicao}º: ${esc(p.codigo)}/${esc(p.base)}, ${brl.format(p.total)}, acumulado ${pct.format(p.acumulado)}, classe ${p.classe}" />`).join('');
  return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="group" aria-label="Curva ABC: valor acumulado dos itens, do mais caro para o mais barato">
    ${grade}${faixas}
    <text class="g-eixo" x="${L}" y="${H - 7}">1º item</text><text class="g-eixo" x="${W - R}" y="${H - 7}" text-anchor="end">${l.length}º item</text>
    <path class="g-linha" pathLength="1" d="${linha}" /><line class="g-mira" x1="0" x2="0" y1="${T}" y2="${T + ph}" hidden />${pontos}
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
  const estreia = ORC.painelVisto !== o.id; ORC.painelVisto = o.id;
  d.innerHTML = `<section class="painel-orc${estreia ? ' estreia' : ''}" aria-label="Resumo visual do orçamento">
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
// Enquanto se arrasta, a linha acompanha o ponteiro e as vizinhas abrem espaço no lugar onde ela vai cair.
// As posições são calculadas pelas medidas tiradas no início, e não pelo que está sob o ponteiro, para a tela não oscilar.
window.ligarArrastar = function (corpo, o, atualizar) {
  let arr = null;
  const limpar = () => {
    if (!arr) return;
    arr.pecas.forEach((p) => { p.el.style.transform = ''; p.el.style.transition = ''; p.el.classList.remove('arrastando'); });
    document.body.classList.remove('arrastando-algo'); arr = null;
  };
  // onde a peça cairia com o ponteiro nesta altura da página
  const destino = (yPag) => {
    if (arr.tipo === 'etapa') {
      const outras = arr.pecas.filter((p) => p !== arr.eu);
      let pos = 0; for (const p of outras) if (yPag > p.meio - (p.ordem > arr.eu.ordem ? arr.eu.alt : 0)) pos += 1;
      return { pos };
    }
    const tb = arr.etapas.find((t) => yPag >= t.topo && yPag < t.base) || (yPag < arr.etapas[0].topo ? arr.etapas[0] : arr.etapas[arr.etapas.length - 1]);
    const itens = arr.pecas.filter((p) => p.etapa === tb.id && p !== arr.eu && p.item);
    let pos = 0; for (const p of itens) if (yPag > p.meio - (p.ordem > arr.eu.ordem ? arr.eu.alt : 0)) pos += 1;
    return { etapa: tb.id, pos, antes: itens[pos] || null };
  };
  const acomodar = (d) => {
    // tudo o que estava depois da peça sobe o espaço que ela deixou; tudo a partir do ponto de queda desce para abrir a vaga
    let corte;
    if (arr.tipo === 'etapa') { const outras = arr.pecas.filter((p) => p !== arr.eu); corte = d.pos < outras.length ? outras[d.pos].ordem : Infinity; }
    else if (d.antes) corte = d.antes.ordem;
    else { const fim = arr.pecas.find((p) => p.etapa === d.etapa && p.fim); corte = fim ? fim.ordem : Infinity; }
    for (const p of arr.pecas) {
      if (p === arr.eu) continue;
      const dy = (p.ordem > arr.eu.ordem ? -arr.eu.alt : 0) + (p.ordem >= corte ? arr.eu.alt : 0);
      p.el.style.transform = dy ? `translateY(${dy}px)` : '';
    }
  };
  corpo.addEventListener('pointerdown', (e) => {
    const pega = e.target.closest('.pega'); if (!pega || e.button > 0) return;
    e.preventDefault();
    const tipo = pega.dataset.pega, sy = window.scrollY;
    const els = tipo === 'etapa' ? [...corpo.querySelectorAll('tbody.etapa')] : [...corpo.querySelectorAll('tbody.etapa > tr')];
    const pecas = els.map((el, ordem) => {
      const r = el.getBoundingClientRect(), tb = el.closest('tbody');
      return { el, ordem, topo: r.top + sy, alt: r.height, meio: r.top + sy + r.height / 2, etapa: Number(tb.dataset.etapa), item: el.classList.contains('item'), fim: el.classList.contains('add-linha') };
    });
    const meuEl = tipo === 'etapa' ? pega.closest('tbody') : pega.closest('tr');
    const etapas = [...corpo.querySelectorAll('tbody.etapa')].map((tb) => { const r = tb.getBoundingClientRect(); return { id: Number(tb.dataset.etapa), topo: r.top + sy, base: r.bottom + sy }; });
    arr = { tipo, id: Number(pega.dataset.id), pega, pecas, etapas, eu: pecas.find((p) => p.el === meuEl), y0: e.clientY + sy, alvo: null };
    const anima = semMovimento() ? '' : `transform 220ms ${MOLA}`;
    pecas.forEach((p) => { if (p !== arr.eu) p.el.style.transition = anima; });
    meuEl.classList.add('arrastando'); document.body.classList.add('arrastando-algo');
    pega.setPointerCapture(e.pointerId);
  });
  corpo.addEventListener('pointermove', (e) => {
    if (!arr) return;
    const yPag = e.clientY + window.scrollY;
    arr.eu.el.style.transform = `translateY(${yPag - arr.y0}px)`;
    arr.alvo = destino(yPag); acomodar(arr.alvo);
    // perto das bordas da janela, rola a página para alcançar o destino
    if (e.clientY < 110) window.scrollBy(0, -14); else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 14);
  });
  const soltar = async () => {
    if (!arr) return;
    const { tipo, id, alvo, pega } = arr;
    if (!alvo) { limpar(); return; }
    // tira as medidas com as linhas ainda deslocadas: ao redesenhar, cada uma assenta de onde está
    const deslizar = medir('.planilha-orc tr.item, .planilha-orc tr.etapa-cab, .planilha-orc tr.add-linha', (el) => el.dataset.item ? `i${el.dataset.item}` : `${el.className}${el.closest('tbody').dataset.etapa}`);
    limpar();
    try {
      if (tipo === 'etapa') {
        if (o.etapas.findIndex((x) => x.id === id) === alvo.pos) return;
        await atualizar(await req(`/api/etapas/${id}/posicionar?posicao=${alvo.pos}`, 'POST'), deslizar);
      } else {
        const origem = o.etapas.find((x) => x.itens.some((i) => i.id === id));
        if (origem.id === alvo.etapa && origem.itens.findIndex((i) => i.id === id) === alvo.pos) return;
        await atualizar(await req(`/api/itens/${id}/posicionar?etapa_id=${alvo.etapa}&posicao=${alvo.pos}`, 'POST'), deslizar);
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
