'use strict';
/* Tela de apresentação: o produto em movimento, com itens e preços reais da base do mês.
   Três cenas se revezam (consultar, orçar, entregar). Quem pede menos movimento vê as cenas paradas e troca pelos botões. */

const AP = { cena: 0, t: [], dados: null, vivo: false };
const apEspera = (ms) => new Promise((ok) => { AP.t.push(setTimeout(ok, ms)); });
const apParar = () => { AP.t.forEach(clearTimeout); AP.t = []; };
// em tela grande, a rolagem conduz a demonstração: o herói fica preso e cada trecho da descida mostra uma cena
const apRolagem = () => window.innerWidth >= 1000 && window.innerHeight >= 700 && !semMovimento();
function apCenaDaRolagem() {
  const tr = $('.ap-trilho.rolando'); if (!tr) return null;
  const q = tr.getBoundingClientRect(), topo = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topo')) || 0;
  const curso = q.height - (window.innerHeight - topo);
  const p = curso > 0 ? Math.min(0.999, Math.max(0, (topo - q.top) / curso)) : 0;
  tr.style.setProperty('--ap-p', p.toFixed(4));
  return Math.floor(p * CENAS.length);
}
let apQuadro = 0;
window.addEventListener('scroll', () => {
  if (!AP.vivo || apQuadro) return;
  apQuadro = requestAnimationFrame(() => { apQuadro = 0; const k = apCenaDaRolagem(); if (k != null && k !== AP.cena && AP.dados) apMostrar(k, false); });
}, { passive: true });
function apIrParaCena(k) {
  const tr = $('.ap-trilho.rolando'); if (!tr) { apMostrar(k, false); return; }
  const topo = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topo')) || 0;
  const curso = tr.offsetHeight - (window.innerHeight - topo);
  window.scrollTo({ top: tr.getBoundingClientRect().top + window.scrollY - topo + curso * ((k + 0.15) / CENAS.length), behavior: 'auto' });
  if (k !== AP.cena) apMostrar(k, false);
}

async function apDados() {
  if (AP.dados && AP.dados.mes === estado.mes) return AP.dados;
  const buscar1 = (q, tipo = 'servico') => api(`/api/busca?${new URLSearchParams({ q, base: 'todas', tipo, limite: 3, ref: estado.mes || '' })}`).then((r) => r.itens.filter((x) => x.preco != null));
  const [chap, alv, pint] = await Promise.all([buscar1('chapisco parede'), buscar1('alvenaria bloco ceramico'), buscar1('pintura acrilica')]);
  const linhas = [[alv[0], 420], [chap[0], 840], [pint[0], 840]].filter((x) => x[0]).map(([it, qtd]) => ({ ...it, qtd, total: Math.round(qtd * it.preco * 1.25 * 100) / 100 }));
  // divisão do custo calculada com a divisão real de cada composição da cena
  const custo = linhas.reduce((s, l) => s + l.qtd * l.preco, 0) || 1;
  const div = Object.fromEntries(['mo', 'mat', 'equip', 'terc'].map((k) => [k, linhas.reduce((s, l) => s + l.qtd * l.preco * (l[`pct_${k}`] || 0), 0) / custo]));
  AP.dados = { mes: estado.mes, busca: chap.slice(0, 3), linhas, div, total: linhas.reduce((s, l) => s + l.total, 0) };
  return AP.dados;
}

const apRes = (it) => `<div class="ap-res"><span class="res-cod">${codigoBase(it.codigo, it.base)}<span class="tipo tipo-servico">Composição</span></span>
  <span class="res-preco">${brl.format(it.preco)}<span class="un">${unid(it.unidade)}</span></span><span class="ap-res-desc">${esc(it.descricao)}</span><span class="res-div">${divisaoCusto(it)}</span></div>`;

