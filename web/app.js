(() => {
  'use strict';
  const cfg = window.GABI || {};
  const $ = (s, el = document) => el.querySelector(s);

  const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const WD_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const PLANS = { avulso: 1, pacote4: 4, pacote8: 8 };
  const WINDOW_DAYS = 30;

  // picks: horários escolhidos ("AAAA-MM-DDTHH:MM"); day: dia aberto no seletor
  const state = { slots: [], services: [], plan: 'avulso', picks: [], day: null };
  const need = () => PLANS[state.plan];

  if (cfg.whatsapp) {
    document.querySelectorAll('.js-whatsapp').forEach((a) => {
      a.href = `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent('Olá, Gabriela! Vim pelo site e queria tirar uma dúvida.')}`;
      a.target = '_blank'; a.rel = 'noopener'; a.hidden = false;
    });
  }

  function localToday() { return new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); }
  function addDays(day, k) { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }
  function weekdayOf(day) { return new Date(`${day}T12:00:00Z`).getUTCDay(); }
  function dayLabel(day) {
    const [, m, d] = day.split('-').map(Number);
    if (day === localToday()) return `Hoje, ${d} de ${MONTHS[m - 1]}`;
    if (day === addDays(localToday(), 1)) return `Amanhã, ${d} de ${MONTHS[m - 1]}`;
    const wd = WEEKDAYS[weekdayOf(day)];
    return `${wd[0].toUpperCase()}${wd.slice(1)}, ${d} de ${MONTHS[m - 1]}`;
  }
  const slotLabel = (s) => `${dayLabel(s.slice(0, 10))}, às ${s.slice(11)}`;

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

  // ---------- Agenda do topo ----------
  function renderAgenda() {
    const box = $('#agenda-days');
    box.innerHTML = '';
    if (!state.slots.length) {
      box.innerHTML = '<p class="agenda-loading">A agenda das próximas semanas está cheia. Deixe seu pedido pelo WhatsApp que a Gabriela encaixa assim que abrir horário.</p>';
      return;
    }
    for (const d of state.slots.slice(0, 3)) {
      const wrap = document.createElement('div');
      wrap.className = 'agenda-day';
      const h = document.createElement('h3');
      h.textContent = dayLabel(d.day);
      const times = document.createElement('div');
      times.className = 'agenda-times';
      for (const t of d.times.slice(0, 5)) {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = t;
        b.setAttribute('aria-label', `Reservar ${h.textContent} às ${t}`);
        b.addEventListener('click', () => {
          state.day = d.day;
          togglePick(`${d.day}T${t}`, true);
          $('#agendar').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
          setTimeout(() => (!$('#service').value ? $('#service') : $('input[name="plan"]:checked')).focus({ preventScroll: true }), 400);
        });
        times.append(b);
      }
      wrap.append(h, times);
      box.append(wrap);
    }
  }

  // ---------- Seletor de dia e horário ----------
  function windowEnd() {
    if (need() === 1 || !state.picks.length) return null;
    return addDays(state.picks[0].slice(0, 10), WINDOW_DAYS - 1);
  }
  function dayAllowed(day) {
    if (need() === 1 || !state.picks.length) return true;
    // Todas as sessões, contando a nova, precisam caber em 30 dias.
    const days = [...state.picks.map((s) => s.slice(0, 10)), day].sort();
    return days[days.length - 1] <= addDays(days[0], WINDOW_DAYS - 1);
  }
  const pickOnDay = (day) => state.picks.find((s) => s.startsWith(day));

  function renderDays() {
    const box = $('#day-picker');
    box.innerHTML = '';
    if (!state.slots.length) { box.innerHTML = '<p class="picked">Sem horários livres nas próximas semanas.</p>'; return; }
    const horizon = need() === 1 ? state.slots.slice(0, 21) : state.slots;
    for (const d of horizon) {
      const [, m, dd] = d.day.split('-').map(Number);
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.day = d.day;
      b.setAttribute('aria-checked', String(state.day === d.day));
      const allowed = dayAllowed(d.day);
      b.disabled = !allowed;
      if (pickOnDay(d.day)) b.classList.add('has-pick');
      b.setAttribute('aria-label', `${dayLabel(d.day)}${pickOnDay(d.day) ? ', sessão escolhida' : ''}${allowed ? '' : ', fora dos 30 dias do pacote'}`);
      b.innerHTML = `<span>${WD_SHORT[d.weekday]}</span><b>${dd}</b><span>${MONTHS[m - 1]}</span>`;
      b.addEventListener('click', () => openDay(d.day));
      box.append(b);
    }
  }
  function renderTimes() {
    const box = $('#time-picker');
    box.innerHTML = '';
    const d = state.slots.find((x) => x.day === state.day);
    if (!d) return;
    for (const t of d.times) {
      const slot = `${d.day}T${t}`;
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', need() === 1 ? 'radio' : 'checkbox'); b.textContent = t;
      b.setAttribute('aria-checked', String(state.picks.includes(slot)));
      b.addEventListener('click', () => togglePick(slot));
      box.append(b);
    }
  }
  function renderPicked() {
    const p = $('#picked');
    const n = need();
    const chosen = $('#chosen');
    chosen.innerHTML = '';
    if (n === 1) {
      if (state.picks[0]) p.innerHTML = `Horário escolhido: <strong>${slotLabel(state.picks[0])}</strong>`;
      else p.textContent = state.day ? 'Agora escolha o horário.' : 'Nenhum horário escolhido.';
      return;
    }
    const left = n - state.picks.length;
    const end = windowEnd();
    p.innerHTML = left > 0
      ? `<strong>${state.picks.length} de ${n} sessões escolhidas.</strong> ${state.picks.length ? `Escolha mais ${left}, até ${dayLabel(end).toLowerCase()}.` : 'Comece pela primeira sessão.'}`
      : `<strong>As ${n} sessões estão escolhidas.</strong>`;
    for (const s of state.picks) {
      const li = document.createElement('li');
      li.innerHTML = '<span></span><button type="button" class="link-btn">Tirar</button>';
      li.querySelector('span').textContent = slotLabel(s);
      li.querySelector('button').setAttribute('aria-label', `Tirar ${slotLabel(s)}`);
      li.querySelector('button').addEventListener('click', () => togglePick(s));
      chosen.append(li);
    }
  }
  function renderPicker() { renderDays(); renderTimes(); renderPicked(); }

  function openDay(day) {
    state.day = day;
    renderPicker();
    const btn = $(`#day-picker [data-day="${day}"]`);
    if (btn) btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    setError('slot', '');
  }
  function togglePick(slot, forceOn = false) {
    const n = need();
    const i = state.picks.indexOf(slot);
    if (i >= 0 && !forceOn) state.picks.splice(i, 1);
    else if (i < 0) {
      if (n === 1) state.picks = [slot];
      else {
        const sameDay = pickOnDay(slot.slice(0, 10));
        if (sameDay) state.picks.splice(state.picks.indexOf(sameDay), 1); // uma por dia: troca o horário
        if (state.picks.length >= n) { setError('slot', `O pacote tem ${n} sessões. Tire uma para escolher outra.`); return; }
        if (!dayAllowed(slot.slice(0, 10))) { setError('slot', 'Esse dia fica fora dos 30 dias do pacote.'); return; }
        state.picks.push(slot);
      }
    }
    state.picks.sort();
    state.day = slot.slice(0, 10);
    setError('slot', '');
    renderPicker();
  }

  document.querySelectorAll('input[name="plan"]').forEach((r) => r.addEventListener('change', () => {
    state.plan = r.value;
    const n = need();
    if (state.picks.length > n) state.picks = state.picks.slice(0, n);
    $('#plan-rule').hidden = n === 1;
    $('#slot-legend').textContent = n === 1 ? 'Dia e horário' : `As ${n} sessões`;
    renderPicker();
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
      const first = Object.keys(errs)[0];
      (first === 'slot' ? $('#day-picker') : form.elements[first]).scrollIntoView({ block: 'center' });
      if (first !== 'slot') form.elements[first].focus({ preventScroll: true });
      return;
    }
    const btn = $('#submit');
    btn.disabled = true; btn.textContent = 'Enviando pedido…';
    try {
      const r = await fetch('/api/bookings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const body = await r.json().catch(() => ({}));
      if (r.ok) {
        const n = need();
        $('#done-text').textContent = n === 1
          ? `Seu horário de ${slotLabel(state.picks[0]).toLowerCase()} está reservado. A Gabriela vai confirmar pelo WhatsApp no número informado.`
          : `Suas ${n} sessões estão reservadas, de ${dayLabel(state.picks[0].slice(0, 10)).toLowerCase()} a ${dayLabel(state.picks[n - 1].slice(0, 10)).toLowerCase()}. A Gabriela vai confirmar o pacote pelo WhatsApp no número informado.`;
        form.hidden = true; $('#done').hidden = false; $('#done').focus();
        loadSlots();
      } else if (body.errors) {
        Object.entries(body.errors).forEach(([k, v]) => setError(k, v));
        if (body.errors.slot) await loadSlots();
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
    renderPicker();
    $('#done').hidden = true; form.hidden = false;
    $('#service').focus();
  });

  async function loadSlots() {
    try {
      const { slots } = await getJson('/api/slots');
      state.slots = slots;
      const free = new Set(slots.flatMap((d) => d.times.map((t) => `${d.day}T${t}`)));
      state.picks = state.picks.filter((s) => free.has(s));
      if (state.day && !slots.some((d) => d.day === state.day)) state.day = null;
      renderAgenda(); renderPicker();
    } catch {
      $('#agenda-days').innerHTML = '<p class="agenda-loading">Não consegui carregar a agenda agora. Recarregue a página em instantes.</p>';
    }
  }

  getJson('/api/services').then(({ services }) => { state.services = services; renderServices(); }).catch(() => {});
  loadSlots();
})();
