// Várias bases próprias e importação do SIENGE pela tela: insumos, composições e orçamento.
// Uso: node e2e_importar.js <pasta com insumos_orcados.xlsx, composicoes.xlsx, planilha_orcamentaria.xlsx> [pasta das capturas]
// (os arquivos de exemplo saem de tests/fixtures_sienge.py: python3 -c "import fixtures_sienge as f; ..." )
const { chromium } = require('playwright'); const DIR = process.argv[2], OUT = process.argv[3] || DIR, U = 'http://localhost:8000';
let ok = 0, falha = 0; const v = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); c ? ok++ : falha++; };
const txt = async (p, s) => (await p.textContent(s)).replace(/\s+/g, ' ').trim();
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 900 } }); const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  const NOME = 'SIENGE Roteiro ' + Date.now().toString().slice(-5);
  await p.goto(U + '/#/proprias'); await p.waitForSelector('.prop-bases');
  const nBases = (await p.$$('[data-prop-base]')).length;
  v(await p.isVisible('[data-prop-base-nova]') && await p.isVisible('a[href="#/importar"]'), 'Aba Bases próprias: seletor de bases, "+ Nova base" e "Importar arquivo"');
  // 1) insumos para uma base nova
  await p.click('a[href="#/importar"]'); await p.waitForSelector('.importar');
  await p.selectOption('#imp-base', 'nova'); await p.fill('#imp-nova', NOME);
  await p.setInputFiles('#imp-file', DIR + '/insumos_orcados.xlsx'); await p.waitForSelector('.imp-previa');
  v(await p.inputValue('[data-imp-col="descricao"]') === '1' && await p.inputValue('[data-imp-col="preco"]') === '5', 'Lê o Excel e reconhece as colunas pelos títulos (descrição, preço...)');
  v((await p.$$('.imp-previa th.imp-usada')).length === 5, 'Prévia destaca as colunas que serão usadas');
  await p.screenshot({ path: OUT + '/imp_insumos.png', fullPage: true });
  await p.click('#imp-simular'); await p.waitForSelector('.imp-resultado');
  v((await txt(p, '.imp-resultado')).includes('nada foi gravado') && (await txt(p, '.imp-resultado')).includes('6 insumos novos'), 'Conferir sem gravar: 6 insumos novos');
  await p.click('#imp-ir'); await p.waitForSelector('.imp-resultado.feito');
  v((await txt(p, '.imp-resultado')).includes('Importação concluída'), 'Importa os insumos na base nova');
  // 2) composições, na mesma base (já escolhida)
  await p.click('[data-imp-tipo="composicoes"]'); await p.setInputFiles('#imp-file', DIR + '/composicoes.xlsx'); await p.waitForSelector('.imp-previa');
  v(await p.inputValue('#imp-base') !== 'nova' && (await p.$eval('#imp-base', (s) => s.selectedOptions[0].textContent)).startsWith(NOME), 'A base recém-criada fica escolhida para o próximo arquivo');
  v(await p.inputValue('[data-imp-col="coeficiente"]') === '3', 'Composições: coluna do índice reconhecida como coeficiente');
  await p.click('#imp-ir'); await p.waitForSelector('.imp-resultado.feito');
  const rc = await txt(p, '.imp-resultado');
  v(rc.includes('3 composições novas') && rc.includes('igual'), 'Importa 3 composições e confere o custo com o do arquivo: ' + rc.slice(0, 140));
  // 3) orçamento
  await p.click('[data-imp-tipo="orcamento"]'); await p.setInputFiles('#imp-file', DIR + '/planilha_orcamentaria.xlsx'); await p.waitForSelector('.imp-previa');
  await p.fill('#imp-nome', 'Residencial roteiro'); await p.fill('#imp-bdi', '25');
  await p.click('#imp-ir'); await p.waitForSelector('.imp-resultado.feito a.botao.primario');
  const ro = await txt(p, '.imp-resultado'); v(ro.includes('2 etapas') && ro.includes('2 subetapas') && ro.includes('4 itens'), 'Orçamento: etapas, subetapas e itens');
  await p.screenshot({ path: OUT + '/imp_orcamento.png', fullPage: true });
  await p.click('.imp-resultado a.botao.primario'); await p.waitForSelector('.planilha-orc tr.item');
  const etq = await p.$$eval('.planilha-orc tr.item .cb-base', (x) => [...new Set(x.map((e) => e.textContent))]);
  v(etq.length === 1 && etq[0] === NOME.toUpperCase(), 'No orçamento, os itens mostram a etiqueta da base importada: ' + etq.join(', '));
  v((await p.$$('tbody.etapa.sub')).length === 2, 'Subetapas do SIENGE viram subetapas no orçamento');
  await p.screenshot({ path: OUT + '/imp_orc_aberto.png', fullPage: true });
  const oid = p.url().match(/orcamento\/(\d+)/)[1];
  // 4) a base na aba Bases próprias
  await p.goto(U + '/#/proprias'); await p.waitForSelector('.prop-bases');
  v((await p.$$('[data-prop-base]')).length === nBases + 1 && (await txt(p, '[data-prop-base][aria-checked="true"]')).includes(NOME), 'A base nova aparece e fica selecionada');
  v((await p.$$('.prop-cartao')).length === 3, 'Mostra só as composições da base escolhida (3)');
  await p.screenshot({ path: OUT + '/imp_bases.png' });
  await p.click('[data-prop-base]'); await p.waitForTimeout(500);
  v(!(await txt(p, '.prop-bases [aria-checked="true"]')).includes(NOME), 'Trocar de base troca a lista');
  await p.goto(U + '/#/'); await p.fill('#q', 'alvenaria vedacao bloco ceramico 9'); await p.waitForSelector('.res');
  v((await p.$$eval('.res .cb-base', (x) => x.map((e) => e.textContent))).includes(NOME.toUpperCase()), 'Na busca geral, o item importado aparece com o nome da base');
  const m = await b.newPage({ viewport: { width: 390, height: 800 } }); await m.goto(U + '/#/importar'); await m.waitForSelector('.importar'); await m.waitForTimeout(300);
  await m.screenshot({ path: OUT + '/imp_cel.png', fullPage: true });
  v(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Celular: página de importação sem rolagem lateral');
  v(!erros.length, 'Sem erros de JavaScript ' + JSON.stringify(erros));
  // limpeza: orçamento e base do roteiro
  await p.request.delete(U + `/api/orcamentos/${oid}`);
  const bases = await (await p.request.get(U + '/api/proprias/bases')).json(); const bb = bases.find((x) => x.nome === NOME);
  if (bb) await p.request.delete(U + `/api/proprias/bases/${bb.id}`);
  console.log(`\n${ok} OK, ${falha} falhas`); await b.close(); process.exitCode = falha ? 1 : 0; })();
