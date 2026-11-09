'use strict';
/* Orçamentos: lista, planilha com etapas e itens, BDI, curva ABC e diálogo "Adicionar ao orçamento". */

const ORC = { atual: null, aba: 'planilha', ultimo: null };
try { ORC.ultimo = Number(localStorage.getItem('orc-ultimo')) || null; } catch (_) { /* sem storage */ }
const lembrar = (id) => { ORC.ultimo = id; try { localStorage.setItem('orc-ultimo', id); } catch (_) { /* ok */ } };

async function req(url, metodo = 'GET', corpo) {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : {}, body: corpo ? JSON.stringify(corpo) : undefined });
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const d = j.detail;
    throw new Error(Array.isArray(d) ? 'Confira os campos preenchidos.' : (d || `Erro ${r.status}`));
  }
  return j;
}

function avisar(html, ms = 4000) {
  const a = $('#aviso'); a.innerHTML = html; a.hidden = false;
  clearTimeout(avisar.t); avisar.t = setTimeout(() => { a.hidden = true; }, ms);
}

const qtdFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });
const lerNum = (s) => { const v = Number(String(s).trim().replace(/\./g, '').replace(',', '.')); return Number.isFinite(v) ? v : NaN; };
const dataFmt = (iso) => iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

// ---------- rotas ----------
window.rotaOrcamento = async function () {
  const m = location.hash.match(/^#\/orcamento\/(\d+)(?:\/(planilha|abc-servicos|abc-insumos))?/);
  const d = $('#detalhe');
  try {
    if (m) { ORC.aba = m[2] || 'planilha'; await abrirOrcamento(Number(m[1])); }
    else await listarOrcamentos();
  } catch (e) {
    d.innerHTML = `<div class="erro"><b>Não foi possível abrir.</b><br>${esc(e.message)} <a href="#/orcamentos">Ver orçamentos</a></div>`;
  }
};

async function listarOrcamentos() {
  const lista = await req('/api/orcamentos');
  const linhas = lista.map((o) => `<tr>
      <td><a href="#/orcamento/${o.id}"><b>${esc(o.nome)}</b></a><span class="sub-linha">${esc([o.cliente, o.local].filter(Boolean).join(' · '))}</span></td>
      <td>${esc(nomeRef(o.referencia))}${o.desatualizado ? ' <span class="ref-item">desatualizado</span>' : ''}</td>
      <td class="num">${o.qtd_itens}</td><td class="num">${num2.format(o.bdi)}%</td>
      <td class="num"><b>${brl.format(o.total)}</b></td><td class="num">${dataFmt(o.atualizado_em)}</td></tr>`).join('');
  $('#detalhe').innerHTML = `<article class="ficha orc">
    <div class="orc-topo"><h2>Orçamentos</h2></div>
    <form class="novo-orc" id="form-novo">
      <label>Nome<input name="nome" required maxlength="200" placeholder="Ex.: Reforma da Escola Estadual Rio Branco"></label>
      <label>Cliente<input name="cliente" maxlength="200" placeholder="Opcional"></label>
      <label>Local<input name="local" maxlength="200" placeholder="Ex.: Aracaju/SE"></label>
      <label class="curto">BDI (%)<input name="bdi" inputmode="decimal" value="25,00" required></label>
      <button class="botao primario" type="submit">Criar orçamento</button>
    </form>
    ${lista.length ? `<table class="uso lista-orc"><thead><tr><th>Orçamento</th><th>Data-base</th><th class="num">Itens</th><th class="num">BDI</th><th class="num">Total</th><th class="num">Alterado</th></tr></thead><tbody>${linhas}</tbody></table>`
      : '<p class="sub" style="margin-top:24px">Nenhum orçamento ainda. Preencha o nome acima para criar o primeiro.</p>'}
  </article>`;
  $('#form-novo').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target); const bdi = lerNum(f.get('bdi'));
    if (!(bdi >= 0 && bdi <= 100)) { avisar('O BDI precisa ficar entre 0 e 100%.'); return; }
    try {
      const o = await req('/api/orcamentos', 'POST', { nome: f.get('nome'), cliente: f.get('cliente'), local: f.get('local'), bdi });
      lembrar(o.id); location.hash = `#/orcamento/${o.id}`;
    } catch (err) { avisar(esc(err.message)); }
  });
}

