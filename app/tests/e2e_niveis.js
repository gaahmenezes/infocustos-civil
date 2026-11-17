// Célula construtiva › etapa › subetapa na planilha: botões "+ Item", "+ Etapa", "+ Subetapa", subir e descer de nível,
// recolher por nível, visão analítica em reais e "Voltar ao orçamento" na ficha. Servidor local na porta 8000 (ou U=...).
const { chromium, devices } = require('playwright'); const OUT = process.argv[2] || require('os').tmpdir(), U = process.env.U || 'http://localhost:8000';
let ok = 0, falha = 0; const v = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); c ? ok++ : falha++; };
const txt = async (p, s) => (await p.textContent(s)).replace(/\s+/g, ' ').trim();
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } }); const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  const api = async (m, u, data) => (await p.request[m](U + u, data ? { data } : undefined)).json();
  await p.goto(U + '/#/'); await p.evaluate(() => localStorage.clear());
  const o = await api('post', '/api/orcamentos', { nome: 'Roteiro níveis', bdi: 25 });
  await p.goto(U + `/#/orcamento/${o.id}`); await p.waitForSelector('tbody.etapa.n1');
  v((await txt(p, 'tbody.n1 .nivel-rot')) === 'Célula construtiva', 'Orçamento novo começa com uma célula construtiva');
  // a célula construtiva é o conjunto macro: recebe etapas, não serviços soltos
  v(!(await p.$('tbody.n1 [data-acao="item-abrir"]')) && (await txt(p, 'tbody.n1 [data-acao="filha-nova"]')) === '+ Etapa', 'A célula construtiva só oferece "+ Etapa" (os serviços entram nas etapas)');
  await p.click('tbody.n1 [data-acao="filha-nova"]'); await p.waitForSelector('tbody.n2');
  await p.keyboard.type('Fundação'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  // "+ Item" vira a caixa de busca e volta a ser botão
  v(await p.isVisible('tbody.n2 [data-acao="item-abrir"]') && await p.isHidden('tbody.n2 .add-q'), 'Na etapa, a busca de item fica recolhida no botão "+ Item"');
  await p.click('tbody.n2 [data-acao="item-abrir"]');
  v(await p.evaluate(() => document.activeElement.classList.contains('add-q')), '"+ Item" abre a busca com o cursor nela');
  await p.keyboard.press('Escape'); await p.waitForTimeout(250);
  v(await p.isVisible('tbody.n2 [data-acao="item-abrir"]'), 'Esc com a busca vazia volta ao botão');
  v(await p.isVisible('tbody.n2 [data-acao="filha-nova"]') && (await txt(p, 'tbody.n2 [data-acao="filha-nova"]')) === '+ Subetapa', '"+ Etapa" cria a etapa, que tem "+ Subetapa"');
  await p.click('tbody.n2 [data-acao="filha-nova"]'); await p.waitForSelector('tbody.n3');
  await p.keyboard.type('Radier'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  v(!(await p.$('tbody.n3 [data-acao="filha-nova"]')), 'A subetapa é o último nível (sem botão de nível abaixo)');
  // itens: um em cada nível
  const ids = await p.$$eval('tbody.etapa', (l) => l.map((t) => Number(t.dataset.etapa)));
  for (const [k, cod, q] of [[1, '87878', 10], [1, '88309', 20], [2, '103354', 30]]) await api('post', `/api/orcamentos/${o.id}/itens`, { etapa_id: ids[k], tipo: 'servico', base: 'SINAPI', codigo: cod, quantidade: q });
  await p.reload(); await p.waitForSelector('tbody.n3 tr.item');
  const nums = await p.$$eval('.planilha-orc tr.etapa-cab td.n, .planilha-orc tr.item td.n', (l) => l.map((t) => t.textContent.replace(/[^\d.]/g, '')));
  v(JSON.stringify(nums) === JSON.stringify(['1', '1.1', '1.1.1', '1.1.2', '1.1.3', '1.1.3.1']), 'Numeração em três níveis: ' + nums.join(' '));
  // visão analítica em reais na célula e na etapa (não na subetapa)
  const anal = await p.$$eval('.etapa-cab .anal-cols', (l) => l.map((t) => t.closest('tbody').dataset.nivel));
  const tAnal = await p.getAttribute('tbody.n1 .anal-cols', 'aria-label');
  const xs = await p.$$eval('.etapa-cab .anal-cols .ac:nth-child(2)', (l) => [...new Set(l.map((x) => Math.round(x.getBoundingClientRect().left)))]);
  v(xs.length === 1, 'As colunas da divisão ficam alinhadas entre a célula e a etapa');
  v(anal.join(',') === '1,2' && /Mão de obra R\$\s?[\d.,]+/.test(tAnal) && /Material R\$/.test(tAnal), 'Divisão em reais no cabeçalho da célula e da etapa (a subetapa fica sem): ' + tAnal.slice(0, 120));
  await p.screenshot({ path: OUT + '/niveis_planilha.png' });
  await p.click('[data-analitico]'); await p.waitForTimeout(300);
  v(!(await p.$('.anal-cols')), 'O botão "Mão de obra e material" esconde a divisão');
  await p.click('[data-analitico]'); await p.waitForSelector('.anal-cols');
  // recolher por nível
  await p.click('[data-plan-nivel="1"]'); await p.waitForTimeout(300);
  v(await p.isHidden('tbody.n2') && await p.isVisible('tbody.n1 .anal-cols'), '"Só células" mostra só as células, com os valores em reais');
  await p.screenshot({ path: OUT + '/niveis_so_celulas.png' });
  await p.click('[data-plan-nivel="2"]'); await p.waitForTimeout(300);
  v(await p.isVisible('tbody.n2 .etapa-cab') && await p.isHidden('tbody.n3'), '"Até etapas" mostra células e etapas');
  await p.click('[data-plan-nivel="tudo"]'); await p.waitForTimeout(300);
  // subir e descer de nível
  await p.click('tbody.n3 [data-acao="nivel-subir"]'); await p.waitForTimeout(700);
  v((await p.$$('tbody.etapa.n3')).length === 0 && (await p.$$('tbody.etapa.n2')).length === 2, 'Subir de nível: a subetapa vira etapa');
  await (await (await p.$$('tbody.etapa.n2')).pop().$('[data-acao="nivel-descer"]')).click(); await p.waitForTimeout(700);
  v((await p.$$('tbody.etapa.n3')).length === 1, 'Descer de nível: volta a ser subetapa da etapa de cima');
  await p.click('tbody.n2 [data-acao="nivel-subir"]'); await p.waitForTimeout(700);
  v((await p.$$('tbody.etapa.n1')).length === 2 && (await p.$$('tbody.etapa.n2')).length === 1, 'Subir a etapa: vira célula construtiva, levando a subetapa (agora etapa)');
  await p.screenshot({ path: OUT + '/niveis_subiu.png' });
  // ficha: voltar ao orçamento
  const cod = await p.getAttribute('tr.item a.cb-p', 'href');
  await p.click('tr.item a.cb-p'); await p.waitForSelector('.voltar-orc');
  v(/orc=\d+/.test(cod) && (await txt(p, '.voltar-orc')).startsWith('Voltar ao orçamento'), 'A ficha aberta pelo orçamento tem "Voltar ao orçamento": ' + await txt(p, '.voltar-orc'));
  await p.screenshot({ path: OUT + '/niveis_ficha.png' });
  await p.click('.voltar-orc'); await p.waitForSelector('.planilha-orc tr.item.destaque');
  v(new RegExp(`#/orcamento/${o.id}`).test(p.url()), 'O botão volta à planilha, com o item em destaque');
  // celular
  const m = await b.newPage(devices['iPhone 13']); await m.goto(U + `/#/orcamento/${o.id}`); await m.waitForSelector('tbody.etapa'); await m.waitForTimeout(600);
  v(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Celular sem rolagem lateral');
  await m.screenshot({ path: OUT + '/niveis_cel.png', fullPage: true });
  v(!erros.length, 'Sem erros de JavaScript ' + JSON.stringify(erros));
  await p.request.delete(U + `/api/orcamentos/${o.id}`);
  console.log(`\n${ok} OK, ${falha} falhas`); await b.close(); process.exitCode = falha ? 1 : 0;
})();
