'use strict';
/* Composições e insumos próprios da empresa.
   A composição própria é viva: o preço de cada item vem da data-base escolhida para a base dele (seletor do topo),
   então trocar o mês atualiza o custo sozinho. Itens podem ser de qualquer base ou próprios (inclusive outras composições próprias). */

const PROP = { aba: 'composicoes', dados: null, atual: null, editarIns: null, base: 1, q: {}, ordem: {}, lim: {} };
try { PROP.ordem = JSON.parse(localStorage.getItem('prop-ordem') || '{}') || {}; } catch (_) { /* ok */ }
try { PROP.base = Number(localStorage.getItem('infocustos-base-propria')) || 1; } catch (_) { /* sem armazenamento */ }
const lembrarBase = (id) => { PROP.base = id; try { localStorage.setItem('infocustos-base-propria', String(id)); } catch (_) { /* ok */ } };
async function recarregarBases() {
  try { const b = await req('/api/proprias/bases'); if (estado.ref) estado.ref.bases_proprias = b; if (b[0] && estado.ref) estado.ref.base_propria = b[0].nome; mostrarNomeBasePropria(); return b; }
  catch (_) { return basesProprias(); }
}
const TIPO_INSUMO = { MATERIAL: 'Material', MAO_DE_OBRA: 'Mão de obra', EQUIPAMENTO: 'Equipamento', SERVICO_TERCEIRO: 'Serviço de terceiro' };
const qsRefs = () => `refs=${encodeURIComponent(refsQs())}`;
const dataBr = (d) => (d ? d.split('-').reverse().join('/') : '');

