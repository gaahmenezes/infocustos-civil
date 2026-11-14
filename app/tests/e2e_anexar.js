// Anexar o orçamento de uma obra (relatório "Orçamento" do SIENGE) pela aba Orçamentos; cancelar; limpeza da tela.
// Uso: node e2e_anexar.js <insumos.pdf> <servicos.pdf> <orcamento.pdf> [pasta das capturas]   (servidor local na porta 8000)
const { chromium } = require('playwright'); const [INS, SRV, ORC, OUT] = process.argv.slice(2), U = 'http://localhost:8000';
let ok = 0, falha = 0; const v = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); c ? ok++ : falha++; };
const txt = async (p, s) => (await p.textContent(s)).replace(/\s+/g, ' ').trim();
const fs = require('fs');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1366, height: 900 } }); const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  const NOME = 'Anexo ' + Date.now().toString().slice(-5);
  // prepara a base com os insumos e as composições da obra
  const r1 = await (await p.request.post(U + `/api/importar/sienge?nova_base=${encodeURIComponent(NOME)}`, { data: fs.readFileSync(INS) })).json();
  await p.request.post(U + `/api/importar/sienge?base_id=${r1.base_id}`, { data: fs.readFileSync(SRV) });
  const antes = (await (await p.request.get(U + '/api/orcamentos')).json()).length;
  await p.goto(U + '/#/orcamentos'); await p.waitForSelector('#anexar-orc');
  v(await p.isVisible('#anexar-orc'), 'Aba Orçamentos tem o botão "Anexar orçamento"');
  await p.click('#anexar-orc'); await p.waitForSelector('.anexar');
  v(await p.getAttribute('.abas a[data-aba="orcamentos"]', 'aria-current') === 'true', 'A página de anexar fica dentro da aba Orçamentos');
  // 1) anexa e cancela: nada gravado, tela zerada
  await p.setInputFiles('#anx-file', ORC); await p.waitForSelector('#anx-ir', { timeout: 60000 });
  const lido = await txt(p, '.imp-lido');
  v(/confere com o total do arquivo/.test(lido) && /encontrados nas bases pelo nome/.test(lido), 'Lê o relatório e confere: ' + lido.slice(0, 150));
  v(lido.includes(NOME), 'Itens encontrados pelo nome na base própria da obra');
  if (OUT) await p.screenshot({ path: OUT + '/anx_conferencia.png', fullPage: true });
  await p.click('#anx-cancelar'); await p.waitForSelector('#anexar-orc');
  v((await txt(p, '#aviso')).includes('Nada foi gravado') && (await (await p.request.get(U + '/api/orcamentos')).json()).length === antes, 'Cancelar: volta à lista e nenhum orçamento é criado');
  await p.click('#anexar-orc'); await p.waitForSelector('.anexar');
  v(await p.$('#anx-ir') === null && (await txt(p, '#anx-zona')).includes('Escolha o arquivo'), 'Depois de cancelar, a tela de anexar está na estaca zero');
  // 2) anexa de verdade
  await p.setInputFiles('#anx-file', ORC); await p.waitForSelector('#anx-ir', { timeout: 60000 });
  await p.fill('#anx-nome', 'Harmonia (anexado)'); await p.fill('#anx-cliente', 'Cliente teste');
  if (await p.$('#anx-base')) await p.selectOption('#anx-base', String(r1.base_id));
  await p.click('#anx-ir'); await p.waitForSelector('.planilha-orc tr.item', { timeout: 120000 });
  v(/#\/orcamento\/\d+/.test(p.url()) && (await txt(p, '#aviso')).includes('Orçamento anexado'), 'Anexar cria o orçamento e abre: ' + (await txt(p, '#aviso')).slice(0, 130));
  const oid = p.url().match(/orcamento\/(\d+)/)[1];
  const o = await (await p.request.get(U + `/api/orcamentos/${oid}`)).json();
  v(o.nome === 'Harmonia (anexado)' && o.cliente === 'Cliente teste' && o.qtd_itens === 461, `Orçamento com nome, cliente e os 461 itens (${o.qtd_itens})`);
  v(o.etapas.filter((e) => e.nivel === 2).length > 100 && o.etapas[0].titulo.includes('›'), 'Etapas ("TORRES › ...") e subetapas do arquivo: ' + o.etapas[0].titulo);
  const proprios = o.etapas.flatMap((e) => e.itens).filter((i) => i.base === 'PROPRIA' && i.tipo === 'servico').length;
  v(proprios > 440, `Itens ligados às composições da base pelo nome (${proprios} de 461)`);
  if (OUT) await p.screenshot({ path: OUT + '/anx_orcamento.png' });
  // 3) nada fica preso: voltar à tela de anexar mostra o início
  await p.goto(U + '/#/orcamentos/anexar'); await p.waitForSelector('.anexar');
  v(await p.$('#anx-ir') === null && await p.$('.imp-lido') === null, 'Depois de anexar, a tela de anexar não guarda nada do arquivo');
  // 4) importação comum: limpa ao concluir e tem Cancelar
  await p.goto(U + '/#/importar'); await p.waitForSelector('.importar');
  await p.setInputFiles('#imp-file', INS); await p.waitForSelector('#imp-cancelar', { timeout: 60000 });
  await p.click('#imp-cancelar'); await p.waitForTimeout(300);
  v(await p.$('#imp-ir') === null && (await txt(p, '#imp-zona')).includes('Escolha o arquivo'), 'Importar arquivo: "Cancelar" volta à estaca zero');
  await p.selectOption('#imp-base', String(r1.base_id)); await p.setInputFiles('#imp-file', INS); await p.waitForSelector('#imp-ir', { timeout: 60000 });
  await p.click('#imp-ir'); await p.waitForSelector('.imp-final', { timeout: 60000 });
  v(await p.$('#imp-ir') === null && await p.$('.imp-reconhecido') === null && (await txt(p, '.imp-final')).includes('Importação concluída'), 'Depois de importar, fica só o resultado; arquivo e prévia saem da tela');
  await p.click('.abas a[data-aba="orcamentos"]'); await p.waitForTimeout(400); await p.goto(U + '/#/importar'); await p.waitForSelector('.importar');
  v(await p.$('.imp-final') === null, 'Sair e voltar à importação: tela limpa');
  v(!erros.length, 'Sem erros de JavaScript ' + JSON.stringify(erros));
  await p.request.delete(U + `/api/orcamentos/${oid}`); await p.request.delete(U + `/api/proprias/bases/${r1.base_id}`);
  console.log(`\n${ok} OK, ${falha} falhas`); await b.close(); process.exitCode = falha ? 1 : 0; })();
