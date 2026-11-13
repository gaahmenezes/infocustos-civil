'use strict';
/* Importação de insumos, composições e orçamentos de outros sistemas (SIENGE, planilhas, PDF de relatório).
   1. escolhe o que importar e para qual base; 2. lê o arquivo; 3. confere a correspondência das colunas na prévia;
   4. confere o resumo (simulação) e importa. */

const IMP = { tipo: 'insumos', arq: null, folha: 0, cab: null, col: {}, base: '', novaBase: '', fonte: 'SIENGE', oficiais: ['SINAPI'],
  nome: '', bdi: 0, comBdi: false, simulado: null, enviando: false };

const PAPEIS = {
  insumos: [['codigo', 'Código'], ['descricao', 'Descrição', true], ['unidade', 'Unidade'], ['tipo', 'Tipo (material, mão de obra...)'], ['preco', 'Preço unitário'], ['data', 'Data do preço']],
  composicoes: [['comp_codigo', 'Código da composição (se vier em cada linha)'], ['comp_descricao', 'Descrição da composição (idem)'], ['comp_unidade', 'Unidade da composição (idem)'],
    ['codigo', 'Código do item'], ['descricao', 'Descrição', true], ['unidade', 'Unidade'], ['coeficiente', 'Coeficiente (índice)', true], ['preco', 'Preço unitário'], ['tipo', 'Tipo do insumo']],
  orcamento: [['item', 'Item (1, 1.1, 1.1.1)'], ['codigo', 'Código'], ['descricao', 'Descrição', true], ['unidade', 'Unidade'], ['quantidade', 'Quantidade', true],
    ['preco', 'Preço unitário'], ['total', 'Preço total']],
};
const TIPOS_IMP = {
  insumos: ['Insumos', 'Relatório de insumos do orçamento (SIENGE) ou qualquer lista com descrição, unidade e preço.'],
  composicoes: ['Composições', 'Composições analíticas: cada composição com os seus insumos e coeficientes. A composição pode vir como título com os itens abaixo, ou com o código dela repetido em cada linha.'],
  orcamento: ['Orçamento', 'Planilha orçamentária: itens com quantidade. Títulos sem quantidade viram etapas e subetapas. Importe antes os insumos e as composições na mesma base, para o orçamento usar as composições.'],
};

window.rotaImportar = function () { desenharImportar(); };

function folhaAtual() { return IMP.arq && IMP.arq.folhas[IMP.folha]; }
function nomeColuna(f, j) {
  const cab = f && IMP.cab != null ? f.linhas[IMP.cab] : null;
  const t = cab && cab[j] !== undefined && cab[j] !== '' ? String(cab[j]) : '';
  return `${String.fromCharCode(65 + (j % 26))}${j >= 26 ? Math.floor(j / 26) : ''}${t ? ` · ${t.slice(0, 28)}` : ''}`;
}

