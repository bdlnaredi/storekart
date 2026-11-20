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

// ================= pricing (shared with the server via core.js) =================
const Core = window.StoreCore;
const priceCart = (cfg, products, items, mode) => Core.priceCart(cfg, products, items, mode, false);
const lineFor = (item, products) => priceCart(S.cfg, products, [item], null).lines[0];
const roleLabel = r => (Core.ROLES[r] || {}).label || r;
const can = perm => Core.can(S.me, perm);

// ================= API (real server, or the same store rules running in this browser) =================
const DEMO_KEY = 'sk_demo_v2';
const Demo = {
  // Used when no StoreKart server is reachable (e.g. the hosted preview). Everything lives in this browser.
  env: null, core: null,
  init() {
    const blank = { config: null, users: [], products: [], orders: [], orderSeq: 1000 };
    this.env = {
      db: ls.get(DEMO_KEY, null) || blank,
      save: () => ls.set(DEMO_KEY, this.env.db),
      // demo only — not a secure hash; the real server uses scrypt
      hash(pw, salt = Math.random().toString(36).slice(2, 10)) { let h = 5381; for (const ch of salt + pw) h = ((h << 5) + h + ch.charCodeAt(0)) >>> 0; return { salt, hash: h.toString(16) }; },
      id: uid,
      makeToken: u => 'demo.' + u.id + '.' + u.salt.slice(0, 8),
      saveUpload: dataUrl => dataUrl,
      emit: (ev, data) => setTimeout(() => onStaffEvent(ev, data), 50),
    };
    this.core = Core.createCore(this.env);
    window.addEventListener('storage', e => { if (e.key === DEMO_KEY) { this.env.db = ls.get(DEMO_KEY, this.env.db); onStaffEvent('sync', {}); } });
  },
  call(method, path, body) {
    const tok = ls.get('sk_token') || '';
    const [, uidPart, saltPart] = tok.split('.');
    const u = this.env.db.users.find(x => x.id === uidPart);
    const userId = u && u.salt.slice(0, 8) === saltPart ? u.id : null;
    try { return JSON.parse(JSON.stringify(this.core.handle({ method, path, body: body ? JSON.parse(JSON.stringify(body)) : {}, userId }))); }
    catch (e) { const er = new Error(e.message); er.status = e.status || 500; throw er; }
  },
  // sample team so every role can be tried in the preview
  seedStaff() {
    const team = [['Meena (Owner)', 'owner', 'owner'], ['Rahul', 'rahul', 'manager'], ['Suresh', 'suresh', 'cashier'], ['Ramesh', 'ramesh', 'delivery'], ['Vijay', 'vijay', 'delivery']];
    for (const [name, username, role] of team) try { this.call('POST', '/api/users', { name, username, role, password: '1234', phone: '98' + Math.floor(10000000 + Math.random() * 89999999) }); } catch {}
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
    if (this.demo) Demo.init();
  },
  async call(method, path, body) {
    if (this.demo) return Demo.call(method, path, body);
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
  orders: [], orderFilter: 'active', me: ls.get('sk_user', null), staff: [],
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
        <div class="small" style="font-weight:700">Your admin login — you'll add manager, cashier and delivery boy logins after this.</div>
        <div class="grid2"><label class="f"><span>Your name *</span><input type="text" id="w-aname" value="${esc(w.aname || '')}" placeholder="e.g. Bharat"></label>
        <label class="f"><span>Login name *</span><input type="text" id="w-auser" value="${esc(w.auser || 'admin')}" autocapitalize="none"></label></div>
        <label class="f"><span>Password * (at least 6 characters)</span><input type="password" id="w-pw" autocomplete="new-password"></label>
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
    const aname = $('#w-aname').value.trim(), auser = $('#w-auser').value.trim();
    if (!aname) return toast('Please enter your name', 'bad');
    el.disabled = true;
    try {
      const r = await Api.post('/api/setup', { password: pw, adminName: aname, username: auser || 'admin', config: S.wiz.cfg, products: S.wiz.samples ? presetProducts(S.wiz.type) : [] });
      ls.set('sk_token', r.token); ls.set('sk_user', r.user); S.me = r.user; ls.set('sk_last_user', r.user.username);
      if (Api.demo) Demo.seedStaff();
      S.wiz = null; S.cart = []; saveCart();
      await loadStore();
      toast('Your store is live! 🎉', 'ok');
      go(Api.demo ? '#/admin/orders' : '#/admin/staff');
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
        ${S.mode === 'delivery' ? (v.geo ? `<div class="row geo-ok"><span>📍 Exact location added</span><span class="spacer"></span><button class="btn sm ghost" data-act="clearGeo">Remove</button></div>` : `<button class="btn block" data-act="useMyLocation">📍 Use my current location <span class="small muted">(helps the delivery boy find you)</span></button>`) : ''}
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
  const customer = { name: val('#c-name'), phone: val('#c-phone'), address: val('#c-addr'), landmark: val('#c-land'), pincode: val('#c-pin'), geo: S.mode === 'delivery' && S.form && S.form.geo ? S.form.geo : null };
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
    const { geo, ...keep } = customer; ls.set('sk_customer', Object.assign(ls.get('sk_customer', {}), keep));
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
const statusName = (s, mode) => Core.statusName(s, mode, S.cfg && S.cfg.businessType);
const flowFor = Core.flowFor;
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
    o.customer.geo ? `Map: https://www.google.com/maps?q=${o.customer.geo.lat},${o.customer.geo.lng}` : '',
    o.note ? `Note: ${o.note}` : '', '', `Track: ${location.href.split('#')[0]}#/order/${o.id}`].filter(x => x !== '').join('\n');
}

// ---- Google Maps helpers ----
const ll = p => `${(+p.lat).toFixed(6)},${(+p.lng).toFixed(6)}`;
function destOf(o) {
  const c = o.customer;
  return c.geo ? ll(c.geo) : [c.address, c.landmark, c.pincode].filter(Boolean).join(', ');
}
const navLink = o => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destOf(o))}&travelmode=driving&dir_action=navigate`;
const routeLink = o => o.rider ? `https://www.google.com/maps/dir/?api=1&origin=${ll(o.rider)}&destination=${encodeURIComponent(destOf(o))}&travelmode=driving` : navLink(o);
function mapEmbedSrc(o) {
  const key = S.cfg.mapsKey, d = destOf(o), r = o.rider;
  if (key) return r ? `https://www.google.com/maps/embed/v1/directions?key=${encodeURIComponent(key)}&origin=${ll(r)}&destination=${encodeURIComponent(d)}&mode=driving` : `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(key)}&q=${encodeURIComponent(d)}`;
  return r ? `https://maps.google.com/maps?saddr=${ll(r)}&daddr=${encodeURIComponent(d)}&output=embed` : `https://maps.google.com/maps?q=${encodeURIComponent(d)}&z=15&output=embed`;
}
const ago = iso => { const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000)); return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.floor(s / 60)} min ago` : timeAgo(iso); };
const fmtDist = m => m == null ? '' : m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`;
function riderDistance(o) { return o.rider && o.customer.geo ? Math.round(Core.distanceM(o.rider, o.customer.geo)) : null; }

