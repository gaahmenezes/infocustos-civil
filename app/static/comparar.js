'use strict';
/* Comparar composições lado a lado: escolha na busca (até 3), bandeja no rodapé e página de comparação. */

const CMP_MAX = 3;
const CMP_SEL = (() => { try { const l = JSON.parse(sessionStorage.getItem('infocustos-comparar') || '[]'); return Array.isArray(l) ? l.slice(0, CMP_MAX) : []; } catch (_) { return []; } })();
const gravarSel = () => { try { sessionStorage.setItem('infocustos-comparar', JSON.stringify(CMP_SEL)); } catch (_) { /* fica na memória */ } };
window.estaComparando = (base, codigo) => CMP_SEL.some((x) => x.base === base && x.codigo === codigo);

function marcarBotoesComparar() {
  document.querySelectorAll('[data-comparar]').forEach((b) => {
    const [base, codigo] = b.dataset.comparar.split('|');
    const sim = window.estaComparando(base, codigo);
    b.setAttribute('aria-pressed', String(sim));
    b.textContent = sim ? (b.classList.contains('cmp-bt') ? 'Comparando' : 'Na comparação') : 'Comparar';
  });
}

window.desenharBandeja = function () {
  const b = $('#bandeja');
  const naConsulta = (document.body.dataset.aba || 'consulta') === 'consulta' && !estado.comparando;
  marcarBotoesComparar();
  if (!CMP_SEL.length || !naConsulta) { b.hidden = true; document.body.classList.remove('com-bandeja'); return; }
  b.hidden = false; document.body.classList.add('com-bandeja');
  b.innerHTML = `<span class="bandeja-rotulo">Comparar</span>
    <ul>${CMP_SEL.map((x, k) => `<li>${codigoBase(x.codigo, x.base)}<span class="bandeja-desc">${esc(x.descricao)}</span>
      <button type="button" class="mini" data-tirar="${k}" aria-label="Tirar ${esc(x.codigo)} da comparação">✕</button></li>`).join('')}</ul>
    ${CMP_SEL.length < 2 ? '<span class="bandeja-dica">Escolha mais uma composição</span>'
      : `<a class="botao primario" href="${rotaComparar(CMP_SEL)}">Comparar ${CMP_SEL.length} composições</a>`}
    <button type="button" class="bandeja-limpar" data-limpar-comparar>Limpar</button>`;
};

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-comparar]');
  if (b) {
    const [base, codigo] = b.dataset.comparar.split('|');
    const k = CMP_SEL.findIndex((x) => x.base === base && x.codigo === codigo);
    if (k >= 0) CMP_SEL.splice(k, 1);
    else if (CMP_SEL.length >= CMP_MAX) { avisar(`Dá para comparar até ${CMP_MAX} composições por vez. Tire uma para trocar.`); return; }
    else CMP_SEL.push({ base, codigo, descricao: b.dataset.desc || '' });
    gravarSel(); window.desenharBandeja(); return;
  }
  const t = e.target.closest('[data-tirar]');
  if (t) { CMP_SEL.splice(Number(t.dataset.tirar), 1); gravarSel(); window.desenharBandeja(); return; }
  if (e.target.closest('[data-limpar-comparar]')) { CMP_SEL.length = 0; gravarSel(); window.desenharBandeja(); }
});

// ---------- página ----------
const CMP_CAT = [['mo', 'Mão de obra, com encargos', '--c-mo'], ['mat', 'Material', '--c-mat'], ['equip', 'Equipamento', '--c-equip'], ['terc', 'Serviço de terceiro', '--c-terc']];
const CMP_VER = { soDif: false };

function categorias(c) {
  const tem = (c.custo_equipamento || 0) + (c.custo_mao_de_obra || 0) + (c.custo_material || 0) + (c.custo_servico_terceiro || 0) > 0;
  const r = tem || c.modelo === 'DNIT' ? c : { ...c, ...resumoPelosItens(c) };
  return { mo: (r.custo_mao_de_obra || 0) + (r.custo_encargo_social || 0), mat: r.custo_material || 0, equip: r.custo_equipamento || 0, terc: r.custo_servico_terceiro || 0 };
}
const difere = (vals) => { const v = vals.filter((x) => x != null); return v.length !== vals.length || v.some((x) => Math.abs(x - v[0]) > 1e-9); };

