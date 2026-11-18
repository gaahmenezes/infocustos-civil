// Bases de encargos da empresa: criar a partir da CEHOP, editar itens e grupos, e usar na composição própria.
// Servidor local na porta 8000 (ou U=...); argumento: pasta das capturas.
const { chromium } = require('playwright'); const OUT = process.argv[2] || require('os').tmpdir(), U = process.env.U || 'http://localhost:8000';
let ok = 0, falha = 0; const v = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); c ? ok++ : falha++; };
const perto = (a, b) => Math.abs(a - b) < 0.011;
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } }); const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  p.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'Encargos Roteiro' : undefined));
  const api = async (m, u, data) => (await p.request[m](U + u, data ? { data } : undefined)).json();
  const cehop = await api('get', '/api/encargos');
  await p.goto(U + '/#/encargos'); await p.waitForSelector('.enc-bases');
  v(await p.isVisible('.enc-base-op.ativa'), 'A aba Encargos sociais mostra o modelo da CEHOP e a barra de bases');
  await p.click('.enc-nova > summary'); await p.click('[data-enc-nova="cehop"]');
  await p.waitForFunction(() => /^#\/encargos\/\d+$/.test(location.hash)); await p.waitForSelector('#enc-nome');
  const id = Number(p.url().split('/').pop());
  let base = await api('get', `/api/bases-encargos/${id}`);
  const cabecalhoOk = () => p.evaluate(() => [...document.querySelectorAll('.enc-editavel')].every((q) => q.querySelector('thead th').getBoundingClientRect().bottom <= q.querySelector('tbody tr').getBoundingClientRect().top + 1));
  v(await cabecalhoOk(), 'O cabeçalho da tabela fica acima da primeira linha (sem sobrepor)');
  await p.mouse.wheel(0, 700); await p.waitForTimeout(400); v(await cabecalhoOk(), 'Também com a página rolada'); await p.mouse.wheel(0, -700);
  v(base.nome === 'Encargos Roteiro' && perto(base.total_horista, cehop.horista.total) && perto(base.total_mensalista, cehop.mensalista.total),
    `Nova base a partir da CEHOP: ${base.total_horista}% horistas e ${base.total_mensalista}% mensalistas`);
  // editar um item (A09 SECONCI: 0 → 1,20)
  const kA09 = base.horista.linhas.findIndex((l) => l.item === 'A09');
  await p.fill(`[data-enc-k="horista:${kA09}"][data-enc-c="valor"]`, '1,2'); await p.press(`[data-enc-k="horista:${kA09}"][data-enc-c="valor"]`, 'Enter'); await p.waitForTimeout(900);
  base = await api('get', `/api/bases-encargos/${id}`);
  const gA = base.horista.linhas.find((l) => l.item === 'A');
  v(perto(base.total_horista, cehop.horista.total + 1.2) && perto(gA.valor, 38.0), `Editar um item refaz o grupo (A = ${gA.valor}%) e o total (${base.total_horista}%)`);
  v((await p.textContent('[data-enc-tipo="horista"] .enc-total')).includes(String(base.total_horista).replace('.', ',')), 'O total do quadro na tela acompanha');
  // novo item no grupo B
  await p.click('[data-enc-mais="horista:B"]'); await p.waitForTimeout(900);
  base = await api('get', `/api/bases-encargos/${id}`);
  const novo = base.horista.linhas.find((l) => l.item === 'B11');
  v(!!novo, 'Novo item no grupo B ganha o código B11');
  const kB11 = base.horista.linhas.indexOf(base.horista.linhas.find((l) => l.item === 'B11'));
  v(await p.evaluate(() => document.activeElement && document.activeElement.dataset.encC === 'descricao'), 'O cursor vai para a descrição do item novo');
  await p.keyboard.type('Adicional de insalubridade'); await p.keyboard.press('Tab'); await p.waitForTimeout(800);
  await p.fill(`[data-enc-k="horista:${kB11}"][data-enc-c="valor"]`, '2'); await p.press(`[data-enc-k="horista:${kB11}"][data-enc-c="valor"]`, 'Enter'); await p.waitForTimeout(900);
  base = await api('get', `/api/bases-encargos/${id}`);
  v(base.horista.linhas.some((l) => l.item === 'B11' && l.descricao === 'Adicional de insalubridade' && l.valor === 2) && perto(base.total_horista, cehop.horista.total + 3.2), `Item novo entra no total: ${base.total_horista}%`);
  // novo grupo
  await p.click('[data-enc-grupo="mensalista"]'); await p.waitForTimeout(900);
  base = await api('get', `/api/bases-encargos/${id}`);
  v(base.mensalista.linhas.some((l) => l.item === 'E') && base.mensalista.linhas.some((l) => l.item === 'E01'), 'Novo grupo E nos mensalistas, com o primeiro item E01');
  // tirar o grupo E
  const kE = base.mensalista.linhas.findIndex((l) => l.item === 'E');
  await p.click(`[data-enc-tirar="mensalista:${kE}"]`); await p.waitForTimeout(900);
  base = await api('get', `/api/bases-encargos/${id}`);
  v(!base.mensalista.linhas.some((l) => l.grupo === 'E'), 'Tirar o grupo tira os itens dele');
  // renomear
  await p.fill('#enc-nome', 'Encargos Viva 2026'); await p.press('#enc-nome', 'Tab'); await p.waitForTimeout(800);
  v((await api('get', `/api/bases-encargos/${id}`)).nome === 'Encargos Viva 2026', 'Renomear a base');
  await p.screenshot({ path: OUT + '/base_encargos.png', fullPage: false });
  // usar na composição própria
  const c = await api('post', '/api/proprias/composicoes', { descricao: 'Roteiro base de encargos', unidade: 'm2' });
  await api('post', `/api/proprias/composicoes/${c.codigo}/itens`, { tipo: 'servico', base: 'SINAPI', codigo: '88309', qtd: 0.5 });
  await api('patch', `/api/proprias/composicoes/${c.codigo}`, { encargos_modo: 'empresa' });
  await p.goto(U + `/#/propria/${c.codigo}`); await p.waitForSelector('#prop-enc-base');
  await p.waitForFunction((i) => !!document.querySelector(`#prop-enc-base option[value="${i}:horista"]`), id);
  await p.selectOption('#prop-enc-base', `${id}:horista`); await p.waitForSelector('.prop-enc-da-base');
  let n = await api('get', `/api/proprias/composicoes/${c.codigo}`);
  v(n.encargos.base_encargos && n.encargos.base_encargos.id === id && perto(n.encargos.pct_social, base.total_horista), `A composição usa o total da base: ${n.encargos.pct_social}%`);
  v(perto(n.encargos.social, n.encargos.mo_sem_encargos * base.total_horista / 100), 'O encargo social da composição é o % da base sobre a mão de obra');
  await (await p.$('.prop-enc')).screenshot({ path: OUT + '/base_encargos_comp.png' });
  // mudar a base muda a composição
  await api('patch', `/api/bases-encargos/${id}`, { horista: base.horista.linhas.map((l) => (l.item === 'A01' ? { ...l, valor: 0 } : l)) });
  n = await api('get', `/api/proprias/composicoes/${c.codigo}`);
  v(perto(n.encargos.pct_social, base.total_horista - 20), `Ao mudar a base, a composição acompanha: ${n.encargos.pct_social}%`);
  // não exclui base em uso
  const r = await p.request.delete(U + `/api/bases-encargos/${id}`);
  v(r.status() === 409, 'Não exclui uma base usada em composição');
  await p.goto(U + `/#/encargos/${id}`); await p.waitForSelector('#enc-nome');
  v((await p.textContent('.enc-base-cab')).includes(c.codigo), 'A base mostra em quais composições é usada');
  // voltar a digitar o %
  await p.goto(U + `/#/propria/${c.codigo}`); await p.waitForSelector('#prop-enc-base'); await p.waitForTimeout(500);
  await p.selectOption('#prop-enc-base', ''); await p.waitForSelector('#prop-enc-social');
  v(!(await api('get', `/api/proprias/composicoes/${c.codigo}`)).encargo_base_id, 'Voltar para "digitar o percentual" solta a base');
  // celular
  const m = await b.newPage({ viewport: { width: 390, height: 844 } }); await m.goto(U + `/#/encargos/${id}`); await m.waitForSelector('#enc-nome');
  v(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No celular, sem rolagem lateral');
  await m.screenshot({ path: OUT + '/base_encargos_m.png' });
  v(!erros.length, 'Sem erros de JavaScript ' + JSON.stringify(erros));
  await p.request.delete(U + `/api/proprias/composicoes/${c.codigo}`);
  v((await p.request.delete(U + `/api/bases-encargos/${id}`)).ok(), 'Sem uso, a base pode ser excluída');
  console.log(`\n${ok} OK, ${falha} falhas`); await b.close(); process.exitCode = falha ? 1 : 0;
})();
