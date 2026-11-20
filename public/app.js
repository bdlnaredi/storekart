/* StoreKart front-end: setup wizard, storefront, checkout, order tracking and admin panel. */
(function () {
'use strict';

// ================= utilities =================
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const rupee = n => (S.cfg && S.cfg.currency || '₹') + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const uid = () => Math.random().toString(16).slice(2, 14).padEnd(12, '0');
function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 4500 : 2600);
}
const timeAgo = iso => {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const fmtTime = iso => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const imgOrEmoji = (p, fallback = '🛍️') => p.image ? `<img src="${esc(p.image)}" alt="" loading="lazy">` : esc(p.emoji || fallback);

// ================= pricing (mirrors the server) =================
function lineFor(item, products) {
  const p = products.find(x => x.id === item.productId);
  if (!p) return null;
  let unit = p.price, variant = null;
  if (p.variants && p.variants.length) {
    const v = p.variants.find(v => v.name === item.variant) || p.variants[0];
    variant = v.name; unit = v.price;
  }
  const addons = (item.addons || []).map(n => (p.addons || []).find(a => a.name === n)).filter(Boolean);
  unit += addons.reduce((s, a) => s + a.price, 0);
  unit = Math.round(unit * 100) / 100;
  return { productId: p.id, name: p.name, image: p.image, emoji: p.emoji, variant, option2: item.option2 || null, addons, unitPrice: unit, qty: item.qty, total: Math.round(unit * item.qty * 100) / 100, note: item.note || '', product: p };
}
function priceCart(cfg, products, items, mode) {
  const lines = items.map(i => lineFor(i, products)).filter(Boolean);
  const subtotal = Math.round(lines.reduce((s, l) => s + l.total, 0) * 100) / 100;
  const d = cfg.delivery || {};
  let deliveryFee = 0;
  if (mode === 'delivery') deliveryFee = d.freeAbove && subtotal >= d.freeAbove ? 0 : Number(d.fee || 0);
  const packing = lines.length ? Number(cfg.packingCharge || 0) : 0;
  const tax = cfg.tax && cfg.tax.enabled && !cfg.tax.inclusive ? Math.round(subtotal * cfg.tax.rate) / 100 : 0;
  const total = Math.round((subtotal + deliveryFee + packing + tax) * 100) / 100;
  return { lines, subtotal, deliveryFee, packing, tax, total };
}

// ================= API (real server, or a demo backend in the browser) =================
const DemoBackend = {
  // Used when no StoreKart server is reachable (e.g. the hosted preview). Everything lives in this browser.
  key: 'sk_demo_db',
  load() { return ls.get(this.key, null) || this.mem || { config: null, password: null, products: [], orders: [], seq: 1000 }; },
  save(db) { this.mem = db; ls.set(this.key, db); },
  isOpen(c) {
    if (!c.acceptingOrders) return false;
    const h = c.hours; if (!h || !h.enabled) return true;
    const n = new Date(), m = n.getHours() * 60 + n.getMinutes();
    const [a, b] = h.open.split(':').map(Number), [x, y] = h.close.split(':').map(Number);
    const o = a * 60 + b, cl = x * 60 + y;
    return o <= cl ? m >= o && m <= cl : m >= o || m <= cl;
  },
  async call(method, path, body) {
    const db = this.load();
    const err = (status, msg) => { const e = new Error(msg); e.status = status; throw e; };
    const authed = () => { if (ls.get('sk_token') !== 'demo-token') err(401, 'Please log in again.'); };
    let m;
    if (path === '/api/config' && method === 'GET') return db.config ? Object.assign({ configured: true, isOpen: this.isOpen(db.config) }, db.config) : { configured: false };
    if (path === '/api/setup') { db.config = Object.assign({ acceptingOrders: true }, body.config); db.password = body.password; db.products = body.products.map(p => Object.assign({ id: uid(), variants: [], addons: [], options2: [], tags: [], inStock: true, stock: null }, p)); this.save(db); return { token: 'demo-token' }; }
    if (path === '/api/login') { if (body.password !== db.password) err(401, 'Wrong password.'); return { token: 'demo-token' }; }
    if (path === '/api/config' && method === 'PUT') { authed(); db.config = Object.assign({}, db.config, body); this.save(db); return db.config; }
    if (path === '/api/password') { authed(); if (body.current !== db.password) err(401, 'Current password is wrong.'); db.password = body.next; this.save(db); return { token: 'demo-token' }; }
    if (path === '/api/reset') { authed(); if (body.password !== db.password) err(401, 'Wrong password.'); this.save({ config: null, password: null, products: [], orders: [], seq: 1000 }); return { ok: true }; }
    if (path === '/api/products' && method === 'GET') return db.products.slice().sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.name.localeCompare(b.name));
    if (path === '/api/products' && method === 'POST') { authed(); const p = Object.assign({}, body, { id: uid() }); db.products.push(p); this.save(db); return p; }
    if ((m = path.match(/^\/api\/products\/(\w+)$/))) {
      authed(); const i = db.products.findIndex(p => p.id === m[1]); if (i < 0) err(404, 'Not found');
      if (method === 'PUT') { db.products[i] = Object.assign({}, body, { id: m[1] }); this.save(db); return db.products[i]; }
      if (method === 'DELETE') { db.products.splice(i, 1); this.save(db); return { ok: true }; }
    }
    if (path === '/api/upload') { authed(); return { url: body.dataUrl }; }
    if (path === '/api/orders' && method === 'POST') {
      if (!this.isOpen(db.config)) err(409, 'Sorry, the store is closed right now.');
      const pr = priceCart(db.config, db.products, body.items, body.mode);
      if (!pr.lines.length) err(400, 'Your cart is empty.');
      const d = db.config.delivery || {};
      if (body.mode === 'delivery' && d.minOrder && pr.subtotal < d.minOrder) err(400, `Minimum order for delivery is ₹${d.minOrder}.`);
      const now = new Date().toISOString();
      const o = Object.assign({ id: uid(), number: ++db.seq, createdAt: now, status: 'new', history: [{ status: 'new', at: now }] }, body, pr, { lines: pr.lines.map(({ product, ...l }) => l) });
      delete o.items; db.orders.unshift(o); this.save(db);
      return { id: o.id, number: o.number, total: o.total };
    }
    if (path === '/api/orders' && method === 'GET') { authed(); return db.orders; }
    if ((m = path.match(/^\/api\/orders\/(\w+)$/))) {
      const o = db.orders.find(x => x.id === m[1]); if (!o) err(404, 'Order not found');
      if (method === 'GET') return o;
      authed();
      if (body.status && body.status !== o.status) { o.status = body.status; o.history.push({ status: body.status, at: new Date().toISOString() }); }
      if (typeof body.paid === 'boolean') o.paid = body.paid;
      this.save(db); return o;
    }
    if (path === '/api/export') { authed(); return db; }
    err(404, 'Not found');
  },
};

const Api = {
  demo: false,
  async detect() {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 2500);
      const r = await fetch('api/health', { signal: ctl.signal }); clearTimeout(t);
      const j = await r.json(); this.demo = !j.ok;
    } catch { this.demo = true; }
  },
  async call(method, path, body) {
    if (this.demo) return DemoBackend.call(method, path, body ? JSON.parse(JSON.stringify(body)) : body);
    const headers = { 'Content-Type': 'application/json' };
    const tok = ls.get('sk_token'); if (tok) headers.Authorization = 'Bearer ' + tok;
    const r = await fetch(path.slice(1), { method, headers, body: body ? JSON.stringify(body) : undefined });
    let j = {}; try { j = await r.json(); } catch {}
    if (!r.ok) { const e = new Error(j.error || 'Network error'); e.status = r.status; throw e; }
    return j;
  },
  get: p => Api.call('GET', p), post: (p, b) => Api.call('POST', p, b || {}), put: (p, b) => Api.call('PUT', p, b), patch: (p, b) => Api.call('PATCH', p, b), del: p => Api.call('DELETE', p),
};

// ================= state =================
const S = {
  cfg: null, products: [], cart: ls.get('sk_cart', []),
  cat: 'All', q: '', vegOnly: false,
  mode: null, wiz: null,
  orders: [], orderFilter: 'active', seenOrders: new Set(ls.get('sk_seen', [])),
};
const saveCart = () => ls.set('sk_cart', S.cart);
const cartCount = () => S.cart.reduce((s, i) => s + i.qty, 0);
const L = k => (S.cfg && S.cfg.labels && S.cfg.labels[k]) || { variant: 'Option', option2: 'Colour', addons: 'Extras', product: 'item', products: 'Shop', pickup: 'Pickup', cta: 'Add' }[k];
const MODE_NAMES = () => ({ delivery: 'Delivery', pickup: L('pickup') || 'Pickup', dinein: 'Dine-in' });

function applyTheme(color) {
  document.documentElement.style.setProperty('--brand', color || '#e23744');
  const m = $('meta[name=theme-color]'); if (m) m.content = color || '#e23744';
}

async function loadStore() {
  S.cfg = await Api.get('/api/config');
  if (S.cfg.configured) {
    S.products = await Api.get('/api/products');
    applyTheme(S.cfg.color);
    document.title = S.cfg.name || 'Online Store';
    // drop cart items whose products were removed
    S.cart = S.cart.filter(i => S.products.some(p => p.id === i.productId)); saveCart();
  }
}

// ================= router =================
const app = () => $('#app');
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  closeModal();
  window.scrollTo(0, 0);
  stopPolling();
  if (!S.cfg.configured) return renderWizard();
  if (a === 'admin') return renderAdmin(b || 'orders', h.split('/').slice(2).join('/'));
  if (a === 'cart') return renderCart();
  if (a === 'checkout') return renderCheckout();
  if (a === 'order' && b) return renderOrder(b);
  if (a === 'orders') return renderMyOrders();
  return renderStore();
}
window.addEventListener('hashchange', route);
const go = h => { if (location.hash === h) route(); else location.hash = h; };

let pollTimer = null;
const stopPolling = () => { clearInterval(pollTimer); pollTimer = null; };

// ================= setup wizard =================
const COLORS = ['#e23744', '#f97316', '#c2410c', '#ca8a04', '#0c8a3e', '#0f766e', '#0891b2', '#1d4ed8', '#6c4ce0', '#c026d3', '#be185d', '#1b1d21'];

