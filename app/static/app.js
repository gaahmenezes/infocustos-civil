'use strict';

const $ = (s, el = document) => el.querySelector(s);
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const num2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });
const coef = (v) => v == null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 8 }).format(v);
const money = (v) => v == null ? '—' : num2.format(v);
// unidade como a pessoa lê: m2 vira m², m3 vira m³
const unid = (u) => esc(String(u ?? '').trim().replace(/^m2$/i, 'm²').replace(/^m3$/i, 'm³'));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const SECOES = [
  ['EQUIPAMENTO', 'Equipamento', '--c-equip'],
  ['MAO_DE_OBRA', 'Mão de obra', '--c-mo'],
  ['MATERIAL', 'Material', '--c-mat'],
  ['SERVICO_TERCEIRO', 'Serviço de terceiro', '--c-terc'],
  ['SERVICO_AUXILIAR', 'Serviço auxiliar', '--c-equip'],
  // SICRO (DNIT)
  ['FIC', 'Fator de influência de chuvas', '--c-enc'],
  ['TEMPO_FIXO', 'Tempo fixo (carga e descarga)', '--c-terc'],
  ['TRANSPORTE', 'Momento de transporte', '--tinta-3'],
];
const NOME_SECAO = Object.fromEntries(SECOES.map(([k, n]) => [k, n]));

const estado = { q: '', base: 'todas', tipo: 'todos', itens: [], atual: null, ref: null, explorar: false };

