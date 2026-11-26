'use strict';
/* Mão de obra e prazo do orçamento: horas de cada profissional por serviço e etapa (das composições) e o prazo estimado
   com a equipe e a jornada informadas, ou a equipe necessária para um prazo. As etapas correm em sequência. */

const PRZ = { dados: null, id: null, abertas: new Set(), servicos: false };
const horasFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const diasFmt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const DIAS_MES = 22;  // dias úteis num mês

function przConfig(id) {
  let c = {};
  try { c = JSON.parse(localStorage.getItem(`infocustos-prazo-${id}`) || '{}') || {}; } catch (_) { c = {}; }
  return { jornada: 8, prod: 100, modo: 'equipe', alvo: '', equipe: {}, paralelas: [], inicio: '', ...c };
}
function przGravar(id, c) { try { localStorage.setItem(`infocustos-prazo-${id}`, JSON.stringify(c)); } catch (_) { /* só nesta visita */ } }

async function przDados(o) {
  if (PRZ.id !== o.id || !PRZ.dados || PRZ.versao !== o.atualizado_em) {
    PRZ.dados = await req(`/api/orcamentos/${o.id}/mao-de-obra`); PRZ.id = o.id; PRZ.versao = o.atualizado_em;
  }
  return PRZ.dados;
}

// dias úteis de um grupo de horas e o profissional que define o prazo (o mesmo cálculo da planilha do Excel)
function przDias(horas, equipe, cap) {
  let pior = 0, quem = null;
  for (const [k, h] of Object.entries(horas)) {
    const n = Math.max(Math.floor(Number(equipe[k]) || 1), 1);
    const d = cap > 0 ? h / (n * cap) : 0;
    if (d > pior) { pior = d; quem = k; }
  }
  return [pior, quem];
}
// cronograma: cada etapa começa quando a anterior (no mesmo nível) termina, ou junto com ela se estiver marcada como
// simultânea; dentro de uma etapa, primeiro os itens lançados direto nela, depois as de dentro, na mesma regra
function przPrazos(dados, equipe, cap, paralelas = new Set()) {
  const filhas = new Map(); for (const e of dados.etapas) { const k = e.pai_id || null; if (!filhas.has(k)) filhas.set(k, []); filhas.get(k).push(e); }
  const res = new Map(); const gargalo = {}; const blocos = [];  // blocos: os itens diretos de cada etapa, com início e fim
  const grupo = (lista, ini) => {
    let cursor = ini, fim = ini, iniAnt = null;
    for (const f of lista) {
      const s = paralelas.has(f.id) && iniAnt !== null ? iniAnt : cursor;
      const fe = agenda(f, s); iniAnt = s; cursor = Math.max(cursor, fe); fim = Math.max(fim, fe);
    }
    return fim;
  };
  const agenda = (e, ini) => {
    const [d, quem0] = przDias(e.horas_proprias, equipe, cap); let quem = quem0;
    if (quem) gargalo[quem] = (gargalo[quem] || 0) + d;
    if (d > 0) blocos.push({ etapa: e.id, ini, fim: ini + d, horas: e.horas_proprias });
    const fs = filhas.get(e.id) || [];
    const fim = grupo(fs, ini + d);
    if (!quem) { const maior = fs.reduce((m, f) => (!m || res.get(f.id)[0] > res.get(m.id)[0] ? f : m), null); quem = maior ? res.get(maior.id)[1] : null; }
    res.set(e.id, [fim - ini, quem, ini, fim]); return fim;
  };
  const total = grupo(filhas.get(null) || [], 0);
  return { res, total, gargalo, blocos };
}
// prazo informado: começa da equipe mínima (cada um trabalhando o prazo todo) e reforça quem segura o prazo até caber
function przEquipePara(dados, alvo, cap, paralelas) {
  const eq = {};
  for (const p of dados.profissionais) eq[p.chave] = Math.max(1, Math.ceil(p.horas / (alvo * cap)));
  let r = przPrazos(dados, eq, cap, paralelas);
  for (let n = 0; n < 2000 && r.total > alvo + 1e-9; n++) {
    const quem = Object.entries(r.gargalo).sort((a, b) => b[1] - a[1])[0];
    if (!quem) break;
    eq[quem[0]] += 1; r = przPrazos(dados, eq, cap, paralelas);
  }
  return { equipe: eq, ...r };
}
function przCalcular(dados, cfg) {
  const cap = (Number(cfg.jornada) || 8) * (Number(cfg.prod) || 100) / 100;
  const alvo = Number(cfg.alvo);
  const paralelas = new Set((cfg.paralelas || []).filter((id) => dados.etapas.some((e) => e.id === id)));
  if (cfg.modo === 'prazo' && alvo > 0) return { cap, paralelas, ...przEquipePara(dados, alvo, cap, paralelas) };
  const equipe = {}; for (const p of dados.profissionais) equipe[p.chave] = Math.max(Math.floor(Number(cfg.equipe[p.chave]) || 1), 1);
  return { cap, paralelas, equipe, ...przPrazos(dados, equipe, cap, paralelas) };
}
const przSoma = (h) => Object.values(h).reduce((s, v) => s + v, 0);
const przMeses = (d) => d >= DIAS_MES ? ` · cerca de ${diasFmt.format(d / DIAS_MES)} ${d / DIAS_MES >= 1.95 ? 'meses' : 'mês'}` : '';
function przChips(horas, nomes, lim = 4) {
  const l = Object.entries(horas).sort((a, b) => b[1] - a[1]);
  const txt = l.slice(0, lim).map(([k, v]) => `${esc(nomes[k] || k)} <b>${horasFmt.format(v)} h</b>`).join(' · ');
  return txt + (l.length > lim ? ` · mais ${l.length - lim}` : '');
}
const przExcel = (o, cfg, calc) => `/api/orcamentos/${o.id}/mao-de-obra.xlsx?${new URLSearchParams({ jornada: cfg.jornada, produtividade: cfg.prod, equipe: JSON.stringify(calc.equipe), paralelas: [...calc.paralelas].join(','), inicio: cfg.inicio || '' })}`;

