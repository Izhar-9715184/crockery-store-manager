'use strict';
/* Phone screens: Today, Sale, Stock, Udhar. Talks to the desktop program over the shop WiFi / Tailscale. */

// ------------------------------------------------------------------ helpers
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => 'Rs ' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const qty = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const fmtDate = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const dayName = (s) => { const [y, m, d] = s.split('-').map(Number); return DAYS[new Date(y, m - 1, d).getDay()]; };
const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* ignore */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } },
};
function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, kind === 'error' ? 5000 : 2200);
}

// ------------------------------------------------------------------ talking to the shop computer
let token = store.get('crk_token');
async function api(name, ...args) {
  let r, j;
  try {
    r = await fetch('/api/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify({ name, args }),
    });
    j = await r.json();
  } catch (_) {
    throw new Error('Cannot reach the shop computer. Is the laptop on and the program open?');
  }
  if (r.status === 401 && j.login) { showLogin(); throw new Error('Please log in again'); }
  if (!j.ok) throw new Error(j.error || 'Something went wrong');
  return j.data;
}
async function safe(fn) {
  try { return await fn(); } catch (e) { toast(e.message, 'error'); return undefined; }
}

// ------------------------------------------------------------------ sheets (pop-up panels)
const sheetStack = [];
// Android "Back" button closes the top pop-up instead of leaving the app.
// pushed = history entries we added; they are removed in ONE step once every pop-up is closed.
let pushed = 0;
let ignorePop = 0;
function releaseHistory() {
  setTimeout(() => {
    if (sheetStack.length === 0 && pushed > 0) {
      ignorePop += 1;
      const n = pushed;
      pushed = 0;
      history.go(-n);
    }
  }, 0);
}
function sheet(title, bodyHtml, footerButtons = []) {
  const el = h(`<div class="shade"><div class="sheet"><header><h3>${esc(title)}</h3><button class="x" aria-label="Close">×</button></header>
    <div class="body"></div><footer></footer></div></div>`);
  const body = $('.body', el);
  if (typeof bodyHtml === 'string') body.innerHTML = bodyHtml; else body.append(bodyHtml);
  const s = { el, body, close };
  function close() {
    const i = sheetStack.indexOf(s);
    if (i < 0) return;
    sheetStack.splice(i, 1);
    el.remove();
    releaseHistory();
  }
  $('.x', el).addEventListener('click', close);
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  const foot = $('footer', el);
  for (const b of footerButtons) {
    const btn = h(`<button class="btn ${b.kind || ''} block">${esc(b.label)}</button>`);
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const r = b.onClick ? await b.onClick(s) : undefined;
        if (r !== false && b.close !== false) close();
      } catch (e) { toast(e.message, 'error'); }
      btn.disabled = false;
    });
    foot.append(btn);
  }
  sheetStack.push(s);
  history.pushState({ sheet: true }, '');
  pushed += 1;
  $('#sheets').append(el);
  return s;
}
window.addEventListener('popstate', () => {
  if (ignorePop > 0) { ignorePop -= 1; return; }
  if (pushed > 0) pushed -= 1;
  const s = sheetStack.pop();
  if (s) s.el.remove();
});
const formVals = (root) => Object.fromEntries($$('[name]', root).map((e) => [e.name, e.value]));

// ------------------------------------------------------------------ login
function showLogin() {
  store.del('crk_token');
  token = null;
  $('#app').hidden = true;
  $('#login').hidden = false;
  fetch('/api/info').then((r) => r.json()).then((i) => { if (i.shop_name) $('#loginShop').textContent = i.shop_name; }).catch(() => {});
}
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#loginErr').textContent = '';
  const btn = $('#loginForm button');
  btn.disabled = true;
  try {
    const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: $('#pin').value }) });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error);
    token = j.token;
    store.set('crk_token', token);
    $('#pin').value = '';
    await startApp();
  } catch (err) {
    $('#loginErr').textContent = err instanceof TypeError ? 'Cannot reach the shop computer.' : err.message;
  }
  btn.disabled = false;
});

// ------------------------------------------------------------------ tabs
const ICON = {
  today: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  sale: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
  stock: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  udhar: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
};
const TABS = [['sale', 'Sale'], ['stock', 'Stock'], ['udhar', 'Udhar'], ['today', 'Today']];
let tab = 'sale';
let settings = {};
const cart = { items: [], customer_id: '', discount: '', paid: null, note: '' };