window.rotaProprias = async function () {
  const m = location.hash.match(/^#\/propria\/(P\d+)/);
  if (m) { await abrirEditor(m[1]); return; }
  await desenharListaProprias();
};

// ---------- lista ----------
async function desenharListaProprias() {
  const d = $('#detalhe');
  const semEsq = d.querySelector('.proprias') ? () => {} : comEsqueleto(d, `<div class="pagina">${esqueletoCartoes(4)}</div>`);
  try {
    PROP.dados = await req(`/api/proprias?${qsRefs()}&base_id=${PROP.base}`);
    if (!PROP.dados.bases.some((b) => b.id === PROP.base)) { lembrarBase(PROP.dados.bases[0].id); PROP.dados = await req(`/api/proprias?${qsRefs()}&base_id=${PROP.base}`); }
    semEsq();
  } catch (e) { semEsq(); d.innerHTML = `<div class="pagina"><div class="erro">${esc(e.message)}</div></div>`; return; }
  if (!/^#\/propria/.test(location.hash)) return;
  const { composicoes, insumos, bases } = PROP.dados;
  if (estado.ref) { estado.ref.bases_proprias = bases; estado.ref.base_propria = bases[0].nome; mostrarNomeBasePropria(); }
  const base = bases.find((b) => b.id === PROP.base);
  const seletor = `<div class="prop-bases" role="radiogroup" aria-label="Base própria">${bases.map((b) => `<button type="button" role="radio" class="prop-base-bt" data-prop-base="${b.id}" aria-checked="${b.id === PROP.base}">
      <b>${esc(b.nome)}</b><span>${b.composicoes} ${b.composicoes === 1 ? 'composição' : 'composições'} · ${b.insumos} ${b.insumos === 1 ? 'insumo' : 'insumos'}</span></button>`).join('')}
    <button type="button" class="prop-base-bt prop-base-nova" data-prop-base-nova><b>+ Nova base</b><span>vazia, para montar ou importar</span></button></div>`;
  const seg = `<div class="segmentos" role="radiogroup" aria-label="Mostrar" data-prop-aba>
    <button type="button" role="radio" data-v="composicoes" aria-checked="${PROP.aba === 'composicoes'}">Composições <span class="n">${composicoes.length}</span></button>
    <button type="button" role="radio" data-v="insumos" aria-checked="${PROP.aba === 'insumos'}">Insumos próprios <span class="n">${insumos.length}</span></button></div>`;
  // busca e ordem em cada lista (composições no formato da Consulta, insumos na tabela)
  const barraLista = (qual, total) => `<div class="prop-filtro" data-prop-filtro="${qual}">
      <input type="search" class="cmp-q" data-prop-q="${qual}" value="${esc(PROP.q[qual] || '')}" placeholder="Buscar ${qual === 'composicoes' ? 'composição' : 'insumo'} por nome, código, código do SIENGE ou grupo" aria-label="Buscar ${qual === 'composicoes' ? 'composições' : 'insumos'} desta base">
      <label class="ordem">Ordenar por <select data-prop-ordem="${qual}">${Object.entries(ORDENS_PROP).filter(([k]) => k !== 'recentes' || qual === 'composicoes')
        .map(([k, [n]]) => `<option value="${k}"${k === ordemDe(qual) ? ' selected' : ''}>${n}</option>`).join('')}</select></label>
      <span class="prop-contagem" data-prop-contagem="${qual}">${total}</span></div>`;
  const cartoes = composicoes.length ? `${barraLista('composicoes', '')}<ul class="lista prop-lista" data-prop-lista="composicoes"></ul>`
    : vazio('folha', 'Nenhuma composição própria ainda', 'Monte uma do zero ou abra uma composição da ORSE, da SINAPI ou do SICRO e use "Criar composição própria a partir desta".',
      '<button type="button" class="botao primario" data-nova-propria>Nova composição</button>');
  const tabela = insumos.length ? `${barraLista('insumos', '')}<div class="tabela-rola"><table class="planilha prop-insumos"><thead><tr><th>Código</th><th>Descrição</th><th>Un.</th><th>Tipo e grupo</th>
      <th class="num">Preço</th><th>Data e fonte</th><th class="ctrl"><span class="sr">Ações</span></th></tr></thead><tbody data-prop-lista="insumos"></tbody></table></div>`
    : vazio('folha', 'Nenhum insumo próprio ainda', 'Cadastre materiais, mão de obra ou equipamentos com o preço da sua cotação.',
      '<button type="button" class="botao primario" data-novo-insumo>Novo insumo</button>');
  d.innerHTML = `<div class="pagina proprias">
    <h1 class="sr">Bases próprias</h1>
    ${seletor}
    <header class="pag-cab"><div class="prop-ident">
      <label class="prop-base-rot" for="prop-base-nome">Nome da base <span>aparece nas etiquetas dos itens, na busca e nos relatórios · clique para alterar</span></label>
      <input class="orc-nome" id="prop-base-nome" value="${esc(base.nome)}" maxlength="40" aria-label="Nome da base própria" data-base-id="${base.id}">
      <p class="sub">Composições com itens de qualquer base (ORSE, SINAPI, SICRO) ou próprios. O custo é recalculado com a data-base de cada base, escolhida no topo.</p></div>
      <div class="acoes"><a class="botao" href="#/importar">Importar arquivo</a><button type="button" class="botao" data-novo-insumo>Novo insumo</button><button type="button" class="botao primario" data-nova-propria>Nova composição</button>
        ${bases.length > 1 ? menu('Mais', ['<button type="button" role="menuitem" class="perigo" data-prop-base-excluir>Excluir esta base</button>']) : ''}</div></header>
    <div class="prop-barra">${seg}<p class="prop-datas">Preços com ${esc(gruposDeData().map((x) => `${juntar(x.bases)} de ${nomeRef(x.mes)}`).join(' · '))}</p></div>
    <section class="${PROP.aba === 'composicoes' ? '' : 'oculto'}" data-prop-painel="composicoes">${cartoes}</section>
    <section class="ficha ${PROP.aba === 'insumos' ? '' : 'oculto'}" data-prop-painel="insumos">${tabela}</section>
  </div>`;
  desenharListaProp('composicoes'); desenharListaProp('insumos');
}

// ---------- busca e ordem das listas da base própria ----------
const ORDENS_PROP = {
  recentes: ['Alteradas por último', (a, b) => String(b.atualizado_em || '').localeCompare(String(a.atualizado_em || ''))],
  nome: ['Nome (A a Z)', (a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR')],
  codigo: ['Código', (a, b) => numCod(a.codigo) - numCod(b.codigo)],
  origem: ['Código do SIENGE', (a, b) => (numCod(a.codigo_origem) - numCod(b.codigo_origem)) || String(a.codigo_origem).localeCompare(String(b.codigo_origem))],
};
const numCod = (c) => { const m = String(c || '').match(/\d+/); return m ? Number(m[0]) : Number.MAX_SAFE_INTEGER; };
const ordemDe = (qual) => PROP.ordem[qual] || (qual === 'composicoes' ? 'recentes' : 'nome');
const PASSO_PROP = 80;
function filtrarProp(qual) {
  const termos = semAcento(PROP.q[qual] || '').split(/\s+/).filter(Boolean);
  const lista = PROP.dados[qual].filter((x) => { if (!termos.length) return true; const alvo = semAcento(`${x.descricao} ${x.codigo} ${x.codigo_origem || ''} ${x.grupo || ''}`); return termos.every((t) => alvo.includes(t)); });
  return lista.sort(ORDENS_PROP[ordemDe(qual)][1]);
}
function desenharListaProp(qual) {
  const alvo = document.querySelector(`[data-prop-lista="${qual}"]`); if (!alvo || !PROP.dados) return;
  const lista = filtrarProp(qual), lim = PROP.lim[qual] || PASSO_PROP, vis = lista.slice(0, lim);
  const cont = document.querySelector(`[data-prop-contagem="${qual}"]`);
  if (cont) cont.innerHTML = `<b>${lista.length.toLocaleString('pt-BR')}</b> ${lista.length === 1 ? 'resultado' : 'resultados'}${lista.length > vis.length ? ` · mostrando ${vis.length.toLocaleString('pt-BR')}` : ''}`;
  const mais = lista.length > vis.length ? `<button type="button" class="botao" data-prop-mais="${qual}">Mostrar mais ${Math.min(PASSO_PROP, lista.length - vis.length).toLocaleString('pt-BR')} <span class="n">de ${(lista.length - vis.length).toLocaleString('pt-BR')} restantes</span></button>` : '';
  const realce = (t) => { const termos = semAcento(PROP.q[qual] || '').split(/\s+/).filter((x) => x.length > 1); if (!termos.length) return esc(t);
    // marca as palavras buscadas sem perder os acentos do texto
    const sa = semAcento(t); const marcas = new Array(t.length).fill(false);
    termos.forEach((x) => { let k = sa.indexOf(x); while (k >= 0) { for (let m = k; m < k + x.length; m += 1) marcas[m] = true; k = sa.indexOf(x, k + 1); } });
    let out = '', dentro = false; [...t].forEach((ch, k) => { if (marcas[k] !== dentro) { out += marcas[k] ? '<mark>' : '</mark>'; dentro = marcas[k]; } out += esc(ch); }); return out + (dentro ? '</mark>' : ''); };
  if (qual === 'composicoes') {
    alvo.innerHTML = vis.length ? vis.map((c) => {
      const meta = [c.grupo || 'Sem grupo', c.tipo_preco === 'informado' ? 'preço informado' : '', c.codigo_origem ? `SIENGE ${c.codigo_origem}` : '', c.origem_codigo ? `a partir de ${c.origem_codigo}/${c.origem_base}` : '',
        `${c.qtd_itens} ${c.qtd_itens === 1 ? 'item' : 'itens'}`].filter(Boolean);
      const div = c.divisao ? barraDivisao(c.divisao) : '';
      return `<li><a class="res prop-res prop-cartao" href="#/propria/${esc(c.codigo)}">
        <span class="res-cod">${codigoBase(c.codigo, 'PROPRIA')}<span class="tipo tipo-servico">Composição</span></span>
        <span class="res-desc">${realce(c.descricao)}</span>
        <span class="res-meta">${esc(meta.join(' · '))}${c.itens_sem_preco ? ` · <b class="prop-alerta">${c.itens_sem_preco} ${c.itens_sem_preco === 1 ? 'item' : 'itens'} sem preço</b>` : ''}</span>
        <span class="res-preco">${c.custo_total == null ? '<span class="sem-preco">sem preço</span>' : brl.format(c.custo_total)}<span class="un" title="Unidade">${unid(c.unidade)}</span></span>
        <span class="res-div">${div}</span></a></li>`; }).join('') + (mais ? `<li class="mais-li">${mais}</li>` : '')
      : `<li class="nada"><b>Nenhuma composição com "${esc(PROP.q[qual])}".</b> Tente menos palavras ou o código.</li>`;
  } else {
    alvo.innerHTML = vis.length ? vis.map((i) => `<tr><td class="cod">${codLink('insumo', 'PROPRIA', i.codigo)}${i.codigo_origem ? `<span class="prop-orig">SIENGE ${esc(i.codigo_origem)}</span>` : ''}</td><td class="desc">${realce(i.descricao)}</td><td>${unid(i.unidade)}</td>
        <td>${esc(TIPO_INSUMO[i.tipo] || i.tipo)}${i.grupo ? `<span class="prop-grupo">${esc(i.grupo)}</span>` : ''}</td><td class="num">${i.preco == null ? '<span class="sem-preco">sem preço</span>' : money(i.preco)}</td>
        <td class="prop-fonte">${esc([dataBr(i.data_preco), i.fonte].filter(Boolean).join(' · ')) || '—'}</td>
        <td class="ctrl"><button type="button" class="mini" data-editar-insumo="${esc(i.codigo)}" aria-label="Editar ${esc(i.codigo)}">✎</button>
          <button type="button" class="mini" data-excluir-insumo="${esc(i.codigo)}" aria-label="Excluir ${esc(i.codigo)}">✕</button></td></tr>`).join('') + (mais ? `<tr class="mais-tr"><td colspan="7">${mais}</td></tr>` : '')
      : `<tr><td colspan="7" class="nada"><b>Nenhum insumo com "${esc(PROP.q[qual])}".</b> Tente menos palavras ou o código.</td></tr>`;
  }
}
let tProp = 0;
document.addEventListener('input', (e) => {
  const q = e.target.closest && e.target.closest('[data-prop-q]'); if (!q) return;
  clearTimeout(tProp); tProp = setTimeout(() => { PROP.q[q.dataset.propQ] = q.value; PROP.lim[q.dataset.propQ] = PASSO_PROP; desenharListaProp(q.dataset.propQ); }, 120);
});
document.addEventListener('change', (e) => {
  const o = e.target.closest && e.target.closest('[data-prop-ordem]'); if (!o) return;
  PROP.ordem[o.dataset.propOrdem] = o.value; PROP.lim[o.dataset.propOrdem] = PASSO_PROP;
  try { localStorage.setItem('prop-ordem', JSON.stringify(PROP.ordem)); } catch (_) { /* ok */ }
  desenharListaProp(o.dataset.propOrdem);
});
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-prop-mais]'); if (!b) return;
  PROP.lim[b.dataset.propMais] = (PROP.lim[b.dataset.propMais] || PASSO_PROP) + PASSO_PROP; desenharListaProp(b.dataset.propMais);
});

// ---------- editor ----------
async function abrirEditor(codigo, dados) {
  const d = $('#detalhe');
  let c = dados;
  if (!c) {
    const semEsq = comEsqueleto(d, esqueletoFicha());
    try { c = await req(`/api/proprias/composicoes/${codigo}?${qsRefs()}`); semEsq(); }
    catch (e) { semEsq(); d.innerHTML = `<div class="pagina"><a class="voltar-lista" href="#/proprias"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 3 4.5 6l3 3" /></svg>Bases próprias</a><div class="erro">${esc(e.message)}</div></div>`; return; }
  }
  const antes = PROP.atual && PROP.atual.codigo === c.codigo ? PROP.atual.custo_total : null;
  PROP.atual = c;
  const total = c.tipo_preco === 'informado' ? c.preco_composto : c.custo_total;
  const datas = Object.entries(c.datas || {}).map(([b, m]) => `<span class="dt-etq"><span class="cb-base cb-${b}">${b}</span>${esc(m.map(curto).join(', '))}</span>`).join('');
  const origem = c.origem ? (() => {
    const dif = c.origem.custo ? total / c.origem.custo - 1 : null;
    return `<div class="prop-cmp"><span>Original ${codLink('servico', c.origem.base, c.origem.codigo)} em ${esc(nomeRef(c.origem.referencia))}</span>
      <b>${c.origem.custo == null ? 'sem preço' : brl.format(c.origem.custo)}</b>${dif == null ? '' : seloVariacao(total, c.origem.custo, 0)}</div>`;
  })() : '';
  const linhas = c.itens.map((i, k) => `<tr class="item" data-item="${i.id}">
      <td class="n">${k + 1}</td>
      <td class="cod">${codLink(i.eh_servico ? 'servico' : 'insumo', i.base, i.codigo)}</td>
      <td class="desc">${esc(i.descricao)}${i.base !== 'PROPRIA' && i.referencia ? `<span class="ref-mes">${esc(i.base)} ${esc(curto(i.referencia))}</span>` : ''}</td>
      <td class="c-un">${unid(i.unidade)}</td>
      <td class="num c-qtd"><input class="qtd" inputmode="decimal" value="${qtdFmt.format(i.qtd)}" data-prop-item="${i.id}" aria-label="Coeficiente do item ${k + 1}"></td>
      <td class="num">${money(i.custo_unit)}</td>
      <td class="num total">${i.custo_total == null ? '<span class="sem-preco">sem preço</span>' : money(i.custo_total)}</td>
      <td class="num">${total && i.custo_total ? pct.format(i.custo_total / total) : ''}</td>
      <td class="ctrl"><button type="button" class="mini" data-prop-mover="cima" data-id="${i.id}" aria-label="Subir o item ${k + 1}"${k ? '' : ' disabled'}>↑</button>
        <button type="button" class="mini" data-prop-mover="baixo" data-id="${i.id}" aria-label="Descer o item ${k + 1}"${k < c.itens.length - 1 ? '' : ' disabled'}>↓</button>
        <button type="button" class="mini" data-prop-tirar="${i.id}" aria-label="Tirar o item ${k + 1}">✕</button></td></tr>`).join('');
  const foco = document.activeElement && document.activeElement.dataset ? { ...document.activeElement.dataset } : {};
  d.innerHTML = `<article class="ficha prop-editor">
    <a class="voltar-lista" href="#/proprias"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 3 4.5 6l3 3" /></svg>Bases próprias</a>
    <div class="ficha-cod">${codigoBase(c.codigo, 'PROPRIA')}<span class="selo">Composição própria</span>${c.tipo_preco === 'informado' ? `<span class="selo selo-inf">Preço informado${c.proposta ? ` · ${esc(c.proposta)}` : ''}</span>` : ''}${c.origem_codigo ? `<span>a partir de ${esc(c.origem_codigo)}/${esc(c.origem_base)}</span>` : ''}</div>
    <div class="prop-campos">
      <label class="prop-desc">Descrição<textarea id="prop-descricao" rows="2" maxlength="400">${esc(c.descricao)}</textarea></label>
      <label>Unidade<input id="prop-unidade" value="${esc(c.unidade)}" maxlength="20"></label>
      <label>Grupo<input id="prop-grupo" value="${esc(c.grupo === 'Composições próprias' ? '' : c.grupo)}" maxlength="120" placeholder="Ex.: Revestimentos"></label>
      <label class="prop-obs">Observações<textarea id="prop-obs" rows="2" maxlength="2000" placeholder="Premissas, fonte das cotações, produtividade adotada...">${esc(c.observacoes)}</textarea></label>
    </div>
    ${blocoPreco(c)}
    <div class="ficha-linha">
      <div class="preco-grande"><span class="valor">${grana(c.custo_total)}</span><span class="por">por <b class="un">${unid(c.unidade)}</b> · sem BDI</span></div>
      <div class="fatos"><div>Preço<b>${c.tipo_preco === 'informado' ? 'Informado' : 'Composto'}</b></div>${c.encargos ? `<div>Encargos<b>Da empresa</b></div>` : ''}<div>Itens<b>${c.itens.length}</b></div>${c.usada_em ? `<div>Usada em<b>${c.usada_em} ${c.usada_em === 1 ? 'composição' : 'composições'}</b></div>` : ''}
        <div>Datas-base<span class="prop-datas-l">${datas || '—'}</span></div></div>
      <div class="acoes">
        <button type="button" class="botao primario" data-adicionar="servico" data-base="PROPRIA" data-cod="${esc(c.codigo)}" data-desc="${esc(c.descricao)}" data-un="${esc(c.unidade)}"${c.itens.length || c.tipo_preco === 'informado' ? '' : ' disabled'}>Adicionar ao orçamento</button>
        ${menu('Mais', [`<a role="menuitem" href="#/composicao/PROPRIA/${esc(c.codigo)}">Ver ficha (tabela e fluxo)</a>`,
          '<button type="button" role="menuitem" data-prop-duplicar>Duplicar</button>', '<button type="button" role="menuitem" class="perigo" data-prop-excluir>Excluir composição</button>'])}
      </div>
    </div>
    ${origem}
    ${c.custo_total ? `<div class="prop-div">${barraDivisao(c.divisao)}</div>` : ''}
    ${c.tipo_preco === 'informado' ? `<p class="aviso-fonte prop-inf-nota" role="note">Vale o <b>preço informado</b>${c.proposta ? ` (${esc(c.proposta)}${c.data_proposta ? `, ${esc(dataBr(c.data_proposta))}` : ''})` : ''}. Os itens abaixo ficam como referência: a soma deles daria <b>${brl.format(c.preco_composto || 0)}</b>${c.preco_composto ? ` (${c.custo_total >= c.preco_composto ? '+' : '−'}${pct.format(Math.abs(c.custo_total / c.preco_composto - 1))})` : ''}.</p>` : ''}
    ${c.itens_sem_preco ? `<p class="aviso-fonte" role="note"><b>${c.itens_sem_preco} ${c.itens_sem_preco === 1 ? 'item está' : 'itens estão'} sem preço</b> na data-base escolhida e não entram no custo. Troque o mês da base no topo ou substitua o item.</p>` : ''}
    <div class="tabela-barra"><h3>Itens da composição${c.tipo_preco === 'informado' ? ' <span class="sub">(referência)</span>' : ''}</h3></div>
    <div class="tabela-rola"><table class="planilha planilha-orc prop-tabela">
      <thead><tr><th class="n">#</th><th>Código</th><th>Descrição</th><th>Un.</th><th class="num">Coeficiente</th><th class="num">Custo unit.</th><th class="num">Custo total</th><th class="num">%</th><th class="ctrl"><span class="sr">Ações</span></th></tr></thead>
      <tbody id="prop-corpo">${linhas}
        <tr class="add-linha"><td></td><td colspan="8"><div class="add-busca">
          <input class="add-q" id="prop-add" placeholder="Adicionar insumo ou composição: digite descrição ou código (ORSE, SINAPI, SICRO ou próprio)" aria-label="Adicionar item à composição" autocomplete="off"
            role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="prop-add-res">
          <ul class="add-res" id="prop-add-res" role="listbox" aria-label="Itens encontrados" tabindex="0" hidden></ul></div>
          <button type="button" class="link-acao prop-novo-ins" data-novo-insumo data-para-comp="${esc(c.codigo)}">Não achou? Cadastrar insumo próprio</button></td></tr>
      </tbody></table></div>
    ${c.tipo_preco === 'informado' ? '' : blocoEncargos(c)}
    <p class="fonte">Custo calculado agora, com ${esc(gruposDeData().map((x) => `${juntar(x.bases)} de ${nomeRef(x.mes)}`).join(' · '))}. Ao trocar o mês de uma base no topo, o custo acompanha.${c.origem_base === 'SICRO' ? ' Composições do SICRO copiadas não trazem o FIC, que o DNIT calcula sobre a execução.' : ''}</p>
  </article>`;
  if (antes != null && antes !== total) contar($('.preco-grande .num-grande'), antes, total);
  ligarEditor(c);
  if (foco.propItem) { const q = $(`.qtd[data-prop-item="${foco.propItem}"]`); if (q) q.focus(); }
}

// ---------- preço: composto (soma dos itens) ou informado (proposta), por grupo de insumo ----------
const arred = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const GRUPOS_PRECO = [['mo', 'Mão de obra', '--c-mo'], ['mat', 'Materiais', '--c-mat'], ['equip', 'Equipamentos', '--c-equip'], ['terc', 'Serviços de terceiros', '--c-terc']];
function blocoPreco(c) {
  const inf = c.tipo_preco === 'informado', v = c.preco_informado || {};
  return `<section class="prop-preco" aria-label="Preço da composição">
    <div class="prop-preco-cab"><h3>Preço</h3>
      <label>Tipo de preço <select id="prop-tipo-preco"><option value="composto"${inf ? '' : ' selected'}>Composto (soma dos itens)</option><option value="informado"${inf ? ' selected' : ''}>Informado (proposta)</option></select></label></div>
    ${inf ? `<div class="prop-preco-grade">
      <table class="planilha prop-grupos"><thead><tr><th>Grupo de insumo</th><th class="num">Preço por ${unid(c.unidade)} (R$)</th><th class="num">%</th></tr></thead><tbody>
        ${GRUPOS_PRECO.map(([k, n, cor]) => `<tr><td><span class="pg-cor" style="--cor:var(${cor})"></span>${n}</td>
          <td class="num"><input class="qtd prop-inf" inputmode="decimal" data-prop-inf="${k}" value="${v[k] ? num2.format(v[k]) : ''}" placeholder="0,00" aria-label="${n}: preço por ${esc(c.unidade)}"></td>
          <td class="num">${c.custo_total ? pct.format((v[k] || 0) / c.custo_total) : ''}</td></tr>`).join('')}
      </tbody><tfoot><tr><td><b>Total informado</b></td><td class="num"><b>${brl.format(c.custo_total || 0)}</b></td><td></td></tr></tfoot></table>
      <div class="prop-proposta">
        <label>Proposta<input id="prop-proposta" value="${esc(c.proposta || '')}" maxlength="200" placeholder="Fornecedor e nº da proposta"></label>
        <label>Data da proposta<input id="prop-data-proposta" type="date" value="${esc(c.data_proposta || '')}"></label>
        <p class="sub">Informe o preço da proposta dividido por grupo de insumo. Ele vale na consulta e nos orçamentos, e a divisão em mão de obra e material sai destes valores.</p>
      </div></div>` : '<p class="sub prop-preco-dica">O preço é a soma dos itens abaixo. Para usar o valor de uma proposta (empreiteiro, fornecedor), escolha <b>Informado</b>.</p>'}
  </section>`;
}

// ---------- encargos: como vêm nas bases, ou os da empresa (tira os das bases e aplica os informados) ----------
function blocoEncargos(c) {
  const e = c.encargos, emp = !!e, extras = (c.encargos_extra || []).concat([{ descricao: '', tipo: 'pct', valor: 0 }]);
  const linha = (rot, v, cls = '') => `<tr class="${cls}"><td>${rot}</td><td class="num">${v}</td></tr>`;
  return `<section class="prop-enc" aria-label="Encargos da composição">
    <div class="prop-preco-cab"><h3>Encargos</h3>
      <label>Encargos <select id="prop-enc-modo"><option value="base"${emp ? '' : ' selected'}>Como vêm nas bases</option><option value="empresa"${emp ? ' selected' : ''}>Da empresa (informados)</option></select></label></div>
    ${emp ? `<div class="prop-enc-grade">
      <div class="prop-enc-campos">
        <label>Encargo social da empresa (% sobre a mão de obra)<input id="prop-enc-social" class="qtd" inputmode="decimal" value="${c.encargo_social_emp != null ? num2.format(c.encargo_social_emp) : ''}" placeholder="0,00"></label>
        <div class="prop-enc-extras"><span class="rot">Outros encargos <span class="sub">alimentação, transporte, EPI, ferramentas…</span></span>
          ${extras.map((x, k) => `<div class="prop-enc-extra" data-extra="${k}">
            <input data-ex="descricao" value="${esc(x.descricao)}" maxlength="120" placeholder="Descrição" aria-label="Descrição do encargo ${k + 1}">
            <select data-ex="tipo" aria-label="Como aplicar o encargo ${k + 1}"><option value="pct"${x.tipo === 'pct' ? ' selected' : ''}>% da mão de obra</option><option value="valor"${x.tipo === 'valor' ? ' selected' : ''}>R$ por ${esc(c.unidade)}</option></select>
            <input data-ex="valor" class="qtd" inputmode="decimal" value="${x.valor ? num2.format(x.valor) : ''}" placeholder="0,00" aria-label="Valor do encargo ${k + 1}">
            ${k < extras.length - 1 ? `<button type="button" class="mini" data-ex-tirar="${k}" aria-label="Tirar o encargo ${k + 1}">✕</button>` : '<span class="mini-vazio"></span>'}</div>`).join('')}
        </div>
      </div>
      <table class="planilha prop-enc-conta"><tbody>
        ${linha('Soma dos itens', brl.format(e.soma_itens))}
        ${linha('− Encargo social das bases', brl.format(e.tirado_social), 'menos')}
        ${linha('− Encargos complementares das bases', brl.format(e.tirado_compl), 'menos')}
        ${linha('<b>Custo sem encargos</b>', `<b>${brl.format(e.sem_encargos)}</b>`, 'sub-total')}
        ${linha(`Mão de obra sem encargos`, brl.format(e.mo_sem_encargos), 'info')}
        ${linha(`+ Encargo social da empresa (${num2.format(e.pct_social)}%)`, brl.format(e.social), 'mais')}
        ${e.extras.map((x) => linha(`+ ${esc(x.descricao || 'Encargo')} (${x.tipo === 'pct' ? `${num2.format(x.valor)}% da mão de obra` : `R$ por ${esc(c.unidade)}`})`, brl.format(x.custo), 'mais')).join('')}
      </tbody><tfoot><tr><td><b>Custo da composição</b></td><td class="num"><b>${brl.format(c.custo_total)}</b></td></tr></tfoot></table>
    </div>
    <p class="sub">Os encargos sociais e complementares embutidos nos itens das bases saem do custo (ORSE e SINAPI informam o encargo social; o SICRO não, e fica como está). Os encargos da empresa entram como mão de obra, também no orçamento.</p>`
    : `<p class="sub prop-preco-dica">Os itens entram com os encargos que cada base já embute${c.es || c.compl ? ` (hoje <b>${brl.format(c.es || 0)}</b> de encargo social e <b>${brl.format(c.compl || 0)}</b> de complementares por ${esc(c.unidade)})` : ''}. Para aplicar os encargos compatibilizados da empresa, escolha <b>Da empresa</b>.</p>`}
  </section>`;
}

function ligarEncargos(c, refazer) {
  const sel = $('#prop-enc-modo'); if (!sel) return;
  sel.addEventListener('change', () => refazer({ encargos_modo: sel.value }));
  const soc = $('#prop-enc-social');
  if (soc) {
    soc.addEventListener('change', () => { const v = soc.value.trim() ? lerNum(soc.value) : 0; if (!(v >= 0)) { avisar('Digite um percentual válido, como 85,50.'); return; } refazer({ encargo_social_emp: v }); });
    soc.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); soc.blur(); } });
  }
  const ler = (sem) => [...document.querySelectorAll('.prop-enc-extra')].filter((l) => l.dataset.extra !== String(sem)).map((l) => ({
    descricao: l.querySelector('[data-ex="descricao"]').value.trim(), tipo: l.querySelector('[data-ex="tipo"]').value,
    valor: l.querySelector('[data-ex="valor"]').value.trim() ? lerNum(l.querySelector('[data-ex="valor"]').value) : 0 })).filter((x) => x.descricao || x.valor);
  document.querySelectorAll('.prop-enc-extra [data-ex]').forEach((el) => {
    el.addEventListener('change', () => { const l = ler(); if (l.some((x) => !(x.valor >= 0))) { avisar('Digite um valor válido, como 12,50.'); return; } refazer({ encargos_extra: l }); });
    if (el.tagName === 'INPUT') el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); } });
  });
  document.querySelectorAll('[data-ex-tirar]').forEach((b) => b.addEventListener('click', () => refazer({ encargos_extra: ler(b.dataset.exTirar) })));
}

