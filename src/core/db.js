'use strict';
/**
 * Database layer (SQLite via Node's built-in node:sqlite).
 *
 * Safety features (the client's data is the most important thing):
 *  - WAL journal + synchronous=FULL  -> survives power cuts / load-shedding
 *  - integrity check on every start; if the DB is damaged it is restored
 *    automatically from the newest good backup
 *  - versioned migrations (PRAGMA user_version); a backup is taken BEFORE
 *    any migration runs, so an update can never destroy data
 *  - daily automatic backups + pre-update / pre-restore backups
 *
 * HOW TO CHANGE THE DATABASE IN A FUTURE UPDATE:
 *  Never edit an old migration. Add a NEW entry at the end of MIGRATIONS
 *  (e.g. "ALTER TABLE products ADD COLUMN barcode TEXT;"). Existing clients get
 *  it applied automatically, with their data kept, the next time they start.
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('./sqlite');

const MIGRATIONS = [
  // ---- v1: initial schema -------------------------------------------------
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE products (
    id         INTEGER PRIMARY KEY,
    code       TEXT,
    name       TEXT NOT NULL,
    category   TEXT,
    unit       TEXT NOT NULL DEFAULT 'pcs',
    cost_price REAL NOT NULL DEFAULT 0,
    sale_price REAL NOT NULL DEFAULT 0,
    stock      REAL NOT NULL DEFAULT 0,
    min_stock  REAL NOT NULL DEFAULT 0,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE UNIQUE INDEX idx_products_code ON products(code)
    WHERE active = 1 AND code IS NOT NULL AND code <> '';
  CREATE INDEX idx_products_name ON products(name);

  CREATE TABLE customers (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    phone      TEXT,
    address    TEXT,
    notes      TEXT,
    active     INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE sales (
    id            INTEGER PRIMARY KEY,
    invoice_no    TEXT NOT NULL UNIQUE,
    date          TEXT NOT NULL,
    customer_id   INTEGER REFERENCES customers(id),
    subtotal      REAL NOT NULL DEFAULT 0,
    discount      REAL NOT NULL DEFAULT 0,
    total         REAL NOT NULL DEFAULT 0,
    paid          REAL NOT NULL DEFAULT 0,
    due           REAL NOT NULL DEFAULT 0,
    profit        REAL NOT NULL DEFAULT 0,
    method        TEXT,
    note          TEXT,
    status        TEXT NOT NULL DEFAULT 'active',
    cancelled_at  TEXT,
    cancel_reason TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX idx_sales_date ON sales(date);
  CREATE INDEX idx_sales_customer ON sales(customer_id);

  CREATE TABLE sale_items (
    id         INTEGER PRIMARY KEY,
    sale_id    INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    name       TEXT NOT NULL,
    qty        REAL NOT NULL,
    price      REAL NOT NULL,
    cost       REAL NOT NULL DEFAULT 0,
    total      REAL NOT NULL
  );
  CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
  CREATE INDEX idx_sale_items_product ON sale_items(product_id);

  CREATE TABLE stock_moves (
    id         INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    date       TEXT NOT NULL,
    type       TEXT NOT NULL,   -- opening | purchase | sale | sale_cancel | breakage | correction
    qty        REAL NOT NULL,   -- signed: + adds stock, - removes stock
    cost_price REAL,
    supplier   TEXT,
    note       TEXT,
    ref_id     INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX idx_moves_product ON stock_moves(product_id);

  CREATE TABLE ledger (
    id          INTEGER PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    date        TEXT NOT NULL,
    type        TEXT NOT NULL,  -- opening | credit_sale | payment | sale_cancel | adjust
    debit       REAL NOT NULL DEFAULT 0,   -- customer owes more (udhar given)
    credit      REAL NOT NULL DEFAULT 0,   -- customer paid back / reduction
    sale_id     INTEGER REFERENCES sales(id),
    method      TEXT,
    note        TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX idx_ledger_customer ON ledger(customer_id);
  CREATE INDEX idx_ledger_date ON ledger(date);

  INSERT INTO settings(key,value) VALUES
    ('shop_name','My Crockery Store'),
    ('shop_address',''),
    ('shop_phone',''),
    ('invoice_prefix','INV-'),
    ('next_invoice','1'),
    ('allow_negative_stock','0'),
    ('print_format','a4'),
    ('invoice_footer','Thank you for shopping with us!');
  `,
  // ---- v2: remember which phone purchase lists were already imported --------
  // (so the same list can never add stock twice)
  `
  CREATE TABLE purchase_imports (
    id           TEXT PRIMARY KEY,
    batch_date   TEXT NOT NULL,
    supplier     TEXT,
    lines        INTEGER NOT NULL,
    total_qty    REAL NOT NULL,
    total_amount REAL NOT NULL,
    imported_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  `,
  // ---- v3, v4 ... add future changes here (never edit the ones above) ------
];


const pad = (n) => String(n).padStart(2, '0');
function stamp(d = new Date()) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
function dateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const sqlQuote = (s) => String(s).replace(/'/g, "''");
const normParams = (params) =>
  params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));

/** Open a db file read-only-ish just to verify it is healthy. Returns user_version. */
function inspectFile(file) {
  const db = new DatabaseSync(file);
  try {
    const qc = db.prepare('PRAGMA quick_check').get();
    if (Object.values(qc)[0] !== 'ok') throw new Error('integrity check failed');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => r.name);
    const version = db.prepare('PRAGMA user_version').get().user_version;
    return { tables, version };
  } finally {
    db.close();
  }
}

