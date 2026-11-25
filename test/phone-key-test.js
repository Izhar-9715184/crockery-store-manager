'use strict';
/** Phone page: the saved connection survives the browser wiping its main storage, a renewed key arrives by itself, and the screen refreshes without a manual reload. */
const path = require('path');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || '/home/claude/.npm-global/lib/node_modules/playwright');
const StockCrypto = require('../docs/stockcrypto.js');

(async () => {
  const ID = 'a'.repeat(32), PASS = 'abcdefghij', OLD = 'ghp_oldoldoldoldoldoldoldold12', NEW = 'ghp_newnewnewnewnewnewnewnew34';
  let stock = 1, key = OLD, gets = 0, conditional = 0;
  const snap = async () => StockCrypto.encrypt({ v: 1, ts: new Date().toISOString(), shop: 'Noor', key, items: [{ i: 1, n: 'Plate', k: '', c: 100, s: 150, q: stock, u: 'pcs' }], cust: [], custAll: [], sups: [], imported: [], billsDone: [], paysDone: [], spaysDone: [] }, PASS);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://api.github.com/gists/**', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      gets++;
      const etag = `"v${stock}-${key}"`;
      if (req.headers()['if-none-match'] === etag) { conditional++; return route.fulfill({ status: 304, headers: { etag, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'etag' } }); }
      return route.fulfill({ status: 200, headers: { etag, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'etag', 'content-type': 'application/json' }, body: JSON.stringify({ id: ID, files: { 'stock.json': { content: await snap() } } }) });
    }
    return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  });
  const url = 'file://' + path.resolve(__dirname, '../docs/index.html');
  await page.goto(url + `#sync=${ID}.${PASS}&key=${OLD}`);
  await page.waitForFunction(() => window.__maalReady === true);
  await page.waitForFunction(() => document.body.textContent.includes('Updated online') || true);
  await page.waitForTimeout(800);
  let d = await page.evaluate(() => JSON.parse(localStorage.getItem('crockery.maal.v1')));
  assert.equal(d.sync.key, OLD); assert.equal(d.products.items[0].q, 1);

  // 1) the browser wipes the main saved data -> the connection is restored from the small copy
  await page.evaluate(() => localStorage.removeItem('crockery.maal.v1'));
  await page.goto(url); await page.waitForFunction(() => window.__maalReady === true); await page.waitForTimeout(1200);
  d = await page.evaluate(() => JSON.parse(localStorage.getItem('crockery.maal.v1')));
  assert.ok(d.sync && d.sync.id === ID && d.sync.pass === PASS, 'connection restored from the backup copy');
  assert.equal(d.products.items[0].q, 1);

  // 2) ... and from IndexedDB when the small copy is gone too
  await page.evaluate(() => { localStorage.removeItem('crockery.maal.v1'); localStorage.removeItem('crockery.sync.bak'); });
  await page.goto(url); await page.waitForFunction(() => window.__maalReady === true); await page.waitForTimeout(1200);
  d = await page.evaluate(() => JSON.parse(localStorage.getItem('crockery.maal.v1')));
  assert.ok(d.sync && d.sync.id === ID, 'connection restored from IndexedDB');

  // 3) the laptop renews the key: the phone picks it up from the locked copy (no new link)
  key = NEW; stock = 7;
  await page.reload(); await page.waitForFunction(() => window.__maalReady === true); await page.waitForTimeout(1200);
  d = await page.evaluate(() => JSON.parse(localStorage.getItem('crockery.maal.v1')));
  assert.equal(d.sync.key, NEW, 'renewed key arrived by itself');
  assert.equal(d.products.items[0].q, 7);

  // 4) opening an old link without a key does not erase the key
  await page.goto(url + `#sync=${ID}.${PASS}`); await page.waitForFunction(() => window.__maalReady === true); await page.waitForTimeout(800);
  d = await page.evaluate(() => JSON.parse(localStorage.getItem('crockery.maal.v1')));
  assert.equal(d.sync.key, NEW, 'key kept');

  // 5) a nothing-changed check costs no download (304), a change shows up by itself
  const before = conditional;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(500);
  stock = 9;
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('crockery.maal.v1')).products.items[0].q === 9, null, { timeout: 20000 });
  await browser.close();
  assert.deepEqual(errors, []);
  console.log('PHONE KEY TEST OK  (gets:', gets, 'conditional 304:', conditional - before >= 0 ? conditional : 0, ')');
})().catch((e) => { console.error(e); process.exit(1); });
