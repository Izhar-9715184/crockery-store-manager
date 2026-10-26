'use strict';
/**
 * End-to-end test of the real screens in Chromium, wired to the real database
 * code (same as Electron does through IPC). Needs Playwright:
 *   node test/edit-ui-test.js [screenshot-folder]
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/home/claude/.npm-global/lib/node_modules/playwright');
const { Store } = require('../src/core/db');
const { createService } = require('../src/core/service');
const { MobileServer } = require('../src/server/server');

const shots = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'shots-'));
fs.mkdirSync(shots, { recursive: true });

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crockery-ui-'));
  const store = new Store(dir);
  const svc = createService(store);

  const mobile = new MobileServer({ service: svc });
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
  await page.exposeFunction('__mobStatus', () => ({ config: svc.getMobileConfig(), ...mobile.status() }));
  await page.exposeFunction('__mobApply', async (o) => {
    try {
      svc.setMobileAccess(o);
      const c = svc.getMobileConfig();
      if (c.enabled && c.hasPin) await mobile.start(0); else await mobile.stop();
      return { ok: true, data: { config: c, ...mobile.status() } };
    } catch (e) { return { ok: false, error: e.message }; }
  });
  await page.addInitScript(() => {
    window.api = { call: async (n, ...a) => { const r = await window.__rpc(n, a); if (!r.ok) throw new Error(r.error); return r.data; } };
    window.sys = { info: () => window.__sysInfo(), checkUpdate: async () => ({ status: 'dev' }), installUpdate: async () => true,
      mobileStatus: () => window.__mobStatus(), mobileApply: async (o) => { const r = await window.__mobApply(o); if (!r.ok) throw new Error(r.error); return r.data; },
      backupTo: async () => null, restore: async () => null, openBackups: async () => true, onUpdateStatus: () => {}, folderStatus: async () => ({ state: 'off', folder: '' }), cloudStatus: async () => ({ configured: false, state: 'unconfigured', connected: false }) };
    window.print = () => { window.__printed = (window.__printed || 0) + 1; };
  });

  const nav = (label) => page.click(`#nav .nav-item:has-text("${label}")`);
  const shot = async (name) => { await page.waitForTimeout(750); await page.screenshot({ path: path.join(shots, name + '.png') }); };
  const plate = svc.saveProduct({ name: 'Plate', cost_price: 100, sale_price: 150, stock: 0 });
  svc.stockIn({ product_id: plate.id, qty: 100, cost_price: 100 });   // typed 100 instead of 10
  const ali = svc.saveCustomer({ name: 'Ali Khan' });
  svc.addOldBalance({ customer_id: ali.id, amount: 5000 });
  svc.receivePayment({ customer_id: ali.id, amount: 3000 });          // typed 3000 instead of 300
  const sale = svc.createSale({ customer_id: ali.id, items: [{ product_id: plate.id, qty: 2, price: 150 }], paid: 0 });

  await page.goto('file://' + path.resolve(__dirname, '../src/renderer/index.html'));
  await page.waitForFunction(() => window.__appReady === true, null, { timeout: 10000 });

  // 1) ledger: edit the wrong payment
  await nav('Customers');
  await page.click('button[data-a=ledger]');
  await page.waitForSelector('.modal .edit-link[data-edit]');
  await shot('edit-1-ledger');
  await page.click('.modal .edit-link[data-edit] >> nth=0');   // newest first: [bill row, payment, opening]; data-edit skips the bill row
  await page.fill('.modal [name=amount]', '300');
  await page.click('.modal footer button:has-text("Save changes")');
  await page.waitForFunction(() => document.body.textContent.includes('Entry updated'));
  assert.equal(svc.getCustomer(ali.id).balance, 5000 - 300 + 300);
  assert.ok((await page.textContent('.modal-body')).includes('edited'));
  // the bill row has an "Edit bill" link (not "Edit")
  assert.equal(await page.locator('.modal .edit-link[data-bill]').count(), 1);
  await page.click('.modal .edit-link[data-bill]');
  await page.waitForSelector('.modal footer button:has-text("Edit bill")');
  await page.click('.modal footer button:has-text("Edit bill")');
  await page.waitForSelector('.edit-banner');
  assert.equal(await page.locator('.overlay').count(), 0, 'all dialogs closed');
  await shot('edit-2-bill');
  await page.fill('#cart input.qty', '1');
  await page.click('#save');
  await page.waitForSelector('#page .page-head, #page table');
  const s2 = svc.getSale(sale.id);
  assert.equal(s2.items[0].qty, 1);
  assert.equal(s2.total, 150);
  assert.equal(svc.getCustomer(ali.id).balance, 5000 - 300 + 150);

  // 2) sales history: Edit bill from the bill dialog
  await nav('Sales');
  await page.click('tbody tr[data-id]');
  await page.click('.modal footer button:has-text("Edit bill")');
  await page.waitForSelector('.edit-banner');
  await page.click('#cancelEdit');
  await page.waitForSelector('tbody tr[data-id]');

  // 3) stock history: edit the 100 -> 10
  await nav('Products');
  await page.click('button[data-a=hist]');
  await page.waitForSelector('.modal .edit-link[data-edit]');
  await shot('edit-3-stock');
  await page.click('.modal .edit-link[data-edit]');
  await page.fill('.modal [name=qty]', '10');
  await page.click('.modal footer button:has-text("Save changes")');
  await page.waitForFunction(() => document.body.textContent.includes('Stock entry updated'));
  assert.equal(svc.listProducts({})[0].stock, 9);
  await page.waitForSelector('.modal .edited-tag');

  await browser.close();
  assert.deepEqual(errors, []);
  console.log('EDIT UI TEST OK  screenshots:', shots);
})().catch((e) => { console.error(e); process.exit(1); });
