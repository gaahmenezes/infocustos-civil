// Unidade em destaque, orçamento mais limpo, paleta de comandos, celular e acessibilidade básica.
// Uso: node e2e_etapa3.js [url]   (servidor em :8000 ou cópia do artefato em :8100)
const { chromium } = require('playwright');
const ok = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); if (!c) process.exitCode = 1; };
const U = process.argv[2] || 'http://localhost:8000/';
const art = U.includes('8100');
const R = (h) => U + (art ? h.replace('#/', '#') : h);
const norm = (t) => (t || '').replace(/\s+/g, ' ').trim();
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && !m.text().includes('404') && errs.push(m.text()));
  await p.goto(U); await p.waitForSelector('#dt-campo');

  // ---------- unidade em destaque ----------
  await p.fill('#q', 'chapisco parede'); await p.waitForSelector('.res');
  const uns = await p.$$eval('.res', (r) => r.map((x) => (x.querySelector('.res-preco .un') || {}).textContent || ''));
  ok(uns.length > 0 && uns.every((u) => u.length > 0), 'Todo resultado mostra a unidade em etiqueta ao lado do preço: ' + [...new Set(uns)].join(', '));
  ok(uns.includes('m²') && !uns.includes('m2'), 'm2 aparece como m²');
  ok(!(await p.$$eval('.res-meta', (m) => m.some((x) => /^m2\b/.test(x.textContent.trim())))), 'A unidade saiu do texto cinza de baixo');
  await p.click('.res'); await p.waitForSelector('.ficha .arvore');
  ok(norm(await p.textContent('.preco-grande .un')) === 'm²', 'Ficha mostra a unidade em etiqueta junto do preço');

  // ---------- paleta de comandos ----------
  await p.keyboard.press('Control+k'); await p.waitForSelector('#dlg-paleta[open]');
  ok(await p.evaluate(() => document.activeElement.id === 'paleta-q'), 'Ctrl+K abre a paleta com o foco na caixa');
  ok(norm(await p.textContent('#paleta-lista')).includes('Novo orçamento') && norm(await p.textContent('#paleta-lista')).includes('Encargos sociais'), 'Paleta lista ações e telas');
  await p.keyboard.type('alvenaria bloco');
  await p.waitForFunction(() => document.querySelectorAll('#paleta-lista .cb').length > 0);
  await p.waitForTimeout(600);  // a lista se refaz a cada tecla; espera a última busca assentar
  ok((await p.$$('#paleta-lista li[role="option"] .un')).length > 0, 'Paleta busca itens da base, com preço e unidade');
  const alvo = await p.$eval('#paleta-lista li[aria-selected="true"] .cb-num', (e) => e.textContent);
  await p.keyboard.press('Enter'); await p.waitForFunction((c) => { const n = document.querySelector('.ficha-cod .cb-num'); return n && n.textContent === c; }, alvo);
  ok(!(await p.isVisible('#dlg-paleta')), 'Enter abre o item escolhido e fecha a paleta: ' + alvo);
  await p.keyboard.press('Control+k'); await p.keyboard.type('comparativo entre'); await p.waitForFunction(() => document.querySelector('#paleta-lista li[aria-selected="true"]') && /Comparativo/.test(document.querySelector('#paleta-lista li[aria-selected="true"]').textContent));
  await p.keyboard.press('Enter'); await p.waitForSelector('.comparativo table');
  ok(true, 'Paleta leva a outra tela pelo nome');
  await p.click('[data-paleta]'); await p.waitForSelector('#dlg-paleta[open]'); await p.keyboard.press('Escape');
  ok(!(await p.isVisible('#dlg-paleta')), 'Botão da barra abre a paleta e Esc fecha');

  // ---------- orçamento mais limpo ----------
  await p.goto(R('#/orcamentos')); await p.click('#novo-orc'); await p.waitForSelector('#dlg-novo-orc[open]');
  await p.fill('[name=nome]', 'Etapa3 teste'); await p.fill('[name=cliente]', 'Prefeitura'); await p.fill('[name=bdi]', '20'); await p.click('#form-novo [type=submit]'); await p.waitForSelector('.planilha');
  ok(!(await p.isVisible('#orc-campos')) && norm(await p.textContent('.orc-dados')).includes('Prefeitura') && norm(await p.textContent('.orc-dados')).includes('20,00%'), 'Dados do orçamento em uma linha; campos recolhidos: ' + norm(await p.textContent('.orc-dados')));
  await p.click('#orc-editar'); ok(await p.isVisible('#orc-bdi'), '"Editar dados" abre os campos');
  await p.fill('#orc-local', 'Aracaju/SE'); await p.press('#orc-local', 'Tab'); await p.waitForFunction(() => document.querySelector('.orc-dados').textContent.includes('Aracaju/SE'));
  ok(await p.isVisible('#orc-campos'), 'Resumo acompanha a edição e os campos continuam abertos');
  await p.click('#orc-editar');
  const add = async (termo, qtd) => {
    const inp = (await p.$$('.add-q'))[0]; await inp.fill(termo);
    await p.waitForSelector('.add-res:not([hidden]) li[data-k]'); await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('qtd'));
    await p.keyboard.type(qtd); await p.keyboard.press('Enter'); await p.waitForTimeout(350);
  };
  for (const c of ['00003', '03310', '00165', '02288', '00051', '00004', '00005', '00006']) await add(c, '100');
  const total = await p.textContent('.orc-totais .total b');
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(700);  // incluir itens rola a página; a verificação é no topo
  ok(!(await p.$eval('.ficha.orc', (f) => f.classList.contains('rolou'))), 'No topo, a faixa de totais fica escondida');
  await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForFunction(() => document.querySelector('.ficha.orc').classList.contains('rolou'));
  await p.waitForTimeout(250);
  const faixa = await p.evaluate(() => { const f = document.querySelector('.orc-fixa-barra'), r = f.getBoundingClientRect(), c = document.querySelector('.cabecalho').getBoundingClientRect(); return { texto: f.textContent, cola: Math.abs(r.top - c.bottom) < 2, op: getComputedStyle(f).opacity }; });
  ok(faixa.cola && faixa.op === '1' && norm(faixa.texto).includes(norm(total)), 'Ao rolar, nome e total ficam presos no topo: ' + norm(total) + (faixa.cola && faixa.op === '1' ? '' : ' ' + JSON.stringify(faixa)));
  const th = await p.evaluate(() => [document.querySelector('.planilha-orc thead th').getBoundingClientRect().top, document.querySelector('.orc-fixa-barra').getBoundingClientRect().bottom]);
  ok(th[0] >= th[1] - 1, 'A faixa nunca cobre o cabeçalho da planilha');

  // ---------- acessibilidade básica ----------
  await p.evaluate(() => window.scrollTo(0, 0)); await p.reload(); await p.waitForSelector('.planilha');
  await p.keyboard.press('Tab');
  ok(await p.evaluate(() => document.activeElement.classList.contains('pular')), 'Primeiro Tab cai em "Pular para o conteúdo"');
  const antes = p.url(); await p.keyboard.press('Enter');
  ok(p.url() === antes && await p.evaluate(() => document.activeElement.id === 'detalhe'), 'O atalho leva o foco ao conteúdo sem trocar de tela');
  const pequenos = await p.$$eval('button, a.botao, input:not([type=checkbox]):not([type=file]), select', (els) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 24 || r.width < 24); }).map((e) => (e.className || e.id || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height)));
  ok(pequenos.length === 0, 'Nenhum botão ou campo menor que 24 px (mínimo da norma) ' + JSON.stringify(pequenos.slice(0, 5)));

  // ---------- celular ----------
  const cel = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, storageState: await ctx.storageState() });
  const m = await cel.newPage(); m.on('pageerror', (e) => errs.push('cel ' + e.message));
  await m.goto(p.url()); await m.waitForSelector('.planilha');
  ok(await m.isVisible('.nav-baixo') && !(await m.isVisible('.abas')), 'Celular: navegação embaixo, sem as abas de cima');
  ok(await m.$eval('.nav-baixo a[data-aba="orcamentos"]', (a) => a.getAttribute('aria-current')) === 'true', 'Barra de baixo marca a tela atual');
  ok(await m.evaluate(() => document.documentElement.scrollWidth) <= 390, 'Celular: orçamento sem rolagem lateral');
  ok(!(await m.isVisible('.planilha-orc thead')) && await m.$eval('tr.item', (t) => getComputedStyle(t).display === 'grid'), 'Celular: itens do orçamento em cartões');
  const cartao = await m.$eval('tr.item', (t) => { const r = t.getBoundingClientRect(); return [...t.querySelectorAll('td')].filter((d) => getComputedStyle(d).display !== 'none').every((d) => { const x = d.getBoundingClientRect(); return x.left >= r.left - 1 && x.right <= r.right + 1; }); });
  ok(cartao, 'Celular: tudo cabe dentro do cartão do item');
  const alvos = await m.$$eval('tr.item .pega, tr.item .mini, .nav-baixo a', (els) => els.map((e) => e.getBoundingClientRect()).every((r) => r.width >= 40 && r.height >= 40));
  const pequenos = alvos ? '' : await m.$$eval('tr.item .pega, tr.item .mini, .nav-baixo a', (els) => els.map((e) => [e.className || e.textContent.trim(), e.getBoundingClientRect()]).filter(([, r]) => r.width < 40 || r.height < 40).map(([n, r]) => `${n} ${Math.round(r.width)}x${Math.round(r.height)}`).join(', '));
  ok(alvos, 'Celular: alça, excluir e navegação com pelo menos 40 px para o dedo ' + pequenos);
  await m.tap('.nav-baixo a[data-aba="consulta"]'); await m.waitForSelector('.pesquisa-intro h1');
  await m.fill('#q', 'chapisco'); await m.waitForSelector('.res'); await m.tap('.res'); await m.waitForSelector('.ficha .arvore');
  ok(await m.evaluate(() => document.documentElement.scrollWidth) <= 390, 'Celular: composição sem rolagem lateral');
  if (!art) {
    const man = await (await m.request.get(U + 'manifest.webmanifest')).json();
    const icones = await Promise.all(man.icons.map((i) => m.request.get(new URL(i.src, U).href).then((r) => r.status())));
    ok(man.display === 'standalone' && man.icons.length === 3 && icones.every((s) => s === 200), 'Site instalável como aplicativo: manifesto e ícones no ar');
  }

  // limpeza
  await p.click('.orc-barra .menu summary'); await p.click('#orc-excluir'); await p.fill('#excluir-orc-conf', 'EXCLUIR'); await p.click('#excluir-orc-ok'); await p.waitForSelector('.pagina.orcamentos');
  ok(errs.length === 0, 'Sem erros de JavaScript ' + JSON.stringify(errs));
  await b.close();
})();
