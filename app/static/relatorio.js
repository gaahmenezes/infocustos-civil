'use strict';
/* Relatório do orçamento para imprimir ou salvar em PDF: capa, resumo, planilha, curva ABC e composições. */

const EMPRESA_CHAVE = 'infocustos-empresa';
function lerEmpresa() { try { return JSON.parse(localStorage.getItem(EMPRESA_CHAVE) || '{}') || {}; } catch (_) { return {}; } }
function gravarEmpresa(e) { try { localStorage.setItem(EMPRESA_CHAVE, JSON.stringify(e)); return true; } catch (_) { return false; } }
const REL = { capa: true, abc: true, comps: false, logo: null };
try { Object.assign(REL, JSON.parse(localStorage.getItem('infocustos-relatorio') || '{}')); } catch (_) { /* padrão */ }
const hoje = () => new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

function cabecalhoFolha(emp, o) {
  return `<header class="folha-cab"><div class="folha-emp">${emp.logo ? `<img src="${emp.logo}" alt="">` : ''}<span>${esc(emp.nome || 'InfoCustos Civil')}</span></div>
    <div class="folha-orc"><b>${esc(o.nome)}</b><span>Data-base ${esc(nomeRef(o.referencia))} · BDI ${num2.format(o.bdi)}%</span></div></header>`;
}
const rodapeFolha = (o) => `<footer class="folha-rod"><span>Preços: ORSE e SINAPI, conforme os relatórios da CEHOP/SE, referência ${esc(nomeRef(o.referencia))}.</span><span>Emitido em ${hoje()} pelo InfoCustos Civil</span></footer>`;

function folhaCapa(emp, o) {
  const contato = [emp.cnpj ? `CNPJ ${emp.cnpj}` : '', emp.endereco, emp.contato].filter(Boolean).map(esc).join(' · ');
  return `<section class="folha folha-capa">
    <div class="capa-topo">${emp.logo ? `<img src="${emp.logo}" alt="Logotipo de ${esc(emp.nome || 'empresa')}">` : ''}
      <div>${emp.nome ? `<b>${esc(emp.nome)}</b>` : ''}${contato ? `<span>${contato}</span>` : ''}</div></div>
    <div class="capa-meio"><span class="capa-rotulo">Orçamento de obra</span><h1>${esc(o.nome)}</h1>
      <dl class="capa-dados">
        ${o.cliente ? `<div><dt>Cliente</dt><dd>${esc(o.cliente)}</dd></div>` : ''}
        ${o.local ? `<div><dt>Local</dt><dd>${esc(o.local)}</dd></div>` : ''}
        <div><dt>Data-base dos preços</dt><dd>${esc(nomeRef(o.referencia))}</dd></div>
        <div><dt>Bases de preços</dt><dd>ORSE e SINAPI</dd></div>
      </dl></div>
    <div class="capa-valores">
      <div><span>Custo direto</span><b>${brl.format(o.custo_total)}</b></div>
      <div><span>BDI de ${num2.format(o.bdi)}%</span><b>${brl.format(o.valor_bdi)}</b></div>
      <div class="capa-total"><span>Valor total</span><b>${brl.format(o.total)}</b></div>
    </div>
    <div class="capa-pe"><span>${hoje()}</span>${emp.responsavel ? `<span class="capa-resp"><b>${esc(emp.responsavel)}</b>${emp.registro ? `${esc(emp.registro)}` : 'Responsável técnico'}</span>` : ''}</div>
  </section>`;
}

function folhaResumo(emp, o) {
  const dv = o.divisao;
  const linhas = o.etapas.map((e) => `<tr><td class="n">${e.numero}</td><td>${esc(e.titulo)}</td><td class="num">${e.itens.length}</td>
      <td class="num">${money(e.custo_total)}</td><td class="num"><b>${money(e.total)}</b></td>
      <td class="rel-peso"><span class="peso"><i style="width:${e.peso * 100}%"></i></span>${pct.format(e.peso)}</td></tr>`).join('');
  const partes = dv ? PAINEL_PARTES.map(([k, n, cor]) => `<div style="--cor:var(${cor})">${n}<b>${brl.format(o.custo_total * dv[k])}</b><span class="pct">${pct.format(dv[k])}</span></div>`).join('') : '';
  return `<section class="folha">${cabecalhoFolha(emp, o)}
    <h2>Resumo do orçamento</h2>
    <table class="rel-tabela"><thead><tr><th>Item</th><th>Etapa</th><th class="num">Itens</th><th class="num">Custo direto (R$)</th><th class="num">Total com BDI (R$)</th><th>Peso</th></tr></thead>
      <tbody>${linhas}</tbody>
      <tfoot><tr><td></td><td>Total</td><td class="num">${o.qtd_itens}</td><td class="num">${money(o.custo_total)}</td><td class="num">${money(o.total)}</td><td></td></tr></tfoot></table>
    ${dv ? `<h3>Divisão do custo direto</h3><div class="custo"><div class="barra">${PAINEL_PARTES.filter(([k]) => dv[k] > 0).map(([k, , cor]) => `<span style="flex-grow:${dv[k]};background:var(${cor})"></span>`).join('')}</div>
      <div class="legenda legenda-4">${partes}</div></div>` : ''}
    ${rodapeFolha(o)}</section>`;
}

