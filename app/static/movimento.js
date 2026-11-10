'use strict';
/* Movimento que explica: cada animação mostra de onde veio e para onde foi o que mudou na tela.
   Tudo é curto (até 300 ms) e se desliga sozinho para quem pede menos movimento no sistema. */

const MOLA = 'cubic-bezier(0.22, 1.2, 0.36, 1)';   // chega um pouco além e assenta, como mola
const SAIDA = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

// ---------- dinheiro com o "R$" discreto e o valor em destaque ----------
// o texto continua igual ("R$ 8,38"); só a apresentação separa a moeda do número
function grana(v, classe = '') {
  if (v == null) return '—';
  const t = brl.format(v), k = t.indexOf(' ');
  return k < 0 ? esc(t) : `<span class="moeda">${esc(t.slice(0, k))}</span> <span class="num-grande ${classe}">${esc(t.slice(k + 1))}</span>`;
}

// ---------- números que contam ----------
// o texto do elemento já é o valor final; enquanto conta, o valor de passagem aparece por cima (atributo data-anim)
const contando = new WeakMap();
function contar(el, de, para, formato = (v) => num2.format(v)) {
  if (!el || de == null || para == null || semMovimento() || Math.abs(para - de) < 0.005) return;
  cancelAnimationFrame(contando.get(el));
  const t0 = performance.now(), dur = 320;
  el.classList.remove('subiu', 'desceu'); el.classList.add(para > de ? 'subiu' : 'desceu');
  const passo = (agora) => {
    const p = Math.min(1, (agora - t0) / dur), e = 1 - Math.pow(1 - p, 3);
    if (p < 1) { el.dataset.anim = formato(de + (para - de) * e); contando.set(el, requestAnimationFrame(passo)); }
    else { delete el.dataset.anim; setTimeout(() => el.classList.remove('subiu', 'desceu'), 500); }
  };
  contando.set(el, requestAnimationFrame(passo));
}

// ---------- linhas que deslizam até o lugar novo (FLIP) ----------
// tirar as medidas antes de redesenhar e chamar a função devolvida depois: quem mudou de lugar desliza, quem é novo surge
function medir(seletor, chave) {
  const antes = new Map();
  document.querySelectorAll(seletor).forEach((el) => antes.set(chave(el), el.getBoundingClientRect()));
  return () => {
    if (semMovimento()) return;
    document.querySelectorAll(seletor).forEach((el) => {
      const a = antes.get(chave(el)), d = el.getBoundingClientRect();
      if (!a) { el.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: SAIDA }); el.classList.add('chegou'); return; }
      const dx = a.left - d.left, dy = a.top - d.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 300, easing: MOLA });
    });
  };
}

// ---------- luz que segue o cursor nos cartões ----------
if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
  let pedido = 0;
  document.addEventListener('pointermove', (e) => {
    const c = e.target.closest && e.target.closest('.orc-cartao, .bloco, .cartao, .pcartao, .ap-ponto');
    if (!c || pedido) return;
    pedido = requestAnimationFrame(() => {
      pedido = 0; const r = c.getBoundingClientRect();
      c.style.setProperty('--mx', `${e.clientX - r.left}px`); c.style.setProperty('--my', `${e.clientY - r.top}px`);
    });
  }, { passive: true });
}

// ---------- indicador que desliza entre as abas ----------
function moverIndicador() {
  const nav = $('.abas'); if (!nav) return;
  let ind = nav.querySelector('.abas-ind');
  if (!ind) { ind = document.createElement('span'); ind.className = 'abas-ind'; ind.setAttribute('aria-hidden', 'true'); nav.prepend(ind); }
  const a = nav.querySelector('a[aria-current="true"]');
  if (!a || !a.offsetWidth) { ind.style.opacity = '0'; return; }
  const primeira = ind.style.opacity !== '1';
  if (primeira) ind.style.transition = 'none';
  const ra = a.getBoundingClientRect(), rn = nav.getBoundingClientRect();
  Object.assign(ind.style, { opacity: '1', width: `${ra.width}px`, height: `${ra.height}px`, transform: `translate(${ra.left - rn.left}px, ${ra.top - rn.top}px)` });
  if (primeira) requestAnimationFrame(() => { ind.style.transition = ''; });
}
window.addEventListener('resize', moverIndicador);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(moverIndicador);

// ---------- esqueletos com o formato do que vai chegar ----------
const osso = (l, a = 12) => `<i class="osso" style="width:${l};height:${a}px"></i>`;
function esqueletoFicha() {
  return `<article class="ficha esq-ficha" aria-hidden="true">${osso('180px', 30)}${osso('72%', 24)}${osso('46%', 24)}
    <div class="esq-linha">${osso('200px', 46)}${osso('120px', 36)}${osso('180px', 40)}</div>${osso('100%', 14)}
    <div class="esq-grade">${Array.from({ length: 5 }, () => osso('70%', 34)).join('')}</div>
    ${Array.from({ length: 7 }, (_, k) => `<div class="esq-tr">${osso('84px')}${osso(`${52 - k * 4}%`)}${osso('60px')}${osso('60px')}</div>`).join('')}</article>`;
}
function esqueletoCartoes(n = 4) {
  return `<ul class="orc-lista" aria-hidden="true">${Array.from({ length: n }, () => `<li><div class="orc-cartao esq-cartao">${osso('70%', 18)}${osso('45%')}${osso('56%', 30)}${osso('100%', 8)}${osso('80%')}</div></li>`).join('')}</ul>`;
}
function esqueletoTabela(n = 10) {
  return `<div class="esq-tabela" aria-hidden="true">${Array.from({ length: n }, (_, k) => `<div class="esq-tr">${osso('84px')}${osso(`${58 - (k % 4) * 7}%`)}${osso('60px')}${osso('60px')}</div>`).join('')}</div>`;
}
// só mostra o esqueleto se a resposta demorar: carregamento rápido não pisca
function comEsqueleto(alvo, html, espera = 140) {
  const t = setTimeout(() => { alvo.innerHTML = html; }, espera);
  return () => clearTimeout(t);
}

// ---------- visto animado nos avisos de sucesso ----------
const VISTO = '<svg class="visto" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" /><path d="M7.5 12.5 10.5 15.5 16.5 9" /></svg>';
