'use strict';
/**
 * PlanAI Field — application PIN gate for pilot deployments.
 * PIN + recovery code (offline). Data is never wiped on recovery.
 */
const FieldAccessGate = (function () {
  const STORE_KEY = 'planai_field_gate_v1';
  const DEFER_KEY = 'planai_field_pin_deferred_v1';
  const SESSION_MS = 15 * 60 * 1000;
  const RECOVERY_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let _unlockedUntil = 0;
  let _masterKey = null;
  let _pendingResolve = null;
  let _overlayMode = 'unlock';
  let _pendingRecoveryCode = null;
  let _offerReturnMode = 'offer';

  function b64(buf) {
    const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }

  function fromB64(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function normalizeRecoveryCode(code) {
    return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function formatRecoveryCode(raw) {
    const c = normalizeRecoveryCode(raw);
    if (c.length !== 12) return raw;
    return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
  }

  function generateRecoveryCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    let raw = '';
    for (let i = 0; i < 12; i++) raw += RECOVERY_CHARS[bytes[i] % RECOVERY_CHARS.length];
    return formatRecoveryCode(raw);
  }

  async function derivePinKey(pin, salt) {
    const base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 180000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
    );
  }

  async function deriveRecoveryKey(code, salt) {
    const norm = normalizeRecoveryCode(code);
    const base = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(norm), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 180000, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }

  async function hashPin(pin, salt) {
    const key = await derivePinKey(pin, salt);
    const sig = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: new Uint8Array(12) },
      key,
      new TextEncoder().encode('planai-field-pin-v1')
    );
    return b64(sig);
  }

  async function hashRecoveryCode(code, salt) {
    const key = await deriveRecoveryKey(code, salt);
    const sig = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: new Uint8Array(12) },
      key,
      new TextEncoder().encode('planai-field-recovery-v1')
    );
    return b64(sig);
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function saveStore(data) {
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
  }

  function hasPin() {
    return !!loadStore()?.verify;
  }

  function hasRecovery() {
    return !!loadStore()?.wrappedMkRecovery;
  }

  function hasDeferredPin() {
    try { return localStorage.getItem(DEFER_KEY) === '1'; } catch (_) { return false; }
  }

  function deferPin() {
    try { localStorage.setItem(DEFER_KEY, '1'); } catch (_) {}
  }

  function clearDefer() {
    try { localStorage.removeItem(DEFER_KEY); } catch (_) {}
  }

  function pinProtectionEnabled() {
    return hasPin();
  }

  function isUnlocked() {
    return Date.now() < _unlockedUntil && !!_masterKey;
  }

  async function importMasterKey(mkRaw) {
    _masterKey = await crypto.subtle.importKey('raw', mkRaw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    _unlockedUntil = Date.now() + SESSION_MS;
    return _masterKey;
  }

  async function wrapMasterKeyWithPin(pin, mkRaw, prevStore) {
    const p = String(pin || '').trim();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const pinKey = await derivePinKey(p, salt);
    const wrapIv = crypto.getRandomValues(new Uint8Array(12));
    const wrappedMk = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: wrapIv }, pinKey, mkRaw);
    const verify = await hashPin(p, salt);
    return {
      ...(prevStore || {}),
      salt: b64(salt),
      verify,
      wrapIv: b64(wrapIv),
      wrappedMk: b64(wrappedMk),
    };
  }

  async function wrapMasterKeyWithRecovery(code, mkRaw, prevStore) {
    const recoverySalt = crypto.getRandomValues(new Uint8Array(16));
    const recoveryKey = await deriveRecoveryKey(code, recoverySalt);
    const recoveryWrapIv = crypto.getRandomValues(new Uint8Array(12));
    const wrappedMkRecovery = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: recoveryWrapIv }, recoveryKey, mkRaw
    );
    const recoveryVerify = await hashRecoveryCode(code, recoverySalt);
    return {
      ...(prevStore || {}),
      recoverySalt: b64(recoverySalt),
      recoveryVerify,
      recoveryWrapIv: b64(recoveryWrapIv),
      wrappedMkRecovery: b64(wrappedMkRecovery),
    };
  }

  async function decryptMasterKeyFromRecovery(code, store) {
    const rsalt = fromB64(store.recoverySalt);
    const verify = await hashRecoveryCode(code, rsalt);
    if (verify !== store.recoveryVerify) return null;
    const rKey = await deriveRecoveryKey(code, rsalt);
    return crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(store.recoveryWrapIv) },
      rKey,
      fromB64(store.wrappedMkRecovery)
    );
  }

  async function unlockMasterKey(pin) {
    const store = loadStore();
    if (!store?.verify || !store?.wrappedMk) return false;
    const salt = fromB64(store.salt);
    const verify = await hashPin(pin, salt);
    if (verify !== store.verify) return false;
    const pinKey = await derivePinKey(pin, salt);
    const mkRaw = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(store.wrapIv) },
      pinKey,
      fromB64(store.wrappedMk)
    );
    await importMasterKey(mkRaw);
    await ensureRecoveryMaterial(pin, mkRaw);
    return true;
  }

  async function ensureRecoveryMaterial(pin, mkRaw) {
    const store = loadStore();
    if (!store || store.wrappedMkRecovery) return;
    const code = generateRecoveryCode();
    const next = await wrapMasterKeyWithRecovery(code, mkRaw, store);
    saveStore(next);
    _pendingRecoveryCode = code;
  }

  async function regenerateRecoveryCode() {
    if (!isUnlocked() || !_masterKey) return { ok: false, error: 'locked' };
    const store = loadStore();
    if (!store) return { ok: false, error: 'no_store' };
    const mkRaw = await crypto.subtle.exportKey('raw', _masterKey);
    const code = generateRecoveryCode();
    const next = await wrapMasterKeyWithRecovery(code, mkRaw, store);
    saveStore(next);
    return { ok: true, recoveryCode: code };
  }

  async function setupPin(pin) {
    const p = String(pin || '').trim();
    if (p.length < 4 || p.length > 12) return { ok: false, error: 'length' };
    const mk = crypto.getRandomValues(new Uint8Array(32));
    const recoveryCode = generateRecoveryCode();
    let store = await wrapMasterKeyWithPin(p, mk, {});
    store = await wrapMasterKeyWithRecovery(recoveryCode, mk, store);
    saveStore(store);
    clearDefer();
    await importMasterKey(mk);
    return { ok: true, recoveryCode };
  }

  async function resetPinWithRecoveryCode(recoveryCode, newPin) {
    const store = loadStore();
    if (!store?.wrappedMkRecovery) return { ok: false, error: 'no_recovery' };
    const np = String(newPin || '').trim();
    if (np.length < 4 || np.length > 12) return { ok: false, error: 'length' };
    const mkRaw = await decryptMasterKeyFromRecovery(recoveryCode, store);
    if (!mkRaw) return { ok: false, error: 'bad_recovery' };
    const next = await wrapMasterKeyWithPin(np, mkRaw, store);
    saveStore(next);
    await importMasterKey(mkRaw);
    clearDefer();
    return { ok: true };
  }

  function getMasterCryptoKey() {
    return isUnlocked() ? _masterKey : null;
  }

  function encryptionStatusLabel() {
    if (hasPin() && isUnlocked()) return 'enabled';
    if (hasPin()) return 'locked';
    if (typeof SecureStorage !== 'undefined') return 'baseline';
    return 'off';
  }

  function lock() {
    _unlockedUntil = 0;
    _masterKey = null;
  }

  function gateErr(key, fallback) {
    return typeof t === 'function' ? t(key) : fallback;
  }

  function setPanelVisible(id, on) {
    const el = document.getElementById(id);
    if (el) el.style.display = on ? 'block' : 'none';
  }

  function showOverlay(mode) {
    const el = document.getElementById('field-access-gate-overlay');
    if (!el) return;
    _overlayMode = mode;
    const err = document.getElementById('field-access-gate-error');
    if (err) err.textContent = '';
    setPanelVisible('field-access-gate-offer', mode === 'offer');
    setPanelVisible('field-access-gate-setup', mode === 'setup');
    setPanelVisible('field-access-gate-unlock', mode === 'unlock');
    setPanelVisible('field-access-gate-recover', mode === 'recover');
    setPanelVisible('field-access-gate-recover-code', mode === 'recover-code');
    setPanelVisible('field-access-gate-recovery-show', mode === 'recovery-show');
    const cancelBtn = document.getElementById('field-access-gate-cancel');
    const backModes = new Set(['recover', 'recover-code', 'setup']);
    if (cancelBtn) {
      let label = 'gate.cancel';
      let fb = 'Cancel';
      if (mode === 'recover' || mode === 'recover-code') { label = 'gate.back'; fb = 'Back'; }
      else if (mode === 'setup' && _offerReturnMode === 'offer') { label = 'gate.back'; fb = 'Back'; }
      else if (mode === 'offer') { label = 'gate.cancel'; fb = 'Cancel'; }
      cancelBtn.textContent = gateErr(label, fb);
      cancelBtn.style.display = mode === 'recovery-show' ? 'none' : 'block';
    }
    el.style.display = 'flex';
    el.setAttribute('aria-hidden', 'false');
    document.body.classList.add('field-access-gate-active');
    const focusMap = {
      offer: '#field-access-offer-create',
      setup: '#field-access-pin-new',
      unlock: '#field-access-pin-input',
      'recover-code': '#field-access-recovery-code-input',
    };
    const sel = focusMap[mode];
    const inp = sel ? el.querySelector(sel) : null;
    if (inp) setTimeout(() => inp.focus(), 80);
  }

  function hideOverlay() {
    const el = document.getElementById('field-access-gate-overlay');
    if (!el) return;
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('field-access-gate-active');
  }

  function finishPending(ok) {
    const fn = _pendingResolve;
    _pendingResolve = null;
    if (fn) fn(ok);
  }

  function showRecoveryCodePanel(code) {
    const display = document.getElementById('field-access-recovery-code-display');
    if (display) display.textContent = code;
    showOverlay('recovery-show');
  }

  function maybeShowPendingRecoveryCode() {
    if (!_pendingRecoveryCode) return false;
    const code = _pendingRecoveryCode;
    _pendingRecoveryCode = null;
    showRecoveryCodePanel(code);
    return true;
  }

  async function submitUnlock() {
    const pin = document.getElementById('field-access-pin-input')?.value || '';
    const err = document.getElementById('field-access-gate-error');
    const ok = await unlockMasterKey(pin);
    if (!ok) {
      if (err) err.textContent = gateErr('gate.wrongPin', 'Incorrect PIN');
      return;
    }
    if (maybeShowPendingRecoveryCode()) return;
    hideOverlay();
    finishPending(true);
    if (typeof syncFieldSecuritySettingsUi === 'function') syncFieldSecuritySettingsUi();
  }

  async function submitSetup() {
    const pin = document.getElementById('field-access-pin-new')?.value || '';
    const confirm = document.getElementById('field-access-pin-confirm')?.value || '';
    const err = document.getElementById('field-access-gate-error');
    if (pin !== confirm) {
      if (err) err.textContent = gateErr('gate.pinMismatch', 'PINs do not match');
      return;
    }
    const res = await setupPin(pin);
    if (!res.ok) {
      if (err) err.textContent = gateErr('gate.pinShort', 'PIN must be 4–12 characters');
      return;
    }
    if (res.recoveryCode) showRecoveryCodePanel(res.recoveryCode);
    else {
      hideOverlay();
      finishPending(true);
    }
    if (typeof syncFieldSecuritySettingsUi === 'function') syncFieldSecuritySettingsUi();
  }

  function dismissRecoveryCode() {
    hideOverlay();
    finishPending(true);
    if (typeof syncFieldSecuritySettingsUi === 'function') syncFieldSecuritySettingsUi();
  }

  function submitOfferSkip() {
    deferPin();
    hideOverlay();
    finishPending(true);
  }

  function submitOfferCreate() {
    _offerReturnMode = 'offer';
    const err = document.getElementById('field-access-gate-error');
    if (err) err.textContent = '';
    showOverlay('setup');
  }

  function showForgotPin() {
    const err = document.getElementById('field-access-gate-error');
    if (err) err.textContent = '';
    showOverlay('recover');
  }

  function recoverMethod() {
    if (!hasRecovery()) {
      const err = document.getElementById('field-access-gate-error');
      if (err) err.textContent = gateErr('gate.recoverNoCode', 'No recovery code on this device.');
      return;
    }
    showOverlay('recover-code');
  }

  async function submitRecoverCode() {
    const code = document.getElementById('field-access-recovery-code-input')?.value || '';
    const pin = document.getElementById('field-access-recover-pin-new')?.value || '';
    const confirm = document.getElementById('field-access-recover-pin-confirm')?.value || '';
    const err = document.getElementById('field-access-gate-error');
    if (pin !== confirm) {
      if (err) err.textContent = gateErr('gate.pinMismatch', 'PINs do not match');
      return;
    }
    const res = await resetPinWithRecoveryCode(code, pin);
    if (!res.ok) {
      const map = {
        bad_recovery: 'gate.recoverBadCode',
        no_recovery: 'gate.recoverNoCode',
        length: 'gate.pinShort',
      };
      if (err) err.textContent = gateErr(map[res.error] || 'gate.recoverFailed', 'Recovery failed');
      return;
    }
    hideOverlay();
    finishPending(true);
    if (typeof syncFieldSecuritySettingsUi === 'function') syncFieldSecuritySettingsUi();
  }

  function requireUnlock(callback) {
    if (!FIELD_MODE || !hasPin()) {
      if (typeof callback === 'function') callback();
      return Promise.resolve(true);
    }
    if (isUnlocked()) {
      if (typeof callback === 'function') callback();
      return Promise.resolve(true);
    }
    return new Promise(resolve => {
      _pendingResolve = (ok) => {
        if (ok && typeof callback === 'function') callback();
        resolve(ok);
      };
      showOverlay('unlock');
    });
  }

  function offerProtection(callback) {
    if (!FIELD_MODE) {
      if (typeof callback === 'function') callback();
      return Promise.resolve(true);
    }
    if (hasPin()) return requireUnlock(callback);
    if (hasDeferredPin()) {
      if (typeof callback === 'function') callback();
      return Promise.resolve(true);
    }
    return new Promise(resolve => {
      _offerReturnMode = 'offer';
      _pendingResolve = (ok) => {
        if (ok && typeof callback === 'function') callback();
        resolve(ok);
      };
      showOverlay('offer');
    });
  }

  function ensureBeforePersist(callback) {
    return offerProtection(callback);
  }

  function requireAccess(callback) {
    return requireUnlock(callback);
  }

  function promptSetupFromSettings(callback) {
    if (!FIELD_MODE) {
      if (typeof callback === 'function') callback(true);
      return Promise.resolve(true);
    }
    if (hasPin()) return requireUnlock(callback);
    return new Promise(resolve => {
      _offerReturnMode = 'settings';
      _pendingResolve = (ok) => {
        if (ok && typeof callback === 'function') callback(true);
        resolve(ok);
      };
      showOverlay('setup');
    });
  }

  function init() {
    window.fieldAccessGateSubmitUnlock = submitUnlock;
    window.fieldAccessGateSubmitSetup = submitSetup;
    window.fieldAccessGateForgotPin = showForgotPin;
    window.fieldAccessGateRecoverMethod = recoverMethod;
    window.fieldAccessGateSubmitRecoverCode = submitRecoverCode;
    window.fieldAccessGateDismissRecoveryCode = dismissRecoveryCode;
    window.fieldAccessGateOfferSkip = submitOfferSkip;
    window.fieldAccessGateOfferCreate = submitOfferCreate;
    window.fieldAccessGateCancel = () => {
      if (_overlayMode === 'recover') {
        showOverlay('unlock');
        return;
      }
      if (_overlayMode === 'recover-code') {
        showOverlay('recover');
        return;
      }
      if (_overlayMode === 'setup' && _offerReturnMode === 'offer') {
        showOverlay('offer');
        return;
      }
      if (_overlayMode === 'recovery-show') {
        dismissRecoveryCode();
        return;
      }
      hideOverlay();
      finishPending(false);
    };
    const gateEl = document.getElementById('field-access-gate-overlay');
    if (gateEl && gateEl.parentElement !== document.body) document.body.appendChild(gateEl);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'hidden') return;
      const gateOpen = document.getElementById('field-access-gate-overlay')?.style.display === 'flex';
      const hubOpen = document.getElementById('field-start-hub-overlay')?.style.display === 'flex';
      if (gateOpen || hubOpen) return;
      lock();
    });
  }

  return {
    init,
    hasPin,
    hasRecovery,
    hasDeferredPin,
    deferPin,
    clearDefer,
    pinProtectionEnabled,
    isUnlocked,
    setupPin,
    unlockMasterKey,
    resetPinWithRecoveryCode,
    regenerateRecoveryCode,
    getMasterCryptoKey,
    encryptionStatusLabel,
    requireAccess,
    requireUnlock,
    offerProtection,
    ensureBeforePersist,
    promptSetupFromSettings,
    lock,
    showOverlay,
    hideOverlay,
    showRecoveryCodePanel,
  };
})();
