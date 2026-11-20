/* StoreKart core — store rules shared by the server (Node) and the browser demo.
   Users & roles, permissions, pricing, order workflow, activity log and rider location. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StoreCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

// ---------------- roles ----------------
const ROLES = {
  admin:    { label: 'Admin',            emoji: '🛡️', about: 'Everything, including staff, settings and resetting the store' },
  owner:    { label: 'Store owner',      emoji: '👑', about: 'Everything except admin accounts and reset: sales, staff, settings, products, orders' },
  manager:  { label: 'Manager',          emoji: '🧑‍💼', about: 'Accepts or cancels orders, assigns delivery boys, manages products' },
  cashier:  { label: 'Cashier / Sales',  emoji: '🧾', about: 'Packs orders, marks them ready, takes payment, prints bills' },
  delivery: { label: 'Delivery boy',     emoji: '🛵', about: 'Sees only his deliveries, shares live location, marks delivered' },
};
const CAN = {
  settings: ['admin', 'owner'],
  staff:    ['admin', 'owner'],
  reports:  ['admin', 'owner'],
  export:   ['admin', 'owner'],
  reset:    ['admin'],
  products: ['admin', 'owner', 'manager'],
  viewOrders: ['admin', 'owner', 'manager', 'cashier'],
  accept:   ['admin', 'owner', 'manager'],   // accept, cancel, re-open
  assign:   ['admin', 'owner', 'manager'],   // choose delivery boy
  pack:     ['admin', 'owner', 'manager', 'cashier'], // packing / ready / hand over for pickup & dine-in
  payment:  ['admin', 'owner', 'manager', 'cashier'],
};
const can = (user, perm) => !!user && (CAN[perm] || []).includes(user.role);

// ---------------- helpers ----------------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (s, m) => { throw new HttpError(s, m); };
const str = (v, max = 500) => (v == null ? '' : String(v)).trim().slice(0, max);
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const money = v => Math.round(Math.max(0, num(v)) * 100) / 100;
const by = u => u ? { id: u.id, name: u.name, role: u.role } : null;
const who = u => u ? `${u.name} (${ROLES[u.role] ? ROLES[u.role].label : u.role})` : '';

function statusName(s, mode, bt) {
  if (s === 'new') return 'Order placed';
  if (s === 'accepted') return 'Order accepted';
  if (s === 'preparing') return bt === 'food' || bt === 'bakery' ? 'Being prepared' : 'Being packed';
  if (s === 'ready') return mode === 'pickup' ? 'Ready for pickup' : mode === 'dinein' ? 'Ready to serve' : 'Packed & ready';
  if (s === 'out') return 'Out for delivery';
  if (s === 'delivered') return mode === 'delivery' ? 'Delivered' : 'Completed';
  if (s === 'cancelled') return 'Cancelled';
  return s;
}
const flowFor = mode => mode === 'delivery' ? ['new', 'accepted', 'preparing', 'ready', 'out', 'delivered'] : ['new', 'accepted', 'preparing', 'ready', 'delivered'];

function distanceM(a, b) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function storeIsOpen(cfg, now = new Date()) {
  if (!cfg || !cfg.acceptingOrders) return false;
  const h = cfg.hours;
  if (!h || !h.enabled) return true;
  let local = now;
  try { local = new Date(now.toLocaleString('en-US', { timeZone: cfg.timezone || 'Asia/Kolkata' })); } catch {}
  const mins = local.getHours() * 60 + local.getMinutes();
  const [oh, om] = (h.open || '00:00').split(':').map(Number);
  const [ch, cm] = (h.close || '23:59').split(':').map(Number);
  const o = oh * 60 + om, c = ch * 60 + cm;
  return o <= c ? mins >= o && mins <= c : mins >= o || mins <= c;
}

// Prices are always calculated from the product list, never trusted from the browser.
function priceCart(cfg, products, items, mode, strict) {
  const lines = [];
  for (const it of Array.isArray(items) ? items.slice(0, 100) : []) {
    const p = products.find(x => x.id === it.productId);
    if (!p) { if (strict) fail(409, 'An item in your cart is no longer available. Please refresh.'); continue; }
    if (strict && !p.inStock) fail(409, `${p.name} is out of stock.`);
    const qty = Math.min(999, Math.max(1, Math.floor(num(it.qty, 1))));
    if (strict && p.stock != null && p.stock < qty) fail(409, `Only ${p.stock} of ${p.name} left.`);
    let unit = p.price, variant = null;
    if (p.variants && p.variants.length) {
      const v = p.variants.find(v => v.name === it.variant) || p.variants[0];
      if (strict && v.inStock === false) fail(409, `${p.name} (${v.name}) is out of stock.`);
      variant = v.name; unit = v.price;
    }
    const opts2 = p.options2 || [];
    const option2 = opts2.includes(it.option2) ? it.option2 : (opts2[0] || null);
    const addons = (Array.isArray(it.addons) ? it.addons : []).map(n => (p.addons || []).find(a => a.name === n)).filter(Boolean).map(a => ({ name: a.name, price: a.price }));
    unit = money(unit + addons.reduce((s, a) => s + a.price, 0));
    const line = { productId: p.id, name: p.name, image: p.image || '', emoji: p.emoji || '', variant, option2, addons, unitPrice: unit, qty, total: money(unit * qty), note: str(it.note, 200), hsn: p.hsn || '' };
    // GST per item: its own rate and "price includes GST" choice, or the store's default
    const t = (cfg && cfg.tax) || {};
    if (t.enabled) {
      const rate = p.gstRate != null && p.gstRate !== '' ? num(p.gstRate) : num(t.rate);
      const incl = p.taxInclusive === true || p.taxInclusive === false ? p.taxInclusive : t.inclusive !== false;
      const gst = incl ? money(line.total * rate / (100 + rate)) : money(line.total * rate / 100);
      Object.assign(line, { gstRate: rate, taxIncl: incl, gst, taxable: incl ? money(line.total - gst) : line.total });
    }
    lines.push(line);
  }
  const subtotal = money(lines.reduce((s, l) => s + l.total, 0));
  const d = (cfg && cfg.delivery) || {};
  let deliveryFee = 0;
  if (mode === 'delivery') deliveryFee = d.freeAbove && subtotal >= d.freeAbove ? 0 : money(d.fee);
  // packing charge only when switched on in Settings, and never for dine-in
  const packing = lines.length && cfg.packingEnabled && mode !== 'dinein' ? money(cfg.packingCharge || 0) : 0;
  // tax = GST added on top of prices; taxIncluded = GST already inside prices (shown for information)
  const tax = money(lines.reduce((s, l) => s + (l.gst && !l.taxIncl ? l.gst : 0), 0));
  const taxIncluded = money(lines.reduce((s, l) => s + (l.gst && l.taxIncl ? l.gst : 0), 0));
  const byRate = {};
  for (const l of lines) if (l.gstRate != null) {
    const r = byRate[l.gstRate] || (byRate[l.gstRate] = { rate: l.gstRate, taxable: 0, gst: 0 });
    r.taxable = money(r.taxable + l.taxable); r.gst = money(r.gst + l.gst);
  }
  // within the state: GST is split half CGST, half SGST
  const taxBreakup = Object.values(byRate).sort((a, b) => a.rate - b.rate).map(r => Object.assign(r, { cgst: money(r.gst / 2), sgst: money(r.gst - money(r.gst / 2)) }));
  return { lines, subtotal, deliveryFee, packing, tax, taxIncluded, taxBreakup, total: money(subtotal + deliveryFee + packing + tax) };
}

// ---------------- the store ----------------
// env: { db, save(), hash(pw, salt?) -> {salt, hash}, id(), makeToken(user), saveUpload(dataUrl) -> url, emit(event, data) }
function createCore(env) {
  const db = () => env.db;
  const nowIso = () => new Date().toISOString();

  function cleanProduct(p, existing = {}) {
    return {
      id: existing.id || env.id(),
      name: str(p.name, 120) || 'Untitled item',
      description: str(p.description, 2000),
      category: str(p.category, 60),
      price: money(p.price),
      mrp: p.mrp ? money(p.mrp) : null,
      unit: str(p.unit, 30),
      image: str(p.image, 2000000),
      emoji: str(p.emoji, 8),
      inStock: p.inStock !== false,
      stock: p.stock === '' || p.stock == null ? null : Math.max(0, Math.floor(num(p.stock))),
      featured: !!p.featured,
      veg: p.veg === true ? true : p.veg === false ? false : null,
      variants: Array.isArray(p.variants) ? p.variants.slice(0, 30).map(v => ({ name: str(v.name, 40), price: money(v.price), inStock: v.inStock !== false })).filter(v => v.name) : [],
      options2: Array.isArray(p.options2) ? p.options2.map(o => str(o, 40)).filter(Boolean).slice(0, 30) : [],
      addons: Array.isArray(p.addons) ? p.addons.slice(0, 30).map(a => ({ name: str(a.name, 40), price: money(a.price) })).filter(a => a.name) : [],
      gstRate: p.gstRate === '' || p.gstRate == null ? null : Math.min(40, Math.max(0, num(p.gstRate))), // null = store default
      hsn: str(p.hsn, 12).replace(/[^\dA-Za-z]/g, ''),
      taxInclusive: p.taxInclusive === true || p.taxInclusive === false ? p.taxInclusive : null,  // null = store default
      sort: num(p.sort, existing.sort || 0),
      createdAt: existing.createdAt || nowIso(),
    };
  }

  const publicUser = u => u && ({ id: u.id, name: u.name, username: u.username, phone: u.phone || '', role: u.role, active: u.active !== false, createdAt: u.createdAt });

  function makeUser(b, existing) {
    const u = existing || { id: env.id(), createdAt: nowIso(), active: true };
    if (b.name != null) u.name = str(b.name, 60) || u.name;
    if (b.username != null) {
      const un = str(b.username, 40).toLowerCase().replace(/\s+/g, '');
      if (!/^[a-z0-9._@-]{3,40}$/.test(un)) fail(400, 'Login name must be 3+ letters/numbers (no spaces).');
      if (db().users.some(x => x.username === un && x.id !== u.id)) fail(409, `Login name “${un}” is already taken.`);
      u.username = un;
    }
    if (b.phone != null) u.phone = str(b.phone, 20);
    if (b.role != null) { if (!ROLES[b.role]) fail(400, 'Unknown role.'); u.role = b.role; }
    if (b.active != null) u.active = !!b.active;
    if (b.password) {
      if (String(b.password).length < 4) fail(400, 'Password / PIN must be at least 4 characters.');
      Object.assign(u, env.hash(String(b.password)));
    }
    if (!u.name || !u.username || !u.role || !u.hash) fail(400, 'Name, login name, role and password are required.');
    return u;
  }

  function checkPw(u, pw) { return !!u && !!u.salt && env.hash(String(pw || ''), u.salt).hash === u.hash; }

  // what a customer is allowed to see about an order
  function publicOrder(o) {
    const { adminNote, ...rest } = o;
    return Object.assign({}, rest, {
      history: o.history.map(h => ({ status: h.status, at: h.at, text: h.text, role: h.by ? h.by.role : null })),
      assignedTo: o.assignedTo ? { name: o.assignedTo.name, phone: o.assignedTo.phone } : null,
      trail: (o.trail || []).slice(-150),
    });
  }

  function log(o, user, entry) {
    o.history.push(Object.assign({ at: nowIso(), by: by(user) }, entry));
    o.updatedAt = nowIso();
  }

  const isRiderOf = (u, o) => !!u && u.role === 'delivery' && o.assignedTo && o.assignedTo.id === u.id;

  function setStatus(o, user, s) {
    const allowed = ['new', 'accepted', 'preparing', 'ready', 'out', 'delivered', 'cancelled'];
    if (!allowed.includes(s)) fail(400, 'Unknown status');
    if (s === o.status) return;
    const final = ['delivered', 'cancelled'].includes(o.status);
    if (final && !can(user, 'accept')) fail(403, 'This order is already closed.');
    let ok = false;
    if (s === 'accepted' || s === 'cancelled' || s === 'new') ok = can(user, 'accept');
    else if (s === 'preparing' || s === 'ready') ok = can(user, 'pack');
    else if (s === 'out') ok = o.mode === 'delivery' && (isRiderOf(user, o) || can(user, 'accept'));
    else if (s === 'delivered') ok = o.mode === 'delivery' ? isRiderOf(user, o) || can(user, 'accept') : can(user, 'pack');
    if (!ok) fail(403, `Your role (${ROLES[user.role].label}) can't do that.`);
    if (s === 'out' && o.mode !== 'delivery') fail(400, 'Only delivery orders go out for delivery.');
    if (s === 'cancelled') {
      for (const l of o.lines) { const p = db().products.find(x => x.id === l.productId); if (p && p.stock != null) { p.stock += l.qty; p.inStock = true; } }
    }
    o.status = s;
    const bt = db().config.businessType;
    let text = `${statusName(s, o.mode, bt)} — by ${who(user)}`;
    if (s === 'out' && o.assignedTo) text = `Out for delivery with ${o.assignedTo.name}`;
    if (s === 'delivered' && o.mode === 'delivery') text = `Delivered by ${o.assignedTo ? o.assignedTo.name : who(user)}`;
    log(o, user, { status: s, text });
    if (s === 'delivered' || s === 'cancelled') o.sharing = false;
  }

  function handle(req) {
    const m = req.method, p = req.path, b = req.body || {};
    const D = db();
    const user = req.userId ? D.users.find(u => u.id === req.userId && u.active !== false) || null : null;
    const need = perm => { if (!user) fail(401, 'Please log in again.'); if (perm && !can(user, perm)) fail(403, `Your role (${ROLES[user.role].label}) can't do that.`); };
    let mm;

    if (p === '/api/health') return { ok: true };
    if (p === '/api/config' && m === 'GET') return D.config ? Object.assign({ configured: true, isOpen: storeIsOpen(D.config) }, D.config) : { configured: false, isOpen: false };

    if (p === '/api/setup' && m === 'POST') {
      if (D.config) fail(409, 'Store is already set up.');
      if (!b.password || String(b.password).length < 6) fail(400, 'Choose an admin password of at least 6 characters.');
      const admin = makeUser({ name: b.adminName || 'Admin', username: b.username || 'admin', phone: (b.config || {}).phone, role: 'admin', password: b.password });
      D.users = [admin];
      D.config = Object.assign({ acceptingOrders: true, timezone: 'Asia/Kolkata', currency: '₹' }, b.config || {});
      D.products = (Array.isArray(b.products) ? b.products : []).map(x => cleanProduct(x));
      env.save(true);
      return { token: env.makeToken(admin), user: publicUser(admin) };
    }

    if (p === '/api/login' && m === 'POST') {
      const u = D.users.find(x => x.username === str(b.username, 40).toLowerCase().replace(/\s+/g, ''));
      if (!u || !checkPw(u, b.password)) fail(401, 'Wrong login name or password.');
      if (u.active === false) fail(403, 'This account is switched off. Ask the store owner.');
      return { token: env.makeToken(u), user: publicUser(u) };
    }
    if (p === '/api/me' && m === 'GET') { need(); return publicUser(user); }
    if (p === '/api/password' && m === 'POST') {
      need();
      if (!checkPw(user, b.current)) fail(401, 'Current password is wrong.');
      if (!b.next || String(b.next).length < 4) fail(400, 'New password must be at least 4 characters.');
      Object.assign(user, env.hash(String(b.next))); env.save(true);
      return { token: env.makeToken(user), user: publicUser(user) };
    }

    // ----- staff -----
    if (p === '/api/users' && m === 'GET') {
      need();
      if (can(user, 'staff')) return D.users.map(publicUser);
      if (can(user, 'assign')) return D.users.filter(u => u.role === 'delivery' || u.id === user.id).map(publicUser);
      fail(403, 'Not allowed');
    }
    if (p === '/api/users' && m === 'POST') {
      need('staff');
      if (b.role === 'admin' && user.role !== 'admin') fail(403, 'Only an admin can create admin accounts.');
      const u = makeUser(b); D.users.push(u); env.save();
      return publicUser(u);
    }
    if ((mm = p.match(/^\/api\/users\/([\w-]+)$/))) {
      need('staff');
      const u = D.users.find(x => x.id === mm[1]); if (!u) fail(404, 'Staff member not found');
      if (u.role === 'admin' && user.role !== 'admin') fail(403, 'Only an admin can change admin accounts.');
      if (b.role === 'admin' && user.role !== 'admin') fail(403, 'Only an admin can give admin access.');
      const admins = D.users.filter(x => x.role === 'admin' && x.active !== false);
      if (m === 'DELETE') {
        if (u.id === user.id) fail(400, "You can't remove your own account.");
        if (u.role === 'admin' && admins.length <= 1) fail(400, 'Keep at least one admin.');
        D.users.splice(D.users.indexOf(u), 1); env.save();
        return { ok: true };
      }
      if (m === 'PUT') {
        if (u.id === user.id && (b.active === false || (b.role && b.role !== u.role))) fail(400, "You can't switch off or change the role of your own account.");
        if (u.role === 'admin' && admins.length <= 1 && ((b.role && b.role !== 'admin') || b.active === false)) fail(400, 'Keep at least one admin.');
        const copy = Object.assign({}, u);
        makeUser(b, copy);
        Object.assign(u, copy); env.save();
        return publicUser(u);
      }
    }

    // ----- settings -----
    if (p === '/api/config' && m === 'PUT') {
      need('settings');
      const nb = Object.assign({}, b); delete nb.configured; delete nb.isOpen;
      D.config = Object.assign({}, D.config, nb); env.save();
      return D.config;
    }
    if (p === '/api/accepting' && m === 'POST') { // quick open / pause switch for managers too
      need('accept'); D.config.acceptingOrders = !!b.on; env.save(); return { ok: true };
    }
    if (p === '/api/reset' && m === 'POST') {
      need('reset');
      if (!checkPw(user, b.password)) fail(401, 'Wrong password.');
      D.config = null; D.users = []; D.products = []; D.orders = []; D.orderSeq = 1000;
      env.save(true); return { ok: true };
    }
    if (p === '/api/export' && m === 'GET') {
      need('export');
      return { config: D.config, products: D.products, orders: D.orders, users: D.users.map(publicUser), exportedAt: nowIso() };
    }

    // ----- products -----
    if (p === '/api/products' && m === 'GET') return [...D.products].sort((a, b2) => (a.sort - b2.sort) || a.name.localeCompare(b2.name));
    if (p === '/api/products' && m === 'POST') { need('products'); const pr = cleanProduct(b); D.products.push(pr); env.save(); return pr; }
    if ((mm = p.match(/^\/api\/products\/([\w-]+)$/))) {
      need('products');
      const i = D.products.findIndex(x => x.id === mm[1]); if (i < 0) fail(404, 'Product not found');
      if (m === 'PUT') { D.products[i] = cleanProduct(b, D.products[i]); env.save(); return D.products[i]; }
      if (m === 'DELETE') { D.products.splice(i, 1); env.save(); return { ok: true }; }
    }
    if (p === '/api/upload' && m === 'POST') {
      need(); if (!can(user, 'products') && !can(user, 'settings')) fail(403, 'Not allowed');
      if (!/^data:image\/(png|jpe?g|webp|gif);base64,/.test(b.dataUrl || '')) fail(400, 'Please choose a PNG, JPG, WEBP or GIF image.');
      return { url: env.saveUpload(b.dataUrl) };
    }

    // ----- orders -----
    if (p === '/api/orders' && m === 'POST') {
      const cfg = D.config;
      if (!cfg) fail(400, 'Store is not set up yet.');
      // channel: online (website/app), kiosk (self-order screen in the shop), counter (staff billing)
      const channel = ['kiosk', 'counter'].includes(b.channel) ? b.channel : 'online';
      if (channel === 'counter') need('pack');
      if (channel === 'kiosk' && !(cfg.kiosk && cfg.kiosk.enabled)) fail(403, 'The self-order screen is switched off in Settings.');
      if (channel !== 'counter' && !storeIsOpen(cfg)) fail(409, 'Sorry, the store is closed right now.');
      const inStore = channel !== 'online';
      const c = b.customer || {};
      const name = str(c.name, 80) || (inStore ? (channel === 'kiosk' ? 'Guest' : 'Counter customer') : '');
      const phone = str(c.phone, 20).replace(/[^\d+]/g, '');
      if (!name) fail(400, 'Please enter your name.');
      if ((!inStore || phone) && phone.replace(/\D/g, '').length < 10) fail(400, 'Please enter a valid 10-digit phone number.');
      const modes = inStore ? ['pickup', 'dinein'].concat(channel === 'counter' && (cfg.modes || []).includes('delivery') ? ['delivery'] : []) : (cfg.modes || ['delivery', 'pickup']);
      const mode = modes.includes(b.mode) ? b.mode : modes[0];
      if (mode === 'delivery' && !str(c.address)) fail(400, 'Please enter your delivery address.');
      if (mode === 'dinein' && !inStore && !str(b.table, 10)) fail(400, 'Please enter your table number.');
      const payments = inStore ? ['cod', 'upi'] : (cfg.payments || ['cod']);
      const payment = payments.includes(b.payment) ? b.payment : payments[0];
      if (payment === 'upi' && !cfg.upiId) { if (!inStore) fail(400, 'UPI is not set up for this store.'); }
      const priced = priceCart(cfg, D.products, b.items, mode, true);
      if (!priced.lines.length) fail(400, 'Your cart is empty.');
      const d = cfg.delivery || {};
      if (mode === 'delivery' && d.minOrder && priced.subtotal < d.minOrder) fail(400, `Minimum order for delivery is ₹${d.minOrder}.`);
      for (const l of priced.lines) { const pr = D.products.find(x => x.id === l.productId); if (pr.stock != null) { pr.stock = Math.max(0, pr.stock - l.qty); if (!pr.stock) pr.inStock = false; } }
      let geo = null;
      if (c.geo && Math.abs(num(c.geo.lat, 999)) <= 90 && Math.abs(num(c.geo.lng, 999)) <= 180) geo = { lat: num(c.geo.lat), lng: num(c.geo.lng) };
      const at = nowIso();
      const placedText = channel === 'kiosk' ? 'Order placed on the in-store screen' : channel === 'counter' ? `Order taken at the counter by ${who(user)}` : 'Order placed';
      const o = Object.assign({
        id: env.id(), number: ++D.orderSeq, createdAt: at, updatedAt: at, status: 'new', channel,
        history: [{ status: 'new', at, text: placedText, by: channel === 'counter' ? by(user) : null }],
        customer: { name, phone, address: str(c.address, 500), landmark: str(c.landmark, 120), pincode: str(c.pincode, 10), geo },
        mode, table: str(b.table, 10), slot: str(b.slot, 60), payment, paid: false, note: str(b.note, 500),
        assignedTo: null, rider: null, trail: [], sharing: false,
      }, priced);
      // counter orders (and kiosk orders if set) skip the manager's accept step
      if (channel === 'counter' || (channel === 'kiosk' && cfg.kiosk.autoAccept)) {
        o.status = 'accepted';
        o.history.push({ status: 'accepted', at, text: channel === 'counter' ? `Order accepted — by ${who(user)}` : 'Order accepted automatically', by: channel === 'counter' ? by(user) : null });
      }
      if (channel === 'counter' && b.paid === true) {
        o.paid = true;
        const cash = payment === 'cod' && num(b.cashGiven) > 0 ? ` (cash ₹${money(b.cashGiven)}, change ₹${money(num(b.cashGiven) - o.total)})` : '';
        o.history.push({ at, text: `Payment of ₹${o.total} received${payment === 'upi' ? ' by UPI' : ' in cash'}${cash} — by ${who(user)}`, by: by(user) });
      }
      D.orders.unshift(o); env.save();
      env.emit('order', { id: o.id, number: o.number, total: o.total, name, channel, status: o.status });
      return { id: o.id, number: o.number, total: o.total };
    }
    if (p === '/api/orders' && m === 'GET') {
      need();
      if (user.role === 'delivery') {
        const dayAgo = Date.now() - 24 * 3600 * 1000;
        return D.orders.filter(o => isRiderOf(user, o) && (!['delivered', 'cancelled'].includes(o.status) || new Date(o.updatedAt) > dayAgo));
      }
      need('viewOrders');
      return D.orders.slice(0, 500);
    }
    if ((mm = p.match(/^\/api\/orders\/([\w-]+)\/location$/)) && m === 'POST') {
      need();
      const o = D.orders.find(x => x.id === mm[1]); if (!o) fail(404, 'Order not found');
      if (!isRiderOf(user, o)) fail(403, 'Only the delivery boy of this order can share location.');
      if (o.status !== 'out') fail(409, 'Start the delivery first.');
      const lat = num(b.lat, 999), lng = num(b.lng, 999);
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) fail(400, 'Bad location');
      const pt = { lat, lng, acc: Math.round(num(b.acc)), speed: b.speed == null ? null : num(b.speed), at: nowIso() };
      const last = o.trail[o.trail.length - 1];
      if (!last || distanceM({ lat: last[0], lng: last[1] }, pt) > 15 || Date.now() - last[2] > 60000) {
        o.trail.push([lat, lng, Date.now()]); if (o.trail.length > 500) o.trail.splice(0, o.trail.length - 500);
      }
      if (!o.sharing) log(o, user, { text: `${user.name} started sharing live location` });
      o.rider = pt; o.sharing = true;
      env.save();
      env.emit('location', { id: o.id });
      const dest = o.customer.geo;
      return { ok: true, distanceM: dest ? Math.round(distanceM(pt, dest)) : null };
    }
    if ((mm = p.match(/^\/api\/orders\/([\w-]+)$/))) {
      const o = D.orders.find(x => x.id === mm[1]); if (!o) fail(404, 'Order not found');
      if (m === 'GET') {
        if (user && (can(user, 'viewOrders') || isRiderOf(user, o))) return o;
        return publicOrder(o); // order ids are unguessable, so the link doubles as the customer's tracking link
      }
      if (m === 'PATCH') {
        need();
        if (user.role === 'delivery' && !isRiderOf(user, o)) fail(403, 'This order is not assigned to you.');
        if (b.assignTo !== undefined) {
          need('assign');
          if (o.mode !== 'delivery') fail(400, 'Only delivery orders need a delivery boy.');
          if (!b.assignTo) { if (o.assignedTo) log(o, user, { text: `Delivery boy removed by ${who(user)}` }); o.assignedTo = null; }
          else {
            const r = D.users.find(u => u.id === b.assignTo && u.role === 'delivery' && u.active !== false);
            if (!r) fail(400, 'Pick an active delivery boy.');
            o.assignedTo = { id: r.id, name: r.name, phone: r.phone || '' };
            o.rider = null; o.trail = []; o.sharing = false;
            log(o, user, { text: `${r.name} will deliver your order (assigned by ${who(user)})` });
            env.emit('assigned', { id: o.id, number: o.number, riderId: r.id });
          }
        }
        if (b.status) setStatus(o, user, b.status);
        if (typeof b.paid === 'boolean' && b.paid !== o.paid) {
          if (!can(user, 'payment') && !isRiderOf(user, o)) fail(403, "Your role can't change payment.");
          o.paid = b.paid;
          log(o, user, { text: b.paid ? `Payment of ₹${o.total} received${o.payment === 'cod' && user.role === 'delivery' ? ' in cash' : ''} — by ${who(user)}` : `Payment marked unpaid — by ${who(user)}` });
        }
        if (b.adminNote != null) { need('viewOrders'); o.adminNote = str(b.adminNote, 500); }
        env.save();
        env.emit('update', { id: o.id, status: o.status, riderId: o.assignedTo ? o.assignedTo.id : null });
        return o;
      }
    }
    fail(404, 'Not found');
  }

  return { handle, publicUser, cleanProduct };
}

return { ROLES, CAN, can, HttpError, createCore, priceCart, storeIsOpen, statusName, flowFor, distanceM };
});
