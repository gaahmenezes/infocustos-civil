// Planilha do orçamento: recolher etapas (com total e divisão do custo no cabeçalho), "Só etapas", navegação por
// teclado entre as quantidades (gravando), régua de peso e anel de foco. Servidor local na porta 8000; argumento: pasta das capturas.
const { chromium } = require('playwright'); const OUT = process.argv[2], U = 'http://localhost:8000';
let ok = 0, falha = 0; const v = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); c ? ok++ : falha++; };
const txt = async (p, s) => (await p.textContent(s)).replace(/\s+/g, ' ').trim();
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 900 } }); const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  const api = async (m, u, data) => (await p.request[m](U + u, data ? { data } : undefined)).json();
  let o = await api('post', '/api/orcamentos', { nome: 'Roteiro planilha', bdi: 25 });
  const e1 = o.etapas[0].id;
  o = await api('post', `/api/orcamentos/${o.id}/etapas`, { titulo: 'Fundação' }); const e2 = o.etapa_criada;
  o = await api('post', `/api/orcamentos/${o.id}/etapas`, { titulo: 'Radier', pai_id: e2 }); const s1 = o.etapa_criada;
  for (const [et, cod, q] of [[e1, '87878', 120], [e1, '88309', 40], [e2, '103354', 300], [s1, '94965', 12], [s1, '88316', 90]])
    await api('post', `/api/orcamentos/${o.id}/itens`, { etapa_id: et, tipo: 'servico', base: 'SINAPI', codigo: cod, quantidade: q });
  await p.goto(U + '/#/'); await p.evaluate(() => localStorage.clear());
  await p.goto(U + `/#/orcamento/${o.id}`); await p.waitForSelector('.planilha-orc tr.item');
  // régua de peso
  const reguas = await p.$$eval('.regua', (x) => x.map((e) => [e.className, e.style.getPropertyValue('--p'), e.getAttribute('title')]));
  v(reguas.length === 5 && reguas.some((r) => r[0].includes('regua-A')) && reguas.some((r) => r[1] === '100.00%'), 'Régua de peso em cada item, com classe ABC: ' + reguas[0][2]);
  await p.screenshot({ path: OUT + '/plan_aberta.png', fullPage: true });
  // recolher uma etapa
  await p.click(`[data-recolher="${e2}"]`); await p.waitForTimeout(350);
  v(await p.getAttribute(`[data-recolher="${e2}"]`, 'aria-expanded') === 'false' && !(await p.isVisible(`tbody[data-etapa="${s1}"]`)), 'Recolher a etapa esconde os itens e as subetapas dela');
  const resumo = await txt(p, `tbody[data-etapa="${e2}"] .etapa-resumo`);
  v(/3 itens · 1 etapa/.test(resumo) && await p.isVisible(`tbody[data-etapa="${e2}"] .etapa-resumo .mini-barra`), 'Cabeçalho recolhido mostra itens, etapas e a divisão do custo: ' + resumo);
  v((await txt(p, `tbody[data-etapa="${e2}"] .etapa-cab td.num b`)).length > 3, 'O total da etapa continua no cabeçalho');
  await p.reload(); await p.waitForSelector('.planilha-orc');
  v(await p.getAttribute(`[data-recolher="${e2}"]`, 'aria-expanded') === 'false', 'A etapa continua recolhida depois de recarregar');
  await p.click('[data-plan-nivel="1"]'); await p.waitForTimeout(300);
  v((await p.$$('tr.item')).every ? (await p.$$eval('tr.item', (x) => x.every((t) => t.offsetParent === null))) : false, '"Só células" recolhe todas: nenhum item à vista');
  await p.screenshot({ path: OUT + '/plan_so_etapas.png', fullPage: true });
  await p.click('[data-plan-nivel="tudo"]'); await p.waitForTimeout(400);
  v(await p.$$eval('tr.item', (x) => x.every((t) => t.offsetParent !== null)), '"Tudo aberto" mostra todos os itens de novo');
  // teclado: digitar, Enter vai para a próxima quantidade e grava a anterior
  const qtds = await p.$$('.qtd');
  await qtds[0].click(); await p.keyboard.press('Control+A'); await p.keyboard.type('150'); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
  v(await p.evaluate(() => document.activeElement.classList.contains('qtd') && document.activeElement === document.querySelectorAll('.qtd')[1]), 'Enter grava e o cursor vai para a próxima quantidade');
  await p.waitForTimeout(400); await p.screenshot({ path: OUT + '/plan_teclado.png' });
  await p.keyboard.type('55'); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(250);
  v(await p.evaluate(() => document.activeElement === document.querySelectorAll('.qtd')[2]), 'Seta para baixo também anda (e grava)');
  await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowUp'); await p.waitForTimeout(250);
  v(await p.evaluate(() => document.activeElement === document.querySelectorAll('.qtd')[0]), 'Seta para cima volta');
  await p.keyboard.type('999'); await p.keyboard.press('Escape');
  v(await p.evaluate(() => document.activeElement.value === document.activeElement.defaultValue), 'Esc desfaz o que foi digitado');
  await p.waitForTimeout(1500);
  const srv = await api('get', `/api/orcamentos/${o.id}`);
  const qs = srv.etapas.flatMap((e) => e.itens).map((i) => i.quantidade);
  v(qs[0] === 150 && qs[1] === 55, `As quantidades digitadas foram gravadas (${qs.slice(0, 2).join(', ')})`);
  v(Math.abs((await p.evaluate(() => Number(document.querySelector('#orc-totais .total b').textContent.replace(/[^\d,]/g, '').replace(',', '.')))) - srv.total) < 0.011, 'Total da tela igual ao do servidor');
  v(await p.isVisible('.anel-foco.visivel'), 'Anel de foco visível na quantidade');
  // navegação pula etapas recolhidas
  await p.click(`[data-recolher="${e2}"]`); await p.waitForTimeout(200);
  await p.$$eval('.qtd', (x) => x[1].focus()); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(150);
  v(await p.evaluate(() => document.activeElement.classList.contains('qtd') && document.activeElement.offsetParent === null) === false && await p.evaluate(() => !document.activeElement.classList.contains('qtd') || document.activeElement.offsetParent !== null), 'Setas pulam as quantidades de etapas recolhidas');
  // celular
  const m = await b.newPage({ viewport: { width: 390, height: 800 } }); await m.goto(U + `/#/orcamento/${o.id}`); await m.waitForSelector('.planilha-orc'); await m.waitForTimeout(400);
  await m.screenshot({ path: OUT + '/plan_cel.png', fullPage: true });
  v(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Celular sem rolagem lateral');
  v(!erros.length, 'Sem erros de JavaScript ' + JSON.stringify(erros));
  await p.request.delete(U + `/api/orcamentos/${o.id}`);
  console.log(`\n${ok} OK, ${falha} falhas`); await b.close(); process.exitCode = falha ? 1 : 0; })();
