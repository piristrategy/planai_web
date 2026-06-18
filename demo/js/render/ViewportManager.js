'use strict';
/**
 * PlanAI Field™ — viewport manager (world-space culling).
 * Developed by PiriStrategy. © Taner Piri / PiriStrategy. All rights reserved.
 */
const ViewportManager = (function () {
  const MARGIN_RATIO = 0.06;

  function getWorldBounds(view) {
    if (!view || !view.scale || view.scale <= 0) return null;
    const minX = (0 - view.tx) / view.scale;
    const minY = (view.topBar - view.ty) / view.scale;
    const maxX = (view.cw - view.tx) / view.scale;
    const maxY = (view.mapBottom - view.ty) / view.scale;
    const mw = (maxX - minX) * MARGIN_RATIO;
    const mh = (maxY - minY) * MARGIN_RATIO;
    return {
      minX: minX - mw,
      minY: minY - mh,
      maxX: maxX + mw,
      maxY: maxY + mh,
    };
  }

  function aabbIntersects(a, b) {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
  }

  function expandAABB(box, x, y) {
    if (!box) return { minX: x, minY: y, maxX: x, maxY: y };
    box.minX = Math.min(box.minX, x);
    box.minY = Math.min(box.minY, y);
    box.maxX = Math.max(box.maxX, x);
    box.maxY = Math.max(box.maxY, y);
    return box;
  }

  function getObjectWorldAABB(obj, latLonToWorld) {
    if (!obj || obj.visible === false) return null;

    if (obj.type === 'import_polygon') {
      const ring = obj.rings && obj.rings[0];
      if (!ring || ring.length < 1) return null;
      let box = null;
      for (const c of ring) {
        if (c.lat == null || c.lon == null) continue;
        const w = latLonToWorld(c.lat, c.lon);
        box = expandAABB(box, w.x, w.y);
      }
      return box;
    }

    if (obj.type === 'import_polyline' || obj.type === 'field_gps_track') {
      const verts = obj.vertices || [];
      if (verts.length < 1) return null;
      let box = null;
      for (const v of verts) {
        if (v.lat != null && v.lon != null) {
          const w = latLonToWorld(v.lat, v.lon);
          box = expandAABB(box, w.x, w.y);
        } else if (v.x != null && v.y != null) {
          box = expandAABB(box, v.x, v.y);
        }
      }
      return box;
    }

    if (obj.type === 'import_point' || obj.type === 'import_text'
        || obj.type === 'field_note' || obj.type === 'field_photo') {
      if (obj.lat == null || obj.lon == null) return null;
      const w = latLonToWorld(obj.lat, obj.lon);
      const pad = 24;
      return { minX: w.x - pad, minY: w.y - pad, maxX: w.x + pad, maxY: w.y + pad };
    }

    if (obj.type === 'polygon' || obj.type === 'zone' || obj.type === 'freedraw') {
      const pts = obj.points;
      if (!pts || pts.length < 2) return null;
      let box = null;
      for (let i = 0; i < pts.length; i += 2) {
        box = expandAABB(box, pts[i], pts[i + 1]);
      }
      return box;
    }

    if (obj.type === 'polyline') {
      const verts = obj.vertices || [];
      if (!verts.length) return null;
      let box = null;
      for (const v of verts) {
        box = expandAABB(box, v.x, v.y);
      }
      return box;
    }

    if (obj.type === 'line' || obj.type === 'arrow') {
      const p = obj.points;
      if (!p || p.length < 4) return null;
      return {
        minX: Math.min(p[0], p[2]),
        minY: Math.min(p[1], p[3]),
        maxX: Math.max(p[0], p[2]),
        maxY: Math.max(p[1], p[3]),
      };
    }

    if (obj.type === 'circle' || obj.type === 'analysis_zone') {
      const r = obj.r || 0;
      return {
        minX: obj.cx - r,
        minY: obj.cy - r,
        maxX: obj.cx + r,
        maxY: obj.cy + r,
      };
    }

    if (obj.type === 'point') {
      const pad = 12;
      return {
        minX: obj.x - pad, minY: obj.y - pad,
        maxX: obj.x + pad, maxY: obj.y + pad,
      };
    }

    if (obj.type === 'text') {
      const pad = 48;
      return {
        minX: obj.x - pad, minY: obj.y - pad,
        maxX: obj.x + pad, maxY: obj.y + pad,
      };
    }

    return null;
  }

  function isObjectVisible(obj, viewport, latLonToWorld) {
    if (!viewport) return true;
    const aabb = getObjectWorldAABB(obj, latLonToWorld);
    if (!aabb) return true;
    return aabbIntersects(aabb, viewport);
  }

  return {
    getWorldBounds,
    getObjectWorldAABB,
    isObjectVisible,
    aabbIntersects,
  };
})();
