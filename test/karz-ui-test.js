'use strict';
/**
 * End-to-end test of the real screens in Chromium, wired to the real database
 * code (same as Electron does through IPC). Needs Playwright:
 *   node test/karz-ui-test.js [screenshot-folder]
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
      backupTo: async () => null, readStyles: async () => window.__css, saveFile: async (o) => { (window.__saved = window.__saved || []).push(o); return 'C:/Docs/' + o.name; }, restore: async () => null, openBackups: async () => true, onUpdateStatus: () => {}, stockSyncStatus: async () => ({ state: 'off' }), folderStatus: async () => ({ state: 'off', folder: '' }), cloudStatus: async () => ({ configured: false, state: 'unconfigured', connected: false }) };
    window.print = () => { window.__printed = (window.__printed || 0) + 1; };
  });

  const nav = (label) => page.click(`#nav .nav-item:has-text("${label}")`);
  const shot = async (name) => { await page.waitForTimeout(600); await page.screenshot({ path: path.join(shots, name + '.png') }); };
  const css = fs.readFileSync(path.resolve(__dirname, '../src/renderer/styles.css'), 'utf8');
  await page.addInitScript((c) => { window.__css = c; }, css);

  const plate = svc.saveProduct({ name: 'Plate', cost_price: 100, sale_price: 150, stock: 0 });
  const ali = svc.saveCustomer({ name: 'Ali Khan', phone: '0300 1234567' });
  svc.saveSettings({ shop_name: 'Noor Crockery', shop_phone: '0300 1112223' });

  await page.goto('file://' + path.resolve(__dirname, '../src/renderer/index.html'));
  await page.waitForFunction(() => window.__appReady === true, null, { timeout: 10000 });

  // ===== A) stock in on karz from a wholesaler, from the Products page
  await nav('Products');
  await page.click('button[data-a=in]');
  await page.fill('.modal [name=qty]', '10');
  await page.fill('.modal [name=cost_price]', '100');
  await page.fill('.modal [name=supplier]', 'Rafiq Traders');
  await page.waitForSelector('.modal #siPay:not([hidden])');
  assert.match(await page.textContent('.modal #siInfo'), /karz added: Rs 1,000/);
  assert.match(await page.textContent('.modal #siInfo'), /new wholesaler/);
  await page.click('.modal #siSeg [data-m=part]');
  await page.fill('.modal [name=paid_part]', '300');
  assert.match(await page.textContent('.modal #siInfo'), /karz added: Rs 700/);
  await shot('k1-stockin');
  await page.click('.modal footer button:has-text("Add stock")');
  await page.waitForFunction(() => document.body.textContent.includes('Wholesale Karz'));
  assert.equal(svc.listSuppliers({})[0].balance, 700);
  assert.equal(svc.getProduct ? svc.getProduct(plate.id).stock : 10, 10);

  // second stock-in, supplier typed in other letters = same wholesaler, all on karz
  await page.click('button[data-a=in]');
  await page.fill('.modal [name=qty]', '5');
  await page.fill('.modal [name=cost_price]', '100');
  await page.fill('.modal [name=supplier]', 'rafiq traders');
  await page.click('.modal footer button:has-text("Add stock")');
  await page.waitForTimeout(300);
  assert.equal(svc.listSuppliers({}).length, 1);
  assert.equal(svc.listSuppliers({})[0].balance, 1200);

  // ===== B) the Wholesale Karz page
  await nav('Wholesale Karz');
  await page.waitForSelector('#rows tr[data-id]');
  assert.match(await page.textContent('#sub'), /1 wholesaler.*Rs 1,200/);
  await shot('k2-page');
  await page.click('#rows button[data-a=ledger]');
  await page.waitForSelector('.modal .edit-link[data-edit]');
  assert.match(await page.textContent('.modal-body'), /Maal: Plate × 10 @ 100/);
  await shot('k3-account');
  await page.click('.modal button[data-a=pay]');
  await page.fill('.overlay:last-of-type [name=amount]', '200');
  await page.click('.overlay:last-of-type footer button:has-text("Save payment")');
  await page.waitForFunction(() => document.body.textContent.includes('Karz remaining: Rs 1,000'));
  assert.equal(svc.listSuppliers({})[0].balance, 1000);
  await page.waitForSelector('.preview .inv');
  assert.match(await page.textContent('.preview .inv'), /PAYMENT MADE/i);
  assert.match(await page.textContent('.preview .inv'), /1,000/);
  await shot('k3b-payment-receipt');
  await page.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => o.remove()));
  // old karz for a brand-new wholesaler
  await page.click('#oldk');
  await page.fill('.modal [name=name]', 'Hajji Sons');
  await page.fill('.modal [name=amount]', '5000');
  await page.click('.modal footer button:has-text("Save")');
  await page.waitForFunction(() => document.body.textContent.includes('You owe Hajji Sons'));
  assert.equal(svc.listSuppliers({}).length, 2);
  await page.click('#seg [data-d="1"]');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#rows tr[data-id]').count(), 2);
  await shot('k4-two');

  // ===== C) receipt first: Save & Receipt -> preview -> Save as PDF / picture / Print
  await nav('New Sale');
  await page.fill('#q', 'plate');
  await page.waitForSelector('#results [data-id], .result, #results *');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#cart input.qty');
  await page.fill('#cart input.qty', '2');
  await page.selectOption('#customer', String(ali.id));
  await page.click('#savePrint');
  await page.waitForSelector('.modal .preview .inv');
  assert.equal(await page.evaluate(() => window.__printed || 0), 0, 'nothing is printed before the owner chooses');
  assert.match(await page.textContent('.modal-title, .modal header'), /Receipt INV/);
  for (const b of ['Save as PDF', 'Save as picture', 'Print']) assert.ok(await page.locator(`.modal footer button:has-text("${b}")`).count(), b);
  await shot('k5-receipt');
  await page.click('.modal footer button:has-text("Save as picture")');
  await page.waitForFunction(() => (window.__saved || []).length === 1, null, { timeout: 10000 });
  await page.click('.modal footer button:has-text("Save as PDF")');
  await page.waitForFunction(() => (window.__saved || []).length === 2, null, { timeout: 10000 });
  const saved = await page.evaluate(() => window.__saved);
  const png = Buffer.from(saved[0].base64, 'base64'), pdf = Buffer.from(saved[1].base64, 'base64');
  assert.equal(saved[0].kind, 'png'); assert.equal(saved[1].kind, 'pdf');
  assert.match(saved[0].name, /^INV-.*\.png$/); assert.match(saved[1].name, /\.pdf$/);
  assert.equal(png.slice(1, 4).toString(), 'PNG');
  assert.equal(pdf.slice(0, 5).toString(), '%PDF-');
  assert.ok(png.length > 5000 && pdf.length > 5000);
  fs.writeFileSync(path.join(shots, 'receipt.png'), png);
  fs.writeFileSync(path.join(shots, 'receipt.pdf'), pdf);
  await page.click('.modal footer button:has-text("Print")');
  await page.waitForFunction(() => window.__printed === 1);

  await page.click('.modal footer button:has-text("Close")');

  // ===== D) customer statement: preview first, then Print / PDF / picture
  await nav('Customers');
  await page.waitForSelector('#rows tr');
  await page.click('#rows tr:has-text("Ali Khan") button[data-a=ledger]');
  await page.waitForSelector('.modal button[data-a=print]');
  await page.click('.modal button[data-a=print]');
  await page.waitForSelector('.modal .preview .inv');
  assert.equal(await page.evaluate(() => window.__printed), 1, 'statement is not printed before choosing (still only the bill print)');
  assert.match(await page.textContent('.modal .preview'), /STATEMENT/i);
  for (const b of ['Save as PDF', 'Save as picture', 'Print']) assert.ok(await page.locator(`.modal footer button:has-text("${b}")`).last().count(), b);
  await shot('k6-statement');
  await page.evaluate(() => { window.__saved = []; });
  await page.locator('.modal footer button:has-text("Save as PDF")').last().click();
  await page.waitForFunction(() => (window.__saved || []).length === 1, null, { timeout: 10000 });
  await page.locator('.modal footer button:has-text("Save as picture")').last().click();
  await page.waitForFunction(() => (window.__saved || []).length === 2, null, { timeout: 10000 });
  const st = await page.evaluate(() => window.__saved);
  assert.match(st[0].name, /^Statement-Ali_Khan.*\.pdf$/);
  assert.equal(Buffer.from(st[0].base64, 'base64').slice(0, 5).toString(), '%PDF-');
  assert.equal(Buffer.from(st[1].base64, 'base64').slice(1, 4).toString(), 'PNG');
  await page.locator('.modal footer button:has-text("Print")').last().click();
  await page.waitForFunction(() => window.__printed === 2);

  await browser.close();
  assert.deepEqual(errors, []);
  console.log('KARZ + RECEIPT UI TEST OK  screenshots:', shots);
})().catch((e) => { console.error(e); process.exit(1); });
