// Bases de encargos sociais da empresa: quadros de horistas e mensalistas editáveis item a item.
// A aba Encargos sociais mostra o modelo da CEHOP e as bases da empresa (#/encargos/<id>).

let BASES_ENC = null;  // lista das bases (para o seletor da aba e o da composição própria)
async function basesEncargos(recarregar) {
  if (!BASES_ENC || recarregar) { try { BASES_ENC = await req('/api/bases-encargos'); } catch (e) { BASES_ENC = BASES_ENC || []; } }
  return BASES_ENC;
}

function barraBasesEnc(bases, atual) {
  return `<nav class="enc-bases" aria-label="Bases de encargos">
    <a class="enc-base-op${atual == null ? ' ativa' : ''}" href="#/encargos"${atual == null ? ' aria-current="page"' : ''}><span class="selo-mini">CEHOP</span>Modelo da ORSE</a>
    ${bases.map((b) => `<a class="enc-base-op propria${atual === b.id ? ' ativa' : ''}" href="#/encargos/${b.id}"${atual === b.id ? ' aria-current="page"' : ''}>${esc(b.nome)}<span class="enc-base-tot">${num2.format(b.total_horista)}%</span></a>`).join('')}
    <details class="menu enc-nova"><summary class="botao">+ Nova base de encargos</summary>
      <div class="menu-lista" role="menu">
        <button type="button" role="menuitem" data-enc-nova="cehop">A partir do modelo da CEHOP</button>
        ${atual != null ? `<button type="button" role="menuitem" data-enc-nova="${atual}">Cópia desta base</button>` : ''}
        <button type="button" role="menuitem" data-enc-nova="vazio">Em branco (grupos A a D)</button>
      </div></details>
  </nav>`;
}

function ligarBarraEnc() {
  document.querySelectorAll('[data-enc-nova]').forEach((b) => b.addEventListener('click', async () => {
    const modelo = b.dataset.encNova;
    const nome = prompt('Nome da nova base de encargos:', modelo === 'cehop' ? 'Encargos da empresa' : modelo === 'vazio' ? 'Nova base de encargos' : 'Cópia');
    if (!nome || !nome.trim()) return;
    try { const n = await req('/api/bases-encargos', 'POST', { nome: nome.trim(), modelo }); await basesEncargos(true); location.hash = `#/encargos/${n.id}`; avisar(`${VISTO}Base de encargos criada. Edite os itens à vontade.`); }
    catch (e) { avisar(esc(e.message)); }
  }));
}

const ENC_TIPOS = [['horista', 'Horistas', 'Quem recebe por hora trabalhada'], ['mensalista', 'Mensalistas', 'Quem recebe salário mensal']];

