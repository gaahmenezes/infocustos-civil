// Refino visual: tema, altura das linhas, menus, teclado, cartões de orçamento, painel lateral e confirmação.
// Uso: node e2e_etapa1.js [url]   (servidor em :8000 ou cópia do artefato em :8100)
const { chromium } = require('playwright');
const ok = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); if (!c) process.exitCode = 1; };
const U = process.argv[2] || 'http://localhost:8000/';
const art = U.includes('8100');
const R = (h) => U + (art ? h.replace('#/', '#') : h);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errs.push(m.text()));
  await p.goto(U); await p.waitForSelector('#mes-ref');

  // tema
  await p.click('#tema');
  ok(await p.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'Botão troca para o tema escuro');
  await p.reload(); await p.waitForSelector('#mes-ref');
  ok(await p.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'Tema escolhido continua depois de recarregar');
  await p.click('#tema');
  ok(await p.evaluate(() => document.documentElement.dataset.theme) === 'light', 'Botão volta para o tema claro');

  // teclado na lista
  await p.fill('#q', 'chapisco parede'); await p.waitForSelector('.res');
  ok(await p.isVisible('.resultados-rod'), 'Dicas de teclado aparecem no rodapé dos resultados');
  await p.press('#q', 'ArrowDown'); await p.keyboard.press('ArrowDown');
  ok(await p.evaluate(() => document.activeElement === document.querySelectorAll('.res')[1]), 'Setas percorrem os resultados');
  await p.keyboard.press('Enter'); await p.waitForSelector('.ficha .arvore');
  ok(await p.evaluate(() => document.querySelectorAll('.res')[1].getAttribute('aria-current') === 'true'), 'Enter abre o resultado em foco');
  await p.keyboard.press('Escape');
  ok(await p.evaluate(() => document.activeElement.id === 'q'), 'Esc na lista volta para a caixa de pesquisa');

  // tabela da composição
  ok(await p.$$eval('.arvore td.cod .cb-p', (c) => c.length > 3 && c.every((x) => x.querySelector('.cb-num') && x.querySelector('.cb-base'))), 'Linhas da tabela mostram código e base em etiqueta');
  ok(await p.$$eval('.arvore td.col-peso .peso-n', (c) => c.length > 3), 'Coluna "% do custo" com o peso de cada item');
  const alt = () => p.$eval('.arvore tbody tr:not(.secao)', (t) => t.getBoundingClientRect().height);
  const h1 = await alt();
  await p.click('.segmentos[data-densidade] [data-v="confortavel"]'); const h2 = await alt();
  ok(h2 > h1 + 4, `Linhas compactas (${Math.round(h1)}px) e confortáveis (${Math.round(h2)}px)`);
  ok(await p.$eval('.chip[data-v="todos"]', (c) => c.getAttribute('aria-checked')) === 'true', 'Trocar a altura das linhas não mexe nos filtros');
  await p.click('.segmentos[data-densidade] [data-v="compacta"]');
  await p.evaluate(() => window.scrollTo(0, 700)); await p.waitForTimeout(250);
  const topo = await p.evaluate(() => [document.querySelector('.arvore thead th').getBoundingClientRect().top, document.querySelector('.cabecalho').getBoundingClientRect().bottom]);
  ok(Math.abs(topo[0] - topo[1]) < 3, 'Cabeçalho da tabela acompanha a rolagem, logo abaixo da barra');
  await p.evaluate(() => window.scrollTo(0, 0));
  ok((await p.$$('.ficha .botao.primario')).length === 1, 'Um só botão amarelo na ficha');
  if (!art) {
    await p.click('.ficha .menu summary');
    ok(await p.isVisible('.menu-lista a[href*="exportar/composicao"]') && await p.isVisible('.menu-lista button'), 'Menu Exportar: Excel e imprimir/PDF');
    await p.click('.ficha h2'); ok(!(await p.isVisible('.menu-lista')), 'Menu fecha ao clicar fora');
  }

  // orçamentos
  await p.goto(R('#/orcamentos')); await p.waitForSelector('#novo-orc');
  await p.click('#novo-orc'); await p.waitForSelector('#dlg-novo-orc[open]');
  ok(await p.evaluate(() => document.activeElement.name === 'nome'), 'Painel lateral abre com o foco no nome');
  await p.fill('[name=nome]', 'Etapa1 teste de tela'); await p.fill('[name=cliente]', 'Prefeitura'); await p.fill('[name=bdi]', '20');
  await p.click('#form-novo [type=submit]'); await p.waitForSelector('.planilha');
  const inp = (await p.$$('.add-q'))[0]; await inp.fill('00003');
  await p.waitForSelector('.add-res:not([hidden]) li[data-k]'); await p.keyboard.press('Enter');
  await p.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('qtd'));
  await p.keyboard.type('100'); await p.keyboard.press('Enter'); await p.waitForTimeout(350);
  ok((await p.$$('.orc-barra .botao.primario')).length === 1, 'Um só botão amarelo no orçamento');
  await p.click('.voltar-lista'); await p.waitForSelector('.orc-cartao');
  await p.fill('#orc-q', 'etapa1 teste');
  ok((await p.$$('.orc-cartao')).length === 1, 'Filtro da lista acha o orçamento pelo nome');
  ok(await p.isVisible('.orc-cartao .mini-barra'), 'Cartão mostra a divisão do custo do orçamento');
  ok((await p.textContent('#orc-resumo')).includes('1 orçamento'), 'Resumo acompanha o filtro: ' + (await p.textContent('#orc-resumo')).trim());
  await p.fill('#orc-q', 'zzzz-nada');
  ok(await p.isVisible('.orc-nada .vazio-estado'), 'Filtro sem resultado mostra estado vazio');
  await p.fill('#orc-q', 'etapa1 teste'); await p.click('.orc-cartao'); await p.waitForSelector('.planilha');
  await p.click('.orc-barra .menu summary'); await p.click('#orc-excluir'); await p.fill('#excluir-orc-conf', 'EXCLUIR'); await p.click('#excluir-orc-ok');
  await p.waitForSelector('.pagina.orcamentos');
  ok(!(await p.textContent('#detalhe')).includes('Etapa1 teste de tela'), 'Excluir tira o orçamento da lista');

  // padrão das outras páginas
  await p.goto(R('#/encargos')); await p.waitForSelector('.enc');
  ok(await p.isVisible('.pag-cab h1') && (await p.$$('.ficha.enc')).length === 2, 'Encargos: título da página e dois cartões');
  await p.goto(R('#/comparativo')); await p.waitForSelector('.comparativo table');
  ok((await p.$$('.blocos .bloco')).length === 4, 'Comparativo: quatro blocos de resumo');
  ok(await p.$$eval('.comparativo td.cod .cb-p', (c) => c.length > 5), 'Comparativo: código e base em etiqueta');
  ok(errs.length === 0, 'Sem erros de JavaScript ' + JSON.stringify(errs));
  await b.close();
})();
