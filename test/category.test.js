'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { Store } = require('../src/core/db');
const { createService } = require('../src/core/service');

test('categories can be renamed and deleted', () => {
  const S = createService(new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'crockery-cat-'))));
  S.saveProduct({ name: 'A', category: 'Shesha', cost_price: 1, sale_price: 2, stock: 1 });
  S.saveProduct({ name: 'B', category: 'Shesha', cost_price: 1, sale_price: 2, stock: 1 });
  S.saveProduct({ name: 'C', category: 'Steel', cost_price: 1, sale_price: 2, stock: 1 });
  assert.deepEqual(S.listCategoriesDetailed().map((c) => [c.name, c.count]), [['Shesha', 2], ['Steel', 1]]);
  assert.equal(S.renameCategory({ from: 'Shesha', to: 'Glass' }).changed, 2);
  assert.deepEqual(S.listCategories(), ['Glass', 'Steel']);
  assert.equal(S.deleteCategory('Steel').changed, 1);
  assert.deepEqual(S.listCategories(), ['Glass']);
  assert.ok(S.listProducts({}).some((p) => p.name === 'C' && p.category === ''), 'product stays, only the category goes');
  assert.throws(() => S.renameCategory({ from: 'Glass', to: ' ' }));
});
