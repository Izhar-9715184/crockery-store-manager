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
      if (o && Array.isArray(o.batches)) return { batches: o.batches, currentId: o.currentId || null, suppliers: o.suppliers || [], products: o.products || null, sync: o.sync || null, udhar: o.udhar || null };
    } catch (e) { /* first run or storage blocked */ }
    return { batches: [], currentId: null, suppliers: [], products: null, sync: null, udhar: null };
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
    const n = norm(p.n);
    let q = 0;
    for (const b of data.batches) {
      if (!b.online || done.has(b.id)) continue;
      for (const l of b.lines) if (norm(l.n) === n) q += l.q;
    }
    return q;
  }
  const stockText = (p) => (p.q === undefined ? 'stock unknown' : (p.q + comingFor(p)) <= 0 ? 'stock 0 (out)' : `stock ${fmt(p.q)}${p.u ? ' ' + p.u : ''}${comingFor(p) ? ` + ${fmt(comingFor(p))} bought, on its way to the laptop` : ''}`);
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
        const o = { n: String(x.n).slice(0, 200), k: String(x.k || '').slice(0, 60), c: Number(x.c) || 0, s: Number(x.s) || 0 };
        if (x.q !== undefined && Number.isFinite(Number(x.q))) { o.q = Number(x.q); o.u = String(x.u || '').slice(0, 20); }
        return o;
      });
      data.products = { items, loadedAt: Date.now(), count: items.length, at: obj.at || null, ts: obj.ts || null, shop: obj.shop || '', imported: Array.isArray(obj.imported) ? obj.imported.slice(0, 400) : [] };
      data.udhar = Array.isArray(obj.cust) ? { list: obj.cust.slice(0, 400), ts: obj.ts || null } : null;
      save(); renderFields(); updateHint(); renderStock(); renderUdhar();
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
    $('#suppliers').innerHTML = data.suppliers.map((s) => `<option value="${esc(s)}">`).join('');
    $('#plist').innerHTML = productNames().map((n) => `<option value="${esc(n)}">`).join('');
  }

  let popIdx = -1;
  function renderLines() {
    const b = ensureCurrent();
    const t = totals(b);
    $('#count').textContent = t.items ? `${t.items} item${t.items === 1 ? '' : 's'}` : '';
    $('#lines').innerHTML = b.lines.length
      ? b.lines.map((l, i) => `<div class="line${popIdx === i ? ' pop' : ''}" data-i="${i}">${avatar(l.n)}<div class="main" data-edit="${i}"><div class="nm">${esc(l.n)}</div>
          <div class="calc">${fmt(l.q)} × ${fmt(l.c)}${l.s ? ` · sale ${fmt(l.s)}` : ''}</div></div>
          <div class="sum">${fmt(l.q * l.c)}</div><button class="x" data-del="${i}" aria-label="Remove">×</button></div>`).join('')
      : `<div class="empty">${CUP}<b>Nothing added yet</b><br>Add each item you buy, one by one.</div>`;
    popIdx = -1;
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
  function updateHint() {
    const p = knownProduct($('#name').value);
    const h = $('#hint');
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
    const line = { n: name, q, c };
    if (s !== null) line.s = s;
    b.lines.push(line);
    popIdx = b.lines.length - 1;
    try { navigator.vibrate && navigator.vibrate(12); } catch (e) { /* ignore */ }
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

  /** Sends the finished list online; the laptop adds it to the stock by itself. */
  async function uploadBatch(b) {
    if (!data.sync || !data.sync.key) throw new Error('This phone is not connected for sending. Open the link from the laptop again.');
    if (!navigator.onLine) throw new Error('No internet. Use "Copy message" or try again later.');
    const payload = { v: 1, id: b.id, date: b.date, supplier: b.supplier || '',
      lines: b.lines.map((l) => (l.s !== undefined ? { n: l.n, q: l.q, c: l.c, s: l.s } : { n: l.n, q: l.q, c: l.c })) };
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
  function openMenu() {
    const s = sheet('Menu', `
      <button class="menu-item" id="m_hist">📋 Old lists (History)</button>
      <button class="menu-item" id="m_online">🌐 Online stock (automatic)</button>
      <button class="menu-item" id="m_prod">📦 Product list by message (without internet)</button>
      <button class="menu-item" id="m_help">ℹ️ How it works / install</button>`);
    $('#m_hist', s.el).addEventListener('click', () => { s.close(); openHistory(); });
    $('#m_prod', s.el).addEventListener('click', () => { s.close(); openProducts(); });
    $('#m_online', s.el).addEventListener('click', () => { s.close(); openOnline(); });
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
  const TITLES = { maal: 'Maal entry', stock: 'Stock', udhar: 'Udhar' };
  let tab = 'maal';
  let stockFilter = 'all';
  function setTab(t) {
    tab = t;
    document.body.dataset.tab = t;
    try { document.querySelector('meta[name=theme-color]').content = { maal: '#4f2bd6', stock: '#055e4d', udhar: '#7c1236' }[t]; } catch (e) { /* ignore */ }
    for (const v of ['maal', 'stock', 'udhar']) $('#v-' + v).hidden = v !== t;
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x.dataset.tab === t));
    $('#pageTitle').textContent = TITLES[t];
    $('#bar').hidden = t !== 'maal';
    if (t === 'stock') renderStock();
    if (t === 'udhar') renderUdhar();
    window.scrollTo(0, 0);
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
        <div class="meta">cost ${fmt(p.c)} · sale ${fmt(p.s)}</div><span class="pill">${lv === 'out' ? 'Out of stock' : lv === 'low' ? 'Running low' : 'In stock'}</span>${c ? `<div class="coming">+ ${fmt(c)} just bought</div>` : ''}</div></div>
        <div><div class="qn">${e === null ? '–' : fmt(e)}</div><div class="qu">${esc(p.u || 'pcs')}</div></div></div>
        <div class="meter"><i style="width:${e === null ? 0 : Math.max(e > 0 ? 4 : 0, Math.min(100, (e / max) * 100))}%"></i></div></button>`;
    }).join('') || '<div class="empty">Nothing found.</div>';
  }

  const fmtTs = (ts) => { const d = new Date(ts); return `${nice(ymd(d))}, ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  function renderUdhar() {
    const u = data.udhar;
    if (!u) {
      $('#udharTotal').textContent = '–';
      $('#udharSub').textContent = data.sync ? 'Udhar is not shared by the laptop' : 'Not connected';
      $('#u_list').innerHTML = `<div class="empty">${CUP}<b>${data.sync ? 'Udhar is switched off' : 'Connect the laptop first'}</b><br>${data.sync ? 'At the laptop: Settings → Stock online for the phone → tick “Also show udhar on the phone”.' : 'Open the link from the laptop (Settings → Stock online for the phone) on this phone.'}</div>`;
      return;
    }
    const total = u.list.reduce((s, c) => s + c.b, 0);
    $('#udharTotal').textContent = money(total);
    $('#udharSub').textContent = `${u.list.length} customer${u.list.length === 1 ? '' : 's'} owe you${u.ts ? ' · as of ' + fmtTs(u.ts) : ''}`;
    const q = norm($('#u_q').value);
    const rows = u.list.filter((c) => !q || norm(c.n).includes(q) || String(c.p).includes(q));
    $('#u_list').innerHTML = rows.map((c, i) => `<button class="pcard ccard" data-c="${u.list.indexOf(c)}"><div class="top2"><div class="who">${avatar(c.n)}
      <div style="min-width:0"><div class="nm">${esc(c.n)}</div><div class="meta">${esc(c.p || 'no phone')}</div></div></div><div class="bal">${fmt(c.b)}<small>Rs</small></div></div></button>`).join('')
      || (u.list.length ? '<div class="empty">Nobody found.</div>' : '<div class="empty">${CUP}<b>Nobody owes you anything</b></div>');
  }
  function openCustomer(c) {
    const typ = { opening: 'Old balance', credit_sale: 'Bill (udhar)', payment: 'Payment received', sale_cancel: 'Bill cancelled', adjust: 'Correction' };
    const s = sheet(c.n, `
      <div class="item-row" style="display:flex;justify-content:space-between;align-items:center"><div class="muted small">Udhar pending</div><div style="font-size:26px;font-weight:800;color:var(--red)">${money(c.b)}</div></div>
      ${c.p ? `<a class="btn primary block call" href="tel:${esc(String(c.p).replace(/[^+\d]/g, ''))}">Call ${esc(c.p)}</a>` : ''}
      <h2 style="margin:16px 2px 8px;font-size:15px">Latest entries</h2>
      <div class="item-row" style="padding-top:2px;padding-bottom:2px">${c.e.length ? c.e.map((x) => `<div class="entry"><div><b>${esc(typ[x.t] || x.t)}</b><div class="muted small">${esc(nice(x.d))}${x.n ? ' · ' + esc(x.n) : ''}</div></div>
        <div class="${x.db ? 'plus' : 'minus'}">${x.db ? '+' + fmt(x.db) : '−' + fmt(x.cr)}</div></div>`).join('') : '<div class="muted small" style="padding:10px 0">No entries.</div>'}</div>`);
    return s;
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
      save();
    });
    $('#date').addEventListener('change', () => { const b = ensureCurrent(); b.date = $('#date').value || ymd(new Date()); save(); });
    $('#name').addEventListener('input', updateHint);
    $('#name').addEventListener('change', updateHint);
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
    $('#k_q').addEventListener('input', renderStock);
    $('#u_q').addEventListener('input', renderUdhar);
    $('#k_seg').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; stockFilter = b.dataset.f; document.querySelectorAll('#k_seg .chip').forEach((x) => x.classList.toggle('on', x === b)); renderStock(); });
    $('#k_list').addEventListener('click', (e) => { const r = e.target.closest('[data-n]'); if (!r) return; setTab('maal'); $('#name').value = r.dataset.n; updateHint(); $('#qty').focus(); });
    $('#u_list').addEventListener('click', (e) => { const r = e.target.closest('[data-c]'); if (r && data.udhar) openCustomer(data.udhar.list[Number(r.dataset.c)]); });
    $('#tabs').addEventListener('click', (e) => { const t = e.target.closest('[data-tab]'); if (t) setTab(t.dataset.tab); });
    window.addEventListener('online', setStatus);
    window.addEventListener('offline', setStatus);
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) { /* ignore */ }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js')
        .then(() => navigator.serviceWorker.ready)
        .then(() => { offlineReady = true; setStatus(); })
        .catch(() => { /* works online only */ });
    }
    renderStock(); renderUdhar();
    const linked = readSyncLink();
    if (data.sync) fetchOnline(linked).then((ok) => { if (linked && ok) toast('Connected. Stock loaded.'); });
    window.addEventListener('online', () => { if (data.sync) fetchOnline(false); });
    window.__maalReady = true;
  }
  init();
})();
