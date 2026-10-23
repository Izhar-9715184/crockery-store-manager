'use strict';
/**
 * Automatic copy of the shop data into a folder the owner chooses: a USB drive, or a folder that
 * Google Drive / OneDrive / Dropbox keeps in the cloud. No sign-in, no setup, works on every Windows.
 *
 * - a verified snapshot is written next to the old copy and only then replaces it (a crash or a
 *   full disk can never leave a half-written "latest" file)
 * - dated copies of the last 30 days are kept
 * - a sidecar file remembers which installation wrote the copy. If the chosen folder already holds
 *   the copy of ANOTHER installation (a new, empty computer), nothing is written until the owner
 *   chooses "restore it" or "replace it".
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { dateStr, inspectFile } = require('./db');

const SUB = 'Crockery Store Backup';
const LATEST = 'crockery-latest.db';
const META = 'crockery-latest.json';
const KEEP_DAILY = 30;
const DAILY = /^crockery-\d{4}-\d{2}-\d{2}\.db$/;

function friendly(e) {
  const c = e && e.code;
  if (c === 'ENOENT' || c === 'ENOTDIR') return 'The backup folder was not found. Is the USB drive plugged in?';
  if (c === 'EACCES' || c === 'EPERM' || c === 'EROFS') return 'The backup folder cannot be written to. Please choose another folder.';
  if (c === 'ENOSPC') return 'The backup drive is full.';
  return (e && e.message) || String(e);
}

class FolderBackup {
  constructor({ store, dir, log } = {}) {
    this.store = store;
    this.file = path.join(dir, 'folderbackup.json');
    this.log = log || (() => {});
    fs.mkdirSync(dir, { recursive: true });
    this.s = this._load();
    if (!this.s.installId) { this.s.installId = crypto.randomUUID(); this._save(); }
    this.lastWrites = -1;
    this._timers = [];
  }
  _load() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch (_) { return {}; } }
  _save() { const t = this.file + '.tmp'; fs.writeFileSync(t, JSON.stringify(this.s, null, 1)); fs.renameSync(t, this.file); }

  get target() { return this.s.folder ? path.join(this.s.folder, SUB) : null; }

  status() {
    let reachable = false;
    try { reachable = !!this.s.folder && fs.statSync(this.s.folder).isDirectory(); } catch (_) { /* unplugged */ }
    let state = 'off';
    if (this.s.folder) state = this.s.needsChoice ? 'choice' : (!reachable ? 'missing' : (this.s.lastError ? 'error' : 'ok'));
    return { state, folder: this.s.folder || '', target: this.target || '', lastOk: this.s.lastOk || null, lastError: this.s.lastError || '', choice: this.s.needsChoice || null };
  }

  _meta() {
    const g = (sql) => { try { return this.store.get(sql); } catch (_) { return null; } };
    return {
      installId: this.s.installId, at: new Date().toISOString(),
      shop: (g("SELECT value FROM settings WHERE key='shop_name'") || {}).value || '',
      products: (g('SELECT COUNT(*) c FROM products') || {}).c || 0,
      sales: (g('SELECT COUNT(*) c FROM sales') || {}).c || 0,
    };
  }
  _readMeta(dir) { try { return JSON.parse(fs.readFileSync(path.join(dir, META), 'utf8')); } catch (_) { return null; } }

  /** Choose (or change) the folder. Writes a test file first, so a bad choice is refused at once. */
  setFolder(folder) {
    if (!folder || !fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) throw new Error('That folder does not exist.');
    const target = path.join(folder, SUB);
    try {
      fs.mkdirSync(target, { recursive: true });
      const t = path.join(target, '.write-test');
      fs.writeFileSync(t, 'ok'); fs.unlinkSync(t);
    } catch (e) { throw new Error(friendly(e)); }
    this.s.folder = folder;
    this.s.lastError = '';
    this.s.needsChoice = null;
    const m = this._readMeta(target);
    if (m && m.installId !== this.s.installId && fs.existsSync(path.join(target, LATEST))) {
      this.s.needsChoice = { shop: m.shop || '', products: m.products || 0, sales: m.sales || 0, at: m.at || '' };
      this._save();
      return this.status();                  // nothing is written yet
    }
    this._save();
    return this.backupNow({ force: true });
  }

  stop() {
    this.s.folder = ''; this.s.needsChoice = null; this.s.lastError = ''; this._save();
    return this.status();
  }

  /** opts.force: replace a copy that belongs to another computer. opts.final: also refresh today's dated copy. */
  backupNow(opts = {}) {
    if (!this.s.folder) throw new Error('No backup folder chosen yet.');
    const target = this.target;
    const tmp = path.join(target, LATEST + '.tmp');
    try {
      if (!fs.existsSync(this.s.folder)) { const e = new Error('missing'); e.code = 'ENOENT'; throw e; }   // e.g. USB drive pulled out: never re-create the path
      fs.mkdirSync(target, { recursive: true });
      const m = this._readMeta(target);
      if (!opts.force && m && m.installId !== this.s.installId && fs.existsSync(path.join(target, LATEST))) {
        this.s.needsChoice = { shop: m.shop || '', products: m.products || 0, sales: m.sales || 0, at: m.at || '' };
        this._save();
        return this.status();
      }
      const writes = this.store.writes;
      try { fs.unlinkSync(tmp); } catch (_) { /* none */ }
      this.store.backupTo(tmp);
      inspectFile(tmp);                          // never replace a good copy with a damaged one
      const meta = this._meta();
      fs.renameSync(tmp, path.join(target, LATEST));
      fs.writeFileSync(path.join(target, META), JSON.stringify(meta));
      const daily = path.join(target, `crockery-${dateStr()}.db`);
      if (!fs.existsSync(daily) || opts.final) fs.copyFileSync(path.join(target, LATEST), daily);
      const olds = fs.readdirSync(target).filter((n) => DAILY.test(n)).sort().reverse().slice(KEEP_DAILY);
      for (const n of olds) { try { fs.unlinkSync(path.join(target, n)); } catch (_) { /* ignore */ } }
      this.lastWrites = writes;
      this.s.needsChoice = null; this.s.lastOk = new Date().toISOString(); this.s.lastError = '';
      this._save();
      return this.status();
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      this.s.lastError = friendly(e);
      this._save();
      throw new Error(this.s.lastError);
    }
  }

  keepThisComputer() { this.s.needsChoice = null; this._save(); return this.backupNow({ force: true }); }

  /** Copies in the folder, newest first. */
  list() {
    if (!this.s.folder) return [];
    const target = this.target;
    let names = [];
    try { names = fs.readdirSync(target).filter((n) => n === LATEST || DAILY.test(n)); } catch (e) { throw new Error(friendly(e)); }
    return names.map((n) => { const st = fs.statSync(path.join(target, n)); return { name: n, size: st.size, at: st.mtime.toISOString() }; })
      .sort((a, b) => (a.at < b.at ? 1 : -1));
  }

  /** Replace this computer's data with a copy from the folder (a safety copy is made first by the Store). */
  restore(name) {
    if (!this.s.folder) throw new Error('No backup folder chosen yet.');
    const n = name || LATEST;
    if (n !== LATEST && !DAILY.test(n)) throw new Error('Unknown backup file.');
    const f = path.join(this.target, n);
    if (!fs.existsSync(f)) throw new Error('That backup file was not found in the folder.');
    const res = this.store.restoreFrom(f);        // verifies the file first
    this.s.needsChoice = null; this.s.lastError = ''; this._save();
    try { this.backupNow({ force: true }); } catch (_) { /* shown in status */ }
    return res;
  }

  // ------------------------------------------------------------ automatic
  _tick() {
    if (!this.s.folder || this.s.needsChoice) return;
    const old = !this.s.lastOk || Date.now() - Date.parse(this.s.lastOk) > 6 * 3600 * 1000;
    if (this.store.writes === this.lastWrites && !old) return;
    try { this.backupNow(); } catch (e) { this.log('folder backup: ' + e.message); }
  }
  start() {
    this._timers.push(setTimeout(() => this._tick(), 20 * 1000), setInterval(() => this._tick(), 10 * 60 * 1000));
    this._timers.forEach((t) => t.unref && t.unref());
  }
  stopTimers() { this._timers.forEach((t) => { clearTimeout(t); clearInterval(t); }); this._timers = []; }
  /** When the program is closed: quick and synchronous, never throws. */
  backupOnExit() {
    if (!this.s.folder || this.s.needsChoice || this.store.writes === this.lastWrites) return;
    try { this.backupNow({ final: true }); } catch (e) { this.log('folder backup on exit: ' + e.message); }
  }
}

module.exports = { FolderBackup };
