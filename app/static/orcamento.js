'use strict';
/* Orçamentos: lista, planilha com etapas e itens, BDI, curva ABC e diálogo "Adicionar ao orçamento". */

const ORC = { atual: null, aba: 'planilha', ultimo: null, recolhidas: new Set(), recolhidasDe: null, anel: null };
// etapas recolhidas: lembradas por orçamento, neste navegador
function lerRecolhidas(id) {
  if (ORC.recolhidasDe === id) return;
  ORC.recolhidasDe = id;
  try { ORC.recolhidas = new Set(JSON.parse(localStorage.getItem(`orc-recolhidas-${id}`) || '[]')); } catch (_) { ORC.recolhidas = new Set(); }
}
function gravarRecolhidas() { try { localStorage.setItem(`orc-recolhidas-${ORC.recolhidasDe}`, JSON.stringify([...ORC.recolhidas])); } catch (_) { /* sem storage */ } }
const CHEVRON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3 7.5 6l-3 3" /></svg>';
// três níveis na planilha: célula construtiva › etapa › subetapa
const NIVEL = { 1: ['célula construtiva', 'células construtivas', 'Célula construtiva'], 2: ['etapa', 'etapas', 'Etapa'], 3: ['subetapa', 'subetapas', 'Subetapa'] };
const NIVEL_DICA = { 1: 'Conjunto macro da obra: torre, habitação, infraestrutura...', 2: 'Conjunto construtivo dentro da célula: rede de drenagem, fundação...', 3: 'Subdivisão da etapa: assentamento de tubulação, escavação... Os serviços entram aqui.' };
const nomeNivel = (n, plural) => (NIVEL[n] || NIVEL[2])[plural ? 1 : 0];
const NomeNivel = (n) => (NIVEL[n] || NIVEL[2])[2];
const artigo = (n) => (n === 1 ? 'a' : 'a');  // célula, etapa e subetapa são todas femininas
const descendentesDe = (o, id) => { const out = []; const f = (pid) => o.etapas.filter((x) => x.pai_id === pid).forEach((x) => { out.push(x); f(x.id); }); f(id); return out; };
const alturaDe = (o, id) => { const fs = o.etapas.filter((x) => x.pai_id === id); return fs.length ? 1 + Math.max(...fs.map((x) => alturaDe(o, x.id))) : 0; };
// mão de obra, material, equipamento e terceiros em reais (a custo, sem BDI)
function valoresDe(itens) {
  const p = { mo: 0, mat: 0, equip: 0, terc: 0 };
  for (const i of itens) if (i.div && i.custo_total) for (const k in p) p[k] += i.custo_total * (i.div[k] || 0);
  return p;
}
const ANALITICO = [['mo', 'Mão de obra', '--c-mo'], ['mat', 'Material', '--c-mat'], ['equip', 'Equipamento', '--c-equip'], ['terc', 'Terceiros', '--c-terc']];
// cada serviço: quanto do custo unitário e do total é mão de obra, material, equipamento e terceiros (a custo, sem BDI)
const CURTO = { mo: 'Mão de obra', mat: 'Material', equip: 'Equipamento', terc: 'Terceiros' };
function divisaoItem(i) {
  if (!i.div || !i.custo_unit) return '';
  const un = unid(i.unidade);
  const partes = ANALITICO.filter(([k]) => (i.div[k] || 0) >= (k === 'mo' || k === 'mat' ? 0.0005 : 0.01));
  if (!partes.length) return '';
  return `<span class="item-div" role="group" aria-label="Divisão do custo: ${partes.map(([k]) => `${CURTO[k]} ${brl.format(i.custo_unit * i.div[k])} por ${esc(i.unidade)}, ${brl.format(i.custo_total * i.div[k])} no total`).join('; ')}">${partes.map(([k, , cor]) =>
    `<span class="idv" style="--cor:var(${cor})" title="${CURTO[k]}: ${pct.format(i.div[k])} do custo"><i></i>${CURTO[k]} <b>${brl.format(i.custo_unit * i.div[k])}<span class="idv-un">/${un}</span></b> <em>· ${REAIS.format(i.custo_total * i.div[k])}</em></span>`).join('')}</span>`;
}
// sem centavos nas colunas da divisão (o valor exato aparece ao passar o mouse)
const REAIS = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
// divisão em colunas fixas, dentro do cabeçalho da célula e da etapa: as colunas ficam alinhadas de uma linha para a outra
function colunasDivisao(itens, rotulo) {
  const v = valoresDe(itens), soma = v.mo + v.mat + v.equip + v.terc;
  const cel = ([k, n, cor]) => (v[k] >= 0.005
    ? `<span class="ac" style="--cor:var(${cor})" title="${n}: ${brl.format(v[k])} (${pct.format(v[k] / soma)} do custo direto)"><i></i><b>${REAIS.format(v[k])}</b><em>${v[k] / soma < 0.001 ? '<0,1%' : pct.format(v[k] / soma)}</em></span>`
    : `<span class="ac vazio" title="${n}: nada"><i></i><b>—</b></span>`);
  return soma ? `<span class="anal-cols" role="group" aria-label="Divisão do custo direto ${esc(rotulo)}: ${ANALITICO.filter(([k]) => v[k] >= 0.005).map(([k, n]) => `${n} ${brl.format(v[k])}`).join(', ')}">${ANALITICO.map(cel).join('')}</span>` : '<span class="anal-cols"></span>';
}
function linhaAnalitica(itens, rotulo) {
  const v = valoresDe(itens), soma = v.mo + v.mat + v.equip + v.terc;
  if (!soma) return '';
  return `<tr class="etapa-anal"><td></td><td colspan="8"><div class="anal" role="group" aria-label="Divisão do custo direto ${esc(rotulo)}">
    <span class="anal-rot">Custo direto <b>${brl.format(soma)}</b></span>
    ${ANALITICO.filter(([k]) => v[k] >= 0.005).map(([k, n, cor]) => `<span class="anal-p" style="--cor:var(${cor})"><i></i>${n} <b>${brl.format(v[k])}</b> <em>${v[k] / soma < 0.001 ? '<0,1%' : pct.format(v[k] / soma)}</em></span>`).join('')}
  </div></td></tr>`;
}
try { ORC.analitico = localStorage.getItem('orc-analitico') !== 'nao'; } catch (_) { ORC.analitico = true; }
// divisão do custo de um conjunto de itens (cada item traz a sua, do servidor)
function divisaoDe(itens) {
  const p = { mo: 0, mat: 0, equip: 0, terc: 0 };
  for (const i of itens) if (i.div && i.custo_total) for (const k in p) p[k] += i.custo_total * (i.div[k] || 0);
  const s = p.mo + p.mat + p.equip + p.terc;
  return s > 0 ? Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v / s])) : null;
}
try { ORC.ultimo = Number(localStorage.getItem('orc-ultimo')) || null; } catch (_) { /* sem storage */ }
const lembrar = (id) => { ORC.ultimo = id; try { localStorage.setItem('orc-ultimo', id); } catch (_) { /* ok */ } };

