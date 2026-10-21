'use strict';
/**
 * Mobile access: a small web server inside the desktop app.
 * The phone opens its address in the browser, enters the owner's PIN, and then
 * uses the same business logic (and the same database) as the desktop screens.
 *
 * Security:
 *  - nothing works without the PIN (scrypt-hashed, never stored in plain text)
 *  - 5 wrong PINs from one device -> locked for 5 minutes
 *  - random session tokens, valid 30 days, cancelled automatically when the PIN changes
 *  - only a fixed list of actions can be called (no settings/backup/restore)
 *  - NEVER open this port on the router to the public internet; use Tailscale or WiFi only
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const MOBILE_DIR = path.join(__dirname, '..', 'mobile');

const ALLOWED = new Set([
  'dashboard', 'summary', 'stockReport',
  'listProducts', 'listCategories', 'saveProduct', 'deleteProduct', 'stockIn', 'adjustStock', 'stockHistory',
  'listCustomers', 'getCustomer', 'saveCustomer', 'deleteCustomer', 'customerLedger', 'receivePayment', 'adjustCustomer',
  'createSale', 'getSale', 'listSales', 'cancelSale', 'getSettings',
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const SESSION_MS = 30 * 24 * 3600 * 1000;
const LOCK_MS = 5 * 60 * 1000;
const MAX_FAILS = 5;
const MAX_BODY = 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class MobileServer {
  constructor({ service, log }) {
    this.service = service;
    this.log = log || (() => {});
    this.server = null;
    this.port = null;
    this.sessions = new Map(); // token -> { exp, fp }
    this.fails = new Map();    // ip -> { n, until }
    this.error = null;
  }

  start(port) {
    return new Promise((resolve, reject) => {
      if (this.server) return resolve(this.status());
      const srv = http.createServer((req, res) => {
        this._handle(req, res).catch((e) => {
          this.log(`mobile server error: ${e.stack || e.message}`);
          if (!res.headersSent) this._json(res, 500, { ok: false, error: 'Server error' });
          else res.end();
        });
      });
      srv.requestTimeout = 30000;
      srv.on('error', (e) => {
        this.error = e.code === 'EADDRINUSE'
          ? `Port ${port} is already used by another program. Choose another port.`
          : e.message;
        this.server = null;
        reject(new Error(this.error));
      });
      srv.listen(port, '0.0.0.0', () => {
        this.server = srv;
        this.port = srv.address().port;
        this.error = null;
        this.log(`Mobile access listening on port ${this.port}`);
        resolve(this.status());
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      this.sessions.clear();
      if (!this.server) return resolve();
      const s = this.server;
      this.server = null;
      this.port = null;
      s.close(() => resolve());
      if (s.closeAllConnections) s.closeAllConnections();
    });
  }

  status() {
    return {
      running: !!this.server,
      port: this.port,
      error: this.error,
      addresses: this.server ? lanAddresses().map((a) => `http://${a}:${this.port}`) : [],
    };
  }

  // ---------------------------------------------------------------- internals
  _json(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(body);
  }

  _readJson(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BODY) { reject(new Error('Request too large')); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
        catch (_) { reject(new Error('Bad request')); }
      });
      req.on('error', reject);
    });
  }

  _auth(req) {
    const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
    if (!m) return false;
    const s = this.sessions.get(m[1]);
    if (!s) return false;
    if (s.exp < Date.now() || s.fp !== this.service.mobilePinFingerprint()) {
      this.sessions.delete(m[1]);
      return false;
    }
    return true;
  }

  async _handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const ip = req.socket.remoteAddress || '?';

    // ---- API
    if (url.pathname === '/api/info' && req.method === 'GET') {
      const s = this.service.getSettings();
      return this._json(res, 200, { ok: true, shop_name: s.shop_name });
    }

    if (url.pathname === '/api/login' && req.method === 'POST') {
      const f = this.fails.get(ip);
      if (f && f.until > Date.now()) {
        return this._json(res, 429, { ok: false, error: 'Too many wrong PINs. Please wait 5 minutes.' });
      }
      let body;
      try { body = await this._readJson(req); } catch (e) { return this._json(res, 400, { ok: false, error: e.message }); }
      const pin = typeof body.pin === 'string' ? body.pin : '';
      if (pin && this.service.checkMobilePin(pin)) {
        this.fails.delete(ip);
        for (const [t, s] of this.sessions) if (s.exp < Date.now()) this.sessions.delete(t);
        const token = crypto.randomBytes(32).toString('hex');
        this.sessions.set(token, { exp: Date.now() + SESSION_MS, fp: this.service.mobilePinFingerprint() });
        return this._json(res, 200, { ok: true, token });
      }
      const rec = this.fails.get(ip) || { n: 0, until: 0 };
      rec.n += 1;
      if (rec.n >= MAX_FAILS) { rec.n = 0; rec.until = Date.now() + LOCK_MS; this.log(`Mobile login locked for ${ip}`); }
      this.fails.set(ip, rec);
      await sleep(400);
      return this._json(res, 401, { ok: false, error: 'Wrong PIN' });
    }

    if (url.pathname === '/api/call' && req.method === 'POST') {
      if (!this._auth(req)) return this._json(res, 401, { ok: false, error: 'Please log in again', login: true });
      let body;
      try { body = await this._readJson(req); } catch (e) { return this._json(res, 400, { ok: false, error: e.message }); }
      const name = body.name;
      if (typeof name !== 'string' || !ALLOWED.has(name) || typeof this.service[name] !== 'function') {
        return this._json(res, 403, { ok: false, error: 'Not allowed' });
      }
      try {
        const data = this.service[name](...(Array.isArray(body.args) ? body.args : []));
        return this._json(res, 200, { ok: true, data });
      } catch (e) {
        return this._json(res, 200, { ok: false, error: e.message });
      }
    }

    if (url.pathname.startsWith('/api/')) return this._json(res, 404, { ok: false, error: 'Not found' });

    // ---- static phone screens
    if (req.method !== 'GET' && req.method !== 'HEAD') return this._json(res, 405, { ok: false, error: 'Method not allowed' });
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch (_) { return this._json(res, 400, { ok: false, error: 'Bad request' }); }
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.join(MOBILE_DIR, path.normalize(rel));
    if (!file.startsWith(MOBILE_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }
}

/** IPv4 addresses of this computer (WiFi, cable, Tailscale ...). */
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  return out;
}

module.exports = { MobileServer, ALLOWED, lanAddresses };