function folhaPlanilha(emp, o) {
  const corpo = o.etapas.map((e) => `<tr class="rel-etapa"><td class="n">${e.numero}</td><td colspan="6">${esc(e.titulo)}</td><td class="num">${money(e.total)}</td></tr>
    ${e.itens.map((i) => `<tr><td class="n">${i.numero}</td><td class="rel-cod">${esc(i.codigo)}<span>${esc(i.base)}</span></td><td>${esc(i.descricao)}</td><td>${esc(i.unidade)}</td>
      <td class="num">${qtdFmt.format(i.quantidade)}</td><td class="num">${money(i.custo_unit)}</td><td class="num">${money(i.preco_unit)}</td><td class="num">${money(i.total)}</td></tr>`).join('')}`).join('');
  return `<section class="folha">${cabecalhoFolha(emp, o)}
    <h2>Planilha orçamentária</h2>
    <table class="rel-tabela rel-planilha"><thead><tr><th>Item</th><th>Código</th><th>Descrição</th><th>Un.</th><th class="num">Quant.</th><th class="num">Custo unit.</th><th class="num">Preço c/ BDI</th><th class="num">Total (R$)</th></tr></thead>
      <tbody>${corpo}</tbody>
      <tfoot><tr><td colspan="7">Custo direto</td><td class="num">${money(o.custo_total)}</td></tr>
        <tr><td colspan="7">BDI de ${num2.format(o.bdi)}%</td><td class="num">${money(o.valor_bdi)}</td></tr>
        <tr class="rel-geral"><td colspan="7">Valor total</td><td class="num">${money(o.total)}</td></tr></tfoot></table>
    <p class="rel-nota">Preço com BDI e total de cada item arredondados em 2 casas.</p>
    ${rodapeFolha(o)}</section>`;
}

function folhaABC(emp, o) {
  const l = curvaABC(o);
  return `<section class="folha">${cabecalhoFolha(emp, o)}
    <h2>Curva ABC de serviços</h2>
    <p class="rel-nota">Itens ordenados pelo valor com BDI. Classe A até 80% do valor acumulado, B até 95%, C o restante.</p>
    <table class="rel-tabela"><thead><tr><th>Pos.</th><th>Código</th><th>Descrição</th><th class="num">Total (R$)</th><th class="num">%</th><th class="num">% acum.</th><th>Classe</th></tr></thead>
      <tbody>${l.map((x) => `<tr><td class="n">${x.posicao}</td><td class="rel-cod">${esc(x.codigo)}<span>${esc(x.base)}</span></td><td>${esc(x.descricao)}</td>
        <td class="num">${money(x.total)}</td><td class="num">${pct.format(x.percentual)}</td><td class="num">${pct.format(x.acumulado)}</td><td class="rel-classe">${x.classe}</td></tr>`).join('')}</tbody></table>
    ${rodapeFolha(o)}</section>`;
}

