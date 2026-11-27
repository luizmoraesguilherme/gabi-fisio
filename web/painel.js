(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];

  const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const WD3 = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const STATUS_LABEL = { pendente: 'A confirmar', confirmado: 'Confirmada', recusado: 'Recusada', concluido: 'Concluída', cancelado: 'Cancelada' };
  const PKG_LABEL = { pendente: 'A confirmar', ativo: 'Ativo', concluido: 'Concluído', recusado: 'Recusado', cancelado: 'Cancelado' };
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  let services = {};
  const DEFAULTS = {
    ses: { q: '', status: '', kind: '', service: '', period: 'futuro', from: '', to: '', package: null, pkgLabel: '' },
    cli: { q: '', sort: 'next', open: null },
    pac: { q: '', status: 'ativo', paid: '', ending: false },
  };
  const S = { view: 'pedidos', ses: { ...DEFAULTS.ses }, cli: { ...DEFAULTS.cli }, pac: { ...DEFAULTS.pac }, cal: { month: null, pend: false, rows: [] } };

  // ---------- Utilidades ----------
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const addDays = (day, k) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); };
  const lastOfMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
  const shiftMonth = (ym, k) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 7); };
  const cap = (t) => t[0].toUpperCase() + t.slice(1);
  const yearSuffix = (day, sep = ' de ') => (day.slice(0, 4) !== today().slice(0, 4) ? `${sep}${day.slice(0, 4)}` : '');
  function dayTitle(day) {
    const d = new Date(`${day}T12:00:00Z`);
    return `${cap(WEEKDAYS[d.getUTCDay()])}, ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}${yearSuffix(day)}`;
  }
  function shortDay(day) { const [, m, d] = day.split('-').map(Number); return `${d} de ${MONTHS[m - 1].slice(0, 3)}${yearSuffix(day)}`; }
  function dayShort(day) { const d = new Date(`${day}T12:00:00Z`); return `${WD3[d.getUTCDay()]}, ${shortDay(day)}`; }
  const slotShort = (slot) => `${dayShort(slot.slice(0, 10))}, ${slot.slice(11)}`;
  const firstName = (n) => n.split(' ')[0];
  const ckey = (phone) => String(phone).replace(/\D/g, '').slice(-11);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const qs = (o) => { const p = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => { if (v !== '' && v != null && v !== false) p.set(k, v); }); const t = p.toString(); return t ? `?${t}` : ''; };

  function waNumber(phone) { let d = phone.replace(/\D/g, ''); if (d.length <= 11) d = `55${d}`; return d; }
  const wa = (phone, text) => `https://wa.me/${waNumber(phone)}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  function waBooking(b, kind) {
    const [day, time] = b.slot.split('T');
    const when = `${dayTitle(day).toLowerCase()}, às ${time}`;
    const svc = (services[b.service] || 'atendimento').toLowerCase();
    return wa(b.phone, kind === 'recusar'
      ? `Olá, ${firstName(b.name)}! Aqui é a Gabriela. Infelizmente não vou conseguir atender ${when}. Podemos ver outro horário?`
      : `Olá, ${firstName(b.name)}! Aqui é a Gabriela, fisioterapeuta. Confirmo seu atendimento de ${svc} ${when}, no endereço ${b.address}. Qualquer coisa, é só me chamar por aqui.`);
  }
  function waPackage(p, kind) {
    const list = p.sessionsList.filter((s) => ['pendente', 'confirmado'].includes(s.status)).map((s) => `• ${dayTitle(s.slot.slice(0, 10))}, às ${s.slot.slice(11)}`).join('\n');
    const svc = (services[p.service] || 'atendimento').toLowerCase();
    if (kind === 'recusar') return wa(p.phone, `Olá, ${firstName(p.name)}! Aqui é a Gabriela. Infelizmente não vou conseguir encaixar o pacote nessas datas. Podemos ver outros horários?`);
    if (kind === 'renovar') return wa(p.phone, `Olá, ${firstName(p.name)}! Aqui é a Gabriela. Seu pacote de ${p.sessions} sessões de ${svc} termina em ${shortDay(p.end_day)}. Quer renovar para o próximo mês? Posso já separar seus horários.`);
    return wa(p.phone, `Olá, ${firstName(p.name)}! Aqui é a Gabriela, fisioterapeuta. Confirmo seu pacote de ${p.sessions} sessões de ${svc}:\n${list}\nEndereço: ${p.address}. Qualquer coisa, é só me chamar por aqui.`);
  }

  async function api(url, opts = {}) {
    const r = await fetch(url, { ...opts, headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) }, credentials: 'same-origin' });
    const body = await r.json().catch(() => ({}));
    if (r.status === 401 && !url.endsWith('/login')) { showLogin(); throw new Error('auth'); }
    if (!r.ok) throw Object.assign(new Error(body.error || 'Erro'), { body });
    return body;
  }
  const setStatus = (msg, ok = false) => { const el = $('#panel-status'); el.textContent = msg || ''; el.classList.toggle('is-ok', ok); };
  const fail = (err) => { if (err.message !== 'auth') setStatus(err.message); };

  // ---------- Login ----------
  function showLogin() { $('#login').hidden = false; $('#app').hidden = true; $('#logout').hidden = true; $('#login-form [name=password]').focus(); }
  function showApp() { $('#login').hidden = true; $('#app').hidden = false; $('#logout').hidden = false; fillServiceFilter(); refresh(); }
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-status').textContent = '';
    try { await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: e.target.password.value }) }); e.target.reset(); showApp(); }
    catch (err) { $('#login-status').textContent = err.body?.error || 'Não deu para entrar agora.'; }
  });
  $('#logout').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }).catch(() => {}); showLogin(); });

  // ---------- Navegação ----------
  function go(view) {
    S.view = view;
    $$('.views button').forEach((x) => (x.dataset.view === view ? x.setAttribute('aria-current', 'page') : x.removeAttribute('aria-current')));
    $$('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
    setStatus('');
    refresh();
    window.scrollTo({ top: 0 });
  }
  $$('.views button').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.view === 'clientes') closeClient(true);
    go(b.dataset.view);
  }));

  function refresh() {
    updateCount();
    ({ pedidos: loadPedidos, agenda: loadAgenda, sessoes: loadSessoes, clientes: loadClientes, pacotes: loadPacotes, precos: loadPrecos, loja: loadLoja, fotos: loadFotos })[S.view]();
  }
  async function updateCount() {
    try {
      const [b, p] = await Promise.all([api('/api/admin/bookings?status=pendente&kind=avulsa&limit=1'), api('/api/admin/packages?status=pendente')]);
      const n = b.total + p.summary.pending;
      $('#count-pendente').textContent = n ? `(${n})` : '';
      const o = await api('/api/admin/orders?status=novo');
      const no = o.orders.length;
      $('#count-loja').textContent = no ? `(${no})` : '';
    } catch {}
  }

  // ---------- Peças reutilizadas ----------
  function bookingActions(b) {
    if (b.status === 'pendente' && !b.package_id) return `
      <button class="btn btn-primary btn-sm" data-id="${b.id}" data-set="confirmado" data-wa="${esc(waBooking(b, 'confirmar'))}">Confirmar e avisar</button>
      <button class="btn btn-quiet btn-sm" data-id="${b.id}" data-set="recusado" data-wa="${esc(waBooking(b, 'recusar'))}">Recusar</button>`;
    if (b.status === 'pendente') return '<span class="muted">Confirme pelo pacote</span>';
    if (b.status === 'confirmado') return `
      <button class="btn btn-primary btn-sm" data-id="${b.id}" data-set="concluido">Concluir</button>
      <button class="btn btn-quiet btn-sm" data-id="${b.id}" data-set="cancelado">Cancelar</button>`;
    return '';
  }

  function sessionRow(b, hideClient) {
    const [day, time] = b.slot.split('T');
    return `<tr class="status-${b.status}">
      <td data-label="Quando"><b class="t-time">${time}</b><span>${dayShort(day)}</span></td>
      ${hideClient ? '' : `<td data-label="Cliente"><button type="button" class="link-btn t-client" data-client="${ckey(b.phone)}">${esc(b.name)}</button><small>${esc(b.phone)}</small></td>`}
      <td data-label="Atendimento">${esc(services[b.service] || b.service)}${b.for_whom ? `<small>para ${esc(b.for_whom)}</small>` : ''}</td>
      <td data-label="Tipo">${b.pkg ? `<button type="button" class="link-btn" data-pkgfilter="${b.pkg.id}" data-pkglabel="${esc(b.name)}">Pacote ${b.pkg.n} de ${b.pkg.sessions}</button>` : 'Avulsa'}</td>
      <td data-label="Situação"><span class="tag tag-${b.status}">${STATUS_LABEL[b.status]}</span></td>
      <td class="t-cell"><div class="t-actions">${bookingActions(b)}<a class="link-btn" href="${esc(wa(b.phone))}" target="_blank" rel="noopener">WhatsApp</a></div></td>
    </tr>`;
  }
  function sessionsTable(rows, { hideClient = false, empty = 'Nenhuma sessão encontrada.' } = {}) {
    if (!rows.length) return `<p class="empty">${empty}</p>`;
    return `<table class="tbl"><thead><tr><th>Quando</th>${hideClient ? '' : '<th>Cliente</th>'}<th>Atendimento</th><th>Tipo</th><th>Situação</th><th><span class="sr">Ações</span></th></tr></thead>
      <tbody>${rows.map((r) => sessionRow(r, hideClient)).join('')}</tbody></table>`;
  }

  function pendingPackageCard(p) {
    return `
      <article class="booking-row pkg-pending">
        <div class="b-time b-time-pkg">${p.sessions}<small>sessões</small></div>
        <div class="b-main">
          <h3><button type="button" class="link-btn t-client" data-client="${ckey(p.phone)}">${esc(p.name)}</button></h3>
          <p class="b-svc">Pacote de ${p.sessions} sessões de ${esc((services[p.service] || p.service).toLowerCase())} <span class="tag">A confirmar</span></p>
          <p>${esc(p.address)}</p>
          <p><a href="tel:${esc(p.phone.replace(/[^\d+]/g, ''))}">${esc(p.phone)}</a></p>
          <ul class="pkg-sessions">${p.sessionsList.map((s) => `<li>${dayTitle(s.slot.slice(0, 10))}, às ${s.slot.slice(11)}</li>`).join('')}</ul>
          <p class="b-hint">Prazo do pacote: ${shortDay(p.start_day)} a ${shortDay(p.end_day)}.</p>
        </div>
        <div class="b-actions">
          <button class="btn btn-primary" data-pkg="${p.id}" data-pset="ativo" data-wa="${esc(waPackage(p, 'confirmar'))}">Confirmar pacote e avisar</button>
          <button class="btn btn-quiet" data-pkg="${p.id}" data-pset="recusado" data-wa="${esc(waPackage(p, 'recusar'))}">Recusar</button>
          <a class="link-btn" href="${esc(wa(p.phone))}" target="_blank" rel="noopener">Abrir conversa</a>
        </div>
      </article>`;
  }

  function meter(label, pct, text, cls = '') {
    return `<div class="meter ${cls}"><div class="meter-top"><span>${label}</span><span>${text}</span></div>
      <div class="meter-track" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="meter-fill" style="width:${Math.min(100, pct)}%"></div></div></div>`;
  }

  function packageCard(p, { hideClient = false } = {}) {
    if (p.status === 'pendente') return pendingPackageCard(p);
    const urgent = p.status === 'ativo' && p.daysLeft <= 7;
    const sessText = `${p.done} de ${p.sessions} feitas (${p.progress}%)`;
    const timeText = p.expired ? `terminou em ${shortDay(p.end_day)}`
      : p.daysElapsed === 0 ? `começa em ${shortDay(p.start_day)}, termina em ${shortDay(p.end_day)}`
      : `dia ${p.daysElapsed} de 30, termina em ${shortDay(p.end_day)} (${plural(p.daysLeft, 'dia', 'dias')})`;
    const unscheduled = p.sessions - p.done - p.scheduled;
    const behind = p.status === 'ativo' && p.timeProgress - p.progress >= 40;
    return `
      <article class="pkg${urgent ? ' is-urgent' : ''}">
        <header class="pkg-head">
          <div>
            <h3>${hideClient ? 'Pacote' : `<button type="button" class="link-btn t-client" data-client="${ckey(p.phone)}">${esc(p.name)}</button>`}</h3>
            <p>Pacote de ${p.sessions} sessões de ${esc((services[p.service] || p.service).toLowerCase())} <span class="tag tag-p-${p.status}">${PKG_LABEL[p.status]}</span></p>
          </div>
          <div class="pkg-pay">
            <label class="field pkg-price"><span>Valor</span><input inputmode="decimal" data-price="${p.id}" value="${p.price != null ? p.price.toFixed(2).replace('.', ',') : ''}" placeholder="0,00" aria-label="Valor do pacote em reais"></label>
            ${p.paid
              ? `<p class="paid">Pago em ${shortDay(p.paid_at.slice(0, 10))} <button type="button" class="link-btn" data-pkg="${p.id}" data-paid="0">Desfazer</button></p>`
              : `<button type="button" class="btn btn-primary" data-pkg="${p.id}" data-paid="1">Marcar como pago</button>`}
          </div>
        </header>
        ${meter('Sessões', p.progress, sessText)}
        ${meter('Prazo de 30 dias', p.timeProgress, timeText, urgent ? 'meter-time is-urgent' : 'meter-time')}
        ${behind ? '<p class="b-hint">As sessões estão atrasadas em relação ao prazo.</p>' : ''}
        ${p.status === 'ativo' && unscheduled > 0 ? `<p class="b-hint">${plural(unscheduled, 'sessão precisa', 'sessões precisam')} ser remarcada${unscheduled > 1 ? 's' : ''}.</p>` : ''}
        <ul class="pkg-dots" aria-label="Sessões do pacote">${p.sessionsList.map((s) => `<li class="dot-${s.status}">${shortDay(s.slot.slice(0, 10))} ${s.slot.slice(11)} <span>${STATUS_LABEL[s.status]}</span></li>`).join('')}</ul>
        <footer class="pkg-actions">
          ${['ativo', 'concluido'].includes(p.status) ? `<a class="btn ${urgent || p.status === 'concluido' ? 'btn-primary' : 'btn-quiet'} btn-sm" href="${esc(waPackage(p, 'renovar'))}" target="_blank" rel="noopener">Oferecer renovação</a>` : ''}
          <button type="button" class="link-btn" data-pkgfilter="${p.id}" data-pkglabel="${esc(p.name)}">Ver sessões na lista</button>
          <a class="link-btn" href="${esc(wa(p.phone))}" target="_blank" rel="noopener">Abrir conversa</a>
          ${p.status === 'ativo' ? `<button type="button" class="link-btn link-danger" data-pkg="${p.id}" data-pset="cancelado">Cancelar pacote</button>` : ''}
        </footer>
      </article>`;
  }

  // ---------- Pedidos ----------
  async function loadPedidos() {
    setStatus('');
    try {
      const [b, p] = await Promise.all([api('/api/admin/bookings?status=pendente&kind=avulsa'), api('/api/admin/packages?status=pendente')]);
      const list = $('#list');
      if (!b.bookings.length && !p.packages.length) { list.innerHTML = '<p class="empty">Nenhum pedido esperando confirmação. Novos pedidos do site aparecem aqui.</p>'; return; }
      let html = '';
      if (p.packages.length) html += `<section class="day-group"><h2>Pacotes</h2>${p.packages.map(pendingPackageCard).join('')}</section>`;
      const byDay = {};
      b.bookings.forEach((x) => (byDay[x.slot.slice(0, 10)] ||= []).push(x));
      html += Object.entries(byDay).map(([day, items]) => `<section class="day-group"><h2>${dayTitle(day)}</h2>${items.map(bookingCard).join('')}</section>`).join('');
      list.innerHTML = html;
    } catch (err) { fail(err); }
  }
  function bookingCard(b) {
    return `
      <article class="booking-row status-${b.status}">
        <div class="b-time">${esc(b.slot.slice(11))}</div>
        <div class="b-main">
          <h3><button type="button" class="link-btn t-client" data-client="${ckey(b.phone)}">${esc(b.name)}</button>${b.for_whom ? ` <span>para ${esc(b.for_whom)}</span>` : ''}</h3>
          <p class="b-svc">${esc(services[b.service] || b.service)} <span class="tag">${STATUS_LABEL[b.status]}</span></p>
          <p>${esc(b.address)}</p>
          <p><a href="tel:${esc(b.phone.replace(/[^\d+]/g, ''))}">${esc(b.phone)}</a></p>
          ${b.notes ? `<p class="b-notes">${esc(b.notes)}</p>` : ''}
        </div>
        <div class="b-actions">${bookingActions(b)}<a class="link-btn" href="${esc(wa(b.phone))}" target="_blank" rel="noopener">Abrir conversa</a></div>
      </article>`;
  }

  // ---------- Ações (pedidos, agenda, sessões, clientes, pacotes) ----------
  document.addEventListener('click', async (e) => {
    const t = e.target;
    const go1 = t.closest('[data-client]');
    if (go1 && $('#app').contains(go1)) { openClient(go1.dataset.client); return; }
    const pf = t.closest('[data-pkgfilter]');
    if (pf) { showPackageSessions(Number(pf.dataset.pkgfilter), pf.dataset.pkglabel); return; }
    const btn = t.closest('button[data-set], button[data-pset], button[data-paid]');
    if (!btn || !$('#app').contains(btn)) return;
    const set = btn.dataset.set || btn.dataset.pset;
    if (set === 'cancelado' && !confirm(btn.dataset.pkg ? 'Cancelar o pacote inteiro? As sessões ainda não feitas voltam a ficar livres no site.' : 'Cancelar este atendimento? O horário volta a ficar livre no site.')) return;
    // Abre o WhatsApp no mesmo clique (antes do await) para o navegador não bloquear a janela.
    const win = btn.dataset.wa ? window.open(btn.dataset.wa, '_blank', 'noopener') : null;
    btn.disabled = true;
    try {
      if (btn.dataset.paid !== undefined) await api(`/api/admin/packages/${btn.dataset.pkg}`, { method: 'PATCH', body: JSON.stringify({ paid: btn.dataset.paid === '1' }) });
      else if (btn.dataset.pkg) await api(`/api/admin/packages/${btn.dataset.pkg}`, { method: 'PATCH', body: JSON.stringify({ status: set }) });
      else await api(`/api/admin/bookings/${btn.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: set }) });
      refresh();
    } catch (err) { if (win) win.close(); btn.disabled = false; fail(err); }
  });
  document.addEventListener('change', async (e) => {
    const inp = e.target.closest('[data-price]');
    if (!inp) return;
    try {
      await api(`/api/admin/packages/${inp.dataset.price}`, { method: 'PATCH', body: JSON.stringify({ price: inp.value.trim() }) });
      setStatus('Valor salvo.', true);
      refresh();
    } catch (err) { fail(err); }
  });

  // ---------- Agenda (calendário) ----------
  $('#cal-prev').addEventListener('click', () => { S.cal.month = shiftMonth(S.cal.month, -1); loadAgenda(); });
  $('#cal-next').addEventListener('click', () => { S.cal.month = shiftMonth(S.cal.month, 1); loadAgenda(); });
  $('#cal-today').addEventListener('click', () => { S.cal.month = today().slice(0, 7); loadAgenda(); });
  $('#cal-pend').addEventListener('change', (e) => { S.cal.pend = e.target.checked; loadAgenda(); });

  async function loadAgenda() {
    S.cal.month ||= today().slice(0, 7);
    const [y, m] = S.cal.month.split('-').map(Number);
    $('#cal-month').textContent = `${cap(MONTHS[m - 1])} de ${y}`;
    try {
      const { bookings } = await api(`/api/admin/bookings${qs({ from: `${S.cal.month}-01`, to: lastOfMonth(S.cal.month), status: S.cal.pend ? 'pendente,confirmado,concluido' : 'confirmado,concluido', limit: 1000 })}`);
      S.cal.rows = bookings;
      renderCalendar();
      loadBlocks();
    } catch (err) { fail(err); }
  }

  function renderCalendar() {
    const [y, m] = S.cal.month.split('-').map(Number);
    const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // semana começa no domingo
    const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const byDay = {};
    S.cal.rows.forEach((b) => (byDay[b.slot.slice(0, 10)] ||= []).push(b));
    const t = today();
    let html = WD3.map((d) => `<div class="cal-wd" aria-hidden="true">${d}</div>`).join('') + '<div class="cal-cell cal-blank" aria-hidden="true"></div>'.repeat(lead);
    for (let d = 1; d <= total; d++) {
      const day = `${S.cal.month}-${String(d).padStart(2, '0')}`;
      const items = byDay[day] || [];
      html += `<div class="cal-cell${day === t ? ' is-today' : ''}${items.length ? ' has-items' : ''}${day < t ? ' is-past' : ''}">
        <div class="cal-dayhead"><b>${d}</b><span class="cal-day-long">${dayTitle(day)}</span></div>
        ${items.map((b) => `<button type="button" class="cal-item${b.package_id ? ' is-pkg' : ''}${b.status === 'concluido' ? ' is-done' : ''}${b.status === 'pendente' ? ' is-pend' : ''}" data-booking="${b.id}"><span class="cal-time">${b.slot.slice(11)}</span> ${esc(firstName(b.name))}</button>`).join('')}
      </div>`;
    }
    $('#cal-grid').innerHTML = html;
    if (!S.cal.rows.length) $('#cal-grid').insertAdjacentHTML('beforeend', '<p class="empty cal-empty">Nenhum atendimento neste mês.</p>');
    $('#cal-detail').hidden = true;
  }
  $('#cal-grid').addEventListener('click', (e) => {
    const it = e.target.closest('[data-booking]');
    if (!it) return;
    const b = S.cal.rows.find((x) => String(x.id) === it.dataset.booking);
    const box = $('#cal-detail');
    box.innerHTML = `<h2>${dayTitle(b.slot.slice(0, 10))}</h2>${sessionsTable([b])}`;
    box.hidden = false;
    box.scrollIntoView({ block: 'nearest' });
    box.focus({ preventScroll: true });
  });

  // Dias de folga
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
    catch (err) { fail(err); }
  });
  $('#block-list').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-day]');
    if (!b) return;
    await api(`/api/admin/blocks/${b.dataset.day}`, { method: 'DELETE' }).catch(() => {});
    loadBlocks();
  });

  // ---------- Sessões ----------
  function fillServiceFilter() {
    const sel = $('#s-service');
    if (sel.options.length > 1) return;
    Object.entries(services).forEach(([id, name]) => sel.add(new Option(name, id)));
  }
  function syncSessionControls() {
    const f = S.ses;
    $('#s-q').value = f.q; $('#s-status').value = f.status; $('#s-kind').value = f.kind; $('#s-service').value = f.service;
    $('#s-period').value = f.period; $('#s-from').value = f.from; $('#s-to').value = f.to;
    $('#s-dates').hidden = f.period !== 'custom';
    const chip = $('#s-pkg');
    chip.hidden = !f.package;
    if (f.package) chip.innerHTML = `Mostrando só as sessões do pacote de <b>${esc(f.pkgLabel)}</b> <button type="button" class="link-btn" id="s-pkg-x">Mostrar todas</button>`;
  }
  function periodRange(f) {
    const t = today();
    switch (f.period) {
      case 'hoje': return { from: t, to: t };
      case '7d': return { from: t, to: addDays(t, 6) };
      case 'mes': return { from: `${t.slice(0, 7)}-01`, to: lastOfMonth(t.slice(0, 7)) };
      case 'passadas': return { to: addDays(t, -1), order: 'desc' };
      case 'tudo': return { order: 'desc' };
      case 'custom': return { from: f.from, to: f.to };
      default: return { from: t }; // futuro
    }
  }
  async function loadSessoes() {
    syncSessionControls();
    const f = S.ses;
    const r = periodRange(f);
    try {
      const { bookings, total, counts } = await api(`/api/admin/bookings${qs({ q: f.q, status: f.status, kind: f.kind, service: f.service, package: f.package, from: r.from, to: r.to, order: r.order, limit: 500 })}`);
      const chips = ['pendente', 'confirmado', 'concluido', 'cancelado', 'recusado'].filter((s) => counts[s]).map((s) => `<span class="tag tag-${s}">${counts[s]} ${STATUS_LABEL[s].toLowerCase()}${counts[s] > 1 && s !== 'pendente' ? 's' : ''}</span>`).join('');
      $('#s-bar').innerHTML = `<b>${plural(total, 'sessão', 'sessões')}</b>${total > bookings.length ? ` <span class="muted">(mostrando as primeiras ${bookings.length})</span>` : ''} ${chips}`;
      $('#s-result').innerHTML = sessionsTable(bookings, { empty: 'Nenhuma sessão com esses filtros. Tente ampliar o período ou limpar os filtros.' });
    } catch (err) { fail(err); }
  }
  const onSes = (id, key, ev = 'change') => $(id).addEventListener(ev, (e) => { S.ses[key] = e.target.value; if (key === 'period') $('#s-dates').hidden = e.target.value !== 'custom'; loadSessoes(); });
  onSes('#s-status', 'status'); onSes('#s-kind', 'kind'); onSes('#s-service', 'service'); onSes('#s-period', 'period');
  onSes('#s-from', 'from'); onSes('#s-to', 'to');
  $('#s-q').addEventListener('input', debounce((e) => { S.ses.q = e.target.value.trim(); loadSessoes(); }));
  $('#s-clear').addEventListener('click', () => { S.ses = { ...DEFAULTS.ses }; loadSessoes(); });
  $('#s-pkg').addEventListener('click', (e) => { if (e.target.id === 's-pkg-x') { S.ses.package = null; S.ses.pkgLabel = ''; loadSessoes(); } });

  function showPackageSessions(id, label) {
    S.ses = { ...DEFAULTS.ses, package: id, pkgLabel: label, period: 'tudo' };
    go('sessoes');
  }

  // ---------- Clientes ----------
  $('#c-q').addEventListener('input', debounce((e) => { S.cli.q = e.target.value.trim(); loadClientes(); }));
  $('#c-sort').addEventListener('change', (e) => { S.cli.sort = e.target.value; loadClientes(); });

  async function loadClientes() {
    if (S.cli.open) return openClient(S.cli.open, true);
    $('#c-main').hidden = false; $('#c-detail').hidden = true;
    try {
      const { clients } = await api(`/api/admin/clients${qs({ q: S.cli.q, sort: S.cli.sort })}`);
      $('#c-bar').innerHTML = `<b>${plural(clients.length, 'cliente', 'clientes')}</b>`;
      $('#c-list').innerHTML = clients.length ? clients.map(clientRow).join('') : '<p class="empty">Nenhum cliente encontrado. Quem pedir um atendimento pelo site aparece aqui.</p>';
    } catch (err) { fail(err); }
  }
  function clientRow(c) {
    const money = c.toReceive > 0 ? `${brl.format(c.toReceive)} a receber` : c.paidTotal > 0 ? `${brl.format(c.paidTotal)} pagos` : '';
    return `<article class="client">
      <div class="c-id"><h3><button type="button" class="link-btn t-client" data-client="${c.key}">${esc(c.name)}</button></h3><p>${esc(c.phone)}</p></div>
      <div class="c-next"><small>Próxima sessão</small><b>${c.nextSlot ? slotShort(c.nextSlot) : 'Nenhuma marcada'}</b></div>
      <div class="c-stats"><span><b>${c.done}</b> ${c.done === 1 ? 'feita' : 'feitas'}</span><span><b>${c.upcoming}</b> ${c.upcoming === 1 ? 'marcada' : 'marcadas'}</span></div>
      <div class="c-tags">${c.packagesActive ? '<span class="tag tag-p-ativo">Pacote ativo</span>' : ''}${c.pending ? `<span class="tag tag-pendente">${c.pending} a confirmar</span>` : ''}${money ? `<span class="muted">${money}</span>` : ''}</div>
      <button type="button" class="btn btn-quiet btn-sm" data-client="${c.key}">Ver ficha</button>
    </article>`;
  }

  async function openClient(key, quiet = false) {
    S.cli.open = key;
    if (S.view !== 'clientes') { S.view = 'clientes'; $$('.views button').forEach((x) => (x.dataset.view === 'clientes' ? x.setAttribute('aria-current', 'page') : x.removeAttribute('aria-current'))); $$('.view').forEach((v) => (v.hidden = v.id !== 'view-clientes')); }
    try {
      const { client: c, bookings, packages } = await api(`/api/admin/clients/${key}`);
      $('#c-main').hidden = true;
      const box = $('#c-detail');
      box.hidden = false;
      box.innerHTML = `
        <button type="button" class="link-btn" id="c-back">Voltar para clientes</button>
        <div class="panel-head">
          <div><h1>${esc(c.name)}</h1><p class="c-contact"><a href="tel:${esc(c.phone.replace(/[^\d+]/g, ''))}">${esc(c.phone)}</a>, ${esc(c.address)}</p></div>
          <div class="c-actions"><a class="btn btn-primary btn-sm" href="${esc(wa(c.phone))}" target="_blank" rel="noopener">Abrir WhatsApp</a>
            <button type="button" class="btn btn-quiet btn-sm" id="c-sessions">Ver na lista de sessões</button></div>
        </div>
        <dl class="pac-summary tiles">
          <div><dt>Sessões feitas</dt><dd>${c.done}</dd></div>
          <div><dt>Próxima sessão</dt><dd class="dd-sm">${c.nextSlot ? slotShort(c.nextSlot) : 'Nenhuma'}</dd></div>
          <div><dt>Pacotes ativos</dt><dd>${c.packagesActive}</dd></div>
          <div><dt>A receber</dt><dd>${brl.format(c.toReceive)}</dd></div>
          <div><dt>Já pago</dt><dd>${brl.format(c.paidTotal)}</dd></div>
        </dl>
        <h2 class="sub">Pacotes</h2>
        <div class="pac-list">${packages.length ? packages.map((p) => packageCard(p, { hideClient: true })).join('') : '<p class="empty">Esse cliente ainda não tem pacote.</p>'}</div>
        <h2 class="sub">Histórico de sessões</h2>
        ${sessionsTable(bookings, { hideClient: true, empty: 'Nenhuma sessão.' })}`;
      $('#c-back').addEventListener('click', () => closeClient());
      $('#c-sessions').addEventListener('click', () => { S.ses = { ...DEFAULTS.ses, q: c.key, period: 'tudo' }; S.cli.open = null; go('sessoes'); });
      if (!quiet) window.scrollTo({ top: 0 });
    } catch (err) { S.cli.open = null; fail(err); }
  }
  function closeClient(silent = false) {
    S.cli.open = null;
    $('#c-detail').hidden = true; $('#c-main').hidden = false;
    if (!silent) loadClientes();
  }

  // ---------- Pacotes ----------
  $('#p-q').addEventListener('input', debounce((e) => { S.pac.q = e.target.value.trim(); loadPacotes(); }));
  $('#p-status').addEventListener('change', (e) => { S.pac.status = e.target.value; loadPacotes(); });
  $('#p-paid').addEventListener('change', (e) => { S.pac.paid = e.target.value; loadPacotes(); });
  $('#p-ending').addEventListener('change', (e) => { S.pac.ending = e.target.checked; loadPacotes(); });
  $('#p-clear').addEventListener('click', () => { S.pac = { ...DEFAULTS.pac }; syncPackageControls(); loadPacotes(); });
  function syncPackageControls() { $('#p-q').value = S.pac.q; $('#p-status').value = S.pac.status; $('#p-paid').value = S.pac.paid; $('#p-ending').checked = S.pac.ending; }

  async function loadPacotes() {
    syncPackageControls();
    try {
      const f = S.pac;
      const { packages, summary } = await api(`/api/admin/packages${qs({ q: f.q, status: f.status, paid: f.paid, ending: f.ending ? 7 : '' })}`);
      $('#pac-summary').innerHTML = `
        <div><dt>Pacotes ativos</dt><dd>${summary.active}</dd>${summary.pending ? `<p>${plural(summary.pending, 'esperando confirmação', 'esperando confirmação')}</p>` : ''}</div>
        <div><dt>A receber</dt><dd>${brl.format(summary.toReceive)}</dd>${summary.noPrice ? `<p>${plural(summary.noPrice, 'pacote sem valor definido', 'pacotes sem valor definido')}</p>` : ''}</div>
        <div><dt>Terminam em até 7 dias</dt><dd>${summary.endingSoon}</dd>${summary.endingSoon ? '<p>Hora de falar sobre renovação.</p>' : ''}</div>`;
      $('#p-bar').innerHTML = `<b>${plural(packages.length, 'pacote', 'pacotes')}</b>`;
      $('#pac-list').innerHTML = packages.length ? packages.map((p) => packageCard(p)).join('')
        : '<p class="empty">Nenhum pacote com esses filtros. Quando você confirmar um pacote pedido pelo site, ele aparece em "Ativos".</p>';
    } catch (err) { fail(err); }
  }



  // ---------- Preços ----------
  const PLAN_COLS = [['avulso', 'Sessão avulsa'], ['pacote4', 'Pacote de 4 sessões'], ['pacote8', 'Pacote de 8 sessões']];
  const moneyIn = (v) => (v != null ? v.toFixed(2).replace('.', ',') : '');
  async function loadPrecos() {
    try {
      const { services: list, prices } = await api('/api/admin/prices');
      const groups = { reabilitacao: 'Reabilitação', 'bem-estar': 'Bem-estar' };
      $('#precos-tabela').innerHTML = `<table class="tbl tbl-precos"><thead><tr><th>Atendimento</th>${PLAN_COLS.map(([, n]) => `<th>${n}</th>`).join('')}</tr></thead><tbody>
        ${Object.entries(groups).map(([g, gname]) => `<tr class="grp"><th colspan="4">${gname}</th></tr>` + list.filter((s) => s.group === g).map((s) => `<tr>
          <td data-label="Atendimento"><b>${esc(s.name)}</b></td>
          ${PLAN_COLS.map(([plan, pname]) => `<td data-label="${pname}"><label class="money"><span>R$</span><input inputmode="decimal" data-price-svc="${s.id}" data-price-plan="${plan}" value="${moneyIn(prices[s.id][plan])}" placeholder="não definido" aria-label="${esc(s.name)}, ${pname}"></label></td>`).join('')}
        </tr>`).join('')).join('')}</tbody></table>`;
    } catch (err) { fail(err); }
  }
  document.addEventListener('change', async (e) => {
    const inp = e.target.closest('[data-price-svc]');
    if (!inp) return;
    try {
      await api('/api/admin/prices', { method: 'PUT', body: JSON.stringify({ service: inp.dataset.priceSvc, plan: inp.dataset.pricePlan, price: inp.value.trim() }) });
      setStatus('Preço salvo. Já aparece no site.', true);
    } catch (err) { fail(err); }
  });

  // ---------- Loja ----------
  const ORDER_LABEL = { novo: 'Novo', confirmado: 'Confirmado', pago: 'Pago', enviado: 'Enviado', entregue: 'Entregue', cancelado: 'Cancelado' };
  const ORDER_NEXT = { novo: ['confirmado', 'Confirmar e avisar'], confirmado: ['pago', 'Marcar como pago'], pago: ['enviado', 'Marcar como enviado'], enviado: ['entregue', 'Marcar como entregue'] };
  const L = { sub: 'pedidos', oq: '', ost: 'novo,confirmado,pago,enviado', cats: [] };
  $$('[data-sub]').forEach((b) => b.addEventListener('click', () => { L.sub = b.dataset.sub; loadLoja(); }));
  $('#o-q').addEventListener('input', debounce((e) => { L.oq = e.target.value.trim(); loadLoja(); }));
  $('#o-status').addEventListener('change', (e) => { L.ost = e.target.value; loadLoja(); });
  function loadLoja() {
    $$('[data-sub]').forEach((b) => (b.dataset.sub === L.sub ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current')));
    $('#loja-pedidos').hidden = L.sub !== 'pedidos';
    $('#loja-produtos').hidden = L.sub !== 'produtos';
    return L.sub === 'pedidos' ? loadOrders() : loadProducts();
  }
  function orderCard(o) {
    const [day, ] = o.created_at.split('T');
    const next = ORDER_NEXT[o.status];
    const msg = o.status === 'novo'
      ? `Olá, ${firstName(o.name)}! Aqui é a Gabriela. Recebi seu pedido da loja: ${o.items.map((l) => `${l.qty}x ${l.name}`).join(', ')}. Total ${brl.format(o.total)}. Como prefere pagar?`
      : o.status === 'pago' ? `Olá, ${firstName(o.name)}! Seu pedido da loja foi enviado.` : '';
    return `<article class="order status-${o.status}">
      <header><h3><b>#${o.id}</b> ${esc(o.name)} <span class="tag tag-o-${o.status}">${ORDER_LABEL[o.status]}</span></h3>
        <p class="muted">${shortDay(day)} · ${o.delivery === 'entrega' ? 'Entrega' : 'Retirada ou próxima sessão'}${o.address ? `, ${esc(o.address)}` : ''}</p></header>
      <ul class="order-items">${o.items.map((l) => `<li><span>${l.qty}x ${esc(l.name)}</span><span>${brl.format(l.price * l.qty)}</span></li>`).join('')}</ul>
      <p class="order-total"><span>Total</span><b>${brl.format(o.total)}</b></p>
      ${o.notes ? `<p class="b-notes">${esc(o.notes)}</p>` : ''}
      <footer class="pkg-actions">
        ${next ? `<button type="button" class="btn btn-primary btn-sm" data-order="${o.id}" data-ost="${next[0]}" ${o.status === 'novo' ? `data-wa="${esc(wa(o.phone, msg))}"` : ''}>${next[1]}</button>` : ''}
        <a class="link-btn" href="${esc(wa(o.phone, o.status === 'enviado' ? '' : ''))}" target="_blank" rel="noopener">Abrir conversa</a>
        ${o.status !== 'cancelado' && o.status !== 'entregue' ? `<button type="button" class="link-btn link-danger" data-order="${o.id}" data-ost="cancelado">Cancelar pedido</button>` : ''}
        ${o.status === 'cancelado' ? `<button type="button" class="link-btn" data-order="${o.id}" data-ost="novo">Reabrir</button>` : ''}
      </footer></article>`;
  }
  async function loadOrders() {
    try {
      const { orders, counts } = await api(`/api/admin/orders${qs({ status: L.ost, q: L.oq })}`);
      $('#o-bar').innerHTML = `<b>${plural(orders.length, 'pedido', 'pedidos')}</b> ${Object.entries(counts).map(([s, n]) => `<span class="tag">${n} ${ORDER_LABEL[s].toLowerCase()}</span>`).join('')}`;
      $('#o-list').innerHTML = orders.length ? orders.map(orderCard).join('') : '<p class="empty">Nenhum pedido da loja por aqui. Quando alguém pedir pelo site, ele aparece nesta lista.</p>';
    } catch (err) { fail(err); }
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-order]');
    if (!b) return;
    if (b.dataset.ost === 'cancelado' && !confirm('Cancelar este pedido? Os itens voltam para o estoque.')) return;
    const win = b.dataset.wa ? window.open(b.dataset.wa, '_blank', 'noopener') : null;
    b.disabled = true;
    try { await api(`/api/admin/orders/${b.dataset.order}`, { method: 'PATCH', body: JSON.stringify({ status: b.dataset.ost }) }); refresh(); }
    catch (err) { if (win) win.close(); b.disabled = false; fail(err); }
  });

  async function loadProducts() {
    try {
      const { categories, products } = await api('/api/admin/products');
      L.cats = categories;
      const sel = $('#prod-cat');
      if (!sel.options.length) categories.forEach((c) => sel.add(new Option(c.name, c.id)));
      $('#pr-bar').innerHTML = `<b>${plural(products.length, 'produto', 'produtos')}</b>`;
      $('#pr-list').innerHTML = products.length ? products.map((p) => productRow(p, categories)).join('') : '<p class="empty">Nenhum produto ainda. Use "Novo produto" para cadastrar o primeiro.</p>';
    } catch (err) { fail(err); }
  }
  function productRow(p, cats) {
    return `<article class="pa${p.active ? '' : ' is-off'}">
      <div class="pa-img">${p.photo ? `<img src="/api/fotos/p${p.id}?v=${p.photo}" alt="">` : '<span>Sem foto</span>'}
        <label class="link-btn">${p.photo ? 'Trocar foto' : 'Enviar foto'}<input type="file" accept="image/*" hidden data-foto="p${p.id}" data-ratio="1"></label>
        ${p.photo ? `<button type="button" class="link-btn link-danger" data-fotodel="p${p.id}">Remover foto</button>` : ''}</div>
      <div class="pa-main">
        <label class="field"><span>Nome</span><input data-pf="name" data-pid="${p.id}" value="${esc(p.name)}" maxlength="90"></label>
        <label class="field"><span>Descrição</span><input data-pf="description" data-pid="${p.id}" value="${esc(p.description)}" maxlength="400"></label>
        <div class="pa-row">
          <label class="field"><span>Categoria</span><select data-pf="category" data-pid="${p.id}">${cats.map((c) => `<option value="${c.id}"${c.id === p.category ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          <label class="field"><span>Preço (R$)</span><input data-pf="price" data-pid="${p.id}" inputmode="decimal" value="${moneyIn(p.price)}"></label>
          <label class="field"><span>Estoque</span><input data-pf="stock" data-pid="${p.id}" inputmode="numeric" value="${p.stock}"></label>
        </div>
        <div class="pa-row">
          <label class="field"><span>Link Mercado Livre <i>futuro</i></span><input data-pf="ml_url" data-pid="${p.id}" value="${esc(p.ml_url)}" placeholder="https://"></label>
          <label class="field"><span>Link Shopee <i>futuro</i></span><input data-pf="shopee_url" data-pid="${p.id}" value="${esc(p.shopee_url)}" placeholder="https://"></label>
        </div>
        <div class="pkg-actions">
          <label class="check"><input type="checkbox" data-pf="active" data-pid="${p.id}"${p.active ? ' checked' : ''}> Aparece na loja</label>
          ${p.stock <= 3 ? `<span class="tag tag-pendente">${p.stock === 0 ? 'Sem estoque' : 'Estoque baixo'}</span>` : ''}
          <button type="button" class="link-btn link-danger" data-pdel="${p.id}">Excluir produto</button>
        </div>
      </div></article>`;
  }
  document.addEventListener('change', async (e) => {
    const f = e.target.closest('[data-pf]');
    if (!f) return;
    const val = f.type === 'checkbox' ? f.checked : f.value.trim();
    try { await api(`/api/admin/products/${f.dataset.pid}`, { method: 'PATCH', body: JSON.stringify({ [f.dataset.pf]: val }) }); setStatus('Produto salvo.', true); if (['price', 'stock', 'active'].includes(f.dataset.pf)) loadProducts(); }
    catch (err) { fail(err); loadProducts(); }
  });
  document.addEventListener('click', async (e) => {
    const d = e.target.closest('[data-pdel]');
    if (!d || !confirm('Excluir este produto da loja? Pedidos antigos continuam no histórico.')) return;
    await api(`/api/admin/products/${d.dataset.pdel}`, { method: 'DELETE' }).catch(fail);
    loadProducts();
  });
  $('#prod-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/api/admin/products', { method: 'POST', body: JSON.stringify({ name: f.name.value, category: f.category.value, price: f.price.value, stock: f.stock.value, description: f.description.value }) });
      f.reset(); f.closest('details').open = false; setStatus('Produto cadastrado. Já aparece na loja.', true); loadProducts();
    } catch (err) { fail(err); }
  });

  // ---------- Fotos do site ----------
  const FOTOS = [
    { slot: 'retrato', titulo: 'Retrato (página inicial)', dica: 'Foto em pé, de preferência com a Gabi de frente ou levemente de lado.', ratio: 4 / 5 },
    { slot: 'atendimento', titulo: 'Em atendimento (Quem sou eu)', dica: 'Foto quadrada: a Gabi em atendimento ou posando com o material.', ratio: 1 },
  ];
  async function loadFotos() {
    try {
      const { fotos } = await fetch('/api/fotos').then((r) => r.json());
      $('#fotos-grid').innerHTML = FOTOS.map((f) => `
        <article class="foto-card">
          <div class="foto-prev" style="aspect-ratio:${f.ratio === 1 ? '1 / 1' : '4 / 5'}">${fotos[f.slot] ? `<img src="/api/fotos/${f.slot}?v=${Math.round(fotos[f.slot])}" alt="">` : '<p>Sem foto ainda</p>'}</div>
          <h3>${f.titulo}</h3>
          <p class="muted">${f.dica}</p>
          <div class="foto-acts">
            <label class="btn btn-primary btn-sm">${fotos[f.slot] ? 'Trocar foto' : 'Enviar foto'}<input type="file" accept="image/*" data-foto="${f.slot}" data-ratio="${f.ratio}" hidden></label>
            ${fotos[f.slot] ? `<button type="button" class="link-btn link-danger" data-fotodel="${f.slot}">Remover</button>` : ''}
          </div>
        </article>`).join('');
    } catch (err) { fail(err); }
  }
  // Corta no formato do site e reduz para ~1400px de altura antes de enviar.
  function prepararFoto(file, ratio) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        let sw = w, sh = w / ratio;
        if (sh > h) { sh = h; sw = h * ratio; }
        const sx = (w - sw) / 2, sy = (h - sh) / 2;
        const outH = Math.min(1400, Math.round(sh)), outW = Math.round(outH * ratio);
        const cv = document.createElement('canvas');
        cv.width = outW; cv.height = outH;
        cv.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
        cv.toBlob((b) => (b ? resolve(b) : reject(new Error('Não consegui preparar essa foto.'))), 'image/jpeg', 0.86);
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => reject(new Error('Não consegui abrir essa foto. Tente um JPG ou PNG.'));
      img.src = URL.createObjectURL(file);
    });
  }
  document.addEventListener('change', async (e) => {
    const inp = e.target.closest('input[data-foto]');
    if (!inp || !inp.files[0]) return;
    try {
      setStatus('Enviando foto…', true);
      const blob = await prepararFoto(inp.files[0], Number(inp.dataset.ratio));
      const r = await fetch(`/api/admin/fotos/${inp.dataset.foto}`, { method: 'PUT', body: blob, headers: { 'Content-Type': 'image/jpeg' }, credentials: 'same-origin' });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Não consegui enviar.');
      setStatus('Foto atualizada. Já aparece no site.', true);
      refresh();
    } catch (err) { setStatus(err.message); }
  });
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-fotodel]');
    if (!b || !confirm('Remover esta foto do site?')) return;
    await api(`/api/admin/fotos/${b.dataset.fotodel}`, { method: 'DELETE' }).catch(fail);
    refresh();
  });

  // ---------- Início ----------
  fetch('/api/services').then((r) => r.json()).then(({ services: s }) => { services = Object.fromEntries(s.map((x) => [x.id, x.name])); })
    .finally(() => fetch('/api/admin/me', { credentials: 'same-origin' }).then((r) => (r.ok ? showApp() : showLogin())).catch(showLogin));
})();
