'use strict';
/* Bases oficiais (#/bases-oficiais): enviar os relatórios de um mês, acompanhar a conferência e publicar. */

const BO = { tarefa: null, timer: 0, abertos: new Set() };
const NOME_STATUS = { pendente: 'Aguardando publicação', publicado: 'Publicado', substituido: 'Substituído por envio mais novo', retirado: 'Retirado do ar' };
const ICONE_CHECK = { ok: '✓', alerta: '!', bloqueio: '✕' };
const PAPEIS_ORSE = [
  ['composicoes', 'Relatório de Composições', 'Pode vir em partes: escolha todos os PDFs.', true],
  ['insumos', 'Relatório de Insumos', 'Um PDF.', false],
  ['servicos', 'Relatório de Serviços', 'Um PDF.', false],
];

window.desenharBasesOficiais = async function (dados) {
  const d = $('#detalhe');
  let r = dados;
  if (!r) {
    const semEsq = d.querySelector('.bases-oficiais') ? () => {} : comEsqueleto(d, `<div class="pagina"><section class="ficha">${esqueletoTabela(8)}</section></div>`);
    try { r = await api('/api/bases-oficiais'); } catch (e) { semEsq(); d.innerHTML = `<div class="pagina"><div class="erro"><b>Não foi possível abrir as bases oficiais.</b><br>${esc(e.message)}</div></div>`; return; }
    semEsq();
  }
  if (!/^#\/bases-oficiais/.test(location.hash)) return;
  BO.tarefa = r.tarefa;
  const noAr = Object.entries(r.no_ar).map(([b, ms]) => `<div class="bo-base"><span class="cb-base cb-${esc(b)}">${esc(b)}</span>
    <span>${ms.map((m) => esc(curto(m))).join(' · ')}</span></div>`).join('');
  const rodando = r.tarefa && r.tarefa.estado === 'rodando';
  d.innerHTML = `<div class="pagina bases-oficiais">
    <header class="pag-cab"><div><h1>Bases oficiais</h1>
      <p class="sub">Envie os relatórios de um mês novo ou de uma revisão. O sistema lê, confere item a item e só publica quando você mandar.</p></div></header>
    <section class="bo-no-ar" aria-label="Meses no ar">${noAr}</section>
    <div id="bo-tarefa">${blocoTarefa(r.tarefa)}</div>
    <div class="bo-envio">
      <section class="cartao bo-cartao" data-bo-base="ORSE">
        <h2><span class="cb-base cb-ORSE">ORSE</span>Relatórios do programa da CEHOP</h2>
        <p class="sub">Tire do programa ORSE, já atualizado, os três relatórios do mês, em PDF. O mês é lido do próprio relatório.</p>
        ${PAPEIS_ORSE.map(([p, nome, dica, varios]) => `<label class="bo-arq"><span class="bo-arq-nome">${nome}<small>${dica}</small></span>
          <input type="file" accept="application/pdf,.pdf" data-bo-papel="${p}"${varios ? ' multiple' : ''}></label>`).join('')}
        <button type="button" class="botao primario" data-bo-enviar="ORSE"${rodando ? ' disabled' : ''}>Enviar e conferir</button>
      </section>
      <section class="cartao bo-cartao" data-bo-base="SINAPI">
        <h2><span class="cb-base cb-SINAPI">SINAPI</span>Planilha da CAIXA</h2>
        <p class="sub">O zip "formato xlsx" do mês, como a CAIXA publica (ou só a planilha SINAPI_Referência). Vale Sergipe, sem desoneração.</p>
        <label class="bo-arq"><span class="bo-arq-nome">Zip ou planilha da CAIXA<small>SINAPI-AAAA-MM-formato-xlsx.zip</small></span>
          <input type="file" accept=".zip,.xlsx" data-bo-papel="caixa"></label>
        <p class="bo-dica">Envie a SINAPI do mês antes da ORSE: assim a conferência da ORSE compara os insumos SINAPI usados nas composições com os da CAIXA.</p>
        <button type="button" class="botao primario" data-bo-enviar="SINAPI"${rodando ? ' disabled' : ''}>Enviar e conferir</button>
      </section>
    </div>
    <h2 class="bo-tit">Envios</h2>
    <div class="bo-envios">${r.envios.length ? r.envios.map(cartaoEnvio).join('') : vazio('folha', 'Nenhum envio ainda', 'Os meses enviados por aqui aparecem nesta lista, com a conferência.')}</div>
    <p class="fonte">Os meses já carregados antes desta tela (no repositório) continuam valendo. Um mês publicado aqui substitui o mesmo mês da mesma base; "Tirar do ar" volta ao que havia antes.</p>
  </div>`;
  ligarBasesOficiais();
  if (rodando) acompanhar();
};

function blocoTarefa(t) {
  if (!t || t.estado === 'livre') return '';
  if (t.estado === 'rodando') {
    const min = Math.floor((t.duracao || 0) / 60), seg = (t.duracao || 0) % 60;
    return `<section class="bo-progresso" role="status" aria-live="polite"><div class="bo-prog-topo"><b>${esc(t.etapa || 'Trabalhando')}</b><span>${min ? `${min} min ` : ''}${seg} s</span></div>
      <div class="bo-barra"><i style="width:${t.pct || 2}%"></i></div>
      <p class="sub">A leitura de um mês da ORSE pode levar vários minutos. Deixe esta página aberta até terminar.</p></section>`;
  }
  if (t.estado === 'erro') return `<section class="bo-progresso erro" role="alert"><b>Não deu certo:</b> ${esc(t.erro)}</section>`;
  return '';
}

function cartaoEnvio(e) {
  const nivel = e.checks.some((c) => c.nivel === 'bloqueio') ? 'bloqueio' : e.checks.some((c) => c.nivel === 'alerta') ? 'alerta' : 'ok';
  const cmp = e.comparacao;
  const comparacao = !cmp ? '' : cmp.tipo === 'novo' ? '<p class="bo-cmp">Primeiro mês desta base.</p>'
    : `<p class="bo-cmp">${cmp.tipo === 'revisao' ? `Revisão de <b>${esc(cmp.contra_nome)}</b>, que está no ar` : `Comparado com <b>${esc(cmp.contra_nome)}</b>`}:
      <b>${int.format(cmp.mudaram)}</b> composições mudam de custo${cmp.mediana != null && cmp.mudaram ? ` (mediana ${cmp.mediana > 0 ? '+' : ''}${pct.format(cmp.mediana)})` : ''}${cmp.novas ? ` · ${int.format(cmp.novas)} novas` : ''}${cmp.retiradas ? ` · ${int.format(cmp.retiradas)} saem` : ''}.</p>
      ${cmp.maiores && cmp.maiores.length ? `<details class="bo-det"><summary>Maiores mudanças</summary><ul>${cmp.maiores.map((m) => `<li><b>${esc(m.codigo)}</b> ${brl.format(m.antes)} → ${brl.format(m.depois)} <span class="var ${m.variacao > 0 ? 'var-alta' : 'var-baixa'}">${m.variacao > 0 ? '+' : '−'}${pct.format(Math.abs(m.variacao))}</span></li>`).join('')}</ul></details>` : ''}`;
  const acoes = e.status === 'pendente'
    ? `${e.bloqueado ? `<label class="bo-forcar"><input type="checkbox" data-bo-forcar="${e.id}"> Publicar mesmo assim</label>` : ''}
       <button type="button" class="botao primario" data-bo-publicar="${e.id}"${e.bloqueado ? ' disabled' : ''}>Publicar</button>
       <button type="button" class="botao" data-bo-descartar="${e.id}">Descartar</button>`
    : e.status === 'publicado' ? `<button type="button" class="botao" data-bo-desfazer="${e.id}">Tirar do ar</button>` : '';
  return `<article class="cartao bo-env nivel-${nivel} st-${esc(e.status)}" data-bo-env="${e.id}">
    <header class="bo-env-cab"><div><span class="cb-base cb-${esc(e.base)}">${esc(e.base)}</span><b>${esc(e.descricao)}</b>
      <span class="bo-st">${esc(NOME_STATUS[e.status] || e.status)}${e.status === 'publicado' && !e.no_ar ? ' · entrando no ar' : ''}</span></div>
      <span class="sub">enviado ${esc(dataHora(e.criado_em))}${e.publicado_em ? ` · publicado ${esc(dataHora(e.publicado_em))}` : ''}</span></header>
    <ul class="bo-checks">${e.checks.map((c) => `<li class="ck-${c.nivel}"><span class="ck-ic" aria-label="${c.nivel}">${ICONE_CHECK[c.nivel]}</span>
      <div><b>${esc(c.titulo)}</b>${c.detalhe ? `<span>${esc(c.detalhe)}</span>` : ''}${c.exemplos && c.exemplos.length ? `<details class="bo-det"><summary>Ver exemplos</summary><ul>${c.exemplos.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}</div></li>`).join('')}</ul>
    ${comparacao}
    ${acoes ? `<div class="bo-acoes">${acoes}</div>` : ''}
  </article>`;
}

const dataHora = (iso) => { if (!iso) return ''; const [d, h] = iso.split('T'); return `${d.split('-').reverse().join('/')} ${(h || '').slice(0, 5)}`; };

function ligarBasesOficiais() {
  document.querySelectorAll('[data-bo-enviar]').forEach((b) => b.addEventListener('click', () => enviarLote(b.dataset.boEnviar, b)));
  document.querySelectorAll('[data-bo-forcar]').forEach((c) => c.addEventListener('change', () => {
    const b = document.querySelector(`[data-bo-publicar="${c.dataset.boForcar}"]`); if (b) b.disabled = !c.checked;
  }));
  document.querySelectorAll('[data-bo-publicar]').forEach((b) => b.addEventListener('click', async () => {
    const forcar = !!(document.querySelector(`[data-bo-forcar="${b.dataset.boPublicar}"]`) || {}).checked;
    if (!confirm(forcar ? 'A conferência encontrou bloqueio. Publicar este mês assim mesmo?' : 'Publicar este mês? A consulta e os orçamentos passam a usar os preços dele.')) return;
    try { await req(`/api/bases-oficiais/envios/${b.dataset.boPublicar}/publicar${forcar ? '?forcar=true' : ''}`, 'POST'); acompanhar(true); }
    catch (e) { avisar(esc(e.message)); }
  }));
  document.querySelectorAll('[data-bo-descartar]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Descartar este envio? Ele não vai ao ar.')) return;
    try { await req(`/api/bases-oficiais/envios/${b.dataset.boDescartar}/descartar`, 'POST'); window.desenharBasesOficiais(); avisar('Envio descartado.'); }
    catch (e) { avisar(esc(e.message)); }
  }));
  document.querySelectorAll('[data-bo-desfazer]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Tirar este mês do ar? Volta o que havia antes dele (o envio anterior do mesmo mês ou a versão já carregada).')) return;
    try { await req(`/api/bases-oficiais/envios/${b.dataset.boDesfazer}/desfazer`, 'POST'); acompanhar(true); }
    catch (e) { avisar(esc(e.message)); }
  }));
}

async function enviarLote(base, botao) {
  const cartao = document.querySelector(`[data-bo-base="${base}"]`);
  const campos = [...cartao.querySelectorAll('[data-bo-papel]')];
  const faltam = campos.filter((c) => !c.files.length).map((c) => c.closest('label').querySelector('.bo-arq-nome').firstChild.textContent.trim());
  if (faltam.length) { avisar(`Falta escolher: ${esc(faltam.join(', '))}.`); return; }
  const arquivos = campos.flatMap((c) => [...c.files].map((f) => [c.dataset.boPapel, f]));
  botao.disabled = true;
  const voltar = () => { botao.disabled = false; botao.textContent = 'Enviar e conferir'; };
  try {
    const lote = await req('/api/bases-oficiais/lote', 'POST', { base });
    for (const [k, [papel, f]] of arquivos.entries()) {
      botao.textContent = `Enviando ${k + 1} de ${arquivos.length}…`;
      const resp = await fetch(`/api/bases-oficiais/lote/${lote.id}/arquivo?papel=${papel}`, { method: 'POST', body: f, headers: { 'X-Nome-Arquivo': encodeURIComponent(f.name) } });
      if (!resp.ok) { const j = await resp.json().catch(() => ({})); throw new Error(j.detail || `Não foi possível enviar ${f.name}.`); }
    }
    botao.textContent = 'Conferindo…';
    await req(`/api/bases-oficiais/lote/${lote.id}/processar`, 'POST');
    acompanhar(true);
  } catch (e) { avisar(esc(e.message)); voltar(); }
}

function acompanhar(redesenhar) {
  clearTimeout(BO.timer);
  const passo = async () => {
    if (!/^#\/bases-oficiais/.test(location.hash)) return;
    let t;
    try { t = await api('/api/bases-oficiais/tarefa'); } catch (_) { BO.timer = setTimeout(passo, 4000); return; }
    if (t.estado === 'rodando') {
      const caixa = $('#bo-tarefa'); if (caixa) caixa.innerHTML = blocoTarefa(t);
      document.querySelectorAll('[data-bo-enviar], [data-bo-publicar], [data-bo-desfazer]').forEach((b) => { b.disabled = true; });
      BO.timer = setTimeout(passo, 2500);
      return;
    }
    await window.desenharBasesOficiais();
    if (t.estado === 'pronto') {
      avisar(`${VISTO}${esc(t.etapa)}`, 6000);
      if (t.envio) { const el = document.querySelector(`[data-bo-env="${t.envio}"]`); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
      if (window.conferirVersao) window.conferirVersao();
    }
  };
  if (redesenhar) passo(); else BO.timer = setTimeout(passo, 2500);
}
