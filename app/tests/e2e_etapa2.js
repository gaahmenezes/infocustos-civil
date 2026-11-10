// Painel do orçamento, arrastar, desfazer, comparar composições, relatório e marca.
// Uso: node e2e_etapa2.js [url]   (servidor em :8000 ou cópia do artefato em :8100)
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
  ok(!(await p.$('#abertura')), 'Tela de abertura some quando a base carrega');
  ok(await p.$eval('.marca-simbolo .marca-degraus', (e) => !!e), 'Logotipo novo na barra');

  // ---------- comparar ----------
  await p.fill('#q', 'chapisco'); await p.waitForSelector('.res');
  await p.hover('.lista li:nth-child(1)'); await p.click('.lista li:nth-child(1) .cmp-bt');
  ok(await p.isVisible('#bandeja') && norm(await p.textContent('#bandeja')).includes('Escolha mais uma'), 'Uma composição marcada: bandeja pede mais uma');
  await p.click('.lista li:nth-child(2) .cmp-bt');
  ok(norm(await p.textContent('#bandeja .botao')) === 'Comparar 2 composições', 'Duas marcadas: botão de comparar');
  await p.click('#bandeja .botao'); await p.waitForSelector('.cmp-tabela');
  ok((await p.$$('.cmp-col')).length === 2, 'Página mostra as duas composições lado a lado');
  ok((await p.$$('.cmp-cab .var-baixa')).length >= 1, 'Indica a de menor preço');
  const tot = await p.$$eval('.cmp-total td', (t) => t.map((x) => x.textContent));
  const cab = await p.$$eval('.cmp-preco b', (t) => t.map((x) => x.textContent));
  ok(JSON.stringify(tot) === JSON.stringify(cab), 'Custo total da tabela confere com o preço do cabeçalho: ' + tot.join(' e '));
  const todas = (await p.$$('.cmp-tabela tr.igual, .cmp-tabela tr.difere')).length;
  await p.click('[data-cmp-ver] [data-v="dif"]'); await p.waitForFunction(() => !document.querySelector('.cmp-tabela tr.igual'));
  const difs = (await p.$$('.cmp-tabela tr.difere')).length;
  ok(difs > 0 && difs < todas, `"Só as diferenças" esconde as linhas iguais (${todas} → ${difs})`);
  ok(!(await p.isVisible('#bandeja')), 'Bandeja some na página de comparação');
  await p.click('.voltar-lista'); await p.waitForSelector('.pesquisa');
  await p.fill('#q', 'chapisco'); await p.waitForSelector('#bandeja:not([hidden])');
  await p.click('[data-limpar-comparar]'); ok(!(await p.isVisible('#bandeja')), 'Limpar esvazia a comparação');

  // ---------- orçamento: painel ----------
  await p.goto(R('#/orcamentos')); await p.click('#novo-orc'); await p.waitForSelector('#dlg-novo-orc[open]');
  await p.fill('[name=nome]', 'Etapa2 teste'); await p.fill('[name=bdi]', '20'); await p.click('#form-novo [type=submit]'); await p.waitForSelector('.planilha');
  ok(!(await p.$('.painel-orc')), 'Orçamento vazio não mostra o painel');
  const add = async (k, termo, qtd) => {
    const inp = (await p.$$('.add-q'))[k]; await inp.fill(termo);
    await p.waitForSelector('.add-res:not([hidden]) li[data-k]'); await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('qtd'));
    await p.keyboard.type(qtd); await p.keyboard.press('Enter'); await p.waitForTimeout(350);
  };
  await add(0, '00003', '100'); await add(0, '03310', '50'); await add(0, '00165', '10');
  await p.fill('#nova-etapa', 'Segunda etapa'); await p.click('#form-etapa button'); await p.waitForTimeout(350);
  await add(1, '02288', '20');
  await p.waitForSelector('.painel-orc');
  ok((await p.$$('.pe-linha')).length === 2 && (await p.$$('.g-alvo')).length === 4, 'Painel: 2 etapas em barras e 4 pontos na curva ABC');
  ok(await p.$$eval('.painel-orc .legenda div', (d) => d.length === 4), 'Painel: divisão do custo com as 4 categorias');
  await p.hover('.g-alvo[data-k="0"]');
  ok(await p.isVisible('#abc-dica') && norm(await p.textContent('#abc-dica')).includes('classe A'), 'Passar o mouse na curva mostra o item: ' + norm(await p.textContent('#abc-dica')).slice(0, 60));
  await p.click('.pe-lista li:nth-child(2) .pe-linha'); await p.waitForSelector('.filtro-ativo');
  ok((await p.$$('tbody.etapa')).length === 1 && norm(await p.textContent('.filtro-ativo')).includes('Segunda etapa'), 'Clicar na barra filtra a planilha pela etapa');
  await p.click('[data-ver-todas]'); await p.waitForFunction(() => document.querySelectorAll('tbody.etapa').length === 2);
  await p.click('.g-alvo[data-k="0"]'); await p.waitForSelector('tr.item.destaque');
  ok(true, 'Clicar num ponto da curva destaca o item na planilha');
  await p.waitForTimeout(900);  // espera a rolagem suave até o item terminar

  // ---------- arrastar ----------
  const ordem = () => p.$$eval('tbody.etapa', (ts) => ts.map((t) => [...t.querySelectorAll('tr.item .cb-num')].map((x) => x.textContent)));
  const antes = await ordem();
  const arrastar = async (de, para, onde = 0.25) => {
    const a = await (await p.$(de)).boundingBox(); const z = await (await p.$(para)).boundingBox();
    await p.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await p.mouse.down();
    await p.mouse.move(z.x + 60, z.y + z.height * 0.5, { steps: 4 }); await p.mouse.move(z.x + 60, z.y + z.height * onde, { steps: 3 });
    await p.mouse.up(); await p.waitForTimeout(450);
  };
  await arrastar('tbody.etapa:nth-of-type(1) tr.item:nth-of-type(4) .pega', 'tbody.etapa:nth-of-type(1) tr.item:nth-of-type(2)');
  let agora = await ordem();
  ok(agora[0][0] === antes[0][2] && agora[0][1] === antes[0][0], `Arrastar muda a ordem dentro da etapa: ${antes[0].join(',')} → ${agora[0].join(',')}`);
  await arrastar('tbody.etapa:nth-of-type(1) tr.item:nth-of-type(2) .pega', 'tbody.etapa:nth-of-type(2) tr.item', 0.8);
  agora = await ordem();
  ok(agora[0].length === 2 && agora[1].length === 2 && agora[1][1] === antes[0][2], `Arrastar leva o item para outra etapa: ${agora.map((x) => x.join(',')).join(' | ')}`);
  ok(JSON.stringify(await p.$$eval('tr.item .n', (n) => n.map((x) => x.textContent.replace(/[^\d.]/g, '')))) === JSON.stringify(['1.1', '1.2', '2.1', '2.2']), 'Numeração refeita depois de arrastar');
  await arrastar('tbody.etapa:nth-of-type(2) .etapa-cab .pega', 'tbody.etapa:nth-of-type(1) .etapa-cab', 0.2);
  ok((await p.$eval('tbody.etapa .etapa-titulo', (e) => e.value)) === 'Segunda etapa', 'Arrastar muda a ordem das etapas');
  await p.focus('tbody.etapa:nth-of-type(1) tr.item .pega'); const t0 = await ordem(); await p.keyboard.press('ArrowDown'); await p.waitForTimeout(400);
  const t1 = await ordem();
  ok(t1[0][0] === t0[0][1] && t1[0][1] === t0[0][0], 'Pelo teclado, a seta para baixo desce o item');

  // ---------- desfazer ----------
  const total = () => p.textContent('.orc-totais .total b');
  const tAntes = await total();
  await p.click('tr.item [data-acao="item-excluir"]'); await p.waitForSelector('[data-desfazer]');
  ok((await p.$$('tr.item')).length === 3 && (await total()) !== tAntes, 'Excluir item não pergunta e mostra "Desfazer"');
  await p.click('[data-desfazer]'); await p.waitForFunction(() => document.querySelectorAll('tr.item').length === 4);
  ok((await total()) === tAntes, 'Desfazer devolve o item e o total: ' + tAntes);
  await p.click('.etapa-cab [data-acao="etapa-excluir"]'); await p.waitForSelector('[data-desfazer]');
  ok((await p.$$('tbody.etapa')).length === 1, 'Excluir etapa tira a etapa com os itens');
  await p.click('[data-desfazer]'); await p.waitForFunction(() => document.querySelectorAll('tbody.etapa').length === 2);
  ok((await total()) === tAntes, 'Desfazer devolve a etapa inteira');

  // ---------- relatório ----------
  await p.click('.orc-barra a.botao.primario'); await p.waitForSelector('.folha');
  ok((await p.$$('.folha')).length === 4, 'Relatório: capa, resumo, planilha e curva ABC');
  ok(norm(await p.textContent('.folha-capa')).includes('Etapa2 teste') && norm(await p.textContent('.capa-total')).includes(norm(tAntes)), 'Capa traz o nome e o valor total');
  ok(norm(await p.textContent('.rel-geral')).includes(norm(tAntes).replace('R$', '').trim()), 'Planilha do relatório fecha no mesmo total');
  await p.click('[data-rel="capa"]'); await p.waitForFunction(() => document.querySelectorAll('.folha').length === 3);
  await p.click('[data-rel="comps"]'); await p.waitForSelector('.rel-comp');
  ok((await p.$$('.rel-comp')).length === 4, 'Opção "Composições analíticas" inclui as 4 composições');
  await p.click('.rel-barra [data-empresa]'); await p.waitForSelector('#dlg-empresa[open]');
  await p.fill('#form-empresa [name=nome]', 'Construtora Teste Ltda.'); await p.fill('#form-empresa [name=responsavel]', 'Eng. Fulano');
  await p.click('#form-empresa [type=submit]'); await p.waitForFunction(() => document.querySelector('.folha-emp') && document.querySelector('.folha-emp').textContent.includes('Construtora Teste'));
  ok(true, 'Nome da empresa aparece no cabeçalho das folhas');
  await p.click('[data-rel="capa"]'); await p.waitForSelector('.folha-capa'); await p.click('[data-rel="comps"]'); await p.waitForFunction(() => !document.querySelector('.rel-comp') && document.querySelector('.folha'));
  ok(norm(await p.textContent('.folha-capa')).includes('Eng. Fulano'), 'Capa traz o responsável técnico');

  // ---------- desfazer exclusão do orçamento ----------
  await p.click('.voltar-lista'); await p.waitForSelector('.planilha');
  await p.click('.orc-barra .menu summary'); await p.click('#orc-excluir'); await p.waitForSelector('.pagina.orcamentos');
  ok(!(await p.textContent('#orc-lista, .vazio-estado')).includes('Etapa2 teste'), 'Orçamento excluído sai da lista');
  await p.click('[data-desfazer]'); await p.waitForSelector('.planilha');
  ok((await p.inputValue('#orc-nome')) === 'Etapa2 teste' && (await total()) === tAntes, 'Desfazer devolve o orçamento inteiro');
  await p.click('.orc-barra .menu summary'); await p.click('#orc-excluir'); await p.waitForSelector('.pagina.orcamentos');
  await p.evaluate(() => { try { localStorage.removeItem('infocustos-empresa'); localStorage.removeItem('infocustos-relatorio'); } catch (_) { /* ok */ } });
  ok(errs.length === 0, 'Sem erros de JavaScript ' + JSON.stringify(errs));
  await b.close();
})();
