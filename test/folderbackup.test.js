'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/core/db');
const { createService } = require('../src/core/service');
const { FolderBackup } = require('../src/core/folderbackup');

const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), 'fb-' + n + '-'));
function computer(name) {
  const dir = tmp(name);
  const store = new Store(path.join(dir, 'data'));
  const svc = createService(store);
  const fb = new FolderBackup({ store, dir: path.join(dir, 'cfg') });
  return { store, svc, fb };
}
const names = (store) => store.all('SELECT name FROM products ORDER BY name').map((r) => r.name);

test('choose a folder: first copy is written, with a dated copy and a status', () => {
  const a = computer('a');
  a.svc.saveProduct({ name: 'Dinner Plate', cost_price: 100, sale_price: 150, stock: 5 });
  const usb = tmp('usb');
  const s = a.fb.setFolder(usb);
  assert.equal(s.state, 'ok');
  const files = fs.readdirSync(path.join(usb, 'Crockery Store Backup'));
  assert.ok(files.includes('crockery-latest.db') && files.includes('crockery-latest.json'));
  assert.ok(files.some((f) => /^crockery-\d{4}-\d{2}-\d{2}\.db$/.test(f)));
  assert.ok(!files.some((f) => f.endsWith('.tmp')), 'no half-written file is left behind');
  a.store.close();
});

test('a missing or unwritable folder is refused clearly; an unplugged USB shows as missing, not as a crash', () => {
  const a = computer('a');
  assert.throws(() => a.fb.setFolder(path.join(os.tmpdir(), 'does-not-exist-xyz')), /does not exist/);
  const usb = tmp('usb');
  a.fb.setFolder(usb);
  fs.rmSync(usb, { recursive: true, force: true });       // USB pulled out
  assert.equal(a.fb.status().state, 'missing');
  assert.throws(() => a.fb.backupNow(), /not found|plugged in/);
  a.fb._tick();                                            // the timer must never throw
  a.store.close();
});

test('exit backup only writes when something changed; old dated copies are pruned', () => {
  const a = computer('a');
  const usb = tmp('usb');
  a.fb.setFolder(usb);
  const dir = path.join(usb, 'Crockery Store Backup');
  const t0 = fs.statSync(path.join(dir, 'crockery-latest.db')).mtimeMs;
  a.fb.backupOnExit();
  assert.equal(fs.statSync(path.join(dir, 'crockery-latest.db')).mtimeMs, t0, 'nothing changed -> nothing written');
  for (let i = 1; i <= 40; i++) fs.writeFileSync(path.join(dir, `crockery-2026-08-${String(i % 28 + 1).padStart(2, '0')}.db`), 'x');
  for (let i = 1; i <= 40; i++) fs.writeFileSync(path.join(dir, `crockery-2025-${String(i % 12 + 1).padStart(2, '0')}-${String(i % 28 + 1).padStart(2, '0')}.db`), 'x');
  a.svc.saveProduct({ name: 'New', cost_price: 1, sale_price: 2, stock: 1 });
  a.fb.backupOnExit();
  const dailies = fs.readdirSync(dir).filter((f) => /^crockery-\d{4}-\d{2}-\d{2}\.db$/.test(f));
  assert.ok(dailies.length <= 30, 'at most 30 dated copies: ' + dailies.length);
  a.store.close();
});

test('a new computer pointed at a folder that holds another shop copy must choose; restore brings the data back', () => {
  const a = computer('a');
  a.svc.saveProduct({ name: 'Dinner Plate', cost_price: 100, sale_price: 150, stock: 5 });
  a.svc.saveProduct({ name: 'Tea Cup', cost_price: 20, sale_price: 40, stock: 50 });
  const usb = tmp('usb');
  a.fb.setFolder(usb);
  const copy = path.join(usb, 'Crockery Store Backup', 'crockery-latest.db');
  const before = fs.readFileSync(copy);

  const b = computer('b');                                  // new empty computer
  b.svc.saveProduct({ name: 'Junk', cost_price: 1, sale_price: 2, stock: 1 });
  const s = b.fb.setFolder(usb);
  assert.equal(s.state, 'choice');
  assert.equal(s.choice.products, 2);
  b.fb.backupNow();                                         // blocked while the choice is open
  assert.deepEqual(fs.readFileSync(copy), before, 'the good copy is untouched');

  b.fb.restore();
  assert.deepEqual(names(b.store), ['Dinner Plate', 'Tea Cup']);
  assert.equal(b.fb.status().state, 'ok');
  assert.ok(b.store.listBackups().some((x) => /pre-restore/.test(x.name)), 'safety copy of the old data');

  assert.equal(a.fb.backupNow().state, 'choice');           // computer a is told someone else took over
  a.fb.keepThisComputer();
  assert.equal(a.fb.status().state, 'ok');
  assert.ok(a.fb.list().length >= 2);
  a.store.close(); b.store.close();
});

test('a damaged data file is never copied over a good backup; restore refuses odd names', () => {
  const a = computer('a');
  a.svc.saveProduct({ name: 'Plate', cost_price: 1, sale_price: 2, stock: 1 });
  const usb = tmp('usb');
  a.fb.setFolder(usb);
  const f = path.join(usb, 'Crockery Store Backup', 'crockery-latest.db');
  const good = fs.readFileSync(f);
  const orig = a.store.backupTo.bind(a.store);
  a.store.backupTo = (d) => { fs.writeFileSync(d, 'this is not a database'); return d; };
  assert.throws(() => a.fb.backupNow(), Error);
  assert.deepEqual(fs.readFileSync(f), good);
  a.store.backupTo = orig;
  assert.throws(() => a.fb.restore('../../evil.db'), /Unknown backup file/);
  a.store.close();
});

test('stop removes the folder setting but keeps the copies', () => {
  const a = computer('a');
  const usb = tmp('usb');
  a.fb.setFolder(usb);
  assert.equal(a.fb.stop().state, 'off');
  assert.ok(fs.existsSync(path.join(usb, 'Crockery Store Backup', 'crockery-latest.db')));
  a.store.close();
});
