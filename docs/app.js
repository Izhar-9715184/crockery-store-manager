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
  const GRADS = [['#5b34e6', '#c026d3'], ['#0b8f78', '#2fd6a8'], ['#d8285c', '#ff8a5b'], ['#2563eb', '#22d3ee'], ['#e08a00', '#ffcf4d'], ['#7c3aed', '#f472b6']];
  const grad = (name) => { let h = 0; for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; const g = GRADS[h % GRADS.length]; return `linear-gradient(135deg, ${g[0]}, ${g[1]})`; };
  const ini = (name) => esc((String(name).trim().match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase());
  const avatar = (name) => `<div class="av" style="background:${grad(name)}">${ini(name)}</div>`;
  const CUP = '<svg viewBox="0 0 80 80" fill="none" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="38" cy="66" rx="26" ry="5" fill="#8a7fd0" fill-opacity=".18"/><path d="M14 30h48c0 18-6 30-24 30S14 48 14 30z" fill="#fff" stroke="#6b4de0" stroke-width="3"/><path d="M62 35c9-1 11 12 1 15" stroke="#6b4de0" stroke-width="3"/><path d="M20 38h36" stroke="#ff6a3d" stroke-width="3"/><path d="M28 16c-3 3 3 5 0 9M38 14c-3 3 3 5 0 9M48 16c-3 3 3 5 0 9" stroke="#b02cc9" stroke-width="2.5"/></svg>';
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
      if (o && Array.isArray(o.batches)) return { batches: o.batches, currentId: o.currentId || null, suppliers: o.suppliers || [], products: o.products || null, sync: o.sync || null, udhar: o.udhar || null, karz: o.karz || null, pays: Array.isArray(o.pays) ? o.pays : [], spays: Array.isArray(o.spays) ? o.spays : [], sups: Array.isArray(o.sups) ? o.sups : [], custAll: Array.isArray(o.custAll) ? o.custAll : [], bills: Array.isArray(o.bills) ? o.bills : [], cart: o.cart || null };
    } catch (e) { /* first run or storage blocked */ }
    return { batches: [], currentId: null, suppliers: [], products: null, sync: null, udhar: null, karz: null, pays: [], spays: [], sups: [], custAll: [], bills: [], cart: null };
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

  // lists sent online but not yet counted by the laptop: show them as "coming" so the number is right at once
  function comingFor(p) {
    const done = new Set((data.products && data.products.imported) || []);
    const billed = new Set((data.products && data.products.billsDone) || []);
    const n = norm(p.n);
    let q = 0;
    for (const b of data.batches) {
      if (!b.online || done.has(b.id)) continue;
      for (const l of b.lines) if (norm(l.n) === n) q += l.q;
    }
    for (const bl of data.bills) {                                   // bills written on this phone, not yet counted by the laptop
      if (billed.has(bl.id)) continue;
      for (const l of bl.lines) if ((l.p && p.i && l.p === p.i) || norm(l.n) === n) q -= l.q;
    }
    return q;
  }
  const comingText = (c) => (c > 0 ? `+ ${fmt(c)} bought, on its way to the laptop` : `− ${fmt(-c)} sold from this phone`);
  const stockText = (p) => (p.q === undefined ? 'stock unknown' : (p.q + comingFor(p)) <= 0 ? 'stock 0 (out)' : `stock ${fmt(p.q)}${p.u ? ' ' + p.u : ''}${comingFor(p) ? ' ' + comingText(comingFor(p)) : ''}`);
  const stockAge = () => {
    const pr = data.products;
    if (!pr) return '';
    if (pr.ts) { const d = new Date(pr.ts); return `Stock as of ${nice(ymd(d))}, ${pad(d.getHours())}:${pad(d.getMinutes())}`; }
    return pr.at ? `Stock as of ${nice(pr.at)}` : `Loaded ${nice(ymd(new Date(pr.loadedAt)))}`;
  };

  // ---- online stock: the laptop keeps a locked copy in a secret GitHub Gist; the phone reads it
  const GIST_API = 'https://api.github.com/gists/';
  let syncMsg = '';
  function readSyncLink() {
    const m = /[#&]sync=([0-9a-f]{20,40})\.([a-z0-9]{6,32})/i.exec(location.hash || '');
    if (!m) return false;
    const k = /[#&]key=([A-Za-z0-9_]{20,120})/.exec(location.hash || '');
    data.sync = { id: m[1], pass: m[2], key: k ? k[1] : '' };
    save();
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
    return true;
  }
  async function fetchOnline(showErr) {
    if (!data.sync) return false;
    if (!navigator.onLine) { syncMsg = 'Offline — showing the last copy saved on this phone'; return false; }
    try {
      const r = await fetch(GIST_API + data.sync.id, { cache: 'no-store', headers: { Accept: 'application/vnd.github+json' } });
      if (!r.ok) throw new Error(r.status === 404 ? 'The online copy was not found. Ask for a new link from the laptop.' : r.status === 403 ? 'Too many tries. Wait a little and try again.' : 'Could not reach the online copy');
      const g = await r.json();
      const f = g.files && (g.files['stock.json'] || Object.values(g.files)[0]);
      if (!f) throw new Error('The online copy is empty');
      let text = f.content;
      if (f.truncated && f.raw_url) text = await (await fetch(f.raw_url, { cache: 'no-store' })).text();
      const obj = await self.StockCrypto.decrypt(text, data.sync.pass);
      if (!obj || !Array.isArray(obj.items)) throw new Error('The online copy is not a stock list');
      const items = obj.items.slice(0, 5000).map((x) => {
        const o = { i: Number(x.i) || 0, n: String(x.n).slice(0, 200), k: String(x.k || '').slice(0, 60), c: Number(x.c) || 0, s: Number(x.s) || 0 };
        if (x.q !== undefined && Number.isFinite(Number(x.q))) { o.q = Number(x.q); o.u = String(x.u || '').slice(0, 20); }
        return o;
      });
      data.products = { items, loadedAt: Date.now(), count: items.length, at: obj.at || null, ts: obj.ts || null, shop: obj.shop || '', imported: Array.isArray(obj.imported) ? obj.imported.slice(0, 400) : [], billsDone: Array.isArray(obj.billsDone) ? obj.billsDone.slice(0, 400) : [], paysDone: Array.isArray(obj.paysDone) ? obj.paysDone.slice(0, 400) : [], spaysDone: Array.isArray(obj.spaysDone) ? obj.spaysDone.slice(0, 400) : [] };
      data.custAll = Array.isArray(obj.custAll) ? obj.custAll.slice(0, 1500).map((c) => ({ i: Number(c.i), n: String(c.n).slice(0, 120), p: String(c.p || '').slice(0, 30), b: c.b === undefined ? null : Number(c.b) })) : [];
      data.udhar = Array.isArray(obj.cust) ? { list: obj.cust.slice(0, 400), ts: obj.ts || null } : null;
      data.karz = Array.isArray(obj.karz) ? { list: obj.karz.slice(0, 300), ts: obj.ts || null } : null;
      data.sups = Array.isArray(obj.sups) ? obj.sups.slice(0, 300).map((x) => String(x).slice(0, 100)) : [];
      data.pays = (data.pays || []).filter((x) => x.status === 'pending' || !(data.products.paysDone || []).includes(x.id) || Date.now() - x.at < 3 * 86400000).slice(0, 60);
      data.spays = (data.spays || []).filter((x) => x.status === 'pending' || !(data.products.spaysDone || []).includes(x.id) || Date.now() - x.at < 3 * 86400000).slice(0, 60);
      data.bills = data.bills.filter((bl) => bl.status === 'pending' || !(data.products.billsDone || []).includes(bl.id) || Date.now() - bl.at < 3 * 86400000).slice(0, 30);
      save(); renderFields(); updateHint(); renderStock(); renderUdhar(); renderKarz(); renderBill();
      syncMsg = `Updated online · ${items.length} products`;
      return true;
    } catch (e) {
      syncMsg = e.message || 'Could not update';
      if (showErr) toast(syncMsg, true);
      return false;
    }
  }

  function renderFields() {
    const b = ensureCurrent();
    $('#supplier').value = b.supplier || '';
    $('#date').value = b.date;
    const allSup = [...data.suppliers, ...(data.sups || []).filter((x) => !data.suppliers.some((y) => y.toLowerCase() === x.toLowerCase()))];
    $('#suppliers').innerHTML = allSup.map((s) => `<option value="${esc(s)}">`).join('');
    renderPay(b);
    $('#plist').innerHTML = productNames().map((n) => `<option value="${esc(n)}">`).join('');
  }

  let popIdx = -1;
  function renderLines() {
    const b = ensureCurrent();
    const t = totals(b);
    $('#count').textContent = t.items ? `${t.items} item${t.items === 1 ? '' : 's'}` : '';
    $('#lines').innerHTML = b.lines.length
      ? b.lines.map((l, i) => `<div class="line${popIdx === i ? ' pop' : ''}" data-i="${i}">${avatar(l.n)}<div class="main" data-edit="${i}"><div class="nm">${esc(l.n)}</div>
          <div class="calc">${fmt(l.q)}${uSfx(l)} × ${fmt(l.c)}${l.s ? ` · sale ${fmt(l.s)}` : ''}</div></div>
          <div class="sum">${fmt(l.q * l.c)}</div><button class="x" data-del="${i}" aria-label="Remove">×</button></div>`).join('')
      : `<div class="empty">${CUP}<b>Nothing added yet</b><br>Add each item you buy, one by one.</div>`;
    popIdx = -1;
    renderPay(b);
    $('#totalAmt').textContent = money(t.amount);
    $('#totalSub').textContent = t.items ? `${t.items} item${t.items === 1 ? '' : 's'} · ${fmt(t.qty)} pcs` : 'No items yet';
    $('#sendBtn').disabled = !t.items;
    const hr = new Date().getHours();
    $('#heroKick').textContent = data.products && data.products.shop ? `${hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening'}, ${data.products.shop}` : 'This purchase';
    $('#heroAmt').textContent = money(t.amount);
    $('#heroSub').textContent = t.items ? `${t.items} item${t.items === 1 ? '' : 's'} · ${fmt(t.qty)} pcs${b.supplier ? ' · ' + b.supplier : ''}` : 'Add what you buy, one by one';
  }

  function updateAmt() {
    const q = num($('#qty').value);
    const c = num($('#cost').value);
    $('#amt').textContent = Number.isFinite(q) && Number.isFinite(c) ? `= ${money(q * c)}` : '';
  }
  const unitOf = (l) => { const it = ((data.products && data.products.items) || []).find((p) => (l.p && p.i === l.p) || norm(p.n) === norm(l.n)); return (it && it.u) || l.u || 'pcs'; };
  const uSfx = (l) => { const u = unitOf(l); return u === 'pcs' ? '' : ' ' + u; };
  function updateHint() {
    const p = knownProduct($('#name').value);
    const h = $('#hint');
    const un = p ? (p.u || 'pcs') : ($('#unit').value || 'pcs');
    $('#unitRow').hidden = !!p;
    $('#qtyLbl').textContent = un === 'pcs' ? 'Quantity' : `Quantity (${un})`;
    $('#costLbl').textContent = un === 'pcs' ? 'Cost price (each)' : `Cost price (per ${un})`;
    if (!p) { h.hidden = true; return; }
    h.hidden = false;
    h.textContent = `In your shop: ${stockText(p)} · cost ${fmt(p.c)} · sale price ${fmt(p.s)}`;
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
    const kp = knownProduct(name);
    const line = { n: name, q, c };
    if (!kp && $('#unit').value && $('#unit').value !== 'pcs') line.u = $('#unit').value;
    if (s !== null) line.s = s;
    b.lines.push(line);
    popIdx = b.lines.length - 1;
    try { navigator.vibrate && navigator.vibrate(12); } catch (e) { /* ignore */ }
    save();
    for (const id of ['name', 'qty', 'cost', 'sale']) $('#' + id).value = '';
    $('#unit').value = 'pcs';
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
  /** How much of this purchase was paid at once. undefined = no wholesaler, so karz is not tracked. */
  function payAmount(b) {
    if (!b.supplier) return undefined;
    const t = totals(b).amount;
    const mode = b.pay || 'karz';
    return mode === 'paid' ? t : mode === 'part' ? Math.min(Math.max(num(b.paid) || 0, 0), t) : 0;
  }
  function renderPay(b) {
    const box = $('#payBox');
    box.hidden = !b.supplier;
    if (!b.supplier) return;
    const mode = b.pay || 'karz';
    document.querySelectorAll('#paySeg button').forEach((x) => x.classList.toggle('on', x.dataset.m === mode));
    $('#paidWrap').hidden = mode !== 'part';
    if (document.activeElement !== $('#paidNow')) $('#paidNow').value = b.paid || '';
    const t = totals(b).amount;
    const paid = payAmount(b);
    $('#payInfo').innerHTML = t ? (paid >= t ? 'Fully paid — no karz.' : `Karz to <b>${esc(b.supplier)}</b>: <b class="red">${money(t - paid)}</b>`) : 'Karz is worked out when you add items.';
  }
  function summaryText(b) {
    const _p = payAmount(b), _t = totals(b).amount;
    const t = totals(b);
    const lines = b.lines.map((l, i) => `${i + 1}. ${l.n} — ${fmt(l.q)}${uSfx(l)} x ${fmt(l.c)} = ${fmt(l.q * l.c)}`);
    return [`Maal entry — ${nice(b.date)}`, b.supplier ? `Supplier: ${b.supplier}` : null, ...lines, `Total: ${fmt(t.qty)} pcs, ${money(t.amount)}`, _p === undefined ? null : (_p >= _t ? 'Paid in full' : `Paid ${money(_p)}, karz ${money(_t - _p)}`)]
      .filter(Boolean).join('\n');
  }
  function packedText(b) {
    const payload = {
      v: 1, id: b.id, date: b.date, supplier: b.supplier || '', ...(payAmount(b) === undefined ? {} : { paid: payAmount(b) }),
      lines: b.lines.map((l) => (l.s !== undefined ? { n: l.n, q: l.q, c: l.c, s: l.s, ...(l.u ? { u: l.u } : {}) } : { n: l.n, q: l.q, c: l.c, ...(l.u ? { u: l.u } : {}) })),
    };
    return `${summaryText(b)}\n\n(Do not change anything below this line)\n${self.Packing.pack('CROCKERY-MAAL', payload)}`;
  }
  function markSent(b) {
    b.sentAt = Date.now();
    if (data.currentId === b.id) data.currentId = null;
    save(); renderFields(); renderLines();
  }

  /** Sends the finished list online; the laptop adds it to the stock by itself. */
  async function uploadBatch(b) {
    if (!data.sync || !data.sync.key) throw new Error('This phone is not connected for sending. Open the link from the laptop again.');
    if (!navigator.onLine) throw new Error('No internet. Use "Copy message" or try again later.');
    const payload = { v: 1, id: b.id, date: b.date, supplier: b.supplier || '', ...(payAmount(b) === undefined ? {} : { paid: payAmount(b) }),
      lines: b.lines.map((l) => (l.s !== undefined ? { n: l.n, q: l.q, c: l.c, s: l.s, ...(l.u ? { u: l.u } : {}) } : { n: l.n, q: l.q, c: l.c, ...(l.u ? { u: l.u } : {}) })) };
    const content = await self.StockCrypto.encrypt(payload, data.sync.pass);
    const r = await fetch(GIST_API + data.sync.id, { method: 'PATCH', headers: { Authorization: 'Bearer ' + data.sync.key, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: { ['maal-' + b.id + '.json']: { content } } }) });
    if (!r.ok) throw new Error(r.status === 401 ? 'The key in the link is not accepted. Open a fresh link from the laptop.' : `Could not send (${r.status}). Try again.`);
    b.online = true;
    if (!b.sentAt) b.sentAt = Date.now();
    if (data.currentId === b.id) data.currentId = null;
    save(); renderFields(); renderLines();
  }

  function openSend(b) {
    if (!b.lines.length) return toast('Add at least one item first', true);
    const text = packedText(b);
    const canShare = typeof navigator.share === 'function';
    const s = sheet(b.sentAt ? 'Send again' : 'Send to laptop', `
      <p class="muted small" style="margin-top:0">${data.sync && data.sync.key ? '<b>Best:</b> press "Send online". The laptop adds it to the stock by itself. Or send the message by WhatsApp as before.' : ''} Send this message to the shop (WhatsApp, SMS, email — anything). At the laptop, open the software → <b>Products &amp; Stock → Import from phone</b> and paste it.</p>
      <pre>${esc(summaryText(b))}</pre>
      ${data.sync && data.sync.key ? `<button class="btn primary block big" id="s_online">${b.online ? 'Send online again' : 'Send online — stock updates by itself'}</button>` : ''}
      ${canShare ? '<button class="btn block" id="s_share">Send (WhatsApp etc.)</button>' : ''}
      <button class="btn block" id="s_copy">Copy message</button>
      <button class="btn block" id="s_file">Save as a file</button>
      <div id="s_done"></div>`);
    const offerDone = () => {
      if (b.sentAt) return;
      $('#s_done', s.el).innerHTML = '<button class="btn teal block" id="s_mark">I have sent it — start a new list</button>';
      $('#s_mark', s.el).addEventListener('click', () => { markSent(b); s.close(); toast('Saved in History. New list ready.'); });
    };
    const onl = $('#s_online', s.el);
    if (onl) onl.addEventListener('click', async () => {
      onl.disabled = true;
      try { await uploadBatch(b); s.close(); toast('Sent online. The laptop will add it to the stock.'); }
      catch (e) { onl.disabled = false; toast(e.message, true); }
    });
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
  const PAGE_VERSION = 'v1.1.9';   // shown in the menu so you can tell which page this phone has
  const drawerOpen = (on) => {
    $('#drawerWrap').hidden = !on;
    $('#menuBtn').setAttribute('aria-expanded', on ? 'true' : 'false');
  };
  function openMenu() {
    $('#dr_shop').textContent = (data.products && data.products.shop) || 'My Shop';
    $('#dr_ver').textContent = 'Page version ' + PAGE_VERSION;
    const ub = $('#dg_udhar'), kb = $('#dg_karz');
    const ut = data.udhar ? data.udhar.list.reduce((t, c) => t + owedNow(c), 0) : 0;
    const kt = data.karz ? data.karz.list.reduce((t, c) => t + owedKarz(c), 0) : 0;
    ub.hidden = !ut; ub.textContent = short(ut); kb.hidden = !kt; kb.textContent = short(kt);
    document.querySelectorAll('.dr-item[data-tab]').forEach((x) => x.classList.toggle('on', x.dataset.tab === tab));
    drawerOpen(true);
  }
  const short = (n) => (n >= 1e5 ? (n / 1e5).toFixed(n >= 1e6 ? 0 : 1).replace(/\.0$/, '') + 'L' : n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : fmt(n));
  async function getNewestPage() {
    try {
      const regs = navigator.serviceWorker ? await navigator.serviceWorker.getRegistrations() : [];
      for (const r of regs) await r.unregister();
      for (const k of await caches.keys()) await caches.delete(k);
    } catch (e) { /* reload anyway */ }
    location.reload();
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
      ${b.lines.map((l) => `<div class="item-row"><b>${esc(l.n)}</b><div class="muted small">${fmt(l.q)}${uSfx(l)} × ${fmt(l.c)} = ${fmt(l.q * l.c)}</div></div>`).join('')}
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

  function openOnline() {
    const linked = !!data.sync;
    const s = sheet('Online stock', `
      <p class="muted small" style="margin-top:0">The laptop keeps a locked copy of your stock online. This phone reads it by itself whenever it has internet, so you always see the stock the shop had when the laptop was last used.</p>
      <div class="item-row">${linked ? `<b>Connected</b><div class="muted small">${esc(stockAge() || 'Not downloaded yet')}</div><div class="muted small">${esc(syncMsg)}</div>` : '<b>Not connected</b><div class="muted small">At the laptop: Settings → Stock online for the phone → Copy link. Send the link to this phone and open it here.</div>'}</div>
      ${linked ? '<button class="btn primary block" id="o_now">Update now</button><button class="btn danger block" id="o_off">Disconnect this phone</button>'
        : '<label class="f"><span>Or paste the link here</span><input id="o_link" type="text" placeholder="https://…#sync=…" autocomplete="off"></label><button class="btn primary block" id="o_go">Connect</button>'}`);
    const now = $('#o_now', s.el);
    if (now) now.addEventListener('click', async () => { now.disabled = true; const ok = await fetchOnline(true); s.close(); if (ok) toast('Stock updated'); });
    const off = $('#o_off', s.el);
    if (off) off.addEventListener('click', () => { data.sync = null; save(); s.close(); toast('Disconnected'); });
    const go = $('#o_go', s.el);
    if (go) go.addEventListener('click', async () => {
      const val = $('#o_link', s.el).value;
      const m = /sync=([0-9a-f]{20,40})\.([a-z0-9]{6,32})/i.exec(val);
      if (!m) return toast('This is not a valid link', true);
      const k = /key=([A-Za-z0-9_]{20,120})/.exec(val);
      data.sync = { id: m[1], pass: m[2], key: k ? k[1] : '' }; save();
      go.disabled = true;
      const ok = await fetchOnline(true); s.close(); if (ok) toast('Connected. Stock loaded.');
    });
  }

  // ------------------------------------------------------------------ tabs: Maal / Stock / Udhar
  const TITLES = { maal: 'Maal entry', bill: 'New bill', stock: 'Stock', udhar: 'Customer udhar', karz: 'Wholesale karz' };
  let tab = 'maal';
  let stockFilter = 'all';
  function setTab(t) {
    tab = t;
    document.body.dataset.tab = t;
    try { document.querySelector('meta[name=theme-color]').content = { maal: '#4f2bd6', bill: '#1d4ed8', stock: '#055e4d', udhar: '#7c1236', karz: '#5c1130' }[t]; } catch (e) { /* ignore */ }
    for (const v of ['maal', 'bill', 'stock', 'udhar', 'karz']) $('#v-' + v).hidden = v !== t;
    document.querySelectorAll('.dr-item[data-tab]').forEach((x) => x.classList.toggle('on', x.dataset.tab === t));
    drawerOpen(false);
    $('#pageTitle').textContent = TITLES[t];
    $('#bar').hidden = t !== 'maal';
    $('#billBar').hidden = t !== 'bill';
    if (t === 'bill') renderBill();
    if (t === 'stock') renderStock();
    if (t === 'udhar') renderUdhar();
    if (t === 'karz') renderKarz();
    window.scrollTo(0, 0);
  }
  // ------------------------------------------------------------------ BILL: sell from the phone
  const newCart = () => ({ cid: 0, cn: '', lines: [], disc: '', paid: '', method: 'cash', note: '', date: ymd(new Date()) });
  const cart = () => (data.cart || (data.cart = newCart()));
  const cartCalc = () => {
    const c = cart();
    const sub = c.lines.reduce((s, l) => s + (num(String(l.q)) || 0) * (num(String(l.pr)) || 0), 0);
    const disc = Math.min(sub, Math.max(0, num(String(c.disc || 0)) || 0));
    const total = Math.max(0, sub - disc);
    const paid = c.paid === '' ? total : Math.min(total, Math.max(0, num(String(c.paid)) || 0));
    return { sub, disc, total, paid, due: Math.max(0, total - paid) };
  };
  const stockOf = (l) => {
    const it = ((data.products && data.products.items) || []).find((p) => (l.p && p.i === l.p) || norm(p.n) === norm(l.n));
    return it && it.q !== undefined ? it.q + comingFor(it) : null;
  };
  function renderBill() {
    const c = cart();
    const items = (data.products && data.products.items) || [];
    // customer chip
    $('#b_custName').textContent = c.cid ? c.cn : 'Walk-in customer';
    $('#b_custAv').textContent = (c.cid ? c.cn : 'W').trim().charAt(0).toUpperCase();
    $('#b_custAv').style.background = grad(c.cid ? c.cn : 'Walk-in');
    const cu = (data.custAll || []).find((x) => x.i === c.cid);
    $('#b_custSub').textContent = c.cid ? (cu && cu.b > 0 ? `Already owes Rs ${fmt(cu.b)}` : (cu && cu.p) || 'Tap to change') : 'Tap to choose a customer';
    // search results
    const q = norm($('#b_q').value);
    const res = items.filter((p) => !q || norm(p.n).includes(q) || norm(p.k).includes(q)).slice(0, q ? 12 : 8);
    $('#b_results').innerHTML = items.length ? res.map((p) => { const e = p.q === undefined ? null : p.q + comingFor(p); return `<button class="bres" data-add="${esc(p.n)}">${avatar(p.n)}<span class="bn"><b>${esc(p.n)}</b><small>Rs ${fmt(p.s)} · ${e === null ? 'stock ?' : e <= 0 ? 'out of stock' : fmt(e) + ' ' + esc(p.u || 'pcs')}</small></span><span class="plus">+</span></button>`; }).join('') || '<div class="muted small" style="padding:8px 2px">No product found.</div>'
      : `<div class="empty">${CUP}<b>No products on this phone</b><br>Connect the laptop first (⋮ → Online stock).</div>`;
    // lines
    $('#b_count').textContent = c.lines.length ? `${c.lines.length} item${c.lines.length === 1 ? '' : 's'}` : '';
    $('#b_lines').innerHTML = c.lines.length ? c.lines.map((l, i) => { const st = stockOf(l); const over = st !== null && (num(String(l.q)) || 0) > st;
      return `<div class="line bl" data-bi="${i}">${avatar(l.n)}<div class="main"><div class="nm">${esc(l.n)}</div>
        <div class="calc">${over ? `<span class="warn">only ${fmt(Math.max(0, st))} in stock</span>` : `Rs <input class="mini" data-f="pr" inputmode="decimal" value="${esc(l.pr)}">${uSfx(l) ? ' per' + uSfx(l) : ''}`}</div></div>
        <div class="stepper"><button data-step="-1" aria-label="Less">−</button><input class="mini q" data-f="q" inputmode="decimal" value="${esc(l.q)}"><button data-step="1" aria-label="More">+</button></div>
        <button class="x" data-bdel="${i}" aria-label="Remove">×</button></div>`; }).join('')
      : `<div class="empty">${CUP}<b>No items yet</b><br>Tap a product above to add it.</div>`;
    $('#b_pay').hidden = !c.lines.length;
    const k = cartCalc();
    $('#b_disc').value = c.disc; $('#b_paid').value = c.paid; $('#b_method').value = c.method; $('#b_date').value = c.date; $('#b_note').value = c.note;
    const sums = () => { const kk = cartCalc(); $('#b_total').textContent = money(kk.total); $('#b_due').textContent = money(kk.due); $('#b_due').className = kk.due > 0 ? 'red' : ''; $('#billHeroAmt').textContent = money(kk.total); $('#billBarAmt').textContent = money(kk.total);
      const n = cart().lines.length; $('#billHeroSub').textContent = n ? `${n} item${n === 1 ? '' : 's'}${kk.due > 0 ? ' · udhar ' + money(kk.due) : ''}${cart().cid ? ' · ' + cart().cn : ''}` : 'Choose a customer and add items'; $('#billBarSub').textContent = n ? `${n} item${n === 1 ? '' : 's'}${kk.due > 0 ? ' · udhar ' + money(kk.due) : ' · paid in full'}` : 'No items yet'; $('#billSend').disabled = !n; };
    sums();
    // recent bills
    const rec = data.bills.slice(0, 6);
    $('#b_recent').hidden = !rec.length;
    const billed = new Set((data.products && data.products.billsDone) || []);
    $('#b_recentList').innerHTML = rec.map((bl) => `<div class="item-row" data-rb="${esc(bl.id)}" style="display:flex;justify-content:space-between;gap:10px;align-items:center"><div><b>${esc(bl.cn || 'Walk-in')}</b><div class="muted small">${esc(nice(bl.date))} · Rs ${fmt(bl.total)}</div></div>
      <span class="chip ${billed.has(bl.id) ? 'sent' : ''}">${billed.has(bl.id) ? 'Billed ✓' : bl.status === 'pending' ? 'Waiting for internet' : 'Sent'}</span></div>`).join('');
    return sums;
  }
  function addToBill(name) {
    const p = ((data.products && data.products.items) || []).find((x) => x.n === name);
    if (!p) return;
    const c = cart();
    const line = c.lines.find((l) => (p.i && l.p === p.i) || norm(l.n) === norm(p.n));
    if (line) line.q = (num(String(line.q)) || 0) + 1; else c.lines.push({ p: p.i || 0, n: p.n, q: 1, pr: p.s });
    try { navigator.vibrate && navigator.vibrate(10); } catch (e) { /* ignore */ }
    save(); renderBill();
  }
  function pickCustomer() {
    const all = data.custAll || [];
    const s = sheet('Customer', `<input id="cu_q" type="search" placeholder="Search customer…" autocomplete="off" style="margin-bottom:10px">
      <button class="menu-item" data-walk>🚶 Walk-in customer (no name)</button><div id="cu_list"></div>`);
    const draw = () => {
      const q = norm($('#cu_q', s.el).value);
      $('#cu_list', s.el).innerHTML = all.filter((x) => !q || norm(x.n).includes(q) || String(x.p).includes(q)).slice(0, 60).map((x) => `<button class="pcard ccard" data-cid="${x.i}"><div class="top2"><div class="who">${avatar(x.n)}<div style="min-width:0"><div class="nm">${esc(x.n)}</div><div class="meta">${esc(x.p || 'no phone')}</div></div></div>${x.b > 0 ? `<div class="bal">${fmt(x.b)}<small>udhar</small></div>` : ''}</div></button>`).join('')
        || (all.length ? '<div class="empty">Nobody found.</div>' : '<div class="empty">No customers on this phone yet. Connect the laptop (⋮ → Online stock).</div>');
    };
    $('#cu_q', s.el).addEventListener('input', draw);
    s.el.addEventListener('click', (e) => {
      const w = e.target.closest('[data-walk]');
      const b = e.target.closest('[data-cid]');
      if (w) { cart().cid = 0; cart().cn = ''; }
      else if (b) { const x = all.find((y) => y.i === Number(b.dataset.cid)); cart().cid = x.i; cart().cn = x.n; }
      else return;
      save(); s.close(); renderBill();
    });
    draw();
  }
  function billText(bl) {
    const lines = bl.lines.map((l, i) => `${i + 1}. ${l.n} — ${fmt(l.q)}${uSfx(l)} x ${fmt(l.pr)}${uSfx(l) ? ' per' + uSfx(l) : ''} = ${fmt(l.q * l.pr)}`);
    const shop = (data.products && data.products.shop) || '';
    return [shop ? `*${shop}*` : null, `Bill — ${nice(bl.date)}`, bl.cn ? `Customer: ${bl.cn}` : null, ...lines, `Total: Rs ${fmt(bl.total)}`, `Received: Rs ${fmt(bl.paidAmt)}`, bl.due > 0 ? `Udhar: Rs ${fmt(bl.due)}` : 'Paid in full', 'Thank you!'].filter(Boolean).join('\n');
  }
  async function uploadBill(bl) {
    if (!data.sync || !data.sync.key) throw new Error('This phone is not connected for sending. Open the link from the laptop again.');
    if (!navigator.onLine) throw new Error('offline');
    const payload = { v: 1, id: bl.id, date: bl.date, cid: bl.cid || 0, cn: bl.cn || '', discount: bl.disc, paid: bl.paid, method: bl.method, note: bl.note,
      lines: bl.lines.map((l) => ({ p: l.p, n: l.n, q: l.q, pr: l.pr })) };
    const content = await self.StockCrypto.encrypt(payload, data.sync.pass);
    const r = await fetch(GIST_API + data.sync.id, { method: 'PATCH', headers: { Authorization: 'Bearer ' + data.sync.key, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: { ['bill-' + bl.id + '.json']: { content } } }) });
    if (!r.ok) throw new Error(r.status === 401 ? 'The key in the link is not accepted. Open a fresh link from the laptop.' : `Could not send (${r.status}). Try again.`);
    bl.status = 'sent';
    save();
  }
  async function uploadPay(py) {
    if (!data.sync || !data.sync.key) throw new Error('This phone is not connected for sending. Open the link from the laptop again.');
    if (!navigator.onLine) throw new Error('offline');
    const content = await self.StockCrypto.encrypt({ v: 1, id: py.id, date: py.date, cn: py.cn, amount: py.amount, method: py.method, note: py.note }, data.sync.pass);
    const r = await fetch(GIST_API + data.sync.id, { method: 'PATCH', headers: { Authorization: 'Bearer ' + data.sync.key, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: { ['pay-' + py.id + '.json']: { content } } }) });
    if (!r.ok) throw new Error(r.status === 401 ? 'The key in the link is not accepted. Open a fresh link from the laptop.' : `Could not send (${r.status}). Try again.`);
    py.status = 'sent';
    save();
  }
  /** Payments taken on this phone that the laptop has not counted yet (they are taken off the balance shown here). */
  const countedS = () => new Set((data.products && data.products.spaysDone) || []);
  const waitingSPays = (name) => (data.spays || []).filter((x) => !countedS().has(x.id) && x.cn.toLowerCase() === String(name).toLowerCase());
  const counted = () => new Set((data.products && data.products.paysDone) || []);
  const waitingPays = (name) => (data.pays || []).filter((x) => !counted().has(x.id) && (!name || x.cn.toLowerCase() === String(name).toLowerCase()));
  const owedNow = (c) => Math.max(0, +(c.b - waitingPays(c.n).reduce((s, x) => s + x.amount, 0)).toFixed(2));
  async function uploadSPay(py) {
    if (!data.sync || !data.sync.key) throw new Error('This phone is not connected for sending. Open the link from the laptop again.');
    if (!navigator.onLine) throw new Error('offline');
    const content = await self.StockCrypto.encrypt({ v: 1, id: py.id, date: py.date, sn: py.cn, amount: py.amount, method: py.method, note: py.note }, data.sync.pass);
    const r = await fetch(GIST_API + data.sync.id, { method: 'PATCH', headers: { Authorization: 'Bearer ' + data.sync.key, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: { ['sp-' + py.id + '.json']: { content } } }) });
    if (!r.ok) throw new Error(r.status === 401 ? 'The key in the link is not accepted. Open a fresh link from the laptop.' : `Could not send (${r.status}). Try again.`);
    py.status = 'sent';
    save();
  }
  async function sendPending() {
    for (const py of (data.spays || []).filter((x) => x.status === 'pending')) { try { await uploadSPay(py); } catch (e) { break; } }
    for (const py of (data.pays || []).filter((x) => x.status === 'pending')) { try { await uploadPay(py); } catch (e) { break; } }
    for (const bl of data.bills.filter((x) => x.status === 'pending')) { try { await uploadBill(bl); } catch (e) { break; } }
    renderBill(); renderStock();
  }
  async function sendBill() {
    const c = cart();
    const k = cartCalc();
    if (!c.lines.length) return toast('Add at least one item', true);
    for (const l of c.lines) {
      const q = num(String(l.q)); const pr = num(String(l.pr));
      if (!(q > 0)) return toast(`Quantity of ${l.n} must be more than 0`, true);
      if (!(pr >= 0)) return toast(`Price of ${l.n} is not a number`, true);
      const st = stockOf(l);
      if (st !== null && q > st) return toast(`Only ${fmt(Math.max(0, st))} of ${l.n} in stock`, true);
    }
    if (k.due > 0 && !c.cid) return toast('Choose a customer for an udhar bill', true);
    const bl = { id: 'bl-' + rid().slice(2), at: Date.now(), date: c.date || ymd(new Date()), cid: c.cid, cn: c.cn, disc: k.disc, paid: k.paid, paidAmt: k.paid, due: k.due, total: k.total,
      method: c.method, note: c.note.trim(), status: 'pending',
      lines: c.lines.map((l) => ({ p: l.p, n: l.n, q: num(String(l.q)), pr: num(String(l.pr)) })) };
    data.bills.unshift(bl);
    data.cart = null;
    save();
    let msg = 'Saved. It will be sent when the phone has internet.';
    try { await uploadBill(bl); msg = 'Sent. The laptop makes the bill by itself.'; } catch (e) { if (e.message !== 'offline') { msg = e.message; } }
    renderBill(); renderStock();
    openReceipt(bl, msg);
  }
  /** The receipt: picture on screen, then Share (WhatsApp) / Save picture / Save PDF. */
  function openReceipt(bl, msg) {
    const shop = (data.products && data.products.shop) || '';
    const canvas = self.Receipt.draw({ ...bl, lines: bl.lines.map((l) => ({ ...l, u: unitOf(l) })) }, shop);
    const s = sheet('Receipt', `<img id="rc_img" class="receipt-img" alt="Receipt" src="${canvas.toDataURL('image/png')}">
      ${msg ? `<p class="muted small">${esc(msg)}</p>` : ''}
      <button class="btn primary block big" id="rc_share">Share (WhatsApp)</button>
      <div class="row2"><button class="btn block" id="rc_png">Save picture</button><button class="btn block" id="rc_pdf">Save PDF</button></div>
      <button class="btn block" id="rc_new">${msg ? 'New bill' : 'Close'}</button>`);
    const nm = `Bill-${bl.date}${bl.cn ? '-' + bl.cn.replace(/[^\w\u0600-\u06FF-]+/g, '_') : ''}`;
    const run = (kind, shareFirst) => async () => {
      try {
        const blob = kind === 'pdf' ? await self.Receipt.pdf(canvas) : await self.Receipt.png(canvas);
        const r = await self.Receipt.deliver(blob, `${nm}.${kind}`, shareFirst);
        if (r === 'saved') toast(kind === 'pdf' ? 'PDF saved in Downloads' : 'Picture saved in Downloads');
      } catch (e) { toast('Could not make the file: ' + e.message, true); }
    };
    $('#rc_share', s.el).addEventListener('click', run('png', true));
    $('#rc_png', s.el).addEventListener('click', run('png', false));
    $('#rc_pdf', s.el).addEventListener('click', run('pdf', false));
    $('#rc_new', s.el).addEventListener('click', () => s.close());
    return s;
  }
  const levelOf = (q) => (q <= 0 ? 'out' : q <= 5 ? 'low' : 'ok');

  function renderStock() {
    const items = (data.products && data.products.items) || [];
    const eff = (p) => (p.q === undefined ? null : p.q + comingFor(p));
    const total = items.reduce((s, p) => s + Math.max(0, eff(p) || 0), 0);
    $('#stockTotal').textContent = items.length ? fmt(total) : '–';
    $('#k_age').textContent = items.length ? `${items.length} products · ${stockAge()}${data.sync ? '' : ' · update before you travel'}` : 'No stock list yet';
    if (!items.length) {
      $('#k_list').innerHTML = `<div class="empty">${CUP}<b>No stock on this phone yet</b><br>${data.sync ? 'Connecting… pull down to retry, or open ⋮ → Online stock.' : 'Open the link from the laptop (Settings → Stock online for the phone), or use ⋮ → Product list by message.'}</div>`;
      return;
    }
    const q = norm($('#k_q').value);
    const max = Math.max(20, ...items.map((p) => eff(p) || 0));
    const rows = items.filter((p) => (!q || norm(p.n).includes(q) || norm(p.k).includes(q)) && (stockFilter === 'all' || (eff(p) !== null && levelOf(eff(p)) === (stockFilter === 'low' ? 'low' : 'out'))));
    $('#k_list').innerHTML = rows.slice(0, 300).map((p) => {
      const e = eff(p);
      const c = comingFor(p);
      const lv = e === null ? 'ok' : levelOf(e);
      return `<button class="pcard lvl-${lv}" data-n="${esc(p.n)}"><div class="top2"><div class="who">${avatar(p.n)}<div style="min-width:0"><div class="nm">${esc(p.n)}</div>
        <div class="meta">cost ${fmt(p.c)} · sale ${fmt(p.s)}</div><span class="pill">${lv === 'out' ? 'Out of stock' : lv === 'low' ? 'Running low' : 'In stock'}</span>${c ? `<div class="coming${c < 0 ? ' neg' : ''}">${c > 0 ? '+ ' + fmt(c) + ' just bought' : '− ' + fmt(-c) + ' sold from phone'}</div>` : ''}</div></div>
        <div><div class="qn">${e === null ? '–' : fmt(e)}</div><div class="qu">${esc(p.u || 'pcs')}</div></div></div>
        <div class="meter"><i style="width:${e === null ? 0 : Math.max(e > 0 ? 4 : 0, Math.min(100, (e / max) * 100))}%"></i></div></button>`;
    }).join('') || '<div class="empty">Nothing found.</div>';
  }

  const fmtTs = (ts) => { const d = new Date(ts); return `${nice(ymd(d))}, ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const owedKarz = (c) => Math.max(0, +(c.b - waitingSPays(c.n).reduce((t, x) => t + x.amount, 0)).toFixed(2));
  const notReady = (what) => `<div class="empty">${CUP}<b>${data.sync ? what + ' not received yet' : 'Connect the laptop first'}</b><br>${data.sync ? (what === 'Karz' ? 'Update the laptop software, then in Settings press “Send stock now”, and refresh here.' : 'At the laptop: Settings → Stock online for the phone → tick “Also show udhar on the phone”, then “Send stock now”.') : 'Open the link from the laptop (Settings → Stock online for the phone) on this phone.'}</div>`;
  function renderUdhar() {
    const u = data.udhar;
    if (!u) {
      $('#udharTotal').textContent = '–';
      $('#udharSub').textContent = data.sync ? 'Udhar is not shared by the laptop yet' : 'Not connected';
      $('#u_list').innerHTML = notReady('Udhar');
      return;
    }
    const total = u.list.reduce((t, c) => t + owedNow(c), 0);
    $('#udharTotal').textContent = money(total);
    $('#udharSub').textContent = `${u.list.length} customer${u.list.length === 1 ? '' : 's'} owe you${u.ts ? ' · as of ' + fmtTs(u.ts) : ''}`;
    const q = norm($('#u_q').value);
    const rows = u.list.filter((c) => !q || norm(c.n).includes(q) || String(c.p).includes(q));
    $('#u_list').innerHTML = rows.map((c) => `<button class="pcard ccard" data-c="${u.list.indexOf(c)}"><div class="top2"><div class="who">${avatar(c.n)}
      <div style="min-width:0"><div class="nm">${esc(c.n)}</div><div class="meta">${esc(c.p || 'no phone')}</div></div></div><div class="bal">${fmt(owedNow(c))}<small>Rs</small></div></div></button>`).join('')
      || (u.list.length ? '<div class="empty">Nobody found.</div>' : `<div class="empty">${CUP}<b>Nobody owes you anything</b></div>`);
  }
  function renderKarz() {
    const u = data.karz;
    if (!u) {
      $('#karzTotal').textContent = '–';
      $('#karzSub').textContent = data.sync ? 'Karz is not shared by the laptop yet' : 'Not connected';
      $('#kz_list').innerHTML = notReady('Karz');
      return;
    }
    const total = u.list.reduce((t, c) => t + owedKarz(c), 0);
    $('#karzTotal').textContent = money(total);
    $('#karzSub').textContent = `You owe ${u.list.length} wholesaler${u.list.length === 1 ? '' : 's'}${u.ts ? ' · as of ' + fmtTs(u.ts) : ''}`;
    const q = norm($('#kz_q').value);
    const rows = u.list.filter((c) => !q || norm(c.n).includes(q) || String(c.p).includes(q));
    $('#kz_list').innerHTML = rows.map((c) => `<button class="pcard ccard" data-c="${u.list.indexOf(c)}"><div class="top2"><div class="who">${avatar(c.n)}
      <div style="min-width:0"><div class="nm">${esc(c.n)}</div><div class="meta">${esc(c.p || 'no phone')}</div></div></div><div class="bal">${fmt(owedKarz(c))}<small>Rs</small></div></div></button>`).join('')
      || (u.list.length ? '<div class="empty">Nobody found.</div>' : `<div class="empty">${CUP}<b>You owe nobody anything</b></div>`);
  }

  /** kind: 'udhar' (a customer owes me) or 'karz' (I owe a wholesaler) */
  function openCustomer(c, kind) {
    const karz = kind === 'karz';
    const mine = karz ? waitingSPays(c.n) : waitingPays(c.n);
    const now = karz ? owedKarz(c) : owedNow(c);
    const typ = karz ? { opening: 'Old karz', purchase: 'Maal on karz', payment: 'Paid to him', adjust: 'Correction' }
      : { opening: 'Old balance', credit_sale: 'Bill (udhar)', payment: 'Payment received', sale_cancel: 'Bill cancelled', adjust: 'Correction' };
    const s = sheet(c.n, `
      <div class="item-row" style="display:flex;justify-content:space-between;align-items:center"><div class="muted small">${karz ? 'You owe him (karz)' : 'Udhar pending'}</div><div style="font-size:26px;font-weight:800;color:var(--red)">${money(now)}</div></div>
      <button class="btn primary block big" id="cu_pay">${karz ? 'Payment given to him' : 'Payment received'}</button>
      <div class="row2"><button class="btn block" id="cu_share">Send details (picture / PDF)</button><button class="btn block" id="cu_sms">SMS / WhatsApp text</button></div>
      ${c.p ? `<a class="btn block call" href="tel:${esc(String(c.p).replace(/[^+\d]/g, ''))}">Call ${esc(c.p)}</a>` : ''}
      <h2 style="margin:16px 2px 8px;font-size:15px">Latest entries</h2>
      <div class="item-row" style="padding-top:2px;padding-bottom:2px">${mine.map((x) => `<div class="entry"><div><b>${karz ? 'Paid to him (this phone)' : 'Payment received (this phone)'}</b><div class="muted small">${esc(nice(x.date))} · ${x.status === 'sent' ? 'sent — the laptop will count it' : 'waiting for internet'}</div></div><div class="minus">−${fmt(x.amount)}</div></div>`).join('')}${c.e.length ? c.e.map((x) => `<div class="entry"><div><b>${esc(typ[x.t] || x.t)}</b><div class="muted small">${esc(nice(x.d))}${x.n ? ' · ' + esc(x.n) : ''}</div></div>
        <div class="${x.db ? 'plus' : 'minus'}">${x.db ? '+' + fmt(x.db) : '−' + fmt(x.cr)}</div></div>`).join('') : (mine.length ? '' : '<div class="muted small" style="padding:10px 0">No entries.</div>')}</div>`);
    $('#cu_pay', s.el).addEventListener('click', () => { s.close(); paymentSheet(c, kind); });
    $('#cu_share', s.el).addEventListener('click', () => sendDetails(c, kind, 'file'));
    $('#cu_sms', s.el).addEventListener('click', () => sendDetails(c, kind, 'text'));
    return s;
  }

  const shopName = () => (data.products && data.products.shop) || '';
  const entriesOf = (c, kind) => {
    const typ = kind === 'karz' ? { opening: 'Old karz', purchase: 'Maal on karz', payment: 'Paid to him', adjust: 'Correction' }
      : { opening: 'Old balance', credit_sale: 'Bill (udhar)', payment: 'Payment received', sale_cancel: 'Bill cancelled', adjust: 'Correction' };
    const mine = (kind === 'karz' ? waitingSPays(c.n) : waitingPays(c.n)).map((x) => ({ d: x.date, label: (kind === 'karz' ? 'Paid to him' : 'Payment received') + ' (this phone)', db: 0, cr: x.amount }));
    return [...mine, ...c.e.map((x) => ({ d: x.d, label: (typ[x.t] || x.t) + (x.n ? ' · ' + x.n : ''), db: x.db, cr: x.cr }))];
  };
  /** Sends the account of a customer / wholesaler: as a picture/PDF (share sheet → WhatsApp) or as plain text (SMS / WhatsApp message). */
  function sendDetails(c, kind, how) {
    const bal = kind === 'karz' ? owedKarz(c) : owedNow(c);
    const entries = entriesOf(c, kind).slice(0, 8);
    if (how === 'text') {
      const lines = entries.slice(0, 5).map((e) => `${nice(e.d)}: ${e.db ? '+' + fmt(e.db) : '-' + fmt(e.cr)}${e.label ? ' (' + e.label + ')' : ''}`);
      const text = kind === 'karz'
        ? [`${shopName() ? shopName() + ' — ' : ''}Account of ${c.n}`, bal > 0 ? `We owe you Rs ${fmt(bal)}.` : 'No karz pending.', ...(lines.length ? ['Recent:', ...lines] : []), 'Thank you.'].join('\n')
        : [`Dear ${c.n},`, bal > 0 ? `Your pending udhar${shopName() ? ' at ' + shopName() : ''} is Rs ${fmt(bal)}.` : 'Your udhar is cleared. Thank you!', ...(lines.length ? ['Recent:', ...lines] : []), bal > 0 ? 'Please pay when you can. Thank you.' : ''].filter(Boolean).join('\n');
      const num_ = String(c.p || '').replace(/[^\d+]/g, '');
      const sheetx = sheet('Send as message', `<pre class="msgpre">${esc(text)}</pre>
        <a class="btn primary block big" id="sd_sms" href="sms:${esc(num_)}?&body=${encodeURIComponent(text)}">SMS</a>
        <a class="btn block" id="sd_wa" target="_blank" rel="noopener" href="https://wa.me/${esc(waNumber(num_))}?text=${encodeURIComponent(text)}">WhatsApp (text)</a>
        <button class="btn block" id="sd_copy">Copy text</button>`);
      $('#sd_copy', sheetx.el).addEventListener('click', async () => { try { await navigator.clipboard.writeText(text); toast('Copied'); } catch (e) { toast('Could not copy', true); } });
      return sheetx;
    }
    const canvas = self.Receipt.drawStatement({ name: c.n, phone: c.p, entries, balance: bal, kind, date: ymd(new Date()) }, shopName());
    return fileSheet(canvas, `${kind === 'karz' ? 'Karz' : 'Udhar'}-${c.n}-${ymd(new Date())}`, kind === 'karz' ? 'Account of karz' : 'Account of udhar', '');
  }
  const waNumber = (n) => { let d = String(n).replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); else if (d.startsWith('0')) d = '92' + d.slice(1); return d; };

  /** A drawn picture with Share / Save picture / Save PDF. */
  function fileSheet(canvas, baseName, title, msg, closeLabel) {
    const s = sheet(title, `<img id="rc_img" class="receipt-img" alt="${esc(title)}" src="${canvas.toDataURL('image/png')}">
      ${msg ? `<p class="muted small">${esc(msg)}</p>` : ''}
      <button class="btn primary block big" id="rc_share">Share (WhatsApp)</button>
      <div class="row2"><button class="btn block" id="rc_png">Save picture</button><button class="btn block" id="rc_pdf">Save PDF</button></div>
      <button class="btn block" id="rc_new">${esc(closeLabel || 'Close')}</button>`);
    const nm = String(baseName).replace(/[^\w؀-ۿ-]+/g, '_');
    const run = (kind, shareFirst) => async () => {
      try {
        const blob = kind === 'pdf' ? await self.Receipt.pdf(canvas) : await self.Receipt.png(canvas);
        const r = await self.Receipt.deliver(blob, `${nm}.${kind}`, shareFirst);
        if (r === 'saved') toast(kind === 'pdf' ? 'PDF saved in Downloads' : 'Picture saved in Downloads');
      } catch (e) { toast('Could not make the file: ' + e.message, true); }
    };
    $('#rc_share', s.el).addEventListener('click', run('png', true));
    $('#rc_png', s.el).addEventListener('click', run('png', false));
    $('#rc_pdf', s.el).addEventListener('click', run('pdf', false));
    $('#rc_new', s.el).addEventListener('click', () => s.close());
    return s;
  }

  /** Take a payment from a customer (kind 'udhar') or give one to a wholesaler (kind 'karz'). Works without internet. */
  function paymentSheet(c, kind) {
    const karz = kind === 'karz';
    const due = karz ? owedKarz(c) : owedNow(c);
    const s = sheet(karz ? `Payment to ${c.n}` : `Payment from ${c.n}`, `
      <div class="item-row" style="display:flex;justify-content:space-between;align-items:center"><div class="muted small">${karz ? 'You owe him (karz)' : 'Udhar pending'}</div><div style="font-size:24px;font-weight:800;color:var(--red)">${money(due)}</div></div>
      <label class="f"><span>${karz ? 'Amount paid (Rs)' : 'Amount received (Rs)'}</span><input id="rv_amt" type="text" inputmode="decimal" value="${due || ''}"></label>
      <div class="seg2" id="rv_m" style="margin:4px 0 8px"><button type="button" class="chip on" data-m="cash">Cash</button><button type="button" class="chip" data-m="bank">Bank</button><button type="button" class="chip" data-m="wallet">EasyPaisa / JazzCash</button></div>
      <label class="f"><span>Note (optional)</span><input id="rv_note" type="text"></label>
      <button class="btn primary block big" id="rv_save">Save payment</button>`);
    let method = 'cash';
    $('#rv_m', s.el).addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b) return; method = b.dataset.m; s.el.querySelectorAll('#rv_m button').forEach((x) => x.classList.toggle('on', x === b)); });
    $('#rv_save', s.el).addEventListener('click', async () => {
      const amount = num($('#rv_amt', s.el).value);
      if (!(amount > 0)) return toast(karz ? 'Enter the amount paid' : 'Enter the amount received', true);
      if (amount > due + 0.009) return toast(`More than the ${karz ? 'karz' : 'udhar'} (${money(due)})`, true);
      const py = { id: (karz ? 'sp-' : 'py-') + rid().slice(2), at: Date.now(), date: ymd(new Date()), cn: c.n, amount, method, note: $('#rv_note', s.el).value.trim(), status: 'pending' };
      (karz ? data.spays : data.pays).unshift(py); save();
      s.close();
      let msg = 'Saved. It will be sent when the phone has internet.';
      try { await (karz ? uploadSPay(py) : uploadPay(py)); msg = 'Saved and sent. The laptop adds it to the ledger by itself.'; } catch (e) { if (e.message !== 'offline') msg = e.message; }
      karz ? renderKarz() : renderUdhar();
      const canvas = self.Receipt.drawPayment({ kind: karz ? 'paid' : 'received', name: c.n, amount, method, date: py.date, note: py.note, after: Math.max(0, +(due - amount).toFixed(2)) }, shopName());
      fileSheet(canvas, `${karz ? 'Payment-to' : 'Receipt'}-${c.n}-${py.date}`, karz ? 'Payment receipt' : 'Receipt', msg + ' You can send this receipt to ' + (karz ? 'the wholesaler.' : 'the customer.'), 'Done');
    });
  }

  function openProducts() {
    const p = data.products;
    const s = sheet('Product list', `
      <p class="muted small" style="margin-top:0">It lets the phone suggest your shop's product names and show <b>how much stock you already have</b> while you type.
      At the laptop: <b>Products &amp; Stock → Product list for phone</b>, then send yourself the message and paste it here.</p>
      <div class="item-row">${p ? `<b>${p.count} products loaded</b><div class="muted small">${esc(stockAge())}</div>` : 'No list loaded yet.'}</div>
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
          .map((x) => {
            const o = { n: String(x.n).slice(0, 200), k: String(x.k || '').slice(0, 60), c: Number(x.c) || 0, s: Number(x.s) || 0 };
            if (x.q !== undefined && Number.isFinite(Number(x.q))) { o.q = Number(x.q); o.u = String(x.u || '').slice(0, 20); }
            return o;
          });
        const at = /^\d{4}-\d{2}-\d{2}$/.test(String(obj.at || '')) ? obj.at : null;
        data.products = { items, loadedAt: Date.now(), count: items.length, at };
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
      renderPay(b);
      save();
    });
    $('#date').addEventListener('change', () => { const b = ensureCurrent(); b.date = $('#date').value || ymd(new Date()); save(); });
    $('#name').addEventListener('input', updateHint);
    $('#name').addEventListener('change', updateHint);
    $('#unit').addEventListener('change', updateHint);
    $('#qty').addEventListener('input', updateAmt);
    $('#qchips').addEventListener('click', (e) => { const b = e.target.closest('[data-q]'); if (!b) return; $('#qty').value = b.dataset.q; updateAmt(); $('#cost').focus(); });
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
    $('#b_cust').addEventListener('click', pickCustomer);
    $('#b_q').addEventListener('input', renderBill);
    $('#b_results').addEventListener('click', (e) => { const b = e.target.closest('[data-add]'); if (b) addToBill(b.dataset.add); });
    $('#b_lines').addEventListener('click', (e) => {
      const row = e.target.closest('[data-bi]'); if (!row) return;
      const l = cart().lines[Number(row.dataset.bi)];
      const st = e.target.closest('[data-step]');
      if (st) { l.q = Math.max(0, (num(String(l.q)) || 0) + Number(st.dataset.step)); if (l.q === 0) cart().lines.splice(Number(row.dataset.bi), 1); save(); renderBill(); return; }
      const d = e.target.closest('[data-bdel]'); if (d) { cart().lines.splice(Number(row.dataset.bi), 1); save(); renderBill(); }
    });
    $('#b_lines').addEventListener('input', (e) => { const row = e.target.closest('[data-bi]'); if (!row || !e.target.dataset.f) return; cart().lines[Number(row.dataset.bi)][e.target.dataset.f] = e.target.value; save(); const k = cartCalc();
      $('#b_total').textContent = money(k.total); $('#b_due').textContent = money(k.due); $('#billHeroAmt').textContent = money(k.total); $('#billBarAmt').textContent = money(k.total); });
    for (const [id, key] of [['b_disc', 'disc'], ['b_paid', 'paid'], ['b_note', 'note']]) $('#' + id).addEventListener('input', () => { cart()[key] = $('#' + id).value; save(); const k = cartCalc(); $('#b_total').textContent = money(k.total); $('#b_due').textContent = money(k.due); $('#billHeroAmt').textContent = money(k.total); $('#billBarAmt').textContent = money(k.total); $('#billBarSub').textContent = k.due > 0 ? `udhar ${money(k.due)}` : 'paid in full'; });
    $('#b_method').addEventListener('change', () => { cart().method = $('#b_method').value; save(); });
    $('#b_date').addEventListener('change', () => { cart().date = $('#b_date').value || ymd(new Date()); save(); });
    $('#b_full').addEventListener('click', () => { cart().paid = ''; save(); renderBill(); });
    $('#b_udhar').addEventListener('click', () => { cart().paid = '0'; save(); renderBill(); });
    $('#billSend').addEventListener('click', sendBill);
    $('#b_recentList').addEventListener('click', (e) => { const r = e.target.closest('[data-rb]'); if (!r) return; const bl = data.bills.find((x) => x.id === r.dataset.rb); if (bl) openReceipt(bl, ''); });
    window.addEventListener('online', sendPending);
    $('#k_q').addEventListener('input', renderStock);
    $('#u_q').addEventListener('input', renderUdhar);
    $('#kz_q').addEventListener('input', renderKarz);
    $('#paySeg').addEventListener('click', (e) => { const b = e.target.closest('[data-m]'); if (!b) return; const bb = ensureCurrent(); bb.pay = b.dataset.m; save(); renderPay(bb); });
    $('#paidNow').addEventListener('input', () => { const bb = ensureCurrent(); bb.paid = $('#paidNow').value; save(); renderPay(bb); });
    $('#k_seg').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; stockFilter = b.dataset.f; document.querySelectorAll('#k_seg .chip').forEach((x) => x.classList.toggle('on', x === b)); renderStock(); });
    $('#k_list').addEventListener('click', (e) => { const r = e.target.closest('[data-n]'); if (!r) return; setTab('maal'); $('#name').value = r.dataset.n; updateHint(); $('#qty').focus(); });
    $('#u_list').addEventListener('click', (e) => { const r = e.target.closest('[data-c]'); if (r && data.udhar) openCustomer(data.udhar.list[Number(r.dataset.c)], 'udhar'); });
    $('#kz_list').addEventListener('click', (e) => { const r = e.target.closest('[data-c]'); if (r && data.karz) openCustomer(data.karz.list[Number(r.dataset.c)], 'karz'); });
    $('#drawerWrap').addEventListener('click', (e) => {
      if (e.target === $('#drawerWrap')) return drawerOpen(false);
      const t = e.target.closest('.dr-item[data-tab]'); if (t) return setTab(t.dataset.tab);
      const id = (e.target.closest('.dr-item') || {}).id;
      if (!id) return;
      drawerOpen(false);
      if (id === 'm_hist') openHistory(); if (id === 'm_online') openOnline(); if (id === 'm_prod') openProducts(); if (id === 'm_help') openHelp(); if (id === 'm_upd') getNewestPage();
    });
    window.addEventListener('online', setStatus);
    window.addEventListener('offline', setStatus);
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }

    if ('serviceWorker' in navigator) {
      // a new version of the page was installed: show it at once (once), instead of after a second refresh
      if (navigator.serviceWorker.controller) {
        let reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
      }
      navigator.serviceWorker.register('sw.js')
        .then(() => navigator.serviceWorker.ready)
        .then(() => { offlineReady = true; setStatus(); })
        .catch(() => { /* works online only */ });
    }
    renderStock(); renderUdhar(); renderKarz(); renderBill();
    const linked = readSyncLink();
    if (data.sync) fetchOnline(linked).then((ok) => { if (linked && ok) toast('Connected. Stock loaded.'); });
    window.addEventListener('online', () => { if (data.sync) fetchOnline(false); });
    if (data.bills.some((x) => x.status === 'pending')) sendPending();
    window.__maalReady = true;
  }
  init();
})();
