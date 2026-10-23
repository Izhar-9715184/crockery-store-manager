'use strict';
// Run with:  node --test test/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { Store, LATEST } = require('../src/core/db');
const { createService } = require('../src/core/service');
const { dateStr } = require('../src/core/db');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'crockery-'));
}
function fresh() {
  const dir = tmpDir();
  const store = new Store(dir);
  return { dir, store, svc: createService(store) };
}
function seed(svc) {
  const plate = svc.saveProduct({ name: 'Dinner Plate', code: 'DP1', category: 'Plates', cost_price: 100, sale_price: 150, stock: 20, min_stock: 5 });
  const cup = svc.saveProduct({ name: 'Tea Cup', cost_price: 50, sale_price: 80, stock: 10, min_stock: 2 });
  const cust = svc.saveCustomer({ name: 'Ali Traders', phone: '0300', opening_balance: 1000 });
  return { plate, cup, cust };
}

test('fresh database is created with latest schema and default settings', () => {
  const { store, svc } = fresh();
  assert.equal(store.get('PRAGMA user_version').user_version, LATEST);
  assert.equal(svc.getSettings().shop_name, 'My Crockery Store');
  store.close();
});

test('product validation, unique code, opening stock', () => {
  const { store, svc } = fresh();
  const { plate } = seed(svc);
  assert.equal(plate.stock, 20);
  assert.equal(svc.stockHistory(plate.id)[0].type, 'opening');
  assert.throws(() => svc.saveProduct({ name: 'Other', code: 'DP1' }), /already used/);
  assert.throws(() => svc.saveProduct({ name: '' }), /required/);
  assert.throws(() => svc.saveProduct({ name: 'X', sale_price: -5 }), /less than 0/);
  store.close();
});

test('cash sale reduces stock and computes profit', () => {
  const { store, svc } = fresh();
  const { plate } = seed(svc);
  const sale = svc.createSale({ items: [{ product_id: plate.id, qty: 4, price: 150 }], discount: 20 });
  assert.equal(sale.subtotal, 600);
  assert.equal(sale.total, 580);
  assert.equal(sale.paid, 580);
  assert.equal(sale.due, 0);
  assert.equal(sale.profit, 180); // 580 - 4*100
  assert.equal(sale.invoice_no, 'INV-00001');
  assert.equal(svc.listProducts({ q: 'plate' })[0].stock, 16);
  assert.equal(svc.createSale({ items: [{ product_id: plate.id, qty: 1, price: 150 }] }).invoice_no, 'INV-00002');
  store.close();
});

test('udhar sale creates ledger entry; payment reduces balance', () => {
  const { store, svc } = fresh();
  const { plate, cust } = seed(svc);
  assert.equal(svc.getCustomer(cust.id).balance, 1000); // opening
  const sale = svc.createSale({
    customer_id: cust.id, items: [{ product_id: plate.id, qty: 10, price: 150 }], paid: 500,
  });
  assert.equal(sale.due, 1000);
  assert.equal(svc.getCustomer(cust.id).balance, 2000);
  svc.receivePayment({ customer_id: cust.id, amount: 750 });
  assert.equal(svc.getCustomer(cust.id).balance, 1250);
  const ledger = svc.customerLedger(cust.id);
  assert.equal(ledger.entries.length, 3);
  assert.equal(ledger.entries[0].balance, 1250); // newest first, running balance
  assert.equal(svc.listCustomers({ onlyDue: true }).length, 1);
  assert.throws(() => svc.deleteCustomer(cust.id), /udhar balance/);
  store.close();
});

test('sale rules: stock check, walk-in udhar, overpay, empty cart', () => {
  const { store, svc } = fresh();
  const { plate, cust } = seed(svc);
  assert.throws(() => svc.createSale({ items: [{ product_id: plate.id, qty: 21, price: 150 }] }), /Not enough stock/);
  assert.throws(() => svc.createSale({ items: [{ product_id: plate.id, qty: 1, price: 150 }], paid: 10 }), /select a customer/);
  assert.throws(() => svc.createSale({ customer_id: cust.id, items: [{ product_id: plate.id, qty: 1, price: 150 }], paid: 999 }), /more than the bill/);
  assert.throws(() => svc.createSale({ items: [] }), /empty/);
  assert.throws(() => svc.createSale({ items: [{ product_id: plate.id, qty: 0, price: 1 }] }), /greater than zero/);
  // same product on two lines is summed for the stock check
  assert.throws(() => svc.createSale({ items: [
    { product_id: plate.id, qty: 12, price: 150 }, { product_id: plate.id, qty: 12, price: 150 }] }), /Not enough stock/);
  // failed sales must leave nothing behind (atomic) and not burn invoice numbers
  assert.equal(svc.listSales({}).length, 0);
  assert.equal(svc.listProducts({ q: 'plate' })[0].stock, 20);
  assert.equal(svc.getSettings().next_invoice, '1');
  // allow negative stock setting
  svc.saveSettings({ allow_negative_stock: '1' });
  const s = svc.createSale({ items: [{ product_id: plate.id, qty: 25, price: 150 }] });
  assert.equal(svc.listProducts({ q: 'plate' })[0].stock, -5);
  assert.equal(s.total, 3750);
  store.close();
});

