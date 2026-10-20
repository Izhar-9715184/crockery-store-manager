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

function printHtml(html) {
  const area = $('#print-area');
  area.innerHTML = html;
  const clear = () => { area.innerHTML = ''; window.removeEventListener('afterprint', clear); };
  window.addEventListener('afterprint', clear);
  setTimeout(() => window.print(), 50);
}

function shopHeader(s) {
  return `<h2>${esc(s.shop_name)}</h2>
    <div class="center">${esc(s.shop_address || '')}${s.shop_phone ? `<br>Phone: ${esc(s.shop_phone)}` : ''}</div>`;
}

function invoiceHtml(sale, s = App.settings) {
  const thermal = s.print_format === 'thermal';
  const rows = sale.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="r">${qty(i.qty)}</td>
      <td class="r">${qty(i.price)}</td><td class="r">${qty(i.total)}</td></tr>`).join('');
  return `<div class="invoice ${thermal ? 'thermal' : ''}">
    ${shopHeader(s)}
    <div class="meta"><div><b>Invoice:</b> ${esc(sale.invoice_no)}<br><b>Date:</b> ${esc(fmtDate(sale.date))}</div>
      <div style="text-align:right"><b>Customer:</b> ${esc(sale.customer_name || 'Walk-in')}${sale.customer_phone ? `<br>${esc(sale.customer_phone)}` : ''}</div></div>
    ${sale.status === 'cancelled' ? '<div class="stamp">CANCELLED</div>' : ''}
    <table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="tot">
      <div><span>Subtotal</span><span>${money(sale.subtotal)}</span></div>
      ${sale.discount > 0 ? `<div><span>Discount</span><span>- ${money(sale.discount)}</span></div>` : ''}
      <div class="grand"><span>Total</span><span>${money(sale.total)}</span></div>
      <div><span>Received</span><span>${money(sale.paid)}</span></div>
      ${sale.due > 0 ? `<div><b>Balance (Udhar)</b><b>${money(sale.due)}</b></div>` : ''}
      ${sale.customer_id && sale.customer_balance > 0 ? `<div><span>Total udhar of customer</span><span>${money(sale.customer_balance)}</span></div>` : ''}
    </div>
    ${sale.note ? `<p><b>Note:</b> ${esc(sale.note)}</p>` : ''}
    <p class="center" style="margin-top:14px">${esc(s.invoice_footer || '')}</p>
  </div>`;
}

function statementHtml(led, s = App.settings) {
  const rows = led.entries.slice().reverse().map((e) => `<tr><td>${esc(fmtDate(e.date))}</td>
    <td>${esc(e.note || e.type)}</td><td class="r">${e.debit ? qty(e.debit) : ''}</td>
    <td class="r">${e.credit ? qty(e.credit) : ''}</td><td class="r">${qty(e.balance)}</td></tr>`).join('');
  return `<div class="invoice">${shopHeader(s)}
    <h2 style="font-size:16px;margin:12px 0 2px">Account statement</h2>
    <div class="center">${esc(led.customer.name)} ${led.customer.phone ? '· ' + esc(led.customer.phone) : ''}<br>As of ${esc(fmtDate(today()))}</div>
    <table><thead><tr><th>Date</th><th>Details</th><th class="r">Udhar</th><th class="r">Paid</th><th class="r">Balance</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="tot"><div class="grand"><span>Balance due</span><span>${money(led.customer.balance)}</span></div></div></div>`;
}

/** Shows an invoice in a window with Print / Cancel buttons. */
async function showInvoice(saleId, { onChange } = {}) {
  const sale = await rpc('getSale', saleId);
  const m = modal({
    title: `Invoice ${sale.invoice_no}`,
    wide: true,
    body: `<div style="max-width:720px;margin:0 auto">${invoiceHtml(sale)}</div>`,
    actions: [
      ...(sale.status === 'active' ? [{
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
      { label: 'Print', kind: 'primary', close: false, onClick: () => printHtml(invoiceHtml(sale)) },
    ],
  });
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
};
