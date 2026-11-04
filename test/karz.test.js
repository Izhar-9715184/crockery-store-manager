'use strict';
// Wholesaler karz: what the shop owes to suppliers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/core/db');
const { createService } = require('../src/core/service');
const Packing = require('../docs/packing.js');

const fresh = () => {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'crockery-karz-')));
  const svc = createService(store);
  const plate = svc.saveProduct({ name: 'Plate', cost_price: 100, sale_price: 150, stock: 0 });
  const cup = svc.saveProduct({ name: 'Cup', cost_price: 40, sale_price: 70, stock: 0 });
  return { store, svc, plate, cup };
};
const owe = (t, name) => t.svc.listSuppliers({}).find((s) => s.name.toLowerCase() === name.toLowerCase());

test('maal on karz creates the supplier and the karz', () => {
  const t = fresh();
  t.svc.stockIn({ product_id: t.plate.id, qty: 10, cost_price: 100, supplier: 'Rafiq Traders', paid: 0 });
  assert.equal(owe(t, 'Rafiq Traders').balance, 1000);
  t.svc.stockIn({ product_id: t.cup.id, qty: 10, cost_price: 40, supplier: 'rafiq traders', paid: 100 });  // same name, other letters
  assert.equal(t.svc.listSuppliers({}).length, 1);
  assert.equal(owe(t, 'Rafiq Traders').balance, 1000 + 400 - 100);
});

test('no paid value = karz is not tracked (old behaviour)', () => {
  const t = fresh();
  t.svc.stockIn({ product_id: t.plate.id, qty: 10, cost_price: 100, supplier: 'Somebody' });
  assert.equal(t.svc.listSuppliers({}).length, 0);
});

test('payments, old karz, edit and delete', () => {
  const t = fresh();
  const s = t.svc.addSupplierKarz({ name: 'Hajji Sons', amount: 5000 });
  assert.equal(s.balance, 5000);
  t.svc.paySupplier({ supplier_id: s.id, amount: 2000 });
  assert.equal(t.svc.getSupplier(s.id).balance, 3000);
  const led = t.svc.supplierLedger(s.id);
  assert.equal(led.entries[0].balance, 3000);
  const pay = led.entries.find((e) => e.type === 'payment');
  t.svc.updateSupplierEntry({ id: pay.id, amount: 2500, date: pay.date });
  assert.equal(t.svc.getSupplier(s.id).balance, 2500);
  t.svc.deleteSupplierEntry(pay.id);
  assert.equal(t.svc.getSupplier(s.id).balance, 5000);
  assert.throws(() => t.svc.deleteSupplier(s.id), /Clear the karz/);
  assert.throws(() => t.svc.paySupplier({ supplier_id: s.id, amount: 0 }), /greater than zero/);
});

test('editing the stock-in changes the karz with it', () => {
  const t = fresh();
  t.svc.stockIn({ product_id: t.plate.id, qty: 10, cost_price: 100, supplier: 'Rafiq', paid: 0 });
  const mv = t.store.get(`SELECT id FROM stock_moves WHERE type='purchase'`);
  t.svc.updateStockIn({ id: mv.id, qty: 12, cost_price: 100 });
  assert.equal(owe(t, 'Rafiq').balance, 1200);
  const pur = t.svc.supplierLedger(owe(t, 'Rafiq').id).entries.find((e) => e.type === 'purchase');
  assert.throws(() => t.svc.updateSupplierEntry({ id: pur.id, amount: 5 }), /Stock history/);
  assert.throws(() => t.svc.deleteSupplierEntry(pur.id), /stock-in/);
});

test('phone list with paid: karz is recorded once, for matched lines only', () => {
  const t = fresh();
  const b = { v: 1, id: 'abc12345', date: '2026-11-01', supplier: 'Rafiq Traders', paid: 300,
    lines: [{ n: 'Plate', q: 10, c: 100 }, { n: 'Cup', q: 5, c: 40 }] };
  const text = Packing.pack('CROCKERY-MAAL', b);
  const r = t.svc.autoImportPurchase(text);
  assert.equal(r.status, 'imported');
  assert.equal(owe(t, 'Rafiq Traders').balance, 1000 + 200 - 300);
  assert.equal(t.svc.autoImportPurchase(text).status, 'done');            // never twice
  assert.equal(owe(t, 'Rafiq Traders').balance, 900);
  // a list without "paid" (older phone page) does not touch karz
  const b2 = { ...b, id: 'zzz99999', paid: undefined };
  t.svc.autoImportPurchase(Packing.pack('CROCKERY-MAAL', b2));
  assert.equal(owe(t, 'Rafiq Traders').balance, 900);
});

test('phone export lists only wholesalers we owe', () => {
  const t = fresh();
  t.svc.addSupplierKarz({ name: 'A', amount: 100 });
  t.svc.addSupplierKarz({ name: 'B', amount: 50 });
  t.svc.paySupplier({ supplier_id: owe(t, 'B').id, amount: 50 });
  const k = t.svc.exportKarzForPhone();
  assert.deepEqual(k.map((x) => x.n), ['A']);
  assert.deepEqual(t.svc.exportSupplierNamesForPhone(), ['A', 'B']);
});