// ---------- endereços das telas ----------
const rotaItem = (tipo, base, codigo) => `#/${tipo === 'servico' ? 'composicao' : 'insumo'}/${base}/${codigo}`;
const rotaComparar = (lista) => `#/comparar/${lista.map((x) => `${x.base}-${x.codigo}`).join(',')}`;
const lerRotaComparar = () => { const m = location.hash.match(/^#\/comparar\/(.+)/); return m ? m[1] : null; };
const rotaOrc = (id, aba) => `#/orcamento/${id}${aba ? '/' + aba : ''}`;

// ---------- preferências (ficam só neste navegador) ----------
const PREF = {
  ler(k, padrao) { try { return localStorage.getItem(k) || padrao; } catch (_) { return padrao; } },
  gravar(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* sem armazenamento */ } },
};
const temaAtual = () => document.documentElement.dataset.theme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
function aplicarTema(t) {
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
  const bt = $('#tema'); if (!bt) return;
  const escuro = temaAtual() === 'dark';
  bt.setAttribute('aria-label', escuro ? 'Usar tema claro' : 'Usar tema escuro');
  bt.title = escuro ? 'Tema claro' : 'Tema escuro';
  bt.dataset.tema = escuro ? 'dark' : 'light';
}
aplicarTema(PREF.ler('infocustos-tema', ''));
document.addEventListener('click', (e) => {
  if (!e.target.closest('#tema')) return;
  const novo = temaAtual() === 'dark' ? 'light' : 'dark';
  PREF.gravar('infocustos-tema', novo);
  // o tema novo se abre em círculo a partir do botão
  const calmo = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!document.startViewTransition || calmo) { aplicarTema(novo); return; }
  const q = e.target.closest('#tema').getBoundingClientRect(), x = q.left + q.width / 2, y = q.top + q.height / 2;
  const raio = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  document.documentElement.classList.add('trocando-tema');
  const t = document.startViewTransition(() => aplicarTema(novo));
  t.ready.then(() => document.documentElement.animate(
    { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${raio}px at ${x}px ${y}px)`] },
    { duration: 520, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' })).catch(() => {});
  t.finished.finally(() => document.documentElement.classList.remove('trocando-tema'));
});
// altura das linhas das tabelas: compacta (padrão) ou confortável
function aplicarDensidade(d) {
  document.documentElement.dataset.densidade = d === 'confortavel' ? 'confortavel' : 'compacta';
  document.querySelectorAll('.segmentos[data-densidade] button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === document.documentElement.dataset.densidade)));
}
aplicarDensidade(PREF.ler('infocustos-densidade', 'compacta'));
document.addEventListener('click', (e) => {
  const b = e.target.closest('.segmentos[data-densidade] button'); if (!b) return;
  PREF.gravar('infocustos-densidade', b.dataset.v); aplicarDensidade(b.dataset.v);
});
const seletorDensidade = () => {
  const d = document.documentElement.dataset.densidade;
  return `<div class="segmentos" role="radiogroup" aria-label="Altura das linhas" data-densidade>
    <button type="button" role="radio" data-v="compacta" aria-checked="${d === 'compacta'}">Compacta</button>
    <button type="button" role="radio" data-v="confortavel" aria-checked="${d === 'confortavel'}">Confortável</button></div>`;
};
// o cabeçalho das tabelas gruda logo abaixo da barra superior, qualquer que seja a altura dela
function medirTopo() { const c = $('.cabecalho'); if (c) document.documentElement.style.setProperty('--topo', `${c.offsetHeight}px`); }
medirTopo(); window.addEventListener('resize', medirTopo);

// ---------- peças comuns ----------
// conjunto próprio: traço único de 2,6 em grade de 48, cantos de raio 4 e um detalhe em amarelo (classe "ac") em cada ícone
const ICONES = {
  lupa: '<circle cx="21" cy="21" r="11" /><path d="M29.5 29.5 40 40" /><path class="ac" d="M15.5 21a5.5 5.5 0 0 1 5.5-5.5" />',
  folha: '<path d="M13 6h16l10 10v22a4 4 0 0 1-4 4H13a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4Z" /><path d="M28 6v11h11" /><path class="ac" d="M16 26h16M16 33h10" />',
  relogio: '<circle cx="24" cy="24" r="16" /><path class="ac" d="M24 14v10.5l7 4" />',
  planilha: '<rect x="6" y="9" width="36" height="30" rx="4" /><path d="M6 19h36M18 19v20" /><path class="ac" d="M24 29h12" />',
  calendario: '<rect x="7" y="10" width="34" height="30" rx="4" /><path d="M7 20h34M16 6v8M32 6v8" /><path class="ac" d="M15 29h6v5h-6z" />',
  grafico: '<path d="M8 40h32M14 40V28M34 40V20" /><path class="ac" d="M24 40V12" />',
};
function vazio(icone, titulo, texto, acao = '') {
  return `<div class="vazio-estado"><svg viewBox="0 0 48 48" aria-hidden="true">${ICONES[icone] || ICONES.folha}</svg>
    <b>${titulo}</b>${texto ? `<p>${texto}</p>` : ''}${acao}</div>`;
}
const SETA = '<svg class="seta" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg>';
function menu(rotulo, itens, classe = '') {
  return `<details class="menu"><summary class="botao ${classe}">${rotulo}${SETA}</summary><div class="menu-lista" role="menu">${itens.join('')}</div></details>`;
}
document.addEventListener('click', (e) => {
  // um menu aberto fecha ao clicar fora dele ou ao escolher uma opção
  document.querySelectorAll('details.menu[open]').forEach((m) => { if (!m.contains(e.target) || e.target.closest('[role="menuitem"]')) m.removeAttribute('open'); });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('details.menu[open]').forEach((m) => { m.removeAttribute('open'); m.querySelector('summary').focus(); });
});

// sessão encerrada (site com senha): volta para a tela de entrada, guardando onde a pessoa estava
function sessaoEncerrada() { if (!sessaoEncerrada.indo) { sessaoEncerrada.indo = true; location.href = '/entrar' + location.hash; } }
async function buscarJson(url) {
  const r = await fetch(url);
  if (r.status === 401) { sessaoEncerrada(); throw new Error('Sessão encerrada.'); }
  if (!r.ok) {
    let msg = `Erro ${r.status}`;
    try { msg = (await r.json()).detail || msg; } catch (_) { /* sem corpo */ }
    throw new Error(msg);
  }
  return anotarBasesProprias(await r.json());
}
// cada item próprio pertence a uma base com nome escolhido pela empresa: as respostas trazem esse nome (base_nome) e
// ele fica guardado por código, para as etiquetas de qualquer tela mostrarem a base certa
const BASE_DO_ITEM = new Map();
function anotarBasesProprias(dado, prof = 0) {
  if (!dado || typeof dado !== 'object' || prof > 6) return dado;
  if (Array.isArray(dado)) { for (const x of dado) anotarBasesProprias(x, prof + 1); return dado; }
  if (dado.base_nome && dado.codigo && (dado.base === 'PROPRIA' || /^[PI]\d{4,}$/.test(dado.codigo))) BASE_DO_ITEM.set(dado.codigo, dado.base_nome);
  for (const v of Object.values(dado)) if (v && typeof v === 'object') anotarBasesProprias(v, prof + 1);
  return dado;
}
// fichas (composição e insumo) ficam um minuto na memória: abrir de novo, ou abrir o que o mouse já apontou, é instantâneo
const MEMORIA = new Map();
const lembravel = (url) => /^\/api\/(composicao|insumo)\//.test(url);
function api(url) {
  if (!lembravel(url)) return buscarJson(url);
  const m = MEMORIA.get(url);
  if (m && Date.now() - m.t < 60000) return m.p;
  const p = buscarJson(url);
  MEMORIA.set(url, { t: Date.now(), p });
  p.catch(() => MEMORIA.delete(url));
  if (MEMORIA.size > 80) MEMORIA.delete(MEMORIA.keys().next().value);
  return p;
}
function precarregar(tipo, base, codigo) {
  const url = `/api/${tipo === 'servico' ? 'composicao' : 'insumo'}/${base}/${codigo}?${qsMesDe(base)}`;
  api(url).catch(() => {});
}

// ---------- data-base de cada base ----------
// Cada base tem o seu calendário (ORSE e SINAPI vêm da CEHOP; o SICRO, do DNIT) e o seu mês escolhido.
// Tudo o que aparece na consulta de uma base é só daquele mês dela.
const BASES = ['ORSE', 'SINAPI', 'SICRO'];
const NOME_BASE = { ORSE: 'ORSE', SINAPI: 'SINAPI', SICRO: 'SICRO' };
const ORIGEM_BASE = { ORSE: 'CEHOP', SINAPI: 'CEHOP', SICRO: 'DNIT' };
// origem dos preços de uma base num mês (a SINAPI pode vir do programa da CEHOP ou dos relatórios da CAIXA)
const origemDe = (b, mes) => (estado.ref && estado.ref.bases && estado.ref.bases[b] && estado.ref.bases[b].fontes && estado.ref.bases[b].fontes[mes]) || ORIGEM_BASE[b];
const textoOrigem = (o) => ({ DNIT: 'do DNIT', CAIXA: 'da CAIXA', CEHOP: 'da CEHOP' }[o] || '');
estado.meses = {};
try {
  estado.meses = JSON.parse(localStorage.getItem('infocustos-meses') || '{}') || {};
  const antigo = localStorage.getItem('infocustos-mes');  // preferência de antes, quando havia um mês só
  if (antigo && !estado.meses.ORSE) { estado.meses.ORSE = antigo; estado.meses.SINAPI = antigo; }
} catch (_) { estado.meses = {}; }
const gravarMeses = () => { try { localStorage.setItem('infocustos-meses', JSON.stringify(estado.meses)); localStorage.removeItem('infocustos-mes'); } catch (_) { /* sem armazenamento */ } };
// base "em foco": a do filtro; com todas as bases, a ORSE (a principal)
const baseFoco = () => (BASES.includes(estado.base) ? estado.base : 'ORSE');
const refsQs = () => Object.entries(estado.meses).filter(([, m]) => m).map(([b, m]) => `${b}:${m}`).join(',');
const qsMesDe = (base) => (estado.meses[base] ? `ref=${encodeURIComponent(estado.meses[base])}` : '');
const qsMes = () => qsMesDe(baseFoco());
const basesCarregadas = () => (estado.ref && estado.ref.bases ? Object.keys(estado.ref.bases) : ['ORSE', 'SINAPI']);
const mesesDaBase = (b) => (estado.ref && estado.ref.bases && estado.ref.bases[b] ? estado.ref.bases[b].meses : []);
// mês que um orçamento usa para cada base: o da data-base do orçamento, ou o mês da base mais próximo antes dele
function mesParaBase(b, ref) {
  const ids = mesesDaBase(b).map((m) => m.id); if (!ids.length || ids.includes(ref)) return ref;
  const antes = ids.filter((m) => m <= ref); return antes.length ? antes[antes.length - 1] : ids[0];
}
const refsDoOrcamento = (o) => basesCarregadas().map((b) => `${b}:${mesParaBase(b, o.referencia)}`).join(',');
const curto = (id) => nomeRef(id).replace(/^(\w{3})\w*\//, '$1/');

// bases que entram na pesquisa (todas, por padrão); a escolha fica neste navegador
try { estado.ativas = JSON.parse(localStorage.getItem('infocustos-bases') || 'null'); } catch (_) { estado.ativas = null; }
const basesAtivas = () => basesCarregadas().filter((b) => !Array.isArray(estado.ativas) || !estado.ativas.length || estado.ativas.includes(b));
const basesQs = () => basesAtivas().join(',');

async function carregarReferencia() {
  let ref;
  try { ref = await api(`/api/referencia?${new URLSearchParams({ refs: refsQs(), bases: Array.isArray(estado.ativas) ? estado.ativas.join(',') : '' })}`); }
  catch (e) {
    try { estado.meses = {}; estado.ativas = null; ref = await api('/api/referencia'); } catch (e2) { $('#referencia').textContent = 'Base indisponível'; return; }
  }
  estado.ref = ref; estado.meses = { ...(ref.refs || { ORSE: ref.id, SINAPI: ref.id }) }; gravarMeses(); mostrarNomeBasePropria();
  estado.ativas = ref.ativas || basesCarregadas();
  try { localStorage.setItem('infocustos-bases', JSON.stringify(estado.ativas)); } catch (_) { /* sem armazenamento */ }
  estado.mes = estado.meses.ORSE || ref.id;
  // filtro rápido de base: só aparecem as bases que estão na pesquisa
  // (o filtro "Bases próprias" fica sempre: itens da empresa não têm data-base)
  document.querySelectorAll('.chips[data-filtro="base"] .chip').forEach((c) => { if (BASES.includes(c.dataset.v)) c.hidden = !estado.ativas.includes(c.dataset.v); });
  if (BASES.includes(estado.base) && !estado.ativas.includes(estado.base)) definirFiltro('base', 'todas');
  desenharDatas();
  if (!estado.q.trim()) contarFiltros(totaisDoMes());
}

// texto das datas: bases com o mesmo mês aparecem juntas ("ORSE e SINAPI agosto/2026 · SICRO julho/2026")
function gruposDeData(lista = basesAtivas()) {
  const g = [];
  lista.forEach((b) => { const m = estado.meses[b]; const x = g.find((y) => y.mes === m); if (x) x.bases.push(b); else g.push({ mes: m, bases: [b] }); });
  return g;
}
const juntar = (l) => (l.length > 1 ? `${l.slice(0, -1).join(', ')} e ${l[l.length - 1]}` : l[0] || '');

// ---------- seletor de bases e datas-base ----------
// O campo mostra uma etiqueta por base que está na pesquisa, com o mês dela. Ao abrir, cada base tem a sua caixa
// (entra ou não na pesquisa) e o seu mês. As mudanças valem ao clicar em "Aplicar"; Esc ou clicar fora descarta.
const RASC = { meses: {}, ativas: [] };
function etiquetasDatas(ativas, meses) {
  return ativas.length ? ativas.map((b) => `<span class="dt-etq"><span class="cb-base cb-${b}">${b}</span><span class="dt-m">${esc(curto(meses[b]))}</span></span>`).join('')
    : '<span class="dt-vazio">Nenhuma base</span>';
}
function linhasPainel() {
  const ref = estado.ref;
  return basesCarregadas().map((b) => {
    const on = RASC.ativas.includes(b);
    const ops = [...mesesDaBase(b)].reverse().map((r) => `<option value="${esc(r.id)}"${r.id === RASC.meses[b] ? ' selected' : ''}>${esc(r.descricao.replace(/-1$/, ''))}${r.id === ref.bases[b].atual ? ' (mais recente)' : ''}</option>`).join('');
    return `<div class="dt-linha${on ? '' : ' fora'}">
      <label class="dt-marca"><input type="checkbox" data-dt-base="${b}"${on ? ' checked' : ''}>
        <span class="cb-base cb-${b}">${b}</span><span class="dt-orig" data-dt-orig="${b}">${origemDe(b, RASC.meses[b])} · Sergipe</span></label>
      <label class="dt-mes"><span class="sr">Data-base do ${b}</span><select data-dt-mes="${b}"${on ? '' : ' disabled'}>${ops}</select></label></div>`;
  }).join('');
}
function desenharDatas() {
  const ref = estado.ref; if (!ref) return;
  const n = (t, b) => (ref.totais.find((x) => x.tipo === t && x.base === b) || {}).n || 0;
  const bases = basesAtivas();
  const soma = (t) => bases.reduce((s, b) => s + n(t, b), 0);
  const aberto = !!($('#dt-painel') && !$('#dt-painel').hidden);
  $('#referencia').innerHTML = `<div class="dt">
    <button type="button" class="dt-campo" id="dt-campo" aria-expanded="${aberto}" aria-controls="dt-painel" aria-label="Bases e datas-base da pesquisa: ${esc(bases.map((b) => `${b} ${nomeRef(estado.meses[b])}`).join(', '))}">
      <span class="dt-etqs" data-mais="${bases.length > 1 ? ` +${bases.length - 1}` : ''}">${etiquetasDatas(bases, estado.meses)}</span>${SETA}</button>
    <div class="dt-painel" id="dt-painel" role="dialog" aria-label="Bases e datas-base da pesquisa"${aberto ? '' : ' hidden'}></div></div>`;
  if (aberto) abrirDatas(true);
  $('#pesquisa-sub').innerHTML = `Pesquise entre <b>${soma('servico').toLocaleString('pt-BR')} composições</b> e
    <b>${soma('insumo').toLocaleString('pt-BR')} insumos</b> ${esc(juntar(bases.map((b) => (b === 'SICRO' ? 'do ' : 'da ') + NOME_BASE[b])))}.`;
  $('#selo-base').hidden = false;
  $('#selo-base').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17 19 7" /></svg>
    <span>${gruposDeData().map((x) => `${esc(juntar(x.bases))} de <b>${esc(nomeRef(x.mes))}</b>`).join(' · ')}, conferidos item a item com os relatórios ${
      juntar([...new Set(bases.map((b) => origemDe(b, estado.meses[b])))].map(textoOrigem))}</span>`;
}
function desenharQuadroDatas() {
  const p = $('#dt-painel'); if (!p) return;
  const nenhuma = !RASC.ativas.length;
  p.innerHTML = `<p class="dt-tit">Bases da pesquisa</p>
    <p class="dt-sub">Marque as bases que entram na busca e escolha o mês de cada uma. Cada base tem o seu calendário.</p>
    <div class="dt-lista">${linhasPainel()}</div>
    <p class="dt-aviso" role="alert">${nenhuma ? 'Marque pelo menos uma base.' : ''}</p>
    <div class="dt-acoes">
      <button type="button" class="botao" data-dt="todas">Marcar todas</button>
      <button type="button" class="botao" data-dt="nenhuma">Desmarcar todas</button>
      <button type="button" class="botao" data-dt="recentes">Mais recentes</button>
      <button type="button" class="botao primario" data-dt="aplicar"${nenhuma ? ' disabled' : ''}>Aplicar</button></div>`;
}
function abrirDatas(manter) {
  const p = $('#dt-painel'); if (!p) return;
  if (!manter) { RASC.meses = { ...estado.meses }; RASC.ativas = [...basesAtivas()]; }
  desenharQuadroDatas(); p.hidden = false; $('#dt-campo').setAttribute('aria-expanded', 'true');
  if (!manter) { const c = p.querySelector('input'); if (c) c.focus(); }
}
function fecharDatas(voltarFoco) {
  const p = $('#dt-painel'); if (!p || p.hidden) return;
  p.hidden = true; $('#dt-campo').setAttribute('aria-expanded', 'false'); if (voltarFoco) $('#dt-campo').focus();
}
async function aplicarDatas() {
  if (!RASC.ativas.length) return;
  const mudou = JSON.stringify(RASC.meses) !== JSON.stringify(estado.meses) || RASC.ativas.join() !== basesAtivas().join();
  fecharDatas(true);
  if (!mudou) return;
  estado.meses = { ...RASC.meses }; estado.ativas = [...RASC.ativas]; gravarMeses();
  await carregarReferencia();
  buscar(); rota();
  avisar && avisar(`Pesquisando em ${esc(gruposDeData().map((x) => `${juntar(x.bases)} de ${nomeRef(x.mes)}`).join(' · '))}.`);
}
async function trocarMes(id, base) {
  // atalhos ("Ver em <mês>", paleta): troca o mês de uma base e a inclui na pesquisa
  const b = base || 'ORSE';
  if (!id || (id === estado.meses[b] && basesAtivas().includes(b))) return;
  estado.meses[b] = id; if (Array.isArray(estado.ativas) && !estado.ativas.includes(b)) estado.ativas.push(b);
  gravarMeses();
  await carregarReferencia();
  buscar(); rota();
  avisar && avisar(`${esc(b)}: mostrando os preços de ${esc(nomeRef(id))}.`);
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-mes]'); if (b) { trocarMes(b.dataset.mes, b.dataset.baseMes); return; }  // botões "Ver em <mês>"
  if (e.target.closest('#dt-campo')) { if ($('#dt-painel').hidden) abrirDatas(); else fecharDatas(); return; }
  const a = e.target.closest('[data-dt]');
  if (a) {
    const k = a.dataset.dt;
    if (k === 'todas') RASC.ativas = [...basesCarregadas()];
    if (k === 'nenhuma') RASC.ativas = [];
    if (k === 'recentes') basesCarregadas().forEach((x) => { RASC.meses[x] = estado.ref.bases[x].atual; });
    if (k === 'aplicar') { aplicarDatas(); return; }
    desenharQuadroDatas(); const f = $(`#dt-painel [data-dt="${k}"]`); if (f) f.focus(); return;
  }
  const p = $('#dt-painel');
  if (p && !p.hidden && !e.target.closest('.dt')) fecharDatas();
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset && t.dataset.dtBase) {
    const b = t.dataset.dtBase;
    RASC.ativas = basesCarregadas().filter((x) => (x === b ? t.checked : RASC.ativas.includes(x)));
    desenharQuadroDatas(); const f = $(`#dt-painel [data-dt-base="${b}"]`); if (f) f.focus();
  }
  if (t.dataset && t.dataset.dtMes) {
    RASC.meses[t.dataset.dtMes] = t.value;
    const o = $(`#dt-painel [data-dt-orig="${t.dataset.dtMes}"]`); if (o) o.textContent = `${origemDe(t.dataset.dtMes, t.value)} · Sergipe`;
  }
});
document.addEventListener('keydown', (e) => {
  const p = $('#dt-painel');
  if (e.key === 'Escape' && p && !p.hidden) { e.preventDefault(); fecharDatas(true); }
  if (e.key === 'Enter' && p && !p.hidden && e.target.closest('#dt-painel') && e.target.tagName !== 'BUTTON') { e.preventDefault(); aplicarDatas(); }
});

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


