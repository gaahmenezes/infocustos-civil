'use strict';

const $ = (s, el = document) => el.querySelector(s);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const num2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });
const coef = (v) => v == null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 8 }).format(v);
const money = (v) => v == null ? '—' : num2.format(v);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SECOES = [
  ['EQUIPAMENTO', 'Equipamento', '--c-equip'],
  ['MAO_DE_OBRA', 'Mão de obra', '--c-mo'],
  ['MATERIAL', 'Material', '--c-mat'],
  ['SERVICO_TERCEIRO', 'Serviço de terceiro', '--c-terc'],
  ['SERVICO_AUXILIAR', 'Serviço auxiliar', '--c-equip'],
];
const NOME_SECAO = Object.fromEntries(SECOES.map(([k, n]) => [k, n]));
const SUGESTOES = ['alvenaria bloco cerâmico', 'concreto fck 25', 'piso porcelanato', 'pintura acrílica', 'tubo pvc esgoto 100', 'servente', 'escavação mecanizada', 'cimento'];

const estado = { q: '', base: 'todas', tipo: 'todos', itens: [], atual: null, ref: null };

async function api(url) {
  const r = await fetch(url);
  if (!r.ok) {
    let msg = `Erro ${r.status}`;
    try { msg = (await r.json()).detail || msg; } catch (_) { /* sem corpo */ }
    throw new Error(msg);
  }
  return r.json();
}

// ---------- referência ----------
async function carregarReferencia() {
  try {
    const ref = await api('/api/referencia');
    estado.ref = ref;
    const n = (t, b) => (ref.totais.find((x) => x.tipo === t && x.base === b) || {}).n || 0;
    const ant = (ref.referencias || []).length > 1 ? ref.referencias[ref.referencias.length - 2] : null;
    $('#referencia').innerHTML = `<strong>Referência ${esc(ref.descricao.replace('-1', ''))}</strong>` +
      (ant ? `<span class="ref-ant">comparando com ${esc(ant.descricao.replace('-1', ''))}</span>` : '') +
      `${(n('servico', 'ORSE') + n('servico', 'SINAPI')).toLocaleString('pt-BR')} serviços · ` +
      `${(n('insumo', 'ORSE') + n('insumo', 'SINAPI')).toLocaleString('pt-BR')} insumos`;
  } catch (e) { $('#referencia').textContent = 'Base indisponível'; }
}

// ---------- referências e histórico ----------
const nomeRef = (id) => {
  const r = estado.ref && (estado.ref.referencias || []).find((x) => x.id === id);
  return r ? r.descricao.replace(/-1$/, '') : (id || '');
};
const refAnterior = () => { const l = (estado.ref && estado.ref.referencias) || []; return l.length > 1 ? l[l.length - 2] : null; };

function seloVariacao(preco, anterior, novo) {
  if (novo) return `<span class="var var-novo" title="Não existia em ${esc(nomeRef(refAnterior() && refAnterior().id))}">novo</span>`;
  if (preco == null || !anterior) return '';
  const v = preco / anterior - 1;
  if (Math.abs(v) < 0.00005) return `<span class="var var-igual" title="Mesmo preço de ${esc(nomeRef(refAnterior().id))}">=</span>`;
  return `<span class="var ${v > 0 ? 'var-alta' : 'var-baixa'}" title="Em ${esc(nomeRef(refAnterior().id))}: ${brl.format(anterior)}">${v > 0 ? '+' : '−'}${pct.format(Math.abs(v))}</span>`;
}

function blocoHistorico(h, unidade) {
  if (!h || h.length < 2) return '';
  const vals = h.map((x) => x.preco).filter((v) => v != null);
  const max = Math.max(...vals, 0.01);
  const cols = h.map((x) => `<div class="hist-col${x.preco == null ? ' hist-vazio' : ''}">
      <span class="hist-barra"><i style="height:${x.preco == null ? 0 : Math.max(4, (x.preco / max) * 100)}%"></i></span>
      <b>${x.preco == null ? '—' : brl.format(x.preco)}</b>
      <span class="hist-ref">${esc(x.descricao.replace(/-1$/, ''))}</span>
      ${x.variacao == null ? (x.preco == null ? '<span class="hist-nota">fora da base</span>' : '') : `<span class="var ${x.variacao > 0.00005 ? 'var-alta' : x.variacao < -0.00005 ? 'var-baixa' : 'var-igual'}">${x.variacao > 0 ? '+' : x.variacao < 0 ? '−' : ''}${pct.format(Math.abs(x.variacao))}</span>`}
    </div>`).join('');
  return `<section class="historico" aria-label="Histórico de preço"><h3>Histórico de preço <span class="sub">por ${esc(unidade || '')}, em cada referência carregada</span></h3><div class="hist">${cols}</div></section>`;
}

