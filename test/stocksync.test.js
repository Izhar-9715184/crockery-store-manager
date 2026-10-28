'use strict';
// Stock online for the phone: locked copy in a (fake) GitHub Gist.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { Store } = require('../src/core/db');
const { createService } = require('../src/core/service');
const { StockSync } = require('../src/cloud/stocksync');
const StockCrypto = require('../docs/stockcrypto.js');

function fakeGithub() {
  const gists = {};
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.headers.authorization !== 'Bearer ghp_goodtoken_goodtoken_1234') return send(401, {});
      if (req.method === 'POST' && req.url === '/gists') { const id = 'a'.repeat(32); gists[id] = JSON.parse(body).files; return send(201, { id }); }
      const m = /^\/gists\/(\w+)$/.exec(req.url);
      if (req.method === 'GET' && m && gists[m[1]]) return send(200, { id: m[1], files: gists[m[1]] });
      if (req.method === 'PATCH' && m && gists[m[1]]) {
        for (const [k, v] of Object.entries(JSON.parse(body).files)) { if (v === null) delete gists[m[1]][k]; else gists[m[1]][k] = v; }
        srv.patches = (srv.patches || 0) + 1; return send(200, { id: m[1] });
      }
      send(404, {});
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, gists, api: `http://127.0.0.1:${srv.address().port}` })));
}
const setup = (api) => {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'crockery-ss-')));
  const service = createService(store);
  service.saveProduct({ name: 'Plate', cost_price: 100, sale_price: 150, stock: 7 });
  const ss = new StockSync({ service, store, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'crockery-ssd-')), api });
  return { store, service, ss };
};

test('crypto: round trip, wrong passphrase refused', async () => {
  const t = await StockCrypto.encrypt({ a: 'اردو', n: 5 }, 'secret1');
  assert.deepEqual(await StockCrypto.decrypt(t, 'secret1'), { a: 'اردو', n: 5 });
  await assert.rejects(StockCrypto.decrypt(t, 'secret2'), /Wrong passphrase/);
  assert.ok(!t.includes('اردو'));
});

test('connect makes a locked gist with stock only; changes are pushed; nothing changed = nothing sent', async () => {
  const { srv, gists, api } = await fakeGithub();
  const { store, service, ss } = setup(api);
  try {
    await assert.rejects(ss.connect('ghp_wrongtoken_wrongtoken_99'), /did not accept/);
    assert.equal(ss.status().state, 'off');
    const st = await ss.connect('ghp_goodtoken_goodtoken_1234');
    assert.equal(st.state, 'ok');
    assert.match(st.link, /#sync=a{32}\.[a-z2-9]{10}&key=/);
    const raw = gists['a'.repeat(32)]['stock.json'].content;
    assert.ok(!raw.includes('Plate'), 'online copy is locked');
    const pass = st.link.split('#sync=')[1].split('&')[0].split('.')[1];
    let obj = await StockCrypto.decrypt(raw, pass);
    assert.equal(obj.items[0].q, 7);
    assert.ok(obj.ts);
    await ss.push();                                    // unchanged
    assert.equal(srv.patches || 0, 0);
    const p = service.listProducts({})[0];
    service.stockIn({ product_id: p.id, qty: 3, cost_price: 100 });
    assert.equal(ss.dirty(), true);
    await ss.push();
    obj = await StockCrypto.decrypt(gists['a'.repeat(32)]['stock.json'].content, pass);
    assert.equal(obj.items[0].q, 10);
    assert.equal(ss.dirty(), false);
    // settings are remembered after a restart
    const again = new StockSync({ service, store, dir: path.dirname(ss.file), api });
    assert.equal(again.status().state, 'ok');
    assert.equal(ss.stop().state, 'off');
  } finally { srv.close(); store.close(); }
});

test('no internet: error is shown, program keeps working, retried later', async () => {
  const { srv, api } = await fakeGithub();
  const { store, service, ss } = setup(api);
  try {
    await ss.connect('ghp_goodtoken_goodtoken_1234');
    srv.close();
    const p = service.listProducts({})[0];
    service.stockIn({ product_id: p.id, qty: 1, cost_price: 100 });
    const st = await ss.push();
    assert.equal(st.state, 'error');
    assert.match(st.lastError, /internet/);
    assert.equal(ss.dirty(), true);                     // will be retried
  } finally { store.close(); }
});

test('phone purchase arrives online: exact names are added at once, odd names wait for review', async () => {
  const { srv, gists, api } = await fakeGithub();
  const { store, service, ss } = setup(api);
  try {
    const st = await ss.connect('ghp_goodtoken_goodtoken_1234');
    assert.match(st.link, /&key=ghp_goodtoken_goodtoken_1234$/);
    const pass = st.link.split('#sync=')[1].split('&')[0].split('.')[1];
    const gid = 'a'.repeat(32);
    gists[gid]['maal-b-good1.json'] = { content: await StockCrypto.encrypt({ v: 1, id: 'b-good1', date: '2026-10-28', supplier: 'Rafiq', lines: [{ n: 'plate', q: 5, c: 110 }] }, pass) };
    gists[gid]['maal-b-odd01.json'] = { content: await StockCrypto.encrypt({ v: 1, id: 'b-odd01', date: '2026-10-28', supplier: 'Rafiq', lines: [{ n: 'Plat typo', q: 2, c: 10 }] }, pass) };
    await ss.poll();
    assert.equal(service.listProducts({})[0].stock, 12);                  // 7 + 5
    assert.ok(!gists[gid]['maal-b-good1.json'], 'handled file removed');
    assert.ok(gists[gid]['maal-b-odd01.json'], 'unclear list stays');
    assert.equal(ss.status().waiting, 1);
    assert.equal(ss.waitingList()[0].id, 'b-odd01');
    // the snapshot tells the phone which lists are already counted, and has the new stock
    const obj = await StockCrypto.decrypt(gists[gid]['stock.json'].content, pass);
    assert.equal(obj.items[0].q, 12);
    assert.ok(obj.imported.includes('b-good1'));
    // same list sent twice -> never added twice
    gists[gid]['maal-b-good1.json'] = { content: await StockCrypto.encrypt({ v: 1, id: 'b-good1', date: '2026-10-28', lines: [{ n: 'plate', q: 5, c: 110 }] }, pass) };
    await ss.poll();
    assert.equal(service.listProducts({})[0].stock, 12);
    assert.ok(!gists[gid]['maal-b-good1.json']);
    // owner reviews the odd list at the laptop -> next poll clears it
    service.applyPurchaseImport({ text: ss.waitingList()[0].text, decisions: [{ action: 'new', sale_price: 20 }] });
    await ss.poll();
    assert.equal(ss.status().waiting, 0);
    assert.ok(!gists[gid]['maal-b-odd01.json']);
  } finally { srv.close(); store.close(); }
});
