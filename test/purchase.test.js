'use strict';
// Purchases entered on the phone (offline) -> imported on the laptop.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Packing = require('../docs/packing.js');
const dbmod = require('../src/core/db');
const { Store } = dbmod;
const { createService } = require('../src/core/service');

const fresh = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crockery-pur-'));
  const store = new Store(dir);
  return { dir, store, svc: createService(store) };
};
const batch = (over = {}) => ({
  v: 1, id: 'b-test-0001', date: '2026-10-21', supplier: 'Rafiq Traders',
  lines: [
    { n: 'dinner plate', q: 24, c: 120, s: 180 },
    { n: 'Chai Pyala نیا', q: 12, c: 60, s: 100 },
    { n: 'Glass Set', q: 6, c: 500 },
  ],
  ...over,
});
const msg = (b = batch()) => `Maal entry 21 Oct\n1. Dinner plate x24\n\n${Packing.pack('CROCKERY-MAAL', b)}\n`;

test('packing: round trip incl. Urdu text, line wrapping and extra words around it', () => {
  const b = batch();
  const text = Packing.pack('CROCKERY-MAAL', b);
  assert.deepEqual(Packing.unpack(text, 'CROCKERY-MAAL'), b);
  // WhatsApp may wrap long lines and people add words before/after
  const wrapped = 'Salam, ye lo:\n' + text.replace(/(.{40})/g, '$1\n') + '\nShukriya!';
  assert.deepEqual(Packing.unpack(wrapped, 'CROCKERY-MAAL'), b);
});

test('packing: cut-short or damaged messages are refused, never half-imported', () => {
  const text = Packing.pack('CROCKERY-MAAL', batch());
  assert.throws(() => Packing.unpack(text.slice(0, text.length - 12), 'CROCKERY-MAAL'), /incomplete|damaged/);
  const i = text.indexOf(':') + 21;                       // change one character in the middle
  const flipped = text.slice(0, i) + (text[i] === 'A' ? 'B' : 'A') + text.slice(i + 1);
  assert.throws(() => Packing.unpack(flipped, 'CROCKERY-MAAL'), /damaged/);
  assert.throws(() => Packing.unpack('hello there', 'CROCKERY-MAAL'), /not a list/);
  assert.throws(() => Packing.unpack(Packing.pack('CROCKERY-PRODUCTS', { v: 1, items: [] }), 'CROCKERY-MAAL'), /not a list/);
});

test('preview: matches by name (any case) or code, suggests similar, flags new items', () => {
  const { store, svc } = fresh();
  svc.saveProduct({ name: 'Dinner Plate', code: 'DP1', cost_price: 100, sale_price: 150, stock: 5 });
  svc.saveProduct({ name: 'Glass Set 6pc', cost_price: 400, sale_price: 600, stock: 2 });
  const p = svc.previewPurchaseImport(msg());
  assert.equal(p.lines.length, 3);
  assert.equal(p.lines[0].match.name, 'Dinner Plate');     // "dinner plate" matches ignoring case
  assert.equal(p.lines[1].match, null);                     // unknown item
  assert.equal(p.lines[2].match, null);                     // "Glass Set" is not exactly "Glass Set 6pc"...
  assert.deepEqual(p.lines[2].suggestions.map((s) => s.name), ['Glass Set 6pc']); // ...but it is suggested
  assert.equal(p.totalQty, 42);
  assert.equal(p.totalAmount, 24 * 120 + 12 * 60 + 6 * 500);
  assert.equal(p.alreadyImported, null);
  // preview must not change anything
  assert.equal(svc.listProducts({}).length, 2);
  store.close();
});

test('apply: stock in for matched, new product created, skipped line ignored, all in one go', () => {
  const { store, svc } = fresh();
  const plate = svc.saveProduct({ name: 'Dinner Plate', cost_price: 100, sale_price: 150, stock: 5 });
  const gs = svc.saveProduct({ name: 'Glass Set 6pc', cost_price: 400, sale_price: 600, stock: 2 });
  const r = svc.applyPurchaseImport({
    text: msg(),
    decisions: [
      { action: 'match', product_id: plate.id },
      { action: 'new', sale_price: 110 },
      { action: 'match', product_id: gs.id },
    ],
  });
  assert.deepEqual(r, { imported: 3, skipped: 0, created: 1, totalQty: 42, totalAmount: 24 * 120 + 12 * 60 + 6 * 500 });
  const plateNow = svc.listProducts({ q: 'Dinner' })[0];
  assert.equal(plateNow.stock, 29);
  assert.equal(plateNow.cost_price, 120);                  // latest purchase price
  assert.equal(svc.listProducts({ q: 'Glass' })[0].stock, 8);
  const neu = svc.listProducts({ q: 'Chai' })[0];
  assert.equal(neu.stock, 12);
  assert.equal(neu.sale_price, 110);
  const hist = svc.stockHistory(plate.id)[0];
  assert.equal(hist.type, 'purchase');
  assert.equal(hist.supplier, 'Rafiq Traders');
  assert.equal(hist.date, '2026-10-21');
  assert.equal(svc.listPurchaseImports().length, 1);
  store.close();
});

