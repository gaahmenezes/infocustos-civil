// Composições e insumos próprios: criar, montar com itens de várias bases, preço vivo, ficha, orçamento e cópia de oficial.
// Usa o servidor local na porta 8000 (com banco de orçamentos vazio); argumento: pasta das capturas.
const { chromium } = require('playwright'); const OUT = process.argv[2] || require('os').tmpdir(), U = 'http://localhost:8000';
let ok = 0, falha = 0; const v = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); c ? ok++ : falha++; };
const txt = async (p, s) => (await p.textContent(s)).replace(/\s+/g, ' ').trim();
const num = (t) => Number(t.replace(/[^\d,]/g, '').replace(',', '.'));
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 900 } }); const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  const antes = await (await p.request.get(U + '/api/proprias')).json();
  const ja = new Set(antes.composicoes.map((x) => x.codigo)), jaIns = new Set(antes.insumos.map((x) => x.codigo));
  await p.goto(U + '/#/'); await p.evaluate(() => localStorage.clear()); await p.goto(U + '/#/proprias'); await p.waitForSelector('.proprias');
  if (!ja.size) v((await txt(p, '.proprias')).includes('Nenhuma composição própria ainda'), 'Aba nova: Composições próprias, com estado vazio que explica o que fazer');
  v(await p.getAttribute('.abas a[data-aba="proprias"]', 'aria-current') === 'true', 'A aba fica marcada no topo');
  await p.click('.pag-cab [data-nova-propria]'); await p.waitForSelector('#prop-descricao');
  v(/#\/propria\/P\d{4}/.test(p.url()), 'Nova composição abre o editor: ' + p.url().split('#')[1]);
  await p.fill('#prop-descricao', 'Assentamento de porcelanato 90x90 com AC III'); await p.press('#prop-descricao', 'Tab'); await p.waitForTimeout(400);
  await p.fill('#prop-unidade', 'm2'); await p.press('#prop-unidade', 'Tab'); await p.waitForTimeout(400);
  // item da SINAPI pela busca
  await p.fill('#prop-add', 'pedreiro com encargos'); await p.waitForSelector('.add-res li[data-k]');
  const prim = await txt(p, '.add-res li[data-k] .res-cod'); await p.keyboard.press('Enter'); await p.waitForSelector('#prop-corpo tr.item');
  v((await p.$$('#prop-corpo tr.item')).length === 1, 'Busca nas bases e inclui o item com Enter: ' + prim);
  v(await p.evaluate(() => document.activeElement && document.activeElement.classList.contains('qtd')), 'Depois de incluir, o cursor vai para o coeficiente');
  await p.keyboard.type('0,55'); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
  // insumo próprio pelo atalho "Não achou?"
  await p.click('.prop-novo-ins'); await p.waitForSelector('#dlg-insumo-proprio[open]');
  await p.fill('[name=descricao]', 'Porcelanato 90x90 polido (cotação)'); await p.fill('[name=unidade]', 'm2'); await p.fill('[name=preco]', '129,90'); await p.fill('[name=fonte]', 'Loja X, menor de 3 cotações');
  await p.click('#form-insumo-proprio .primario'); await p.waitForFunction(() => document.querySelectorAll('#prop-corpo tr.item').length === 2);
  v(true, 'Insumo próprio cadastrado no diálogo entra direto na composição');
  await p.keyboard.type('1,08'); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
  for (const q of ['argamassa colante', 'servente com encargos']) { await p.fill('#prop-add', q); await p.waitForSelector('.add-res li[data-k]'); await p.keyboard.press('Enter'); await p.waitForTimeout(900); }
  const n = (await p.$$('#prop-corpo tr.item')).length; v(n === 4, `Quatro itens na composição (${n})`);
  const total1 = num(await txt(p, '.preco-grande .valor'));
  const soma = await p.$$eval('#prop-corpo tr.item td.total', (t) => t.reduce((s, x) => s + Number(x.textContent.replace(/[^\d,]/g, '').replace(',', '.') || 0), 0));
  v(Math.abs(soma - total1) < 0.05, `O custo é a soma dos itens (${total1.toFixed(2)})`);
  v(await p.isVisible('.prop-div .mini-barra'), 'Mostra a divisão do custo (mão de obra, material...)');
  await p.screenshot({ path: OUT + '/prop_editor.png', fullPage: true });
  // preço vivo: trocar o mês da SINAPI muda o custo
  await p.goto(U + '/#/'); await p.waitForSelector('#dt-campo'); await p.click('#dt-campo');
  await p.selectOption('[data-dt-mes="SINAPI"]', '2026-08'); await p.click('[data-dt="aplicar"]'); await p.waitForTimeout(800);
  await p.goto(U + '/#/proprias'); await p.waitForSelector('.prop-cartao'); await p.click('.prop-cartao'); await p.waitForSelector('#prop-corpo tr.item');
  const total2 = num(await txt(p, '.preco-grande .valor'));
  v(total2 !== total1 && (await txt(p, '.prop-datas-l')).includes('SINAPIago/2026'), `Preço vivo: com a SINAPI de agosto o custo vai de ${total1.toFixed(2)} para ${total2.toFixed(2)}`);
  // ficha com tabela e fluxo
  await p.click('.prop-editor details.menu summary'); await p.click('.prop-editor [role=menuitem][href*="composicao/PROPRIA"]'); await p.waitForSelector('.arvore');
  v((await txt(p, '.ficha-cod')).includes('PRÓPRIA'), 'Ficha da composição própria abre como as oficiais');
  await p.click('.segmentos[data-vista] [data-v=fluxo]'); await p.waitForSelector('#fluxo .fx-f'); v(true, 'Vista Fluxo funciona na composição própria');
  await p.click('.segmentos[data-vista] [data-v=tabela]');
  await p.click('.arvore .expandir'); await p.waitForSelector('tr.filho'); v(true, 'Composição auxiliar da SINAPI se desdobra dentro da própria');
  // no orçamento
  await p.click('.ficha .acoes [data-adicionar]'); await p.waitForSelector('#dlg-adicionar[open]');
  await p.selectOption('#dlg-orc', 'novo'); await p.fill('#dlg-novo', 'Obra com composição própria'); await p.fill('#dlg-qtd', '50'); await p.click('#dlg-ok');
  await p.waitForSelector('#aviso:not([hidden])'); await p.waitForTimeout(600);
  const orcs = await (await p.request.get(U + '/api/orcamentos')).json(); const o = orcs.find((x) => x.nome === 'Obra com composição própria');
  v(o && o.total > 0 && o.divisao && o.divisao.mat < 1, `Entra no orçamento com custo e divisão do custo (total ${o && o.total})`);
  // busca geral
  await p.goto(U + '/#/'); await p.fill('#q', 'porcelanato 90x90'); await p.waitForSelector('.res');
  v((await p.$$eval('.res .cb-base', (x) => x.slice(0, 2).map((e) => e.textContent))).includes('BASE PRÓPRIA'), 'Na busca geral, o que é próprio aparece primeiro');
  await p.click('.chips[data-filtro="base"] [data-v="PROPRIA"]'); await p.waitForTimeout(600);
  v((await p.$$eval('.res .cb-base', (x) => [...new Set(x.map((e) => e.textContent))])).join() === 'BASE PRÓPRIA', 'Filtro "Próprias" mostra só os itens da empresa');
  // criar a partir de uma oficial
  await p.goto(U + '/#/composicao/SINAPI/103354'); await p.waitForSelector('[data-copiar-propria]');
  const nOficial = await p.$$eval('.arvore tbody tr:not(.secao)', (x) => x.length);
  await p.click('[data-copiar-propria]');
  await p.waitForSelector('.prop-cmp'); v((await txt(p, '.prop-cmp')).includes('103354'), 'Criar própria a partir da oficial: copia os itens e mostra a comparação com a original');
  v((await p.$$('#prop-corpo tr.item')).length === nOficial, `A cópia traz os ${nOficial} itens da 103354 no mês escolhido para a SINAPI`);
  await p.fill('#prop-corpo tr.item:nth-child(3) .qtd', '30'); await p.keyboard.press('Enter'); await p.waitForTimeout(900);
  v(/\d+,\d%/.test(await txt(p, '.prop-cmp')), 'Ao ajustar um coeficiente, a diferença para a original aparece: ' + (await txt(p, '.prop-cmp')).slice(-24));
  await p.screenshot({ path: OUT + '/prop_copia.png', fullPage: true });
  // lista e insumos
  await p.goto(U + '/#/proprias'); await p.waitForSelector('.prop-cartao'); v((await p.$$('.prop-cartao')).length === ja.size + 2, 'Lista com as duas composições próprias novas');
  await p.click('[data-prop-aba] [data-v=insumos]'); v(await p.isVisible('.prop-insumos'), 'Aba de insumos próprios com o cadastrado');
  await p.screenshot({ path: OUT + '/prop_lista.png' });
  await p.click('[data-excluir-insumo]'); await p.click('[data-excluir-insumo]');
  await p.waitForFunction(() => document.querySelector('#aviso').textContent.includes('é usado em'), null, { timeout: 5000 }).catch(() => {});
  v((await txt(p, '#aviso')).includes('é usado em'), 'Insumo em uso não é excluído (avisa onde está): ' + (await txt(p, '#aviso')).slice(0, 60));
  const m = await b.newPage({ viewport: { width: 390, height: 800 } }); await m.goto(U + '/#/proprias'); await m.waitForSelector('.prop-cartao'); await m.click('.prop-cartao'); await m.waitForSelector('#prop-corpo tr.item'); await m.waitForTimeout(400);
  await m.screenshot({ path: OUT + '/prop_cel.png', fullPage: true }); v(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Celular sem rolagem lateral no editor');
  v(!erros.length, 'Sem erros de JavaScript ' + JSON.stringify(erros));
  // limpeza: tira o que o roteiro criou (composições antes dos insumos que elas usam) e o orçamento de teste
  const depois = await (await p.request.get(U + '/api/proprias')).json();
  for (const x of depois.composicoes.filter((y) => !ja.has(y.codigo)).reverse()) await p.request.delete(U + `/api/proprias/composicoes/${x.codigo}`);
  for (const x of depois.insumos.filter((y) => !jaIns.has(y.codigo))) await p.request.delete(U + `/api/proprias/insumos/${x.codigo}`);
  for (const x of (await (await p.request.get(U + '/api/orcamentos')).json()).filter((y) => y.nome === 'Obra com composição própria')) await p.request.delete(U + `/api/orcamentos/${x.id}`);
  console.log(`\n${ok} OK, ${falha} falhas`); await b.close(); process.exitCode = falha ? 1 : 0; })();
