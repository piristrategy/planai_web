'use strict';
/**
 * PlanAI Field™ — mobile hardening hooks (Android/iOS Capacitor).
 * Developed by PiriStrategy. © Taner Piri / PiriStrategy. All rights reserved.
 */
const MobileHardening = (function () {
  function init() {
    if (typeof DeviceSecurity === 'undefined') return;
    try {
      const cap = window.Capacitor;
      if (!cap?.isNativePlatform?.()) return;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') DeviceSecurity.refresh(true).catch(() => {});
      });
    } catch (_) {}
  }

  function requestSecureScreen() {
    try {
      if (typeof SecurityProfile !== 'undefined' && SecurityProfile.current() === 'SECURE') {
        document.body?.classList.add('planai-flag-secure');
      }
    } catch (_) {}
  }

  return { init, requestSecureScreen };
})();
