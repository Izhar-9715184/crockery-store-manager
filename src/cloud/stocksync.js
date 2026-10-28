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

  link() { return this.s.gistId ? `${this.pagesUrl}#sync=${this.s.gistId}.${this.s.pass}` : ''; }
  status() {
    return { state: !this.s.gistId ? 'off' : (this.s.lastError ? 'error' : 'ok'), lastOk: this.s.lastOk || null,
      lastError: this.s.lastError || '', link: this.link(), products: this.s.count || 0 };
  }

  async _payload() {
    const out = this.service.exportProductsForPhone();
    const { Packing } = { Packing: require('../../docs/packing.js') };
    const obj = Packing.unpack(out.text, 'CROCKERY-PRODUCTS');
    obj.ts = new Date().toISOString();
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
  dirty() { return !!this.s.gistId && this.store.writes !== this.sentWrites; }

  stop() {
    this.s = {}; this.sentWrites = -1; this._save();
    return this.status();
  }
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => { this.push().catch(() => {}); }, this.intervalMs);
    if (this.timer.unref) this.timer.unref();
    setTimeout(() => { this.push({ force: true }).catch(() => {}); }, 8000).unref();
  }
  /** Last copy when the program is closed (max ~6 s). */
  async pushOnExit() {
    if (!this.dirty()) return;
    await Promise.race([this.push().catch(() => {}), new Promise((r) => setTimeout(r, 6000))]);
  }
}

module.exports = { StockSync };