// ---------- orçamento ----------
async function abrirOrcamento(id, dados) {
  const o = dados || await req(`/api/orcamentos/${id}`);
  ORC.atual = o; lembrar(o.id);
  const abas = [['planilha', 'Planilha'], ['abc-servicos', 'Curva ABC de serviços'], ['abc-insumos', 'Curva ABC de insumos']];
  $('#detalhe').innerHTML = `<article class="ficha orc">
    <a class="link-acao" href="#/orcamentos">Todos os orçamentos</a>
    <div class="orc-cab">
      <div class="orc-ident">
        <input class="orc-nome" id="orc-nome" value="${esc(o.nome)}" aria-label="Nome do orçamento" maxlength="200">
        <div class="orc-campos">
          <label>Cliente<input id="orc-cliente" value="${esc(o.cliente)}" placeholder="—"></label>
          <label>Local<input id="orc-local" value="${esc(o.local)}" placeholder="—"></label>
          <label class="curto">BDI (%)<input id="orc-bdi" inputmode="decimal" value="${num2.format(o.bdi)}"></label>
          <span class="orc-ref">Data-base ${esc((o.referencia_descricao || o.referencia).replace(/-1$/, ''))}</span>
        </div>
      </div>
      <div class="orc-totais" id="orc-totais"></div>
    </div>
    ${o.desatualizado ? `<div class="desatualizado" id="orc-desatualizado">
      <p><b>Há preços de ${esc(o.referencias_itens.filter((r) => r < o.referencia_atual.id).map((r) => nomeRef(r)).join(', ') || nomeRef(o.referencia))} neste orçamento.</b>
        A referência atual é ${esc(o.referencia_atual.descricao.replace(/-1$/, ''))}.</p>
      <div class="acoes"><button type="button" class="botao" id="orc-ver-impacto">Ver o impacto da atualização</button></div>
      <div class="impacto" id="orc-impacto" hidden></div>
    </div>` : ''}
    <div class="orc-barra">
      <nav class="abas-orc" aria-label="Visões do orçamento">${abas.map(([k, n]) => `<a href="#/orcamento/${o.id}/${k}" aria-current="${ORC.aba === k}">${n}</a>`).join('')}</nav>
      <div class="acoes">
        <a class="botao primario" href="/api/orcamentos/${o.id}/exportar.xlsx">Exportar Excel</a>
        <button type="button" class="botao" id="orc-duplicar">Duplicar</button>
        <button type="button" class="botao perigo" id="orc-excluir">Excluir</button>
      </div>
    </div>
    <div id="orc-corpo"></div>
  </article>`;
  desenharTotais(o);
  ligarCabecalho(o);
  if (o.desatualizado) ligarAtualizacao(o);
  if (ORC.aba === 'planilha') desenharPlanilha(o);
  else await desenharABC(o, ORC.aba === 'abc-servicos' ? 'servicos' : 'insumos');
}

function desenharTotais(o) {
  $('#orc-totais').innerHTML = `
    <div>Custo direto<b>${brl.format(o.custo_total)}</b></div>
    <div>BDI de ${num2.format(o.bdi)}%<b>${brl.format(o.valor_bdi)}</b></div>
    <div class="total">Total<b>${brl.format(o.total)}</b></div>`;
}

function ligarCabecalho(o) {
  const salvar = async (campo, valor) => {
    try { const n = await req(`/api/orcamentos/${o.id}`, 'PATCH', { [campo]: valor }); ORC.atual = n; return n; } catch (e) { avisar(esc(e.message)); return null; }
  };
  $('#orc-nome').addEventListener('change', (e) => { if (e.target.value.trim()) salvar('nome', e.target.value.trim()); });
  $('#orc-cliente').addEventListener('change', (e) => salvar('cliente', e.target.value));
  $('#orc-local').addEventListener('change', (e) => salvar('local', e.target.value));
  $('#orc-bdi').addEventListener('change', async (e) => {
    const v = lerNum(e.target.value);
    if (!(v >= 0 && v <= 100)) { avisar('O BDI precisa ficar entre 0 e 100%.'); e.target.value = num2.format(ORC.atual.bdi); return; }
    const n = await salvar('bdi', v); if (n) { e.target.value = num2.format(n.bdi); abrirOrcamento(n.id, n); avisar(`BDI alterado para ${num2.format(n.bdi)}%. Preços recalculados.`); }
  });
  $('#orc-duplicar').addEventListener('click', async () => {
    const n = await req(`/api/orcamentos/${o.id}/duplicar`, 'POST'); location.hash = `#/orcamento/${n.id}`; avisar('Orçamento duplicado.');
  });
  $('#orc-excluir').addEventListener('click', async () => {
    if (!confirm(`Excluir o orçamento "${o.nome}"? Isso não pode ser desfeito.`)) return;
    await req(`/api/orcamentos/${o.id}`, 'DELETE'); location.hash = '#/orcamentos'; avisar('Orçamento excluído.');
  });
}