// ---------- continuar de onde parou (fica só neste navegador) ----------
const HIST_CHAVE = 'infocustos-historico';
const HIST = (() => {
  try { const h = JSON.parse(localStorage.getItem(HIST_CHAVE) || 'null'); if (h && Array.isArray(h.pesquisas) && Array.isArray(h.abertos)) return h; } catch (_) { /* sem armazenamento */ }
  return { pesquisas: [], abertos: [] };
})();
function gravarHist() { try { localStorage.setItem(HIST_CHAVE, JSON.stringify(HIST)); } catch (_) { /* fica só na memória */ } }
function registrarPesquisa() {
  const q = estado.q.trim(); if (q.length < 2) return;
  HIST.pesquisas = [{ q, tipo: estado.tipo, base: estado.base }, ...HIST.pesquisas.filter((p) => !(p.q.toLowerCase() === q.toLowerCase() && p.tipo === estado.tipo && p.base === estado.base))].slice(0, 6);
  gravarHist();
}
function registrarAberto(d, tipo) {
  const it = { tipo, base: d.base, codigo: d.codigo, descricao: d.descricao || '', unidade: d.unidade || '' };
  HIST.abertos = [it, ...HIST.abertos.filter((x) => !(x.tipo === it.tipo && x.base === it.base && x.codigo === it.codigo))].slice(0, 6);
  gravarHist();
}
function definirFiltro(grupo, v) {
  estado[grupo] = v;
  document.querySelectorAll(`.chips[data-filtro="${grupo}"] .chip`).forEach((c) => c.setAttribute('aria-checked', String(c.dataset.v === v)));
}
const nomeFiltro = (p) => [p.tipo === 'servico' ? 'composições' : p.tipo === 'insumo' ? 'insumos' : '', p.base !== 'todas' ? p.base : ''].filter(Boolean).join(' · ');
async function desenharInicio() {
  $('#c-pesquisas').innerHTML = HIST.pesquisas.length
    ? HIST.pesquisas.map((p, k) => `<li><button type="button" data-repetir="${k}"><span class="linha-1">${esc(p.q)}</span>
        <span class="linha-2">${esc(nomeFiltro(p) || 'composições e insumos, todas as bases')}</span></button></li>`).join('')
    : `<li class="vazio-cartao"><svg viewBox="0 0 48 48" aria-hidden="true">${ICONES.lupa}</svg>As pesquisas que você fizer aparecem aqui, com os filtros.</li>`;
  $('#c-pesquisas-rod').innerHTML = HIST.pesquisas.length ? '<button type="button" data-limpar-hist="pesquisas">Limpar pesquisas</button>' : '';
  $('#c-abertos').innerHTML = HIST.abertos.length
    ? HIST.abertos.map((x) => `<li><a href="${rotaItem(x.tipo, esc(x.base), esc(x.codigo))}">
        <span class="linha-1">${esc(x.descricao)}</span><span class="linha-2"><b>${esc(x.codigo)}</b> ${esc(x.base)} · ${x.tipo === 'servico' ? 'composição' : 'insumo'}${x.unidade ? `<span class="un">${unid(x.unidade)}</span>` : ''}</span></a></li>`).join('')
    : `<li class="vazio-cartao"><svg viewBox="0 0 48 48" aria-hidden="true">${ICONES.relogio}</svg>O que você abrir fica aqui, para voltar com um clique.</li>`;
  $('#c-abertos-rod').innerHTML = HIST.abertos.length ? '<button type="button" data-limpar-hist="abertos">Limpar lista</button>' : '';
  try {
    const orcs = (await api('/api/orcamentos')).slice(0, 4);
    $('#c-orcamentos').innerHTML = orcs.length
      ? orcs.map((o) => `<li><a href="${rotaOrc(o.id)}"><span class="linha-1">${esc(o.nome)}</span><span class="valor-dir">${brl.format(o.total)}</span>
          <span class="linha-2">${esc(nomeRef(o.referencia))} · ${o.qtd_itens} ${o.qtd_itens === 1 ? 'item' : 'itens'}</span></a></li>`).join('')
      : `<li class="vazio-cartao"><svg viewBox="0 0 48 48" aria-hidden="true">${ICONES.planilha}</svg><span>Nenhum orçamento ainda. <a class="link-acao" href="#/orcamentos">Criar o primeiro</a></span></li>`;
  } catch (_) { $('#c-orcamentos').innerHTML = '<li class="vazio-cartao">Não foi possível carregar os orçamentos.</li>'; }
}

// ---------- estados da tela e transições ----------
const semMovimento = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function transicao(fn) {
  // troca de estado com a View Transitions do navegador; sem suporte (ou sem movimento), troca direto
  if (!document.startViewTransition || semMovimento() || document.hidden) { fn(); return Promise.resolve(); }
  // uma transição nova cancela a anterior; o navegador avisa com promessas rejeitadas, que aqui são esperadas
  const t = document.startViewTransition(fn);
  t.ready.catch(() => {}); t.updateCallbackDone.catch(() => {});
  return t.finished.catch(() => {});
}
function aplicarEstado() {
  const naConsulta = (document.body.dataset.aba || 'consulta') === 'consulta';
  // "Ver toda a base" mostra a lista mesmo sem nada digitado
  const temQ = estado.q.trim().length > 0 || estado.explorar;
  const ocioso = naConsulta && !temQ && !estado.atual && !estado.comparando;
  const mudou = document.body.classList.contains('ocioso') !== ocioso || document.body.classList.contains('buscando') !== (naConsulta && temQ);
  if (ocioso && (mudou || !aplicarEstado.inicio)) { aplicarEstado.inicio = true; desenharInicio(); }
  // a troca pode ficar para o próximo quadro (transição animada): recalcula na hora de aplicar, para não usar um estado velho
  // (ex.: sair do comparativo direto para um item não pode deixar a tela no estado inicial, sem a ficha)
  const aplicar = () => {
    const naC = (document.body.dataset.aba || 'consulta') === 'consulta';
    const tq = estado.q.trim().length > 0 || estado.explorar;
    document.body.classList.toggle('ocioso', naC && !tq && !estado.atual && !estado.comparando);
    document.body.classList.toggle('buscando', naC && tq);
    $('#limpar').hidden = !tq;
  };
  if (mudou) transicao(aplicar); else aplicar();
}

