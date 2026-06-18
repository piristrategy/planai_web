'use strict';
/**
 * PlanAI Field™ — AES-GCM encrypted offline cache layer.
 * Developed by PiriStrategy. © Taner Piri / PiriStrategy. All rights reserved.
 */
const SecureStorage = (function () {
  const PREFIX = 'planai.sec.';
  let _key = null;

  async function deriveKey() {
    if (_key) return _key;
    if (typeof FieldAccessGate !== 'undefined') {
      const mk = FieldAccessGate.getMasterCryptoKey();
      if (mk) { _key = mk; return _key; }
    }
    if (!crypto?.subtle) return null;
    const salt = new TextEncoder().encode('planai-field-v1');
    const baseKey = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode('planai-field-offline'), 'PBKDF2', false, ['deriveKey']
    );
    _key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' },
      baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
    return _key;
  }

  function shouldEncrypt() {
    return typeof SecurityProfile !== 'undefined' && SecurityProfile.requiresEncryptedCache();
  }

  async function encryptJson(obj) {
    const key = await deriveKey();
    if (!key) return JSON.stringify(obj);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = new TextEncoder().encode(JSON.stringify(obj));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
    const out = new Uint8Array(iv.length + cipher.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(cipher), iv.length);
    return PREFIX + btoa(String.fromCharCode(...out));
  }

  async function decryptJson(stored) {
    if (!stored || typeof stored !== 'string' || !stored.startsWith(PREFIX)) {
      try { return JSON.parse(stored); } catch (_) { return null; }
    }
    const key = await deriveKey();
    if (!key) return null;
    const raw = Uint8Array.from(atob(stored.slice(PREFIX.length)), (c) => c.charCodeAt(0));
    const iv = raw.slice(0, 12);
    const data = raw.slice(12);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return JSON.parse(new TextDecoder().decode(plain));
  }

  async function wrapPut(key, value) {
    if (!shouldEncrypt()) return value;
    try { return await encryptJson(typeof value === 'object' ? value : { v: value }); } catch (_) { return value; }
  }

  async function wrapGet(stored) {
    if (!stored || typeof stored !== 'string' || !stored.startsWith(PREFIX)) return stored;
    try { return await decryptJson(stored); } catch (_) { return null; }
  }

  function init() {}

  return { init, shouldEncrypt, encryptJson, decryptJson, wrapPut, wrapGet, deriveKey };
})();