function mapBox(o, height = 300) {
  if (Api.demo) {
    const d = riderDistance(o);
    return `<div class="map-ph" style="height:${height}px"><div style="font-size:40px">🗺️</div><b>Live Google Map shows here</b>
      <div class="small muted">${o.rider ? `Delivery boy at ${ll(o.rider)}${d != null ? ` · ${fmtDist(d)} away` : ''}` : 'Waiting for location…'}</div>
      <div class="small muted">(Preview pages can't load Google Maps — it works on your own server.)</div></div>`;
  }
  return `<iframe class="map" id="map-frame" style="height:${height}px" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${esc(mapEmbedSrc(o))}"></iframe>`;
}

function activityHtml(o) {
  return `<div class="activity">${o.history.slice().reverse().map(h => `<div class="act"><span class="act-ic">${h.status ? ({ new: '📝', accepted: '👍', preparing: '📦', ready: '✅', out: '🛵', delivered: '🎉', cancelled: '✖️' }[h.status] || '•') : /payment/i.test(h.text) ? '💰' : /location/i.test(h.text) ? '📍' : /deliver|assigned/i.test(h.text) ? '🧑‍✈️' : '•'}</span><div><div>${esc(h.text)}</div><div class="small muted">${fmtTime(h.at)}</div></div></div>`).join('')}</div>`;
}

function trackDynamic(o) {
  const flow = flowFor(o.mode);
  const idx = o.status === 'cancelled' ? -1 : flow.indexOf(o.status);
  const when = s => (o.history.find(h => h.status === s) || {}).at;
  const d = riderDistance(o);
  return `
    ${o.payment === 'upi' && !o.paid && o.status !== 'cancelled' ? `<div class="card stack" style="margin-top:12px"><b>Pay ${rupee(o.total)} by UPI</b>
      <a class="btn primary lg block" href="${upiLink(o)}">📲 Pay with UPI app</a>
      <div class="small muted">Or pay to UPI ID <b>${esc(S.cfg.upiId)}</b> and mention order #${o.number}. The store confirms your payment.</div></div>` : ''}
    ${o.paid ? `<div class="pill ok" style="margin-top:12px">✓ Payment received</div>` : ''}
    ${o.assignedTo && o.status !== 'cancelled' ? `<div class="card rider-card" style="margin-top:12px">
      <div class="row"><div class="avatar">🛵</div><div style="flex:1"><b>${esc(o.assignedTo.name)}</b><div class="small muted">${o.status === 'out' ? (o.rider ? `On the way${d != null ? ` · ${fmtDist(d)} away` : ''} · updated ${ago(o.rider.at)}` : 'On the way — live location starting…') : o.status === 'delivered' ? 'Delivered your order' : 'Your delivery partner'}</div></div>
      ${o.assignedTo.phone && o.status !== 'delivered' ? `<a class="btn sm" href="tel:${esc(o.assignedTo.phone)}">📞 Call</a>` : ''}</div>
      ${o.status === 'out' && o.rider ? `<a class="btn block" style="margin-top:10px" href="${routeLink(o)}" target="_blank" rel="noopener">🗺️ Open route in Google Maps</a>` : ''}</div>` : ''}
    <div class="card" style="margin-top:12px">
      ${o.status === 'cancelled' ? `<div class="pill bad">This order was cancelled</div>` : `<div class="timeline">${flow.map((s, i) => `<div class="tl ${i <= idx ? 'done' : ''} ${i === idx ? 'cur' : ''}"><div class="dot">${i <= idx ? '✓' : ''}</div><div><div class="t">${esc(statusName(s, o.mode))}</div>${when(s) ? `<div class="small muted">${fmtTime(when(s))}</div>` : ''}</div></div>`).join('')}</div>`}
    </div>
    <div class="card" style="margin-top:12px"><h3>Order activity</h3>${activityHtml(o)}</div>`;
}

async function renderOrder(id) {
  const fresh = location.hash.endsWith('/new');
  let o;
  try { o = await Api.get('/api/orders/' + id); } catch (e) { app().innerHTML = `${storeHeader('#/')}<div class="narrow"><div class="empty"><div class="big">🤷</div>Order not found.</div></div>`; return; }
  const showMap = o2 => o2.mode === 'delivery' && o2.status === 'out';
  app().innerHTML = `${storeHeader('#/')}<div class="narrow page-pad">
    ${fresh ? `<div class="card" style="margin-top:18px;text-align:center;background:var(--brand-soft);border-color:transparent"><div style="font-size:44px">🎉</div><h2>Order placed!</h2><p class="muted" style="margin:0">Order #${o.number} · ${rupee(o.total)}</p></div>` : `<h2 style="margin-top:18px">Order #${o.number}</h2>`}
    <div id="map-wrap" style="margin-top:12px">${showMap(o) ? mapBox(o) : ''}</div>
    <div id="track-dyn">${trackDynamic(o)}</div>
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
  let mapAt = o.rider ? { lat: o.rider.lat, lng: o.rider.lng } : null;
  if (['delivered', 'cancelled'].includes(o.status)) return;
  pollTimer = setInterval(async () => {
    let n; try { n = await Api.get('/api/orders/' + id); } catch { return; }
    $('#track-dyn') && ($('#track-dyn').innerHTML = trackDynamic(n));
    const wrap = $('#map-wrap'); if (!wrap) return;
    if (showMap(n)) {
      // only reload the map when the delivery boy has moved a bit, so it doesn't flicker
      const moved = n.rider && (!mapAt || Core.distanceM(mapAt, n.rider) > 40);
      if (!wrap.innerHTML || moved || Api.demo) { wrap.innerHTML = mapBox(n); if (n.rider) mapAt = { lat: n.rider.lat, lng: n.rider.lng }; }
    } else wrap.innerHTML = '';
    if (['delivered', 'cancelled'].includes(n.status)) stopPolling();
  }, o.mode === 'delivery' ? 8000 : 15000);
}

