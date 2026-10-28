/*
 * Locks / unlocks the stock list that the laptop puts online, so the online copy is unreadable
 * to anybody who does not have the passphrase. Same file runs on the phone (browser) and in the
 * Windows program (Node), using the standard Web Crypto API: PBKDF2 -> AES-256-GCM.
 *
 * NOTE: this file is also packed into the Windows program (see package.json "files").
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StockCrypto = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const subtle = () => {
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.subtle) return globalThis.crypto;
    return require('crypto').webcrypto;   // older Node / Electron
  };
  const enc = (s) => new TextEncoder().encode(s);
  const b64 = (u8) => (typeof Buffer !== 'undefined' ? Buffer.from(u8).toString('base64') : btoa(String.fromCharCode(...u8)));
  const unb64 = (s) => (typeof Buffer !== 'undefined' ? new Uint8Array(Buffer.from(s, 'base64')) : Uint8Array.from(atob(s), (c) => c.charCodeAt(0)));
  const ITER = 100000;

  async function key(pass, salt) {
    const c = subtle();
    const base = await c.subtle.importKey('raw', enc(String(pass).trim()), 'PBKDF2', false, ['deriveKey']);
    return c.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encrypt(obj, pass) {
    const c = subtle();
    const salt = c.getRandomValues(new Uint8Array(16));
    const iv = c.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await c.subtle.encrypt({ name: 'AES-GCM', iv }, await key(pass, salt), enc(JSON.stringify(obj))));
    return JSON.stringify({ v: 1, s: b64(salt), i: b64(iv), d: b64(ct) });
  }
  async function decrypt(text, pass) {
    let o;
    try { o = JSON.parse(text); } catch (e) { throw new Error('The online stock copy is damaged'); }
    if (!o || o.v !== 1) throw new Error('The online stock copy is not readable');
    try {
      const pt = await subtle().subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.i) }, await key(pass, unb64(o.s)), unb64(o.d));
      return JSON.parse(new TextDecoder().decode(pt));
    } catch (e) { throw new Error('Wrong passphrase, or the copy is damaged'); }
  }
  return { encrypt, decrypt };
});
