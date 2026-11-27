(() => {
  'use strict';
  const cfg = window.GABI || {};
  const $ = (s, el = document) => el.querySelector(s);

  const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const WD_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  const state = { slots: [], services: [], day: null, time: null };

  // WhatsApp opcional
  if (cfg.whatsapp) {
    document.querySelectorAll('.js-whatsapp').forEach((a) => {
      a.href = `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent('Olá, Gabriela! Vim pelo site e queria tirar uma dúvida.')}`;
      a.target = '_blank'; a.rel = 'noopener'; a.hidden = false;
    });
  }

  function dayLabel(day, weekday) {
    const [, m, d] = day.split('-').map(Number);
    const todayStr = localToday();
    const tomorrow = addDays(todayStr, 1);
    if (day === todayStr) return `Hoje, ${d} de ${MONTHS[m - 1]}`;
    if (day === tomorrow) return `Amanhã, ${d} de ${MONTHS[m - 1]}`;
    return `${WEEKDAYS[weekday][0].toUpperCase()}${WEEKDAYS[weekday].slice(1)}, ${d} de ${MONTHS[m - 1]}`;
  }
  function localToday() {
    const n = new Date(Date.now() - 3 * 3600e3);
    return n.toISOString().slice(0, 10);
  }
  function addDays(day, k) {
    const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + k);
    return d.toISOString().slice(0, 10);
  }

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
      h.textContent = dayLabel(d.day, d.weekday);
      const times = document.createElement('div');
      times.className = 'agenda-times';
      for (const t of d.times.slice(0, 5)) {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = t;
        b.setAttribute('aria-label', `Reservar ${h.textContent} às ${t}`);
        b.addEventListener('click', () => {
          pickDay(d.day); pickTime(t);
          $('#agendar').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
          setTimeout(() => (!$('#service').value ? $('#service') : $('input[name="name"]')).focus({ preventScroll: true }), 400);
        });
        times.append(b);
      }
      wrap.append(h, times);
      box.append(wrap);
    }
  }

  // ---------- Seletor de dia e horário ----------
  function renderDays() {
    const box = $('#day-picker');
    box.innerHTML = '';
    for (const d of state.slots) {
      const [, m, dd] = d.day.split('-').map(Number);
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.dataset.day = d.day;
      b.setAttribute('aria-checked', String(state.day === d.day));
      b.setAttribute('aria-label', dayLabel(d.day, d.weekday));
      b.innerHTML = `<span>${WD_SHORT[d.weekday]}</span><b>${dd}</b><span>${MONTHS[m - 1]}</span>`;
      b.addEventListener('click', () => pickDay(d.day));
      box.append(b);
    }
    if (!state.slots.length) box.innerHTML = '<p class="picked">Sem horários livres nas próximas semanas.</p>';
  }
  function renderTimes() {
    const box = $('#time-picker');
    box.innerHTML = '';
    const d = state.slots.find((x) => x.day === state.day);
    if (!d) return;
    for (const t of d.times) {
      const b = document.createElement('button');
      b.type = 'button'; b.setAttribute('role', 'radio'); b.textContent = t;
      b.setAttribute('aria-checked', String(state.time === t));
      b.addEventListener('click', () => pickTime(t));
      box.append(b);
    }
  }
  function renderPicked() {
    const p = $('#picked');
    const d = state.slots.find((x) => x.day === state.day);
    if (d && state.time) p.innerHTML = `Horário escolhido: <strong>${dayLabel(d.day, d.weekday)}, às ${state.time}</strong>`;
    else if (d) p.textContent = 'Agora escolha o horário.';
    else p.textContent = 'Nenhum horário escolhido.';
  }
  function pickDay(day) {
    if (state.day !== day) state.time = null;
    state.day = day;
    renderDays(); renderTimes(); renderPicked();
    const btn = $(`#day-picker [data-day="${day}"]`);
    if (btn) btn.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    setError('slot', '');
  }
  function pickTime(t) { state.time = t; renderTimes(); renderPicked(); setError('slot', ''); }

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
    if (!data.service) e.service = 'Escolha um atendimento.';
    if (!data.slot) e.slot = 'Escolha um dia e um horário.';
    if ((data.name || '').trim().length < 2) e.name = 'Escreva seu nome.';
    if ((data.phone || '').replace(/\D/g, '').length < 10) e.phone = 'Informe um telefone com DDD.';
    if ((data.address || '').trim().length < 5) e.address = 'Informe o endereço do atendimento.';
    return e;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.slot = state.day && state.time ? `${state.day}T${state.time}` : '';
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
        const d = state.slots.find((x) => x.day === state.day);
        $('#done-text').textContent = `Seu horário de ${dayLabel(d.day, d.weekday).toLowerCase()}, às ${state.time}, está reservado. A Gabriela vai confirmar pelo WhatsApp no número informado.`;
        form.hidden = true; $('#done').hidden = false; $('#done').focus();
        loadSlots();
      } else if (body.errors) {
        Object.entries(body.errors).forEach(([k, v]) => setError(k, v));
        if (body.errors.slot) { state.time = null; await loadSlots(); }
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
    form.reset(); state.day = null; state.time = null;
    renderDays(); renderTimes(); renderPicked();
    $('#done').hidden = true; form.hidden = false;
    $('#service').focus();
  });

  async function loadSlots() {
    try {
      const { slots } = await getJson('/api/slots');
      state.slots = slots;
      if (state.day && !slots.some((d) => d.day === state.day)) { state.day = null; state.time = null; }
      renderAgenda(); renderDays(); renderTimes(); renderPicked();
    } catch {
      $('#agenda-days').innerHTML = '<p class="agenda-loading">Não consegui carregar a agenda agora. Recarregue a página em instantes.</p>';
    }
  }

  getJson('/api/services').then(({ services }) => { state.services = services; renderServices(); }).catch(() => {});
  loadSlots();
})();
