'use strict';
/**
 * PlanAI Field — optional e-mail OTP recovery (server-assisted, data preserved).
 * Configure API: localStorage planai_field_recovery_api or window.PLANAI_FIELD_RECOVERY_API
 */
const PinRecoveryService = (function () {
  const DEVICE_KEY = 'planai_field_device_id';
  const API_LS_KEY = 'planai_field_recovery_api';

  function apiBase() {
    try {
      const fromWin = typeof window !== 'undefined' && window.PLANAI_FIELD_RECOVERY_API;
      const fromLs = localStorage.getItem(API_LS_KEY);
      return String(fromWin || fromLs || '').replace(/\/$/, '');
    } catch (_) {
      return '';
    }
  }

  function isAvailable() {
    return !!apiBase();
  }

  function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
  }

  function getDeviceId() {
    try {
      let id = localStorage.getItem(DEVICE_KEY);
      if (!id) {
        id = 'dev_' + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()));
        localStorage.setItem(DEVICE_KEY, id);
      }
      return id;
    } catch (_) {
      return 'dev_anon';
    }
  }

  async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function hashEmail(email) {
    return sha256Hex(normalizeEmail(email));
  }

  function maskEmail(email) {
    const e = normalizeEmail(email);
    const at = e.indexOf('@');
    if (at < 2) return e;
    const name = e.slice(0, at);
    const dom = e.slice(at + 1);
    const masked = name[0] + '***' + (name.length > 1 ? name[name.length - 1] : '');
    return masked + '@' + dom;
  }

  function b64(buf) {
    const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  async function deriveOtpWrapKey(otp, saltB64) {
    const salt = Uint8Array.from(atob(saltB64), c => c.charCodeAt(0));
    const base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(String(otp)), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']
    );
  }

  async function registerMasterKeyBackup(email, mkRaw) {
    const base = apiBase();
    if (!base) return { ok: false, error: 'no_api' };
    const emailNorm = normalizeEmail(email);
    if (!emailNorm || !emailNorm.includes('@')) return { ok: false, error: 'bad_email' };
    try {
      const emailHash = await hashEmail(emailNorm);
      const res = await fetch(`${base}/v1/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailNorm,
          emailHash,
          deviceId: getDeviceId(),
          mkBackup: b64(mkRaw),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || 'register_failed' };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'network' };
    }
  }

  async function sendOtp(email) {
    const base = apiBase();
    if (!base) return { ok: false, error: 'no_api' };
    const emailNorm = normalizeEmail(email);
    if (!emailNorm) return { ok: false, error: 'bad_email' };
    try {
      const res = await fetch(`${base}/v1/otp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailNorm, deviceId: getDeviceId() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || 'send_failed' };
      return { ok: true, hint: data.hint || maskEmail(emailNorm) };
    } catch (_) {
      return { ok: false, error: 'network' };
    }
  }

  async function recoverMasterKeyWithOtp(email, otp) {
    const base = apiBase();
    if (!base) return { ok: false, error: 'no_api' };
    const emailNorm = normalizeEmail(email);
    const code = String(otp || '').trim();
    if (!emailNorm || code.length < 4) return { ok: false, error: 'bad_input' };
    try {
      const res = await fetch(`${base}/v1/otp/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailNorm, otp: code, deviceId: getDeviceId() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data.error || 'verify_failed' };
      if (!data.wrappedMk || !data.wrapSalt) return { ok: false, error: 'bad_payload' };
      const key = await deriveOtpWrapKey(code, data.wrapSalt);
      const raw = Uint8Array.from(atob(data.wrappedMk), c => c.charCodeAt(0));
      const iv = raw.slice(0, 12);
      const cipher = raw.slice(12);
      const mkRaw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
      return { ok: true, mkRaw };
    } catch (_) {
      return { ok: false, error: 'verify_failed' };
    }
  }

  return {
    apiBase,
    isAvailable,
    normalizeEmail,
    hashEmail,
    maskEmail,
    getDeviceId,
    registerMasterKeyBackup,
    sendOtp,
    recoverMasterKeyWithOtp,
  };
})();
