'use strict';
/**
 * PlanAI Field — safe HTML export embedding (pilot hardening).
 */
const ExportSafety = (function () {
  const EXPORT_CSP = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data: blob: https:",
    "connect-src https:",
    "font-src https: data:",
    "media-src data: blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  function safeJsonInHtml(obj) {
    return JSON.stringify(obj)
      .replace(/</g, '\\u003c')
      .replace(/>/g, '\\u003e')
      .replace(/&/g, '\\u0026')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');
  }

  function cspMetaTag() {
    return '<meta http-equiv="Content-Security-Policy" content="' + EXPORT_CSP + '"/>';
  }

  function jsonScriptBlock(id, obj) {
    return '<script type="application/json" id="' + id + '">' + safeJsonInHtml(obj) + '</script>';
  }

  function readJsonScriptBootstrap(varName, id) {
    return 'const ' + varName + '=JSON.parse(document.getElementById("' + id + '").textContent);';
  }

  function sanitizeExportImageUrl(url) {
    if (!url || typeof url !== 'string') return '';
    if (/^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(url)) return url;
    if (/^https:\/\//i.test(url)) return url.replace(/"/g, '');
    return '';
  }

  return {
    EXPORT_CSP,
    safeJsonInHtml,
    cspMetaTag,
    jsonScriptBlock,
    readJsonScriptBootstrap,
    sanitizeExportImageUrl,
  };
})();