function avisoReferencia(x) {
  if (x.referencia_atual !== false) return '';
  return `<p class="aviso-ref">Este item não está na referência ${esc(nomeRef(estado.ref.id))}. Os valores abaixo são de ${esc(nomeRef(x.referencia))}, a última em que ele aparece.</p>`;
}

// ---------- busca ----------
let tBusca = 0, seq = 0;
function agendarBusca() { clearTimeout(tBusca); tBusca = setTimeout(buscar, 140); }

async function buscar() {
  const meu = ++seq;
  const p = new URLSearchParams({ q: estado.q, base: estado.base, tipo: estado.tipo, limite: 80 });
  $('#exportar-busca').href = `/api/exportar/busca.xlsx?${new URLSearchParams({ q: estado.q, base: estado.base, tipo: estado.tipo })}`;
  document.body.classList.toggle('tem-busca', true);
  try {
    const r = await api(`/api/busca?${p}`);
    if (meu !== seq) return;
    estado.itens = r.itens;
    desenharLista(r);
  } catch (e) {
    $('#contagem').textContent = e.message;
  }
}

function trecho(item) {
  if (!item.trecho) return esc(item.descricao);
  return esc(item.trecho).replace(/\u0001/g, '<mark>').replace(/\u0002/g, '</mark>');
}

function desenharLista(r) {
  const lista = $('#lista');
  lista.innerHTML = '';
  const t = r.total;
  $('#contagem').textContent = !estado.q
    ? 'Itens mais usados nas composições'
    : t === 0 ? 'Nada encontrado. Tente menos palavras ou só o começo delas.'
      : `${t.toLocaleString('pt-BR')} ${t === 1 ? 'resultado' : 'resultados'}${t > r.itens.length ? ` · mostrando ${r.itens.length}` : ''}`;
  const tpl = $('#tpl-resultado');
  r.itens.forEach((it, i) => {
    const li = tpl.content.cloneNode(true);
    const b = li.querySelector('.res');
    b.dataset.i = i;
    b.querySelector('.res-cod').innerHTML = `${esc(it.codigo)}/${esc(it.base)}<span class="tag">${it.tipo === 'servico' ? 'serviço' : 'insumo'}</span>`;
    b.querySelector('.res-desc').innerHTML = trecho(it);
    const meta = [it.unidade, it.grupo || (it.tipo === 'insumo' ? it.categoria : ''),
      it.tipo === 'insumo' && it.usos ? `em ${it.usos.toLocaleString('pt-BR')} composições` : ''].filter(Boolean);
    b.querySelector('.res-meta').textContent = meta.join(' · ');
    b.querySelector('.res-preco').innerHTML = (it.preco == null ? 'sem preço' : brl.format(it.preco)) + seloVariacao(it.preco, it.preco_anterior, it.novo);
    if (estado.atual && estado.atual.base === it.base && estado.atual.codigo === it.codigo && estado.atual.tipo === it.tipo) b.setAttribute('aria-current', 'true');
    b.addEventListener('click', () => abrir(it.tipo, it.base, it.codigo));
    lista.appendChild(li);
  });
}

function marcarAtual() {
  document.querySelectorAll('.res').forEach((b) => {
    const it = estado.itens[b.dataset.i];
    const sim = estado.atual && it && it.base === estado.atual.base && it.codigo === estado.atual.codigo && it.tipo === estado.atual.tipo;
    b.toggleAttribute('aria-current', false);
    if (sim) { b.setAttribute('aria-current', 'true'); b.scrollIntoView({ block: 'nearest' }); }
  });
}

// ---------- navegação ----------
function abrir(tipo, base, codigo) {
  const h = `#/${tipo === 'servico' ? 'composicao' : 'insumo'}/${base}/${codigo}`;
  if (location.hash !== h) location.hash = h; else rota();
}