async function folhasComposicoes(emp, o, progresso) {
  const vistos = new Map();
  for (const e of o.etapas) for (const i of e.itens) if (i.tipo === 'servico' && !vistos.has(`${i.base}|${i.codigo}`)) vistos.set(`${i.base}|${i.codigo}`, i);
  const lista = [...vistos.values()]; const blocos = [];
  for (const [k, i] of lista.entries()) {
    progresso(k + 1, lista.length);
    let c; try { c = await api(`/api/composicao/${i.base}/${i.codigo}?ref=${encodeURIComponent(i.referencia || o.referencia)}`); } catch (_) { continue; }
    const secoes = SECOES.map(([s, nome]) => [nome, c.itens.filter((x) => x.secao === s)]).filter((g) => g[1].length);
    blocos.push(`<article class="rel-comp"><header><span class="rel-cod">${esc(c.codigo)}<span>${esc(c.base)}</span></span><b>${esc(c.descricao)}</b>
        <span class="rel-comp-preco">${brl.format(c.custo_total)} por ${esc(c.unidade)}</span></header>
      <table class="rel-tabela"><thead><tr><th>Código</th><th>Descrição</th><th>Un.</th><th class="num">Coeficiente</th><th class="num">Custo unit.</th><th class="num">Custo total</th></tr></thead>
      ${secoes.map(([nome, itens]) => `<tbody><tr class="rel-etapa"><td colspan="5">${nome}</td><td class="num">${money(itens.reduce((s, x) => s + (x.custo_total || 0), 0))}</td></tr>
        ${itens.map((x) => `<tr><td class="rel-cod">${esc(x.codigo)}<span>${esc(x.base)}</span></td><td>${esc(x.descricao)}</td><td>${esc(x.unidade)}</td>
          <td class="num">${coef(x.qtd)}</td><td class="num">${money(x.custo_unit)}</td><td class="num">${money(x.custo_total)}</td></tr>`).join('')}</tbody>`).join('')}
      </table></article>`);
  }
  if (!blocos.length) return '';
  return `<section class="folha">${cabecalhoFolha(emp, o)}<h2>Composições analíticas</h2>
    <p class="rel-nota">Composição de cada serviço do orçamento, na data-base em que entrou. Valores em R$, sem BDI.</p>${blocos.join('')}${rodapeFolha(o)}</section>`;
}

window.desenharRelatorio = async function (o) {
  const d = $('#detalhe'); const emp = lerEmpresa();
  const marca = (k, rotulo) => `<label class="rel-opcao"><input type="checkbox" data-rel="${k}"${REL[k] ? ' checked' : ''}>${rotulo}</label>`;
  if (!o.qtd_itens) {
    d.innerHTML = `<div class="pagina">${vazio('folha', 'O relatório precisa de itens', 'Adicione composições ou insumos na planilha do orçamento.', `<a class="botao primario" href="${rotaOrc(o.id)}">Voltar à planilha</a>`)}</div>`; return;
  }
  d.innerHTML = `<div class="pagina relatorio-pag">
    <div class="rel-barra">
      <a class="voltar-lista" href="${rotaOrc(o.id)}"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 3 4.5 6l3 3" /></svg>Voltar à planilha</a>
      <div class="rel-opcoes">${marca('capa', 'Capa')}${marca('abc', 'Curva ABC')}${marca('comps', 'Composições analíticas')}</div>
      <div class="acoes"><button type="button" class="botao" data-empresa>Dados da empresa</button>
        <button type="button" class="botao primario" data-imprimir>Imprimir ou salvar em PDF</button></div>
    </div>
    ${emp.nome ? '' : '<p class="rel-aviso">O relatório sai com o nome e o logotipo da sua empresa. <button type="button" class="link-acao" data-empresa>Preencher os dados da empresa</button></p>'}
    <div class="relatorio" id="relatorio"><p class="carregando">Montando o relatório…</p></div>
  </div>`;
  const rel = $('#relatorio');
  let comps = '';
  if (REL.comps) comps = await folhasComposicoes(emp, o, (k, n) => { rel.innerHTML = `<p class="carregando">Buscando as composições: ${k} de ${n}…</p>`; });
  if (!document.body.contains(rel)) return;  // a pessoa saiu da tela enquanto carregava
  rel.innerHTML = (REL.capa ? folhaCapa(emp, o) : '') + folhaResumo(emp, o) + folhaPlanilha(emp, o) + (REL.abc ? folhaABC(emp, o) : '') + comps;
  d.querySelectorAll('[data-rel]').forEach((c) => c.addEventListener('change', () => {
    REL[c.dataset.rel] = c.checked;
    try { localStorage.setItem('infocustos-relatorio', JSON.stringify({ capa: REL.capa, abc: REL.abc, comps: REL.comps })); } catch (_) { /* ok */ }
    window.desenharRelatorio(o);
  }));
};

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-imprimir]')) {
    const antes = document.title; const o = ORC.atual;
    if (o) document.title = `Orçamento - ${o.nome}`;  // vira o nome sugerido do arquivo PDF
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
