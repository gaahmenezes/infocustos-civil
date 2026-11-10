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

// exclusões não perguntam: o aviso traz "Desfazer", que devolve o que saiu
let ultimoDesfazer = null;
function avisarDesfazer(texto, desfazer) {
  ultimoDesfazer = desfazer;
  avisar(`${texto} <button type="button" class="aviso-bt" data-desfazer>Desfazer</button>`, 9000);
}
document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-desfazer]') || !ultimoDesfazer) return;
  const d = ultimoDesfazer; ultimoDesfazer = null;
  try {
    const n = await req('/api/restaurar', 'POST', d);
    avisar(d.tipo === 'orcamento' ? 'Orçamento restaurado.' : d.tipo === 'etapa' ? 'Etapa restaurada.' : 'Item restaurado.');
    if (location.hash === rotaOrc(n.id) || location.hash.startsWith(rotaOrc(n.id, ''))) window.rotaOrcamento(); else location.hash = rotaOrc(n.id);
  } catch (err) { avisar(esc(err.message)); }
});

const qtdFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 });
const lerNum = (s) => { const v = Number(String(s).trim().replace(/\./g, '').replace(',', '.')); return Number.isFinite(v) ? v : NaN; };
const dataFmt = (iso) => iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

// ---------- rotas ----------
window.rotaOrcamento = async function () {
  const m = location.hash.match(/^#\/orcamento\/(\d+)(?:\/(planilha|abc-servicos|abc-insumos|relatorio))?/);
  const d = $('#detalhe');
  try {
    if (m) { ORC.aba = m[2] || 'planilha'; await abrirOrcamento(Number(m[1])); }
    else await listarOrcamentos();
  } catch (e) {
    d.innerHTML = `<div class="erro"><b>Não foi possível abrir.</b><br>${esc(e.message)} <a href="#/orcamentos">Ver orçamentos</a></div>`;
  }
};

const LISTA = { q: '', ordem: 'recentes', todos: [] };
const ORDENS = {
  recentes: ['Alterados por último', (a, b) => String(b.atualizado_em).localeCompare(String(a.atualizado_em))],
  nome: ['Nome (A a Z)', (a, b) => a.nome.localeCompare(b.nome, 'pt-BR')],
  total: ['Maior total', (a, b) => b.total - a.total],
};
function desenharCartoesOrc() {
  const termo = LISTA.q.trim().toLowerCase();
  const vis = LISTA.todos.filter((o) => !termo || [o.nome, o.cliente, o.local].join(' ').toLowerCase().includes(termo)).sort(ORDENS[LISTA.ordem][1]);
  const soma = vis.reduce((t, o) => t + o.total, 0);
  $('#orc-resumo').innerHTML = LISTA.todos.length
    ? `<b>${vis.length}</b> ${vis.length === 1 ? 'orçamento' : 'orçamentos'}${termo ? ` de ${LISTA.todos.length}` : ''} · <b>${brl.format(soma)}</b> no total, com BDI`
    : 'Monte a planilha da obra com os preços da ORSE e da SINAPI.';
  const ul = $('#orc-lista'); if (!ul) return;
  ul.innerHTML = vis.length ? vis.map((o) => `<li><a class="orc-cartao" href="${rotaOrc(o.id)}">
      <span class="orc-c-nome">${esc(o.nome)}</span>
      <span class="orc-c-sub">${esc([o.cliente, o.local].filter(Boolean).join(' · ') || 'Sem cliente e local')}</span>
      <span class="orc-c-total">${grana(o.total)}</span>
      <span class="orc-c-rot">total com BDI de ${num2.format(o.bdi)}%</span>
      <span class="res-div">${o.divisao ? barraDivisao(o.divisao) : '<span class="dom">Ainda sem itens</span>'}</span>
      <span class="orc-c-meta">${esc(nomeRef(o.referencia))} · ${o.qtd_itens} ${o.qtd_itens === 1 ? 'item' : 'itens'} · alterado em ${dataFmt(o.atualizado_em)}</span>
    </a></li>`).join('')
    : `<li class="orc-nada">${vazio('lupa', 'Nenhum orçamento com esse nome', 'Confira a grafia ou limpe o filtro.')}</li>`;
}

function abrirNovoOrcamento() {
  const d = $('#dlg-novo-orc'), f = $('#form-novo');
  f.reset(); $('#novo-orc-erro').textContent = '';
  f.elements.referencia.innerHTML = [...((estado.ref && estado.ref.referencias) || [])].reverse().map((r) =>
    `<option value="${esc(r.id)}"${r.id === estado.mes ? ' selected' : ''}>${esc(r.descricao.replace(/-1$/, ''))}</option>`).join('');
  d.showModal(); f.elements.nome.focus();
}
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-novo-orc]')) abrirNovoOrcamento();
  const f = e.target.closest('[data-fechar]'); if (f) f.closest('dialog').close();
});
$('#form-novo').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target); const bdi = lerNum(f.get('bdi'));
  if (!(bdi >= 0 && bdi <= 100)) { $('#novo-orc-erro').textContent = 'O BDI precisa ficar entre 0 e 100%.'; return; }
  try {
    const o = await req('/api/orcamentos', 'POST', { nome: f.get('nome'), cliente: f.get('cliente'), local: f.get('local'), bdi, referencia: f.get('referencia') || undefined });
    $('#dlg-novo-orc').close(); lembrar(o.id); location.hash = rotaOrc(o.id);
  } catch (err) { $('#novo-orc-erro').textContent = err.message; }
});