async function req(url, metodo = 'GET', corpo) {
  const r = await fetch(url, { method: metodo, headers: corpo ? { 'Content-Type': 'application/json' } : {}, body: corpo ? JSON.stringify(corpo) : undefined });
  if (r.status === 401) { sessaoEncerrada(); throw new Error('Sessão encerrada.'); }
  if (r.status === 204) return null;
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const d = j.detail;
    throw new Error(Array.isArray(d) ? 'Confira os campos preenchidos.' : (d || `Erro ${r.status}`));
  }
  return anotarBasesProprias(j);
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
  const m = location.hash.match(/^#\/orcamento\/(\d+)(?:\/(planilha|mapa|abc-servicos|abc-insumos|relatorio))?/);
  const d = $('#detalhe');
  try {
    if (/^#\/orcamentos\/anexar/.test(location.hash)) { window.desenharAnexar(); return; }
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
    : 'Monte a planilha da obra com os preços da ORSE, da SINAPI e do SICRO.';
  const ul = $('#orc-lista'); if (!ul) return;
  ul.innerHTML = vis.length ? vis.map((o) => `<li><a class="orc-cartao" href="${rotaOrc(o.id)}">
      <span class="orc-c-nome">${esc(o.nome)}</span>
      <span class="orc-c-sub">${esc([o.cliente, o.local].filter(Boolean).join(' · ') || 'Sem cliente e local')}</span>
      <span class="orc-c-total">${grana(o.total)}</span>
      <span class="orc-c-rot">total com BDI de ${num2.format(o.bdi)}%${o.bdi_no_total ? ' sobre o total' : ''}</span>
      <span class="res-div">${o.divisao ? barraDivisao(o.divisao) : '<span class="dom">Ainda sem itens</span>'}</span>
      <span class="orc-c-meta">${esc(nomeRef(o.referencia))} · ${o.qtd_itens} ${o.qtd_itens === 1 ? 'item' : 'itens'} · alterado em ${dataFmt(o.atualizado_em)}</span>
    </a><button type="button" class="orc-c-excluir" data-excluir-orc="${o.id}" aria-label="Excluir o orçamento ${esc(o.nome)}" title="Excluir orçamento">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg></button></li>`).join('')
    : `<li class="orc-nada">${vazio('lupa', 'Nenhum orçamento com esse nome', 'Confira a grafia ou limpe o filtro.')}</li>`;
}

// ---------- excluir orçamento: confirmação extra (digitar EXCLUIR) e, depois, ainda dá para desfazer ----------
const EXC = { o: null };
const palavraOk = () => $('#excluir-orc-conf').value.trim().toUpperCase() === 'EXCLUIR';
function pedirExclusao(o) {
  EXC.o = o;
  const n = o.qtd_itens ?? (o.etapas || []).reduce((s, e) => s + e.itens.length, 0);
  $('#excluir-orc-desc').innerHTML = `<b>${esc(o.nome)}</b><span>${esc([o.cliente, o.local].filter(Boolean).join(' · ') || 'Sem cliente e local')}</span>
    <span>${n} ${n === 1 ? 'item' : 'itens'} · total ${brl.format(o.total)}</span>`;
  $('#excluir-orc-conf').value = ''; $('#excluir-orc-erro').textContent = ''; $('#excluir-orc-ok').disabled = true;
  $('#dlg-excluir-orc').showModal(); $('#excluir-orc-conf').focus();
}
$('#excluir-orc-conf').addEventListener('input', () => { $('#excluir-orc-ok').disabled = !palavraOk(); $('#excluir-orc-erro').textContent = ''; });
$('#form-excluir-orc').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!palavraOk()) { $('#excluir-orc-erro').textContent = 'Digite EXCLUIR para confirmar.'; return; }
  const o = EXC.o, bt = $('#excluir-orc-ok'); bt.disabled = true;
  try {
    const r = await req(`/api/orcamentos/${o.id}`, 'DELETE');
    $('#dlg-excluir-orc').close();
    if (location.hash === '#/orcamentos') window.rotaOrcamento(); else location.hash = '#/orcamentos';
    avisarDesfazer(`Orçamento "${esc(o.nome)}" excluído.`, r && r.desfazer);
  } catch (err) { $('#excluir-orc-erro').textContent = err.message; bt.disabled = false; }
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-excluir-orc]'); if (!b) return;
  e.preventDefault();
  const o = LISTA.todos.find((x) => String(x.id) === b.dataset.excluirOrc); if (o) pedirExclusao(o);
});

function abrirNovoOrcamento() {
  const d = $('#dlg-novo-orc'), f = $('#form-novo');
  f.reset(); $('#novo-orc-erro').textContent = '';
  f.elements.referencia.innerHTML = [...((estado.ref && estado.ref.referencias) || [])].reverse().map((r) =>
    `<option value="${esc(r.id)}"${r.id === (estado.meses.ORSE || estado.mes) ? ' selected' : ''}>${esc(r.descricao.replace(/-1$/, ''))}</option>`).join('');
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
  if (location.hash !== '#/orcamentos') return;
  const tem = LISTA.todos.length > 0;
  $('#detalhe').innerHTML = `<div class="pagina orcamentos">
    <header class="pag-cab">
      <div><h1>Orçamentos</h1><p class="sub" id="orc-resumo"></p></div>
      <div class="acoes"><a class="botao" href="#/orcamentos/anexar" id="anexar-orc">Anexar orçamento</a>
        <button type="button" class="botao primario" id="novo-orc" data-novo-orc>Novo orçamento</button></div>
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
  const h = location.hash;
  const semEsq = dados || (ORC.atual && ORC.atual.id === id && $('#detalhe .orc')) ? () => {} : comEsqueleto($('#detalhe'), `<div class="pagina">${esqueletoTabela(14)}</div>`);
  let o;
  try { o = dados || await req(`/api/orcamentos/${id}`); } finally { semEsq(); }
  if (!dados && location.hash !== h) return;
  if (!ORC.atual || ORC.atual.id !== o.id || !o.etapas.some((e) => e.id === ORC.filtro)) ORC.filtro = null;
  ORC.atual = o; lembrar(o.id);
  if (ORC.aba === 'relatorio') { await window.desenharRelatorio(o); return; }
  const abas = [['planilha', 'Planilha'], ['mapa', 'Mapa'], ['abc-servicos', 'Curva ABC de serviços'], ['abc-insumos', 'Curva ABC de insumos']];
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
    <div class="orc-opcoes">
    <div class="orc-compl${o.sem_complementares ? ' ligado' : ''}" id="orc-compl"${o.complementares > 0 || o.sem_complementares ? '' : ' hidden'}>
      <button type="button" class="chave" id="orc-compl-bt" role="switch" aria-checked="${!!o.sem_complementares}"><span class="chave-trilho" aria-hidden="true"><i></i></span>Desconsiderar encargos complementares</button>
      <p>${o.sem_complementares
        ? `<b>${brl.format(o.complementares)}</b> de alimentação, transporte, EPI, ferramentas, exames, seguro e capacitação saíram do custo das composições. Lance esse valor nos seus custos indiretos, sem duplicidade.`
        : `As composições trazem <b>${brl.format(o.complementares)}</b> embutidos na mão de obra (alimentação, transporte, EPI, ferramentas, exames, seguro e capacitação). Se você lança isso nos indiretos, ligue para não contar duas vezes.`}</p>
    </div>
    <div class="orc-compl${o.bdi_no_total ? ' ligado' : ''}" id="orc-bdi-total">
      <button type="button" class="chave" id="orc-bdi-total-bt" role="switch" aria-checked="${!!o.bdi_no_total}"><span class="chave-trilho" aria-hidden="true"><i></i></span>BDI só no total do orçamento</button>
      <p>${o.bdi_no_total
        ? `O BDI de ${num2.format(o.bdi)}% entra uma única vez, sobre o custo direto total: <b>${brl.format(o.custo_total)}</b> + <b>${brl.format(o.valor_bdi)}</b>. Itens e etapas aparecem a custo, sem BDI.`
        : 'O BDI está no preço unitário de cada item. Ligue para deixar os itens a custo e aplicar o BDI uma única vez, sobre o total.'}</p>
    </div>
    </div>
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
  else if (ORC.aba === 'mapa') window.desenharMapa(o);
  else await desenharABC(o, ORC.aba === 'abc-servicos' ? 'servicos' : 'insumos');
  conferirFaixaFixa();  // a tela foi refeita: se já estava rolada, a faixa de totais continua à vista
}

function desenharTotais(o) {
  $('#orc-totais').innerHTML = `
    <div>Custo direto<b>${grana(o.custo_total)}</b></div>
    <div>BDI de ${num2.format(o.bdi)}%${o.bdi_no_total ? ' sobre o total' : ''}<b>${grana(o.valor_bdi)}</b></div>
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
  $('#orc-excluir').addEventListener('click', () => pedirExclusao(o));
  $('#orc-bdi-total-bt').addEventListener('click', async () => {
    const ligar = !o.bdi_no_total;
    const n = await salvar('bdi_no_total', ligar); if (!n) return;
    await abrirOrcamento(n.id, n); $('#orc-bdi-total-bt').focus();
    avisar(ligar ? `${VISTO}BDI aplicado só no total: ${brl.format(n.custo_total)} + ${brl.format(n.valor_bdi)} = ${brl.format(n.total)}.` : `BDI de volta ao preço de cada item. Total ${brl.format(n.total)}.`, 6000);
  });
  $('#orc-compl-bt').addEventListener('click', async () => {
    const ligar = !o.sem_complementares;
    const n = await salvar('sem_complementares', ligar); if (!n) return;
    await abrirOrcamento(n.id, n); $('#orc-compl-bt').focus();
    avisar(ligar ? `${VISTO}Encargos complementares desconsiderados: ${brl.format(n.complementares)} a menos no custo direto.` : 'Encargos complementares de volta ao custo das composições.', 6000);
  });
}