function drawTabs() {
  $('#tabs').innerHTML = TABS.map(([id, label]) => `<button data-t="${id}" class="${id === tab ? 'on' : ''}">
    <svg viewBox="0 0 24 24" aria-hidden="true">${ICON[id]}</svg>${label}</button>`).join('');
}
$('#tabs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-t]');
  if (b) go(b.dataset.t);
});
$('#refresh').addEventListener('click', () => go(tab));
async function go(t) {
  tab = t;
  drawTabs();
  $('#barTitle').textContent = { sale: 'New Sale', stock: 'Stock', udhar: 'Udhar', today: 'Today' }[t];
  const view = $('#view');
  const fresh = document.createElement('div');
  view.replaceChildren(fresh);
  window.scrollTo(0, 0);
  await safe(() => ({ sale: viewSale, stock: viewStock, udhar: viewUdhar, today: viewToday })[t](fresh));
}

// ------------------------------------------------------------------ Today
async function viewToday(root) {
  const d = await api('dashboard');
  const t = d.todaySum;
  const max = Math.max(1, ...d.last7.map((x) => x.sales));
  root.innerHTML = `
    <div class="muted small" style="margin:0 2px 8px">${esc(fmtDate(d.today))} · ${esc(dayName(d.today))}</div>
    <div class="stats">
      <div class="card stat"><div class="l">Sales today</div><div class="v">${money(t.sales)}</div><div class="h">${t.bills} bill${t.bills === 1 ? '' : 's'}</div></div>
      <div class="card stat"><div class="l">Cash received</div><div class="v teal">${money(t.cash_in)}</div><div class="h">incl. ${money(t.recovered)} udhar recovered</div></div>
      <div class="card stat"><div class="l">Udhar given</div><div class="v ${t.udhar_given > 0 ? 'red' : ''}">${money(t.udhar_given)}</div></div>
      <div class="card stat"><div class="l">Profit</div><div class="v">${money(t.profit)}</div></div>
      <div class="card stat wide"><div class="l">Total udhar to collect</div><div class="v red">${money(d.outstanding)}</div><div class="h">Stock value ${money(d.stockValue)}</div></div>
    </div>
    <div class="sec-title">Last 7 days</div>
    <div class="card"><div class="bars">${d.last7.map((x) => `<div class="bar ${x.date === d.today ? 'today' : ''}">
      <div class="small num muted" style="font-size:10px">${x.sales ? qty(Math.round(x.sales)) : ''}</div><div class="fill" style="height:${Math.round((x.sales / max) * 100)}%"></div><div class="d">${dayName(x.date)}</div></div>`).join('')}</div></div>
    <div class="sec-title">Low &amp; out of stock</div>
    <div class="card">${d.lowStock.length ? d.lowStock.slice(0, 10).map((p) => `<div class="row"><div class="main"><div class="name">${esc(p.name)}</div></div>
      <span class="badge ${p.stock <= 0 ? 'out' : 'low'}">${p.stock <= 0 ? 'Out' : qty(p.stock) + ' left'}</span></div>`).join('') : '<div class="empty">All items are well stocked</div>'}</div>`;
}

// ------------------------------------------------------------------ Sale
const cartTotal = () => Math.max(0, cart.items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0) - (Number(cart.discount) || 0));
const cartCount = () => cart.items.reduce((s, i) => s + (Number(i.qty) || 0), 0);

