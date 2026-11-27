(() => {
  'use strict';
  const cfg = window.GABI || {};
  const $ = (s, el = document) => el.querySelector(s);

  const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  const PLANS = { avulso: 1, pacote4: 4, pacote8: 8 };
  const PLAN_NAME = { avulso: 'Sessão avulsa', pacote4: 'Pacote de 4 sessões', pacote8: 'Pacote de 8 sessões' };
  const WINDOW_DAYS = 30;
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const state = {
    services: [],
    free: new Map(),   // "AAAA-MM-DD" -> ["08:00", ...] horários livres
    today: '', until: '',
    months: [],        // ["2026-11", ..., "2027-12"]
    month: '',         // mês exibido no calendário
    plan: 'avulso',
    picks: [],         // "AAAA-MM-DDTHH:MM", sempre ordenados
    day: null,         // dia aberto (mostra os horários)
  };
  const need = () => PLANS[state.plan];

  if (cfg.whatsapp) {
    document.querySelectorAll('.js-whatsapp').forEach((a) => {
      a.href = `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent('Olá, Gabriela! Vim pelo site e queria tirar uma dúvida.')}`;
      a.target = '_blank'; a.rel = 'noopener'; a.hidden = false;
    });
  }

  // ---------- Datas ----------
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const parts = (day) => day.split('-').map(Number);
  function addDays(day, k) { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }
  const weekdayOf = (day) => new Date(`${day}T12:00:00Z`).getUTCDay();
  const cap = (t) => t[0].toUpperCase() + t.slice(1);
  function dayLabel(day, short = false) {
    const [y, m, d] = parts(day);
    if (day === state.today) return `Hoje, ${d} de ${MONTHS[m - 1]}`;
    if (day === addDays(state.today, 1)) return `Amanhã, ${d} de ${MONTHS[m - 1]}`;
    const wd = WEEKDAYS[weekdayOf(day)];
    const month = short ? MONTHS[m - 1].slice(0, 3) : MONTHS[m - 1];
    const year = String(y) !== state.today.slice(0, 4) ? ` de ${y}` : '';
    return `${cap(wd)}, ${d} de ${month}${year}`;
  }
  const slotLabel = (s) => `${dayLabel(s.slice(0, 10))}, às ${s.slice(11)}`;
  const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return `${cap(MONTHS[m - 1])} de ${y}`; };

  async function getJson(url) {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }

  // ---------- Atendimentos ----------
  function renderServices() {
    const sel = $('#service');
    for (const g of ['reabilitacao', 'bem-estar']) {
      const ul = $(`#services-${g}`);
      ul.innerHTML = '';
      for (const s of state.services.filter((x) => x.group === g)) {
        const li = document.createElement('li');
        li.innerHTML = '<strong></strong><span></span>';
        li.querySelector('strong').textContent = s.name;
        li.querySelector('span').textContent = s.blurb;
        ul.append(li);
      }
    }
    for (const s of state.services) sel.add(new Option(s.name, s.id));
  }
  const serviceName = () => (state.services.find((s) => s.id === $('#service').value) || {}).name || '';

  // ---------- Agenda do topo ----------
  function renderAgenda() {
    const box = $('#agenda-days');
    box.innerHTML = '';
    const days = [...state.free.keys()].slice(0, 3);
    if (!days.length) {
      box.innerHTML = '<p class="agenda-loading">A agenda está cheia por enquanto. Chame a Gabriela no WhatsApp que ela encaixa assim que abrir horário.</p>';
      return;
    }
    for (const day of days) {
      const wrap = document.createElement('div');
      wrap.className = 'agenda-day';
      const h = document.createElement('h3');
      h.textContent = dayLabel(day);
      const times = document.createElement('div');
      times.className = 'agenda-times';
      for (const t of state.free.get(day).slice(0, 5)) {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = t;
        b.setAttribute('aria-label', `Reservar ${h.textContent} às ${t}`);
        b.addEventListener('click', () => {
          state.month = day.slice(0, 7);
          togglePick(`${day}T${t}`, true);
          $('#agendar').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth' });
          setTimeout(() => (!$('#service').value ? $('#service') : $('input[name="plan"]:checked')).focus({ preventScroll: true }), 400);
        });
        times.append(b);
      }
      wrap.append(h, times);
      box.append(wrap);
    }
  }

  // ---------- Calendário ----------
  const pickOnDay = (day) => state.picks.find((s) => s.startsWith(day));

  // Todas as sessões do pacote, contando a nova, precisam caber em 30 dias.
  function dayAllowed(day) {
    if (need() === 1 || !state.picks.length) return true;
    const days = [...state.picks.map((s) => s.slice(0, 10)), day].sort();
    return days[days.length - 1] <= addDays(days[0], WINDOW_DAYS - 1);
  }

  function renderMonthSelect() {
    const sel = $('#cal-month');
    sel.innerHTML = '';
    for (const ym of state.months) sel.add(new Option(monthLabel(ym), ym));
    sel.value = state.month;
  }

  function renderCalendar() {
    if (!state.month) return;
    const [y, m] = state.month.split('-').map(Number);
    const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const total = new Date(Date.UTC(y, m, 0)).getUTCDate();
    let html = '<span class="cal-pad" aria-hidden="true"></span>'.repeat(lead);
    for (let d = 1; d <= total; d++) {
      const day = `${state.month}-${String(d).padStart(2, '0')}`;
      const times = state.free.get(day);
      const allowed = Boolean(times) && dayAllowed(day);
      const cls = ['cal-day'];
      if (day === state.today) cls.push('is-today');
      if (state.day === day) cls.push('is-open');
      if (pickOnDay(day)) cls.push('has-pick');
      if (times && !allowed) cls.push('is-out');
      let label = `${dayLabel(day)}`;
      if (!times) label += ', sem horário livre';
      else if (!allowed) label += ', fora dos 30 dias do pacote';
      else label += `, ${times.length} ${times.length === 1 ? 'horário livre' : 'horários livres'}`;
      if (pickOnDay(day)) label += ', sessão escolhida';
      html += `<button type="button" class="${cls.join(' ')}" data-day="${day}" ${allowed ? '' : 'disabled'} aria-pressed="${state.day === day}" aria-label="${label}">${d}</button>`;
    }
    $('#cal-days').innerHTML = html;
    const i = state.months.indexOf(state.month);
    $('#cal-prev').disabled = i <= 0;
    $('#cal-next').disabled = i >= state.months.length - 1;
    $('#cal-month').value = state.month;
  }

  function renderTimes() {
    const box = $('#times');
    const times = state.day && state.free.get(state.day);
    if (!times) {
      const first = [...state.free.keys()].find((d) => d.startsWith(state.month)) || [...state.free.keys()][0];
      box.innerHTML = `<p class="times-empty">Toque num dia do calendário para ver os horários livres.${first && !state.day ? ` O próximo dia livre é ${dayLabel(first).toLowerCase()}.` : ''}</p>`;
      return;
    }
    const mine = pickOnDay(state.day);
    box.innerHTML = `<h3>${dayLabel(state.day)}</h3>
      <p class="times-hint">${need() === 1 ? 'Escolha o horário.' : 'Uma sessão por dia. Toque de novo para tirar.'}</p>
      <div class="times-grid">${times.map((t) => `<button type="button" data-slot="${state.day}T${t}" aria-pressed="${mine === `${state.day}T${t}`}">${t}</button>`).join('')}</div>`;
  }

  function renderSuggest() {
    const n = need();
    const btn = $('#suggest');
    btn.hidden = !(n > 1 && state.picks.length >= 1 && state.picks.length < n);
    btn.textContent = state.picks.length === 1 ? `Sugerir as outras ${n - 1} sessões` : 'Refazer sugestão a partir da primeira';
  }

  function renderSummary() {
    const n = need();
    const svc = serviceName();
    let sess;
    if (!state.picks.length) sess = `<p class="sum-empty">${n === 1 ? 'Nenhum horário escolhido.' : `Nenhuma das ${n} sessões escolhida.`}</p>`;
    else sess = `<ol class="sum-list">${state.picks.map((s) => `<li><span>${slotLabel(s)}</span>${n > 1 ? `<button type="button" class="link-btn" data-remove="${s}" aria-label="Tirar ${slotLabel(s)}">Tirar</button>` : ''}</li>`).join('')}</ol>`;
    let meter = '';
    if (n > 1) {
      const pct = Math.round((state.picks.length / n) * 100);
      const end = state.picks.length ? addDays(state.picks[0].slice(0, 10), WINDOW_DAYS - 1) : '';
      meter = `<div class="sum-meter"><div class="meter-top"><span>${state.picks.length} de ${n} sessões</span></div>
        <div class="meter-track" role="progressbar" aria-label="Sessões escolhidas" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${state.picks.length}"><div class="meter-fill" style="width:${pct}%"></div></div></div>
        ${end ? `<p class="sum-deadline">Todas até ${dayLabel(end, true).toLowerCase()}.</p>` : ''}`;
    }
    $('#summary-body').innerHTML = `<dl class="sum">
      <div><dt>Atendimento</dt><dd>${svc ? svc : '<span class="sum-empty">Ainda não escolhido</span>'}</dd></div>
      <div><dt>Plano</dt><dd>${PLAN_NAME[state.plan]}</dd></div>
    </dl>${meter}${sess}`;
  }

  function renderAll() { renderCalendar(); renderTimes(); renderSuggest(); renderSummary(); }

  function openDay(day) {
    state.day = day;
    renderAll();
    if (matchMedia('(max-width: 759px)').matches) $('#times').scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
    setError('slot', '');
  }

  function togglePick(slot, forceOn = false) {
    const n = need();
    const day = slot.slice(0, 10);
    const i = state.picks.indexOf(slot);
    if (i >= 0 && !forceOn) state.picks.splice(i, 1);
    else if (i < 0) {
      if (n === 1) state.picks = [slot];
      else {
        const same = pickOnDay(day);
        if (same) state.picks.splice(state.picks.indexOf(same), 1); // uma por dia: troca o horário
        if (state.picks.length >= n) { setError('slot', `O pacote tem ${n} sessões. Tire uma para escolher outra.`); renderAll(); return; }
        if (!dayAllowed(day)) { setError('slot', 'Esse dia fica fora dos 30 dias do pacote.'); renderAll(); return; }
        state.picks.push(slot);
      }
    }
    state.picks.sort();
    state.day = day;
    state.month = day.slice(0, 7);
    setError('slot', '');
    renderMonthSelect();
    renderAll();
  }

  // Monta as demais sessões repetindo o horário da primeira: toda semana (4) ou duas vezes por semana (8).
  function suggest() {
    const n = need();
    if (n === 1 || !state.picks.length) return;
    const first = state.picks[0];
    const start = first.slice(0, 10);
    const pref = toMin(first.slice(11));
    const end = addDays(start, WINDOW_DAYS - 1);
    const offsets = n === 4 ? [7, 14, 21] : [3, 7, 10, 14, 17, 21, 24];
    const used = new Set([start]);
    const picked = [first];
    const closest = (times) => times.reduce((a, b) => (Math.abs(toMin(b) - pref) < Math.abs(toMin(a) - pref) ? b : a));
    const take = (day) => {
      const times = state.free.get(day);
      if (!times || used.has(day) || day <= start || day > end) return false;
      picked.push(`${day}T${closest(times)}`); used.add(day);
      return true;
    };
    for (const off of offsets) for (const delta of [0, 1, -1, 2, -2, 3]) if (take(addDays(start, off + delta))) break;
    for (let i = 1; i < WINDOW_DAYS && picked.length < n; i++) take(addDays(start, i));
    state.picks = picked.slice(0, n).sort();
    state.day = start;
    setError('slot', picked.length < n ? 'Não achei horários livres suficientes nesse prazo. Escolha os dias que faltam no calendário.' : '');
    renderAll();
    $('#summary').scrollIntoView({ block: 'nearest', behavior: reduceMotion() ? 'auto' : 'smooth' });
  }

  // ---------- Eventos do calendário e do plano ----------
  $('#cal-days').addEventListener('click', (e) => { const b = e.target.closest('[data-day]'); if (b && !b.disabled) openDay(b.dataset.day); });
  $('#times').addEventListener('click', (e) => { const b = e.target.closest('[data-slot]'); if (b) togglePick(b.dataset.slot); });
  $('#summary').addEventListener('click', (e) => { const b = e.target.closest('[data-remove]'); if (b) togglePick(b.dataset.remove); });
  $('#cal-prev').addEventListener('click', () => { const i = state.months.indexOf(state.month); if (i > 0) { state.month = state.months[i - 1]; renderCalendar(); } });
  $('#cal-next').addEventListener('click', () => { const i = state.months.indexOf(state.month); if (i < state.months.length - 1) { state.month = state.months[i + 1]; renderCalendar(); } });
  $('#cal-month').addEventListener('change', (e) => { state.month = e.target.value; renderCalendar(); });
  $('#suggest').addEventListener('click', suggest);
  $('#service').addEventListener('change', () => { setError('service', ''); renderSummary(); });

  document.querySelectorAll('input[name="plan"]').forEach((r) => r.addEventListener('change', () => {
    state.plan = r.value;
    const n = need();
    if (state.picks.length > n) state.picks = state.picks.slice(0, n);
    if (n > 1 && state.picks.length) { // mantém só o que cabe nos 30 dias da primeira
      const end = addDays(state.picks[0].slice(0, 10), WINDOW_DAYS - 1);
      state.picks = state.picks.filter((s) => s.slice(0, 10) <= end);
    }
    $('#plan-rule').hidden = n === 1;
    $('#slot-legend').textContent = n === 1 ? 'Dia e horário' : `Escolha as ${n} sessões`;
    setError('slot', '');
    renderAll();
  }));

  // ---------- Envio ----------
  const form = $('#booking-form');
  function setError(name, msg) {
    const el = form.querySelector(`.error[data-for="${name}"]`);
    if (el) el.textContent = msg || '';
    const input = form.elements[name];
    if (input && input.setAttribute) input.setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  function clientErrors(data) {
    const e = {};
    const n = need();
    if (!data.service) e.service = 'Escolha um atendimento.';
    if (state.picks.length !== n) e.slot = n === 1 ? 'Escolha um dia e um horário.' : `Escolha as ${n} sessões do pacote (faltam ${n - state.picks.length}).`;
    if ((data.name || '').trim().length < 2) e.name = 'Escreva seu nome.';
    if ((data.phone || '').replace(/\D/g, '').length < 10) e.phone = 'Informe um telefone com DDD.';
    if ((data.address || '').trim().length < 5) e.address = 'Informe o endereço do atendimento.';
    return e;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.plan = state.plan;
    data.slots = state.picks.slice();
    ['service', 'slot', 'name', 'phone', 'address'].forEach((k) => setError(k, ''));
    $('#form-status').textContent = '';
    const errs = clientErrors(data);
    if (Object.keys(errs).length) {
      Object.entries(errs).forEach(([k, v]) => setError(k, v));
      const first = ['service', 'slot', 'name', 'phone', 'address'].find((k) => errs[k]);
      const target = first === 'slot' ? $('#step-dates') : form.elements[first];
      target.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
      if (first !== 'slot') form.elements[first].focus({ preventScroll: true });
      $('#form-status').textContent = 'Falta preencher o que está destacado em vermelho.';
      return;
    }
    const btn = $('#submit');
    btn.disabled = true; btn.textContent = 'Enviando pedido…';
    try {
      const r = await fetch('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const body = await r.json().catch(() => ({}));
      if (r.ok) {
        const n = need();
        const picks = state.picks.slice();
        $('#done-text').textContent = n === 1
          ? `Seu horário de ${slotLabel(picks[0]).toLowerCase()} está reservado. A Gabriela vai confirmar pelo WhatsApp no número informado.`
          : `Suas ${n} sessões estão reservadas, de ${dayLabel(picks[0].slice(0, 10)).toLowerCase()} a ${dayLabel(picks[n - 1].slice(0, 10)).toLowerCase()}. A Gabriela vai confirmar o pacote pelo WhatsApp no número informado.`;
        $('#book-layout').hidden = true; $('#done').hidden = false; $('#done').focus();
        $('#done').scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
        state.picks = []; state.day = null;
        loadSlots();
      } else if (body.errors) {
        Object.entries(body.errors).forEach(([k, v]) => setError(k, v));
        if (body.errors.slot) { await loadSlots(); $('#step-dates').scrollIntoView({ block: 'center' }); }
      } else {
        $('#form-status').textContent = body.error || 'Não deu para enviar agora. Tente de novo em instantes.';
      }
    } catch {
      $('#form-status').textContent = 'Sem conexão com o servidor. Confira sua internet e tente de novo.';
    } finally {
      btn.disabled = false; btn.textContent = 'Pedir agendamento';
    }
  });

  $('#new-booking').addEventListener('click', () => {
    form.reset(); state.plan = 'avulso'; state.picks = []; state.day = null;
    $('#plan-rule').hidden = true; $('#slot-legend').textContent = 'Dia e horário';
    $('#done').hidden = true; $('#book-layout').hidden = false;
    renderAll();
    $('#service').focus();
  });

  // ---------- Carga inicial ----------
  async function loadSlots() {
    try {
      const { slots, today, until } = await getJson('/api/slots');
      state.today = today; state.until = until;
      state.free = new Map(slots.map((d) => [d.day, d.times]));
      const months = [];
      for (let ym = today.slice(0, 7); ym <= until.slice(0, 7);) {
        months.push(ym);
        const [y, m] = ym.split('-').map(Number);
        ym = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
      }
      state.months = months;
      const firstDay = slots.length ? slots[0].day : today;
      if (!state.month || !months.includes(state.month)) state.month = firstDay.slice(0, 7);
      const free = new Set(slots.flatMap((d) => d.times.map((t) => `${d.day}T${t}`)));
      state.picks = state.picks.filter((s) => free.has(s));
      if (state.day && !state.free.has(state.day)) state.day = null;
      renderMonthSelect(); renderAgenda(); renderAll();
    } catch {
      $('#agenda-days').innerHTML = '<p class="agenda-loading">Não consegui carregar a agenda agora. Recarregue a página em instantes.</p>';
      $('#times').innerHTML = '<p class="times-empty">Não consegui carregar os horários. Recarregue a página em instantes.</p>';
    }
  }

  getJson('/api/services').then(({ services }) => { state.services = services; renderServices(); renderSummary(); }).catch(() => {});
  renderSummary();
  loadSlots();
})();