// ---------- barra de baixo: adicionar serviço, célula, etapa ou subetapa, escolhendo onde ----------
const curtoTit = (t) => (t.length > 58 ? `${t.slice(0, 56)}…` : t);
function opcoesDestino(o) {
  // os serviços entram nas etapas e subetapas; a célula só aparece como escolha se já tiver itens soltos (orçamentos antigos)
  const temEtapa = o.etapas.some((e) => e.nivel >= 2);
  const ops = o.etapas.map((e) => {
    const ok = e.nivel >= 2 || e.itens.length > 0 || !temEtapa;
    return { id: e.id, ok, rot: `${'\u00a0\u00a0\u00a0'.repeat(e.nivel - 1)}${e.numero}. ${curtoTit(e.titulo)}` };
  });
  if (!temEtapa && !o.etapas.some((e) => e.itens.length)) return [{ id: '', ok: true, rot: `Nova etapa "Serviços preliminares"${o.etapas.length ? ` em ${o.etapas[o.etapas.length - 1].numero}. ${curtoTit(o.etapas[o.etapas.length - 1].titulo)}` : ''}` }];
  return ops;
}
function opcoesOnde(o) {
  return [{ id: '', rot: 'Nova célula construtiva' }, ...o.etapas.filter((e) => e.nivel < 3)
    .map((e) => ({ id: e.id, rot: `${e.nivel === 1 ? 'Nova etapa' : 'Nova subetapa'} em ${e.numero}. ${curtoTit(e.titulo)}`, nivel: e.nivel + 1 }))];
}
function escolhasPadrao(o) {
  const dest = opcoesDestino(o).filter((x) => x.ok);
  if (!dest.some((x) => String(x.id) === String(ORC.destino))) ORC.destino = dest.length ? dest[dest.length - 1].id : '';
  const onde = opcoesOnde(o);
  if (ORC.onde === undefined || !onde.some((x) => String(x.id) === String(ORC.onde))) {
    const cel = o.etapas.filter((e) => e.nivel === 1); ORC.onde = cel.length ? cel[cel.length - 1].id : '';
  }
}
const DICA_NOME = { 1: 'Nome da célula construtiva: Torre A, Habitação, Infraestrutura…', 2: 'Nome da etapa: Rede de drenagem, Fundação…', 3: 'Nome da subetapa: Assentamento de tubulação, Escavação…' };
const nivelDoOnde = (o, onde) => { const e = o.etapas.find((x) => String(x.id) === String(onde)); return e ? e.nivel + 1 : 1; };
function barraAdicionar(o) {
  escolhasPadrao(o);
  const modo = ORC.addModo || 'item', nv = nivelDoOnde(o, ORC.onde);
  return `<form class="plan-add" id="form-etapa" data-modo="${modo}" aria-label="Adicionar à planilha">
    <div class="segmentos pa-modo" role="group" aria-label="O que adicionar">
      <button type="button" data-pa-modo="item" aria-pressed="${modo === 'item'}">+ Serviço</button>
      <button type="button" data-pa-modo="etapa" aria-pressed="${modo === 'etapa'}" aria-label="Adicionar célula, etapa ou subetapa">+ <span class="pa-longo">Célula, etapa ou subetapa</span><span class="pa-curto">Etapa</span></button></div>
    <div class="pa-campos pa-item"${modo === 'item' ? '' : ' hidden'}>
      <label class="pa-onde"><span class="pa-rot">Em</span> <select id="pa-destino" aria-label="Etapa ou subetapa onde o serviço entra">${opcoesDestino(o).map((x) => `<option value="${x.id}"${x.ok ? '' : ' disabled'}${String(x.id) === String(ORC.destino) ? ' selected' : ''}>${esc(x.rot)}</option>`).join('')}</select></label>
      <div class="add-busca"><input class="add-q" id="pa-busca" placeholder="Descrição ou código de ${esc(nomeRef(o.referencia))}" data-etapa="${ORC.destino}" aria-label="Buscar serviço ou insumo para adicionar" autocomplete="off">
        <ul class="add-res" role="listbox" aria-label="Itens encontrados" tabindex="0" hidden></ul></div>
    </div>
    <div class="pa-campos pa-etapa"${modo === 'etapa' ? '' : ' hidden'}>
      <label class="pa-onde"><span class="pa-rot">Criar</span> <select id="pa-pai" aria-label="O que criar e onde">${opcoesOnde(o).map((x) => `<option value="${x.id}"${String(x.id) === String(ORC.onde) ? ' selected' : ''}>${esc(x.rot)}</option>`).join('')}</select></label>
      <input id="nova-etapa" placeholder="${DICA_NOME[nv]}" maxlength="200" aria-label="Nome">
      <button class="botao primario botao-p" type="submit">Adicionar</button>
    </div>
  </form>`;
}

