'use strict';
/* Bill receipt on the phone: drawn as a picture, and as a one-page PDF, so it can be saved or sent on WhatsApp. */
(function (root) {
  const fmt = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const nice = (s) => { const d = new Date(s + 'T00:00:00'); return isNaN(d) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
  const FONT = '"Segoe UI", system-ui, Roboto, Arial, "Noto Nastaliq Urdu", sans-serif';

  /** bl = { date, cn, lines:[{n,q,pr}], disc, total, paidAmt, due, id } */
  function draw(bl, shop) {
    const S = 2, W = 600;
    const rows = bl.lines.length;
    const H = 150 + 70 + rows * 46 + 40 + (bl.disc > 0 ? 34 : 0) + 3 * 40 + 100;
    const c = document.createElement('canvas');
    c.width = W * S; c.height = H * S;
    const g = c.getContext('2d');
    g.scale(S, S);
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    // header band (maroon + gold, like the logo)
    const hg = g.createLinearGradient(0, 0, W, 130);
    hg.addColorStop(0, '#4a0f20'); hg.addColorStop(1, '#9f1f3f');
    g.fillStyle = hg; g.fillRect(0, 0, W, 120);
    g.fillStyle = '#d9a94a'; g.fillRect(0, 120, W, 4);
    g.fillStyle = '#fdf3d0'; g.textBaseline = 'alphabetic';
    g.font = `800 28px ${FONT}`; g.textAlign = 'left';
    g.fillText(String(shop || 'Bill').slice(0, 28), 28, 56);
    g.font = `600 14px ${FONT}`; g.fillStyle = 'rgba(253,243,208,.8)';
    g.fillText('BILL / RECEIPT', 28, 84);
    g.textAlign = 'right'; g.font = `700 15px ${FONT}`; g.fillStyle = '#fdf3d0';
    g.fillText(nice(bl.date), W - 28, 56);
    g.font = `500 13px ${FONT}`; g.fillStyle = 'rgba(253,243,208,.75)';
    g.fillText(bl.id ? String(bl.id).slice(-6).toUpperCase() : '', W - 28, 84);
    // customer
    g.textAlign = 'left'; g.fillStyle = '#7a7466'; g.font = `700 12px ${FONT}`;
    g.fillText('BILLED TO', 28, 158);
    g.fillStyle = '#14261f'; g.font = `800 22px ${FONT}`;
    g.fillText(String(bl.cn || 'Walk-in customer').slice(0, 34), 28, 186);
    // table head
    let y = 214;
    g.fillStyle = '#14261f'; g.fillRect(24, y, W - 48, 32);
    g.fillStyle = '#fff'; g.font = `700 12px ${FONT}`;
    g.textAlign = 'left'; g.fillText('ITEM', 36, y + 21);
    g.textAlign = 'right'; g.fillText('QTY × RATE', 380, y + 21); g.fillText('AMOUNT', W - 36, y + 21);
    y += 32;
    bl.lines.forEach((l, i) => {
      if (i % 2) { g.fillStyle = '#f7f4ea'; g.fillRect(24, y, W - 48, 46); }
      g.fillStyle = '#14261f'; g.textAlign = 'left'; g.font = `600 16px ${FONT}`;
      let n = String(l.n); while (g.measureText(n).width > 200 && n.length > 3) n = n.slice(0, -2);
      g.fillText(n === String(l.n) ? n : n + '…', 36, y + 29);
      g.textAlign = 'right'; g.font = `500 15px ${FONT}`; g.fillStyle = '#4b5a53';
      g.fillText(`${fmt(l.q)}${l.u && l.u !== 'pcs' ? ' ' + l.u : ''} × ${fmt(l.pr)}`, 380, y + 29);
      g.fillStyle = '#14261f'; g.font = `800 16px ${FONT}`; g.fillText(fmt(l.q * l.pr), W - 36, y + 29);
      y += 46;
    });
    g.strokeStyle = '#e0d8c0'; g.beginPath(); g.moveTo(24, y + 4); g.lineTo(W - 24, y + 4); g.stroke();
    y += 30;
    const row = (label, val, o = {}) => {
      if (o.bg) { g.fillStyle = o.bg; g.fillRect(260, y - 24, W - 284, 36); }
      g.fillStyle = o.color || '#4b5a53'; g.font = `${o.bold ? 800 : 600} ${o.big ? 19 : 16}px ${FONT}`;
      g.textAlign = 'left'; g.fillText(label, 272, y);
      g.textAlign = 'right'; g.fillText(val, W - 36, y);
      y += 40;
    };
    if (bl.disc > 0) { row('Discount', '- ' + fmt(bl.disc)); y -= 6; }
    row('Total', 'Rs ' + fmt(bl.total), { bg: '#14261f', color: '#fff', bold: true, big: true });
    row('Received', 'Rs ' + fmt(bl.paidAmt));
    if (bl.due > 0) row('Remaining (Udhar)', 'Rs ' + fmt(bl.due), { bg: '#fde9e5', color: '#a1291d', bold: true });
    else row('Paid in full', '✓', { color: '#0b7a62', bold: true });
    g.textAlign = 'center'; g.fillStyle = '#b57a22'; g.font = `800 16px ${FONT}`;
    g.fillText('Thank you for shopping with us!', W / 2, H - 30);
    return c;
  }


  const hdr = (g, W, shop, left, right, sub) => {
    const hg = g.createLinearGradient(0, 0, W, 130);
    hg.addColorStop(0, '#4a0f20'); hg.addColorStop(1, '#9f1f3f');
    g.fillStyle = hg; g.fillRect(0, 0, W, 120);
    g.fillStyle = '#d9a94a'; g.fillRect(0, 120, W, 4);
    g.textBaseline = 'alphabetic'; g.textAlign = 'left'; g.fillStyle = '#fdf3d0';
    g.font = `800 28px ${FONT}`; g.fillText(String(shop || 'Shop').slice(0, 28), 28, 56);
    g.font = `700 14px ${FONT}`; g.fillStyle = 'rgba(253,243,208,.85)'; g.fillText(left, 28, 84);
    g.textAlign = 'right'; g.font = `700 15px ${FONT}`; g.fillStyle = '#fdf3d0'; g.fillText(right, W - 28, 56);
    g.font = `500 13px ${FONT}`; g.fillStyle = 'rgba(253,243,208,.75)'; g.fillText(sub || '', W - 28, 84);
    g.textAlign = 'left';
  };
  /** One payment: o = { kind:'received'|'paid', name, amount, method, date, note, after } */
  function drawPayment(o, shop) {
    const S = 2, W = 600, H = 470;
    const c = document.createElement('canvas');
    c.width = W * S; c.height = H * S;
    const g = c.getContext('2d'); g.scale(S, S);
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const rec = o.kind === 'received';
    hdr(g, W, shop, rec ? 'PAYMENT RECEIPT' : 'PAYMENT MADE', nice(o.date), '');
    g.fillStyle = '#7a7466'; g.font = `700 12px ${FONT}`; g.fillText(rec ? 'RECEIVED FROM' : 'PAID TO', 28, 160);
    g.fillStyle = '#14261f'; g.font = `800 24px ${FONT}`; g.fillText(String(o.name).slice(0, 32), 28, 192);
    g.fillStyle = rec ? '#0b7a62' : '#9f1f3f'; g.fillRect(28, 216, W - 56, 86);
    g.fillStyle = 'rgba(255,255,255,.85)'; g.font = `700 13px ${FONT}`; g.fillText(rec ? 'AMOUNT RECEIVED' : 'AMOUNT PAID', 46, 244);
    g.fillStyle = '#fff'; g.font = `800 36px ${FONT}`; g.fillText('Rs ' + fmt(o.amount), 46, 286);
    let y = 336;
    const row = (k, v, bold) => { g.fillStyle = '#7a7466'; g.font = `600 15px ${FONT}`; g.textAlign = 'left'; g.fillText(k, 28, y);
      g.fillStyle = '#14261f'; g.font = `${bold ? 800 : 600} 16px ${FONT}`; g.textAlign = 'right'; g.fillText(v, W - 28, y); y += 32; };
    row('Method', ({ cash: 'Cash', bank: 'Bank transfer', wallet: 'EasyPaisa / JazzCash', cheque: 'Cheque' })[o.method] || o.method || 'Cash');
    if (o.note) row('Note', String(o.note).slice(0, 36));
    if (o.after !== undefined && o.after !== null) row(rec ? 'Udhar remaining' : 'Karz remaining', o.after > 0 ? 'Rs ' + fmt(o.after) : 'Nil — cleared', true);
    g.textAlign = 'center'; g.fillStyle = '#b57a22'; g.font = `800 16px ${FONT}`;
    g.fillText(rec ? 'Thank you!' : 'Payment made with thanks', W / 2, H - 26);
    return c;
  }
  /** Account details of one person: o = { name, phone, entries:[{d,label,db,cr}], balance, kind:'udhar'|'karz' } */
  function drawStatement(o, shop) {
    const S = 2, W = 600, n = o.entries.length;
    const H = 150 + 100 + 38 + n * 44 + 110;
    const c = document.createElement('canvas');
    c.width = W * S; c.height = H * S;
    const g = c.getContext('2d'); g.scale(S, S);
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    hdr(g, W, shop, o.kind === 'karz' ? 'ACCOUNT OF KARZ' : 'ACCOUNT OF UDHAR', nice(o.date), '');
    g.fillStyle = '#7a7466'; g.font = `700 12px ${FONT}`; g.fillText(o.kind === 'karz' ? 'WHOLESALER' : 'CUSTOMER', 28, 158);
    g.fillStyle = '#14261f'; g.font = `800 24px ${FONT}`; g.fillText(String(o.name).slice(0, 32), 28, 190);
    if (o.phone) { g.fillStyle = '#7a7466'; g.font = `500 14px ${FONT}`; g.fillText(o.phone, 28, 212); }
    let y = 232;
    g.fillStyle = '#14261f'; g.fillRect(24, y, W - 48, 32);
    g.fillStyle = '#fff'; g.font = `700 12px ${FONT}`; g.textAlign = 'left'; g.fillText('DATE / DETAILS', 36, y + 21);
    g.textAlign = 'right'; g.fillText(o.kind === 'karz' ? 'KARZ' : 'UDHAR', 440, y + 21); g.fillText('PAID', W - 36, y + 21);
    y += 32;
    o.entries.forEach((e, i) => {
      if (i % 2) { g.fillStyle = '#f7f4ea'; g.fillRect(24, y, W - 48, 44); }
      g.textAlign = 'left'; g.fillStyle = '#14261f'; g.font = `700 14px ${FONT}`; g.fillText(nice(e.d), 36, y + 20);
      g.fillStyle = '#6b7a72'; g.font = `500 12.5px ${FONT}`; g.fillText(String(e.label || '').slice(0, 34), 36, y + 37);
      g.textAlign = 'right'; g.font = `800 16px ${FONT}`;
      g.fillStyle = '#a1291d'; g.fillText(e.db ? fmt(e.db) : '', 440, y + 28);
      g.fillStyle = '#0b7a62'; g.fillText(e.cr ? fmt(e.cr) : '', W - 36, y + 28);
      y += 44;
    });
    y += 22;
    g.fillStyle = o.balance > 0 ? '#14261f' : '#0b7a62'; g.fillRect(24, y, W - 48, 50);
    g.fillStyle = '#fff'; g.textAlign = 'left'; g.font = `800 18px ${FONT}`; g.fillText(o.kind === 'karz' ? 'Karz remaining' : 'Balance due', 40, y + 32);
    g.textAlign = 'right'; g.fillText(o.balance > 0 ? 'Rs ' + fmt(o.balance) : 'Nil', W - 40, y + 32);
    g.textAlign = 'center'; g.fillStyle = '#b57a22'; g.font = `700 14px ${FONT}`; g.fillText('Latest entries shown', W / 2, H - 22);
    return c;
  }

  function toPdf(jpeg, w, h) {
    const enc = new TextEncoder();
    const pw = +(w * 0.75).toFixed(2), ph = +(h * 0.75).toFixed(2);
    const chunks = [], offs = [];
    let len = 0;
    const put = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; chunks.push(b); len += b.length; };
    put('%PDF-1.4\n');
    const obj = (n, body, stream) => { offs[n] = len; put(`${n} 0 obj\n${body}\n`); if (stream) { put('stream\n'); put(stream); put('\nendstream\n'); } put('endobj\n'); };
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`);
    const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
    obj(4, `<< /Length ${content.length} >>`, content);
    obj(5, `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg);
    const xref = len;
    put(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((n) => String(offs[n]).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(len); let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }
  const blobOf = (c, type, q) => new Promise((res) => c.toBlob(res, type, q));
  async function png(c) { return blobOf(c, 'image/png'); }
  async function pdf(c) {
    const j = new Uint8Array(await (await blobOf(c, 'image/jpeg', 0.93)).arrayBuffer());
    return new Blob([toPdf(j, c.width, c.height)], { type: 'application/pdf' });
  }
  /** Gives the file to the phone: the share sheet when it can take files (WhatsApp...), else a normal download. */
  async function deliver(blob, name, shareFirst) {
    const file = new File([blob], name, { type: blob.type });
    if (shareFirst && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: name }); return 'shared'; } catch (e) { if (e && e.name === 'AbortError') return 'cancelled'; }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    return 'saved';
  }
  root.Receipt = { draw, drawPayment, drawStatement, png, pdf, deliver };
})(typeof self !== 'undefined' ? self : this);