const CENAS = [
  { nome: 'Consultar', titulo: 'Ache o preço enquanto digita',
    montar: (d) => `<div class="ap-busca"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5 21 21" /></svg><span class="ap-digita" data-texto="chapisco parede"></span><i class="ap-cursor"></i></div>
      <div class="ap-lista">${d.busca.map(apRes).join('')}</div>`,
    tocar: async (pal) => {
      const alvo = pal.querySelector('.ap-digita'), itens = [...pal.querySelectorAll('.ap-res')];
      for (const ch of alvo.dataset.texto) { alvo.textContent += ch; await apEspera(70 + Math.random() * 60); }
      for (const it of itens) { it.classList.add('visivel'); await apEspera(140); }
      await apEspera(500); if (itens[0]) itens[0].classList.add('escolhido');
    },
    parado: (pal) => { pal.querySelector('.ap-digita').textContent = 'chapisco parede'; pal.querySelectorAll('.ap-res').forEach((x) => x.classList.add('visivel')); } },
  { nome: 'Orçar', titulo: 'Monte a planilha e veja onde o custo pesa',
    montar: (d) => `<div class="ap-orc-topo"><div><span class="ap-rotulo">Exemplo: reforma de escola · BDI 25%</span><b class="ap-orc-total"><span class="moeda">R$</span>&nbsp;<span class="num-grande" id="ap-total">0,00</span></b></div>
        <div class="ap-barra" title="Divisão do custo: mão de obra, material, equipamento e terceiros">${PAINEL_PARTES.filter(([k]) => d.div[k] > 0.004).map(([k, , cor]) => `<i style="--f:${d.div[k].toFixed(4)};background:var(${cor})"></i>`).join('')}</div></div>
      <div class="ap-linhas">${d.linhas.map((l, k) => `<div class="ap-linha"><span class="ap-n">1.${k + 1}</span>${codigoBase(l.codigo, l.base)}<span class="ap-linha-desc">${esc(l.descricao)}</span>
        <span class="ap-qtd">${l.qtd.toLocaleString('pt-BR')}<span class="un">${unid(l.unidade)}</span></span><b>${num2.format(l.total)}</b></div>`).join('')}</div>`,
    tocar: async (pal, d) => {
      const tot = pal.querySelector('#ap-total'); let soma = 0;
      for (const [k, el] of [...pal.querySelectorAll('.ap-linha')].entries()) {
        el.classList.add('visivel'); const novo = soma + d.linhas[k].total;
        contar(tot, soma, novo); tot.textContent = num2.format(novo); soma = novo; await apEspera(620);
      }
      pal.querySelector('.ap-barra').classList.add('visivel');
    },
    parado: (pal, d) => { pal.querySelectorAll('.ap-linha').forEach((x) => x.classList.add('visivel')); pal.querySelector('#ap-total').textContent = num2.format(d.total); pal.querySelector('.ap-barra').classList.add('visivel'); } },
  { nome: 'Entregar', titulo: 'Saia com o relatório pronto para a proposta',
    montar: (d) => `<div class="ap-folhas"><div class="ap-folha ap-folha-3"></div><div class="ap-folha ap-folha-2"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <div class="ap-folha ap-folha-1"><span class="ap-faixa"></span><span class="ap-rotulo">Orçamento de obra · exemplo</span><b>Reforma de escola</b>
        <span class="ap-folha-total"><span class="ap-rotulo">Valor total</span><strong>${brl.format(d.total)}</strong></span></div><span class="ap-pdf">PDF</span></div>`,
    tocar: async (pal) => { await apEspera(80); pal.querySelector('.ap-folhas').classList.add('visivel'); },
    parado: (pal) => pal.querySelector('.ap-folhas').classList.add('visivel') },
];

async function apMostrar(k, automatico) {
  const palco = $('#ap-palco'); if (!palco || !AP.dados) return;
  apParar(); AP.cena = k;
  document.querySelectorAll('.ap-abas button').forEach((b, n) => { b.setAttribute('aria-selected', String(n === k)); b.classList.toggle('correndo', n === k && automatico && !semMovimento()); });
  const c = CENAS[k];
  palco.innerHTML = `<p class="ap-cena-titulo">${c.titulo}</p><div class="ap-cena">${c.montar(AP.dados)}</div>`;
  const cena = palco.querySelector('.ap-cena');
  if (semMovimento()) { c.parado(cena, AP.dados); return; }
  await c.tocar(cena, AP.dados);
  if (!automatico) return;
  await apEspera(2600);
  if (AP.vivo && document.body.contains(palco) && !document.hidden) apMostrar((k + 1) % CENAS.length, true);
}