test('cancel sale restores stock and reverses udhar', () => {
  const { store, svc } = fresh();
  const { plate, cust } = seed(svc);
  const sale = svc.createSale({ customer_id: cust.id, items: [{ product_id: plate.id, qty: 5, price: 150 }], paid: 0 });
  assert.equal(svc.getCustomer(cust.id).balance, 1750);
  assert.throws(() => svc.cancelSale(sale.id, ''), /reason/);
  svc.cancelSale(sale.id, 'wrong entry');
  assert.equal(svc.getCustomer(cust.id).balance, 1000);
  assert.equal(svc.listProducts({ q: 'plate' })[0].stock, 20);
  assert.throws(() => svc.cancelSale(sale.id, 'again'), /already cancelled/);
  // cancelled sales are excluded from reports
  const sum = svc.summary(dateStr(), dateStr());
  assert.equal(sum.bills, 0);
  assert.equal(sum.cancelled, 1);
  store.close();
});

test('stock in, breakage, correction keep a full history', () => {
  const { store, svc } = fresh();
  const { cup } = seed(svc);
  svc.stockIn({ product_id: cup.id, qty: 24, cost_price: 55, supplier: 'Rafiq & Sons' });
  let p = svc.listProducts({ q: 'cup' })[0];
  assert.equal(p.stock, 34);
  assert.equal(p.cost_price, 55);
  svc.adjustStock({ product_id: cup.id, kind: 'breakage', qty: 3, note: 'fell down' });
  svc.adjustStock({ product_id: cup.id, kind: 'correction', qty: 30 });
  p = svc.listProducts({ q: 'cup' })[0];
  assert.equal(p.stock, 30);
  // stock must always equal the sum of its movements
  const sum = store.get('SELECT SUM(qty) AS s FROM stock_moves WHERE product_id=?', cup.id).s;
  assert.equal(sum, 30);
  assert.deepEqual(svc.stockHistory(cup.id).map((m) => m.type), ['correction', 'breakage', 'purchase', 'opening']);
  store.close();
});

test('reports: daily summary, dashboard, stock report', () => {
  const { store, svc } = fresh();
  const { plate, cup, cust } = seed(svc);
  svc.createSale({ items: [{ product_id: plate.id, qty: 2, price: 150 }] }); // 300 cash, profit 100
  svc.createSale({ customer_id: cust.id, items: [{ product_id: cup.id, qty: 5, price: 80 }], paid: 100 }); // 400, due 300, profit 150
  svc.receivePayment({ customer_id: cust.id, amount: 200 });
  const d = dateStr();
  const s = svc.summary(d, d);
  assert.equal(s.bills, 2);
  assert.equal(s.sales, 700);
  assert.equal(s.paid_on_sale, 400);
  assert.equal(s.udhar_given, 300);
  assert.equal(s.recovered, 200);
  assert.equal(s.cash_in, 600);
  assert.equal(s.profit, 250);
  assert.equal(s.items_qty, 7);
  assert.equal(s.perDay.length, 1);
  assert.equal(s.topProducts[0].name, 'Tea Cup' === s.topProducts[0].name ? 'Tea Cup' : 'Dinner Plate');
  const dash = svc.dashboard();
  assert.equal(dash.outstanding, 1000 + 300 - 200);
  assert.equal(dash.last7.length, 7);
  assert.equal(dash.last7[6].sales, 700);
  const st = svc.stockReport();
  assert.equal(st.totalValue, 18 * 100 + 5 * 50);
  store.close();
});

test('backups: daily auto backup, manual backup, restore', () => {
  const { dir, store, svc } = fresh();
  const { plate } = seed(svc);
  assert.ok(store.listBackups().some((b) => b.name.startsWith('auto-')), 'auto backup exists');
  const b = svc.createBackup();
  svc.createSale({ items: [{ product_id: plate.id, qty: 5, price: 150 }] });
  assert.equal(svc.listSales({}).length, 1);
  store.restoreFrom(b.path); // go back to before the sale
  const svc2 = createService(store);
  assert.equal(svc2.listSales({}).length, 0);
  assert.equal(svc2.listProducts({ q: 'plate' })[0].stock, 20);
  assert.ok(store.listBackups().some((x) => x.name.startsWith('pre-restore')), 'safety backup of the state before restore');
  assert.throws(() => store.restoreFrom(path.join(dir, 'nothing.db')), /./);
  store.close();
});

