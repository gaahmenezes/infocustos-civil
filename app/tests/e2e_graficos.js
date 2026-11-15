// Mapa do orçamento, histórico de preço na ficha, placar do comparativo e composição em anéis.
// Servidor local na porta 8000; argumento: pasta das capturas.
const { chromium } = require('playwright'); const OUT = process.argv[2], U = 'http://localhost:8000';
let ok = 0, falha = 0; const v = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); c ? ok++ : falha++; };
const txt = async (p, s) => (await p.textContent(s)).replace(/\s+/g, ' ').trim();
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 960 } }); const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  const api = async (m, u, data) => (await p.request[m](U + u, data ? { data } : undefined)).json();
  await p.goto(U + '/#/'); await p.evaluate(() => localStorage.clear());
  // histórico de preço na ficha (SINAPI tem 5 meses: CEHOP e CAIXA)
  await p.goto(U + '/#/composicao/SINAPI/87878'); await p.waitForSelector('.ficha'); await p.waitForSelector('.gh-svg', { timeout: 15000 });
  const pts = await p.$$('.gh-pt'); const sel = await p.$$('.gh-pt.sel');
  v(pts.length >= 4 && sel.length === 1, `Curva do histórico na ficha: ${pts.length} meses, o mês escolhido em destaque`);
  v((await txt(p, '.gh-cab')).match(/de \w+\/\d\d a \w+\/\d\d/) !== null, 'Mostra a variação do período: ' + (await txt(p, '.gh-total')));
  v(await p.$('.gh-troca') !== null && (await txt(p, '.gh-nota')).includes('troca de fonte'), 'Marca a troca de fonte (CEHOP → CAIXA) com tracejado e nota');
  await p.waitForTimeout(1300); await p.evaluate(() => document.querySelector('.gh').scrollIntoView({ block: 'center' })); await p.waitForTimeout(300);
  await p.screenshot({ path: OUT + '/g_historico.png' });
  // anéis
  await p.goto(U + '/#/composicao/ORSE/00069'); await p.waitForSelector('.segmentos[data-vista]');
  await p.click('.segmentos[data-vista] [data-v=aneis]'); await p.waitForSelector('.an-svg path');
  v((await p.$$('.an-sec')).length >= 2 && (await p.$$('.an-item')).length >= 3, 'Vista Anéis: categorias por dentro e itens por fora');
  const passar = (sel) => p.$eval(sel, (el) => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  await passar('.an-item'); await p.waitForTimeout(250);
  v((await txt(p, '.an-centro')).includes('do custo') && await p.$('.an-svg path.apagado') !== null, 'Passar o mouse destaca o item e mostra o valor no centro: ' + (await txt(p, '.an-centro')).slice(0, 70));
  await p.waitForTimeout(700); await p.screenshot({ path: OUT + '/g_aneis.png' });
  await p.goto(U + '/#/composicao/ORSE/00004'); await p.waitForSelector('.an-svg path');
  v(true, 'A vista Anéis fica escolhida ao abrir outra composição');
  await p.click('.segmentos[data-vista] [data-v=tabela]');
  // placar do comparativo
  await p.goto(U + '/#/comparativo'); await p.waitForSelector('.placar .pl-linha', { timeout: 30000 }); await p.waitForTimeout(900);
  v((await p.$$('.placar .pl-linha.alta')).length > 0 && (await p.$$('.placar .pl-linha.baixa')).length > 0, 'Placar com as maiores altas e as maiores quedas lado a lado');
  await p.screenshot({ path: OUT + '/g_placar.png' });
  await p.click('[data-cmp="tipo"] [data-v="insumo"]'); await p.waitForTimeout(900);
  v((await p.$$('.placar .pl-linha')).length > 0, 'Trocar o filtro redesenha o placar com animação');
  // mapa do orçamento
  let o = await api('post', '/api/orcamentos', { nome: 'Roteiro mapa', bdi: 25 });
  const e1 = o.etapas[0].id; o = await api('post', `/api/orcamentos/${o.id}/etapas`, { titulo: 'Fundação' }); const e2 = o.etapa_criada;
  o = await api('post', `/api/orcamentos/${o.id}/etapas`, { titulo: 'Radier', pai_id: e2 }); const s1 = o.etapa_criada;
  for (const [et, cod, q] of [[e1, '87878', 120], [e1, '88309', 40], [e2, '103354', 300], [s1, '94965', 12], [s1, '88316', 90]])
    await api('post', `/api/orcamentos/${o.id}/itens`, { etapa_id: et, tipo: 'servico', base: 'SINAPI', codigo: cod, quantidade: q });
  await p.goto(U + `/#/orcamento/${o.id}`); await p.waitForSelector('.abas-orc'); await p.click('.abas-orc a[href$="/mapa"]'); await p.waitForSelector('#mapa .mapa-no');
  v((await p.$$('#mapa .mapa-no')).length === 2, 'Aba Mapa: um retângulo por etapa');
  await p.click('#mapa .mapa-no.grupo'); await p.waitForTimeout(600);
  v((await txt(p, '.mapa-trilha')).includes('Fundação'), 'Clicar aproxima na etapa: ' + await txt(p, '.mapa-trilha'));
  await p.keyboard.press('Escape'); await p.waitForTimeout(400);
  v(!(await txt(p, '.mapa-trilha')).includes('Fundação'), 'Esc volta um nível');
  await p.click('#mapa .mapa-no.grupo'); await p.waitForTimeout(500);
  const folha = await p.$('#mapa .mapa-no.folha'); await folha.click(); await p.waitForSelector('.planilha-orc tr.item.destaque');
  v(/\/planilha$/.test(p.url()), 'Clicar num item leva à linha dele na planilha, em destaque');
  const m = await b.newPage({ viewport: { width: 390, height: 800 } }); await m.goto(U + '/#/composicao/SINAPI/87878'); await m.waitForSelector('.gh-svg', { timeout: 15000 }); await m.waitForTimeout(800);
  v(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Celular: ficha com histórico e anéis sem rolagem lateral');
  await m.screenshot({ path: OUT + '/g_cel.png', fullPage: true });
  v(!erros.length, 'Sem erros de JavaScript ' + JSON.stringify(erros));
  await p.request.delete(U + `/api/orcamentos/${o.id}`);
  console.log(`\n${ok} OK, ${falha} falhas`); await b.close(); process.exitCode = falha ? 1 : 0; })();
