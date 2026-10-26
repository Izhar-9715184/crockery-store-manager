'use strict';
// Editing mistakes: udhar entries, bills and stock-in records.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/core/db');
const { createService } = require('../src/core/service');

const fresh = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crockery-edit-'));
  const store = new Store(dir);
  const svc = createService(store);
  const plate = svc.saveProduct({ name: 'Plate', cost_price: 100, sale_price: 150, stock: 0 });
  const cup = svc.saveProduct({ name: 'Cup', cost_price: 40, sale_price: 70, stock: 0 });
  svc.stockIn({ product_id: plate.id, qty: 20, cost_price: 100 });
  svc.stockIn({ product_id: cup.id, qty: 10, cost_price: 40 });
  const ali = svc.saveCustomer({ name: 'Ali' });
  const bob = svc.saveCustomer({ name: 'Bob' });
  return { store, svc, plate, cup, ali, bob };
};
const stock = (t, p) => t.svc.getProduct ? t.svc.getProduct(p.id).stock : t.store.get('SELECT stock FROM products WHERE id=?', p.id).stock;
const bal = (t, c) => t.svc.getCustomer(c.id).balance;

test('migration v3 adds edited_at + edit_log', () => {
  const t = fresh();
  assert.ok(t.store.get(`SELECT name FROM sqlite_master WHERE name='edit_log'`));
  assert.equal(t.store.get('PRAGMA user_version').user_version >= 3, true);
});

test('ledger: wrong payment amount can be fixed, balance follows', () => {
  const t = fresh();
  t.svc.addOldBalance({ customer_id: t.ali.id, amount: 5000 });
  t.svc.receivePayment({ customer_id: t.ali.id, amount: 5000 }); // typo, meant 500
  assert.equal(bal(t, t.ali), 0);
  const e = t.svc.customerLedger(t.ali.id).entries.find((x) => x.type === 'payment');
  const c = t.svc.updateLedgerEntry({ id: e.id, amount: 500, date: e.date });
  assert.equal(c.balance, 4500);
  const after = t.svc.customerLedger(t.ali.id).entries.find((x) => x.type === 'payment');
  assert.ok(after.edited_at);
  assert.equal(t.store.all('SELECT * FROM edit_log').length, 1);
});

test('ledger: old balance can change sign/amount; adjust needs a reason; zero and bill rows refused', () => {
  const t = fresh();
  t.svc.addOldBalance({ customer_id: t.ali.id, amount: 900 });
  const o = t.svc.customerLedger(t.ali.id).entries[0];
  assert.equal(t.svc.updateLedgerEntry({ id: o.id, amount: 1200, date: o.date }).balance, 1200);
  assert.throws(() => t.svc.updateLedgerEntry({ id: o.id, amount: 0, date: o.date }), /zero/);
  t.svc.adjustCustomer({ customer_id: t.ali.id, amount: 100, note: 'x' });
  const a = t.svc.customerLedger(t.ali.id).entries[0];
  assert.throws(() => t.svc.updateLedgerEntry({ id: a.id, amount: 50, note: '' }), /reason/);
  assert.equal(t.svc.updateLedgerEntry({ id: a.id, amount: -50, note: 'fix' }).balance, 1150);
  const s = t.svc.createSale({ customer_id: t.bob.id, items: [{ product_id: t.plate.id, qty: 1, price: 150 }], paid: 0 });
  const row = t.svc.customerLedger(t.bob.id).entries[0];
  assert.throws(() => t.svc.updateLedgerEntry({ id: row.id, amount: 1 }), /bill/);
  assert.ok(s.id);
});

