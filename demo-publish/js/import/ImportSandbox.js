'use strict';
/**
 * PlanAI Field™ — import sandbox (worker-isolated pre-validation).
 * Developed by PiriStrategy. © Taner Piri / PiriStrategy. All rights reserved.
 */
const ImportSandbox = (function () {
  let _worker = null;
  let _seq = 0;
  const _pending = new Map();

  function workerUrl() {
    const scripts = document.querySelectorAll('script[src*="app.js"]');
    const base = scripts.length ? scripts[0].src.replace(/\/js\/app\.js.*$/, '') : '';
    return (base || '') + '/js/workers/spatial-import.worker.js';
  }

  function ensureWorker() {
    if (_worker) return _worker;
    try {
      _worker = new Worker(workerUrl());
      _worker.onmessage = (ev) => {
        const d = ev.data || {};
        const p = _pending.get(d.id);
        if (!p) return;
        _pending.delete(d.id);
        if (d.ok) p.resolve(d);
        else p.reject(Object.assign(new Error(d.error || 'WORKER_FAIL'), { spatialSecurity: d.error }));
      };
      _worker.onerror = () => { _worker = null; };
    } catch (_) {
      _worker = null;
    }
    return _worker;
  }

  function validateInWorker(type, text) {
    const w = ensureWorker();
    if (!w) return syncValidate(type, text);
    return new Promise((resolve, reject) => {
      const id = ++_seq;
      _pending.set(id, { resolve, reject });
      w.postMessage({ id, type, text });
      setTimeout(() => {
        if (_pending.has(id)) {
          _pending.delete(id);
          try { syncValidate(type, text); resolve({ ok: true, fallback: true }); } catch (e) { reject(e); }
        }
      }, 12000);
    });
  }

  function syncValidate(type, text) {
    const core = typeof SpatialLimitsCore !== 'undefined' ? SpatialLimitsCore : null;
    const sec = typeof SpatialSecurity !== 'undefined' ? SpatialSecurity : null;
    if (type === 'geojson') {
      const geo = sec ? sec.parseJsonSafe(text, 'GeoJSON') : JSON.parse(text);
      if (core) core.validateGeoJsonRoot(geo);
      else if (sec) sec.validateGeoJsonRoot(geo);
      return { ok: true };
    }
    if (type === 'kml') {
      if (core) core.assertKmlPreParse(text);
      else if (sec) sec.assertKmlPreParse(text);
      return { ok: true };
    }
    if (type === 'gml') {
      if (core) core.assertGmlPreParse(text);
      else if (sec) sec.assertGmlPreParse(text);
      return { ok: true };
    }
    throw new Error('IMPORT_UNKNOWN_TYPE');
  }

  async function validateFilePreParse(file, ext, text) {
    if (typeof SpatialSecurity !== 'undefined') SpatialSecurity.assertImportFile(file);
    const e = (ext || '').toLowerCase();
    try {
      if (e === 'geojson' || e === 'json') await validateInWorker('geojson', text);
      else if (e === 'kml') await validateInWorker('kml', text);
      else if (e === 'gml' || e === 'xml') await validateInWorker('gml', text);
    } catch (err) {
      if (typeof SecurityTelemetry !== 'undefined') SecurityTelemetry.record('import.blocked', { ext: e, code: err.spatialSecurity });
      throw err;
    }
    return true;
  }

  function terminate() {
    if (_worker) { _worker.terminate(); _worker = null; }
    _pending.clear();
  }

  return { validateInWorker, validateFilePreParse, syncValidate, terminate };
})();
