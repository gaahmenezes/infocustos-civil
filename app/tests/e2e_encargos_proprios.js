// Encargos da empresa na composição própria: tira os encargos das bases e aplica os informados.
// Servidor local na porta 8000 (ou U=...); argumento: pasta das capturas.
const { chromium } = require('playwright'); const OUT = process.argv[2] || require('os').tmpdir(), U = process.env.U || 'http://localhost:8000';
let ok = 0, falha = 0; const v = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); c ? ok++ : falha++; };
const perto = (a, b) => Math.abs(a - b) < 0.011;
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } }); const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  const api = async (m, u, data) => (await p.request[m](U + u, data ? { data } : undefined)).json();
  const c = await api('post', '/api/proprias/composicoes', { descricao: 'Roteiro encargos da empresa', unidade: 'm2' });
  for (const it of [{ tipo: 'servico', base: 'SINAPI', codigo: '88309', qtd: 0.5 }, { tipo: 'insumo', base: 'ORSE', codigo: '00066', qtd: 0.4 }, { tipo: 'servico', base: 'ORSE', codigo: '00003', qtd: 1 }])
    await api('post', `/api/proprias/composicoes/${c.codigo}/itens`, it);
  const base = await api('get', `/api/proprias/composicoes/${c.codigo}`);
  v(base.encargos_modo === 'base' && base.es > 0, `Como vêm nas bases: R$ ${base.custo_total} com R$ ${base.es} de encargo social embutido`);
  await p.goto(U + `/#/propria/${c.codigo}`); await p.waitForSelector('#prop-enc-modo');
  v((await p.textContent('.prop-enc')).includes('encargo social'), 'O editor mostra quanto de encargo as bases embutem');
  // zera os encargos
  await p.selectOption('#prop-enc-modo', 'empresa'); await p.waitForSelector('#prop-enc-social');
  let n = await api('get', `/api/proprias/composicoes/${c.codigo}`);
  v(perto(n.custo_total, base.custo_total - n.encargos.tirado_social - n.encargos.tirado_compl) && n.custo_total < base.custo_total,
    `Da empresa, sem nada informado: os encargos das bases saem (R$ ${base.custo_total} → R$ ${n.custo_total})`);
  const mo = n.encargos.mo_sem_encargos;
  // encargo social da empresa
  await p.fill('#prop-enc-social', '85,5'); await p.press('#prop-enc-social', 'Enter'); await p.waitForTimeout(800);
  n = await api('get', `/api/proprias/composicoes/${c.codigo}`);
  v(perto(n.encargos.social, mo * 0.855), `Encargo social da empresa: 85,5% de R$ ${mo.toFixed(2)} = R$ ${n.encargos.social}`);
  // outros encargos
  await p.fill('.prop-enc-extra[data-extra="0"] [data-ex="descricao"]', 'EPI e ferramentas'); await p.press('.prop-enc-extra[data-extra="0"] [data-ex="descricao"]', 'Tab'); await p.waitForTimeout(700);
  await p.selectOption('.prop-enc-extra[data-extra="0"] [data-ex="tipo"]', 'valor'); await p.waitForTimeout(700);
  await p.fill('.prop-enc-extra[data-extra="0"] [data-ex="valor"]', '1,20'); await p.press('.prop-enc-extra[data-extra="0"] [data-ex="valor"]', 'Enter'); await p.waitForTimeout(800);
  await p.fill('.prop-enc-extra[data-extra="1"] [data-ex="descricao"]', 'Alimentação'); await p.press('.prop-enc-extra[data-extra="1"] [data-ex="descricao"]', 'Tab'); await p.waitForTimeout(700);
  await p.fill('.prop-enc-extra[data-extra="1"] [data-ex="valor"]', '10'); await p.press('.prop-enc-extra[data-extra="1"] [data-ex="valor"]', 'Enter'); await p.waitForTimeout(800);
  n = await api('get', `/api/proprias/composicoes/${c.codigo}`);
  const esp = n.encargos.sem_encargos + mo * 0.855 + 1.2 + mo * 0.1;
  v(n.encargos_extra.length === 2 && perto(n.custo_total, esp), `Com os encargos da empresa: R$ ${n.custo_total} (esperado R$ ${esp.toFixed(4)})`);
  v(perto(n.custo_mao_de_obra, mo + n.encargos.aplicado), 'Os encargos da empresa entram na mão de obra');
  v((await p.textContent('.preco-grande')).includes(n.custo_total.toFixed(2).replace('.', ',')), 'O preço grande no topo mostra o custo com os encargos da empresa');
  await p.screenshot({ path: OUT + '/encargos.png', fullPage: true });
  await (await p.$('.prop-enc')).screenshot({ path: OUT + '/encargos_bloco.png' });
  // tirar um encargo
  await p.click('[data-ex-tirar="0"]'); await p.waitForTimeout(800);
  n = await api('get', `/api/proprias/composicoes/${c.codigo}`);
  v(n.encargos_extra.length === 1 && n.encargos_extra[0].descricao === 'Alimentação', 'Tira um encargo da lista');
  // orçamento usa o preço com os encargos da empresa
  const o = await api('post', '/api/orcamentos', { nome: 'Roteiro encargos', bdi: 0 });
  const e = await api('post', `/api/orcamentos/${o.id}/etapas`, { titulo: 'Etapa', pai_id: o.etapas[0].id });
  const lancar = async () => { const r = await api('post', `/api/orcamentos/${o.id}/itens`, { etapa_id: e.etapa_criada, tipo: 'servico', base: 'PROPRIA', codigo: c.codigo, quantidade: 1 });
    return r.etapas.flatMap((x) => x.itens).filter((i) => i.codigo === c.codigo).pop(); };
  const comEmp = await lancar();
  await api('patch', `/api/proprias/composicoes/${c.codigo}`, { encargos_modo: 'base' });
  const comBase = await lancar();
  await api('patch', `/api/proprias/composicoes/${c.codigo}`, { encargos_modo: 'empresa' });
  // o mês do orçamento pode ser outro que o do editor: compara o mesmo item lançado nos dois modos
  v(comEmp && comBase && comEmp.custo_unit !== comBase.custo_unit && comEmp.custo_unit > 0,
    `O orçamento usa o custo com os encargos da empresa (R$ ${comEmp && comEmp.custo_unit} com os da empresa; R$ ${comBase && comBase.custo_unit} como nas bases)`);
  // a cópia leva os encargos
  const d = await api('post', `/api/proprias/composicoes/${c.codigo}/duplicar`);
  v(d.encargos_modo === 'empresa' && d.encargo_social_emp === 85.5 && d.encargos_extra.length === 1, 'Duplicar leva os encargos da empresa');
  // voltar a "como vêm nas bases"
  await p.selectOption('#prop-enc-modo', 'base'); await p.waitForTimeout(800);
  n = await api('get', `/api/proprias/composicoes/${c.codigo}`);
  v(perto(n.custo_total, base.custo_total), 'Voltar para "como vêm nas bases" devolve o custo original');
  // celular
  await api('patch', `/api/proprias/composicoes/${c.codigo}`, { encargos_modo: 'empresa' });
  const m = await b.newPage({ viewport: { width: 390, height: 844 } }); await m.goto(U + `/#/propria/${c.codigo}`); await m.waitForSelector('.prop-enc-extra');
  v(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No celular, sem rolagem lateral');
  await (await m.$('.prop-enc')).screenshot({ path: OUT + '/encargos_m.png' });
  v(!erros.length, 'Sem erros de JavaScript ' + JSON.stringify(erros));
  await p.request.delete(U + `/api/orcamentos/${o.id}`);
  for (const x of [d.codigo, c.codigo]) await p.request.delete(U + `/api/proprias/composicoes/${x}`);
  console.log(`\n${ok} OK, ${falha} falhas`); await b.close(); process.exitCode = falha ? 1 : 0;
})();
