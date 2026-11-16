// Defeitos achados na auditoria de 16/11/2026, um teste para cada (servidor local na porta 8000; argumento: pasta das capturas).
const { chromium, devices } = require('playwright'); const OUT = process.argv[2] || require('os').tmpdir(), U = process.env.U || 'http://localhost:8000';
let ok = 0, falha = 0; const v = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); c ? ok++ : falha++; };
const txt = async (p, s) => (await p.textContent(s)).replace(/\s+/g, ' ').trim();
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 900 } }); const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  const api = async (m, u, data) => (await p.request[m](U + u, data ? { data } : undefined)).json();

  // 1) encargos sociais: sem mês escolhido, vem o mês da ORSE (com o detalhamento), e o nome do mês sem o "-1"
  const enc = await api('get', '/api/encargos');
  v(enc.horista.linhas.length > 0 && !/-1$/.test(enc.referencia.descricao), `Encargos sem mês pedido: ${enc.referencia.descricao}, ${enc.horista.linhas.length} linhas de horista`);
  const ref = await api('get', '/api/referencia');
  v(ref.referencias.every((r) => !/-1$/.test(r.descricao)), 'Nenhum mês aparece como "agosto/2026-1"');

  // 2) filtro "Bases próprias" conta os itens próprios mesmo sem texto digitado
  const nProp = ref.totais.filter((t) => t.base === 'PROPRIA').reduce((s, t) => s + t.n, 0);
  const bases = await api('get', '/api/proprias/bases'); const temProp = bases.some((x) => x.composicoes + x.insumos > 0);
  v(!temProp || nProp > 0, `Contagem das bases próprias no filtro: ${nProp}`);

  // 3) códigos da planilha e da curva ABC abrem a ficha no mês do orçamento (não no mês da consulta)
  const meses = ref.bases.SINAPI.meses.map((m) => m.id);
  let o = await api('post', '/api/orcamentos', { nome: 'Auditoria', bdi: 25, referencia: meses[0] });
  o = await api('post', `/api/orcamentos/${o.id}/itens`, { etapa_id: o.etapas[0].id, tipo: 'servico', base: 'SINAPI', codigo: '87878', quantidade: 10 });
  for (const aba of ['planilha', 'abc-servicos']) {
    await p.goto(U + `/#/orcamento/${o.id}/${aba}`); await p.waitForSelector('#orc-corpo a.cb-p');
    const href = await p.getAttribute('#orc-corpo a.cb-p', 'href');
    await p.click('#orc-corpo a.cb-p'); await p.waitForSelector('.ficha .preco-grande'); await p.waitForTimeout(300);
    v(href.includes(`ref=${meses[0]}`) && (await txt(p, '.ficha')).includes(nomeRefJS(meses[0])), `${aba}: o código abre a ficha em ${nomeRefJS(meses[0])} (${href})`);
  }

  // 4) desconsiderar encargos complementares não muda o total de quem não tem encargo complementar
  const o2 = await api('post', '/api/orcamentos', { nome: 'Auditoria 2', bdi: 0 });
  const prop = await api('get', '/api/busca?base=PROPRIA&q=&limite=1');
  if (prop.itens.length) {
    const c1 = await api('post', `/api/orcamentos/${o2.id}/itens`, { etapa_id: o2.etapas[0].id, tipo: prop.itens[0].tipo, base: 'PROPRIA', codigo: prop.itens[0].codigo, quantidade: 4401.12 });
    const c2 = await api('patch', `/api/orcamentos/${o2.id}`, { sem_complementares: true });
    v(c2.total <= c1.total + 0.005, `Sem encargos complementares o total não sobe: ${c1.total} → ${c2.total}`);
  } else v(true, 'Sem base própria para testar os encargos complementares');

  // 5) tela que demora não pinta por cima da tela para onde a pessoa já foi
  await p.goto(U + '/#/'); await p.waitForSelector('#q');
  await p.route('**/api/orcamentos', async (r) => { await new Promise((res) => setTimeout(res, 1200)); await r.continue(); });
  await p.evaluate(() => { location.hash = '#/orcamentos'; }); await p.waitForTimeout(150);
  await p.evaluate(() => { location.hash = '#/encargos'; }); await p.waitForSelector('.encargos'); await p.waitForTimeout(1800);
  v(!!(await p.$('.encargos')) && !(await p.$('.orc-lista')), 'Resposta atrasada de Orçamentos não cobre a tela de Encargos');
  await p.unroute('**/api/orcamentos');

  // 6) celular: menu Exportar abre dentro da tela (a página não fica mais larga)
  const m = await b.newPage(devices['iPhone 13']);
  await m.goto(U + '/#/composicao/SINAPI/87878'); await m.waitForSelector('.ficha .preco-grande'); await m.click('details.menu > summary'); await m.waitForTimeout(300);
  const larg = await m.evaluate(() => ({ W: innerWidth, r: Math.round(document.querySelector('details.menu[open] .menu-lista').getBoundingClientRect().right) }));
  v(larg.W === 390 && larg.r <= 390, `Celular: menu aberto dentro da tela (borda direita em ${larg.r}px de ${larg.W}px)`);
  await m.screenshot({ path: OUT + '/aud_menu_cel.png' });

  // 7) planilha grande: alterar uma quantidade não trava a página
  const grande = (await api('get', '/api/orcamentos')).sort((a, c) => c.qtd_itens - a.qtd_itens)[0];
  if (grande && grande.qtd_itens >= 200) {
    await p.goto(U + `/#/orcamento/${grande.id}`); await p.waitForSelector('.planilha-orc tr.item .qtd'); await p.waitForTimeout(1200);
    await p.evaluate(() => { window.__lt = 0; new PerformanceObserver((l) => l.getEntries().forEach((e) => { window.__lt += e.duration; })).observe({ type: 'longtask' }); });
    const q = await p.$('.planilha-orc tr.item .qtd'); const antes = await q.inputValue();
    await q.fill('7'); await q.press('Tab'); await p.waitForTimeout(3000);
    const trava = await p.evaluate(() => Math.round(window.__lt));
    v(trava < 1500, `Planilha de ${grande.qtd_itens} itens: tempo travado ao alterar uma quantidade ${trava} ms`);
    const q2 = await p.$('.planilha-orc tr.item .qtd'); await q2.fill(antes); await q2.press('Tab'); await p.waitForTimeout(1500);
  } else v(true, 'Sem orçamento grande para medir');

  v(!erros.length, 'Sem erros de JavaScript ' + JSON.stringify(erros));
  await p.request.delete(U + `/api/orcamentos/${o.id}`); await p.request.delete(U + `/api/orcamentos/${o2.id}`);
  console.log(`\n${ok} OK, ${falha} falhas`); await b.close(); process.exitCode = falha ? 1 : 0;
})();
function nomeRefJS(id) { const [a, mm] = id.split('-'); return `${['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'][Number(mm) - 1]}/${a}`; }
