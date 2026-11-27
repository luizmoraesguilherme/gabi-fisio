(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const STATUS_LABEL = { pendente: 'A confirmar', confirmado: 'Confirmado', recusado: 'Recusado', concluido: 'Concluído', cancelado: 'Cancelado' };

  let services = {};
  let filter = 'pendente';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function dayTitle(day) {
    const d = new Date(`${day}T12:00:00Z`);
    return `${WEEKDAYS[d.getUTCDay()][0].toUpperCase()}${WEEKDAYS[d.getUTCDay()].slice(1)}, ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`;
  }
  function waLink(b, kind) {
    let digits = b.phone.replace(/\D/g, '');
    if (digits.length <= 11) digits = `55${digits}`;
    const [day, time] = b.slot.split('T');
    const first = b.name.split(' ')[0];
    const when = `${dayTitle(day).toLowerCase()}, às ${time}`;
    const svc = services[b.service] || 'atendimento';
    const text = kind === 'recusar'
      ? `Olá, ${first}! Aqui é a Gabriela. Infelizmente não vou conseguir atender ${when}. Podemos ver outro horário?`
      : `Olá, ${first}! Aqui é a Gabriela, fisioterapeuta. Confirmo seu atendimento de ${svc.toLowerCase()} ${when}, no endereço ${b.address}. Qualquer coisa, é só me chamar por aqui.`;
    return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  }

  async function api(url, opts = {}) {
    const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, credentials: 'same-origin' });
    const body = await r.json().catch(() => ({}));
    if (r.status === 401 && !url.endsWith('/login')) { showLogin(); throw new Error('auth'); }
    if (!r.ok) throw Object.assign(new Error(body.error || 'Erro'), { body });
    return body;
  }

  function showLogin() { $('#login').hidden = false; $('#app').hidden = true; $('#logout').hidden = true; $('#login-form [name=password]').focus(); }
  function showApp() { $('#login').hidden = true; $('#app').hidden = false; $('#logout').hidden = false; load(); loadBlocks(); }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-status').textContent = '';
    try {
      await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: e.target.password.value }) });
      e.target.reset(); showApp();
    } catch (err) { $('#login-status').textContent = err.body?.error || 'Não deu para entrar agora.'; }
  });
  $('#logout').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }).catch(() => {}); showLogin(); });

  document.querySelectorAll('.tabs [role=tab]').forEach((t) => t.addEventListener('click', () => {
    filter = t.dataset.status;
    document.querySelectorAll('.tabs [role=tab]').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    load();
  }));

  async function load() {
    $('#panel-status').textContent = '';
    try {
      const [{ bookings }, pend] = await Promise.all([
        api(`/api/admin/bookings${filter ? `?status=${filter}` : ''}`),
        api('/api/admin/bookings?status=pendente'),
      ]);
      $('#count-pendente').textContent = pend.bookings.length ? `(${pend.bookings.length})` : '';
      render(bookings);
    } catch (err) { if (err.message !== 'auth') $('#panel-status').textContent = err.message; }
  }

  function render(rows) {
    const list = $('#list');
    if (!rows.length) {
      const empty = { pendente: 'Nenhum pedido esperando confirmação. Novos pedidos do site aparecem aqui.', confirmado: 'Nenhum atendimento confirmado ainda.', concluido: 'Os atendimentos marcados como concluídos ficam aqui.', '': 'Ainda não chegou nenhum pedido pelo site.' };
      list.innerHTML = `<p class="empty">${empty[filter]}</p>`;
      return;
    }
    const byDay = {};
    rows.forEach((b) => (byDay[b.slot.slice(0, 10)] ||= []).push(b));
    list.innerHTML = Object.entries(byDay).map(([day, items]) => `
      <section class="day-group">
        <h2>${dayTitle(day)}</h2>
        ${items.map((b) => `
          <article class="booking-row status-${b.status}">
            <div class="b-time">${esc(b.slot.slice(11))}</div>
            <div class="b-main">
              <h3>${esc(b.name)}${b.for_whom ? ` <span>para ${esc(b.for_whom)}</span>` : ''}</h3>
              <p class="b-svc">${esc(services[b.service] || b.service)} <span class="tag">${STATUS_LABEL[b.status]}</span></p>
              <p>${esc(b.address)}</p>
              <p><a href="tel:${esc(b.phone.replace(/[^\d+]/g, ''))}">${esc(b.phone)}</a></p>
              ${b.notes ? `<p class="b-notes">${esc(b.notes)}</p>` : ''}
            </div>
            <div class="b-actions">
              ${b.status === 'pendente' ? `
                <button class="btn btn-primary" data-id="${b.id}" data-set="confirmado" data-wa="${esc(waLink(b, 'confirmar'))}">Confirmar e avisar</button>
                <button class="btn btn-quiet" data-id="${b.id}" data-set="recusado" data-wa="${esc(waLink(b, 'recusar'))}">Recusar</button>` : ''}
              ${b.status === 'confirmado' ? `
                <button class="btn btn-primary" data-id="${b.id}" data-set="concluido">Marcar como concluído</button>
                <button class="btn btn-quiet" data-id="${b.id}" data-set="cancelado">Cancelar</button>` : ''}
              <a class="link-btn" href="${esc(waLink(b, 'confirmar').replace(/\?text=.*/, ''))}" target="_blank" rel="noopener">Abrir conversa</a>
            </div>
          </article>`).join('')}
      </section>`).join('');
  }

  $('#list').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-set]');
    if (!btn) return;
    if (btn.dataset.set === 'cancelado' && !confirm('Cancelar este atendimento? O horário volta a ficar livre no site.')) return;
    // Abre o WhatsApp no mesmo clique (antes do await) para o navegador não bloquear a janela.
    const win = btn.dataset.wa ? window.open(btn.dataset.wa, '_blank', 'noopener') : null;
    btn.disabled = true;
    try {
      await api(`/api/admin/bookings/${btn.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: btn.dataset.set }) });
      load();
    } catch (err) {
      if (win) win.close();
      btn.disabled = false;
      $('#panel-status').textContent = err.message;
    }
  });

  async function loadBlocks() {
    try {
      const { blocks } = await api('/api/admin/blocks');
      $('#block-list').innerHTML = blocks.length
        ? blocks.map((b) => `<li><span>${dayTitle(b.day)}${b.reason ? `, ${esc(b.reason)}` : ''}</span> <button class="link-btn" data-day="${b.day}">Liberar</button></li>`).join('')
        : '<li class="empty">Nenhum dia bloqueado.</li>';
    } catch {}
  }
  $('#block-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try { await api('/api/admin/blocks', { method: 'POST', body: JSON.stringify({ day: f.day.value, reason: f.reason.value }) }); f.reset(); loadBlocks(); }
    catch (err) { $('#panel-status').textContent = err.message; }
  });
  $('#block-list').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-day]');
    if (!b) return;
    await api(`/api/admin/blocks/${b.dataset.day}`, { method: 'DELETE' }).catch(() => {});
    loadBlocks();
  });

  fetch('/api/services').then((r) => r.json()).then(({ services: s }) => { services = Object.fromEntries(s.map((x) => [x.id, x.name])); })
    .finally(() => fetch('/api/admin/me', { credentials: 'same-origin' }).then((r) => (r.ok ? showApp() : showLogin())).catch(showLogin));
})();
