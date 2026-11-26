// Mão de obra e prazo (aba do orçamento) e emissão de relatório por tipo.
const { chromium } = require('playwright');
const ok = (c, m) => { console.log((c ? 'OK  ' : 'FALHA ') + m); if (!c) process.exitCode = 1; };
const U = 'http://localhost:8000';
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1440, height: 1000 } });
  const erros = []; p.on('pageerror', (e) => erros.push(e.message));
  const post = async (u, d) => (await p.request.post(U + u, { data: d })).json();
  const o = await post('/api/orcamentos', { nome: 'Teste prazo', bdi: 0 });
  const et = async (t, pai) => (await post(`/api/orcamentos/${o.id}/etapas`, { titulo: t, pai_id: pai })).etapas.find((x) => x.titulo === t).id;
  const c = await et('INFRAESTRUTURA'); const s1 = await et('Contenções', c); const s2 = await et('Movimentação de terra', c);
  for (const [e, cod, q] of [[s1, '100651', 120], [s2, '102276', 900]]) await post(`/api/orcamentos/${o.id}/itens`, { etapa_id: e, tipo: 'servico', base: 'SINAPI', codigo: cod, quantidade: q });
  const d = await (await p.request.get(`${U}/api/orcamentos/${o.id}/mao-de-obra`)).json();
  const esc = d.itens.find((i) => i.codigo === '102276');
  ok(Math.abs(esc.horas['operador de escavadeira'] - 53.48) < 0.05, `Horas do operador na escavação: ${esc.horas['operador de escavadeira']}`);
  ok(!Object.keys(esc.horas).some((k) => /alimenta|transporte|epi|curso/.test(k)), 'Encargos complementares não entram como horas');
  const cel = d.etapas.find((e) => e.id === c);
  ok(Math.abs(Object.values(cel.horas).reduce((s, v) => s + v, 0) - d.horas_total) < 0.1, 'A célula soma as horas das subetapas');
  await p.goto(`${U}/#/orcamento/${o.id}/prazo`); await p.waitForSelector('.prz-resumo');
  const antes = await p.textContent('.prz-resumo div:nth-child(2) b');
  await p.fill('[data-prz-eq="servente de obras"]', '3'); await p.press('[data-prz-eq="servente de obras"]', 'Tab'); await p.waitForTimeout(300);
  const depois = await p.textContent('.prz-resumo div:nth-child(2) b');
  ok(antes !== depois, `Mais serventes encurtam o prazo: ${antes} → ${depois}`);
  // cronograma: a segunda subetapa junto com a primeira encurta a obra; histograma desenhado
  const soma = await p.textContent('.prz-resumo div:nth-child(2) b');
  await p.check(`[data-prz-junto="${s2}"]`); await p.waitForTimeout(300);
  const junto = await p.textContent('.prz-resumo div:nth-child(2) b');
  ok(junto !== soma && await p.$$eval('.gantt .gt-barra', (l) => l.length) === 3, `Etapa junto com a anterior encurta o prazo: ${soma} → ${junto}`);
  ok(await p.$$eval('.histograma rect', (l) => l.length) > 0, 'Histograma de mão de obra desenhado');
  await p.fill('#prz-inicio', '2027-01-04'); await p.dispatchEvent('#prz-inicio', 'change'); await p.waitForTimeout(300);
  ok(/04\/01\/27/.test(await p.textContent('.gantt')), 'Cronograma com datas a partir do início da obra');
  await p.uncheck(`[data-prz-junto="${s2}"]`); await p.waitForTimeout(300);
  await p.click('[data-prz-modo="prazo"]'); await p.fill('#prz-alvo', '5'); await p.press('#prz-alvo', 'Tab'); await p.waitForTimeout(300);
  const dias = Number((await p.textContent('.prz-resumo div:nth-child(2) b')).replace(/[^\d,]/g, '').replace(',', '.'));
  ok(dias > 0 && dias <= 5, `Equipe calculada cabe no prazo de 5 dias: ${dias}`);
  ok((await p.request.get(await p.getAttribute('.prz-opcoes a.botao', 'href').then((h) => U + h))).ok(), 'Planilha do Excel da análise de prazo');
  for (const [t, h2] of [['sintetico', 'Planilha orçamentária'], ['analitico', 'Orçamento analítico'], ['abc-mat', 'Curva ABC de materiais'], ['abc-serv', 'Curva ABC de serviços'], ['prazo', 'Mão de obra e prazo']]) {
    await p.goto(`${U}/#/orcamento/${o.id}/relatorio`); await p.waitForSelector('.rel-tipos');
    await p.check(`[name="rel-tipo"][value="${t}"]`); await p.waitForFunction((x) => [...document.querySelectorAll('.folha h2')].some((h) => h.textContent === x), h2);
    ok(true, `Relatório ${t}: ${h2}`);
  }
  const mat = await (await p.request.get(`${U}/api/orcamentos/${o.id}/abc?tipo=insumos&so_material=true`)).json();
  ok(mat.linhas.length && !mat.linhas.some((l) => /encargos complementares/i.test(l.descricao)), 'Curva ABC de materiais sem os encargos complementares');
  ok(!erros.length, 'Sem erros na página ' + erros.join(' | '));
  await p.request.delete(`${U}/api/orcamentos/${o.id}`); await b.close();
})();