function desenharImportar() {
  const d = $('#detalhe'), bases = basesProprias(), f = folhaAtual();
  if (!IMP.base && !IMP.novaBase) IMP.base = String(PROP.base || (bases[0] && bases[0].id) || 1);
  const ncol = f ? Math.min(40, Math.max(...f.linhas.slice(0, 200).map((l) => l.length), 1)) : 0;
  const mapa = f ? PAPEIS[IMP.tipo].map(([p, rot, obrig]) => `<label class="imp-map"><span>${esc(rot)}${obrig ? ' <b class="imp-obrig">*</b>' : ''}</span>
      <select data-imp-col="${p}"><option value="">—</option>${Array.from({ length: ncol }, (_, j) => `<option value="${j}"${IMP.col[p] === j ? ' selected' : ''}>${esc(nomeColuna(f, j))}</option>`).join('')}</select></label>`).join('') : '';
  const dados = f ? f.linhas.slice(IMP.cab == null ? 0 : IMP.cab + 1).slice(0, 14) : [];
  const usados = new Map(Object.entries(IMP.col).filter(([, j]) => j != null).map(([p, j]) => [j, (PAPEIS[IMP.tipo].find((x) => x[0] === p) || [p, p])[1]]));
  const previa = f ? `<div class="tabela-rola imp-previa"><table class="planilha"><thead><tr>${Array.from({ length: ncol }, (_, j) => `<th class="${usados.has(j) ? 'imp-usada' : ''}">${esc(nomeColuna(f, j))}${usados.has(j) ? `<span>${esc(usados.get(j))}</span>` : ''}</th>`).join('')}</tr></thead>
      <tbody>${dados.map((l) => `<tr>${Array.from({ length: ncol }, (_, j) => `<td class="${usados.has(j) ? 'imp-usada' : ''}">${esc(l[j] === undefined ? '' : String(l[j]).slice(0, 80))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>` : '';
  const r = IMP.simulado;
  d.innerHTML = `<div class="pagina importar">
    <a class="botao voltar-lista" href="#/proprias">Bases próprias</a>
    <header class="pag-cab"><div><h1>Importar arquivo</h1>
      <p class="sub">Traga insumos, composições e orçamentos de outros sistemas, como o SIENGE. Aceita Excel (.xlsx), CSV e PDF. Os itens entram numa base própria e guardam o código de origem: importar de novo atualiza, sem duplicar.</p></div></header>
    <section class="imp-passo"><h2><span>1</span>O que você vai importar</h2>
      <div class="imp-tipos" role="radiogroup" aria-label="Tipo de importação">${Object.entries(TIPOS_IMP).map(([k, [n, t]]) => `<button type="button" role="radio" data-imp-tipo="${k}" aria-checked="${IMP.tipo === k}"><b>${n}</b><span>${esc(t)}</span></button>`).join('')}</div>
      <div class="imp-campos">
        <label>Base própria de destino<select id="imp-base">${bases.map((b) => `<option value="${b.id}"${String(b.id) === IMP.base && !IMP.novaBase ? ' selected' : ''}>${esc(b.nome)} (${b.composicoes} comp., ${b.insumos} ins.)</option>`).join('')}
          <option value="nova"${IMP.novaBase ? ' selected' : ''}>Nova base…</option></select></label>
        <label${IMP.novaBase ? '' : ' hidden'} id="imp-nova-wrap">Nome da nova base<input id="imp-nova" maxlength="40" value="${esc(IMP.novaBase)}" placeholder="Ex.: SIENGE Residencial Aurora"></label>
        <label>Fonte (vai junto com os itens)<input id="imp-fonte" maxlength="200" value="${esc(IMP.fonte)}" placeholder="Ex.: SIENGE, orçamento 2026-14"></label>
        ${IMP.tipo === 'orcamento' ? `<label>Nome do orçamento<input id="imp-nome" maxlength="200" value="${esc(IMP.nome)}" placeholder="Ex.: Residencial Aurora"></label>
          <label class="curto">BDI (%)<input id="imp-bdi" inputmode="decimal" value="${num2.format(IMP.bdi)}"></label>
          <label class="imp-check"><input type="checkbox" id="imp-com-bdi"${IMP.comBdi ? ' checked' : ''}> Os preços do arquivo já incluem esse BDI</label>` : ''}
        ${IMP.tipo !== 'insumos' ? `<fieldset class="imp-oficiais"><legend>Códigos que podem ser de base oficial</legend>${['SINAPI', 'ORSE', 'SICRO'].map((b) => `<label class="imp-check"><input type="checkbox" data-imp-oficial="${b}"${IMP.oficiais.includes(b) ? ' checked' : ''}> ${b}</label>`).join('')}
          <small>Um código que não estiver na base própria é procurado nessas bases, no mês mais recente delas.</small></fieldset>` : ''}
      </div></section>
    <section class="imp-passo"><h2><span>2</span>Arquivo</h2>
      <label class="imp-arquivo" id="imp-zona"><input type="file" id="imp-file" accept=".xlsx,.xlsm,.csv,.txt,.pdf">
        <b>${IMP.arq ? esc(IMP.arq.arquivo) : 'Escolha o arquivo ou arraste para cá'}</b>
        <span>${IMP.arq ? `${esc(IMP.arq.formato)} · ${IMP.arq.folhas.length} ${IMP.arq.folhas.length === 1 ? 'folha' : 'folhas'} · trocar arquivo` : 'Excel (.xlsx), CSV ou PDF, até 25 MB. No SIENGE, prefira exportar em Excel.'}</span></label>
      ${IMP.arq && IMP.arq.aviso ? `<p class="aviso-fonte" role="note">${esc(IMP.arq.aviso)}</p>` : ''}</section>
    ${f ? `<section class="imp-passo"><h2><span>3</span>Colunas</h2>
      <div class="imp-campos">
        ${IMP.arq.folhas.length > 1 ? `<label>Folha<select id="imp-folha">${IMP.arq.folhas.map((x, k) => `<option value="${k}"${k === IMP.folha ? ' selected' : ''}>${esc(x.nome)} (${x.linhas.length} linhas)</option>`).join('')}</select></label>` : ''}
        <label>Linha do cabeçalho<select id="imp-cab"><option value="">Sem cabeçalho</option>${f.linhas.slice(0, 60).map((l, k) => `<option value="${k}"${IMP.cab === k ? ' selected' : ''}>${k + 1}: ${esc(l.filter((v) => v !== '').slice(0, 4).join(' | ').slice(0, 70))}</option>`).join('')}</select></label>
      </div>
      <p class="sub">As colunas foram reconhecidas pelos títulos. Confira e corrija o que estiver trocado; <b>*</b> é obrigatória.</p>
      <div class="imp-mapa">${mapa}</div>
      ${previa}</section>
    <section class="imp-passo"><h2><span>4</span>Conferir e importar</h2>
      <div class="acoes"><button type="button" class="botao" id="imp-simular"${IMP.enviando ? ' disabled' : ''}>Conferir sem gravar</button>
        <button type="button" class="botao primario" id="imp-ir"${IMP.enviando ? ' disabled' : ''}>Importar</button></div>
      <div id="imp-resumo" aria-live="polite">${r ? resumoImportacao(r) : ''}</div></section>` : ''}
  </div>`;
  ligarImportar();
}

function resumoImportacao(r) {
  const n = (v, um, varios) => `<b>${(v || 0).toLocaleString('pt-BR')}</b> ${v === 1 ? um : varios}`;
  const base = r.base_id ? `<a href="#/proprias" data-ir-base="${r.base_id}">${esc(r.base)}</a>` : `<b>${esc(r.base)}</b> (nova)`;
  let corpo = '';
  if (IMP.tipo === 'insumos') corpo = `<li>${n(r.novos, 'insumo novo', 'insumos novos')} e ${n(r.atualizados, 'atualizado', 'atualizados')} na base ${base}</li>
    ${r.codigos_com_variacoes ? `<li>${n(r.variacoes, 'linha', 'linhas')} com o mesmo código e detalhe diferente (${n(r.codigos_com_variacoes, 'código', 'códigos')}): cada variação entra como um insumo</li>` : ''}
    ${r.sem_preco ? `<li>${n(r.sem_preco, 'insumo sem preço', 'insumos sem preço')} (coluna de preço vazia ou não indicada)</li>` : ''}
    ${r.ignoradas && r.ignoradas.length ? `<li>Linhas sem descrição ignoradas: ${r.ignoradas.slice(0, 12).join(', ')}${r.ignoradas.length > 12 ? '…' : ''}</li>` : ''}`;
  if (IMP.tipo === 'composicoes') corpo = `<li>${n(r.composicoes_novas, 'composição nova', 'composições novas')} e ${n(r.composicoes_atualizadas, 'atualizada', 'atualizadas')} na base ${base}, com ${n(r.itens, 'item', 'itens')}</li>
    <li>${n(r.insumos_criados, 'insumo criado', 'insumos criados')} a partir das linhas (códigos que a base ainda não tinha)${r.itens_de_base_oficial ? ` · ${n(r.itens_de_base_oficial, 'item ligado', 'itens ligados')} a base oficial` : ''}</li>
    ${r.vazias && r.vazias.length ? `<li class="imp-alerta">Sem itens: ${esc(r.vazias.slice(0, 8).join(', '))}${r.vazias.length > 8 ? '…' : ''}. Confira a coluna do coeficiente.</li>` : ''}
    ${r.conferidas ? `<li>${r.n_diferentes ? `<span class="imp-alerta">${n(r.n_diferentes, 'composição com custo diferente', 'composições com custo diferente')} do arquivo</span> (de ${r.conferidas} conferidas)` : `Custo das ${r.conferidas} composições conferido com o arquivo: <b>igual</b>`}</li>` : ''}
    ${(r.diferentes || []).slice(0, 8).map((x) => `<li class="imp-dif">${codLink('servico', 'PROPRIA', x.codigo)} ${esc(x.codigo_origem)} · arquivo ${brl.format(x.arquivo)} · aplicativo ${brl.format(x.calculado)}</li>`).join('')}`;
  if (IMP.tipo === 'orcamento') {
    const o = r.origem_dos_itens || {};
    corpo = `<li>${n(r.etapas, 'etapa', 'etapas')}, ${n(r.subetapas, 'subetapa', 'subetapas')} e ${n(r.itens, 'item', 'itens')}</li>
      <li>Itens ligados a ${n(o.composicao_da_base, 'composição', 'composições')} e ${n(o.insumo_da_base, 'insumo', 'insumos')} da base ${base}${o.base_oficial ? `, ${n(o.base_oficial, 'item', 'itens')} de base oficial` : ''}</li>
      ${o.criado_com_preco_do_arquivo ? `<li class="imp-alerta">${n(o.criado_com_preco_do_arquivo, 'item sem composição na base virou insumo', 'itens sem composição na base viraram insumos')} com o preço do arquivo</li>` : ''}
      ${r.orcamento_id ? `<li>Total no aplicativo <b>${brl.format(r.total_aplicativo)}</b> · no arquivo <b>${brl.format(r.total_arquivo_com_bdi)}</b>${r.total_arquivo_com_bdi ? ` (diferença de ${brl.format(r.total_aplicativo - r.total_arquivo_com_bdi)})` : ''}</li>
        ${r.n_precos_diferentes ? `<li class="imp-alerta">${n(r.n_precos_diferentes, 'item com preço unitário diferente', 'itens com preço unitário diferente')} do arquivo</li>` : ''}
        ${(r.precos_diferentes || []).slice(0, 8).map((x) => `<li class="imp-dif">${esc(x.codigo_origem || '—')} ${esc(x.descricao.slice(0, 60))} · arquivo ${brl.format(x.arquivo)} · aplicativo ${brl.format(x.aplicativo)}</li>`).join('')}` : `<li>Total do arquivo, sem BDI: <b>${brl.format(r.total_arquivo || 0)}</b></li>`}`;
  }
  return `<div class="imp-resultado${r.simulado ? '' : ' feito'}"><b>${r.simulado ? 'Conferência (nada foi gravado)' : `${VISTO}Importação concluída`}</b><ul>${corpo}</ul>
    ${!r.simulado && r.orcamento_id ? `<a class="botao primario" href="${rotaOrc(r.orcamento_id)}">Abrir o orçamento</a>` : ''}
    ${!r.simulado && !r.orcamento_id ? `<a class="botao" href="#/proprias" data-ir-base="${r.base_id}">Ver a base ${esc(r.base)}</a>` : ''}</div>`;
}

function lerCampos() {
  const v = (id) => { const e = $(id); return e ? e.value : ''; };
  IMP.fonte = v('#imp-fonte').trim();
  if ($('#imp-nome')) IMP.nome = v('#imp-nome').trim();
  if ($('#imp-bdi')) { const b = lerNum(v('#imp-bdi')); IMP.bdi = b >= 0 && b <= 100 ? b : 0; }
  if ($('#imp-com-bdi')) IMP.comBdi = $('#imp-com-bdi').checked;
  if ($('#imp-nova')) IMP.novaBase = $('#imp-base').value === 'nova' ? v('#imp-nova').trim() : '';
}

async function lerArquivo(arquivo) {
  if (!arquivo) return;
  lerCampos();
  const z = $('#imp-zona'); if (z) z.classList.add('lendo');
  try {
    const r = await fetch('/api/importar/ler', { method: 'POST', body: arquivo, headers: { 'X-Nome-Arquivo': encodeURIComponent(arquivo.name) } });
    if (r.status === 401) { sessaoEncerrada(); return; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.detail || `Erro ${r.status}`);
    IMP.arq = j; IMP.folha = 0; IMP.simulado = null; aplicarPalpite();
    if (IMP.tipo === 'orcamento' && !IMP.nome) IMP.nome = arquivo.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
    desenharImportar();
  } catch (e) { avisar(esc(e.message), 7000); if (z) z.classList.remove('lendo'); }
}
function aplicarPalpite() {
  const f = folhaAtual(); if (!f) return;
  IMP.cab = f.cabecalho; IMP.col = {};
  const ok = new Set(PAPEIS[IMP.tipo].map((p) => p[0]));
  for (const [p, j] of Object.entries(f.colunas || {})) if (ok.has(p)) IMP.col[p] = j;
  // no orçamento, "quantidade" é a quantidade do item; nas composições, quem faz esse papel é o coeficiente
  if (IMP.tipo === 'composicoes' && IMP.col.coeficiente == null && f.colunas.quantidade != null) IMP.col.coeficiente = f.colunas.quantidade;
  // código/descrição de composição só valem se forem colunas separadas das do item
  if (IMP.tipo === 'composicoes') for (const [p, q] of [['comp_codigo', 'codigo'], ['comp_descricao', 'descricao']]) if (IMP.col[p] != null && IMP.col[p] === IMP.col[q]) delete IMP.col[p];
}

async function enviarImportacao(simular) {
  lerCampos();
  const f = folhaAtual(); if (!f) return;
  const falta = PAPEIS[IMP.tipo].filter(([p, , obrig]) => obrig && IMP.col[p] == null).map(([, rot]) => rot);
  if (falta.length) { avisar(`Indique a coluna: ${esc(falta.join(', '))}.`); return; }
  if ($('#imp-base').value === 'nova' && !IMP.novaBase) { avisar('Dê um nome à nova base.'); $('#imp-nova').focus(); return; }
  if (IMP.tipo === 'orcamento' && !IMP.nome) { avisar('Dê um nome ao orçamento.'); $('#imp-nome').focus(); return; }
  const corpo = { linhas: f.linhas, cabecalho: IMP.cab, colunas: IMP.col, fonte: IMP.fonte, oficiais: IMP.tipo === 'insumos' ? [] : IMP.oficiais, simular,
    data_preco: new Date().toISOString().slice(0, 10) };
  if (IMP.novaBase) corpo.nova_base = IMP.novaBase; else corpo.base_id = Number($('#imp-base').value);
  if (IMP.tipo === 'orcamento') Object.assign(corpo, { nome: IMP.nome, bdi: IMP.bdi, precos_com_bdi: IMP.comBdi, referencia: estado.meses.ORSE || undefined });
  IMP.enviando = true; $('#imp-simular').disabled = true; $('#imp-ir').disabled = true;
  $('#imp-resumo').innerHTML = `<p class="carregando">${simular ? 'Conferindo' : 'Importando'} ${f.linhas.length.toLocaleString('pt-BR')} linhas…</p>`;
  try {
    const r = await req(`/api/importar/${IMP.tipo}`, 'POST', corpo);
    IMP.simulado = r;
    if (!simular) { IMP.novaBase = ''; IMP.base = String(r.base_id); lembrarBase(r.base_id); await recarregarBases(); MEMORIA.clear(); }
  } catch (e) { IMP.simulado = null; avisar(esc(e.message), 8000); }
  IMP.enviando = false; desenharImportar();
  const res = $('#imp-resumo'); if (res) res.scrollIntoView({ block: 'nearest', behavior: semMovimento() ? 'auto' : 'smooth' });
}

function ligarImportar() {
  const pg = $('.importar'); if (!pg) return;
  pg.addEventListener('click', (e) => {
    const t = e.target.closest('[data-imp-tipo]');
    if (t) { lerCampos(); IMP.tipo = t.dataset.impTipo; IMP.simulado = null; aplicarPalpite(); desenharImportar(); return; }
    if (e.target.id === 'imp-simular') enviarImportacao(true);
    if (e.target.id === 'imp-ir') enviarImportacao(false);
    const ib = e.target.closest('[data-ir-base]'); if (ib) lembrarBase(Number(ib.dataset.irBase));
  });
  pg.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'imp-file') { lerArquivo(t.files[0]); return; }
    if (t.id === 'imp-base') { IMP.base = t.value === 'nova' ? IMP.base : t.value; $('#imp-nova-wrap').hidden = t.value !== 'nova'; if (t.value === 'nova') { $('#imp-nova').focus(); } else IMP.novaBase = ''; IMP.simulado = null; return; }
    if (t.id === 'imp-folha') { IMP.folha = Number(t.value); IMP.simulado = null; aplicarPalpite(); desenharImportar(); return; }
    if (t.id === 'imp-cab') { lerCampos(); IMP.cab = t.value === '' ? null : Number(t.value); IMP.simulado = null; desenharImportar(); return; }
    if (t.dataset.impCol) { lerCampos(); if (t.value === '') delete IMP.col[t.dataset.impCol]; else IMP.col[t.dataset.impCol] = Number(t.value); IMP.simulado = null; desenharImportar(); return; }
    if (t.dataset.impOficial) { IMP.oficiais = [...pg.querySelectorAll('[data-imp-oficial]:checked')].map((x) => x.dataset.impOficial); IMP.simulado = null; return; }
    lerCampos(); IMP.simulado = null;
  });
  const z = $('#imp-zona');
  z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('sobre'); });
  z.addEventListener('dragleave', () => z.classList.remove('sobre'));
  z.addEventListener('drop', (e) => { e.preventDefault(); z.classList.remove('sobre'); lerArquivo(e.dataTransfer.files[0]); });
}