function renderWizard() {
  const w = S.wiz || (S.wiz = { step: 1, type: null, cfg: null, samples: true });
  const steps = `<div class="steps">${[1, 2, 3, 4].map(i => `<i class="${i <= w.step ? 'on' : ''}"></i>`).join('')}</div>`;
  let body = '';
  if (w.step === 1) {
    body = `
      <h2>What kind of shop is this?</h2>
      <p class="muted">This sets up the right menu style, wording and sample items. You can change everything later.</p>
      <div class="types">${Object.entries(PRESETS).map(([k, p]) => `
        <button class="type ${w.type === k ? 'on' : ''}" data-act="wizType" data-k="${k}" style="${w.type === k ? `--brand:${p.color}` : ''}">
          <div class="e">${p.emoji}</div><div class="n">${esc(p.label)}</div><div class="d">${esc(p.blurb)}</div>
        </button>`).join('')}</div>
      <div class="wiz-nav"><span class="spacer"></span><button class="btn primary lg" data-act="wizNext" ${w.type ? '' : 'disabled'}>Continue →</button></div>`;
  } else if (w.step === 2) {
    const c = w.cfg;
    body = `
      <h2>Your store details</h2>
      <p class="muted">Customers see these on your store page.</p>
      <div class="card stack">
        <label class="f"><span>Store name *</span><input type="text" id="w-name" value="${esc(c.name || '')}" placeholder="e.g. ${w.type === 'food' ? 'Burger Junction' : w.type === 'clothing' ? 'Style Street' : w.type === 'grocery' ? 'Sharma Kirana Store' : 'My Store'}"></label>
        <label class="f"><span>Tagline</span><input type="text" id="w-tag" value="${esc(c.tagline || '')}"></label>
        <div class="grid2">
          <label class="f"><span>WhatsApp / phone number *</span><input type="tel" id="w-phone" value="${esc(c.phone || '')}" placeholder="10-digit mobile number"></label>
          <label class="f"><span>Logo emoji</span><input type="text" id="w-emoji" value="${esc(c.logoEmoji || '')}" maxlength="4"></label>
        </div>
        <label class="f"><span>Shop address</span><textarea id="w-addr" placeholder="Shown to customers for pickup">${esc(c.address || '')}</textarea></label>
        <div><span class="small" style="font-weight:600">Brand colour</span>
          <div class="swatches" style="margin-top:8px">${COLORS.map(col => `<button class="swatch ${c.color === col ? 'on' : ''}" style="background:${col}" data-act="wizColor" data-c="${col}" aria-label="${col}"></button>`).join('')}
          <input type="color" id="w-color" value="${esc(c.color)}" style="width:40px;height:34px;border:0;background:none;padding:0"></div></div>
      </div>
      <div class="wiz-nav"><button class="btn lg" data-act="wizBack">← Back</button><span class="spacer"></span><button class="btn primary lg" data-act="wizNext">Continue →</button></div>`;
  } else if (w.step === 3) {
    const c = w.cfg, mn = MODE_NAMES();
    body = `
      <h2>How do customers order?</h2>
      <div class="card stack">
        <div><b>Order types</b><div class="row wrap" style="margin-top:8px">
          ${['delivery', 'pickup', 'dinein'].map(m => `<label class="check ${c.modes.includes(m) ? 'on' : ''}"><input type="checkbox" class="w-mode" value="${m}" ${c.modes.includes(m) ? 'checked' : ''}><span>${m === 'pickup' ? esc(c.labels.pickup) : mn[m]}</span></label>`).join('')}
        </div></div>
        <div class="grid3">
          <label class="f"><span>Delivery charge (₹)</span><input type="number" id="w-fee" value="${c.delivery.fee}" min="0"></label>
          <label class="f"><span>Free delivery above (₹)</span><input type="number" id="w-free" value="${c.delivery.freeAbove}" min="0"></label>
          <label class="f"><span>Minimum order (₹)</span><input type="number" id="w-min" value="${c.delivery.minOrder}" min="0"></label>
        </div>
        <label class="f"><span>Delivery time shown to customers</span><input type="text" id="w-eta" value="${esc(c.delivery.eta)}"></label>
        <div><b>Payment</b><div class="stack" style="margin-top:8px">
          <label class="check ${c.payments.includes('cod') ? 'on' : ''}"><input type="checkbox" class="w-pay" value="cod" ${c.payments.includes('cod') ? 'checked' : ''}><span>Cash / pay on delivery or at counter</span></label>
          <label class="check ${c.payments.includes('upi') ? 'on' : ''}"><input type="checkbox" class="w-pay" value="upi" ${c.payments.includes('upi') ? 'checked' : ''}><span>UPI (GPay, PhonePe, Paytm) — customer pays straight to your UPI ID</span></label>
          <label class="f"><span>Your UPI ID</span><input type="text" id="w-upi" value="${esc(c.upiId)}" placeholder="yourname@okaxis"></label>
        </div></div>
      </div>
      <div class="wiz-nav"><button class="btn lg" data-act="wizBack">← Back</button><span class="spacer"></span><button class="btn primary lg" data-act="wizNext">Continue →</button></div>`;
  } else {
    const pr = PRESETS[w.type];
    body = `
      <h2>Almost done</h2>
      <div class="card stack">
        <label class="check ${w.samples ? 'on' : ''}"><input type="checkbox" id="w-samples" ${w.samples ? 'checked' : ''}><span><b>Add ${pr.products.length} sample ${esc(pr.labels.product)}s</b><br><span class="small muted">${esc(pr.products.slice(0, 4).map(p => p.name).join(', '))}… — edit prices and photos later, or delete them.</span></span></label>
        <div class="small muted">Categories: ${esc(w.cfg.categories.join(' · '))}</div>
        <label class="f"><span>Admin password * (to manage orders and products)</span><input type="password" id="w-pw" placeholder="At least 6 characters" autocomplete="new-password"></label>
        <label class="f"><span>Type it again</span><input type="password" id="w-pw2" autocomplete="new-password"></label>
      </div>
      <div class="wiz-nav"><button class="btn lg" data-act="wizBack">← Back</button><span class="spacer"></span><button class="btn primary lg" data-act="wizFinish">🚀 Launch my store</button></div>`;
  }
  app().innerHTML = `<div class="wizard"><div class="narrow" style="max-width:760px">
    <div class="wiz-head"><div class="mark">🛍️</div><h1>Set up your online store</h1>${steps}</div>${body}</div></div>`;
  if (w.step === 3) $$('.w-mode, .w-pay').forEach(i => i.addEventListener('change', () => i.closest('.check').classList.toggle('on', i.checked)));
  if (w.step === 4) $('#w-samples').addEventListener('change', e => { w.samples = e.target.checked; e.target.closest('.check').classList.toggle('on', w.samples); });
  if (w.step === 2) $('#w-color').addEventListener('input', e => { readWizStep(); w.cfg.color = e.target.value; applyTheme(w.cfg.color); $$('.swatch').forEach(s => s.classList.remove('on')); });
}
function readWizStep() {
  const w = S.wiz, c = w.cfg;
  if (w.step === 2) {
    c.name = $('#w-name').value.trim(); c.tagline = $('#w-tag').value.trim(); c.phone = $('#w-phone').value.trim();
    c.logoEmoji = $('#w-emoji').value.trim(); c.address = $('#w-addr').value.trim();
  }
  if (w.step === 3) {
    c.modes = $$('.w-mode:checked').map(i => i.value);
    c.payments = $$('.w-pay:checked').map(i => i.value);
    c.upiId = $('#w-upi').value.trim();
    c.delivery = Object.assign({}, c.delivery, { fee: +$('#w-fee').value || 0, freeAbove: +$('#w-free').value || 0, minOrder: +$('#w-min').value || 0, eta: $('#w-eta').value.trim() });
  }
}
const wizActions = {
  wizType(el) { const k = el.dataset.k; S.wiz.type = k; S.wiz.cfg = presetConfig(k); applyTheme(PRESETS[k].color); renderWizard(); },
  wizColor(el) { readWizStep(); S.wiz.cfg.color = el.dataset.c; applyTheme(el.dataset.c); renderWizard(); },
  wizBack() { readWizStep(); S.wiz.step--; renderWizard(); },
  wizNext() {
    readWizStep();
    const w = S.wiz, c = w.cfg;
    if (w.step === 2) {
      if (!c.name) return toast('Please enter your store name', 'bad');
      if (c.phone.replace(/\D/g, '').length < 10) return toast('Please enter a 10-digit phone number', 'bad');
    }
    if (w.step === 3) {
      if (!c.modes.length) return toast('Pick at least one order type', 'bad');
      if (!c.payments.length) return toast('Pick at least one payment method', 'bad');
      if (c.payments.includes('upi') && !/^[\w.\-]+@[\w]+$/.test(c.upiId)) return toast('Enter a valid UPI ID like name@okaxis', 'bad');
    }
    w.step++; renderWizard(); window.scrollTo(0, 0);
  },
  async wizFinish(el) {
    const pw = $('#w-pw').value, pw2 = $('#w-pw2').value;
    if (pw.length < 6) return toast('Password must be at least 6 characters', 'bad');
    if (pw !== pw2) return toast('The two passwords don’t match', 'bad');
    el.disabled = true;
    try {
      const r = await Api.post('/api/setup', { password: pw, config: S.wiz.cfg, products: S.wiz.samples ? presetProducts(S.wiz.type) : [] });
      ls.set('sk_token', r.token);
      S.wiz = null; S.cart = []; saveCart();
      await loadStore();
      toast('Your store is live! 🎉', 'ok');
      go('#/admin/orders');
    } catch (e) { toast(e.message, 'bad'); el.disabled = false; }
  },
};

// ================= storefront =================
function storeHeader(back) {
  const c = S.cfg, n = cartCount();
  return `<header class="topbar"><div class="wrap-page inner">
    ${back ? `<a class="icon-btn" href="${back}" aria-label="Back">←</a>` : ''}
    <a href="#/" class="row" style="text-decoration:none;gap:10px;min-width:0">
      <div class="logo">${c.logoImage ? `<img src="${esc(c.logoImage)}" alt="">` : esc(c.logoEmoji || '🛍️')}</div>
      <div style="min-width:0"><div class="store-name">${esc(c.name)}</div>
      <div class="small" style="color:${c.isOpen ? 'var(--ok)' : 'var(--bad)'};font-weight:600">${c.isOpen ? '● Open now' : '● Closed'}</div></div>
    </a>
    <span class="spacer"></span>
    <a class="icon-btn" href="#/orders" title="My orders">🧾</a>
    <a class="icon-btn cart-btn" href="#/cart" title="Cart">🛒${n ? `<span class="badge">${n}</span>` : ''}</a>
  </div></header>
  ${c.isOpen ? '' : `<div class="closed-bar"><div class="wrap-page">We're not taking orders right now${c.hours && c.hours.enabled ? ` — open ${esc(c.hours.open)} to ${esc(c.hours.close)}` : ''}. You can still browse.</div></div>`}`;
}

function qtyInCart(pid) { return S.cart.filter(i => i.productId === pid).reduce((s, i) => s + i.qty, 0); }
function hasChoices(p) { return (p.variants && p.variants.length > 1) || (p.options2 && p.options2.length) || (p.addons && p.addons.length); }
function fromPrice(p) {
  const inS = (p.variants || []).filter(v => v.inStock !== false);
  return inS.length ? Math.min(...inS.map(v => v.price)) : (p.variants && p.variants.length ? p.variants[0].price : p.price);
}
function pctOff(p) { const pr = p.variants && p.variants.length ? p.variants[0].price : p.price; return p.mrp && p.mrp > pr ? Math.round((1 - pr / p.mrp) * 100) : 0; }

function productCard(p) {
  const c = S.cfg, q = qtyInCart(p.id), off = pctOff(p);
  const unit = p.unit || (p.variants && p.variants.length === 1 ? p.variants[0].name : p.variants && p.variants.length ? `${p.variants.length} ${L('variant').toLowerCase()}s` : '');
  let ctl;
  if (!p.inStock) ctl = `<span class="small muted">Sold out</span>`;
  else if (q && !hasChoices(p)) ctl = `<div class="stepper" data-stop><button data-act="dec" data-id="${p.id}">−</button><span>${q}</span><button data-act="inc" data-id="${p.id}">+</button></div>`;
  else ctl = `<button class="add-btn" data-act="${hasChoices(p) ? 'open' : 'quickAdd'}" data-id="${p.id}">${q ? `${q} in cart +` : esc(L('cta') || 'Add')}</button>`;
  return `<div class="pcard" data-act="open" data-id="${p.id}">
    <div class="pimg">${imgOrEmoji(p)}${off && c.features && c.features.mrp !== false ? `<span class="off">${off}% OFF</span>` : ''}${p.inStock ? '' : '<div class="oos">Out of stock</div>'}</div>
    <div class="pbody">
      <div class="row" style="gap:6px;align-items:flex-start">${c.features && c.features.veg && p.veg != null ? `<span class="veg-dot ${p.veg ? '' : 'nv'}" style="margin-top:3px"></span>` : ''}<div class="pname">${esc(p.name)}</div></div>
      ${unit ? `<div class="punit">${esc(unit)}</div>` : ''}
      <div class="pfoot"><div><span class="price">${rupee(fromPrice(p))}</span>${p.mrp && p.mrp > fromPrice(p) ? `<span class="mrp">${rupee(p.mrp)}</span>` : ''}</div>${ctl}</div>
    </div></div>`;
}

