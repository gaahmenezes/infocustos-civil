'use strict';
/* Tela de entrada: números da base contando, resposta animada ao erro e ao acerto, e a cortina que leva ao sistema. */
(() => {
  const $ = (s) => document.querySelector(s);
  const calmo = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const form = $('#form'), senha = $('#senha'), campo = $('#campo'), erro = $('#erro'), bt = $('#entrar');

  // clarão acompanha o cursor
  if (!calmo && window.matchMedia('(hover: hover)').matches) {
    let pedido = 0;
    document.addEventListener('pointermove', (e) => {
      if (pedido) return;
      pedido = requestAnimationFrame(() => { pedido = 0; const c = $('.clarao').style; c.setProperty('--mx', `${e.clientX}px`); c.setProperty('--my', `${e.clientY}px`); });
    }, { passive: true });
  }

  // números da base: contam do zero até o valor (o servidor pode estar acordando; avisa se demorar)
  const fmt = new Intl.NumberFormat('pt-BR');
  function contar(el, alvo) {
    if (calmo) { el.textContent = fmt.format(alvo); return; }
    const t0 = performance.now(), dur = 1100;
    const passo = (t) => { const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 4); el.textContent = fmt.format(Math.round(alvo * e)); if (p < 1) requestAnimationFrame(passo); };
    requestAnimationFrame(passo);
  }
  const aviso = setTimeout(() => { $('#acordando').hidden = false; }, 2500);
  fetch('/api/entrada').then((r) => r.json()).then((d) => {
    clearTimeout(aviso); $('#acordando').hidden = true;
    d.nbases = (d.bases || []).length;
    document.querySelectorAll('[data-n]').forEach((el) => contar(el, d[el.dataset.n] || 0));
    if (d.bases && d.bases.length) $('#rot-mes').textContent = `bases de preços: ${d.bases.join(', ')}`;
  }).catch(() => { clearTimeout(aviso); });

  $('#olho').addEventListener('click', (e) => {
    const b = e.currentTarget, ver = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(ver)); b.setAttribute('aria-label', ver ? 'Esconder a senha' : 'Mostrar a senha');
    senha.type = ver ? 'text' : 'password'; senha.focus();
  });
  senha.addEventListener('input', () => { campo.classList.remove('errado'); erro.textContent = ''; });

  function negar(msg) {
    bt.classList.remove('enviando'); erro.textContent = msg;
    campo.classList.remove('errado'); void campo.offsetWidth; campo.classList.add('errado');
    senha.focus(); senha.select();
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (bt.classList.contains('enviando') || bt.classList.contains('certo')) return;
    if (!senha.value) { negar('Digite a senha.'); return; }
    bt.classList.add('enviando');
    const lento = setTimeout(() => { $('#acordando').hidden = false; }, 2500);
    try {
      const r = await fetch('/api/entrar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ senha: senha.value }) });
      clearTimeout(lento); $('#acordando').hidden = true;
      if (!r.ok) { let m = 'Não foi possível entrar.'; try { m = (await r.json()).detail || m; } catch (_) { /* sem corpo */ } negar(m); return; }
      bt.classList.remove('enviando'); bt.classList.add('certo');
      const q = bt.getBoundingClientRect(), c = $('#cortina');
      c.style.setProperty('--cx', `${q.left + q.width / 2}px`); c.style.setProperty('--cy', `${q.top + q.height / 2}px`);
      const ir = () => { try { sessionStorage.setItem('infocustos-chegou', '1'); } catch (_) { /* sem armazenamento */ } location.replace('/' + location.hash); };
      if (calmo) { ir(); return; }
      setTimeout(() => { c.classList.add('abrir'); }, 380);
      setTimeout(ir, 380 + 600);
    } catch (_) { clearTimeout(lento); negar('Sem conexão com o servidor. Tente de novo.'); }
  });
})();
