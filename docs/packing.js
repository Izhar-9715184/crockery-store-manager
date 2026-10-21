/*
 * Shared by the phone "Maal Entry" page (browser) and the laptop software (Node).
 * Turns a small object into one line of text that can be sent by WhatsApp / SMS /
 * email and turned back into the same object on the other side.
 *
 *   CROCKERY-MAAL:<base64url of JSON>~<crc32 in hex>
 *
 * The checksum detects a message that was cut short or damaged on the way, so a
 * half-received list can never be imported by mistake.
 *
 * NOTE: this file is also packed into the Windows program (see package.json "files").
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Packing = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  const hex8 = (n) => n.toString(16).padStart(8, '0');

  function utf8Encode(str) {
    return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(str) : Uint8Array.from(Buffer.from(str, 'utf8'));
  }
  function utf8Decode(bytes) {
    return typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-8').decode(bytes) : Buffer.from(bytes).toString('utf8');
  }
  function toB64url(bytes) {
    let b64;
    if (typeof Buffer !== 'undefined') b64 = Buffer.from(bytes).toString('base64');
    else {
      let s = '';
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      b64 = btoa(s);
    }
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64url(str) {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    if (typeof Buffer !== 'undefined') return Uint8Array.from(Buffer.from(b64, 'base64'));
    const bin = atob(b64 + '==='.slice((b64.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** object -> "TAG:xxxx~crc" */
  function pack(tag, obj) {
    const bytes = utf8Encode(JSON.stringify(obj));
    return `${tag}:${toB64url(bytes)}~${hex8(crc32(bytes))}`;
  }

  /**
   * Finds "TAG:...~crc" anywhere inside a longer text (e.g. a WhatsApp message that
   * also contains a readable summary) and returns the object. Throws a friendly
   * Error if it is missing, cut short or damaged.
   */
  function unpack(text, tag) {
    const s = String(text || '');
    const re = new RegExp(`${tag}:([A-Za-z0-9_\\-\\s]+)~([0-9a-fA-F]{8})`);
    const m = re.exec(s);
    if (!m) {
      if (new RegExp(`${tag}:`).test(s)) {
        throw new Error('This message looks incomplete (cut short). Please ask for it to be sent again.');
      }
      throw new Error('This is not a list from the phone. Copy the whole message and try again.');
    }
    const bytes = fromB64url(m[1].replace(/\s+/g, ''));
    if (hex8(crc32(bytes)) !== m[2].toLowerCase()) {
      throw new Error('The message is damaged or incomplete. Please ask for it to be sent again.');
    }
    try {
      return JSON.parse(utf8Decode(bytes));
    } catch (e) {
      throw new Error('The message could not be read. Please ask for it to be sent again.');
    }
  }

  return { pack, unpack, crc32 };
});
