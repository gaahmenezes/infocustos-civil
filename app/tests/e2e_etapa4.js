// Movimento e acabamento: transição do resultado para a ficha, números que contam, linhas que abrem espaço,
// indicador das abas, esqueletos, moeda discreta e a tela de apresentação.
// Uso: node e2e_etapa4.js [url]   (servidor em :8000 ou cópia do artefato em :8100)
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
  await p.goto(U); await p.waitForSelector('#mes-ref');

  // ---------- tela inicial limpa ----------
  ok(!(await p.isVisible('.area')) && !(await p.isVisible('#inicio')), 'Tela inicial: nada aparece abaixo dos cartões');
  ok(await p.$eval('.conheca', (c) => c.parentElement.id === 'pesquisa' && !c.closest('.cartao')), 'Link da apresentação fica abaixo dos cartões, fora deles');

  // ---------- indicador das abas ----------
  const ind = () => p.$eval('.abas-ind', (i) => { const r = i.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width)]; });
  const aba = (n) => p.$eval(`.abas a[data-aba="${n}"]`, (a) => { const r = a.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width)]; });
  await p.waitForTimeout(450);
  const perto = (x, y) => Math.abs(x[0] - y[0]) <= 1 && Math.abs(x[1] - y[1]) <= 1;
  ok(perto(await ind(), await aba('consulta')), 'Indicador amarelo começa sob a aba Consulta');
  await p.click('.abas a[data-aba="encargos"]'); await p.waitForSelector('.enc'); await p.waitForTimeout(500);
  ok(perto(await ind(), await aba('encargos')), 'Indicador desliza até a aba escolhida');
  await p.click('.abas a[data-aba="consulta"]'); await p.waitForTimeout(400);

  // ---------- do resultado para a ficha ----------
  await p.fill('#q', 'chapisco parede'); await p.waitForSelector('.res');
  const nomes = await p.evaluate(() => new Promise((ok2) => {
    const visto = new Set(); const fim = Date.now() + 2500;
    const olhar = () => { document.getAnimations({ subtree: true }).forEach((a) => { const el = a.effect && a.effect.pseudoElement; if (el) visto.add(el); });
      if (Date.now() < fim && !visto.has('::view-transition-group(vt-cod)')) requestAnimationFrame(olhar); else ok2([...visto]); };
    document.querySelector('.res').click(); olhar();
  }));
  await p.waitForSelector('.ficha .arvore');
  const temVT = await p.evaluate(() => !!document.startViewTransition);
  ok(!temVT || (nomes.includes('::view-transition-group(vt-cod)') && nomes.includes('::view-transition-group(vt-preco)')), 'Código e preço viajam do resultado até a ficha');
  ok(norm(await p.textContent('.preco-grande .valor')) === 'R$ 8,38' && norm(await p.textContent('.preco-grande .moeda')) === 'R$', 'Preço com o "R$" separado, e o texto continua "R$ 8,38"');
  const tam = await p.evaluate(() => [parseFloat(getComputedStyle(document.querySelector('.preco-grande .moeda')).fontSize), parseFloat(getComputedStyle(document.querySelector('.preco-grande .num-grande')).fontSize)]);
  ok(tam[0] < tam[1] * 0.6, `Moeda menor que o valor (${tam[0]}px e ${tam[1]}px)`);

  // ---------- preço conta ao trocar de mês ----------
  const passos = await p.evaluate(() => new Promise((ok2) => {
    const v = new Set(); const fim = Date.now() + 2500;
    const olhar = () => { const n = document.querySelector('.preco-grande .num-grande'); if (n && n.dataset.anim) v.add(n.dataset.anim);
      if (Date.now() < fim) requestAnimationFrame(olhar); else ok2([...v]); };
    const s = document.querySelector('#mes-ref'); s.value = '2026-05'; s.dispatchEvent(new Event('change', { bubbles: true })); olhar();
  }));
  const final = norm(await p.textContent('.preco-grande .num-grande'));
  ok(passos.length >= 3 && !(await p.$('.preco-grande [data-anim]')), `Ao trocar de mês, o preço conta até o valor novo (${passos.length} passos até ${final})`);
  await p.selectOption('#mes-ref', '2026-08'); await p.waitForTimeout(700);

  // ---------- esqueleto no formato da ficha ----------
  const comAtraso = await ctx.newPage();
  if (!art) {
    await comAtraso.route('**/api/composicao/**', async (r) => { await new Promise((x) => setTimeout(x, 900)); r.continue(); });
    await comAtraso.goto(U + '#/composicao/ORSE/03310'); await comAtraso.waitForSelector('.esq-ficha');
    ok((await comAtraso.$$('.esq-ficha .osso')).length > 10, 'Carregamento lento mostra o esqueleto da ficha');
    await comAtraso.waitForSelector('.ficha .arvore'); ok(!(await comAtraso.$('.esq-ficha')), 'O esqueleto dá lugar à ficha');
  }
  await comAtraso.close();

  // ---------- orçamento: totais contam e linhas abrem espaço ----------
  await p.goto(R('#/orcamentos')); await p.click('#novo-orc'); await p.waitForSelector('#dlg-novo-orc[open]');
  await p.fill('[name=nome]', 'Etapa4 teste'); await p.fill('[name=bdi]', '20'); await p.click('#form-novo [type=submit]'); await p.waitForSelector('.planilha');
  const add = async (termo, qtd) => {
    const inp = (await p.$$('.add-q'))[0]; await inp.fill(termo);
    await p.waitForSelector('.add-res:not([hidden]) li[data-k]'); await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('qtd'));
    await p.keyboard.type(qtd); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  };
  await add('00003', '100');
  ok(norm(await p.textContent('#aviso')).includes('adicionado') && !!(await p.$('#aviso .visto')), 'Aviso de item adicionado traz o visto animado');
  await add('03310', '50'); await add('00165', '10');
  const total = () => p.$eval('.orc-totais .total b', (e) => e.textContent.replace(/\s+/g, ' ').trim());
  const t0 = await total();
  const contou = await p.evaluate(() => new Promise((ok2) => {
    const v = new Set(); const fim = Date.now() + 2200;
    const olhar = () => { const n = document.querySelector('.orc-totais .total .num-grande'); if (n && n.dataset.anim) v.add(n.dataset.anim);
      if (Date.now() < fim) requestAnimationFrame(olhar); else ok2(v.size); };
    const q = document.querySelector('.qtd'); q.value = '500'; q.dispatchEvent(new Event('change', { bubbles: true })); olhar();
  }));
  const t1 = await total();
  ok(contou >= 3 && t1 !== t0, `Ao mudar a quantidade, o total conta de ${t0} até ${t1} (${contou} passos)`);

  const linha = (n) => p.$(`tbody.etapa tr.item:nth-of-type(${n + 1})`);
  const a = await (await p.$('tbody.etapa tr.item:nth-of-type(4) .pega')).boundingBox();
  const alvo = await (await linha(1)).boundingBox();
  await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await p.mouse.down();
  await p.mouse.move(alvo.x + 80, alvo.y + alvo.height * 0.6, { steps: 5 }); await p.mouse.move(alvo.x + 80, alvo.y + alvo.height * 0.2, { steps: 3 });
  await p.waitForTimeout(350);
  const durante = await p.evaluate(() => [...document.querySelectorAll('tbody.etapa tr.item')].map((t) => [t.classList.contains('arrastando'), new DOMMatrix(getComputedStyle(t).transform).m42]));
  ok(durante[2][0] && durante[2][1] < -20, 'A linha arrastada acompanha o ponteiro');
  ok(durante[0][1] > 20 && durante[1][1] > 20, `As linhas vizinhas descem para abrir a vaga (${Math.round(durante[0][1])}px e ${Math.round(durante[1][1])}px)`);
  await p.mouse.up(); await p.waitForTimeout(600);
  const ordem = await p.$$eval('tbody.etapa tr.item .cb-num', (c) => c.map((x) => x.textContent));
  ok(ordem.join() === '00165,00003,03310', 'Ao soltar, a ordem fica como a tela mostrava: ' + ordem.join(', '));
  ok(await p.$$eval('tbody.etapa tr', (t) => t.every((x) => !x.style.transform)), 'Depois de soltar, nenhuma linha fica deslocada');
  await p.click('.orc-barra .menu summary'); await p.click('#orc-excluir'); await p.fill('#excluir-orc-conf', 'EXCLUIR'); await p.click('#excluir-orc-ok'); await p.waitForSelector('.pagina.orcamentos');

  // ---------- luz e profundidade ----------
  if (await p.$('.orc-cartao')) {
    await p.waitForTimeout(600);  // a lista acaba de ser redesenhada
    const c = await (await p.$('.orc-cartao')).boundingBox();
    await p.mouse.move(c.x + 40, c.y + 30); await p.mouse.move(c.x + 80, c.y + 50, { steps: 4 }); await p.waitForTimeout(300);
    ok((await p.$eval('.orc-cartao', (e) => e.style.getPropertyValue('--mx'))) !== '', 'Cartão de orçamento recebe a luz que segue o cursor');
  }

  // ---------- tela de apresentação ----------
  await p.goto(U); await p.waitForSelector('.conheca'); await p.click('.conheca'); await p.waitForSelector('.ap-heroi h1');
  ok(!(await p.isVisible('#pesquisa')) && norm(await p.textContent('.ap-numeros')).includes('composições'), 'Link da tela inicial abre a apresentação: ' + norm(await p.textContent('.ap-numeros')));
  await p.waitForSelector('.ap-res.escolhido', { timeout: 15000 });
  const reais = await p.$$eval('.ap-res', (r) => r.map((x) => x.querySelector('.cb-num').textContent + ' ' + x.querySelector('.res-preco').textContent.replace(/\s+/g, ' ')));
  ok(reais.length === 3 && reais[0].startsWith('03310 R$ 8,38'), 'Demonstração usa itens e preços reais do mês: ' + reais[0]);
  await p.click('[data-cena="1"]'); await p.waitForSelector('.ap-barra.visivel'); await p.waitForTimeout(700);
  const soma = await p.$$eval('.ap-linha b', (l) => l.reduce((s, x) => s + Number(x.textContent.replace(/\./g, '').replace(',', '.')), 0));
  const mostrado = Number((await p.textContent('#ap-total')).replace(/\./g, '').replace(',', '.'));
  ok(Math.abs(soma - mostrado) < 0.02, `Cena do orçamento: o total fecha com a soma das linhas (${mostrado.toLocaleString('pt-BR')})`);
  await p.click('[data-cena="2"]'); await p.waitForSelector('.ap-folhas.visivel');
  ok(norm(await p.textContent('.ap-folha-total strong')).replace('R$ ', '') === (await p.evaluate((v) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2 }), mostrado)), 'Cena do relatório mostra o mesmo total');
  ok(norm(await p.textContent('.ap-nota')).includes('não é um site da CEHOP'), 'A apresentação diz que o produto é independente da CEHOP e da CAIXA');
  await p.click('.ap-cta'); await p.waitForSelector('.pesquisa-intro h1');
  ok(await p.evaluate(() => document.body.classList.contains('ocioso')), '"Começar a orçar" leva à consulta');
  if (!art) { const r = await p.request.get(U + 'apresentacao', { maxRedirects: 0 }); ok(r.status() === 307 && r.headers().location === '/#/apresentacao', 'Endereço curto /apresentacao redireciona para a tela'); }

  // ---------- menos movimento ----------
  const calmo = await b.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const q = await calmo.newPage(); q.on('pageerror', (e) => errs.push('calmo ' + e.message));
  await q.goto(R('#/apresentacao')); await q.waitForSelector('.ap-res.visivel');
  ok((await q.textContent('.ap-digita')) === 'chapisco parede' && (await q.$$('.ap-res.visivel')).length === 3, 'Com "menos movimento" no sistema, a demonstração aparece pronta, sem animar');
  await q.waitForTimeout(3500);
  ok(await q.$eval('[data-cena="0"]', (x) => x.getAttribute('aria-selected')) === 'true', 'E não troca de cena sozinha');
  ok(errs.length === 0, 'Sem erros de JavaScript ' + JSON.stringify(errs));
  await b.close();
})();