async function viewSale(root) {
  root.innerHTML = `<div class="search"><input id="q" type="search" placeholder="Search product or code…" autocomplete="off"></div><div id="list" class="card"></div><div id="cartHolder"></div>`;
  const list = $('#list', root);
  let products = [];
  async function load() {
    products = await safe(() => api('listProducts', { q: $('#q', root).value, limit: 60 })) || [];
    list.innerHTML = products.length ? products.map((p) => `<button class="row" data-id="${p.id}">
      <div class="main"><div class="name">${esc(p.name)}</div><div class="sub">${esc([p.code, p.category].filter(Boolean).join(' · '))}</div></div>
      <div class="r"><div class="num" style="font-weight:700">${money(p.sale_price)}</div>
      <span class="badge ${p.stock <= 0 ? 'out' : p.min_stock > 0 && p.stock <= p.min_stock ? 'low' : 'ok'}">${qty(p.stock)} ${esc(p.unit)}</span></div></button>`).join('')
      : '<div class="empty">No product found</div>';
  }
  function drawCartBar() {
    $('#cartHolder', root).innerHTML = cart.items.length
      ? `<button class="cartbar" id="openCart"><span>🛒 ${qty(cartCount())} item${cartCount() === 1 ? '' : 's'}</span><span class="num">${money(cartTotal())} ›</span></button>` : '';
  }
  $('#q', root).addEventListener('input', debounce(load, 200));
  list.addEventListener('click', (e) => {
    const r = e.target.closest('[data-id]');
    if (!r) return;
    const p = products.find((x) => x.id === Number(r.dataset.id));
    const line = cart.items.find((i) => i.product_id === p.id);
    if (line) line.qty = Number(line.qty) + 1;
    else cart.items.push({ product_id: p.id, name: p.name, qty: 1, price: p.sale_price, stock: p.stock });
    toast(`+1 ${p.name}`, 'ok');
    drawCartBar();
  });
  root.addEventListener('click', (e) => { if (e.target.closest('#openCart')) openCart(() => { drawCartBar(); load(); }); });
  drawCartBar();
  await load();
}

async function openCart(onChange) {
  const customers = await api('listCustomers', {});
  let custList = customers;
  const s = sheet('Bill', '<div id="cb"></div>', [
    { label: 'Save sale', kind: 'primary', close: false, onClick: () => save(s) },
  ]);
  const body = $('#cb', s.body);

  function totalsHtml() {
    const total = cartTotal();
    const paid = cart.paid === null || cart.paid === '' ? total : Number(cart.paid) || 0;
    return { total, paid, due: Math.max(0, total - paid) };
  }
  function draw() {
    const t = totalsHtml();
    body.innerHTML = `
      ${cart.items.length ? cart.items.map((i, idx) => `<div class="line" data-i="${idx}">
        <div class="top"><span>${esc(i.name)}</span><span class="num" data-lt>${qty((Number(i.qty) || 0) * (Number(i.price) || 0))}</span></div>
        <div class="ctl"><button class="step" data-act="minus">−</button>
          <input type="number" inputmode="decimal" min="0" step="any" value="${i.qty}" data-f="qty" aria-label="Quantity">
          <input type="number" inputmode="decimal" min="0" step="any" value="${i.price}" data-f="price" aria-label="Price">
          <button class="step" data-act="plus">+</button></div>
        <div class="small muted" style="margin-top:4px">${qty(i.stock)} in stock · <a href="#" data-act="del" class="red">remove</a></div></div>`).join('')
        : '<div class="empty">The bill is empty</div>'}
      <div class="stack" style="margin-top:12px">
        <label class="f"><span>Customer</span><select id="cust"><option value="">Walk-in customer</option>${custList.map((c) =>
          `<option value="${c.id}" ${String(c.id) === String(cart.customer_id) ? 'selected' : ''}>${esc(c.name)}${c.balance > 0 ? ' (udhar ' + qty(c.balance) + ')' : ''}</option>`).join('')}</select></label>
        <button class="btn sm" id="newCust" style="justify-self:start">+ New customer</button>
        <div class="sum"><span>Discount</span><input type="number" inputmode="decimal" id="disc" min="0" step="any" value="${esc(cart.discount)}" placeholder="0"></div>
        <div class="sum total"><span>Total</span><span class="num" id="tot">${money(t.total)}</span></div>
        <div class="sum"><span>Amount received</span><input type="number" inputmode="decimal" id="paid" min="0" step="any" value="${cart.paid === null ? t.total : esc(cart.paid)}"></div>
        <div class="sum"><span class="row-quick"><button class="btn sm" id="fullPaid">Full payment</button> <button class="btn sm" id="allUdhar">All udhar</button></span>
          <span>Udhar: <b id="due" class="num ${t.due > 0 ? 'red' : ''}">${money(t.due)}</b></span></div>
        <input type="text" id="note" placeholder="Note (optional)" value="${esc(cart.note)}">
      </div>`;
  }
  function refreshTotals() {
    const t = totalsHtml();
    $('#tot', body).textContent = money(t.total);
    $('#due', body).textContent = money(t.due);
    $('#due', body).className = 'num ' + (t.due > 0 ? 'red' : '');
    onChange();
  }
  draw();

  body.addEventListener('input', (e) => {
    const line = e.target.closest('.line');
    if (line && e.target.dataset.f) {
      const it = cart.items[Number(line.dataset.i)];
      it[e.target.dataset.f] = e.target.value;
      $('[data-lt]', line).textContent = qty((Number(it.qty) || 0) * (Number(it.price) || 0));
      if (cart.paid === null) $('#paid', body).value = cartTotal();
      refreshTotals();
    }
    if (e.target.id === 'disc') { cart.discount = e.target.value; if (cart.paid === null) $('#paid', body).value = cartTotal(); refreshTotals(); }
    if (e.target.id === 'paid') { cart.paid = e.target.value; refreshTotals(); }
    if (e.target.id === 'note') cart.note = e.target.value;
  });
  body.addEventListener('change', (e) => { if (e.target.id === 'cust') cart.customer_id = e.target.value; });
  body.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]');
    if (act) {
      e.preventDefault();
      const idx = Number(act.closest('.line').dataset.i);
      const it = cart.items[idx];
      if (act.dataset.act === 'plus') it.qty = (Number(it.qty) || 0) + 1;
      if (act.dataset.act === 'minus') it.qty = Math.max(0, (Number(it.qty) || 0) - 1);
      if (act.dataset.act === 'del') cart.items.splice(idx, 1);
      draw(); onChange();
      return;
    }
    if (e.target.id === 'fullPaid') { cart.paid = null; draw(); }
    if (e.target.id === 'allUdhar') { cart.paid = '0'; draw(); }
    if (e.target.id === 'newCust') {
      customerForm(null, async (c) => { custList = await api('listCustomers', {}); cart.customer_id = String(c.id); draw(); });
    }
  });

  async function save(sh) {
    const total = cartTotal();
    const sale = await api('createSale', {
      customer_id: cart.customer_id ? Number(cart.customer_id) : null,
      items: cart.items.filter((i) => Number(i.qty) > 0).map((i) => ({ product_id: i.product_id, qty: Number(i.qty), price: Number(i.price) })),
      discount: cart.discount === '' ? 0 : Number(cart.discount),
      paid: cart.paid === null || cart.paid === '' ? undefined : Number(cart.paid),
      note: cart.note,
    });
    cart.items = []; cart.customer_id = ''; cart.discount = ''; cart.paid = null; cart.note = '';
    sh.close();
    onChange();
    saleDone(sale, total);
    return false;
  }
}

