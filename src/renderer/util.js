'use strict';
/* Shared helpers for all screens. */
const App = { pages: {}, settings: {}, cart: null };

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const rpc = (name, ...args) => window.api.call(name, ...args);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
const money = (n) => 'Rs ' + Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const qty = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const today = () => ymd(new Date());
function addDays(str, n) {
  const [y, m, d] = str.split('-').map(Number);
  return ymd(new Date(y, m - 1, d + n));
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(str) {
  if (!str) return '';
  const [y, m, d] = str.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dayName(str) {
  const [y, m, d] = str.split('-').map(Number);
  return DAYS[new Date(y, m - 1, d).getDay()];
}
function debounce(fn, ms = 200) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------------------------------------------------------------- toast
function toast(msg, kind = '') {
  const el = h(`<div class="toast ${kind}">${esc(msg)}</div>`);
  $('#toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3000);
}
/** Run an async action; show any error as a toast instead of crashing. */
async function safe(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(e.message || String(e), 'error');
    return undefined;
  }
}

// ---------------------------------------------------------------- modal
const modalStack = [];
function modal({ title, body, wide = false, actions = [], onOpen }) {
  const el = h(`<div class="overlay"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <header><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Close">×</button></header>
    <div class="modal-body"></div><footer></footer></div></div>`);
  const bodyEl = $('.modal-body', el);
  if (typeof body === 'string') bodyEl.innerHTML = body; else bodyEl.append(body);
  const m = { el, body: bodyEl, close };
  function close() {
    const i = modalStack.indexOf(m);
    if (i >= 0) modalStack.splice(i, 1);
    el.remove();
  }
  $('[data-close]', el).addEventListener('click', close);
  el.addEventListener('mousedown', (e) => { if (e.target === el) m._down = true; });
  el.addEventListener('mouseup', (e) => { if (e.target === el && m._down) close(); m._down = false; });
  const foot = $('footer', el);
  for (const a of actions) {
    const b = h(`<button class="btn ${a.kind || ''}">${esc(a.label)}</button>`);
    if (a.id) b.id = a.id;
    b.addEventListener('click', async () => {
      if (a.onClick) {
        b.disabled = true;
        let r;
        try { r = await a.onClick(m); } catch (e) { toast(e.message || String(e), 'error'); b.disabled = false; return; }
        b.disabled = false;
        if (r === false) return;
      }
      if (a.close !== false) close();
    });
    foot.append(b);
  }
  modalStack.push(m);
  document.body.append(el);
  if (onOpen) onOpen(m);
  const first = $('input:not([type=hidden]):not([readonly]), select, textarea', bodyEl);
  if (first && !m.noFocus) first.focus();
  return m;
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length) modalStack[modalStack.length - 1].close();
});

function confirmBox(message, { okLabel = 'Yes', danger = false, title = 'Please confirm' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const m = modal({
      title,
      body: `<p style="margin:0">${esc(message)}</p>`,
      actions: [
        { label: 'Cancel', onClick: () => finish(false) },
        { label: okLabel, kind: danger ? 'danger' : 'primary', onClick: () => finish(true) },
      ],
    });
    const origClose = m.close;
    m.close = () => { origClose(); finish(false); };
  });
}

function askText({ title, label, okLabel = 'OK', placeholder = '', required = true }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const m = modal({
      title,
      body: `<label class="f"><span>${esc(label)}</span><input type="text" name="t" placeholder="${esc(placeholder)}"></label>`,
      actions: [
        { label: 'Cancel', onClick: () => finish(null) },
        {
          label: okLabel, kind: 'primary',
          onClick: (mm) => {
            const v = $('[name=t]', mm.body).value.trim();
            if (required && !v) { toast('Please write something', 'error'); return false; }
            finish(v);
          },
        },
      ],
    });
    $('[name=t]', m.body).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('footer .btn.primary', m.el).click(); });
  });
}

/** Read all named inputs inside an element into a plain object. */
function formData(root) {
  const o = {};
  for (const el of $$('[name]', root)) {
    o[el.name] = el.type === 'checkbox' ? el.checked : el.value;
  }
  return o;
}