function ligarEditor(c) {
  const salvar = async (campo, valor) => {
    try { PROP.atual = await req(`/api/proprias/composicoes/${c.codigo}?${qsRefs()}`, 'PATCH', { [campo]: valor }); avisar('Salvo.'); }
    catch (e) { avisar(esc(e.message)); }
  };
  const refazer = async (dados) => { try { abrirEditor(c.codigo, await req(`/api/proprias/composicoes/${c.codigo}?${qsRefs()}`, 'PATCH', dados)); avisar('Salvo.'); } catch (e) { avisar(esc(e.message)); } };
  ligarEncargos(c, refazer);
  $('#prop-tipo-preco').addEventListener('change', (e) => {
    const inf = e.target.value === 'informado', v = c.preco_informado || {};
    // ao passar para "informado" sem valores ainda, começa com a divisão atual dos itens (o usuário ajusta pela proposta)
    const vazio = !Object.values(v).some((x) => x > 0);
    refazer(inf && vazio && c.custo_total ? { tipo_preco: 'informado', preco_inf_mo: arred(c.custo_total * (c.divisao.mo || 0)), preco_inf_mat: arred(c.custo_total * (c.divisao.mat || 0)),
      preco_inf_equip: arred(c.custo_total * (c.divisao.equip || 0)), preco_inf_terc: arred(c.custo_total * (c.divisao.terc || 0)) } : { tipo_preco: e.target.value });
  });
  document.querySelectorAll('[data-prop-inf]').forEach((inp) => inp.addEventListener('change', () => {
    const val = inp.value.trim() ? lerNum(inp.value) : 0;
    if (!(val >= 0)) { avisar('Digite um valor válido, como 12,50.'); return; }
    refazer({ [`preco_inf_${inp.dataset.propInf}`]: val });
  }));
  document.querySelectorAll('[data-prop-inf]').forEach((inp) => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } }));
  [['prop-proposta', 'proposta'], ['prop-data-proposta', 'data_proposta']].forEach(([id, campo]) => { const el = $(`#${id}`); if (el) el.addEventListener('change', () => refazer({ [campo]: el.value.trim() })); });
  [['prop-descricao', 'descricao'], ['prop-unidade', 'unidade'], ['prop-grupo', 'grupo'], ['prop-obs', 'observacoes']].forEach(([id, campo]) => {
    $(`#${id}`).addEventListener('change', (e) => {
      const v = e.target.value.trim();
      if (!v && (campo === 'descricao' || campo === 'unidade')) { avisar('Descrição e unidade não podem ficar em branco.'); e.target.value = c[campo]; return; }
      salvar(campo, v);
    });
  });
  const corpo = $('#prop-corpo');
  corpo.addEventListener('change', async (e) => {
    const t = e.target; if (!t.dataset.propItem) return;
    const v = lerNum(t.value);
    if (!(v >= 0)) { avisar('Digite um coeficiente válido, como 0,25.'); return; }
    try { abrirEditor(c.codigo, await req(`/api/proprias/itens/${t.dataset.propItem}?${qsRefs()}`, 'PATCH', { qtd: v })); } catch (err) { avisar(esc(err.message)); }
  });
  corpo.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.dataset.propItem) { e.preventDefault(); e.target.blur(); } });
  corpo.addEventListener('click', async (e) => {
    const mv = e.target.closest('[data-prop-mover]'), tira = e.target.closest('[data-prop-tirar]');
    try {
      if (mv) abrirEditor(c.codigo, await req(`/api/proprias/itens/${mv.dataset.id}/mover?direcao=${mv.dataset.propMover}&${qsRefs()}`, 'POST'));
      if (tira) {
        const r = await req(`/api/proprias/itens/${tira.dataset.propTirar}?${qsRefs()}`, 'DELETE');
        abrirEditor(c.codigo, r);
        PROP.desfazer = { codigo: c.codigo, item: r.desfazer };
        avisar(`Item tirado. <button type="button" class="aviso-bt" data-prop-desfazer>Desfazer</button>`, 9000);
      }
    } catch (err) { avisar(esc(err.message)); }
  });
  buscaDeItens($('#prop-add'), async (x) => {
    try {
      const n = await req(`/api/proprias/composicoes/${c.codigo}/itens?${qsRefs()}`, 'POST', { tipo: x.tipo, base: x.base, codigo: x.codigo, qtd: 1 });
      await abrirEditor(c.codigo, n);
      const q = $(`.qtd[data-prop-item="${n.item_criado}"]`); if (q) { q.focus(); q.select(); }
      avisar(`${VISTO} ${esc(x.codigo)} incluído. Ajuste o coeficiente.`);
    } catch (err) { avisar(esc(err.message)); }
  }, c.codigo);
}