async function saleDone(sale) {
  const s = settings;
  const lines = sale.items.map((i) => `${i.name} × ${qty(i.qty)} = ${qty(i.total)}`).join('\n');
  const text = `*${s.shop_name || 'Crockery Store'}*\nBill ${sale.invoice_no} · ${fmtDate(sale.date)}\n\n${lines}\n\n` +
    (sale.discount > 0 ? `Discount: ${qty(sale.discount)}\n` : '') + `*Total: Rs ${qty(sale.total)}*\nReceived: Rs ${qty(sale.paid)}\n` +
    (sale.due > 0 ? `Udhar: Rs ${qty(sale.due)}\n` : '') + `\n${s.invoice_footer || 'Thank you!'}`;
  let phone = String(sale.customer_phone || '').replace(/\D/g, '');
  if (phone.startsWith('0')) phone = '92' + phone.slice(1);
  const wa = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  sheet('Sale saved ✓', `<div class="stack" style="text-align:center;padding:10px 0">
    <div style="font-size:30px" class="teal">✓</div><div><b>${esc(sale.invoice_no)}</b></div>
    <div class="num" style="font-size:26px;font-weight:800">${money(sale.total)}</div>
    ${sale.due > 0 ? `<div class="red">Udhar ${money(sale.due)}${sale.customer_name ? ' · ' + esc(sale.customer_name) : ''}</div>` : '<div class="muted">Fully paid</div>'}</div>`,
  [
    { label: 'Send bill on WhatsApp', kind: 'teal', close: false, onClick: () => { window.open(wa, '_blank', 'noopener'); return false; } },
    { label: 'New sale' },
  ]);
}

// ------------------------------------------------------------------ Stock
const stockBadge = (p) => p.stock <= 0 ? `<span class="badge out">${qty(p.stock)} · Out</span>`
  : p.min_stock > 0 && p.stock <= p.min_stock ? `<span class="badge low">${qty(p.stock)} · Low</span>` : `<span class="badge ok">${qty(p.stock)}</span>`;
let stockFilter = '';

