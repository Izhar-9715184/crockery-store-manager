'use strict';
/**
 * Business logic: products, stock, customers, sales, udhar (credit) ledger, reports.
 * Every function that changes data runs inside one database transaction, so a
 * sale is either saved completely (stock + ledger + invoice) or not at all.
 */
const crypto = require('crypto');
const { dateStr } = require('./db');
const Packing = require('../../docs/packing.js'); // same code the phone page uses

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;

function fail(msg) {
  throw new Error(msg);
}
function num(v, label, { min = null, allowEmpty = false } = {}) {
  if ((v === '' || v === null || v === undefined) && allowEmpty) return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) fail(`${label} must be a number`);
  if (min !== null && n < min) fail(`${label} cannot be less than ${min}`);
  return n;
}
function date(v, label = 'Date') {
  const d = v || dateStr();
  if (!RE_DATE.test(d)) fail(`${label} is invalid`);
  return d;
}
const clean = (s) => (s === undefined || s === null ? '' : String(s).trim());

function createService(store) {
  const S = {};

  // ------------------------------------------------------------ settings
  // keys starting with "secret_" (e.g. the mobile PIN hash) are never sent to any screen
  S.getSettings = () =>
    Object.fromEntries(
      store.all('SELECT key, value FROM settings')
        .filter((r) => !r.key.startsWith('secret_'))
        .map((r) => [r.key, r.value])
    );

  const ALLOWED_SETTINGS = [
    'shop_name', 'shop_address', 'shop_phone', 'invoice_prefix',
    'allow_negative_stock', 'print_format', 'invoice_footer',
  ];
  S.saveSettings = (obj) =>
    store.tx(() => {
      for (const k of ALLOWED_SETTINGS) {
        if (obj && obj[k] !== undefined) {
          store.run(
            'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
            k, String(obj[k])
          );
        }
      }
      return S.getSettings();
    });

  // ------------------------------------------------------------ products
  S.listProducts = ({ q = '', filter = '', limit = 3000 } = {}) => {
    const where = ['active = 1'];
    const params = [];
    if (clean(q)) {
      where.push('(name LIKE ? OR code LIKE ? OR category LIKE ?)');
      const like = `%${clean(q)}%`;
      params.push(like, like, like);
    }
    if (filter === 'low') where.push('min_stock > 0 AND stock <= min_stock AND stock > 0');
    if (filter === 'out') where.push('stock <= 0');
    return store.all(
      `SELECT * FROM products WHERE ${where.join(' AND ')} ORDER BY name COLLATE NOCASE LIMIT ${Number(limit) | 0}`,
      ...params
    );
  };

  S.listCategories = () =>
    store.all("SELECT DISTINCT category FROM products WHERE active=1 AND category <> '' ORDER BY category")
      .map((r) => r.category);

  S.saveProduct = (p) =>
    store.tx(() => {
      const name = clean(p.name);
      if (!name) fail('Product name is required');
      const code = clean(p.code) || null;
      const row = {
        code,
        name,
        category: clean(p.category),
        unit: clean(p.unit) || 'pcs',
        cost_price: r2(num(p.cost_price, 'Cost price', { min: 0, allowEmpty: true })),
        sale_price: r2(num(p.sale_price, 'Sale price', { min: 0, allowEmpty: true })),
        min_stock: num(p.min_stock, 'Minimum stock', { min: 0, allowEmpty: true }),
      };
      if (code) {
        const dup = store.get('SELECT id FROM products WHERE code = ? AND active = 1 AND id <> ?', code, p.id || 0);
        if (dup) fail(`Product code "${code}" is already used by another product`);
      }
      if (p.id) {
        store.run(
          `UPDATE products SET code=?, name=?, category=?, unit=?, cost_price=?, sale_price=?, min_stock=? WHERE id=?`,
          row.code, row.name, row.category, row.unit, row.cost_price, row.sale_price, row.min_stock, p.id
        );
        return store.get('SELECT * FROM products WHERE id=?', p.id);
      }
      const opening = num(p.stock, 'Opening stock', { min: 0, allowEmpty: true });
      const r = store.run(
        `INSERT INTO products(code,name,category,unit,cost_price,sale_price,stock,min_stock) VALUES(?,?,?,?,?,?,?,?)`,
        row.code, row.name, row.category, row.unit, row.cost_price, row.sale_price, opening, row.min_stock
      );
      if (opening > 0) {
        store.run(
          `INSERT INTO stock_moves(product_id,date,type,qty,cost_price,note) VALUES(?,?,?,?,?,?)`,
          r.id, dateStr(), 'opening', opening, row.cost_price, 'Opening stock'
        );
      }
      return store.get('SELECT * FROM products WHERE id=?', r.id);
    });

  /** Hides the product (history is kept so old invoices stay correct). */
  S.deleteProduct = (id) => {
    store.run('UPDATE products SET active = 0 WHERE id = ?', id);
    return true;
  };

  /** Add purchased stock (maal aaya). */
  S.stockIn = (i) =>
    store.tx(() => {
      const prod = store.get('SELECT * FROM products WHERE id=? AND active=1', i.product_id) || fail('Product not found');
      const qty = num(i.qty, 'Quantity', { min: 0 });
      if (qty <= 0) fail('Quantity must be greater than zero');
      const cost = r2(num(i.cost_price, 'Cost price', { min: 0, allowEmpty: true }));
      store.run(
        `INSERT INTO stock_moves(product_id,date,type,qty,cost_price,supplier,note) VALUES(?,?,?,?,?,?,?)`,
        prod.id, date(i.date), 'purchase', qty, cost || prod.cost_price, clean(i.supplier), clean(i.note)
      );
      store.run('UPDATE products SET stock = stock + ?, cost_price = CASE WHEN ? > 0 THEN ? ELSE cost_price END WHERE id = ?',
        qty, cost, cost, prod.id);
      return store.get('SELECT * FROM products WHERE id=?', prod.id);
    });

  /** kind: 'breakage' (qty removed) or 'correction' (qty = the real counted stock). */
  S.adjustStock = (i) =>
    store.tx(() => {
      const prod = store.get('SELECT * FROM products WHERE id=? AND active=1', i.product_id) || fail('Product not found');
      const qty = num(i.qty, 'Quantity', { min: 0 });
      let delta;
      if (i.kind === 'breakage') {
        if (qty <= 0) fail('Quantity must be greater than zero');
        delta = -qty;
      } else if (i.kind === 'correction') {
        delta = qty - prod.stock;
        if (delta === 0) return prod;
      } else fail('Unknown adjustment type');
      store.run(
        `INSERT INTO stock_moves(product_id,date,type,qty,cost_price,note) VALUES(?,?,?,?,?,?)`,
        prod.id, date(i.date), i.kind, delta, prod.cost_price, clean(i.note)
      );
      store.run('UPDATE products SET stock = stock + ? WHERE id = ?', delta, prod.id);
      return store.get('SELECT * FROM products WHERE id=?', prod.id);
    });

  S.stockHistory = (product_id) =>
    store.all('SELECT * FROM stock_moves WHERE product_id=? ORDER BY date DESC, id DESC LIMIT 300', product_id);

  // ------------------------------------------------------------ customers
  const BALANCE_SQL = `(SELECT COALESCE(SUM(debit)-SUM(credit),0) FROM ledger l WHERE l.customer_id = c.id)`;

  S.listCustomers = ({ q = '', onlyDue = false } = {}) => {
    const where = ['c.active = 1'];
    const params = [];
    if (clean(q)) {
      where.push('(c.name LIKE ? OR c.phone LIKE ? OR c.address LIKE ?)');
      const like = `%${clean(q)}%`;
      params.push(like, like, like);
    }
    let sql = `SELECT c.*, ${BALANCE_SQL} AS balance FROM customers c WHERE ${where.join(' AND ')}`;
    if (onlyDue) sql = `SELECT * FROM (${sql}) WHERE balance > 0.004`;
    sql += onlyDue ? ' ORDER BY balance DESC' : ' ORDER BY name COLLATE NOCASE';
    return store.all(sql, ...params).map((c) => ({ ...c, balance: r2(c.balance) }));
  };

  S.getCustomer = (id) => {
    const c = store.get(`SELECT c.*, ${BALANCE_SQL} AS balance FROM customers c WHERE c.id=?`, id);
    if (c) c.balance = r2(c.balance);
    return c;
  };

  S.saveCustomer = (c) =>
    store.tx(() => {
      const name = clean(c.name);
      if (!name) fail('Customer name is required');
      if (c.id) {
        store.run('UPDATE customers SET name=?, phone=?, address=?, notes=? WHERE id=?',
          name, clean(c.phone), clean(c.address), clean(c.notes), c.id);
        return S.getCustomer(c.id);
      }
      const r = store.run('INSERT INTO customers(name,phone,address,notes) VALUES(?,?,?,?)',
        name, clean(c.phone), clean(c.address), clean(c.notes));
      const opening = r2(num(c.opening_balance, 'Opening udhar', { allowEmpty: true }));
      if (opening !== 0) {
        store.run(
          'INSERT INTO ledger(customer_id,date,type,debit,credit,note) VALUES(?,?,?,?,?,?)',
          r.id, dateStr(), 'opening', opening > 0 ? opening : 0, opening < 0 ? -opening : 0, 'Opening balance'
        );
      }
      return S.getCustomer(r.id);
    });

  S.deleteCustomer = (id) =>
    store.tx(() => {
      const c = S.getCustomer(id) || fail('Customer not found');
      if (Math.abs(c.balance) > 0.004) fail('This customer still has an udhar balance. Clear it first.');
      store.run('UPDATE customers SET active=0 WHERE id=?', id);
      return true;
    });

  S.customerLedger = (id) => {
    const rows = store.all(
      `SELECT l.*, s.invoice_no FROM ledger l LEFT JOIN sales s ON s.id = l.sale_id
       WHERE l.customer_id = ? ORDER BY l.date ASC, l.id ASC`, id);
    let bal = 0;
    for (const r of rows) {
      bal = r2(bal + r.debit - r.credit);
      r.balance = bal;
    }
    return { customer: S.getCustomer(id), entries: rows.reverse() };
  };

  /** Customer pays back some of his udhar. */
  S.receivePayment = (p) =>
    store.tx(() => {
      const cust = S.getCustomer(p.customer_id) || fail('Customer not found');
      const amount = r2(num(p.amount, 'Amount', { min: 0 }));
      if (amount <= 0) fail('Amount must be greater than zero');
      store.run(
        'INSERT INTO ledger(customer_id,date,type,credit,method,note) VALUES(?,?,?,?,?,?)',
        cust.id, date(p.date), 'payment', amount, clean(p.method) || 'cash', clean(p.note)
      );
      return S.getCustomer(cust.id);
    });

  /**
   * Old udhar from the paper register. Picks the customer by id or by name (a new customer is created
   * when the name is not known), and adds the amount to his udhar with the register page as a note.
   */
  S.addOldBalance = (p) =>
    store.tx(() => {
      let cust = null;
      let created = false;
      if (p.customer_id) {
        cust = S.getCustomer(p.customer_id) || fail('Customer not found');
      } else {
        const name = clean(p.name);
        if (!name) fail('Please choose or type the customer name');
        const found = store.get('SELECT id FROM customers WHERE active=1 AND name = ? COLLATE NOCASE ORDER BY id', name);
        if (found) cust = S.getCustomer(found.id);
        else {
          const r = store.run('INSERT INTO customers(name,phone,address,notes) VALUES(?,?,?,?)', name, clean(p.phone), '', '');
          cust = S.getCustomer(r.id);
          created = true;
        }
      }
      const amount = r2(num(p.amount, 'Old balance', { min: 0 }));
      if (amount <= 0) fail('Old balance must be greater than zero');
      const page = clean(p.page);
      const extra = clean(p.note);
      const note = 'Old balance' + (page ? ` · register page ${page}` : '') + (extra ? ` · ${extra}` : '');
      store.run(
        'INSERT INTO ledger(customer_id,date,type,debit,credit,note) VALUES(?,?,?,?,?,?)',
        cust.id, date(p.date), 'opening', amount, 0, note
      );
      return { customer: S.getCustomer(cust.id), created, amount };
    });

  /** Manual correction of a customer's balance (+ increases udhar, - reduces it). */
  S.adjustCustomer = (p) =>
    store.tx(() => {
      const cust = S.getCustomer(p.customer_id) || fail('Customer not found');
      const amount = r2(num(p.amount, 'Amount'));
      if (amount === 0) fail('Amount cannot be zero');
      if (!clean(p.note)) fail('Please write a reason for this correction');
      store.run(
        'INSERT INTO ledger(customer_id,date,type,debit,credit,note) VALUES(?,?,?,?,?,?)',
        cust.id, date(p.date), 'adjust', amount > 0 ? amount : 0, amount < 0 ? -amount : 0, clean(p.note)
      );
      return S.getCustomer(cust.id);
    });

  /**
   * Fix a wrongly typed udhar-register entry: a payment received, an old balance, or a manual correction.
   * (Entries that belong to a bill are fixed by editing the bill.)
   */
  S.updateLedgerEntry = (i) =>
    store.tx(() => {
      const e = store.get('SELECT * FROM ledger WHERE id=?', i.id) || fail('Entry not found');
      if (e.type === 'credit_sale' || e.type === 'sale_cancel') fail('This entry belongs to a bill. Open the bill and use "Edit bill".');
      const amount = r2(num(i.amount, 'Amount'));
      if (amount === 0) fail('Amount cannot be zero');
      let debit = 0, credit = 0;
      if (e.type === 'payment') {
        if (amount < 0) fail('Amount must be greater than zero');
        credit = amount;
      } else if (e.type === 'opening' || e.type === 'adjust') {
        if (e.type === 'adjust' && !clean(i.note)) fail('Please write a reason for this correction');
        if (amount > 0) debit = amount; else credit = -amount;
      } else fail('This entry cannot be edited');
      const d = date(i.date);
      const method = e.type === 'payment' ? (clean(i.method) || e.method || 'cash') : e.method;
      const note = i.note === undefined ? e.note : clean(i.note);
      store.run(`UPDATE ledger SET date=?, debit=?, credit=?, method=?, note=?, edited_at=datetime('now','localtime') WHERE id=?`,
        d, debit, credit, method, note, e.id);
      const pick = (x) => ({ date: x.date, debit: x.debit, credit: x.credit, method: x.method, note: x.note });
      logEdit('ledger', e.id, e.type, pick(e), pick(store.get('SELECT * FROM ledger WHERE id=?', e.id)));
      return S.getCustomer(e.customer_id);
    });

  /** Fix a wrongly entered "maal aaya" (stock in) record: quantity, cost, date, supplier. */
  S.updateStockIn = (i) =>
    store.tx(() => {
      const m = store.get('SELECT * FROM stock_moves WHERE id=?', i.id) || fail('Stock entry not found');
      if (m.type !== 'purchase' && m.type !== 'opening') fail('Only stock-in entries can be edited');
      const prod = store.get('SELECT * FROM products WHERE id=?', m.product_id) || fail('Product not found');
      const q = num(i.qty, 'Quantity', { min: 0 });
      if (q <= 0) fail('Quantity must be greater than zero');
      const cost = r2(num(i.cost_price, 'Cost price', { min: 0, allowEmpty: true }));
      const delta = q - m.qty;
      const settings = S.getSettings();
      if (settings.allow_negative_stock !== '1' && prod.stock + delta < 0) {
        fail(`Cannot reduce to ${q}: part of this stock is already sold. Lowest possible quantity is ${m.qty - prod.stock}`);
      }
      const newCost = cost > 0 ? cost : m.cost_price;
      store.run(`UPDATE stock_moves SET qty=?, cost_price=?, date=?, supplier=?, note=?, edited_at=datetime('now','localtime') WHERE id=?`,
        q, newCost, date(i.date || m.date), i.supplier === undefined ? m.supplier : clean(i.supplier),
        i.note === undefined ? m.note : clean(i.note), m.id);
      store.run('UPDATE products SET stock = stock + ? WHERE id=?', delta, prod.id);
      // the product's cost price follows the newest stock-in
      const latest = store.get(
        `SELECT id, cost_price FROM stock_moves WHERE product_id=? AND type IN ('purchase','opening') ORDER BY (type='purchase') DESC, date DESC, id DESC LIMIT 1`,
        prod.id);
      if (latest && latest.id === m.id && newCost > 0) store.run('UPDATE products SET cost_price=? WHERE id=?', newCost, prod.id);
      const pick = (x) => ({ qty: x.qty, cost_price: x.cost_price, date: x.date, supplier: x.supplier, note: x.note });
      logEdit('stock_in', m.id, prod.name, pick(m), pick(store.get('SELECT * FROM stock_moves WHERE id=?', m.id)));
      return store.get('SELECT * FROM products WHERE id=?', prod.id);
    });

  // ------------------------------------------------------------ sales
  /**
   * Validates a bill and works out its totals (shared by "new sale" and "edit sale").
   * oldCost: product_id -> cost that was stored on the bill being edited (kept, so an edit never changes old profit).
   */
  function prepareSale(input, settings, oldCost = new Map()) {
    const items = Array.isArray(input.items) ? input.items : [];
    if (!items.length) fail('The cart is empty');
    const saleDate = date(input.date);

    let customer = null;
    if (input.customer_id) {
      customer = store.get('SELECT * FROM customers WHERE id=? AND active=1', input.customer_id) || fail('Customer not found');
    }

    // validate lines + stock (same product may appear on several lines)
    const lines = [];
    const need = new Map();
    for (const it of items) {
      const prod = store.get('SELECT * FROM products WHERE id=? AND active=1', it.product_id) || fail('A product in the cart no longer exists');
      const qty = num(it.qty, `Quantity of ${prod.name}`);
      if (qty <= 0) fail(`Quantity of ${prod.name} must be greater than zero`);
      const price = r2(num(it.price, `Price of ${prod.name}`, { min: 0 }));
      lines.push({ prod, qty, price, cost: oldCost.has(prod.id) ? oldCost.get(prod.id) : prod.cost_price });
      need.set(prod.id, (need.get(prod.id) || 0) + qty);
    }
    if (settings.allow_negative_stock !== '1') {
      for (const [pid, q] of need) {
        const p = store.get('SELECT name, stock FROM products WHERE id=?', pid);
        if (p.stock < q) fail(`Not enough stock for "${p.name}" (available ${p.stock}, needed ${q})`);
      }
    }

    const subtotal = r2(lines.reduce((s, l) => s + r2(l.qty * l.price), 0));
    const discount = r2(num(input.discount, 'Discount', { min: 0, allowEmpty: true }));
    if (discount > subtotal) fail('Discount cannot be more than the bill total');
    const total = r2(subtotal - discount);
    const paid = input.paid === undefined || input.paid === null || input.paid === ''
      ? total : r2(num(input.paid, 'Amount received', { min: 0 }));
    if (paid > total + 0.004) fail('Amount received cannot be more than the bill total');
    const due = r2(total - paid);
    if (due > 0 && !customer) fail('Please select a customer for an udhar (credit) sale');
    const cost = r2(lines.reduce((s, l) => s + l.qty * l.cost, 0));
    const profit = r2(total - cost);
    return { saleDate, customer, lines, subtotal, discount, total, paid, due, profit, method: clean(input.method) || 'cash', note: clean(input.note) };
  }

  /** Writes items, stock moves and the udhar row of a bill. */
  function writeSaleBody(saleId, invoice_no, P) {
    for (const l of P.lines) {
      store.run(
        `INSERT INTO sale_items(sale_id,product_id,name,qty,price,cost,total) VALUES(?,?,?,?,?,?,?)`,
        saleId, l.prod.id, l.prod.name, l.qty, l.price, l.cost, r2(l.qty * l.price)
      );
      store.run(
        `INSERT INTO stock_moves(product_id,date,type,qty,cost_price,ref_id,note) VALUES(?,?,?,?,?,?,?)`,
        l.prod.id, P.saleDate, 'sale', -l.qty, l.cost, saleId, invoice_no
      );
      store.run('UPDATE products SET stock = stock - ? WHERE id = ?', l.qty, l.prod.id);
    }
    if (P.due > 0) {
      store.run(
        `INSERT INTO ledger(customer_id,date,type,debit,sale_id,note) VALUES(?,?,?,?,?,?)`,
        P.customer.id, P.saleDate, 'credit_sale', P.due, saleId, `Udhar on ${invoice_no}`
      );
    }
  }

  S.createSale = (input) =>
    store.tx(() => {
      const settings = S.getSettings();
      const P = prepareSale(input, settings);
      const n = Number(settings.next_invoice || 1);
      const invoice_no = `${settings.invoice_prefix || ''}${String(n).padStart(5, '0')}`;
      store.run(`UPDATE settings SET value=? WHERE key='next_invoice'`, String(n + 1));
      const sale = store.run(
        `INSERT INTO sales(invoice_no,date,customer_id,subtotal,discount,total,paid,due,profit,method,note)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        invoice_no, P.saleDate, P.customer ? P.customer.id : null, P.subtotal, P.discount, P.total, P.paid, P.due, P.profit,
        P.method, P.note
      );
      writeSaleBody(sale.id, invoice_no, P);
      return S.getSale(sale.id);
    });

  function logEdit(entity, entity_id, label, before, after) {
    store.run('INSERT INTO edit_log(entity,entity_id,label,before,after) VALUES(?,?,?,?,?)',
      entity, entity_id, label, JSON.stringify(before), JSON.stringify(after));
  }

  /**
   * Correct a saved bill (wrong quantity / price / customer / amount received...).
   * Old stock comes back, the new lines are checked and taken out again, and the udhar row is rebuilt.
   * The invoice number stays the same.
   */
  S.updateSale = (id, input) =>
    store.tx(() => {
      const old = S.getSale(id) || fail('Sale not found');
      if (old.status !== 'active') fail('A cancelled bill cannot be edited');
      const settings = S.getSettings();
      const oldCost = new Map();
      for (const it of old.items) if (!oldCost.has(it.product_id)) oldCost.set(it.product_id, it.cost);
      // give the old goods back first, so the stock check sees the true available stock
      for (const it of old.items) store.run('UPDATE products SET stock = stock + ? WHERE id = ?', it.qty, it.product_id);
      const P = prepareSale(input, settings, oldCost);
      store.run('DELETE FROM sale_items WHERE sale_id=?', id);
      store.run(`DELETE FROM stock_moves WHERE type='sale' AND ref_id=?`, id);
      store.run(`DELETE FROM ledger WHERE type='credit_sale' AND sale_id=?`, id);
      store.run(
        `UPDATE sales SET date=?, customer_id=?, subtotal=?, discount=?, total=?, paid=?, due=?, profit=?, method=?, note=?,
           edited_at=datetime('now','localtime') WHERE id=?`,
        P.saleDate, P.customer ? P.customer.id : null, P.subtotal, P.discount, P.total, P.paid, P.due, P.profit, P.method, P.note, id
      );
      writeSaleBody(id, old.invoice_no, P);
      const pick = (x) => ({ date: x.date, customer_id: x.customer_id, total: x.total, discount: x.discount, paid: x.paid, due: x.due,
        items: x.items.map((i) => ({ product_id: i.product_id, name: i.name, qty: i.qty, price: i.price })) });
      const now = S.getSale(id);
      logEdit('sale', id, old.invoice_no, pick(old), pick(now));
      return now;
    });

  S.getSale = (id) => {
    const sale = store.get(
      `SELECT s.*, c.name AS customer_name, c.phone AS customer_phone, c.address AS customer_address
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id WHERE s.id = ?`, id);
    if (!sale) return null;
    sale.items = store.all('SELECT * FROM sale_items WHERE sale_id=? ORDER BY id', id);
    if (sale.customer_id) sale.customer_balance = S.getCustomer(sale.customer_id).balance;
    return sale;
  };

  S.listSales = ({ from, to, q = '', customer_id = null, status = '', limit = 500 } = {}) => {
    const where = ['1=1'];
    const params = [];
    if (from) { where.push('s.date >= ?'); params.push(date(from)); }
    if (to) { where.push('s.date <= ?'); params.push(date(to)); }
    if (customer_id) { where.push('s.customer_id = ?'); params.push(customer_id); }
    if (status) { where.push('s.status = ?'); params.push(status); }
    if (clean(q)) {
      where.push('(s.invoice_no LIKE ? OR c.name LIKE ?)');
      params.push(`%${clean(q)}%`, `%${clean(q)}%`);
    }
    return store.all(
      `SELECT s.*, c.name AS customer_name FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE ${where.join(' AND ')} ORDER BY s.date DESC, s.id DESC LIMIT ${Number(limit) | 0}`,
      ...params
    );
  };

  /** Cancel a wrongly entered sale: stock returns and udhar is reversed. */
  S.cancelSale = (id, reason) =>
    store.tx(() => {
      const sale = S.getSale(id) || fail('Sale not found');
      if (sale.status !== 'active') fail('This sale is already cancelled');
      if (!clean(reason)) fail('Please write a reason for cancelling');
      store.run(`UPDATE sales SET status='cancelled', cancelled_at=datetime('now','localtime'), cancel_reason=? WHERE id=?`,
        clean(reason), id);
      for (const it of sale.items) {
        store.run(
          `INSERT INTO stock_moves(product_id,date,type,qty,cost_price,ref_id,note) VALUES(?,?,?,?,?,?,?)`,
          it.product_id, dateStr(), 'sale_cancel', it.qty, it.cost, id, `Cancelled ${sale.invoice_no}`
        );
        store.run('UPDATE products SET stock = stock + ? WHERE id = ?', it.qty, it.product_id);
      }
      if (sale.due > 0 && sale.customer_id) {
        store.run(
          `INSERT INTO ledger(customer_id,date,type,credit,sale_id,note) VALUES(?,?,?,?,?,?)`,
          sale.customer_id, dateStr(), 'sale_cancel', sale.due, id, `Cancelled ${sale.invoice_no}`
        );
      }
      return S.getSale(id);
    });

  // ------------------------------------------------------------ reports
  function range(from, to) {
    const f = date(from);
    const t = date(to || from);
    if (t < f) fail('"To" date is before "From" date');
    return [f, t];
  }

  S.summary = (from, to) => {
    const [f, t] = range(from, to);
    const tot = store.get(
      `SELECT COUNT(*) AS bills, COALESCE(SUM(subtotal),0) AS gross, COALESCE(SUM(discount),0) AS discount,
              COALESCE(SUM(total),0) AS sales, COALESCE(SUM(paid),0) AS paid_on_sale,
              COALESCE(SUM(due),0) AS udhar_given, COALESCE(SUM(profit),0) AS profit
       FROM sales WHERE status='active' AND date BETWEEN ? AND ?`, f, t);
    const rec = store.get(
      `SELECT COALESCE(SUM(credit),0) AS recovered, COUNT(*) AS n FROM ledger
       WHERE type='payment' AND date BETWEEN ? AND ?`, f, t);
    const cancelled = store.get(
      `SELECT COUNT(*) AS n FROM sales WHERE status='cancelled' AND date BETWEEN ? AND ?`, f, t).n;
    const items = store.get(
      `SELECT COALESCE(SUM(si.qty),0) AS qty FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.status='active' AND s.date BETWEEN ? AND ?`, f, t).qty;

    const perDay = store.all(
      `SELECT date, COUNT(*) AS bills, SUM(total) AS sales, SUM(paid) AS paid, SUM(due) AS udhar, SUM(profit) AS profit
       FROM sales WHERE status='active' AND date BETWEEN ? AND ? GROUP BY date ORDER BY date DESC`, f, t);
    const recPerDay = Object.fromEntries(
      store.all(`SELECT date, SUM(credit) AS amt FROM ledger WHERE type='payment' AND date BETWEEN ? AND ? GROUP BY date`, f, t)
        .map((r) => [r.date, r.amt]));
    for (const d of perDay) d.recovered = recPerDay[d.date] || 0;

    const topProducts = store.all(
      `SELECT si.name, SUM(si.qty) AS qty, SUM(si.total) AS revenue
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE s.status='active' AND s.date BETWEEN ? AND ?
       GROUP BY si.product_id ORDER BY revenue DESC LIMIT 10`, f, t);

    const payments = store.all(
      `SELECT l.*, c.name AS customer_name FROM ledger l JOIN customers c ON c.id = l.customer_id
       WHERE l.type='payment' AND l.date BETWEEN ? AND ? ORDER BY l.date DESC, l.id DESC`, f, t);

    return {
      from: f, to: t,
      bills: tot.bills, gross: r2(tot.gross), discount: r2(tot.discount), sales: r2(tot.sales),
      paid_on_sale: r2(tot.paid_on_sale), udhar_given: r2(tot.udhar_given), profit: r2(tot.profit),
      recovered: r2(rec.recovered), cash_in: r2(tot.paid_on_sale + rec.recovered),
      cancelled, items_qty: items, perDay, topProducts, payments,
    };
  };

  S.stockReport = () => {
    const rows = store.all(
      `SELECT id, code, name, category, unit, cost_price, sale_price, stock, min_stock,
              stock * cost_price AS value FROM products WHERE active = 1 ORDER BY name COLLATE NOCASE`);
    return {
      rows,
      totalValue: r2(rows.reduce((s, r) => s + (r.stock > 0 ? r.value : 0), 0)),
      totalQty: rows.reduce((s, r) => s + (r.stock > 0 ? r.stock : 0), 0),
    };
  };

  S.dashboard = () => {
    const today = dateStr();
    const todaySum = S.summary(today, today);
    const outstanding = r2(S.listCustomers({ onlyDue: true }).reduce((s, c) => s + c.balance, 0));
    const topDebtors = S.listCustomers({ onlyDue: true }).slice(0, 6);
    const lowStock = store.all(
      `SELECT id, name, stock, min_stock, unit FROM products
       WHERE active = 1 AND ((min_stock > 0 AND stock <= min_stock) OR stock <= 0)
       ORDER BY stock ASC, name LIMIT 50`);
    const stockValue = S.stockReport().totalValue;

    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(dateStr(d));
    }
    const byDay = Object.fromEntries(
      store.all(`SELECT date, SUM(total) AS sales FROM sales WHERE status='active' AND date BETWEEN ? AND ? GROUP BY date`,
        days[0], days[6]).map((r) => [r.date, r.sales]));
    const last7 = days.map((d) => ({ date: d, sales: r2(byDay[d] || 0) }));

    return { today, todaySum, outstanding, topDebtors, lowStock, stockValue, last7 };
  };

  // ------------------------------------------------------------ backups
  S.listBackups = () => store.listBackups();
  S.createBackup = () => {
    const p = store.backup('manual');
    return { path: p };
  };
  // ------------------------------------------------------------ mobile access (PIN)
  const rawSetting = (k) => (store.get('SELECT value FROM settings WHERE key=?', k) || {}).value;
  const putSetting = (k, v) =>
    store.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v));
  const scrypt = (pin, saltHex) => crypto.scryptSync(String(pin), Buffer.from(saltHex, 'hex'), 32);

  S.getMobileConfig = () => ({
    enabled: rawSetting('mobile_enabled') === '1',
    port: Number(rawSetting('mobile_port') || 8765),
    hasPin: !!rawSetting('secret_mobile_pin_hash'),
  });

  /** Turn mobile access on/off, change the port, or set a new PIN (min 6 characters). */
  S.setMobileAccess = ({ enabled, port, pin } = {}) =>
    store.tx(() => {
      if (port !== undefined && port !== '' && port !== null) {
        const p = Number(port);
        if (!Number.isInteger(p) || p < 1024 || p > 65535) fail('Port must be a number between 1024 and 65535');
        putSetting('mobile_port', p);
      }
      if (pin !== undefined && pin !== '' && pin !== null) {
        const pinStr = String(pin);
        if (pinStr.length < 6) fail('The PIN must be at least 6 characters');
        const salt = crypto.randomBytes(16).toString('hex');
        putSetting('secret_mobile_pin_salt', salt);
        putSetting('secret_mobile_pin_hash', scrypt(pinStr, salt).toString('hex'));
      }
      if (enabled !== undefined) {
        if (enabled && !rawSetting('secret_mobile_pin_hash')) fail('Set a PIN first');
        putSetting('mobile_enabled', enabled ? '1' : '0');
      }
      return S.getMobileConfig();
    });

  S.checkMobilePin = (pin) => {
    const salt = rawSetting('secret_mobile_pin_salt');
    const hash = rawSetting('secret_mobile_pin_hash');
    if (!salt || !hash) return false;
    return crypto.timingSafeEqual(scrypt(pin, salt), Buffer.from(hash, 'hex'));
  };
  /** Changes whenever the PIN changes -> old phone logins stop working. */
  S.mobilePinFingerprint = () => rawSetting('secret_mobile_pin_hash') || '';

  // ------------------------------------------------------------ purchases entered on the phone
  // The phone page works offline in the wholesale market and produces one text
  // message (see docs/packing.js). Here it is checked, matched to products and
  // turned into "stock in" entries.
  const PREFIX_MAAL = 'CROCKERY-MAAL';
  const PREFIX_PRODUCTS = 'CROCKERY-PRODUCTS';
  const normName = (s) => clean(s).toLowerCase().replace(/\s+/g, ' ');

  function readBatch(text) {
    const b = Packing.unpack(text, PREFIX_MAAL);
    if (!b || b.v !== 1 || !Array.isArray(b.lines)) fail('This is not a purchase list from the phone');
    if (typeof b.id !== 'string' || !/^[A-Za-z0-9_-]{4,64}$/.test(b.id)) fail('This list has no valid number');
    if (!RE_DATE.test(String(b.date || ''))) fail('The date in this list is invalid');
    if (b.lines.length < 1 || b.lines.length > 500) fail('A list must have between 1 and 500 lines');
    const lines = b.lines.map((l, i) => {
      const name = clean(l.n).slice(0, 200);
      const q = Number(l.q);
      const c = Number(l.c);
      const s = l.s === undefined || l.s === null || l.s === '' ? null : Number(l.s);
      if (!name) fail(`Line ${i + 1}: product name is missing`);
      if (!Number.isFinite(q) || q <= 0 || q > 1e6) fail(`Line ${i + 1} (${name}): quantity is invalid`);
      if (!Number.isFinite(c) || c < 0 || c > 1e9) fail(`Line ${i + 1} (${name}): cost price is invalid`);
      if (s !== null && (!Number.isFinite(s) || s < 0 || s > 1e9)) fail(`Line ${i + 1} (${name}): sale price is invalid`);
      return { name, qty: q, cost: r2(c), sale_price: s === null ? null : r2(s) };
    });
    return { id: b.id, date: b.date, supplier: clean(b.supplier).slice(0, 100), lines };
  }

  function findProduct(products, name) {
    const n = normName(name);
    return products.find((p) => normName(p.name) === n) || products.find((p) => p.code && normName(p.code) === n) || null;
  }

  /** Checks the message and shows what would happen. Changes nothing. */
  S.previewPurchaseImport = (text) => {
    const batch = readBatch(text);
    const products = store.all('SELECT id, code, name, stock, cost_price, sale_price FROM products WHERE active = 1 ORDER BY name COLLATE NOCASE');
    const done = store.get('SELECT * FROM purchase_imports WHERE id = ?', batch.id);
    const lines = batch.lines.map((l, index) => {
      const match = findProduct(products, l.name);
      const n = normName(l.name);
      const suggestions = match ? [] : products
        .filter((p) => n.length >= 3 && (normName(p.name).includes(n) || n.includes(normName(p.name))))
        .slice(0, 3).map((p) => ({ id: p.id, name: p.name }));
      return { index, ...l, match, suggestions };
    });
    return {
      id: batch.id, date: batch.date, supplier: batch.supplier,
      alreadyImported: done ? { imported_at: done.imported_at } : null,
      lines,
      totalQty: lines.reduce((s, l) => s + l.qty, 0),
      totalAmount: r2(lines.reduce((s, l) => s + l.qty * l.cost, 0)),
    };
  };

  /**
   * decisions[i] = { action: 'match', product_id } | { action: 'new', sale_price? } | { action: 'skip' }
   * Everything happens in one transaction, and the list is remembered so it cannot be imported twice.
   */
  S.applyPurchaseImport = ({ text, decisions }) =>
    store.tx(() => {
      const batch = readBatch(text);
      const done = store.get('SELECT * FROM purchase_imports WHERE id = ?', batch.id);
      if (done) fail(`This list was already imported on ${done.imported_at.slice(0, 16)}. Nothing was added again.`);
      if (!Array.isArray(decisions) || decisions.length !== batch.lines.length) fail('Please review every line before importing');
      let created = 0;
      let skipped = 0;
      let qtyAdded = 0;
      let amount = 0;
      batch.lines.forEach((l, i) => {
        const d = decisions[i] || {};
        if (d.action === 'skip') { skipped++; return; }
        let productId;
        if (d.action === 'match') {
          productId = Number(d.product_id);
          if (!store.get('SELECT id FROM products WHERE id = ? AND active = 1', productId)) fail(`Line ${i + 1}: the chosen product no longer exists`);
        } else if (d.action === 'new') {
          const sale = d.sale_price === undefined || d.sale_price === '' || d.sale_price === null ? l.sale_price : Number(d.sale_price);
          productId = S.saveProduct({ name: l.name, cost_price: l.cost, sale_price: sale === null || sale === undefined ? 0 : sale, stock: 0 }).id;
          created++;
        } else fail(`Line ${i + 1}: please choose what to do`);
        S.stockIn({ product_id: productId, qty: l.qty, cost_price: l.cost, supplier: batch.supplier, date: batch.date, note: `Phone list ${batch.id}` });
        qtyAdded += l.qty;
        amount += l.qty * l.cost;
      });
      if (skipped === batch.lines.length) fail('Every line was skipped, so there is nothing to import');
      store.run(
        'INSERT INTO purchase_imports(id,batch_date,supplier,lines,total_qty,total_amount) VALUES(?,?,?,?,?,?)',
        batch.id, batch.date, batch.supplier, batch.lines.length - skipped, qtyAdded, r2(amount)
      );
      return { imported: batch.lines.length - skipped, skipped, created, totalQty: qtyAdded, totalAmount: r2(amount) };
    });

  S.listPurchaseImports = () => store.all('SELECT * FROM purchase_imports ORDER BY imported_at DESC LIMIT 50');

  /** Product names for the phone page's suggestion list. Returns one line of text. */
  S.exportProductsForPhone = () => {
    const items = store.all('SELECT name, code, cost_price, sale_price, stock, unit FROM products WHERE active = 1 ORDER BY name COLLATE NOCASE')
      .map((p) => ({ n: p.name, k: p.code || '', c: p.cost_price, s: p.sale_price, q: p.stock, u: p.unit || '' }));
    // "at" = the day this stock count was taken, so the phone can say how old the numbers are
    return { count: items.length, text: Packing.pack(PREFIX_PRODUCTS, { v: 1, at: dateStr(), items }) };
  };

  S.dbInfo = () => ({
    file: store.file,
    folder: store.dir,
    backupsFolder: store.backupsDir,
    recovered: store.recovered,
    counts: {
      products: store.get('SELECT COUNT(*) AS n FROM products WHERE active=1').n,
      customers: store.get('SELECT COUNT(*) AS n FROM customers WHERE active=1').n,
      sales: store.get('SELECT COUNT(*) AS n FROM sales').n,
    },
  });

  return S;
}

module.exports = { createService };