// ---------------------------------------------------------------- csv / print
function downloadCsv(filename, rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const text = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// Paper sizes for printing. "size" goes into the page rule so the printer gets the right paper.
const PAPERS = {
  a5: { label: 'A5 (half page)', size: 'A5 portrait', margin: '7mm' },
  a4: { label: 'A4 (full page)', size: 'A4 portrait', margin: '10mm' },
  thermal: { label: 'Receipt 80mm', size: '80mm auto', margin: '3mm' },
};
const paperOf = (s = App.settings) => (PAPERS[s.print_format] ? s.print_format : 'a5');

function printHtml(html, paper) {
  const p = PAPERS[paper] || PAPERS.a4;
  let st = $('#print-page-style');
  if (!st) { st = document.createElement('style'); st.id = 'print-page-style'; document.head.append(st); }
  st.textContent = `@page { size: ${p.size}; margin: ${p.margin}; }`;
  const area = $('#print-area');
  area.innerHTML = html;
  const clear = () => { area.innerHTML = ''; window.removeEventListener('afterprint', clear); };
  window.addEventListener('afterprint', clear);
  setTimeout(() => window.print(), 50);
}

/** 115000 -> "Rupees One Lakh Fifteen Thousand Only" (Pakistani lakh / crore system). */
function amountWords(n) {
  const v = Math.round(Math.abs(Number(n) || 0) * 100) / 100;
  const rupees = Math.floor(v);
  const paisa = Math.round((v - rupees) * 100);
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen',
    'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => (x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? '-' + ones[x % 10] : ''));
  const three = (x) => (x >= 100 ? ones[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' + two(x % 100) : '') : two(x));
  const parts = [];
  const crore = Math.floor(rupees / 1e7);
  const lakh = Math.floor((rupees % 1e7) / 1e5);
  const thousand = Math.floor((rupees % 1e5) / 1e3);
  const rest = rupees % 1000;
  if (crore) parts.push(three(crore) + ' Crore');
  if (lakh) parts.push(two(lakh) + ' Lakh');
  if (thousand) parts.push(two(thousand) + ' Thousand');
  if (rest) parts.push(three(rest));
  const words = parts.length ? parts.join(' ') : 'Zero';
  return `Rupees ${words}${paisa ? ' and ' + two(paisa) + ' Paisa' : ''} Only`;
}

const initialOf = (s) => esc((String(s.shop_name || 'S').trim()[0] || 'S').toUpperCase());
const timeOf = (iso) => {
  const m = /(\d{2}):(\d{2})/.exec(String(iso || '').slice(11));
  if (!m) return '';
  const hr = Number(m[1]);
  return `${hr % 12 || 12}:${m[2]} ${hr < 12 ? 'AM' : 'PM'}`;
};

/** Coloured shop header used by every printout. `title` is the big word on the right (INVOICE, STATEMENT ...). */
function shopHeader(s, title = '', sub = '') {
  return `<div class="inv-head"><div class="inv-logo">${initialOf(s)}</div>
    <div class="inv-shop"><div class="inv-name">${esc(s.shop_name)}</div>
      <div class="inv-sub">${esc([s.shop_address, s.shop_phone ? 'Phone: ' + s.shop_phone : ''].filter(Boolean).join(' · '))}</div></div>
    ${title ? `<div class="inv-title"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</div>` : ''}</div>`;
}

function invoiceHtml(sale, s = App.settings, paper = paperOf(s)) {
  const cancelled = sale.status === 'cancelled';
  if (paper === 'thermal') {
    const rows = sale.items.map((i) => `<tr><td colspan="3" class="nm">${esc(i.name)}</td></tr>
      <tr><td>${qty(i.qty)} × ${qty(i.price)}</td><td></td><td class="r">${qty(i.total)}</td></tr>`).join('');
    return `<div class="inv thermal">
      <div class="th-head"><div class="inv-logo">${initialOf(s)}</div><div class="inv-name">${esc(s.shop_name)}</div>
        <div class="th-sub">${esc(s.shop_address || '')}${s.shop_phone ? '<br>Phone: ' + esc(s.shop_phone) : ''}</div></div>
      <div class="th-meta"><span>${esc(sale.invoice_no)}</span><span>${esc(fmtDate(sale.date))} ${esc(timeOf(sale.created_at))}</span></div>
      <div class="th-meta"><span>${esc(sale.customer_name || 'Walk-in customer')}</span><span>${sale.due > 0 ? 'CREDIT' : 'CASH'}</span></div>
      ${cancelled ? '<div class="stamp">CANCELLED</div>' : ''}
      <table><tbody>${rows}</tbody></table>
      <div class="tot">
        <div><span>Subtotal</span><span>${money(sale.subtotal)}</span></div>
        ${sale.discount > 0 ? `<div><span>Discount</span><span>- ${money(sale.discount)}</span></div>` : ''}
        <div class="grand"><span>TOTAL</span><span>${money(sale.total)}</span></div>
        <div><span>Received</span><span>${money(sale.paid)}</span></div>
        ${sale.due > 0 ? `<div class="due"><span>Remaining (Udhar)</span><span>${money(sale.due)}</span></div>` : ''}
        ${sale.customer_id && sale.customer_balance > 0 ? `<div><span>Total pending</span><span>${money(sale.customer_balance)}</span></div>` : ''}
      </div>
      ${sale.note ? `<div class="th-note">${esc(sale.note)}</div>` : ''}
      <div class="th-thanks">${esc(s.invoice_footer || 'Thank you for shopping with us!')}</div></div>`;
  }
  const rows = sale.items.map((i, n) => `<tr><td class="c">${n + 1}</td><td>${esc(i.name)}</td>
      <td class="r">${qty(i.qty)}</td><td class="r">${qty(i.price)}</td><td class="r"><b>${qty(i.total)}</b></td></tr>`).join('');
  const addr = [sale.customer_phone, sale.customer_address].filter(Boolean).join(' · ');
  return `<div class="inv ${paper}">
    ${shopHeader(s, 'INVOICE', sale.due > 0 ? 'Credit Memo' : 'Cash Memo')}
    <div class="inv-body">
      <div class="inv-boxes">
        <div class="inv-box"><div class="inv-k">Billed to</div><div class="inv-v">${esc(sale.customer_name || 'Walk-in customer')}</div>${addr ? `<div class="inv-s">${esc(addr)}</div>` : ''}</div>
        <div class="inv-box"><dl><dt>Bill No.</dt><dd><b>${esc(sale.invoice_no)}</b></dd><dt>Date</dt><dd>${esc(fmtDate(sale.date))}</dd>${sale.created_at ? `<dt>Time</dt><dd>${esc(timeOf(sale.created_at))}</dd>` : ''}</dl></div>
      </div>
      ${cancelled ? '<div class="stamp">CANCELLED</div>' : ''}
      <table class="inv-table"><thead><tr><th class="c">#</th><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="inv-foot">
        <div class="inv-words"><div class="inv-k">Amount in words</div><div>${esc(amountWords(sale.total))}</div>
          ${sale.note ? `<div class="inv-k" style="margin-top:8px">Note</div><div>${esc(sale.note)}</div>` : ''}</div>
        <div class="inv-totals">
          <div class="row"><span>Subtotal</span><span>${money(sale.subtotal)}</span></div>
          ${sale.discount > 0 ? `<div class="row"><span>Discount</span><span>- ${money(sale.discount)}</span></div>` : ''}
          <div class="row grand"><span>Total</span><span>${money(sale.total)}</span></div>
          <div class="row"><span>Received</span><span>${money(sale.paid)}</span></div>
          ${sale.due > 0 ? `<div class="row due"><span>Remaining (Udhaar)</span><span>${money(sale.due)}</span></div>` : ''}
          ${sale.customer_id && sale.customer_balance > 0 ? `<div class="row small"><span>Total pending (all bills)</span><span>${money(sale.customer_balance)}</span></div>` : ''}
        </div>
      </div>
      <div class="inv-thanks">${esc(s.invoice_footer || 'Thank you for shopping with us!')}</div>
      ${paper === 'a4' ? '<div class="inv-sign"><span>Customer signature</span><span>Authorised signature</span></div>' : ''}
    </div></div>`;
}

function statementHtml(led, s = App.settings) {
  const rows = led.entries.slice().reverse().map((e, n) => `<tr><td>${esc(fmtDate(e.date))}</td>
    <td>${esc(e.note || e.type)}</td><td class="r">${e.debit ? qty(e.debit) : ''}</td>
    <td class="r">${e.credit ? qty(e.credit) : ''}</td><td class="r"><b>${qty(e.balance)}</b></td></tr>`).join('');
  const c = led.customer;
  return `<div class="inv a4">${shopHeader(s, 'STATEMENT', 'Account of udhar')}
    <div class="inv-body">
      <div class="inv-boxes">
        <div class="inv-box"><div class="inv-k">Customer</div><div class="inv-v">${esc(c.name)}</div>${[c.phone, c.address].filter(Boolean).length ? `<div class="inv-s">${esc([c.phone, c.address].filter(Boolean).join(' · '))}</div>` : ''}</div>
        <div class="inv-box"><dl><dt>As of</dt><dd>${esc(fmtDate(today()))}</dd><dt>Entries</dt><dd>${led.entries.length}</dd></dl></div>
      </div>
      <table class="inv-table"><thead><tr><th>Date</th><th>Details</th><th class="r">Udhar</th><th class="r">Paid</th><th class="r">Balance</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="inv-foot"><div class="inv-words"><div class="inv-k">Amount in words</div><div>${esc(amountWords(Math.max(0, c.balance)))}</div></div>
        <div class="inv-totals"><div class="row grand ${c.balance > 0 ? 'due2' : ''}"><span>Balance due</span><span>${money(c.balance)}</span></div></div></div>
      <div class="inv-thanks">${esc(s.invoice_footer || 'Thank you!')}</div>
    </div></div>`;
}

/** Print the bill straight away on the paper the shop chose in Settings. */
function printSale(sale) { printHtml(invoiceHtml(sale), paperOf()); }

/** Preview of a bill with a paper-size picker and Print / Cancel-sale buttons. */
async function showInvoice(saleId, { onChange } = {}) {
  const sale = await rpc('getSale', saleId);
  let paper = paperOf();
  const draw = () => {
    $$('.paper-pick button', m.body).forEach((b) => b.classList.toggle('on', b.dataset.p === paper));
    $('.preview', m.body).innerHTML = invoiceHtml(sale, App.settings, paper);
    $('.preview', m.body).className = 'preview ' + paper;
  };
  const m = modal({
    title: `Print Bill ${sale.invoice_no}${sale.edited_at ? ' (edited)' : ''}`,
    wide: true,
    body: `<div class="paper-pick">${Object.keys(PAPERS).map((k) => `<button data-p="${k}">${esc(PAPERS[k].label)}</button>`).join('')}</div>
      <div class="preview-wrap"><div class="preview"></div></div>
      <p class="muted small" style="margin:10px 0 0">In the print window choose your printer. If the bill looks cut off, set Margins to “Default” and untick “Headers and footers”.</p>`,
    actions: [
      ...(sale.status === 'active' ? [{
        label: 'Edit bill', close: false,
        onClick: async () => {
          const prods = await rpc('listProducts', { limit: 5000 });
          App.cart = {
            items: sale.items.map((i) => { const p = prods.find((x) => x.id === i.product_id) || {}; return { product_id: i.product_id, name: i.name, qty: i.qty, price: i.price, stock: (p.stock || 0) + i.qty, unit: p.unit || '' }; }),
            customer_id: sale.customer_id ? String(sale.customer_id) : '', discount: sale.discount ? String(sale.discount) : '',
            paid: String(sale.paid), method: sale.method || 'cash', note: sale.note || '', date: sale.date,
            editing: { id: sale.id, invoice_no: sale.invoice_no },
          };
          while (modalStack.length) modalStack[modalStack.length - 1].close();
          if (onChange) onChange();
          App.go('sale');
        },
      }, {
        label: 'Cancel this sale', kind: 'danger', close: false,
        onClick: async () => {
          const reason = await askText({ title: 'Cancel sale', label: 'Why is this sale being cancelled?', okLabel: 'Cancel sale' });
          if (!reason) return false;
          await rpc('cancelSale', sale.id, reason);
          toast('Sale cancelled. Stock and udhar were restored.', 'ok');
          m.close();
          if (onChange) onChange();
        },
      }] : []),
      { label: 'Close' },
      { label: 'Print', kind: 'primary', close: false, onClick: () => printHtml(invoiceHtml(sale, App.settings, paper), paper) },
    ],
  });
  m.body.addEventListener('click', async (e) => {
    const b = e.target.closest('.paper-pick button');
    if (!b) return;
    paper = b.dataset.p;
    draw();
    try { App.settings = await rpc('saveSettings', { print_format: paper }); } catch (_) { /* choice just is not remembered */ }
  });
  draw();
  return m;
}

const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  sale: '<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>',
  sales: '<path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 1 .7V2z"/><path d="M8 8h8M8 12h8"/>',
  products: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  customers: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  reports: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  rupee: '<path d="M6 3h12M6 8h12M9 13h3a4 4 0 0 0 0-8M9 13l6 8"/>',
  wallet: '<path d="M20 12V8a2 2 0 0 0-2-2H5a2 2 0 0 1 0-4h13"/><path d="M3 5v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-4"/><path d="M17 12h5v4h-5a2 2 0 0 1 0-4z"/>',
  trend: '<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>',
  alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
};
