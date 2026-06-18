'use strict';
/**
 * PlanAI Field™ — privacy-safe local security telemetry.
 * Developed by PiriStrategy. © Taner Piri / PiriStrategy. All rights reserved.
 */
const SecurityTelemetry = (function () {
  const KEY = 'planai_sec_events';
  const MAX = 48;
  const OPTIN_KEY = 'planai_telemetry_optin';

  function enabled() {
    if (typeof SecurityProfile !== 'undefined' && SecurityProfile.telemetryEnabled()) return true;
    try { return localStorage.getItem(OPTIN_KEY) === '1'; } catch (_) { return false; }
  }

  function record(type, detail) {
    if (!enabled()) return;
    try {
      const list = JSON.parse(localStorage.getItem(KEY) || '[]');
      list.push({ t: Date.now(), type: String(type).slice(0, 64), d: detail || null });
      while (list.length > MAX) list.shift();
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch (_) {}
  }

  function flush() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (_) { return []; }
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (_) {}
  }

  function init() {}

  return { init, record, flush, clear, enabled };
})();