function desenharPlanilha(o) {
  lerRecolhidas(o.id);
  const noFiltro = ORC.filtro ? new Set([ORC.filtro, ...descendentesDe(o, ORC.filtro).map((x) => x.id)]) : null;
  const visiveis = o.etapas.filter((e) => !noFiltro || noFiltro.has(e.id));
  const porId = new Map(o.etapas.map((e) => [e.id, e]));
  // régua de peso: cada item mostra quanto pesa no total (largura relativa ao maior item) e a classe ABC dele
  const todos = o.etapas.flatMap((e) => e.itens), maiorItem = Math.max(...todos.map((i) => i.total), 0.01);
  const somaEtapas = o.etapas.filter((e) => e.nivel === 1).reduce((s, e) => s + e.total, 0) || 1;
  const classe = new Map(curvaABC(o).map((x) => [x.chave, x.classe]));
  const filhas = (e) => o.etapas.filter((x) => x.pai_id === e.id);
  const itensDe = (e) => [...e.itens, ...descendentesDe(o, e.id).flatMap((x) => x.itens)];
  const ancRecolhida = (e) => { if (ORC.filtro) return false; for (let p = porId.get(e.pai_id); p; p = porId.get(p.pai_id)) if (ORC.recolhidas.has(p.id)) return true; return false; };
  const etapas = visiveis.map((e) => {
    const rec = ORC.recolhidas.has(e.id), maeRec = ancRecolhida(e);
    const lista = itensDe(e), fs = filhas(e), nsub = fs.length;
    const tipo = nomeNivel(e.nivel), Tipo = NomeNivel(e.nivel), prox = e.nivel + 1;
    const irmas = o.etapas.filter((x) => (x.pai_id || null) === (e.pai_id || null)), k = irmas.indexOf(e);
    const podeDescer = k > 0 && irmas[k - 1].nivel + 1 + alturaDe(o, e.id) <= 3;
    return `
    <tbody class="etapa n${e.nivel}${e.nivel > 1 ? ' sub' : ''}${rec ? ' recolhida' : ''}${maeRec ? ' mae-recolhida' : ''}" data-etapa="${e.id}" data-pai="${e.pai_id || ''}" data-nivel="${e.nivel}">
      <tr class="etapa-cab">
        <td class="n"><button type="button" class="pega" data-pega="etapa" data-id="${e.id}" aria-label="Mover ${artigo(e.nivel)} ${tipo} ${e.numero}: arraste ou use as setas para cima e para baixo" title="Arraste para mudar a ordem">⠿</button><button type="button" class="recolher" data-recolher="${e.id}" aria-expanded="${!rec}" aria-label="${rec ? 'Mostrar' : 'Recolher'} ${artigo(e.nivel)} ${tipo} ${e.numero}" title="${rec ? 'Mostrar os itens' : 'Recolher'}">${CHEVRON}</button><span class="num-nivel">${e.numero}</span></td>
        <td colspan="6"><div class="etapa-linha"><span class="nivel-rot" aria-hidden="true" title="${NIVEL_DICA[e.nivel] || ''}">${Tipo}</span><input class="etapa-titulo" value="${esc(e.titulo)}" title="${esc(e.titulo)}" aria-label="Título d${artigo(e.nivel)} ${tipo} ${e.numero}" data-etapa="${e.id}">
          <span class="etapa-resumo${ORC.analitico && e.nivel <= 2 ? ' com-colunas' : ''}" aria-hidden="${!rec}">${lista.length} ${lista.length === 1 ? 'item' : 'itens'}${nsub ? ` · ${nsub} ${nomeNivel(prox, nsub !== 1)}` : ''}${lista.length && e.nivel <= 2 && !ORC.analitico ? barraDivisao(divisaoDe(lista)) : ''}</span>
          ${ORC.analitico && e.nivel <= 2 ? colunasDivisao(lista, `d${artigo(e.nivel)} ${tipo} ${e.numero}`) : ''}</div></td>
        <td class="num c-tot-etapa"><b>${brl.format(e.total)}</b><span class="peso-etapa">${pct.format(e.peso)} do total</span></td>
        <td class="ctrl"><span class="ctrl-nivel">
          ${e.nivel > 1 ? `<button type="button" class="mini" data-acao="nivel-subir" data-id="${e.id}" aria-label="Subir de nível: ${artigo(e.nivel)} ${tipo} ${e.numero} vira ${nomeNivel(e.nivel - 1)}" title="Subir de nível: vira ${nomeNivel(e.nivel - 1)}">↖</button>` : ''}
          ${podeDescer ? `<button type="button" class="mini" data-acao="nivel-descer" data-id="${e.id}" aria-label="Descer de nível: ${artigo(e.nivel)} ${tipo} ${e.numero} entra em ${irmas[k - 1].numero} e vira ${nomeNivel(e.nivel + 1)}" title="Descer de nível: entra em ${esc(irmas[k - 1].numero)} e vira ${nomeNivel(e.nivel + 1)}">↘</button>` : ''}
          </span><button type="button" class="mini excluir-etapa" data-acao="etapa-excluir" data-id="${e.id}" aria-label="Excluir ${artigo(e.nivel)} ${tipo} ${e.numero}" title="Excluir ${artigo(e.nivel)} ${tipo} ${e.numero}">✕</button>
        </td>
      </tr>
      ${e.itens.map((i) => { const cl = classe.get(`${i.tipo}|${i.base}|${i.codigo}`) || 'C', peso = i.total / somaEtapas; return `<tr class="item${ORC.destaque === `${i.tipo}|${i.base}|${i.codigo}` ? ' destaque' : ''}" data-item="${i.id}">
        <td class="n"><button type="button" class="pega" data-pega="item" data-id="${i.id}" aria-label="Mover o item ${i.numero}: arraste ou use as setas para cima e para baixo" title="Arraste para mudar a ordem ou a etapa">⠿</button>${i.numero}</td>
        <td class="cod">${codLink(i.tipo, i.base, i.codigo, { ...mesDoItem(o, i), orc: o.id })}</td>
        <td class="desc">${esc(i.descricao)}${ORC.analitico ? divisaoItem(i) : ''}${i.referencia && i.referencia !== o.referencia ? `<span class="ref-item" title="Este item não existe em ${esc(nomeRef(o.referencia))} e ficou com o preço de ${esc(nomeRef(i.referencia))}">preço de ${esc(nomeRef(i.referencia))}</span>` : ''}${i.total > 0 ? `<span class="regua regua-${cl}" role="img" style="--p:${Math.max(0.6, (i.total / maiorItem) * 100).toFixed(2)}%" title="${pct.format(peso)} do total · classe ${cl} da curva ABC" aria-label="${pct.format(peso)} do total, classe ${cl}"></span>` : ''}</td>
        <td class="c-un">${unid(i.unidade)}</td>
        <td class="num c-qtd"><input class="qtd" inputmode="decimal" value="${qtdFmt.format(i.quantidade)}" data-item="${i.id}" aria-label="Quantidade do item ${i.numero}"></td>
        <td class="num c-custo" data-rotulo="Custo unit."${o.bdi_no_total ? ' colspan="2"' : ''}>${money(i.custo_unit)}</td>
        ${o.bdi_no_total ? '' : `<td class="num c-preco" data-rotulo="Preço c/ BDI">${money(i.preco_unit)}</td>`}
        <td class="num total c-total" data-rotulo="Total">${money(i.total)}</td>
        <td class="ctrl">
          <button type="button" class="mini" data-acao="item-excluir" data-id="${i.id}" aria-label="Excluir item ${i.numero}">✕</button>
        </td></tr>`; }).join('')}
    </tbody>`; }).join('');
  const temNivel = (n) => o.etapas.some((e) => e.nivel === n && (filhas(e).length || e.itens.length));
  const filtrada = ORC.filtro && visiveis[0];
  $('#orc-corpo').innerHTML = `
    ${o.etapas.length > 1 ? `<div class="plan-barra">
      <div class="segmentos plan-niveis" role="group" aria-label="Mostrar na planilha">
        <button type="button" data-plan-nivel="1" aria-pressed="false">Só células</button>
        ${temNivel(2) ? '<button type="button" data-plan-nivel="2" aria-pressed="false">Até etapas</button>' : ''}
        <button type="button" data-plan-nivel="tudo" aria-pressed="false">Tudo aberto</button></div>
      <button type="button" class="botao botao-p plan-anal" data-analitico aria-pressed="${ORC.analitico}" title="Mostrar ou esconder a divisão do custo em reais em cada célula construtiva e etapa">${ORC.analitico ? '✓ ' : ''}Mão de obra e material</button>
      ${ORC.analitico ? `<span class="anal-leg" aria-hidden="true">${ANALITICO.map(([, n, cor]) => `<span style="--cor:var(${cor})"><i></i>${n}</span>`).join('')}<em>custo direto, sem BDI</em></span>` : ''}
      <p class="plan-dica"><kbd>↑</kbd><kbd>↓</kbd> ou <kbd>Enter</kbd> andam entre as quantidades · <kbd>Esc</kbd> desfaz · ↖ ↘ mudam o nível</p></div>` : ''}
    ${filtrada ? `<p class="filtro-ativo">Mostrando só ${artigo(filtrada.nivel)} ${nomeNivel(filtrada.nivel)} <b>${filtrada.numero}. ${esc(filtrada.titulo)}</b><button type="button" class="link-acao" data-ver-todas>Ver o orçamento inteiro</button></p>` : ''}
    <table class="planilha planilha-orc${o.bdi_no_total ? ' bdi-no-total' : ''}">
      <thead><tr><th>Item</th><th>Código</th><th>Descrição</th><th>Un.</th><th class="num">Quant.</th><th class="num"${o.bdi_no_total ? ' colspan="2"' : ''}>Custo unit.</th>${o.bdi_no_total ? '' : '<th class="num c-preco">Preço c/ BDI</th>'}<th class="num">${o.bdi_no_total ? 'Total sem BDI' : 'Total'}</th><th></th></tr></thead>
      ${etapas}
    </table>
    ${barraAdicionar(o)}
    <p class="fonte">${o.bdi_no_total ? 'BDI aplicado uma única vez sobre o custo direto total: itens e etapas aparecem a custo, sem BDI.' : 'Preço com BDI e total por item arredondados em 2 casas.'} Custo unitário congelado na data-base em que o item entrou.${o.sem_complementares ? ' Custos unitários sem os encargos complementares da mão de obra.' : ''}${ORC.analitico ? ' A divisão em mão de obra, material, equipamento e terceiros é do custo direto, sem BDI.' : ''}</p>`;
  ligarPlanilha(o);
  aplicarRecolhidas(false);
}