function desenharPlanilha(o) {
  const etapas = o.etapas.map((e, k) => `
    <tbody class="etapa" data-etapa="${e.id}">
      <tr class="etapa-cab">
        <td class="n">${e.numero}</td>
        <td colspan="5"><input class="etapa-titulo" value="${esc(e.titulo)}" aria-label="Título da etapa ${e.numero}" data-etapa="${e.id}"></td>
        <td class="num"><span class="peso-etapa">${pct.format(e.peso)}</span></td>
        <td class="num"><b>${brl.format(e.total)}</b></td>
        <td class="ctrl">
          <button type="button" class="mini" data-acao="etapa-cima" data-id="${e.id}" ${k === 0 ? 'disabled' : ''} aria-label="Subir etapa">↑</button>
          <button type="button" class="mini" data-acao="etapa-baixo" data-id="${e.id}" ${k === o.etapas.length - 1 ? 'disabled' : ''} aria-label="Descer etapa">↓</button>
          <button type="button" class="mini" data-acao="etapa-excluir" data-id="${e.id}" aria-label="Excluir etapa">✕</button>
        </td>
      </tr>
      ${e.itens.map((i, m) => `<tr class="item" data-item="${i.id}">
        <td class="n">${i.numero}</td>
        <td class="cod"><a href="#/${i.tipo === 'servico' ? 'composicao' : 'insumo'}/${esc(i.base)}/${esc(i.codigo)}">${esc(i.codigo)}</a>/${esc(i.base)}</td>
        <td class="desc">${esc(i.descricao)}${i.referencia && i.referencia < o.referencia_atual.id ? `<span class="ref-item" title="Preço da referência ${esc(nomeRef(i.referencia))}">${esc(nomeRef(i.referencia))}</span>` : ''}</td>
        <td>${esc(i.unidade)}</td>
        <td class="num"><input class="qtd" inputmode="decimal" value="${qtdFmt.format(i.quantidade)}" data-item="${i.id}" aria-label="Quantidade do item ${i.numero}"></td>
        <td class="num">${money(i.custo_unit)}</td>
        <td class="num">${money(i.preco_unit)}</td>
        <td class="num"><b>${money(i.total)}</b></td>
        <td class="ctrl">
          <button type="button" class="mini" data-acao="item-cima" data-id="${i.id}" ${m === 0 ? 'disabled' : ''} aria-label="Subir item">↑</button>
          <button type="button" class="mini" data-acao="item-baixo" data-id="${i.id}" ${m === e.itens.length - 1 ? 'disabled' : ''} aria-label="Descer item">↓</button>
          <button type="button" class="mini" data-acao="item-excluir" data-id="${i.id}" aria-label="Excluir item ${i.numero}">✕</button>
        </td></tr>`).join('')}
      <tr class="add-linha"><td></td><td colspan="8">
        <div class="add-busca">
          <input class="add-q" placeholder="Adicionar serviço ou insumo à etapa ${e.numero}: digite descrição ou código" data-etapa="${e.id}" aria-label="Adicionar item à etapa ${e.numero}" autocomplete="off">
          <ul class="add-res" hidden></ul>
        </div>
      </td></tr>
    </tbody>`).join('');
  $('#orc-corpo').innerHTML = `
    <table class="planilha">
      <thead><tr><th>Item</th><th>Código</th><th>Descrição</th><th>Un.</th><th class="num">Quant.</th><th class="num">Custo unit.</th><th class="num">Preço c/ BDI</th><th class="num">Total</th><th></th></tr></thead>
      ${etapas}
    </table>
    <form class="nova-etapa" id="form-etapa">
      <input id="nova-etapa" placeholder="Nome da nova etapa — ex.: Fundações" maxlength="200" aria-label="Nome da nova etapa">
      <button class="botao" type="submit">Adicionar etapa</button>
    </form>
    <p class="fonte">Preço com BDI e total por item arredondados em 2 casas. Custo unitário congelado na data-base em que o item entrou.</p>`;
  ligarPlanilha(o);
}

