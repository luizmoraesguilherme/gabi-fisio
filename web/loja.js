(() => {
  'use strict';
  const cfg = window.GABI || {};
  const $ = (s, el = document) => el.querySelector(s);
  const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = { categories: [], products: [], cat: '', cart: {} };
  try { state.cart = JSON.parse(localStorage.getItem('gabi_sacola') || '{}') || {}; } catch { state.cart = {}; }
  const save = () => { try { localStorage.setItem('gabi_sacola', JSON.stringify(state.cart)); } catch {} };

  if (cfg.whatsapp) document.querySelectorAll('.js-whatsapp').forEach((a) => {
    if (a.id === 'order-wa') return;
    a.href = `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent('Olá, Gabriela! Vim pela loja do site.')}`;
    a.target = '_blank'; a.rel = 'noopener'; a.hidden = false;
  });

  // Ilustrações simples por categoria, usadas enquanto o produto não tem foto.
  const ICONS = {
    oleos: '<rect x="42" y="22" width="16" height="14" rx="3" fill="#18304A"/><rect x="30" y="36" width="40" height="52" rx="10" fill="#2A78C2"/><rect x="38" y="52" width="24" height="20" rx="3" fill="#fff" opacity=".85"/>',
    acessorios: '<circle cx="50" cy="52" r="30" fill="#E2668A"/><circle cx="50" cy="52" r="30" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="2 9" stroke-linecap="round" opacity=".8"/><circle cx="50" cy="52" r="10" fill="#fff" opacity=".85"/>',
    fitas: '<circle cx="50" cy="54" r="32" fill="#2A78C2"/><circle cx="50" cy="54" r="14" fill="#F5EDE4"/><rect x="58" y="70" width="34" height="14" rx="3" fill="#E2668A" transform="rotate(-8 58 70)"/>',
    autocuidado: '<rect x="24" y="34" width="52" height="46" rx="14" fill="#E2668A"/><rect x="38" y="24" width="24" height="14" rx="5" fill="#18304A"/><path d="M38 58h24M50 46v24" stroke="#fff" stroke-width="4" stroke-linecap="round"/>',
  };
  const art = (cat) => `<svg viewBox="0 0 100 100" aria-hidden="true">${ICONS[cat] || ICONS.acessorios}</svg>`;

  const qty = (id) => state.cart[id] || 0;
  const byId = (id) => state.products.find((p) => p.id === Number(id));
  const lines = () => Object.keys(state.cart).map((id) => ({ p: byId(id), n: state.cart[id] })).filter((l) => l.p && l.n > 0);
  const total = () => lines().reduce((t, l) => t + l.p.price * l.n, 0);

  function renderChips() {
    const all = [{ id: '', name: 'Tudo' }, ...state.categories];
    $('#chips').innerHTML = all.map((c) => `<button type="button" class="chip" data-cat="${c.id}" aria-pressed="${state.cat === c.id}">${esc(c.name)}</button>`).join('');
  }
  function renderProducts() {
    const list = state.products.filter((p) => !state.cat || p.category === state.cat);
    if (!list.length) { $('#prod-grid').innerHTML = '<p class="empty">Nenhum produto nesta categoria por enquanto.</p>'; return; }
    $('#prod-grid').innerHTML = list.map((p) => {
      const left = p.stock - qty(p.id);
      const photo = p.photo ? `<img src="/api/fotos/p${p.id}?v=${p.photo}" alt="" loading="lazy">` : art(p.category);
      return `<article class="prod">
        <div class="prod-img cat-${p.category}">${photo}</div>
        <h3>${esc(p.name)}</h3>
        <p class="prod-desc">${esc(p.description)}</p>
        <div class="prod-foot">
          <b class="prod-price">${brl(p.price)}</b>
          ${p.stock <= 0 ? '<span class="muted">Esgotado</span>'
            : `<button type="button" class="btn btn-quiet btn-sm" data-add="${p.id}" ${left <= 0 ? 'disabled' : ''}>${left <= 0 ? 'Todas na sacola' : 'Pôr na sacola'}</button>`}
        </div>
        ${p.stock > 0 && p.stock <= 3 ? `<p class="prod-low">Restam ${p.stock}</p>` : ''}
      </article>`;
    }).join('');
  }
  function renderBag() {
    const ls = lines();
    const count = ls.reduce((t, l) => t + l.n, 0);
    $('#bag-count').textContent = count;
    $('#bag-count').hidden = !count;
    $('#order-form').hidden = !ls.length;
    if (!ls.length) { $('#bag-body').innerHTML = '<p class="bag-empty">Sua sacola está vazia. Escolha um produto ao lado.</p>'; return; }
    $('#bag-body').innerHTML = `<ul class="bag-list">${ls.map((l) => `
      <li><div><strong>${esc(l.p.name)}</strong><small>${brl(l.p.price)} cada</small></div>
        <div class="qty" role="group" aria-label="Quantidade de ${esc(l.p.name)}">
          <button type="button" data-dec="${l.p.id}" aria-label="Menos um">−</button><b>${l.n}</b><button type="button" data-inc="${l.p.id}" aria-label="Mais um" ${l.n >= l.p.stock ? 'disabled' : ''}>+</button>
        </div><b class="line-total">${brl(l.p.price * l.n)}</b></li>`).join('')}</ul>
      <p class="bag-total"><span>Total</span><b>${brl(total())}</b></p>`;
  }
  const rerender = () => { save(); renderProducts(); renderBag(); };

  document.addEventListener('click', (e) => {
    const t = e.target;
    const c = t.closest('[data-cat]'); if (c) { state.cat = c.dataset.cat; renderChips(); renderProducts(); return; }
    const add = t.closest('[data-add]'); if (add) { const p = byId(add.dataset.add); if (qty(p.id) < p.stock) state.cart[p.id] = qty(p.id) + 1; rerender(); if (matchMedia('(max-width: 860px)').matches) { add.textContent = 'Na sacola ✓'; } return; }
    const inc = t.closest('[data-inc]'); if (inc) { const p = byId(inc.dataset.inc); if (qty(p.id) < p.stock) state.cart[p.id] = qty(p.id) + 1; rerender(); return; }
    const dec = t.closest('[data-dec]'); if (dec) { const id = dec.dataset.dec; state.cart[id] = qty(id) - 1; if (state.cart[id] <= 0) delete state.cart[id]; rerender(); }
  });

  const form = $('#order-form');
  form.addEventListener('change', (e) => { if (e.target.name === 'delivery') $('#addr-field').hidden = e.target.value !== 'entrega'; });
  const setErr = (k, msg) => { const el = form.querySelector(`[data-for="${k}"]`); if (el) el.textContent = msg || ''; };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    ['name', 'phone', 'address'].forEach((k) => setErr(k, ''));
    $('#order-status').textContent = '';
    const fd = new FormData(form);
    const items = lines().map((l) => ({ id: l.p.id, qty: l.n }));
    const btn = $('#order-submit'); btn.disabled = true;
    try {
      const r = await fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        name: fd.get('name'), phone: fd.get('phone'), delivery: fd.get('delivery'), address: fd.get('address'), notes: fd.get('notes'), website: fd.get('website'), items }) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        const er = body.errors || {};
        ['name', 'phone', 'address'].forEach((k) => setErr(k, er[k]));
        $('#order-status').textContent = er.items || body.error || (Object.keys(er).length ? 'Confira os campos acima.' : 'Não consegui enviar agora. Tente de novo.');
        if (r.status === 409) loadProducts();
        return;
      }
      const resumo = lines().map((l) => `${l.n}x ${l.p.name}`).join(', ');
      $('#order-done-text').textContent = `Recebemos seu pedido de ${brl(body.total)}. A Gabriela vai confirmar pelo WhatsApp e combinar o pagamento.`;
      if (cfg.whatsapp) { const a = $('#order-wa'); a.href = `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(`Olá, Gabriela! Acabei de pedir pela loja (pedido #${body.id}): ${resumo}. Total ${brl(body.total)}.`)}`; a.target = '_blank'; a.rel = 'noopener'; a.hidden = false; }
      state.cart = {}; save(); form.reset(); $('#addr-field').hidden = true;
      form.hidden = true; $('#bag-body').hidden = true; $('#order-done').hidden = false; $('#order-done').focus();
      renderBag(); renderProducts(); loadProducts();
    } catch { $('#order-status').textContent = 'Sem conexão. Tente de novo.'; }
    finally { btn.disabled = false; }
  });
  $('#order-new').addEventListener('click', () => { $('#order-done').hidden = true; $('#bag-body').hidden = false; renderBag(); });

  function loadProducts() {
    return fetch('/api/products').then((r) => r.json()).then(({ categories, products }) => {
      state.categories = categories; state.products = products;
      for (const id of Object.keys(state.cart)) { const p = byId(id); if (!p || p.stock <= 0) delete state.cart[id]; else if (state.cart[id] > p.stock) state.cart[id] = p.stock; }
      renderChips(); renderProducts(); renderBag(); save();
    }).catch(() => { $('#prod-grid').innerHTML = '<p class="empty">Não consegui carregar os produtos agora. Recarregue a página em instantes.</p>'; });
  }
  loadProducts();
})();
