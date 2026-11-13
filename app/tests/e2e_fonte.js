// O rodapé "Fonte" da ficha mostra o mês da base do item, e não o mês da ORSE. Servidor local na porta 8000.
const { chromium } = require('playwright'); const U = 'http://localhost:8000';
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 860 } }); let ok = 0, f = 0; const v = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); c ? ok++ : f++; };
  const txt = async (s) => (await p.textContent(s)).replace(/\s+/g, ' ').trim();
  const ult = (await (await p.request.get(U + '/api/referencia')).json()).bases.SINAPI.meses.at(-1).descricao;  // mês mais recente da SINAPI
  for (const [rota, mes] of [['#/insumo/SINAPI/43356', ult], ['#/composicao/SINAPI/87878', ult], ['#/insumo/ORSE/00158', 'agosto/2026'], ['#/composicao/SICRO/0307731', 'julho/2026']]) {
    await p.goto(U + '/' + rota); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForSelector('.ficha .fonte'); await p.waitForTimeout(400);
    const fonte = (await p.$$eval('.ficha .fonte', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()))).find((t) => t.startsWith('Fonte')) || ''; v(fonte.includes('referência ' + mes), `${rota}: ${fonte.slice(0, 90)}`); }
  await p.goto(U + '/#/'); await p.waitForSelector('#dt-campo'); await p.click('#dt-campo'); await p.selectOption('[data-dt-mes="SINAPI"]', '2026-07'); await p.click('[data-dt="aplicar"]'); await p.waitForTimeout(600);
  await p.goto(U + '/#/insumo/SINAPI/43356'); await p.waitForSelector('.ficha .fonte'); await p.waitForTimeout(500);
  v((await txt('.ficha .fonte')).includes('julho/2026') && (await txt('.ficha')).includes('105,51'), 'Trocando a SINAPI para julho: preço (105,51) e rodapé de julho');
  console.log(`${ok} OK, ${f} falhas`); await b.close(); process.exitCode = f ? 1 : 0; })();
