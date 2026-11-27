(() => {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const STATUS_LABEL = { pendente: 'A confirmar', confirmado: 'Confirmado', recusado: 'Recusado', concluido: 'Concluído', cancelado: 'Cancelado' };
  const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

  let services = {};
  let filter = 'pendente';
  let pfilter = 'ativo';
  let view = 'pedidos';
  let calMonth = null; // "AAAA-MM"
  let calRows = [];

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const today = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  function dayTitle(day) {
    const d = new Date(`${day}T12:00:00Z`);
    const wd = WEEKDAYS[d.getUTCDay()];
    return `${wd[0].toUpperCase()}${wd.slice(1)}, ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`;
  }
  const shortDay = (day) => { const [, m, d] = day.split('-').map(Number); return `${d} de ${MONTHS[m - 1].slice(0, 3)}`; };
  const firstName = (n) => n.split(' ')[0];

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
    const list = p.sessionsList.filter((s) => ['pendente', 'confirmado'].includes(s.status))
      .map((s) => `• ${dayTitle(s.slot.slice(0, 10))}, às ${s.slot.slice(11)}`).join('\n');
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
  const status = (msg) => { $('#panel-status').textContent = msg || ''; };
  const fail = (err) => { if (err.message !== 'auth') status(err.message); };

  // ---------- Login ----------
  function showLogin() { $('#login').hidden = false; $('#app').hidden = true; $('#logout').hidden = true; $('#login-form [name=password]').focus(); }
  function showApp() { $('#login').hidden = true; $('#app').hidden = false; $('#logout').hidden = false; refresh(); loadBlocks(); }
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-status').textContent = '';
    try { await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password: e.target.password.value }) }); e.target.reset(); showApp(); }
    catch (err) { $('#login-status').textContent = err.body?.error || 'Não deu para entrar agora.'; }
  });
  $('#logout').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST' }).catch(() => {}); showLogin(); });

  // ---------- Navegação ----------
  $$('.views button').forEach((b) => b.addEventListener('click', () => {
    view = b.dataset.view;
    $$('.views button').forEach((x) => (x === b ? x.setAttribute('aria-current', 'page') : x.removeAttribute('aria-current')));
    $$('.view').forEach((v) => (v.hidden = v.id !== `view-${view}`));
    status('');
    refresh();
  }));
  $$('#view-pedidos .tabs [role=tab]').forEach((t) => t.addEventListener('click', () => {
    filter = t.dataset.status;
    $$('#view-pedidos .tabs [role=tab]').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    loadPedidos();
  }));
  $$('#view-pacotes .tabs [role=tab]').forEach((t) => t.addEventListener('click', () => {
    pfilter = t.dataset.pstatus;
    $$('#view-pacotes .tabs [role=tab]').forEach((x) => x.setAttribute('aria-selected', String(x === t)));
    loadPacotes();
  }));

  async function refresh() {
    updateCount();
    if (view === 'pedidos') loadPedidos();
    if (view === 'calendario') loadCalendar();
    if (view === 'pacotes') loadPacotes();
  }
  async function updateCount() {
    try {
      const [{ bookings }, { packages }] = await Promise.all([api('/api/admin/bookings?status=pendente'), api('/api/admin/packages?status=pendente')]);
      const n = bookings.filter((b) => !b.package_id).length + packages.length;
      $('#count-pendente').textContent = n ? `(${n})` : '';
    } catch {}
  }

  // ---------- Pedidos ----------
  async function loadPedidos() {
    status('');
    try {
      const [{ bookings }, pend] = await Promise.all([
        api(`/api/admin/bookings${filter ? `?status=${filter}` : ''}`),
        filter === 'pendente' ? api('/api/admin/packages?status=pendente') : Promise.resolve({ packages: [] }),
      ]);
      renderPedidos(filter === 'pendente' ? bookings.filter((b) => !b.package_id) : bookings, pend.packages);
    } catch (err) { fail(err); }
  }

  function bookingRow(b) {
    return `
      <article class="booking-row status-${b.status}">
        <div class="b-time">${esc(b.slot.slice(11))}</div>
        <div class="b-main">
          <h3>${esc(b.name)}${b.for_whom ? ` <span>para ${esc(b.for_whom)}</span>` : ''}</h3>
          <p class="b-svc">${esc(services[b.service] || b.service)} <span class="tag">${STATUS_LABEL[b.status]}</span>${b.package_id ? ' <span class="tag tag-pacote">Pacote</span>' : ''}</p>
          <p>${esc(b.address)}</p>
          <p><a href="tel:${esc(b.phone.replace(/[^\d+]/g, ''))}">${esc(b.phone)}</a></p>
          ${b.notes ? `<p class="b-notes">${esc(b.notes)}</p>` : ''}
        </div>
        <div class="b-actions">${bookingActions(b)}
          <a class="link-btn" href="${esc(wa(b.phone))}" target="_blank" rel="noopener">Abrir conversa</a>
        </div>
      </article>`;
  }
  function bookingActions(b) {
    if (b.status === 'pendente' && !b.package_id) return `
      <button class="btn btn-primary" data-id="${b.id}" data-set="confirmado" data-wa="${esc(waBooking(b, 'confirmar'))}">Confirmar e avisar</button>
      <button class="btn btn-quiet" data-id="${b.id}" data-set="recusado" data-wa="${esc(waBooking(b, 'recusar'))}">Recusar</button>`;
    if (b.status === 'confirmado') return `
      <button class="btn btn-primary" data-id="${b.id}" data-set="concluido">Marcar como concluída</button>
      <button class="btn btn-quiet" data-id="${b.id}" data-set="cancelado">Cancelar</button>`;
    return '';
  }

  function packageCardPending(p) {
    return `
      <article class="booking-row pkg-pending">
        <div class="b-time b-time-pkg">${p.sessions}<small>sessões</small></div>
        <div class="b-main">
          <h3>${esc(p.name)}</h3>
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

  function renderPedidos(rows, pendingPackages) {
    const list = $('#list');
    if (!rows.length && !pendingPackages.length) {
      const empty = { pendente: 'Nenhum pedido esperando confirmação. Novos pedidos do site aparecem aqui.', confirmado: 'Nenhum atendimento confirmado ainda.', concluido: 'Os atendimentos marcados como concluídos ficam aqui.', '': 'Ainda não chegou nenhum pedido pelo site.' };
      list.innerHTML = `<p class="empty">${empty[filter]}</p>`;
      return;
    }
    let html = '';
    if (pendingPackages.length) html += `<section class="day-group"><h2>Pacotes</h2>${pendingPackages.map(packageCardPending).join('')}</section>`;
    const byDay = {};
    rows.forEach((b) => (byDay[b.slot.slice(0, 10)] ||= []).push(b));
    html += Object.entries(byDay).map(([day, items]) => `<section class="day-group"><h2>${dayTitle(day)}</h2>${items.map(bookingRow).join('')}</section>`).join('');
    list.innerHTML = html;
  }

  // Ações (servem para pedidos, calendário e pacotes)
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-set], button[data-pset], button[data-paid]');
    if (!btn || !$('#app').contains(btn)) return;
    const set = btn.dataset.set || btn.dataset.pset;
    if (set === 'cancelado' && !confirm(btn.dataset.pkg ? 'Cancelar o pacote inteiro? As sessões ainda não feitas voltam a ficar livres no site.' : 'Cancelar este atendimento? O horário volta a ficar livre no site.')) return;
    // Abre o WhatsApp no mesmo clique (antes do await) para o navegador não bloquear a janela.
    const win = btn.dataset.wa ? window.open(btn.dataset.wa, '_blank', 'noopener') : null;
    btn.disabled = true;
    try {
      if (btn.dataset.paid !== undefined) {
        await api(`/api/admin/packages/${btn.dataset.pkg}`, { method: 'PATCH', body: JSON.stringify({ paid: btn.dataset.paid === '1' }) });
      } else if (btn.dataset.pkg) {
        await api(`/api/admin/packages/${btn.dataset.pkg}`, { method: 'PATCH', body: JSON.stringify({ status: set }) });
      } else {
        await api(`/api/admin/bookings/${btn.dataset.id}`, { method: 'PATCH', body: JSON.stringify({ status: set }) });
      }
      refresh();
    } catch (err) {
      if (win) win.close();
      btn.disabled = false;
      fail(err);
    }
  });

  // ---------- Calendário ----------
  const monthOf = (day) => day.slice(0, 7);
  function shiftMonth(ym, k) { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + k, 1)); return d.toISOString().slice(0, 7); }
  $('#cal-prev').addEventListener('click', () => { calMonth = shiftMonth(calMonth, -1); loadCalendar(); });
  $('#cal-next').addEventListener('click', () => { calMonth = shiftMonth(calMonth, 1); loadCalendar(); });
  $('#cal-today').addEventListener('click', () => { calMonth = monthOf(today()); loadCalendar(); });

  async function loadCalendar() {
    calMonth ||= monthOf(today());
    const [y, m] = calMonth.split('-').map(Number);
    $('#cal-month').textContent = `${MONTHS[m - 1][0].toUpperCase()}${MONTHS[m - 1].slice(1)} de ${y}`;
    try {
      const { bookings } = await api(`/api/admin/bookings?from=${calMonth}-01&to=${shiftMonth(calMonth, 1)}-01`);
      calRows = bookings.filter((b) => b.status === 'confirmado' || b.status === 'concluido');
      renderCalendar();
    } catch (err) { fail(err); }
  }

  function renderCalendar() {
    const [y, m] = calMonth.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7; // semana começa na segunda
    const byDay = {};
    calRows.forEach((b) => (byDay[b.slot.slice(0, 10)] ||= []).push(b));
    const t = today();
    let html = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'].map((d) => `<div class="cal-wd" aria-hidden="true">${d}</div>`).join('');
    for (let i = 0; i < lead; i++) html += '<div class="cal-cell cal-pad" aria-hidden="true"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const day = `${calMonth}-${String(d).padStart(2, '0')}`;
      const items = byDay[day] || [];
      html += `
        <div class="cal-cell${day === t ? ' is-today' : ''}${items.length ? ' has-items' : ''}${day < t ? ' is-past' : ''}">
          <div class="cal-day"><b>${d}</b><span class="cal-day-long">${dayTitle(day)}</span></div>
          ${items.map((b) => `<button type="button" class="cal-item${b.package_id ? ' is-pkg' : ''}${b.status === 'concluido' ? ' is-done' : ''}" data-booking="${b.id}">
              <span class="cal-time">${b.slot.slice(11)}</span> ${esc(firstName(b.name))}</button>`).join('')}
        </div>`;
    }
    $('#cal-grid').innerHTML = html;
    if (!calRows.length) $('#cal-grid').insertAdjacentHTML('beforeend', '<p class="empty cal-empty">Nenhum atendimento confirmado neste mês.</p>');
    $('#cal-detail').hidden = true;
  }
  $('#cal-grid').addEventListener('click', (e) => {
    const it = e.target.closest('[data-booking]');
    if (!it) return;
    const b = calRows.find((x) => String(x.id) === it.dataset.booking);
    const box = $('#cal-detail');
    box.innerHTML = `<h2>${dayTitle(b.slot.slice(0, 10))}</h2>${bookingRow(b)}`;
    box.hidden = false;
    box.scrollIntoView({ block: 'nearest' });
    box.focus({ preventScroll: true });
  });

  // ---------- Pacotes ----------
  async function loadPacotes() {
    status('');
    try {
      const { packages } = await api('/api/admin/packages');
      renderSummary(packages);
      const shown = pfilter === 'encerrados'
        ? packages.filter((p) => ['concluido', 'cancelado', 'recusado'].includes(p.status)).reverse()
        : packages.filter((p) => p.status === pfilter);
      renderPacotes(shown);
    } catch (err) { fail(err); }
  }

  function renderSummary(all) {
    const active = all.filter((p) => p.status === 'ativo');
    const unpaid = all.filter((p) => ['ativo', 'concluido'].includes(p.status) && !p.paid);
    const toReceive = unpaid.reduce((s, p) => s + (p.price || 0), 0);
    const noPrice = unpaid.filter((p) => p.price == null).length;
    const soon = active.filter((p) => p.daysLeft <= 7);
    $('#pac-summary').innerHTML = `
      <div><dt>Pacotes ativos</dt><dd>${active.length}</dd></div>
      <div><dt>A receber</dt><dd>${brl.format(toReceive)}</dd>${noPrice ? `<p>${noPrice} ${noPrice > 1 ? 'pacotes' : 'pacote'} sem valor definido</p>` : ''}</div>
      <div><dt>Terminam em até 7 dias</dt><dd>${soon.length}</dd>${soon.length ? `<p>Hora de falar sobre renovação.</p>` : ''}</div>`;
  }

  function bar(label, pct, text, cls = '') {
    return `<div class="meter ${cls}">
      <div class="meter-top"><span>${label}</span><span>${text}</span></div>
      <div class="meter-track" role="progressbar" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><div class="meter-fill" style="width:${Math.min(100, pct)}%"></div></div>
    </div>`;
  }

  function renderPacotes(rows) {
    const list = $('#pac-list');
    if (!rows.length) {
      const empty = { ativo: 'Nenhum pacote ativo. Quando você confirmar um pacote pedido pelo site, ele aparece aqui.', pendente: 'Nenhum pacote esperando confirmação.', encerrados: 'Pacotes concluídos, cancelados ou recusados ficam aqui.' };
      list.innerHTML = `<p class="empty">${empty[pfilter]}</p>`;
      return;
    }
    if (pfilter === 'pendente') { list.innerHTML = rows.map(packageCardPending).join(''); return; }
    list.innerHTML = rows.map((p) => {
      const urgent = p.status === 'ativo' && p.daysLeft <= 7;
      const sessText = `${p.done} de ${p.sessions} feitas (${p.progress}%)`;
      const timeText = p.expired ? `terminou em ${shortDay(p.end_day)}` : p.daysElapsed === 0 ? `começa em ${shortDay(p.start_day)}, termina em ${shortDay(p.end_day)}` : `dia ${p.daysElapsed} de 30, termina em ${shortDay(p.end_day)} (${p.daysLeft} ${p.daysLeft === 1 ? 'dia' : 'dias'})`;
      const behind = p.status === 'ativo' && p.timeProgress - p.progress >= 40;
      return `
      <article class="pkg${urgent ? ' is-urgent' : ''}">
        <header class="pkg-head">
          <div>
            <h3>${esc(p.name)}</h3>
            <p>Pacote de ${p.sessions} sessões de ${esc((services[p.service] || p.service).toLowerCase())}${p.status !== 'ativo' ? ` <span class="tag">${{ concluido: 'Concluído', cancelado: 'Cancelado', recusado: 'Recusado' }[p.status]}</span>` : ''}</p>
          </div>
          <div class="pkg-pay">
            <label class="field pkg-price"><span>Valor</span><input inputmode="decimal" data-price="${p.id}" value="${p.price != null ? String(p.price.toFixed(2)).replace('.', ',') : ''}" placeholder="0,00" aria-label="Valor do pacote de ${esc(p.name)} em reais"></label>
            ${p.paid
              ? `<p class="paid">Pago em ${shortDay(p.paid_at.slice(0, 10))} <button type="button" class="link-btn" data-pkg="${p.id}" data-paid="0">Desfazer</button></p>`
              : `<button type="button" class="btn btn-primary" data-pkg="${p.id}" data-paid="1">Marcar como pago</button>`}
          </div>
        </header>
        ${bar('Sessões', p.progress, sessText, 'meter-sess')}
        ${bar('Prazo de 30 dias', p.timeProgress, timeText, urgent ? 'meter-time is-urgent' : 'meter-time')}
        ${behind ? `<p class="b-hint">As sessões estão atrasadas em relação ao prazo. Vale remarcar as que foram canceladas.</p>` : ''}
        ${p.status === 'ativo' && p.sessions - p.done - p.scheduled > 0 ? `<p class="b-hint">${p.sessions - p.done - p.scheduled} ${p.sessions - p.done - p.scheduled > 1 ? 'sessões precisam' : 'sessão precisa'} ser remarcada${p.sessions - p.done - p.scheduled > 1 ? 's' : ''}.</p>` : ''}
        <ul class="pkg-dots" aria-label="Sessões do pacote">${p.sessionsList.map((s) => `<li class="dot-${s.status}" title="${STATUS_LABEL[s.status]}">${shortDay(s.slot.slice(0, 10))} ${s.slot.slice(11)} <span>${STATUS_LABEL[s.status]}</span></li>`).join('')}</ul>
        <footer class="pkg-actions">
          ${['ativo', 'concluido'].includes(p.status) ? `<a class="btn ${urgent || p.status === 'concluido' ? 'btn-primary' : 'btn-quiet'}" href="${esc(waPackage(p, 'renovar'))}" target="_blank" rel="noopener">Oferecer renovação</a>` : ''}
          <a class="link-btn" href="${esc(wa(p.phone))}" target="_blank" rel="noopener">Abrir conversa</a>
          ${p.status === 'ativo' ? `<button type="button" class="link-btn link-danger" data-pkg="${p.id}" data-pset="cancelado">Cancelar pacote</button>` : ''}
        </footer>
      </article>`;
    }).join('');
  }

  $('#pac-list').addEventListener('change', async (e) => {
    const inp = e.target.closest('[data-price]');
    if (!inp) return;
    try {
      await api(`/api/admin/packages/${inp.dataset.price}`, { method: 'PATCH', body: JSON.stringify({ price: inp.value.trim() }) });
      status('Valor salvo.');
      loadPacotes();
    } catch (err) { fail(err); }
  });

  // ---------- Dias de folga ----------
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

  fetch('/api/services').then((r) => r.json()).then(({ services: s }) => { services = Object.fromEntries(s.map((x) => [x.id, x.name])); })
    .finally(() => fetch('/api/admin/me', { credentials: 'same-origin' }).then((r) => (r.ok ? showApp() : showLogin())).catch(showLogin));
})();