// ---------- busca (em tempo real) ----------
let tBusca = 0, seq = 0, tAguardo = 0;
const ROTULO_TIPO = { servico: 'Composição', insumo: 'Insumo' };
function agendarBusca() { clearTimeout(tBusca); tBusca = setTimeout(buscar, 90); }

function contarFiltros(grade) {
  // números dos filtros: cada grupo conta respeitando o filtro do outro grupo
  const g = grade || [];
  const soma = (f) => g.filter(f).reduce((s, x) => s + x.n, 0);
  const daBase = (x) => estado.base === 'todas' || x.base === estado.base;
  const doTipo = (x) => estado.tipo === 'todos' || x.tipo === estado.tipo;
  const n = {
    tipo: { todos: soma(daBase), servico: soma((x) => daBase(x) && x.tipo === 'servico'), insumo: soma((x) => daBase(x) && x.tipo === 'insumo') },
    base: { todas: soma(doTipo), ...Object.fromEntries([...BASES, 'PROPRIA'].map((b) => [b, soma((x) => doTipo(x) && x.base === b)])) },
  };
  document.querySelectorAll('.chips').forEach((grupo) => grupo.querySelectorAll('.chip').forEach((c) => {
    const v = n[grupo.dataset.filtro][c.dataset.v] || 0;
    c.querySelector('.n').textContent = grade ? v.toLocaleString('pt-BR') : '';
    c.classList.toggle('zero', !!grade && v === 0);
  }));
}
function totaisDoMes() {
  // sem nada digitado, os filtros mostram o tamanho da base do mês
  return estado.ref ? estado.ref.totais.map((t) => ({ tipo: t.tipo, base: t.base, n: t.n })) : null;
}

function esqueleto() {
  $('#lista').innerHTML = Array.from({ length: 6 }, () => '<li class="esq" aria-hidden="true"><i></i><i></i><i></i></li>').join('');
}

const PAGINA = 100;
async function buscar() {
  const q = estado.q.trim();
  aplicarEstado();
  $('#exportar-busca').href = `/api/exportar/busca.xlsx?${new URLSearchParams({ q, base: estado.base, tipo: estado.tipo, refs: refsQs(), bases: basesQs() })}`;
  if (!q && !estado.explorar) {
    // nada digitado: nenhuma composição aparece
    ++seq; estado.itens = []; $('#lista').innerHTML = ''; $('#contagem').textContent = '';
    contarFiltros(totaisDoMes());
    return;
  }
  const meu = ++seq;
  const lista = $('#lista');
  if (!lista.children.length) esqueleto();
  clearTimeout(tAguardo); tAguardo = setTimeout(() => lista.classList.add('aguardando'), 160);
  try {
    // sem texto (ver toda a base): a tabela do mês em ordem de código
    const r = await api(`/api/busca?${new URLSearchParams({ q, base: estado.base, tipo: estado.tipo, limite: q ? 80 : PAGINA, refs: refsQs(), bases: basesQs(), ordem: q ? 'usos' : 'codigo' })}`);
    if (meu !== seq) return;
    estado.itens = r.itens;
    // sem texto, os números dos filtros são o tamanho da base do mês
    contarFiltros(q ? r.grade : totaisDoMes());
    desenharLista(r);
    if (!q) { const rol = lista.closest('.resultados') || lista; rol.scrollTop = 0; lista.scrollTop = 0; }
  } catch (e) {
    if (meu === seq) { $('#contagem').textContent = e.message; lista.innerHTML = ''; }
  } finally {
    if (meu === seq) { clearTimeout(tAguardo); lista.classList.remove('aguardando'); }
  }
}

const PARTES = [['pct_mo', 'mão de obra', '--c-mo'], ['pct_mat', 'material', '--c-mat'], ['pct_equip', 'equipamento', '--c-equip'], ['pct_terc', 'serviço de terceiro', '--c-terc']];
function divisaoCusto(it) {
  // barrinha com a divisão do custo da composição, para comparar resultados sem abrir um por um
  if (it.tipo !== 'servico' || it.pct_mo == null) return '';
  return barraDivisao(it);
}
function barraDivisao(d) {
  // aceita { pct_mo, pct_mat, ... } (composição) ou { mo, mat, equip, terc } (orçamento)
  if (!d) return '';
  const partes = PARTES.map(([k, n, cor]) => [n, d[k] ?? d[k.slice(4)] ?? 0, cor]);
  const dom = partes.reduce((a, b) => (b[1] > a[1] ? b : a));
  const desc = partes.filter((p) => p[1] >= 0.005).map((p) => `${p[0]} ${pct.format(p[1])}`).join(', ');
  return `<span class="mini-barra" role="img" aria-label="Divisão do custo: ${esc(desc)}" title="${esc(desc)}">${partes.filter((p) => p[1] > 0)
    .map((p) => `<i style="flex-grow:${p[1]};background:var(${p[2]})"></i>`).join('')}</span><span class="dom"><b>${pct.format(dom[1])}</b> ${esc(dom[0])}</span>`;
}

function trecho(item) {
  if (!item.trecho) return esc(item.descricao);
  return esc(item.trecho).replace(/\u0001/g, '<mark>').replace(/\u0002/g, '</mark>');
}

// código e base em destaque: número em algarismos fixos, base como etiqueta com cor própria
// a base própria tem o nome que a empresa escolher (aba Bases próprias)
const basesProprias = () => (estado.ref && estado.ref.bases_proprias) || [];
// com uma base só, o nome dela; com várias, o filtro da busca diz "Bases próprias" (todas juntas)
const nomeBasePropria = () => (basesProprias().length > 1 ? 'Bases próprias' : (estado.ref && estado.ref.base_propria) || 'Base própria');
const rotuloBase = (b, codigo) => (b === 'PROPRIA' ? (BASE_DO_ITEM.get(codigo) || (basesProprias().length > 1 ? 'Própria' : nomeBasePropria())).toUpperCase() : b);
function mostrarNomeBasePropria() { document.querySelectorAll('[data-nome-propria]').forEach((el) => { el.textContent = nomeBasePropria(); }); }
function codigoBase(codigo, base, marcar) {
  const termo = marcar ? ($('#q').value || '').trim().replace(/^0+/, '') : '';
  const semZeros = String(codigo).replace(/^0+/, '');
  const num = termo && /^\d+$/.test(termo) && semZeros.startsWith(termo) ? `<mark>${esc(codigo)}</mark>` : esc(codigo);
  return `<span class="cb"><span class="cb-num">${num}</span><span class="cb-base cb-${esc(base)}">${esc(rotuloBase(base, codigo))}</span></span>`;
}

// nas tabelas: o mesmo par código + base, mais discreto, e o conjunto inteiro abre o item
function codLink(tipo, base, codigo) {
  return `<a class="cb cb-p" href="${rotaItem(tipo, esc(base), esc(codigo))}"><span class="cb-num">${esc(codigo)}</span><span class="cb-base cb-${esc(base)}">${esc(rotuloBase(base, codigo))}</span></a>`;
}