// ---------- datas (dias úteis: segunda a sexta) ----------
function przData(inicio, dias) {
  if (!inicio) return null;
  const d = new Date(`${inicio}T12:00:00`); if (Number.isNaN(d.getTime())) return null;
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  let falta = Math.floor(dias + 1e-9);
  while (falta > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) falta -= 1; }
  return d;
}
const dataCurta = (d) => d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '';
// fim de um período de `dias` úteis que começa em `ini`: o último dia trabalhado
const przFimData = (inicio, ini, fim) => przData(inicio, Math.max(Math.ceil(fim - 1e-9) - 1, Math.floor(ini + 1e-9)));

// ---------- cronograma (barras) e histograma de mão de obra ----------
const PRZ_CORES = ['#2A78D6', '#EB6834', '#1BAF7A', '#6250D6', '#D4A100', '#C2417A', '#2E9FB0'];
function przSemanas(calc) {
  const sem = Math.max(1, Math.ceil(calc.total / 5 - 1e-9));
  const porSem = Array.from({ length: sem }, () => ({}));
  for (const b of calc.blocos) {
    for (const [k, h] of Object.entries(b.horas)) {
      const n = Math.max(Math.floor(Number(calc.equipe[k]) || 1), 1); const d = h / (n * calc.cap);
      const ini = b.ini, fim = b.ini + d;
      for (let w = Math.floor(ini / 5); w < sem && w * 5 < fim; w++) {
        const sobra = Math.min(fim, w * 5 + 5) - Math.max(ini, w * 5);
        if (sobra > 0) porSem[w][k] = (porSem[w][k] || 0) + n * sobra / 5;
      }
    }
  }
  return porSem;
}
function przGantt(dados, calc, cfg, comControles) {
  const total = calc.total || 1; const sem = Math.max(1, Math.ceil(total / 5 - 1e-9));
  const passo = Math.max(1, Math.ceil(sem / (comControles ? 10 : 6)));
  const marcas = []; for (let w = 0; w <= sem; w += passo) marcas.push(w);
  const irmaAnterior = new Map(); const visto = new Map();
  for (const e of dados.etapas) { const k = e.pai_id || 0; irmaAnterior.set(e.id, visto.get(k) || null); visto.set(k, e.id); }
  const linhas = dados.etapas.map((e) => {
    const [d, , ini, fim] = calc.res.get(e.id); if (!(d > 0)) return '';
    const datas = cfg.inicio ? `${dataCurta(przData(cfg.inicio, ini))} a ${dataCurta(przFimData(cfg.inicio, ini, fim))}` : `dia ${diasFmt.format(ini)} ao ${diasFmt.format(fim)}`;
    const pode = irmaAnterior.get(e.id) && comControles;
    return `<div class="gt-linha n${e.nivel}"><div class="gt-rot"><span class="gt-num">${e.numero}</span><span class="gt-tit">${esc(e.titulo)}</span><span class="gt-datas">${diasFmt.format(d)} dias úteis · ${datas}</span>
        ${pode ? `<label class="gt-junto" title="Começa junto com a etapa anterior, em vez de depois dela"><input type="checkbox" data-prz-junto="${e.id}"${calc.paralelas.has(e.id) ? ' checked' : ''}>junto com a anterior</label>` : (calc.paralelas.has(e.id) && !comControles ? '<span class="gt-junto">junto com a anterior</span>' : '')}</div>
      <div class="gt-trilho"><span class="gt-barra" style="left:${ini / (sem * 5) * 100}%;width:${Math.max((fim - ini) / (sem * 5) * 100, 0.6)}%" title="${esc(e.numero + ' ' + e.titulo)}: ${diasFmt.format(d)} dias úteis, ${datas}"></span></div></div>`;
  }).join('');
  return `<div class="gantt" role="img" aria-label="Cronograma: ${esc(dados.etapas.filter((e) => calc.res.get(e.id)[0] > 0).map((e) => `${e.numero} ${e.titulo}, ${diasFmt.format(calc.res.get(e.id)[0])} dias úteis`).join('; '))}">
    <div class="gt-linha gt-eixo"><div class="gt-rot">${cfg.inicio ? `Início em ${dataCurta(przData(cfg.inicio, 0))}` : 'Semana'}</div><div class="gt-trilho">${marcas.map((w) => `<span style="left:${w / sem * 100}%">${cfg.inicio ? dataCurta(przData(cfg.inicio, w * 5)) : w + 1 > sem ? '' : `S${w + 1}`}</span>`).join('')}</div></div>
    ${linhas}</div>`;
}
function przHistograma(dados, calc, W = 960) {
  const porSem = przSemanas(calc); const nomes = Object.fromEntries(dados.profissionais.map((p) => [p.chave, p.nome]));
  const top = dados.profissionais.slice(0, 6).map((p) => p.chave); const cor = (k) => PRZ_CORES[top.indexOf(k)] || '#9AA1A8';
  const series = [...top, 'outros'];
  const valores = porSem.map((w) => { const v = {}; for (const [k, n] of Object.entries(w)) { const c = top.includes(k) ? k : 'outros'; v[c] = (v[c] || 0) + n; } return v; });
  const max = Math.max(1, ...valores.map((v) => Object.values(v).reduce((s, x) => s + x, 0)));
  const pico = valores.reduce((m, v, i) => { const t = Object.values(v).reduce((s, x) => s + x, 0); return t > m[0] ? [t, i] : m; }, [0, 0]);
  const H = 220, L = 34, B = 22, larg = (W - L) / valores.length;
  const passoY = max <= 6 ? 1 : max <= 15 ? 2 : max <= 40 ? 5 : 10;
  const ys = []; for (let y = 0; y <= max; y += passoY) ys.push(y);
  const passoX = valores.length <= 16 ? 1 : Math.ceil(valores.length / 16);
  const barras = valores.map((v, i) => { let acum = 0;
    return series.filter((k) => v[k] > 0).map((k) => { const h = v[k] / max * (H - B - 8); const y = H - B - acum - h; acum += h;
      return `<rect x="${L + i * larg + larg * 0.12}" y="${y}" width="${larg * 0.76}" height="${h}" fill="${k === 'outros' ? '#9AA1A8' : cor(k)}"><title>Semana ${i + 1} · ${esc(k === 'outros' ? 'Outros' : nomes[k])}: ${diasFmt.format(v[k])} pessoas em média</title></rect>`; }).join(''); }).join('');
  return `<figure class="histograma"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Histograma de mão de obra: pico de ${diasFmt.format(pico[0])} pessoas na semana ${pico[1] + 1}">
      ${ys.map((y) => { const yy = H - B - y / max * (H - B - 8); return `<line x1="${L}" x2="${W}" y1="${yy}" y2="${yy}" class="hg-grade"/><text x="${L - 6}" y="${yy + 3}" text-anchor="end" class="hg-txt">${y}</text>`; }).join('')}
      ${barras}
      ${valores.map((_, i) => i % passoX ? '' : `<text x="${L + i * larg + larg / 2}" y="${H - 6}" text-anchor="middle" class="hg-txt">S${i + 1}</text>`).join('')}
    </svg>
    <figcaption><ul class="hg-leg">${series.filter((k) => valores.some((v) => v[k] > 0)).map((k) => `<li><i style="background:${k === 'outros' ? '#9AA1A8' : cor(k)}"></i>${esc(k === 'outros' ? 'Outros' : nomes[k])}</li>`).join('')}</ul>
      <p>Pessoas na obra em média por semana (5 dias úteis). Pico: <b>${diasFmt.format(pico[0])} pessoas</b> na semana ${pico[1] + 1}. Cada profissional fica na etapa o tempo das horas dele, com a equipe informada.</p></figcaption></figure>`;
}