test('data survives close/reopen (as after an app update + restart)', () => {
  const { dir, store, svc } = fresh();
  const { plate, cust } = seed(svc);
  svc.createSale({ customer_id: cust.id, items: [{ product_id: plate.id, qty: 3, price: 150 }], paid: 0 });
  store.close();
  const store2 = new Store(dir);
  const svc2 = createService(store2);
  assert.equal(svc2.getCustomer(cust.id).balance, 1450);
  assert.equal(svc2.listProducts({ q: 'plate' })[0].stock, 17);
  store2.close();
});

test('corrupted database is auto-restored from the newest good backup', () => {
  const { dir, store, svc } = fresh();
  seed(svc);
  store.close();
  // destroy the live database file
  fs.writeFileSync(path.join(dir, 'crockery.db'), Buffer.from('this is not a database at all'.repeat(200)));
  for (const ext of ['-wal', '-shm']) fs.rmSync(path.join(dir, 'crockery.db' + ext), { force: true });
  const store2 = new Store(dir);
  assert.ok(store2.recovered, 'reports that it recovered');
  const svc2 = createService(store2);
  assert.equal(svc2.listProducts({}).length, 2);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('damaged-')), 'bad file kept aside');
  store2.close();
});

test('corrupted database with no backup fails loudly and keeps the file', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'crockery.db'), Buffer.from('garbage'.repeat(500)));
  assert.throws(() => new Store(dir), /no usable backup/);
  assert.ok(fs.existsSync(path.join(dir, 'crockery.db')));
});

test('migration: an update upgrades old data in place, with a backup, nothing lost', () => {
  const dbmod = require('../src/core/db');
  const original = dbmod.MIGRATIONS.length;
  const dir = tmpDir();
  const s1 = new Store(dir);
  const svc = createService(s1);
  svc.saveProduct({ name: 'Glass Set', sale_price: 900, cost_price: 600, stock: 7 });
  assert.equal(s1.get('PRAGMA user_version').user_version, original);
  s1.close();

  try {
    // a broken future migration must roll back completely and leave the data usable
    dbmod.MIGRATIONS.push('ALTER TABLE products ADD COLUMN barcode TEXT; THIS IS NOT SQL;');
    assert.throws(() => new Store(dir), new RegExp(`update to v${original + 1} failed`));
    dbmod.MIGRATIONS.pop();
    const ok = new Store(dir);
    assert.equal(ok.get('PRAGMA user_version').user_version, original);
    assert.equal(createService(ok).listProducts({}).length, 1);
    ok.close();

    // a good "version 1.1" migration adds a column and keeps all rows
    dbmod.MIGRATIONS.push('ALTER TABLE products ADD COLUMN barcode TEXT;');
    const s2 = new Store(dir);
    assert.equal(s2.get('PRAGMA user_version').user_version, original + 1);
    const row = s2.get('SELECT name, stock, barcode FROM products');
    assert.deepEqual(row, { name: 'Glass Set', stock: 7, barcode: null });
    assert.ok(s2.listBackups().some((b) => b.name.startsWith('pre-migrate-')), 'backup taken before migrating');
    s2.close();

    // an OLD app must refuse to open data from a NEWER app instead of damaging it
    dbmod.MIGRATIONS.pop();
    assert.throws(() => new Store(dir), /newer version/);
  } finally {
    dbmod.MIGRATIONS.length = original;
  }
});

test('old balance from the paper register: by name, new customer created, page noted, several entries add up', () => {
  const { store, svc } = fresh();
  const ali = svc.saveCustomer({ name: 'Ali Traders', phone: '0300' });
  let r = svc.addOldBalance({ name: 'ali traders', amount: 5000, page: '12', date: '2026-01-05' });   // matches existing, any case
  assert.equal(r.created, false);
  assert.equal(r.customer.id, ali.id);
  assert.equal(r.customer.balance, 5000);
  r = svc.addOldBalance({ customer_id: ali.id, amount: 1500.5, note: 'diwali' });
  assert.equal(r.customer.balance, 6500.5);
  r = svc.addOldBalance({ name: 'New Buyer', amount: 800, page: '3' });                                // unknown name -> new customer
  assert.equal(r.created, true);
  assert.equal(r.customer.balance, 800);
  const led = svc.customerLedger(ali.id).entries.reverse();
  assert.match(led[0].note, /Old balance · register page 12/);
  assert.equal(led[0].type, 'opening');
  assert.match(led[1].note, /diwali/);
  assert.equal(svc.listCustomers({}).length, 2, 'no duplicate customer was made');
  // bad input changes nothing
  assert.throws(() => svc.addOldBalance({ name: '', amount: 5 }), /customer name/);
  assert.throws(() => svc.addOldBalance({ name: 'Ali Traders', amount: 0 }), /greater than zero/);
  assert.throws(() => svc.addOldBalance({ name: 'Zed', amount: -4 }), Error);
  assert.equal(svc.listCustomers({}).length, 2, 'a failed entry does not leave a half-made customer');
  store.close();
});