function desenharLista(r) {
  const lista = $('#lista');
  const t = r.total;
  const filtro = [estado.tipo === 'servico' ? 'composições' : estado.tipo === 'insumo' ? 'insumos' : '', estado.base !== 'todas' ? estado.base : ''].filter(Boolean).join(' · ');
  $('#contagem').innerHTML = t === 0 ? '' : `<b>${t.toLocaleString('pt-BR')}</b> ${t === 1 ? 'resultado' : 'resultados'}${filtro ? ` em ${esc(filtro)}` : ''}${t > r.itens.length ? ` · mostrando ${r.itens.length}` : ''}`;
  if (!t) {
    const outros = (r.grade || []).reduce((s, x) => s + x.n, 0);
    lista.innerHTML = `<li class="nada"><b>Nada encontrado${filtro ? ` em ${esc(filtro)}` : ''}.</b>${outros
      ? `Há ${outros.toLocaleString('pt-BR')} resultados com os outros filtros.` : 'Tente menos palavras ou só o começo delas.'}</li>`;
    return;
  }
  lista.innerHTML = linhasLista(r.itens, 0) + maisLista(r);
}
function maisLista(r) {
  // a base inteira chega em páginas: o botão traz as próximas, na mesma ordem
  const falta = r.total - estado.itens.length;
  return !estado.q.trim() && falta > 0
    ? `<li class="mais-li"><button type="button" class="botao" id="mais-base">Mostrar mais ${Math.min(PAGINA, falta).toLocaleString('pt-BR')} <span class="n">de ${falta.toLocaleString('pt-BR')} restantes</span></button></li>` : '';
}
function linhasLista(itens, inicio) {
  return itens.map((it, k) => {
    const i = inicio + k;
    const meta = [it.grupo || (it.tipo === 'insumo' ? it.categoria : ''),
      it.tipo === 'insumo' && it.usos ? `em ${it.usos.toLocaleString('pt-BR')} composições` : ''].filter(Boolean);
    const atual = estado.atual && estado.atual.base === it.base && estado.atual.codigo === it.codigo && estado.atual.tipo === it.tipo;
    return `<li><button type="button" class="res" data-i="${i}"${atual ? ' aria-current="true"' : ''}>
      <span class="res-cod">${codigoBase(it.codigo, it.base, true)}<span class="tipo tipo-${it.tipo}">${ROTULO_TIPO[it.tipo]}</span></span>
      <span class="res-desc">${trecho(it)}</span>
      <span class="res-meta">${esc(meta.join(' · '))}</span>
      <span class="res-preco">${it.preco == null ? '<span class="sem-preco">sem preço</span>' : brl.format(it.preco)}${it.unidade ? `<span class="un" title="Unidade">${unid(it.unidade)}</span>` : ''}</span>
      <span class="res-div">${divisaoCusto(it)}</span></button>${it.tipo === 'servico' && it.tem_composicao
        ? `<button type="button" class="cmp-bt" data-comparar="${esc(it.base)}|${esc(it.codigo)}" data-desc="${esc(it.descricao)}" aria-pressed="${window.estaComparando ? window.estaComparando(it.base, it.codigo) : false}" title="Comparar esta composição com outras">Comparar</button>` : ''}</li>`;
  }).join('');
}
async function mostrarMais(bt) {
  const meu = seq, desde = estado.itens.length;
  bt.disabled = true; bt.textContent = 'Carregando…';
  try {
    const r = await api(`/api/busca?${new URLSearchParams({ q: '', base: estado.base, tipo: estado.tipo, limite: PAGINA, desde, refs: refsQs(), bases: basesQs(), ordem: 'codigo' })}`);
    if (meu !== seq) return;
    estado.itens = estado.itens.concat(r.itens);
    bt.closest('li').outerHTML = linhasLista(r.itens, desde) + maisLista(r);
    $('#contagem').innerHTML = $('#contagem').innerHTML.replace(/mostrando [\d.]+/, `mostrando ${estado.itens.length.toLocaleString('pt-BR')}`);
    const novo = $(`#lista .res[data-i="${desde}"]`); if (novo) novo.focus({ preventScroll: true });
  } catch (e) { bt.disabled = false; bt.textContent = `Não foi possível carregar (${e.message}). Tentar de novo`; }
}
$('#lista').addEventListener('click', (e) => { const b = e.target.closest('#mais-base'); if (b) mostrarMais(b); });
function verBase() {
  estado.explorar = true; estado.q = ''; $('#q').value = ''; buscar();
}
document.addEventListener('click', (e) => { if (e.target.closest('[data-ver-base]')) { e.preventDefault(); verBase(); } });

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
  const h = rotaItem(tipo, base, codigo);
  if (location.hash !== h) location.hash = h; else rota();
}