async function desenharBaseEncargos(id, dados) {
  const d = $('#detalhe');
  let b;
  const semEsq = dados || d.querySelector('.encargos') ? () => {} : comEsqueleto(d, `<div class="pagina"><section class="ficha">${esqueletoTabela(12)}</section></div>`);
  try { b = dados || await req(`/api/bases-encargos/${id}`); } catch (e) { semEsq(); d.innerHTML = `<div class="pagina"><div class="erro"><b>Não foi possível abrir a base de encargos.</b><br>${esc(e.message)}</div></div>`; return; }
  semEsq();
  const bases = await basesEncargos(!dados);
  if (!new RegExp(`^#/encargos/${id}\\b`).test(location.hash)) return;
  const foco = document.activeElement && document.activeElement.dataset ? { k: document.activeElement.dataset.encK, c: document.activeElement.dataset.encC } : {};
  const quadro = ([tipo, titulo, nota]) => {
    const q = b[tipo], grupos = [...new Set(q.linhas.map((l) => l.grupo))];
    const linhas = q.linhas.map((l, k) => l.item === l.grupo
      ? `<tr class="enc-grupo" data-enc-linha="${k}"><td class="cod">${esc(l.grupo)}</td>
          <td><input class="enc-in" data-enc-k="${tipo}:${k}" data-enc-c="descricao" value="${esc(l.descricao)}" maxlength="300" aria-label="Nome do grupo ${esc(l.grupo)}"></td>
          <td class="num"><b>${num2.format(l.valor)}%</b></td>
          <td class="ctrl"><button type="button" class="mini" data-enc-mais="${tipo}:${esc(l.grupo)}" aria-label="Novo item no grupo ${esc(l.grupo)}" title="Novo item no grupo">+</button>
            <button type="button" class="mini" data-enc-tirar="${tipo}:${k}" aria-label="Tirar o grupo ${esc(l.grupo)} e os itens dele">✕</button></td></tr>`
      : `<tr data-enc-linha="${k}"><td class="cod"><input class="enc-in enc-cod" data-enc-k="${tipo}:${k}" data-enc-c="item" value="${esc(l.item)}" maxlength="20" aria-label="Código do item"></td>
          <td><input class="enc-in" data-enc-k="${tipo}:${k}" data-enc-c="descricao" value="${esc(l.descricao)}" maxlength="300" placeholder="Descrição" aria-label="Descrição do item ${esc(l.item)}"></td>
          <td class="num"><input class="enc-in qtd" inputmode="decimal" data-enc-k="${tipo}:${k}" data-enc-c="valor" value="${num2.format(l.valor)}" aria-label="Percentual do item ${esc(l.item)}"></td>
          <td class="ctrl"><button type="button" class="mini" data-enc-tirar="${tipo}:${k}" aria-label="Tirar o item ${esc(l.item)}">✕</button></td></tr>`).join('');
    return `<section class="ficha enc enc-editavel" data-enc-tipo="${tipo}">
      <header class="enc-cab"><div><h2>${titulo}</h2><p class="sub">${nota}</p></div><span class="enc-total">${num2.format(q.total)}%</span></header>
      <div class="tabela-rola"><table class="planilha"><thead><tr><th>Item</th><th>Descrição</th><th class="num">Valor (%)</th><th class="ctrl" aria-label="Ações"></th></tr></thead>
        <tbody>${linhas}</tbody>
        <tfoot><tr><td></td><td><b>Total do encargo social</b></td><td class="num"><b>${num2.format(q.total)}%</b></td><td></td></tr></tfoot></table></div>
      <button type="button" class="link-acao" data-enc-grupo="${tipo}">+ Grupo${grupos.length ? ` ${String.fromCharCode(Math.max(...grupos.map((g) => g.charCodeAt(0))) + 1)}` : ''}</button>
    </section>`;
  };
  d.innerHTML = `<div class="pagina encargos">
    <header class="pag-cab"><div><h1>Encargos sociais</h1>
      <p class="sub">Base da empresa: edite os itens e os totais são refeitos. As composições próprias que usam esta base acompanham.</p></div></header>
    ${barraBasesEnc(bases, b.id)}
    <div class="enc-base-cab">
      <label class="enc-nome">Nome da base<input id="enc-nome" value="${esc(b.nome)}" maxlength="120"></label>
      <p class="sub">${esc(b.origem)}${b.usada_em.length ? ` · usada em ${b.usada_em.length} ${b.usada_em.length === 1 ? 'composição própria' : 'composições próprias'}: ${b.usada_em.map((c) => `<a href="#/propria/${esc(c)}">${esc(c)}</a>`).join(', ')}` : ' · ainda não usada em composições'}</p>
      <button type="button" class="botao perigo" id="enc-excluir"${b.usada_em.length ? ' disabled title="Troque os encargos das composições que a usam antes de excluir"' : ''}>Excluir base</button>
    </div>
    <div class="enc-grade">${ENC_TIPOS.map(quadro).join('')}</div>
    <p class="fonte">Na composição própria, escolha “Encargos: Da empresa” e esta base no campo de encargo social. O percentual incide sobre a mão de obra sem os encargos das bases.</p>
  </div>`;
  ligarBarraEnc();
  if (foco.k) { const el = d.querySelector(`[data-enc-k="${foco.k}"][data-enc-c="${foco.c}"]`); if (el) el.focus(); }
  const gravar = async (dadosPatch, msg) => {
    try { const n = await req(`/api/bases-encargos/${b.id}`, 'PATCH', dadosPatch); await basesEncargos(true); await desenharBaseEncargos(b.id, n); avisar(msg || 'Salvo.'); }
    catch (e) { avisar(esc(e.message)); desenharBaseEncargos(b.id); }
  };
  const linhasDe = (tipo) => b[tipo].linhas.map((l) => ({ grupo: l.grupo, item: l.item, descricao: l.descricao, valor: l.item === l.grupo ? 0 : l.valor }));
  $('#enc-nome').addEventListener('change', (e) => { const v = e.target.value.trim(); if (!v) { e.target.value = b.nome; return; } gravar({ nome: v }); });
  d.querySelectorAll('[data-enc-k]').forEach((el) => {
    el.addEventListener('change', () => {
      const [tipo, k] = el.dataset.encK.split(':'), l = linhasDe(tipo), c = el.dataset.encC;
      if (c === 'valor') { const v = el.value.trim() ? lerNum(el.value) : 0; if (!(v >= 0)) { avisar('Digite um percentual válido, como 1,50.'); return; } l[k].valor = v; }
      else if (c === 'item') { const v = el.value.trim().toUpperCase(); if (!v) { el.value = l[k].item; return; } l[k].item = v; }
      else l[k].descricao = el.value.trim();
      gravar({ [tipo]: l });
    });
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); } });
  });
  d.querySelectorAll('[data-enc-tirar]').forEach((bt) => bt.addEventListener('click', () => {
    const [tipo, k] = bt.dataset.encTirar.split(':'), l = linhasDe(tipo), alvo = l[k];
    const fica = alvo.item === alvo.grupo ? l.filter((x) => x.grupo !== alvo.grupo) : l.filter((_, i) => i !== Number(k));
    gravar({ [tipo]: fica }, alvo.item === alvo.grupo ? `Grupo ${esc(alvo.grupo)} retirado.` : `Item ${esc(alvo.item)} retirado.`);
  }));
  d.querySelectorAll('[data-enc-mais]').forEach((bt) => bt.addEventListener('click', () => {
    const [tipo, g] = bt.dataset.encMais.split(':'), l = linhasDe(tipo);
    const nums = l.filter((x) => x.grupo === g && x.item !== g).map((x) => Number(x.item.slice(g.length)) || 0);
    const novo = `${g}${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(2, '0')}`;
    const fim = l.reduce((p, x, i) => (x.grupo === g ? i : p), -1);
    l.splice(fim + 1, 0, { grupo: g, item: novo, descricao: '', valor: 0 });
    gravar({ [tipo]: l }, `Item ${novo} incluído. Preencha a descrição e o percentual.`).then(() => {
      const el = $(`[data-enc-k="${tipo}:${fim + 1}"][data-enc-c="descricao"]`); if (el) el.focus();
    });
  }));
  d.querySelectorAll('[data-enc-grupo]').forEach((bt) => bt.addEventListener('click', () => {
    const tipo = bt.dataset.encGrupo, l = linhasDe(tipo), gs = l.map((x) => x.grupo.charCodeAt(0)).filter((x) => x >= 65 && x <= 90);
    const g = String.fromCharCode(gs.length ? Math.max(...gs) + 1 : 65);
    if (g > 'Z') { avisar('Não há mais letras para um novo grupo.'); return; }
    l.push({ grupo: g, item: g, descricao: 'NOVO GRUPO', valor: 0 }, { grupo: g, item: `${g}01`, descricao: '', valor: 0 });
    gravar({ [tipo]: l }, `Grupo ${g} incluído.`).then(() => { const el = $(`[data-enc-k="${tipo}:${l.length - 2}"][data-enc-c="descricao"]`); if (el) { el.focus(); el.select(); } });
  }));
  $('#enc-excluir').addEventListener('click', async () => {
    if (!confirm(`Excluir a base de encargos "${b.nome}"?`)) return;
    try { await req(`/api/bases-encargos/${b.id}`, 'DELETE'); await basesEncargos(true); location.hash = '#/encargos'; avisar('Base de encargos excluída.'); }
    catch (e) { avisar(esc(e.message)); }
  });
}
