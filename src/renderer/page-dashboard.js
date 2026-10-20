'use strict';
App.pages.dashboard = {
  title: 'Dashboard',
  async render(root) {
    const d = await rpc('dashboard');
    const t = d.todaySum;
    const max = Math.max(1, ...d.last7.map((x) => x.sales));
    const bars = d.last7.map((x) => `<div class="bar ${x.date === d.today ? 'today' : ''}">
        <div class="amt">${x.sales ? qty(Math.round(x.sales)) : ''}</div>
        <div class="fill" style="height:${Math.round((x.sales / max) * 100)}%"></div>
        <div class="day">${dayName(x.date)}</div></div>`).join('');

    root.innerHTML = `
      <div class="page-head">
        <div><h1>Dashboard</h1><div class="sub">${esc(fmtDate(d.today))} · ${esc(dayName(d.today))}</div></div>
        <div class="head-actions"><button class="btn primary lg" data-go="sale">+ New Sale</button></div>
      </div>
      <div class="stats s3">
        <div class="card stat"><div class="label">Today's sales</div><div class="value">${money(t.sales)}</div>
          <div class="hint">${t.bills} bill${t.bills === 1 ? '' : 's'} · ${qty(t.items_qty)} items</div></div>
        <div class="card stat"><div class="label">Cash received today</div><div class="value teal">${money(t.cash_in)}</div>
          <div class="hint">${money(t.paid_on_sale)} sales + ${money(t.recovered)} udhar recovered</div></div>
        <div class="card stat"><div class="label">Udhar given today</div><div class="value ${t.udhar_given > 0 ? 'red' : ''}">${money(t.udhar_given)}</div>
          <div class="hint">sold on credit</div></div>
        <div class="card stat"><div class="label">Today's profit</div><div class="value">${money(t.profit)}</div>
          <div class="hint">sale price − cost price</div></div>
        <div class="card stat clickable" data-go="customers" data-arg="due"><div class="label">Total udhar to collect</div>
          <div class="value red">${money(d.outstanding)}</div><div class="hint">${d.topDebtors.length ? 'tap to see who owes' : 'nobody owes you'}</div></div>
        <div class="card stat clickable" data-go="products"><div class="label">Stock value (at cost)</div>
          <div class="value">${money(d.stockValue)}</div><div class="hint">${d.lowStock.length} item${d.lowStock.length === 1 ? '' : 's'} low / out of stock</div></div>
      </div>
      <div class="grid2">
        <div class="card"><h2>Sales — last 7 days</h2><div class="bars">${bars}</div></div>
        <div class="card"><h2>Low &amp; out of stock</h2>
          ${d.lowStock.length ? d.lowStock.slice(0, 8).map((p) => `<div class="list-row click" data-go="products" data-arg="${esc(p.name)}">
            <span>${esc(p.name)}</span><span class="badge ${p.stock <= 0 ? 'out' : 'low'}">${p.stock <= 0 ? 'Out of stock' : qty(p.stock) + ' left'}</span></div>`).join('')
            : '<div class="empty">All items are well stocked.</div>'}
        </div>
      </div>
      <div class="card"><h2>Customers who owe you most</h2>
        ${d.topDebtors.length ? d.topDebtors.map((c) => `<div class="list-row click" data-ledger="${c.id}">
          <span>${esc(c.name)} <span class="muted small">${esc(c.phone || '')}</span></span><b class="red num">${money(c.balance)}</b></div>`).join('')
          : '<div class="empty">No pending udhar.</div>'}
      </div>`;

    root.addEventListener('click', (e) => {
      const g = e.target.closest('[data-go]');
      if (g) return App.go(g.dataset.go, g.dataset.arg);
      const l = e.target.closest('[data-ledger]');
      if (l) openLedger(Number(l.dataset.ledger));
    });
  },
};