window.desenharComparar = async function (texto) {
  const d = $('#detalhe');
  const pedidos = texto.split(',').map((t) => { const k = t.indexOf('-'); return { base: t.slice(0, k), codigo: t.slice(k + 1) }; })
    .filter((x) => (x.base === 'ORSE' || x.base === 'SINAPI') && /^\w+$/.test(x.codigo)).slice(0, CMP_MAX);
  if (pedidos.length < 2) {
    d.innerHTML = `<div class="pagina">${vazio('planilha', 'Escolha pelo menos duas composições', 'Na consulta, use o botão "Comparar" em cada resultado.', '<a class="botao primario" href="#/">Ir para a consulta</a>')}</div>`; return;
  }
  if (!d.querySelector('.comparar')) d.innerHTML = '<p class="carregando">Montando a comparação…</p>';
  const res = await Promise.all(pedidos.map((x) => api(`/api/composicao/${x.base}/${x.codigo}?${qsMes()}`).then((c) => ({ c }), (e) => ({ erro: e.message, ...x }))));
  const ok = res.filter((r) => r.c).map((r) => r.c), falhas = res.filter((r) => r.erro);
  const mes = nomeRef(estado.mes);
  if (ok.length < 2) {
    d.innerHTML = `<div class="pagina">${vazio('planilha', 'Não deu para comparar', `${falhas.map((f) => `${esc(f.codigo)}/${esc(f.base)}: ${esc(f.erro)}`).join(' ')}`, '<a class="botao" href="#/">Voltar à consulta</a>')}</div>`; return;
  }
  const menor = Math.min(...ok.map((c) => c.custo_total));
  const unidades = [...new Set(ok.map((c) => (c.unidade || '').toLowerCase()))];
  const cats = ok.map(categorias);
  const resto = (k) => rotaComparar(ok.filter((_, j) => j !== k));

  const cab = ok.map((c, k) => {
    const dif = menor > 0 ? c.custo_total / menor - 1 : 0;
    const partes = CMP_CAT.filter(([q]) => cats[k][q] > 0).map(([q, n, cor]) => `<i style="flex-grow:${cats[k][q]};background:var(${cor})" title="${n}: ${brl.format(cats[k][q])}"></i>`).join('');
    return `<th scope="col" class="cmp-col"><div class="cmp-cab">
        <div class="cmp-cab-topo">${codigoBase(c.codigo, c.base)}${ok.length > 2 ? `<a class="mini" href="${resto(k)}" aria-label="Tirar ${esc(c.codigo)} da comparação" title="Tirar da comparação">✕</a>` : ''}</div>
        <a class="cmp-desc" href="${rotaItem('servico', esc(c.base), esc(c.codigo))}" title="Abrir a composição">${esc(c.descricao)}</a>
        <div class="cmp-preco"><b>${brl.format(c.custo_total)}</b><span>por ${esc(c.unidade)}</span></div>
        ${Math.abs(dif) < 0.00005 ? '<span class="var var-baixa">menor preço</span>' : `<span class="var var-alta">+${pct.format(dif)} sobre o menor</span>`}
        <span class="mini-barra">${partes}</span>
      </div></th>`;
  }).join('');

  const linCat = CMP_CAT.map(([q, n, cor]) => {
    const vals = cats.map((x) => x[q]); const mx = Math.max(...vals, 0.01);
    return `<tr><th scope="row"><span class="ponto" style="background:var(${cor})"></span>${n}</th>${ok.map((c, k) => `<td class="num"><span class="cmp-valor">${brl.format(vals[k])}</span>
      <span class="cmp-trilho"><i style="width:${(vals[k] / mx) * 100}%;background:var(${cor})"></i></span><span class="cmp-pct">${pct.format(c.custo_total ? vals[k] / c.custo_total : 0)}</span></td>`).join('')}</tr>`;
  }).join('');

  // itens: une pelo código; a linha mostra o coeficiente e o custo em cada composição
  const corpo = SECOES.map(([sec, nome, cor]) => {
    const mapa = new Map();
    ok.forEach((c, k) => c.itens.filter((i) => i.secao === sec).forEach((i) => {
      const ch = `${i.base}|${i.codigo}`;
      const l = mapa.get(ch) || { base: i.base, codigo: i.codigo, descricao: i.descricao, unidade: i.unidade, servico: i.eh_servico, cel: ok.map(() => null) };
      l.cel[k] = { qtd: i.qtd, custo: i.custo_total }; mapa.set(ch, l);
    }));
    if (!mapa.size) return '';
    const linhas = [...mapa.values()].sort((a, b) => Math.max(...b.cel.map((x) => (x ? x.custo || 0 : 0))) - Math.max(...a.cel.map((x) => (x ? x.custo || 0 : 0))));
    const somas = ok.map((_, k) => linhas.reduce((s, l) => s + (l.cel[k] ? l.cel[k].custo || 0 : 0), 0));
    const trs = linhas.map((l) => {
      const dif = difere(l.cel.map((x) => (x ? x.qtd : null))) || difere(l.cel.map((x) => (x ? x.custo : null)));
      if (CMP_VER.soDif && !dif) return '';
      return `<tr class="${dif ? 'difere' : 'igual'}"><th scope="row"><span class="cmp-item">${codLink(l.servico ? 'servico' : 'insumo', l.base, l.codigo)}<span class="cmp-item-desc">${esc(l.descricao)}</span><span class="cmp-item-un">${esc(l.unidade)}</span></span></th>
        ${l.cel.map((x) => (x ? `<td class="num"><span class="cmp-coef">${coef(x.qtd)}</span><span class="cmp-valor">${money(x.custo)}</span></td>` : '<td class="num ausente">não usa</td>')).join('')}</tr>`;
    }).join('');
    return `<tbody><tr class="cmp-secao"><th scope="row"><span class="ponto" style="background:var(${cor})"></span>${nome} <span class="nota">${linhas.length} ${linhas.length === 1 ? 'item' : 'itens'}</span></th>
      ${somas.map((s) => `<td class="num">${brl.format(s)}</td>`).join('')}</tr>${trs}</tbody>`;
  }).join('');

  d.innerHTML = `<div class="pagina comparar">
    <header class="pag-cab">
      <div><a class="voltar-lista" href="#/"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 3 4.5 6l3 3" /></svg>Consulta</a>
        <h1>Comparar composições</h1><p class="sub">Preços de <b>${esc(mes)}</b>, sem BDI. As diferenças aparecem em destaque.</p></div>
      <div class="segmentos" role="radiogroup" aria-label="O que mostrar" data-cmp-ver>
        <button type="button" role="radio" data-v="tudo" aria-checked="${!CMP_VER.soDif}">Todos os itens</button>
        <button type="button" role="radio" data-v="dif" aria-checked="${CMP_VER.soDif}">Só as diferenças</button></div>
    </header>
    ${falhas.length ? `<p class="erro">${falhas.map((f) => `${esc(f.codigo)}/${esc(f.base)} ficou de fora: ${esc(f.erro)}`).join(' ')}</p>` : ''}
    ${unidades.length > 1 ? `<p class="cmp-alerta">As unidades são diferentes (${ok.map((c) => esc(c.unidade)).join(', ')}). O preço de uma não se compara direto com o da outra.</p>` : ''}
    <section class="ficha"><div class="tabela-rola"><table class="cmp-tabela" style="--colunas:${ok.length}">
      <thead><tr><td class="cmp-canto"></td>${cab}</tr></thead>
      <tbody class="cmp-cats"><tr class="cmp-secao"><th scope="row" colspan="${ok.length + 1}">Custo por categoria</th></tr>${linCat}
        <tr class="cmp-total"><th scope="row">Custo total</th>${ok.map((c) => `<td class="num">${brl.format(c.custo_total)}</td>`).join('')}</tr></tbody>
      <tbody><tr class="cmp-legenda"><th scope="row">Insumos e serviços</th>${ok.map(() => '<td class="num">coeficiente · custo (R$)</td>').join('')}</tr></tbody>
      ${corpo}
    </table></div>
    <p class="fonte">Fonte: ORSE e SINAPI, referência ${esc(mes)}. Itens com o mesmo código ficam na mesma linha; as bases usam códigos próprios, então o mesmo material pode aparecer em linhas separadas.</p></section>
  </div>`;
  d.querySelector('[data-cmp-ver]').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return; CMP_VER.soDif = b.dataset.v === 'dif'; window.desenharComparar(texto);
  });
};
