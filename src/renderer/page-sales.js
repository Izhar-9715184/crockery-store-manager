'use strict';
App.pages.sales = {
  title: 'Sales History',
  async render(root, arg) {
    const st = App.salesFilter || (App.salesFilter = { from: today(), to: today(), q: '' });
    root.innerHTML = `
      <div class="page-head"><div><h1>Sales History</h1><div class="sub">Every bill you have made. Click a bill to view, print or cancel it.</div></div></div>
      <div class="toolbar">
        <div class="seg" id="presets"><button data-p="today">Today</button><button data-p="yesterday">Yesterday</button><button data-p="week">Last 7 days</button><button data-p="month">This month</button></div>
        <label class="f" style="width:150px"><input type="date" id="from"></label><span class="muted">to</span>
        <label class="f" style="width:150px"><input type="date" id="to"></label>
        <input type="search" id="q" placeholder="Invoice no. or customer…" class="grow">
      </div>
      <div class="card table-card"><div class="table-wrap" style="max-height:calc(100vh - 230px)"><table>
        <thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th class="r">Total</th><th class="r">Received</th><th class="r">Udhar</th><th>Status</th></tr></thead>
        <tbody id="rows"></tbody><tfoot id="foot"></tfoot></table></div></div>`;

    const el = (id) => $('#' + id, root);
    el('from').value = st.from; el('to').value = st.to; el('q').value = st.q;

    async function load() {
      st.from = el('from').value; st.to = el('to').value; st.q = el('q').value;
      const rows = await safe(() => rpc('listSales', { from: st.from, to: st.to, q: st.q }));
      if (!rows) return;
      el('rows').innerHTML = rows.length ? rows.map((s) => `<tr class="click ${s.status === 'cancelled' ? 'cancelled' : ''}" data-id="${s.id}">
          <td><b>${esc(s.invoice_no)}</b></td><td class="nowrap">${esc(fmtDate(s.date))}</td><td>${esc(s.customer_name || 'Walk-in')}</td>
          <td class="r num">${money(s.total)}</td><td class="r num">${money(s.paid)}</td>
          <td class="r num ${s.due > 0 && s.status === 'active' ? 'red' : ''}">${s.due > 0 ? money(s.due) : '–'}</td>
          <td>${s.status === 'cancelled' ? '<span class="badge cancelled">Cancelled</span>' : s.due > 0 ? '<span class="badge due">Udhar</span>' : '<span class="badge ok">Paid</span>'}</td></tr>`).join('')
        : `<tr><td colspan="7" class="empty">No sales found for this period.</td></tr>`;
      const act = rows.filter((s) => s.status === 'active');
      el('foot').innerHTML = rows.length ? `<tr><td colspan="3">${act.length} bill${act.length === 1 ? '' : 's'}</td>
        <td class="r num">${money(act.reduce((a, s) => a + s.total, 0))}</td><td class="r num">${money(act.reduce((a, s) => a + s.paid, 0))}</td>
        <td class="r num">${money(act.reduce((a, s) => a + s.due, 0))}</td><td></td></tr>` : '';
    }

    el('presets').addEventListener('click', (e) => {
      const p = e.target.dataset.p;
      if (!p) return;
      const t = today();
      if (p === 'today') { el('from').value = t; el('to').value = t; }
      if (p === 'yesterday') { el('from').value = addDays(t, -1); el('to').value = addDays(t, -1); }
      if (p === 'week') { el('from').value = addDays(t, -6); el('to').value = t; }
      if (p === 'month') { el('from').value = t.slice(0, 8) + '01'; el('to').value = t; }
      load();
    });
    el('from').addEventListener('change', load);
    el('to').addEventListener('change', load);
    el('q').addEventListener('input', debounce(load, 200));
    el('rows').addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr) showInvoice(Number(tr.dataset.id), { onChange: load });
    });
    await load();
  },
};
