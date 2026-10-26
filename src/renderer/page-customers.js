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

/** Old udhar from the paper register, one customer after the other. */
async function oldBalanceDialog(done) {
  const people = await rpc('listCustomers', {});
  let count = 0;
  let sum = 0;
  const m = modal({
    title: 'Add Old Balance',
    body: `<p class="muted" style="margin:0 0 14px">Enter what a customer already owes from your paper register. It is added to that customer's udhar. Later payments are received against it as usual.</p>
      <div class="form-grid">
        <label class="f full"><span>Customer name *</span><input type="text" name="name" list="obNames" autocomplete="off" placeholder="Choose from the list or type a new name">
          <datalist id="obNames">${people.map((c) => `<option value="${esc(c.name)}">${esc(c.phone || c.address || '')}</option>`).join('')}</datalist></label>
        <label class="f"><span>Old balance (Rs) *</span><input type="number" name="amount" min="0" step="any" placeholder="0"></label>
        <label class="f"><span>Date (optional)</span><input type="date" name="date" value="${today()}"></label>
        <label class="f"><span>Register page no. (optional)</span><input type="text" name="page" placeholder="e.g. 12"></label>
        <label class="f"><span>Note (optional)</span><input type="text" name="note" placeholder="e.g. Eid shopping"></label>
        <div class="full ob-hint" id="obHint"></div>
        <div class="full ob-tally" id="obTally" hidden></div></div>`,
    actions: [
      { label: 'Cancel' },
      { label: 'Save & add next', close: false, onClick: (mm) => save(mm, true) },
      { label: 'Save', kind: 'teal', close: false, onClick: (mm) => save(mm, false) },
    ],
  });
  const q = (n) => $(`[name=${n}]`, m.body);
  // show the current udhar of the typed customer, or tell that a new customer will be created
  const hint = () => {
    const nm = q('name').value.trim().toLowerCase();
    const c = nm && people.find((x) => x.name.toLowerCase() === nm);
    $('#obHint', m.body).innerHTML = !nm ? '' : c
      ? `Already owes <b class="${c.balance > 0 ? 'red' : ''}">${money(c.balance)}</b>. The old balance will be added to this.`
      : '<span class="teal">New customer — will be created automatically.</span>';
  };
  q('name').addEventListener('input', hint);
  async function save(mm, next) {
    const f = formData(mm.body);
    const r = await rpc('addOldBalance', f);
    count += 1; sum += r.amount;
    if (r.created) people.push({ ...r.customer });
    else { const x = people.find((c) => c.id === r.customer.id); if (x) x.balance = r.customer.balance; }
    if (done) done();
    if (!next) { mm.close(); toast(`Old balance saved for ${r.customer.name}. Now owes ${money(r.customer.balance)}`, 'ok'); return false; }
    toast(`Saved: ${r.customer.name} · ${money(r.amount)}`, 'ok');
    const t = $('#obTally', mm.body);
    t.hidden = false;
    t.innerHTML = `✔ ${count} saved so far · ${money(sum)} in total`;
    // ready for the next customer: keep the date, clear the rest
    for (const n of ['name', 'amount', 'page', 'note']) q(n).value = '';
    hint();
    q('name').focus();
    return false;
  }
  m.body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); $('footer .btn.teal', m.el).click(); }
  });
  return m;
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

/** Fix a wrong amount / date / note on a payment, old-balance or correction entry. */
function editLedgerEntryDialog(e, done) {
  const signed = e.type === 'payment' ? e.credit : e.debit - e.credit;
  const kind = { payment: 'Payment received', opening: 'Old balance', adjust: 'Balance correction' }[e.type] || e.type;
  const hint = e.type === 'payment' ? 'Amount the customer paid.'
    : 'Plus number = udhar (customer owes), minus number = reduces udhar.';
  modal({
    title: `Edit entry — ${kind}`,
    body: `<div class="form-grid">
      <div class="full muted small">${esc(hint)} The customer's balance is recalculated automatically. The old value is kept in an edit log.</div>
      <label class="f"><span>Amount *</span><input type="number" name="amount" step="any" value="${signed}"></label>
      <label class="f"><span>Date</span><input type="date" name="date" value="${esc(e.date)}"></label>
      ${e.type === 'payment' ? `<label class="f"><span>Paid by</span><select name="method">${['cash', 'bank', 'wallet', 'cheque'].map((k) => `<option value="${k}" ${e.method === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>` : ''}
      <label class="f full"><span>Note${e.type === 'adjust' ? ' / reason *' : ''}</span><input type="text" name="note" value="${esc(e.note || '')}"></label></div>`,
    actions: [{ label: 'Cancel' }, {
      label: 'Save changes', kind: 'primary', close: false,
      onClick: async (m) => { await rpc('updateLedgerEntry', { ...formData(m.body), id: e.id }); m.close(); toast('Entry updated', 'ok'); if (done) done(); },
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
      <div class="card table-card"><table><thead><tr><th>Date</th><th>Details</th><th class="r">Udhar</th><th class="r">Paid</th><th class="r">Balance</th><th></th></tr></thead><tbody>
        ${led.entries.map((e) => `<tr><td class="nowrap">${esc(fmtDate(e.date))}</td><td>${esc(e.note || e.type)}${e.edited_at ? '<span class="edited-tag" title="Edited ' + esc(e.edited_at) + '">edited</span>' : ''}${e.method && e.type === 'payment' ? ` <span class="muted small">(${esc(e.method)})</span>` : ''}</td>
          <td class="r num ${e.debit ? 'red' : ''}">${e.debit ? qty(e.debit) : ''}</td><td class="r num ${e.credit ? 'teal' : ''}">${e.credit ? qty(e.credit) : ''}</td>
          <td class="r num"><b>${qty(e.balance)}</b></td>
          <td class="r nowrap">${e.type === 'credit_sale' ? `<button class="edit-link" data-bill="${e.sale_id}" title="Open the bill to edit it">Edit bill</button>`
            : e.type === 'sale_cancel' ? '' : `<button class="edit-link" data-edit="${e.id}">Edit</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No entries yet.</td></tr>'}
      </tbody></table></div>`;
    m.ledger = led;
  };
  const m = modal({ title: 'Customer ledger (udhar account)', wide: true, body: '<div class="empty">Loading…</div>', actions: [{ label: 'Close' }] });
  m.el.addEventListener('click', async (e) => {
    const refresh = async () => { await render(); if (onChange) onChange(); };
    const ed = e.target.closest('[data-edit]');
    if (ed) { editLedgerEntryDialog(m.ledger.entries.find((x) => x.id === Number(ed.dataset.edit)), refresh); return; }
    const bill = e.target.closest('[data-bill]');
    if (bill) { showInvoice(Number(bill.dataset.bill), { onChange: refresh }); return; }
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const c = m.ledger.customer;
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
        <div class="head-actions"><button class="btn" id="exp">Export CSV</button><button class="btn teal" id="oldbal">Add Old Balance</button><button class="btn primary" id="add">+ Add customer</button></div></div>
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
    el('oldbal').addEventListener('click', () => oldBalanceDialog(load));
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
