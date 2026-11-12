'use strict';
/* Camada local do artefato: responde às mesmas rotas da API do servidor, usando os arquivos em dados/.
   Cada mês de referência tem seus próprios arquivos. Os orçamentos ficam no armazenamento deste navegador. */

const LOCAL = (() => {
  const BASES = ['ORSE', 'SINAPI'];
  const SECOES = ['MAO_DE_OBRA', 'MATERIAL', 'EQUIPAMENTO', 'SERVICO_TERCEIRO', 'SERVICO_AUXILIAR'];
  const CHAVE = 'infocustos-orcamentos-v1';
  let MESES = [], NS = 24, pronto = null;
  const DADOS = new Map();  // mês -> { itens, porChave, compExiste, cacheComp, cacheUsos }

  const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const palavrasDe = (t) => semAcento(t).match(/[a-z0-9]+/g) || [];
  const shard = (base, cod) => { let s = 0; for (const ch of base + '|' + cod) s += ch.charCodeAt(0); return s % NS; };
  const semZero = (c) => String(c).replace(/^0+/, '');
  const r2 = (v) => Math.round(Number((v * 100).toPrecision(12))) / 100;  // meio para cima, como o ARRED do Excel
  const nomeMes = (m) => m.descricao.replace(/-1$/, '');
  function erro(status, msg) { const e = new Error(msg); e.status = status; return e; }

  function carregar() {
    if (pronto) return pronto;
    pronto = fetch('dados/meses.json').then((r) => { if (!r.ok) throw new Error('Não foi possível carregar a base de preços.'); return r.json(); })
      .then((j) => { MESES = j.meses; NS = j.n_shards; });
    return pronto;
  }
  function mes(ref) {
    if (!ref) return MESES[MESES.length - 1];
    const m = MESES.find((x) => x.id === ref);
    if (!m) throw erro(404, `O mês ${ref} não está carregado. Meses disponíveis: ${MESES.map((x) => x.id).join(', ')}.`);
    return m;
  }
  async function dados(ref) {
    if (!DADOS.has(ref)) {
      DADOS.set(ref, fetch(`dados/${ref}/itens.json`).then((r) => r.json()).then((j) => {
        const d = { itens: [], porChave: new Map(), compExiste: new Set(), cacheComp: new Map(), cacheUsos: new Map() };
        d.itens = j.itens.map((a) => {
          const it = { tipo: a[0] === 0 ? 'servico' : 'insumo', base: BASES[a[1]], codigo: a[2], descricao: a[3], unidade: a[4], preco: a[5],
            grupo: a[6], subgrupo: a[7], categoria: a[8], usos: a[9], tem_composicao: a[10], marcador: a[11] };
          if (a[12]) [it.pct_mo, it.pct_mat, it.pct_equip, it.pct_terc] = a[12];
          it._p = palavrasDe(it.descricao); it._z = semZero(it.codigo);
          d.porChave.set(`${it.tipo}|${it.base}|${it.codigo}`, it);
          if (it.tem_composicao) d.compExiste.add(`${it.base}|${it.codigo}`);
          return it;
        });
        return d;
      }));
    }
    return DADOS.get(ref);
  }
  async function arquivo(ref, prefixo, n, cache) {
    if (!cache.has(n)) cache.set(n, fetch(`dados/${ref}/${prefixo}_${String(n).padStart(2, '0')}.json`).then((r) => r.json()));
    return cache.get(n);
  }
  const item = (d, tipo, base, cod) => d.porChave.get(`${tipo}|${base}|${cod}`) ||
    d.itens.find((x) => x.tipo === tipo && x.base === base && x._z === semZero(cod));

  async function composicao(ref, base, codigo) {
    const d = await dados(ref);
    let cod = codigo;
    if (!d.compExiste.has(`${base}|${cod}`)) {
      const s = item(d, 'servico', base, codigo); if (s && d.compExiste.has(`${base}|${s.codigo}`)) cod = s.codigo; else return null;
    }
    const sh = await arquivo(ref, 'comp', shard(base, cod), d.cacheComp);
    const a = sh[`${base}|${cod}`]; if (!a) return null;
    const srv = item(d, 'servico', base, cod) || {};
    return {
      base, codigo: cod, referencia: ref, modelo: a[0], unidade: a[1] || srv.unidade, prod_equipe: a[2], encargo_social: a[3],
      custo_equipamento: a[4], custo_mao_de_obra: a[5], custo_encargo_social: a[6], custo_material: a[7], custo_servico_terceiro: a[8],
      custo_total: a[9], usada_em: a[10], descricao: srv.descricao, grupo: srv.grupo, subgrupo: srv.subgrupo, categoria: srv.categoria,
      itens: a[11].map((x) => {
        const b = BASES[x[1]], eh = x[3], ref2 = item(d, eh ? 'servico' : 'insumo', b, x[2]);
        return { secao: SECOES[x[0]], base: b, codigo: x[2], eh_servico: eh, unidade: x[4], qtd: x[5], custo_unit: x[6], custo_total: x[7],
          custo_prod: x[8], descricao: x[9] || (ref2 && ref2.descricao) || '', tem_composicao: !!eh && d.compExiste.has(`${b}|${x[2]}`) };
      }),
    };
  }

  // ---------- busca (um mês) ----------
  function pontuar(it, termos) {
    const p = it._p; let s = 0, pos = 0;
    for (const t of termos) {
      const k = p.findIndex((w) => w.startsWith(t));
      if (k < 0) return null;
      pos += k; s -= (p[k] === t ? 1.2 : 0.8);
    }
    if (p[0] && p[0].startsWith(termos[0])) s -= 6; else if (p.slice(0, 4).some((w) => w.startsWith(termos[0]))) s -= 2;
    if (it.tipo === 'servico') s -= 1.5;
    s -= Math.min(it.usos || 0, 2000) / 1000;
    return s + pos / 40 + p.length / 200;
  }
  const destacar = (desc, termos) => desc.replace(/[\p{L}\p{N}]+/gu, (w) => (termos.some((t) => semAcento(w).startsWith(t)) ? `\u0001${w}\u0002` : w));
  const publico = (x, trecho) => ({ tipo: x.tipo, base: x.base, codigo: x.codigo, descricao: x.descricao, unidade: x.unidade, preco: x.preco,
    grupo: x.grupo, subgrupo: x.subgrupo, categoria: x.categoria, usos: x.usos, tem_composicao: x.tem_composicao, marcador: x.marcador,
    pct_mo: x.pct_mo, pct_mat: x.pct_mat, pct_equip: x.pct_equip, pct_terc: x.pct_terc, trecho });

  async function busca(ref, q, base, tipo, limite) {
    const d = await dados(ref);
    q = (q || '').trim();
    const passa = (x) => (base !== 'ORSE' && base !== 'SINAPI' || x.base === base) && (tipo !== 'servico' && tipo !== 'insumo' || x.tipo === tipo);
    const contar = (l) => {  // contagem por tipo × base, sem os filtros (para os números dos filtros)
      const m = new Map(); for (const x of l) { const k = `${x.tipo}|${x.base}`; m.set(k, (m.get(k) || 0) + 1); }
      return [...m].map(([k, n]) => { const [t, b] = k.split('|'); return { tipo: t, base: b, n }; });
    };
    if (/^\d{1,7}$/.test(q)) {
      const z = semZero(q);
      const todos = d.itens.filter((x) => x._z === z || x.codigo.startsWith(q));
      const res = todos.filter(passa).sort((a, b) => (b._z === z) - (a._z === z) || (a.tipo === 'servico' ? -1 : 1) || a.codigo.localeCompare(b.codigo));
      return { total: res.length, referencia: ref, grade: contar(todos), itens: res.slice(0, limite).map((x) => publico(x, null)) };
    }
    const termos = palavrasDe(q);
    if (!termos.length) {
      const lista = d.itens.filter(passa);
      return { total: lista.length, referencia: ref, grade: contar(d.itens), itens: [...lista].sort((a, b) => b.usos - a.usos).slice(0, limite).map((x) => publico(x, null)) };
    }
    const todos = [];
    for (const it of d.itens) { const s = pontuar(it, termos); if (s !== null) todos.push([s, it]); }
    const pont = todos.filter(([, it]) => passa(it)).sort((a, b) => a[0] - b[0]);
    return { total: pont.length, referencia: ref, grade: contar(todos.map(([, it]) => it)),
      itens: pont.slice(0, limite).map(([, it]) => publico(it, destacar(it.descricao, termos))) };
  }

  async function insumo(ref, base, codigo, limite) {
    const d = await dados(ref), m = mes(ref);
    const it = item(d, 'insumo', base, codigo);
    if (!it) throw erro(404, `O insumo ${codigo}/${base} não existe em ${nomeMes(m)}.`);
    const sh = await arquivo(ref, 'usos', shard(base, it.codigo), d.cacheUsos);
    const u = sh[`${base}|${it.codigo}`] || [0, []];
    return { base, codigo: it.codigo, referencia: ref, descricao: it.descricao, unidade: it.unidade, preco: it.preco, marcador: it.marcador,
      tipo: it.categoria, grupo: it.grupo, subgrupo: it.subgrupo, usado_em: u[0],
      usos: u[1].slice(0, limite).map((x) => { const s = item(d, 'servico', BASES[x[0]], x[1]) || {};
        return { base: BASES[x[0]], codigo: x[1], descricao: s.descricao, unidade: s.unidade, qtd: x[2], custo_total: x[3], preco_composicao: x[4] }; }) };
  }

  // ---------- comparativo entre meses ----------
  async function comparativo(qs) {
    if (MESES.length < 2) return { de: null, para: MESES[MESES.length - 1], referencias: MESES, resumo: null, itens: [] };
    const a = mes(qs.get('de') || MESES[MESES.length - 2].id), b = mes(qs.get('para') || MESES[MESES.length - 1].id);
    if (a.id === b.id) throw erro(422, 'Escolha dois meses diferentes para comparar.');
    const tipo = qs.get('tipo') === 'insumo' ? 'insumo' : 'servico', base = qs.get('base'), sentido = qs.get('sentido');
    const q = semAcento((qs.get('q') || '').trim()), limite = Math.min(Number(qs.get('limite') || 150), 1000);
    const [da, db] = await Promise.all([dados(a.id), dados(b.id)]);
    const filtro = (l) => l.filter((x) => x.tipo === tipo && (base !== 'ORSE' && base !== 'SINAPI' ? true : x.base === base));
    const la = filtro(da.itens), lb = filtro(db.itens);
    const ma = new Map(la.map((x) => [`${x.base}|${x.codigo}`, x])), mb = new Map(lb.map((x) => [`${x.base}|${x.codigo}`, x]));
    const pares = [];
    for (const [k, y] of mb) { const x = ma.get(k); if (x && x.preco > 0 && y.preco != null) pares.push([x, y]); }
    const res = { comparados: pares.length, subiram: pares.filter(([x, y]) => y.preco > x.preco + 0.005).length,
      desceram: pares.filter(([x, y]) => y.preco < x.preco - 0.005).length, iguais: pares.filter(([x, y]) => Math.abs(y.preco - x.preco) <= 0.005).length,
      novos: [...mb.keys()].filter((k) => !ma.has(k)).length, retirados: [...ma.keys()].filter((k) => !mb.has(k)).length };
    let lista = pares.map(([x, y]) => ({ tipo, base: y.base, codigo: y.codigo, descricao: y.descricao, unidade: y.unidade, grupo: y.grupo,
      preco_de: x.preco, preco_para: y.preco, variacao: y.preco / x.preco - 1 }));
    if (q) lista = lista.filter((x) => semAcento(x.descricao).includes(q) || x.codigo === q);
    lista.sort((x, y) => (sentido === 'baixa' ? x.variacao - y.variacao : y.variacao - x.variacao));
    return { de: a, para: b, referencias: MESES, resumo: res, itens: lista.slice(0, limite) };
  }
  async function comparativoItem(tipo, base, codigo) {
    const meses = [];
    let info = null;
    for (const m of MESES) {
      const it = item(await dados(m.id), tipo, base, codigo);
      if (it) info = it;
      meses.push({ referencia: m.id, descricao: m.descricao, preco: it ? it.preco : null });
    }
    if (!info) throw erro(404, `${codigo}/${base} não existe em nenhum mês carregado.`);
    return { tipo, base, codigo, descricao: info.descricao, unidade: info.unidade, meses };
  }

  // ---------- orçamentos (neste navegador) ----------
  let BANCO = null;
  function banco() {
    if (BANCO) return BANCO;
    try { BANCO = JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch (_) { BANCO = null; }
    if (!BANCO || !Array.isArray(BANCO.orcamentos)) BANCO = { seq: 1, orcamentos: [] };
    return BANCO;
  }
  function gravar() { try { localStorage.setItem(CHAVE, JSON.stringify(BANCO)); } catch (_) { /* fica só na memória */ } }
  const agora = () => new Date().toISOString().slice(0, 19);
  const novoId = () => banco().seq++;
  function achar(oid) { const o = banco().orcamentos.find((x) => x.id === Number(oid)); if (!o) throw erro(404, 'Orçamento não encontrado.'); return o; }
  function donoEtapa(eid) { for (const o of banco().orcamentos) { const e = o.etapas.find((x) => x.id === Number(eid)); if (e) return [o, e]; } throw erro(404, 'Etapa não encontrada.'); }
  function donoItem(iid) { for (const o of banco().orcamentos) { const i = o.itens.find((x) => x.id === Number(iid)); if (i) return [o, i]; } throw erro(404, 'Item não encontrado.'); }
  const ordenar = (l) => l.sort((a, b) => a.ordem - b.ordem || a.id - b.id);

  function calcular(o) {
    if (!MESES.some((m) => m.id === o.referencia)) o.referencia = MESES[MESES.length - 1].id;
    const f = 1 + o.bdi / 100;
    const etapas = ordenar([...o.etapas]).map((e, n) => {
      const itens = ordenar(o.itens.filter((i) => i.etapa_id === e.id)).map((i, m) => {
        const pu = r2(i.custo_unit * f);
        return { ...i, numero: `${n + 1}.${m + 1}`, preco_unit: pu, custo_total: r2(i.quantidade * i.custo_unit), total: r2(i.quantidade * pu) };
      });
      return { ...e, numero: String(n + 1), itens, custo_total: r2(itens.reduce((s, i) => s + i.custo_total, 0)), total: r2(itens.reduce((s, i) => s + i.total, 0)) };
    });
    const custo = r2(etapas.reduce((s, e) => s + e.custo_total, 0)), total = r2(etapas.reduce((s, e) => s + e.total, 0));
    etapas.forEach((e) => { e.peso = total ? e.total / total : 0; });
    const { etapas: _e, itens: _i, ...cab } = o;
    return { ...cab, etapas, custo_total: custo, total, valor_bdi: r2(total - custo), qtd_itens: o.itens.length, referencia_descricao: mes(o.referencia).descricao };
  }
  // divisão do custo direto do orçamento (mesma regra do servidor)
  const PARTE_CAT = { PESSOAL: 'mo', EQUIPAMENTOS: 'equip', 'SERVIÇOS DE TERCEIROS': 'terc' };
  async function comDivisao(c) {
    const partes = { mo: 0, mat: 0, equip: 0, terc: 0 };
    for (const e of c.etapas) for (const i of e.itens) {
      if (!i.custo_total) continue;
      const it = item(await dados(i.referencia || c.referencia), i.tipo, i.base, i.codigo);
      if (i.tipo === 'servico' && it && it.pct_mo != null) for (const k of Object.keys(partes)) partes[k] += i.custo_total * (it['pct_' + k] || 0);
      else if (i.tipo === 'insumo') partes[PARTE_CAT[it ? it.categoria : ''] || 'mat'] += i.custo_total;
      else partes.mat += i.custo_total;
    }
    const soma = partes.mo + partes.mat + partes.equip + partes.terc;
    c.divisao = soma > 0 ? Object.fromEntries(Object.entries(partes).map(([k, v]) => [k, Math.round((v / soma) * 1e4) / 1e4])) : null;
    return c;
  }
  function tocar(o) { o.atualizado_em = agora(); gravar(); return calcular(o); }
  function mover(lista, id, direcao) {
    ordenar(lista); const k = lista.findIndex((x) => x.id === Number(id)); const j = direcao === 'cima' ? k - 1 : k + 1;
    if (j >= 0 && j < lista.length) [lista[k], lista[j]] = [lista[j], lista[k]];
    lista.forEach((x, n) => { x.ordem = n + 1; });
  }
  async function precoNoMes(ref, tipo, base, codigo) {
    const it = item(await dados(ref), tipo, base, codigo); if (!it) return null;
    let preco = it.preco;
    if (tipo === 'servico') { const c = await composicao(ref, base, it.codigo); if (c) preco = c.custo_total; }
    return { codigo: it.codigo, descricao: it.descricao, unidade: it.unidade, preco, referencia: ref };
  }
  async function explodir(ref, base, codigo, fator, acc, prof = 0) {
    const c = await composicao(ref, base, codigo); if (!c || prof > 6) return false;
    for (const i of c.itens) {
      let q = i.qtd || 0, cu;
      if (c.modelo === 'DNIT' && (i.secao === 'EQUIPAMENTO' || i.secao === 'MAO_DE_OBRA') && c.prod_equipe) {
        q /= c.prod_equipe; cu = i.qtd ? i.custo_total / i.qtd : (i.custo_prod || 0);
      } else cu = i.custo_unit != null ? i.custo_unit : (i.qtd ? i.custo_total / i.qtd : 0);
      if (i.eh_servico && await explodir(ref, i.base, i.codigo, fator * q, acc, prof + 1)) continue;
      const k = `${i.base}|${i.codigo}`;
      const a = acc.get(k) || { base: i.base, codigo: i.codigo, descricao: i.descricao, unidade: i.unidade, secao: i.secao, quantidade: 0, custo_total: 0 };
      a.quantidade += fator * q; a.custo_total += fator * q * (cu || 0); acc.set(k, a);
    }
    return true;
  }
  function classificar(linhas, chave) {
    const total = linhas.reduce((s, l) => s + l[chave], 0) || 1; let acum = 0;
    linhas.sort((a, b) => b[chave] - a[chave]);
    linhas.forEach((l, n) => { const ant = acum; acum += l[chave];
      Object.assign(l, { posicao: n + 1, percentual: l[chave] / total, acumulado: acum / total, classe: ant / total < 0.8 ? 'A' : ant / total < 0.95 ? 'B' : 'C' }); });
    return linhas;
  }
  const resumo = (l, chave) => Object.fromEntries(['A', 'B', 'C'].map((cl) => { const g = l.filter((x) => x.classe === cl); return [cl, { itens: g.length, valor: r2(g.reduce((s, x) => s + x[chave], 0)) }]; }));
  async function abc(o, tipo) {
    if (tipo === 'servicos') {
      const m = new Map();
      for (const e of o.etapas) for (const i of e.itens) {
        const k = `${i.tipo}|${i.base}|${i.codigo}`;
        const a = m.get(k) || { tipo: i.tipo, base: i.base, codigo: i.codigo, descricao: i.descricao, unidade: i.unidade, quantidade: 0, preco_unit: i.preco_unit, total: 0 };
        a.quantidade += i.quantidade; a.total += i.total; m.set(k, a);
      }
      const l = classificar([...m.values()], 'total');
      return { tipo, total: o.total, linhas: l, resumo: resumo(l, 'total') };
    }
    const acc = new Map();
    for (const e of o.etapas) for (const i of e.itens) {
      if (i.tipo === 'servico' && await explodir(i.referencia || o.referencia, i.base, i.codigo, i.quantidade, acc)) continue;
      const k = `${i.base}|${i.codigo}`;
      const a = acc.get(k) || { base: i.base, codigo: i.codigo, descricao: i.descricao, unidade: i.unidade, secao: 'DIRETO', quantidade: 0, custo_total: 0 };
      a.quantidade += i.quantidade; a.custo_total += i.quantidade * i.custo_unit; acc.set(k, a);
    }
    const l = classificar([...acc.values()].filter((x) => x.custo_total > 0).map((x) => ({ ...x, custo_unit: x.quantidade ? x.custo_total / x.quantidade : 0 })), 'custo_total');
    return { tipo, total: r2(l.reduce((s, x) => s + x.custo_total, 0)), custo_direto: o.custo_total, linhas: l, resumo: resumo(l, 'custo_total') };
  }
  async function simular(o, ref) {
    const c = calcular(o), f = 1 + o.bdi / 100, linhas = [], sem = []; let novo = 0;
    for (const e of c.etapas) for (const i of e.itens) {
      const p = await precoNoMes(ref, i.tipo, i.base, i.codigo);
      if (!p || p.preco == null) { sem.push({ id: i.id, numero: i.numero, codigo: i.codigo, base: i.base, descricao: i.descricao, motivo: !p ? 'não existe no mês' : 'sem preço no mês' }); novo += i.total; continue; }
      const nt = r2(i.quantidade * r2(p.preco * f)); novo += nt;
      linhas.push({ id: i.id, numero: i.numero, codigo: i.codigo, base: i.base, descricao: i.descricao, custo_unit_depois: p.preco, total_depois: nt });
    }
    return { referencia: ref, total_depois: r2(novo), itens: linhas, sem_preco: sem };
  }
  let exemploEmCurso = null;
  // leituras simultâneas esperam a mesma criação, para nenhuma ver a lista ainda vazia
  function criarExemplo() { return exemploEmCurso || (exemploEmCurso = montarExemplo()); }
  async function montarExemplo() {
    const b = banco(); if (b.exemplo_v2) return; b.exemplo_v2 = true;
    const ref = MESES[0].id;  // exemplo feito no primeiro mês carregado
    const o = { id: novoId(), nome: `Exemplo: reforma de escola em ${nomeMes(MESES[0])} (dados fictícios)`, cliente: 'Exemplo', local: 'Aracaju/SE',
      referencia: ref, bdi: 24.23, observacoes: '', criado_em: agora(), atualizado_em: agora(), etapas: [], itens: [] };
    const plano = [['Serviços preliminares', [['servico', 'ORSE', '00003', 850], ['servico', 'ORSE', '00051', 6]]],
      ['Alvenaria e revestimento', [['servico', 'SINAPI', '103335', 420], ['servico', 'ORSE', '03310', 840], ['servico', 'SINAPI', '87777', 840]]],
      ['Pintura', [['servico', 'ORSE', '02288', 1260]]]];
    for (const [n, [titulo, itens]] of plano.entries()) {
      const e = { id: novoId(), ordem: n + 1, titulo }; o.etapas.push(e);
      for (const [m, [tipo, base, cod, q]] of itens.entries()) {
        const p = await precoNoMes(ref, tipo, base, cod); if (!p || p.preco == null) continue;
        o.itens.push({ id: novoId(), etapa_id: e.id, ordem: m + 1, tipo, base, codigo: p.codigo, descricao: p.descricao, unidade: p.unidade, quantidade: q, custo_unit: p.preco, referencia: ref });
      }
    }
    b.orcamentos.push(o); gravar();
  }

  // ---------- roteador ----------
  // toda resposta com o orçamento inteiro leva a divisão do custo, como no servidor
  async function req(url, metodo = 'GET', corpo = {}) {
    const r = await rotear(url, metodo, corpo);
    if (r && Array.isArray(r.etapas) && r.divisao === undefined) await comDivisao(r);
    return r;
  }
  async function rotear(url, metodo, corpo) {
    await carregar();
    const u = new URL(url, 'http://local'); const p = u.pathname.split('/').filter(Boolean).slice(1); const qs = u.searchParams;
    const M = metodo.toUpperCase();
    const [r0, r1, r2_, r3] = p;
    // versão de teste: só ORSE e SINAPI, que vêm juntas da CEHOP e usam o mesmo mês (o da ORSE)
    const mesPedido = () => { const r = Object.fromEntries((qs.get('refs') || '').split(',').filter((x) => x.includes(':')).map((x) => x.split(':')));
      return mes(r.ORSE || r.SINAPI || qs.get('ref')); };
    const ativas = () => { const l = (qs.get('bases') || '').split(',').filter((b) => BASES.includes(b)); return l.length ? l : BASES; };
    if (r0 === 'proprias') throw erro(501, 'Composições próprias estão disponíveis no site publicado, não nesta versão de teste.');
    if (r0 === 'referencia') {
      const m = mesPedido(); const d = await dados(m.id);
      const meses = MESES.map(({ encargos, ...x }) => x), atual = MESES[MESES.length - 1].id;
      const extra = { bases: Object.fromEntries(BASES.map((b) => [b, { meses, atual }])), refs: Object.fromEntries(BASES.map((b) => [b, m.id])), ativas: ativas() };
      const n = (t, b) => d.itens.filter((x) => x.tipo === t && x.base === b).length;
      return { ...m, referencias: MESES.map(({ encargos, ...x }) => x), atual: MESES[MESES.length - 1].id,
        totais: [['insumo', 'ORSE'], ['insumo', 'SINAPI'], ['servico', 'ORSE'], ['servico', 'SINAPI']].filter(([, b]) => extra.ativas.includes(b)).map(([t, b]) => ({ tipo: t, base: b, n: n(t, b) })), ...extra };
    }
    if (r0 === 'busca') {
      const so = ativas(), base = so.length === 1 ? so[0] : qs.get('base');
      return busca(mesPedido().id, qs.get('q'), base, qs.get('tipo'), Math.min(Number(qs.get('limite') || 60), 500));
    }
    if (r0 === 'composicao') {
      if (!BASES.includes(r1)) throw erro(404, 'Base não encontrada. Use ORSE ou SINAPI.');
      const m = mes(qs.get('ref'));
      const c = await composicao(m.id, r1, r2_); if (!c) throw erro(404, `A composição ${r2_}/${r1} não existe em ${nomeMes(m)}.`); return c;
    }
    if (r0 === 'insumo') return insumo(mes(qs.get('ref')).id, r1, r2_, Number(qs.get('limite') || 100));
    if (r0 === 'encargos') {
      const m = mes(qs.get('ref'));
      return { referencia: m, horista: { total: m.encargo_social_horista, linhas: m.encargos.horista }, mensalista: { total: m.encargo_social_mensalista, linhas: m.encargos.mensalista } };
    }
    if (r0 === 'comparativo' && r1 === 'item') return comparativoItem(r2_, r3, p[4]);
    if (r0 === 'comparativo') return comparativo(qs);
    if (r0 === 'orcamentos') {
      await criarExemplo();
      const b = banco();
      if (!r1 && M === 'GET') return Promise.all(b.orcamentos.slice().sort((x, y) => y.atualizado_em.localeCompare(x.atualizado_em)).map((o) => comDivisao(calcular(o))));
      if (!r1 && M === 'POST') {
        if (!String(corpo.nome || '').trim()) throw erro(422, 'Dê um nome ao orçamento.');
        const o = { id: novoId(), nome: corpo.nome.trim(), cliente: (corpo.cliente || '').trim(), local: (corpo.local || '').trim(), referencia: mes(corpo.referencia).id,
          bdi: Number(corpo.bdi ?? 25), observacoes: '', criado_em: agora(), atualizado_em: agora(), etapas: [], itens: [] };
        o.etapas.push({ id: novoId(), ordem: 1, titulo: 'Serviços preliminares' }); b.orcamentos.push(o); return tocar(o);
      }
      const o = achar(r1);
      if (!r2_ && M === 'GET') return comDivisao(calcular(o));
      if (!r2_ && M === 'PATCH') { for (const k of ['nome', 'cliente', 'local', 'bdi', 'observacoes']) if (corpo[k] != null) o[k] = k === 'bdi' ? Number(corpo[k]) : corpo[k]; return tocar(o); }
      if (!r2_ && M === 'DELETE') { b.orcamentos = b.orcamentos.filter((x) => x !== o); gravar(); return { desfazer: { tipo: 'orcamento', orcamento: o } }; }
      if (r2_ === 'duplicar') {
        const mapa = new Map(); const n = { ...JSON.parse(JSON.stringify(o)), id: novoId(), nome: o.nome + ' (cópia)', criado_em: agora() };
        n.etapas.forEach((e) => { const id = novoId(); mapa.set(e.id, id); e.id = id; });
        n.itens.forEach((i) => { i.id = novoId(); i.etapa_id = mapa.get(i.etapa_id); });
        b.orcamentos.push(n); return tocar(n);
      }
      if (r2_ === 'etapas') { o.etapas.push({ id: novoId(), ordem: Math.max(0, ...o.etapas.map((e) => e.ordem)) + 1, titulo: corpo.titulo.trim() }); return tocar(o); }
      if (r2_ === 'itens') {
        const m = mes(o.referencia);
        const pr = await precoNoMes(m.id, corpo.tipo, corpo.base, corpo.codigo);
        if (!pr) throw erro(404, `${corpo.codigo}/${corpo.base} não existe em ${nomeMes(m)}, a data-base deste orçamento.`);
        if (pr.preco == null) throw erro(422, `${corpo.codigo}/${corpo.base} não tem preço em ${nomeMes(m)} e não pode entrar no orçamento.`);
        let eid = corpo.etapa_id;
        if (!eid) { const ult = ordenar([...o.etapas]).pop(); if (ult) eid = ult.id; else { eid = novoId(); o.etapas.push({ id: eid, ordem: 1, titulo: 'Serviços' }); } }
        if (!o.etapas.some((e) => e.id === Number(eid))) throw erro(404, 'Etapa não encontrada neste orçamento.');
        const id = novoId();
        o.itens.push({ id, etapa_id: Number(eid), ordem: Math.max(0, ...o.itens.filter((i) => i.etapa_id === Number(eid)).map((i) => i.ordem)) + 1,
          tipo: corpo.tipo, base: corpo.base, codigo: pr.codigo, descricao: pr.descricao, unidade: pr.unidade, quantidade: Number(corpo.quantidade ?? 1), custo_unit: pr.preco, referencia: m.id });
        return { ...tocar(o), item_criado: id };
      }
      if (r2_ === 'atualizacao') return simular(o, mes(qs.get('referencia')).id);
      if (r2_ === 'atualizar') {
        const ref = mes(qs.get('referencia')).id, sim = await simular(o, ref);
        for (const l of sim.itens) { const i = o.itens.find((x) => x.id === l.id); i.custo_unit = l.custo_unit_depois; i.referencia = ref; }
        o.referencia = ref;
        return { ...tocar(o), atualizacao: { referencia: ref, itens_atualizados: sim.itens.length, sem_preco: sim.sem_preco } };
      }
      if (r2_ === 'abc') return abc(calcular(o), qs.get('tipo') === 'insumos' ? 'insumos' : 'servicos');
    }
    if (r0 === 'etapas') {
      const [o, e] = donoEtapa(r1);
      if (r2_ === 'mover') { mover(o.etapas, e.id, qs.get('direcao')); return tocar(o); }
      if (M === 'PATCH') { e.titulo = corpo.titulo.trim(); return tocar(o); }
      if (r2_ === 'posicionar') {
        const resto = ordenar(o.etapas.filter((x) => x !== e)); resto.splice(Math.min(Number(qs.get('posicao')), resto.length), 0, e);
        resto.forEach((x, n) => { x.ordem = n + 1; }); return tocar(o);
      }
      if (M === 'DELETE') {
        const itens = o.itens.filter((i) => i.etapa_id === e.id);
        o.etapas = o.etapas.filter((x) => x !== e); o.itens = o.itens.filter((i) => i.etapa_id !== e.id);
        return { ...tocar(o), desfazer: { tipo: 'etapa', orcamento_id: o.id, etapas: [e], itens } };
      }
    }
    if (r0 === 'itens') {
      const [o, i] = donoItem(r1);
      if (r2_ === 'mover') { mover(o.itens.filter((x) => x.etapa_id === i.etapa_id), i.id, qs.get('direcao')); return tocar(o); }
      if (M === 'PATCH') { if (corpo.quantidade != null) i.quantidade = Number(corpo.quantidade); return tocar(o); }
      if (r2_ === 'posicionar') {
        const eid = Number(qs.get('etapa_id')), origem = i.etapa_id;
        if (!o.etapas.some((e) => e.id === eid)) throw erro(404, 'Etapa não encontrada neste orçamento.');
        const destino = ordenar(o.itens.filter((x) => x.etapa_id === eid && x !== i)); destino.splice(Math.min(Number(qs.get('posicao')), destino.length), 0, i);
        i.etapa_id = eid; destino.forEach((x, n) => { x.ordem = n + 1; });
        if (origem !== eid) ordenar(o.itens.filter((x) => x.etapa_id === origem)).forEach((x, n) => { x.ordem = n + 1; });
        return tocar(o);
      }
      if (M === 'DELETE') { o.itens = o.itens.filter((x) => x !== i); return { ...tocar(o), desfazer: { tipo: 'item', orcamento_id: o.id, itens: [i] } }; }
    }
    if (r0 === 'restaurar') {
      // devolve o que a última exclusão tirou
      const b = banco();
      if (corpo.tipo === 'orcamento') {
        const o = corpo.orcamento; if (b.orcamentos.some((x) => x.id === o.id)) o.id = novoId();
        b.orcamentos.push(o); return comDivisao(tocar(o));
      }
      const o = achar(corpo.orcamento_id);
      for (const e of corpo.etapas || []) o.etapas.push(e);
      for (const i of corpo.itens || []) { if (!o.etapas.some((e) => e.id === i.etapa_id)) throw erro(404, 'A etapa deste item não existe mais.'); o.itens.push(i); }
      return comDivisao(tocar(o));
    }
    throw erro(404, 'Rota não encontrada.');
  }

  return { req, carregar };
})();
