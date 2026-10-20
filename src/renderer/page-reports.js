'use strict';
App.pages.reports = {
  title: 'Reports',
  async render(root) {
    const st = App.repFilter || (App.repFilter = { tab: 'sales', from: today(), to: today() });
    root.innerHTML = `
      <div class="page-head"><div><h1>Reports</h1><div class="sub">Daily sales, cash, udhar and profit — or check your stock.</div></div>
        <div class="head-actions"><div class="seg" id="tabs"><button data-t="sales">Sales report</button><button data-t="stock">Stock report</button><button data-t="udhar">Udhar list</button></div></div></div>
      <div id="body"></div>`;
    const body = $('#body', root);
    $('#tabs', root).addEventListener('click', (e) => { if (e.target.dataset.t) { st.tab = e.target.dataset.t; draw(); } });

    async function salesTab() {
      body.innerHTML = `
        <div class="toolbar">
          <div class="seg" id="presets"><button data-p="today">Today</button><button data-p="yesterday">Yesterday</button><button data-p="week">Last 7 days</button><button data-p="month">This month</button></div>
          <label class="f" style="width:150px"><input type="date" id="from" value="${st.from}"></label><span class="muted">to</span>
          <label class="f" style="width:150px"><input type="date" id="to" value="${st.to}"></label>
          <span class="grow"></span><button class="btn" id="exp">Export CSV</button><button class="btn" id="prt">Print</button>
        </div><div id="rep"></div>`;
      let rep;
      async function load() {
        st.from = $('#from', body).value; st.to = $('#to', body).value;
        rep = await safe(() => rpc('summary', st.from, st.to));
        if (!rep) return;
        $('#rep', body).innerHTML = `
          <div class="stats">
            <div class="card stat"><div class="label">Total sales</div><div class="value">${money(rep.sales)}</div><div class="hint">${rep.bills} bills · ${qty(rep.items_qty)} items${rep.discount ? ' · discount ' + money(rep.discount) : ''}</div></div>
            <div class="card stat"><div class="label">Cash received</div><div class="value teal">${money(rep.cash_in)}</div><div class="hint">${money(rep.paid_on_sale)} at sale + ${money(rep.recovered)} recovered</div></div>
            <div class="card stat"><div class="label">Udhar given</div><div class="value red">${money(rep.udhar_given)}</div><div class="hint">sold on credit</div></div>
            <div class="card stat"><div class="label">Profit</div><div class="value">${money(rep.profit)}</div><div class="hint">${rep.sales ? Math.round((rep.profit / rep.sales) * 100) : 0}% of sales</div></div>
          </div>
          <div class="grid2 even">
            <div class="card table-card"><h2>Day by day</h2><table><thead><tr><th>Date</th><th class="r">Bills</th><th class="r">Sales</th><th class="r">Received</th><th class="r">Udhar</th><th class="r">Recovered</th><th class="r">Profit</th></tr></thead><tbody>
              ${rep.perDay.map((d) => `<tr><td class="nowrap">${esc(fmtDate(d.date))}</td><td class="r">${d.bills}</td><td class="r num">${qty(d.sales)}</td><td class="r num">${qty(d.paid)}</td>
                <td class="r num">${qty(d.udhar)}</td><td class="r num">${qty(d.recovered)}</td><td class="r num">${qty(d.profit)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No sales in this period.</td></tr>'}
            </tbody></table></div>
            <div class="card table-card"><h2>Best selling products</h2><table><thead><tr><th>Product</th><th class="r">Qty sold</th><th class="r">Amount</th></tr></thead><tbody>
              ${rep.topProducts.map((p) => `<tr><td>${esc(p.name)}</td><td class="r num">${qty(p.qty)}</td><td class="r num">${qty(p.revenue)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">–</td></tr>'}
            </tbody></table></div>
          </div>
          <div class="card table-card"><h2>Udhar payments received</h2><table><thead><tr><th>Date</th><th>Customer</th><th>Method</th><th>Note</th><th class="r">Amount</th></tr></thead><tbody>
            ${rep.payments.map((p) => `<tr><td class="nowrap">${esc(fmtDate(p.date))}</td><td>${esc(p.customer_name)}</td><td>${esc(p.method || '')}</td><td class="muted">${esc(p.note || '')}</td><td class="r num">${qty(p.credit)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No payments received in this period.</td></tr>'}
          </tbody></table></div>`;
      }
      $('#presets', body).addEventListener('click', (e) => {
        const p = e.target.dataset.p; if (!p) return;
        const t = today();
        if (p === 'today') { $('#from', body).value = t; $('#to', body).value = t; }
        if (p === 'yesterday') { $('#from', body).value = addDays(t, -1); $('#to', body).value = addDays(t, -1); }
        if (p === 'week') { $('#from', body).value = addDays(t, -6); $('#to', body).value = t; }
        if (p === 'month') { $('#from', body).value = t.slice(0, 8) + '01'; $('#to', body).value = t; }
        load();
      });
      $('#from', body).addEventListener('change', load);
      $('#to', body).addEventListener('change', load);
      $('#prt', body).addEventListener('click', () => printHtml(`<div class="invoice">${shopHeader(App.settings)}<h2 style="font-size:16px;margin:10px 0">Sales report: ${esc(fmtDate(rep.from))} – ${esc(fmtDate(rep.to))}</h2>
        <div class="tot" style="width:70%"><div><span>Total sales (${rep.bills} bills)</span><span>${money(rep.sales)}</span></div><div><span>Received at sale</span><span>${money(rep.paid_on_sale)}</span></div>
        <div><span>Udhar recovered</span><span>${money(rep.recovered)}</span></div><div class="grand"><span>Cash received</span><span>${money(rep.cash_in)}</span></div>
        <div><span>Udhar given</span><span>${money(rep.udhar_given)}</span></div><div><span>Profit</span><span>${money(rep.profit)}</span></div></div></div>`));
      $('#exp', body).addEventListener('click', () => downloadCsv(`sales-${rep.from}_${rep.to}.csv`, [
        ['Date', 'Bills', 'Sales', 'Received at sale', 'Udhar given', 'Udhar recovered', 'Profit'],
        ...rep.perDay.map((d) => [d.date, d.bills, d.sales, d.paid, d.udhar, d.recovered, d.profit])]));
      await load();
    }

    async function stockTab() {
      const r = await rpc('stockReport');
      body.innerHTML = `<div class="stats"><div class="card stat"><div class="label">Stock value (at cost)</div><div class="value">${money(r.totalValue)}</div></div>
        <div class="card stat"><div class="label">Total pieces</div><div class="value">${qty(r.totalQty)}</div></div>
        <div class="card stat"><div class="label">Products</div><div class="value">${r.rows.length}</div></div></div>
        <div class="card table-card"><div class="table-wrap" style="max-height:calc(100vh - 330px)"><table><thead><tr><th>Product</th><th>Category</th><th class="r">Cost</th><th class="r">Sale price</th><th class="r">Stock</th><th class="r">Value</th></tr></thead><tbody>
        ${r.rows.map((p) => `<tr><td>${esc(p.name)}</td><td class="muted">${esc(p.category || '')}</td><td class="r num">${qty(p.cost_price)}</td><td class="r num">${qty(p.sale_price)}</td>
          <td class="r">${stockBadge(p)}</td><td class="r num">${p.stock > 0 ? qty(p.value) : '–'}</td></tr>`).join('')}</tbody></table></div></div>`;
    }

    async function udharTab() {
      const rows = await rpc('listCustomers', { onlyDue: true });
      const total = rows.reduce((s, c) => s + c.balance, 0);
      body.innerHTML = `<div class="toolbar"><div class="grow"><b>${rows.length}</b> customers owe you <b class="red">${money(total)}</b></div>
          <button class="btn" id="exp">Export CSV</button><button class="btn" id="prt">Print</button></div>
        <div class="card table-card"><table><thead><tr><th>Customer</th><th>Phone</th><th>Address</th><th class="r">Udhar pending</th></tr></thead><tbody>
        ${rows.map((c) => `<tr class="click" data-id="${c.id}"><td><b>${esc(c.name)}</b></td><td>${esc(c.phone || '')}</td><td class="muted">${esc(c.address || '')}</td><td class="r num red"><b>${money(c.balance)}</b></td></tr>`).join('') || '<tr><td colspan="4" class="empty">Nobody owes you anything.</td></tr>'}
        </tbody></table></div>`;
      $('tbody', body).addEventListener('click', (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) openLedger(Number(tr.dataset.id), udharTab); });
      $('#exp', body).addEventListener('click', () => downloadCsv(`udhar-${today()}.csv`, [['Customer', 'Phone', 'Address', 'Udhar pending'], ...rows.map((c) => [c.name, c.phone, c.address, c.balance])]));
      $('#prt', body).addEventListener('click', () => printHtml(`<div class="invoice">${shopHeader(App.settings)}<h2 style="font-size:16px;margin:10px 0">Udhar list — ${esc(fmtDate(today()))}</h2>
        <table><thead><tr><th>Customer</th><th>Phone</th><th class="r">Udhar</th></tr></thead><tbody>${rows.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.phone || '')}</td><td class="r">${qty(c.balance)}</td></tr>`).join('')}</tbody></table>
        <div class="tot"><div class="grand"><span>Total</span><span>${money(total)}</span></div></div></div>`));
    }

    async function draw() {
      $$('#tabs button', root).forEach((b) => b.classList.toggle('on', b.dataset.t === st.tab));
      if (st.tab === 'stock') await stockTab();
      else if (st.tab === 'udhar') await udharTab();
      else await salesTab();
    }
    await draw();
  },
};
