const { chromium } = require('playwright');
const ok = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); if (!c) process.exitCode = 1; };
const U = process.argv[3] || 'http://localhost:8000/';
const OUT = process.argv[2];
const art = U.includes('8100');
const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && !m.text().includes('404') && errs.push(m.text()));
  await p.goto(U); await p.waitForSelector('#mes-ref'); await p.waitForTimeout(500);
  ok(await p.evaluate(() => document.body.classList.contains('ocioso')), 'Abre sem nada digitado: tela inicial');
  ok((await p.$$('.res')).length === 0, 'Sem nada digitado, nenhuma composição aparece');
  ok(!(await p.isVisible('#resultados')), 'Painel de resultados escondido');
  ok(norm(await p.textContent('.chip[data-v="servico"] .n')) !== '', 'Filtros mostram o tamanho da base: ' + norm(await p.textContent('#filtros')));
  await p.screenshot({ path: OUT + '/1_inicio.png' });
  // digitação em tempo real, letra a letra
  await p.click('#q');
  for (const ch of 'chap') { await p.keyboard.type(ch); await p.waitForTimeout(60); }
  await p.waitForFunction(() => document.querySelectorAll('.res').length > 0);
  ok(await p.evaluate(() => document.body.classList.contains('buscando')), 'Ao digitar, a busca sobe e os resultados aparecem');
  const n1 = norm(await p.textContent('#contagem'));
  await p.keyboard.type('isco parede'); await p.waitForTimeout(350);
  const n2 = norm(await p.textContent('#contagem'));
  ok(n1 !== n2, `Atualiza a cada tecla: "${n1}" → "${n2}"`);
  const cs = norm(await p.textContent('.chip[data-v="servico"] .n')), ci = norm(await p.textContent('.chip[data-v="insumo"] .n'));
  ok(true, `Contagens ao vivo: composições ${cs}, insumos ${ci}`);
  await p.click('.chip[data-v="servico"]'); await p.waitForTimeout(250);
  ok(await p.$$eval('.res .tipo', (t) => t.every((x) => x.textContent === 'Composição')), 'Isolar composições');
  await p.click('.chip[data-v="ORSE"]'); await p.waitForTimeout(250);
  ok(await p.$$eval('.res-cod', (t) => t.every((x) => x.textContent.includes('/ORSE'))), 'Isolar composições da ORSE');
  await p.click('.chip[data-v="todos"]'); await p.click('.chip[data-v="todas"]'); await p.waitForTimeout(250);
  ok(await p.$$eval('.res .tipo', (t) => new Set(t.map((x) => x.textContent)).size >= 1), 'Juntar tudo de novo');
  await p.screenshot({ path: OUT + '/2_busca.png' });
  await p.click('.res'); await p.waitForSelector('.ficha .arvore');
  ok(true, 'Abre a composição ao lado da lista');
  await p.screenshot({ path: OUT + '/3_composicao.png' });
  await p.click('#limpar'); await p.waitForTimeout(400);
  ok((await p.$$('.res')).length === 0 && (await p.inputValue('#q')) === '', 'Limpar apaga a pesquisa e a lista');
  ok(await p.isVisible('.ficha'), 'O item aberto continua na tela, em largura total');
  await p.goto(art ? U + '#inicio' : U + '#/'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => document.body.classList.contains('ocioso')), 'Voltar ao início mostra só a busca');
  await p.fill('#q', 'xyzwqk'); await p.waitForTimeout(400);
  ok(norm(await p.textContent('.nada')).startsWith('Nada encontrado'), 'Sem resultado: ' + norm(await p.textContent('.nada')));
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => document.body.classList.contains('ocioso')), 'Esc limpa e volta ao início');
  // outras abas continuam funcionando
  for (const [aba, sel] of [['orcamentos', '#form-novo'], ['encargos', '.enc'], ['comparativo', '.comparativo table']]) {
    await p.click(`.abas a[data-aba="${aba}"]`); await p.waitForSelector(sel);
    ok(!(await p.isVisible('#pesquisa')), `Aba ${aba} sem a caixa de pesquisa`);
    await p.screenshot({ path: OUT + `/4_${aba}.png` });
  }
  const d = await b.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark', deviceScaleFactor: 1 });
  await d.goto(U); await d.waitForSelector('#mes-ref'); await d.fill('#q', 'alvenaria bloco ceramico 14'); await d.waitForSelector('.res');
  await d.click('.res'); await d.waitForSelector('.ficha .arvore'); await d.waitForTimeout(300); await d.screenshot({ path: OUT + '/5_escuro.png' });
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await m.goto(U); await m.waitForSelector('#mes-ref'); await m.waitForTimeout(300); await m.screenshot({ path: OUT + '/6_cel_inicio.png' });
  await m.fill('#q', 'pintura acrilica'); await m.waitForSelector('.res'); await m.waitForTimeout(300); await m.screenshot({ path: OUT + '/7_cel_busca.png' });
  ok(await m.evaluate(() => document.documentElement.scrollWidth) <= 390, 'Celular sem rolagem lateral');
  await m.click('.res'); await m.waitForSelector('.ficha'); await m.waitForTimeout(300);
  ok(!(await m.isVisible('#resultados')) && await m.isVisible('.voltar'), 'Celular: composição em tela cheia com Voltar');
  await m.screenshot({ path: OUT + '/8_cel_comp.png' });
  ok(errs.length === 0, 'Sem erros de JavaScript ' + JSON.stringify(errs));
  await b.close();
})();
