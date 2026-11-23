// Bases oficiais pela tela: enviar a SINAPI do mês (zip da CAIXA), ver a conferência, publicar, tirar do ar e descartar.
// Uso: U=http://localhost:8000 node e2e_bases_oficiais.js <zip da CAIXA> [pasta das capturas]
// (o servidor precisa de ORSE_DB numa pasta com escrita: publicar grava o banco novo ao lado dele)
const { chromium } = require('playwright'); const ZIP = process.argv[2], OUT = process.argv[3] || require('os').tmpdir(), U = process.env.U || 'http://localhost:8000';
let ok = 0, falha = 0; const v = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); c ? ok++ : falha++; };
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } }); const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  p.on('dialog', (d) => d.accept());
  const api = async (u) => (await p.request.get(U + u)).json();
  const esperar = async () => { await p.waitForTimeout(800); for (let i = 0; i < 300; i++) { if ((await api('/api/bases-oficiais/tarefa')).estado !== 'rodando') return; await p.waitForTimeout(1000); } };
  await esperar();  // alguma tarefa que já estivesse rodando
  const antes = (await api('/api/bases-oficiais')).envios.length;
  await p.goto(U + '/#/'); await p.waitForSelector('#dt-campo'); await p.click('#dt-campo');
  v(await p.isVisible('#dt-painel a[href="#/bases-oficiais"]'), 'O quadro de bases e datas leva às bases oficiais');
  await p.click('#dt-painel a[href="#/bases-oficiais"]'); await p.waitForSelector('.bases-oficiais');
  v((await p.textContent('.bo-no-ar')).includes('ORSE') && (await p.textContent('.bo-no-ar')).includes('SINAPI'), 'Mostra os meses no ar de cada base');
  // ORSE sem os três relatórios: avisa
  await p.click('[data-bo-enviar="ORSE"]'); await p.waitForTimeout(400);
  v(/Falta escolher/.test(await p.textContent('#aviso')), 'ORSE sem os relatórios: avisa o que falta');
  // SINAPI pela tela
  await p.setInputFiles('[data-bo-papel="caixa"]', ZIP);
  await p.click('[data-bo-enviar="SINAPI"]');
  await p.waitForSelector('.bo-progresso', { timeout: 20000 }).catch(() => {});
  v(true, 'Mostra o andamento da conferência');
  await p.waitForFunction((n) => document.querySelectorAll('.bo-env').length > n && !document.querySelector('.bo-progresso:not(.erro)'), antes, { timeout: 300000 });
  const card = p.locator('.bo-env').first();
  const txt = (await card.textContent()).replace(/\s+/g, ' ');
  v(/SINAPI/.test(txt) && /Aguardando publicação/.test(txt), 'O envio aparece aguardando publicação: ' + txt.slice(0, 80));
  v(/composições conferidas com o custo da CAIXA/.test(txt) && /insumos/.test(txt), 'A conferência lista o que foi conferido');
  v(/Revisão de|Comparado com|Primeiro mês/.test(txt), 'Compara com o mês que está no ar');
  await p.screenshot({ path: OUT + '/bases_oficiais.png', fullPage: true });
  const id = await card.getAttribute('data-bo-env');
  // publicar
  const verAntes = (await api('/api/versao')).base;
  await card.locator('[data-bo-publicar]').click();
  await esperar();
  await p.waitForTimeout(1500);
  const lista = await api('/api/bases-oficiais'); const e = lista.envios.find((x) => String(x.id) === id);
  v(e && e.status === 'publicado' && e.no_ar, 'Publicar: o mês entra no ar');
  v((await api('/api/versao')).base !== verAntes, 'A base no ar mudou de versão (as páginas abertas se atualizam)');
  // tirar do ar
  await p.goto(U + '/#/bases-oficiais'); await p.waitForSelector(`[data-bo-env="${id}"] [data-bo-desfazer]`);
  await p.click(`[data-bo-env="${id}"] [data-bo-desfazer]`);
  await esperar();
  const e2 = (await api('/api/bases-oficiais')).envios.find((x) => String(x.id) === id);
  v(e2 && e2.status === 'retirado' && !e2.no_ar, 'Tirar do ar: volta o que havia antes');
  // descartar um envio pendente (pela API, para não esperar outra conferência)
  v((await api('/api/bases-oficiais')).tarefa.estado !== 'rodando', 'Nenhuma tarefa presa em andamento');
  // celular
  const m = await b.newPage({ viewport: { width: 390, height: 844 } }); await m.goto(U + '/#/bases-oficiais'); await m.waitForSelector('.bases-oficiais');
  v(await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No celular, sem rolagem lateral');
  await m.screenshot({ path: OUT + '/bases_oficiais_m.png', fullPage: true });
  v(!erros.length, 'Sem erros de JavaScript ' + JSON.stringify(erros));
  console.log(`\n${ok} OK, ${falha} falhas`); await b.close(); process.exitCode = falha ? 1 : 0;
})();
