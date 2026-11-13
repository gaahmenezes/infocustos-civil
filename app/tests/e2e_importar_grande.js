// Planilha grande (792 linhas, como o relatório de insumos do SIENGE): todas as linhas entram, não só as da prévia.
// Uso: node e2e_importar_grande.js <arquivo.xlsx> <quantidade esperada> [pasta das capturas]
const { chromium } = require('playwright'); const ARQ = process.argv[2], N = Number(process.argv[3]), OUT = process.argv[4], U = 'http://localhost:8000';
let ok = 0, falha = 0; const v = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); c ? ok++ : falha++; };
const txt = async (p, s) => (await p.textContent(s)).replace(/\s+/g, ' ').trim();
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 900 } }); const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  const NOME = 'Grande ' + Date.now().toString().slice(-5);
  await p.goto(U + '/#/importar'); await p.waitForSelector('.importar');
  await p.selectOption('#imp-base', 'nova'); await p.fill('#imp-nova', NOME);
  await p.setInputFiles('#imp-file', ARQ); await p.waitForSelector('.imp-previa');
  v((await txt(p, '.imp-contagem')).includes(`${N.toLocaleString('pt-BR')} linhas`) && (await txt(p, '.imp-contagem')).includes('todas entram'), 'Diz quantas linhas o arquivo tem e que todas entram: ' + await txt(p, '.imp-contagem'));
  v((await p.$$('.imp-previa tbody tr')).length === 60, 'Prévia com as 60 primeiras linhas');
  await p.click('#imp-simular'); await p.waitForSelector('.imp-resultado');
  const s = await txt(p, '.imp-resultado'); v(s.includes(`${N.toLocaleString('pt-BR')} linhas de dados lidas`) && s.includes('nada foi gravado'), 'Conferência: ' + s.slice(0, 160));
  await p.click('#imp-ir'); await p.waitForSelector('.imp-resultado.feito', { timeout: 60000 });
  const bases = await (await p.request.get(U + '/api/proprias/bases')).json(); const bb = bases.find((x) => x.nome === NOME);
  v(bb && bb.insumos === N, `Base com os ${N} insumos gravados (${bb && bb.insumos})`);
  await p.goto(U + '/#/proprias'); await p.waitForSelector('.prop-bases'); await p.click('[data-prop-aba] [data-v=insumos]');
  v((await p.$$('.prop-insumos tbody tr')).length === N, 'A aba Bases próprias lista todos os insumos da base');
  if (OUT) await p.screenshot({ path: OUT + '/imp_grande.png' });
  v(!erros.length, 'Sem erros de JavaScript ' + JSON.stringify(erros));
  if (bb) await p.request.delete(U + `/api/proprias/bases/${bb.id}`);
  console.log(`\n${ok} OK, ${falha} falhas`); await b.close(); process.exitCode = falha ? 1 : 0; })();