test('the same list can never add stock twice', () => {
  const { store, svc } = fresh();
  const p = svc.saveProduct({ name: 'Dinner Plate', cost_price: 100, sale_price: 150, stock: 5 });
  const text = msg(batch({ lines: [{ n: 'Dinner Plate', q: 10, c: 100 }] }));
  const decisions = [{ action: 'match', product_id: p.id }];
  svc.applyPurchaseImport({ text, decisions });
  assert.throws(() => svc.applyPurchaseImport({ text, decisions }), /already imported/);
  assert.equal(svc.previewPurchaseImport(text).alreadyImported !== null, true);
  assert.equal(svc.listProducts({})[0].stock, 15);
  store.close();
});

test('apply is all-or-nothing: one bad line leaves stock, products and history untouched', () => {
  const { store, svc } = fresh();
  const plate = svc.saveProduct({ name: 'Dinner Plate', cost_price: 100, sale_price: 150, stock: 5 });
  assert.throws(() => svc.applyPurchaseImport({
    text: msg(),
    decisions: [{ action: 'match', product_id: plate.id }, { action: 'new' }, { action: 'match', product_id: 99999 }],
  }), /no longer exists/);
  assert.equal(svc.listProducts({}).length, 1, 'new product was rolled back');
  assert.equal(svc.listProducts({})[0].stock, 5, 'stock unchanged');
  assert.equal(svc.listPurchaseImports().length, 0, 'not marked as imported, can be retried');
  // wrong number of decisions / undecided line / everything skipped
  assert.throws(() => svc.applyPurchaseImport({ text: msg(), decisions: [] }), /review every line/);
  assert.throws(() => svc.applyPurchaseImport({ text: msg(), decisions: [{}, {}, {}] }), /choose what to do/);
  assert.throws(() => svc.applyPurchaseImport({ text: msg(), decisions: [{ action: 'skip' }, { action: 'skip' }, { action: 'skip' }] }), /nothing to import/);
  store.close();
});

test('invalid or hostile lists are rejected with a clear message', () => {
  const { store, svc } = fresh();
  const bad = (over, re) => assert.throws(() => svc.previewPurchaseImport(msg(batch(over))), re);
  bad({ lines: [{ n: 'X', q: -1, c: 5 }] }, /quantity is invalid/);
  bad({ lines: [{ n: 'X', q: 'abc', c: 5 }] }, /quantity is invalid/);
  bad({ lines: [{ n: 'X', q: 1, c: -5 }] }, /cost price is invalid/);
  bad({ lines: [{ n: '  ', q: 1, c: 5 }] }, /name is missing/);
  bad({ lines: [] }, /between 1 and 500/);
  bad({ lines: Array.from({ length: 501 }, () => ({ n: 'X', q: 1, c: 1 })) }, /between 1 and 500/);
  bad({ date: '21-10-2026' }, /date/);
  bad({ id: 'a b/c' }, /valid number/);
  bad({ v: 2 }, /not a purchase list/);
  // markup in names is just text (the screens escape it)
  const p = svc.previewPurchaseImport(msg(batch({ lines: [{ n: '<img src=x onerror=alert(1)>', q: 1, c: 1 }] })));
  assert.equal(p.lines[0].name, '<img src=x onerror=alert(1)>');
  store.close();
});

test('product list for the phone: round trip', () => {
  const { store, svc } = fresh();
  svc.saveProduct({ name: 'Dinner Plate', code: 'DP1', cost_price: 100, sale_price: 150, stock: 5 });
  svc.saveProduct({ name: 'چائے کا کپ', cost_price: 50, sale_price: 80, stock: 5 });
  const out = svc.exportProductsForPhone();
  assert.equal(out.count, 2);
  const back = Packing.unpack(out.text, 'CROCKERY-PRODUCTS');
  assert.deepEqual(back.items.map((i) => i.n).sort(), ['Dinner Plate', 'چائے کا کپ'].sort());
  store.close();
});

test('update from v1 to v2: old data kept, backup taken, import table added', () => {
  const original = dbmod.MIGRATIONS.slice();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crockery-mig-'));
  try {
    dbmod.MIGRATIONS.length = 1;                         // pretend this is the old program (v1 only)
    const old = new Store(dir);
    createService(old).saveProduct({ name: 'Old Plate', cost_price: 10, sale_price: 20, stock: 3 });
    assert.equal(old.get('PRAGMA user_version').user_version, 1);
    old.close();
    dbmod.MIGRATIONS.length = 0;
    original.forEach((m) => dbmod.MIGRATIONS.push(m));   // now the new program (with v2)
    const upd = new Store(dir);
    assert.equal(upd.get('PRAGMA user_version').user_version, original.length);
    assert.equal(createService(upd).listProducts({})[0].name, 'Old Plate');
    assert.ok(upd.listBackups().some((b) => b.name.startsWith('pre-migrate-v1')), 'backup before migrating');
    assert.equal(upd.get("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='purchase_imports'").n, 1);
    upd.close();
  } finally {
    dbmod.MIGRATIONS.length = 0;
    original.forEach((m) => dbmod.MIGRATIONS.push(m));
  }
});
