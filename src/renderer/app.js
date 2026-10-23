'use strict';
/* App shell: navigation, banners, start-up. */
const NAV = [
  { id: 'sale', label: 'New Sale', icon: 'sale', primary: true },
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'sales', label: 'Sales History', icon: 'sales' },
  { id: 'products', label: 'Products & Stock', icon: 'products' },
  { id: 'customers', label: 'Customers & Udhar', icon: 'customers' },
  { id: 'reports', label: 'Reports', icon: 'reports' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

App.current = null;
App.go = async function go(id, arg) {
  const page = App.pages[id];
  if (!page) return;
  App.current = id;
  $$('#nav .nav-item').forEach((b) => b.classList.toggle('active', b.dataset.id === id));
  const root = $('#page');
  // a fresh element drops all old listeners
  const fresh = document.createElement('div');
  root.replaceChildren(fresh);
  try {
    await page.render(fresh, arg);
  } catch (e) {
    fresh.innerHTML = `<div class="card pad"><b>Something went wrong.</b><p class="muted">${esc(e.message)}</p></div>`;
  }
};

function drawBanners(u, recovered) {
  const b = $('#banners');
  b.innerHTML = '';
  if (recovered) {
    b.append(h(`<div class="banner warn">Your data file was damaged (for example by a power cut). It was restored automatically from the backup “${esc(recovered.from)}”. Entries made after that backup may need to be re-entered.</div>`));
  }
  if (u && u.status === 'ready') {
    const el = h(`<div class="banner update"><span>Version ${esc(u.version)} is ready. It will install by itself when you close the program, or you can do it now.</span><button class="btn">Restart &amp; update</button></div>`);
    $('button', el).addEventListener('click', () => window.sys.installUpdate());
    b.append(el);
  }
  $('#updateDot').hidden = !(u && u.status === 'ready');
}

// light / dark look, remembered on this computer
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const b = $('#themeBtn');
  if (b) b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${t === 'dark' ? ICONS.sun : ICONS.moon}</svg><span>${t === 'dark' ? 'Light look' : 'Dark look'}</span>`;
}
function initTheme() {
  let t = 'light';
  try { t = localStorage.getItem('crockery.theme') || 'light'; } catch (_) { /* storage may be unavailable */ }
  applyTheme(t);
  $('#themeBtn').addEventListener('click', () => {
    t = t === 'dark' ? 'light' : 'dark';
    applyTheme(t);
    try { localStorage.setItem('crockery.theme', t); } catch (_) { /* just not remembered */ }
  });
}

async function boot() {
  initTheme();
  $('#nav').innerHTML = NAV.map((n) => `<button class="nav-item ${n.primary ? 'primary' : ''}" data-id="${n.id}">
    <svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[n.icon]}</svg><span>${n.label}</span></button>`).join('');
  $('#nav').addEventListener('click', (e) => {
    const b = e.target.closest('.nav-item');
    if (b) App.go(b.dataset.id);
  });

  try {
    App.settings = await rpc('getSettings');
    $('#brandName').textContent = App.settings.shop_name;
    const info = await window.sys.info();
    $('#versionLabel').textContent = `Version ${info.version}`;
    drawBanners(info.update, info.db.recovered);
    window.sys.onUpdateStatus((u) => { drawBanners(u, info.db.recovered); if (App.onUpdate) App.onUpdate(u); });
  } catch (e) {
    toast(e.message, 'error');
  }
  await App.go('dashboard');
  window.__appReady = true; // used by the automatic start-up check
}

boot();
