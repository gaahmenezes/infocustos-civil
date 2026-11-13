// Mostra, quadro a quadro, o que aparece durante o carregamento. Uso: node e2e_piscada.js <pasta> [url] [lento]
const { chromium } = require('playwright'); const OUT = process.argv[2], URL = process.argv[3] || 'http://localhost:8000/';
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1280, height: 760 } });
  const linhas = [];
  await p.addInitScript(() => {
    const t0 = performance.now(); window.__q = [];
    const amostra = () => {
      const ab = document.getElementById('abertura'), d = document.getElementById('detalhe');
      const vis = (sel) => { const e = document.querySelector(sel); if (!e) return '-'; const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return (r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05) ? 'S' : 'n'; };
      window.__q.push([Math.round(performance.now() - t0), location.hash, document.body ? document.body.dataset.aba || '' : '', ab ? (getComputedStyle(ab).opacity + '/' + ab.className) : 'sem-cortina', vis('.pesquisa') + (document.querySelector('.area') ? getComputedStyle(document.querySelector('.area')).visibility[0] : ''), vis('.ocioso-inicio, .inicio, .hero, #numeros'), vis('.ap-heroi'), d ? d.textContent.trim().slice(0, 40).replace(/\s+/g, ' ') : '']);
      if (performance.now() - t0 < 4000) requestAnimationFrame(amostra);
    };
    requestAnimationFrame(amostra);
  });
  if (process.argv[4]) await p.route('**/api/referencia*', async (r) => { await new Promise((ok) => setTimeout(ok, 1500)); r.continue(); });
  await p.goto(URL); await p.waitForTimeout(4200);
  const q = await p.evaluate(() => window.__q); let ant = '';
  for (const x of q) { const k = x.slice(1).join(' | '); if (k !== ant) console.log(x[0] + 'ms', k); ant = k; }
  await b.close(); })();