async function listarOrcamentos() {
  const semEsq = comEsqueleto($('#detalhe'), `<div class="pagina">${esqueletoCartoes(4)}</div>`);
  try { LISTA.todos = await req('/api/orcamentos'); } finally { semEsq(); }
  const tem = LISTA.todos.length > 0;
  $('#detalhe').innerHTML = `<div class="pagina orcamentos">
    <header class="pag-cab">
      <div><h1>Orçamentos</h1><p class="sub" id="orc-resumo"></p></div>
      <button type="button" class="botao primario" id="novo-orc" data-novo-orc>Novo orçamento</button>
    </header>
    ${tem ? `<div class="pag-barra">
        <input type="search" id="orc-q" class="cmp-q" placeholder="Filtrar por nome, cliente ou local" value="${esc(LISTA.q)}" aria-label="Filtrar orçamentos">
        <label class="ordem">Ordenar por <select id="orc-ordem">${Object.entries(ORDENS).map(([k, [n]]) => `<option value="${k}"${k === LISTA.ordem ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      </div>
      <ul class="orc-lista lista-orc" id="orc-lista"></ul>`
    : vazio('planilha', 'Nenhum orçamento ainda', 'Crie o primeiro e adicione composições e insumos direto da consulta.',
      '<button type="button" class="botao primario" data-novo-orc>Criar o primeiro orçamento</button>')}
  </div>`;
  desenharCartoesOrc();
  if (!tem) return;
  $('#orc-q').addEventListener('input', (e) => { LISTA.q = e.target.value; desenharCartoesOrc(); });
  $('#orc-ordem').addEventListener('change', (e) => { LISTA.ordem = e.target.value; desenharCartoesOrc(); });
}

// ---------- orçamento ----------
async function abrirOrcamento(id, dados) {
  const o = dados || await req(`/api/orcamentos/${id}`);
  if (!ORC.atual || ORC.atual.id !== o.id || !o.etapas.some((e) => e.id === ORC.filtro)) ORC.filtro = null;
  ORC.atual = o; lembrar(o.id);
  if (ORC.aba === 'relatorio') { await window.desenharRelatorio(o); return; }
  const abas = [['planilha', 'Planilha'], ['abc-servicos', 'Curva ABC de serviços'], ['abc-insumos', 'Curva ABC de insumos']];
  $('#detalhe').innerHTML = `<article class="ficha orc">
    <a class="voltar-lista" href="#/orcamentos"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 3 4.5 6l3 3" /></svg>Todos os orçamentos</a>
    <div class="orc-cab">
      <div class="orc-ident">
        <input class="orc-nome" id="orc-nome" value="${esc(o.nome)}" aria-label="Nome do orçamento" maxlength="200">
        <p class="orc-dados">${[o.cliente, o.local].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('')}<span>BDI de <b>${num2.format(o.bdi)}%</b></span><span>data-base <b>${esc(nomeRef(o.referencia))}</b></span>
          <button type="button" class="link-acao" id="orc-editar" aria-expanded="${!!ORC.editando}" aria-controls="orc-campos">${ORC.editando ? 'Fechar' : 'Editar dados'}</button></p>
        <div class="orc-campos" id="orc-campos"${ORC.editando ? '' : ' hidden'}>
          <label>Cliente<input id="orc-cliente" value="${esc(o.cliente)}" placeholder="—"></label>
          <label>Local<input id="orc-local" value="${esc(o.local)}" placeholder="—"></label>
          <label class="curto">BDI (%)<input id="orc-bdi" inputmode="decimal" value="${num2.format(o.bdi)}"></label>
          <label class="curto">Data-base<select id="orc-mes">${((estado.ref && estado.ref.referencias) || []).map((r) =>
            `<option value="${esc(r.id)}"${r.id === o.referencia ? ' selected' : ''}>${esc(r.descricao.replace(/-1$/, ''))}</option>`).join('')}</select></label>
        </div>
      </div>
      <div class="orc-totais" id="orc-totais"></div>
    </div>
    <div class="orc-fixa" aria-hidden="true"><div class="orc-fixa-barra"><b>${esc(o.nome)}</b>
      <span>Custo direto ${brl.format(o.custo_total)}</span><span>BDI ${brl.format(o.valor_bdi)}</span><strong>${brl.format(o.total)}</strong></div></div>
    <div class="mudar-mes" id="orc-mudar-mes" hidden></div>
    <div id="orc-painel"></div>
    <div class="orc-barra">
      <nav class="abas-orc" aria-label="Visões do orçamento">${abas.map(([k, n]) => `<a href="${rotaOrc(o.id, k)}" aria-current="${ORC.aba === k}">${n}</a>`).join('')}</nav>
      <div class="acoes">
        <a class="botao primario" href="${rotaOrc(o.id, 'relatorio')}">Relatório em PDF</a>
        ${menu('Mais', [`<a role="menuitem" href="/api/orcamentos/${o.id}/exportar.xlsx">Planilha do Excel (.xlsx)</a>`,
          '<button type="button" role="menuitem" id="orc-duplicar">Duplicar orçamento</button>',
          '<button type="button" role="menuitem" class="perigo" id="orc-excluir">Excluir orçamento</button>'])}
      </div>
    </div>
    <div id="orc-corpo"></div>
  </article>`;
  desenharTotais(o);
  window.desenharPainel(o);
  ligarCabecalho(o);
  ligarMudarMes(o);
  if (ORC.aba === 'planilha') desenharPlanilha(o);
  else await desenharABC(o, ORC.aba === 'abc-servicos' ? 'servicos' : 'insumos');
}

function desenharTotais(o) {
  $('#orc-totais').innerHTML = `
    <div>Custo direto<b>${grana(o.custo_total)}</b></div>
    <div>BDI de ${num2.format(o.bdi)}%<b>${grana(o.valor_bdi)}</b></div>
    <div class="total">Total<b>${grana(o.total)}</b></div>`;
  // quando o orçamento muda, os totais contam do valor antigo ao novo
  const ant = ORC.totais;
  if (ant && ant.id === o.id) [['custo_total', 0], ['valor_bdi', 1], ['total', 2]].forEach(([k, n]) => contar(document.querySelectorAll('#orc-totais .num-grande')[n], ant[k], o[k]));
  ORC.totais = { id: o.id, custo_total: o.custo_total, valor_bdi: o.valor_bdi, total: o.total };
}

function ligarCabecalho(o) {
  const salvar = async (campo, valor) => {
    try { const n = await req(`/api/orcamentos/${o.id}`, 'PATCH', { [campo]: valor }); ORC.atual = n; return n; } catch (e) { avisar(esc(e.message)); return null; }
  };
  $('#orc-editar').addEventListener('click', () => {
    ORC.editando = !ORC.editando; $('#orc-campos').hidden = !ORC.editando;
    $('#orc-editar').setAttribute('aria-expanded', String(ORC.editando)); $('#orc-editar').textContent = ORC.editando ? 'Fechar' : 'Editar dados';
    if (ORC.editando) $('#orc-cliente').focus();
  });
  $('#orc-nome').addEventListener('change', (e) => { if (e.target.value.trim()) salvar('nome', e.target.value.trim()); });
  // cliente e local aparecem no resumo acima dos campos: redesenha para o resumo acompanhar
  const salvarTexto = async (campo, valor) => { const n = await salvar(campo, valor); if (n) abrirOrcamento(n.id, n); };
  $('#orc-cliente').addEventListener('change', (e) => salvarTexto('cliente', e.target.value));
  $('#orc-local').addEventListener('change', (e) => salvarTexto('local', e.target.value));
  $('#orc-bdi').addEventListener('change', async (e) => {
    const v = lerNum(e.target.value);
    if (!(v >= 0 && v <= 100)) { avisar('O BDI precisa ficar entre 0 e 100%.'); e.target.value = num2.format(ORC.atual.bdi); return; }
    const n = await salvar('bdi', v); if (n) { e.target.value = num2.format(n.bdi); abrirOrcamento(n.id, n); avisar(`BDI alterado para ${num2.format(n.bdi)}%. Preços recalculados.`); }
  });
  $('#orc-duplicar').addEventListener('click', async () => {
    const n = await req(`/api/orcamentos/${o.id}/duplicar`, 'POST'); location.hash = rotaOrc(n.id); avisar('Orçamento duplicado.');
  });
  $('#orc-excluir').addEventListener('click', async () => {
    const r = await req(`/api/orcamentos/${o.id}`, 'DELETE'); location.hash = '#/orcamentos';
    avisarDesfazer(`Orçamento "${esc(o.nome)}" excluído.`, r && r.desfazer);
  });
}

function desenharPlanilha(o) {
  const visiveis = o.etapas.filter((e) => !ORC.filtro || e.id === ORC.filtro);
  const etapas = visiveis.map((e) => `
    <tbody class="etapa" data-etapa="${e.id}">
      <tr class="etapa-cab">
        <td class="n"><button type="button" class="pega" data-pega="etapa" data-id="${e.id}" aria-label="Mover a etapa ${e.numero}: arraste ou use as setas para cima e para baixo" title="Arraste para mudar a ordem">⠿</button>${e.numero}</td>
        <td colspan="5"><input class="etapa-titulo" value="${esc(e.titulo)}" aria-label="Título da etapa ${e.numero}" data-etapa="${e.id}"></td>
        <td class="num"><span class="peso-etapa">${pct.format(e.peso)}</span></td>
        <td class="num"><b>${brl.format(e.total)}</b></td>
        <td class="ctrl">
          <button type="button" class="mini" data-acao="etapa-excluir" data-id="${e.id}" aria-label="Excluir etapa">✕</button>
        </td>
      </tr>
      ${e.itens.map((i) => `<tr class="item${ORC.destaque === `${i.tipo}|${i.base}|${i.codigo}` ? ' destaque' : ''}" data-item="${i.id}">
        <td class="n"><button type="button" class="pega" data-pega="item" data-id="${i.id}" aria-label="Mover o item ${i.numero}: arraste ou use as setas para cima e para baixo" title="Arraste para mudar a ordem ou a etapa">⠿</button>${i.numero}</td>
        <td class="cod">${codLink(i.tipo, i.base, i.codigo)}</td>
        <td class="desc">${esc(i.descricao)}${i.referencia && i.referencia !== o.referencia ? `<span class="ref-item" title="Este item não existe em ${esc(nomeRef(o.referencia))} e ficou com o preço de ${esc(nomeRef(i.referencia))}">preço de ${esc(nomeRef(i.referencia))}</span>` : ''}</td>
        <td class="c-un">${unid(i.unidade)}</td>
        <td class="num c-qtd"><input class="qtd" inputmode="decimal" value="${qtdFmt.format(i.quantidade)}" data-item="${i.id}" aria-label="Quantidade do item ${i.numero}"></td>
        <td class="num c-custo" data-rotulo="Custo unit.">${money(i.custo_unit)}</td>
        <td class="num c-preco" data-rotulo="Preço c/ BDI">${money(i.preco_unit)}</td>
        <td class="num total c-total" data-rotulo="Total">${money(i.total)}</td>
        <td class="ctrl">
          <button type="button" class="mini" data-acao="item-excluir" data-id="${i.id}" aria-label="Excluir item ${i.numero}">✕</button>
        </td></tr>`).join('')}
      <tr class="add-linha"><td></td><td colspan="8">
        <div class="add-busca">
          <input class="add-q" placeholder="Adicionar serviço ou insumo de ${esc(nomeRef(o.referencia))} à etapa ${e.numero}: digite descrição ou código" data-etapa="${e.id}" aria-label="Adicionar item à etapa ${e.numero}" autocomplete="off">
          <ul class="add-res" hidden></ul>
        </div>
      </td></tr>
    </tbody>`).join('');
  const filtrada = ORC.filtro && visiveis[0];
  $('#orc-corpo').innerHTML = `
    ${filtrada ? `<p class="filtro-ativo">Mostrando só a etapa <b>${filtrada.numero}. ${esc(filtrada.titulo)}</b><button type="button" class="link-acao" data-ver-todas>Ver todas as etapas</button></p>` : ''}
    <table class="planilha planilha-orc">
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
  const atualizar = (n, jaMedido) => {
    const foco = document.activeElement && { ...document.activeElement.dataset };
    const deslizar = jaMedido || medir('.planilha-orc tr.item, .planilha-orc tr.etapa-cab, .planilha-orc tr.add-linha', (el) => el.dataset.item ? `i${el.dataset.item}` : `${el.className}${el.closest('tbody').dataset.etapa}`);
    return abrirOrcamento(n.id, n).then(() => { deslizar(); restaurarFoco(foco); });
  };
  window.ligarArrastar(corpo, o, atualizar);
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
      if (a === 'item-excluir') {
        const r = await req(`/api/itens/${id}`, 'DELETE'); await atualizar(r);
        avisarDesfazer('Item excluído.', r.desfazer);
      }
      if (a === 'etapa-excluir') {
        const et = o.etapas.find((x) => String(x.id) === id);
        const r = await req(`/api/etapas/${id}`, 'DELETE'); await atualizar(r);
        avisarDesfazer(`Etapa "${esc(et.titulo)}" excluída${et.itens.length ? `, com ${et.itens.length} ${et.itens.length === 1 ? 'item' : 'itens'}` : ''}.`, r.desfazer);
      }
    } catch (err) { avisar(esc(err.message)); }
  });
  corpo.addEventListener('click', (e) => { if (e.target.closest('[data-ver-todas]')) { ORC.filtro = null; abrirOrcamento(o.id, ORC.atual); } });
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
  if (el) { el.focus(); el.select(); return; }
  if (foco.pega) { el = document.querySelector(`.pega[data-pega="${foco.pega}"][data-id="${foco.id}"]`); if (el) el.focus(); }
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
      const r = await req(`/api/busca?${new URLSearchParams({ q, limite: 8, ref: ORC.atual.referencia })}`);
      if (meu !== seqLocal) return;
      itens = r.itens.filter((x) => x.preco != null);
      ul.innerHTML = itens.length ? itens.map((x, k) => `<li data-k="${k}"><span class="res-cod">${codigoBase(x.codigo, x.base)}<span class="tipo tipo-${x.tipo}">${x.tipo === 'servico' ? 'Composição' : 'Insumo'}</span></span>
          <span>${trecho(x)}</span><span class="add-preco">${brl.format(x.preco)}<span class="un">${unid(x.unidade)}</span></span></li>`).join('')
        : `<li class="nada">Nada encontrado com preço em ${esc(nomeRef(ORC.atual.referencia))}.</li>`;
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
      const deslizar = medir('.planilha-orc tr.item, .planilha-orc tr.etapa-cab, .planilha-orc tr.add-linha', (el) => el.dataset.item ? `i${el.dataset.item}` : `${el.className}${el.closest('tbody').dataset.etapa}`);
      await abrirOrcamento(n.id, n); deslizar();
      const q = document.querySelector(`.qtd[data-item="${n.item_criado}"]`); if (q) { q.focus(); q.select(); }
      avisar(`${VISTO}${esc(x.codigo)}/${esc(x.base)} adicionado. Digite a quantidade.`);
    } catch (err) { avisar(esc(err.message)); }
  }
}

