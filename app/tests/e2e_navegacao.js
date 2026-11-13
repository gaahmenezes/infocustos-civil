// Depois de abrir o site, todas as abas aparecem e a troca de cores funciona. Servidor local na porta 8000.
const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } }); const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  let ok = 0, f = 0; const v = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); c ? ok++ : f++; };
  const visivel = async (sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(), c = getComputedStyle(e); return r.height > 0 && c.visibility === 'visible' && c.display !== 'none'; }, sel);
  await p.goto('http://localhost:8000/'); await p.waitForSelector('.ap-cta'); await p.waitForTimeout(600);
  v(!(await p.evaluate(() => document.documentElement.className.includes('vai-'))), 'Depois de carregar, a marca de entrada sai');
  await p.click('.ap-cta'); await p.waitForTimeout(700); v(await visivel('#q') && await visivel('.pesquisa'), 'Apresentação -> Consulta: a busca aparece');
  await p.fill('#q', 'chapisco'); await p.waitForSelector('.res'); v(await visivel('.res'), 'Resultados da busca aparecem');
  for (const [aba, sel] of [['orcamentos', '.orcamentos, .pagina'], ['proprias', '.proprias'], ['encargos', '#detalhe .pagina, #detalhe article'], ['comparativo', '#detalhe .pagina, #detalhe article']]) {
    await p.click(`.abas a[data-aba="${aba}"]`); await p.waitForTimeout(900); v(await visivel(sel), `Aba ${aba} aparece`); }
  const fundo = () => p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await p.click('.abas a[data-aba="consulta"]'); await p.waitForTimeout(500);
  const f1 = await fundo(); await p.click('#tema, [data-tema], .tema'); await p.waitForTimeout(900); const f2 = await fundo();
  v(f1 !== f2, `Troca de cores funciona (${f1} -> ${f2})`);
  await p.goto('http://localhost:8000/#/orcamentos'); await p.reload(); await p.waitForTimeout(1200); await p.click('.abas a[data-aba="consulta"]'); await p.waitForTimeout(600);
  v(await visivel('#q'), 'Link direto para orçamentos e depois Consulta: aparece');
  v(!erros.length, 'Sem erros de JavaScript ' + JSON.stringify(erros)); console.log(`${ok} OK, ${f} falhas`); await b.close(); })();