function renderMyOrders() {
  const mine = ls.get('sk_my_orders', []);
  app().innerHTML = `${storeHeader('#/')}<div class="narrow page-pad"><h2 style="margin-top:18px">My orders</h2>
    ${mine.length ? `<div class="card">${mine.map(o => `<a class="line" href="#/order/${o.id}" style="text-decoration:none"><div class="thumb">🧾</div><div style="flex:1"><b>Order #${o.number}</b><div class="small muted">${fmtTime(o.at)}</div></div><b>${rupee(o.total)}</b></a>`).join('')}</div>`
    : `<div class="empty"><div class="big">🧾</div>No orders on this phone yet.</div>`}</div>`;
}

// ================= staff area (admin / owner / manager / cashier / delivery) =================
let events = null;
function staffTabs() {
  const t = [];
  if (can('viewOrders')) t.push(['orders', 'Orders']);
  if (S.me && S.me.role === 'delivery') t.push(['deliveries', 'My deliveries']);
  if (can('products')) t.push(['products', L('products') === 'Menu' ? 'Menu' : 'Products']);
  if (can('staff')) t.push(['staff', 'Staff']);
  if (can('settings')) t.push(['settings', 'Settings']);
  t.push(['me', '👤']);
  return t;
}
const homeTab = () => S.me && S.me.role === 'delivery' ? 'deliveries' : 'orders';
function adminShell(tab, inner) {
  const c = S.cfg;
  return `<div class="admin"><header class="admin-top"><div class="wrap-page inner">
      <div class="logo" style="width:34px;height:34px;font-size:18px">${c.logoImage ? `<img src="${esc(c.logoImage)}" alt="">` : esc(c.logoEmoji || '🛍️')}</div>
      <nav class="tabs">${staffTabs().map(([k, t]) => `<a href="#/admin/${k}" class="${tab === k || (tab === 'product' && k === 'products') ? 'on' : ''}" ${k === 'me' ? `title="My account"` : ''}>${esc(t)}</a>`).join('')}</nav>
      <span class="spacer"></span>
      <span class="who small"><b>${esc(S.me.name)}</b><br>${esc(roleLabel(S.me.role))}</span>
      ${S.me.role !== 'delivery' ? `<a href="#/" class="btn sm" style="background:transparent;color:#fff;border-color:#3a3e46" target="_blank"><span class="store-link-txt">Store </span>↗</a>` : ''}
    </div></header>${Tracker.bar()}<div class="wrap-page" style="padding-bottom:60px">${inner}</div></div>`;
}

function renderLogin() {
  const demoTeam = Api.demo ? Demo.env.db.users.filter(u => u.active !== false) : [];
  app().innerHTML = `<div class="narrow"><div class="card login-box stack">
    <div style="text-align:center"><div class="logo" style="margin:0 auto 10px">${esc(S.cfg.logoEmoji || '🛍️')}</div><h2>${esc(S.cfg.name)}</h2><div class="muted">Staff login</div></div>
    <label class="f"><span>Login name</span><input type="text" id="l-user" autocomplete="username" autocapitalize="none" value="${esc(ls.get('sk_last_user', ''))}"></label>
    <label class="f"><span>Password / PIN</span><input type="password" id="l-pw" autocomplete="current-password"></label>
    <button class="btn primary block lg" data-act="login">Log in</button>
    ${demoTeam.length ? `<div class="small muted" style="text-align:center">Demo — tap to log in as:</div><div class="row wrap" style="justify-content:center">${demoTeam.map(u => `<button class="btn sm" data-act="demoLogin" data-u="${esc(u.username)}">${Core.ROLES[u.role].emoji} ${esc(u.name.replace(/ \(.*/, ''))} · ${esc(roleLabel(u.role))}</button>`).join('')}</div><div class="small muted" style="text-align:center">Staff PIN is 1234; admin uses the password from setup.</div>` : ''}
    <a href="#/" class="btn ghost block">← Back to store</a></div></div>`;
  const u = $('#l-user'), p = $('#l-pw'); (u.value ? p : u).focus();
  p.onkeydown = e => { if (e.key === 'Enter') actions.login(); };
}

async function renderAdmin(tab, rest) {
  if (!ls.get('sk_token') || !S.me) return renderLogin();
  try {
    S.me = await Api.get('/api/me'); ls.set('sk_user', S.me);
    const allowed = staffTabs().map(t => t[0]).concat(can('products') ? ['product'] : []);
    if (!allowed.includes(tab)) return go('#/admin/' + homeTab());
    if (tab === 'orders') await renderAdminOrders();
    else if (tab === 'deliveries') await renderDeliveries();
    else if (tab === 'products') await renderAdminProducts();
    else if (tab === 'product') renderProductForm(rest);
    else if (tab === 'staff') await renderStaff();
    else if (tab === 'settings') renderSettings();
    else if (tab === 'me') renderMe();
    connectEvents();
    Tracker.sync();
  } catch (e) {
    if (e.status === 401) { logout(); renderLogin(); } else toast(e.message, 'bad');
  }
}
function logout() { ls.del('sk_token'); ls.del('sk_user'); S.me = null; S.ordersInit = false; S.orders = []; Tracker.stop(); if (events) { events.close(); events = null; } }

function connectEvents() {
  if (Api.demo || events) return;
  events = new EventSource('api/events?token=' + encodeURIComponent(ls.get('sk_token')));
  for (const ev of ['order', 'update', 'assigned']) events.addEventListener(ev, e => onStaffEvent(ev, JSON.parse(e.data)));
  events.onerror = () => { events.close(); events = null; setTimeout(() => location.hash.startsWith('#/admin') && S.me && connectEvents(), 8000); };
}
function beep(times = 3) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) { const t = i * .25, o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(.25, ctx.currentTime + t); g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + t + .2); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + .22); }
  } catch {}
  try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch {}
}
function alertStaff(title, body) {
  beep(); toast(`🔔 ${title}`, 'ok');
  try { if (Notification.permission === 'granted') new Notification(title, { body }); } catch {}
}
// live events: new order, status change, assignment
function onStaffEvent(ev, d) {
  if (!S.me || !location.hash.startsWith('#/admin')) return;
  const r = S.me.role;
  if (ev === 'order' && ['admin', 'owner', 'manager'].includes(r)) alertStaff(`New order #${d.number} — ${rupee(d.total)}`, d.name || '');
  if (ev === 'update' && r === 'cashier' && d.status === 'accepted') alertStaff('Order accepted — please pack it', '');
  if (ev === 'update' && ['admin', 'owner', 'manager'].includes(r) && d.status === 'ready') toast('📦 An order is packed and ready');
  if (ev === 'assigned' && r === 'delivery' && d.riderId === S.me.id) alertStaff(`New delivery #${d.number}`, 'Open My deliveries');
  if (Api.demo && ev === 'sync' && r === 'delivery') { /* other tab changed something */ }
  const h = location.hash;
  if (h.startsWith('#/admin/orders')) renderAdminOrders().catch(() => {});
  if (h.startsWith('#/admin/deliveries')) renderDeliveries().catch(() => {});
}

