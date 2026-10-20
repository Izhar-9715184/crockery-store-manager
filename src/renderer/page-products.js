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

async function historyDialog(p) {
  const rows = await rpc('stockHistory', p.id);
  const label = { opening: 'Opening stock', purchase: 'Stock in', sale: 'Sold', sale_cancel: 'Sale cancelled', breakage: 'Broken / lost', correction: 'Count correction' };
  modal({
    title: `Stock history — ${p.name}`, wide: true,
    body: `<table><thead><tr><th>Date</th><th>What</th><th class="r">Qty</th><th>Details</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td class="nowrap">${esc(fmtDate(r.date))}</td><td>${esc(label[r.type] || r.type)}</td>
        <td class="r num ${r.qty < 0 ? 'red' : 'teal'}">${r.qty > 0 ? '+' : ''}${qty(r.qty)}</td>
        <td class="muted">${esc([r.supplier, r.note].filter(Boolean).join(' · '))}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">No movements yet.</td></tr>'}
      </tbody></table>`,
    actions: [{ label: 'Close' }],
  });
}

App.pages.products = {
  title: 'Products & Stock',
  async render(root, arg) {
    const st = App.prodFilter || (App.prodFilter = { q: '', f: '' });
    if (typeof arg === 'string') { st.q = arg; st.f = ''; }
    root.innerHTML = `
      <div class="page-head"><div><h1>Products &amp; Stock</h1><div class="sub" id="sub"></div></div>
        <div class="head-actions"><button class="btn" id="exp">Export CSV</button><button class="btn primary" id="add">+ Add product</button></div></div>
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
    el('exp').addEventListener('click', async () => {
      const r = await rpc('stockReport');
      downloadCsv(`stock-${today()}.csv`, [['Code', 'Product', 'Category', 'Unit', 'Cost price', 'Sale price', 'Stock', 'Stock value'],
        ...r.rows.map((p) => [p.code, p.name, p.category, p.unit, p.cost_price, p.sale_price, p.stock, p.stock > 0 ? p.stock * p.cost_price : 0])]);
    });
    el('rows').addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const p = rows.find((x) => x.id === Number(b.closest('tr').dataset.id));
      ({ in: () => stockInDialog(p, load), adj: () => adjustDialog(p, load), hist: () => historyDialog(p), edit: () => editProduct(p, load) })[b.dataset.a]();
    });
    await load();
  },
};
