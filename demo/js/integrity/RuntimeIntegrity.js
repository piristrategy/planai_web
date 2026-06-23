'use strict';
/**
 * PlanAI Field™ — runtime SHA-256 manifest verification.
 * Developed by PiriStrategy. © Taner Piri / PiriStrategy. All rights reserved.
 */
const RuntimeIntegrity = (function () {
  const PRODUCTION = document.body?.classList?.contains('walk-production') || false;
  const MANIFEST_URL = new URL('integrity-manifest.json', document.baseURI || location.href).href;
  let _failed = false;
  let _checked = false;
  let _mismatchCount = 0;

  async function sha256Hex(buffer) {
    if (!crypto?.subtle) return null;
    const dig = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(dig)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function verifyModule(path, expected) {
    if (!expected || !PRODUCTION) return true;
    try {
      const base = document.baseURI || location.href;
      const url = path.startsWith('http') ? path : new URL(path, base).href;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return false;
      const buf = await res.arrayBuffer();
      const hash = await sha256Hex(buf);
      return hash === expected.toLowerCase();
    } catch (_) {
      return !PRODUCTION;
    }
  }

  async function init() {
    if (_checked) return !_failed;
    _checked = true;
    if (!PRODUCTION) return true;
    try {
      const proto = location.protocol || '';
      if (proto === 'file:' || proto === 'blob:') return true;
      const host = (location.hostname || '').toLowerCase();
      if (host === 'planai.tr' || host.endsWith('.planai.tr')) return true;
      if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;
    } catch (_) { /* continue strict check */ }
    try {
      const res = await fetch(MANIFEST_URL, { cache: 'no-store' });
      if (!res.ok) {
        _failed = true;
        return false;
      }
      const manifest = await res.json();
      const modules = manifest.modules || [];
      for (const m of modules) {
        const ok = await verifyModule(m.path, m.sha256);
        if (!ok) {
          _mismatchCount++;
          _failed = true;
          if (typeof SecurityTelemetry !== 'undefined') {
            SecurityTelemetry.record('integrity.mismatch', { path: m.path });
          }
        }
      }
      if (_failed && typeof DeviceSecurity !== 'undefined') {
        DeviceSecurity.addRiskScore(25, 'integrity.manifest');
      }
    } catch (_) {
      if (PRODUCTION) _failed = true;
    }
    return !_failed;
  }

  function isFailed() { return _failed; }
  function mismatchCount() { return _mismatchCount; }

  return { init, isFailed, mismatchCount, verifyModule, PRODUCTION };
})();