// ---------- orders (manager / cashier / owner / admin) ----------
const ORDER_FILTERS = [['active', 'Active'], ['new', 'New'], ['topack', 'To pack'], ['ready', 'Ready'], ['out', 'On the way'], ['done', 'Completed'], ['cancelled', 'Cancelled'], ['all', 'All']];
async function renderAdminOrders() {
  const [orders, staff] = await Promise.all([Api.get('/api/orders'), can('assign') ? Api.get('/api/users') : Promise.resolve([])]);
  S.orders = orders; S.staff = staff;
  if (!S.ordersInit) { S.ordersInit = true; S.orderFilter = S.me.role === 'cashier' ? 'topack' : 'active'; }
  const today = new Date().toDateString();
  const todays = S.orders.filter(o => new Date(o.createdAt).toDateString() === today && o.status !== 'cancelled');
  const active = S.orders.filter(o => !['delivered', 'cancelled'].includes(o.status));
  const f = S.orderFilter;
  const match = o => f === 'all' || (f === 'active' ? !['delivered', 'cancelled'].includes(o.status) : f === 'topack' ? ['accepted', 'preparing'].includes(o.status) : f === 'done' ? o.status === 'delivered' : o.status === f);
  const list = S.orders.filter(match).slice(0, 200);
  const count = k => S.orders.filter(o => k === 'topack' ? ['accepted', 'preparing'].includes(o.status) : o.status === k).length;
  const c = S.cfg;
  const y = window.scrollY;
  app().innerHTML = adminShell('orders', `
    <div class="stats">
      ${can('reports') ? `<div class="stat"><div class="k">Today's orders</div><div class="v">${todays.length}</div></div>
      <div class="stat"><div class="k">Today's sales</div><div class="v">${rupee(todays.reduce((s, o) => s + o.total, 0))}</div></div>` : `<div class="stat"><div class="k">New</div><div class="v">${count('new')}</div></div><div class="stat"><div class="k">To pack</div><div class="v">${count('topack')}</div></div>`}
      <div class="stat"><div class="k">Active orders</div><div class="v">${active.length}</div></div>
      <div class="stat"><div class="k">Store</div><div class="v" style="font-size:16px;padding-top:4px">${can('accept') ? `<label class="row" style="cursor:pointer"><span class="switch"><input type="checkbox" id="accepting" ${c.acceptingOrders ? 'checked' : ''}><i></i></span>${c.acceptingOrders ? 'Taking orders' : 'Paused'}</label>` : (c.acceptingOrders ? 'Taking orders' : 'Paused')}</div></div>
    </div>
    <div class="row wrap" style="margin-bottom:12px">
      <div class="chips" style="padding:0">${ORDER_FILTERS.map(([k, t]) => { const n = ['new', 'topack', 'ready', 'out'].includes(k) ? count(k) : 0; return `<button class="chip ${f === k ? 'on' : ''}" data-act="ofilter" data-f="${k}">${t}${n ? ` · ${n}` : ''}</button>`; }).join('')}</div>
      <span class="spacer"></span>
      ${'Notification' in window && Notification.permission === 'default' ? `<button class="btn sm" data-act="askNotify">🔔 Enable alerts</button>` : ''}
      <button class="btn sm" data-act="refreshOrders">↻</button>
    </div>
    ${list.length ? `<div class="olist">${list.map(orderCard).join('')}</div>` : `<div class="empty"><div class="big">📭</div>${f === 'active' || f === 'topack' ? 'Nothing waiting right now. New orders will ring here.' : 'No orders here.'}</div>`}
  `);
  window.scrollTo(0, y);
  const acc = $('#accepting');
  if (acc) acc.onchange = async e => { await Api.post('/api/accepting', { on: e.target.checked }); S.cfg = await Api.get('/api/config'); renderAdminOrders(); toast(e.target.checked ? 'Store is taking orders' : 'Orders paused'); };
  if (!pollTimer) pollTimer = setInterval(() => { if (location.hash.startsWith('#/admin/orders')) renderAdminOrders().catch(() => {}); }, Api.demo ? 4000 : 60000);
}

function orderButtons(o) {
  const b = [], final = ['delivered', 'cancelled'].includes(o.status), bt = S.cfg.businessType;
  const btn = (s, label, cls = 'primary') => `<button class="btn ${cls} sm" style="flex:1" data-act="setStatus" data-id="${o.id}" data-s="${s}">${label}</button>`;
  if (o.status === 'new' && can('accept')) b.push(btn('accepted', '✓ Accept order'));
  if (o.status === 'new' && !can('accept')) b.push(`<span class="small muted">Waiting for the manager to accept</span>`);
  if (o.status === 'accepted' && can('pack')) b.push(btn('preparing', bt === 'food' || bt === 'bakery' ? '👨‍🍳 Start preparing' : '📦 Start packing'));
  if (o.status === 'preparing' && can('pack')) b.push(btn('ready', o.mode === 'delivery' ? '✅ Packed — ready for delivery' : '✅ Mark ready'));
  if (o.status === 'ready' && o.mode !== 'delivery' && can('pack')) b.push(btn('delivered', o.mode === 'dinein' ? '🍽️ Served' : '🤝 Handed over'));
  if (o.status === 'ready' && o.mode === 'delivery') b.push(`<span class="small muted">${o.assignedTo ? `Waiting for ${esc(o.assignedTo.name)} to pick up` : 'Assign a delivery boy ↓'}</span>`);
  if (o.status === 'out' && can('accept')) b.push(btn('delivered', 'Mark delivered', ''));
  b.push(`<button class="btn sm" data-act="printBill" data-id="${o.id}">🖨️</button>`);
  if (!final && can('accept')) b.push(`<button class="btn sm danger" data-act="cancelOrder" data-id="${o.id}">Cancel</button>`);
  return b.join('');
}

function orderCard(o) {
  const pill = { new: 'brand', accepted: 'warn', preparing: 'warn', ready: 'ok', out: 'ok', delivered: '', cancelled: 'bad' }[o.status];
  const cu = o.customer, final = ['delivered', 'cancelled'].includes(o.status);
  const riders = S.staff.filter(u => u.role === 'delivery' && u.active);
  const busy = id => S.orders.filter(x => x.status === 'out' && x.assignedTo && x.assignedTo.id === id).length;
  const last = o.history[o.history.length - 1];
  return `<div class="ocard ${o.status === 'new' ? 'new' : ''}">
    <div class="row"><b style="font-size:17px">#${o.number}</b><span class="pill ${pill}">${esc(statusName(o.status, o.mode))}</span><span class="spacer"></span><span class="small muted">${timeAgo(o.createdAt)}</span></div>
    <div class="small" style="margin-top:6px"><b>${esc(cu.name)}</b> · <a href="tel:${esc(cu.phone)}">${esc(cu.phone)}</a> · <a href="${waLink(cu.phone, `Hi ${cu.name}, about your order #${o.number} from ${S.cfg.name}: `)}" target="_blank" rel="noopener">WhatsApp</a></div>
    <div class="small muted">${o.mode === 'delivery' ? '🛵 ' + esc(cu.address + (cu.landmark ? ', ' + cu.landmark : '') + (cu.pincode ? ' - ' + cu.pincode : '')) + (cu.geo ? ` · <a href="https://www.google.com/maps?q=${ll(cu.geo)}" target="_blank" rel="noopener">📍 pin</a>` : '') : o.mode === 'dinein' ? '🍽️ Table ' + esc(o.table) : '🏬 ' + esc(MODE_NAMES().pickup)}${o.slot ? ' · ⏰ ' + esc(o.slot) : ''}</div>
    <div class="oitems">${o.lines.map(l => `<div><span>${l.qty} × ${esc(l.name)}${l.variant ? ` <b>(${esc(l.variant)})</b>` : ''}${l.option2 ? ` · ${esc(l.option2)}` : ''}${l.addons && l.addons.length ? `<br><span class="muted small">+ ${esc(l.addons.map(a => a.name).join(', '))}</span>` : ''}${l.note ? `<br><span class="small" style="color:var(--warn)">“${esc(l.note)}”</span>` : ''}</span><span>${rupee(l.total)}</span></div>`).join('')}
      ${o.note ? `<div class="small" style="color:var(--warn);margin-top:6px">Note: ${esc(o.note)}</div>` : ''}</div>
    <div class="row"><b>${rupee(o.total)}</b><span class="pill ${o.paid ? 'ok' : ''}">${o.payment === 'upi' ? 'UPI' : 'Cash'} · ${o.paid ? 'Paid' : 'Unpaid'}</span><span class="spacer"></span>
      ${can('payment') && !(o.status === 'cancelled') ? `<button class="btn sm ghost" data-act="togglePaid" data-id="${o.id}">${o.paid ? 'Mark unpaid' : 'Mark paid'}</button>` : ''}</div>
    ${o.mode === 'delivery' && !final && can('assign') ? `<div class="row assign" style="margin-top:8px"><span class="small" style="font-weight:600">🛵 Delivery boy</span>
      <select data-assign="${o.id}" ${o.status === 'out' ? 'disabled' : ''}><option value="">— choose —</option>${riders.map(r => `<option value="${r.id}" ${o.assignedTo && o.assignedTo.id === r.id ? 'selected' : ''}>${esc(r.name)}${busy(r.id) ? ` (on ${busy(r.id)} delivery)` : ' (free)'}</option>`).join('')}</select></div>
      ${!riders.length ? `<div class="small muted">No delivery boys yet — ${can('staff') ? '<a href="#/admin/staff">add one in Staff</a>' : 'ask the owner to add one'}.</div>` : ''}` : ''}
    ${o.mode === 'delivery' && o.assignedTo && (!can('assign') || final) ? `<div class="small" style="margin-top:8px">🛵 ${esc(o.assignedTo.name)}</div>` : ''}
    ${o.status === 'out' ? `<div class="small" style="margin-top:6px">${o.rider ? `📍 Live · ${fmtDist(riderDistance(o)) || 'location'} ${riderDistance(o) != null ? 'from customer' : ''} · ${ago(o.rider.at)} · <a href="${routeLink(o)}" target="_blank" rel="noopener">see on map</a>` : '⏳ Waiting for live location'}</div>` : ''}
    <div class="small muted" style="margin-top:6px">Last: ${esc(last.text)}</div>
    <div class="row wrap" style="margin-top:10px">${orderButtons(o)}</div>
    <div class="row" style="margin-top:6px"><a class="small" href="#/order/${o.id}" target="_blank">Customer tracking page ↗</a><span class="spacer"></span><button class="btn sm ghost" data-act="showLog" data-id="${o.id}">Activity log</button></div>
  </div>`;
}

// ---------- delivery boy ----------
// Shares the phone's GPS for every order that's out for delivery, while this page is open.
const Tracker = {
  watch: null, last: 0, pos: null, status: 'off', err: '', sim: null, wake: null, out: [],
  bar() {
    if (!S.me || S.me.role !== 'delivery' || !this.out.length) return '';
    const cls = this.status === 'on' ? 'ok' : this.status === 'error' ? 'bad' : 'warn';
    return `<div class="track-bar ${cls}"><div class="wrap-page row"><span class="live-dot"></span><span style="flex:1">${this.status === 'on' ? `Sharing live location with ${this.out.length} customer${this.out.length > 1 ? 's' : ''}${this.pos ? ` · ±${Math.round(this.pos.acc)} m` : ''}` : this.status === 'error' ? esc(this.err) : 'Getting your location…'}</span>${Api.demo ? `<button class="btn sm" data-act="simDrive">${this.sim ? '⏸ Stop' : '▶️ Simulate drive'}</button>` : ''}</div></div>`;
  },
  refreshBar() { const old = $('.track-bar'); const html = this.bar(); if (old) old.outerHTML = html || ''; else if (html) $('.admin-top') && $('.admin-top').insertAdjacentHTML('afterend', html); },
  async sync() {
    if (!S.me || S.me.role !== 'delivery') return this.stop();
    try { this.out = (await Api.get('/api/orders')).filter(o => o.status === 'out'); } catch { return; }
    if (this.out.length) this.start(); else this.stop();
    this.refreshBar();
  },
  start() {
    if (this.watch != null || this.sim) return;
    if (!('geolocation' in navigator)) return this.setErr('This phone/browser has no GPS access.');
    if (!window.isSecureContext) return this.setErr('Live location needs the store opened over https:// (your Cloudflare domain).');
    this.status = 'wait';
    this.watch = navigator.geolocation.watchPosition(p => this.onPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, speed: p.coords.speed }),
      e => this.setErr(e.code === 1 ? 'Location permission denied — allow location for this site in Chrome settings.' : 'Could not get GPS — ' + e.message),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
    this.keepAwake();
    clearInterval(this.beat);
    this.beat = setInterval(() => { if (this.pos && Date.now() - this.last > 30000) this.onPos(this.pos, true); }, 10000);
  },
  stop() {
    if (this.watch != null) navigator.geolocation.clearWatch(this.watch);
    this.watch = null; clearInterval(this.sim); this.sim = null; clearInterval(this.beat); clearTimeout(this.pending); this.status = 'off'; this.out = [];
    try { this.wake && this.wake.release(); } catch {} this.wake = null;
  },
  setErr(msg) { this.status = 'error'; this.err = msg; this.refreshBar(); },
  async keepAwake() { try { if ('wakeLock' in navigator) this.wake = await navigator.wakeLock.request('screen'); } catch {} },
  async onPos(pos, force) {
    this.pos = pos; this.status = 'on';
    const wait = 8000 - (Date.now() - this.last);
    if (!force && wait > 0) {
      // too soon — send this newest position as soon as the gap is over
      clearTimeout(this.pending); this.pending = setTimeout(() => this.onPos(this.pos, true), wait);
      return this.refreshBar();
    }
    clearTimeout(this.pending);
    this.last = Date.now();
    for (const o of this.out) { try { await Api.post(`/api/orders/${o.id}/location`, pos); } catch (e) { if (e.status === 409 || e.status === 403) this.sync(); } }
    this.refreshBar();
    if (location.hash.startsWith('#/admin/deliveries')) renderDeliveries(true).catch(() => {});
  },
  // preview only: pretend to ride towards the customer
  toggleSim() {
    if (this.sim) { clearInterval(this.sim); this.sim = null; return this.refreshBar(); }
    const o = this.out[0]; if (!o) return;
    const dest = o.customer.geo || { lat: 26.9124, lng: 75.7873 };
    let p = this.pos || { lat: dest.lat + 0.018, lng: dest.lng + 0.022 };
    this.sim = setInterval(() => {
      p = { lat: p.lat + (dest.lat - p.lat) * 0.15, lng: p.lng + (dest.lng - p.lng) * 0.15, acc: 8 + Math.random() * 6, speed: 7 };
      this.onPos(p, true);
    }, 2500);
    this.refreshBar();
  },
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Tracker.watch != null) Tracker.keepAwake(); });

async function renderDeliveries(quiet) {
  const list = await Api.get('/api/orders');
  const mine = list.filter(o => !['delivered', 'cancelled'].includes(o.status));
  const done = list.filter(o => o.status === 'delivered');
  Tracker.out = list.filter(o => o.status === 'out');
  const cash = done.filter(o => o.payment === 'cod' && o.paid).reduce((s, o) => s + o.total, 0);
  const html = adminShell('deliveries', `
    <div class="row" style="margin:16px 0 8px"><h2 style="margin:0">Hi ${esc(S.me.name)} 👋</h2><span class="spacer"></span><button class="btn sm" data-act="refreshDeliveries">↻</button></div>
    <div class="stats" style="grid-template-columns:repeat(3,1fr)"><div class="stat"><div class="k">To deliver</div><div class="v">${mine.length}</div></div><div class="stat"><div class="k">Delivered today</div><div class="v">${done.length}</div></div><div class="stat"><div class="k">Cash collected</div><div class="v">${rupee(cash)}</div></div></div>
    ${mine.length ? `<div class="olist">${mine.map(deliveryCard).join('')}</div>` : `<div class="empty"><div class="big">🛵</div>No deliveries assigned right now.<br>You'll hear a beep when the manager gives you one.</div>`}
    ${done.length ? `<h3 style="margin-top:24px">Done today</h3><div class="card">${done.map(o => `<div class="line"><div class="thumb">✅</div><div style="flex:1"><b>#${o.number} · ${esc(o.customer.name)}</b><div class="small muted">${esc(o.customer.address)}</div></div><div style="text-align:right"><b>${rupee(o.total)}</b><div class="small muted">${o.payment === 'cod' ? 'Cash' : 'UPI'}</div></div></div>`).join('')}</div>` : ''}
    <p class="small muted" style="margin-top:20px">Keep this page open while delivering — your phone shares its location only while the page is on screen. Use the Navigate button for Google Maps directions, then come back here to mark delivered.</p>`);
  if (quiet && $('.olist') && document.activeElement && document.activeElement.type === 'checkbox') return; // don't wipe a ticked box
  app().innerHTML = html;
  if (!pollTimer) pollTimer = setInterval(() => { if (location.hash.startsWith('#/admin/deliveries')) { renderDeliveries(true).catch(() => {}); Tracker.sync(); } }, Api.demo ? 4000 : 30000);
  Tracker.sync();
}
function deliveryCard(o) {
  const cu = o.customer, cod = o.payment === 'cod' && !o.paid, d = riderDistance(o);
  return `<div class="ocard ${o.status === 'out' ? 'new' : ''}">
    <div class="row"><b style="font-size:17px">#${o.number}</b><span class="pill ${o.status === 'out' ? 'ok' : o.status === 'ready' ? 'brand' : 'warn'}">${o.status === 'out' ? 'On the way' : o.status === 'ready' ? 'Ready to pick up' : 'Being packed…'}</span><span class="spacer"></span>${cod ? `<span class="pill warn">Collect ${rupee(o.total)}</span>` : `<span class="pill ok">Paid</span>`}</div>
    <div style="margin-top:8px"><b>${esc(cu.name)}</b></div>
    <div>${esc(cu.address)}${cu.landmark ? `<br><span class="muted">Near ${esc(cu.landmark)}</span>` : ''}${cu.pincode ? ` · ${esc(cu.pincode)}` : ''}</div>
    ${o.status === 'out' && d != null ? `<div class="small muted">${fmtDist(d)} to go</div>` : ''}
    <div class="small muted" style="margin-top:4px">${o.lines.reduce((s, l) => s + l.qty, 0)} items · ${o.lines.map(l => esc(l.name)).slice(0, 3).join(', ')}${o.lines.length > 3 ? '…' : ''}</div>
    ${o.note ? `<div class="small" style="color:var(--warn)">Note: ${esc(o.note)}</div>` : ''}
    <div class="row wrap" style="margin-top:10px"><a class="btn sm" style="flex:1" href="tel:${esc(cu.phone)}">📞 Call</a><a class="btn sm" style="flex:1" href="${waLink(cu.phone, `Hi ${cu.name}, I'm ${S.me.name} from ${S.cfg.name} with your order #${o.number}.`)}" target="_blank" rel="noopener">💬 WhatsApp</a><a class="btn sm" style="flex:1" href="${navLink(o)}" target="_blank" rel="noopener">🧭 Navigate</a></div>
    ${o.status === 'out' ? `
      ${cod ? `<label class="check" style="margin-top:10px"><input type="checkbox" id="cash-${o.id}"><span>I collected <b>${rupee(o.total)}</b> cash</span></label>` : ''}
      <button class="btn primary lg block" style="margin-top:10px" data-act="riderDelivered" data-id="${o.id}" data-cod="${cod ? 1 : 0}">✓ Delivered</button>`
    : `<button class="btn primary lg block" style="margin-top:10px" data-act="riderStart" data-id="${o.id}" ${o.status === 'ready' ? '' : 'disabled'}>${o.status === 'ready' ? '🛵 Picked up — start delivery' : 'Wait — order is being packed'}</button>`}
  </div>`;
}

// ---------- staff management (owner / admin) ----------
async function renderStaff() {
  S.staff = await Api.get('/api/users');
  if (!S.orders.length) S.orders = await Api.get('/api/orders');
  const today = new Date().toDateString();
  const did = (u, test) => S.orders.reduce((n, o) => n + o.history.filter(h => h.by && h.by.id === u.id && new Date(h.at).toDateString() === today && test(h)).length, 0);
  const order = ['admin', 'owner', 'manager', 'cashier', 'delivery'];
  const list = S.staff.slice().sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.name.localeCompare(b.name));
  app().innerHTML = adminShell('staff', `
    <div class="row wrap" style="margin:16px 0"><h2 style="margin:0">Staff <span class="muted" style="font-weight:500">(${S.staff.length})</span></h2><span class="spacer"></span><button class="btn primary" data-act="editStaff" data-id="">+ Add staff</button></div>
    <div class="roles-help">${Object.entries(Core.ROLES).map(([k, r]) => `<div><b>${r.emoji} ${esc(r.label)}</b><span class="small muted">${esc(r.about)}</span></div>`).join('')}</div>
    <div style="overflow-x:auto;margin-top:14px"><table class="ptable"><thead><tr><th>Name</th><th>Role</th><th>Login</th><th>Today</th><th>Active</th><th></th></tr></thead><tbody>
    ${list.map(u => {
      const stats = u.role === 'delivery' ? `${did(u, h => h.status === 'delivered')} delivered` : u.role === 'cashier' ? `${did(u, h => h.status === 'ready')} packed` : `${did(u, h => h.status === 'accepted')} accepted`;
      const locked = u.role === 'admin' && S.me.role !== 'admin';
      return `<tr><td><b>${esc(u.name)}</b>${u.id === S.me.id ? ' <span class="pill">you</span>' : ''}<div class="small muted">${esc(u.phone || '')}</div></td>
        <td><span class="pill">${Core.ROLES[u.role].emoji} ${esc(roleLabel(u.role))}</span></td><td class="small">${esc(u.username)}</td><td class="small">${stats}</td>
        <td>${locked || u.id === S.me.id ? (u.active ? 'Yes' : 'No') : `<label class="switch"><input type="checkbox" data-act="staffActive" data-id="${u.id}" ${u.active ? 'checked' : ''}><i></i></label>`}</td>
        <td>${locked ? '' : `<button class="btn sm" data-act="editStaff" data-id="${u.id}">Edit</button>`}</td></tr>`;
    }).join('')}</tbody></table></div>
    <p class="small muted">Each person logs in at <b>${esc(location.origin + location.pathname)}#/admin</b> with their own login name and PIN, and sees only what their role allows. On Android they can tap “Add to Home screen” to keep it like an app.</p>`);
}
function staffForm(u) {
  const isNew = !u; u = u || { name: '', username: '', phone: '', role: 'delivery', active: true };
  const roles = Object.keys(Core.ROLES).filter(r => r !== 'admin' || S.me.role === 'admin');
  openModal(`<div class="sheet" data-stop><div class="sheet-body stack">
    <div class="row"><h2 style="flex:1;margin:0">${isNew ? 'Add staff' : 'Edit ' + esc(u.name)}</h2><button class="icon-btn" data-act="closeModal">✕</button></div>
    <label class="f"><span>Name *</span><input type="text" id="u-name" value="${esc(u.name)}"></label>
    <div class="grid2"><label class="f"><span>Login name *</span><input type="text" id="u-user" value="${esc(u.username)}" autocapitalize="none" placeholder="e.g. ramesh"></label>
    <label class="f"><span>Mobile (customers see it for delivery)</span><input type="tel" id="u-phone" value="${esc(u.phone)}"></label></div>
    <div><span class="small" style="font-weight:600">Role *</span><div class="opt-list" style="margin-top:6px">${roles.map(r => `<label class="opt ${u.role === r ? 'on' : ''}"><input type="radio" name="u-role" value="${r}" ${u.role === r ? 'checked' : ''} ${u.id === S.me.id ? 'disabled' : ''}><span style="flex:1"><b>${Core.ROLES[r].emoji} ${esc(Core.ROLES[r].label)}</b><br><span class="small muted">${esc(Core.ROLES[r].about)}</span></span></label>`).join('')}</div></div>
    <label class="f"><span>${isNew ? 'Password / PIN * (4+ characters)' : 'New password / PIN (leave empty to keep)'}</span><input type="text" id="u-pw" autocomplete="off" placeholder="${isNew ? 'e.g. 4-digit PIN' : ''}"></label>
    <div class="row">${!isNew && u.id !== S.me.id ? `<button class="btn danger" data-act="delStaff" data-id="${u.id}">Remove</button>` : ''}<span class="spacer"></span><button class="btn primary lg" data-act="saveStaff" data-id="${isNew ? '' : u.id}">Save</button></div>
  </div></div>`);
  $$('input[name=u-role]').forEach(i => i.onchange = () => $$('.opt').forEach(o => o.classList.toggle('on', $('input', o).checked)));
}

// ---------- my account (everyone) ----------
function renderMe() {
  app().innerHTML = adminShell('me', `<div class="narrow" style="max-width:520px;padding:16px 0">
    <div class="card stack"><div class="row"><div class="avatar">${Core.ROLES[S.me.role].emoji}</div><div><h2 style="margin:0">${esc(S.me.name)}</h2><div class="muted">${esc(roleLabel(S.me.role))} · login: ${esc(S.me.username)}</div></div></div>
      <div class="small muted">${esc(Core.ROLES[S.me.role].about)}</div></div>
    <div class="card stack" style="margin-top:12px"><h3>Change my password / PIN</h3>
      <label class="f"><span>Current</span><input type="password" id="pw-cur" autocomplete="current-password"></label>
      <label class="f"><span>New</span><input type="password" id="pw-new" autocomplete="new-password"></label>
      <button class="btn" data-act="changePw">Change password</button></div>
    ${'Notification' in window && Notification.permission !== 'granted' ? `<button class="btn block" style="margin-top:12px" data-act="askNotify">🔔 Turn on order alerts</button>` : ''}
    <button class="btn block lg" style="margin-top:12px" data-act="logout">Log out</button>
  </div>`);
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
      <label class="f"><span>Google Maps API key (optional)</span><input type="text" id="s-maps" value="${esc(c.mapsKey || '')}" placeholder="Leave empty — maps work without it"></label>
      <div class="small muted">Live delivery maps work without a key. Add a free “Maps Embed API” key from Google Cloud only if the map ever stops loading.</div>
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
    <div class="card set-section stack"><h3>💾 Data</h3>
      <div class="row wrap"><button class="btn" data-act="exportData">Download backup</button>
      ${can('reset') ? `<span class="spacer"></span><button class="btn danger" data-act="resetStore">Start over / change business type…</button></div>
      <div class="small muted">Starting over deletes all products, orders, staff and settings and opens the setup wizard again.</div>` : '</div>'}
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
    packingCharge: +v('#s-pack') || 0, mapsKey: v('#s-maps'), slots: v('#s-slots').split('\n').map(s => s.trim()).filter(Boolean),
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
    try {
      const r = await Api.post('/api/login', { username: $('#l-user').value, password: $('#l-pw').value });
      ls.set('sk_token', r.token); ls.set('sk_user', r.user); ls.set('sk_last_user', r.user.username); S.me = r.user; S.ordersInit = false;
      go('#/admin/' + homeTab());
    } catch (e) { toast(e.message, 'bad'); }
  },
  demoLogin(el) {
    const u = el.dataset.u; $('#l-user').value = u;
    if (u === (Demo.env.db.users.find(x => x.role === 'admin') || {}).username) { $('#l-pw').focus(); return toast('Type the admin password you chose'); }
    $('#l-pw').value = '1234'; actions.login();
  },
  logout() { logout(); go('#/admin'); },
  refreshDeliveries() { renderDeliveries(); },
  simDrive() { Tracker.toggleSim(); },
  async riderStart(el) {
    el.disabled = true;
    try { await Api.patch('/api/orders/' + el.dataset.id, { status: 'out' }); toast('Delivery started — sharing your live location', 'ok'); await Tracker.sync(); renderDeliveries(); }
    catch (e) { toast(e.message, 'bad'); el.disabled = false; }
  },
  async riderDelivered(el) {
    const id = el.dataset.id;
    if (el.dataset.cod === '1' && !$('#cash-' + id).checked) return toast('Tick “I collected cash” first', 'bad');
    el.disabled = true;
    try {
      if (el.dataset.cod === '1') await Api.patch('/api/orders/' + id, { paid: true });
      await Api.patch('/api/orders/' + id, { status: 'delivered' });
      toast('Delivered 🎉', 'ok'); await Tracker.sync(); renderDeliveries();
    } catch (e) { toast(e.message, 'bad'); el.disabled = false; }
  },
  showLog(el) {
    const o = S.orders.find(x => x.id === el.dataset.id);
    openModal(`<div class="sheet" data-stop><div class="sheet-body"><div class="row"><h2 style="flex:1;margin:0">Order #${o.number} activity</h2><button class="icon-btn" data-act="closeModal">✕</button></div>${activityHtml(o)}</div></div>`);
  },
  editStaff(el) { staffForm(el.dataset.id ? S.staff.find(u => u.id === el.dataset.id) : null); },
  async saveStaff(el) {
    const id = el.dataset.id;
    const roleIn = $('input[name=u-role]:checked');
    const body = { name: $('#u-name').value.trim(), username: $('#u-user').value.trim(), phone: $('#u-phone').value.trim(), role: roleIn ? roleIn.value : undefined };
    const pw = $('#u-pw').value.trim(); if (pw || !id) body.password = pw;
    if (id && id === S.me.id) delete body.role;
    try { if (id) await Api.put('/api/users/' + id, body); else await Api.post('/api/users', body); closeModal(); toast('Saved', 'ok'); renderStaff(); }
    catch (e) { toast(e.message, 'bad'); }
  },
  async delStaff(el) { if (!confirm('Remove this staff member?')) return; try { await Api.del('/api/users/' + el.dataset.id); closeModal(); renderStaff(); } catch (e) { toast(e.message, 'bad'); } },
  async staffActive(el) { try { await Api.put('/api/users/' + el.dataset.id, { active: el.checked }); toast(el.checked ? 'Account switched on' : 'Account switched off — they are logged out'); } catch (e) { toast(e.message, 'bad'); el.checked = !el.checked; } },
  async useMyLocation(el) {
    if (!navigator.geolocation) return toast('Location not available on this device', 'bad');
    el.disabled = true; el.textContent = 'Finding you…';
    navigator.geolocation.getCurrentPosition(p => {
      S.form = S.form || {}; S.form.geo = { lat: p.coords.latitude, lng: p.coords.longitude };
      S.drawCheckout(); toast('Location added — the delivery boy will navigate straight to you', 'ok');
    }, err => { el.disabled = false; el.textContent = '📍 Use my current location'; toast(err.code === 1 ? 'Location permission was denied' : 'Could not get your location', 'bad'); }, { enableHighAccuracy: true, timeout: 15000 });
  },
  clearGeo() { S.form.geo = null; S.drawCheckout(); },
  ofilter(el) { S.orderFilter = el.dataset.f; renderAdminOrders(); },
  refreshOrders() { renderAdminOrders(); },
  askNotify() { Notification.requestPermission().then(() => route()); },
  async setStatus(el) { el.disabled = true; try { await Api.patch('/api/orders/' + el.dataset.id, { status: el.dataset.s }); renderAdminOrders(); } catch (e) { toast(e.message, 'bad'); el.disabled = false; } },
  async cancelOrder(el) { if (!confirm('Cancel this order?')) return; try { await Api.patch('/api/orders/' + el.dataset.id, { status: 'cancelled' }); renderAdminOrders(); } catch (e) { toast(e.message, 'bad'); } },
  async togglePaid(el) { const o = S.orders.find(x => x.id === el.dataset.id); try { await Api.patch('/api/orders/' + o.id, { paid: !o.paid }); renderAdminOrders(); } catch (e) { toast(e.message, 'bad'); } },
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
    try { const r = await Api.post('/api/password', { current: $('#pw-cur').value, next: $('#pw-new').value }); ls.set('sk_token', r.token); ls.set('sk_user', r.user); toast('Password changed', 'ok'); $('#pw-cur').value = $('#pw-new').value = ''; }
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
    try { await Api.post('/api/reset', { password: pw }); logout(); S.cart = []; saveCart(); await loadStore(); go('#/'); }
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

document.addEventListener('change', async e => {
  const sel = e.target.closest('select[data-assign]');
  if (!sel) return;
  try { await Api.patch('/api/orders/' + sel.dataset.assign, { assignTo: sel.value }); toast(sel.value ? `Assigned to ${sel.options[sel.selectedIndex].text.replace(/ \(.*/, '')}` : 'Delivery boy removed', 'ok'); renderAdminOrders(); }
  catch (err) { toast(err.message, 'bad'); renderAdminOrders(); }
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