window.desenharPrazo = async function (o) {
  const corpo = $('#orc-corpo');
  if (!o.qtd_itens) { corpo.innerHTML = vazio('grafico', 'A análise de prazo aparece quando houver itens', 'Adicione composições na aba Planilha.'); return; }
  corpo.innerHTML = '<p class="carregando">Somando as horas de mão de obra das composições…</p>';
  const dados = await przDados(o);
  if (ORC.aba !== 'prazo' || !document.body.contains(corpo)) return;
  const cfg = przConfig(o.id);
  const nomes = Object.fromEntries([...dados.profissionais, ...dados.mensais].map((p) => [p.chave, p.nome]));
  if (!dados.profissionais.length) {
    corpo.innerHTML = vazio('grafico', 'Nenhuma hora de mão de obra nos itens', 'Os itens deste orçamento não têm profissionais em horas nas composições (insumos lançados direto ou serviços sem composição).'); return;
  }
  const calc = przCalcular(dados, cfg);
  const maxH = dados.profissionais[0].horas || 1;
  const itensDe = new Map(); for (const i of dados.itens) { if (!itensDe.has(i.etapa_id)) itensDe.set(i.etapa_id, []); itensDe.get(i.etapa_id).push(i); }
  const linhasProf = dados.profissionais.map((p) => {
    const n = calc.equipe[p.chave]; const d = p.horas / (n * calc.cap);
    return `<tr><td class="desc">${esc(p.nome)}</td><td class="num">${horasFmt.format(p.horas)} h</td>
      <td class="num">${cfg.modo === 'prazo' ? `<b>${n}</b>` : `<input class="prz-n" type="number" min="1" step="1" inputmode="numeric" value="${n}" data-prz-eq="${esc(p.chave)}" aria-label="Quantos ${esc(p.nome)} na equipe">`}</td>
      <td class="num">${diasFmt.format(d)}</td><td class="prz-barra"><span class="peso"><i style="width:${(p.horas / maxH) * 100}%"></i></span></td></tr>`;
  }).join('');
  const linhasEtapa = dados.etapas.map((e) => {
    const [d, quem] = calc.res.get(e.id); const h = przSoma(e.horas); const its = itensDe.get(e.id) || [];
    const aberta = PRZ.servicos || PRZ.abertas.has(e.id);
    return `<tbody class="prz-etapa n${e.nivel}${aberta ? ' aberta' : ''}"><tr class="prz-cab">
        <td class="n">${its.length ? `<button type="button" class="recolher" data-prz-abrir="${e.id}" aria-expanded="${aberta}" aria-label="${aberta ? 'Esconder' : 'Mostrar'} os serviços de ${esc(e.numero)}">›</button>` : ''}${e.numero}</td>
        <td class="desc">${esc(e.titulo)}</td><td class="num">${h ? `${horasFmt.format(h)} h` : '—'}</td>
        <td class="num"><b>${h ? diasFmt.format(d) : '—'}</b></td><td>${quem ? esc(nomes[quem] || quem) : ''}</td></tr>
      ${aberta ? its.map((i) => `<tr class="prz-item"><td class="n">${i.numero}</td>
        <td class="desc"><span class="prz-cod">${esc(i.codigo)} · ${esc(rotuloBase(i.base, i.codigo))}</span> ${esc(i.descricao)}
          <span class="prz-chips">${i.sem_dados ? 'Sem composição: não entra na conta.' : (przSoma(i.horas) ? przChips(i.horas, nomes) : 'Sem mão de obra em horas.')}</span></td>
        <td class="num">${przSoma(i.horas) ? `${horasFmt.format(przSoma(i.horas))} h` : '—'}</td><td class="num">${przSoma(i.horas) ? diasFmt.format(przDias(i.horas, calc.equipe, calc.cap)[0]) : ''}</td><td></td></tr>`).join('') : ''}</tbody>`;
  }).join('');
  const alvo = Number(cfg.alvo);
  corpo.innerHTML = `
    <p class="sub" style="margin-top:18px">Horas de cada profissional tiradas das composições (quantidade do item × coeficiente em h), com as composições auxiliares abertas até o fim. Os encargos complementares (alimentação, transporte, EPI, curso) não são tempo de obra e ficam de fora. As etapas correm em sequência, na ordem do orçamento, a não ser as marcadas para correr junto com a anterior.</p>
    <div class="prz-opcoes">
      <label>Jornada (h por dia)<input id="prz-jornada" inputmode="decimal" value="${qtdFmt.format(cfg.jornada)}"></label>
      <label>Produtividade da equipe (% da base)<input id="prz-prod" inputmode="decimal" value="${qtdFmt.format(cfg.prod)}"></label>
      <div class="prz-modo" role="radiogroup" aria-label="O que você quer informar">
        <button type="button" role="radio" aria-checked="${cfg.modo !== 'prazo'}" data-prz-modo="equipe">Tenho a equipe: calcular o prazo</button>
        <button type="button" role="radio" aria-checked="${cfg.modo === 'prazo'}" data-prz-modo="prazo">Tenho o prazo: calcular a equipe</button></div>
      <label>Início da obra (opcional)<input id="prz-inicio" type="date" value="${esc(cfg.inicio || '')}"></label>
      ${cfg.modo === 'prazo' ? `<label>Prazo desejado (dias úteis)<input id="prz-alvo" inputmode="numeric" value="${esc(String(cfg.alvo || ''))}" placeholder="ex.: 120"></label>` : ''}
      <a class="botao" href="${przExcel(o, cfg, calc)}">Planilha do Excel (.xlsx)</a>
    </div>
    <div class="prz-resumo">
      <div>Horas de mão de obra<b>${horasFmt.format(dados.horas_total)} h</b><span>${dados.profissionais.length} profissionais</span></div>
      <div>Prazo estimado<b>${diasFmt.format(calc.total)} dias úteis</b><span>${qtdFmt.format(cfg.jornada)} h por dia${przMeses(calc.total)}</span></div>
      <div>Equipe${cfg.modo === 'prazo' ? ' necessária' : ''}<b>${Object.values(calc.equipe).reduce((s, n) => s + n, 0)} pessoas</b><span>${cfg.modo === 'prazo' ? (alvo > 0 ? `para ${qtdFmt.format(alvo)} dias úteis` : 'informe o prazo desejado') : 'altere na tabela abaixo'}</span></div>
    </div>
    ${cfg.modo === 'prazo' && !(alvo > 0) ? '<p class="fonte">Informe o prazo desejado para calcular a equipe. Enquanto isso, a conta usa 1 profissional de cada.</p>' : ''}
    <h3 class="prz-tit">Profissionais</h3>
    <table class="planilha prz-tab"><thead><tr><th>Profissional</th><th class="num">Horas na obra</th><th class="num">Equipe</th><th class="num">Dias úteis com essa equipe</th><th></th></tr></thead><tbody>${linhasProf}</tbody></table>
    ${dados.mensais.length ? `<p class="fonte">Acompanhamento, em meses, fora da conta do prazo: ${dados.mensais.map((p) => `${esc(p.nome)} ${num2.format(p.meses)} ${p.meses >= 2 ? 'meses' : 'mês'}`).join(' · ')}.</p>` : ''}
    <div class="prz-tit-linha"><h3 class="prz-tit">Prazo por etapa</h3><button type="button" class="link-acao" data-prz-todos>${PRZ.servicos ? 'Esconder os serviços' : 'Mostrar os serviços de todas'}</button></div>
    <table class="planilha prz-tab prz-etapas"><thead><tr><th>Item</th><th>Etapa e serviço</th><th class="num">Horas</th><th class="num">Dias úteis</th><th>Quem define o prazo</th></tr></thead>${linhasEtapa}</table>
    <h3 class="prz-tit">Cronograma</h3>
    <p class="fonte">Cada etapa começa quando a anterior termina. Marque "junto com a anterior" nas etapas que correm ao mesmo tempo${cfg.inicio ? '; as datas contam só os dias úteis (segunda a sexta, sem feriados)' : '; informe o início da obra para ver as datas'}.</p>
    ${przGantt(dados, calc, cfg, true)}
    <h3 class="prz-tit">Histograma de mão de obra</h3>
    ${przHistograma(dados, calc)}
    <p class="fonte">O coeficiente das bases é a produtividade média de referência; ajuste a produtividade se a sua equipe rende mais ou menos. ${dados.sem_dados ? `${dados.sem_dados} ${dados.sem_dados === 1 ? 'item sem composição ficou' : 'itens sem composição ficaram'} de fora.` : ''}</p>`;
  const refazer = () => window.desenharPrazo(o);
  const ler = (sel, chave) => { const el = $(sel); if (!el) return; el.addEventListener('change', () => { const v = lerNum(el.value); if (v > 0) { cfg[chave] = v; przGravar(o.id, cfg); } refazer(); }); };
  $('#prz-inicio').addEventListener('change', (e) => { cfg.inicio = e.target.value || ''; przGravar(o.id, cfg); refazer(); });
  corpo.querySelectorAll('[data-prz-junto]').forEach((c) => c.addEventListener('change', () => {
    const id = Number(c.dataset.przJunto); const l = new Set(cfg.paralelas || []); if (c.checked) l.add(id); else l.delete(id);
    cfg.paralelas = [...l]; przGravar(o.id, cfg); refazer();
  }));
  ler('#prz-jornada', 'jornada'); ler('#prz-prod', 'prod'); ler('#prz-alvo', 'alvo');
  corpo.querySelectorAll('[data-prz-eq]').forEach((el) => el.addEventListener('change', () => {
    const v = Math.floor(lerNum(el.value)); if (v >= 1) { cfg.equipe[el.dataset.przEq] = v; przGravar(o.id, cfg); } refazer();
  }));
  corpo.querySelectorAll('[data-prz-modo]').forEach((b) => b.addEventListener('click', () => { cfg.modo = b.dataset.przModo; przGravar(o.id, cfg); refazer(); }));
  corpo.querySelectorAll('[data-prz-abrir]').forEach((b) => b.addEventListener('click', () => {
    const id = Number(b.dataset.przAbrir); if (PRZ.abertas.has(id)) PRZ.abertas.delete(id); else PRZ.abertas.add(id); refazer();
  }));
  corpo.querySelector('[data-prz-todos]').addEventListener('click', () => { PRZ.servicos = !PRZ.servicos; PRZ.abertas.clear(); refazer(); });
};