class Store {
  constructor(dir, logger) {
    this.dir = dir;
    this.file = path.join(dir, 'crockery.db');
    this.backupsDir = path.join(dir, 'backups');
    this.log = logger || (() => {});
    this.recovered = null; // set if we had to restore from a backup at startup
    this._depth = 0;
    this.writes = 0; // counts changes; the cloud backup uses it to skip uploads when nothing changed
    fs.mkdirSync(this.backupsDir, { recursive: true });
    this._open();
    this.autoBackup();
  }

  // ---------- opening / recovery ----------
  _openFile(file) {
    const db = new DatabaseSync(file);
    try {
      db.exec('PRAGMA busy_timeout = 5000');
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('PRAGMA synchronous = FULL');
      db.exec('PRAGMA foreign_keys = ON');
      const qc = db.prepare('PRAGMA quick_check').get();
      if (Object.values(qc)[0] !== 'ok') throw new Error('integrity check failed');
    } catch (e) {
      try { db.close(); } catch (_) { /* ignore */ }
      throw e;
    }
    this.db = db;
  }

  _open() {
    const existed = fs.existsSync(this.file);
    try {
      this._openFile(this.file);
    } catch (e) {
      if (!existed) throw e;
      this.log(`Database damaged (${e.message}) - trying backups`);
      this._recoverFromBackup();
    }
    this._migrate();
  }

  _recoverFromBackup() {
    const candidates = this.listBackups(); // newest first
    for (const b of candidates) {
      try {
        const info = inspectFile(b.path);
        if (info.version > MIGRATIONS.length || !info.tables.includes('sales')) continue;
        const corrupt = path.join(this.dir, `damaged-${stamp()}.db`);
        fs.renameSync(this.file, corrupt);
        for (const ext of ['-wal', '-shm']) {
          if (fs.existsSync(this.file + ext)) fs.renameSync(this.file + ext, corrupt + ext);
        }
        fs.copyFileSync(b.path, this.file);
        this._openFile(this.file);
        this.recovered = { from: b.name, modified: b.modified };
        this.log(`Recovered database from backup ${b.name}`);
        return;
      } catch (e) {
        this.log(`Backup ${b.name} not usable: ${e.message}`);
      }
    }
    throw new Error(
      'The database file is damaged and no usable backup was found. ' +
        `Your original file was left untouched at: ${this.file}`
    );
  }

