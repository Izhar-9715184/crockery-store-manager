'use strict';
/** Settings > Google backup card: every state, with a scripted stand-in for the program's cloud functions.
 *   node test/cloud-ui-test.js [screenshot-folder] */
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
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'crockery-cu-')));
  const svc = createService(store);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1300, height: 1500 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.exposeFunction('__rpc', (name, args) => { try { return { ok: true, data: svc[name](...args) }; } catch (e) { return { ok: false, error: e.message }; } });
  await page.exposeFunction('__sysInfo', () => ({ version: '1.0.0', packaged: false, update: { status: 'idle' }, db: svc.dbInfo() }));
  await page.addInitScript(() => {
    const cloud = { state: 'off', calls: [] };
    window.__cloud = cloud;
    const st = () => ({ configured: cloud.state !== 'unconfigured', connected: ['ok', 'choice', 'error'].includes(cloud.state), state: cloud.state, email: 'shop@gmail.com', lastOk: '2026-10-22T10:00:00', lastError: cloud.state === 'error' ? 'No internet connection. It will try again by itself.' : '', choice: cloud.state === 'choice' ? { shop: 'Rafiq Crockery', products: 42, sales: 310, at: '2026-10-21T20:15:00' } : null });
    const folder = { state: 'off', found: false };
    window.__folder = folder;
    const fst = () => ({ state: folder.state, folder: 'E:\\', target: 'E:\\Crockery Store Backup', lastOk: '2026-10-22T10:00:00', lastError: '', choice: folder.state === 'choice' ? { shop: 'Rafiq Crockery', products: 42, sales: 310, at: '2026-10-21T20:15:00' } : null });
    window.api = { call: async (n, ...a) => { const r = await window.__rpc(n, a); if (!r.ok) throw new Error(r.error); return r.data; } };
    window.sys = { info: () => window.__sysInfo(), checkUpdate: async () => ({ status: 'dev' }), installUpdate: async () => true, backupTo: async () => null, restore: async () => null, openBackups: async () => true, onUpdateStatus: () => {},
      mobileStatus: async () => ({ config: { enabled: false, port: 8765, hasPin: false }, running: false }), mobileApply: async () => ({}),
      stockSyncStatus: async () => ({ state: 'off' }), folderStatus: async () => fst(),
      folderChoose: async () => { cloud.calls.push('f-choose'); folder.state = folder.found ? 'choice' : 'ok'; return fst(); },
      folderBackupNow: async () => { cloud.calls.push('f-now'); return fst(); },
      folderList: async () => [{ name: 'crockery-latest.db', at: '2026-10-22T09:00:00', size: 90000 }, { name: 'crockery-2026-10-21.db', at: '2026-10-21T20:00:00', size: 88000 }],
      folderRestore: async (n) => { cloud.calls.push('f-restore:' + (n || 'latest')); folder.state = 'ok'; return {}; },
      folderKeep: async () => { cloud.calls.push('f-keep'); folder.state = 'ok'; return fst(); },
      folderStop: async () => { cloud.calls.push('f-stop'); folder.state = 'off'; return fst(); },
      cloudStatus: async () => st(),
      cloudConnect: async () => { cloud.calls.push('connect'); cloud.state = 'choice'; return st(); },
      cloudBackupNow: async () => { cloud.calls.push('now'); return st(); },
      cloudList: async () => [{ id: 'f1', name: 'crockery-2026-10-21.db', at: '2026-10-21T20:15:00', products: 42, sales: 310 }, { id: 'f2', name: 'crockery-latest.db', at: '2026-10-22T09:00:00', products: 43, sales: 315 }],
      cloudRestore: async (id) => { cloud.calls.push('restore:' + (id || 'latest')); cloud.state = 'ok'; return {}; },
      cloudKeep: async () => { cloud.calls.push('keep'); cloud.state = 'ok'; return st(); },
      cloudDisconnect: async () => { cloud.calls.push('out'); cloud.state = 'off'; return st(); } };
  });
  await page.goto('file://' + path.resolve(__dirname, '../src/renderer/index.html'));
  await page.waitForFunction(() => window.__appReady === true);
  const open = async () => { await page.click('#nav .nav-item:has-text("Settings")'); await page.waitForFunction(() => { const a = document.querySelector('#cloudCard'); const b = document.querySelector('#folderCard'); return a && b && !a.textContent.includes('Loading') && !b.textContent.includes('Loading'); }); };
  const card = () => page.textContent('#cloudCard');

  await page.evaluate(() => { window.__cloud.state = 'unconfigured'; });
  await open();
  assert.equal(await page.locator('#cloudWrap').isHidden(), true, 'Google card is hidden when not set up');

  // ---- folder backup card
  assert.match(await page.textContent('#folderCard'), /Choose a folder/);
  await page.screenshot({ path: path.join(shots, 'f1-off.png') });
  await page.click('#fbChoose');
  await page.waitForSelector('#fbNow');
  assert.match(await page.textContent('#folderCard'), /Crockery Store Backup/);
  await page.screenshot({ path: path.join(shots, 'f2-on.png') });
  await page.click('#fbNow');
  await page.click('#fbPick');
  await page.waitForSelector('[data-rn]');
  assert.equal(await page.locator('[data-rn]').count(), 2);
  await page.click('[data-rn="crockery-2026-10-21.db"]');
  await page.click('#fbStop');
  await page.waitForSelector('#fbChoose');
  await page.evaluate(() => { window.__folder.found = true; });
  await page.click('#fbChoose');                               // a copy from another computer is already there
  await page.waitForSelector('#fbRestore');
  assert.match(await page.textContent('#folderCard'), /Rafiq Crockery · 42 products · 310 bills/);
  assert.equal(await page.locator('#fbNow').isDisabled(), true);
  await page.screenshot({ path: path.join(shots, 'f3-choice.png') });
  await page.click('#fbRestore');
  await page.waitForSelector('#fbNow:not([disabled])');
  await page.click('#fbChange');
  await page.waitForSelector('#fbRestore');
  await page.click('#fbKeep');
  await page.waitForSelector('#fbNow:not([disabled])');
  assert.deepEqual((await page.evaluate(() => window.__cloud.calls)).filter((c) => c.startsWith('f-')),
    ['f-choose', 'f-now', 'f-restore:crockery-2026-10-21.db', 'f-stop', 'f-choose', 'f-restore:latest', 'f-choose', 'f-keep']);
  await page.evaluate(() => { window.__cloud.calls.length = 0; });

  await page.evaluate(() => { window.__cloud.state = 'off'; });
  await open();
  assert.match(await card(), /same Gmail/);
  await page.screenshot({ path: path.join(shots, 'c1-off.png') });
  await page.click('#cgIn');                                   // sign in -> a copy from another computer exists
  await page.waitForSelector('#cgRestore');
  assert.match(await card(), /Rafiq Crockery · 42 products · 310 bills/);
  assert.equal(await page.locator('#cgNow').isDisabled(), true, 'no upload while a choice is open');
  await page.screenshot({ path: path.join(shots, 'c2-choice.png') });
  await page.click('#cgRestore');
  await page.waitForSelector('#cgNow:not([disabled])');
  assert.match(await card(), /shop@gmail.com/);
  await page.screenshot({ path: path.join(shots, 'c3-ok.png') });
  await page.click('#cgNow');
  await page.click('#cgPick');
  await page.waitForSelector('[data-rf]');
  assert.equal(await page.locator('[data-rf]').count(), 2);
  await page.click('[data-rf="f1"]');
  await page.click('#cgOut');
  await page.waitForSelector('#cgIn');
  const calls = await page.evaluate(() => window.__cloud.calls);
  assert.deepEqual(calls, ['connect', 'restore:latest', 'now', 'restore:f1', 'out']);

  await page.evaluate(() => { window.__cloud.state = 'error'; });
  await open();
  assert.match(await card(), /No internet/);
  await page.screenshot({ path: path.join(shots, 'c4-error.png') });
  await browser.close();
  store.close();
  assert.deepEqual(errors, [], 'no browser errors: ' + errors.join(' | '));
  console.log('CLOUD UI TEST OK — screenshots in ' + shots);
})().catch((e) => { console.error('CLOUD UI TEST FAILED:', e); process.exit(1); });
