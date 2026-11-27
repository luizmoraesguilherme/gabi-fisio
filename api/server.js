// API do site da Gabi — Node 22, sem dependências externas.
// Banco: SQLite embutido (node:sqlite), arquivo em DATA_DIR.
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

if (!ADMIN_PASSWORD) console.warn('[aviso] ADMIN_PASSWORD vazio: o painel fica bloqueado.');

// ---------- Agenda (horário de Brasília, UTC-3 fixo) ----------
const SCHEDULE = {
  // 0 = domingo ... 6 = sábado
  days: { 1: ['08:00', '18:00'], 2: ['08:00', '18:00'], 3: ['08:00', '18:00'], 4: ['08:00', '18:00'], 5: ['08:00', '18:00'], 6: ['08:00', '12:00'] },
  stepMinutes: 90, // 60 min de atendimento + 30 de deslocamento
  minLeadHours: 12,
  bookUntil: '2027-12-31', // a agenda do site fica aberta até o fim de dezembro de 2027
};

// Pacotes: todas as sessões precisam caber em 30 dias a partir da primeira.
const PLANS = { avulso: 1, pacote4: 4, pacote8: 8 };
const PACKAGE_WINDOW_DAYS = 30;

const SERVICES = [
  { id: 'idosos', name: 'Fisioterapia para idosos', group: 'reabilitacao', minutes: 60, blurb: 'Força, equilíbrio e prevenção de quedas, com exercícios adaptados à casa.' },
  { id: 'reabilitacao', name: 'Reabilitação', group: 'reabilitacao', minutes: 60, blurb: 'Recuperação de lesões, dores e limitações de movimento.' },
  { id: 'pos-cirurgico', name: 'Pós-operatório', group: 'reabilitacao', minutes: 60, blurb: 'Retomada dos movimentos depois de cirurgias ortopédicas e outras.' },
  { id: 'pos-plastica', name: 'Pós-operatório de cirurgia plástica', group: 'reabilitacao', minutes: 60, blurb: 'Drenagem e cuidados para reduzir inchaço e fibrose.' },
  { id: 'gestantes', name: 'Fisioterapia para gestantes', group: 'reabilitacao', minutes: 60, blurb: 'Alívio de dores, postura e preparo do corpo para o parto.' },
  { id: 'drenagem', name: 'Drenagem linfática', group: 'bem-estar', minutes: 60, blurb: 'Reduz retenção de líquido e sensação de peso nas pernas.' },
  { id: 'massagem', name: 'Massagem relaxante', group: 'bem-estar', minutes: 60, blurb: 'Solta a musculatura e alivia a tensão do dia a dia.' },
  { id: 'pedras-quentes', name: 'Massagem com pedras quentes', group: 'bem-estar', minutes: 75, blurb: 'Calor das pedras somado à massagem para relaxamento profundo.' },
];
const SERVICE_IDS = new Set(SERVICES.map((s) => s.id));

const STATUSES = ['pendente', 'confirmado', 'recusado', 'concluido', 'cancelado'];
const BLOCKING = ['pendente', 'confirmado'];
const PACKAGE_STATUSES = ['pendente', 'ativo', 'concluido', 'recusado', 'cancelado'];

// ---------- Banco ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'gabi.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    service TEXT NOT NULL,
    slot TEXT NOT NULL,
    address TEXT NOT NULL,
    for_whom TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'pendente',
    updated_at TEXT
  );
  CREATE INDEX IF NOT EXISTS bookings_slot ON bookings(slot);
  CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    service TEXT NOT NULL,
    sessions INTEGER NOT NULL,
    start_day TEXT NOT NULL,
    end_day TEXT NOT NULL,
    address TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendente',
    price REAL,
    paid INTEGER NOT NULL DEFAULT 0,
    paid_at TEXT,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS blocks (
    day TEXT PRIMARY KEY,
    reason TEXT
  );
