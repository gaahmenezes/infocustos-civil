// Seletor de bases e datas-base. Usa o servidor local na porta 8000; argumento: pasta das capturas.
const { chromium } = require('playwright'); const OUT = process.argv[2], U = 'http://localhost:8000';
let ok = 0, falha = 0; const v = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); c ? ok++ : falha++; };
const txt = async (p, s) => (await p.textContent(s)).replace(/\s+/g, ' ').trim();
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 900 } }); const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  await p.goto(U + '/'); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('#dt-campo');
  v((await txt(p, '#dt-campo')).replace(/ /g, '') === 'ORSEago/2026SINAPIset/2026SICROjul/2026', 'Campo mostra uma etiqueta por base com o mês: ' + await txt(p, '#dt-campo'));
  await p.fill('#q', 'concreto'); await p.waitForSelector('.res'); await p.waitForTimeout(400);
  v(await p.$$eval('.chips[data-filtro="base"] .chip:not([hidden]) .n', (x) => x.every((e) => +e.textContent.replace(/\D/g, '') > 0)) && (await p.$$eval('.chips[data-filtro="base"] .chip:not([hidden])', (x) => x.length)) === 4, 'Pesquisa em todas as bases juntas (contagem em cada uma)');
  await p.click('#dt-campo'); v(await p.isVisible('#dt-painel'), 'Clique abre o quadro');
  await p.screenshot({ path: OUT + '/dt_painel.png' });
  await p.uncheck('[data-dt-base="ORSE"]'); await p.selectOption('[data-dt-mes="SINAPI"]', '2026-05');
  v(await p.isDisabled('[data-dt-mes="ORSE"]'), 'Base desmarcada: o mês dela fica desativado');
  v((await txt(p, '#dt-campo')).includes('ORSE'), 'Antes de aplicar, nada muda na pesquisa');
  await p.click('[data-dt="aplicar"]'); await p.waitForTimeout(1200);
  v((await txt(p, '#dt-campo')).replace(/ /g, '') === 'SINAPImai/2026SICROjul/2026', 'Aplicar: só SINAPI (maio) e SICRO (julho): ' + await txt(p, '#dt-campo'));
  const bases = await p.$$eval('.res .cb-base', (x) => [...new Set(x.map((e) => e.textContent))]);
  v(!bases.includes('ORSE') && bases.length >= 1, 'A busca deixa a ORSE de fora: ' + bases);
  v(await p.isHidden('.chips[data-filtro="base"] [data-v="ORSE"]'), 'O filtro rápido da ORSE some');
  await p.click('.res'); await p.waitForSelector('.ficha .preco-grande'); v(/maio\/2026|julho\/2026/.test(await txt(p, '.ficha')), 'Ficha aberta no mês da sua base');
  await p.goBack(); await p.waitForTimeout(400);
  await p.click('#dt-campo'); await p.click('[data-dt="nenhuma"]');
  v(await p.isDisabled('[data-dt="aplicar"]') && (await txt(p, '.dt-aviso')).includes('pelo menos uma'), 'Sem nenhuma base, Aplicar fica bloqueado e avisa');
  await p.keyboard.press('Escape'); v(await p.isHidden('#dt-painel') && (await txt(p, '#dt-campo')).startsWith('SINAPI'), 'Esc fecha e descarta o rascunho');
  await p.click('#dt-campo'); await p.click('[data-dt="todas"]'); await p.click('[data-dt="recentes"]'); await p.click('[data-dt="aplicar"]'); await p.waitForTimeout(1200);
  v((await txt(p, '#dt-campo')).replace(/ /g, '') === 'ORSEago/2026SINAPIset/2026SICROjul/2026', 'Marcar todas + Mais recentes volta ao padrão');
  await p.reload(); await p.waitForSelector('#dt-campo'); v((await txt(p, '#dt-campo')).startsWith('ORSEago'), 'A escolha fica guardada depois de recarregar');
  for (const tema of ['dark']) { const d = await b.newPage({ viewport: { width: 1366, height: 900 }, colorScheme: tema }); await d.goto(U + '/'); await d.waitForSelector('#dt-campo'); await d.click('#dt-campo'); await d.waitForTimeout(300); await d.screenshot({ path: OUT + '/dt_escuro.png' }); await d.close(); }
  const m = await b.newPage({ viewport: { width: 390, height: 800 } }); await m.goto(U + '/'); await m.waitForSelector('#dt-campo', { state: 'attached' }); await m.waitForTimeout(400);
  await m.screenshot({ path: OUT + '/dt_cel.png' }); if (await m.isVisible('#dt-campo')) { await m.click('#dt-campo'); await m.waitForTimeout(300); await m.screenshot({ path: OUT + '/dt_cel_painel.png' }); }
  v(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Celular sem rolagem lateral');
  v(!erros.length, 'Sem erros de JavaScript ' + JSON.stringify(erros));
  console.log(`\n${ok} OK, ${falha} falhas`); await b.close(); process.exitCode = falha ? 1 : 0; })();