// refaz os totais do orçamento no navegador, com a mesma conta e os mesmos arredondamentos do servidor
const arred2 = (v) => Math.round((v + Number.EPSILON) * 100) / 100;
function recalcular(o, mudar, manter) {
  const n = structuredClone(o), fator = n.bdi_no_total ? 1 : 1 + n.bdi / 100;
  let custo = 0, total = 0, qtd = 0;
  // a lista vem plana: cada nível seguido do que está dentro dele; o total de cada um inclui o de dentro
  if (manter) n.etapas.forEach((e) => { e.itens = e.itens.filter(manter); });
  const porId = new Map(n.etapas.map((e) => [e.id, e])), prox = new Map();
  let ne = 0;
  n.etapas.forEach((e) => {
    const mae = porId.get(e.pai_id);
    if (mae) { const k = (prox.get(mae.id) ?? mae.itens.length) + 1; prox.set(mae.id, k); e.numero = `${mae.numero}.${k}`; } else { ne += 1; e.numero = String(ne); }
    e.itens.forEach((i, ni) => {
      if (mudar) mudar(i);
      i.numero = `${e.numero}.${ni + 1}`;
      i.preco_unit = fator === 1 ? i.custo_unit : arred2(i.custo_unit * fator); i.custo_total = arred2(i.quantidade * i.custo_unit); i.total = arred2(i.quantidade * i.preco_unit);
    });
    e._c = e.itens.reduce((s, i) => s + i.custo_total, 0); e._t = e.itens.reduce((s, i) => s + i.total, 0);
    qtd += e.itens.length;
  });
  // de baixo para cima: cada nível fecha o seu total e o soma ao de cima (como no servidor)
  [...n.etapas].reverse().forEach((e) => {
    e.custo_total = arred2(e._c); e.total = arred2(e._t); delete e._c; delete e._t;
    const mae = porId.get(e.pai_id); if (mae) { mae._c += e.custo_total; mae._t += e.total; }
  });
  n.etapas.filter((e) => e.nivel === 1).forEach((e) => { custo += e.custo_total; total += e.total; });
  n.complementares = arred2(n.etapas.reduce((t, e) => t + e.itens.reduce((u, i) => u + i.quantidade * (i.custo_compl || 0), 0), 0));
  n.custo_total = arred2(custo); n.qtd_itens = qtd;
  const somaEtapas = total;
  if (n.bdi_no_total) { n.valor_bdi = arred2(n.custo_total * n.bdi / 100); n.total = arred2(n.custo_total + n.valor_bdi); }
  else { n.total = arred2(total); n.valor_bdi = arred2(total - custo); }
  n.etapas.forEach((e) => { e.peso = somaEtapas ? e.total / somaEtapas : 0; });
  return n;
}