async function viewStock(root) {
  root.innerHTML = `<div class="search"><input id="q" type="search" placeholder="Search product…" autocomplete="off">
    <div class="chips" id="chips"><button class="chip" data-f="">All</button><button class="chip" data-f="low">Low stock</button><button class="chip" data-f="out">Out of stock</button></div></div>
    <div id="list" class="card"></div><button class="fab" id="add">+ Product</button>`;
  let products = [];
  const list = $('#list', root);
  async function load() {
    $$('.chip', root).forEach((c) => c.classList.toggle('on', c.dataset.f === stockFilter));
    products = await safe(() => api('listProducts', { q: $('#q', root).value, filter: stockFilter })) || [];
    list.innerHTML = products.length ? products.map((p) => `<button class="row" data-id="${p.id}">
      <div class="main"><div class="name">${esc(p.name)}</div><div class="sub">${esc([p.code, p.category].filter(Boolean).join(' · '))} · sale ${qty(p.sale_price)}</div></div>
      <div>${stockBadge(p)}</div></button>`).join('') : '<div class="empty">No products</div>';
  }
  $('#q', root).addEventListener('input', debounce(load, 200));
  $('#chips', root).addEventListener('click', (e) => { if (e.target.dataset.f !== undefined) { stockFilter = e.target.dataset.f; load(); } });
  $('#add', root).addEventListener('click', () => productForm(null, load));
  list.addEventListener('click', (e) => {
    const r = e.target.closest('[data-id]');
    if (r) productSheet(products.find((x) => x.id === Number(r.dataset.id)), load);
  });
  await load();
}

function productSheet(p, done) {
  const s = sheet(p.name, `<div class="stack">
    <div class="card"><div class="row"><span class="muted">In stock</span>${stockBadge(p)}</div>
      <div class="row"><span class="muted">Sale price</span><b class="num">${money(p.sale_price)}</b></div>
      <div class="row"><span class="muted">Cost price</span><b class="num">${money(p.cost_price)}</b></div></div>
    <div class="actions-grid"><button class="btn teal" data-a="in">+ Stock in</button><button class="btn" data-a="broken">Broken / lost</button>
      <button class="btn" data-a="count">Count correct</button><button class="btn" data-a="edit">Edit product</button></div></div>`);
  s.body.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    if (a.dataset.a === 'in') stockInForm(p, () => { s.close(); done(); });
    if (a.dataset.a === 'broken') adjustForm(p, 'breakage', () => { s.close(); done(); });
    if (a.dataset.a === 'count') adjustForm(p, 'correction', () => { s.close(); done(); });
    if (a.dataset.a === 'edit') productForm(p, () => { s.close(); done(); });
  });
}

function stockInForm(p, done) {
  sheet(`Stock in — ${p.name}`, `<div class="stack"><div class="muted">Now in stock: <b>${qty(p.stock)}</b></div>
    <label class="f"><span>Quantity received *</span><input type="number" inputmode="decimal" name="qty" min="0" step="any"></label>
    <label class="f"><span>Cost price (per piece)</span><input type="number" inputmode="decimal" name="cost_price" min="0" step="any" value="${p.cost_price}"></label>
    <label class="f"><span>Supplier</span><input type="text" name="supplier"></label></div>`,
  [{ label: 'Add stock', kind: 'primary', close: false, onClick: async (s) => {
    await api('stockIn', { ...formVals(s.body), product_id: p.id });
    toast('Stock added', 'ok'); s.close(); done();
  } }]);
}

function adjustForm(p, kind, done) {
  const broken = kind === 'breakage';
  sheet(`${broken ? 'Broken / lost' : 'Count correction'} — ${p.name}`, `<div class="stack"><div class="muted">Now in stock: <b>${qty(p.stock)}</b></div>
    <label class="f"><span>${broken ? 'How many broken / lost?' : 'Correct number on the shelf'}</span><input type="number" inputmode="decimal" name="qty" min="0" step="any"></label>
    <label class="f"><span>Note</span><input type="text" name="note" placeholder="optional"></label></div>`,
  [{ label: 'Save', kind: 'primary', close: false, onClick: async (s) => {
    await api('adjustStock', { ...formVals(s.body), kind, product_id: p.id });
    toast('Stock updated', 'ok'); s.close(); done();
  } }]);
}