function ligarPlanilha(o) {
  const corpo = $('#orc-corpo');
  const atualizar = (n) => { ORC.atual = n; const foco = document.activeElement && document.activeElement.dataset; abrirOrcamento(n.id, n).then(() => restaurarFoco(foco)); };
  corpo.addEventListener('change', async (e) => {
    const t = e.target;
    try {
      if (t.classList.contains('qtd')) {
        const v = lerNum(t.value);
        if (!(v >= 0)) { avisar('Digite uma quantidade válida, como 12,5.'); t.value = ''; return; }
        atualizar(await req(`/api/itens/${t.dataset.item}`, 'PATCH', { quantidade: v }));
      } else if (t.classList.contains('etapa-titulo') && t.value.trim()) {
        ORC.atual = await req(`/api/etapas/${t.dataset.etapa}`, 'PATCH', { titulo: t.value.trim() });
      }
    } catch (err) { avisar(esc(err.message)); }
  });
  corpo.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target.classList.contains('qtd') || e.target.classList.contains('etapa-titulo'))) { e.preventDefault(); e.target.blur(); }
  });
  corpo.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-acao]'); if (!b) return;
    const id = b.dataset.id;
    try {
      const a = b.dataset.acao;
      if (a === 'etapa-cima' || a === 'etapa-baixo') atualizar(await req(`/api/etapas/${id}/mover?direcao=${a.endsWith('cima') ? 'cima' : 'baixo'}`, 'POST'));
      if (a === 'item-cima' || a === 'item-baixo') atualizar(await req(`/api/itens/${id}/mover?direcao=${a.endsWith('cima') ? 'cima' : 'baixo'}`, 'POST'));
      if (a === 'item-excluir') atualizar(await req(`/api/itens/${id}`, 'DELETE'));
      if (a === 'etapa-excluir') {
        const et = o.etapas.find((x) => String(x.id) === id);
        if (et.itens.length && !confirm(`Excluir a etapa "${et.titulo}" e seus ${et.itens.length} itens?`)) return;
        atualizar(await req(`/api/etapas/${id}`, 'DELETE'));
      }
    } catch (err) { avisar(esc(err.message)); }
  });
  $('#form-etapa').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = $('#nova-etapa').value.trim(); if (!v) { $('#nova-etapa').focus(); return; }
    atualizar(await req(`/api/orcamentos/${o.id}/etapas`, 'POST', { titulo: v }));
  });
  corpo.querySelectorAll('.add-q').forEach(ligarBuscaInline);
}

function restaurarFoco(foco) {
  if (!foco) return;
  let el = null;
  if (foco.item) el = document.querySelector(`.qtd[data-item="${foco.item}"]`);
  if (el) { el.focus(); el.select(); }
}

