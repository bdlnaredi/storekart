// StoreKart — self-hosted online store for any kind of shop.
// Zero dependencies: needs only Node.js 18+.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT || '3080', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_BODY = 8 * 1024 * 1024; // 8 MB (images are sent as base64)

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- storage ----------
const EMPTY_DB = { config: null, admin: null, secret: null, products: [], orders: [], orderSeq: 1000 };
let db = loadDb();

function loadDb() {
  try {
    return Object.assign({}, EMPTY_DB, JSON.parse(fs.readFileSync(DB_FILE, 'utf8')));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('Could not read db.json, starting fresh:', e.message);
    return JSON.parse(JSON.stringify(EMPTY_DB));
  }
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
    fs.renameSync(tmp, DB_FILE);
  }, 50);
}
function saveNow() { clearTimeout(saveTimer); fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(db, null, 1)); fs.renameSync(DB_FILE + '.tmp', DB_FILE); }

if (!db.secret) { db.secret = crypto.randomBytes(32).toString('hex'); saveNow(); }

// ---------- auth ----------
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') };
}
function checkPassword(pw) {
  if (!db.admin) return false;
  const { hash } = hashPassword(pw, db.admin.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(db.admin.hash, 'hex'));
}
function makeToken() {
  const exp = Date.now() + 30 * 24 * 3600 * 1000;
  const payload = `admin.${exp}.${db.admin.salt.slice(0, 8)}`;
  const sig = crypto.createHmac('sha256', db.secret).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64url');
}
function isAdmin(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ') || !db.admin) return false;
  try {
    const raw = Buffer.from(h.slice(7), 'base64url').toString();
    const i = raw.lastIndexOf('.');
    const payload = raw.slice(0, i), sig = raw.slice(i + 1);
    const good = crypto.createHmac('sha256', db.secret).update(payload).digest('hex');
    if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return false;
    const [, exp, saltPart] = payload.split('.');
    return Number(exp) > Date.now() && saltPart === db.admin.salt.slice(0, 8); // password change logs everyone out
  } catch { return false; }
}

// simple login rate limit
const loginFails = new Map();
function tooManyFails(ip) {
  const r = loginFails.get(ip);
  return r && r.count >= 8 && Date.now() - r.at < 10 * 60 * 1000;
}

// ---------- helpers ----------
function send(res, status, data, headers = {}) {
  const body = typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data);
  res.writeHead(status, Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers));
  res.end(body);
}
const fail = (res, status, msg) => send(res, status, { error: msg });

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('Upload too large (max 8 MB)'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const str = (v, max = 500) => (v == null ? '' : String(v)).trim().slice(0, max);
const num = (v, def = 0) => { const n = Number(v); return Number.isFinite(n) ? n : def; };
const money = v => Math.round(Math.max(0, num(v)) * 100) / 100;
const id = () => crypto.randomBytes(6).toString('hex');

function cleanProduct(p, existing = {}) {
  return {
    id: existing.id || id(),
    name: str(p.name, 120) || 'Untitled item',
    description: str(p.description, 2000),
    category: str(p.category, 60),
    price: money(p.price),
    mrp: p.mrp ? money(p.mrp) : null,
    unit: str(p.unit, 30),
    image: str(p.image, 300),
    emoji: str(p.emoji, 8),
    inStock: p.inStock !== false,
    stock: p.stock === '' || p.stock == null ? null : Math.max(0, Math.floor(num(p.stock))),
    featured: !!p.featured,
    veg: p.veg === true ? true : p.veg === false ? false : null,
    tags: Array.isArray(p.tags) ? p.tags.map(t => str(t, 30)).filter(Boolean).slice(0, 10) : [],
    // variants: e.g. sizes (S/M/L), weights (500 g / 1 kg), portions (Half/Full) — each with its own price
    variants: Array.isArray(p.variants) ? p.variants.slice(0, 30).map(v => ({ name: str(v.name, 40), price: money(v.price), inStock: v.inStock !== false })).filter(v => v.name) : [],
    // second option list, e.g. colours for clothing
    options2: Array.isArray(p.options2) ? p.options2.map(o => str(o, 40)).filter(Boolean).slice(0, 30) : [],
    // add-ons, e.g. extra cheese +₹30
    addons: Array.isArray(p.addons) ? p.addons.slice(0, 30).map(a => ({ name: str(a.name, 40), price: money(a.price) })).filter(a => a.name) : [],
    sort: num(p.sort, existing.sort || 0),
    createdAt: existing.createdAt || new Date().toISOString(),
  };
}

function publicConfig() {
  if (!db.config) return { configured: false };
  return Object.assign({ configured: true }, db.config);
}

function storeIsOpen(cfg) {
  if (!cfg.acceptingOrders) return false;
  const h = cfg.hours;
  if (!h || !h.enabled) return true;
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: cfg.timezone || 'Asia/Kolkata' }));
  const mins = now.getHours() * 60 + now.getMinutes();
  const [oh, om] = (h.open || '00:00').split(':').map(Number);
  const [ch, cm] = (h.close || '23:59').split(':').map(Number);
  const o = oh * 60 + om, c = ch * 60 + cm;
  return o <= c ? mins >= o && mins <= c : mins >= o || mins <= c; // handles past-midnight closing
}

