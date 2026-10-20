'use strict';

function editCustomer(c, done) {
  const isNew = !c;
  c = c || { name: '', phone: '', address: '', notes: '' };
  modal({
    title: isNew ? 'Add customer' : 'Edit customer',
    body: `<div class="form-grid">
      <label class="f full"><span>Name *</span><input type="text" name="name" value="${esc(c.name)}"></label>
      <label class="f"><span>Phone</span><input type="tel" name="phone" value="${esc(c.phone || '')}"></label>
      <label class="f"><span>Address / area</span><input type="text" name="address" value="${esc(c.address || '')}"></label>
      ${isNew ? `<label class="f full"><span>Old udhar already pending (optional)</span><input type="number" name="opening_balance" step="any" placeholder="0"></label>` : ''}
      <label class="f full"><span>Notes</span><textarea name="notes">${esc(c.notes || '')}</textarea></label></div>`,
    actions: [
      ...(!isNew ? [{
        label: 'Delete', kind: 'danger', close: false,
        onClick: async (m) => {
          if (!(await confirmBox(`Remove ${c.name}? Their old bills stay in Sales History.`, { okLabel: 'Remove', danger: true }))) return false;
          await rpc('deleteCustomer', c.id);
          m.close(); toast('Customer removed', 'ok'); if (done) done();
        },
      }] : []),
      { label: 'Cancel' },
      {
        label: 'Save', kind: 'primary', close: false,
        onClick: async (m) => {
          const f = formData(m.body);
          if (!isNew) f.id = c.id;
          const saved = await rpc('saveCustomer', f);
          m.close(); toast('Customer saved', 'ok'); if (done) done(saved);
        },
      },
    ],
  });
}

function receivePaymentDialog(c, done) {
  modal({
    title: `Receive payment — ${c.name}`,
    body: `<div class="form-grid">
      <div class="full">Udhar pending: <b class="red">${money(c.balance)}</b></div>
      <label class="f"><span>Amount received *</span><input type="number" name="amount" min="0" step="any" value="${c.balance > 0 ? c.balance : ''}"></label>
      <label class="f"><span>Date</span><input type="date" name="date" value="${today()}"></label>
      <label class="f"><span>Method</span><select name="method"><option value="cash">Cash</option><option value="bank">Bank transfer</option>
        <option value="wallet">EasyPaisa / JazzCash</option><option value="cheque">Cheque</option></select></label>
      <label class="f"><span>Note</span><input type="text" name="note"></label></div>`,
    actions: [{ label: 'Cancel' }, {
      label: 'Save payment', kind: 'primary', close: false,
      onClick: async (m) => {
        const updated = await rpc('receivePayment', { ...formData(m.body), customer_id: c.id });
        m.close(); toast(`Payment saved. Remaining udhar: ${money(updated.balance)}`, 'ok'); if (done) done();
      },
    }],
  });
}

function adjustCustomerDialog(c, done) {
  modal({
    title: `Correct balance — ${c.name}`,
    body: `<div class="form-grid">
      <div class="full muted small">Use this only to fix a mistake or to write off an amount. Use a <b>plus</b> number to increase udhar and a <b>minus</b> number to reduce it.</div>
      <label class="f"><span>Amount (+ / −) *</span><input type="number" name="amount" step="any"></label>
      <label class="f"><span>Date</span><input type="date" name="date" value="${today()}"></label>
      <label class="f full"><span>Reason *</span><input type="text" name="note"></label></div>`,
    actions: [{ label: 'Cancel' }, {
      label: 'Save', kind: 'primary', close: false,
      onClick: async (m) => { await rpc('adjustCustomer', { ...formData(m.body), customer_id: c.id }); m.close(); if (done) done(); },
    }],
  });
}

