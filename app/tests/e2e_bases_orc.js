// Bases vigentes de cada orçamento: a busca de itens da barra de baixo procura só nas bases escolhidas.
// Servidor local na porta 8000 (ou U=...); argumento: pasta das capturas.
const { chromium } = require('playwright'); const OUT = process.argv[2] || require('os').tmpdir(), U = process.env.U || 'http://localhost:8000';
let ok = 0, falha = 0; const v = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); c ? ok++ : falha++; };
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 950 } }); const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  const api = async (m, u, data) => (await p.request[m](U + u, data ? { data } : undefined)).json();
  const propria = (await api('get', '/api/proprias/bases')).sort((a, c) => c.composicoes - a.composicoes)[0];
  const o = await api('post', '/api/orcamentos', { nome: 'Roteiro bases vigentes', bdi: 0 });
  await api('post', `/api/orcamentos/${o.id}/etapas`, { titulo: 'Fundação', pai_id: o.etapas[0].id });
  await p.goto(U + `/#/orcamento/${o.id}`); await p.waitForSelector('#orc-editar');
  const buscar = async (termo) => {
    await p.fill('#pa-busca', ''); await p.fill('#pa-busca', termo); await p.waitForSelector('#form-etapa .add-res li', { timeout: 10000 }); await p.waitForTimeout(300);
    return p.$$eval('#form-etapa .add-res li[data-k] .cb-base', (l) => [...new Set(l.map((x) => x.textContent.trim()))]);
  };
  const antes = await buscar('87878');  // código do SINAPI: sem escolha, as oficiais também entram
  v(antes.includes('SINAPI'), 'Sem escolha, a busca usa todas as bases (acha o 87878 do SINAPI): ' + antes.join(', '));
  // deixa só a base própria
  await p.click('#orc-editar'); await p.waitForSelector('[data-orc-base]');
  const chaves = await p.$$eval('[data-orc-base]', (l) => l.map((x) => x.dataset.orcBase));
  for (const k of chaves) { if (k !== `P${propria.id}` && await p.isChecked(`[data-orc-base="${k}"]`)) { await p.uncheck(`[data-orc-base="${k}"]`); await p.waitForTimeout(500); } }
  v(/bases/.test(await p.textContent('.orc-dados')) && (await p.textContent('.orc-dados')).includes(propria.nome), 'O resumo do orçamento mostra a base vigente: ' + propria.nome);
  const so = await buscar('concreto');
  v(so.length === 1 && so[0].toUpperCase() === propria.nome.toUpperCase(), `Com só "${propria.nome}" vigente, a busca traz só ela: ${so.join(', ')}`);
  // só ORSE
  await p.check('[data-orc-base="ORSE"]'); await p.waitForTimeout(500); await p.uncheck(`[data-orc-base="P${propria.id}"]`); await p.waitForTimeout(600);
  const orse = await buscar('concreto');
  v(orse.length === 1 && orse[0] === 'ORSE', 'Com só a ORSE vigente, a busca traz só a ORSE: ' + orse.join(', '));
  await p.screenshot({ path: OUT + '/bases_orc.png' });
  // não deixa ficar sem nenhuma base
  await p.click('[data-orc-base="ORSE"]'); await p.waitForTimeout(500);
  v(await p.isChecked('[data-orc-base="ORSE"]'), 'Não deixa o orçamento sem nenhuma base vigente');
  // fica gravado e vai junto na cópia
  const n = await api('get', `/api/orcamentos/${o.id}`);
  v(n.bases === 'ORSE', 'A escolha fica gravada no orçamento: ' + n.bases);
  const d = await api('post', `/api/orcamentos/${o.id}/duplicar`);
  v(d.bases === 'ORSE', 'A cópia do orçamento leva as bases vigentes');
  // marcar todas de novo volta a "todas"
  await p.reload(); await p.waitForSelector('#orc-editar'); await p.click('#orc-editar');
  for (const k of chaves) { if (!(await p.isChecked(`[data-orc-base="${k}"]`))) { await p.check(`[data-orc-base="${k}"]`); await p.waitForTimeout(500); } }
  v((await api('get', `/api/orcamentos/${o.id}`)).bases === '', 'Todas marcadas = sem restrição');
  v(!erros.length, 'Sem erros de JavaScript ' + JSON.stringify(erros));
  await p.request.delete(U + `/api/orcamentos/${o.id}`); await p.request.delete(U + `/api/orcamentos/${d.id}`);
  console.log(`\n${ok} OK, ${falha} falhas`); await b.close(); process.exitCode = falha ? 1 : 0;
})();
