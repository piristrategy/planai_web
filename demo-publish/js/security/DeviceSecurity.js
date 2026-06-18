'use strict';
/**
 * PlanAI Field™ — device integrity & secure-mode downgrade.
 * Developed by PiriStrategy. © Taner Piri / PiriStrategy. All rights reserved.
 */
const DeviceSecurity = (function () {
  const CHECK_INTERVAL_MS = 5 * 60 * 1000;
  const CACHE_MS = 90 * 1000;
  const PRODUCTION = document.body?.classList?.contains('walk-production') || false;

  let _snapshot = null;
  let _secureMode = false;
  let _manualSecure = false;
  let _timer = null;
  let _lastCheck = 0;
  let _checking = false;

  function secLog() {
    if (PRODUCTION) return;
    if (typeof console !== 'undefined' && console.debug) {
      console.debug.apply(console, ['[DeviceSecurity]', ...arguments]);
    }
  }

  function getPlugin() {
    try {
      const cap = window.Capacitor;
      if (!cap?.Plugins?.PlanAIDeviceSecurity) return null;
      return cap.Plugins.PlanAIDeviceSecurity;
    } catch (_) {
      return null;
    }
  }

  function isNativeMobile() {
    try {
      const cap = window.Capacitor;
      return !!(cap?.isNativePlatform?.() || cap?.getPlatform?.() === 'android' || cap?.getPlatform?.() === 'ios');
    } catch (_) {
      return false;
    }
  }

  function levelFromScore(score) {
    if (score >= 90) return 'critical';
    if (score >= 60) return 'high';
    if (score >= 30) return 'medium';
    if (score >= 10) return 'low';
    return 'none';
  }

  function webHeuristics() {
    const signals = [];
    let score = 0;
    if (typeof navigator !== 'undefined' && /emulator|sdk_gphone|generic/i.test(navigator.userAgent || '')) {
      signals.push({ id: 'web.emu_ua', weight: 15 });
      score += 15;
    }
    return { platform: 'web', score, level: levelFromScore(score), compromised: score >= 30, signals };
  }

  async function nativeAssess() {
    const plugin = getPlugin();
    if (!plugin?.assess) return null;
    try {
      return await plugin.assess();
    } catch (e) {
      secLog('native assess failed', e?.message || e);
      return null;
    }
  }

  function mergeSnapshot(native, web) {
    const base = native || web || { platform: 'unknown', score: 0, level: 'none', signals: [] };
    const score = Math.min(100, Number(base.score) || 0);
    const level = base.level || levelFromScore(score);
    const compromised = score >= 30 || !!base.compromised;
    return {
      platform: base.platform || 'unknown',
      score,
      level,
      compromised,
      signals: base.signals || [],
      assessedAt: Date.now(),
      secureMode: compromised || _manualSecure,
    };
  }

  function applySecureModeUI() {
    const on = isSecureModeActive();
    document.body?.classList.toggle('device-secure-mode', on);
    try {
      if (on && typeof window.__planaiDisableDebugOverlays === 'function') {
        window.__planaiDisableDebugOverlays();
      }
    } catch (_) {}
  }

  async function refresh(force) {
    const now = Date.now();
    if (!force && _snapshot && now - _lastCheck < CACHE_MS) return _snapshot;
    if (_checking) return _snapshot;
    _checking = true;
    try {
      let native = null;
      if (isNativeMobile()) native = await nativeAssess();
      const web = webHeuristics();
      _snapshot = mergeSnapshot(native, web);
      _lastCheck = now;
      _secureMode = _snapshot.compromised || _manualSecure;
      _snapshot.secureMode = _secureMode;
      applySecureModeUI();
      secLog('assessed', _snapshot.level, _snapshot.score, _snapshot.platform);
      return _snapshot;
    } finally {
      _checking = false;
    }
  }

  function startPeriodicChecks() {
    if (_timer) return;
    _timer = setInterval(() => { refresh(true).catch(() => {}); }, CHECK_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refresh(true).catch(() => {});
    });
  }

  function getSecurityRiskLevel() {
    return _snapshot?.level || 'none';
  }

  function isCompromisedDevice() {
    return !!(_snapshot?.compromised || _manualSecure);
  }

  function isSecureModeActive() {
    return !!(_secureMode || _manualSecure || _snapshot?.compromised);
  }

  function enableSecureMode(reason) {
    _manualSecure = true;
    _secureMode = true;
    if (_snapshot) _snapshot.secureMode = true;
    applySecureModeUI();
    secLog('secure mode enabled', reason || 'manual');
    return true;
  }

  function getSnapshot() {
    return _snapshot ? { ..._snapshot } : null;
  }

  /** Restrict sensitive exports (PDF/ZIP/share) when device integrity is degraded. */
  function blocksSensitiveExport() {
    return isSecureModeActive();
  }

  /** Restrict municipality / plan overlay imports in secure mode. */
  function blocksPlanOverlayImport() {
    return isSecureModeActive();
  }

  /** Watermark field reports when exporting from a compromised device. */
  function reportWatermarkHtml() {
    if (!isSecureModeActive()) return '';
    const lvl = getSecurityRiskLevel();
    return '<div class="device-secure-watermark" style="margin:8px 0;padding:8px 12px;border:1px dashed #c0392b;background:#fdecea;color:#922b21;font-size:11px;border-radius:6px;">'
      + '⚠ PlanAI Field — Kısıtlı güvenlik modu (' + lvl + '). Bu rapor filigranlıdır; resmi kullanım için doğrulanmış cihaz gerekir.'
      + '</div>';
  }

  function exportBlockedMessage() {
    return 'Güvenlik modu: dışa aktarma kısıtlı. Harita ve GPS kullanımı devam eder.';
  }

  function addRiskScore(delta, reason) {
    const d = Math.max(0, Math.min(100, Number(delta) || 0));
    if (!_snapshot) _snapshot = mergeSnapshot(null, webHeuristics());
    _snapshot.score = Math.min(100, (_snapshot.score || 0) + d);
    _snapshot.level = levelFromScore(_snapshot.score);
    _snapshot.compromised = _snapshot.score >= 30 || _manualSecure;
    if (reason) {
      _snapshot.signals = (_snapshot.signals || []).concat([{ id: reason, weight: d }]);
    }
    _secureMode = _snapshot.compromised || _manualSecure;
    _snapshot.secureMode = _secureMode;
    applySecureModeUI();
    secLog('risk boost', d, reason, _snapshot.score);
    return _snapshot.score;
  }

  async function init() {
    await refresh(true);
    startPeriodicChecks();
  }

  // Public API (also on window for Capacitor WebView inspection resistance — logic stays minimal in HTML)
  const api = {
    init,
    refresh,
    getSecurityRiskLevel,
    isCompromisedDevice,
    enableSecureMode,
    getSnapshot,
    blocksSensitiveExport,
    blocksPlanOverlayImport,
    reportWatermarkHtml,
    exportBlockedMessage,
    isSecureModeActive,
    addRiskScore,
  };

  if (!PRODUCTION) {
    window.getSecurityRiskLevel = getSecurityRiskLevel;
    window.isCompromisedDevice = isCompromisedDevice;
    window.enableSecureMode = enableSecureMode;
  }
  window.DeviceSecurity = api;

  return api;
})();