async function openLedger(id, onChange) {
  const render = async () => {
    const led = await rpc('customerLedger', id);
    const c = led.customer;
    m.body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:14px;flex-wrap:wrap">
        <div><div style="font-size:18px;font-weight:650">${esc(c.name)}</div><div class="muted">${esc([c.phone, c.address].filter(Boolean).join(' · '))}</div></div>
        <div style="text-align:right"><div class="muted small">${c.balance < 0 ? 'Advance (you owe customer)' : 'Udhar pending'}</div>
          <div style="font-size:26px;font-weight:700" class="num ${c.balance > 0 ? 'red' : 'teal'}">${money(Math.abs(c.balance))}</div></div></div>
      <div class="toolbar"><button class="btn primary" data-a="pay">Receive payment</button><button class="btn" data-a="adj">Correct balance</button>
        <button class="btn" data-a="print">Print statement</button></div>
      <div class="card table-card"><table><thead><tr><th>Date</th><th>Details</th><th class="r">Udhar</th><th class="r">Paid</th><th class="r">Balance</th></tr></thead><tbody>
        ${led.entries.map((e) => `<tr><td class="nowrap">${esc(fmtDate(e.date))}</td><td>${esc(e.note || e.type)}${e.method && e.type === 'payment' ? ` <span class="muted small">(${esc(e.method)})</span>` : ''}</td>
          <td class="r num ${e.debit ? 'red' : ''}">${e.debit ? qty(e.debit) : ''}</td><td class="r num ${e.credit ? 'teal' : ''}">${e.credit ? qty(e.credit) : ''}</td>
          <td class="r num"><b>${qty(e.balance)}</b></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No entries yet.</td></tr>'}
      </tbody></table></div>`;
    m.ledger = led;
  };
  const m = modal({ title: 'Customer ledger (udhar account)', wide: true, body: '<div class="empty">Loading…</div>', actions: [{ label: 'Close' }] });
  m.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const c = m.ledger.customer;
    const refresh = async () => { await render(); if (onChange) onChange(); };
    if (b.dataset.a === 'pay') receivePaymentDialog(c, refresh);
    if (b.dataset.a === 'adj') adjustCustomerDialog(c, refresh);
    if (b.dataset.a === 'print') printHtml(statementHtml(m.ledger));
  });
  await render();
}

App.pages.customers = {
  title: 'Customers & Udhar',
  async render(root, arg) {
    const st = App.custFilter || (App.custFilter = { q: '', due: false });
    if (arg === 'due') st.due = true;
    root.innerHTML = `
      <div class="page-head"><div><h1>Customers &amp; Udhar</h1><div class="sub" id="sub"></div></div>
        <div class="head-actions"><button class="btn" id="exp">Export CSV</button><button class="btn primary" id="add">+ Add customer</button></div></div>
      <div class="toolbar"><input type="search" id="q" placeholder="Search name, phone or area…" class="grow">
        <div class="seg" id="seg"><button data-d="0">All customers</button><button data-d="1">Udhar pending</button></div></div>
      <div class="card table-card"><div class="table-wrap" style="max-height:calc(100vh - 230px)"><table>
        <thead><tr><th>Name</th><th>Phone</th><th>Address</th><th class="r">Udhar pending</th><th></th></tr></thead>
        <tbody id="rows"></tbody></table></div></div>`;
    const el = (id) => $('#' + id, root);
    let rows = [];
    el('q').value = st.q;
    async function load() {
      st.q = el('q').value;
      rows = await rpc('listCustomers', { q: st.q, onlyDue: st.due });
      $$('#seg button', root).forEach((b) => b.classList.toggle('on', (b.dataset.d === '1') === st.due));
      const total = rows.reduce((s, c) => s + (c.balance > 0 ? c.balance : 0), 0);
      el('sub').innerHTML = `${rows.length} customer${rows.length === 1 ? '' : 's'} · total udhar <b class="red">${money(total)}</b>`;
      el('rows').innerHTML = rows.length ? rows.map((c) => `<tr data-id="${c.id}">
        <td><b>${esc(c.name)}</b></td><td>${esc(c.phone || '')}</td><td class="muted">${esc(c.address || '')}</td>
        <td class="r num"><b class="${c.balance > 0.004 ? 'red' : c.balance < -0.004 ? 'teal' : 'muted'}">${c.balance > 0.004 || c.balance < -0.004 ? money(c.balance) : '–'}</b></td>
        <td><div class="actions"><button class="btn sm" data-a="ledger">Ledger</button><button class="btn sm teal" data-a="pay">Receive payment</button><button class="btn sm" data-a="edit">Edit</button></div></td></tr>`).join('')
        : `<tr><td colspan="5" class="empty">${st.due ? 'Nobody owes you anything.' : 'No customers yet. Click “Add customer”.'}</td></tr>`;
    }
    el('q').addEventListener('input', debounce(load, 150));
    el('seg').addEventListener('click', (e) => { if (e.target.dataset.d !== undefined) { st.due = e.target.dataset.d === '1'; load(); } });
    el('add').addEventListener('click', () => editCustomer(null, load));
    el('exp').addEventListener('click', () => downloadCsv(`customers-${today()}.csv`, [['Name', 'Phone', 'Address', 'Udhar pending'],
      ...rows.map((c) => [c.name, c.phone, c.address, c.balance])]));
    el('rows').addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const c = rows.find((x) => x.id === Number(b.closest('tr').dataset.id));
      if (b.dataset.a === 'ledger') openLedger(c.id, load);
      if (b.dataset.a === 'pay') receivePaymentDialog(c, load);
      if (b.dataset.a === 'edit') editCustomer(c, load);
    });
    await load();
  },
};
