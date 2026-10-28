'use strict';
const UNITS = ['pcs', 'set', 'dozen', 'pair', 'box', 'kg'];

function stockBadge(p) {
  if (p.stock <= 0) return `<span class="badge out">${qty(p.stock)} · Out</span>`;
  if (p.min_stock > 0 && p.stock <= p.min_stock) return `<span class="badge low">${qty(p.stock)} · Low</span>`;
  return `<span class="badge ok">${qty(p.stock)}</span>`;
}

async function editProduct(p, done) {
  const cats = await rpc('listCategories');
  const isNew = !p;
  p = p || { name: '', code: '', category: '', unit: 'pcs', cost_price: '', sale_price: '', stock: '', min_stock: '' };
  modal({
    title: isNew ? 'Add product' : 'Edit product',
    body: `<datalist id="cats">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <div class="form-grid">
        <label class="f full"><span>Product name *</span><input type="text" name="name" value="${esc(p.name)}" placeholder="e.g. Dinner Plate 10 inch"></label>
        <label class="f"><span>Code / barcode</span><input type="text" name="code" value="${esc(p.code || '')}"></label>
        <label class="f"><span>Category</span><input type="text" name="category" list="cats" value="${esc(p.category || '')}" placeholder="e.g. Plates"></label>
        <label class="f"><span>Cost price (what you pay)</span><input type="number" name="cost_price" min="0" step="any" value="${p.cost_price}"></label>
        <label class="f"><span>Sale price</span><input type="number" name="sale_price" min="0" step="any" value="${p.sale_price}"></label>
        <label class="f"><span>Unit</span><select name="unit">${UNITS.map((u) => `<option ${u === p.unit ? 'selected' : ''}>${u}</option>`).join('')}</select></label>
        <label class="f"><span>Warn me when stock falls to</span><input type="number" name="min_stock" min="0" step="any" value="${p.min_stock}" placeholder="0 = no warning"></label>
        ${isNew ? `<label class="f full"><span>Opening stock (how many you have now)</span><input type="number" name="stock" min="0" step="any" value="${p.stock}"></label>`
          : `<div class="full muted small">Current stock: <b>${qty(p.stock)}</b>. To change it use “Stock in” or “Adjust” in the list.</div>`}
      </div>`,
    actions: [
      ...(!isNew ? [{
        label: 'Delete', kind: 'danger', close: false,
        onClick: async (m) => {
          if (!(await confirmBox(`Remove “${p.name}” from the product list? Old bills keep working.`, { okLabel: 'Remove', danger: true }))) return false;
          await rpc('deleteProduct', p.id);
          m.close(); toast('Product removed', 'ok'); if (done) done();
        },
      }] : []),
      { label: 'Cancel' },
      {
        label: 'Save', kind: 'primary', close: false,
        onClick: async (m) => {
          const f = formData(m.body);
          if (!isNew) f.id = p.id;
          const saved = await rpc('saveProduct', f);
          m.close(); toast('Product saved', 'ok'); if (done) done(saved);
        },
      },
    ],
  });
}

function stockInDialog(p, done) {
  modal({
    title: `Stock in — ${p.name}`,
    body: `<div class="form-grid">
      <label class="f"><span>Quantity received *</span><input type="number" name="qty" min="0" step="any"></label>
      <label class="f"><span>Cost price (per piece)</span><input type="number" name="cost_price" min="0" step="any" value="${p.cost_price}"></label>
      <label class="f"><span>Supplier</span><input type="text" name="supplier"></label>
      <label class="f"><span>Date</span><input type="date" name="date" value="${today()}"></label>
      <label class="f full"><span>Note</span><input type="text" name="note"></label>
      <div class="full muted small">Now in stock: <b>${qty(p.stock)}</b></div></div>`,
    actions: [{ label: 'Cancel' }, {
      label: 'Add stock', kind: 'primary', close: false,
      onClick: async (m) => {
        await rpc('stockIn', { ...formData(m.body), product_id: p.id });
        m.close(); toast('Stock added', 'ok'); if (done) done();
      },
    }],
  });
}

function adjustDialog(p, done) {
  const m = modal({
    title: `Adjust stock — ${p.name}`,
    body: `<div class="form-grid">
      <label class="f full"><span>What happened?</span>
        <select name="kind"><option value="breakage">Broken / damaged / lost (reduce stock)</option>
        <option value="correction">I counted the shelf — set the correct number</option></select></label>
      <label class="f full"><span id="qlabel">Quantity broken</span><input type="number" name="qty" min="0" step="any"></label>
      <label class="f full"><span>Note</span><input type="text" name="note" placeholder="optional"></label>
      <div class="full muted small">Now in stock: <b>${qty(p.stock)}</b></div></div>`,
    actions: [{ label: 'Cancel' }, {
      label: 'Save', kind: 'primary', close: false,
      onClick: async (mm) => {
        await rpc('adjustStock', { ...formData(mm.body), product_id: p.id });
        mm.close(); toast('Stock updated', 'ok'); if (done) done();
      },
    }],
  });
  $('[name=kind]', m.body).addEventListener('change', (e) => {
    $('#qlabel', m.body).textContent = e.target.value === 'breakage' ? 'Quantity broken' : 'Correct stock count';
  });
}

