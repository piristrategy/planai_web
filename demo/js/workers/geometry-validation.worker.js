'use strict';
/**
 * PlanAI Field™ — geometry validation Web Worker.
 * Developed by PiriStrategy. © Taner Piri / PiriStrategy. All rights reserved.
 */
importScripts('../spatial/SpatialLimitsCore.js');

function isFiniteCoord(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
  return true;
}

function validateRing(ring) {
  if (!Array.isArray(ring)) throw Object.assign(new Error('SPATIAL_RING'), { spatialSecurity: 'SPATIAL_RING' });
  if (ring.length > SpatialLimitsCore.LIMITS.MAX_RING_VERTICES) {
    throw Object.assign(new Error('SPATIAL_RING_VERTS'), { spatialSecurity: 'SPATIAL_RING_VERTS' });
  }
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    if (!p || !isFiniteCoord(p.lat ?? p[1], p.lon ?? p[0])) {
      throw Object.assign(new Error('SPATIAL_COORD'), { spatialSecurity: 'SPATIAL_COORD' });
    }
  }
  return ring.length;
}

self.onmessage = function (ev) {
  const msg = ev.data || {};
  const id = msg.id;
  try {
    const rings = msg.rings || [];
    if (rings.length > SpatialLimitsCore.LIMITS.MAX_POLYGON_RINGS) {
      throw Object.assign(new Error('SPATIAL_RING_COUNT'), { spatialSecurity: 'SPATIAL_RING_COUNT' });
    }
    let verts = 0;
    for (let i = 0; i < rings.length; i++) verts += validateRing(rings[i]);
    self.postMessage({ id, ok: true, vertices: verts });
  } catch (e) {
    self.postMessage({ id, ok: false, error: e.spatialSecurity || e.message || 'GEOM_FAIL' });
  }
};
