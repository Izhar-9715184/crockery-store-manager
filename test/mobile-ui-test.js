'use strict';
/**
 * Phone-size end-to-end test: real HTTP server + real database + the phone screens in Chromium.
 *   node test/mobile-ui-test.js [screenshot-folder]
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/home/claude/.npm-global/lib/node_modules/playwright');
const { Store } = require('../src/core/db');
const { createService } = require('../src/core/service');
const { MobileServer } = require('../src/server/server');

const shots = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'mshots-'));
fs.mkdirSync(shots, { recursive: true });

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crockery-mui-'));
  const store = new Store(dir);
  const svc = createService(store);
  svc.setMobileAccess({ pin: 'owner-1234', enabled: true });
  // desktop already has some data
  svc.saveProduct({ name: 'Dinner Plate', code: 'DP1', cost_price: 120, sale_price: 180, stock: 20, min_stock: 5 });
  svc.saveCustomer({ name: 'Ali Traders', phone: '0300-1234567', opening_balance: 2500 });
  const srv = new MobileServer({ service: svc });
  await srv.start(0);
  const base = `http://127.0.0.1:${srv.port}`;

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/401|429|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  const shot = (n) => page.screenshot({ path: path.join(shots, n + '.png') });
  const toastText = () => page.locator('#toast').textContent();
  const tab = (id) => page.click(`#tabs [data-t=${id}]`);

  // ---- login (wrong PIN first)
  await page.goto(base);
  await page.waitForSelector('#loginForm');
  await shot('m1-login');
  await page.fill('#pin', 'wrong-pin');
  await page.click('#loginForm button');
  await page.waitForFunction(() => document.querySelector('#loginErr').textContent.includes('Wrong PIN'));
  await page.fill('#pin', 'owner-1234');
  await page.click('#loginForm button');
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForSelector('#list .row');

  // ---- sale: tap the product twice, open the bill, put 400 received, pick Ali -> udhar
  await page.click('#list .row');
  await page.click('#list .row');
  await page.waitForSelector('#openCart');
  assert.match(await page.textContent('#openCart'), /360/);
  await shot('m2-sale');
  await page.click('#openCart');
  await page.waitForSelector('.sheet .line');
  // Android Back button must close the pop-up, not leave the app
  await page.goBack();
  await page.waitForFunction(() => !document.querySelector('.sheet'));
  assert.ok(page.url().startsWith(base), 'still inside the app after Back');
  await page.click('#openCart');
  await page.waitForSelector('.sheet .line');
  await page.selectOption('#cust', { index: 1 });
  await page.fill('#paid', '100');
  assert.match(await page.textContent('#due'), /260/);
  await shot('m3-bill');
  await page.click('.sheet footer .btn.primary');
  await page.waitForSelector('text=Sale saved');
  await shot('m4-saved');
  assert.equal(svc.listProducts({ q: 'plate' })[0].stock, 18, 'stock reduced on the desktop database');
  assert.equal(svc.getCustomer(1).balance, 2760);
  await page.click('.sheet footer .btn:not(.teal)');   // "New sale"

  // not enough stock -> clear message, bill kept
  await page.click('#list .row');
  await page.click('#openCart');
  await page.fill('.line [data-f=qty]', '500');
  await page.click('.sheet footer .btn.primary');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Not enough stock'));
  await page.click('.sheet .x');   // close bill

  // ---- stock: add a product, stock in, broken
  await tab('stock');
  await page.waitForSelector('#list .row');
  await page.click('#add');
  await page.fill('.sheet [name=name]', 'Tea Cup <b>');
  await page.fill('.sheet [name=cost_price]', '50');
  await page.fill('.sheet [name=sale_price]', '80');
  await page.fill('.sheet [name=stock]', '12');
  await page.click('.sheet footer .btn.primary');
  await page.waitForFunction(() => document.querySelectorAll('#list .row').length === 2);
  assert.ok((await page.textContent('#list')).includes('Tea Cup <b>'), 'names are escaped');
  await page.click('#list .row:has-text("Tea Cup")');
  await page.click('[data-a=in]');
  await page.fill('.sheet [name=qty]', '8');
  await page.click('.sheet footer .btn.primary');
  await page.waitForFunction(() => !document.querySelector('.sheet'));
  assert.equal(svc.listProducts({ q: 'cup' })[0].stock, 20);
  await shot('m5-stock');
  await page.click('#list .row:has-text("Tea Cup")');
  await page.click('[data-a=broken]');
  await page.fill('.sheet [name=qty]', '2');
  await page.click('.sheet footer .btn.primary');
  await page.waitForFunction(() => !document.querySelector('.sheet'));
  assert.equal(svc.listProducts({ q: 'cup' })[0].stock, 18);

  // ---- udhar: ledger + receive payment
  await tab('udhar');
  await page.waitForSelector('#list .row');
  assert.ok((await page.textContent('#list')).includes('2,760'));
  await page.click('#list .row');
  await page.waitForSelector('.sheet [data-a=pay]');
  await shot('m6-ledger');
  await page.click('[data-a=pay]');
  await page.fill('.sheet:last-child [name=amount], .shade:last-child [name=amount]', '1000');
  await page.click('.shade:last-child .sheet footer .btn.primary');
  await page.waitForFunction(() => document.querySelector('.sheet') && document.querySelector('.sheet').textContent.includes('1,760'));
  assert.equal(svc.getCustomer(1).balance, 1760);
  await page.click('.sheet .x');

  // ---- today
  await tab('today');
  await page.waitForSelector('.stats');
  await shot('m7-today');

  // ---- session survives a reload; wrong/expired token returns to login
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  svc.setMobileAccess({ pin: 'changed-pin-99' });
  await tab('stock');
  await page.waitForSelector('#login:not([hidden])');

  await browser.close();
  await srv.stop();
  store.close();
  assert.deepEqual(errors, [], 'no browser errors: ' + errors.join(' | '));
  console.log('MOBILE UI TEST OK — screenshots in ' + shots);
})().catch((e) => { console.error('MOBILE UI TEST FAILED:', e); process.exit(1); });