function renderStore() {
  const c = S.cfg;
  const cats = ['All', ...c.categories.filter(cat => S.products.some(p => p.category === cat))];
  if (S.products.some(p => !c.categories.includes(p.category))) cats.push('Other');
  if (!cats.includes(S.cat)) S.cat = 'All';
  const q = S.q.toLowerCase();
  let list = S.products.filter(p => (!q || (p.name + ' ' + (p.description || '') + ' ' + p.category).toLowerCase().includes(q)) && (!S.vegOnly || p.veg === true));
  const featured = !q && S.cat === 'All' ? list.filter(p => p.featured) : [];
  let sections;
  if (S.cat === 'All') {
    sections = cats.slice(1).map(cat => ({ cat, items: list.filter(p => cat === 'Other' ? !c.categories.includes(p.category) : p.category === cat) })).filter(s => s.items.length);
  } else {
    sections = [{ cat: S.cat, items: list.filter(p => S.cat === 'Other' ? !c.categories.includes(p.category) : p.category === S.cat) }];
  }
  const d = c.delivery || {};
  const meta = [
    c.modes.includes('delivery') && d.eta ? `🛵 ${esc(d.eta)}` : '',
    c.modes.includes('delivery') && d.freeAbove ? `Free delivery above ${rupee(d.freeAbove)}` : '',
    c.modes.includes('delivery') && d.minOrder ? `Min. order ${rupee(d.minOrder)}` : '',
    c.modes.includes('pickup') ? `🏬 ${esc(L('pickup'))}` : '',
    c.modes.includes('dinein') ? '🍽️ Dine-in' : '',
  ].filter(Boolean);
  const n = cartCount(), total = n ? priceCart(c, S.products, S.cart, null).subtotal : 0;
  app().innerHTML = `${storeHeader()}
    <section class="hero"><div class="wrap-page inner"><h1>${esc(c.name)}</h1><p>${esc(c.tagline || '')}</p>
      <div class="meta">${meta.map(m => `<span>${m}</span>`).join('')}</div></div></section>
    <div class="wrap-page page-pad">
      <div class="toolbar">
        <div class="search"><input type="search" id="q" placeholder="Search ${esc((L('products') || 'shop').toLowerCase() === 'menu' ? 'the menu' : 'products')}…" value="${esc(S.q)}"></div>
        <div class="chips">
          ${c.features && c.features.veg ? `<button class="chip veg ${S.vegOnly ? 'on' : ''}" data-act="vegOnly">🟢 Veg only</button>` : ''}
          ${cats.map(cat => `<button class="chip ${S.cat === cat ? 'on' : ''}" data-act="cat" data-c="${esc(cat)}">${esc(cat)}</button>`).join('')}
        </div>
      </div>
      ${featured.length ? `<div class="section-title">⭐ Bestsellers</div><div class="grid">${featured.map(productCard).join('')}</div>` : ''}
      ${sections.map(s => `<div class="section-title">${esc(s.cat)}</div><div class="grid">${s.items.map(productCard).join('')}</div>`).join('')}
      ${!sections.length ? `<div class="empty"><div class="big">🔎</div>${S.products.length ? 'Nothing matches your search.' : 'No products yet — check back soon!'}</div>` : ''}
    </div>
    ${storeFooter()}
    ${n ? `<a class="cart-bar" href="#/cart"><span>${n} item${n > 1 ? 's' : ''} · ${rupee(total)}</span><span>View cart →</span></a>` : ''}`;
  const qi = $('#q');
  qi.addEventListener('input', () => { S.q = qi.value; const pos = qi.selectionStart; renderStore(); const n2 = $('#q'); n2.focus(); n2.setSelectionRange(pos, pos); });
}
function storeFooter() {
  const c = S.cfg;
  return `<footer class="store-foot"><div class="wrap-page stack">
    <div class="row wrap" style="gap:24px;align-items:flex-start">
      <div style="flex:1;min-width:220px"><b style="color:var(--ink)">${esc(c.name)}</b>${c.address ? `<div>${esc(c.address)}</div>` : ''}
        ${c.hours && c.hours.enabled ? `<div>Open ${esc(c.hours.open)} – ${esc(c.hours.close)}</div>` : ''}
        ${c.tax && c.tax.enabled && c.tax.gstin ? `<div>GSTIN: ${esc(c.tax.gstin)}</div>` : ''}</div>
      <div style="flex:1;min-width:220px">${c.phone ? `<div>📞 <a href="tel:${esc(c.phone)}">${esc(c.phone)}</a></div><div>💬 <a href="${waLink(c.phone, 'Hi ' + c.name + '!')}" target="_blank" rel="noopener">Chat on WhatsApp</a></div>` : ''}
        ${c.policy ? `<div style="margin-top:6px">${esc(c.policy)}</div>` : ''}</div>
    </div>
    <div class="small"><a href="#/admin" style="color:var(--muted)">Store admin</a></div>
  </div></footer>`;
}
function waLink(phone, text) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) d = '91' + d;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}

// ---- product sheet ----
function openModal(html) { $('#modal-root').innerHTML = `<div class="overlay" data-act="closeModal">${html}</div>`; document.body.style.overflow = 'hidden'; }
function closeModal() { $('#modal-root').innerHTML = ''; document.body.style.overflow = ''; }

function openProduct(id) {
  const p = S.products.find(x => x.id === id); if (!p) return;
  const c = S.cfg;
  const st = { variant: (p.variants.find(v => v.inStock !== false) || p.variants[0] || {}).name, option2: p.options2[0], addons: [], qty: 1, note: '' };
  const isSize = p.variants.length && p.variants.every(v => v.price === p.variants[0].price);
  const draw = () => {
    const ln = lineFor(Object.assign({ productId: p.id }, st), S.products);
    openModal(`<div class="sheet" data-stop>
      <div class="sheet-img">${imgOrEmoji(p)}</div>
      <div class="sheet-body">
        <div class="row" style="align-items:flex-start">${c.features && c.features.veg && p.veg != null ? `<span class="veg-dot ${p.veg ? '' : 'nv'}" style="margin-top:6px"></span>` : ''}<h2 style="flex:1">${esc(p.name)}</h2><button class="icon-btn" data-act="closeModal">✕</button></div>
        <div><span class="price" style="font-size:18px">${rupee(ln.unitPrice)}</span>${p.mrp && p.mrp > ln.unitPrice ? `<span class="mrp">${rupee(p.mrp)}</span> <span class="pill ok">${Math.round((1 - ln.unitPrice / p.mrp) * 100)}% off</span>` : ''} ${p.unit ? `<span class="muted small">· ${esc(p.unit)}</span>` : ''}</div>
        ${p.description ? `<p class="muted">${esc(p.description)}</p>` : ''}
        ${p.stock != null && p.stock <= 5 && p.stock > 0 ? `<div class="pill warn">Only ${p.stock} left</div>` : ''}
        ${p.variants.length > 1 ? `<div class="opt-group"><h4>${esc(L('variant'))}</h4>${isSize
          ? `<div class="size-list">${p.variants.map(v => `<button class="size ${st.variant === v.name ? 'on' : ''} ${v.inStock === false ? 'disabled' : ''}" data-v="${esc(v.name)}">${esc(v.name)}</button>`).join('')}</div>`
          : `<div class="opt-list">${p.variants.map(v => `<label class="opt ${st.variant === v.name ? 'on' : ''} ${v.inStock === false ? 'disabled' : ''}"><input type="radio" name="v" value="${esc(v.name)}" ${st.variant === v.name ? 'checked' : ''}><span style="flex:1">${esc(v.name)}${v.inStock === false ? ' (sold out)' : ''}</span><b>${rupee(v.price)}</b></label>`).join('')}</div>`}</div>` : ''}
        ${p.options2.length ? `<div class="opt-group"><h4>${esc(L('option2') || 'Colour')}</h4><div class="size-list">${p.options2.map(o => `<button class="size ${st.option2 === o ? 'on' : ''}" data-o2="${esc(o)}">${esc(o)}</button>`).join('')}</div></div>` : ''}
        ${p.addons.length ? `<div class="opt-group"><h4>${esc(L('addons') || 'Extras')} <span class="muted small">(optional)</span></h4><div class="opt-list">${p.addons.map(a => `<label class="opt ${st.addons.includes(a.name) ? 'on' : ''}"><input type="checkbox" value="${esc(a.name)}" ${st.addons.includes(a.name) ? 'checked' : ''}><span style="flex:1">${esc(a.name)}</span><b>+${rupee(a.price)}</b></label>`).join('')}</div></div>` : ''}
        <div class="opt-group"><h4>Special instructions <span class="muted small">(optional)</span></h4><input type="text" id="p-note" value="${esc(st.note)}" placeholder="${c.businessType === 'bakery' ? 'Message on cake, e.g. Happy Birthday Riya' : c.businessType === 'food' ? 'e.g. less spicy, no onion' : 'Anything we should know?'}"></div>
      </div>
      <div class="sheet-foot">
        <div class="stepper"><button data-q="-1">−</button><span>${st.qty}</span><button data-q="1">+</button></div>
        <button class="btn primary lg" style="flex:1" id="p-add" ${p.inStock ? '' : 'disabled'}>${p.inStock ? `Add · ${rupee(ln.unitPrice * st.qty)}` : 'Out of stock'}</button>
      </div></div>`);
    const sh = $('.sheet');
    $$('[data-v]', sh).forEach(b => b.onclick = () => { st.variant = b.dataset.v; keepNote(); draw(); });
    $$('input[name=v]', sh).forEach(i => i.onchange = () => { st.variant = i.value; keepNote(); draw(); });
    $$('[data-o2]', sh).forEach(b => b.onclick = () => { st.option2 = b.dataset.o2; keepNote(); draw(); });
    $$('.opt input[type=checkbox]', sh).forEach(i => i.onchange = () => { st.addons = $$('.opt input[type=checkbox]:checked', sh).map(x => x.value); keepNote(); draw(); });
    $$('[data-q]', sh).forEach(b => b.onclick = () => { st.qty = Math.max(1, Math.min(99, st.qty + +b.dataset.q)); keepNote(); draw(); });
    $('#p-add').onclick = () => { keepNote(); addToCart(p.id, st); closeModal(); refreshAfterCart(); toast(`Added ${p.name}`, 'ok'); };
    function keepNote() { st.note = $('#p-note').value; }
  };
  draw();
}