async function rota() {
  const emOrc = /^#\/orcamento/.test(location.hash);
  const emVar = /^#\/variacao/.test(location.hash);
  document.body.classList.toggle('modo-orc', emOrc || emVar);
  const aba = emOrc ? 'orcamentos' : emVar ? 'variacao' : 'consulta';
  document.querySelectorAll('.abas a').forEach((a) => a.setAttribute('aria-current', String(a.dataset.aba === aba)));
  if (emOrc) { window.rotaOrcamento && window.rotaOrcamento(); return; }
  if (emVar) { desenharVariacao(); return; }
  const m = location.hash.match(/^#\/(composicao|insumo)\/(ORSE|SINAPI)\/(\w+)/);
  if (!m) {
    document.body.classList.remove('ver-detalhe');
    if (!$('#inicio')) $('#detalhe').innerHTML = inicioHTML;
    return;
  }
  const [, tipo, base, codigo] = m;
  estado.atual = { tipo: tipo === 'composicao' ? 'servico' : 'insumo', base, codigo };
  marcarAtual();
  document.body.classList.add('ver-detalhe');
  const d = $('#detalhe');
  d.innerHTML = '<p class="carregando">Abrindo…</p>';
  try {
    if (tipo === 'composicao') desenharComposicao(await api(`/api/composicao/${base}/${codigo}`));
    else desenharInsumo(await api(`/api/insumo/${base}/${codigo}`));
    d.scrollTop = 0;
  } catch (e) {
    d.innerHTML = `<div class="erro"><b>Não foi possível abrir ${esc(codigo)}/${esc(base)}.</b><br>${esc(e.message)}</div>`;
  }
}

function botaoVoltar() {
  return '<button type="button" class="botao voltar" onclick="history.back()">Voltar aos resultados</button>';
}

// ---------- composição ----------
function resumoPelosItens(c) {
  // Algumas bases (ex.: SINAPI no relatório da CEHOP) não trazem o resumo por categoria; calcula pelos itens.
  const soma = (k) => c.itens.filter((i) => i.secao === k).reduce((s, i) => s + (i.custo_total || 0), 0);
  const moTotal = soma('MAO_DE_OBRA'); const enc = (c.encargo_social || 0) / 100;
  const fator = c.custo_total && (soma('EQUIPAMENTO') + moTotal + soma('MATERIAL') + soma('SERVICO_TERCEIRO') + soma('SERVICO_AUXILIAR'));
  const k = fator ? c.custo_total / fator : 1;
  return {
    custo_equipamento: soma('EQUIPAMENTO') * k, custo_mao_de_obra: moTotal / (1 + enc) * k,
    custo_encargo_social: (moTotal - moTotal / (1 + enc)) * k, custo_material: (soma('MATERIAL') + soma('SERVICO_AUXILIAR')) * k,
    custo_servico_terceiro: soma('SERVICO_TERCEIRO') * k, calculado: true,
  };
}

function barraCusto(c) {
  const temResumo = (c.custo_equipamento || 0) + (c.custo_mao_de_obra || 0) + (c.custo_material || 0) + (c.custo_servico_terceiro || 0) > 0;
  if (!temResumo && c.modelo !== 'DNIT') c = { ...c, ...resumoPelosItens(c) };
  const partes = [
    ['Equipamento', c.custo_equipamento, '--c-equip'],
    ['Mão de obra', c.custo_mao_de_obra, '--c-mo'],
    ['Encargo social', c.custo_encargo_social, '--c-enc'],
    ['Material', c.custo_material, '--c-mat'],
    ['Serviço de terceiro', c.custo_servico_terceiro, '--c-terc'],
  ];
  const soma = partes.reduce((s, p) => s + (p[1] || 0), 0);
  if (soma <= 0) return '<p class="sub">O relatório da base não detalha o custo desta composição por categoria.</p>';
  const barras = partes.filter((p) => p[1] > 0)
    .map((p) => `<span style="flex-grow:${p[1]};background:var(${p[2]})" title="${p[0]}: ${brl.format(p[1])}"></span>`).join('');
  const leg = partes.map((p) => `<div style="--cor:var(${p[2]})">${p[0]}<b>${brl.format(p[1] || 0)}</b><span class="pct">${pct.format((p[1] || 0) / soma)}</span></div>`).join('');
  const nota = c.calculado ? '<p class="fonte" style="margin-top:8px">Divisão por categoria calculada a partir dos itens; a base informa só o custo total.</p>' : '';
  return `<div class="custo" aria-label="Composição do custo"><div class="barra">${barras}</div><div class="legenda">${leg}</div>${nota}</div>`;
}

function linhaItem(i, total, nivel = 0) {
  const peso = total > 0 ? Math.min(100, (i.custo_total / total) * 100) : 0;
  const tipoLink = i.eh_servico ? 'servico' : 'insumo';
  const exp = i.tem_composicao
    ? `<button type="button" class="expandir" aria-expanded="false" aria-label="Mostrar a composição de ${esc(i.codigo)}" data-base="${esc(i.base)}" data-cod="${esc(i.codigo)}" data-nivel="${nivel + 1}" data-qtd="${i.qtd ?? ''}">+</button>`
    : '';
  const cls = nivel ? `filho" style="--nivel:${nivel}` : '';
  return `<tr class="${cls}">
    <td class="cod">${exp}<a href="#/${tipoLink === 'servico' ? 'composicao' : 'insumo'}/${esc(i.base)}/${esc(i.codigo)}">${esc(i.codigo)}</a>/${esc(i.base)}</td>
    <td class="desc">${esc(i.descricao)}</td>
    <td class="col-unit">${esc(i.unidade)}</td>
    <td class="num col-coef">${coef(i.qtd)}</td>
    <td class="num">${money(i.custo_unit)}</td>
    <td class="num">${money(i.custo_total)}${nivel ? '' : `<span class="peso" title="${pct.format(peso / 100)} do custo"><i style="width:${peso}%"></i></span>`}</td>
  </tr>`;
}

function desenharComposicao(c) {
  estado.comp = c;
  const dnit = c.modelo === 'DNIT';
  const total = c.custo_total;
  const grupos = SECOES.map(([k, nome, cor]) => [k, nome, cor, c.itens.filter((i) => i.secao === k)]).filter((g) => g[3].length);
  const corpo = grupos.map(([k, nome, cor, itens]) => {
    const soma = itens.reduce((s, i) => s + (i.custo_total || 0), 0);
    const nota = k === 'MAO_DE_OBRA' && c.encargo_social ? `<span class="nota">com encargo social de ${num2.format(c.encargo_social)}%</span>` : '';
    const notaDnit = dnit && (k === 'EQUIPAMENTO' || k === 'MAO_DE_OBRA') ? `<span class="nota">custo horário da equipe</span>` : '';
    return `<tbody data-secao="${k}">
      <tr class="secao"><td colspan="6"><button type="button" class="secao-bt" aria-expanded="true" style="--cor:var(${cor})">
        <span class="tri"></span><span class="ponto"></span>${nome} <span class="nota">${itens.length} ${itens.length === 1 ? 'item' : 'itens'}</span>${nota}${notaDnit}
        <span class="soma">${brl.format(soma)}</span></button></td></tr>
      ${itens.map((i) => linhaItem(i, dnit && k !== 'SERVICO_AUXILIAR' ? 0 : total)).join('')}
    </tbody>`;
  }).join('');
  const ref = estado.ref ? estado.ref.descricao.replace('-1', '') : '';
  $('#detalhe').innerHTML = `<article class="ficha">
    ${botaoVoltar()}
    <div class="ficha-cod">${esc(c.codigo)}/${esc(c.base)} <span class="selo">${dnit ? 'Composição padrão DNIT' : 'Composição analítica'}</span>${c.grupo ? `<span>${esc(c.grupo)}${c.subgrupo ? ' › ' + esc(c.subgrupo) : ''}</span>` : ''}</div>
    <h2>${esc(c.descricao || 'Composição sem descrição na base')}</h2>
    ${avisoReferencia(c)}
    <div class="ficha-linha">
      <div class="preco-grande"><span class="valor">${brl.format(total)}</span><span class="por">por ${esc(c.unidade)}${dnit && c.prod_equipe ? ` · produção da equipe ${num2.format(c.prod_equipe)} ${esc(c.unidade)}/h` : ''}</span></div>
      <div class="fatos">
        <div>Itens<b>${c.itens.length}</b></div>
        ${c.usada_em ? `<div>Usada em<b>${c.usada_em} composições</b></div>` : ''}
        <div>Data-base<b>${esc(nomeRef(c.referencia) || ref)}</b></div>
      </div>
      <div class="acoes">
        <button type="button" class="botao primario" data-adicionar="servico" data-base="${esc(c.base)}" data-cod="${esc(c.codigo)}" data-desc="${esc(c.descricao)}" data-un="${esc(c.unidade)}">Adicionar ao orçamento</button>
        <a class="botao" href="/api/exportar/composicao/${esc(c.base)}/${esc(c.codigo)}.xlsx">Exportar Excel</a>
        <button type="button" class="botao" onclick="window.print()">Imprimir ou PDF</button>
      </div>
    </div>
    ${barraCusto(c)}
    ${blocoHistorico(c.historico, c.unidade)}
    <table class="arvore">
      <thead><tr><th>Código</th><th>Descrição</th><th class="col-unit">Un.</th><th class="num col-coef">${dnit ? 'Qtd.' : 'Coeficiente'}</th><th class="num">${dnit ? 'Custo prod.' : 'Custo unit.'}</th><th class="num">Custo total</th></tr></thead>
      ${corpo}
    </table>
    ${dnit ? '<p class="fonte">No modelo DNIT, equipamentos e mão de obra formam o custo horário da equipe, que é dividido pela produção da equipe. Serviços auxiliares entram por unidade.</p>' : ''}
    <p class="fonte">Fonte: ${esc(c.base)}, referência ${esc(ref)}. Valores em R$, sem BDI.</p>
  </article>`;
  if (dnit) ajustarDnit(c);
}

function ajustarDnit(c) {
  // No DNIT, o custo exibido do equipamento é o custo horário total (produtivo + improdutivo).
  document.querySelectorAll('tbody[data-secao="EQUIPAMENTO"] tr:not(.secao)').forEach((tr, k) => {
    const i = c.itens.filter((x) => x.secao === 'EQUIPAMENTO')[k];
    if (i && i.custo_prod != null) tr.children[4].textContent = money(i.custo_prod);
  });
}

async function expandir(bt) {
  const aberto = bt.getAttribute('aria-expanded') === 'true';
  const tr = bt.closest('tr');
  if (aberto) {
    let n = tr.nextElementSibling;
    const nivel = Number(bt.dataset.nivel);
    while (n && n.classList.contains('filho') && Number(n.style.getPropertyValue('--nivel')) >= nivel) {
      const prox = n.nextElementSibling; n.remove(); n = prox;
    }
    bt.setAttribute('aria-expanded', 'false'); bt.textContent = '+';
    return;
  }
  bt.disabled = true;
  try {
    const sub = await api(`/api/composicao/${bt.dataset.base}/${bt.dataset.cod}`);
    const nivel = Number(bt.dataset.nivel);
    const cab = `<tr class="filho" style="--nivel:${nivel}"><td class="cod"></td><td class="desc" colspan="5"><span class="rotulo-sub">Composição de ${esc(sub.codigo)}/${esc(sub.base)}, por ${esc(sub.unidade)}: ${brl.format(sub.custo_total)}</span></td></tr>`;
    tr.insertAdjacentHTML('afterend', cab + sub.itens.map((i) => linhaItem(i, sub.custo_total, nivel)).join(''));
    bt.setAttribute('aria-expanded', 'true'); bt.textContent = '−';
  } catch (e) { alert(e.message); }
  bt.disabled = false;
}

// ---------- insumo ----------
function desenharInsumo(i) {
  const ref = estado.ref ? estado.ref.descricao.replace('-1', '') : '';
  const mo = i.tipo === 'PESSOAL' && estado.ref;
  const comEnc = mo ? i.preco * (1 + estado.ref.encargo_social_horista / 100) : null;
  const linhas = i.usos.map((u) => `<tr>
      <td class="cod"><a href="#/composicao/${esc(u.base)}/${esc(u.codigo)}">${esc(u.codigo)}</a>/${esc(u.base)}</td>
      <td>${esc(u.descricao)}</td>
      <td class="num">${coef(u.qtd)} </td>
      <td class="num">${money(u.custo_total)}</td>
      <td class="num">${u.preco_composicao ? pct.format(u.custo_total / u.preco_composicao) : '—'}</td>
    </tr>`).join('');
  $('#detalhe').innerHTML = `<article class="ficha">
    ${botaoVoltar()}
    <div class="ficha-cod">${esc(i.codigo)}/${esc(i.base)} <span class="selo">Insumo</span><span>${esc(i.tipo)} › ${esc(i.grupo)}${i.subgrupo ? ' › ' + esc(i.subgrupo) : ''}</span></div>
    <h2>${esc(i.descricao || 'Insumo sem descrição na base')}</h2>
    ${avisoReferencia(i)}
    <div class="ficha-linha">
      <div class="preco-grande"><span class="valor">${i.preco == null ? 'Sem preço' : brl.format(i.preco)}</span><span class="por">por ${esc(i.unidade)}${i.marcador ? ' · preço marcado com # na base' : ''}</span></div>
      <div class="fatos">
        ${mo ? `<div>Com encargo social de ${num2.format(estado.ref.encargo_social_horista)}%<b>${brl.format(comEnc)} por ${esc(i.unidade)}</b></div>` : ''}
        <div>Usado em<b>${i.usado_em.toLocaleString('pt-BR')} composições</b></div>
        <div>Data-base<b>${esc(nomeRef(i.referencia) || ref)}</b></div>
      </div>
      ${i.preco == null ? '' : `<div class="acoes"><button type="button" class="botao primario" data-adicionar="insumo" data-base="${esc(i.base)}" data-cod="${esc(i.codigo)}" data-desc="${esc(i.descricao)}" data-un="${esc(i.unidade)}">Adicionar ao orçamento</button></div>`}
    </div>
    ${blocoHistorico(i.historico, i.unidade)}
    ${i.usado_em ? `<h3>Onde este insumo pesa mais</h3>
    <p class="sub">Composições ordenadas pela participação do insumo no custo${i.usado_em > i.usos.length ? `; mostrando ${i.usos.length} de ${i.usado_em.toLocaleString('pt-BR')}` : ''}.</p>
    <table class="uso"><thead><tr><th>Composição</th><th>Descrição</th><th class="num">Coeficiente</th><th class="num">Custo no serviço</th><th class="num">Participação</th></tr></thead><tbody>${linhas}</tbody></table>`
    : '<p class="sub" style="margin-top:20px">Nenhuma composição desta referência usa este insumo.</p>'}
    <p class="fonte">Fonte: ${esc(i.base)}, referência ${esc(ref)}.</p>
  </article>`;
}

// ---------- eventos ----------
$('#form-busca').addEventListener('submit', (e) => { e.preventDefault(); buscar(); });
$('#q').addEventListener('input', (e) => { estado.q = e.target.value; agendarBusca(); });
$('#q').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'Enter') {
    const p = document.querySelector('.res'); if (p) { e.preventDefault(); if (e.key === 'Enter') p.click(); else p.focus(); }
  }
});
$('#lista').addEventListener('keydown', (e) => {
  const b = e.target.closest('.res'); if (!b) return;
  const li = b.parentElement;
  if (e.key === 'ArrowDown' && li.nextElementSibling) { e.preventDefault(); li.nextElementSibling.firstElementChild.focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); (li.previousElementSibling ? li.previousElementSibling.firstElementChild : $('#q')).focus(); }
});
document.querySelectorAll('.segmentos').forEach((g) => g.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  g.querySelectorAll('button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  estado[g.dataset.filtro] = b.dataset.v; buscar();
}));
$('#detalhe').addEventListener('click', (e) => {
  const sb = e.target.closest('.secao-bt');
  if (sb) {
    const ab = sb.getAttribute('aria-expanded') === 'true';
    sb.setAttribute('aria-expanded', String(!ab));
    sb.closest('tbody').querySelectorAll('tr:not(.secao)').forEach((tr) => { tr.hidden = ab; });
    return;
  }
  const ex = e.target.closest('.expandir');
  if (ex) expandir(ex);
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement !== $('#q')) { e.preventDefault(); $('#q').focus(); $('#q').select(); }
});
window.addEventListener('hashchange', rota);

