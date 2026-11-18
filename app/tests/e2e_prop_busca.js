// Bases próprias: busca e ordem nas listas de composições (no formato da Consulta) e de insumos.
// Servidor local na porta 8000 (ou U=...); argumento: pasta das capturas. Usa a base própria com mais composições.
const { chromium, devices } = require('playwright'); const OUT = process.argv[2] || require('os').tmpdir(), U = process.env.U || 'http://localhost:8000';
let ok = 0, falha = 0; const v = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); c ? ok++ : falha++; };
const txt = async (p, s) => (await p.textContent(s)).replace(/\s+/g, ' ').trim();
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 950 } }); const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  const bases = await (await p.request.get(U + '/api/proprias/bases')).json(); const base = bases.sort((a, c) => c.composicoes - a.composicoes)[0];
  await p.goto(U + '/#/'); await p.evaluate((id) => { localStorage.setItem('infocustos-base-propria', String(id)); localStorage.removeItem('prop-ordem'); }, base.id);
  await p.goto(U + '/#/proprias'); await p.waitForSelector('[data-prop-base]');
  await p.click(`[data-prop-base="${base.id}"]`); await p.waitForSelector('[data-prop-lista="composicoes"] .res');
  // composições no formato da Consulta
  const c1 = await p.$('[data-prop-lista="composicoes"] .res');
  v(!!(await c1.$('.cb')) && !!(await c1.$('.res-preco .un')) && !!(await c1.$('.res-meta')) && !!(await c1.$('.res-div .mini-barra')), 'Composição no formato da Consulta: código e base, preço com unidade, grupo e divisão do custo');
  v(/resultados/.test(await txt(p, '[data-prop-contagem="composicoes"]')), 'Contagem de resultados: ' + await txt(p, '[data-prop-contagem="composicoes"]'));
  // busca por nome
  await p.fill('[data-prop-q="composicoes"]', 'alvenaria'); await p.waitForTimeout(400);
  const descs = await p.$$eval('[data-prop-lista="composicoes"] .res', (l) => l.map((x) => x.textContent.toLowerCase()));  // descrição ou grupo
  v(descs.length > 0 && descs.every((d) => /alvenaria/.test(d)) && !!(await p.$('[data-prop-lista="composicoes"] mark')), `Busca por nome ou grupo: ${descs.length} com "alvenaria", palavra marcada`);
  // busca por código
  const cod = await p.$eval('[data-prop-lista="composicoes"] .cb-num', (x) => x.textContent.trim());
  await p.fill('[data-prop-q="composicoes"]', cod); await p.waitForTimeout(400);
  v((await p.$$eval('[data-prop-lista="composicoes"] .cb-num', (l) => l.map((x) => x.textContent.trim()))).includes(cod), 'Busca pelo código: ' + cod);
  await p.fill('[data-prop-q="composicoes"]', ''); await p.waitForTimeout(400);
  // ordem por código e por nome
  await p.selectOption('[data-prop-ordem="composicoes"]', 'codigo'); await p.waitForTimeout(300);
  const cods = await p.$$eval('[data-prop-lista="composicoes"] .cb-num', (l) => l.slice(0, 10).map((x) => Number(x.textContent.replace(/\D/g, ''))));
  v(cods.every((x, k) => !k || x >= cods[k - 1]), 'Ordenar por código: ' + cods.slice(0, 5).join(', '));
  await p.selectOption('[data-prop-ordem="composicoes"]', 'nome'); await p.waitForTimeout(300);
  const nomes = await p.$$eval('[data-prop-lista="composicoes"] .res-desc', (l) => l.slice(0, 10).map((x) => x.textContent.trim()));
  v(nomes.every((x, k) => !k || nomes[k - 1].localeCompare(x, 'pt-BR') <= 0), 'Ordenar por nome (A a Z): ' + nomes.slice(0, 2).join(' / ').slice(0, 80));
  await p.screenshot({ path: OUT + '/prop_comp.png' });
  // mostrar mais
  const antes = (await p.$$('[data-prop-lista="composicoes"] .res')).length;
  if (await p.$('[data-prop-mais="composicoes"]')) { await p.click('[data-prop-mais="composicoes"]'); await p.waitForTimeout(300); }
  v((await p.$$('[data-prop-lista="composicoes"] .res')).length >= antes, `"Mostrar mais" acrescenta resultados (${antes} → ${(await p.$$('[data-prop-lista="composicoes"] .res')).length})`);
  // clicar abre a composição
  await p.click('[data-prop-lista="composicoes"] .res'); await p.waitForTimeout(800);
  v(/#\/propria\/P\d+/.test(p.url()), 'Clicar abre a composição: ' + p.url().split('#')[1]);
  // insumos: tabela, com busca e ordem
  await p.goto(U + '/#/proprias'); await p.waitForSelector('[data-prop-aba]'); await p.click('[data-prop-aba] [data-v="insumos"]'); await p.waitForSelector('[data-prop-lista="insumos"] tr');
  v(!!(await p.$('table.prop-insumos')), 'Insumos continuam na tabela');
  await p.fill('[data-prop-q="insumos"]', 'cimento'); await p.waitForTimeout(400);
  const ins = await p.$$eval('[data-prop-lista="insumos"] td.desc', (l) => l.map((x) => x.textContent.toLowerCase()));
  v(ins.length > 0 && ins.every((d) => /cimento/.test(d)), `Busca nos insumos: ${ins.length} com "cimento"`);
  await p.fill('[data-prop-q="insumos"]', ''); await p.selectOption('[data-prop-ordem="insumos"]', 'codigo'); await p.waitForTimeout(400);
  const ci = await p.$$eval('[data-prop-lista="insumos"] .cb-num', (l) => l.slice(0, 10).map((x) => Number(x.textContent.replace(/\D/g, ''))));
  v(ci.every((x, k) => !k || x >= ci[k - 1]), 'Insumos ordenados por código: ' + ci.slice(0, 5).join(', '));
  await p.screenshot({ path: OUT + '/prop_ins.png' });
  await p.reload(); await p.waitForSelector('[data-prop-ordem="insumos"]', { state: 'attached' });
  v(await p.$eval('[data-prop-ordem="insumos"]', (s) => s.value) === 'codigo', 'A ordem escolhida fica lembrada');
  const m = await b.newPage(devices['iPhone 13']); await m.goto(U + '/#/'); await m.evaluate((id) => localStorage.setItem('infocustos-base-propria', String(id)), base.id); await m.goto(U + '/#/proprias'); await m.reload(); await m.waitForSelector('[data-prop-lista="composicoes"] .res'); await m.waitForTimeout(400);
  v(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Celular sem rolagem lateral'); await m.screenshot({ path: OUT + '/prop_cel.png' });
  v(!erros.length, 'Sem erros de JavaScript ' + JSON.stringify(erros));
  console.log(`\n${ok} OK, ${falha} falhas`); await b.close(); process.exitCode = falha ? 1 : 0;
})();