// busca de itens em todas as bases (cada uma no seu mês) e nos próprios
function buscaDeItens(inp, escolher, proprio) {
  const ul = inp.nextElementSibling; let t = 0, seqLocal = 0, itens = [], sel = -1;
  const fechar = () => { ul.hidden = true; sel = -1; inp.setAttribute('aria-expanded', 'false'); inp.removeAttribute('aria-activedescendant'); };
  const marcar = () => {
    ul.querySelectorAll('li[data-k]').forEach((li, k) => { li.setAttribute('aria-selected', String(k === sel)); li.id = `prop-op-${k}`; });
    if (sel >= 0) inp.setAttribute('aria-activedescendant', `prop-op-${sel}`);
  };
  inp.addEventListener('input', () => {
    clearTimeout(t);
    const q = inp.value.trim(); if (q.length < 2) { fechar(); return; }
    t = setTimeout(async () => {
      const meu = ++seqLocal;
      let r; try { r = await req(`/api/busca?${new URLSearchParams({ q, limite: 10, refs: refsQs(), bases: basesQs() })}`); } catch (_) { return; }
      if (meu !== seqLocal) return;
      itens = r.itens.filter((x) => !(x.base === 'PROPRIA' && x.codigo === proprio));
      ul.innerHTML = itens.length ? itens.map((x, k) => `<li data-k="${k}" role="option"><span class="res-cod">${codigoBase(x.codigo, x.base)}<span class="tipo tipo-${x.tipo}">${x.tipo === 'servico' ? 'Composição' : 'Insumo'}</span></span>
          <span>${trecho(x)}</span><span class="add-preco">${x.preco == null ? 'sem preço' : brl.format(x.preco)}<span class="un">${unid(x.unidade)}</span></span></li>`).join('')
        : '<li class="nada" role="option" aria-disabled="true">Nada encontrado. Cadastre um insumo próprio, se for o caso.</li>';
      ul.hidden = false; sel = -1; inp.setAttribute('aria-expanded', 'true');
    }, 160);
  });
  inp.addEventListener('keydown', (e) => {
    if (ul.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, itens.length - 1); marcar(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); marcar(); }
    if (e.key === 'Enter' && itens.length) { e.preventDefault(); const x = itens[Math.max(sel, 0)]; fechar(); inp.value = ''; escolher(x); }
    if (e.key === 'Escape') fechar();
  });
  inp.addEventListener('blur', () => setTimeout(fechar, 200));
  ul.addEventListener('mousedown', (e) => { const li = e.target.closest('li[data-k]'); if (li) { e.preventDefault(); const x = itens[Number(li.dataset.k)]; fechar(); inp.value = ''; escolher(x); } });
}

