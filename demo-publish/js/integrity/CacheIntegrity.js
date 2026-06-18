'use strict';
/**
 * PlanAI Field™ — offline cache integrity checks.
 * Developed by PiriStrategy. © Taner Piri / PiriStrategy. All rights reserved.
 */
const CacheIntegrity = (function () {
  const MAX_CACHE_MB = 512;
  const KEY = 'planai_cache_integrity';

  function fingerprint(obj) {
    try {
      return String(JSON.stringify(obj)).length + '|' + Object.keys(obj || {}).length;
    } catch (_) {
      return '0|0';
    }
  }

  function assertSize(bytes) {
    if (bytes > MAX_CACHE_MB * 1024 * 1024) {
      const err = new Error('CACHE_SIZE_EXCEEDED');
      err.cacheIntegrity = 'CACHE_SIZE_EXCEEDED';
      throw err;
    }
  }

  function seal(label, payload) {
    try {
      const meta = JSON.parse(localStorage.getItem(KEY) || '{}');
      meta[label] = { fp: fingerprint(payload), at: Date.now() };
      localStorage.setItem(KEY, JSON.stringify(meta));
    } catch (_) {}
  }

  function verify(label, payload) {
    try {
      const meta = JSON.parse(localStorage.getItem(KEY) || '{}');
      const prev = meta[label];
      if (!prev) return true;
      return prev.fp === fingerprint(payload);
    } catch (_) {
      return true;
    }
  }

  return { assertSize, seal, verify, MAX_CACHE_MB };
})();
