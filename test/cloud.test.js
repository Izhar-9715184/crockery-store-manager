'use strict';
/** The whole Google Drive backup logic, run against a small fake Google (no internet needed). */
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/core/db');
const { createService } = require('../src/core/service');
const { CloudBackup } = require('../src/cloud/cloud');

function fakeGoogle() {
  const st = { files: [], seq: 1, tokens: 0, failToken: false, revoked: 0, email: 'shop@gmail.com', scope: 'openid email https://www.googleapis.com/auth/drive.appdata', online: true };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const send = (code, obj, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...headers }); res.end(typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj)); };
      if (!st.online) return req.socket.destroy();
      if (u.pathname === '/token') {
        const p = new URLSearchParams(body.toString());
        if (p.get('grant_type') === 'authorization_code') {
          if (!p.get('code_verifier')) return send(400, { error: 'invalid_request' });
          const id = Buffer.from(JSON.stringify({ email: st.email })).toString('base64').replace(/=/g, '');
          return send(200, { access_token: 'at' + (++st.tokens), refresh_token: 'rt-' + st.email, expires_in: 3600, scope: st.scope, id_token: 'h.' + id + '.s' });
        }
        if (st.failToken) return send(400, { error: 'invalid_grant' });
        return send(200, { access_token: 'at' + (++st.tokens), expires_in: 3600 });
      }
      if (u.pathname === '/revoke') { st.revoked++; return send(200, {}); }
      if (!/^Bearer at/.test(req.headers.authorization || '') && u.pathname.startsWith('/up')) return send(401, { error: { message: 'no token' } });
      const mine = () => st.files.filter((f) => f.owner === st.email);
      if (req.method === 'GET' && u.pathname === '/drive/v3/files') {
        return send(200, { files: mine().map((f) => ({ id: f.id, name: f.name, size: String(f.data ? f.data.length : 0), modifiedTime: f.modified, appProperties: f.props })) });
      }
      const m = u.pathname.match(/^\/drive\/v3\/files\/(.+)$/);
      if (m && req.method === 'GET') { const f = mine().find((x) => x.id === m[1]); return f ? send(200, f.data, { 'Content-Type': 'application/octet-stream' }) : send(404, { error: { message: 'nf' } }); }
      if (m && req.method === 'DELETE') { st.files = st.files.filter((x) => x.id !== m[1]); return send(204, ''); }
      if (u.pathname.startsWith('/upload/drive/v3/files') && (req.method === 'POST' || req.method === 'PATCH')) {
        const meta = JSON.parse(body.toString() || '{}');
        let f;
        const id = u.pathname.split('/')[5];
        if (req.method === 'PATCH') { f = mine().find((x) => x.id === id); f.props = meta.appProperties || f.props; }
        else { f = { id: 'f' + st.seq++, name: meta.name, owner: st.email, props: meta.appProperties || {}, data: Buffer.alloc(0) }; st.files.push(f); }
        st.pending = f;
        return send(200, {}, { Location: `http://127.0.0.1:${srv.address().port}/put/${f.id}` });
      }
      if (u.pathname.startsWith('/put/') && req.method === 'PUT') { const f = st.files.find((x) => x.id === u.pathname.slice(5)); f.data = body; f.modified = new Date().toISOString(); return send(200, {}); }
      send(404, { error: { message: 'unknown ' + u.pathname } });
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, st, base: `http://127.0.0.1:${srv.address().port}` })));
}

async function setup(g, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-' + name + '-'));
  const store = new Store(path.join(dir, 'data'));
  const svc = createService(store);
  const cloud = new CloudBackup({
    store, dir, config: { clientId: 'id.apps', clientSecret: 'sec' }, log: () => {},
    endpoints: { auth: g.base + '/auth', token: g.base + '/token', revoke: g.base + '/revoke', api: g.base + '/drive/v3', upload: g.base + '/upload/drive/v3' },
    // pretend to be the user's browser: the "browser" answers on the redirect address
    openUrl: (url) => { const u = new URL(url); setTimeout(() => http.get(u.searchParams.get('redirect_uri') + '?code=abc&state=' + u.searchParams.get('state'), (r) => r.resume()), 20); },
  });
  return { dir, store, svc, cloud };
}
const rows = (store) => store.all('SELECT name FROM products ORDER BY name').map((r) => r.name);

test('not set up: sign-in explains it instead of crashing', async () => {
  const g = await fakeGoogle();
  const a = await setup(g, 'a');
  a.cloud.config = { clientId: 'PASTE_CLIENT_ID_HERE', clientSecret: 'PASTE_CLIENT_SECRET_HERE' };
  assert.equal(a.cloud.status().state, 'unconfigured');
  await assert.rejects(a.cloud.connect(), /not set up/);
  g.srv.close();
});

