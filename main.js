'use strict';
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SMOKE = process.argv.includes('--smoke-test'); // used by the build pipeline

// In smoke-test mode use a throw-away data folder so real data is never touched.
if (SMOKE) app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'crockery-smoke-')));

let win = null;
let store = null;
let service = null;
let autoUpdater = null;
let updateState = { status: 'idle', version: null, percent: 0, message: '' };

// ---------------------------------------------------------------- logging
const logDir = path.join(app.getPath('userData'), 'logs');
function log(msg) {
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const f = path.join(logDir, 'app.log');
    if (fs.existsSync(f) && fs.statSync(f).size > 1024 * 1024) fs.renameSync(f, f + '.old');
    fs.appendFileSync(f, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (_) { /* logging must never crash the app */ }
  if (SMOKE) console.log(msg);
}

// ---------------------------------------------------------------- single instance
// Two copies of the app writing to the same database could cause trouble.
if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(start);
}

function start() {
  try {
    const { Store } = require('./src/core/db');
    const { createService } = require('./src/core/service');
    // Client data lives in AppData (outside the program folder) -> updates never touch it.
    store = new Store(path.join(app.getPath('userData'), 'data'), log);
    service = createService(store);
  } catch (e) {
    log(`FATAL: ${e.stack || e.message}`);
    dialog.showErrorBox('Cannot open your shop data', e.message);
    app.exit(1);
    return;
  }

  registerIpc();
  createWindow();

  if (SMOKE) return runSmokeTest();

  setupUpdater();
  // keep today's automatic backup fresh while the shop is working
  setInterval(() => { try { store.autoBackup(true); } catch (e) { log(`backup: ${e.message}`); } }, 15 * 60 * 1000);
}

// ---------------------------------------------------------------- window
function createWindow() {
  win = new BrowserWindow({
    width: 1366,
    height: 820,
    minWidth: 1100,
    minHeight: 680,
    show: false,
    backgroundColor: '#f4f1ec',
    title: 'Crockery Store Manager',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (app.isPackaged) Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => { if (!SMOKE) win.show(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, 'src', 'renderer', 'index.html'));
  win.on('closed', () => { win = null; });
}

// ---------------------------------------------------------------- IPC
function registerIpc() {
  ipcMain.handle('api', (_e, name, args) => {
    try {
      if (!Object.prototype.hasOwnProperty.call(service, name)) throw new Error(`Unknown action: ${name}`);
      return { ok: true, data: service[name](...(args || [])) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('sys:info', () => ({
    version: app.getVersion(),
    packaged: app.isPackaged,
    update: updateState,
    db: service.dbInfo(),
  }));

  ipcMain.handle('sys:checkUpdate', async () => {
    if (!autoUpdater) return { status: 'dev', message: 'Updates are only checked in the installed app.' };
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      setUpdate({ status: 'error', message: e.message });
    }
    return updateState;
  });

  ipcMain.handle('sys:installUpdate', () => {
    if (!autoUpdater || updateState.status !== 'ready') return false;
    try { store.backup(`pre-update-v${app.getVersion()}`); } catch (e) { log(`pre-update backup: ${e.message}`); }
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return true;
  });

  ipcMain.handle('sys:backupTo', async () => {
    const d = new Date();
    const name = `crockery-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.db`;
    const r = await dialog.showSaveDialog(win, {
      title: 'Save a copy of your data (e.g. on a USB drive)',
      defaultPath: path.join(app.getPath('documents'), name),
      filters: [{ name: 'Crockery backup', extensions: ['db'] }],
    });
    if (r.canceled || !r.filePath) return null;
    store.backupTo(r.filePath);
    return r.filePath;
  });

  ipcMain.handle('sys:restore', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose a backup file to restore',
      defaultPath: store.backupsDir,
      properties: ['openFile'],
      filters: [{ name: 'Crockery backup', extensions: ['db'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const c = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Cancel', 'Restore this backup'],
      defaultId: 0,
      cancelId: 0,
      title: 'Restore backup',
      message: 'Replace ALL current data with this backup?',
      detail: 'Everything entered after the backup was made will be gone. A safety copy of your current data is saved first.',
    });
    if (c.response !== 1) return null;
    const res = store.restoreFrom(r.filePaths[0]);
    win.webContents.reload();
    return res;
  });

  ipcMain.handle('sys:openBackups', () => shell.openPath(store.backupsDir));
}

// ---------------------------------------------------------------- auto update
function setUpdate(patch) {
  updateState = { ...updateState, ...patch };
  if (win && !win.isDestroyed()) win.webContents.send('update-status', updateState);
}

function setupUpdater() {
  if (!app.isPackaged) return; // no updates while developing
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (e) {
    log(`electron-updater not available: ${e.message}`);
    return;
  }
  autoUpdater.logger = { info: log, warn: log, error: log, debug: () => {} };
  autoUpdater.autoDownload = true;          // download quietly in the background
  autoUpdater.autoInstallOnAppQuit = true;  // and install when the shop closes the app

  autoUpdater.on('checking-for-update', () => setUpdate({ status: 'checking', message: '' }));
  autoUpdater.on('update-available', (i) => setUpdate({ status: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => setUpdate({ status: 'latest', message: '' }));
  autoUpdater.on('download-progress', (p) => setUpdate({ status: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => {
    try { store.backup(`pre-update-v${app.getVersion()}`); } catch (e) { log(`pre-update backup: ${e.message}`); }
    setUpdate({ status: 'ready', version: i.version, percent: 100 });
  });
  // No internet is normal for a shop - never bother the user, just remember it.
  autoUpdater.on('error', (e) => setUpdate({ status: 'error', message: e == null ? 'unknown' : e.message }));

  const check = () => autoUpdater.checkForUpdates().catch((e) => log(`update check failed: ${e.message}`));
  setTimeout(check, 15 * 1000);
  setInterval(check, 4 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------- build pipeline check
// `electron . --smoke-test` : proves the packaged pieces work together
// (database, migrations, screens loading) before an update is published.
async function runSmokeTest() {
  const fail = (m) => { console.error(`SMOKE TEST FAILED: ${m}`); app.exit(1); };
  try {
    const p = service.saveProduct({ name: 'Smoke Plate', cost_price: 10, sale_price: 20, stock: 5 });
    const s = service.createSale({ items: [{ product_id: p.id, qty: 1, price: 20 }] });
    if (s.total !== 20) return fail('sale total wrong');
    store.backup('smoke');
  } catch (e) {
    return fail(e.message);
  }
  const started = Date.now();
  const timer = setInterval(async () => {
    try {
      const ready = win && (await win.webContents.executeJavaScript('window.__appReady === true'));
      if (ready) {
        clearInterval(timer);
        console.log('SMOKE TEST OK');
        store.close();
        app.exit(0);
      } else if (Date.now() - started > 20000) {
        clearInterval(timer);
        fail('screens did not load in 20s');
      }
    } catch (e) {
      /* page still loading */
    }
  }, 500);
}

app.on('before-quit', () => { try { if (store) store.close(); } catch (_) { /* ignore */ } });
app.on('window-all-closed', () => app.quit());