function productForm(p, done) {
  const isNew = !p;
  p = p || { name: '', code: '', category: '', unit: 'pcs', cost_price: '', sale_price: '', min_stock: '' };
  sheet(isNew ? 'Add product' : 'Edit product', `<div class="stack">
    <label class="f"><span>Product name *</span><input type="text" name="name" value="${esc(p.name)}"></label>
    <div class="grid2"><label class="f"><span>Code</span><input type="text" name="code" value="${esc(p.code || '')}"></label>
      <label class="f"><span>Category</span><input type="text" name="category" value="${esc(p.category || '')}"></label></div>
    <div class="grid2"><label class="f"><span>Cost price</span><input type="number" inputmode="decimal" name="cost_price" min="0" step="any" value="${p.cost_price}"></label>
      <label class="f"><span>Sale price</span><input type="number" inputmode="decimal" name="sale_price" min="0" step="any" value="${p.sale_price}"></label></div>
    <div class="grid2"><label class="f"><span>Unit</span><select name="unit">${['pcs', 'set', 'dozen', 'pair', 'box', 'kg'].map((u) => `<option ${u === p.unit ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
      <label class="f"><span>Low stock alert at</span><input type="number" inputmode="decimal" name="min_stock" min="0" step="any" value="${p.min_stock}"></label></div>
    ${isNew ? '<label class="f"><span>Opening stock</span><input type="number" inputmode="decimal" name="stock" min="0" step="any"></label>' : ''}</div>`,
  [
    { label: 'Save', kind: 'primary', close: false, onClick: async (s) => {
      const f = formVals(s.body);
      if (!isNew) f.id = p.id;
      await api('saveProduct', f);
      toast('Product saved', 'ok'); s.close(); done();
    } },
    ...(!isNew ? [{ label: 'Remove product', kind: 'danger', close: false, onClick: async (s) => {
      if (!confirm(`Remove “${p.name}”? Old bills stay correct.`)) return false;
      await api('deleteProduct', p.id); toast('Removed', 'ok'); s.close(); done();
    } }] : []),
  ]);
}

// ------------------------------------------------------------------ Udhar
let dueOnly = true;
async function viewUdhar(root) {
  root.innerHTML = `<div class="search"><input id="q" type="search" placeholder="Search customer…" autocomplete="off">
    <div class="chips" id="chips"><button class="chip" data-d="1">Udhar pending</button><button class="chip" data-d="0">All customers</button></div></div>
    <div class="muted small" id="sum" style="margin:0 2px 8px"></div><div id="list" class="card"></div><button class="fab" id="add">+ Customer</button>`;
  let rows = [];
  const list = $('#list', root);
  async function load() {
    $$('.chip', root).forEach((c) => c.classList.toggle('on', (c.dataset.d === '1') === dueOnly));
    rows = await safe(() => api('listCustomers', { q: $('#q', root).value, onlyDue: dueOnly })) || [];
    const total = rows.reduce((s, c) => s + (c.balance > 0 ? c.balance : 0), 0);
    $('#sum', root).innerHTML = `${rows.length} customer${rows.length === 1 ? '' : 's'} · total udhar <b class="red">${money(total)}</b>`;
    list.innerHTML = rows.length ? rows.map((c) => `<button class="row" data-id="${c.id}"><div class="main"><div class="name">${esc(c.name)}</div>
      <div class="sub">${esc([c.phone, c.address].filter(Boolean).join(' · '))}</div></div>
      <b class="num ${c.balance > 0.004 ? 'red' : c.balance < -0.004 ? 'teal' : 'muted'}">${Math.abs(c.balance) > 0.004 ? money(c.balance) : '–'}</b></button>`).join('')
      : `<div class="empty">${dueOnly ? 'Nobody owes you anything' : 'No customers yet'}</div>`;
  }
  $('#q', root).addEventListener('input', debounce(load, 200));
  $('#chips', root).addEventListener('click', (e) => { if (e.target.dataset.d !== undefined) { dueOnly = e.target.dataset.d === '1'; load(); } });
  $('#add', root).addEventListener('click', () => customerForm(null, load));
  list.addEventListener('click', (e) => { const r = e.target.closest('[data-id]'); if (r) ledgerSheet(Number(r.dataset.id), load); });
  await load();
}

function customerForm(c, done) {
  const isNew = !c;
  c = c || { name: '', phone: '', address: '' };
  sheet(isNew ? 'Add customer' : 'Edit customer', `<div class="stack">
    <label class="f"><span>Name *</span><input type="text" name="name" value="${esc(c.name)}"></label>
    <label class="f"><span>Phone</span><input type="tel" inputmode="tel" name="phone" value="${esc(c.phone || '')}"></label>
    <label class="f"><span>Address / area</span><input type="text" name="address" value="${esc(c.address || '')}"></label>
    ${isNew ? '<label class="f"><span>Old udhar already pending (optional)</span><input type="number" inputmode="decimal" name="opening_balance" step="any"></label>' : ''}</div>`,
  [{ label: 'Save', kind: 'primary', close: false, onClick: async (s) => {
    const f = formVals(s.body);
    if (!isNew) f.id = c.id;
    const saved = await api('saveCustomer', f);
    toast('Customer saved', 'ok'); s.close(); done(saved);
  } }]);
}

async function ledgerSheet(id, done) {
  const render = async () => {
    const led = await api('customerLedger', id);
    const c = led.customer;
    sh.body.innerHTML = `<div class="stack"><div style="display:flex;justify-content:space-between;align-items:flex-end;gap:10px">
      <div><div class="muted small">${esc([c.phone, c.address].filter(Boolean).join(' · '))}</div></div>
      <div class="r"><div class="muted small">${c.balance < 0 ? 'Advance' : 'Udhar pending'}</div>
      <div class="num ${c.balance > 0 ? 'red' : 'teal'}" style="font-size:26px;font-weight:800">${money(Math.abs(c.balance))}</div></div></div>
      <div class="actions-grid"><button class="btn primary" data-a="pay">Receive payment</button><button class="btn" data-a="remind">WhatsApp reminder</button>
        <button class="btn" data-a="edit">Edit</button></div>
      <div class="card">${led.entries.slice(0, 40).map((e) => `<div class="row"><div class="main"><div class="name" style="font-weight:600">${esc(e.note || e.type)}</div>
        <div class="sub">${esc(fmtDate(e.date))}</div></div><div class="r"><div class="num ${e.debit ? 'red' : 'teal'}">${e.debit ? '+' + qty(e.debit) : '−' + qty(e.credit)}</div>
        <div class="sub num">bal ${qty(e.balance)}</div></div></div>`).join('') || '<div class="empty">No entries</div>'}</div></div>`;
    sh.led = led;
  };
  const sh = sheet('Customer ledger', '<div class="empty">Loading…</div>');
  sh.body.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]');
    if (!a) return;
    const c = sh.led.customer;
    const refresh = async () => { await render(); done(); };
    if (a.dataset.a === 'pay') paymentForm(c, refresh);
    if (a.dataset.a === 'edit') customerForm(c, refresh);
    if (a.dataset.a === 'remind') {
      let phone = String(c.phone || '').replace(/\D/g, '');
      if (phone.startsWith('0')) phone = '92' + phone.slice(1);
      const text = `Assalam o Alaikum ${c.name},\nAap ka ${settings.shop_name || 'dukaan'} mein Rs ${qty(c.balance)} udhar baqi hai. Meharbani karke ada kar dein. Shukriya.`;
      window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    }
  });
  await safe(render);
}

function paymentForm(c, done) {
  sheet(`Receive payment — ${c.name}`, `<div class="stack"><div>Udhar pending: <b class="red">${money(c.balance)}</b></div>
    <label class="f"><span>Amount received *</span><input type="number" inputmode="decimal" name="amount" min="0" step="any" value="${c.balance > 0 ? c.balance : ''}"></label>
    <label class="f"><span>Method</span><select name="method"><option value="cash">Cash</option><option value="bank">Bank transfer</option><option value="wallet">EasyPaisa / JazzCash</option><option value="cheque">Cheque</option></select></label>
    <label class="f"><span>Note</span><input type="text" name="note"></label></div>`,
  [{ label: 'Save payment', kind: 'primary', close: false, onClick: async (s) => {
    const u = await api('receivePayment', { ...formVals(s.body), customer_id: c.id });
    toast(`Saved. Remaining udhar: ${money(u.balance)}`, 'ok'); s.close(); done();
  } }]);
}

// ------------------------------------------------------------------ start
async function startApp() {
  try { settings = await api('getSettings'); } catch (e) { if (!token) return; throw e; }
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#barShop').textContent = settings.shop_name || '';
  document.title = settings.shop_name || 'Crockery Store';
  await go(tab);
}
(async function boot() {
  if (!token) return showLogin();
  try { await startApp(); } catch (e) { toast(e.message, 'error'); $('#login').hidden = true; $('#app').hidden = false; }
})();
window.__mobileReady = true;