  _migrate() {
    const cur = this.db.prepare('PRAGMA user_version').get().user_version;
    if (cur > MIGRATIONS.length) {
      throw new Error(
        'This data was created by a newer version of the software. Please install the latest update.'
      );
    }
    const LATEST = MIGRATIONS.length;
    if (cur === LATEST) return;
    if (cur > 0) this.backup(`pre-migrate-v${cur}-to-v${LATEST}`);
    for (let v = cur; v < LATEST; v++) {
      this.db.exec('BEGIN');
      try {
        const m = MIGRATIONS[v];
        if (typeof m === 'function') m(this.db);
        else this.db.exec(m);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec('COMMIT');
        this.log(`Migrated database to v${v + 1}`);
      } catch (e) {
        try { this.db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
        throw new Error(`Database update to v${v + 1} failed: ${e.message}`);
      }
    }
  }

  // ---------- query helpers ----------
  all(sql, ...params) {
    return this.db.prepare(sql).all(...normParams(params)).map((r) => ({ ...r }));
  }
  get(sql, ...params) {
    const r = this.db.prepare(sql).get(...normParams(params));
    return r ? { ...r } : undefined;
  }
  run(sql, ...params) {
    this.writes++;
    const r = this.db.prepare(sql).run(...normParams(params));
    return { changes: Number(r.changes), id: Number(r.lastInsertRowid) };
  }
  exec(sql) {
    this.writes++;
    this.db.exec(sql);
  }
  /** Run fn atomically. Nested calls join the outer transaction. */
  tx(fn) {
    if (this._depth > 0) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this._depth++;
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (e) {
      try { this.db.exec('ROLLBACK'); } catch (_) { /* ignore */ }
      throw e;
    } finally {
      this._depth--;
    }
  }

  // ---------- backups ----------
  /** Consistent snapshot of the live database into the backups folder. */
  backup(label) {
    let dest = path.join(this.backupsDir, `${label}-${stamp()}.db`);
    let n = 1;
    while (fs.existsSync(dest)) dest = path.join(this.backupsDir, `${label}-${stamp()}-${n++}.db`);
    this.db.exec(`VACUUM INTO '${sqlQuote(dest)}'`);
    this.prune();
    return dest;
  }

  /**
   * Automatic backup file for today (auto-YYYY-MM-DD.db).
   * Created once at start; call with refresh=true (the app does this every
   * few minutes and on exit) to overwrite it with the latest data. The new
   * snapshot is verified before it replaces the old one, so a damaged live
   * database can never overwrite a good backup.
   */
  autoBackup(refresh = false) {
    const dest = path.join(this.backupsDir, `auto-${dateStr()}.db`);
    if (fs.existsSync(dest) && !refresh) return null;
    const tmp = dest + '.tmp';
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      this.db.exec(`VACUUM INTO '${sqlQuote(tmp)}'`);
      inspectFile(tmp); // throws if the snapshot is not healthy
      fs.renameSync(tmp, dest);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (_) { /* ignore */ }
      this.log(`Auto backup skipped: ${e.message}`);
      return null;
    }
    this.prune();
    return dest;
  }

  /** Copy to any location chosen by the user (e.g. a USB drive). */
  backupTo(dest) {
    if (fs.existsSync(dest)) fs.unlinkSync(dest);
    this.db.exec(`VACUUM INTO '${sqlQuote(dest)}'`);
    return dest;
  }

  listBackups() {
    return fs
      .readdirSync(this.backupsDir)
      .filter((f) => f.endsWith('.db'))
      .map((f) => {
        const p = path.join(this.backupsDir, f);
        const st = fs.statSync(p);
        return { name: f, path: p, size: st.size, modified: st.mtime.toISOString() };
      })
      .sort((a, b) => (a.modified < b.modified ? 1 : a.modified > b.modified ? -1 : 0));
  }

  prune() {
    const keep = { auto: 30, manual: 30, pre: 20 };
    const groups = {};
    for (const b of this.listBackups()) {
      const g = b.name.startsWith('auto-') ? 'auto' : b.name.startsWith('manual-') ? 'manual' : 'pre';
      (groups[g] = groups[g] || []).push(b);
    }
    for (const [g, list] of Object.entries(groups)) {
      for (const old of list.slice(keep[g])) {
        try { fs.unlinkSync(old.path); } catch (_) { /* ignore */ }
      }
    }
  }

  /** Replace the live database with a backup file chosen by the user. */
  restoreFrom(file) {
    const info = inspectFile(file); // throws if not a healthy sqlite db
    if (!info.tables.includes('sales') || !info.tables.includes('products')) {
      throw new Error('This file is not a backup of this software.');
    }
    if (info.version > MIGRATIONS.length) {
      throw new Error('This backup was made by a newer version of the software. Please update first.');
    }
    const safety = this.backup('pre-restore');
    this.close();
    for (const ext of ['-wal', '-shm']) {
      if (fs.existsSync(this.file + ext)) fs.unlinkSync(this.file + ext);
    }
    fs.copyFileSync(file, this.file);
    this._open();
    return { safetyBackup: safety };
  }

  close() {
    try {
      this.autoBackup(true);
    } catch (_) { /* ignore */ }
    try {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (_) { /* ignore */ }
    try {
      this.db.close();
    } catch (_) { /* ignore */ }
  }
}

module.exports = {
  Store,
  MIGRATIONS,
  get LATEST() { return MIGRATIONS.length; },
  dateStr,
  inspectFile,
  stamp,
};
