'use strict';
/**
 * PlanAI Field™ — import sanitizer Web Worker.
 * Developed by PiriStrategy. © Taner Piri / PiriStrategy. All rights reserved.
 */
importScripts('../sanitize/ContentSanitizer.js');

self.onmessage = function (ev) {
  const msg = ev.data || {};
  const id = msg.id;
  try {
    const kind = msg.kind || 'properties';
    if (kind === 'properties') {
      self.postMessage({ id, ok: true, data: ContentSanitizer.sanitizeProperties(msg.data) });
    } else if (kind === 'note') {
      self.postMessage({ id, ok: true, data: ContentSanitizer.sanitizeFieldNoteText(msg.data) });
    } else if (kind === 'pdf') {
      self.postMessage({ id, ok: true, data: ContentSanitizer.sanitizePdfHtml(msg.data) });
    } else {
      self.postMessage({ id, ok: false, error: 'UNKNOWN_KIND' });
    }
  } catch (e) {
    self.postMessage({ id, ok: false, error: e.message || 'SANITIZE_FAIL' });
  }
};