// Recalculate every order on the server so prices can't be tampered with.
function priceOrder(items, cfg, mode) {
  const lines = [];
  for (const it of Array.isArray(items) ? items.slice(0, 100) : []) {
    const p = db.products.find(x => x.id === it.productId);
    if (!p) throw Object.assign(new Error('An item in your cart is no longer available. Please refresh.'), { status: 409 });
    if (!p.inStock) throw Object.assign(new Error(`${p.name} is out of stock.`), { status: 409 });
    const qty = Math.min(999, Math.max(1, Math.floor(num(it.qty, 1))));
    if (p.stock != null && p.stock < qty) throw Object.assign(new Error(`Only ${p.stock} of ${p.name} left.`), { status: 409 });
    let unitPrice = p.price, variant = null;
    if (p.variants.length) {
      const v = p.variants.find(v => v.name === it.variant) || p.variants[0];
      if (!v.inStock) throw Object.assign(new Error(`${p.name} (${v.name}) is out of stock.`), { status: 409 });
      variant = v.name; unitPrice = v.price;
    }
    const option2 = p.options2.includes(it.option2) ? it.option2 : (p.options2[0] || null);
    const addons = (Array.isArray(it.addons) ? it.addons : []).map(n => p.addons.find(a => a.name === n)).filter(Boolean);
    unitPrice += addons.reduce((s, a) => s + a.price, 0);
    lines.push({ productId: p.id, name: p.name, image: p.image, variant, option2, addons: addons.map(a => ({ ...a })), unitPrice: money(unitPrice), qty, total: money(unitPrice * qty), note: str(it.note, 200) });
  }
  if (!lines.length) throw Object.assign(new Error('Your cart is empty.'), { status: 400 });
  const subtotal = money(lines.reduce((s, l) => s + l.total, 0));
  const d = cfg.delivery || {};
  if (mode === 'delivery' && d.minOrder && subtotal < d.minOrder) throw Object.assign(new Error(`Minimum order for delivery is ₹${d.minOrder}.`), { status: 400 });
  let deliveryFee = 0;
  if (mode === 'delivery') deliveryFee = d.freeAbove && subtotal >= d.freeAbove ? 0 : money(d.fee);
  const packing = money(cfg.packingCharge || 0);
  let tax = 0;
  if (cfg.tax && cfg.tax.enabled && !cfg.tax.inclusive) tax = money(subtotal * num(cfg.tax.rate) / 100);
  const total = money(subtotal + deliveryFee + packing + tax);
  return { lines, subtotal, deliveryFee, packing, tax, total };
}

function serveStatic(req, res, urlPath) {
  let file;
  if (urlPath.startsWith('/uploads/')) {
    file = path.join(UPLOAD_DIR, path.basename(urlPath));
  } else {
    const rel = decodeURIComponent(urlPath).replace(/^\/+/, '') || 'index.html';
    file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR)) return fail(res, 403, 'Forbidden');
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      if (urlPath.startsWith('/uploads/')) return fail(res, 404, 'Not found');
      file = path.join(PUBLIC_DIR, 'index.html'); // SPA fallback
    }
    const ext = path.extname(file).toLowerCase();
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon' };
    const cache = ext === '.html' || file.endsWith('sw.js') ? 'no-cache' : urlPath.startsWith('/uploads/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  });
}

// Server-sent events so the admin panel hears new orders instantly
const listeners = new Set();
function broadcast(event, data) { for (const res of listeners) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }

