'use strict';
/**
 * PlanAI Field™ — security tier profiles (PUBLIC / PRO / MUNICIPALITY / SECURE).
 * Developed by PiriStrategy. © Taner Piri / PiriStrategy. All rights reserved.
 */
const SecurityProfile = (function () {
  const TIERS = ['PUBLIC', 'PRO', 'MUNICIPALITY', 'SECURE'];
  const KEY = 'planai_security_tier';
  let _tier = 'PRO';

  const POLICY = {
    PUBLIC: { export: true, overlay: true, watermark: false, encryptedCache: false, telemetry: false },
    PRO: { export: true, overlay: true, watermark: false, encryptedCache: true, telemetry: false },
    MUNICIPALITY: { export: true, overlay: true, watermark: true, encryptedCache: true, telemetry: true },
    SECURE: { export: false, overlay: false, watermark: true, encryptedCache: true, telemetry: true },
  };

  function init() {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved && TIERS.includes(saved)) _tier = saved;
    } catch (_) {}
  }

  function current() { return _tier; }
  function setTier(t) {
    if (!TIERS.includes(t)) return false;
    _tier = t;
    try { localStorage.setItem(KEY, t); } catch (_) {}
    return true;
  }
  function policy() { return POLICY[_tier] || POLICY.PUBLIC; }

  function blocksExport() {
    const p = policy();
    if (p.export === false) return true;
    if (p.watermark && typeof DeviceSecurity !== 'undefined' && DeviceSecurity.isSecureModeActive()) return true;
    return false;
  }

  function blocksPlanOverlay() {
    const p = policy();
    if (p.overlay === false) return true;
    return false;
  }

  function requiresWatermark() {
    return !!policy().watermark;
  }

  function requiresEncryptedCache() {
    return !!policy().encryptedCache || (typeof DeviceSecurity !== 'undefined' && DeviceSecurity.isSecureModeActive());
  }

  function telemetryEnabled() {
    return !!policy().telemetry;
  }

  return {
    init, current, setTier, policy, blocksExport, blocksPlanOverlay,
    requiresWatermark, requiresEncryptedCache, telemetryEnabled, TIERS,
  };
})();
