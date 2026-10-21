'use strict';
function fmtBytes(n) {
  return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
}
function fmtStamp(iso) {
  const d = new Date(iso);
  return `${fmtDate(ymd(d))} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function updateText(u, packaged) {
  if (!packaged) return 'Updates are checked only in the installed program.';
  return ({
    idle: 'Not checked yet.',
    checking: 'Checking for updates…',
    latest: 'You have the latest version.',
    downloading: `Downloading version ${u.version || ''} … ${u.percent || 0}%`,
    ready: `Version ${u.version} is ready to install.`,
    error: 'Could not check (no internet?). It will try again automatically.',
    dev: 'Updates are checked only in the installed program.',
  })[u.status] || '';
}

App.pages.settings = {
  title: 'Settings',
  async render(root) {
    const s = await rpc('getSettings');
    const info = await window.sys.info();
    const backups = await rpc('listBackups');
    App.settings = s;

    root.innerHTML = `
      <div class="page-head"><div><h1>Settings</h1><div class="sub">Shop details, data safety and program updates.</div></div></div>
      <div class="grid2 even" style="align-items:start">
        <div class="card"><h2>Shop details</h2><div class="pad"><div class="form-grid" id="shopForm">
          <label class="f full"><span>Shop name</span><input type="text" name="shop_name" value="${esc(s.shop_name)}"></label>
          <label class="f"><span>Phone</span><input type="text" name="shop_phone" value="${esc(s.shop_phone)}"></label>
          <label class="f"><span>Invoice prefix</span><input type="text" name="invoice_prefix" value="${esc(s.invoice_prefix)}"></label>
          <label class="f full"><span>Address</span><input type="text" name="shop_address" value="${esc(s.shop_address)}"></label>
          <label class="f full"><span>Line at the bottom of every invoice</span><input type="text" name="invoice_footer" value="${esc(s.invoice_footer)}"></label>
          <label class="f"><span>Print size</span><select name="print_format"><option value="a4" ${s.print_format !== 'thermal' ? 'selected' : ''}>A4 / A5 paper</option><option value="thermal" ${s.print_format === 'thermal' ? 'selected' : ''}>Thermal receipt (80 mm)</option></select></label>
          <label class="f check" style="align-self:end"><input type="checkbox" name="allow_negative_stock" ${s.allow_negative_stock === '1' ? 'checked' : ''}><span style="margin:0">Allow selling when stock is 0</span></label>
          <div class="full"><button class="btn primary" id="saveShop">Save settings</button></div></div></div></div>

        <div>
          <div class="card" style="margin-bottom:14px"><h2>Program updates</h2><div class="pad">
            <dl class="kv"><dt>Installed version</dt><dd><b>${esc(info.version)}</b></dd><dt>Status</dt><dd id="updText">${esc(updateText(info.update, info.packaged))}</dd></dl>
            <div style="margin-top:12px;display:flex;gap:8px"><button class="btn" id="chk">Check for updates</button><button class="btn teal" id="inst" ${info.update.status === 'ready' ? '' : 'hidden'}>Restart &amp; update now</button></div>
            <p class="muted small" style="margin-bottom:0">Updates download by themselves. Your shop data is never touched by an update, and a backup is saved before each one.</p></div></div>
          <div class="card"><h2>Your data</h2><div class="pad">
            <dl class="kv"><dt>Products</dt><dd>${info.db.counts.products}</dd><dt>Customers</dt><dd>${info.db.counts.customers}</dd><dt>Bills</dt><dd>${info.db.counts.sales}</dd>
              <dt>Stored in</dt><dd class="small" style="word-break:break-all">${esc(info.db.file)}</dd></dl></div></div>
        </div>
      </div>

      <div class="card section-gap"><h2>Backups (data safety)</h2><div class="pad">
        <p style="margin-top:0">A backup is made <b>automatically every day</b> and before every update. Keep an extra copy on a USB drive or in another folder for full safety.</p>
        <div class="toolbar"><button class="btn primary" id="bk">Backup now</button><button class="btn" id="bkTo">Save a copy to USB / folder…</button>
          <button class="btn" id="bkOpen">Open backups folder</button><span class="grow"></span><button class="btn danger" id="bkRestore">Restore from a file…</button></div>
        <div class="table-wrap" style="max-height:260px"><table><thead><tr><th>Backup file</th><th>Made on</th><th class="r">Size</th></tr></thead><tbody>
          ${backups.map((b) => `<tr><td>${esc(b.name)}</td><td>${esc(fmtStamp(b.modified))}</td><td class="r">${fmtBytes(b.size)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">No backups yet.</td></tr>'}
        </tbody></table></div></div></div>

      <div class="card section-gap"><h2>Mobile access (use on your phone)</h2><div class="pad" id="mobCard"><div class="muted">Loading…</div></div></div>`;

    const el = (id) => $('#' + id, root);
    el('saveShop').addEventListener('click', () => safe(async () => {
      const f = formData(el('shopForm'));
      f.allow_negative_stock = f.allow_negative_stock ? '1' : '0';
      App.settings = await rpc('saveSettings', f);
      $('#brandName').textContent = App.settings.shop_name;
      toast('Settings saved', 'ok');
    }));
    el('chk').addEventListener('click', () => safe(async () => {
      el('updText').textContent = 'Checking for updates…';
      const u = await window.sys.checkUpdate();
      el('updText').textContent = updateText(u, info.packaged);
    }));
    el('inst').addEventListener('click', () => window.sys.installUpdate());
    el('bk').addEventListener('click', () => safe(async () => { await rpc('createBackup'); toast('Backup saved', 'ok'); App.go('settings'); }));
    el('bkTo').addEventListener('click', () => safe(async () => { const p = await window.sys.backupTo(); if (p) toast('Copy saved to ' + p, 'ok'); }));
    el('bkOpen').addEventListener('click', () => window.sys.openBackups());
    el('bkRestore').addEventListener('click', () => safe(async () => { const r = await window.sys.restore(); if (r) toast('Backup restored', 'ok'); }));
    // ---- mobile access card
    async function drawMobile() {
      const m = await window.sys.mobileStatus();
      const card = el('mobCard');
      const urls = m.addresses || [];
      const tail = urls.filter((u) => /\/\/100\./.test(u));
      const lan = urls.filter((u) => !/\/\/100\./.test(u));
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <span class="badge ${m.running ? 'ok' : ''}">${m.running ? 'ON' : 'OFF'}</span>
          <span>${m.running ? `Your phone can connect (port ${m.port}).` : 'Phone access is switched off.'}</span></div>
        ${m.error ? `<div class="red" style="margin-bottom:10px">${esc(m.error)}</div>` : ''}
        <div class="form-grid" id="mobForm" style="max-width:560px">
          <label class="f"><span>${m.config.hasPin ? 'Change PIN (leave empty to keep)' : 'Set a PIN (min 6 characters) *'}</span><input type="password" name="pin" autocomplete="new-password" placeholder="${m.config.hasPin ? '••••••' : 'e.g. 482915'}"></label>
          <label class="f"><span>Port</span><input type="number" name="port" min="1024" max="65535" value="${m.config.port}"></label>
          <div class="full" style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn primary" id="mobSave">${m.running ? 'Save' : 'Save & turn ON'}</button>
            ${m.running ? '<button class="btn danger" id="mobOff">Turn OFF</button>' : (m.config.hasPin ? '<button class="btn" id="mobOn">Turn ON</button>' : '')}
          </div>
        </div>
        ${m.running ? `
        <div class="hr"></div>
        <b>On the phone, open Chrome and type one of these addresses:</b>
        <div style="margin:8px 0">${lan.length ? lan.map((u) => `<div><code>${esc(u)}</code> <span class="muted small">(same WiFi as this laptop)</span></div>`).join('') : '<div class="muted">No WiFi/network address found. Connect this laptop to the shop WiFi.</div>'}
          ${tail.map((u) => `<div><code>${esc(u)}</code> <span class="muted small">(from anywhere, via Tailscale)</span></div>`).join('')}</div>
        <p class="small muted" style="margin:6px 0">Then enter the PIN. To get an icon on the home screen: Chrome menu (⋮) → <b>Add to Home screen</b>.</p>
        <div class="hr"></div>
        <details><summary><b>Use it from outside the shop (free)</b></summary>
          <ol class="small" style="line-height:1.7">
            <li>Install <b>Tailscale</b> (tailscale.com, free) on this laptop and on the phone, and log in with the <b>same account</b> on both.</li>
            <li>This panel will then show an address starting with <b>100.</b> — type it in the phone's Chrome.</li>
            <li>This laptop must be switched on, connected to the internet, and this program open.</li>
          </ol></details>
        <p class="small muted" style="margin-bottom:0">When Windows asks to allow the program on the network, choose <b>Private networks → Allow access</b>. Never open this port on your router to the public internet. Use WiFi or Tailscale only.</p>` : ''}`;
      const apply = (extra) => safe(async () => {
        const f = formData(el('mobForm'));
        const opts = { port: f.port };
        if (f.pin) opts.pin = f.pin;
        Object.assign(opts, extra);
        await window.sys.mobileApply(opts);
        toast('Saved', 'ok');
        await drawMobile();
      });
      el('mobSave').addEventListener('click', () => apply({ enabled: true }));
      if (el('mobOff')) el('mobOff').addEventListener('click', () => safe(async () => { await window.sys.mobileApply({ enabled: false }); await drawMobile(); }));
      if (el('mobOn')) el('mobOn').addEventListener('click', () => apply({ enabled: true }));
    }
    drawMobile().catch((e) => { el('mobCard').textContent = e.message; });

    App.onUpdate = (u) => { const t = $('#updText'); if (t) t.textContent = updateText(u, info.packaged); const b = $('#inst'); if (b) b.hidden = u.status !== 'ready'; };
  },
};