window.desenharApresentacao = async function () {
  const d = $('#detalhe'), ref = estado.ref; AP.vivo = true; apParar();
  const n = (t) => ref ? ref.totais.filter((x) => x.tipo === t).reduce((s, x) => s + x.n, 0) : 0;
  const mes = nomeRef(estado.mes), meses = ref ? ref.referencias.length : 0;
  const pontos = [
    ['lupa', 'Busca que acompanha a digitação', 'Composições e insumos da ORSE e da SINAPI juntos ou isolados, com a unidade e a divisão do custo já no resultado.'],
    ['folha', 'Composição aberta até o insumo', 'Coeficientes, custos e o peso de cada item. Serviços auxiliares se desdobram na mesma tabela.'],
    ['planilha', 'Comparação lado a lado', 'Até três composições na mesma tela, com o menor preço indicado e as diferenças em destaque.'],
    ['grafico', 'Orçamento que se explica', 'Custo por etapa, curva ABC e divisão entre mão de obra e material. Itens mudam de ordem arrastando.'],
    ['relogio', 'Cada mês no seu lugar', 'A consulta mostra um mês por vez. A variação de preços fica numa aba própria, só para comparar.'],
    ['calendario', 'Relatório com a sua marca', 'Capa, resumo, planilha, curva ABC e composições analíticas em PDF, com nome e logotipo da empresa.'],
  ];
  const rolando = apRolagem();
  d.innerHTML = `<div class="apresentacao">
    <div class="ap-trilho${rolando ? ' rolando' : ''}">
    <section class="ap-heroi">
      <div class="ap-texto">
        <p class="ap-olho"><span></span>Preços ORSE e SINAPI de ${esc(mes)}</p>
        <h1>Do preço à proposta,<br><em>sem perder o fio.</em></h1>
        <p class="ap-sub">Consulte as bases, abra cada composição até o insumo, monte o orçamento e saia com o relatório pronto. Tudo numa tela limpa, no computador ou no celular.</p>
        <div class="ap-acoes"><a class="botao primario ap-cta" href="#/">Começar a orçar</a><a class="botao ap-sec" href="#/orcamentos">Ver orçamentos</a></div>
        <dl class="ap-numeros"><div><dt>${n('servico').toLocaleString('pt-BR')}</dt><dd>composições</dd></div><div><dt>${n('insumo').toLocaleString('pt-BR')}</dt><dd>insumos</dd></div>
          <div><dt>${meses}</dt><dd>${meses === 1 ? 'mês carregado' : 'meses carregados'}</dd></div></dl>
      </div>
      <div class="ap-janela" aria-label="Demonstração do sistema">
        <div class="ap-janela-topo"><i></i><i></i><i></i>
          <div class="ap-abas" role="tablist" aria-label="Cenas da demonstração">${CENAS.map((c, k) => `<button type="button" role="tab" aria-selected="${k === 0}" data-cena="${k}">${c.nome}</button>`).join('')}</div></div>
        <div class="ap-palco" id="ap-palco" role="tabpanel"><div class="ap-carregando">${osso('60%', 18)}${osso('100%', 54)}${osso('100%', 54)}${osso('100%', 54)}</div></div>
      </div>
      ${rolando ? '<p class="ap-role" aria-hidden="true"><span class="ap-role-barra"><i></i></span>Role a página para ver as três cenas</p>' : ''}
    </section>
    </div>
    <section class="ap-pontos" aria-label="O que o sistema faz">${pontos.map(([ic, t, x]) => `<article class="ap-ponto"><svg viewBox="0 0 48 48" aria-hidden="true">${ICONES[ic]}</svg><h2>${t}</h2><p>${x}</p></article>`).join('')}</section>
    <p class="ap-nota">Os preços vêm dos relatórios publicados pela CEHOP/SE e são conferidos item a item a cada mês. O InfoCustos Civil é um produto independente: não é um site da CEHOP nem da CAIXA.</p>
  </div>`;
  d.querySelector('.ap-abas').addEventListener('click', (e) => { const b = e.target.closest('[data-cena]'); if (b) apIrParaCena(Number(b.dataset.cena)); });
  try { await apDados(); } catch (_) { const j = d.querySelector('.ap-janela'); if (j) j.remove(); return; }
  if (document.body.contains($('#ap-palco'))) apMostrar(0, !rolando);
};
window.sairDaApresentacao = () => { AP.vivo = false; apParar(); };
