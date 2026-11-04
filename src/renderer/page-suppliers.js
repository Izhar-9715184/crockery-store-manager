'use strict';
/* Wholesale Karz: maal bought on credit — what the shop owes each wholesaler. */

function editSupplier(s, done) {
  const isNew = !s;
  s = s || { name: '', phone: '', notes: '' };
  modal({
    title: isNew ? 'Add wholesaler' : 'Edit wholesaler',
    body: `<div class="form-grid">
      <label class="f full"><span>Name *</span><input type="text" name="name" value="${esc(s.name)}"></label>
      <label class="f"><span>Phone</span><input type="tel" name="phone" value="${esc(s.phone || '')}"></label>
      ${isNew ? `<label class="f"><span>Old karz already pending (optional)</span><input type="number" name="opening_balance" min="0" step="any" placeholder="0"></label>` : '<span></span>'}
      <label class="f full"><span>Notes</span><textarea name="notes">${esc(s.notes || '')}</textarea></label></div>`,
    actions: [
      ...(!isNew ? [{
        label: 'Delete', kind: 'danger', close: false,
        onClick: async (m) => {
          if (!(await confirmBox(`Remove ${s.name} from the list? (Only possible when no karz is pending.)`, { okLabel: 'Remove', danger: true }))) return false;
          await rpc('deleteSupplier', s.id);
          m.close(); toast('Wholesaler removed', 'ok'); if (done) done();
        },
      }] : []),
      { label: 'Cancel' },
      {
        label: 'Save', kind: 'primary', close: false,
        onClick: async (m) => {
          const f = formData(m.body);
          if (!isNew) f.id = s.id;
          await rpc('saveSupplier', f);
          m.close(); toast('Wholesaler saved', 'ok'); if (done) done();
        },
      },
    ],
  });
}

function paySupplierDialog(s, done) {
  modal({
    title: `Pay wholesaler — ${s.name}`,
    body: `<div class="form-grid">
      <div class="full">Karz pending: <b class="red">${money(s.balance)}</b></div>
      <label class="f"><span>Amount paid *</span><input type="number" name="amount" min="0" step="any" value="${s.balance > 0 ? s.balance : ''}"></label>
      <label class="f"><span>Date</span><input type="date" name="date" value="${today()}"></label>
      <label class="f"><span>Method</span><select name="method"><option value="cash">Cash</option><option value="bank">Bank transfer</option>
        <option value="wallet">EasyPaisa / JazzCash</option><option value="cheque">Cheque</option></select></label>
      <label class="f"><span>Note</span><input type="text" name="note"></label></div>`,
    actions: [{ label: 'Cancel' }, {
      label: 'Save payment', kind: 'primary', close: false,
      onClick: async (m) => {
        const u = await rpc('paySupplier', { ...formData(m.body), supplier_id: s.id });
        m.close(); toast(`Payment saved. Karz remaining: ${money(u.balance)}`, 'ok'); if (done) done();
      },
    }],
  });
}

/** Karz from before this program (paper register). */
async function oldKarzDialog(done) {
  const people = await rpc('listSuppliers', {});
  const m = modal({
    title: 'Add Old Karz',
    body: `<p class="muted" style="margin:0 0 14px">Enter what you already owe a wholesaler. Choose a name from the list, or type a new one — it is created automatically.</p>
      <div class="form-grid">
        <label class="f full"><span>Wholesaler name *</span><input type="text" name="name" list="okNames" autocomplete="off" placeholder="Choose from the list or type a new name">
          <datalist id="okNames">${people.map((c) => `<option value="${esc(c.name)}">`).join('')}</datalist></label>
        <label class="f"><span>Karz (Rs) *</span><input type="number" name="amount" min="0" step="any" placeholder="0"></label>
        <label class="f"><span>Date</span><input type="date" name="date" value="${today()}"></label>
        <label class="f full"><span>Note (optional)</span><input type="text" name="note" placeholder="e.g. register page 12"></label></div>`,
    actions: [{ label: 'Cancel' }, {
      label: 'Save', kind: 'primary', close: false,
      onClick: async (mm) => { const s = await rpc('addSupplierKarz', formData(mm.body)); mm.close(); toast(`Saved. You owe ${s.name} ${money(s.balance)}`, 'ok'); if (done) done(); },
    }],
  });
  return m;
}

