'use strict';
/**
 * PlanAI Field™ — spatial import Web Worker.
 * Developed by PiriStrategy. © Taner Piri / PiriStrategy. All rights reserved.
 */
importScripts('../spatial/SpatialLimitsCore.js');

self.onmessage = function (ev) {
  const msg = ev.data || {};
  const id = msg.id;
  try {
    const type = msg.type;
    const text = msg.text || '';
    if (type === 'geojson') {
      SpatialLimitsCore.assertTextSize(text, 'GeoJSON');
      const geo = JSON.parse(text);
      if (!geo || typeof geo !== 'object') throw Object.assign(new Error('SPATIAL_JSON_ROOT'), { spatialSecurity: 'SPATIAL_JSON_ROOT' });
      SpatialLimitsCore.validateGeoJsonRoot(geo);
      self.postMessage({ id, ok: true, complexity: SpatialLimitsCore.complexityScore(geo) });
    } else if (type === 'kml') {
      SpatialLimitsCore.assertKmlPreParse(text);
      self.postMessage({ id, ok: true });
    } else if (type === 'gml') {
      SpatialLimitsCore.assertGmlPreParse(text);
      self.postMessage({ id, ok: true });
    } else {
      self.postMessage({ id, ok: false, error: 'UNKNOWN_TYPE' });
    }
  } catch (e) {
    self.postMessage({ id, ok: false, error: e.spatialSecurity || e.message || 'PARSE_FAIL' });
  }
};
