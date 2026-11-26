'use strict';
/* Relatórios do orçamento para imprimir ou salvar em PDF: um tipo por vez (sintético, analítico, curvas ABC de materiais
   e de serviços, mão de obra e prazo), com capa opcional. */

const EMPRESA_CHAVE = 'infocustos-empresa';
function lerEmpresa() { try { return JSON.parse(localStorage.getItem(EMPRESA_CHAVE) || '{}') || {}; } catch (_) { return {}; } }
function gravarEmpresa(e) { try { localStorage.setItem(EMPRESA_CHAVE, JSON.stringify(e)); return true; } catch (_) { return false; } }
const REL = { capa: true, tipo: 'sintetico', logo: null };
const TIPOS_REL = [['sintetico', 'Orçamento sintético', 'Resumo por etapa e planilha com os itens'],
  ['analitico', 'Orçamento analítico', 'Cada serviço com a composição dele: insumos, coeficientes e custos'],
  ['abc-mat', 'Curva ABC de materiais', 'Materiais da obra inteira, das composições abertas até o insumo'],
  ['abc-serv', 'Curva ABC de serviços', 'Serviços do orçamento ordenados pelo valor'],
  ['prazo', 'Mão de obra e prazo', 'Horas por profissional, etapa e serviço, e o prazo estimado']];
try { const g = JSON.parse(localStorage.getItem('infocustos-relatorio') || '{}') || {}; REL.capa = g.capa !== false; if (TIPOS_REL.some((t) => t[0] === g.tipo)) REL.tipo = g.tipo; } catch (_) { /* padrão */ }
// no papel, o percentual tem sempre uma casa (8,0% ao lado de 1,9%)
const pct1 = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
// sem BDI (0%): custo e preço são o mesmo número, e o relatório mostra uma coluna só
const semBDI = (o) => !o.bdi_no_total && !(o.bdi > 0);
const hoje = () => new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

function cabecalhoFolha(emp, o) {
  return `<header class="folha-cab"><div class="folha-emp">${emp.logo ? `<img src="${emp.logo}" alt="">` : ''}<span>${esc(emp.nome || 'InfoCustos Civil')}</span></div>
    <div class="folha-orc"><b>${esc(o.nome)}</b><span>Data-base ${esc(nomeRef(o.referencia))} · BDI ${num2.format(o.bdi)}%</span></div></header>`;
}
// bases usadas no orçamento e de onde vêm os preços de cada uma (o SICRO tem calendário próprio)
const basesDoOrcamento = (o) => [...new Set(o.etapas.flatMap((e) => e.itens.map((i) => i.base)))].sort((a, b) => BASES.indexOf(a) - BASES.indexOf(b));
function fontesDoOrcamento(o) {
  const bases = basesDoOrcamento(o); if (!bases.length) return `Preços: referência ${nomeRef(o.referencia)}.`;
  const partes = bases.map((b) => {
    const meses = [...new Set(o.etapas.flatMap((e) => e.itens.filter((i) => i.base === b).map((i) => nomeRef(i.referencia || o.referencia))))];
    if (b === 'PROPRIA') return `${nomeBasePropria()} (composições e insumos próprios da empresa)`;
    return `${b} ${meses.join(', ')} (${b === 'SICRO' ? 'DNIT, Sergipe' : 'CEHOP/SE'})`;
  });
  return `Preços: ${juntar(partes)}.`;
}
const rodapeFolha = (o) => `<footer class="folha-rod"><span>${esc(fontesDoOrcamento(o))}</span><span>Emitido em ${hoje()} pelo InfoCustos Civil</span></footer>`;

// faixa com a divisão do custo direto, na capa: o cliente vê de relance para onde vai o dinheiro
function capaDivisao(o) {
  const dv = o.divisao; if (!dv) return '';
  const partes = [['Mão de obra', dv.mo, '--c-mo'], ['Material', dv.mat, '--c-mat'], ['Equipamento', dv.equip, '--c-equip'], ['Serviço de terceiro', dv.terc, '--c-terc']].filter((p) => p[1] > 0.0005);
  if (!partes.length) return '';
  return `<div class="capa-divisao"><span class="capa-rotulo">Composição do custo direto</span>
    <div class="capa-barra" role="img" aria-label="${esc(partes.map((p) => `${p[0]} ${pct1.format(p[1])}`).join(', '))}">${partes.map((p) => `<i style="flex-grow:${p[1]};background:var(${p[2]})"></i>`).join('')}</div>
    <ul>${partes.map((p) => `<li style="--cor:var(${p[2]})"><b>${pct1.format(p[1])}</b>${p[0]}</li>`).join('')}</ul></div>`;
}

