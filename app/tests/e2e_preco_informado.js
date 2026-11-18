// Composição própria com preço informado (proposta), por grupo de insumo, como no SIENGE.
// Servidor local na porta 8000 (ou U=...); argumento: pasta das capturas.
const { chromium, devices } = require('playwright'); const OUT = process.argv[2] || require('os').tmpdir(), U = process.env.U || 'http://localhost:8000';
let ok = 0, falha = 0; const v = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); c ? ok++ : falha++; };
const txt = async (p, s) => (await p.textContent(s)).replace(/\s+/g, ' ').trim();
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 950 } }); const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  const api = async (m, u, data) => (await p.request[m](U + u, data ? { data } : undefined)).json();
  const base = await api('post', '/api/proprias/bases', { nome: `Proposta ${Date.now() % 100000}` });
  const ins = await api('post', '/api/proprias/insumos', { descricao: 'Gesseiro', unidade: 'h', preco: 20, tipo: 'MAO_DE_OBRA', base_id: base.id });
  const k = (await api('post', '/api/proprias/composicoes', { descricao: 'Forro de gesso acartonado (roteiro proposta)', unidade: 'm2', base_id: base.id })).codigo;
  await api('post', `/api/proprias/composicoes/${k}/itens`, { tipo: 'insumo', base: 'PROPRIA', codigo: ins.codigo, qtd: 1.5 });
  await p.goto(U + `/#/propria/${k}`); await p.waitForSelector('#prop-tipo-preco');
  v(await p.$eval('#prop-tipo-preco', (s) => s.value) === 'composto' && /30,00/.test(await txt(p, '.preco-grande')), 'Começa com preço composto: soma dos itens (R$ 30,00)');
  // passa para informado: começa com a divisão atual e aceita os valores da proposta
  await p.selectOption('#prop-tipo-preco', 'informado'); await p.waitForSelector('[data-prop-inf="mat"]');
  v(/30,00/.test(await p.inputValue('[data-prop-inf="mo"]')), 'Ao escolher "Informado", os grupos começam com a divisão atual (mão de obra R$ 30,00)');
  await p.fill('[data-prop-inf="mo"]', '18,50'); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
  await p.fill('[data-prop-inf="mat"]', '27,30'); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
  await p.fill('#prop-proposta', 'Gesso Forte · proposta 118'); await p.keyboard.press('Tab'); await p.waitForTimeout(700);
  v(/45,80/.test(await txt(p, '.preco-grande')) && /45,80/.test(await txt(p, '.prop-grupos tfoot')), 'Preço informado = soma dos grupos: R$ 45,80');
  v(/preço informado/i.test(await txt(p, '.prop-inf-nota')) && /30,00/.test(await txt(p, '.prop-inf-nota')), 'Os itens ficam como referência, com a soma deles ao lado: ' + (await txt(p, '.prop-inf-nota')).slice(0, 110));
  await p.screenshot({ path: OUT + '/informado_editor.png', fullPage: true });
  // vale na consulta e no orçamento
  await p.goto(U + `/#/composicao/PROPRIA/${k}`); await p.waitForSelector('.ficha .preco-grande');
  v(/45,80/.test(await txt(p, '.preco-grande')) && /Preço informado/.test(await txt(p, '.ficha-cod')), 'A ficha mostra o preço informado e a proposta: ' + await txt(p, '.ficha-cod .selo'));
  const o = await api('post', '/api/orcamentos', { nome: 'Roteiro proposta', bdi: 0 });
  const o2 = await api('post', `/api/orcamentos/${o.id}/itens`, { tipo: 'servico', base: 'PROPRIA', codigo: k, quantidade: 100 });
  v(Math.abs(o2.custo_total - 4580) < 0.01, `No orçamento: 100 m² × R$ 45,80 = ${o2.custo_total}`);
  const it = o2.etapas.flatMap((e) => e.itens)[0];
  v(it.div && Math.abs(it.div.mo - 18.5 / 45.8) < 0.001, 'A divisão de mão de obra e material do item sai da proposta');
  // volta a composto
  await p.goto(U + `/#/propria/${k}`); await p.waitForSelector('#prop-tipo-preco'); await p.selectOption('#prop-tipo-preco', 'composto'); await p.waitForTimeout(800);
  v(/30,00/.test(await txt(p, '.preco-grande')) && !(await p.$('[data-prop-inf]')), 'Voltar para "Composto" usa de novo a soma dos itens');
  const m = await b.newPage(devices['iPhone 13']); await m.goto(U + `/#/propria/${k}`); await m.waitForSelector('#prop-tipo-preco'); await m.waitForTimeout(400);
  v(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Celular sem rolagem lateral');
  v(!erros.length, 'Sem erros de JavaScript ' + JSON.stringify(erros));
  await p.request.delete(U + `/api/orcamentos/${o.id}`); await p.request.delete(U + `/api/proprias/composicoes/${k}`);
  console.log(`\n${ok} OK, ${falha} falhas`); await b.close(); process.exitCode = falha ? 1 : 0;
})();
