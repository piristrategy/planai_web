'use strict';
/**
 * PlanAI Field™ — unified security orchestrator.
 * Developed by PiriStrategy. © Taner Piri / PiriStrategy. All rights reserved.
 */
const PlanAISecurity = (function () {
  async function init() {
    if (typeof SecurityProfile !== 'undefined') SecurityProfile.init();
    if (typeof SecureStorage !== 'undefined') SecureStorage.init();
    if (typeof SecurityTelemetry !== 'undefined') SecurityTelemetry.init();
    if (typeof DeviceSecurity !== 'undefined') await DeviceSecurity.init();
    if (typeof RuntimeIntegrity !== 'undefined') await RuntimeIntegrity.init();
    if (typeof MobileHardening !== 'undefined') MobileHardening.init();
    if (typeof MobileHardening !== 'undefined') MobileHardening.requestSecureScreen();
    if (typeof PlanAIBranding !== 'undefined') PlanAIBranding.init();
    document.body?.classList.add('planai-security-ready');
  }

  function compositeRiskScore() {
    let s = 0;
    if (typeof DeviceSecurity !== 'undefined') s += DeviceSecurity.getSnapshot()?.score || 0;
    if (typeof RuntimeIntegrity !== 'undefined' && RuntimeIntegrity.isFailed()) s += 25;
    return Math.min(100, s);
  }

  function isSecureModeActive() {
    if (typeof DeviceSecurity !== 'undefined' && DeviceSecurity.isSecureModeActive()) return true;
    if (typeof RuntimeIntegrity !== 'undefined' && RuntimeIntegrity.isFailed()) return true;
    if (typeof SecurityProfile !== 'undefined' && SecurityProfile.current() === 'SECURE') return true;
    return false;
  }

  function blocksSensitiveExport() {
    if (typeof SecurityProfile !== 'undefined' && SecurityProfile.blocksExport()) return true;
    if (typeof DeviceSecurity !== 'undefined' && DeviceSecurity.blocksSensitiveExport()) return true;
    if (typeof RuntimeIntegrity !== 'undefined' && RuntimeIntegrity.isFailed()) return true;
    return false;
  }

  function blocksPlanOverlayImport() {
    if (typeof SecurityProfile !== 'undefined' && SecurityProfile.blocksPlanOverlay()) return true;
    if (typeof DeviceSecurity !== 'undefined' && DeviceSecurity.blocksPlanOverlayImport()) return true;
    return false;
  }

  function reportWatermarkHtml() {
    let html = '';
    if (typeof DeviceSecurity !== 'undefined') html += DeviceSecurity.reportWatermarkHtml();
    if (typeof SecurityProfile !== 'undefined' && SecurityProfile.requiresWatermark() && !html) {
      html = '<div class="device-secure-watermark" style="margin:8px 0;padding:8px 12px;border:1px dashed #1a3358;background:#eef2f7;color:#1a3358;font-size:11px;border-radius:6px;">'
        + 'PlanAI Field — ' + SecurityProfile.current() + ' tier report.'
        + '</div>';
    }
    return html;
  }

  function exportBlockedMessage() {
    if (typeof DeviceSecurity !== 'undefined') return DeviceSecurity.exportBlockedMessage();
    return 'Güvenlik modu: dışa aktarma kısıtlı.';
  }

  function sanitizeExportHtml(html) {
    if (typeof ContentSanitizer !== 'undefined') return ContentSanitizer.sanitizePdfHtml(html);
    if (typeof SpatialSecurity !== 'undefined') return SpatialSecurity.sanitizePdfHtml(html);
    return html;
  }

  function recordThreat(type, detail) {
    if (typeof SecurityTelemetry !== 'undefined') SecurityTelemetry.record(type, detail);
  }

  const PRODUCTION = document.body?.classList?.contains('walk-production') || false;
  if (!PRODUCTION) {
    window.getSecurityRiskLevel = () => (typeof DeviceSecurity !== 'undefined' ? DeviceSecurity.getSecurityRiskLevel() : 'none');
    window.isCompromisedDevice = () => isSecureModeActive();
    window.enableSecureMode = (r) => (typeof DeviceSecurity !== 'undefined' ? DeviceSecurity.enableSecureMode(r) : false);
  }

  return {
    init,
    compositeRiskScore,
    isSecureModeActive,
    blocksSensitiveExport,
    blocksPlanOverlayImport,
    reportWatermarkHtml,
    exportBlockedMessage,
    sanitizeExportHtml,
    recordThreat,
  };
})();