async function historyDialog(p, done) {
  const rows = await rpc('stockHistory', p.id);
  const label = { opening: 'Opening stock', purchase: 'Stock in', sale: 'Sold', sale_cancel: 'Sale cancelled', breakage: 'Broken / lost', correction: 'Count correction' };
  const hm = modal({
    title: `Stock history — ${p.name}`, wide: true,
    body: `<table><thead><tr><th>Date</th><th>What</th><th class="r">Qty</th><th>Details</th><th></th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="nowrap">${esc(fmtDate(r.date))}</td><td>${esc(label[r.type] || r.type)}</td>
        <td class="r num ${r.qty < 0 ? 'red' : 'teal'}">${r.qty > 0 ? '+' : ''}${qty(r.qty)}</td>
        <td class="muted">${esc([r.supplier, r.note].filter(Boolean).join(' · '))}${r.edited_at ? '<span class="edited-tag">edited</span>' : ''}</td>
        <td class="r nowrap">${r.type === 'purchase' || r.type === 'opening' ? `<button class="edit-link" data-edit="${r.id}">Edit</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No movements yet.</td></tr>'}
      </tbody></table>`,
    actions: [{ label: 'Close' }],
  });
  hm.body.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-edit]');
    if (!b) return;
    const r = rows.find((x) => x.id === Number(b.dataset.edit));
    editStockInDialog(p, r, () => { hm.close(); historyDialog(p); if (done) done(); });
  });
}

/** Fix a wrongly typed "maal aaya" record. */
function editStockInDialog(p, r, done) {
  modal({
    title: `Edit stock in — ${p.name}`,
    body: `<div class="form-grid">
      <div class="full muted small">Change the quantity or cost that was typed wrongly. Stock is corrected automatically.</div>
      <label class="f"><span>Quantity *</span><input type="number" name="qty" step="any" min="0" value="${r.qty}"></label>
      <label class="f"><span>Cost price (each)</span><input type="number" name="cost_price" step="any" min="0" value="${r.cost_price || ''}"></label>
      <label class="f"><span>Date</span><input type="date" name="date" value="${esc(r.date)}"></label>
      <label class="f"><span>Supplier</span><input type="text" name="supplier" value="${esc(r.supplier || '')}"></label>
      <label class="f full"><span>Note</span><input type="text" name="note" value="${esc(r.note || '')}"></label></div>`,
    actions: [{ label: 'Cancel' }, {
      label: 'Save changes', kind: 'primary', close: false,
      onClick: async (m) => { await rpc('updateStockIn', { ...formData(m.body), id: r.id }); m.close(); toast('Stock entry updated', 'ok'); if (done) done(); },
    }],
  });
}

/* ---------- purchases written on the phone (offline, at the wholesale market) ---------- */
function importFromPhoneDialog(done) {
  const loadWaiting = async (m) => {
    try {
      const list = window.sys.stockSyncWaiting ? await window.sys.stockSyncWaiting() : [];
      if (!list.length) return;
      $('#waitBox', m.body).innerHTML = `<div class="hint-box" style="background:var(--teal-soft);border-radius:10px;padding:10px;margin-bottom:12px"><b>${list.length} list${list.length === 1 ? '' : 's'} sent online from the phone</b>
        ${list.map((w, i) => `<div style="display:flex;justify-content:space-between;gap:8px;align-items:center;margin-top:6px"><span>${esc(fmtDate(w.date))}${w.supplier ? ' · ' + esc(w.supplier) : ''} · ${w.lines} lines</span><button class="btn sm primary" data-wl="${i}">Review this list</button></div>`).join('')}</div>`;
      $('#waitBox', m.body).addEventListener('click', (e) => {
        const b = e.target.closest('[data-wl]');
        if (!b) return;
        $('[name=text]', m.body).value = list[Number(b.dataset.wl)].text;
        toast('List loaded. Press Check.', 'ok');
      });
    } catch (_) { /* online lists just are not shown */ }
  };
  const m = modal({
    title: 'Import purchases from phone',
    wide: true,
    body: `<p style="margin-top:0">On the phone, in <b>Maal Entry</b>, press <b>Send to laptop</b> and send the message to this computer (WhatsApp Web / Desktop, email…).
      Copy the whole message and paste it here, or choose the saved file.</p>
      <div id="waitBox"></div>
      <label class="f"><span>Paste the message here</span><textarea name="text" style="min-height:150px" placeholder="Maal entry — …&#10;CROCKERY-MAAL:…"></textarea></label>
      <label class="f"><span>…or choose a saved file</span><input type="file" name="file" accept=".txt,.json,text/plain"></label>`,
    actions: [{ label: 'Cancel' }, {
      label: 'Check', kind: 'primary', close: false,
      onClick: async (mm) => {
        const text = $('[name=text]', mm.body).value;
        if (!text.trim()) throw new Error('Paste the message first');
        const prev = await rpc('previewPurchaseImport', text);
        mm.close();
        reviewPurchase(text, prev, done);
      },
    }],
  });
  $('[name=file]', m.body).addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (f) $('[name=text]', m.body).value = await f.text();
  });
  loadWaiting(m);
}

async function reviewPurchase(text, prev, done) {
  const products = await rpc('listProducts', { limit: 5000 });
  const opts = (sel) => `<option value="new" ${sel === 'new' ? 'selected' : ''}>＋ Create as NEW product</option>
    <option value="skip" ${sel === 'skip' ? 'selected' : ''}>— Skip this line —</option>
    ${products.map((p) => `<option value="${p.id}" ${String(sel) === String(p.id) ? 'selected' : ''}>${esc(p.name)} (now ${qty(p.stock)})</option>`).join('')}`;
  const rows = prev.lines.map((l) => {
    const sel = l.match ? l.match.id : 'new';
    return `<tr data-i="${l.index}"><td><b>${esc(l.name)}</b>${l.match ? '' : `<div class="small red">New item${l.suggestions.length ? ' — maybe: ' + l.suggestions.map((s) => esc(s.name)).join(', ') : ''}</div>`}</td>
      <td class="r num">${qty(l.qty)}</td><td class="r num">${qty(l.cost)}</td>
      <td style="min-width:260px"><select data-sel>${opts(sel)}</select>
        <input type="number" min="0" step="any" data-sale placeholder="Sale price for the new product" value="${l.sale_price ?? ''}" style="margin-top:6px;${l.match ? 'display:none' : ''}"></td></tr>`;
  }).join('');
  const m = modal({
    title: 'Check before importing',
    wide: true,
    body: `${prev.alreadyImported ? `<div class="banner warn" style="padding:10px 14px;border-radius:8px;margin-bottom:12px">This list was already imported on ${esc(prev.alreadyImported.imported_at.slice(0, 16))}. It cannot be added again.</div>` : ''}
      <div style="margin-bottom:10px"><b>${esc(fmtDate(prev.date))}</b>${prev.supplier ? ' · ' + esc(prev.supplier) : ''} · ${prev.lines.length} items · ${qty(prev.totalQty)} pcs · <b>${money(prev.totalAmount)}</b></div>
      <div class="card table-card"><div class="table-wrap" style="max-height:52vh"><table><thead><tr><th>Item on phone</th><th class="r">Qty</th><th class="r">Cost</th><th>Add to which product?</th></tr></thead><tbody>${rows}</tbody></table></div></div>
      <p class="muted small">Matching items are pre-selected. Stock goes up by the quantity, and the cost price becomes the latest purchase price.</p>`,
    actions: [{ label: 'Cancel' }, {
      label: 'Import now', kind: 'primary', close: false,
      onClick: async (mm) => {
        const decisions = $$('tbody tr', mm.body).map((tr) => {
          const v = $('[data-sel]', tr).value;
          if (v === 'skip') return { action: 'skip' };
          if (v === 'new') return { action: 'new', sale_price: $('[data-sale]', tr).value };
          return { action: 'match', product_id: Number(v) };
        });
        const r = await rpc('applyPurchaseImport', { text, decisions });
        mm.close();
        toast(`Imported ${r.imported} item${r.imported === 1 ? '' : 's'} (${qty(r.totalQty)} pcs)${r.created ? ` · ${r.created} new product${r.created === 1 ? '' : 's'}` : ''}`, 'ok');
        if (done) done();
      },
    }],
  });
  if (prev.alreadyImported) $('footer .btn.primary', m.el).disabled = true;
  m.body.addEventListener('change', (e) => {
    const tr = e.target.closest('tr[data-i]');
    if (tr && e.target.matches('[data-sel]')) $('[data-sale]', tr).style.display = e.target.value === 'new' ? '' : 'none';
  });
}

async function phoneProductListDialog() {
  const { count, text } = await rpc('exportProductsForPhone');
  modal({
    title: 'Product list for the phone',
    body: `<p style="margin-top:0"><b>${count} products.</b> This lets the phone suggest your exact product names while you type in the market, so imports match without mistakes.</p>
      <ol><li>Press <b>Copy</b> (or Save file).</li><li>Send it to your phone (WhatsApp to yourself).</li>
      <li>On the phone: <b>Maal Entry → ⋮ → Product list</b> and paste it.</li></ol>
      <p class="muted small">Do this again whenever you add many new products.</p>`,
    actions: [{ label: 'Close' }, {
      label: 'Save as file', close: false,
      onClick: () => downloadText(`products-for-phone-${today()}.txt`, text),
    }, {
      label: 'Copy', kind: 'primary', close: false,
      onClick: async () => {
        try { await navigator.clipboard.writeText(text); toast('Copied. Send it to your phone.', 'ok'); }
        catch (e) { downloadText(`products-for-phone-${today()}.txt`, text); toast('Could not copy, saved as a file instead', 'ok'); }
      },
    }],
  });
}

function downloadText(filename, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = filename;
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

App.pages.products = {
  title: 'Products & Stock',
  async render(root, arg) {
    const st = App.prodFilter || (App.prodFilter = { q: '', f: '' });
    if (typeof arg === 'string') { st.q = arg; st.f = ''; }
    root.innerHTML = `
      <div class="page-head"><div><h1>Products &amp; Stock</h1><div class="sub" id="sub"></div></div>
        <div class="head-actions"><button class="btn" id="exp">Export CSV</button><button class="btn" id="plist">Product list for phone</button><button class="btn teal" id="imp">Import from phone</button><button class="btn primary" id="add">+ Add product</button></div></div>
      <div class="toolbar">
        <input type="search" id="q" placeholder="Search name, code or category…" class="grow">
        <div class="seg" id="seg"><button data-f="">All</button><button data-f="low">Low stock</button><button data-f="out">Out of stock</button></div>
      </div>
      <div class="card table-card"><div class="table-wrap" style="max-height:calc(100vh - 230px)"><table>
        <thead><tr><th>Code</th><th>Product</th><th>Category</th><th class="r">Cost</th><th class="r">Sale price</th><th class="r">Stock</th><th class="r">Value</th><th></th></tr></thead>
        <tbody id="rows"></tbody></table></div></div>`;
    const el = (id) => $('#' + id, root);
    let rows = [];
    el('q').value = st.q;

    async function load() {
      st.q = el('q').value;
      rows = await rpc('listProducts', { q: st.q, filter: st.f });
      $$('#seg button', root).forEach((b) => b.classList.toggle('on', b.dataset.f === st.f));
      const value = rows.reduce((s, p) => s + (p.stock > 0 ? p.stock * p.cost_price : 0), 0);
      el('sub').textContent = `${rows.length} product${rows.length === 1 ? '' : 's'} · stock value ${money(value)}`;
      el('rows').innerHTML = rows.length ? rows.map((p) => `<tr data-id="${p.id}">
        <td class="muted">${esc(p.code || '')}</td><td><b>${esc(p.name)}</b></td><td class="muted">${esc(p.category || '')}</td>
        <td class="r num">${qty(p.cost_price)}</td><td class="r num">${qty(p.sale_price)}</td>
        <td class="r">${stockBadge(p)} <span class="muted small">${esc(p.unit)}</span></td>
        <td class="r num">${p.stock > 0 ? qty(p.stock * p.cost_price) : '–'}</td>
        <td><div class="actions"><button class="btn sm" data-a="in">Stock in</button><button class="btn sm" data-a="adj">Adjust</button>
          <button class="btn sm" data-a="hist">History</button><button class="btn sm" data-a="edit">Edit</button></div></td></tr>`).join('')
        : `<tr><td colspan="8" class="empty">${st.q || st.f ? 'No products match.' : 'No products yet. Click “Add product” to start.'}</td></tr>`;
    }
    el('q').addEventListener('input', debounce(load, 150));
    el('seg').addEventListener('click', (e) => { if (e.target.dataset.f !== undefined) { st.f = e.target.dataset.f; load(); } });
    el('add').addEventListener('click', () => editProduct(null, load));
    el('imp').addEventListener('click', () => importFromPhoneDialog(load));
    el('plist').addEventListener('click', () => phoneProductListDialog());
    el('exp').addEventListener('click', async () => {
      const r = await rpc('stockReport');
      downloadCsv(`stock-${today()}.csv`, [['Code', 'Product', 'Category', 'Unit', 'Cost price', 'Sale price', 'Stock', 'Stock value'],
        ...r.rows.map((p) => [p.code, p.name, p.category, p.unit, p.cost_price, p.sale_price, p.stock, p.stock > 0 ? p.stock * p.cost_price : 0])]);
    });
    el('rows').addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const p = rows.find((x) => x.id === Number(b.closest('tr').dataset.id));
      ({ in: () => stockInDialog(p, load), adj: () => adjustDialog(p, load), hist: () => historyDialog(p, load), edit: () => editProduct(p, load) })[b.dataset.a]();
    });
    await load();
  },
};
