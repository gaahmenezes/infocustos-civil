// Preço do insumo próprio editado dentro da composição: grava na base e vale em todas as composições que o usam.
// Servidor local na porta 8000 (ou U=...); argumento: pasta das capturas.
const { chromium } = require('playwright'); const OUT = process.argv[2] || require('os').tmpdir(), U = process.env.U || 'http://localhost:8000';
let ok = 0, falha = 0; const v = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); c ? ok++ : falha++; };
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 950 } }); const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  const api = async (m, u, data) => (await p.request[m](U + u, data ? { data } : undefined)).json();
  const ins = await api('post', '/api/proprias/insumos', { descricao: 'Bloquete roteiro preço', unidade: 'm2', tipo: 'MATERIAL', preco: 54 });
  const c1 = await api('post', '/api/proprias/composicoes', { descricao: 'Roteiro preço A', unidade: 'm2' });
  const c2 = await api('post', '/api/proprias/composicoes', { descricao: 'Roteiro preço B', unidade: 'm2' });
  for (const c of [c1, c2]) await api('post', `/api/proprias/composicoes/${c.codigo}/itens`, { tipo: 'insumo', base: 'PROPRIA', codigo: ins.codigo, qtd: 1.05 });
  await api('post', `/api/proprias/composicoes/${c1.codigo}/itens`, { tipo: 'servico', base: 'SINAPI', codigo: '88309', qtd: 0.5 });
  await p.goto(U + `/#/propria/${c1.codigo}`); await p.waitForSelector(`[data-prop-preco="${ins.codigo}"]`);
  v(await p.$$eval('[data-prop-preco]', (l) => l.length) === 1, 'Só o insumo próprio tem o preço editável (o item da SINAPI não)');
  await p.fill(`[data-prop-preco="${ins.codigo}"]`, '58,90'); await p.press(`[data-prop-preco="${ins.codigo}"]`, 'Enter');
  await p.waitForFunction((cod) => (document.querySelector(`[data-prop-preco="${cod}"]`) || {}).value === '58,90' && document.querySelector('#avisos, .aviso, [role=status]'), ins.codigo).catch(() => {});
  await p.waitForTimeout(900);
  const i = await api('get', `/api/insumo/PROPRIA/${ins.codigo}`);
  v(i.preco === 58.9 && i.data_preco === new Date().toISOString().slice(0, 10), `O preço vai para a base: R$ ${i.preco}, com a data de hoje`);
  const a = await api('get', `/api/proprias/composicoes/${c1.codigo}`), bb = await api('get', `/api/proprias/composicoes/${c2.codigo}`);
  const it = a.itens.find((x) => x.codigo === ins.codigo);
  v(it.custo_unit === 58.9 && Math.abs(it.custo_total - 61.845) < 0.001, 'A composição recalcula o item: 1,05 × 58,90 = 61,85');
  v(Math.abs(bb.custo_total - 61.845) < 0.001, 'A outra composição que usa o insumo também muda');
  v(/outra composição/.test(await p.textContent('body')), 'O aviso diz que o preço vale em outra composição');
  // o editor usa os meses escolhidos no topo: confere o preço grande com a soma da própria tabela
  const soma = await p.$$eval('#prop-corpo tr.item td.total', (l) => l.reduce((t, x) => t + Number(x.textContent.replace(/[^\d,]/g, '').replace(',', '.')), 0));
  v((await p.textContent('.preco-grande')).includes(soma.toFixed(2).replace('.', ',')), 'O preço grande acompanha: R$ ' + soma.toFixed(2));
  await p.screenshot({ path: OUT + '/preco_ins.png' });
  v(!erros.length, 'Sem erros de JavaScript ' + JSON.stringify(erros));
  for (const c of [c1, c2]) await p.request.delete(U + `/api/proprias/composicoes/${c.codigo}`);
  await p.request.delete(U + `/api/proprias/insumos/${ins.codigo}`);
  console.log(`\n${ok} OK, ${falha} falhas`); await b.close(); process.exitCode = falha ? 1 : 0;
})();