// ---------- ações ----------
async function novaComposicao() {
  try {
    const c = await req(`/api/proprias/composicoes?${qsRefs()}`, 'POST', { descricao: 'Nova composição própria', unidade: 'un', base_id: PROP.base });
    location.hash = `#/propria/${c.codigo}`;
    setTimeout(() => { const t = $('#prop-descricao'); if (t) { t.focus(); t.select(); } }, 120);
  } catch (e) { avisar(esc(e.message)); }
}
async function copiarOficial(base, codigo, ref) {
  try {
    const c = await req(`/api/proprias/copiar/${base}/${codigo}?${new URLSearchParams({ ref: ref || '', refs: refsQs(), base_id: PROP.base })}`, 'POST');
    location.hash = `#/propria/${c.codigo}`;
    avisar(`${VISTO} Composição própria ${esc(c.codigo)} criada a partir de ${esc(codigo)}/${esc(base)}. Ajuste os itens.`);
  } catch (e) { avisar(esc(e.message)); }
}
function abrirDialogoInsumo(codigo, paraComp) {
  const d = $('#dlg-insumo-proprio'), f = $('#form-insumo-proprio');
  f.reset(); $('#ins-erro').textContent = '';
  PROP.editarIns = codigo || null; PROP.insParaComp = paraComp || null;
  $('#ins-titulo').textContent = codigo ? `Editar insumo ${codigo}` : 'Novo insumo próprio';
  if (codigo) {
    const i = (PROP.dados && PROP.dados.insumos || []).find((x) => x.codigo === codigo);
    if (i) { f.elements.descricao.value = i.descricao; f.elements.unidade.value = i.unidade; f.elements.tipo.value = i.tipo;
      f.elements.preco.value = i.preco == null ? '' : num2.format(i.preco); f.elements.data_preco.value = i.data_preco; f.elements.fonte.value = i.fonte; }
  } else f.elements.data_preco.value = new Date().toISOString().slice(0, 10);
  d.showModal(); f.elements.descricao.focus();
}
$('#form-insumo-proprio').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, preco = f.elements.preco.value.trim() ? lerNum(f.elements.preco.value) : null;
  if (preco !== null && !(preco >= 0)) { $('#ins-erro').textContent = 'Digite o preço como 129,90.'; return; }
  const corpo = { descricao: f.elements.descricao.value.trim(), unidade: f.elements.unidade.value.trim(), tipo: f.elements.tipo.value, preco,
    data_preco: f.elements.data_preco.value, fonte: f.elements.fonte.value.trim() };
  if (!PROP.editarIns) corpo.base_id = (PROP.insParaComp && PROP.atual && PROP.atual.base_id) || PROP.base;
  if (!corpo.descricao || !corpo.unidade) { $('#ins-erro').textContent = 'Preencha a descrição e a unidade.'; return; }
  try {
    const i = PROP.editarIns ? await req(`/api/proprias/insumos/${PROP.editarIns}`, 'PATCH', corpo) : await req('/api/proprias/insumos', 'POST', corpo);
    $('#dlg-insumo-proprio').close();
    if (PROP.insParaComp) {
      const n = await req(`/api/proprias/composicoes/${PROP.insParaComp}/itens?${qsRefs()}`, 'POST', { tipo: 'insumo', base: 'PROPRIA', codigo: i.codigo, qtd: 1 });
      await abrirEditor(PROP.insParaComp, n);
      const q = $(`.qtd[data-prop-item="${n.item_criado}"]`); if (q) { q.focus(); q.select(); }
    } else if (/^#\/propria/.test(location.hash)) window.rotaProprias(); else { PROP.aba = 'insumos'; window.rotaProprias(); }
    avisar(`${VISTO} Insumo ${esc(i.codigo)} ${PROP.editarIns ? 'salvo' : 'cadastrado'}.`);
  } catch (err) { $('#ins-erro').textContent = err.message; }
});

