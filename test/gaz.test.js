'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { Store } = require('../src/core/db');
const { createService } = require('../src/core/service');
const Packing = require('../docs/packing.js');

test('gaz: phone list creates a gaz product, fractional sale shows the unit', () => {
  const S = createService(new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'crockery-gaz-'))));
  const text = Packing.pack('CROCKERY-MAAL', { v: 1, id: 'gaz-test-1', date: '2026-11-12', supplier: 'Cloth House',
    lines: [{ n: 'Lawn Cloth', q: 40, c: 300, s: 380, u: 'gaz' }] });
  const pv = S.previewPurchaseImport(text);
  assert.equal(pv.lines[0].unit, 'gaz');
  S.applyPurchaseImport({ text, decisions: [{ action: 'new' }] });
  const p = S.listProducts({}).find((x) => x.name === 'Lawn Cloth');
  assert.equal(p.unit, 'gaz'); assert.equal(p.stock, 40);
  const sale = S.createSale({ items: [{ product_id: p.id, qty: 2.5, price: 380 }], paid: 950, method: 'cash' });
  assert.equal(sale.items[0].unit, 'gaz'); assert.equal(sale.total, 950);
  assert.equal(S.listProducts({}).find((x) => x.name === 'Lawn Cloth').stock, 37.5);
});