function folhaCapa(emp, o, rotulo = 'Orçamento de obra') {
  const contato = [emp.cnpj ? `CNPJ ${emp.cnpj}` : '', emp.endereco, emp.contato].filter(Boolean).map(esc).join(' · ');
  return `<section class="folha folha-capa">
    <div class="capa-topo">${emp.logo ? `<img src="${emp.logo}" alt="Logotipo de ${esc(emp.nome || 'empresa')}">` : ''}
      <div>${emp.nome ? `<b>${esc(emp.nome)}</b>` : ''}${contato ? `<span>${contato}</span>` : ''}</div></div>
    <div class="capa-meio"><span class="capa-rotulo">${esc(rotulo)}</span><h1>${esc(o.nome)}</h1>
      <dl class="capa-dados">
        ${o.cliente ? `<div><dt>Cliente</dt><dd>${esc(o.cliente)}</dd></div>` : ''}
        ${o.local ? `<div><dt>Local</dt><dd>${esc(o.local)}</dd></div>` : ''}
        <div><dt>Data-base dos preços</dt><dd>${esc(nomeRef(o.referencia))}</dd></div>
        <div><dt>Bases de preços</dt><dd>${esc(juntar(basesDoOrcamento(o).map((b) => (b === 'PROPRIA' ? nomeBasePropria() : b))) || 'ORSE e SINAPI')}</dd></div>
      </dl></div>
    ${capaDivisao(o)}
    <div class="capa-valores">
      <div><span>Custo direto</span><b>${brl.format(o.custo_total)}</b></div>
      <div><span>BDI de ${num2.format(o.bdi)}%${o.bdi_no_total ? ' sobre o total' : ''}</span><b>${brl.format(o.valor_bdi)}</b></div>
      <div class="capa-total"><span>Valor total</span><b>${brl.format(o.total)}</b></div>
    </div>
    <div class="capa-pe"><span>${hoje()}</span>${emp.responsavel ? `<span class="capa-resp"><b>${esc(emp.responsavel)}</b>${emp.registro ? `${esc(emp.registro)}` : 'Responsável técnico'}</span>` : ''}</div>
  </section>`;
}

function folhaResumo(emp, o) {
  const dv = o.divisao;
  const itensDe = (e) => [e, ...descendentesDe(o, e.id)].reduce((s, x) => s + x.itens.length, 0);
  const um = semBDI(o);
  // peso: barra na célula e na etapa; na subetapa só o número (a barra de 1% não diz nada)
  const linhas = o.etapas.map((e) => `<tr class="rel-n${e.nivel}"><td class="n">${e.numero}</td><td class="rel-tit">${esc(e.titulo)}</td><td class="num">${itensDe(e)}</td>
      ${um ? '' : `<td class="num">${money(e.custo_total)}</td>`}<td class="num">${money(e.total)}</td>
      <td class="rel-peso">${e.nivel < 3 ? `<span class="peso"><i style="width:${e.peso * 100}%"></i></span>` : ''}${pct1.format(e.peso)}</td></tr>`).join('');
  const partes = dv ? PAINEL_PARTES.map(([k, n, cor]) => `<div style="--cor:var(${cor})">${n}<b>${brl.format(o.custo_total * dv[k])}</b><span class="pct">${pct1.format(dv[k])}</span></div>`).join('') : '';
  return `<section class="folha">${cabecalhoFolha(emp, o)}
    <h2>Resumo do orçamento</h2>
    <table class="rel-tabela rel-niveis rel-resumo"><thead><tr><th>Item</th><th>Etapa</th><th class="num">Itens</th>${um ? '' : '<th class="num">Custo direto (R$)</th>'}<th class="num">${um ? 'Total (R$)' : o.bdi_no_total ? 'Total sem BDI (R$)' : 'Total com BDI (R$)'}</th><th class="rel-peso">Peso</th></tr></thead>
      <tbody>${linhas}</tbody>
      <tfoot><tr><td></td><td>Total${um ? ' (sem BDI)' : ''}</td><td class="num">${o.qtd_itens}</td>${um ? '' : `<td class="num">${money(o.custo_total)}</td>`}<td class="num">${money(o.total)}</td><td></td></tr></tfoot></table>
    ${dv ? `<h3>Divisão do custo direto</h3><div class="custo"><div class="barra">${PAINEL_PARTES.filter(([k]) => dv[k] > 0).map(([k, , cor]) => `<span style="flex-grow:${dv[k]};background:var(${cor})"></span>`).join('')}</div>
      <div class="legenda legenda-4">${partes}</div></div>` : ''}
    ${rodapeFolha(o)}</section>`;
}