async function rota() {
  const emOrc = /^#\/orcamento/.test(location.hash);
  const emVar = /^#\/comparativo/.test(location.hash);
  const emEnc = /^#\/encargos/.test(location.hash);
  const emCmp = lerRotaComparar() !== null;
  const emAp = /^#\/apresentacao/.test(location.hash);
  const emImp = /^#\/importar/.test(location.hash);
  const emProp = emImp || /^#\/propria/.test(location.hash);
  estado.comparando = emCmp || emAp;
  if (!emAp && window.sairDaApresentacao) window.sairDaApresentacao();
  document.body.classList.toggle('modo-orc', emOrc || emVar || emEnc || emCmp || emAp || emProp);
  document.body.classList.toggle('modo-ap', emAp);
  const aba = emOrc ? 'orcamentos' : emVar ? 'comparativo' : emEnc ? 'encargos' : emAp ? 'apresentacao' : emProp ? 'proprias' : 'consulta';
  document.body.dataset.aba = aba;
  document.querySelectorAll('.abas a, .nav-baixo a').forEach((a) => a.setAttribute('aria-current', String(a.dataset.aba === aba)));
  moverIndicador();
  if (aba !== 'consulta' || emCmp) estado.atual = null;
  if (emAp) { aplicarEstado(); window.desenharBandeja && window.desenharBandeja(); window.desenharApresentacao(); window.scrollTo(0, 0); return; }
  aplicarEstado();
  window.desenharBandeja && window.desenharBandeja();
  if (emCmp) { document.body.classList.remove('ver-detalhe'); window.desenharComparar(lerRotaComparar()); return; }
  if (emOrc) { window.rotaOrcamento && window.rotaOrcamento(); return; }
  if (emVar) { desenharComparativo(); return; }
  if (emEnc) { desenharEncargos(); return; }
  if (emImp) { window.rotaImportar && window.rotaImportar(); return; }
  if (emProp) { window.rotaProprias && window.rotaProprias(); return; }
  const m = location.hash.match(/^#\/(composicao|insumo)\/(ORSE|SINAPI|SICRO|PROPRIA)\/(\w+)/);
  if (!m) {
    estado.atual = null;
    document.body.classList.remove('ver-detalhe');
    if (!$('#inicio')) $('#detalhe').innerHTML = inicioHTML;
    aplicarEstado();
    return;
  }
  const [, tipo, base, codigo] = m;
  estado.atual = { tipo: tipo === 'composicao' ? 'servico' : 'insumo', base, codigo };
  marcarAtual();
  document.body.classList.add('ver-detalhe');
  aplicarEstado();
  const d = $('#detalhe');
  const semEsqueleto = comEsqueleto(d, esqueletoFicha());
  try {
    // composição própria: cada item no mês da sua base (refs)
    const qs = base === 'PROPRIA' ? `refs=${encodeURIComponent(refsQs())}` : qsMesDe(base);
    const dados = tipo === 'composicao' ? await api(`/api/composicao/${base}/${codigo}?${qs}`) : await api(`/api/insumo/${base}/${codigo}?${qs}`);
    semEsqueleto();
    // o código e o preço viajam do resultado clicado até o lugar deles na ficha (ou de uma ficha para a outra)
    const origem = window.innerWidth > 900 && !d.querySelector('.ficha:not(.esq-ficha)') && document.querySelector('.res[aria-current="true"]');
    const viajantes = origem ? [[origem.querySelector('.cb'), 'vt-cod'], [origem.querySelector('.res-preco'), 'vt-preco']].filter((x) => x[0]) : [];
    viajantes.forEach(([el, nome]) => { el.style.viewTransitionName = nome; });
    await transicao(() => {
      viajantes.forEach(([el]) => { el.style.viewTransitionName = ''; });
      if (document.startViewTransition && !semMovimento()) d.dataset.vt = '1';
      if (tipo === 'composicao') desenharComposicao(dados); else desenharInsumo(dados);
    });
    if (tipo === 'composicao' && window.montarFluxo) window.montarFluxo();
    registrarAberto(dados, tipo === 'composicao' ? 'servico' : 'insumo');
    // a ficha começa visível: no celular volta ao topo; no computador só sobe se o começo ficou fora da tela
    if (window.innerWidth <= 900 || d.getBoundingClientRect().top < 70) window.scrollTo({ top: 0, behavior: semMovimento() ? 'auto' : 'smooth' });
  } catch (e) {
    semEsqueleto();
    const outros = mesesDaBase(base).filter((r) => r.id !== estado.meses[base]);
    d.innerHTML = `${botaoVoltar()}<div class="erro"><b>Não foi possível abrir ${esc(codigo)}/${esc(base)}.</b><br>${esc(e.message)}
      ${outros.length ? `<div class="acoes" style="margin-top:12px">${outros.map((r) => `<button type="button" class="botao" data-mes="${esc(r.id)}" data-base-mes="${esc(base)}">Ver em ${esc(r.descricao.replace(/-1$/, ''))}</button>`).join('')}</div>` : ''}</div>`;
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

function linhaItem(i, total, nivel = 0, cor = '--tinta-2') {
  const peso = total > 0 ? Math.min(100, (i.custo_total / total) * 100) : 0;
  const exp = i.tem_composicao
    ? `<button type="button" class="expandir" aria-expanded="false" aria-label="Mostrar a composição de ${esc(i.codigo)}" data-base="${esc(i.base)}" data-cod="${esc(i.codigo)}" data-nivel="${nivel + 1}" data-qtd="${i.qtd ?? ''}" data-ref="${esc(i.referencia || '')}">+</button>`
    : '';
  const cls = nivel ? `filho" style="--nivel:${nivel}` : '';
  return `<tr class="${cls}">
    <td class="cod">${exp}${i.codigo ? codLink(i.eh_servico ? 'servico' : 'insumo', i.base, i.codigo) : '<span class="sem-cod" aria-label="sem código">—</span>'}</td>
    <td class="desc">${esc(i.descricao)}</td>
    <td class="col-unit">${esc(i.unidade)}</td>
    <td class="num col-coef">${coef(i.qtd)}</td>
    <td class="num">${money(i.custo_unit)}</td>
    <td class="num total">${money(i.custo_total)}</td>
    <td class="col-peso">${nivel || !total ? '' : `<span class="peso"><i style="width:${peso}%;background:var(${cor})"></i></span><span class="peso-n">${pct.format(peso / 100)}</span>`}</td>
  </tr>`;
}

/*EXPORTAR-COMP*/
function exportarComposicao(c) {
  return menu('Exportar', [
    `<a role="menuitem" href="/api/exportar/composicao/${esc(c.base)}/${esc(c.codigo)}.xlsx?ref=${esc(c.referencia)}">Planilha do Excel (.xlsx)</a>`,
    '<button type="button" role="menuitem" onclick="window.print()">Imprimir ou salvar em PDF</button>',
  ]);
}
/*FIM-EXPORTAR-COMP*/

function desenharComposicao(c) {
  estado.comp = c;
  const dnit = c.modelo === 'DNIT';
  const total = c.custo_total;
  const grupos = SECOES.map(([k, nome, cor]) => [k, nome, cor, c.itens.filter((i) => i.secao === k)]).filter((g) => g[3].length);
  const corpo = grupos.map(([k, nome, cor, itens]) => {
    const soma = itens.reduce((s, i) => s + (i.custo_total || 0), 0);
    const nota = k === 'MAO_DE_OBRA' && c.encargo_social ? `<span class="nota">com encargo social de ${num2.format(c.encargo_social)}%</span>` : '';
    const notaDnit = dnit && (k === 'EQUIPAMENTO' || k === 'MAO_DE_OBRA') ? `<span class="nota">custo horário da equipe</span>` : k === 'TRANSPORTE' ? '<span class="nota">custo conforme a distância da obra</span>' : '';
    return `<tbody data-secao="${k}">
      <tr class="secao"><td colspan="7"><button type="button" class="secao-bt" aria-expanded="true" style="--cor:var(${cor})">
        <span class="tri"></span><span class="ponto"></span>${nome} <span class="nota">${itens.length} ${itens.length === 1 ? 'item' : 'itens'}</span>${nota}${notaDnit}
        <span class="soma">${brl.format(soma)}</span></button></td></tr>
      ${itens.map((i) => linhaItem(i, dnit && (k === 'EQUIPAMENTO' || k === 'MAO_DE_OBRA') ? 0 : total, 0, cor)).join('')}
    </tbody>`;
  }).join('');
  const ref = estado.ref ? estado.ref.descricao.replace('-1', '') : '';
  $('#detalhe').innerHTML = `<article class="ficha">
    ${botaoVoltar()}
    <div class="ficha-cod">${codigoBase(c.codigo, c.base)}<span class="selo">${dnit ? 'Composição padrão DNIT' : 'Composição analítica'}</span>${c.grupo ? `<span>${esc(c.grupo)}${c.subgrupo ? ' › ' + esc(c.subgrupo) : ''}</span>` : ''}</div>
    <h2>${esc(c.descricao || 'Composição sem descrição na base')}</h2>
    <div class="ficha-linha">
      <div class="preco-grande"><span class="valor">${grana(total)}</span><span class="por">por <b class="un">${unid(c.unidade)}</b>${dnit && c.prod_equipe ? ` · produção da equipe ${num2.format(c.prod_equipe)} ${esc(c.unidade)}/h` : ''}</span></div>
      <div class="fatos">
        <div>Itens<b>${c.itens.length}</b></div>
        ${c.usada_em ? `<div>Usada em<b>${c.usada_em} composições</b></div>` : ''}
        <div>Data-base<b>${c.base === 'PROPRIA' ? esc(Object.entries(c.datas || {}).map(([b, m]) => `${b} ${m.map(curto).join(', ')}`).join(' · ') || '—') : esc(nomeRef(c.referencia) || ref)}</b></div>
      </div>
      <div class="acoes">
        <button type="button" class="botao primario" data-adicionar="servico" data-base="${esc(c.base)}" data-cod="${esc(c.codigo)}" data-desc="${esc(c.descricao)}" data-un="${esc(c.unidade)}">Adicionar ao orçamento</button>
        <button type="button" class="botao" data-comparar="${esc(c.base)}|${esc(c.codigo)}" data-desc="${esc(c.descricao)}" aria-pressed="${window.estaComparando ? window.estaComparando(c.base, c.codigo) : false}">Comparar</button>
        ${c.base === 'PROPRIA' ? `<a class="botao" href="#/propria/${esc(c.codigo)}">Editar composição</a>`
          : `<button type="button" class="botao" data-copiar-propria data-base="${esc(c.base)}" data-cod="${esc(c.codigo)}" data-ref="${esc(c.referencia || '')}" title="Copia os itens para uma composição sua, para ajustar coeficientes e trocar itens">Criar própria a partir desta</button>`}
        ${c.base === 'PROPRIA' ? '' : exportarComposicao(c)}
      </div>
    </div>
    ${barraCusto(c)}
    <div class="tabela-barra"><h3>Itens da composição</h3><div class="tabela-ctrl">${window.seletorVista ? window.seletorVista() : ''}${seletorDensidade()}</div></div>
    <table class="arvore">
      <thead><tr><th>Código</th><th>Descrição</th><th class="col-unit">Un.</th><th class="num col-coef">${dnit ? 'Qtd.' : 'Coeficiente'}</th><th class="num">${dnit ? 'Custo prod.' : 'Custo unit.'}</th><th class="num">Custo total</th><th class="col-peso">% do custo</th></tr></thead>
      ${corpo}
    </table>
    ${dnit ? '<p class="fonte">No modelo DNIT, equipamentos e mão de obra formam o custo horário da equipe, que é dividido pela produção da equipe. Serviços auxiliares entram por unidade.</p>' : ''}
    ${c.base === 'SICRO' ? `<p class="fonte">SICRO: o FIC (fator de influência de chuvas) incide sobre o custo de execução. O momento de transporte não tem custo na tabela do DNIT: depende da distância de cada obra, definida no projeto. Preços sem desoneração.</p>` : ''}
    ${c.base === 'PROPRIA' ? `<p class="fonte">Composição própria da empresa. Custo calculado agora, cada item no mês escolhido para a sua base.${c.observacoes ? ` Observações: ${esc(c.observacoes)}` : ''}</p>` : ''}
    <p class="fonte"${c.base === 'PROPRIA' ? ' hidden' : ''}>Fonte: ${esc(c.base)}${c.fonte === 'DNIT' ? ' (DNIT), Sergipe' : c.fonte === 'CAIXA' ? ' (relatórios da CAIXA), Aracaju/SE, sem desoneração' : c.fonte === 'CEHOP' ? ' (programa ORSE da CEHOP)' : ''}, referência ${esc(nomeRef(c.referencia) || ref)}. Valores em R$, sem BDI.</p>
    ${c.fonte === 'CAIXA' ? '<p class="fonte">SINAPI da CAIXA: a composição aparece como a CAIXA publica, com composições auxiliares (abra o + para ver os itens). Insumo sem preço coletado em Sergipe usa o preço de São Paulo (AS), como no cálculo oficial.</p>' : ''}
  </article>`;
  if (dnit) ajustarDnit(c);
  contarPreco(`c|${c.base}|${c.codigo}`, total);
}

// ao trocar de mês com o mesmo item aberto, o preço conta do valor antigo ao novo
function contarPreco(chave, valor) {
  const v = estado.precoVisto;
  if (v && v.chave === chave && valor != null) contar($('.preco-grande .num-grande'), v.valor, valor);
  estado.precoVisto = { chave, valor };
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
    // cada composição auxiliar no mês do próprio item (numa composição própria, os itens são de bases e meses diferentes)
    const sub = await api(`/api/composicao/${bt.dataset.base}/${bt.dataset.cod}?ref=${encodeURIComponent(bt.dataset.ref || (estado.comp && estado.comp.referencia) || estado.meses[bt.dataset.base] || '')}&refs=${encodeURIComponent(refsQs())}`);
    const nivel = Number(bt.dataset.nivel);
    const cab = `<tr class="filho" style="--nivel:${nivel}"><td class="cod"></td><td class="desc" colspan="6"><span class="rotulo-sub">Composição de ${esc(sub.codigo)}/${esc(sub.base)}, por ${esc(sub.unidade)}: ${brl.format(sub.custo_total)}</span></td></tr>`;
    tr.insertAdjacentHTML('afterend', cab + sub.itens.map((i) => linhaItem(i, sub.custo_total, nivel)).join(''));
    bt.setAttribute('aria-expanded', 'true'); bt.textContent = '−';
  } catch (e) { avisar(esc(e.message)); }
  bt.disabled = false;
}

// ---------- insumo ----------
// origem do preço nos relatórios da CAIXA
const MARCADOR = { C: ' · preço coletado no estado', CR: ' · preço pelo coeficiente da família (CR)', AS: ' · preço de São Paulo (AS), sem coleta no estado', '': '' };
function desenharInsumo(i) {
  const ref = estado.ref ? estado.ref.descricao.replace('-1', '') : '';
  // a CAIXA publica a mão de obra já com encargos; só nos meses da CEHOP o encargo entra depois
  const mo = i.tipo === 'PESSOAL' && estado.ref && i.fonte !== 'CAIXA';
  const comEnc = mo ? i.preco * (1 + estado.ref.encargo_social_horista / 100) : null;
  const linhas = i.usos.map((u) => `<tr>
      <td class="cod">${codLink('servico', u.base, u.codigo)}</td>
      <td class="desc">${esc(u.descricao)}</td>
      <td class="num">${coef(u.qtd)} </td>
      <td class="num">${money(u.custo_total)}</td>
      <td class="num">${u.preco_composicao ? pct.format(u.custo_total / u.preco_composicao) : '—'}</td>
    </tr>`).join('');
  $('#detalhe').innerHTML = `<article class="ficha">
    ${botaoVoltar()}
    <div class="ficha-cod">${codigoBase(i.codigo, i.base)}<span class="selo">Insumo</span><span>${esc(i.tipo)} › ${esc(i.grupo)}${i.subgrupo ? ' › ' + esc(i.subgrupo) : ''}</span></div>
    <h2>${esc(i.descricao || 'Insumo sem descrição na base')}</h2>
    <div class="ficha-linha">
      <div class="preco-grande"><span class="valor">${i.preco == null ? 'Sem preço' : grana(i.preco)}</span><span class="por">por <b class="un">${unid(i.unidade)}</b>${MARCADOR[i.marcador] !== undefined ? MARCADOR[i.marcador] : i.marcador ? ' · preço marcado com # na base' : ''}${i.fonte === 'CAIXA' && i.tipo === 'PESSOAL' ? ' · já com encargos sociais' : ''}${i.base === 'PROPRIA' ? `${i.data_preco ? ` · preço de ${esc(i.data_preco.split('-').reverse().join('/'))}` : ''}${i.fonte ? ` · ${esc(i.fonte)}` : ''}` : ''}</span></div>
      <div class="fatos">
        ${mo ? `<div>Com encargo social de ${num2.format(estado.ref.encargo_social_horista)}%<b>${brl.format(comEnc)} por ${esc(i.unidade)}</b></div>` : ''}
        <div>Usado em<b>${i.usado_em.toLocaleString('pt-BR')} composições</b></div>
        <div>Data-base<b>${esc(nomeRef(i.referencia) || ref)}</b></div>
      </div>
      ${i.preco == null ? '' : `<div class="acoes"><button type="button" class="botao primario" data-adicionar="insumo" data-base="${esc(i.base)}" data-cod="${esc(i.codigo)}" data-desc="${esc(i.descricao)}" data-un="${esc(i.unidade)}">Adicionar ao orçamento</button></div>`}
    </div>
    ${i.usado_em ? `<div class="tabela-barra"><div><h3>Onde este insumo pesa mais</h3>
    <p class="sub">Composições ordenadas pela participação do insumo no custo${i.usado_em > i.usos.length ? `; mostrando ${i.usos.length} de ${i.usado_em.toLocaleString('pt-BR')}` : ''}.</p></div>${seletorDensidade()}</div>
    <table class="uso"><thead><tr><th>Composição</th><th>Descrição</th><th class="num">Coeficiente</th><th class="num">Custo no serviço</th><th class="num">Participação</th></tr></thead><tbody>${linhas}</tbody></table>`
    : vazio('folha', 'Nenhuma composição usa este insumo', `Em ${esc(nomeRef(i.referencia) || ref)}, ele aparece só na tabela de preços.`)}
    <p class="fonte">Fonte: ${esc(i.base)}${i.fonte === 'DNIT' ? ' (DNIT), Sergipe' : i.fonte === 'CAIXA' ? ' (relatórios da CAIXA), Aracaju/SE, sem desoneração' : i.fonte === 'CEHOP' ? ' (programa ORSE da CEHOP)' : ''}, referência ${esc(nomeRef(i.referencia) || ref)}.</p>
  </article>`;
  contarPreco(`i|${i.base}|${i.codigo}`, i.preco);
}

// ---------- eventos ----------
$('#form-busca').addEventListener('submit', (e) => { e.preventDefault(); buscar(); });
$('#q').addEventListener('input', (e) => { estado.q = e.target.value; agendarBusca(); });
$('#q').addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && (estado.q || estado.explorar)) { e.preventDefault(); limparBusca(); return; }
  if (e.key === 'ArrowDown' || e.key === 'Enter') {
    if (e.key === 'Enter') registrarPesquisa();
    const p = document.querySelector('.res'); if (p) { e.preventDefault(); if (e.key === 'Enter') p.click(); else p.focus(); }
  }
});
function limparBusca() {
  estado.q = ''; estado.explorar = false; $('#q').value = ''; buscar(); $('#q').focus();
}
$('#limpar').addEventListener('click', limparBusca);
$('#lista').addEventListener('click', (e) => {
  const b = e.target.closest('.res'); if (!b) return;
  const it = estado.itens[b.dataset.i]; if (it) { registrarPesquisa(); abrir(it.tipo, it.base, it.codigo); }
});
// apontar (ou focar) um resultado já busca a ficha: quando o clique chega, ela está pronta
let tPre = 0;
const preDoResultado = (e) => {
  const b = e.target.closest && e.target.closest('.res'); if (!b) return;
  const it = estado.itens[b.dataset.i]; if (!it) return;
  clearTimeout(tPre); tPre = setTimeout(() => precarregar(it.tipo, it.base, it.codigo), e.type === 'pointerover' ? 70 : 0);
};
['pointerover', 'focusin', 'touchstart'].forEach((ev) => $('#lista').addEventListener(ev, preDoResultado, { passive: true }));
$('#lista').addEventListener('keydown', (e) => {
  const b = e.target.closest('.res'); if (!b) return;
  const li = b.parentElement;
  if (e.key === 'ArrowDown' && li.nextElementSibling) { e.preventDefault(); li.nextElementSibling.firstElementChild.focus(); }
  if (e.key === 'ArrowUp') { e.preventDefault(); (li.previousElementSibling ? li.previousElementSibling.firstElementChild : $('#q')).focus(); }
  if (e.key === 'Home') { e.preventDefault(); $('#lista .res').focus(); }
  if (e.key === 'End') { e.preventDefault(); [...document.querySelectorAll('#lista .res')].pop().focus(); }
  if (e.key === 'Escape') { e.preventDefault(); $('#q').focus(); $('#q').select(); }
});
document.querySelectorAll('.chips').forEach((g) => g.addEventListener('click', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  g.querySelectorAll('.chip').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  estado[g.dataset.filtro] = b.dataset.v;
  if (estado.q.trim() || estado.explorar) buscar(); else contarFiltros(totaisDoMes());
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
  if (e.key === '/' && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); $('#q').focus(); $('#q').select(); }
});
window.addEventListener('hashchange', rota);

