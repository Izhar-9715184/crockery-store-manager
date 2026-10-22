'use strict';
/**
 * Google Drive backup: every shop signs in with its own Gmail and the data is copied
 * into a hidden app folder of THAT person's Google Drive ("appDataFolder"). Nobody else
 * (including the software seller) can see it, and it costs nothing.
 *
 * - sign-in: Google "installed app" flow with PKCE, answered on http://127.0.0.1:<port>
 * - backup:  a verified snapshot is uploaded on a timer, on exit and on request
 * - restore: on a new computer, sign in with the same Gmail and bring the data back
 * - safety:  each installation has an id. If the cloud copy belongs to ANOTHER installation
 *            nothing is uploaded until the user chooses (restore it, or replace it) so a new,
 *            empty computer can never overwrite a good cloud copy.
 *
 * Only Node's own modules are used, so it also runs inside the old Electron 22 (Windows 7/8).
 */
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { dateStr, inspectFile } = require('../core/db');

const DEFAULT_ENDPOINTS = {
  auth: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  revoke: 'https://oauth2.googleapis.com/revoke',
  api: 'https://www.googleapis.com/drive/v3',
  upload: 'https://www.googleapis.com/upload/drive/v3',
};
const SCOPE = 'openid email https://www.googleapis.com/auth/drive.appdata';
const LATEST = 'crockery-latest.db';
const KEEP_DAILY = 30;
const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function request(urlStr, { method = 'GET', headers = {}, body, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(new Error('Bad address: ' + urlStr)); }
    const lib = u.protocol === 'http:' ? http : https;
    const h = { ...headers };
    if (body !== undefined) h['Content-Length'] = Buffer.byteLength(body);
    const req = lib.request({ protocol: u.protocol, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, method, headers: h }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(timeout, () => req.destroy(new Error('TIMEOUT')));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
const form = (o) => Object.keys(o).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&');
const asJson = (r) => { try { return JSON.parse(r.body.toString('utf8') || '{}'); } catch (_) { return {}; } };

function friendly(e) {
  const m = String((e && (e.code || e.message)) || e);
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|TIMEOUT/.test(m)) {
    return 'No internet connection. It will try again by itself.';
  }
  return e && e.message ? e.message : m;
}

class CloudBackup {
  /**
   * @param {object} o
   *  store      the Store (core/db.js)
   *  dir        folder for cloud.json (the sign-in is kept here)
   *  config     { clientId, clientSecret }
   *  openUrl    (url) => opens the Google sign-in page in the user's browser
   *  crypt      optional { encrypt(str)->base64, decrypt(base64)->str } to protect the sign-in token
   *  endpoints  optional override (tests use a fake Google)
   */
  constructor({ store, dir, config, openUrl, crypt, log, endpoints } = {}) {
    this.store = store;
    this.dir = dir;
    this.config = config || {};
    this.openUrl = openUrl || (() => { throw new Error('Cannot open the browser'); });
    this.crypt = crypt || null;
    this.log = log || (() => {});
    this.ep = { ...DEFAULT_ENDPOINTS, ...(endpoints || {}) };
    this.file = path.join(dir, 'cloud.json');
    fs.mkdirSync(dir, { recursive: true });
    this.s = this._load();
    if (!this.s.installId) { this.s.installId = crypto.randomUUID(); this._save(); }
    this.access = null;
    this.accessExp = 0;
    this.busy = false;
    this._q = Promise.resolve();
    this.lastWrites = -1;
    this._timers = [];
  }

  // ------------------------------------------------------------ small state file
  _load() {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (_) { return {}; }
  }
  _save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.s, null, 1));
    fs.renameSync(tmp, this.file);
  }
  _setRefresh(t) {
    if (!t) { delete this.s.refresh; return; }
    try { this.s.refresh = this.crypt ? 'enc:' + this.crypt.encrypt(t) : 'raw:' + t; } catch (_) { this.s.refresh = 'raw:' + t; }
  }
  _getRefresh() {
    const v = this.s.refresh;
    if (!v) return null;
    if (v.startsWith('enc:')) { try { return this.crypt.decrypt(v.slice(4)); } catch (_) { return null; } }
    return v.slice(4);
  }

  isConfigured() {
    const c = this.config || {};
    return !!(c.clientId && c.clientSecret && !/PASTE|YOUR_/i.test(c.clientId + c.clientSecret));
  }

  status() {
    const connected = !!this._getRefresh();
    let state = 'ok';
    if (!this.isConfigured()) state = 'unconfigured';
    else if (!connected) state = this.s.email ? 'signin' : 'off';
    else if (this.s.needsChoice) state = 'choice';
    else if (this.s.lastError) state = 'error';
    return {
      configured: this.isConfigured(), connected, state, busy: this.busy,
      email: this.s.email || '', lastOk: this.s.lastOk || null, lastError: this.s.lastError || '',
      choice: this.s.needsChoice || null,
    };
  }

  // ------------------------------------------------------------ Google sign-in
  async connect() {
    if (!this.isConfigured()) {
      throw new Error('Google sign-in is not set up in this copy of the software yet. Please ask your software provider.');
    }
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));

    const { code, redirect } = await new Promise((resolve, reject) => {
      let done = false;
      const server = http.createServer((req, res) => {
        const u = new URL(req.url, 'http://127.0.0.1');
        if (u.pathname !== '/cb') { res.writeHead(404); return res.end('Not found'); }
        const page = (t) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;text-align:center;margin-top:80px"><h2>${t}</h2><p>You can close this tab and go back to the software.</p>`); };
        if (done) return page('Already done.');
        if (u.searchParams.get('error')) { done = true; page('Sign-in was cancelled.'); finish(new Error('Sign-in was cancelled.')); return; }
        if (u.searchParams.get('state') !== state || !u.searchParams.get('code')) { page('Something went wrong.'); return; }
        done = true;
        page('Signed in successfully ✔');
        finish(null, u.searchParams.get('code'));
      });
      const timer = setTimeout(() => finish(new Error('Sign-in took too long. Please try again.')), 5 * 60 * 1000);
      function finish(err, code) {
        clearTimeout(timer);
        const redirect = `http://127.0.0.1:${server.address() ? server.address().port : 0}/cb`;
        setTimeout(() => { try { server.close(); } catch (_) { /* ignore */ } }, 300);
        if (err) reject(err); else resolve({ code, redirect });
      }
      server.on('error', (e) => reject(e));
      server.listen(0, '127.0.0.1', () => {
        const redirect = `http://127.0.0.1:${server.address().port}/cb`;
        const url = this.ep.auth + '?' + form({
          client_id: this.config.clientId, redirect_uri: redirect, response_type: 'code', scope: SCOPE,
          code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent',
        });
        try { this.openUrl(url); } catch (e) { finish(e); }
      });
    });

    const r = await request(this.ep.token, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ code, client_id: this.config.clientId, client_secret: this.config.clientSecret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }),
    }).catch((e) => { throw new Error(friendly(e)); });
    const j = asJson(r);
    if (r.status !== 200 || !j.access_token) throw new Error('Google refused the sign-in' + (j.error_description ? ': ' + j.error_description : '.'));
    if (!j.refresh_token) throw new Error('Google did not allow permanent access. Please sign in again and press "Allow".');
    if (j.scope && !String(j.scope).includes('drive.appdata')) {
      throw new Error('Please tick the Google Drive box on the Google page, otherwise backups cannot be saved.');
    }
    let email = '';
    try { email = JSON.parse(Buffer.from(String(j.id_token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).email || ''; } catch (_) { /* ignore */ }
    this.access = j.access_token;
    this.accessExp = Date.now() + (j.expires_in || 3600) * 1000;
    this._setRefresh(j.refresh_token);
    this.s.email = email || this.s.email || '';
    this.s.lastError = '';
    this.s.needsChoice = null;
    this._save();

    // does this Gmail already hold a copy that belongs to another computer?
    try {
      const files = await this._list();
      const latest = files.find((f) => f.name === LATEST);
      if (latest && (latest.appProperties || {}).installId !== this.s.installId) {
        this.s.needsChoice = this._choiceInfo(latest);
        this._save();
        return this.status();
      }
      await this.backupNow({ force: true });
    } catch (e) {
      this.s.lastError = friendly(e);
      this._save();
    }
    return this.status();
  }

  async disconnect() {
    const t = this._getRefresh();
    if (t) { try { await request(this.ep.revoke + '?token=' + encodeURIComponent(t), { method: 'POST', timeout: 8000 }); } catch (_) { /* best effort */ } }
    this._setRefresh(null);
    this.access = null;
    this.s.needsChoice = null;
    this.s.lastError = '';
    this.s.email = '';
    this._save();
    return this.status();
  }

  async _token() {
    if (this.access && Date.now() < this.accessExp - 60000) return this.access;
    const refresh = this._getRefresh();
    if (!refresh) throw new Error('Please sign in with Google first.');
    const r = await request(this.ep.token, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form({ client_id: this.config.clientId, client_secret: this.config.clientSecret, refresh_token: refresh, grant_type: 'refresh_token' }),
    });
    const j = asJson(r);
    if (r.status !== 200 || !j.access_token) {
      if (j.error === 'invalid_grant' || r.status === 400 || r.status === 401) {
        this._setRefresh(null); this.access = null; this._save();
        throw new Error('Google sign-in expired. Please sign in again (your data is safe).');
      }
      throw new Error('Could not reach Google (' + r.status + ').');
    }
    this.access = j.access_token;
    this.accessExp = Date.now() + (j.expires_in || 3600) * 1000;
    return this.access;
  }

  // ------------------------------------------------------------ Drive calls
  async _drive(method, url, { json, body, headers = {}, raw } = {}) {
    const tok = await this._token();
    const h = { Authorization: 'Bearer ' + tok, ...headers };
    let b = body;
    if (json !== undefined) { b = JSON.stringify(json); h['Content-Type'] = 'application/json; charset=UTF-8'; }
    const r = await request(url, { method, headers: h, body: b });
    if (r.status === 401) this.access = null;
    if (r.status >= 400) {
      const e = asJson(r).error || {};
      throw new Error('Google Drive: ' + (e.message || 'error ' + r.status));
    }
    return raw ? r : asJson(r);
  }
  async _list() {
    const j = await this._drive('GET', `${this.ep.api}/files?` + form({ spaces: 'appDataFolder', pageSize: 200, fields: 'files(id,name,size,modifiedTime,appProperties)' }));
    return j.files || [];
  }
  async _put(name, filePath, props, existingId) {
    const data = fs.readFileSync(filePath);
    const meta = existingId ? { appProperties: props } : { name, parents: ['appDataFolder'], appProperties: props };
    const start = await this._drive(
      existingId ? 'PATCH' : 'POST',
      existingId ? `${this.ep.upload}/files/${existingId}?uploadType=resumable` : `${this.ep.upload}/files?uploadType=resumable`,
      { json: meta, headers: { 'X-Upload-Content-Type': 'application/octet-stream' }, raw: true });
    const loc = start.headers.location;
    if (!loc) throw new Error('Google Drive did not accept the upload.');
    const tok = await this._token();
    const r = await request(loc, { method: 'PUT', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/octet-stream' }, body: data, timeout: 5 * 60 * 1000 });
    if (r.status >= 400) throw new Error('Google Drive upload failed (' + r.status + ').');
  }
  async _delete(id) { await this._drive('DELETE', `${this.ep.api}/files/${id}`, { raw: true }); }

  _meta() {
    const g = (sql) => { try { return this.store.get(sql); } catch (_) { return null; } };
    return {
      shop: (g("SELECT value FROM settings WHERE key='shop_name'") || {}).value || '',
      products: String((g('SELECT COUNT(*) c FROM products') || {}).c || 0),
      sales: String((g('SELECT COUNT(*) c FROM sales') || {}).c || 0),
    };
  }
  _choiceInfo(f) {
    const p = f.appProperties || {};
    return { fileId: f.id, at: p.at || f.modifiedTime || '', shop: p.shop || '', products: Number(p.products || 0), sales: Number(p.sales || 0), size: Number(f.size || 0) };
  }

  _locked(fn) {
    const run = this._q.then(async () => { this.busy = true; try { return await fn(); } finally { this.busy = false; } });
    this._q = run.catch(() => {});
    return run;
  }

  // ------------------------------------------------------------ backup / restore
  /** Upload a verified snapshot. opts.force: replace a cloud copy that belongs to another computer. opts.final: end-of-day copy too. */
  backupNow(opts = {}) {
    return this._locked(async () => {
      if (!this._getRefresh()) throw new Error('Please sign in with Google first.');
      if (this.s.needsChoice && !opts.force) return this.status();
      const tmp = path.join(os.tmpdir(), `crockery-cloud-${process.pid}-${Date.now()}.db`);
      try {
        const writes = this.store.writes;
        const files = await this._list();
        const latest = files.find((f) => f.name === LATEST);
        if (!opts.force && latest && (latest.appProperties || {}).installId !== this.s.installId) {
          this.s.needsChoice = this._choiceInfo(latest);   // another computer took over this Gmail
          this._save();
          return this.status();
        }
        this.store.backupTo(tmp);
        inspectFile(tmp);                                    // never upload a damaged snapshot
        const props = { installId: this.s.installId, at: new Date().toISOString(), ...this._meta() };
        await this._put(LATEST, tmp, props, latest && latest.id);
        const dname = `crockery-${dateStr()}.db`;
        const daily = files.find((f) => f.name === dname);
        if (!daily || opts.final) await this._put(dname, tmp, props, daily && daily.id);
        const dailies = files.filter((f) => /^crockery-\d{4}-\d{2}-\d{2}\.db$/.test(f.name)).sort((a, b) => (a.name < b.name ? 1 : -1));
        if (!daily) dailies.unshift({ name: dname });
        for (const old of dailies.slice(KEEP_DAILY)) { if (old.id) { try { await this._delete(old.id); } catch (_) { /* ignore */ } } }
        this.lastWrites = writes;
        this.s.needsChoice = null;
        this.s.lastOk = new Date().toISOString();
        this.s.lastError = '';
        this._save();
        return this.status();
      } catch (e) {
        this.s.lastError = friendly(e);
        this._save();
        throw new Error(this.s.lastError);
      } finally {
        try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      }
    });
  }

  /** Copies available in the user's Drive, newest first. */
  async listCloud() {
    const files = await this._list();
    return files
      .map((f) => ({ id: f.id, name: f.name, size: Number(f.size || 0), at: (f.appProperties || {}).at || f.modifiedTime, shop: (f.appProperties || {}).shop || '', products: Number((f.appProperties || {}).products || 0), sales: Number((f.appProperties || {}).sales || 0) }))
      .sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  /** Replace this computer's data with a cloud copy (a safety copy of the current data is made first). */
  restore(fileId) {
    return this._locked(async () => {
      const files = await this._list();
      const f = fileId ? files.find((x) => x.id === fileId) : files.find((x) => x.name === LATEST);
      if (!f) throw new Error('No backup was found in this Google account.');
      const tmp = path.join(os.tmpdir(), `crockery-restore-${process.pid}-${Date.now()}.db`);
      try {
        const r = await this._drive('GET', `${this.ep.api}/files/${f.id}?alt=media`, { raw: true });
        fs.writeFileSync(tmp, r.body);
        const res = this.store.restoreFrom(tmp);          // verifies the file first
        this.s.needsChoice = null;
        this.s.lastError = '';
        this._save();
        return res;
      } catch (e) {
        throw new Error(friendly(e));
      } finally {
        try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      }
    }).then(async (res) => { try { await this.backupNow({ force: true }); } catch (_) { /* shown in status */ } return res; });
  }

  /** "This computer has the right data": replace the cloud copy with it. */
  async keepThisComputer() {
    this.s.needsChoice = null;
    this._save();
    return this.backupNow({ force: true });
  }

  // ------------------------------------------------------------ automatic
  start() {
    const tick = () => {
      if (!this._getRefresh() || !this.isConfigured() || this.s.needsChoice || this.busy) return;
      const old = !this.s.lastOk || Date.now() - Date.parse(this.s.lastOk) > 6 * 3600 * 1000;
      if (this.store.writes === this.lastWrites && !old) return;
      this.backupNow().catch((e) => this.log('cloud backup: ' + e.message));
    };
    this._timers.push(setTimeout(tick, 20 * 1000), setInterval(tick, 10 * 60 * 1000));
    this._timers.forEach((t) => t.unref && t.unref());
  }
  stop() { this._timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); this._timers = []; }

  /** Last backup when the program is closed. Never blocks the exit for more than a few seconds. */
  async backupOnExit(ms = 12000) {
    if (!this._getRefresh() || !this.isConfigured() || this.s.needsChoice) return;
    if (this.store.writes === this.lastWrites) return;
    await Promise.race([this.backupNow({ final: true }).catch((e) => this.log('cloud backup on exit: ' + e.message)), new Promise((r) => setTimeout(r, ms))]);
  }
}

module.exports = { CloudBackup, request };
