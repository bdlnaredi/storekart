// StoreKart — self-hosted online store for any kind of shop.
// Zero dependencies: needs only Node.js 18+. Store rules live in public/core.js (shared with the browser demo).
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Core = require('./public/core.js');

const PORT = parseInt(process.env.PORT || '3080', 10);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const MAX_BODY = 8 * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ---------- storage ----------
const env = {
  db: loadDb(),
  save(now) { now ? saveNow() : saveSoon(); },
  hash(pw, salt = crypto.randomBytes(16).toString('hex')) { return { salt, hash: crypto.scryptSync(pw, salt, 64).toString('hex') }; },
  id: () => crypto.randomBytes(6).toString('hex'),
  makeToken(user) {
    const payload = `${user.id}.${Date.now() + 30 * 24 * 3600 * 1000}.${user.salt.slice(0, 8)}`;
    const sig = crypto.createHmac('sha256', env.db.secret).update(payload).digest('hex');
    return Buffer.from(`${payload}.${sig}`).toString('base64url');
  },
  saveUpload(dataUrl) {
    const m = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/.exec(dataUrl);
    const name = `${env.id()}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, name), Buffer.from(m[2], 'base64'));
    return `/uploads/${name}`;
  },
  emit(event, data) { broadcast(event, data); },
};

function loadDb() {
  let d;
  try { d = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch (e) { if (e.code !== 'ENOENT') console.error('Could not read db.json, starting fresh:', e.message); d = {}; }
  d = Object.assign({ config: null, users: [], products: [], orders: [], handovers: [], orderSeq: 1000 }, d);
  if (!d.secret) d.secret = crypto.randomBytes(32).toString('hex');
  // upgrade from v1 (single admin password) to staff accounts
  if (d.admin && !d.users.length) {
    d.users.push({ id: crypto.randomBytes(6).toString('hex'), name: 'Admin', username: 'admin', role: 'admin', active: true, salt: d.admin.salt, hash: d.admin.hash, createdAt: new Date().toISOString() });
    console.log('Upgraded: your old admin password now logs in with the login name "admin".');
  }
  delete d.admin;
  for (const o of d.orders) { o.history = (o.history || []).map(h => h.text ? h : Object.assign({ text: Core.statusName(h.status, o.mode, d.config && d.config.businessType) }, h)); o.trail = o.trail || []; }
  return d;
}
let saveTimer = null;
function saveNow() { clearTimeout(saveTimer); saveTimer = null; fs.writeFileSync(DB_FILE + '.tmp', JSON.stringify(env.db)); fs.renameSync(DB_FILE + '.tmp', DB_FILE); }
function saveSoon() { if (!saveTimer) saveTimer = setTimeout(saveNow, 300); }
saveNow();

const core = Core.createCore(env);

function userIdFromToken(tok) {
  if (!tok) return null;
  try {
    const raw = Buffer.from(tok, 'base64url').toString();
    const i = raw.lastIndexOf('.');
    const payload = raw.slice(0, i), sig = raw.slice(i + 1);
    const good = crypto.createHmac('sha256', env.db.secret).update(payload).digest('hex');
    if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
    const [uid, exp, saltPart] = payload.split('.');
    const u = env.db.users.find(x => x.id === uid);
    // changing a password (or switching an account off) logs that person out everywhere
    if (!u || u.active === false || Number(exp) < Date.now() || u.salt.slice(0, 8) !== saltPart) return null;
    return uid;
  } catch { return null; }
}

// ---------- live updates for staff screens ----------
const listeners = new Set(); // { res, user }
function broadcast(event, data) {
  for (const l of listeners) {
    const u = env.db.users.find(x => x.id === l.userId);
    if (!u) continue;
    if (event === 'cash') { if (data.toId !== u.id) continue; } // cash handovers: only the person who must act
    else if (u.role === 'delivery' && data.riderId !== u.id) continue; // delivery boys only hear about their own orders
    if (event === 'location') continue; // only customers poll for the map
    l.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
}

// ---------- http ----------
const loginFails = new Map();
function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new Core.HttpError(413, 'Upload too large (max 8 MB)')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Core.HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, urlPath) {
  let file;
  if (urlPath.startsWith('/uploads/')) file = path.join(UPLOAD_DIR, path.basename(urlPath));
  else {
    file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(urlPath).replace(/^\/+/, '') || 'index.html'));
    if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'Forbidden' });
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      if (urlPath.startsWith('/uploads/')) return send(res, 404, { error: 'Not found' });
      file = path.join(PUBLIC_DIR, 'index.html');
    }
    const ext = path.extname(file).toLowerCase();
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };
    const cache = urlPath.startsWith('/uploads/') ? 'public, max-age=31536000, immutable' : 'no-cache';
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream', 'Cache-Control': cache, 'X-Content-Type-Options': 'nosniff' });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  const p = url.pathname;
  try {
    if (!p.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
      return serveStatic(req, res, p);
    }
    const auth = req.headers.authorization || '';
    let userId = userIdFromToken(auth.startsWith('Bearer ') ? auth.slice(7) : null);

    if (p === '/api/events') {
      userId = userIdFromToken(url.searchParams.get('token')); // EventSource can't send headers
      if (!userId) return send(res, 401, { error: 'Unauthorized' });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write(': connected\n\n');
      const l = { res, userId }; listeners.add(l);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(ping); listeners.delete(l); });
      return;
    }

    const ip = req.socket.remoteAddress;
    if (p === '/api/login') {
      const r = loginFails.get(ip);
      if (r && r.count >= 8 && Date.now() - r.at < 10 * 60 * 1000) return send(res, 429, { error: 'Too many wrong attempts. Try again in 10 minutes.' });
    }
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    try {
      const out = core.handle({ method: req.method, path: p, body, userId });
      if (p === '/api/login') loginFails.delete(ip);
      return send(res, req.method === 'POST' && (p === '/api/orders' || p === '/api/products' || p === '/api/users') ? 201 : 200, out);
    } catch (e) {
      if (p === '/api/login' && e.status === 401) { const r = loginFails.get(ip) || { count: 0 }; loginFails.set(ip, { count: r.count + 1, at: Date.now() }); }
      throw e;
    }
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong.' });
  }
});

server.listen(PORT, () => console.log(`StoreKart running on http://localhost:${PORT}  (data: ${DATA_DIR})`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { saveNow(); process.exit(0); });
