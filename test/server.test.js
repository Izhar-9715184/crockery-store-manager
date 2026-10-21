'use strict';
// node --test test/server.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/core/db');
const { createService } = require('../src/core/service');
const { MobileServer, ALLOWED } = require('../src/server/server');

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crockery-srv-'));
  const store = new Store(dir);
  const svc = createService(store);
  svc.setMobileAccess({ pin: 'owner-1234', enabled: true });
  const srv = new MobileServer({ service: svc });
  await srv.start(0);
  const base = `http://127.0.0.1:${srv.port}`;
  const post = (p, body, token) => fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: JSON.stringify(body),
  });
  return { dir, store, svc, srv, base, post, done: async () => { await srv.stop(); store.close(); } };
}
async function login(t, pin = 'owner-1234') {
  const r = await t.post('/api/login', { pin });
  return { status: r.status, body: await r.json() };
}

test('PIN rules: min length, hashed in database, never exposed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crockery-pin-'));
  const store = new Store(dir);
  const svc = createService(store);
  assert.throws(() => svc.setMobileAccess({ pin: '123' }), /at least 6/);
  assert.throws(() => svc.setMobileAccess({ enabled: true }), /Set a PIN first/);
  assert.throws(() => svc.setMobileAccess({ port: 80 }), /between 1024/);
  svc.setMobileAccess({ pin: 'secret99', port: 9001, enabled: true });
  assert.deepEqual(svc.getMobileConfig(), { enabled: true, port: 9001, hasPin: true });
  assert.equal(svc.checkMobilePin('secret99'), true);
  assert.equal(svc.checkMobilePin('secret98'), false);
  const rows = JSON.stringify(store.all('SELECT * FROM settings'));
  assert.ok(!rows.includes('secret99'), 'PIN is not stored in plain text');
  assert.ok(!Object.keys(svc.getSettings()).some((k) => k.startsWith('secret_')), 'hash not sent to screens');
  store.close();
});

test('login, then use the API; wrong or missing token is refused', async () => {
  const t = await setup();
  try {
    assert.equal((await t.post('/api/call', { name: 'dashboard', args: [] })).status, 401);
    assert.equal((await login(t, 'wrong-pin')).status, 401);
    const ok = await login(t);
    assert.equal(ok.status, 200);
    assert.match(ok.body.token, /^[a-f0-9]{64}$/);
    const r = await (await t.post('/api/call', { name: 'dashboard', args: [] }, ok.body.token)).json();
    assert.equal(r.ok, true);
    assert.equal(r.data.last7.length, 7);
    assert.equal((await t.post('/api/call', { name: 'dashboard', args: [] }, 'a'.repeat(64))).status, 401);
    const info = await (await fetch(t.base + '/api/info')).json();
    assert.equal(info.shop_name, 'My Crockery Store');
  } finally { await t.done(); }
});

test('only whitelisted actions: no settings, backups, restore or PIN functions', async () => {
  const t = await setup();
  try {
    const { body: { token } } = await login(t);
    for (const bad of ['saveSettings', 'createBackup', 'listBackups', 'dbInfo', 'setMobileAccess', 'checkMobilePin',
      'mobilePinFingerprint', 'getMobileConfig', '__proto__', 'constructor', 'toString']) {
      const r = await t.post('/api/call', { name: bad, args: [] }, token);
      assert.equal(r.status, 403, `${bad} must be refused`);
    }
    for (const name of ALLOWED) assert.equal(typeof t.svc[name], 'function', `${name} exists`);
    // getSettings must not leak the PIN hash
    const s = await (await t.post('/api/call', { name: 'getSettings', args: [] }, token)).json();
    assert.ok(!JSON.stringify(s).includes('secret_'));
  } finally { await t.done(); }
});

test('a full sale + stock entry from the phone, same database as the desktop', async () => {
  const t = await setup();
  try {
    const { body: { token } } = await login(t);
    const call = async (name, ...args) => (await (await t.post('/api/call', { name, args }, token)).json());
    const p = (await call('saveProduct', { name: 'Tea Cup', cost_price: 50, sale_price: 80, stock: 10 })).data;
    await call('stockIn', { product_id: p.id, qty: 5 });
    const c = (await call('saveCustomer', { name: 'Bilal', phone: '0300' })).data;
    const sale = (await call('createSale', { customer_id: c.id, items: [{ product_id: p.id, qty: 3, price: 80 }], paid: 100 })).data;
    assert.equal(sale.due, 140);
    // desktop side sees the very same data immediately
    assert.equal(t.svc.listProducts({ q: 'cup' })[0].stock, 12);
    assert.equal(t.svc.getCustomer(c.id).balance, 140);
    // errors come back as messages, not crashes
    const bad = await call('createSale', { items: [{ product_id: p.id, qty: 999, price: 80 }] });
    assert.equal(bad.ok, false);
    assert.match(bad.error, /Not enough stock/);
  } finally { await t.done(); }
});

test('5 wrong PINs lock the device; correct PIN is refused during the lock', async () => {
  const t = await setup();
  try {
    for (let i = 0; i < 5; i++) assert.equal((await login(t, 'nope-' + i)).status, 401);
    const locked = await login(t);
    assert.equal(locked.status, 429);
    assert.match(locked.body.error, /wait/i);
  } finally { await t.done(); }
});

test('changing the PIN logs out every phone', async () => {
  const t = await setup();
  try {
    const { body: { token } } = await login(t);
    assert.equal((await t.post('/api/call', { name: 'dashboard', args: [] }, token)).status, 200);
    t.svc.setMobileAccess({ pin: 'brand-new-pin' });
    assert.equal((await t.post('/api/call', { name: 'dashboard', args: [] }, token)).status, 401);
    assert.equal((await login(t, 'owner-1234')).status, 401);
    assert.equal((await login(t, 'brand-new-pin')).status, 200);
  } finally { await t.done(); }
});

test('static files are served; path traversal and other files are blocked', async () => {
  const t = await setup();
  try {
    const home = await fetch(t.base + '/');
    assert.equal(home.status, 200);
    assert.match(home.headers.get('content-type'), /text\/html/);
    assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
    for (const evil of ['/../../package.json', '/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/main.js', '/..\\..\\package.json']) {
      const r = await fetch(t.base + evil);
      assert.equal(r.status, 404, evil);
      assert.ok(!(await r.text()).includes('electron'));
    }
    assert.equal((await fetch(t.base + '/nothing.js')).status, 404);
    assert.equal((await fetch(t.base + '/api/unknown')).status, 404);
    const big = await fetch(t.base + '/api/login', { method: 'POST', body: 'x'.repeat(2 * 1024 * 1024) }).catch(() => null);
    assert.ok(!big || big.status !== 200);
    const junk = await fetch(t.base + '/api/login', { method: 'POST', body: '{not json' });
    assert.equal(junk.status, 400);
  } finally { await t.done(); }
});

test('port already in use gives a friendly error', async () => {
  const t = await setup();
  try {
    const second = new MobileServer({ service: t.svc });
    await assert.rejects(() => second.start(t.srv.port), /already used/);
  } finally { await t.done(); }
});
