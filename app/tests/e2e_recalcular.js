// "Recalcular preços" no mesmo mês: o orçamento leva os itens para os preços que a base tem hoje (revisão da base).
// Servidor local (U=..., padrão :8000) com o banco do orçamento em ORC_DB (para simular um preço antigo congelado).
const { chromium } = require('playwright'); const OUT = process.argv[2] || require('os').tmpdir(), U = process.env.U || 'http://localhost:8000';
const { execFileSync } = require('child_process');
let ok = 0, falha = 0; const v = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); c ? ok++ : falha++; };
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 950 } }); const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  const api = async (m, u, data) => (await p.request[m](U + u, data ? { data } : undefined)).json();
  const o = await api('post', '/api/orcamentos', { nome: 'Roteiro recalcular', bdi: 0, referencia: '2026-08' });
  const n = await api('post', `/api/orcamentos/${o.id}/itens`, { etapa_id: o.etapas[0].id, tipo: 'servico', base: 'ORSE', codigo: '00051', quantidade: 1 });
  const it = n.etapas.flatMap((e) => e.itens).find((i) => i.codigo === '00051');
  const atual = it.custo_unit;
  // simula o preço que ficou congelado antes da revisão da base (549,94)
  execFileSync('python3', ['-c', `import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute('UPDATE item SET custo_unit = 549.94 WHERE id = ?', (int(sys.argv[2]),)); c.commit()`, process.env.ORC_DB, String(it.id)]);
  await p.goto(U + `/#/orcamento/${o.id}`); await p.waitForSelector('#orc-editar');
  v((await api('get', `/api/orcamentos/${o.id}`)).total === 549.94, 'Orçamento com o preço antigo congelado: R$ 549,94');
  await p.click('#orc-editar'); await p.click('#orc-recalc'); await p.waitForSelector('#orc-mes-ok');
  const txt = (await p.textContent('#orc-mudar-mes')).replace(/\s+/g, ' ');
  v(/Recalcular com os preços atuais de agosto\/2026/.test(txt) && /1 item muda/.test(txt), 'Prévia: recalcular no mesmo mês, 1 item muda');
  v(txt.includes('549,94') && txt.includes(atual.toFixed(2).replace('.', ',')), `Prévia mostra o total antes e depois: ${txt.match(/Total com BDI: [^.]*\./)}`);
  await p.screenshot({ path: OUT + '/recalcular.png' });
  await p.click('#orc-mes-ok'); await p.waitForTimeout(1200);
  const d = await api('get', `/api/orcamentos/${o.id}`);
  v(Math.abs(d.total - atual) < 0.006 && d.referencia === '2026-08', `Depois de recalcular: R$ ${d.total}, mesma data-base (${d.referencia})`);
  await p.click('#orc-editar').catch(() => {}); if (!(await p.isVisible('#orc-recalc'))) await p.click('#orc-editar');
  await p.click('#orc-recalc'); await p.waitForSelector('#orc-mes-cancelar');
  v(/Nenhum item muda/.test(await p.textContent('#orc-mudar-mes')) && await p.isDisabled('#orc-mes-ok'), 'Já atualizado: nenhum item muda e o botão fica desligado');
  v(!erros.length, 'Sem erros de JavaScript ' + JSON.stringify(erros));
  await p.request.delete(U + `/api/orcamentos/${o.id}`);
  console.log(`\n${ok} OK, ${falha} falhas`); await b.close(); process.exitCode = falha ? 1 : 0;
})();