$('#sugestoes').innerHTML = SUGESTOES.map((s) => `<button type="button">${esc(s)}</button>`).join('');
document.addEventListener('click', (e) => {
  const s = e.target.closest('#sugestoes button'); if (!s) return;
  $('#q').value = estado.q = s.textContent; buscar(); $('#q').focus();
});
const inicioHTML = $('#detalhe').innerHTML;
carregarReferencia().then(() => { buscar(); rota(); });


// ---------- o que mudou entre referências ----------
const VAR = { tipo: 'servico', base: 'todas', sentido: 'alta' };
async function desenharVariacao() {
  const d = $('#detalhe');
  if (!d.querySelector('.variacao')) d.innerHTML = '<p class="carregando">Comparando referências…</p>';
  let r;
  try { r = await api(`/api/variacao?${new URLSearchParams({ ...VAR, limite: 150 })}`); }
  catch (e) { d.innerHTML = `<div class="erro">${esc(e.message)}</div>`; return; }
  if (!r.de) { d.innerHTML = '<div class="vazio"><h1>Só há uma referência carregada.</h1><p>Quando a próxima base mensal entrar, esta página mostra o que mudou.</p></div>'; return; }
  const rs = r.resumo, de = r.de.descricao.replace(/-1$/, ''), para = r.para.descricao.replace(/-1$/, '');
  const seg = (campo, opcoes) => `<div class="segmentos" role="radiogroup" data-var="${campo}">${opcoes.map(([v, n]) =>
    `<button type="button" role="radio" data-v="${v}" aria-checked="${VAR[campo] === v}">${n}</button>`).join('')}</div>`;
  const linhas = r.itens.map((i) => `<tr>
      <td class="cod"><a href="#/${i.tipo === 'servico' ? 'composicao' : 'insumo'}/${esc(i.base)}/${esc(i.codigo)}">${esc(i.codigo)}</a>/${esc(i.base)}</td>
      <td class="desc">${esc(i.descricao)}</td><td>${esc(i.unidade)}</td>
      <td class="num">${money(i.preco_anterior)}</td><td class="num"><b>${money(i.preco)}</b></td>
      <td class="num">${seloVariacao(i.preco, i.preco_anterior, 0)}</td>
      ${VAR.tipo === 'insumo' ? `<td class="num">${(i.usos || 0).toLocaleString('pt-BR')}</td>` : ''}</tr>`).join('');
  d.innerHTML = `<article class="ficha orc variacao">
    <div class="orc-topo"><h2>O que mudou de ${esc(de)} para ${esc(para)}</h2>
      <p class="sub">Comparação dos preços de ${VAR.tipo === 'servico' ? 'serviços' : 'insumos'} entre as duas últimas referências carregadas.</p></div>
    <div class="var-filtros">${seg('tipo', [['servico', 'Serviços'], ['insumo', 'Insumos']])}${seg('base', [['todas', 'Todas'], ['ORSE', 'ORSE'], ['SINAPI', 'SINAPI']])}${seg('sentido', [['alta', 'Maiores altas'], ['baixa', 'Maiores quedas']])}</div>
    <div class="legenda var-resumo">
      <div style="--cor:var(--alta)">Subiram<b>${(rs.subiram || 0).toLocaleString('pt-BR')}</b><span class="pct">${pct.format(rs.comparados ? rs.subiram / rs.comparados : 0)} dos comparados</span></div>
      <div style="--cor:var(--baixa)">Desceram<b>${(rs.desceram || 0).toLocaleString('pt-BR')}</b><span class="pct">${pct.format(rs.comparados ? rs.desceram / rs.comparados : 0)}</span></div>
      <div style="--cor:var(--linha-forte)">Iguais<b>${(rs.iguais || 0).toLocaleString('pt-BR')}</b><span class="pct">${pct.format(rs.comparados ? rs.iguais / rs.comparados : 0)}</span></div>
      <div style="--cor:var(--planta)">Novos em ${esc(para)}<b>${(rs.novos || 0).toLocaleString('pt-BR')}</b><span class="pct">sem preço anterior</span></div>
    </div>
    <table class="planilha"><thead><tr><th>Código</th><th>Descrição</th><th>Un.</th><th class="num">${esc(de)}</th><th class="num">${esc(para)}</th><th class="num">Variação</th>${VAR.tipo === 'insumo' ? '<th class="num">Usado em</th>' : ''}</tr></thead>
    <tbody>${linhas}</tbody></table>
    <p class="fonte">Mostrando as ${r.itens.length} maiores ${VAR.sentido === 'alta' ? 'altas' : 'quedas'}.${VAR.tipo === 'insumo' ? ' "Usado em" conta em quantas composições o insumo aparece.' : ''}</p>
  </article>`;
  d.querySelectorAll('[data-var]').forEach((g) => g.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; VAR[g.dataset.var] = b.dataset.v; desenharVariacao();
  }));
}
