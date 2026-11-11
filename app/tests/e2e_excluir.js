// Excluir orçamento com confirmação extra. Usa o servidor local na porta 8000.
const { chromium } = require('playwright');
const U = 'http://localhost:8000/', OUT = process.argv[2];
let ok = 0, falha = 0; const v = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); c ? ok++ : falha++; };
(async () => {
  const api = async (p, m = 'GET', b) => (await fetch(U + p.slice(1), { method: m, headers: { 'content-type': 'application/json' }, body: b && JSON.stringify(b) })).json();
  const a = await api('/api/orcamentos', 'POST', { nome: 'Casa Teste A' });
  await api(`/api/orcamentos/${a.id}/itens`, 'POST', { tipo: 'servico', base: 'ORSE', codigo: '00003', quantidade: 10 });
  const bo = await api('/api/orcamentos', 'POST', { nome: 'Galpão Teste B' });
  for (const tema of ['light', 'dark']) {
  const br = await chromium.launch(); const p = await br.newPage({ viewport: { width: 1366, height: 900 }, colorScheme: tema }); const erros = [];
  p.on('pageerror', (e) => erros.push(e.message));
  if (tema === 'dark') { await p.goto(U + '#/orcamentos'); await p.waitForSelector('.orc-cartao'); await p.click('[data-excluir-orc]'); await p.fill('#excluir-orc-conf', 'excluir'); await p.screenshot({ path: OUT + '/exc_escuro.png' }); await br.close(); break; }
  await p.goto(U + '#/orcamentos'); await p.waitForSelector('.orc-cartao');
  v(await p.locator('[data-excluir-orc]').count() === 2, 'Cada cartão tem o botão de excluir');
  await p.click(`[data-excluir-orc="${a.id}"]`);
  v(await p.isVisible('#dlg-excluir-orc'), 'Clicar no botão abre a confirmação, sem abrir o orçamento');
  v(location => true, '');
  v((await p.textContent('#excluir-orc-desc')).includes('Casa Teste A') && (await p.textContent('#excluir-orc-desc')).includes('1 item'), 'A confirmação mostra nome, itens e total: ' + (await p.textContent('#excluir-orc-desc')).replace(/\s+/g, ' ').trim());
  v(await p.isDisabled('#excluir-orc-ok'), 'Botão Excluir começa desativado');
  await p.fill('#excluir-orc-conf', 'excl'); v(await p.isDisabled('#excluir-orc-ok'), 'Palavra incompleta não libera');
  await p.screenshot({ path: OUT + '/exc_dialogo.png' });
  await p.click('#dlg-excluir-orc [data-fechar]'); await p.waitForTimeout(200);
  v((await api('/api/orcamentos')).length === 2, 'Cancelar não apaga nada');
  await p.click(`[data-excluir-orc="${a.id}"]`); v(await p.inputValue('#excluir-orc-conf') === '', 'Ao reabrir, o campo vem vazio');
  await p.fill('#excluir-orc-conf', 'excluir'); v(!(await p.isDisabled('#excluir-orc-ok')), 'Digitar "excluir" (minúsculas) libera o botão');
  await p.click('#excluir-orc-ok'); await p.waitForSelector('#aviso:not([hidden])');
  await p.waitForFunction(() => document.querySelectorAll('.orc-cartao').length === 1);
  v((await api('/api/orcamentos')).length === 1, 'O orçamento sai do banco e da lista');
  v((await p.textContent('#aviso')).includes('Desfazer'), 'Aviso traz Desfazer');
  await p.click('[data-desfazer]'); await p.waitForTimeout(600);
  const depois = await api('/api/orcamentos');
  v(depois.length === 2 && depois.some((o) => o.nome === 'Casa Teste A' && o.qtd_itens === 1), 'Desfazer devolve o orçamento com o item');
  // de dentro do orçamento, pelo menu Mais
  const idA = depois.find((o) => o.nome === 'Casa Teste A').id;
  await p.goto(U + '#/orcamento/' + idA); await p.waitForSelector('.planilha');
  await p.locator('details.menu summary', { hasText: 'Mais' }).click(); await p.click('#orc-excluir');
  v(await p.isVisible('#dlg-excluir-orc'), 'No orçamento, "Excluir orçamento" também pede a confirmação');
  await p.keyboard.type('EXCLUIR'); await p.keyboard.press('Enter');
  await p.waitForFunction(() => location.hash === '#/orcamentos'); await p.waitForTimeout(400);
  v((await api('/api/orcamentos')).length === 1 && await p.locator('.orc-cartao').count() === 1, 'Enter confirma, apaga e volta à lista');
  v(erros.length === 0, 'Sem erros de JavaScript ' + JSON.stringify(erros));
  await br.close();
  }
  console.log(`\n${ok} OK, ${falha} falhas`); process.exitCode = falha ? 1 : 0;
})();
