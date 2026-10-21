'use strict';
/* Maal Entry: write down what you buy at the wholesale market (works with no internet),
   then send it to the shop laptop as one message. */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const money = (n) => 'Rs ' + fmt(n);
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const nice = (s) => { const [y, m, d] = s.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const num = (s) => { const n = Number(String(s).replace(/,/g, '').trim()); return s !== '' && Number.isFinite(n) ? n : NaN; };
  const rid = () => {
    const a = new Uint8Array(9);
    (self.crypto || {}).getRandomValues ? self.crypto.getRandomValues(a) : a.forEach((_, i) => (a[i] = Math.random() * 256));
    return 'b-' + Array.from(a, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 14);
  };

  // ------------------------------------------------------------------ saved data (on this phone)
  const KEY = 'crockery.maal.v1';
  let saveOk = true;
  function load() {
    try {
      const o = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (o && Array.isArray(o.batches)) return { batches: o.batches, currentId: o.currentId || null, suppliers: o.suppliers || [], products: o.products || null };
    } catch (e) { /* first run or storage blocked */ }
    return { batches: [], currentId: null, suppliers: [], products: null };
  }
  let data = load();
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); saveOk = true; } catch (e) { saveOk = false; }
    banner();
  }
  function banner() {
    const b = $('#banner');
    b.hidden = saveOk;
    b.textContent = 'Warning: this browser cannot save your list. Do not close the page, or send the list now.';
  }

  const current = () => data.batches.find((b) => b.id === data.currentId && !b.sentAt) || null;
  function ensureCurrent() {
    let b = current();
    if (!b) {
      b = { id: rid(), date: ymd(new Date()), supplier: data.suppliers[0] || '', lines: [], created: Date.now(), sentAt: null };
      data.batches.unshift(b);
      data.batches = data.batches.slice(0, 40);
      data.currentId = b.id;
      save();
    }
    return b;
  }
  const totals = (b) => ({
    items: b.lines.length,
    qty: b.lines.reduce((s, l) => s + l.q, 0),
    amount: b.lines.reduce((s, l) => s + l.q * l.c, 0),
  });

  // ------------------------------------------------------------------ small UI helpers
  let toastTimer;
  function toast(msg, err) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (err ? ' err' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, err ? 4500 : 2200);
  }
  function sheet(title, html) {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><header><h2>${esc(title)}</h2><button aria-label="Close">×</button></header><div class="body">${html}</div></div>`;
    const close = () => wrap.remove();
    $('header button', wrap).addEventListener('click', close);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    $('#sheets').append(wrap);
    return { el: $('.body', wrap), close };
  }

  // ------------------------------------------------------------------ main screen
  function productNames() {
    const set = new Map();
    for (const p of (data.products && data.products.items) || []) set.set(norm(p.n), p.n);
    for (const b of data.batches) for (const l of b.lines) if (!set.has(norm(l.n))) set.set(norm(l.n), l.n);
    return [...set.values()].slice(0, 3000);
  }
  function knownProduct(name) {
    const n = norm(name);
    return n ? ((data.products && data.products.items) || []).find((p) => norm(p.n) === n || (p.k && norm(p.k) === n)) : null;
  }

  function renderFields() {
    const b = ensureCurrent();
    $('#supplier').value = b.supplier || '';
    $('#date').value = b.date;
    $('#suppliers').innerHTML = data.suppliers.map((s) => `<option value="${esc(s)}">`).join('');
    $('#plist').innerHTML = productNames().map((n) => `<option value="${esc(n)}">`).join('');
  }

  function renderLines() {
    const b = ensureCurrent();
    const t = totals(b);
    $('#count').textContent = t.items ? `${t.items} item${t.items === 1 ? '' : 's'}` : '';
    $('#lines').innerHTML = b.lines.length
      ? b.lines.map((l, i) => `<div class="line" data-i="${i}"><div class="main" data-edit="${i}"><div class="nm">${esc(l.n)}</div>
          <div class="calc">${fmt(l.q)} × ${fmt(l.c)}${l.s ? ` · sale ${fmt(l.s)}` : ''}</div></div>
          <div class="sum">${fmt(l.q * l.c)}</div><button class="x" data-del="${i}" aria-label="Remove">×</button></div>`).join('')
      : '<div class="empty">Nothing added yet.<br>Add each item you buy, one by one.</div>';
    $('#totalAmt').textContent = money(t.amount);
    $('#totalSub').textContent = t.items ? `${t.items} item${t.items === 1 ? '' : 's'} · ${fmt(t.qty)} pcs` : 'No items yet';
    $('#sendBtn').disabled = !t.items;
  }

  function updateAmt() {
    const q = num($('#qty').value);
    const c = num($('#cost').value);
    $('#amt').textContent = Number.isFinite(q) && Number.isFinite(c) ? `= ${money(q * c)}` : '';
  }
  function updateHint() {
    const p = knownProduct($('#name').value);
    const h = $('#hint');
    if (!p) { h.hidden = true; return; }
    h.hidden = false;
    h.textContent = `In your shop: cost ${fmt(p.c)} · sale price ${fmt(p.s)}`;
    if ($('#cost').value === '' && p.c) { $('#cost').value = String(p.c); updateAmt(); }
  }

  function addLine() {
    const b = ensureCurrent();
    const name = $('#name').value.trim();
    const q = num($('#qty').value);
    const c = num($('#cost').value);
    const sRaw = $('#sale').value.trim();
    const s = sRaw === '' ? null : num(sRaw);
    if (!name) return toast('Write the product name', true);
    if (!(q > 0)) return toast('Write how many pieces (more than 0)', true);
    if (!(c >= 0)) return toast('Write the cost price of one piece (0 if free)', true);
    if (s !== null && !(s >= 0)) return toast('Sale price is not a number', true);
    const line = { n: name, q, c };
    if (s !== null) line.s = s;
    b.lines.push(line);
    save();
    for (const id of ['name', 'qty', 'cost', 'sale']) $('#' + id).value = '';
    $('#more').open = false;
    updateAmt(); updateHint(); renderLines(); renderFields();
    $('#name').focus();
    toast('Added');
  }

  function editLine(i) {
    const b = ensureCurrent();
    const l = b.lines[i];
    if (!l) return;
    const s = sheet('Edit item', `
      <label class="f"><span>Product name</span><input id="e_n" type="text" value="${esc(l.n)}"></label>
      <div class="row2"><label class="f"><span>Quantity</span><input id="e_q" type="text" inputmode="decimal" value="${l.q}"></label>
      <label class="f"><span>Cost price (each)</span><input id="e_c" type="text" inputmode="decimal" value="${l.c}"></label></div>
      <label class="f"><span>Sale price (optional)</span><input id="e_s" type="text" inputmode="decimal" value="${l.s ?? ''}"></label>
      <button class="btn primary block" id="e_save">Save</button>`);
    $('#e_save', s.el).addEventListener('click', () => {
      const n = $('#e_n', s.el).value.trim();
      const q = num($('#e_q', s.el).value);
      const c = num($('#e_c', s.el).value);
      const sv = $('#e_s', s.el).value.trim();
      const sp = sv === '' ? null : num(sv);
      if (!n) return toast('Write the product name', true);
      if (!(q > 0)) return toast('Quantity must be more than 0', true);
      if (!(c >= 0)) return toast('Cost price is not a number', true);
      if (sp !== null && !(sp >= 0)) return toast('Sale price is not a number', true);
      l.n = n; l.q = q; l.c = c;
      if (sp === null) delete l.s; else l.s = sp;
      save(); renderLines(); renderFields(); s.close();
    });
  }

  // ------------------------------------------------------------------ sending
  function summaryText(b) {
    const t = totals(b);
    const lines = b.lines.map((l, i) => `${i + 1}. ${l.n} — ${fmt(l.q)} x ${fmt(l.c)} = ${fmt(l.q * l.c)}`);
    return [`Maal entry — ${nice(b.date)}`, b.supplier ? `Supplier: ${b.supplier}` : null, ...lines, `Total: ${fmt(t.qty)} pcs, ${money(t.amount)}`]
      .filter(Boolean).join('\n');
  }
  function packedText(b) {
    const payload = {
      v: 1, id: b.id, date: b.date, supplier: b.supplier || '',
      lines: b.lines.map((l) => (l.s !== undefined ? { n: l.n, q: l.q, c: l.c, s: l.s } : { n: l.n, q: l.q, c: l.c })),
    };
    return `${summaryText(b)}\n\n(Do not change anything below this line)\n${self.Packing.pack('CROCKERY-MAAL', payload)}`;
  }
  function markSent(b) {
    b.sentAt = Date.now();
    if (data.currentId === b.id) data.currentId = null;
    save(); renderFields(); renderLines();
  }

  function openSend(b) {
    if (!b.lines.length) return toast('Add at least one item first', true);
    const text = packedText(b);
    const canShare = typeof navigator.share === 'function';
    const s = sheet(b.sentAt ? 'Send again' : 'Send to laptop', `
      <p class="muted small" style="margin-top:0">Send this message to the shop (WhatsApp, SMS, email — anything). At the laptop, open the software → <b>Products &amp; Stock → Import from phone</b> and paste it.</p>
      <pre>${esc(summaryText(b))}</pre>
      ${canShare ? '<button class="btn primary block big" id="s_share">Send (WhatsApp etc.)</button>' : ''}
      <button class="btn block ${canShare ? '' : 'primary'}" id="s_copy">Copy message</button>
      <button class="btn block" id="s_file">Save as a file</button>
      <div id="s_done"></div>`);
    const offerDone = () => {
      if (b.sentAt) return;
      $('#s_done', s.el).innerHTML = '<button class="btn teal block" id="s_mark">I have sent it — start a new list</button>';
      $('#s_mark', s.el).addEventListener('click', () => { markSent(b); s.close(); toast('Saved in History. New list ready.'); });
    };
    if (canShare) {
      $('#s_share', s.el).addEventListener('click', async () => {
        try {
          await navigator.share({ title: 'Maal entry', text });
          if (!b.sentAt) markSent(b);
          s.close();
          toast('Shared. New list ready.');
        } catch (e) {
          if (e && e.name !== 'AbortError') { toast('Sharing did not work. Use "Copy message".', true); }
        }
      });
    }
    $('#s_copy', s.el).addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        toast('Copied. Paste it in WhatsApp.');
        offerDone();
      } catch (e) {
        $('#s_done', s.el).innerHTML = '<p class="small muted">Press and hold the box, choose Select all → Copy.</p><textarea id="s_ta" readonly></textarea>';
        const ta = $('#s_ta', s.el); ta.value = text; ta.focus(); ta.select();
        offerDone();
      }
    });
    $('#s_file', s.el).addEventListener('click', () => {
      const d = new Date();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      a.download = `maal-${ymd(d)}-${pad(d.getHours())}${pad(d.getMinutes())}.txt`;
      document.body.append(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      toast('File saved on your phone');
      offerDone();
    });
  }

  // ------------------------------------------------------------------ menu, history, product list, help
  function openMenu() {
    const s = sheet('Menu', `
      <button class="menu-item" id="m_hist">📋 Old lists (History)</button>
      <button class="menu-item" id="m_prod">📦 Product list from the laptop</button>
      <button class="menu-item" id="m_help">ℹ️ How it works / install</button>`);
    $('#m_hist', s.el).addEventListener('click', () => { s.close(); openHistory(); });
    $('#m_prod', s.el).addEventListener('click', () => { s.close(); openProducts(); });
    $('#m_help', s.el).addEventListener('click', () => { s.close(); openHelp(); });
  }

  function openHistory() {
    const rows = data.batches.filter((b) => b.lines.length);
    const s = sheet('Old lists', rows.length ? rows.map((b) => {
      const t = totals(b);
      return `<div class="item-row" data-id="${esc(b.id)}"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(nice(b.date))}${b.supplier ? ' · ' + esc(b.supplier) : ''}</b>
        <span class="chip ${b.sentAt ? 'sent' : ''}">${b.sentAt ? 'Sent' : 'Not sent'}</span></div>
        <div class="muted small">${t.items} items · ${fmt(t.qty)} pcs · ${money(t.amount)}</div></div>`;
    }).join('') : '<div class="empty">No lists yet.</div>');
    s.el.addEventListener('click', (e) => {
      const r = e.target.closest('[data-id]');
      if (r) { s.close(); openBatch(data.batches.find((b) => b.id === r.dataset.id)); }
    });
  }

  function openBatch(b) {
    if (!b) return;
    const s = sheet(`${nice(b.date)}${b.supplier ? ' · ' + b.supplier : ''}`, `
      ${b.lines.map((l) => `<div class="item-row"><b>${esc(l.n)}</b><div class="muted small">${fmt(l.q)} × ${fmt(l.c)} = ${fmt(l.q * l.c)}</div></div>`).join('')}
      <div class="item-row"><b>Total: ${money(totals(b).amount)}</b></div>
      <button class="btn primary block" id="b_send">${b.sentAt ? 'Send again' : 'Send to laptop'}</button>
      ${b.sentAt ? '<button class="btn block" id="b_copy">Copy to a new list</button>' : '<button class="btn block" id="b_cont">Continue editing this list</button>'}
      <button class="btn danger block" id="b_del">Delete this list</button>`);
    $('#b_send', s.el).addEventListener('click', () => { s.close(); openSend(b); });
    const cont = $('#b_cont', s.el);
    if (cont) cont.addEventListener('click', () => { data.currentId = b.id; save(); renderFields(); renderLines(); s.close(); });
    const copy = $('#b_copy', s.el);
    if (copy) copy.addEventListener('click', () => {
      const nb = { id: rid(), date: ymd(new Date()), supplier: b.supplier, lines: JSON.parse(JSON.stringify(b.lines)), created: Date.now(), sentAt: null };
      data.batches.unshift(nb); data.currentId = nb.id; save(); renderFields(); renderLines(); s.close(); toast('Copied to a new list');
    });
    $('#b_del', s.el).addEventListener('click', () => {
      if (!confirm('Delete this list from the phone?')) return;
      data.batches = data.batches.filter((x) => x.id !== b.id);
      if (data.currentId === b.id) data.currentId = null;
      save(); renderFields(); renderLines(); s.close();
    });
  }

  function openProducts() {
    const p = data.products;
    const s = sheet('Product list', `
      <p class="muted small" style="margin-top:0">Optional. It lets the phone suggest your shop's product names while you type, so names match at the laptop.
      At the laptop: <b>Products &amp; Stock → Product list for phone</b>, then send yourself the message and paste it here.</p>
      <div class="item-row">${p ? `<b>${p.count} products loaded</b><div class="muted small">${esc(nice(ymd(new Date(p.loadedAt))))}</div>` : 'No list loaded yet.'}</div>
      <label class="f"><span>Paste the message here</span><textarea id="p_text" placeholder="CROCKERY-PRODUCTS:..."></textarea></label>
      <label class="f"><span>…or choose the saved file</span><input id="p_file" type="file" accept=".txt,.json,text/plain"></label>
      <button class="btn primary block" id="p_load">Load list</button>
      ${p ? '<button class="btn danger block" id="p_clear">Remove list</button>' : ''}`);
    $('#p_file', s.el).addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (f) $('#p_text', s.el).value = await f.text();
    });
    $('#p_load', s.el).addEventListener('click', () => {
      try {
        const obj = self.Packing.unpack($('#p_text', s.el).value, 'CROCKERY-PRODUCTS');
        if (!obj || !Array.isArray(obj.items)) throw new Error('This is not a product list');
        const items = obj.items.filter((x) => x && typeof x.n === 'string').slice(0, 5000)
          .map((x) => ({ n: String(x.n).slice(0, 200), k: String(x.k || '').slice(0, 60), c: Number(x.c) || 0, s: Number(x.s) || 0 }));
        data.products = { items, loadedAt: Date.now(), count: items.length };
        save(); renderFields(); s.close(); toast(`${items.length} products loaded`);
      } catch (e) { toast(e.message, true); }
    });
    const clr = $('#p_clear', s.el);
    if (clr) clr.addEventListener('click', () => { data.products = null; save(); renderFields(); s.close(); });
  }

  function openHelp() {
    sheet('How it works', `
      <ol class="steps">
        <li>At the wholesale market, add each item you buy: name, how many, cost price. <b>No internet needed.</b></li>
        <li>When you finish, tap <b>Send to laptop</b> and send the message by WhatsApp.</li>
        <li>At the shop laptop: <b>Products &amp; Stock → Import from phone</b>, paste the message, check, and press Import. Your stock goes up.</li>
      </ol>
      <p class="muted small">Your lists are saved on this phone. Do not clear the browser's data. A list can be imported only once, so sending it twice is safe.</p>
      <p><b>Put the icon on your home screen:</b> in Chrome tap ⋮ → <b>Add to Home screen</b> (or <b>Install app</b>).</p>`);
  }

  // ------------------------------------------------------------------ start
  function setStatus() {
    const s = $('#status');
    const off = !navigator.onLine;
    s.className = 'sub ' + (off ? 'off' : 'ok');
    s.textContent = off ? 'Offline: your list is saved on this phone' : (offlineReady ? 'Ready to work without internet' : 'Wholesale purchase list');
  }
  let offlineReady = false;

  function init() {
    banner();
    renderFields();
    renderLines();
    updateAmt();
    setStatus();
    $('#supplier').addEventListener('input', () => {
      const b = ensureCurrent();
      b.supplier = $('#supplier').value.trim();
      if (b.supplier) data.suppliers = [b.supplier, ...data.suppliers.filter((x) => x !== b.supplier)].slice(0, 20);
      save();
    });
    $('#date').addEventListener('change', () => { const b = ensureCurrent(); b.date = $('#date').value || ymd(new Date()); save(); });
    $('#name').addEventListener('input', updateHint);
    $('#name').addEventListener('change', updateHint);
    $('#qty').addEventListener('input', updateAmt);
    $('#cost').addEventListener('input', updateAmt);
    $('#addBtn').addEventListener('click', addLine);
    for (const id of ['qty', 'cost', 'sale']) $('#' + id).addEventListener('keydown', (e) => { if (e.key === 'Enter') addLine(); });
    $('#lines').addEventListener('click', (e) => {
      const d = e.target.closest('[data-del]');
      if (d) {
        const b = ensureCurrent();
        const l = b.lines[Number(d.dataset.del)];
        if (l && confirm(`Remove "${l.n}"?`)) { b.lines.splice(Number(d.dataset.del), 1); save(); renderLines(); }
        return;
      }
      const ed = e.target.closest('[data-edit]');
      if (ed) editLine(Number(ed.dataset.edit));
    });
    $('#sendBtn').addEventListener('click', () => openSend(ensureCurrent()));
    $('#menuBtn').addEventListener('click', openMenu);
    window.addEventListener('online', setStatus);
    window.addEventListener('offline', setStatus);
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js')
        .then(() => navigator.serviceWorker.ready)
        .then(() => { offlineReady = true; setStatus(); })
        .catch(() => { /* works online only */ });
    }
    window.__maalReady = true;
  }
  init();
})();