function folhaPlanilha(emp, o) {
  const um = semBDI(o), sp = o.bdi_no_total || um;  // sem a coluna "Preço c/ BDI": BDI só no total, ou BDI zero
  const cs = sp ? 6 : 7;
  const corpo = o.etapas.map((e) => `<tr class="rel-etapa rel-n${e.nivel}"><td class="n">${e.numero}</td><td colspan="${cs - 1}" class="rel-tit">${esc(e.titulo)}</td><td class="num">${money(e.total)}</td></tr>
    ${e.itens.map((i) => `<tr><td class="n">${i.numero}</td><td class="rel-cod">${esc(i.codigo)}<span>${esc(rotuloBase(i.base, i.codigo))}</span></td><td>${esc(i.descricao)}</td><td>${esc(i.unidade)}</td>
      <td class="num">${qtdFmt.format(i.quantidade)}</td><td class="num">${money(i.custo_unit)}</td>${sp ? '' : `<td class="num">${money(i.preco_unit)}</td>`}<td class="num">${money(i.total)}</td></tr>`).join('')}`).join('');
  return `<section class="folha">${cabecalhoFolha(emp, o)}
    <h2>Planilha orçamentária</h2>
    <table class="rel-tabela rel-planilha rel-niveis"><thead><tr><th>Item</th><th>Código</th><th>Descrição</th><th>Un.</th><th class="num">Quant.</th><th class="num">Custo unit.</th>${sp ? '' : '<th class="num">Preço c/ BDI</th>'}<th class="num">${o.bdi_no_total ? 'Total sem BDI (R$)' : 'Total (R$)'}</th></tr></thead>
      <tbody>${corpo}</tbody>
      <tfoot>${um ? '' : `<tr><td colspan="${cs}">Custo direto</td><td class="num">${money(o.custo_total)}</td></tr>
        <tr><td colspan="${cs}">BDI de ${num2.format(o.bdi)}%${o.bdi_no_total ? ' sobre o custo direto total' : ''}</td><td class="num">${money(o.valor_bdi)}</td></tr>`}
        <tr class="rel-geral"><td colspan="${cs}">Valor total${um ? ' (sem BDI)' : ''}</td><td class="num">${money(o.total)}</td></tr></tfoot></table>
    <p class="rel-nota">${um ? 'Orçamento sem BDI: os valores são o custo direto, arredondado em 2 casas por item.' : o.bdi_no_total ? 'BDI aplicado uma única vez sobre o custo direto total; itens e etapas a custo, sem BDI.' : 'Preço com BDI e total de cada item arredondados em 2 casas.'}${o.sem_complementares ? ` Custos unitários sem os encargos complementares da mão de obra (alimentação, transporte, EPI, ferramentas, exames, seguro e capacitação): ${brl.format(o.complementares)} desconsiderados do custo direto, a lançar nos custos indiretos.` : ''}</p>
    ${rodapeFolha(o)}</section>`;
}

function folhaABC(emp, o) {
  const l = curvaABC(o);
  return `<section class="folha">${cabecalhoFolha(emp, o)}
    <h2>Curva ABC de serviços</h2>
    <p class="rel-nota">Itens ordenados pelo valor ${o.bdi_no_total ? 'a custo (o BDI entra só no total do orçamento)' : 'com BDI'}. Classe A até 80% do valor acumulado, B até 95%, C o restante.</p>
    <table class="rel-tabela"><thead><tr><th>Pos.</th><th>Código</th><th>Descrição</th><th class="num">Total (R$)</th><th class="num">%</th><th class="num">% acum.</th><th>Classe</th></tr></thead>
      <tbody>${l.map((x) => `<tr><td class="n">${x.posicao}</td><td class="rel-cod">${esc(x.codigo)}<span>${esc(rotuloBase(x.base, x.codigo))}</span></td><td>${esc(x.descricao)}</td>
        <td class="num">${money(x.total)}</td><td class="num">${pct1.format(x.percentual)}</td><td class="num">${pct1.format(x.acumulado)}</td><td class="rel-classe">${x.classe}</td></tr>`).join('')}</tbody></table>
    ${rodapeFolha(o)}</section>`;
}