// Versão nova publicada: a página se recarrega sozinha ao trocar de tela ou ao voltar para a aba do navegador,
// para nunca rodar arquivos antigos misturados com o servidor novo.
const VERSAO_CARREGADA = (document.querySelector('meta[name=versao]') || {}).content || '';
let ultimaConferencia = 0;
async function conferirVersao() {
  if (!VERSAO_CARREGADA || VERSAO_CARREGADA === '__VERSAO__' || Date.now() - ultimaConferencia < 5000) return;
  ultimaConferencia = Date.now();
  try {
    const r = await fetch('/api/versao', { cache: 'no-store' }); if (!r.ok) return;
    const { versao } = await r.json();
    if (versao && versao !== VERSAO_CARREGADA) location.reload();
  } catch (_) { /* sem rede: tenta na próxima */ }
}
window.addEventListener('hashchange', conferirVersao);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') conferirVersao(); });

document.addEventListener('click', (e) => {
  const s = e.target.closest('[data-repetir]'); if (!s) return;
  const p = HIST.pesquisas[Number(s.dataset.repetir)]; if (!p) return;
  definirFiltro('tipo', p.tipo); definirFiltro('base', p.base);
  $('#q').value = estado.q = p.q; buscar(); $('#q').focus();
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-limpar-hist]'); if (!b) return;
  HIST[b.dataset.limparHist] = []; gravarHist(); desenharInicio();
});
const inicioHTML = $('#detalhe').innerHTML;
// o cursor já começa na pesquisa quando a tela inicial é a consulta (em tela de toque não, para o teclado não subir sozinho);
// nas outras telas o foco fica no começo da página, e o primeiro Tab encontra "Pular para o conteúdo"
const focoInicial = () => { if (document.body.classList.contains('ocioso') && window.matchMedia('(hover: hover)').matches) $('#q').focus(); };
// quem chega pelo endereço do site, sem indicar uma tela, começa pela apresentação; links diretos (#/orcamento/3,
// #/composicao/..., #/ da Consulta) abrem a tela pedida
if (!location.hash || location.hash === '#') history.replaceState(null, '', '#/apresentacao');
const tAcordando = setTimeout(() => { const a = $('#abertura'); if (a) a.classList.add('acordando'); }, 3500);
// as marcas "vai-ap"/"vai-outra" só valem até a primeira tela ser desenhada: depois disso saem, senão esconderiam
// as outras telas (inclusive se o carregamento falhar)
const soltarEntrada = () => document.documentElement.classList.remove('vai-ap', 'vai-outra');
carregarReferencia().then(() => { buscar(); rota(); soltarEntrada(); focoInicial(); }).finally(() => {
  soltarEntrada();
  clearTimeout(tAcordando);
  const a = $('#abertura'); if (!a) return;
  if (!a.classList.contains('chegada') || semMovimento()) { a.remove(); return; }
  // vindo da tela de entrada: a cortina amarela se recolhe e revela o sistema
  a.classList.add('recolher'); setTimeout(() => a.remove(), 650);
});


