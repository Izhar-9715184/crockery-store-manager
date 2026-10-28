'use strict';
/**
 * Puts a LOCKED (encrypted) copy of the stock list online, so the phone can see the shop's stock
 * even when the laptop is switched off. Free: it uses a secret GitHub "Gist" of the shop owner.
 * - only products, stock and prices are sent (never customers, udhar or sales)
 * - the file is AES-encrypted with a random passphrase that only the laptop and the phone know
 * - the laptop sends a fresh copy a few seconds after any change, and when it is closed
 * Stock only changes while the software is running, so the last copy online is always the true stock.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const StockCrypto = require('../../docs/stockcrypto.js');

const FILE = 'stock.json';
const PAGES = 'https://izhar-9715184.github.io/crockery-store-manager/';
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';   // no look-alike letters

function randomPass(n = 10) {
  const b = require('crypto').randomBytes(n);
  return Array.from(b, (x) => ALPHA[x % ALPHA.length]).join('');
}
function friendly(e) {
  if (e && e.status === 401) return 'GitHub did not accept this token. Make a new token (with only the "gist" permission) and try again.';
  if (e && e.status === 403) return 'GitHub refused (the token may lack the "gist" permission, or too many requests). Try again later.';
  if (e && e.status === 404) return 'The online copy was not found (the Gist was deleted?). Press Stop, then connect again.';
  if (e && e.code && /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH/.test(e.code)) return 'No internet connection. It will try again by itself.';
  return (e && e.message) || String(e);
}

class StockSync {
  constructor({ service, store, dir, api = 'https://api.github.com', pagesUrl = PAGES, intervalMs = 20000, log } = {}) {
    this.service = service; this.store = store; this.api = api; this.pagesUrl = pagesUrl; this.intervalMs = intervalMs;
    this.log = log || (() => {});
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'stocksync.json');
    this.s = this._load();
    this.sentWrites = -1;
    this.busy = null;
    this.timer = null;
    this.waiting = [];     // phone purchases that need the owner's review
    this.tick = 0;
  }
  _load() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (_) { return {}; } }
  _save() { const t = this.file + '.tmp'; fs.writeFileSync(t, JSON.stringify(this.s, null, 1)); fs.renameSync(t, this.file); }

  _req(method, p, body, token) {
    const u = new URL(this.api + p);
    const lib = u.protocol === 'http:' ? http : https;
    return new Promise((resolve, reject) => {
      const data = body ? JSON.stringify(body) : null;
      const req = lib.request({
        method, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, timeout: 20000,
        headers: { 'User-Agent': 'crockery-store-manager', Accept: 'application/vnd.github+json', 'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
      }, (res) => {
        let out = '';
        res.on('data', (c) => { out += c; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) { try { resolve(JSON.parse(out || '{}')); } catch (_) { resolve({}); } }
          else { const e = new Error(`GitHub answered ${res.statusCode}`); e.status = res.statusCode; reject(e); }
        });
      });
      req.on('timeout', () => { req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })); });
      req.on('error', reject);
      if (data) req.write(data);
      req.end();
    });
  }

  link() { return this.s.gistId ? `${this.pagesUrl}#sync=${this.s.gistId}.${this.s.pass}&key=${this.s.token}` : ''; }
  status() {
    return { state: !this.s.gistId ? 'off' : (this.s.lastError ? 'error' : 'ok'), lastOk: this.s.lastOk || null,
      lastError: this.s.lastError || '', link: this.link(), products: this.s.count || 0, waiting: this.waiting.length, udhar: this.s.udhar !== false };
  }

  async _payload() {
    const out = this.service.exportProductsForPhone();
    const { Packing } = { Packing: require('../../docs/packing.js') };
    const obj = Packing.unpack(out.text, 'CROCKERY-PRODUCTS');
    obj.ts = new Date().toISOString();
    try { obj.shop = String(this.service.getSettings().shop_name || '').slice(0, 60); } catch (_) { /* optional */ }
    if (this.s.udhar !== false) obj.cust = this.service.exportUdharForPhone();    // names + balances of customers who owe money
    obj.imported = this.service.importedBatchIds();   // lets the phone know which of its lists are already counted
    return { content: await StockCrypto.encrypt(obj, this.s.pass), count: out.count };
  }

  /** First time: make the secret gist. token = GitHub token with only the "gist" permission. */
  async connect(token) {
    token = String(token || '').trim();
    if (token.length < 20) throw new Error('Paste the GitHub token first');
    this.s = { token, pass: randomPass() };
    try {
      const { content, count } = await this._payload();
      const g = await this._req('POST', '/gists', { description: 'Crockery shop stock (locked)', public: false, files: { [FILE]: { content } } }, token);
      this.s.gistId = g.id; this.s.count = count; this.s.lastOk = new Date().toISOString(); this.s.lastError = '';
      this.sentWrites = this.store.writes;
      this._save();
      return this.status();
    } catch (e) { this.s = {}; throw new Error(friendly(e)); }
  }

  /** Sends the stock now (does nothing when nothing changed, unless force). */
  push({ force = false } = {}) {
    if (!this.s.gistId) return Promise.resolve(this.status());
    if (this.busy) return this.busy;
    if (!force && this.store.writes === this.sentWrites) return Promise.resolve(this.status());
    const w = this.store.writes;
    this.busy = (async () => {
      try {
        const { content, count } = await this._payload();
        await this._req('PATCH', `/gists/${this.s.gistId}`, { files: { [FILE]: { content } } }, this.s.token);
        this.sentWrites = w; this.s.count = count; this.s.lastOk = new Date().toISOString(); this.s.lastError = '';
      } catch (e) { this.s.lastError = friendly(e); this.log(`stock sync: ${this.s.lastError}`); }
      this._save();
      this.busy = null;
      return this.status();
    })();
    return this.busy;
  }
  /**
   * Purchases written on the phone arrive as small locked files (maal-*.json) in the same Gist.
   * Exact-match lists are added to the stock at once; the rest wait for review. Handled files are removed.
   */
  async poll() {
    if (!this.s.gistId) return;
    let g;
    try { g = await this._req('GET', `/gists/${this.s.gistId}`, null, this.s.token); } catch (e) { return; }
    const waiting = [];
    const remove = {};
    let imported = false;
    for (const [name, f] of Object.entries(g.files || {})) {
      if (!/^maal-[\w-]+\.json$/.test(name) || !f || f.truncated) continue;
      try {
        const batch = await StockCrypto.decrypt(f.content, this.s.pass);
        const text = require('../../docs/packing.js').pack('CROCKERY-MAAL', batch);
        const r = this.service.autoImportPurchase(text);
        if (r.status === 'review') waiting.push({ name, id: r.id, date: r.date, supplier: r.supplier, lines: r.lines, text });
        else { remove[name] = null; if (r.status === 'imported') imported = true; }
      } catch (e) { this.log(`phone list ${name}: ${e.message}`); }
    }
    this.waiting = waiting;
    if (Object.keys(remove).length) {
      try { await this._req('PATCH', `/gists/${this.s.gistId}`, { files: remove }, this.s.token); } catch (e) { /* removed next time */ }
    }
    if (imported) await this.push({ force: true });
  }
  waitingList() { return this.waiting.map((w) => ({ id: w.id, date: w.date, supplier: w.supplier, lines: w.lines, text: w.text })); }

  dirty() { return !!this.s.gistId && this.store.writes !== this.sentWrites; }

  /** Choose whether customers' udhar is also put online (locked) for the phone's Udhar tab. */
  async setUdhar(on) {
    this.s.udhar = !!on; this._save();
    return this.push({ force: true });
  }

  stop() {
    this.s = {}; this.sentWrites = -1; this._save();
    return this.status();
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick++;
      (this.tick % 3 === 0 ? this.poll() : Promise.resolve()).catch(() => {}).then(() => this.push()).catch(() => {});
    }, this.intervalMs);
    if (this.timer.unref) this.timer.unref();
    setTimeout(() => { this.poll().catch(() => {}).then(() => this.push({ force: true })).catch(() => {}); }, 8000).unref();
  }
  /** Last copy when the program is closed (max ~6 s). */
  async pushOnExit() {
    if (!this.dirty()) return;
    await Promise.race([this.push().catch(() => {}), new Promise((r) => setTimeout(r, 6000))]);
  }
}

module.exports = { StockSync };