function ligarPlanilha(o) {
  const corpo = $('#orc-corpo');
  const atualizar = (n, jaMedido) => {
    // quem anda pelas quantidades com o teclado diz para onde o cursor vai (o campo de agora é recriado ao redesenhar)
    const foco = ORC.focoProx ? { item: ORC.focoProx } : document.activeElement && { ...document.activeElement.dataset };
    const deslizar = jaMedido || medir('.planilha-orc tr.item, .planilha-orc tr.etapa-cab, .planilha-orc tr.add-linha', (el) => el.dataset.item ? `i${el.dataset.item}` : `${el.className}${el.closest('tbody').dataset.etapa || 'f' + el.closest('tbody').dataset.fimDe}`);
    return abrirOrcamento(n.id, n).then(() => { deslizar(); restaurarFoco(foco); });
  };
  // resposta do servidor a uma mudança já mostrada: se bate com o previsto, a tela só é refeita depois que os números
  // terminam de contar (para trazer a divisão do custo atualizada); se não bate, corrige na hora
  const confirmar = (n, previsto) => {
    if (n.total !== previsto.total || n.custo_total !== previsto.custo_total) return atualizar(n);
    const visto = ORC.atual; ORC.atual = n;
    // se a pessoa já está em outro campo (busca de item, nome de etapa, dados do orçamento, troca de data-base) ou arrastando uma linha, espera ela sair para não apagar o texto
    const ocupada = () => {
      const a = document.activeElement, caixa = $('#orc-mudar-mes');
      // numa quantidade, só conta como ocupada se a pessoa já começou a digitar (valor diferente do mostrado)
      return document.body.classList.contains('arrastando-algo') || (caixa && !caixa.hidden)
        || (!!a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) && (!a.classList.contains('qtd') || a.value !== a.defaultValue));
    };
    const refazer = () => {
      if (ORC.atual !== n || ORC.aba !== 'planilha' || !$('#orc-corpo')) { if (ORC.atual === visto) ORC.atual = n; return; }
      if (ocupada()) { setTimeout(refazer, 600); return; }
      // a planilha mostrada já é a certa (mesma conta do servidor, e a divisão de cada item não muda com a quantidade):
      // só o painel recebe a divisão do custo recalculada, sem redesenhar as centenas de linhas de novo
      window.desenharPainel(n);
    };
    setTimeout(refazer, 480);
    return Promise.resolve();
  };
  window.ligarArrastar(corpo, o, atualizar);
  corpo.addEventListener('change', async (e) => {
    const t = e.target;
    try {
      if (t.classList.contains('qtd')) {
        const v = lerNum(t.value);
        if (!(v >= 0)) { avisar('Digite uma quantidade válida, como 12,5.'); t.value = ''; return; }
        // a tela mostra o resultado na hora, com a mesma conta do servidor; a resposta dele confirma (ou desfaz, se falhar)
        const antes = ORC.atual, previsto = recalcular(antes, (i) => { if (String(i.id) === t.dataset.item) i.quantidade = v; });
        atualizar(previsto);
        try { confirmar(await req(`/api/itens/${t.dataset.item}`, 'PATCH', { quantidade: v }), previsto); }
        catch (err) { await atualizar(antes); avisar(`${esc(err.message)} A quantidade voltou ao valor anterior.`); }
      } else if (t.classList.contains('etapa-titulo') && t.value.trim()) {
        ORC.atual = await req(`/api/etapas/${t.dataset.etapa}`, 'PATCH', { titulo: t.value.trim() });
      }
    } catch (err) { avisar(esc(err.message)); }
  });
  corpo.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.classList.contains('qtd')) {
      // como numa planilha: setas e Enter andam entre as quantidades visíveis; Esc desfaz o que foi digitado
      if (e.key === 'Escape') { e.preventDefault(); t.value = t.defaultValue; t.select(); return; }
      // quantidade do serviço que acabou de entrar pela barra de baixo: o Enter grava e volta à busca, para lançar o próximo
      if (e.key === 'Enter' && !e.shiftKey && ORC.voltarBusca && ORC.voltarBusca === t.dataset.item) {
        e.preventDefault(); ORC.voltarBusca = null; t.blur();
        setTimeout(() => { const b = $('#pa-busca'); if (b && (!document.activeElement || document.activeElement === document.body)) b.focus({ preventScroll: true }); }, 60);
        return;
      }
      const ir = e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey) ? 1 : e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 0;
      if (!ir) return;
      e.preventDefault();
      const todas = [...corpo.querySelectorAll('.qtd')].filter((x) => x.offsetParent !== null);
      const prox = todas[todas.indexOf(t) + ir];
      if (!prox) { t.blur(); return; }
      prox.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      // se o valor mudou, o "change" da linha anterior grava e recalcula já dentro deste focus(), e o redesenho
      // devolve o cursor para `focoProx`
      ORC.focoProx = prox.dataset.item;
      prox.focus({ preventScroll: true }); ORC.focoProx = null;
      if (document.body.contains(prox)) prox.select();
      return;
    }
    if (e.key === 'Enter' && t.classList.contains('etapa-titulo')) { e.preventDefault(); t.blur(); }
  });
  // anel de foco que desliza de uma quantidade para a outra
  corpo.addEventListener('focusin', (e) => { if (e.target.classList.contains('qtd')) moverAnel(e.target); });
  corpo.addEventListener('focusout', () => setTimeout(() => { const a = document.activeElement; if (!a || !a.classList || !a.classList.contains('qtd')) esconderAnel(); }, 0));
  corpo.addEventListener('click', (e) => {
    const b = e.target.closest('[data-recolher]');
    if (b) { alternarEtapa(Number(b.dataset.recolher)); return; }
    const nv = e.target.closest('[data-plan-nivel]');
    if (nv) {
      const n = Number(nv.dataset.planNivel);  // 1: só as células; 2: células e etapas; "tudo": nada recolhido
      ORC.recolhidas = n ? new Set(ORC.atual.etapas.filter((x) => x.nivel === n).map((x) => x.id)) : new Set();
      gravarRecolhidas(); aplicarRecolhidas(true);
    }
    if (e.target.closest('[data-analitico]')) {
      ORC.analitico = !ORC.analitico; try { localStorage.setItem('orc-analitico', ORC.analitico ? 'sim' : 'nao'); } catch (_) { /* ok */ }
      abrirOrcamento(o.id, ORC.atual);
    }
    const ab = e.target.closest('[data-acao="item-abrir"]');
    if (ab) {
      const caixa = document.getElementById(`add-${ab.dataset.id}`);
      ab.hidden = true; ab.setAttribute('aria-expanded', 'true'); caixa.hidden = false; caixa.querySelector('.add-q').focus();
    }
  });
  corpo.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-acao]'); if (!b) return;
    const id = b.dataset.id;
    try {
      const a = b.dataset.acao;
      if (a === 'item-excluir') {
        // a linha sai na hora; se o servidor recusar, ela volta
        const antes = ORC.atual, previsto = recalcular(antes, null, (i) => String(i.id) !== id);
        atualizar(previsto);
        try { const r = await req(`/api/itens/${id}`, 'DELETE'); confirmar(r, previsto); avisarDesfazer('Item excluído.', r.desfazer); }
        catch (err) { await atualizar(antes); avisar(`${esc(err.message)} O item não foi excluído.`); }
      }
      if (a === 'etapa-excluir') {
        const et = o.etapas.find((x) => String(x.id) === id);
        const dentro = [et, ...descendentesDe(o, et.id)];
        const ni = dentro.reduce((s, x) => s + x.itens.length, 0);
        const r = await req(`/api/etapas/${id}`, 'DELETE'); await atualizar(r);
        const partes = [2, 3].map((nv) => { const q = dentro.filter((x) => x !== et && x.nivel === nv).length; return q ? `${q} ${nomeNivel(nv, q !== 1)}` : ''; });
        const com = juntar([...partes, ni ? `${ni} ${ni === 1 ? 'item' : 'itens'}` : ''].filter(Boolean));
        avisarDesfazer(`${NomeNivel(et.nivel)} "${esc(et.titulo)}" excluída${com ? `, com ${com}` : ''}.`, r.desfazer);
      }
      if (a === 'filha-nova') {
        const r = await req(`/api/orcamentos/${o.id}/etapas`, 'POST', { titulo: `Nova ${nomeNivel(Number(b.dataset.nivel))}`, pai_id: Number(id) });
        ORC.recolhidas.delete(Number(id)); gravarRecolhidas();
        await atualizar(r);
        const t = document.querySelector(`.etapa-titulo[data-etapa="${r.etapa_criada}"]`); if (t) { t.focus(); t.select(); }
      }
      if (a === 'nivel-subir' || a === 'nivel-descer') {
        const et = o.etapas.find((x) => String(x.id) === id);
        const r = await req(`/api/etapas/${id}/nivel?sentido=${a === 'nivel-subir' ? 'subir' : 'descer'}`, 'POST');
        await atualizar(r);
        const nova = r.etapas.find((x) => x.id === et.id);
        if (nova) {
          if (nova.pai_id) { ORC.recolhidas.delete(nova.pai_id); gravarRecolhidas(); aplicarRecolhidas(false); }
          avisar(`"${esc(et.titulo)}" agora é ${nomeNivel(nova.nivel)} (${nova.numero}).`);
          const t = document.querySelector(`.etapa-titulo[data-etapa="${et.id}"]`); if (t) t.scrollIntoView({ block: 'nearest', behavior: semMovimento() ? 'auto' : 'smooth' });
        }
      }
    } catch (err) { avisar(esc(err.message)); }
  });
  corpo.addEventListener('click', (e) => { if (e.target.closest('[data-ver-todas]')) { ORC.filtro = null; abrirOrcamento(o.id, ORC.atual); } });
  const barra = $('#form-etapa');
  barra.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pa-modo]'); if (!b) return;
    ORC.addModo = b.dataset.paModo; barra.dataset.modo = ORC.addModo;
    barra.querySelectorAll('[data-pa-modo]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    barra.querySelector('.pa-item').hidden = ORC.addModo !== 'item'; barra.querySelector('.pa-etapa').hidden = ORC.addModo !== 'etapa';
    (ORC.addModo === 'item' ? $('#pa-busca') : $('#nova-etapa')).focus(); marcarDestino();
  });
  $('#pa-destino').addEventListener('change', (e) => { ORC.destino = e.target.value; $('#pa-busca').dataset.etapa = e.target.value; marcarDestino(); $('#pa-busca').focus(); });
  $('#pa-pai').addEventListener('change', (e) => { ORC.onde = e.target.value; $('#nova-etapa').placeholder = DICA_NOME[nivelDoOnde(ORC.atual, ORC.onde)]; marcarDestino(); $('#nova-etapa').focus(); });
  barra.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = $('#nova-etapa').value.trim(); if (!v) { $('#nova-etapa').focus(); return; }
    const pai = ORC.onde ? Number(ORC.onde) : undefined;
    const r = await req(`/api/orcamentos/${o.id}/etapas`, 'POST', pai ? { titulo: v, pai_id: pai } : { titulo: v });
    const nova = r.etapas.find((x) => x.id === r.etapa_criada);
    if (pai) { ORC.recolhidas.delete(pai); gravarRecolhidas(); }
    // o próximo passo provável já fica escolhido: dentro da célula, uma etapa; dentro da etapa, uma subetapa; na subetapa, os serviços
    if (nova) {
      if (nova.nivel < 3) ORC.onde = nova.id;
      if (nova.nivel >= 2) ORC.destino = nova.id;
      if (nova.nivel === 3) ORC.addModo = 'item';
    }
    await atualizar(r);
    avisar(`${VISTO}${nova ? NomeNivel(nova.nivel) : 'Etapa'} "${esc(v)}" criada${nova ? ` (${nova.numero})` : ''}.`);
    const alvo = ORC.addModo === 'item' ? $('#pa-busca') : $('#nova-etapa'); if (alvo) alvo.focus({ preventScroll: true });
    const t = nova && document.querySelector(`tbody[data-etapa="${nova.id}"]`); if (t) t.scrollIntoView({ block: 'nearest', behavior: semMovimento() ? 'auto' : 'smooth' });
  });
  // atalho: clicar no número de uma linha a escolhe como destino na barra de baixo
  corpo.addEventListener('click', (e) => {
    const td = e.target.closest('.etapa-cab td.n'); if (!td || e.target.closest('button')) return;
    const et = ORC.atual.etapas.find((x) => String(x.id) === td.closest('tbody').dataset.etapa); if (!et) return;
    const dest = opcoesDestino(ORC.atual).find((x) => x.id === et.id && x.ok);
    if (dest) { ORC.destino = et.id; $('#pa-destino').value = String(et.id); $('#pa-busca').dataset.etapa = String(et.id); }
    if (et.nivel < 3) { ORC.onde = et.id; $('#pa-pai').value = String(et.id); $('#nova-etapa').placeholder = DICA_NOME[et.nivel + 1]; }
    marcarDestino();
    avisar(`${et.numero}. ${esc(et.titulo)} escolhida na barra de baixo${dest ? ' para os serviços' : ''}${et.nivel < 3 ? `${dest ? ' e' : ''} para a nova ${nomeNivel(et.nivel + 1)}` : ''}.`);
  });
  marcarDestino();
  corpo.querySelectorAll('.add-q').forEach(ligarBuscaInline);
}
// a linha escolhida na barra de baixo fica marcada na planilha
function marcarDestino() {
  const corpo = $('#orc-corpo'); if (!corpo) return;
  const modo = ORC.addModo || 'item', alvo = String(modo === 'item' ? ORC.destino : ORC.onde);
  corpo.querySelectorAll('tbody.etapa').forEach((tb) => tb.classList.toggle('destino', !!alvo && tb.dataset.etapa === alvo));
}

