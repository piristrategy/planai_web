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

  /** MPYY ring_stamp — merkez + 3 halka (8 + 12 + 18 nokta), tek nokta çapı. */
  function drawRingStampDots(c, cx, cy, radius, simplified) {
    const dotR = Math.max(0.95, radius * 0.058);
    const rings = [
      { n: 8, r: 0.32, phase: 0 },
      { n: 12, r: 0.52, phase: Math.PI / 12 },
      { n: 18, r: 0.72, phase: Math.PI / 18 },
    ];
    c.beginPath();
    c.arc(cx, cy, dotR, 0, Math.PI * 2);
    c.fill();
    if (simplified) return;
    for (let ri = 0; ri < rings.length; ri++) {
      const ring = rings[ri];
      const rr = radius * ring.r;
      for (let i = 0; i < ring.n; i++) {
        const a = (i / ring.n) * Math.PI * 2 + ring.phase;
        c.beginPath();
        c.arc(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, dotR, 0, Math.PI * 2);
        c.fill();
      }
    }
  }

  function ringStampMetrics(cell, simplified) {
    const circleR = cell * (6 / 18) * (simplified ? 0.9 : 1);
    const dotR = Math.max(0.95, circleR * 0.058);
    const outer = circleR * 0.72 + dotR;
    const pad = Math.ceil(outer) + 2;
    const rowH = Math.round(cell * 0.866);
    return { circleR, pad, rowH, logicalH: rowH * 2 };
  }

  function dotGridMetrics(cell, lod, dotRatio) {
    const rowH = Math.round(cell * 0.866);
    let r;
    if (dotRatio != null) {
      const dr = Math.max(0.04, Math.min(0.35, Number(dotRatio) || 0.167));
      r = cell * dr * (lod === 'coarse' ? 0.9 : lod === 'medium' ? 1 : 1.05);
    } else {
      r = cell * (lod === 'coarse' ? 0.055 : lod === 'medium' ? 0.065 : 0.07);
    }
    return { r, pad: Math.ceil(r) + 2, rowH, logicalH: rowH * 2 };
  }

  function makeBleedTileEntry(canvas, cellPx, padPx, logicalH) {
    return {
      canvas,
      tileW: canvas.width,
      tileH: canvas.height,
      cellPx,
      padPx,
      logicalH,
      bleed: true,
      worldW: 1,
      worldH: logicalH / cellPx,
    };
  }

  function drawStampOnBleedCanvas(c, cell, color, lod) {
    const simplified = lod === 'coarse';
    const m = ringStampMetrics(cell, simplified);
    const w = cell + 2 * m.pad;
    const h = m.logicalH + 2 * m.pad;
    c.canvas.width = w;
    c.canvas.height = h;
    c.clearRect(0, 0, w, h);
    c.fillStyle = color;
    c.strokeStyle = color;
    const ox = m.pad;
    const oy = m.pad;
    drawRingStampDots(c, ox + cell / 2, oy + cell / 2, m.circleR, simplified);
    drawRingStampDots(c, ox, oy + m.rowH + cell / 2, m.circleR, simplified);
    return makeBleedTileEntry(c.canvas, cell, m.pad, m.logicalH);
  }

  function getStampTile(color, lod) {
    const key = 'stamp|81218p|' + color + '|' + lod;
    const hit = cacheGet(key);
    if (hit) return hit;
    const canvas = document.createElement('canvas');
    const entry = drawStampOnBleedCanvas(canvas.getContext('2d'), TILE_PX, color, lod);
    cacheSet(key, entry);
    return entry;
  }

  function drawParkDotsOnBleedCanvas(c, cell, color, lod) {
    const m = dotGridMetrics(cell, lod, null);
    const w = cell + 2 * m.pad;
    const h = m.logicalH + 2 * m.pad;
    c.canvas.width = w;
    c.canvas.height = h;
    c.clearRect(0, 0, w, h);
    c.fillStyle = color;
    const ox = m.pad;
    const oy = m.pad;
    const dot = (cx, cy) => {
      c.beginPath();
      c.arc(cx, cy, m.r, 0, Math.PI * 2);
      c.fill();
    };
    dot(ox + cell / 2, oy + cell / 2);
    dot(ox, oy + m.rowH + cell / 2);
    return makeBleedTileEntry(c.canvas, cell, m.pad, m.logicalH);
  }

  function getParkDotsTile(color, lod) {
    const key = 'parkDots|bleed|' + color + '|' + lod;
    const hit = cacheGet(key);
    if (hit) return hit;
    const canvas = document.createElement('canvas');
    const entry = drawParkDotsOnBleedCanvas(canvas.getContext('2d'), TILE_PX, color, lod);
    cacheSet(key, entry);
    return entry;
  }

  function drawStaggeredStippleOnBleedCanvas(c, cell, color, lod, dotRatio) {
    const m = dotGridMetrics(cell, lod, dotRatio);
    const w = cell + 2 * m.pad;
    const h = m.logicalH + 2 * m.pad;
    c.canvas.width = w;
    c.canvas.height = h;
    c.clearRect(0, 0, w, h);
    c.fillStyle = color;
    const ox = m.pad;
    const oy = m.pad;
    const dot = (cx, cy) => {
      c.beginPath();
      c.arc(cx, cy, m.r, 0, Math.PI * 2);
      c.fill();
    };
    dot(ox + cell / 2, oy + cell / 2);
    dot(ox, oy + m.rowH + cell / 2);
    return makeBleedTileEntry(c.canvas, cell, m.pad, m.logicalH);
  }

  function getStaggeredStippleTile(color, lod, dotRatio) {
    const dr = (Number(dotRatio) || 0.167).toFixed(3);
    const key = 'staggeredStipple|bleed|' + color + '|' + lod + '|' + dr;
    const hit = cacheGet(key);
    if (hit) return hit;
    const canvas = document.createElement('canvas');
    const entry = drawStaggeredStippleOnBleedCanvas(canvas.getContext('2d'), TILE_PX, color, lod, dotRatio);
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

  /** Bleed kenarlı döşeme — şaşırtmalı damgaların yarım kırpılmasını önler. */
  function fillBleedTiles(ctx, tileEntry, cellWorld, x0, y0, x1, y1) {
    const { canvas, cellPx, padPx, logicalH } = tileEntry;
    const worldH = cellWorld * (logicalH / cellPx);
    const o = snapOrigin(x0, y0, cellWorld);
    const oySnap = snapOrigin(x0, y0, worldH).y;
    const sx = cellWorld / cellPx;
    const sy = worldH / logicalH;
    const bw = canvas.width;
    const bh = canvas.height;
    const col0 = Math.floor((x0 - o.x) / cellWorld) - 1;
    const col1 = Math.ceil((x1 - o.x) / cellWorld) + 1;
    const row0 = Math.floor((y0 - oySnap) / worldH) - 1;
    const row1 = Math.ceil((y1 - oySnap) / worldH) + 1;
    for (let row = row0; row <= row1; row++) {
      for (let col = col0; col <= col1; col++) {
        const wx = o.x + col * cellWorld;
        const wy = oySnap + row * worldH;
        ctx.drawImage(canvas, 0, 0, bw, bh, wx - padPx * sx, wy - padPx * sy, bw * sx, bh * sy);
      }
    }
    return true;
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
    ctx.fillRect(x0, y0, x1 - x0, y1 - y1);
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

    let tile;
    if (patternType === 'stamp') tile = getStampTile(color, lod);
    else if (patternType === 'parkDots') tile = getParkDotsTile(color, lod);
    else if (patternType === 'staggeredStipple') tile = getStaggeredStippleTile(color, lod, dotRatio);
    else if (patternType === 'dots') tile = getDotsTile(color, lod);
    else return false;

    const prevAlpha = ctx.globalAlpha;
    if (alpha != null) ctx.globalAlpha = alpha;
    const ok = tile.bleed
      ? fillBleedTiles(ctx, tile, cellWorld, x0, y0, x1, y1)
      : fillWorldPattern(ctx, tile, cellWorld, snapOrigin(x0, y0, cellWorld).x, snapOrigin(x0, y0, cellWorld).y, x0, y0, x1, y1);
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