function addToCart(pid, st) {
  const key = [pid, st.variant || '', st.option2 || '', (st.addons || []).slice().sort().join('+'), st.note || ''].join('|');
  const ex = S.cart.find(i => i.key === key);
  if (ex) ex.qty += st.qty || 1;
  else S.cart.push({ key, productId: pid, variant: st.variant || null, option2: st.option2 || null, addons: st.addons || [], note: st.note || '', qty: st.qty || 1 });
  saveCart();
}
function refreshAfterCart() {
  const h = location.hash.replace(/^#\/?/, '');
  if (h === '' ) { const y = window.scrollY; renderStore(); window.scrollTo(0, y); }
  else if (h === 'cart') renderCart();
}

// ---- cart ----
function renderCart() {
  const c = S.cfg;
  if (!S.cart.length) {
    app().innerHTML = `${storeHeader('#/')}<div class="narrow"><div class="empty"><div class="big">🛒</div><h2>Your cart is empty</h2><p>Add something tasty… or stylish… or useful!</p><a class="btn primary" href="#/">Browse ${esc(L('products'))}</a></div></div>`;
    return;
  }
  const pr = priceCart(c, S.products, S.cart, (c.modes || [])[0]);
  app().innerHTML = `${storeHeader('#/')}<div class="narrow page-pad">
    <h2 style="margin-top:18px">Your cart</h2>
    <div class="card">${pr.lines.map((l, i) => `<div class="line">
      <div class="thumb">${imgOrEmoji(l)}</div>
      <div style="flex:1;min-width:0"><b>${esc(l.name)}</b>
        <div class="small muted">${[l.variant, l.option2, ...l.addons.map(a => '+ ' + a.name)].filter(Boolean).map(esc).join(' · ')}${l.note ? `<br>“${esc(l.note)}”` : ''}</div>
        <div class="row" style="margin-top:6px"><div class="stepper"><button data-act="cartQty" data-i="${i}" data-d="-1">−</button><span>${l.qty}</span><button data-act="cartQty" data-i="${i}" data-d="1">+</button></div><span class="spacer"></span><b>${rupee(l.total)}</b></div>
      </div></div>`).join('')}</div>
    <div class="card" style="margin-top:12px"><div class="bill">
      <div class="r"><span>Item total</span><span>${rupee(pr.subtotal)}</span></div>
      ${pr.packing ? `<div class="r"><span>Packing charge</span><span>${rupee(pr.packing)}</span></div>` : ''}
      ${pr.tax ? `<div class="r"><span>GST (${c.tax.rate}%)</span><span>${rupee(pr.tax)}</span></div>` : ''}
      ${c.modes.includes('delivery') ? `<div class="r muted small"><span>Delivery charge is added at checkout${c.delivery.freeAbove ? ` (free above ${rupee(c.delivery.freeAbove)})` : ''}</span></div>` : ''}
    </div></div>
    ${c.modes.includes('delivery') && c.delivery.freeAbove && pr.subtotal < c.delivery.freeAbove ? `<p class="pill brand" style="margin-top:12px">Add ${rupee(c.delivery.freeAbove - pr.subtotal)} more for free delivery</p>` : ''}
    <div style="margin-top:16px" class="row"><a class="btn" href="#/">+ Add more</a><span class="spacer"></span><button class="btn primary lg" data-act="toCheckout" ${c.isOpen ? '' : 'disabled'}>${c.isOpen ? 'Checkout →' : 'Store is closed'}</button></div>
  </div>`;
}

// ---- checkout ----
function renderCheckout() {
  const c = S.cfg;
  if (!S.cart.length) return go('#/cart');
  const cust = ls.get('sk_customer', {});
  S.form = null;
  if (!S.mode || !c.modes.includes(S.mode)) S.mode = c.modes[0];
  const draw = () => {
    const pr = priceCart(c, S.products, S.cart, S.mode);
    const mn = MODE_NAMES();
    const d = c.delivery || {};
    const short = S.mode === 'delivery' && d.minOrder && pr.subtotal < d.minOrder;
    const pay = c.payments || ['cod'];
    const payNow = $('input[name=pay]:checked') ? $('input[name=pay]:checked').value : pay[0];
    // remember what was typed, even for fields hidden by the current order type
    const v = S.form || (S.form = { name: cust.name || '', phone: cust.phone || '', address: cust.address || '', landmark: cust.landmark || '', pincode: cust.pincode || '', table: '', slot: '', note: '' });
    [['name', '#c-name'], ['phone', '#c-phone'], ['address', '#c-addr'], ['landmark', '#c-land'], ['pincode', '#c-pin'], ['table', '#c-table'], ['slot', '#c-slot'], ['note', '#c-note']].forEach(([k, id]) => { if ($(id)) v[k] = $(id).value; });
    app().innerHTML = `${storeHeader('#/cart')}<div class="narrow page-pad">
      <h2 style="margin-top:18px">Checkout</h2>
      ${c.modes.length > 1 ? `<div class="seg">${c.modes.map(m => `<button class="${S.mode === m ? 'on' : ''}" data-act="mode" data-m="${m}">${m === 'delivery' ? '🛵' : m === 'pickup' ? '🏬' : '🍽️'} ${esc(mn[m])}</button>`).join('')}</div>` : ''}
      <div class="card stack" style="margin-top:12px">
        <div class="grid2">
          <label class="f"><span>Your name *</span><input type="text" id="c-name" value="${esc(v.name)}" autocomplete="name"></label>
          <label class="f"><span>Mobile number *</span><input type="tel" id="c-phone" value="${esc(v.phone)}" autocomplete="tel" inputmode="tel"></label>
        </div>
        ${S.mode === 'delivery' ? `
          <label class="f"><span>Delivery address *</span><textarea id="c-addr" autocomplete="street-address" placeholder="House / flat no., street, area">${esc(v.address)}</textarea></label>
          <div class="grid2"><label class="f"><span>Landmark</span><input type="text" id="c-land" value="${esc(v.landmark)}"></label>
          <label class="f"><span>Pincode</span><input type="text" id="c-pin" value="${esc(v.pincode)}" inputmode="numeric" maxlength="6"></label></div>` : ''}
        ${S.mode === 'pickup' && c.address ? `<div class="pill">📍 Pick up from: ${esc(c.address)}</div>` : ''}
        ${S.mode === 'dinein' ? `<label class="f"><span>Table number *</span><input type="text" id="c-table" value="${esc(v.table)}" inputmode="numeric"></label>` : ''}
        ${c.features && c.features.slots && c.slots && c.slots.length && S.mode !== 'dinein' ? `<label class="f"><span>${S.mode === 'delivery' ? 'Delivery' : 'Pickup'} time</span><select id="c-slot">${['As soon as possible', ...c.slots].map(s => `<option ${v.slot === s ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>` : ''}
        <label class="f"><span>Note for the store</span><input type="text" id="c-note" value="${esc(v.note)}" placeholder="Optional"></label>
      </div>
      <div class="card stack" style="margin-top:12px"><b>Payment</b>
        ${pay.map(p => `<label class="opt ${payNow === p ? 'on' : ''}"><input type="radio" name="pay" value="${p}" ${payNow === p ? 'checked' : ''}><span style="flex:1">${p === 'upi' ? '📲 UPI — GPay / PhonePe / Paytm' : S.mode === 'delivery' ? '💵 Cash on delivery' : '💵 Pay at counter'}</span></label>`).join('')}
      </div>
      <div class="card" style="margin-top:12px"><div class="bill">
        ${pr.lines.map(l => `<div class="r"><span>${l.qty} × ${esc(l.name)}${l.variant ? ` (${esc(l.variant)})` : ''}</span><span>${rupee(l.total)}</span></div>`).join('')}
        <div class="r" style="border-top:1px solid var(--line);padding-top:6px"><span>Item total</span><span>${rupee(pr.subtotal)}</span></div>
        ${S.mode === 'delivery' ? `<div class="r"><span>Delivery</span><span>${pr.deliveryFee ? rupee(pr.deliveryFee) : '<b style="color:var(--ok)">FREE</b>'}</span></div>` : ''}
        ${pr.packing ? `<div class="r"><span>Packing</span><span>${rupee(pr.packing)}</span></div>` : ''}
        ${pr.tax ? `<div class="r"><span>GST (${c.tax.rate}%)</span><span>${rupee(pr.tax)}</span></div>` : ''}
        ${c.tax && c.tax.enabled && c.tax.inclusive ? `<div class="r small muted"><span>Prices include GST</span></div>` : ''}
        <div class="r total"><span>To pay</span><span>${rupee(pr.total)}</span></div>
      </div></div>
      ${short ? `<p class="pill warn" style="margin-top:12px">Minimum order for delivery is ${rupee(d.minOrder)} — add ${rupee(d.minOrder - pr.subtotal)} more.</p>` : ''}
      <button class="btn primary lg block" style="margin-top:16px" data-act="placeOrder" ${short || !c.isOpen ? 'disabled' : ''}>Place order · ${rupee(pr.total)}</button>
    </div>`;
    $$('input[name=pay]').forEach(i => i.onchange = draw);
  };
  S.drawCheckout = draw;
  draw();
}

async function placeOrder(btn) {
  const val = id => ($(id) ? $(id).value.trim() : '');
  const customer = { name: val('#c-name'), phone: val('#c-phone'), address: val('#c-addr'), landmark: val('#c-land'), pincode: val('#c-pin') };
  if (!customer.name) return toast('Please enter your name', 'bad');
  if (customer.phone.replace(/\D/g, '').length < 10) return toast('Please enter a valid mobile number', 'bad');
  if (S.mode === 'delivery' && !customer.address) return toast('Please enter your delivery address', 'bad');
  if (S.mode === 'dinein' && !val('#c-table')) return toast('Please enter your table number', 'bad');
  btn.disabled = true; btn.textContent = 'Placing order…';
  try {
    const r = await Api.post('/api/orders', {
      customer, mode: S.mode, table: val('#c-table'), slot: val('#c-slot'), note: val('#c-note'),
      payment: ($('input[name=pay]:checked') || {}).value || 'cod',
      items: S.cart.map(i => ({ productId: i.productId, variant: i.variant, option2: i.option2, addons: i.addons, qty: i.qty, note: i.note })),
    });
    ls.set('sk_customer', Object.assign(ls.get('sk_customer', {}), customer));
    const mine = ls.get('sk_my_orders', []); mine.unshift({ id: r.id, number: r.number, total: r.total, at: new Date().toISOString() }); ls.set('sk_my_orders', mine.slice(0, 30));
    S.cart = []; saveCart();
    S.products = await Api.get('/api/products');
    go('#/order/' + r.id + '/new');
  } catch (e) {
    toast(e.message, 'bad'); btn.disabled = false; btn.textContent = 'Place order';
    if (e.status === 409) { S.products = await Api.get('/api/products'); S.cfg = await Api.get('/api/config'); }
  }
}

// ---- order tracking ----
const STATUS = {
  new: { t: 'Order placed', e: '📝' }, accepted: { t: 'Accepted', e: '👍' },
  preparing: { t: 'Being prepared', e: '👨‍🍳' }, ready: { t: 'Ready', e: '✅' },
  out: { t: 'Out for delivery', e: '🛵' }, delivered: { t: 'Delivered', e: '🎉' }, cancelled: { t: 'Cancelled', e: '✖️' },
};
function statusName(s, mode) {
  const bt = S.cfg && S.cfg.businessType;
  if (s === 'preparing') return bt === 'food' || bt === 'bakery' ? 'Being prepared' : 'Being packed';
  if (s === 'ready') return mode === 'pickup' ? 'Ready for pickup' : mode === 'dinein' ? 'Ready to serve' : 'Packed & ready';
  if (s === 'delivered') return mode === 'delivery' ? 'Delivered' : 'Completed';
  return STATUS[s].t;
}
const flowFor = mode => mode === 'delivery' ? ['new', 'accepted', 'preparing', 'out', 'delivered'] : ['new', 'accepted', 'preparing', 'ready', 'delivered'];
function upiLink(o) {
  const c = S.cfg;
  return `upi://pay?pa=${encodeURIComponent(c.upiId)}&pn=${encodeURIComponent(c.name)}&am=${o.total.toFixed(2)}&cu=INR&tn=${encodeURIComponent('Order #' + o.number)}`;
}
function orderSummaryText(o) {
  const mn = MODE_NAMES();
  return [`🛍️ *New order #${o.number}* — ${S.cfg.name}`, '',
    ...o.lines.map(l => `• ${l.qty} × ${l.name}${l.variant ? ` (${l.variant})` : ''}${l.option2 ? ` [${l.option2}]` : ''}${l.addons && l.addons.length ? ` + ${l.addons.map(a => a.name).join(', ')}` : ''} — ₹${l.total}`),
    '', `*Total: ₹${o.total}* (${o.payment === 'upi' ? 'UPI' : 'Cash'})`, `${mn[o.mode]}${o.table ? ' · Table ' + o.table : ''}${o.slot ? ' · ' + o.slot : ''}`,
    `${o.customer.name}, ${o.customer.phone}`, o.mode === 'delivery' ? `📍 ${o.customer.address}${o.customer.landmark ? ', ' + o.customer.landmark : ''}${o.customer.pincode ? ' - ' + o.customer.pincode : ''}` : '',
    o.note ? `Note: ${o.note}` : '', '', `Track: ${location.href.split('#')[0]}#/order/${o.id}`].filter(x => x !== '').join('\n');
}

async function renderOrder(id) {
  const fresh = location.hash.endsWith('/new');
  let o;
  try { o = await Api.get('/api/orders/' + id); } catch (e) { app().innerHTML = `${storeHeader('#/')}<div class="narrow"><div class="empty"><div class="big">🤷</div>Order not found.</div></div>`; return; }
  const flow = flowFor(o.mode);
  const idx = o.status === 'cancelled' ? -1 : flow.indexOf(o.status);
  const when = s => (o.history.find(h => h.status === s) || {}).at;
  app().innerHTML = `${storeHeader('#/')}<div class="narrow page-pad">
    ${fresh ? `<div class="card" style="margin-top:18px;text-align:center;background:var(--brand-soft);border-color:transparent"><div style="font-size:44px">🎉</div><h2>Order placed!</h2><p class="muted" style="margin:0">Order #${o.number} · ${rupee(o.total)}</p></div>` : `<h2 style="margin-top:18px">Order #${o.number}</h2>`}
    ${o.payment === 'upi' && !o.paid && o.status !== 'cancelled' ? `<div class="card stack" style="margin-top:12px"><b>Pay ${rupee(o.total)} by UPI</b>
      <a class="btn primary lg block" href="${upiLink(o)}">📲 Pay with UPI app</a>
      <div class="small muted">Or pay to UPI ID <b>${esc(S.cfg.upiId)}</b> and mention order #${o.number}. The store confirms your payment.</div></div>` : ''}
    ${o.paid ? `<div class="pill ok" style="margin-top:12px">✓ Payment received</div>` : ''}
    <div class="card" style="margin-top:12px">
      ${o.status === 'cancelled' ? `<div class="pill bad">This order was cancelled</div>` : `<div class="timeline">${flow.map((s, i) => `<div class="tl ${i <= idx ? 'done' : ''} ${i === idx ? 'cur' : ''}"><div class="dot">${i <= idx ? '✓' : ''}</div><div><div class="t">${esc(statusName(s, o.mode))}</div>${when(s) ? `<div class="small muted">${fmtTime(when(s))}</div>` : ''}</div></div>`).join('')}</div>`}
    </div>
    <div class="card" style="margin-top:12px"><div class="bill">
      ${o.lines.map(l => `<div class="r"><span>${l.qty} × ${esc(l.name)}${l.variant ? ` (${esc(l.variant)})` : ''}${l.option2 ? ` · ${esc(l.option2)}` : ''}${l.addons && l.addons.length ? `<br><span class="small muted">+ ${esc(l.addons.map(a => a.name).join(', '))}</span>` : ''}</span><span>${rupee(l.total)}</span></div>`).join('')}
      ${o.deliveryFee ? `<div class="r"><span>Delivery</span><span>${rupee(o.deliveryFee)}</span></div>` : ''}
      ${o.packing ? `<div class="r"><span>Packing</span><span>${rupee(o.packing)}</span></div>` : ''}
      ${o.tax ? `<div class="r"><span>GST</span><span>${rupee(o.tax)}</span></div>` : ''}
      <div class="r total"><span>Total</span><span>${rupee(o.total)}</span></div>
    </div>
    <p class="small muted" style="margin-bottom:0">${esc(MODE_NAMES()[o.mode])}${o.table ? ` · Table ${esc(o.table)}` : ''}${o.slot ? ` · ${esc(o.slot)}` : ''} · ${o.payment === 'upi' ? 'UPI' : 'Cash'} · ${fmtTime(o.createdAt)}</p></div>
    <div class="row wrap" style="margin-top:14px">
      ${S.cfg.phone ? `<a class="btn" style="flex:1" href="${waLink(S.cfg.phone, orderSummaryText(o))}" target="_blank" rel="noopener">💬 Send order on WhatsApp</a><a class="btn" href="tel:${esc(S.cfg.phone)}">📞 Call store</a>` : ''}
    </div>
    <a class="btn ghost block" href="#/" style="margin-top:8px">← Back to store</a>
  </div>`;
  if (!['delivered', 'cancelled'].includes(o.status)) {
    pollTimer = setInterval(async () => {
      try { const n = await Api.get('/api/orders/' + id); if (n.status !== o.status || n.paid !== o.paid) { if (fresh) location.hash = '#/order/' + id; else { stopPolling(); renderOrder(id); } } } catch {}
    }, 15000);
  }
}

function renderMyOrders() {
  const mine = ls.get('sk_my_orders', []);
  app().innerHTML = `${storeHeader('#/')}<div class="narrow page-pad"><h2 style="margin-top:18px">My orders</h2>
    ${mine.length ? `<div class="card">${mine.map(o => `<a class="line" href="#/order/${o.id}" style="text-decoration:none"><div class="thumb">🧾</div><div style="flex:1"><b>Order #${o.number}</b><div class="small muted">${fmtTime(o.at)}</div></div><b>${rupee(o.total)}</b></a>`).join('')}</div>`
    : `<div class="empty"><div class="big">🧾</div>No orders on this phone yet.</div>`}</div>`;
}

// ================= admin =================
let events = null;
function adminShell(tab, inner) {
  const c = S.cfg;
  return `<div class="admin"><header class="admin-top"><div class="wrap-page inner">
      <div class="logo" style="width:34px;height:34px;font-size:18px">${c.logoImage ? `<img src="${esc(c.logoImage)}" alt="">` : esc(c.logoEmoji || '🛍️')}</div>
      <nav class="tabs">
        <a href="#/admin/orders" class="${tab === 'orders' ? 'on' : ''}">Orders</a>
        <a href="#/admin/products" class="${tab === 'products' || tab === 'product' ? 'on' : ''}">${esc(L('products') === 'Menu' ? 'Menu' : 'Products')}</a>
        <a href="#/admin/settings" class="${tab === 'settings' ? 'on' : ''}">Settings</a>
      </nav>
      <span class="spacer"></span>
      <a href="#/" class="btn sm" style="background:transparent;color:#fff;border-color:#3a3e46" target="_blank"><span class="store-link-txt">View store </span>↗</a>
    </div></header><div class="wrap-page" style="padding-bottom:60px">${inner}</div></div>`;
}

function renderLogin() {
  app().innerHTML = `<div class="narrow"><div class="card login-box stack">
    <div style="text-align:center"><div class="logo" style="margin:0 auto 10px">${esc(S.cfg.logoEmoji || '🛍️')}</div><h2>${esc(S.cfg.name)} admin</h2></div>
    <label class="f"><span>Password</span><input type="password" id="l-pw" autocomplete="current-password"></label>
    <button class="btn primary block lg" data-act="login">Log in</button>
    <a href="#/" class="btn ghost block">← Back to store</a></div></div>`;
  const i = $('#l-pw'); i.focus(); i.onkeydown = e => { if (e.key === 'Enter') actions.login(); };
}

async function renderAdmin(tab, rest) {
  if (!ls.get('sk_token')) return renderLogin();
  try {
    if (tab === 'orders') await renderAdminOrders();
    else if (tab === 'products') await renderAdminProducts();
    else if (tab === 'product') renderProductForm(rest);
    else if (tab === 'settings') renderSettings();
    else go('#/admin/orders');
    connectEvents();
  } catch (e) {
    if (e.status === 401) { ls.del('sk_token'); renderLogin(); } else toast(e.message, 'bad');
  }
}

function connectEvents() {
  if (Api.demo) {
    if (!window.__skStorage) { window.__skStorage = true; window.addEventListener('storage', e => { if (e.key === DemoBackend.key) onNewOrderMaybe(); }); }
    return;
  }
  if (events) return;
  events = new EventSource('api/events?token=' + encodeURIComponent(ls.get('sk_token')));
  events.addEventListener('order', e => { const d = JSON.parse(e.data); notifyNewOrder(d); });
  events.onerror = () => { events.close(); events = null; setTimeout(() => location.hash.startsWith('#/admin') && connectEvents(), 8000); };
}
async function onNewOrderMaybe() {
  const before = S.orders.length ? S.orders[0].id : null;
  const list = await Api.get('/api/orders');
  if (list.length && list[0].id !== before && list[0].status === 'new') notifyNewOrder(list[0]);
}
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, .25, .5].forEach(t => { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(.25, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + t + .2); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + .22); });
  } catch {}
}
function notifyNewOrder(d) {
  beep();
  toast(`🔔 New order #${d.number} — ${rupee(d.total)}`, 'ok');
  try { if (Notification.permission === 'granted') new Notification(`New order #${d.number}`, { body: `${d.name || d.customer && d.customer.name || ''} · ₹${d.total}` }); } catch {}
  if (location.hash.startsWith('#/admin/orders') || location.hash === '#/admin') renderAdminOrders();
}

async function renderAdminOrders() {
  S.orders = await Api.get('/api/orders');
  const today = new Date().toDateString();
  const todays = S.orders.filter(o => new Date(o.createdAt).toDateString() === today && o.status !== 'cancelled');
  const active = S.orders.filter(o => !['delivered', 'cancelled'].includes(o.status));
  const f = S.orderFilter;
  const list = S.orders.filter(o => f === 'all' ? true : f === 'active' ? !['delivered', 'cancelled'].includes(o.status) : f === 'done' ? o.status === 'delivered' : o.status === f).slice(0, 200);
  const c = S.cfg;
  app().innerHTML = adminShell('orders', `
    <div class="stats">
      <div class="stat"><div class="k">Today's orders</div><div class="v">${todays.length}</div></div>
      <div class="stat"><div class="k">Today's sales</div><div class="v">${rupee(todays.reduce((s, o) => s + o.total, 0))}</div></div>
      <div class="stat"><div class="k">Active orders</div><div class="v">${active.length}</div></div>
      <div class="stat"><div class="k">Store</div><div class="v" style="font-size:16px;padding-top:4px"><label class="row" style="cursor:pointer"><span class="switch"><input type="checkbox" id="accepting" ${c.acceptingOrders ? 'checked' : ''}><i></i></span>${c.acceptingOrders ? 'Taking orders' : 'Paused'}</label></div></div>
    </div>
    <div class="row wrap" style="margin-bottom:12px">
      <div class="chips" style="padding:0">${[['active', 'Active'], ['new', 'New'], ['done', 'Completed'], ['cancelled', 'Cancelled'], ['all', 'All']].map(([k, t]) => `<button class="chip ${f === k ? 'on' : ''}" data-act="ofilter" data-f="${k}">${t}</button>`).join('')}</div>
      <span class="spacer"></span>
      ${'Notification' in window && Notification.permission === 'default' ? `<button class="btn sm" data-act="askNotify">🔔 Enable alerts</button>` : ''}
      <button class="btn sm" data-act="refreshOrders">↻ Refresh</button>
    </div>
    ${list.length ? `<div class="olist">${list.map(orderCard).join('')}</div>` : `<div class="empty"><div class="big">📭</div>${f === 'active' ? 'No active orders right now. New orders will ring here.' : 'No orders here.'}<br><br><a class="btn" href="#/" target="_blank">Open your store to test an order</a></div>`}
  `);
  $('#accepting').onchange = async e => { await Api.put('/api/config', { acceptingOrders: e.target.checked }); S.cfg = await Api.get('/api/config'); renderAdminOrders(); toast(e.target.checked ? 'Store is taking orders' : 'Orders paused'); };
  if (!pollTimer) pollTimer = setInterval(() => { if (location.hash.startsWith('#/admin/orders')) renderAdminOrders().catch(() => {}); }, 60000);
}

function orderCard(o) {
  const flow = flowFor(o.mode);
  const i = flow.indexOf(o.status);
  const next = o.status === 'cancelled' || i < 0 || i === flow.length - 1 ? null : flow[i + 1];
  const nextLabel = { accepted: '✓ Accept order', preparing: S.cfg.businessType === 'food' || S.cfg.businessType === 'bakery' ? '👨‍🍳 Start preparing' : '📦 Start packing', ready: '✅ Mark ready', out: '🛵 Out for delivery', delivered: o.mode === 'delivery' ? '🎉 Mark delivered' : '🎉 Mark completed' }[next];
  const pill = { new: 'brand', accepted: 'warn', preparing: 'warn', ready: 'ok', out: 'ok', delivered: '', cancelled: 'bad' }[o.status];
  const cu = o.customer;
  return `<div class="ocard ${o.status === 'new' ? 'new' : ''}">
    <div class="row"><b style="font-size:17px">#${o.number}</b><span class="pill ${pill}">${esc(statusName(o.status, o.mode))}</span><span class="spacer"></span><span class="small muted">${timeAgo(o.createdAt)}</span></div>
    <div class="small" style="margin-top:6px"><b>${esc(cu.name)}</b> · <a href="tel:${esc(cu.phone)}">${esc(cu.phone)}</a> · <a href="${waLink(cu.phone, `Hi ${cu.name}, about your order #${o.number} from ${S.cfg.name}: `)}" target="_blank" rel="noopener">WhatsApp</a></div>
    <div class="small muted">${o.mode === 'delivery' ? '🛵 ' + esc(cu.address + (cu.landmark ? ', ' + cu.landmark : '') + (cu.pincode ? ' - ' + cu.pincode : '')) : o.mode === 'dinein' ? '🍽️ Table ' + esc(o.table) : '🏬 ' + esc(MODE_NAMES().pickup)}${o.slot ? ' · ⏰ ' + esc(o.slot) : ''}</div>
    <div class="oitems">${o.lines.map(l => `<div><span>${l.qty} × ${esc(l.name)}${l.variant ? ` <b>(${esc(l.variant)})</b>` : ''}${l.option2 ? ` · ${esc(l.option2)}` : ''}${l.addons && l.addons.length ? `<br><span class="muted small">+ ${esc(l.addons.map(a => a.name).join(', '))}</span>` : ''}${l.note ? `<br><span class="small" style="color:var(--warn)">“${esc(l.note)}”</span>` : ''}</span><span>${rupee(l.total)}</span></div>`).join('')}
      ${o.note ? `<div class="small" style="color:var(--warn);margin-top:6px">Note: ${esc(o.note)}</div>` : ''}</div>
    <div class="row"><b>${rupee(o.total)}</b><span class="pill ${o.paid ? 'ok' : ''}">${o.payment === 'upi' ? 'UPI' : 'Cash'} · ${o.paid ? 'Paid' : 'Unpaid'}</span><span class="spacer"></span>
      <button class="btn sm ghost" data-act="togglePaid" data-id="${o.id}">${o.paid ? 'Mark unpaid' : 'Mark paid'}</button></div>
    <div class="row wrap" style="margin-top:10px">
      ${next ? `<button class="btn primary sm" style="flex:1" data-act="setStatus" data-id="${o.id}" data-s="${next}">${nextLabel}</button>` : ''}
      <button class="btn sm" data-act="printBill" data-id="${o.id}">🖨️ Bill</button>
      ${!['delivered', 'cancelled'].includes(o.status) ? `<button class="btn sm danger" data-act="cancelOrder" data-id="${o.id}">Cancel</button>` : ''}
    </div></div>`;
}

function printBill(o) {
  const c = S.cfg;
  $('#print-area').innerHTML = `<h2>${esc(c.name)}</h2><div class="c">${esc(c.address || '')}<br>${esc(c.phone || '')}${c.tax && c.tax.enabled && c.tax.gstin ? `<br>GSTIN: ${esc(c.tax.gstin)}` : ''}</div><hr>
    <div>Order #${o.number}<br>${fmtTime(o.createdAt)}<br>${esc(o.customer.name)} ${esc(o.customer.phone)}<br>${esc(MODE_NAMES()[o.mode])}${o.table ? ' T-' + esc(o.table) : ''}${o.mode === 'delivery' ? '<br>' + esc(o.customer.address) : ''}</div><hr>
    <table>${o.lines.map(l => `<tr><td>${l.qty} x ${esc(l.name)}${l.variant ? ` (${esc(l.variant)})` : ''}${l.option2 ? ` ${esc(l.option2)}` : ''}${l.addons && l.addons.length ? `<br>&nbsp;+ ${esc(l.addons.map(a => a.name).join(', '))}` : ''}</td><td style="text-align:right">${l.total.toFixed(2)}</td></tr>`).join('')}</table><hr>
    <table><tr><td>Subtotal</td><td style="text-align:right">${o.subtotal.toFixed(2)}</td></tr>
    ${o.deliveryFee ? `<tr><td>Delivery</td><td style="text-align:right">${o.deliveryFee.toFixed(2)}</td></tr>` : ''}
    ${o.packing ? `<tr><td>Packing</td><td style="text-align:right">${o.packing.toFixed(2)}</td></tr>` : ''}
    ${o.tax ? `<tr><td>GST</td><td style="text-align:right">${o.tax.toFixed(2)}</td></tr>` : ''}
    <tr><td><b>TOTAL</b></td><td style="text-align:right"><b>₹${o.total.toFixed(2)}</b></td></tr></table><hr>
    <div class="c">${o.payment === 'upi' ? 'UPI' : 'Cash'} · ${o.paid ? 'PAID' : 'UNPAID'}<br>Thank you! Visit again 🙏</div>`;
  window.print();
}

// ---- products admin ----
async function renderAdminProducts() {
  S.products = await Api.get('/api/products');
  const c = S.cfg;
  const q = (S.adminQ || '').toLowerCase();
  const list = S.products.filter(p => !q || (p.name + ' ' + p.category).toLowerCase().includes(q));
  app().innerHTML = adminShell('products', `
    <div class="row wrap" style="margin:16px 0">
      <h2 style="margin:0">${esc(L('products') === 'Menu' ? 'Menu' : 'Products')} <span class="muted" style="font-weight:500">(${S.products.length})</span></h2><span class="spacer"></span>
      <input type="search" id="aq" placeholder="Search…" value="${esc(S.adminQ || '')}" style="max-width:220px">
      <a class="btn primary" href="#/admin/product/new">+ Add ${esc(L('product'))}</a>
    </div>
    ${list.length ? `<div style="overflow-x:auto"><table class="ptable"><thead><tr><th></th><th>Name</th><th>Category</th><th>Price</th><th>In stock</th><th></th></tr></thead><tbody>
    ${list.map(p => `<tr>
      <td style="width:56px"><div class="thumb" style="width:44px;height:44px;font-size:22px">${imgOrEmoji(p)}</div></td>
      <td><b>${esc(p.name)}</b>${p.featured ? ' <span class="pill brand">⭐</span>' : ''}${c.features && c.features.veg && p.veg != null ? ` <span class="veg-dot ${p.veg ? '' : 'nv'}"></span>` : ''}<div class="small muted">${p.variants && p.variants.length ? esc(p.variants.map(v => v.name).join(', ')) : esc(p.unit || '')}${p.stock != null ? ` · ${p.stock} left` : ''}</div></td>
      <td class="small">${esc(p.category)}</td>
      <td>${rupee(fromPrice(p))}${p.mrp ? `<div class="mrp" style="margin:0">${rupee(p.mrp)}</div>` : ''}</td>
      <td><label class="switch"><input type="checkbox" data-act="stockToggle" data-id="${p.id}" ${p.inStock ? 'checked' : ''}><i></i></label></td>
      <td style="white-space:nowrap"><a class="btn sm" href="#/admin/product/${p.id}">Edit</a></td></tr>`).join('')}
    </tbody></table></div>` : `<div class="empty"><div class="big">📦</div>No ${esc(L('product'))}s yet.<br><br><a class="btn primary" href="#/admin/product/new">+ Add your first ${esc(L('product'))}</a></div>`}
  `);
  const aq = $('#aq'); aq.oninput = () => { S.adminQ = aq.value; const pos = aq.selectionStart; renderAdminProducts().then(() => { const n = $('#aq'); n.focus(); n.setSelectionRange(pos, pos); }); };
}

function rowsEditor(id, rows, withPrice, withStock) {
  return `<div class="rows-edit" id="${id}">${rows.map(r => rowHtml(r, withPrice, withStock)).join('')}</div>
    <button class="btn sm" style="margin-top:8px" data-act="addRow" data-t="${id}" data-p="${withPrice ? 1 : 0}" data-s="${withStock ? 1 : 0}">+ Add</button>`;
}
function rowHtml(r, withPrice, withStock) {
  return `<div class="r ${withStock ? '' : 'two'}"><input type="text" class="rn" value="${esc(r.name || '')}" placeholder="Name">${withPrice ? `<input type="number" class="rp" value="${r.price ?? ''}" placeholder="₹ Price" min="0" step="0.01">` : ''}${withStock ? `<label class="row small" title="In stock"><span class="switch"><input type="checkbox" class="rs" ${r.inStock !== false ? 'checked' : ''}><i></i></span></label>` : ''}<button class="icon-btn" data-act="delRow" title="Remove">🗑️</button></div>`;
}
const readRows = id => $$(`#${id} .r`).map(r => ({ name: $('.rn', r).value.trim(), price: $('.rp', r) ? +$('.rp', r).value || 0 : undefined, inStock: $('.rs', r) ? $('.rs', r).checked : undefined })).filter(r => r.name);

function renderProductForm(pid) {
  const c = S.cfg;
  const isNew = pid === 'new';
  const p = isNew ? { name: '', category: c.categories[0] || '', price: '', mrp: '', unit: '', description: '', inStock: true, stock: null, featured: false, veg: c.features && c.features.veg ? true : null, variants: [], options2: [], addons: [], emoji: c.logoEmoji || '🛍️', image: '' } : S.products.find(x => x.id === pid);
  if (!p) return go('#/admin/products');
  S.editImage = p.image || '';
  app().innerHTML = adminShell('product', `<div class="narrow" style="max-width:760px;padding:0">
    <a class="back" href="#/admin/products">← All ${esc(L('product'))}s</a>
    <h2>${isNew ? 'Add ' + esc(L('product')) : 'Edit ' + esc(p.name)}</h2>
    <div class="card stack">
      <div class="row" style="align-items:flex-start;gap:16px">
        <div><div class="img-pick" id="img-pick" title="Upload photo">${S.editImage ? `<img src="${esc(S.editImage)}">` : esc(p.emoji || '📷')}</div>
          <input type="file" id="img-file" accept="image/*" class="hidden">
          <div class="row" style="justify-content:center;margin-top:6px">${S.editImage ? `<button class="btn sm ghost danger" data-act="rmImage">Remove photo</button>` : `<span class="small muted">Tap to add photo</span>`}</div></div>
        <div style="flex:1" class="stack">
          <label class="f"><span>Name *</span><input type="text" id="p-name" value="${esc(p.name)}"></label>
          <div class="grid2">
            <label class="f"><span>Category</span><select id="p-cat">${[...new Set([...c.categories, p.category].filter(Boolean))].map(cat => `<option ${cat === p.category ? 'selected' : ''}>${esc(cat)}</option>`).join('')}</select></label>
            <label class="f"><span>Emoji (if no photo)</span><input type="text" id="p-emoji" value="${esc(p.emoji || '')}" maxlength="4"></label>
          </div>
        </div>
      </div>
      <div class="grid3">
        <label class="f"><span>Selling price (₹) *</span><input type="number" id="p-price" value="${p.price}" min="0" step="0.01"></label>
        <label class="f"><span>MRP (₹) — shows discount</span><input type="number" id="p-mrp" value="${p.mrp || ''}" min="0" step="0.01"></label>
        <label class="f"><span>Unit / pack</span><input type="text" id="p-unit" value="${esc(p.unit || '')}" placeholder="e.g. 1 kg, 500 ml, 2 pcs"></label>
      </div>
      <label class="f"><span>Description</span><textarea id="p-desc">${esc(p.description || '')}</textarea></label>
      <div class="row wrap" style="gap:18px">
        <label class="row" style="cursor:pointer"><span class="switch"><input type="checkbox" id="p-instock" ${p.inStock ? 'checked' : ''}><i></i></span>In stock</label>
        <label class="row" style="cursor:pointer"><span class="switch"><input type="checkbox" id="p-feat" ${p.featured ? 'checked' : ''}><i></i></span>Bestseller ⭐</label>
        ${c.features && c.features.veg ? `<label class="row">Type <select id="p-veg" style="width:auto"><option value="veg" ${p.veg === true ? 'selected' : ''}>🟢 Veg</option><option value="nonveg" ${p.veg === false ? 'selected' : ''}>🔴 Non-veg</option><option value="" ${p.veg == null ? 'selected' : ''}>Not shown</option></select></label>` : ''}
        <label class="row">Stock qty <input type="number" id="p-stock" value="${p.stock ?? ''}" min="0" placeholder="Unlimited" style="width:110px"></label>
      </div>
    </div>
    <div class="card" style="margin-top:12px"><h3>${esc(L('variant'))} options</h3><p class="small muted" style="margin-top:0">e.g. ${c.businessType === 'clothing' ? 'S, M, L, XL (same price)' : c.businessType === 'grocery' ? '500 g ₹40, 1 kg ₹75' : c.businessType === 'food' ? 'Regular ₹149, Large ₹299 / Half, Full' : 'different sizes or packs'}. Leave empty if there's just one. Each option's price replaces the selling price.</p>
      ${rowsEditor('v-rows', p.variants || [], true, true)}
      <button class="btn sm ghost" data-act="sameSizes">Quick add sizes…</button></div>
    <div class="card" style="margin-top:12px"><h3>${esc(L('option2') || 'Colour')} choices</h3><p class="small muted" style="margin-top:0">Comma separated — e.g. Black, White, Navy. Leave empty if none.</p>
      <input type="text" id="p-opt2" value="${esc((p.options2 || []).join(', '))}"></div>
    <div class="card" style="margin-top:12px"><h3>${esc(L('addons') || 'Add-ons')}</h3><p class="small muted" style="margin-top:0">Optional extras the customer can tick, e.g. Extra cheese +₹20.</p>
      ${rowsEditor('a-rows', p.addons || [], true, false)}</div>
    <div class="row" style="margin-top:16px">${isNew ? '' : `<button class="btn danger" data-act="delProduct" data-id="${p.id}">Delete</button>`}<span class="spacer"></span><a class="btn" href="#/admin/products">Cancel</a><button class="btn primary lg" data-act="saveProduct" data-id="${isNew ? '' : p.id}">Save</button></div>
  </div>`);
  $('#img-pick').onclick = () => $('#img-file').click();
  $('#img-file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const dataUrl = await resizeImage(f, 900);
      toast('Uploading photo…');
      const r = await Api.post('/api/upload', { dataUrl });
      S.editImage = r.url; $('#img-pick').innerHTML = `<img src="${esc(r.url)}">`;
    } catch (err) { toast(err.message || 'Could not upload photo', 'bad'); }
  };
}
function resizeImage(file, max) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url); res(cv.toDataURL('image/jpeg', .82));
    };
    img.onerror = () => rej(new Error('That file is not an image'));
    img.src = url;
  });
}
async function saveProduct(btn) {
  const name = $('#p-name').value.trim();
  if (!name) return toast('Please enter a name', 'bad');
  const variants = readRows('v-rows');
  const price = +$('#p-price').value || (variants[0] && variants[0].price) || 0;
  if (!price && !variants.length) return toast('Please enter a price', 'bad');
  const vegSel = $('#p-veg') ? $('#p-veg').value : '';
  const stockV = $('#p-stock').value;
  const body = {
    name, category: $('#p-cat').value, price, mrp: +$('#p-mrp').value || null, unit: $('#p-unit').value.trim(), description: $('#p-desc').value.trim(),
    emoji: $('#p-emoji').value.trim(), image: S.editImage, inStock: $('#p-instock').checked, featured: $('#p-feat').checked,
    veg: vegSel === 'veg' ? true : vegSel === 'nonveg' ? false : null, stock: stockV === '' ? null : +stockV,
    variants, options2: $('#p-opt2').value.split(',').map(s => s.trim()).filter(Boolean), addons: readRows('a-rows').map(({ name, price }) => ({ name, price })),
  };
  btn.disabled = true;
  try {
    const id = btn.dataset.id;
    if (id) { const old = S.products.find(p => p.id === id); body.sort = old.sort; body.createdAt = old.createdAt; await Api.put('/api/products/' + id, body); }
    else { body.sort = S.products.length; await Api.post('/api/products', body); }
    toast('Saved', 'ok'); go('#/admin/products');
  } catch (e) { toast(e.message, 'bad'); btn.disabled = false; }
}