test('sign in on an empty Google account uploads the data; sign-in is protected on disk', async () => {
  const g = await fakeGoogle();
  const a = await setup(g, 'a');
  a.svc.saveProduct({ name: 'Dinner Plate', cost_price: 100, sale_price: 150, stock: 5 });
  const s = await a.cloud.connect();
  assert.equal(s.state, 'ok');
  assert.equal(s.email, 'shop@gmail.com');
  const names = g.st.files.map((f) => f.name).sort();
  assert.equal(names.length, 2);
  assert.ok(names.includes('crockery-latest.db'));
  assert.ok(names.some((n) => /^crockery-\d{4}-\d{2}-\d{2}\.db$/.test(n)));
  // what is in the cloud is a real, healthy copy of the shop data
  const copy = path.join(a.dir, 'check.db');
  fs.writeFileSync(copy, g.st.files.find((f) => f.name === 'crockery-latest.db').data);
  const c = new Store(path.dirname(copy) + '/chk'); c.restoreFrom(copy); assert.deepEqual(rows(c), ['Dinner Plate']); c.close();
  g.srv.close(); a.store.close();
});

test('a new computer with the same Gmail must choose; nothing is overwritten, then restore brings everything back', async () => {
  const g = await fakeGoogle();
  const a = await setup(g, 'a');
  a.svc.saveProduct({ name: 'Dinner Plate', cost_price: 100, sale_price: 150, stock: 5 });
  a.svc.saveProduct({ name: 'Tea Cup', cost_price: 20, sale_price: 40, stock: 50 });
  await a.cloud.connect();
  const before = g.st.files.find((f) => f.name === 'crockery-latest.db').data.length;

  const b = await setup(g, 'b');            // new, empty computer
  b.svc.saveProduct({ name: 'Junk', cost_price: 1, sale_price: 2, stock: 1 });
  const s = await b.cloud.connect();
  assert.equal(s.state, 'choice');
  assert.equal(s.choice.products, 2);
  await b.cloud.backupNow();                // blocked while the choice is open
  assert.equal(g.st.files.find((f) => f.name === 'crockery-latest.db').data.length, before, 'cloud copy untouched');

  await b.cloud.restore();
  assert.deepEqual(rows(b.store), ['Dinner Plate', 'Tea Cup']);
  assert.equal(b.cloud.status().state, 'ok');
  assert.ok(b.store.listBackups().some((x) => /pre-restore/.test(x.name)), 'safety copy of the old data was made');

  // the first computer is now told that someone else took over, and does not overwrite
  const s2 = await a.cloud.backupNow();
  assert.equal(s2.state, 'choice');
  // ... until its owner decides "my data is right"
  a.svc.saveProduct({ name: 'Extra', cost_price: 1, sale_price: 2, stock: 1 });
  await a.cloud.keepThisComputer();
  assert.equal(a.cloud.status().state, 'ok');
  const list = await a.cloud.listCloud();
  assert.ok(list.length >= 2);
  g.srv.close(); a.store.close(); b.store.close();
});

test('the same computer signing in again continues quietly; sign out keeps the cloud copy', async () => {
  const g = await fakeGoogle();
  const a = await setup(g, 'a');
  await a.cloud.connect();
  await a.cloud.disconnect();
  assert.equal(g.st.revoked, 1);
  assert.equal(a.cloud.status().connected, false);
  assert.equal(g.st.files.length, 2, 'cloud copy is kept');
  const s = await a.cloud.connect();
  assert.equal(s.state, 'ok');
  g.srv.close(); a.store.close();
});

test('expired sign-in asks to sign in again; offline only shows a friendly message', async () => {
  const g = await fakeGoogle();
  const a = await setup(g, 'a');
  await a.cloud.connect();
  a.cloud.accessExp = 0;
  g.st.online = false;
  await assert.rejects(a.cloud.backupNow(), /No internet/);
  assert.match(a.cloud.status().lastError, /No internet/);
  assert.equal(a.cloud.status().state, 'error');
  g.st.online = true;
  a.cloud.accessExp = 0; g.st.failToken = true;
  await assert.rejects(a.cloud.backupNow(), /sign in again/);
  assert.equal(a.cloud.status().state, 'signin');
  g.srv.close(); a.store.close();
});

test('missing Drive permission on the Google page is refused with a clear message', async () => {
  const g = await fakeGoogle();
  g.st.scope = 'openid email';
  const a = await setup(g, 'a');
  await assert.rejects(a.cloud.connect(), /Google Drive box/);
  g.srv.close(); a.store.close();
});

test('exit backup only uploads when something changed', async () => {
  const g = await fakeGoogle();
  const a = await setup(g, 'a');
  await a.cloud.connect();
  const t0 = g.st.files.find((f) => f.name === 'crockery-latest.db').modified;
  await a.cloud.backupOnExit();                           // nothing changed
  assert.equal(g.st.files.find((f) => f.name === 'crockery-latest.db').modified, t0);
  a.svc.saveProduct({ name: 'New', cost_price: 1, sale_price: 2, stock: 1 });
  await new Promise((r) => setTimeout(r, 15));
  await a.cloud.backupOnExit();
  assert.notEqual(g.st.files.find((f) => f.name === 'crockery-latest.db').modified, t0);
  g.srv.close(); a.store.close();
});
