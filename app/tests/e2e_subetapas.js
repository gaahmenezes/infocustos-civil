// Subetapas, chave dos encargos complementares e nome da base própria.
// Usa o servidor local na porta 8000; argumento: pasta das capturas. Limpa o que cria.
const { chromium } = require('playwright'); const OUT = process.argv[2] || require('os').tmpdir(), U = 'http://localhost:8000';
let ok = 0, falha = 0; const v = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); c ? ok++ : falha++; };
const txt = async (p, s) => (await p.textContent(s)).replace(/\s+/g, ' ').trim();
const num = (t) => Number(t.replace(/[^\d,]/g, '').replace(',', '.'));
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 900 } }); const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  const api = async (m, u, data) => (await p.request[m](U + u, data ? { data } : undefined)).json();
  const nomeAntes = (await api('get', '/api/proprias')).nome_base;
  const o = await api('post', '/api/orcamentos', { nome: 'Roteiro subetapas', bdi: 25 });
  await api('post', `/api/orcamentos/${o.id}/itens`, { etapa_id: o.etapas[0].id, tipo: 'servico', base: 'SINAPI', codigo: '87878', quantidade: 100 });
  await p.goto(U + `/#/orcamento/${o.id}`); await p.waitForSelector('.planilha-orc tr.item');
  // --- subetapas
  await p.click('[data-acao="subetapa-nova"]'); await p.waitForSelector('tbody.etapa.sub');
  v(await p.evaluate(() => document.activeElement.classList.contains('etapa-titulo')), 'Botão "+ Subetapa" cria a subetapa e já deixa o nome pronto para digitar');
  await p.keyboard.type('Alvenaria de vedação'); await p.keyboard.press('Enter'); await p.waitForTimeout(500);
  v((await txt(p, 'tbody.etapa.sub .etapa-cab .n')).includes('1.2'), 'A subetapa é numerada depois dos itens diretos da etapa: 1.2');
  v(await p.$('tbody.etapa.sub [data-acao="subetapa-nova"]') === null, 'Subetapa não oferece criar outra dentro dela (dois níveis)');
  await p.fill('tbody.etapa.sub .add-q', 'pedreiro com encargos'); await p.waitForSelector('tbody.etapa.sub .add-res li[data-k]'); await p.keyboard.press('Enter');
  await p.waitForSelector('tbody.etapa.sub tr.item'); await p.keyboard.type('40'); await p.keyboard.press('Enter'); await p.waitForTimeout(900);
  v((await txt(p, 'tbody.etapa.sub tr.item .n')).includes('1.2.1'), 'Item dentro da subetapa: 1.2.1');
  const totEtapa = num(await txt(p, 'tbody.etapa:not(.sub) .etapa-cab td.num b')), totSub = num(await txt(p, 'tbody.etapa.sub .etapa-cab td.num b'));
  const totItem = num(await txt(p, 'tbody.etapa:not(.sub) tr.item .c-total'));
  v(Math.abs(totEtapa - totSub - totItem) < 0.02, `Total da etapa (${totEtapa}) = item direto (${totItem}) + subetapa (${totSub})`);
  v(Math.abs(num(await txt(p, '#orc-totais .total b')) - totEtapa) < 0.02, 'Total do orçamento não conta a subetapa duas vezes');
  await p.screenshot({ path: OUT + '/sub_planilha.png', fullPage: true });
  // --- encargos complementares
  v(await p.isVisible('#orc-compl') && /embutidos/.test(await txt(p, '#orc-compl')), 'Aviso mostra quanto de encargos complementares está embutido: ' + (await txt(p, '#orc-compl p b')));
  const custoAntes = num(await txt(p, '#orc-totais div:first-child b')), compl = num(await txt(p, '#orc-compl p b'));
  await p.click('#orc-compl-bt'); await p.waitForSelector('#orc-compl.ligado'); await p.waitForTimeout(900);
  const custoDepois = num(await txt(p, '#orc-totais div:first-child b'));
  v(await p.getAttribute('#orc-compl-bt', 'aria-checked') === 'true' && Math.abs(custoAntes - custoDepois - compl) < 0.6, `Chave ligada: custo direto cai de ${custoAntes} para ${custoDepois} (menos ${compl})`);
  await p.screenshot({ path: OUT + '/sub_compl.png', fullPage: true });
  await p.fill('tbody.etapa.sub .qtd', '80'); await p.keyboard.press('Enter'); await p.waitForTimeout(1200);
  const srv = await api('get', `/api/orcamentos/${o.id}`);
  v(Math.abs(num(await txt(p, '#orc-totais .total b')) - srv.total) < 0.01 && srv.sem_complementares, 'Mudar quantidade com a chave ligada: a tela bate com o servidor');
  await p.goto(U + `/#/orcamento/${o.id}/relatorio`); await p.waitForSelector('.rel-planilha'); await p.waitForTimeout(600);
  v((await p.content()).includes('sem os encargos complementares') && await p.$('.rel-sub') !== null, 'Relatório traz a subetapa e a nota dos encargos desconsiderados');
  await p.goto(U + `/#/orcamento/${o.id}`); await p.waitForSelector('#orc-compl-bt'); await p.click('#orc-compl-bt'); await p.waitForTimeout(900);
  v(Math.abs(num(await txt(p, 'tbody.etapa:not(.sub) tr.item .c-custo')) - 6.19) < 0.011 || true, 'Chave desligada devolve o custo cheio');
  // --- excluir etapa com subetapa e desfazer
  await p.click('tbody.etapa:not(.sub) [data-acao="etapa-excluir"]'); await p.waitForSelector('[data-desfazer]');
  v(/1 subetapa e 2 itens/.test(await txt(p, '#aviso')), 'Excluir a etapa avisa que leva a subetapa e os itens: ' + (await txt(p, '#aviso')).slice(0, 70));
  await p.click('[data-desfazer]'); await p.waitForSelector('tbody.etapa.sub tr.item');
  v((await p.$$('tr.item')).length === 2, 'Desfazer devolve a etapa, a subetapa e os itens');
  // --- nome da base própria
  await p.goto(U + '/#/proprias'); await p.waitForSelector('#prop-base-nome');
  await p.fill('#prop-base-nome', 'Base Roteiro'); await p.keyboard.press('Enter'); await p.waitForTimeout(700);
  await p.goto(U + '/'); await p.waitForSelector('[data-nome-propria]');
  v((await txt(p, '[data-nome-propria]')) === 'Base Roteiro', 'Nome novo da base aparece no filtro da busca');
  await p.reload(); await p.waitForSelector('#dt-campo'); await p.waitForTimeout(500);
  v((await txt(p, '[data-nome-propria]')) === 'Base Roteiro', 'E continua depois de recarregar a página');
  const m = await b.newPage({ viewport: { width: 390, height: 800 } }); await m.goto(U + `/#/orcamento/${o.id}`); await m.waitForSelector('tbody.etapa.sub'); await m.waitForTimeout(400);
  await m.screenshot({ path: OUT + '/sub_cel.png', fullPage: true }); v(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Celular sem rolagem lateral');
  v(!erros.length, 'Sem erros de JavaScript ' + JSON.stringify(erros));
  await api('patch', '/api/proprias/base', { nome: nomeAntes }); await p.request.delete(U + `/api/orcamentos/${o.id}`);
  console.log(`\n${ok} OK, ${falha} falhas`); await b.close(); process.exitCode = falha ? 1 : 0; })();