function ligarBuscaInline(inp) {
  const ul = inp.nextElementSibling; let t = 0, seqLocal = 0, itens = [], sel = -1;
  const fechar = () => { ul.hidden = true; sel = -1; };
  const marcar = () => ul.querySelectorAll('li').forEach((li, k) => li.setAttribute('aria-selected', String(k === sel)));
  inp.addEventListener('input', () => {
    clearTimeout(t);
    const q = inp.value.trim(); if (q.length < 2) { fechar(); return; }
    t = setTimeout(async () => {
      const meu = ++seqLocal;
      const r = await req(`/api/busca?${new URLSearchParams({ q, limite: 8 })}`);
      if (meu !== seqLocal) return;
      itens = r.itens.filter((x) => x.preco != null);
      ul.innerHTML = itens.length ? itens.map((x, k) => `<li data-k="${k}"><span class="res-cod">${esc(x.codigo)}/${esc(x.base)} · ${x.tipo === 'servico' ? 'serviço' : 'insumo'}</span>
          <span>${trecho(x)}</span><span class="add-preco">${brl.format(x.preco)}/${esc(x.unidade)}</span></li>`).join('')
        : '<li class="nada">Nada encontrado com preço nesta base.</li>';
      ul.hidden = false; sel = -1;
    }, 160);
  });
  inp.addEventListener('keydown', (e) => {
    if (ul.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, itens.length - 1); marcar(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); marcar(); }
    if (e.key === 'Enter' && itens.length) { e.preventDefault(); escolher(itens[Math.max(sel, 0)]); }
    if (e.key === 'Escape') fechar();
  });
  inp.addEventListener('blur', () => setTimeout(fechar, 200));
  ul.addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-k]'); if (li) { e.preventDefault(); escolher(itens[Number(li.dataset.k)]); } });
  async function escolher(x) {
    try {
      const n = await req(`/api/orcamentos/${ORC.atual.id}/itens`, 'POST', { etapa_id: Number(inp.dataset.etapa), tipo: x.tipo, base: x.base, codigo: x.codigo, quantidade: 1 });
      await abrirOrcamento(n.id, n);
      const q = document.querySelector(`.qtd[data-item="${n.item_criado}"]`); if (q) { q.focus(); q.select(); }
      avisar(`${esc(x.codigo)}/${esc(x.base)} adicionado. Digite a quantidade.`);
    } catch (err) { avisar(esc(err.message)); }
  }
}

// ---------- curva ABC ----------
async function desenharABC(o, tipo) {
  const corpo = $('#orc-corpo');
  if (!o.qtd_itens) { corpo.innerHTML = '<p class="sub" style="margin-top:20px">A curva ABC aparece quando o orçamento tiver itens. Adicione serviços na planilha.</p>'; return; }
  corpo.innerHTML = '<p class="carregando">Calculando a curva ABC…</p>';
  const r = await req(`/api/orcamentos/${o.id}/abc?tipo=${tipo}`);
  const chave = tipo === 'servicos' ? 'total' : 'custo_total';
  const cores = { A: 'var(--c-equip)', B: 'var(--c-mat)', C: 'var(--linha-forte)' };
  const blocos = ['A', 'B', 'C'].map((cl) => `<div style="--cor:${cores[cl]}">Classe ${cl}<b>${brl.format(r.resumo[cl].valor)}</b>
      <span class="pct">${r.resumo[cl].itens} ${r.resumo[cl].itens === 1 ? 'item' : 'itens'} · ${pct.format(r.total ? r.resumo[cl].valor / r.total : 0)} do valor</span></div>`).join('');
  const barra = ['A', 'B', 'C'].filter((cl) => r.resumo[cl].valor > 0).map((cl) => `<span style="flex-grow:${r.resumo[cl].valor};background:${cores[cl]}"></span>`).join('');
  const linhas = r.linhas.map((l) => `<tr class="cl-${l.classe}">
      <td class="n">${l.posicao}</td>
      <td class="cod"><a href="#/${tipo === 'servicos' && l.tipo === 'servico' ? 'composicao' : 'insumo'}/${esc(l.base)}/${esc(l.codigo)}">${esc(l.codigo)}</a>/${esc(l.base)}</td>
      <td class="desc">${esc(l.descricao)}</td><td>${esc(l.unidade)}</td>
      <td class="num">${qtdFmt.format(l.quantidade)}</td>
      <td class="num">${money(tipo === 'servicos' ? l.preco_unit : l.custo_unit)}</td>
      <td class="num"><b>${money(l[chave])}</b></td>
      <td class="num">${pct.format(l.percentual)}</td>
      <td class="num">${pct.format(l.acumulado)}</td>
      <td class="classe"><span>${l.classe}</span></td></tr>`).join('');
  const dif = tipo === 'insumos' ? r.total - r.custo_direto : 0;
  corpo.innerHTML = `
    <p class="sub" style="margin-top:18px">${tipo === 'servicos'
      ? 'Serviços e insumos do orçamento ordenados pelo valor com BDI. O mesmo código em etapas diferentes aparece somado.'
      : 'Cada composição foi desmontada até o insumo, incluindo os serviços auxiliares, e as quantidades foram multiplicadas pelas do orçamento. Valores de custo direto, sem BDI.'}
      Classe A até 80% do valor acumulado, B até 95%, C o restante.</p>
    <div class="custo"><div class="barra">${barra}</div><div class="legenda legenda-3">${blocos}</div></div>
    ${tipo === 'insumos' ? `<p class="fonte">Soma dos insumos: ${brl.format(r.total)} · custo direto do orçamento: ${brl.format(r.custo_direto)}${Math.abs(dif) >= 0.01 ? ` · diferença de ${brl.format(dif)} vem do arredondamento dos coeficientes e dos encargos de mensalistas publicados pela base` : ''}.</p>` : ''}
    <table class="planilha abc"><thead><tr><th>Pos.</th><th>Código</th><th>Descrição</th><th>Un.</th><th class="num">Quant.</th><th class="num">${tipo === 'servicos' ? 'Preço unit.' : 'Custo unit.'}</th><th class="num">Total</th><th class="num">%</th><th class="num">% acum.</th><th>Classe</th></tr></thead>
      <tbody>${linhas}</tbody></table>`;
}

