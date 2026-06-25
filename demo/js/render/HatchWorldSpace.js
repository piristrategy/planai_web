'use strict';
/**
 * PlanAI Field™ — world-space hatch rendering (CAD/GIS).
 * Developed by PiriStrategy. © Taner Piri / PiriStrategy. All rights reserved.
 */
const HatchWorldSpace = (function () {
  const TILE_PX = 64;
  const CACHE_MAX = 160;
  const _tileCache = new Map();

  function lodFromScreenPx(screenCell) {
    if (screenCell < 3.5) return 'skip';
    if (screenCell < 7) return 'coarse';
    if (screenCell < 12) return 'medium';
    return 'fine';
  }

  function snapOrigin(x, y, cell) {
    const c = Math.max(cell, 1e-6);
    return {
      x: Math.floor(x / c) * c,
      y: Math.floor(y / c) * c,
    };
  }

  function cacheGet(key) {
    return _tileCache.get(key) || null;
  }

  function cacheSet(key, entry) {
    if (_tileCache.size >= CACHE_MAX) {
      const first = _tileCache.keys().next().value;
      _tileCache.delete(first);
    }
    _tileCache.set(key, entry);
  }

  function drawStampOnTile(c, w, h, color, lod) {
    const simplified = lod === 'coarse';
    const cell = w;
    const circleR = cell * (6 / 18) * (simplified ? 0.9 : 1);
    const rowH = Math.round(cell * 0.866);
    c.clearRect(0, 0, w, h);
    c.fillStyle = color;
    c.strokeStyle = color;
    drawRingStampDots(c, cell / 2, cell / 2, circleR, simplified);
    drawRingStampDots(c, 0, rowH + cell / 2, circleR, simplified);
  }

  function drawRingStampDots(c, cx, cy, radius, simplified) {
    const dotR = Math.max(0.95, radius * 0.085);
    c.beginPath();
    c.arc(cx, cy, dotR * 1.05, 0, Math.PI * 2);
    c.fill();
    if (simplified) return;
    const ring1R = radius * 0.32;
    const ring1N = 8;
    for (let i = 0; i < ring1N; i++) {
      const a = (i / ring1N) * Math.PI * 2;
      c.beginPath();
      c.arc(cx + Math.cos(a) * ring1R, cy + Math.sin(a) * ring1R, dotR, 0, Math.PI * 2);
      c.fill();
    }
    const ring2R = radius * 0.52;
    for (let i = 0; i < ring1N; i++) {
      const a = (i / ring1N) * Math.PI * 2 + Math.PI / ring1N;
      c.beginPath();
      c.arc(cx + Math.cos(a) * ring2R, cy + Math.sin(a) * ring2R, dotR * 0.82, 0, Math.PI * 2);
      c.fill();
    }
    const ring3R = radius * 0.72;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
      c.beginPath();
      c.arc(cx + Math.cos(a) * ring3R, cy + Math.sin(a) * ring3R, dotR * 0.68, 0, Math.PI * 2);
      c.fill();
    }
  }

  function getStampTile(color, lod) {
    const key = 'stamp|' + color + '|' + lod;
    const hit = cacheGet(key);
    if (hit) return hit;
    const rowH = Math.round(TILE_PX * 0.866);
    const tileH = rowH * 2;
    const canvas = document.createElement('canvas');
    canvas.width = TILE_PX;
    canvas.height = tileH;
    drawStampOnTile(canvas.getContext('2d'), TILE_PX, tileH, color, lod);
    const entry = { canvas, tileW: TILE_PX, tileH, worldW: 1, worldH: tileH / TILE_PX };
    cacheSet(key, entry);
    return entry;
  }

  function drawStaggeredStippleOnTile(c, w, h, color, lod, dotRatio) {
    c.clearRect(0, 0, w, h);
    c.fillStyle = color;
    const dr = Math.max(0.04, Math.min(0.35, Number(dotRatio) || 0.167));
    const r = w * dr * (lod === 'coarse' ? 0.9 : lod === 'medium' ? 1 : 1.05);
    const rowH = Math.round(w * 0.866);
    const dot = (cx, cy) => {
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.fill();
    };
    dot(w / 2, w / 2);
    dot(0, rowH + w / 2);
  }

  function getStaggeredStippleTile(color, lod, dotRatio) {
    const dr = (Number(dotRatio) || 0.167).toFixed(3);
    const key = 'staggeredStipple|' + color + '|' + lod + '|' + dr;
    const hit = cacheGet(key);
    if (hit) return hit;
    const rowH = Math.round(TILE_PX * 0.866);
    const tileH = rowH * 2;
    const canvas = document.createElement('canvas');
    canvas.width = TILE_PX;
    canvas.height = tileH;
    drawStaggeredStippleOnTile(canvas.getContext('2d'), TILE_PX, tileH, color, lod, dotRatio);
    const entry = { canvas, tileW: TILE_PX, tileH, worldW: 1, worldH: tileH / TILE_PX };
    cacheSet(key, entry);
    return entry;
  }

  function drawParkDotsOnTile(c, w, h, color, lod) {
    c.clearRect(0, 0, w, h);
    c.fillStyle = color;
    const r = w * (lod === 'coarse' ? 0.055 : lod === 'medium' ? 0.065 : 0.07);
    const rowH = Math.round(w * 0.866);
    const dot = (cx, cy) => {
      c.beginPath();
      c.arc(cx, cy, r, 0, Math.PI * 2);
      c.fill();
    };
    dot(w / 2, w / 2);
    dot(0, rowH + w / 2);
  }

  function getParkDotsTile(color, lod) {
    const key = 'parkDots|circles|' + color + '|' + lod;
    const hit = cacheGet(key);
    if (hit) return hit;
    const rowH = Math.round(TILE_PX * 0.866);
    const tileH = rowH * 2;
    const canvas = document.createElement('canvas');
    canvas.width = TILE_PX;
    canvas.height = tileH;
    const c = canvas.getContext('2d');
    drawParkDotsOnTile(c, TILE_PX, tileH, color, lod);
    const entry = { canvas, tileW: TILE_PX, tileH, worldW: 1, worldH: tileH / TILE_PX };
    cacheSet(key, entry);
    return entry;
  }

  function getDotsTile(color, lod) {
    const key = 'dots|' + color + '|' + lod;
    const hit = cacheGet(key);
    if (hit) return hit;
    const canvas = document.createElement('canvas');
    canvas.width = TILE_PX;
    canvas.height = TILE_PX;
    const c = canvas.getContext('2d');
    c.clearRect(0, 0, TILE_PX, TILE_PX);
    c.fillStyle = color;
    const r = TILE_PX * (lod === 'coarse' ? 0.06 : 0.08);
    c.beginPath();
    c.arc(TILE_PX / 2, TILE_PX / 2, r, 0, Math.PI * 2);
    c.fill();
    cacheSet(key, { canvas, tileW: TILE_PX, tileH: TILE_PX, worldW: 1, worldH: 1 });
    return cacheGet(key);
  }

  /** Dünya uzayında pattern fill — origin snap + setTransform. */
  function fillWorldPattern(ctx, tileEntry, cellWorld, ox, oy, x0, y0, x1, y1) {
    const tw = tileEntry.tileW;
    const th = tileEntry.tileH;
    const worldW = cellWorld;
    const worldH = cellWorld * (th / tw);
    const pat = ctx.createPattern(tileEntry.canvas, 'repeat');
    if (!pat) return false;
    if (typeof pat.setTransform === 'function') {
      pat.setTransform(new DOMMatrix()
        .translate(ox, oy)
        .scale(worldW / tw, worldH / th));
    }
    ctx.fillStyle = pat;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    return true;
  }

  function fillRepeating(ctx, patternType, color, cellWorld, bounds, alpha, dotRatio) {
    const screenCell = cellWorld * (typeof S !== 'undefined' ? (S.scale || 1) : 1);
    let lod = lodFromScreenPx(screenCell);
    if (lod === 'skip') lod = 'coarse';

    const x0 = bounds.x0;
    const y0 = bounds.y0;
    const x1 = bounds.x1;
    const y1 = bounds.y1;
    const origin = snapOrigin(x0, y0, cellWorld);

    let tile;
    if (patternType === 'stamp') tile = getStampTile(color, lod);
    else if (patternType === 'parkDots') tile = getParkDotsTile(color, lod);
    else if (patternType === 'staggeredStipple') tile = getStaggeredStippleTile(color, lod, dotRatio);
    else if (patternType === 'dots') tile = getDotsTile(color, lod);
    else return false;

    const prevAlpha = ctx.globalAlpha;
    if (alpha != null) ctx.globalAlpha = alpha;
    const ok = fillWorldPattern(ctx, tile, cellWorld, origin.x, origin.y, x0, y0, x1, y1);
    ctx.globalAlpha = prevAlpha;
    return ok;
  }

  /** Çizgi tabanlı taramalar — dünya grid origin snap. */
  function forEachWorldGrid(x0, y0, x1, y1, cell, fn) {
    const o = snapOrigin(x0, y0, cell);
    for (let y = o.y; y < y1; y += cell) fn('h', y);
    for (let x = o.x; x < x1; x += cell) fn('v', x);
  }

  function forEachWorldDiagonal(x0, y0, x1, y1, cell, fn) {
    const h = y1 - y0;
    const o = snapOrigin(x0, y0, cell);
    for (let d = o.x - h; d < x1 + h; d += cell) fn(d);
  }

  function clearCache() {
    _tileCache.clear();
  }

  return {
    TILE_PX,
    lodFromScreenPx,
    snapOrigin,
    fillRepeating,
    forEachWorldGrid,
    forEachWorldDiagonal,
    clearCache,
  };
})();