// ---- settings ----
function renderSettings() {
  const c = S.cfg, d = c.delivery || {}, t = c.tax || {}, h = c.hours || {}, lb = c.labels || {};
  const sw = (id, on, text) => `<label class="row" style="cursor:pointer"><span class="switch"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><i></i></span>${text}</label>`;
  app().innerHTML = adminShell('settings', `<div class="narrow" style="max-width:820px;padding:16px 0">
    <h2>Settings</h2>
    <div class="card set-section stack"><h3>🏪 Store</h3>
      <div class="grid2"><label class="f"><span>Store name</span><input type="text" id="s-name" value="${esc(c.name)}"></label>
      <label class="f"><span>Tagline</span><input type="text" id="s-tag" value="${esc(c.tagline || '')}"></label></div>
      <div class="grid2"><label class="f"><span>WhatsApp / phone</span><input type="tel" id="s-phone" value="${esc(c.phone || '')}"></label>
      <label class="f"><span>Logo emoji</span><input type="text" id="s-emoji" value="${esc(c.logoEmoji || '')}" maxlength="4"></label></div>
      <div class="row"><div class="logo" style="width:56px;height:56px;font-size:28px" id="logo-prev">${c.logoImage ? `<img src="${esc(c.logoImage)}">` : esc(c.logoEmoji || '🛍️')}</div>
        <button class="btn sm" data-act="pickLogo">Upload logo image</button>${c.logoImage ? `<button class="btn sm ghost danger" data-act="rmLogo">Remove</button>` : ''}<input type="file" id="logo-file" accept="image/*" class="hidden"></div>
      <label class="f"><span>Address</span><textarea id="s-addr">${esc(c.address || '')}</textarea></label>
      <label class="f"><span>Policy / note in footer (returns, warranty…)</span><input type="text" id="s-policy" value="${esc(c.policy || '')}"></label>
      <div><span class="small" style="font-weight:600">Brand colour</span><div class="swatches" style="margin-top:8px">${COLORS.map(col => `<button class="swatch ${c.color === col ? 'on' : ''}" style="background:${col}" data-act="setColor" data-c="${col}"></button>`).join('')}<input type="color" id="s-color" value="${esc(c.color)}" style="width:40px;height:34px;border:0;background:none;padding:0"></div></div>
    </div>
    <div class="card set-section stack"><h3>🕘 Ordering</h3>
      ${sw('s-accept', c.acceptingOrders, 'Taking orders now')}
      <div class="row wrap">${sw('s-hours', h.enabled, 'Only take orders between')}<input type="time" id="s-open" value="${esc(h.open || '09:00')}" style="width:auto"> and <input type="time" id="s-close" value="${esc(h.close || '22:00')}" style="width:auto"></div>
      <div><b>Order types</b><div class="row wrap" style="margin-top:8px">${['delivery', 'pickup', 'dinein'].map(m => `<label class="check ${c.modes.includes(m) ? 'on' : ''}"><input type="checkbox" class="s-mode" value="${m}" ${c.modes.includes(m) ? 'checked' : ''}><span>${MODE_NAMES()[m]}</span></label>`).join('')}</div></div>
      <div class="grid3"><label class="f"><span>Delivery charge (₹)</span><input type="number" id="s-fee" value="${d.fee || 0}" min="0"></label>
        <label class="f"><span>Free delivery above (₹, 0 = never)</span><input type="number" id="s-free" value="${d.freeAbove || 0}" min="0"></label>
        <label class="f"><span>Minimum delivery order (₹)</span><input type="number" id="s-min" value="${d.minOrder || 0}" min="0"></label></div>
      <div class="grid2"><label class="f"><span>Delivery time shown</span><input type="text" id="s-eta" value="${esc(d.eta || '')}"></label>
        <label class="f"><span>Packing charge per order (₹)</span><input type="number" id="s-pack" value="${c.packingCharge || 0}" min="0"></label></div>
      ${sw('s-slots-on', c.features && c.features.slots, 'Let customers choose a time slot')}
      <label class="f"><span>Time slots (one per line)</span><textarea id="s-slots">${esc((c.slots || []).join('\n'))}</textarea></label>
    </div>
    <div class="card set-section stack"><h3>💳 Payments & GST</h3>
      <div class="row wrap">${['cod', 'upi'].map(p => `<label class="check ${(c.payments || []).includes(p) ? 'on' : ''}"><input type="checkbox" class="s-pay" value="${p}" ${(c.payments || []).includes(p) ? 'checked' : ''}><span>${p === 'cod' ? 'Cash / pay on delivery' : 'UPI'}</span></label>`).join('')}</div>
      <label class="f"><span>UPI ID</span><input type="text" id="s-upi" value="${esc(c.upiId || '')}" placeholder="yourname@okaxis"></label>
      ${sw('s-tax', t.enabled, 'Show GST')}
      <div class="grid3"><label class="f"><span>GST rate %</span><input type="number" id="s-rate" value="${t.rate ?? 5}" min="0" step="0.5"></label>
        <label class="f"><span>Prices</span><select id="s-incl"><option value="1" ${t.inclusive !== false ? 'selected' : ''}>Already include GST</option><option value="0" ${t.inclusive === false ? 'selected' : ''}>Add GST on top</option></select></label>
        <label class="f"><span>GSTIN (on bills)</span><input type="text" id="s-gstin" value="${esc(t.gstin || '')}"></label></div>
    </div>
    <div class="card set-section stack"><h3>🏷️ Categories</h3>
      <div id="cats">${c.categories.map((cat, i) => `<div class="cat-row"><input type="text" class="cat-in" value="${esc(cat)}"><button class="icon-btn" data-act="catUp" data-i="${i}" title="Move up">↑</button><button class="icon-btn" data-act="catDel" data-i="${i}" title="Remove">🗑️</button></div>`).join('')}</div>
      <button class="btn sm" data-act="catAdd">+ Add category</button>
    </div>
    <div class="card set-section stack"><h3>🔤 Wording & features</h3>
      <div class="grid3"><label class="f"><span>Name for options</span><input type="text" id="s-l-var" value="${esc(lb.variant || '')}" placeholder="Size / Weight / Portion"></label>
        <label class="f"><span>Name for 2nd choice</span><input type="text" id="s-l-o2" value="${esc(lb.option2 || '')}" placeholder="Colour / Flavour"></label>
        <label class="f"><span>Name for extras</span><input type="text" id="s-l-add" value="${esc(lb.addons || '')}" placeholder="Add-ons / Toppings"></label></div>
      <div class="grid3"><label class="f"><span>Pickup is called</span><input type="text" id="s-l-pick" value="${esc(lb.pickup || '')}" placeholder="Takeaway / Store pickup"></label>
        <label class="f"><span>Add button text</span><input type="text" id="s-l-cta" value="${esc(lb.cta || '')}" placeholder="Add / Add to bag"></label>
        <label class="f"><span>Catalogue is called</span><select id="s-l-prods"><option ${lb.products !== 'Menu' ? 'selected' : ''}>Shop</option><option ${lb.products === 'Menu' ? 'selected' : ''}>Menu</option></select></label></div>
      ${sw('s-veg', c.features && c.features.veg, 'Show veg / non-veg marks and “Veg only” filter')}
      ${sw('s-mrp', !c.features || c.features.mrp !== false, 'Show MRP discount badges')}
    </div>
    <div class="row" style="position:sticky;bottom:0;background:var(--bg);padding:12px 0"><span class="spacer"></span><button class="btn primary lg" data-act="saveSettings">Save settings</button></div>
    <div class="card set-section stack"><h3>🔒 Admin password</h3>
      <div class="grid2"><label class="f"><span>Current password</span><input type="password" id="pw-cur" autocomplete="current-password"></label><label class="f"><span>New password</span><input type="password" id="pw-new" autocomplete="new-password"></label></div>
      <div class="row"><button class="btn" data-act="changePw">Change password</button><span class="spacer"></span><button class="btn ghost" data-act="logout">Log out</button></div>
    </div>
    <div class="card set-section stack"><h3>💾 Data</h3>
      <div class="row wrap"><button class="btn" data-act="exportData">Download backup</button>
      <span class="spacer"></span><button class="btn danger" data-act="resetStore">Start over / change business type…</button></div>
      <div class="small muted">Starting over deletes all products, orders and settings and opens the setup wizard again.</div>
    </div>
  </div>`);
  $$('.s-mode, .s-pay').forEach(i => i.addEventListener('change', () => i.closest('.check').classList.toggle('on', i.checked)));
  $('#s-color').oninput = e => { applyTheme(e.target.value); S.pendingColor = e.target.value; };
  $('#logo-file').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const r = await Api.post('/api/upload', { dataUrl: await resizeImage(f, 400) }); await Api.put('/api/config', { logoImage: r.url }); S.cfg = await Api.get('/api/config'); renderSettings(); toast('Logo updated', 'ok'); } catch (err) { toast(err.message, 'bad'); }
  };
  S.pendingColor = c.color;
}
async function saveSettings(btn) {
  const v = id => $(id).value.trim(), ch = id => $(id).checked;
  const modes = $$('.s-mode:checked').map(i => i.value), payments = $$('.s-pay:checked').map(i => i.value);
  if (!v('#s-name')) return toast('Store name can’t be empty', 'bad');
  if (!modes.length) return toast('Keep at least one order type', 'bad');
  if (!payments.length) return toast('Keep at least one payment method', 'bad');
  if (payments.includes('upi') && !/^[\w.\-]+@[\w]+$/.test(v('#s-upi'))) return toast('Enter a valid UPI ID', 'bad');
  const cats = $$('.cat-in').map(i => i.value.trim()).filter(Boolean);
  const old = S.cfg.categories;
  const body = {
    name: v('#s-name'), tagline: v('#s-tag'), phone: v('#s-phone'), logoEmoji: v('#s-emoji'), address: v('#s-addr'), policy: v('#s-policy'), color: S.pendingColor,
    acceptingOrders: ch('#s-accept'), hours: { enabled: ch('#s-hours'), open: v('#s-open'), close: v('#s-close') },
    modes, payments, upiId: v('#s-upi'),
    delivery: { fee: +v('#s-fee') || 0, freeAbove: +v('#s-free') || 0, minOrder: +v('#s-min') || 0, eta: v('#s-eta') },
    packingCharge: +v('#s-pack') || 0, slots: v('#s-slots').split('\n').map(s => s.trim()).filter(Boolean),
    tax: { enabled: ch('#s-tax'), rate: +v('#s-rate') || 0, inclusive: v('#s-incl') === '1', gstin: v('#s-gstin') },
    categories: cats,
    labels: Object.assign({}, S.cfg.labels, { variant: v('#s-l-var') || 'Option', option2: v('#s-l-o2'), addons: v('#s-l-add') || 'Extras', pickup: v('#s-l-pick') || 'Pickup', cta: v('#s-l-cta') || 'Add', products: v('#s-l-prods') }),
    features: Object.assign({}, S.cfg.features, { veg: ch('#s-veg'), mrp: ch('#s-mrp'), slots: ch('#s-slots-on') }),
  };
  btn.disabled = true;
  try {
    // keep products in step when a category is renamed in place
    const renames = old.map((o, i) => [o, $$('.cat-in')[i] && $$('.cat-in')[i].value.trim()]).filter(([o, n]) => n && o !== n && !old.includes(n));
    await Api.put('/api/config', body);
    for (const [o, n] of renames) for (const p of S.products.filter(p => p.category === o)) await Api.put('/api/products/' + p.id, Object.assign({}, p, { category: n }));
    S.cfg = await Api.get('/api/config'); S.products = await Api.get('/api/products'); applyTheme(S.cfg.color);
    toast('Settings saved', 'ok'); renderSettings();
  } catch (e) { toast(e.message, 'bad'); }
  btn.disabled = false;
}