document.addEventListener('click', async (e) => {
  if (e.target.closest('[data-nova-propria]')) { novaComposicao(); return; }
  const bb = e.target.closest('[data-prop-base]'); if (bb) { lembrarBase(Number(bb.dataset.propBase)); window.rotaProprias(); return; }
  if (e.target.closest('[data-prop-base-nova]')) {
    const nomes = new Set(basesProprias().map((b) => b.nome)); let n = basesProprias().length + 1; while (nomes.has(`Base ${n}`)) n += 1;
    try {
      const b = await req('/api/proprias/bases', 'POST', { nome: `Base ${n}` }); lembrarBase(b.id); await recarregarBases(); await window.rotaProprias();
      const t = $('#prop-base-nome'); if (t) { t.focus(); t.select(); } avisar(`${VISTO}Base criada. Dê um nome a ela.`);
    } catch (err) { avisar(esc(err.message)); }
    return;
  }
  const bx = e.target.closest('[data-prop-base-excluir]');
  if (bx) {
    const b = basesProprias().find((x) => x.id === PROP.base); if (!b) return;
    if (bx.dataset.confirmar !== '1') {
      bx.dataset.confirmar = '1'; bx.textContent = `Clique de novo: excluir "${b.nome}" com ${b.composicoes} composições e ${b.insumos} insumos`;
      setTimeout(() => { const m = bx.closest('details'); if (m) m.open = true; }, 0); return;
    }
    try { await req(`/api/proprias/bases/${b.id}`, 'DELETE'); lembrarBase(1); await recarregarBases(); window.rotaProprias(); avisar(`Base "${esc(b.nome)}" excluída.`); }
    catch (err) { avisar(esc(err.message)); }
    return;
  }
  const ni = e.target.closest('[data-novo-insumo]'); if (ni) { abrirDialogoInsumo(null, ni.dataset.paraComp); return; }
  const ei = e.target.closest('[data-editar-insumo]'); if (ei) { abrirDialogoInsumo(ei.dataset.editarInsumo); return; }
  const xi = e.target.closest('[data-excluir-insumo]');
  if (xi) {
    if (xi.dataset.confirmar !== '1') { xi.dataset.confirmar = '1'; xi.textContent = 'Excluir?'; xi.classList.add('perigo-ativo'); setTimeout(() => { if (document.body.contains(xi)) { xi.dataset.confirmar = ''; xi.textContent = '✕'; xi.classList.remove('perigo-ativo'); } }, 4000); return; }
    try { await req(`/api/proprias/insumos/${xi.dataset.excluirInsumo}`, 'DELETE'); avisar('Insumo excluído.'); window.rotaProprias(); } catch (err) { avisar(esc(err.message)); }
    return;
  }
  const ab = e.target.closest('[data-prop-aba] button');
  if (ab) { PROP.aba = ab.dataset.v; document.querySelectorAll('[data-prop-aba] button').forEach((b) => b.setAttribute('aria-checked', String(b === ab)));
    document.querySelectorAll('[data-prop-painel]').forEach((s) => s.classList.toggle('oculto', s.dataset.propPainel !== PROP.aba)); return; }
  const cp = e.target.closest('[data-copiar-propria]'); if (cp) { copiarOficial(cp.dataset.base, cp.dataset.cod, cp.dataset.ref); return; }
  if (e.target.closest('[data-prop-desfazer]') && PROP.desfazer) {
    const { codigo, item } = PROP.desfazer; PROP.desfazer = null;
    try { abrirEditor(codigo, await req(`/api/proprias/composicoes/${codigo}/itens?${qsRefs()}`, 'POST', item)); avisar('Item devolvido (no fim da lista).'); } catch (err) { avisar(esc(err.message)); }
    return;
  }
  if (e.target.closest('[data-prop-duplicar]') && PROP.atual) {
    try { const n = await req(`/api/proprias/composicoes/${PROP.atual.codigo}/duplicar?${qsRefs()}`, 'POST'); location.hash = `#/propria/${n.codigo}`; avisar(`Duplicada como ${esc(n.codigo)}.`); } catch (err) { avisar(esc(err.message)); }
    return;
  }
  const px = e.target.closest('[data-prop-excluir]');
  if (px && PROP.atual) {
    if (px.dataset.confirmar !== '1') {
      px.dataset.confirmar = '1'; px.textContent = 'Clique de novo para excluir';
      setTimeout(() => { const m = px.closest('details'); if (m) m.open = true; }, 0); return;
    }
    try { await req(`/api/proprias/composicoes/${PROP.atual.codigo}`, 'DELETE'); location.hash = '#/proprias'; avisar(`Composição ${esc(PROP.atual.codigo)} excluída.`); } catch (err) { avisar(esc(err.message)); }
  }
});
$('#dlg-insumo-proprio').addEventListener('click', (e) => { if (e.target.id === 'dlg-insumo-proprio') e.target.close(); });

// ---------- nome da base ----------
document.addEventListener('change', async (e) => {
  if (e.target.id !== 'prop-base-nome') return;
  const v = e.target.value.trim();
  if (!v) { e.target.value = nomeBasePropria(); return; }
  const id = Number(e.target.dataset.baseId) || 1, antes = (basesProprias().find((b) => b.id === id) || {}).nome || '';
  try {
    const r = await req(`/api/proprias/bases/${id}`, 'PATCH', { nome: v });
    e.target.value = r.nome; for (const [k, nome] of BASE_DO_ITEM) if (nome === antes) BASE_DO_ITEM.set(k, r.nome);
    await recarregarBases(); MEMORIA.clear(); window.rotaProprias(); avisar(`${VISTO}A base agora se chama <b>${esc(r.nome)}</b>.`);
  } catch (err) { e.target.value = antes; avisar(esc(err.message)); }
});
document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'prop-base-nome') { e.preventDefault(); e.target.blur(); } });