// ---------- recolher etapas ----------
function aplicarRecolhidas(animar) {
  const corpo = $('#orc-corpo'); if (!corpo) return;
  const paiDe = new Map([...corpo.querySelectorAll('tbody.etapa')].map((tb) => [Number(tb.dataset.etapa), Number(tb.dataset.pai) || null]));
  const ancRec = (id) => { for (let p = paiDe.get(id); p; p = paiDe.get(p)) if (ORC.recolhidas.has(p)) return true; return false; };
  corpo.querySelectorAll('tbody.etapa').forEach((tb) => {
    const id = Number(tb.dataset.etapa);
    const rec = ORC.recolhidas.has(id), maeRec = ancRec(id) && !ORC.filtro;
    const abriu = (tb.classList.contains('recolhida') && !rec) || (tb.classList.contains('mae-recolhida') && !maeRec);
    tb.classList.toggle('recolhida', rec); tb.classList.toggle('mae-recolhida', maeRec);
    const b = tb.querySelector('[data-recolher]');
    if (b) { b.setAttribute('aria-expanded', String(!rec)); b.setAttribute('aria-label', b.getAttribute('aria-label').replace(/^(Mostrar|Recolher)/, rec ? 'Mostrar' : 'Recolher')); b.title = rec ? 'Mostrar os itens' : 'Recolher'; }
    const r = tb.querySelector('.etapa-resumo'); if (r) r.setAttribute('aria-hidden', String(!rec));
    if (abriu && animar && !semMovimento()) { tb.classList.remove('abrindo'); void tb.offsetWidth; tb.classList.add('abrindo'); }
  });
  corpo.querySelectorAll('tbody.etapa-fim').forEach((tb) => { const id = Number(tb.dataset.fimDe); tb.classList.toggle('mae-recolhida', !ORC.filtro && (ORC.recolhidas.has(id) || ancRec(id))); });
  const et = ORC.atual ? ORC.atual.etapas : [];
  corpo.querySelectorAll('[data-plan-nivel]').forEach((b) => {
    const n = Number(b.dataset.planNivel), deste = et.filter((x) => x.nivel === n);
    b.setAttribute('aria-pressed', String(n ? deste.length > 0 && deste.every((x) => ORC.recolhidas.has(x.id)) && et.every((x) => x.nivel === n || !ORC.recolhidas.has(x.id)) : ORC.recolhidas.size === 0));
  });
  esconderAnel();
}
function alternarEtapa(id) {
  if (ORC.recolhidas.has(id)) ORC.recolhidas.delete(id); else ORC.recolhidas.add(id);
  gravarRecolhidas(); aplicarRecolhidas(true);
}

