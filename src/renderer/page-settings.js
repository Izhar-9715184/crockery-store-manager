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
          <label class="f"><span>Print size</span><select name="print_format">${Object.keys(PAPERS).map((k) => `<option value="${k}" ${paperOf(s) === k ? 'selected' : ''}>${esc(PAPERS[k].label)}</option>`).join('')}</select></label>
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

      <div class="card section-gap"><h2>Stock online for the phone (Maal Entry)</h2><div class="pad" id="syncCard"><div class="muted">Loading…</div></div></div>
      <div class="card section-gap"><h2>Automatic copy to a folder (USB, Google Drive, OneDrive…)</h2><div class="pad" id="folderCard"><div class="muted">Loading…</div></div></div>

      <div class="card section-gap" id="cloudWrap"><h2>Google backup (your data safe in your own Google Drive)</h2><div class="pad" id="cloudCard"><div class="muted">Loading…</div></div></div>

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
    // ---- stock online for the phone
    async function drawSync() {
      const st = await window.sys.stockSyncStatus();
      const card = el('syncCard');
      if (st.state === 'off') {
        card.innerHTML = `
          <p style="margin-top:0">See your shop's <b>stock on the phone even when this computer is off</b> (for example while buying maal in the market). The software puts a <b>locked copy</b> of your products and stock online, free, in your own secret GitHub Gist. Sales and bills are <b>never</b> sent. (Later you can choose whether customers' udhar is also shown on the phone.) It updates by itself a few seconds after every change.</p>
          <ol class="small" style="margin:6px 0 12px 18px">
            <li>On github.com: your picture → <b>Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic)</b>.</li>
            <li>Name: <i>stock</i>. Tick <b>only "gist"</b>. Expiration: <b>No expiration</b>. Generate, and copy the token.</li>
            <li>Paste it below and press Connect.</li></ol>
          <div style="display:flex;gap:8px;flex-wrap:wrap"><input type="password" id="ssToken" placeholder="GitHub token (ghp_…)" style="flex:1;min-width:260px" autocomplete="off"><button class="btn primary" id="ssGo">Connect</button></div>`;
        el('ssGo').addEventListener('click', () => safe(async () => { await window.sys.stockSyncConnect(el('ssToken').value); toast('Connected. Stock is now online.', 'ok'); drawSync(); }));
        return;
      }
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">${st.state === 'ok' ? '<span class="badge ok">ON</span>' : '<span class="badge">CHECK</span>'}<span>${st.products} products are online</span></div>
        <dl class="kv"><dt>Last sent</dt><dd>${esc(st.lastOk ? fmtStamp(st.lastOk) : 'not yet')}</dd></dl>
        ${st.lastError ? `<div class="red" style="margin:8px 0">${esc(st.lastError)}</div>` : ''}
        ${st.waiting ? `<div class="card" style="border:2px solid var(--amber,#d97706);margin:10px 0"><div class="pad"><b>${st.waiting} purchase list${st.waiting === 1 ? '' : 's'} from the phone ${st.waiting === 1 ? 'needs' : 'need'} your review</b> (a product name was new or different). Open <b>Products &amp; Stock → Import from phone</b> and press <b>Load waiting lists</b>.</div></div>` : ''}
        <label style="display:flex;gap:8px;align-items:flex-start;margin:8px 0"><input type="checkbox" id="ssUdhar" style="width:auto;margin-top:3px" ${st.udhar ? 'checked' : ''}><span>Also show <b>udhar</b> on the phone (Udhar tab): names, phone numbers, amounts owed and the last few entries of customers who owe money. Locked like the stock.</span></label>
        <p class="small muted" style="margin:6px 0">When you buy maal, the phone can send the list online. If every product name matches, the stock here goes up <b>by itself</b> (within a minute of the computer being on). Otherwise it waits for your review.</p>
        <p style="margin:10px 0 6px"><b>Connect the phone (once):</b> copy this link, send it to your phone (WhatsApp to yourself) and open it there. Keep this link private — it contains the key, and lets that phone send purchase lists.</p>
        <input type="text" id="ssLink" readonly value="${esc(st.link)}" style="width:100%">
        <div class="toolbar" style="margin-top:10px"><button class="btn primary" id="ssCopy">Copy link</button><button class="btn" id="ssNow">Send stock now</button><span class="grow"></span><button class="btn" id="ssStop">Stop</button></div>`;
      el('ssCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(st.link); toast('Link copied. Send it to your phone.', 'ok'); } catch (_) { el('ssLink').select(); toast('Press Ctrl+C to copy', 'ok'); } });
      el('ssUdhar').addEventListener('change', (e) => safe(async () => { await window.sys.stockSyncUdhar(e.target.checked); toast(e.target.checked ? 'Udhar will show on the phone' : 'Udhar removed from the online copy', 'ok'); drawSync(); }));
      el('ssNow').addEventListener('click', () => safe(async () => { await window.sys.stockSyncNow(); toast('Stock sent', 'ok'); drawSync(); }));
      el('ssStop').addEventListener('click', () => safe(async () => { if (!(await confirmBox('Stop sharing stock online? (The old online copy stays until you delete the Gist on github.com.)', { okLabel: 'Stop' }))) return; await window.sys.stockSyncStop(); drawSync(); }));
    }
    drawSync();
    // ---- folder backup card
    async function drawFolder() {
      const f = await window.sys.folderStatus();
      const card = el('folderCard');
      const when = (iso) => (iso ? fmtStamp(iso) : 'not yet');
      if (f.state === 'off') {
        card.innerHTML = `
          <p style="margin-top:0">Choose a folder and the software keeps a <b>copy of your data there automatically</b>, every few minutes after a change and when you close it. If this computer breaks, install the software on another computer, choose the same folder, and press <b>Bring that data here</b>.</p>
          <ul class="small" style="margin:6px 0 12px 18px">
            <li><b>USB drive or external disk:</b> plug it in and choose it.</li>
            <li><b>Cloud (best):</b> if Google Drive, OneDrive or Dropbox is installed on this computer, choose a folder inside it. Then your data is also safe online.</li></ul>
          <button class="btn primary" id="fbChoose">Choose backup folder…</button>`;
        el('fbChoose').addEventListener('click', () => safe(async () => { const r = await window.sys.folderChoose(); if (r) toast(r.state === 'choice' ? 'A copy from another computer was found. Please choose what to do.' : 'Backup folder set. First copy saved.', r.state === 'choice' ? 'error' : 'ok'); drawFolder(); }));
        return;
      }
      const badge = f.state === 'ok' ? '<span class="badge ok">ON</span>' : '<span class="badge">CHECK</span>';
      let extra = '';
      if (f.state === 'missing') extra = '<div class="red" style="margin:8px 0">The backup folder was not found. Is the USB drive plugged in? Nothing is lost; copies will continue when it is back.</div>';
      else if (f.lastError) extra = `<div class="red" style="margin:8px 0">${esc(f.lastError)}</div>`;
      if (f.state === 'choice') {
        const x = f.choice || {};
        extra = `<div class="card" style="border:2px solid var(--amber,#d97706);margin:12px 0"><div class="pad">
          <b>A copy of shop data was found in this folder.</b>
          <div class="small" style="margin:6px 0">${esc(x.shop || 'Shop')} · ${x.products || 0} products · ${x.sales || 0} bills · saved ${esc(x.at ? fmtStamp(x.at) : '')}</div>
          <p class="small" style="margin:6px 0">It was made by another computer (or before this program was re-installed). <b>Nothing has been written from this computer yet</b>, so nothing is overwritten. What should happen?</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn primary" id="fbRestore">Bring that data here (replace this computer's data)</button>
            <button class="btn danger" id="fbKeep">This computer's data is correct (replace the copy in the folder)</button></div></div></div>`;
      }
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">${badge}<span>Copies go to: <b class="small" style="word-break:break-all">${esc(f.target)}</b></span></div>
        <dl class="kv"><dt>Last copy saved</dt><dd>${esc(when(f.lastOk))}</dd></dl>
        ${extra}
        <p class="muted small">The last 30 days of copies are kept. Without the USB drive plugged in, the software works as usual.</p>
        <div class="toolbar"><button class="btn primary" id="fbNow" ${f.state === 'choice' ? 'disabled' : ''}>Save a copy now</button>
          <button class="btn" id="fbPick">Restore an older copy…</button><button class="btn" id="fbChange">Change folder…</button><span class="grow"></span><button class="btn" id="fbStop">Stop</button></div>
        <div id="fbList"></div>`;
      const run = (id, fn, redraw = true) => { const b = el(id); if (b) b.addEventListener('click', () => safe(async () => { try { await fn(); } finally { if (redraw) drawFolder(); } })); };
      run('fbNow', async () => { await window.sys.folderBackupNow(); toast('Copy saved', 'ok'); });
      run('fbChange', async () => { const r = await window.sys.folderChoose(); if (r) toast('Backup folder changed', 'ok'); });
      run('fbRestore', async () => { const r = await window.sys.folderRestore(); if (r) toast('Data restored from the backup folder', 'ok'); });
      run('fbKeep', async () => { const r = await window.sys.folderKeep(); if (r) toast('Copy in the folder replaced with this computer\'s data', 'ok'); });
      run('fbStop', async () => { await window.sys.folderStop(); toast('Automatic folder copies stopped. Existing copies are kept.', 'ok'); });
      run('fbPick', async () => {
        const list = await window.sys.folderList();
        el('fbList').innerHTML = `<div class="table-wrap" style="max-height:220px;margin-top:10px"><table><thead><tr><th>Copy</th><th>Saved</th><th class="r">Size</th><th></th></tr></thead><tbody>
          ${list.map((x) => `<tr><td>${esc(x.name.replace('crockery-', '').replace('.db', ''))}</td><td>${esc(fmtStamp(x.at))}</td><td class="r">${fmtBytes(x.size)}</td><td class="r"><button class="btn small" data-rn="${esc(x.name)}">Restore</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">No copies yet.</td></tr>'}
          </tbody></table></div>`;
        el('fbList').querySelectorAll('[data-rn]').forEach((b) => b.addEventListener('click', () => safe(async () => { const r = await window.sys.folderRestore(b.dataset.rn); if (r) toast('Data restored from the backup folder', 'ok'); drawFolder(); })));
      }, false);
    }
    drawFolder();
    // ---- Google Drive backup card
    async function drawCloud() {
      const c = await window.sys.cloudStatus();
      const card = el('cloudCard');
      const when = (iso) => (iso ? fmtStamp(iso) : 'not yet');
      if (c.state === 'unconfigured') { card.innerHTML = ''; el('cloudWrap').hidden = true; return; }   // not set up by the provider: nothing to show
      el('cloudWrap').hidden = false;
      if (!c.connected) {
        card.innerHTML = `
          <p style="margin-top:0">Sign in with your <b>Gmail</b> and the software keeps a copy of your data in <b>your own Google Drive</b>, automatically. If this computer breaks or is lost, install the software on any other computer, sign in with the same Gmail, and all your data comes back.</p>
          <p class="muted small">Nobody else can see this copy, not even the software provider. It uses a hidden folder that belongs to this program only.</p>
          ${c.state === 'signin' ? `<div class="red" style="margin-bottom:10px">${esc(c.lastError || 'Please sign in again.')}</div>` : ''}
          <button class="btn primary" id="cgIn">${c.state === 'signin' ? 'Sign in again with Google' : 'Sign in with Google'}</button>
          <span class="muted small" id="cgWait" hidden> A Google page opened in your browser. Choose your account and press Allow…</span>`;
        el('cgIn').addEventListener('click', () => safe(async () => {
          el('cgIn').disabled = true; el('cgWait').hidden = false;
          try { const r = await window.sys.cloudConnect(); toast(r.state === 'choice' ? 'Please choose what to do with the copy found in your Google Drive' : 'Signed in. Your data is being saved to Google Drive', r.state === 'choice' ? 'error' : 'ok'); }
          finally { drawCloud(); }
        }));
        return;
      }
      const badge = c.state === 'ok' ? '<span class="badge ok">ON</span>' : '<span class="badge">CHECK</span>';
      let choice = '';
      if (c.state === 'choice') {
        const x = c.choice || {};
        choice = `<div class="card" style="border:2px solid var(--amber,#d97706);margin:12px 0"><div class="pad">
          <b>A copy of shop data was found in this Google account.</b>
          <div class="small" style="margin:6px 0">${esc(x.shop || 'Shop')} · ${x.products || 0} products · ${x.sales || 0} bills · saved ${esc(x.at ? fmtStamp(x.at) : '')}</div>
          <p class="small" style="margin:6px 0">It came from another computer (or from before this program was re-installed). <b>Nothing has been uploaded from this computer yet</b>, so nothing is overwritten. What should happen?</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn primary" id="cgRestore">Bring that data here (replace this computer's data)</button>
            <button class="btn danger" id="cgKeep">This computer's data is correct (replace the Google copy)</button></div></div></div>`;
      }
      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">${badge}<span>Signed in as <b>${esc(c.email || 'your Google account')}</b></span></div>
        <dl class="kv"><dt>Last copy saved</dt><dd>${esc(when(c.lastOk))}</dd></dl>
        ${c.lastError ? `<div class="red" style="margin:8px 0">${esc(c.lastError)}</div>` : ''}
        ${choice}
        <p class="muted small">A copy is saved automatically a few minutes after any change, and again when you close the software. It needs internet; without it the software works as usual and saves later.</p>
        <div class="toolbar"><button class="btn primary" id="cgNow" ${c.state === 'choice' ? 'disabled' : ''}>Save to Google now</button>
          <button class="btn" id="cgPick">Restore an older copy…</button><span class="grow"></span><button class="btn" id="cgOut">Sign out</button></div>
        <div id="cgList"></div>`;
      const run = (id, fn, redraw = true) => { const b = el(id); if (b) b.addEventListener('click', () => safe(async () => { try { await fn(); } finally { if (redraw) drawCloud(); } })); };
      run('cgNow', async () => { toast('Saving to Google Drive…'); const r = await window.sys.cloudBackupNow(); toast('Saved to Google Drive', r.lastError ? 'error' : 'ok'); });
      run('cgRestore', async () => { const r = await window.sys.cloudRestore(); if (r) toast('Data restored from Google Drive', 'ok'); });
      run('cgKeep', async () => { const r = await window.sys.cloudKeep(); if (r) toast('Google copy replaced with this computer\'s data', 'ok'); });
      run('cgOut', async () => { await window.sys.cloudDisconnect(); toast('Signed out. Your copy in Google Drive is kept.', 'ok'); });
      run('cgPick', async () => {
        const list = await window.sys.cloudList();
        el('cgList').innerHTML = `<div class="table-wrap" style="max-height:220px;margin-top:10px"><table><thead><tr><th>Copy</th><th>Saved</th><th class="r">Products</th><th class="r">Bills</th><th></th></tr></thead><tbody>
          ${list.map((f) => `<tr><td>${esc(f.name.replace('crockery-', '').replace('.db', ''))}</td><td>${esc(fmtStamp(f.at))}</td><td class="r">${f.products}</td><td class="r">${f.sales}</td><td class="r"><button class="btn small" data-rf="${esc(f.id)}">Restore</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No copies yet.</td></tr>'}
          </tbody></table></div>`;
        el('cgList').querySelectorAll('[data-rf]').forEach((b) => b.addEventListener('click', () => safe(async () => { const r = await window.sys.cloudRestore(b.dataset.rf); if (r) toast('Data restored from Google Drive', 'ok'); drawCloud(); })));
      }, false);
    }
    drawCloud();
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