`);

// Migração: sessões podem pertencer a um pacote.
if (!db.prepare(`PRAGMA table_info(bookings)`).all().some((c) => c.name === 'package_id')) {
  db.exec(`ALTER TABLE bookings ADD COLUMN package_id INTEGER REFERENCES packages(id)`);
}

const q = {
  takenSlots: db.prepare(`SELECT slot FROM bookings WHERE slot >= ? AND status IN ('pendente','confirmado')`),
  slotTaken: db.prepare(`SELECT 1 FROM bookings WHERE slot = ? AND status IN ('pendente','confirmado') LIMIT 1`),
  insert: db.prepare(`INSERT INTO bookings (created_at, name, phone, service, slot, address, for_whom, notes, package_id) VALUES (?,?,?,?,?,?,?,?,?)`),
  insertPackage: db.prepare(`INSERT INTO packages (created_at, name, phone, service, sessions, start_day, end_day, address) VALUES (?,?,?,?,?,?,?,?)`),
  packages: db.prepare(`SELECT * FROM packages ORDER BY end_day ASC`),
  packagesByStatus: db.prepare(`SELECT * FROM packages WHERE status = ? ORDER BY end_day ASC`),
  getPackage: db.prepare(`SELECT * FROM packages WHERE id = ?`),
  packageSessions: db.prepare(`SELECT * FROM bookings WHERE package_id = ? ORDER BY slot`),
  setPackage: db.prepare(`UPDATE packages SET status = ?, price = ?, paid = ?, paid_at = ?, updated_at = ? WHERE id = ?`),
  setPackageSessions: db.prepare(`UPDATE bookings SET status = ?, updated_at = ? WHERE package_id = ? AND status = ?`),
  list: db.prepare(`SELECT * FROM bookings ORDER BY slot ASC`),
  get: db.prepare(`SELECT * FROM bookings WHERE id = ?`),
  setStatus: db.prepare(`UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?`),
  blocks: db.prepare(`SELECT day, reason FROM blocks WHERE day >= ? ORDER BY day`),
  addBlock: db.prepare(`INSERT OR REPLACE INTO blocks (day, reason) VALUES (?, ?)`),
  delBlock: db.prepare(`DELETE FROM blocks WHERE day = ?`),
};

// ---------- Horários ----------
const pad = (n) => String(n).padStart(2, '0');
// "Agora" em Brasília como objeto Date cujos campos UTC representam a hora local.
const nowLocal = () => new Date(Date.now() - 3 * 3600 * 1000);
const fmtDay = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

function availableSlots(until = SCHEDULE.bookUntil) {
  const now = nowLocal();
  const earliest = new Date(now.getTime() + SCHEDULE.minLeadHours * 3600 * 1000);
  const today = fmtDay(now);
  const last = until < SCHEDULE.bookUntil ? until : SCHEDULE.bookUntil;
  const taken = new Set(q.takenSlots.all(today).map((r) => r.slot));
  const blocked = new Set(q.blocks.all(today).map((r) => r.day));
  const out = [];
  for (let i = 0; i < 800; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i));
    const day = fmtDay(d);
    if (day > last) break;
    const hours = SCHEDULE.days[d.getUTCDay()];
    if (!hours || blocked.has(day)) continue;
    const times = [];
    for (let m = toMin(hours[0]); m + 60 <= toMin(hours[1]); m += SCHEDULE.stepMinutes) {
      const time = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
      const at = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), Math.floor(m / 60), m % 60));
      if (at < earliest || taken.has(`${day}T${time}`)) continue;
      times.push(time);
    }
    if (times.length) out.push({ day, weekday: d.getUTCDay(), times });
  }
  return out;
}

function addDays(day, n) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return fmtDay(d);
}

function validateSlots(slots, need) {
  if (slots.length !== need) return need === 1 ? 'Escolha um dia e um horário.' : `Escolha as ${need} sessões do pacote (faltam ${need - slots.length}).`;
  if (!slots.every((s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s))) return 'Horário inválido.';
  const days = slots.map((s) => s.slice(0, 10));
  if (new Set(days).size !== days.length) return 'Escolha no máximo uma sessão por dia.';
  if (need > 1 && days[days.length - 1] > addDays(days[0], PACKAGE_WINDOW_DAYS - 1)) {
    return `Todas as sessões precisam ficar dentro de ${PACKAGE_WINDOW_DAYS} dias a partir da primeira.`;
  }
  const free = availableSlots(days[days.length - 1]);
  const bad = slots.find((s) => {
    const entry = free.find((d) => d.day === s.slice(0, 10));
    return !(entry && entry.times.includes(s.slice(11)));
  });
  return bad ? `O horário de ${bad.replace('T', ' às ')} não está mais livre. Escolha outro.` : '';
}

function packageSummary(pkg) {
  const sessions = q.packageSessions.all(pkg.id);
  const count = (st) => sessions.filter((s) => s.status === st).length;
  const done = count('concluido');
  const today = fmtDay(nowLocal());
  const totalDays = PACKAGE_WINDOW_DAYS;
  const elapsed = Math.min(totalDays, Math.max(0, Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${pkg.start_day}T12:00:00Z`)) / 86400000) + 1));
  return {
    ...pkg,
    paid: Boolean(pkg.paid),
    sessionsList: sessions.map((s) => ({ id: s.id, slot: s.slot, status: s.status })),
    done,
    scheduled: count('confirmado') + count('pendente'),
    canceled: count('cancelado') + count('recusado'),
    remaining: pkg.sessions - done,
    progress: Math.round((done / pkg.sessions) * 100),
    daysElapsed: elapsed,
    daysLeft: Math.max(0, Math.round((Date.parse(`${pkg.end_day}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000)),
    timeProgress: Math.round((elapsed / totalDays) * 100),
    expired: today > pkg.end_day,
  };
}

// ---------- Consultas do painel ----------
const fold = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const digits = (t) => String(t ?? '').replace(/\D/g, '');
const clientKey = (phone) => digits(phone).slice(-11);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
function matchesQuery(row, term) {
  const t = fold(term).trim();
  if (!t) return true;
  if (fold(`${row.name} ${row.phone} ${row.address} ${row.for_whom || ''}`).includes(t)) return true;
  const d = digits(term);
  return d.length >= 3 && digits(row.phone).includes(d);
}

function withPackageInfo(rows) {
  const info = new Map();
  for (const id of new Set(rows.map((r) => r.package_id).filter(Boolean))) {
    const pkg = q.getPackage.get(id);
    info.set(id, { id, sessions: pkg.sessions, status: pkg.status, order: q.packageSessions.all(id).map((x) => x.id) });
  }
  return rows.map((r) => {
    const i = r.package_id ? info.get(r.package_id) : null;
    return { ...r, pkg: i ? { id: i.id, sessions: i.sessions, status: i.status, n: i.order.indexOf(r.id) + 1 } : null };
  });
}

function listBookings(sp) {
  const where = [], args = [];
  const statuses = (sp.get('status') || '').split(',').filter((x) => STATUSES.includes(x));
  if (statuses.length) { where.push(`status IN (${statuses.map(() => '?').join(',')})`); args.push(...statuses); }
  const service = sp.get('service');
  if (service && SERVICE_IDS.has(service)) { where.push('service = ?'); args.push(service); }
  const kind = sp.get('kind');
  if (kind === 'avulsa') where.push('package_id IS NULL');
  if (kind === 'pacote') where.push('package_id IS NOT NULL');
  const pkgId = Number(sp.get('package'));
  if (pkgId) { where.push('package_id = ?'); args.push(pkgId); }
  const from = sp.get('from'), to = sp.get('to');
  if (DAY_RE.test(from || '')) { where.push('slot >= ?'); args.push(from); }
  if (DAY_RE.test(to || '')) { where.push('slot < ?'); args.push(addDays(to, 1)); } // "to" inclusivo
  const order = sp.get('order') === 'desc' ? 'DESC' : 'ASC';
  let rows = db.prepare(`SELECT * FROM bookings${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY slot ${order}`).all(...args);
  const term = sp.get('q');
  if (term) rows = rows.filter((r) => matchesQuery(r, term));
  return rows;
}

function buildClients() {
  const now = nowLocal();
  const nowStr = `${fmtDay(now)}T${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
  const map = new Map();
  const get = (r) => {
    const k = clientKey(r.phone);
    if (!map.has(k)) map.set(k, { key: k, name: r.name, phone: r.phone, address: r.address, seen: '', sessions: 0, done: 0, upcoming: 0, pending: 0, canceled: 0, nextSlot: null, lastSlot: null, packagesActive: 0, packagesTotal: 0, paidTotal: 0, toReceive: 0 });
    return map.get(k);
  };
  for (const b of q.list.all()) {
    const c = get(b);
    if (b.created_at >= c.seen) { c.seen = b.created_at; c.name = b.name; c.phone = b.phone; c.address = b.address; }
    if (b.status === 'cancelado' || b.status === 'recusado') { c.canceled++; continue; }
    c.sessions++;
    if (b.status === 'concluido') { c.done++; if (!c.lastSlot || b.slot > c.lastSlot) c.lastSlot = b.slot; }
    if (b.status === 'pendente') c.pending++;
    if (b.status === 'pendente' || b.status === 'confirmado') {
      c.upcoming++;
      if (b.slot >= nowStr && (!c.nextSlot || b.slot < c.nextSlot)) c.nextSlot = b.slot;
    }
  }
  for (const pk of q.packages.all()) {
    const c = get(pk);
    c.packagesTotal++;
    if (pk.status === 'ativo') c.packagesActive++;
    if (pk.status === 'ativo' || pk.status === 'concluido') { if (pk.paid) c.paidTotal += pk.price || 0; else c.toReceive += pk.price || 0; }
  }
  return [...map.values()];
}

// ---------- Sessão (cookie assinado com HMAC) ----------
const sign = (v) => crypto.createHmac('sha256', SESSION_SECRET).update(v).digest('base64url');
function makeSession() {
  const exp = Date.now() + 7 * 24 * 3600 * 1000;
  const payload = `admin.${exp}`;
  return `${payload}.${sign(payload)}`;
}
function validSession(token) {
  if (!token) return false;
  const i = token.lastIndexOf('.');
  if (i < 0) return false;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = sign(payload);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
  const exp = Number(payload.split('.')[1]);
  return Number.isFinite(exp) && exp > Date.now();
}
function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}
function passwordOk(given) {
  if (!ADMIN_PASSWORD || typeof given !== 'string') return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

// ---------- Limite simples por IP ----------
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  return arr.length > max;
}
setInterval(() => hits.clear(), 3600 * 1000).unref();

// ---------- HTTP ----------
function send(res, status, body, headers = {}) {
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 20_000) { reject(new Error('too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('bad_json')); }
    });
    req.on('error', reject);
  });
}

// ---------- Fotos do site (ficam no volume de dados, a Gabriela troca pelo painel) ----------
const PHOTO_SLOTS = ['retrato', 'atendimento'];
const PHOTO_DIR = path.join(DATA_DIR, 'fotos');
fs.mkdirSync(PHOTO_DIR, { recursive: true });
function sniffImage(buf) {
  if (buf.length > 12 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length > 12 && buf.subarray(1, 4).toString() === 'PNG') return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return null;
}
function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > max) { reject(new Error('too_large')); req.destroy(); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
const clean = (v, max) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
const ipOf = (req) => (req.headers['x-real-ip'] || req.socket.remoteAddress || '').toString();

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;

  if (p === '/api/health') return send(res, 200, { ok: true });
  if (p === '/api/services' && m === 'GET') return send(res, 200, { services: SERVICES });
  const photoPublic = p.match(/^\/api\/fotos\/([a-z]+)$/);
  if (photoPublic && m === 'GET') {
    const slot = photoPublic[1];
    const file = path.join(PHOTO_DIR, slot);
    if (!PHOTO_SLOTS.includes(slot) || !fs.existsSync(file)) return send(res, 404, { error: 'Sem foto.' });
    const buf = fs.readFileSync(file);
    res.writeHead(200, { 'Content-Type': sniffImage(buf) || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    return res.end(buf);
  }
  if (p === '/api/fotos' && m === 'GET') {
    return send(res, 200, { fotos: Object.fromEntries(PHOTO_SLOTS.map((k) => [k, fs.existsSync(path.join(PHOTO_DIR, k)) ? fs.statSync(path.join(PHOTO_DIR, k)).mtimeMs : 0])) });
  }
  if (p === '/api/slots' && m === 'GET') {
    return send(res, 200, { slots: availableSlots(), today: fmtDay(nowLocal()), until: SCHEDULE.bookUntil });
  }

  if (p === '/api/bookings' && m === 'POST') {
    if (limited(`book:${ipOf(req)}`, 12, 3600 * 1000)) return send(res, 429, { error: 'Muitos pedidos seguidos. Tente de novo em uma hora ou chame no WhatsApp.' });
    const b = await readJson(req);
    if (b.website) return send(res, 201, { ok: true }); // campo-isca para robôs
    const plan = Object.hasOwn(PLANS, b.plan) ? b.plan : 'avulso';
    const need = PLANS[plan];
    const rawSlots = Array.isArray(b.slots) ? b.slots : [b.slot];
    const slots = [...new Set(rawSlots.map((x) => clean(x, 16)).filter(Boolean))].sort();
    const data = {
      name: clean(b.name, 80),
      phone: clean(b.phone, 30),
      service: clean(b.service, 40),
      address: clean(b.address, 200),
      forWhom: clean(b.forWhom, 80),
      notes: clean(b.notes, 600),
    };
    const errors = {};
    if (data.name.length < 2) errors.name = 'Escreva seu nome.';
    if (data.phone.replace(/\D/g, '').length < 10) errors.phone = 'Informe um telefone com DDD.';
    if (!SERVICE_IDS.has(data.service)) errors.service = 'Escolha um atendimento.';
    if (data.address.length < 5) errors.address = 'Informe o endereço do atendimento.';
    const slotError = validateSlots(slots, need);
    if (slotError) errors.slot = slotError;
    if (Object.keys(errors).length) return send(res, 422, { errors });

    // Revalida dentro de uma transação para evitar dois pedidos no mesmo horário.
    db.exec('BEGIN IMMEDIATE');
    try {
      const busy = slots.find((s) => q.slotTaken.get(s));
      if (busy) { db.exec('ROLLBACK'); return send(res, 409, { errors: { slot: `O horário de ${busy.replace('T', ' às ')} acabou de ser reservado. Escolha outro.` } }); }
      const now = new Date().toISOString();
      let packageId = null;
      if (need > 1) {
        const startDay = slots[0].slice(0, 10);
        const r = q.insertPackage.run(now, data.name, data.phone, data.service, need, startDay, addDays(startDay, PACKAGE_WINDOW_DAYS - 1), data.address);
        packageId = Number(r.lastInsertRowid);
      }
      for (const s of slots) q.insert.run(now, data.name, data.phone, data.service, s, data.address, data.forWhom, data.notes, packageId);
      db.exec('COMMIT');
      return send(res, 201, { ok: true, packageId, slots });
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  }

  // ----- Painel -----
  if (p === '/api/admin/login' && m === 'POST') {
    if (limited(`login:${ipOf(req)}`, 8, 15 * 60 * 1000)) return send(res, 429, { error: 'Muitas tentativas. Espere 15 minutos.' });
    const b = await readJson(req);
    if (!passwordOk(b.password)) return send(res, 401, { error: 'Senha incorreta.' });
    const flags = `HttpOnly; SameSite=Strict; Path=/; Max-Age=${7 * 24 * 3600}${COOKIE_SECURE ? '; Secure' : ''}`;
    return send(res, 200, { ok: true }, { 'Set-Cookie': `gabi_session=${makeSession()}; ${flags}` });
  }
  if (p === '/api/admin/logout' && m === 'POST') {
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'gabi_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
  }
  if (p.startsWith('/api/admin/')) {
    if (!validSession(cookies(req).gabi_session)) return send(res, 401, { error: 'Entre com a senha do painel.' });

    const photoAdmin = p.match(/^\/api\/admin\/fotos\/([a-z]+)$/);
    if (photoAdmin) {
      const slot = photoAdmin[1];
      if (!PHOTO_SLOTS.includes(slot)) return send(res, 404, { error: 'Foto desconhecida.' });
      const file = path.join(PHOTO_DIR, slot);
      if (m === 'PUT') {
        let buf;
        try { buf = await readRaw(req, 3_000_000); } catch { return send(res, 413, { error: 'A foto passou de 3 MB.' }); }
        if (!sniffImage(buf)) return send(res, 422, { error: 'Envie uma foto JPG, PNG ou WebP.' });
        fs.writeFileSync(file, buf);
        return send(res, 200, { ok: true });
      }
      if (m === 'DELETE') { fs.rmSync(file, { force: true }); return send(res, 200, { ok: true }); }
    }

    if (p === '/api/admin/me') return send(res, 200, { ok: true });

    if (p === '/api/admin/bookings' && m === 'GET') {
      const all = listBookings(url.searchParams);
      const limit = Math.min(Number(url.searchParams.get('limit')) || 500, 1000);
      const counts = {};
      for (const r of all) counts[r.status] = (counts[r.status] || 0) + 1;
      return send(res, 200, { bookings: withPackageInfo(all.slice(0, limit)), total: all.length, counts });
    }

    if (p === '/api/admin/clients' && m === 'GET') {
      const term = url.searchParams.get('q') || '';
      let list = buildClients().filter((c) => matchesQuery(c, term));
      const sort = url.searchParams.get('sort') || 'next';
      if (sort === 'name') list.sort((a, b) => fold(a.name).localeCompare(fold(b.name)));
      else if (sort === 'sessions') list.sort((a, b) => b.sessions - a.sessions || fold(a.name).localeCompare(fold(b.name)));
      else list.sort((a, b) => (a.nextSlot ? 0 : 1) - (b.nextSlot ? 0 : 1) || (a.nextSlot || '').localeCompare(b.nextSlot || '') || fold(a.name).localeCompare(fold(b.name)));
      return send(res, 200, { clients: list });
    }
    const cm = p.match(/^\/api\/admin\/clients\/(\d+)$/);
    if (cm && m === 'GET') {
      const client = buildClients().find((c) => c.key === cm[1]);
      if (!client) return send(res, 404, { error: 'Cliente não encontrado.' });
      const rows = q.list.all().filter((r) => clientKey(r.phone) === client.key).reverse();
      const pkgs = q.packages.all().filter((x) => clientKey(x.phone) === client.key).reverse().map(packageSummary);
      return send(res, 200, { client, bookings: withPackageInfo(rows), packages: pkgs });
    }
    const bm = p.match(/^\/api\/admin\/bookings\/(\d+)$/);
    if (bm && m === 'PATCH') {
      const b = await readJson(req);
      if (!STATUSES.includes(b.status)) return send(res, 422, { error: 'Status inválido.' });
      const row = q.get.get(Number(bm[1]));
      if (!row) return send(res, 404, { error: 'Pedido não encontrado.' });
      if (BLOCKING.includes(b.status) && !BLOCKING.includes(row.status) && q.slotTaken.get(row.slot)) {
        return send(res, 409, { error: 'Já existe outro atendimento nesse horário.' });
      }
      const now = new Date().toISOString();
      q.setStatus.run(b.status, now, row.id);
      if (row.package_id) {
        const pkg = q.getPackage.get(row.package_id);
        const sessions = q.packageSessions.all(pkg.id);
        if (pkg.status === 'ativo' && sessions.filter((s) => s.status === 'concluido').length >= pkg.sessions) {
          q.setPackage.run('concluido', pkg.price, pkg.paid, pkg.paid_at, now, pkg.id);
        }
      }
      return send(res, 200, { booking: q.get.get(row.id) });
    }

    if (p === '/api/admin/packages' && m === 'GET') {
      const sp = url.searchParams;
      const all = q.packages.all().map(packageSummary);
      const money = all.filter((x) => (x.status === 'ativo' || x.status === 'concluido') && !x.paid);
      const summary = {
        active: all.filter((x) => x.status === 'ativo').length,
        pending: all.filter((x) => x.status === 'pendente').length,
        toReceive: money.reduce((t, x) => t + (x.price || 0), 0),
        noPrice: money.filter((x) => x.price == null).length,
        endingSoon: all.filter((x) => x.status === 'ativo' && x.daysLeft <= 7).length,
      };
      let rows = all;
      const st = sp.get('status');
      if (st === 'encerrados') rows = rows.filter((x) => ['concluido', 'cancelado', 'recusado'].includes(x.status));
      else if (PACKAGE_STATUSES.includes(st)) rows = rows.filter((x) => x.status === st);
      const paid = sp.get('paid');
      if (paid === '1') rows = rows.filter((x) => x.paid);
      if (paid === '0') rows = rows.filter((x) => !x.paid && (x.status === 'ativo' || x.status === 'concluido'));
      const ending = Number(sp.get('ending'));
      if (ending) rows = rows.filter((x) => x.status === 'ativo' && x.daysLeft <= ending);
      const client = sp.get('client');
      if (client) rows = rows.filter((x) => clientKey(x.phone) === client);
      const term = sp.get('q');
      if (term) rows = rows.filter((x) => matchesQuery(x, term));
      const open = st === 'ativo' || st === 'pendente';
      rows.sort((a, b) => (open ? a.end_day.localeCompare(b.end_day) : b.id - a.id));
      return send(res, 200, { packages: rows, summary });
    }
    const pm = p.match(/^\/api\/admin\/packages\/(\d+)$/);
    if (pm && m === 'PATCH') {
      const b = await readJson(req);
      const pkg = q.getPackage.get(Number(pm[1]));
      if (!pkg) return send(res, 404, { error: 'Pacote não encontrado.' });
      const now = new Date().toISOString();
      let status = pkg.status;
      if (b.status !== undefined) {
        if (!PACKAGE_STATUSES.includes(b.status)) return send(res, 422, { error: 'Status inválido.' });
        status = b.status;
      }
      let price = pkg.price;
      if (b.price !== undefined) {
        const v = b.price === null || b.price === '' ? null : Number(String(b.price).replace(',', '.'));
        if (v !== null && (!Number.isFinite(v) || v < 0)) return send(res, 422, { error: 'Valor inválido.' });
        price = v;
      }
      let paid = pkg.paid, paidAt = pkg.paid_at;
      if (b.paid !== undefined) { paid = b.paid ? 1 : 0; paidAt = b.paid ? now : null; }
      db.exec('BEGIN IMMEDIATE');
      try {
        q.setPackage.run(status, price, paid, paidAt, now, pkg.id);
        // Confirmar o pacote confirma todas as sessões pedidas; recusar/cancelar libera os horários.
        if (status !== pkg.status) {
          if (status === 'ativo') q.setPackageSessions.run('confirmado', now, pkg.id, 'pendente');
          if (status === 'recusado') q.setPackageSessions.run('recusado', now, pkg.id, 'pendente');
          if (status === 'cancelado') { q.setPackageSessions.run('cancelado', now, pkg.id, 'pendente'); q.setPackageSessions.run('cancelado', now, pkg.id, 'confirmado'); }
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      return send(res, 200, { package: packageSummary(q.getPackage.get(pkg.id)) });
    }

    if (p === '/api/admin/blocks' && m === 'GET') return send(res, 200, { blocks: q.blocks.all(fmtDay(nowLocal())) });
    if (p === '/api/admin/blocks' && m === 'POST') {
      const b = await readJson(req);
      const day = clean(b.day, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return send(res, 422, { error: 'Data inválida.' });
      q.addBlock.run(day, clean(b.reason, 80));
      return send(res, 201, { ok: true });
    }
    const blk = p.match(/^\/api\/admin\/blocks\/(\d{4}-\d{2}-\d{2})$/);
    if (blk && m === 'DELETE') { q.delBlock.run(blk[1]); return send(res, 200, { ok: true }); }
  }

  return send(res, 404, { error: 'Não encontrado.' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    if (err.message === 'bad_json' || err.message === 'too_large') return send(res, 400, { error: 'Requisição inválida.' });
    console.error(err);
    send(res, 500, { error: 'Erro no servidor. Tente de novo em instantes.' });
  });
});
server.listen(PORT, () => console.log(`API ouvindo na porta ${PORT}`));
process.on('SIGTERM', () => server.close(() => { db.close(); process.exit(0); }));
