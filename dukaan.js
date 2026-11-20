// Link with Dukaan (counter billing + Tally). Off until it's switched on in Settings → Connect Dukaan.
//
//  - Products (or pack sizes) are matched to Dukaan items. StoreKart shows Dukaan's live stock for them.
//  - An online order puts its items aside in Dukaan the moment it's placed (so the counter can't sell them twice).
//  - When the order is completed and paid it becomes a Dukaan bill (series W…) which goes into Tally.
//  - A cancelled order gives the stock back (or cancels the Dukaan bill if it was already made).
//  - Logins work both ways (Dukaan checks StoreKart logins; StoreKart checks Dukaan name + PIN).
//
// Everything that goes to Dukaan waits in a queue and is retried, so StoreKart keeps working if Dukaan is down.
'use strict';

const crypto = require('crypto');

module.exports = function createLink(env, core, Core) {
  const D = () => env.db;
  const DEFAULTS = { enabled: false, url: '', key: '', staffLogin: true, lastStockAt: 0, lastOkAt: 0, lastError: '', shop: '' };
  // the saved link settings — always the same object, so changes stick
  const L = () => { const d = D(); if (!d.link) d.link = {}; for (const k in DEFAULTS) if (!(k in d.link)) d.link[k] = DEFAULTS[k]; return d.link; };
  const Q = () => (D().linkQueue = D().linkQueue || []);
  const on = () => { const l = L(); return !!(l.enabled && l.url && l.key); };
  const money = n => Math.round(n * 100) / 100;
  let itemsCache = { at: 0, items: [] };

  // ---------- talking to Dukaan ----------
  async function call(path, body, timeout = 10000) {
    const l = L();
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
    try {
      const r = await fetch(l.url + path.replace(/^\//, ''), {
        method: body ? 'POST' : 'GET', signal: ctl.signal,
        headers: { 'Content-Type': 'application/json', 'X-Link-Key': l.key },
        body: body ? JSON.stringify(body) : undefined,
      });
      let j = {}; try { j = await r.json(); } catch {}
      if (!r.ok) { const e = new Error(j.error || `Dukaan answered ${r.status}`); e.status = r.status; throw e; }
      l.lastOkAt = Date.now();
      return j;
    } catch (e) {
      if (!e.status) { const e2 = new Error(e.name === 'AbortError' ? 'Dukaan did not answer in time' : 'Can\'t reach Dukaan (' + (e.cause && e.cause.code || e.message) + ')'); e2.status = 0; throw e2; }
      throw e;
    } finally { clearTimeout(t); }
  }

  // ---------- which Dukaan item (and how many of it) each order line is ----------
  function mapLine(line) {
    const p = D().products.find(x => x.id === line.productId);
    if (!p) return null;
    let link = p.link;
    if (line.variant && p.variants && p.variants.length) {
      const v = p.variants.find(v => v.name === line.variant);
      if (v && v.link && v.link.item) link = v.link;
    }
    if (!link || !link.item) return null;
    const factor = link.factor > 0 ? link.factor : 1;
    // what the customer paid for one pack, GST included
    const paidEach = (line.total + (line.gst && !line.taxIncl ? line.gst : 0)) / line.qty;
    return { item: link.item, qty: Math.round(line.qty * factor * 1000) / 1000, price: Math.round(paidEach * 100 / factor) };
  }
  function linesFor(o) {
    const by = {};
    for (const l of o.lines) {
      const m = mapLine(l); if (!m) continue;
      const k = m.item + '|' + m.price;
      if (by[k]) by[k].qty = Math.round((by[k].qty + m.qty) * 1000) / 1000; else by[k] = m;
    }
    return Object.values(by);
  }

  // ---------- the queue ----------
  function enqueue(kind, o, extra) {
    if (!on()) return;
    const q = Q();
    if (q.some(t => t.kind === kind && t.orderId === o.id)) return;
    q.push(Object.assign({ id: crypto.randomBytes(5).toString('hex'), kind, orderId: o.id, number: o.number, tries: 0, nextAt: 0, error: '', createdAt: new Date().toISOString() }, extra || {}));
    env.save();
    setTimeout(work, 50);
  }

  function onOrderEvent(ev, data) {
    if (!on() || !data || !data.id) return;
    const o = D().orders.find(x => x.id === data.id); if (!o) return;
    const dk = o.dk = o.dk || {};
    const lines = linesFor(o);
    if (!lines.length) return; // nothing in this order is a Dukaan item
    if (o.status === 'cancelled') {
      Q().splice(0, Q().length, ...Q().filter(t => !(t.orderId === o.id && (t.kind === 'reserve' || t.kind === 'sale'))));
      if (dk.billed) enqueue('cancel', o);
      else if (dk.reserved) enqueue('release', o);
      return;
    }
    if (o.status === 'delivered' && o.paid && !dk.billed) { enqueue('sale', o); return; }
    if (ev === 'order' && !dk.reserved) enqueue('reserve', o);
  }

  let working = false;
  async function work() {
    if (working || !on()) return;
    working = true;
    try {
      for (const t of Q().slice()) {
        if (t.nextAt > Date.now()) continue;
        const o = D().orders.find(x => x.id === t.orderId);
        try {
          if (!o) { done(t); continue; }
          const dk = o.dk = o.dk || {};
          if (t.kind === 'reserve') {
            await call('api/link/reserve', { order_id: o.id, number: String(o.number), lines: linesFor(o).map(l => ({ item: l.item, qty: l.qty })) });
            dk.reserved = true;
          } else if (t.kind === 'release') {
            await call('api/link/release', { order_id: o.id }); dk.reserved = false;
          } else if (t.kind === 'sale') {
            const c = o.customer || {};
            const r = await call('api/link/sale', {
              order_id: o.id, number: String(o.number), payment: o.payment,
              buyer: { name: c.name, phone: c.phone, address: [c.address, c.landmark, c.pincode].filter(Boolean).join(', ') },
              lines: linesFor(o),
            });
            Object.assign(dk, { billed: true, reserved: false, bill: r.number, billFlag: r.flag || '' });
            o.history.push({ at: new Date().toISOString(), text: `Billed in Dukaan as ${r.number}${r.flag ? ' (marked for the owner to check: ' + r.flag + ')' : ''}`, pub: null, by: null, staffOnly: true });
          } else if (t.kind === 'cancel') {
            await call('api/link/cancel', { order_id: o.id, reason: `Online order #${o.number} cancelled` });
            dk.cancelled = true;
          }
          done(t);
        } catch (e) {
          t.tries++; t.error = e.message;
          // can't reach Dukaan: retry soon; Dukaan refused: retry slowly (the owner sees it in Settings)
          t.nextAt = Date.now() + Math.min(e.status ? 30 * 60e3 : 5 * 60e3, 10e3 * 2 ** Math.min(t.tries, 8));
          L().lastError = `#${t.number} ${t.kind}: ${e.message}`;
          if (!e.status) break; // Dukaan is down — try the rest later, in order
        }
      }
    } finally { working = false; env.save(); }
  }
  function done(t) { const q = Q(); const i = q.indexOf(t); if (i >= 0) q.splice(i, 1); }

  // ---------- live stock from Dukaan ----------
  async function pullStock() {
    if (!on()) return null;
    const r = await call('api/link/stock');
    const stock = r.stock || {};
    let changed = false;
    const avail = (link) => link && link.item && stock[link.item] != null ? Math.max(0, Math.floor(stock[link.item] / (link.factor > 0 ? link.factor : 1) + 1e-9)) : null;
    for (const p of D().products) {
      if (p.link && p.link.item && !(p.variants && p.variants.some(v => v.link && v.link.item))) {
        const a = avail(p.link); if (a == null) continue;
        if (p.stock !== a || p.inStock !== a > 0) { p.stock = a; p.inStock = a > 0; changed = true; }
        p.dkStock = stock[p.link.item];
      } else if (p.variants && p.variants.some(v => v.link && v.link.item)) {
        let any = false;
        for (const v of p.variants) {
          const a = avail(v.link);
          if (a == null) { if (v.inStock !== false) any = true; continue; }
          if (v.inStock !== a > 0) { v.inStock = a > 0; changed = true; }
          v.dkStock = stock[v.link.item];
          if (a > 0) any = true;
        }
        if (p.inStock !== any) { p.inStock = any; changed = true; }
      }
    }
    L().lastStockAt = Date.now(); L().lastError = L().lastError && /stock/.test(L().lastError) ? '' : L().lastError;
    if (changed) env.save();
    return stock;
  }

  async function dukaanItems(force) {
    if (!force && Date.now() - itemsCache.at < 60e3) return itemsCache.items;
    const r = await call('api/link/items');
    itemsCache = { at: Date.now(), items: r.items || [] };
    return itemsCache.items;
  }

  // ---------- logins ----------
  // A Dukaan cashier (name + PIN) or the Dukaan owner signs in to StoreKart → their own linked StoreKart account
  async function loginViaDukaan(username, password) {
    const l = L();
    if (!on() || !l.staffLogin) return null;
    const r = await call('api/link/verify', { name: username, pin: password });
    const ext = 'dk:' + r.id;
    const users = D().users;
    let u = users.find(x => x.ext === ext);
    if (u && u.active === false) { const e = new Error('This account is switched off. Ask the store owner.'); e.status = 403; e.local = true; throw e; }
    if (!u) {
      let un = String(r.name || 'staff').toLowerCase().replace(/[^a-z0-9._-]+/g, '') || 'staff';
      if (r.role === 'owner') un = 'dukaan-owner';
      let candidate = un, i = 2;
      while (users.some(x => x.username === candidate)) candidate = `${un}${i++}`;
      u = Object.assign({ id: crypto.randomBytes(6).toString('hex'), name: r.role === 'owner' ? 'Owner (Dukaan)' : r.name, username: candidate, phone: '',
        role: r.role === 'owner' ? 'owner' : 'cashier', active: true, ext, createdAt: new Date().toISOString() }, env.hash(crypto.randomBytes(16).toString('hex')));
      users.push(u); env.save();
    }
    return u;
  }

  // Dukaan asks: is this a StoreKart login?
  function verifyForDukaan(body) {
    if (!L().staffLogin) { const e = new Error('Signing in with StoreKart logins is switched off in StoreKart.'); e.status = 403; throw e; }
    const un = String(body.username || '').toLowerCase().replace(/\s+/g, '');
    const u = D().users.find(x => x.username === un && x.active !== false && !x.ext);
    if (!u || env.hash(String(body.password || ''), u.salt).hash !== u.hash) { const e = new Error('Wrong login name or password.'); e.status = 401; throw e; }
    if (u.role === 'delivery') { const e = new Error('Delivery staff can\'t use the billing counter.'); e.status = 403; throw e; }
    return { user: { id: u.id, name: u.name, role: u.role } };
  }

  // ---------- settings (owner / admin) ----------
  function status() {
    const l = L();
    return { enabled: l.enabled, url: l.url, hasKey: !!l.key, keyEnd: l.key ? l.key.slice(-4) : '', staffLogin: l.staffLogin, shop: l.shop,
      lastStockAt: l.lastStockAt, lastOkAt: l.lastOkAt, lastError: l.lastError,
      queue: Q().map(t => ({ id: t.id, kind: t.kind, number: t.number, tries: t.tries, error: t.error, nextAt: t.nextAt })),
      linked: D().products.reduce((n, p) => n + (p.link && p.link.item ? 1 : 0) + (p.variants || []).filter(v => v.link && v.link.item).length, 0) };
  }

  async function saveSettings(b) {
    const l = L();
    if (b.url != null) {
      let u = String(b.url).trim().split('#')[0];
      if (u && !/^https?:\/\//.test(u)) u = 'http://' + u;
      if (u && !u.endsWith('/')) u += '/';
      l.url = u;
    }
    if (b.key) l.key = String(b.key).trim();
    if (b.staffLogin != null) l.staffLogin = !!b.staffLogin;
    if (b.enabled != null) l.enabled = !!b.enabled;
    if (l.enabled && !(l.url && l.key)) { const e = new Error('Enter Dukaan\'s address and the link key first.'); e.status = 400; throw e; }
    env.save();
    if (l.enabled) {
      const h = await call('api/link/hello'); l.shop = h.shop || '';
      await pullStock().catch(() => {});
      // orders placed while the link was off: put their stock aside now
      for (const o of D().orders) if (!['delivered', 'cancelled'].includes(o.status) && !(o.dk && o.dk.reserved)) onOrderEvent('order', { id: o.id });
    }
    return status();
  }

  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
  async function autoMatch() {
    const items = await dukaanItems(true);
    const byName = new Map(items.map(i => [norm(i.name), i.name]));
    let n = 0;
    for (const p of D().products) {
      if (p.variants && p.variants.length > 1) {
        for (const v of p.variants) if (!(v.link && v.link.item)) {
          const hit = byName.get(norm(p.name + ' ' + v.name)) || byName.get(norm(v.name + ' ' + p.name));
          if (hit) { v.link = { item: hit, factor: 1 }; n++; }
        }
      } else if (!(p.link && p.link.item)) {
        const hit = byName.get(norm(p.name)) || (p.unit && byName.get(norm(p.name + ' ' + p.unit)));
        if (hit) { p.link = { item: hit, factor: 1 }; n++; }
      }
    }
    env.save(); await pullStock().catch(() => {});
    return { matched: n, status: status() };
  }

  async function importItems(b) {
    const items = await dukaanItems(true);
    const linked = new Set();
    for (const p of D().products) { if (p.link && p.link.item) linked.add(p.link.item); for (const v of p.variants || []) if (v.link && v.link.item) linked.add(v.link.item); }
    const groups = Array.isArray(b.groups) && b.groups.length ? new Set(b.groups) : null;
    const cfg = D().config;
    let n = 0;
    for (const it of items) {
      if (linked.has(it.name) || !it.can_sell || (groups && !groups.has(it.group))) continue;
      const cat = it.group || 'Other';
      if (!cfg.categories.includes(cat)) cfg.categories.push(cat);
      D().products.push(core.cleanProduct({
        name: it.name, category: cat, price: it.price / 100, mrp: it.mrp > it.price ? it.mrp / 100 : null, unit: it.unit,
        gstRate: it.gst, hsn: it.hsn, taxInclusive: true, emoji: '🛒', inStock: it.stock > 0, stock: Math.max(0, Math.floor(it.stock || 0)),
        link: { item: it.name, factor: 1 }, sort: D().products.length,
      }));
      n++;
    }
    env.save();
    return { imported: n, status: status() };
  }

  // ---------- routes ----------
  // from Dukaan (X-Link-Key)
  function keyOk(k) { const l = L(); return !!(l.enabled && l.key && k && k.length === l.key.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(l.key))); }
  async function fromDukaan(path, body) {
    if (path === '/api/link/hello') return { app: 'storekart', store: D().config ? D().config.name : '' };
    if (path === '/api/link/verify') return verifyForDukaan(body);
    const e = new Error('Not found'); e.status = 404; throw e;
  }
  // from the owner's Settings screen
  async function adminRoute(path, m, body) {
    if (path === '/api/link/settings' && m === 'GET') return status();
    if (path === '/api/link/settings' && m === 'POST') return saveSettings(body);
    if (path === '/api/link/test' && m === 'POST') { const h = await call('api/link/hello'); L().shop = h.shop || ''; return Object.assign({ ok: true }, h); }
    if (path === '/api/link/items' && m === 'GET') return on() ? { on: true, items: await dukaanItems(!!body.force) } : { on: false, items: [] };
    if (path === '/api/link/match' && m === 'POST') return autoMatch();
    if (path === '/api/link/import' && m === 'POST') return importItems(body);
    if (path === '/api/link/sync' && m === 'POST') { await pullStock(); return status(); }
    if (path === '/api/link/retry' && m === 'POST') { for (const t of Q()) t.nextAt = 0; await work(); return status(); }
    const e = new Error('Not found'); e.status = 404; throw e;
  }

  setInterval(() => { if (on()) { work(); } }, 5000);
  setInterval(() => { if (on()) pullStock().catch(e => { L().lastError = 'Stock: ' + e.message; }); }, 60000);
  setTimeout(() => { if (on()) { pullStock().catch(() => {}); work(); } }, 2000);

  return { onOrderEvent, loginViaDukaan, keyOk, fromDukaan, adminRoute, pullStock, status };
};