async function folhaABCMateriais(emp, o) {
  const r = await req(`/api/orcamentos/${o.id}/abc?tipo=insumos&so_material=true`);
  return `<section class="folha">${cabecalhoFolha(emp, o)}
    <h2>Curva ABC de materiais</h2>
    <p class="rel-nota">Composições desmontadas até o insumo, com as quantidades multiplicadas pelas do orçamento; só os materiais (sem mão de obra, equipamentos e os encargos complementares). Custo direto, sem BDI. Classe A até 80% do valor acumulado, B até 95%, C o restante.</p>
    <div class="rel-prz-resumo">${['A', 'B', 'C'].map((cl) => `<div><span>Classe ${cl} · ${r.resumo[cl].itens} ${r.resumo[cl].itens === 1 ? 'material' : 'materiais'}</span><b>${brl.format(r.resumo[cl].valor)}</b></div>`).join('')}</div>
    <table class="rel-tabela"><thead><tr><th>Pos.</th><th>Código</th><th>Descrição</th><th>Un.</th><th class="num">Quant.</th><th class="num">Custo unit.</th><th class="num">Total (R$)</th><th class="num">%</th><th class="num">% acum.</th><th>Classe</th></tr></thead>
      <tbody>${r.linhas.map((x) => `<tr><td class="n">${x.posicao}</td><td class="rel-cod">${esc(x.codigo)}<span>${esc(rotuloBase(x.base, x.codigo))}</span></td><td>${esc(x.descricao)}</td><td>${esc(x.unidade)}</td>
        <td class="num">${qtdFmt.format(x.quantidade)}</td><td class="num">${money(x.custo_unit)}</td><td class="num">${money(x.custo_total)}</td><td class="num">${pct1.format(x.percentual)}</td><td class="num">${pct1.format(x.acumulado)}</td><td class="rel-classe">${x.classe}</td></tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="6">Total de materiais</td><td class="num">${money(r.total)}</td><td colspan="3"></td></tr></tfoot></table>
    ${rodapeFolha(o)}</section>`;
}

// composições de cada serviço do orçamento (uma vez por código e mês), seis pedidos por vez
async function buscarComposicoes(o, progresso) {
  const vistos = new Map();
  for (const e of o.etapas) for (const i of e.itens) if (i.tipo === 'servico') { const k = `${i.base}|${i.codigo}|${i.referencia || o.referencia}`; if (!vistos.has(k)) vistos.set(k, i); }
  const chaves = [...vistos.keys()], achadas = new Map(); const vez = REL.vez; let prontas = 0, prox = 0;
  const trabalhar = async () => {
    while (prox < chaves.length && vez === REL.vez) {
      const k = chaves[prox++]; const i = vistos.get(k);
      try { achadas.set(k, i.base === 'PROPRIA' ? await api(`/api/proprias/composicoes/${encodeURIComponent(i.codigo)}`) : await api(`/api/composicao/${i.base}/${i.codigo}?ref=${encodeURIComponent(i.referencia || o.referencia)}&refs=${encodeURIComponent(refsDoOrcamento(o))}`)); } catch (_) { /* fica sem */ }
      prontas += 1; if (vez === REL.vez) progresso(prontas, chaves.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, chaves.length) }, trabalhar));
  return vez === REL.vez ? achadas : null;
}

// orçamento analítico: a planilha com a composição de cada serviço logo abaixo dele
async function folhaAnalitica(emp, o, progresso) {
  const comps = await buscarComposicoes(o, progresso); if (!comps) return null;
  const um = semBDI(o);
  const corpo = o.etapas.map((e) => `<tr class="rel-etapa rel-n${e.nivel}"><td class="n">${e.numero}</td><td colspan="5" class="rel-tit">${esc(e.titulo)}</td><td class="num">${money(e.total)}</td></tr>
    ${e.itens.map((i) => { const c = i.tipo === 'servico' ? comps.get(`${i.base}|${i.codigo}|${i.referencia || o.referencia}`) : null;
      return `<tr class="rel-an-item"><td class="n">${i.numero}</td><td class="rel-cod">${esc(i.codigo)}<span>${esc(rotuloBase(i.base, i.codigo))}</span></td><td>${esc(i.descricao)}</td><td>${esc(i.unidade)}</td>
        <td class="num">${qtdFmt.format(i.quantidade)}</td><td class="num">${money(o.bdi_no_total ? i.custo_unit : i.preco_unit)}</td><td class="num">${money(i.total)}</td></tr>
      ${c && c.itens && c.itens.length ? `<tr class="rel-an-comp"><td></td><td colspan="6"><table class="rel-tabela rel-an-tab"><thead><tr><th>Código</th><th>Insumo / serviço auxiliar</th><th>Un.</th><th class="num">Coeficiente</th><th class="num">Custo unit.</th><th class="num">Custo por ${esc(c.unidade || i.unidade)}</th></tr></thead>
        <tbody>${SECOES.map(([s, nome]) => [nome, c.itens.filter((x) => x.secao === s)]).filter((g) => g[1].length).map(([nome, its]) => `<tr class="rel-an-sec"><td colspan="5">${nome}</td><td class="num">${money(its.reduce((t, x) => t + (x.custo_total || 0), 0))}</td></tr>
          ${its.map((x) => `<tr><td class="rel-cod">${esc(x.codigo)}<span>${esc(rotuloBase(x.base, x.codigo))}</span></td><td>${esc(x.descricao)}</td><td>${esc(x.unidade)}</td><td class="num">${coef(x.qtd)}</td><td class="num">${money(x.custo_unit)}</td><td class="num">${money(x.custo_total)}</td></tr>`).join('')}`).join('')}</tbody></table></td></tr>` : ''}`; }).join('')}`).join('');
  return `<section class="folha">${cabecalhoFolha(emp, o)}
    <h2>Orçamento analítico</h2>
    <p class="rel-nota">Cada serviço com a composição dele na data-base em que entrou no orçamento. A composição está em custo direto, por unidade do serviço; o preço unitário do item ${um ? 'é o custo (orçamento sem BDI)' : o.bdi_no_total ? 'está a custo (o BDI entra só no total)' : 'inclui o BDI'}.</p>
    <table class="rel-tabela rel-planilha rel-analitico"><thead><tr><th>Item</th><th>Código</th><th>Descrição</th><th>Un.</th><th class="num">Quant.</th><th class="num">${o.bdi_no_total || um ? 'Custo unit.' : 'Preço c/ BDI'}</th><th class="num">${o.bdi_no_total ? 'Total sem BDI (R$)' : 'Total (R$)'}</th></tr></thead>
      <tbody>${corpo}</tbody>
      <tfoot>${um ? '' : `<tr><td colspan="6">Custo direto</td><td class="num">${money(o.custo_total)}</td></tr>
        <tr><td colspan="6">BDI de ${num2.format(o.bdi)}%${o.bdi_no_total ? ' sobre o custo direto total' : ''}</td><td class="num">${money(o.valor_bdi)}</td></tr>`}
        <tr class="rel-geral"><td colspan="6">Valor total${um ? ' (sem BDI)' : ''}</td><td class="num">${money(o.total)}</td></tr></tfoot></table>
    ${rodapeFolha(o)}</section>`;
}

window.desenharRelatorio = async function (o) {
  const d = $('#detalhe'); const emp = lerEmpresa();
  if (!o.qtd_itens) {
    d.innerHTML = `<div class="pagina">${vazio('folha', 'O relatório precisa de itens', 'Adicione composições ou insumos na planilha do orçamento.', `<a class="botao primario" href="${rotaOrc(o.id)}">Voltar à planilha</a>`)}</div>`; return;
  }
  const tipo = TIPOS_REL.find((t) => t[0] === REL.tipo) || TIPOS_REL[0];
  d.innerHTML = `<div class="pagina relatorio-pag">
    <div class="rel-barra">
      <a class="voltar-lista" href="${rotaOrc(o.id)}"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 3 4.5 6l3 3" /></svg>Voltar à planilha</a>
      <div class="acoes"><label class="rel-opcao"><input type="checkbox" data-rel-capa${REL.capa ? ' checked' : ''}>Capa</label><button type="button" class="botao" data-empresa>Dados da empresa</button>
        <button type="button" class="botao primario" data-imprimir>Imprimir ou salvar em PDF</button></div>
    </div>
    <fieldset class="rel-tipos"><legend>Qual relatório emitir</legend>
      ${TIPOS_REL.map(([k, nome, dica]) => `<label class="rel-tipo"><input type="radio" name="rel-tipo" value="${k}"${k === tipo[0] ? ' checked' : ''}><b>${nome}</b><span>${dica}</span></label>`).join('')}
    </fieldset>
    ${emp.nome ? '' : '<p class="rel-aviso">O relatório sai com o nome e o logotipo da sua empresa. <button type="button" class="link-acao" data-empresa>Preencher os dados da empresa</button></p>'}
    <div class="relatorio" id="relatorio"><p class="carregando">Montando o relatório…</p></div>
  </div>`;
  const gravar = () => { try { localStorage.setItem('infocustos-relatorio', JSON.stringify({ capa: REL.capa, tipo: REL.tipo })); } catch (_) { /* ok */ } };
  d.querySelectorAll('[name="rel-tipo"]').forEach((r) => r.addEventListener('change', () => { REL.tipo = r.value; gravar(); window.desenharRelatorio(o); }));
  d.querySelector('[data-rel-capa]').addEventListener('change', (e) => { REL.capa = e.target.checked; gravar(); window.desenharRelatorio(o); });
  const rel = $('#relatorio');
  REL.vez = (REL.vez || 0) + 1; const vez = REL.vez;
  const progresso = (k, n) => { if (document.body.contains(rel)) rel.innerHTML = `<p class="carregando">Buscando as composições: ${k} de ${n}…</p>`; else REL.vez += 1; };
  let miolo;
  try {
    if (tipo[0] === 'sintetico') miolo = folhaResumo(emp, o) + folhaPlanilha(emp, o);
    else if (tipo[0] === 'analitico') { const a = await folhaAnalitica(emp, o, progresso); miolo = a === null ? null : folhaResumo(emp, o) + a; }
    else if (tipo[0] === 'abc-mat') miolo = await folhaABCMateriais(emp, o);
    else if (tipo[0] === 'abc-serv') miolo = folhaABC(emp, o);
    else miolo = await window.folhaPrazo(emp, o);
  } catch (e) { miolo = `<div class="erro"><b>Não foi possível montar o relatório.</b><br>${esc(e.message)}</div>`; }
  if (vez !== REL.vez || miolo === null || !document.body.contains(rel)) return;  // a pessoa saiu da tela ou mudou o tipo enquanto carregava
  rel.innerHTML = (REL.capa ? folhaCapa(emp, o, tipo[0] === 'sintetico' || tipo[0] === 'analitico' ? `${tipo[1]} de obra` : tipo[1]) : '') + miolo;
};

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-imprimir]')) {
    const antes = document.title; const o = ORC.atual;
    if (o) document.title = `${(TIPOS_REL.find((t) => t[0] === REL.tipo) || TIPOS_REL[0])[1]} - ${o.nome}`;  // vira o nome sugerido do arquivo PDF
    window.print(); document.title = antes;
  }
  if (e.target.closest('[data-empresa]')) abrirEmpresa();
});

// ---------- dados da empresa ----------
let logoNovo;
function mostrarLogo(src) {
  const img = $('#empresa-logo-previa'); img.hidden = !src; if (src) img.src = src;
  $('#empresa-logo-tirar').hidden = !src;
}
function abrirEmpresa() {
  const emp = lerEmpresa(), f = $('#form-empresa');
  for (const k of ['nome', 'cnpj', 'contato', 'endereco', 'responsavel', 'registro']) f.elements[k].value = emp[k] || '';
  logoNovo = emp.logo || ''; mostrarLogo(logoNovo);
  $('#dlg-empresa').showModal(); f.elements.nome.focus();
}
$('#empresa-logo').addEventListener('change', (e) => {
  const arq = e.target.files[0]; if (!arq) return;
  const leitor = new FileReader();
  leitor.onload = () => {
    // reduz a imagem para caber no armazenamento do navegador
    const img = new Image();
    img.onload = () => {
      const esc0 = Math.min(1, 480 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(img.width * esc0) || 1; cv.height = Math.round(img.height * esc0) || 1;
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      logoNovo = cv.toDataURL('image/png'); mostrarLogo(logoNovo);
    };
    img.onerror = () => avisar('Não foi possível ler essa imagem. Tente um PNG ou JPG.');
    img.src = leitor.result;
  };
  leitor.readAsDataURL(arq); e.target.value = '';
});
$('#empresa-logo-tirar').addEventListener('click', () => { logoNovo = ''; mostrarLogo(''); });
$('#form-empresa').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target, emp = { logo: logoNovo || '' };
  for (const k of ['nome', 'cnpj', 'contato', 'endereco', 'responsavel', 'registro']) emp[k] = f.elements[k].value.trim();
  if (!gravarEmpresa(emp)) { avisar('Não foi possível salvar neste navegador. Tente um logotipo menor.'); return; }
  $('#dlg-empresa').close(); avisar('Dados da empresa salvos.');
  if (ORC.aba === 'relatorio' && ORC.atual) window.desenharRelatorio(ORC.atual);
});
