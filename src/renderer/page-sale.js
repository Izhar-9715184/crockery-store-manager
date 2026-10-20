'use strict';
/* New Sale screen: search products on the left, bill on the right. */
App.pages.sale = {
  title: 'New Sale',
  async render(root) {
    if (!App.cart) App.cart = { items: [], customer_id: '', discount: '', paid: null, method: 'cash', note: '', date: today() };
    const cart = App.cart;
    if (!cart.date) cart.date = today();
    let customers = await rpc('listCustomers', {});
    let products = [];
    let customerFilter = '';

    root.innerHTML = `
      <div class="sale-layout">
        <section class="sale-left">
          <input type="search" id="q" class="search-big" placeholder="Search product by name or code… (press Enter to add the first result)" autocomplete="off">
          <div class="card results"><div id="results"></div></div>
        </section>
        <section class="sale-right">
          <div class="card">
            <div class="sale-top">
              <div class="row"><label class="f"><span>Date</span><input type="date" id="date"></label>
                <label class="f"><span>Customer</span>
                  <div style="display:flex;gap:6px"><select id="customer"></select><button class="btn" id="newCust" title="Add new customer">+</button></div></label></div>
              <div id="custInfo" class="cust-balance"></div>
            </div>
            <div class="cart" id="cart"></div>
            <div class="cart-foot">
              <div class="sum-row"><span>Subtotal</span><span id="subtotal" class="num">Rs 0</span></div>
              <div class="sum-row"><span>Discount</span><input type="number" id="discount" min="0" step="any" placeholder="0"></div>
              <div class="sum-row total"><span>Total</span><span id="total" class="num">Rs 0</span></div>
              <div class="sum-row"><span>Amount received</span><input type="number" id="paid" min="0" step="any"></div>
              <div class="sum-row"><span class="muted small quick"><button class="btn sm" id="fullPaid">Full payment</button><button class="btn sm" id="allUdhar">All udhar</button></span>
                <span>Udhar: <b id="due" class="num">Rs 0</b></span></div>
              <div class="sum-row"><select id="method" style="width:auto">
                  <option value="cash">Cash</option><option value="bank">Bank transfer</option>
                  <option value="wallet">EasyPaisa / JazzCash</option><option value="cheque">Cheque</option></select>
                <input type="text" id="note" placeholder="Note (optional)" style="width:230px;text-align:left"></div>
              <div style="display:flex;gap:8px;margin-top:10px">
                <button class="btn" id="clear">Clear</button>
                <button class="btn teal grow" id="save" style="flex:1">Save</button>
                <button class="btn primary" id="savePrint" style="flex:1.3">Save &amp; Print</button>
              </div>
            </div>
          </div>
        </section>
      </div>`;

    const el = (id) => $('#' + id, root);
    const subtotal = () => cart.items.reduce((s, i) => s + (Number(i.qty) || 0) * (Number(i.price) || 0), 0);
    const totalAmt = () => Math.max(0, subtotal() - (Number(cart.discount) || 0));
    const paidAmt = () => (cart.paid === null || cart.paid === '' ? totalAmt() : Number(cart.paid) || 0);

    // ----- customers dropdown
    function drawCustomers() {
      el('customer').innerHTML = `<option value="">Walk-in customer</option>` + customers.map((c) =>
        `<option value="${c.id}" ${String(c.id) === String(cart.customer_id) ? 'selected' : ''}>${esc(c.name)}${c.phone ? ' · ' + esc(c.phone) : ''}${c.balance > 0 ? '  (udhar ' + qty(c.balance) + ')' : ''}</option>`).join('');
      const c = customers.find((x) => String(x.id) === String(cart.customer_id));
      el('custInfo').textContent = c && c.balance > 0 ? `Previous udhar: ${money(c.balance)}` : '';
    }

    // ----- product list
    function rowHtml(p, first) {
      return `<div class="prod-row ${first ? 'first' : ''} ${p.stock <= 0 ? 'noStock' : ''}" data-add="${p.id}">
        <div><div class="nm">${esc(p.name)}</div><div class="muted small">${esc([p.code, p.category].filter(Boolean).join(' · '))}</div></div>
        <div class="r num">${money(p.sale_price)}</div>
        <div class="r"><span class="badge ${p.stock <= 0 ? 'out' : p.min_stock > 0 && p.stock <= p.min_stock ? 'low' : 'ok'}">${qty(p.stock)} ${esc(p.unit)}</span></div></div>`;
    }
    async function search() {
      products = await rpc('listProducts', { q: el('q').value, limit: 60 });
      el('results').innerHTML = products.length
        ? products.map((p, i) => rowHtml(p, i === 0 && el('q').value.trim() !== '')).join('')
        : `<div class="empty">No product found. Add it from the Products screen.</div>`;
    }

    function addProduct(p) {
      const line = cart.items.find((i) => i.product_id === p.id);
      if (line) line.qty = Number(line.qty) + 1;
      else cart.items.push({ product_id: p.id, name: p.name, qty: 1, price: p.sale_price, stock: p.stock, unit: p.unit });
      draw();
    }

    // ----- cart
    function drawCart() {
      el('cart').innerHTML = cart.items.length ? `<table><thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Amount</th><th></th></tr></thead><tbody>
        ${cart.items.map((i, idx) => `<tr data-idx="${idx}"><td>${esc(i.name)}<div class="muted small">${qty(i.stock)} in stock</div></td>
          <td class="r"><input class="qty" type="number" min="0" step="any" value="${i.qty}" data-f="qty"></td>
          <td class="r"><input class="price" type="number" min="0" step="any" value="${i.price}" data-f="price"></td>
          <td class="r num" data-line>${qty((Number(i.qty) || 0) * (Number(i.price) || 0))}</td>
          <td><button class="icon-btn" data-del title="Remove">×</button></td></tr>`).join('')}</tbody></table>`
        : `<div class="empty">Click a product on the left to add it to the bill.</div>`;
    }
    function drawTotals() {
      const total = totalAmt();
      const paid = paidAmt();
      el('subtotal').textContent = money(subtotal());
      el('total').textContent = money(total);
      el('paid').value = cart.paid === null ? (total ? String(total) : '') : cart.paid;
      const due = Math.max(0, total - paid);
      el('due').textContent = money(due);
      el('due').className = 'num ' + (due > 0 ? 'red' : '');
    }
    function draw() {
      drawCart();
      drawTotals();
    }

    // ----- events
    el('q').addEventListener('input', debounce(search, 120));
    el('q').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && products.length && el('q').value.trim()) {
        addProduct(products[0]);
        el('q').select();
      }
    });
    el('results').addEventListener('click', (e) => {
      const r = e.target.closest('[data-add]');
      if (r) addProduct(products.find((p) => p.id === Number(r.dataset.add)));
    });
    el('cart').addEventListener('input', (e) => {
      const tr = e.target.closest('tr[data-idx]');
      if (!tr || !e.target.dataset.f) return;
      cart.items[Number(tr.dataset.idx)][e.target.dataset.f] = e.target.value;
      $('[data-line]', tr).textContent = qty((Number(cart.items[Number(tr.dataset.idx)].qty) || 0) * (Number(cart.items[Number(tr.dataset.idx)].price) || 0));
      drawTotals();
    });
    el('cart').addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      if (del) { cart.items.splice(Number(del.closest('tr').dataset.idx), 1); draw(); }
    });
    el('date').value = cart.date;
    el('date').addEventListener('change', () => { cart.date = el('date').value; });
    el('discount').value = cart.discount;
    el('discount').addEventListener('input', () => { cart.discount = el('discount').value; drawTotals(); });
    el('paid').addEventListener('input', () => { cart.paid = el('paid').value; const due = Math.max(0, totalAmt() - paidAmt()); el('due').textContent = money(due); el('due').className = 'num ' + (due > 0 ? 'red' : ''); });
    el('fullPaid').addEventListener('click', () => { cart.paid = null; drawTotals(); });
    el('allUdhar').addEventListener('click', () => { cart.paid = '0'; drawTotals(); });
    el('method').value = cart.method;
    el('method').addEventListener('change', () => { cart.method = el('method').value; });
    el('note').value = cart.note;
    el('note').addEventListener('input', () => { cart.note = el('note').value; });
    el('customer').addEventListener('change', () => { cart.customer_id = el('customer').value; drawCustomers(); });
    el('newCust').addEventListener('click', () => editCustomer(null, async (c) => {
      customers = await rpc('listCustomers', {});
      cart.customer_id = String(c.id);
      drawCustomers();
    }));
    el('clear').addEventListener('click', async () => {
      if (cart.items.length && !(await confirmBox('Clear the whole bill?', { okLabel: 'Clear' }))) return;
      App.cart = null;
      App.go('sale');
    });

    async function save(print) {
      await safe(async () => {
        const sale = await rpc('createSale', {
          date: cart.date,
          customer_id: cart.customer_id ? Number(cart.customer_id) : null,
          items: cart.items.map((i) => ({ product_id: i.product_id, qty: Number(i.qty), price: Number(i.price) })),
          discount: cart.discount === '' ? 0 : Number(cart.discount),
          paid: cart.paid === null || cart.paid === '' ? undefined : Number(cart.paid),
          method: cart.method,
          note: cart.note,
        });
        toast(`Saved ${sale.invoice_no} · ${money(sale.total)}${sale.due > 0 ? ' · udhar ' + money(sale.due) : ''}`, 'ok');
        if (print) printHtml(invoiceHtml(sale));
        App.cart = null;
        App.go('sale');
      });
    }
    el('save').addEventListener('click', () => save(false));
    el('savePrint').addEventListener('click', () => save(true));

    drawCustomers();
    draw();
    await search();
    el('q').focus();
  },
};
