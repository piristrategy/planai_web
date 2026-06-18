'use strict';
/**
 * PlanAI Field — IndexedDB encryption for snapshots and blobs (pilot).
 * Encrypts only when the user has unlocked a device PIN (Settings).
 */
const FieldDbCrypto = (function () {
  const ENC_MARK = 'planai.enc.v1';

  function enabled() {
    if (typeof FieldAccessGate !== 'undefined' && FieldAccessGate.getMasterCryptoKey()) return true;
    return false;
  }

  function sensitiveStore(store) {
    return store === 'snapshots' || store === 'blobs';
  }

  async function getKey() {
    if (typeof FieldAccessGate !== 'undefined') {
      const mk = FieldAccessGate.getMasterCryptoKey();
      if (mk) return mk;
    }
    return null;
  }

  function bytesToB64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function toPlainBytes(buf) {
    if (buf instanceof ArrayBuffer) return new Uint8Array(buf);
    if (ArrayBuffer.isView(buf)) return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    return null;
  }

  async function encryptBytes(buf) {
    const key = await getKey();
    if (!key) return null;
    const plain = toPlainBytes(buf);
    if (!plain) return null;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain);
    const out = new Uint8Array(iv.length + cipher.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(cipher), iv.length);
    return bytesToB64(out);
  }

  async function decryptBytes(b64) {
    const key = await getKey();
    if (!key || !b64) return null;
    const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const iv = raw.slice(0, 12);
    const data = raw.slice(12);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
    return plain;
  }

  async function encryptRecord(store, val) {
    if (!enabled() || !sensitiveStore(store) || !val) return val;
    if (val._enc === ENC_MARK) return val;
    if (store === 'snapshots' && typeof val.json === 'string') {
      const enc = await encryptBytes(new TextEncoder().encode(val.json));
      if (!enc) return val;
      return { id: val.id, _enc: ENC_MARK, json: null, jsonEnc: enc };
    }
    if (store === 'blobs' && val.data != null) {
      const enc = await encryptBytes(val.data instanceof Blob ? val.data : val.data);
      if (!enc) return val;
      return {
        ...val,
        _enc: ENC_MARK,
        data: null,
        dataEnc: enc,
        mime: val.mime || (val.data?.type) || 'application/octet-stream',
      };
    }
    return val;
  }

  async function decryptRecord(store, val) {
    if (!val || val._enc !== ENC_MARK) return val;
    const out = { ...val };
    if (store === 'snapshots' && val.jsonEnc) {
      const plain = await decryptBytes(val.jsonEnc);
      if (plain) out.json = new TextDecoder().decode(plain);
    }
    if (store === 'blobs' && val.dataEnc) {
      const plain = await decryptBytes(val.dataEnc);
      if (plain) out.data = new Blob([plain], { type: val.mime || 'application/octet-stream' });
    }
    delete out.jsonEnc;
    delete out.dataEnc;
    delete out._enc;
    return out;
  }

  return {
    enabled,
    sensitiveStore,
    encryptRecord,
    decryptRecord,
  };
})();