// ---------- anel de foco ----------
function moverAnel(el) {
  const corpo = $('#orc-corpo'); if (!corpo) return;
  let anel = corpo.querySelector('.anel-foco');
  if (!anel) { anel = document.createElement('span'); anel.className = 'anel-foco'; anel.setAttribute('aria-hidden', 'true'); corpo.appendChild(anel); }
  const rc = corpo.getBoundingClientRect(), r = el.getBoundingClientRect();
  const pos = { x: r.left - rc.left, y: r.top - rc.top, w: r.width, h: r.height };
  // depois de redesenhar, o anel nasce onde estava e desliza; sem anel anterior, só aparece
  if (!anel.classList.contains('visivel')) {
    const de = ORC.anel || pos;
    anel.style.transition = 'none';
    Object.assign(anel.style, { transform: `translate(${de.x}px, ${de.y}px)`, width: `${de.w}px`, height: `${de.h}px` });
    void anel.offsetWidth; anel.style.transition = '';
  }
  anel.classList.add('visivel');
  Object.assign(anel.style, { transform: `translate(${pos.x}px, ${pos.y}px)`, width: `${pos.w}px`, height: `${pos.h}px` });
  ORC.anel = pos;
}
function esconderAnel() { const a = document.querySelector('#orc-corpo .anel-foco'); if (a) a.classList.remove('visivel'); }

function restaurarFoco(foco) {
  if (!foco) return;
  let el = null;
  if (foco.item) el = document.querySelector(`.qtd[data-item="${foco.item}"]`);
  // sem rolar a página: quem redesenha é o sistema, e a pessoa pode já estar olhando outro ponto
  if (el) { el.focus({ preventScroll: true }); el.select(); return; }
  if (foco.pega) { el = document.querySelector(`.pega[data-pega="${foco.pega}"][data-id="${foco.id}"]`); if (el) el.focus({ preventScroll: true }); }
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
      const r = await req(`/api/busca?${new URLSearchParams({ q, limite: 8, ref: ORC.atual.referencia, refs: refsDoOrcamento(ORC.atual) })}`);
      if (meu !== seqLocal) return;
      itens = r.itens.filter((x) => x.preco != null);
      ul.innerHTML = itens.length ? itens.map((x, k) => `<li data-k="${k}" role="option"><span class="res-cod">${codigoBase(x.codigo, x.base)}<span class="tipo tipo-${x.tipo}">${x.tipo === 'servico' ? 'Composição' : 'Insumo'}</span></span>
          <span>${trecho(x)}</span><span class="add-preco">${brl.format(x.preco)}<span class="un">${unid(x.unidade)}</span></span></li>`).join('')
        : `<li class="nada" role="option" aria-disabled="true">Nada encontrado com preço em ${esc(nomeRef(ORC.atual.referencia))}.</li>`;
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
      const n = await req(`/api/orcamentos/${ORC.atual.id}/itens`, 'POST', { etapa_id: Number(inp.dataset.etapa) || null, tipo: x.tipo, base: x.base, codigo: x.codigo, quantidade: 1 });
      const deslizar = medir('.planilha-orc tr.item, .planilha-orc tr.etapa-cab, .planilha-orc tr.add-linha', (el) => el.dataset.item ? `i${el.dataset.item}` : `${el.className}${el.closest('tbody').dataset.etapa || 'f' + el.closest('tbody').dataset.fimDe}`);
      await abrirOrcamento(n.id, n); deslizar();
      const q = document.querySelector(`.qtd[data-item="${n.item_criado}"]`); if (q) { q.focus(); q.select(); }
      ORC.voltarBusca = String(n.item_criado);
      avisar(`${VISTO}${esc(x.codigo)}/${esc(rotuloBase(x.base, x.codigo))} adicionado. Digite a quantidade e Enter para voltar à busca.`);
    } catch (err) { avisar(esc(err.message)); }
  }
}

// o mês em que o item está no orçamento (cada base no seu calendário); a composição própria leva o mês de cada base
const mesDoItem = (o, i) => (i.base === 'PROPRIA' ? { refs: refsDoOrcamento(o) } : { ref: i.referencia || mesParaBase(i.base, o.referencia) });

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
      <td class="cod">${codLink(tipo === 'servicos' && l.tipo === 'servico' ? 'servico' : 'insumo', l.base, l.codigo, { ...mesDoItem(o, l), orc: o.id })}</td>
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
      ? `Serviços e insumos do orçamento ordenados pelo valor ${o.bdi_no_total ? 'a custo (o BDI deste orçamento entra só no total)' : 'com BDI'}. O mesmo código em etapas diferentes aparece somado.`
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
  if (novo) { et.innerHTML = '<option value="">Obra › Serviços preliminares</option>'; return; }
  const o = await req(`/api/orcamentos/${v}`);
  // os serviços entram numa etapa ou subetapa; a célula construtiva aparece só como título do grupo
  const temEtapa = o.etapas.some((e) => e.nivel >= 2);
  et.innerHTML = o.etapas.map((e) => (e.nivel === 1 && temEtapa
    ? `<option disabled>${e.numero}. ${esc(e.titulo)}</option>`
    : `<option value="${e.id}">${'\u00a0\u00a0\u00a0'.repeat(Math.max(0, e.nivel - 1))}${e.numero}. ${esc(e.titulo)}</option>`)).join('')
    + (temEtapa ? '' : '<option value="">Nova etapa "Serviços preliminares"</option>');
  const alvos = o.etapas.filter((e) => e.nivel >= 2);
  et.value = alvos.length ? String(alvos[alvos.length - 1].id) : '';
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
      const o = await req('/api/orcamentos', 'POST', { nome, bdi: 25, referencia: estado.meses.ORSE || estado.mes }); oid = o.id; etapa = o.etapas[0].id;
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
function conferirFaixaFixa() {
  const cab = document.querySelector('.ficha.orc .orc-cab'); if (!cab) return;
  const topo = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topo')) || 62;
  cab.closest('.ficha').classList.toggle('rolou', cab.getBoundingClientRect().bottom < topo);
}
window.addEventListener('scroll', conferirFaixaFixa, { passive: true });
