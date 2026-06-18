'use strict';
/**
 * PlanAI Field™ — content sanitization for field notes and exports.
 * Developed by PiriStrategy. © Taner Piri / PiriStrategy. All rights reserved.
 */
const ContentSanitizer = (function () {
  const MAX_FIELD_NOTE = 8000;
  const MAX_PDF_HTML = 512 * 1024;
  const SCRIPTISH = /<script|on\w+\s*=|javascript:|data:text\/html|<iframe|<object|<embed|<svg[\s\S]*?onload/i;

  function stripHtml(s) {
    return String(s ?? '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '');
  }

  function sanitizeFieldNoteText(text) {
    let s = stripHtml(text).slice(0, MAX_FIELD_NOTE);
    s = s.replace(/javascript:/gi, '').replace(/data:/gi, '');
    return s.trim();
  }

  function sanitizePdfHtml(html) {
    let s = String(html ?? '');
    s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
    s = s.replace(/<svg[\s\S]*?<\/svg>/gi, '');
    s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    s = s.replace(/javascript:/gi, '');
    s = s.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
    return s.slice(0, MAX_PDF_HTML);
  }

  function sanitizeProperties(props) {
    if (!props || typeof props !== 'object' || Array.isArray(props)) return {};
    const out = {};
    const keys = Object.keys(props).slice(0, 128);
    for (const k of keys) {
      const key = String(k).slice(0, 128);
      if (/^[@$]|^__proto__|^constructor$|^prototype$/i.test(key)) continue;
      let v = props[k];
      if (v == null) { out[key] = v; continue; }
      if (typeof v === 'object') {
        try { v = JSON.stringify(v); } catch (_) { continue; }
      }
      v = String(v).slice(0, 4096);
      if (SCRIPTISH.test(v)) v = stripHtml(v).slice(0, 512);
      out[key] = v;
    }
    return out;
  }

  function exportIntegrityMeta(projectName) {
    if (typeof PlanAIBranding !== 'undefined') return PlanAIBranding.exportIntegrityMeta(projectName);
    const ts = new Date().toISOString();
    return { exportedAt: ts, integrityHint: ts.slice(0, 48), generator: 'PlanAI Field Secure Export' };
  }

  return {
    sanitizeFieldNoteText,
    sanitizePdfHtml,
    sanitizeProperties,
    exportIntegrityMeta,
    stripHtml,
  };
})();
