// Relatórios padrão do SIENGE em PDF pela tela: Insumos Orçados e Composições de Serviços da Obra.
// Uso: node e2e_sienge.js <insumos.pdf> <servicos.pdf> [pasta das capturas]   (servidor local na porta 8000)
const { chromium } = require('playwright'); const INS = process.argv[2], SRV = process.argv[3], OUT = process.argv[4], U = 'http://localhost:8000';
let ok = 0, falha = 0; const v = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); c ? ok++ : falha++; };
const txt = async (p, s) => (await p.textContent(s)).replace(/\s+/g, ' ').trim();
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 900 } }); const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  const NOME = 'SIENGE PDF ' + Date.now().toString().slice(-5);
  await p.goto(U + '/#/importar'); await p.waitForSelector('.importar');
  await p.selectOption('#imp-base', 'nova'); await p.fill('#imp-nova', NOME);
  let t0 = Date.now(); await p.setInputFiles('#imp-file', INS); await p.waitForSelector('.imp-reconhecido', { timeout: 60000 });
  v((await txt(p, '.imp-reconhecido')).includes('Insumos Orçados'), `Reconhece o relatório Insumos Orçados (${Date.now() - t0} ms)`);
  const lido = await txt(p, '.imp-lido'); v(/confere com o "Total da obra"/.test(lido), 'Soma dos insumos confere com o total do relatório: ' + lido.slice(0, 110));
  v(await p.$('[data-imp-col]') === null, 'Sem etapa de conferir colunas');
  if (OUT) await p.screenshot({ path: OUT + '/sg_insumos.png', fullPage: true });
  await p.click('#imp-simular'); await p.waitForSelector('.imp-resultado'); v((await txt(p, '.imp-resultado')).includes('nada foi gravado'), 'Conferir sem gravar');
  await p.click('#imp-ir'); await p.waitForSelector('.imp-resultado.feito', { timeout: 60000 });
  const ri = await txt(p, '.imp-resultado'); v(/insumos novos/.test(ri), 'Insumos importados: ' + ri.slice(0, 120));
  // composições, na mesma base, com o orçamento
  t0 = Date.now(); await p.setInputFiles('#imp-file', SRV); await p.waitForFunction(() => document.querySelector('.imp-reconhecido') && document.querySelector('.imp-reconhecido').textContent.includes('Composições'), null, { timeout: 120000 });
  v(true, `Lê o relatório de 309 páginas sem travar (${Date.now() - t0} ms)`);
  v((await p.$eval('#imp-base', (s) => s.selectedOptions[0].textContent)).startsWith(NOME) && await p.isChecked('#imp-criar-orc'), 'Mesma base escolhida; criar orçamento marcado');
  if (OUT) await p.screenshot({ path: OUT + '/sg_servicos.png', fullPage: true });
  await p.click('#imp-ir'); await p.waitForSelector('.imp-resultado.feito a.botao.primario', { timeout: 120000 });
  const rs = await txt(p, '.imp-resultado'); v(/conferido com o relatório: igual/.test(rs), 'Custo das composições confere com o relatório: ' + rs.slice(0, 150));
  if (OUT) await p.screenshot({ path: OUT + '/sg_resultado.png', fullPage: true });
  await p.click('.imp-resultado a.botao.primario'); await p.waitForSelector('.planilha-orc tr.item', { timeout: 60000 });
  v((await p.$$('tbody.etapa.sub')).length > 50 && (await p.$$('tr.item')).length > 500, 'Orçamento com as etapas, subetapas e serviços do SIENGE');
  const oid = p.url().match(/orcamento\/(\d+)/)[1];
  if (OUT) await p.screenshot({ path: OUT + '/sg_orcamento.png' });
  await p.goto(U + '/#/proprias'); await p.waitForSelector('.prop-cartao', { timeout: 60000 });
  v((await txt(p, '.prop-cartao')).length > 10 && (await p.$$('.prop-cartao')).length > 300, 'Base com as composições; cada uma com etapa › subetapa como grupo: ' + (await txt(p, '.prop-cartao .orc-c-sub')));
  await p.click('[data-prop-aba] [data-v=insumos]');
  v((await txt(p, '.prop-insumos tbody')).includes('Materiais › Aglomerantes'), 'Insumos mostram o grupo e a família do SIENGE');
  if (OUT) await p.screenshot({ path: OUT + '/sg_base.png' });
  v(!erros.length, 'Sem erros de JavaScript ' + JSON.stringify(erros));
  await p.request.delete(U + `/api/orcamentos/${oid}`);
  const bases = await (await p.request.get(U + '/api/proprias/bases')).json(); const bb = bases.find((x) => x.nome === NOME);
  if (bb) await p.request.delete(U + `/api/proprias/bases/${bb.id}`);
  console.log(`\n${ok} OK, ${falha} falhas`); await b.close(); process.exitCode = falha ? 1 : 0; })();