// ---------- diálogo "Adicionar ao orçamento" ----------
const dlg = $('#dlg-adicionar');
let dlgItem = null, dlgOrcs = [];

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-adicionar]'); if (!b) return;
  dlgItem = { tipo: b.dataset.adicionar, base: b.dataset.base, codigo: b.dataset.cod, descricao: b.dataset.desc, unidade: b.dataset.un };
  $('#dlg-item').textContent = `${dlgItem.codigo}/${dlgItem.base} · ${dlgItem.descricao}`;
  $('#dlg-erro').textContent = ''; $('#dlg-qtd').value = '1';
  dlgOrcs = await req('/api/orcamentos');
  const sel = $('#dlg-orc');
  sel.innerHTML = dlgOrcs.map((o) => `<option value="${o.id}">${esc(o.nome)}</option>`).join('') + '<option value="novo">Novo orçamento…</option>';
  sel.value = dlgOrcs.some((o) => o.id === ORC.ultimo) ? String(ORC.ultimo) : (dlgOrcs[0] ? String(dlgOrcs[0].id) : 'novo');
  await trocarOrc();
  dlg.showModal(); $('#dlg-qtd').select();
});

async function trocarOrc() {
  const v = $('#dlg-orc').value; const novo = v === 'novo';
  $('#dlg-novo-wrap').hidden = !novo; $('#dlg-novo').required = novo;
  const et = $('#dlg-etapa');
  if (novo) { et.innerHTML = '<option value="">Serviços preliminares</option>'; return; }
  const o = await req(`/api/orcamentos/${v}`);
  et.innerHTML = o.etapas.map((e) => `<option value="${e.id}">${e.numero}. ${esc(e.titulo)}</option>`).join('');
  if (o.etapas.length) et.value = String(o.etapas[o.etapas.length - 1].id);
}
$('#dlg-orc').addEventListener('change', trocarOrc);
$('#dlg-cancelar').addEventListener('click', () => dlg.close());

$('#form-adicionar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const q = lerNum($('#dlg-qtd').value);
  if (!(q >= 0)) { $('#dlg-erro').textContent = 'Digite uma quantidade válida, como 12,5.'; return; }
  try {
    let oid = $('#dlg-orc').value, etapa = Number($('#dlg-etapa').value) || null;
    if (oid === 'novo') {
      const nome = $('#dlg-novo').value.trim(); if (!nome) { $('#dlg-erro').textContent = 'Dê um nome ao novo orçamento.'; return; }
      const o = await req('/api/orcamentos', 'POST', { nome, bdi: 25 }); oid = o.id; etapa = o.etapas[0].id;
    }
    const n = await req(`/api/orcamentos/${oid}/itens`, 'POST', { etapa_id: etapa, tipo: dlgItem.tipo, base: dlgItem.base, codigo: dlgItem.codigo, quantidade: q });
    lembrar(n.id); dlg.close();
    avisar(`Adicionado a <b>${esc(n.nome)}</b> · total ${brl.format(n.total)} · <a href="#/orcamento/${n.id}">Abrir orçamento</a>`, 6000);
  } catch (err) { $('#dlg-erro').textContent = err.message; }
});


