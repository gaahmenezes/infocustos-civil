// Requer: npm i axe-core. Uso: node e2e_acessibilidade.js <id de um orçamento com itens> [--detalhe]
// Verificação automática de acessibilidade (axe-core) nas telas principais, nos temas claro e escuro.
const { chromium } = require('playwright');
const fs = require('fs');
const AXE = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const U = 'http://localhost:8000/', OID = process.argv[2];  // id de um orçamento com itens
const detalhe = process.argv.includes('--detalhe');
(async () => {
  const b = await chromium.launch();
  let total = 0;
  for (const tema of ['light', 'dark']) {
    const p = await b.newPage({ viewport: { width: 1366, height: 900 }, colorScheme: tema });
    const telas = [
      ['início', async () => { await p.goto(U + '#/'); await p.waitForSelector('#dt-campo'); await p.waitForTimeout(400); }],
      ['busca + composição', async () => { await p.fill('#q', 'chapisco'); await p.waitForSelector('.res'); await p.click('.res'); await p.waitForSelector('.arvore'); await p.waitForTimeout(400); }],
      ['insumo', async () => { await p.goto(U + '#/insumo/SINAPI/01379'); await p.waitForSelector('.uso'); await p.waitForTimeout(300); }],
      ['comparar', async () => { await p.goto(U + '#/comparar/ORSE-03310,ORSE-03311'); await p.waitForSelector('.cmp-tabela'); await p.waitForTimeout(300); }],
      ['orçamentos', async () => { await p.goto(U + '#/orcamentos'); await p.waitForSelector('.orc-cartao'); await p.waitForTimeout(300); }],
      ['orçamento', async () => { await p.goto(U + '#/orcamento/' + OID); await p.waitForSelector('.planilha'); await p.waitForTimeout(500); }],
      ['relatório', async () => { await p.goto(U + '#/orcamento/' + OID + '/relatorio'); await p.waitForSelector('.folha'); await p.waitForTimeout(400); }],
      ['encargos', async () => { await p.goto(U + '#/encargos'); await p.waitForSelector('.enc'); await p.waitForTimeout(300); }],
      ['apresentação', async () => { await p.goto(U + '#/apresentacao'); await p.waitForSelector('.ap-res.escolhido', { timeout: 15000 }); await p.waitForTimeout(300); }],
      ['comparativo', async () => { await p.goto(U + '#/comparativo'); await p.waitForSelector('.comparativo table'); await p.waitForTimeout(300); }],
    ];
    for (const [nome, ir] of telas) {
      await ir();
      await p.evaluate(AXE);
      const r = await p.evaluate(() => window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'] }));
      const n = r.violations.reduce((s, v) => s + v.nodes.length, 0); total += n;
      console.log(`${tema.padEnd(5)} ${nome.padEnd(20)} ${n ? r.violations.map((v) => `${v.id}×${v.nodes.length}`).join(', ') : 'sem falhas'}`);
      if (detalhe) for (const v of r.violations) for (const no of v.nodes.slice(0, 4)) console.log('      ', v.id, '|', no.target.join(' '), '|', (no.any[0] && no.any[0].message || '').slice(0, 110));
    }
    await p.close();
  }
  console.log('TOTAL', total);
  await b.close();
  process.exitCode = total ? 1 : 0;
})();