// ---------- routes ----------
async function api(req, res, url) {
  const m = req.method, p = url.pathname;
  const admin = isAdmin(req);
  const needAdmin = () => { if (!admin) { fail(res, 401, 'Please log in again.'); return true; } return false; };

  if (p === '/api/health') return send(res, 200, { ok: true });

  if (p === '/api/config' && m === 'GET') return send(res, 200, Object.assign(publicConfig(), { isOpen: db.config ? storeIsOpen(db.config) : false }));

  // First-run setup — only allowed while the store is unconfigured
  if (p === '/api/setup' && m === 'POST') {
    if (db.config) return fail(res, 409, 'Store is already set up.');
    const b = await readBody(req);
    if (!b.password || String(b.password).length < 6) return fail(res, 400, 'Choose an admin password of at least 6 characters.');
    db.admin = hashPassword(String(b.password));
    db.config = Object.assign({ acceptingOrders: true, timezone: 'Asia/Kolkata', currency: '₹' }, b.config || {});
    db.products = (Array.isArray(b.products) ? b.products : []).map(x => cleanProduct(x));
    saveNow();
    return send(res, 200, { token: makeToken() });
  }

  if (p === '/api/login' && m === 'POST') {
    const ip = req.socket.remoteAddress;
    if (tooManyFails(ip)) return fail(res, 429, 'Too many wrong attempts. Try again in 10 minutes.');
    const b = await readBody(req);
    if (!checkPassword(String(b.password || ''))) {
      const r = loginFails.get(ip) || { count: 0, at: 0 };
      loginFails.set(ip, { count: r.count + 1, at: Date.now() });
      return fail(res, 401, 'Wrong password.');
    }
    loginFails.delete(ip);
    return send(res, 200, { token: makeToken() });
  }

  if (p === '/api/config' && m === 'PUT') {
    if (needAdmin()) return;
    const b = await readBody(req);
    delete b.configured; delete b.isOpen;
    db.config = Object.assign({}, db.config, b);
    save();
    return send(res, 200, publicConfig());
  }

  if (p === '/api/password' && m === 'POST') {
    if (needAdmin()) return;
    const b = await readBody(req);
    if (!checkPassword(String(b.current || ''))) return fail(res, 401, 'Current password is wrong.');
    if (!b.next || String(b.next).length < 6) return fail(res, 400, 'New password must be at least 6 characters.');
    db.admin = hashPassword(String(b.next)); saveNow();
    return send(res, 200, { token: makeToken() });
  }

  // Start over with a different business type (keeps nothing)
  if (p === '/api/reset' && m === 'POST') {
    if (needAdmin()) return;
    const b = await readBody(req);
    if (!checkPassword(String(b.password || ''))) return fail(res, 401, 'Wrong password.');
    db = Object.assign(JSON.parse(JSON.stringify(EMPTY_DB)), { secret: db.secret });
    saveNow();
    return send(res, 200, { ok: true });
  }

  // ----- products -----
  if (p === '/api/products' && m === 'GET') {
    const list = [...db.products].sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));
    return send(res, 200, list);
  }
  if (p === '/api/products' && m === 'POST') {
    if (needAdmin()) return;
    const prod = cleanProduct(await readBody(req));
    db.products.push(prod); save();
    return send(res, 201, prod);
  }
  let mm;
  if ((mm = p.match(/^\/api\/products\/([a-f0-9]+)$/))) {
    if (needAdmin()) return;
    const i = db.products.findIndex(x => x.id === mm[1]);
    if (i < 0) return fail(res, 404, 'Product not found');
    if (m === 'PUT') { db.products[i] = cleanProduct(await readBody(req), db.products[i]); save(); return send(res, 200, db.products[i]); }
    if (m === 'DELETE') { db.products.splice(i, 1); save(); return send(res, 200, { ok: true }); }
  }

  if (p === '/api/upload' && m === 'POST') {
    if (needAdmin()) return;
    const b = await readBody(req);
    const match = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/.exec(b.dataUrl || '');
    if (!match) return fail(res, 400, 'Please choose a PNG, JPG, WEBP or GIF image.');
    const name = `${id()}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(match[2], 'base64'));
    return send(res, 201, { url: `/uploads/${name}` });
  }

  // ----- orders -----
  if (p === '/api/orders' && m === 'POST') {
    const cfg = db.config;
    if (!cfg) return fail(res, 400, 'Store is not set up yet.');
    if (!storeIsOpen(cfg)) return fail(res, 409, 'Sorry, the store is closed right now.');
    const b = await readBody(req);
    const c = b.customer || {};
    const name = str(c.name, 80), phone = str(c.phone, 20).replace(/[^\d+]/g, '');
    if (!name) return fail(res, 400, 'Please enter your name.');
    if (phone.replace(/\D/g, '').length < 10) return fail(res, 400, 'Please enter a valid 10-digit phone number.');
    const modes = cfg.modes || ['delivery', 'pickup'];
    const mode = modes.includes(b.mode) ? b.mode : modes[0];
    if (mode === 'delivery' && !str(c.address)) return fail(res, 400, 'Please enter your delivery address.');
    if (mode === 'dinein' && !str(b.table, 10)) return fail(res, 400, 'Please enter your table number.');
    const payments = cfg.payments || ['cod'];
    const payment = payments.includes(b.payment) ? b.payment : payments[0];
    const priced = priceOrder(b.items, cfg, mode);
    for (const l of priced.lines) { const prod = db.products.find(x => x.id === l.productId); if (prod.stock != null) { prod.stock -= l.qty; if (prod.stock <= 0) { prod.stock = 0; prod.inStock = false; } } }
    const order = {
      id: id(), number: ++db.orderSeq, createdAt: new Date().toISOString(),
      status: 'new', history: [{ status: 'new', at: new Date().toISOString() }],
      customer: { name, phone, address: str(c.address, 500), landmark: str(c.landmark, 120), pincode: str(c.pincode, 10) },
      mode, table: str(b.table, 10), slot: str(b.slot, 60), payment, paymentRef: str(b.paymentRef, 60), note: str(b.note, 500),
      ...priced,
    };
    db.orders.unshift(order); save();
    broadcast('order', { id: order.id, number: order.number, total: order.total, name });
    return send(res, 201, { id: order.id, number: order.number, total: order.total });
  }
  if (p === '/api/orders' && m === 'GET') {
    if (needAdmin()) return;
    return send(res, 200, db.orders.slice(0, 1000));
  }
  if ((mm = p.match(/^\/api\/orders\/([a-f0-9]+)$/))) {
    const o = db.orders.find(x => x.id === mm[1]);
    if (!o) return fail(res, 404, 'Order not found');
    if (m === 'GET') return send(res, 200, o); // order ids are unguessable, so the link works as a tracking link
    if (m === 'PATCH') {
      if (needAdmin()) return;
      const b = await readBody(req);
      const allowed = ['new', 'accepted', 'preparing', 'ready', 'out', 'delivered', 'cancelled'];
      if (b.status && allowed.includes(b.status) && b.status !== o.status) {
        if (b.status === 'cancelled' && o.status !== 'cancelled') {
          for (const l of o.lines) { const prod = db.products.find(x => x.id === l.productId); if (prod && prod.stock != null) { prod.stock += l.qty; prod.inStock = true; } }
        }
        o.status = b.status; o.history.push({ status: b.status, at: new Date().toISOString() });
      }
      if (typeof b.paid === 'boolean') o.paid = b.paid;
      if (b.adminNote != null) o.adminNote = str(b.adminNote, 500);
      save();
      return send(res, 200, o);
    }
  }

  if (p === '/api/events' && m === 'GET') {
    // EventSource can't send headers, so the token comes in the query string
    req.headers.authorization = 'Bearer ' + (url.searchParams.get('token') || '');
    if (!isAdmin(req)) return fail(res, 401, 'Unauthorized');
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write(': connected\n\n');
    listeners.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); listeners.delete(res); });
    return;
  }

  if (p === '/api/export' && m === 'GET') {
    if (needAdmin()) return;
    const { secret, admin: _a, ...rest } = db;
    return send(res, 200, rest, { 'Content-Disposition': 'attachment; filename="storekart-backup.json"' });
  }

  return fail(res, 404, 'Not found');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return fail(res, 405, 'Method not allowed');
    return serveStatic(req, res, url.pathname);
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) fail(res, e.status || 500, e.status ? e.message : 'Something went wrong.');
  }
});

server.listen(PORT, () => console.log(`StoreKart running on http://localhost:${PORT}  (data: ${DATA_DIR})`));
process.on('SIGTERM', () => { saveNow(); process.exit(0); });
process.on('SIGINT', () => { saveNow(); process.exit(0); });