// ---------- curva ABC ----------
async function desenharABC(o, tipo) {
  const corpo = $('#orc-corpo');
  if (!o.qtd_itens) { corpo.innerHTML = vazio('grafico', 'A curva ABC aparece quando houver itens', 'Adicione composições ou insumos na aba Planilha.'); return; }
  corpo.innerHTML = '<p class="carregando">Calculando a curva ABC…</p>';
  const r = await req(`/api/orcamentos/${o.id}/abc?tipo=${tipo}`);
  const chave = tipo === 'servicos' ? 'total' : 'custo_total';
  const cores = { A: 'var(--c-equip)', B: 'var(--c-mat)', C: 'var(--linha-forte)' };
  const blocos = ['A', 'B', 'C'].map((cl) => `<div style="--cor:${cores[cl]}">Classe ${cl}<b>${brl.format(r.resumo[cl].valor)}</b>
      <span class="pct">${r.resumo[cl].itens} ${r.resumo[cl].itens === 1 ? 'item' : 'itens'} · ${pct.format(r.total ? r.resumo[cl].valor / r.total : 0)} do valor</span></div>`).join('');
  const barra = ['A', 'B', 'C'].filter((cl) => r.resumo[cl].valor > 0).map((cl) => `<span style="flex-grow:${r.resumo[cl].valor};background:${cores[cl]}"></span>`).join('');
  const linhas = r.linhas.map((l) => `<tr class="cl-${l.classe}">
      <td class="n">${l.posicao}</td>
      <td class="cod">${codLink(tipo === 'servicos' && l.tipo === 'servico' ? 'servico' : 'insumo', l.base, l.codigo)}</td>
      <td class="desc">${esc(l.descricao)}</td><td>${esc(l.unidade)}</td>
      <td class="num">${qtdFmt.format(l.quantidade)}</td>
      <td class="num">${money(tipo === 'servicos' ? l.preco_unit : l.custo_unit)}</td>
      <td class="num total">${money(l[chave])}</td>
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
  sel.innerHTML = dlgOrcs.map((o) => `<option value="${o.id}">${esc(o.nome)} (${esc(nomeRef(o.referencia))})</option>`).join('') + `<option value="novo">Novo orçamento em ${esc(nomeRef(estado.mes))}…</option>`;
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
      const o = await req('/api/orcamentos', 'POST', { nome, bdi: 25, referencia: estado.mes }); oid = o.id; etapa = o.etapas[0].id;
    }
    const n = await req(`/api/orcamentos/${oid}/itens`, 'POST', { etapa_id: etapa, tipo: dlgItem.tipo, base: dlgItem.base, codigo: dlgItem.codigo, quantidade: q });
    lembrar(n.id); dlg.close();
    avisar(`${VISTO}Adicionado a <b>${esc(n.nome)}</b> · total ${brl.format(n.total)} · <a href="${rotaOrc(n.id)}">Abrir orçamento</a>`, 6000);
  } catch (err) { $('#dlg-erro').textContent = err.message; }
});


// ---------- data-base do orçamento ----------
// O orçamento usa um único mês. Trocar o mês recalcula os preços com os valores do novo mês.
function ligarMudarMes(o) {
  const sel = $('#orc-mes'), caixa = $('#orc-mudar-mes');
  if (!sel) return;
  const desfazer = () => { sel.value = o.referencia; caixa.hidden = true; caixa.innerHTML = ''; };
  sel.addEventListener('change', async () => {
    const alvo = sel.value; if (alvo === o.referencia) { desfazer(); return; }
    const nome = nomeRef(alvo);
    caixa.hidden = false; caixa.innerHTML = '<p class="carregando">Calculando…</p>';
    try {
      const r = await req(`/api/orcamentos/${o.id}/atualizacao?referencia=${encodeURIComponent(alvo)}`);
      const sem = r.sem_preco.map((x) => `<li><b>${x.numero}</b> ${esc(x.codigo)}/${esc(x.base)} · ${esc(x.descricao)}</li>`).join('');
      caixa.innerHTML = `<p><b>Mudar a data-base para ${esc(nome)}?</b> Os custos de ${r.itens.length} ${r.itens.length === 1 ? 'item serão recalculados' : 'itens serão recalculados'} com os preços de ${esc(nome)}.
        Total com BDI em ${esc(nome)}: <b>${brl.format(r.total_depois)}</b>.</p>
        ${sem ? `<p>${r.sem_preco.length === 1 ? 'Este item não existe' : 'Estes itens não existem'} em ${esc(nome)} e ${r.sem_preco.length === 1 ? 'fica' : 'ficam'} com o preço atual. Substitua por um equivalente, se for o caso:</p><ul class="sem-preco">${sem}</ul>` : ''}
        <div class="acoes"><button type="button" class="botao primario" id="orc-mes-ok">Mudar para ${esc(nome)}</button>
          <button type="button" class="botao" id="orc-mes-copia">Criar uma cópia em ${esc(nome)}</button>
          <button type="button" class="botao" id="orc-mes-cancelar">Cancelar</button></div>`;
      $('#orc-mes-cancelar').addEventListener('click', desfazer);
      $('#orc-mes-ok').addEventListener('click', async () => {
        const n = await req(`/api/orcamentos/${o.id}/atualizar?referencia=${encodeURIComponent(alvo)}`, 'POST');
        await abrirOrcamento(n.id, n); avisar(`Data-base alterada para ${esc(nome)}. Novo total ${brl.format(n.total)}.`, 6000);
      });
      $('#orc-mes-copia').addEventListener('click', async () => {
        const copia = await req(`/api/orcamentos/${o.id}/duplicar`, 'POST');
        const n = await req(`/api/orcamentos/${copia.id}/atualizar?referencia=${encodeURIComponent(alvo)}`, 'POST');
        await req(`/api/orcamentos/${n.id}`, 'PATCH', { nome: `${o.nome} (${nome})` });
        location.hash = rotaOrc(n.id); avisar(`Cópia criada em ${esc(nome)}. O orçamento original não mudou.`, 6000);
      });
    } catch (e) { caixa.innerHTML = `<p class="erro">${esc(e.message)}</p>`; }
  });
}

// ---------- totais sempre à vista ----------
// quando o cabeçalho do orçamento sai da tela, uma faixa fina com nome e totais gruda no topo
window.addEventListener('scroll', () => {
  const cab = document.querySelector('.ficha.orc .orc-cab'); if (!cab) return;
  const topo = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topo')) || 62;
  cab.closest('.ficha').classList.toggle('rolou', cab.getBoundingClientRect().bottom < topo);
}, { passive: true });
