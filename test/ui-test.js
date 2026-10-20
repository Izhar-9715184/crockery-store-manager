'use strict';
/**
 * End-to-end test of the real screens in Chromium, wired to the real database
 * code (same as Electron does through IPC). Needs Playwright:
 *   node test/ui-test.js [screenshot-folder]
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/home/claude/.npm-global/lib/node_modules/playwright');
const { Store } = require('../src/core/db');
const { createService } = require('../src/core/service');

const shots = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'));
fs.mkdirSync(shots, { recursive: true });

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crockery-ui-'));
  const store = new Store(dir);
  const svc = createService(store);

  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const page = await browser.newPage({ viewport: { width: 1366, height: 820 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.accept());

  // Stand-in for preload.js: same API shape, backed by the real service.
  await page.exposeFunction('__rpc', (name, args) => {
    try { return { ok: true, data: svc[name](...args) }; } catch (e) { return { ok: false, error: e.message }; }
  });
  await page.exposeFunction('__sysInfo', () => ({ version: '1.0.0', packaged: false, update: { status: 'idle' }, db: svc.dbInfo() }));
  await page.addInitScript(() => {
    window.api = { call: async (n, ...a) => { const r = await window.__rpc(n, a); if (!r.ok) throw new Error(r.error); return r.data; } };
    window.sys = { info: () => window.__sysInfo(), checkUpdate: async () => ({ status: 'dev' }), installUpdate: async () => true,
      backupTo: async () => null, restore: async () => null, openBackups: async () => true, onUpdateStatus: () => {} };
    window.print = () => { window.__printed = (window.__printed || 0) + 1; };
  });

  const shot = (name) => page.screenshot({ path: path.join(shots, name + '.png') });
  const nav = (label) => page.click(`#nav .nav-item:has-text("${label}")`);
  const toastText = async () => (await page.locator('.toast').last().textContent());

  await page.goto('file://' + path.resolve(__dirname, '../src/renderer/index.html'));
  await page.waitForFunction(() => window.__appReady === true, null, { timeout: 10000 });
  await page.waitForSelector('.stats');
  await shot('01-dashboard-empty');

  // ---- add products through the UI
  await nav('Products');
  await page.click('#add');
  await page.fill('[name=name]', 'Dinner Plate 10"');
  await page.fill('[name=code]', 'DP10');
  await page.fill('[name=category]', 'Plates');
  await page.fill('[name=cost_price]', '120');
  await page.fill('[name=sale_price]', '180');
  await page.fill('[name=stock]', '24');
  await page.fill('[name=min_stock]', '6');
  await page.click('.modal footer .btn.primary');
  await page.waitForSelector('#rows tr[data-id]');
  await page.click('#add');
  await page.fill('[name=name]', '<b>Tea Cup</b> Set');   // special characters must be shown literally
  await page.fill('[name=cost_price]', '600');
  await page.fill('[name=sale_price]', '950');
  await page.fill('[name=stock]', '3');
  await page.fill('[name=min_stock]', '4');
  await page.click('.modal footer .btn.primary');
  await page.waitForFunction(() => document.querySelectorAll('#rows tr[data-id]').length === 2);
  assert.ok((await page.textContent('#rows')).includes('<b>Tea Cup</b> Set'), 'HTML in names is escaped');
  await shot('02-products');

  // duplicate code must be rejected with a friendly message
  await page.click('#add');
  await page.fill('[name=name]', 'Other');
  await page.fill('[name=code]', 'DP10');
  await page.click('.modal footer .btn.primary');
  await page.waitForSelector('.toast.error');
  assert.match(await toastText(), /already used/);
  await page.click('.modal [data-close]');

  // stock in
  await page.click('tr[data-id="2"] [data-a=in]');
  await page.fill('.modal [name=qty]', '12');
  await page.click('.modal footer .btn.primary');
  await page.waitForFunction(() => document.querySelector('tr[data-id="2"]').textContent.includes('15'));

  // ---- customer with old udhar
  await nav('Customers');
  await page.click('#add');
  await page.fill('[name=name]', 'Ali Traders');
  await page.fill('[name=phone]', '0300-1234567');
  await page.fill('[name=opening_balance]', '2500');
  await page.click('.modal footer .btn.primary');
  await page.waitForSelector('#rows tr[data-id]');
  assert.ok((await page.textContent('#rows')).includes('2,500'));
  await shot('03-customers');

  // ---- new sale: cash walk-in, with keyboard (type + Enter)
  await nav('New Sale');
  await page.fill('#q', 'plate');
  await page.waitForSelector('.prod-row.first');
  await page.press('#q', 'Enter');
  await page.press('#q', 'Enter');       // second Enter = quantity 2
  await page.waitForSelector('#cart tr[data-idx]');
  assert.equal(await page.inputValue('#cart .qty'), '2');
  assert.match(await page.textContent('#total'), /360/);
  await shot('04-new-sale');
  await page.click('#save');
  await page.waitForSelector('.toast.ok');
  assert.match(await toastText(), /INV-00001/);

  // ---- sale on udhar to Ali
  await page.fill('#q', 'tea');
  await page.waitForSelector('.prod-row');
  await page.click('.prod-row');
  await page.selectOption('#customer', '1');
  await page.fill('#discount', '50');
  await page.fill('#paid', '400');
  assert.match(await page.textContent('#due'), /500/);   // 950-50=900, paid 400 -> udhar 500
  await page.click('#savePrint');
  await page.waitForSelector('.toast.ok');
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(() => window.__printed), 1, 'print was triggered');
  assert.equal(svc.getCustomer(1).balance, 3000);
  assert.equal(svc.listProducts({ q: 'plate' })[0].stock, 22);

  // not enough stock must show a clear error and keep the bill
  await page.fill('#q', 'tea');
  await page.waitForSelector('.prod-row');
  await page.click('.prod-row');
  await page.fill('#cart .qty', '99');
  await page.click('#save');
  await page.waitForSelector('.toast.error');
  assert.match(await toastText(), /Not enough stock/);
  assert.equal(await page.locator('#cart tr[data-idx]').count(), 1, 'cart kept after error');
  await page.click('#clear');
  await page.click('.modal footer .btn.primary');

  // ---- sales history + invoice view
  await nav('Sales History');
  await page.waitForSelector('#rows tr[data-id]');
  assert.equal(await page.locator('#rows tr[data-id]').count(), 2);
  await page.click('#rows tr[data-id]:first-child');
  await page.waitForSelector('.modal .invoice');
  await shot('05-invoice');
  await page.click('.modal [data-close]');

  // ---- ledger and payment
  await nav('Customers');
  await page.click('tr[data-id="1"] [data-a=ledger]');
  await page.waitForSelector('.modal table');
  await shot('06-ledger');
  await page.click('.modal [data-a=pay]');
  await page.fill('.overlay:last-child [name=amount]', '1000');
  await page.click('.overlay:last-child footer .btn.primary');
  await page.waitForFunction(() => document.querySelector('.modal-body').textContent.includes('2,000'));
  assert.equal(svc.getCustomer(1).balance, 2000);
  await page.click('.modal [data-close]');

  // ---- cancel the udhar sale from history
  await nav('Sales History');
  await page.click('#rows tr[data-id]:first-child');
  await page.click('.modal footer .btn.danger');
  await page.fill('.overlay:last-child [name=t]', 'customer returned');
  await page.click('.overlay:last-child footer .btn.primary');
  await page.waitForSelector('#rows tr.cancelled');
  assert.equal(svc.getCustomer(1).balance, 1500);
  assert.equal(svc.listProducts({ q: 'tea' })[0].stock, 15);

  // ---- dashboard / reports / settings
  await nav('Dashboard');
  await page.waitForSelector('.bars');
  await shot('07-dashboard');
  await nav('Reports');
  await page.waitForSelector('#rep .stats');
  await shot('08-reports');
  await page.click('#tabs [data-t=udhar]');
  await page.waitForSelector('tbody tr.click');
  await nav('Settings');
  await page.waitForSelector('#bk');
  await page.click('#bk');
  await page.waitForSelector('.toast.ok');
  await shot('09-settings');

  await browser.close();
  store.close();
  assert.deepEqual(errors, [], 'no browser errors: ' + errors.join(' | '));
  console.log('UI TEST OK — screenshots in ' + shots);
})().catch((e) => { console.error('UI TEST FAILED:', e); process.exit(1); });
