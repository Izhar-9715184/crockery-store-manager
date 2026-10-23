'use strict';
/**
 * End to end: the offline phone page (docs/) -> message -> laptop "Import from phone" screen -> real database.
 *   node test/phone-ui-test.js [screenshot-folder]
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/home/claude/.npm-global/lib/node_modules/playwright');
const { Store } = require('../src/core/db');
const { createService } = require('../src/core/service');

const shots = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'));
fs.mkdirSync(shots, { recursive: true });
const DOCS = path.resolve(__dirname, '../docs');
const PREFIX = '/crockery-store-manager/';  // GitHub Pages serves the page under the repository name

// tiny static server that behaves like GitHub Pages (page lives under /<repo>/)
function pagesServer() {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (!p.startsWith(PREFIX)) { res.writeHead(404); return res.end('no'); }
    p = p.slice(PREFIX.length) || 'index.html';
    const f = path.join(DOCS, p);
    if (!f.startsWith(DOCS) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('no'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crockery-ph-'));
  const store = new Store(dir);
  const svc = createService(store);
  svc.saveProduct({ name: 'Dinner Plate', code: 'DP1', cost_price: 100, sale_price: 150, stock: 5 });
  svc.saveProduct({ name: 'Glass Set 6pc', cost_price: 400, sale_price: 600, stock: 2 });

  const srv = await pagesServer();
  const base = `http://localhost:${srv.address().port}${PREFIX}`;
  const browser = await chromium.launch();
  const errors = [];

  // ================= PHONE =================
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const phone = await phoneCtx.newPage();
  phone.on('pageerror', (e) => errors.push('phone pageerror: ' + e.message));
  phone.on('console', (m) => { if (m.type() === 'error') errors.push('phone console: ' + m.text()); });
  phone.on('dialog', (d) => d.accept());
  await phone.addInitScript(() => { navigator.share = async (d) => { window.__shared = d; }; });

  await phone.goto(base);
  await phone.waitForFunction(() => window.__maalReady === true);
  await phone.waitForFunction(() => document.querySelector('#status').textContent.includes('without internet'), null, { timeout: 15000 });

  // the market has no signal: go offline and reload -> page must still open
  await phoneCtx.setOffline(true);
  await phone.reload();
  await phone.waitForFunction(() => window.__maalReady === true);
  assert.match(await phone.textContent('#status'), /Offline/);

  const add = async (name, q, c, s) => {
    await phone.fill('#name', name);
    await phone.fill('#qty', String(q));
    await phone.fill('#cost', String(c));
    if (s !== undefined) { await phone.click('#more summary'); await phone.fill('#sale', String(s)); }
    await phone.click('#addBtn');
  };
  await phone.fill('#supplier', 'Rafiq Traders');
  await add('dinner plate', 24, 120);
  await add('Chai Pyala نیا', 12, 60, 100);
  await add('Glass Set', 6, 500);
  await add('Wrong item', 1, 1);
  await phone.click('[data-del="3"]');                     // remove the wrong one (confirm auto-accepted)
  assert.equal(await phone.locator('.line').count(), 3);
  assert.match(await phone.textContent('#totalAmt'), /6,600/);
  assert.match(await phone.textContent('#totalSub'), /3 items · 42 pcs/);

  // validation messages
  await phone.fill('#name', 'X'); await phone.click('#addBtn');
  assert.match(await phone.textContent('#toast'), /how many/);
  await phone.fill('#name', '');

  // edit a line
  await phone.click('[data-edit="2"]');
  await phone.fill('#e_q', '7');
  await phone.click('#e_save');
  assert.match(await phone.textContent('#totalAmt'), /7,100/);   // 2880 + 720 + 3500
  await phone.click('[data-edit="2"]');
  await phone.fill('#e_q', '6');
  await phone.click('#e_save');
  await phone.screenshot({ path: path.join(shots, 'p1-list.png') });

  // closing and reopening the page keeps the list (saved on the phone)
  await phone.reload();
  await phone.waitForFunction(() => window.__maalReady === true);
  assert.equal(await phone.locator('.line').count(), 3);

  // send
  await phone.click('#sendBtn');
  await phone.waitForSelector('#s_share');
  await phone.screenshot({ path: path.join(shots, 'p2-send.png') });
  await phone.click('#s_share');
  await phone.waitForFunction(() => window.__shared && window.__shared.text);
  const message = await phone.evaluate(() => window.__shared.text);
  assert.match(message, /CROCKERY-MAAL:/);
  assert.match(message, /Rafiq Traders/);
  assert.equal(await phone.locator('.line').count(), 0, 'a new empty list is ready after sending');
  await phone.click('#menuBtn');
  await phone.click('#m_hist');
  assert.match(await phone.textContent('.sheet'), /Sent/);
  await phone.screenshot({ path: path.join(shots, 'p3-history.png') });
  await phone.click('.sheet [data-id]');
  await phone.click('#b_copy');                              // copy the sent list into a new one (new number)
  assert.equal(await phone.locator('.line').count(), 3);

  // product list from the laptop makes names suggestable + shows the shop price
  const plist = svc.exportProductsForPhone();
  await phone.click('#menuBtn');
  await phone.click('#m_prod');
  await phone.fill('#p_text', 'forwarded:\n' + plist.text);
  await phone.click('#p_load');
  assert.match(await phone.textContent('#toast'), /2 products loaded/);
  await phone.fill('#name', 'Dinner Plate');
  assert.match(await phone.textContent('#hint'), /cost 100/);
  await phone.fill('#name', '');
  await phone.fill('#name', 'Dinn');
  assert.ok((await phone.locator('#plist option').count()) >= 2);

  // ================= LAPTOP =================
  const lap = await browser.newPage({ viewport: { width: 1366, height: 820 } });
  lap.on('pageerror', (e) => errors.push('laptop pageerror: ' + e.message));
  lap.on('console', (m) => { if (m.type() === 'error') errors.push('laptop console: ' + m.text()); });
  await lap.exposeFunction('__rpc', (name, args) => {
    try { return { ok: true, data: svc[name](...args) }; } catch (e) { return { ok: false, error: e.message }; }
  });
  await lap.exposeFunction('__sysInfo', () => ({ version: '1.0.0', packaged: false, update: { status: 'idle' }, db: svc.dbInfo() }));
  await lap.addInitScript(() => {
    window.api = { call: async (n, ...a) => { const r = await window.__rpc(n, a); if (!r.ok) throw new Error(r.error); return r.data; } };
    window.sys = { info: () => window.__sysInfo(), checkUpdate: async () => ({ status: 'dev' }), installUpdate: async () => true,
      backupTo: async () => null, restore: async () => null, openBackups: async () => true, onUpdateStatus: () => {},
      mobileStatus: async () => ({ config: { enabled: false, port: 8765, hasPin: false }, running: false }), mobileApply: async () => ({}), folderStatus: async () => ({ state: 'off', folder: '' }), cloudStatus: async () => ({ configured: false, state: 'unconfigured', connected: false }) };
  });
  await lap.goto('file://' + path.resolve(__dirname, '../src/renderer/index.html'));
  await lap.waitForFunction(() => window.__appReady === true);
  await lap.click('#nav .nav-item:has-text("Products")');
  await lap.waitForSelector('#rows tr[data-id]');

  // product-list dialog renders
  await lap.click('#plist');
  await lap.waitForSelector('.modal');
  assert.match(await lap.textContent('.modal'), /2 products/);
  await lap.click('.modal [data-close]');

  // a message that is cut short is refused with a clear message
  await lap.click('#imp');
  await lap.fill('.modal [name=text]', message.slice(0, message.length - 15));
  await lap.click('.modal footer .btn.primary');
  await lap.waitForSelector('.toast.error');
  assert.match(await lap.textContent('.toast.error'), /incomplete|damaged/);
  await lap.fill('.modal [name=text]', 'Salam, ye lo\n' + message + '\nShukriya');  // extra words around it are fine
  await lap.click('.modal footer .btn.primary');
  await lap.waitForSelector('text=Check before importing');
  await lap.screenshot({ path: path.join(shots, 'l1-review.png') });
  const rows = lap.locator('.modal tbody tr');
  assert.equal(await rows.count(), 3);
  // line 1 matched "dinner plate" automatically, line 2 is new, line 3 ("Glass Set") is only a suggestion
  assert.equal(await rows.nth(0).locator('[data-sel]').inputValue(), String(svc.listProducts({ q: 'Dinner' })[0].id));
  assert.equal(await rows.nth(1).locator('[data-sel]').inputValue(), 'new');
  assert.equal(await rows.nth(2).locator('[data-sel]').inputValue(), 'new');
  assert.match(await rows.nth(2).textContent(), /Glass Set 6pc/);
  await rows.nth(2).locator('[data-sel]').selectOption(String(svc.listProducts({ q: 'Glass' })[0].id));
  await rows.nth(1).locator('[data-sale]').fill('110');
  await lap.click('.modal footer .btn.primary');
  await lap.waitForSelector('.toast.ok');
  assert.match(await lap.textContent('.toast.ok'), /Imported 3 items \(42 pcs\)/);

  // database really changed
  assert.equal(svc.listProducts({ q: 'Dinner' })[0].stock, 29);
  assert.equal(svc.listProducts({ q: 'Dinner' })[0].cost_price, 120);
  assert.equal(svc.listProducts({ q: 'Glass' })[0].stock, 8);
  const chai = svc.listProducts({ q: 'Chai' })[0];
  assert.equal(chai.stock, 12);
  assert.equal(chai.sale_price, 110);
  await lap.screenshot({ path: path.join(shots, 'l2-after.png') });

  // importing the same message again is blocked
  await lap.click('#imp');
  await lap.fill('.modal [name=text]', message);
  await lap.click('.modal footer .btn.primary');
  await lap.waitForSelector('text=already imported');
  assert.equal(await lap.locator('.modal footer .btn.primary').isDisabled(), true);
  assert.equal(svc.listProducts({ q: 'Dinner' })[0].stock, 29);

  await browser.close();
  srv.close();
  store.close();
  assert.deepEqual(errors, [], 'no browser errors: ' + errors.join(' | '));
  console.log('PHONE + IMPORT TEST OK — screenshots in ' + shots);
})().catch((e) => { console.error('PHONE TEST FAILED:', e); process.exit(1); });
