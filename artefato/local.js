'use strict';
/* Camada local do artefato: responde às mesmas rotas da API do servidor, usando os arquivos em dados/.
   Os orçamentos ficam no armazenamento deste navegador (versão de teste). */

const LOCAL = (() => {
  const BASES = ['ORSE', 'SINAPI'];
  const SECOES = ['MAO_DE_OBRA', 'MATERIAL', 'EQUIPAMENTO', 'SERVICO_TERCEIRO', 'SERVICO_AUXILIAR'];
  const CHAVE = 'infocustos-orcamentos-v1';
  let REF = null, REFS = [], NS = 24, ITENS = [], POR_CHAVE = new Map(), COMP_EXISTE = new Set();
  const cacheComp = new Map(), cacheUsos = new Map();
  let pronto = null;

  const semAcento = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const palavrasDe = (t) => semAcento(t).match(/[a-z0-9]+/g) || [];
  const shard = (base, cod) => { let s = 0; for (const ch of base + '|' + cod) s += ch.charCodeAt(0); return s % NS; };
  const semZero = (c) => String(c).replace(/^0+/, '');
  const r2 = (v) => Math.round(Number((v * 100).toPrecision(12))) / 100;  // meio para cima, como o ARRED do Excel

  function carregar() {
    if (pronto) return pronto;
    pronto = fetch('dados/itens.json').then((r) => { if (!r.ok) throw new Error('Não foi possível carregar a base de preços.'); return r.json(); }).then((j) => {
      REF = j.ref; REFS = j.referencias || [j.ref]; NS = j.n_shards;
      ITENS = j.itens.map((a, id) => {
        const it = { id, tipo: a[0] === 0 ? 'servico' : 'insumo', base: BASES[a[1]], codigo: a[2], descricao: a[3], unidade: a[4], preco: a[5],
          grupo: a[6], subgrupo: a[7], categoria: a[8], usos: a[9], tem_composicao: a[10], marcador: a[11], preco_anterior: a[12], novo: a[13] };
        it._p = palavrasDe(it.descricao); it._z = semZero(it.codigo);
        return it;
      });
      for (const it of ITENS) {
        POR_CHAVE.set(`${it.tipo}|${it.base}|${it.codigo}`, it);
        if (it.tem_composicao) COMP_EXISTE.add(`${it.base}|${it.codigo}`);
      }
    });
    return pronto;
  }

  async function arquivo(prefixo, n, cache) {
    if (!cache.has(n)) cache.set(n, fetch(`dados/${prefixo}_${String(n).padStart(2, '0')}.json`).then((r) => r.json()));
    return cache.get(n);
  }
  const item = (tipo, base, cod) => POR_CHAVE.get(`${tipo}|${base}|${cod}`) ||
    ITENS.find((x) => x.tipo === tipo && x.base === base && x._z === semZero(cod));

  async function composicao(base, codigo) {
    let cod = codigo;
    if (!COMP_EXISTE.has(`${base}|${cod}`)) {
      const s = item('servico', base, codigo); if (s && COMP_EXISTE.has(`${base}|${s.codigo}`)) cod = s.codigo; else return null;
    }
    const sh = await arquivo('comp', shard(base, cod), cacheComp);
    const a = sh[`${base}|${cod}`]; if (!a) return null;
    const srv = item('servico', base, cod) || {};
    return {
      base, codigo: cod, referencia: REF.id, modelo: a[0], unidade: a[1] || srv.unidade, prod_equipe: a[2], encargo_social: a[3],
      custo_equipamento: a[4], custo_mao_de_obra: a[5], custo_encargo_social: a[6], custo_material: a[7], custo_servico_terceiro: a[8],
      custo_total: a[9], usada_em: a[10], historico: historicoDe(srv), referencia_atual: true, descricao: srv.descricao, grupo: srv.grupo, subgrupo: srv.subgrupo, categoria: srv.categoria,
      itens: a[11].map((x) => {
        const b = BASES[x[1]], eh = x[3];
        const ref = item(eh ? 'servico' : 'insumo', b, x[2]);
        return { secao: SECOES[x[0]], base: b, codigo: x[2], eh_servico: eh, unidade: x[4], qtd: x[5], custo_unit: x[6], custo_total: x[7],
          custo_prod: x[8], descricao: x[9] || (ref && ref.descricao) || '', tem_composicao: !!eh && COMP_EXISTE.has(`${b}|${x[2]}`) };
      }),
    };
  }

  function historicoDe(it) {
    if (REFS.length < 2) return [];
    const ant = REFS[REFS.length - 2];
    const pa = it.novo ? null : it.preco_anterior;
    return [{ referencia: ant.id, descricao: ant.descricao, preco: pa, variacao: null },
      { referencia: REF.id, descricao: REF.descricao, preco: it.preco, variacao: pa && it.preco != null ? it.preco / pa - 1 : null }];
  }

  function variacao(base, tipo, sentido, limite) {
    let l = ITENS.filter((x) => x.tipo === (tipo === 'insumo' ? 'insumo' : 'servico'));
    if (base === 'ORSE' || base === 'SINAPI') l = l.filter((x) => x.base === base);
    const novos = l.filter((x) => x.novo).length;
    const comp = l.filter((x) => x.preco_anterior > 0 && x.preco != null);
    const res = { comparados: comp.length, subiram: comp.filter((x) => x.preco > x.preco_anterior + 0.005).length,
      desceram: comp.filter((x) => x.preco < x.preco_anterior - 0.005).length, iguais: comp.filter((x) => Math.abs(x.preco - x.preco_anterior) <= 0.005).length, novos };
    const ord = comp.map((x) => ({ ...publico(x, null), variacao: x.preco / x.preco_anterior - 1 }))
      .sort((a, b) => (sentido === 'baixa' ? a.variacao - b.variacao : b.variacao - a.variacao));
    return { de: REFS.length > 1 ? REFS[REFS.length - 2] : null, para: REF, resumo: res, itens: ord.slice(0, limite) };
  }

  // ---------- busca ----------
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
    s += pos / 40 + p.length / 200;
    return s;
  }
  function destacar(desc, termos) {
    return desc.replace(/[\p{L}\p{N}]+/gu, (w) => (termos.some((t) => semAcento(w).startsWith(t)) ? `\u0001${w}\u0002` : w));
  }
  function busca(q, base, tipo, limite) {
    q = (q || '').trim();
    let lista = ITENS;
    if (base === 'ORSE' || base === 'SINAPI') lista = lista.filter((x) => x.base === base);
    if (tipo === 'servico' || tipo === 'insumo') lista = lista.filter((x) => x.tipo === tipo);
    let res;
    if (/^\d{1,7}$/.test(q)) {
      const z = semZero(q);
      res = lista.filter((x) => x._z === z || x.codigo.startsWith(q)).sort((a, b) => (b._z === z) - (a._z === z) || (a.tipo === 'servico' ? -1 : 1) || a.codigo.localeCompare(b.codigo));
      return { total: res.length, itens: res.slice(0, limite).map((x) => publico(x, null)) };
    }
    const termos = palavrasDe(q);
    if (!termos.length) {
      res = [...lista].sort((a, b) => b.usos - a.usos);
      return { total: lista.length, itens: res.slice(0, limite).map((x) => publico(x, null)) };
    }
    const pont = [];
    for (const it of lista) { const s = pontuar(it, termos); if (s !== null) pont.push([s, it]); }
    pont.sort((a, b) => a[0] - b[0]);
    return { total: pont.length, itens: pont.slice(0, limite).map(([, it]) => publico(it, destacar(it.descricao, termos))) };
  }
  const publico = (x, trecho) => ({ tipo: x.tipo, base: x.base, codigo: x.codigo, descricao: x.descricao, unidade: x.unidade, preco: x.preco,
    grupo: x.grupo, subgrupo: x.subgrupo, categoria: x.categoria, usos: x.usos, tem_composicao: x.tem_composicao, marcador: x.marcador,
    preco_anterior: x.preco_anterior, novo: x.novo, trecho });

  async function insumo(base, codigo, limite) {
    const it = item('insumo', base, codigo);
    if (!it) throw erro(404, `O insumo ${codigo}/${base} não existe nesta referência.`);
    const sh = await arquivo('usos', shard(base, it.codigo), cacheUsos);
    const u = sh[`${base}|${it.codigo}`] || [0, []];
    return { base, codigo: it.codigo, referencia: REF.id, descricao: it.descricao, unidade: it.unidade, preco: it.preco, marcador: it.marcador,
      tipo: it.categoria, grupo: it.grupo, subgrupo: it.subgrupo, usado_em: u[0], historico: historicoDe(it), referencia_atual: true,
      usos: u[1].slice(0, limite).map((x) => { const s = item('servico', BASES[x[0]], x[1]) || {};
        return { base: BASES[x[0]], codigo: x[1], descricao: s.descricao, unidade: s.unidade, qtd: x[2], custo_total: x[3], preco_composicao: x[4] }; }) };
  }

  // ---------- orçamentos (neste navegador) ----------
  let BANCO = null;
  function banco() {
    if (BANCO) return BANCO;
    try { BANCO = JSON.parse(localStorage.getItem(CHAVE) || 'null'); } catch (_) { BANCO = null; }
    if (!BANCO || !Array.isArray(BANCO.orcamentos)) BANCO = { seq: 1, orcamentos: [], exemplo_criado: false };
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
    const refsItens = [...new Set(o.itens.map((i) => i.referencia).filter(Boolean))].sort();
    const nome = (id) => (REFS.find((r) => r.id === id) || { descricao: id }).descricao;
    return { ...cab, etapas, custo_total: custo, total, valor_bdi: r2(total - custo), qtd_itens: o.itens.length,
      referencias_itens: refsItens, referencia_atual: { id: REF.id, descricao: REF.descricao }, referencia_descricao: nome(o.referencia),
      desatualizado: refsItens.some((r) => r < REF.id) || (!o.itens.length && o.referencia < REF.id) };
  }
  function tocar(o) { o.atualizado_em = agora(); gravar(); return calcular(o); }

  function mover(lista, id, direcao) {
    ordenar(lista); const k = lista.findIndex((x) => x.id === Number(id)); const j = direcao === 'cima' ? k - 1 : k + 1;
    if (j >= 0 && j < lista.length) [lista[k], lista[j]] = [lista[j], lista[k]];
    lista.forEach((x, n) => { x.ordem = n + 1; });
  }

  async function precoNaBase(tipo, base, codigo) {
    const it = item(tipo, base, codigo); if (!it) return null;
    let preco = it.preco;
    if (tipo === 'servico') { const c = await composicao(base, it.codigo); if (c) preco = c.custo_total; }
    return { codigo: it.codigo, descricao: it.descricao, unidade: it.unidade, preco, referencia: REF.id };
  }

  async function explodir(base, codigo, fator, acc, prof = 0) {
    const c = await composicao(base, codigo); if (!c || prof > 6) return false;
    for (const i of c.itens) {
      let q = i.qtd || 0, cu;
      if (c.modelo === 'DNIT' && (i.secao === 'EQUIPAMENTO' || i.secao === 'MAO_DE_OBRA') && c.prod_equipe) {
        q /= c.prod_equipe; cu = i.qtd ? i.custo_total / i.qtd : (i.custo_prod || 0);
      } else cu = i.custo_unit != null ? i.custo_unit : (i.qtd ? i.custo_total / i.qtd : 0);
      if (i.eh_servico && await explodir(i.base, i.codigo, fator * q, acc, prof + 1)) continue;
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
      if (i.tipo === 'servico' && await explodir(i.base, i.codigo, i.quantidade, acc)) continue;
      const k = `${i.base}|${i.codigo}`;
      const a = acc.get(k) || { base: i.base, codigo: i.codigo, descricao: i.descricao, unidade: i.unidade, secao: 'DIRETO', quantidade: 0, custo_total: 0 };
      a.quantidade += i.quantidade; a.custo_total += i.quantidade * i.custo_unit; acc.set(k, a);
    }
    const l = classificar([...acc.values()].filter((x) => x.custo_total > 0).map((x) => ({ ...x, custo_unit: x.quantidade ? x.custo_total / x.quantidade : 0 })), 'custo_total');
    return { tipo, total: r2(l.reduce((s, x) => s + x.custo_total, 0)), custo_direto: o.custo_total, linhas: l, resumo: resumo(l, 'custo_total') };
  }

  // serviço do exemplo que saiu da SINAPI em agosto/2026 (preço e descrição de maio/2026)
  const FORA_DA_BASE = { 'SINAPI|103335': { descricao: 'Alvenaria de vedação de blocos cerâmicos furados na horizontal de 14x9x19 cm (espessura 14 cm, bloco deitado) e argamassa de assentamento com preparo manual. af_12/2021', unidade: 'm2', preco: 139.37 } };

  async function simular(o) {
    const c = calcular(o), f = 1 + o.bdi / 100, linhas = [], sem = []; let novo = 0;
    for (const e of c.etapas) for (const i of e.itens) {
      const p = await precoNaBase(i.tipo, i.base, i.codigo);
      if (!p || p.preco == null) { sem.push({ id: i.id, numero: i.numero, codigo: i.codigo, base: i.base, descricao: i.descricao, motivo: !p ? 'saiu da base' : 'sem preço na nova referência' }); novo += i.total; continue; }
      const nt = r2(i.quantidade * r2(p.preco * f)); novo += nt;
      linhas.push({ id: i.id, numero: i.numero, codigo: i.codigo, base: i.base, descricao: i.descricao, unidade: i.unidade, quantidade: i.quantidade,
        de_referencia: i.referencia, custo_unit_antes: i.custo_unit, custo_unit_depois: p.preco, total_antes: i.total, total_depois: nt,
        variacao: i.custo_unit ? p.preco / i.custo_unit - 1 : null });
    }
    linhas.sort((a, b) => Math.abs(b.total_depois - b.total_antes) - Math.abs(a.total_depois - a.total_antes));
    return { referencia: REF.id, total_antes: c.total, total_depois: r2(novo), variacao: c.total ? novo / c.total - 1 : null, itens: linhas, sem_preco: sem };
  }

  async function criarExemplo() {
    const b = banco(); if (b.exemplo_criado) return; b.exemplo_criado = true;
    const ant = REFS.length > 1 ? REFS[REFS.length - 2].id : REF.id;
    const o = { id: novoId(), nome: 'Exemplo: reforma de escola feita em maio (dados fictícios)', cliente: 'Exemplo', local: 'Aracaju/SE', referencia: ant, bdi: 24.23,
      observacoes: '', criado_em: agora(), atualizado_em: agora(), etapas: [], itens: [] };
    const plano = [['Serviços preliminares', [['servico', 'ORSE', '00003', 850], ['servico', 'ORSE', '00051', 6]]],
      ['Alvenaria e revestimento', [['servico', 'SINAPI', '103335', 420], ['servico', 'ORSE', '03310', 840], ['servico', 'SINAPI', '87777', 840]]],
      ['Pintura', [['servico', 'ORSE', '02288', 1260]]]];
    for (const [n, [titulo, itens]] of plano.entries()) {
      const e = { id: novoId(), ordem: n + 1, titulo }; o.etapas.push(e);
      for (const [m, [tipo, base, cod, q]] of itens.entries()) {
        const it = item(tipo, base, cod);
        // orçamento de exemplo com os preços da referência anterior, para mostrar a atualização
        const antigo = FORA_DA_BASE[`${base}|${cod}`] || (it && it.preco_anterior != null ? { descricao: it.descricao, unidade: it.unidade, preco: it.preco_anterior } : null);
        if (!antigo) continue;
        o.itens.push({ id: novoId(), etapa_id: e.id, ordem: m + 1, tipo, base, codigo: cod, descricao: antigo.descricao, unidade: antigo.unidade, quantidade: q, custo_unit: antigo.preco, referencia: ant });
      }
    }
    b.orcamentos.push(o); gravar();
  }

  function erro(status, msg) { const e = new Error(msg); e.status = status; return e; }

  // ---------- roteador ----------
  async function req(url, metodo = 'GET', corpo = {}) {
    await carregar();
    const u = new URL(url, 'http://local'); const p = u.pathname.split('/').filter(Boolean).slice(1); const qs = u.searchParams;
    const M = metodo.toUpperCase();
    const [r0, r1, r2_] = p;
    if (r0 === 'referencia') {
      const n = (t, b) => ITENS.filter((x) => x.tipo === t && x.base === b).length;
      return { ...REF, referencias: REFS, totais: [['insumo', 'ORSE'], ['insumo', 'SINAPI'], ['servico', 'ORSE'], ['servico', 'SINAPI']].map(([t, b]) => ({ tipo: t, base: b, n: n(t, b) })) };
    }
    if (r0 === 'variacao') return variacao(qs.get('base'), qs.get('tipo'), qs.get('sentido'), Math.min(Number(qs.get('limite') || 100), 1000));
    if (r0 === 'busca') return busca(qs.get('q'), qs.get('base'), qs.get('tipo'), Math.min(Number(qs.get('limite') || 60), 500));
    if (r0 === 'composicao') {
      if (!BASES.includes(r1)) throw erro(404, 'Base não encontrada. Use ORSE ou SINAPI.');
      const c = await composicao(r1, r2_); if (!c) throw erro(404, `A composição ${r2_}/${r1} não existe nesta referência.`); return c;
    }
    if (r0 === 'insumo') return insumo(r1, r2_, Number(qs.get('limite') || 100));
    if (r0 === 'orcamentos') {
      await criarExemplo();
      const b = banco();
      if (!r1 && M === 'GET') return b.orcamentos.slice().sort((x, y) => y.atualizado_em.localeCompare(x.atualizado_em)).map((o) => calcular(o));
      if (!r1 && M === 'POST') {
        if (!String(corpo.nome || '').trim()) throw erro(422, 'Dê um nome ao orçamento.');
        const o = { id: novoId(), nome: corpo.nome.trim(), cliente: (corpo.cliente || '').trim(), local: (corpo.local || '').trim(), referencia: REF.id,
          bdi: Number(corpo.bdi ?? 25), observacoes: '', criado_em: agora(), atualizado_em: agora(), etapas: [], itens: [] };
        o.etapas.push({ id: novoId(), ordem: 1, titulo: 'Serviços preliminares' }); b.orcamentos.push(o); return tocar(o);
      }
      const o = achar(r1);
      if (!r2_ && M === 'GET') return calcular(o);
      if (!r2_ && M === 'PATCH') { for (const k of ['nome', 'cliente', 'local', 'bdi', 'observacoes']) if (corpo[k] != null) o[k] = k === 'bdi' ? Number(corpo[k]) : corpo[k]; return tocar(o); }
      if (!r2_ && M === 'DELETE') { b.orcamentos = b.orcamentos.filter((x) => x !== o); gravar(); return null; }
      if (r2_ === 'duplicar') {
        const mapa = new Map(); const n = { ...JSON.parse(JSON.stringify(o)), id: novoId(), nome: o.nome + ' (cópia)', criado_em: agora() };
        n.etapas.forEach((e) => { const id = novoId(); mapa.set(e.id, id); e.id = id; });
        n.itens.forEach((i) => { i.id = novoId(); i.etapa_id = mapa.get(i.etapa_id); });
        b.orcamentos.push(n); return tocar(n);
      }
      if (r2_ === 'etapas') { o.etapas.push({ id: novoId(), ordem: Math.max(0, ...o.etapas.map((e) => e.ordem)) + 1, titulo: corpo.titulo.trim() }); return tocar(o); }
      if (r2_ === 'itens') {
        const pr = await precoNaBase(corpo.tipo, corpo.base, corpo.codigo);
        if (!pr) throw erro(404, `${corpo.codigo}/${corpo.base} não existe na base de preços.`);
        if (pr.preco == null) throw erro(422, `${corpo.codigo}/${corpo.base} não tem preço nesta referência e não pode entrar no orçamento.`);
        let eid = corpo.etapa_id;
        if (!eid) { const ult = ordenar([...o.etapas]).pop(); if (ult) eid = ult.id; else { eid = novoId(); o.etapas.push({ id: eid, ordem: 1, titulo: 'Serviços' }); } }
        if (!o.etapas.some((e) => e.id === Number(eid))) throw erro(404, 'Etapa não encontrada neste orçamento.');
        const id = novoId();
        o.itens.push({ id, etapa_id: Number(eid), ordem: Math.max(0, ...o.itens.filter((i) => i.etapa_id === Number(eid)).map((i) => i.ordem)) + 1,
          tipo: corpo.tipo, base: corpo.base, codigo: pr.codigo, descricao: pr.descricao, unidade: pr.unidade, quantidade: Number(corpo.quantidade ?? 1), custo_unit: pr.preco, referencia: pr.referencia });
        return { ...tocar(o), item_criado: id };
      }
      if (r2_ === 'atualizacao') return simular(o);
      if (r2_ === 'atualizar') {
        const sim = await simular(o);
        for (const l of sim.itens) { const i = o.itens.find((x) => x.id === l.id); i.custo_unit = l.custo_unit_depois; i.referencia = REF.id; }
        o.referencia = REF.id;
        return { ...tocar(o), atualizacao: { referencia: REF.id, total_antes: sim.total_antes, itens_atualizados: sim.itens.length, sem_preco: sim.sem_preco } };
      }
      if (r2_ === 'abc') return abc(calcular(o), qs.get('tipo') === 'insumos' ? 'insumos' : 'servicos');
    }
    if (r0 === 'etapas') {
      const [o, e] = donoEtapa(r1);
      if (r2_ === 'mover') { mover(o.etapas, e.id, qs.get('direcao')); return tocar(o); }
      if (M === 'PATCH') { e.titulo = corpo.titulo.trim(); return tocar(o); }
      if (M === 'DELETE') { o.etapas = o.etapas.filter((x) => x !== e); o.itens = o.itens.filter((i) => i.etapa_id !== e.id); return tocar(o); }
    }
    if (r0 === 'itens') {
      const [o, i] = donoItem(r1);
      if (r2_ === 'mover') { mover(o.itens.filter((x) => x.etapa_id === i.etapa_id), i.id, qs.get('direcao')); return tocar(o); }
      if (M === 'PATCH') { if (corpo.quantidade != null) i.quantidade = Number(corpo.quantidade); return tocar(o); }
      if (M === 'DELETE') { o.itens = o.itens.filter((x) => x !== i); return tocar(o); }
    }
    throw erro(404, 'Rota não encontrada.');
  }

  return { req, carregar, salvoNoNavegador: () => { try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; } catch (_) { return false; } } };
})();