// ================= click actions =================
const actions = Object.assign({}, wizActions, {
  closeModal(el, e) { if (e.target === el || el.classList.contains('icon-btn')) closeModal(); },
  open(el) { openProduct(el.dataset.id); },
  quickAdd(el) {
    const p = S.products.find(x => x.id === el.dataset.id);
    addToCart(p.id, { variant: p.variants[0] && p.variants[0].name, qty: 1 }); refreshAfterCart();
  },
  inc(el) { const it = S.cart.find(i => i.productId === el.dataset.id); if (it) it.qty++; saveCart(); refreshAfterCart(); },
  dec(el) { const i = S.cart.findIndex(i => i.productId === el.dataset.id); if (i >= 0) { S.cart[i].qty--; if (S.cart[i].qty <= 0) S.cart.splice(i, 1); } saveCart(); refreshAfterCart(); },
  cartQty(el) { const i = +el.dataset.i; S.cart[i].qty += +el.dataset.d; if (S.cart[i].qty <= 0) S.cart.splice(i, 1); saveCart(); renderCart(); },
  cat(el) { S.cat = el.dataset.c; renderStore(); },
  vegOnly() { S.vegOnly = !S.vegOnly; renderStore(); },
  async toCheckout() { S.cfg = await Api.get('/api/config'); if (!S.cfg.isOpen) { toast('Sorry, the store just closed.', 'bad'); return renderCart(); } go('#/checkout'); },
  mode(el) { S.mode = el.dataset.m; S.drawCheckout(); },
  placeOrder(el) { placeOrder(el); },
  async login() {
    try { const r = await Api.post('/api/login', { password: $('#l-pw').value }); ls.set('sk_token', r.token); route(); }
    catch (e) { toast(e.message, 'bad'); }
  },
  logout() { ls.del('sk_token'); if (events) { events.close(); events = null; } go('#/'); },
  ofilter(el) { S.orderFilter = el.dataset.f; renderAdminOrders(); },
  refreshOrders() { renderAdminOrders(); },
  askNotify() { Notification.requestPermission().then(() => renderAdminOrders()); },
  async setStatus(el) { el.disabled = true; try { await Api.patch('/api/orders/' + el.dataset.id, { status: el.dataset.s }); renderAdminOrders(); } catch (e) { toast(e.message, 'bad'); el.disabled = false; } },
  async cancelOrder(el) { if (!confirm('Cancel this order?')) return; await Api.patch('/api/orders/' + el.dataset.id, { status: 'cancelled' }); renderAdminOrders(); },
  async togglePaid(el) { const o = S.orders.find(x => x.id === el.dataset.id); await Api.patch('/api/orders/' + o.id, { paid: !o.paid }); renderAdminOrders(); },
  printBill(el) { printBill(S.orders.find(x => x.id === el.dataset.id)); },
  async stockToggle(el) { const p = S.products.find(x => x.id === el.dataset.id); await Api.put('/api/products/' + p.id, Object.assign({}, p, { inStock: el.checked, stock: el.checked && p.stock === 0 ? null : p.stock })); toast(el.checked ? 'Back in stock' : 'Marked out of stock'); S.products = await Api.get('/api/products'); },
  addRow(el) { $('#' + el.dataset.t).insertAdjacentHTML('beforeend', rowHtml({}, el.dataset.p === '1', el.dataset.s === '1')); $(`#${el.dataset.t} .r:last-child .rn`).focus(); },
  delRow(el) { el.closest('.r').remove(); },
  sameSizes() {
    const s = prompt('Type sizes separated by commas', S.cfg.businessType === 'clothing' ? 'S, M, L, XL, XXL' : 'Small, Medium, Large');
    if (!s) return;
    const price = +$('#p-price').value || 0;
    s.split(',').map(x => x.trim()).filter(Boolean).forEach(n => $('#v-rows').insertAdjacentHTML('beforeend', rowHtml({ name: n, price }, true, true)));
  },
  rmImage() { S.editImage = ''; $('#img-pick').innerHTML = esc($('#p-emoji').value || '📷'); },
  saveProduct(el) { saveProduct(el); },
  async delProduct(el) { if (!confirm('Delete this item? This cannot be undone.')) return; await Api.del('/api/products/' + el.dataset.id); toast('Deleted'); go('#/admin/products'); },
  setColor(el) { S.pendingColor = el.dataset.c; applyTheme(el.dataset.c); $$('.swatch').forEach(s => s.classList.toggle('on', s === el)); },
  pickLogo() { $('#logo-file').click(); },
  async rmLogo() { await Api.put('/api/config', { logoImage: '' }); S.cfg = await Api.get('/api/config'); renderSettings(); },
  catAdd() { $('#cats').insertAdjacentHTML('beforeend', `<div class="cat-row"><input type="text" class="cat-in" placeholder="New category"></div>`); $('#cats .cat-row:last-child input').focus(); },
  catUp(el) { const r = el.closest('.cat-row'); if (r.previousElementSibling) r.parentNode.insertBefore(r, r.previousElementSibling); },
  catDel(el) { const r = el.closest('.cat-row'); const n = $('input', r).value; if (S.products.some(p => p.category === n) && !confirm(`Some items are in “${n}”. They'll show under “Other”. Remove anyway?`)) return; r.remove(); },
  saveSettings(el) { saveSettings(el); },
  async changePw() {
    try { const r = await Api.post('/api/password', { current: $('#pw-cur').value, next: $('#pw-new').value }); ls.set('sk_token', r.token); toast('Password changed', 'ok'); $('#pw-cur').value = $('#pw-new').value = ''; }
    catch (e) { toast(e.message, 'bad'); }
  },
  async exportData() {
    const data = await Api.get('/api/export');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = `store-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  },
  async resetStore() {
    const pw = prompt('This deletes ALL products, orders and settings.\nType your admin password to confirm:');
    if (!pw) return;
    try { await Api.post('/api/reset', { password: pw }); ls.del('sk_token'); S.cart = []; saveCart(); await loadStore(); go('#/'); }
    catch (e) { toast(e.message, 'bad'); }
  },
});

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  // clicks on controls inside a product card shouldn't also open the card
  if (el.dataset.act === 'open' && e.target.closest('[data-stop], .add-btn, .stepper') && !e.target.closest('.add-btn[data-act=open]')) return;
  if (el.dataset.act === 'closeModal' && e.target.closest('[data-stop]') && !e.target.closest('.icon-btn[data-act=closeModal]')) return;
  const fn = actions[el.dataset.act];
  if (!fn) return;
  if (el.tagName === 'A') e.preventDefault();
  if (el.type !== 'checkbox') e.preventDefault();
  e.stopPropagation();
  fn(el, e);
});

// ================= boot =================
(async function boot() {
  await Api.detect();
  if (Api.demo) document.body.insertAdjacentHTML('beforeend', '<div class="demo-flag">Demo mode · data stays in this browser</div>');
  try { await loadStore(); } catch (e) { app().innerHTML = `<div class="empty"><div class="big">⚠️</div>Could not reach the store server.<br>${esc(e.message)}</div>`; return; }
  route();
  if ('serviceWorker' in navigator && !Api.demo) navigator.serviceWorker.register('sw.js').catch(() => {});
  // refresh open/closed state and stock every few minutes on the storefront
  setInterval(async () => { if (!location.hash.startsWith('#/admin') && !location.hash.startsWith('#/checkout') && S.cfg.configured) { try { S.cfg = await Api.get('/api/config'); } catch {} } }, 180000);
})();
})();