// ---------- comparativo entre meses (único lugar onde meses diferentes aparecem juntos) ----------
const CMP = { de: null, para: null, tipo: 'servico', base: 'todas', sentido: 'alta', q: '' };
let tCmp = 0;
const bloco = (rotulo, valor, nota, cor) => `<div class="bloco"${cor ? ` style="--cor:var(${cor})"` : ''}><span class="bloco-rotulo">${rotulo}</span><b>${valor}</b>${nota ? `<span class="bloco-nota">${nota}</span>` : ''}</div>`;
document.addEventListener('click', (e) => { if (e.target.closest('[data-cmp-base-todas]')) { CMP.base = 'todas'; CMP.de = null; CMP.para = null; desenharComparativo(); } });
async function desenharComparativo() {
  const d = $('#detalhe');
  // o servidor escolhe o par de meses (os dois últimos de uma mesma base) e diz quais meses a base filtrada tem
  const semEsq = d.querySelector('.comparativo') ? () => {} : comEsqueleto(d, `<div class="pagina"><section class="ficha">${esqueletoTabela(12)}</section></div>`);
  let r;
  const pedido = Object.fromEntries(Object.entries({ ...CMP, limite: 150 }).filter(([, v]) => v !== null && v !== undefined));
  try { r = await api(`/api/comparativo?${new URLSearchParams(pedido)}`); semEsq(); }
  catch (e) { semEsq(); d.innerHTML = `<div class="erro">${esc(e.message)}</div>`; return; }
  const meses = r.referencias || [];
  if (!r.de) {
    const qual = CMP.base !== 'todas' ? `O ${CMP.base} tem` : 'Há';
    d.innerHTML = `<div class="pagina comparativo">${vazio('calendario', `${qual} só um mês carregado`, 'Quando outro mês desta base for carregado, esta aba compara os preços entre eles.',
      CMP.base !== 'todas' ? '<button type="button" class="botao" data-cmp-base-todas>Ver todas as bases</button>' : '')}</div>`; return;
  }
  CMP.de = r.de.id; CMP.para = r.para.id;
  const avisoFonte = r.aviso ? `<p class="aviso-fonte" role="note"><b>Atenção:</b> ${esc(r.aviso)}</p>` : '';
  const rs = r.resumo, de = nomeRef(r.de.id), para = nomeRef(r.para.id);
  const parte = (n) => pct.format(rs.comparados ? (n || 0) / rs.comparados : 0);
  const seg = (campo, opcoes) => `<div class="segmentos" role="radiogroup" data-cmp="${campo}">${opcoes.map(([v, n]) =>
    `<button type="button" role="radio" data-v="${v}" aria-checked="${CMP[campo] === v}">${n}</button>`).join('')}</div>`;
  const sel = (id, valor) => `<select id="${id}">${meses.map((m) => `<option value="${esc(m.id)}"${m.id === valor ? ' selected' : ''}>${esc(m.descricao.replace(/-1$/, ''))}</option>`).join('')}</select>`;
  const linhas = r.itens.map((i) => `<tr>
      <td class="cod"><button type="button" class="cb cb-p" data-hist="${esc(i.tipo)}|${esc(i.base)}|${esc(i.codigo)}" title="Ver o preço em todos os meses"><span class="cb-num">${esc(i.codigo)}</span><span class="cb-base cb-${esc(i.base)}">${esc(i.base)}</span></button></td>
      <td class="desc">${esc(i.descricao)}</td><td>${esc(i.unidade)}</td>
      <td class="num">${money(i.preco_de)}</td><td class="num total">${money(i.preco_para)}</td>
      <td class="num">${seloVariacao(i.preco_para, i.preco_de, 0)}</td></tr>`).join('');
  const foco = document.activeElement && document.activeElement.id;
  d.innerHTML = `<div class="pagina comparativo">
    <header class="pag-cab">
      <div><h1>Comparativo entre meses</h1>
        <p class="sub">Variação de preço de cada item entre dois meses. Fora desta aba, cada mês aparece sozinho.</p></div>
      <div class="cmp-meses"><label>De ${sel('cmp-de', CMP.de)}</label><span aria-hidden="true">→</span><label>Para ${sel('cmp-para', CMP.para)}</label></div>
    </header>
    ${avisoFonte}
    <div class="blocos">
      ${bloco('Subiram', (rs.subiram || 0).toLocaleString('pt-BR'), `${parte(rs.subiram)} dos ${rs.comparados.toLocaleString('pt-BR')} comparados`, '--alta')}
      ${bloco('Desceram', (rs.desceram || 0).toLocaleString('pt-BR'), `${parte(rs.desceram)} dos comparados`, '--baixa')}
      ${bloco('Iguais', (rs.iguais || 0).toLocaleString('pt-BR'), `${parte(rs.iguais)} dos comparados`, '--linha-forte')}
      ${bloco(`Só em ${esc(para)}`, (rs.novos || 0).toLocaleString('pt-BR'), `${(rs.retirados || 0).toLocaleString('pt-BR')} só em ${esc(de)}`, '--acao')}
    </div>
    <section class="ficha">
      <div class="var-filtros">${seg('tipo', [['servico', 'Composições'], ['insumo', 'Insumos']])}${seg('base', [['todas', 'Todas as bases'], ...basesCarregadas().map((b) => [b, b])])}${seg('sentido', [['alta', 'Maiores altas'], ['baixa', 'Maiores quedas']])}
        <input id="cmp-q" class="cmp-q" type="search" placeholder="Filtrar por descrição ou código" value="${esc(CMP.q)}" aria-label="Filtrar itens do comparativo"></div>
      <div id="cmp-item"></div>
      ${linhas ? `<div class="tabela-rola"><table class="planilha"><thead><tr><th>Código</th><th>Descrição</th><th>Un.</th><th class="num">${esc(de)}</th><th class="num">${esc(para)}</th><th class="num">Variação</th></tr></thead>
        <tbody>${linhas}</tbody></table></div>
        <p class="fonte">Mostrando ${r.itens.length} itens, das maiores ${CMP.sentido === 'alta' ? 'altas' : 'quedas'} para as menores. Clique no código para ver o preço do item em todos os meses.</p>`
      : `<div class="tabela-rola"><table class="planilha" hidden></table></div>${vazio('grafico', 'Nenhum item para comparar', `Nenhum item tem preço nos dois meses${CMP.q ? ' com esse filtro' : ''}.`)}`}
    </section>
  </div>`;
  d.querySelectorAll('[data-cmp]').forEach((g) => g.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; CMP[g.dataset.cmp] = b.dataset.v;
    if (g.dataset.cmp === 'base') { CMP.de = null; CMP.para = null; }  // cada base tem os seus meses: o servidor escolhe o par dela
    desenharComparativo();
  }));
  $('#cmp-de').addEventListener('change', (e) => { CMP.de = e.target.value; desenharComparativo(); });
  $('#cmp-para').addEventListener('change', (e) => { CMP.para = e.target.value; desenharComparativo(); });
  const q = $('#cmp-q');
  q.addEventListener('input', () => { clearTimeout(tCmp); tCmp = setTimeout(() => { CMP.q = q.value; desenharComparativo(); }, 300); });
  if (foco === 'cmp-q') { q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  d.querySelectorAll('[data-hist]').forEach((b) => b.addEventListener('click', () => historicoDoItem(...b.dataset.hist.split('|'))));
}

async function historicoDoItem(tipo, base, codigo) {
  const caixa = $('#cmp-item');
  try {
    const r = await api(`/api/comparativo/item/${tipo}/${base}/${codigo}`);
    caixa.innerHTML = `<div class="cmp-detalhe"><div class="cmp-detalhe-cab">${codigoBase(codigo, base)}<span>${esc(r.descricao)}</span>
      <button type="button" class="mini" aria-label="Fechar" onclick="this.closest('.cmp-detalhe').remove()">✕</button></div>
      ${blocoHistorico(r.meses.map((m, k, l) => {
        const ant = l.slice(0, k).reverse().find((x) => x.preco != null);
        return { ...m, variacao: m.preco != null && ant ? m.preco / ant.preco - 1 : null };
      }), r.unidade)}</div>`;
    caixa.scrollIntoView({ block: 'nearest' });
  } catch (e) { caixa.innerHTML = `<p class="erro">${esc(e.message)}</p>`; }
}

// ---------- encargos sociais do mês ----------
async function desenharEncargos() {
  const d = $('#detalhe');
  let r;
  try { r = await api(`/api/encargos?${qsMesDe('ORSE')}`); } catch (e) { d.innerHTML = `<div class="erro">${esc(e.message)}</div>`; return; }
  const mesNome = nomeRef(r.referencia.id);
  const quadro = (tipo, titulo, nota) => {
    const e = r[tipo];
    const cab = `<header class="enc-cab"><div><h2>${titulo}</h2><p class="sub">${nota}</p></div>${e.total == null ? '' : `<span class="enc-total">${num2.format(e.total)}%</span>`}</header>`;
    if (e.total == null) return `<section class="ficha enc">${cab}${vazio('folha', 'Relatório ainda não carregado', `O modelo de encargo de ${tipo === 'horista' ? 'horistas' : 'mensalistas'} de ${esc(mesNome)} não foi enviado.`)}</section>`;
    if (!e.linhas.length) return `<section class="ficha enc">${cab}${vazio('folha', 'Sem o detalhamento deste mês', `O percentual acima é o aplicado nas composições de ${esc(mesNome)}. O relatório item a item ainda não foi carregado.`)}</section>`;
    const linhas = e.linhas.map((l) => l.item === l.grupo
      ? `<tr class="enc-grupo"><td>${esc(l.grupo)}</td><td>${esc(l.descricao)}</td><td class="num">${num2.format(l.valor)}%</td></tr>`
      : `<tr><td class="cod">${esc(l.item)}</td><td>${esc(l.descricao)}</td><td class="num">${num2.format(l.valor)}%</td></tr>`).join('');
    return `<section class="ficha enc">${cab}
      <table class="planilha"><thead><tr><th>Item</th><th>Descrição</th><th class="num">Valor</th></tr></thead><tbody>${linhas}</tbody>
      <tfoot><tr><td></td><td><b>Total do encargo social</b></td><td class="num"><b>${num2.format(e.total)}%</b></td></tr></tfoot></table></section>`;
  };
  d.innerHTML = `<div class="pagina encargos">
    <header class="pag-cab"><div><h1>Encargos sociais</h1>
      <p class="sub">Percentuais sobre o salário da mão de obra em <b>${esc(mesNome)}</b>, conforme o modelo da CEHOP.</p></div>${seletorDensidade()}</header>
    <div class="enc-grade">${quadro('horista', 'Horistas', 'Quem recebe por hora trabalhada')}${quadro('mensalista', 'Mensalistas', 'Quem recebe salário mensal')}</div>
    <p class="fonte">Fonte: ORSE (CEHOP/SE), Modelo de Encargo Social Horista e Mensalista, referência ${esc(r.referencia.descricao)}.</p>
  </div>`;
}

// "Pular para o conteúdo": leva o foco direto à área principal, sem mexer no endereço da tela
document.addEventListener('click', (e) => {
  if (!e.target.closest('.pular')) return;
  e.preventDefault();
  const alvo = document.body.classList.contains('ocioso') ? $('#q') : $('#detalhe');
  if (alvo.id === 'detalhe') alvo.setAttribute('tabindex', '-1');
  alvo.focus();
});