// folha do relatório (imprimir ou PDF), com a mesma configuração da aba
window.folhaPrazo = async function (emp, o) {
  const dados = await przDados(o); const cfg = przConfig(o.id);
  if (!dados.profissionais.length) return `<section class="folha">${cabecalhoFolha(emp, o)}<h2>Mão de obra e prazo</h2><p class="rel-nota">Os itens deste orçamento não têm profissionais em horas nas composições.</p>${rodapeFolha(o)}</section>`;
  const calc = przCalcular(dados, cfg);
  const nomes = Object.fromEntries(dados.profissionais.map((p) => [p.chave, p.nome]));
  const itensDe = new Map(); for (const i of dados.itens) { if (!itensDe.has(i.etapa_id)) itensDe.set(i.etapa_id, []); itensDe.get(i.etapa_id).push(i); }
  return `<section class="folha">${cabecalhoFolha(emp, o)}
    <h2>Mão de obra e prazo</h2>
    <p class="rel-nota">Jornada de ${qtdFmt.format(cfg.jornada)} h por dia, produtividade de ${qtdFmt.format(cfg.prod)}% da base${cfg.modo === 'prazo' && Number(cfg.alvo) > 0 ? `, equipe calculada para ${qtdFmt.format(Number(cfg.alvo))} dias úteis` : ''}. Horas tiradas das composições, sem os encargos complementares; etapas em sequência, na ordem do orçamento${calc.paralelas.size ? ', a não ser as marcadas para correr junto com a anterior' : ''}.</p>
    <div class="rel-prz-resumo"><div><span>Horas de mão de obra</span><b>${horasFmt.format(dados.horas_total)} h</b></div>
      <div><span>Prazo estimado</span><b>${diasFmt.format(calc.total)} dias úteis</b></div>
      <div><span>Equipe</span><b>${Object.values(calc.equipe).reduce((s, n) => s + n, 0)} pessoas</b></div></div>
    <h3>Profissionais</h3>
    <table class="rel-tabela"><thead><tr><th>Profissional</th><th class="num">Horas</th><th class="num">Equipe</th><th class="num">Dias úteis</th></tr></thead>
      <tbody>${dados.profissionais.map((p) => `<tr><td>${esc(p.nome)}</td><td class="num">${horasFmt.format(p.horas)}</td><td class="num">${calc.equipe[p.chave]}</td><td class="num">${diasFmt.format(p.horas / (calc.equipe[p.chave] * calc.cap))}</td></tr>`).join('')}</tbody></table>
    ${dados.mensais.length ? `<p class="rel-nota">Acompanhamento, fora da conta do prazo: ${dados.mensais.map((p) => `${esc(p.nome)} ${num2.format(p.meses)} ${p.meses >= 2 ? 'meses' : 'mês'}`).join(' · ')}.</p>` : ''}
    <h3>Prazo por etapa e horas por serviço</h3>
    <table class="rel-tabela"><thead><tr><th>Item</th><th>Etapa e serviço</th><th class="num">Horas</th><th class="num">Dias úteis</th><th>Quem define o prazo</th></tr></thead>
      <tbody>${dados.etapas.map((e) => { const [d, quem] = calc.res.get(e.id); const h = przSoma(e.horas);
        return `<tr class="rel-etapa${e.nivel > 1 ? ` rel-sub rel-n${e.nivel}` : ''}"><td class="n">${e.numero}</td><td>${esc(e.titulo)}</td><td class="num">${h ? horasFmt.format(h) : '—'}</td><td class="num">${h ? diasFmt.format(d) : '—'}</td><td>${quem ? esc(nomes[quem] || '') : ''}</td></tr>
        ${(itensDe.get(e.id) || []).map((i) => `<tr><td class="n">${i.numero}</td><td>${esc(i.descricao)}<span class="rel-prz-chips">${i.sem_dados ? 'Sem composição: não entra na conta.' : przChips(i.horas, nomes, 6)}</span></td>
          <td class="num">${przSoma(i.horas) ? horasFmt.format(przSoma(i.horas)) : '—'}</td><td class="num">${przSoma(i.horas) ? diasFmt.format(przDias(i.horas, calc.equipe, calc.cap)[0]) : ''}</td><td></td></tr>`).join('')}`; }).join('')}</tbody>
      <tfoot><tr><td></td><td>Prazo estimado da obra${cfg.inicio ? ` (${dataCurta(przData(cfg.inicio, 0))} a ${dataCurta(przFimData(cfg.inicio, 0, calc.total))})` : ''}</td><td class="num">${horasFmt.format(dados.horas_total)}</td><td class="num">${diasFmt.format(calc.total)}</td><td></td></tr></tfoot></table>
    <h3>Cronograma</h3>
    ${przGantt(dados, calc, cfg, false)}
    <h3>Histograma de mão de obra</h3>
    ${przHistograma(dados, calc, 640)}
    <p class="rel-nota">O coeficiente das bases é a produtividade média de referência, não a da equipe da obra.</p>
    ${rodapeFolha(o)}</section>`;
};
