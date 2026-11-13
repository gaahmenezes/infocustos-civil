// A primeira tela ao acessar o site é a apresentação. Servidores: :8000 sem senha e :8001 com INFOCUSTOS_SENHA=obra123; argumento: pasta das capturas.
const { chromium } = require('playwright'); const OUT = process.argv[2];
(async () => { const b = await chromium.launch(); const erros = []; let ok = 0, f = 0; const v = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); c ? ok++ : f++; };
  const p = await b.newPage({ viewport: { width: 1366, height: 860 } }); p.on('pageerror', (e) => erros.push(e.message));
  await p.goto('http://localhost:8000/'); await p.waitForSelector('.ap-cta'); await p.waitForTimeout(800);
  v(p.url().endsWith('#/apresentacao') && await p.getAttribute('body', 'data-aba') === 'apresentacao', 'Endereço do site abre a apresentação: ' + p.url());
  await p.screenshot({ path: OUT + '/ap_inicio.png' });
  await p.click('.ap-cta'); await p.waitForSelector('#q'); await p.waitForTimeout(400);
  v(p.url().endsWith('#/') && await p.getAttribute('body', 'data-aba') === 'consulta', '"Começar a orçar" leva à consulta');
  await p.reload(); await p.waitForTimeout(1200); v(await p.getAttribute('body', 'data-aba') === 'consulta', 'Recarregar a consulta continua na consulta');
  await p.goBack(); await p.waitForTimeout(800); v(await p.getAttribute('body', 'data-aba') === 'apresentacao', 'Voltar do navegador retorna à apresentação');
  await p.goto('http://localhost:8000/#/orcamentos'); await p.waitForTimeout(1200); v(await p.getAttribute('body', 'data-aba') === 'orcamentos', 'Link direto (#/orcamentos) abre a tela pedida');
  // com senha: depois de entrar, cai na apresentação
  const q = await b.newPage({ viewport: { width: 1366, height: 860 } });
  await q.goto('http://localhost:8001/'); await q.waitForSelector('#senha, input[type=password]');
  await q.fill('input[type=password]', 'obra123'); await q.keyboard.press('Enter'); await q.waitForSelector('.ap-cta', { timeout: 15000 }); await q.waitForTimeout(1500);
  v(q.url().endsWith('#/apresentacao'), 'Depois de entrar com a senha, a primeira tela é a apresentação');
  const m = await b.newPage({ viewport: { width: 390, height: 800 } }); await m.goto('http://localhost:8000/'); await m.waitForSelector('.ap-cta'); await m.waitForTimeout(800);
  await m.screenshot({ path: OUT + '/ap_cel.png' }); v(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Celular: apresentação sem rolagem lateral');
  v(!erros.length, 'Sem erros de JavaScript ' + JSON.stringify(erros)); console.log(`${ok} OK, ${f} falhas`); await b.close(); })();