test('sale: edit qty/price/paid — stock, udhar, profit and invoice no. are right', () => {
  const t = fresh();
  const s = t.svc.createSale({ customer_id: t.ali.id, items: [{ product_id: t.plate.id, qty: 5, price: 150 }], paid: 0 });
  assert.equal(stock(t, t.plate), 15);
  assert.equal(bal(t, t.ali), 750);
  const u = t.svc.updateSale(s.id, { date: s.date, customer_id: t.ali.id, items: [{ product_id: t.plate.id, qty: 3, price: 160 }, { product_id: t.cup.id, qty: 2, price: 70 }], paid: 100 });
  assert.equal(u.invoice_no, s.invoice_no);
  assert.equal(u.total, 620);
  assert.equal(u.due, 520);
  assert.equal(u.profit, 620 - 300 - 80);
  assert.ok(u.edited_at);
  assert.equal(stock(t, t.plate), 17);
  assert.equal(stock(t, t.cup), 8);
  assert.equal(bal(t, t.ali), 520);
  assert.equal(t.store.all(`SELECT * FROM stock_moves WHERE type='sale' AND ref_id=?`, s.id).length, 2);
  // fully paid now -> no udhar row left
  t.svc.updateSale(s.id, { date: s.date, customer_id: t.ali.id, items: [{ product_id: t.plate.id, qty: 3, price: 160 }] });
  assert.equal(bal(t, t.ali), 0);
  assert.equal(stock(t, t.cup), 10);
  assert.equal(t.store.all('SELECT * FROM edit_log WHERE entity=?', 'sale').length, 2);
});

test('sale: changing the customer moves the udhar; failure rolls everything back; cancelled refused', () => {
  const t = fresh();
  const s = t.svc.createSale({ customer_id: t.ali.id, items: [{ product_id: t.plate.id, qty: 2, price: 150 }], paid: 0 });
  t.svc.updateSale(s.id, { date: s.date, customer_id: t.bob.id, items: [{ product_id: t.plate.id, qty: 2, price: 150 }], paid: 0 });
  assert.equal(bal(t, t.ali), 0);
  assert.equal(bal(t, t.bob), 300);
  // too many -> rolled back
  assert.throws(() => t.svc.updateSale(s.id, { date: s.date, customer_id: t.bob.id, items: [{ product_id: t.plate.id, qty: 99, price: 150 }], paid: 0 }), /Not enough stock/);
  assert.equal(stock(t, t.plate), 18);
  assert.equal(bal(t, t.bob), 300);
  assert.equal(t.svc.getSale(s.id).items[0].qty, 2);
  // may sell up to what was there before + what the bill already held
  t.svc.updateSale(s.id, { date: s.date, customer_id: t.bob.id, items: [{ product_id: t.plate.id, qty: 20, price: 150 }], paid: 3000 });
  assert.equal(stock(t, t.plate), 0);
  t.svc.cancelSale(s.id, 'oops');
  assert.throws(() => t.svc.updateSale(s.id, { date: s.date, items: [{ product_id: t.plate.id, qty: 1, price: 1 }] }), /cancelled/);
});

test('stock-in: fix quantity and cost; cost price follows latest; cannot go below what is sold', () => {
  const t = fresh();
  t.svc.stockIn({ product_id: t.plate.id, qty: 100, cost_price: 1000, date: '2099-01-01' }); // typo: meant 10 @ 100
  const m = t.svc.stockHistory(t.plate.id).find((x) => x.type === 'purchase' && x.qty === 100);
  let p = t.svc.updateStockIn({ id: m.id, qty: 10, cost_price: 110, date: '2099-01-01' });
  assert.equal(p.stock, 30);
  assert.equal(p.cost_price, 110);
  t.svc.createSale({ items: [{ product_id: t.plate.id, qty: 25, price: 150 }] });
  assert.throws(() => t.svc.updateStockIn({ id: m.id, qty: 1, cost_price: 110 }), /Lowest possible quantity is 5/);
  p = t.svc.updateStockIn({ id: m.id, qty: 5, cost_price: 110 });
  assert.equal(p.stock, 0);
  const sale = t.store.get(`SELECT id FROM stock_moves WHERE type='sale' LIMIT 1`);
  assert.throws(() => t.svc.updateStockIn({ id: sale.id, qty: 1 }), /stock-in/);
  assert.ok(t.store.get('SELECT edited_at FROM stock_moves WHERE id=?', m.id).edited_at);
});