function editSupplierEntryDialog(e, done) {
  const kind = { payment: 'Payment made', opening: 'Old karz', adjust: 'Correction' }[e.type] || e.type;
  modal({
    title: `Edit entry — ${kind}`,
    body: `<div class="form-grid">
      <div class="full muted small">The wholesaler's balance is recalculated automatically. The old value is kept in the edit log.</div>
      <label class="f"><span>Amount *</span><input type="number" name="amount" step="any" min="0" value="${e.type === 'payment' ? e.credit : e.debit}"></label>
      <label class="f"><span>Date</span><input type="date" name="date" value="${esc(e.date)}"></label>
      <label class="f full"><span>Note</span><input type="text" name="note" value="${esc(e.note || '')}"></label></div>`,
    actions: [{ label: 'Cancel' }, {
      label: 'Save changes', kind: 'primary', close: false,
      onClick: async (m) => { await rpc('updateSupplierEntry', { ...formData(m.body), id: e.id }); m.close(); toast('Entry updated', 'ok'); if (done) done(); },
    }],
  });
}

async function openSupplierLedger(id, onChange) {
  const label = (e) => e.type === 'purchase' ? `Maal: ${esc(e.product || '')}${e.m_qty ? ` × ${qty(e.m_qty)}` : ''}${e.m_cost ? ` @ ${qty(e.m_cost)}` : ''}`
    : e.type === 'payment' ? `Payment${e.method ? ` (${esc(e.method)})` : ''}${e.note ? ' · ' + esc(e.note) : ''}` : esc(e.note || e.type);
  const render = async () => {
    const led = await rpc('supplierLedger', id);
    const s = led.supplier;
    m.body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:14px;flex-wrap:wrap">
        <div><div style="font-size:18px;font-weight:650">${esc(s.name)}</div><div class="muted">${esc([s.phone, s.notes].filter(Boolean).join(' · '))}</div></div>
        <div style="text-align:right"><div class="muted small">${s.balance < 0 ? 'Advance (he owes you)' : 'You owe him (karz)'}</div>
          <div style="font-size:26px;font-weight:700" class="num ${s.balance > 0 ? 'red' : 'teal'}">${money(Math.abs(s.balance))}</div></div></div>
      <div class="toolbar"><button class="btn primary" data-a="pay">Pay wholesaler</button><button class="btn" data-a="old">Add old karz</button></div>
      <div class="card table-card"><table><thead><tr><th>Date</th><th>Details</th><th class="r">Karz</th><th class="r">Paid</th><th class="r">Balance</th><th></th></tr></thead><tbody>
        ${led.entries.map((e) => `<tr><td class="nowrap">${esc(fmtDate(e.date))}</td><td>${label(e)}${e.edited_at ? '<span class="edited-tag">edited</span>' : ''}</td>
          <td class="r num ${e.debit ? 'red' : ''}">${e.debit ? qty(e.debit) : ''}</td><td class="r num ${e.credit ? 'teal' : ''}">${e.credit ? qty(e.credit) : ''}</td>
          <td class="r num"><b>${qty(e.balance)}</b></td>
          <td class="r nowrap">${e.type === 'purchase' ? '' : `<button class="edit-link" data-edit="${e.id}">Edit</button><button class="edit-link del" data-del="${e.id}">Delete</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No entries yet.</td></tr>'}
      </tbody></table></div>`;
    m.ledger = led;
  };
  const m = modal({ title: 'Wholesaler account (karz)', wide: true, body: '<div class="empty">Loading…</div>', actions: [{ label: 'Close' }] });
  m.el.addEventListener('click', async (e) => {
    const refresh = async () => { await render(); if (onChange) onChange(); };
    const ed = e.target.closest('[data-edit]');
    if (ed) { editSupplierEntryDialog(m.ledger.entries.find((x) => x.id === Number(ed.dataset.edit)), refresh); return; }
    const del = e.target.closest('[data-del]');
    if (del) {
      if (await confirmBox('Delete this entry? The balance will be recalculated. (The old value is kept in the edit log.)', { okLabel: 'Delete' })) {
        await safe(async () => { await rpc('deleteSupplierEntry', Number(del.dataset.del)); toast('Entry deleted', 'ok'); await refresh(); });
      }
      return;
    }
    const b = e.target.closest('[data-a]');
    if (!b) return;
    const s = m.ledger.supplier;
    if (b.dataset.a === 'pay') paySupplierDialog(s, refresh);
    if (b.dataset.a === 'old') {
      modal({
        title: `Add old karz — ${s.name}`,
        body: `<div class="form-grid"><label class="f"><span>Karz (Rs) *</span><input type="number" name="amount" min="0" step="any"></label>
          <label class="f"><span>Date</span><input type="date" name="date" value="${today()}"></label>
          <label class="f full"><span>Note</span><input type="text" name="note"></label></div>`,
        actions: [{ label: 'Cancel' }, { label: 'Save', kind: 'primary', close: false,
          onClick: async (mm) => { await rpc('addSupplierKarz', { ...formData(mm.body), supplier_id: s.id }); mm.close(); await refresh(); } }],
      });
    }
  });
  await render();
}

App.pages.suppliers = {
  title: 'Wholesale Karz',
  async render(root) {
    const st = App.supFilter || (App.supFilter = { q: '', due: false });
    root.innerHTML = `
      <div class="page-head"><div><h1>Wholesale Karz</h1><div class="sub" id="sub"></div></div>
        <div class="head-actions"><button class="btn teal" id="oldk">Add Old Karz</button><button class="btn primary" id="add">+ Add wholesaler</button></div></div>
      <div class="toolbar"><input type="search" id="q" placeholder="Search wholesaler…" class="grow">
        <div class="seg" id="seg"><button data-d="0">All wholesalers</button><button data-d="1">Karz pending</button></div></div>
      <div class="card table-card"><div class="table-wrap" style="max-height:calc(100vh - 230px)"><table>
        <thead><tr><th>Wholesaler</th><th>Phone</th><th>Last entry</th><th class="r">You owe (karz)</th><th></th></tr></thead>
        <tbody id="rows"></tbody></table></div></div>
      <p class="muted small" style="margin-top:10px">Tip: when you add stock (Products &amp; Stock &rarr; Stock in) or send a Maal list from the phone, choose the wholesaler and whether it was <b>karz</b>, <b>paid</b> or <b>part paid</b>. It is added here automatically.</p>`;
    const el = (id) => $('#' + id, root);
    let rows = [];
    el('q').value = st.q;
    async function load() {
      st.q = el('q').value;
      rows = await rpc('listSuppliers', { q: st.q, onlyDue: st.due });
      $$('#seg button', root).forEach((b) => b.classList.toggle('on', (b.dataset.d === '1') === st.due));
      const total = rows.reduce((s, c) => s + (c.balance > 0 ? c.balance : 0), 0);
      el('sub').innerHTML = `${rows.length} wholesaler${rows.length === 1 ? '' : 's'} · total karz <b class="red">${money(total)}</b>`;
      el('rows').innerHTML = rows.length ? rows.map((c) => `<tr data-id="${c.id}">
        <td>${nameWithAvatar(c.name)}</td><td>${esc(c.phone || '')}</td><td class="muted">${c.last_date ? esc(fmtDate(c.last_date)) : ''}</td>
        <td class="r num"><b class="${c.balance > 0.004 ? 'red' : c.balance < -0.004 ? 'teal' : 'muted'}">${Math.abs(c.balance) > 0.004 ? money(c.balance) : '–'}</b></td>
        <td><div class="actions"><button class="btn sm" data-a="ledger">Account</button><button class="btn sm teal" data-a="pay">Pay</button><button class="btn sm" data-a="edit">Edit</button></div></td></tr>`).join('')
        : `<tr><td colspan="5" class="empty">${st.due ? 'You owe nobody anything.' : 'No wholesalers yet. Click “Add wholesaler”, or add stock with a wholesaler name.'}</td></tr>`;
    }
    el('q').addEventListener('input', debounce(load, 150));
    el('seg').addEventListener('click', (e) => { if (e.target.dataset.d !== undefined) { st.due = e.target.dataset.d === '1'; load(); } });
    el('add').addEventListener('click', () => editSupplier(null, load));
    el('oldk').addEventListener('click', () => oldKarzDialog(load));
    el('rows').addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]');
      if (!b) return;
      const c = rows.find((x) => x.id === Number(b.closest('tr').dataset.id));
      if (b.dataset.a === 'ledger') openSupplierLedger(c.id, load);
      if (b.dataset.a === 'pay') paySupplierDialog(c, load);
      if (b.dataset.a === 'edit') editSupplier(c, load);
    });
    await load();
  },
};
