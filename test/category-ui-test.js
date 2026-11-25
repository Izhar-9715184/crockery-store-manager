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

  svc.saveProduct({ name: 'Plate', category: 'Shesha', cost_price: 100, sale_price: 150, stock: 3 });
  svc.saveProduct({ name: 'Bowl', category: 'Sheshaa', cost_price: 100, sale_price: 150, stock: 3 });
  svc.saveProduct({ name: 'Pot', category: 'Steel', cost_price: 100, sale_price: 150, stock: 3 });
  svc.saveSettings({ shop_name: 'Noor Crockery', shop_phone: '0300 1112223' });

  await page.goto('file://' + path.resolve(__dirname, '../src/renderer/index.html'));
  await page.waitForFunction(() => window.__appReady === true, null, { timeout: 10000 });
  await nav('Products');
  await page.click('button:has-text("Add product")');
  await page.click('.modal #catManage');
  await page.waitForSelector('.catrow');
  assert.equal(await page.locator('.catrow').count(), 3);
  await shot('c1-manage');
  // fix the typo "Sheshaa" -> "Shesha" (joins the existing category)
  const row = page.locator('.catrow', { has: page.locator('input[value="Sheshaa"]') });
  await row.locator('input').fill('Shesha');
  await row.locator('[data-save]').click();
  await page.waitForFunction(() => document.querySelectorAll('.catrow').length === 2);
  assert.deepEqual(svc.listCategories(), ['Shesha', 'Steel']);
  // delete "Steel": the product stays
  await page.locator('.catrow', { has: page.locator('input[value="Steel"]') }).locator('[data-del]').click();
  await page.locator('.overlay:last-child footer button:has-text("Delete")').click();
  await page.waitForFunction(() => document.querySelectorAll('.catrow').length === 1);
  assert.deepEqual(svc.listCategories(), ['Shesha']);
  assert.ok(svc.listProducts({}).some((p) => p.name === 'Pot' && p.category === ''));
  // the datalist behind the dialog follows
  assert.equal(await page.locator('#cats option').count(), 1);
  await shot('c2-after');
  await browser.close();
  assert.deepEqual(errors, []);
  console.log('CATEGORY UI TEST OK  screenshots:', shots);
})().catch((e) => { console.error(e); process.exit(1); });