// ---------- atualizar a data-base do orçamento ----------
function ligarAtualizacao(o) {
  const bt = $('#orc-ver-impacto'), caixa = $('#orc-impacto');
  bt.addEventListener('click', async () => {
    if (!caixa.hidden) { caixa.hidden = true; bt.textContent = 'Ver o impacto da atualização'; return; }
    bt.disabled = true; caixa.hidden = false; caixa.innerHTML = '<p class="carregando">Calculando…</p>';
    try {
      const r = await req(`/api/orcamentos/${o.id}/atualizacao`);
      const para = nomeRef(r.referencia);
      const linhas = r.itens.slice(0, 12).map((l) => `<tr><td class="n">${l.numero}</td>
          <td class="cod">${esc(l.codigo)}/${esc(l.base)}</td><td class="desc">${esc(l.descricao)}</td>
          <td class="num">${money(l.custo_unit_antes)}</td><td class="num"><b>${money(l.custo_unit_depois)}</b></td>
          <td class="num">${seloVariacao(l.custo_unit_depois, l.custo_unit_antes, 0)}</td>
          <td class="num">${money(l.total_depois - l.total_antes)}</td></tr>`).join('');
      const sem = r.sem_preco.map((x) => `<li><b>${x.numero}</b> ${esc(x.codigo)}/${esc(x.base)} · ${esc(x.descricao)} <span class="sub">(${esc(x.motivo)}; fica com o preço atual)</span></li>`).join('');
      caixa.innerHTML = `
        <div class="totais-imp">
          <div>Total hoje<b>${brl.format(r.total_antes)}</b></div>
          <div>Total em ${esc(para)}<b>${brl.format(r.total_depois)}</b></div>
          <div>Diferença<b>${brl.format(r.total_depois - r.total_antes)} ${r.variacao == null ? '' : seloVariacao(r.total_depois, r.total_antes, 0)}</b></div>
          <div>Itens com preço novo<b>${r.itens.length}</b></div>
        </div>
        ${r.itens.length ? `<table class="planilha"><thead><tr><th>Item</th><th>Código</th><th>Descrição</th><th class="num">Custo antes</th><th class="num">Custo em ${esc(para)}</th><th class="num">Variação</th><th class="num">Efeito no total</th></tr></thead><tbody>${linhas}</tbody></table>
          ${r.itens.length > 12 ? `<p class="fonte">Mostrando os 12 itens que mais mudam o total, de ${r.itens.length}.</p>` : ''}` : ''}
        ${sem ? `<p style="margin-top:12px"><b>${r.sem_preco.length} ${r.sem_preco.length === 1 ? 'item não pode ser atualizado' : 'itens não podem ser atualizados'}:</b></p><ul class="sem-preco">${sem}</ul>
          <p class="sub">Substitua esses itens por um serviço equivalente da referência atual, se for o caso.</p>` : ''}
        <div class="acoes" style="margin-top:12px">
          <button type="button" class="botao primario" id="orc-atualizar">Atualizar preços para ${esc(para)}</button>
          <button type="button" class="botao" id="orc-duplicar-atualizar">Duplicar e atualizar a cópia</button>
        </div>`;
      $('#orc-atualizar').addEventListener('click', async () => {
        const n = await req(`/api/orcamentos/${o.id}/atualizar`, 'POST');
        await abrirOrcamento(n.id, n);
        avisar(`Preços atualizados para ${esc(para)}: ${n.atualizacao.itens_atualizados} itens. Novo total ${brl.format(n.total)}.`, 6000);
      });
      $('#orc-duplicar-atualizar').addEventListener('click', async () => {
        const copia = await req(`/api/orcamentos/${o.id}/duplicar`, 'POST');
        const n = await req(`/api/orcamentos/${copia.id}/atualizar`, 'POST');
        await req(`/api/orcamentos/${n.id}`, 'PATCH', { nome: `${o.nome} (${para})` });
        location.hash = `#/orcamento/${n.id}`;
        avisar(`Cópia criada com preços de ${esc(para)}. O orçamento original não mudou.`, 6000);
      });
      bt.textContent = 'Fechar';
    } catch (e) { caixa.innerHTML = `<p class="erro">${esc(e.message)}</p>`; }
    bt.disabled = false;
  });
}
