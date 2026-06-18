'use strict';
/**
 * PlanAI Field — Smart Dataset Analyzer (performance & memory estimation).
 */
const DatasetAnalyzer = (function () {
  const DEVICE = { LOW: 'low', MID: 'mid', HIGH: 'high' };
  const RISK = { GREEN: 'green', YELLOW: 'yellow', ORANGE: 'orange', RED: 'red' };

  const MEMORY_BUDGET_MB = { low: 100, mid: 200, high: 350 };
  const RASTER_MAX_PX_DEFAULT = 2048;
  const RASTER_MAX_PX_OPTIMIZED = 1024;

  const LIMITS = {
    kml: { safe: 10, warn: 20, high: 50, critical: 50 },
    kmz: { safe: 8, warn: 15, high: 40, critical: 40 },
    gml: { safe: 3000, warn: 5000, high: 6000, critical: 6000, metric: 'polygons' },
    planGml: { safe: 3000, warn: 5000, high: 6000, critical: 6000, metric: 'polygons' },
    geojson: { safe: 5000, warn: 10000, high: 12000, critical: 15000, metric: 'features' },
    geotiff: { safe: 25, warn: 50, high: 100, critical: 100, metric: 'mb' },
    gps: { safe: 20000, warn: 50000, high: 100000, critical: 100000, metric: 'points' },
  };

  function detectDeviceClass() {
    const mem = typeof navigator !== 'undefined' && navigator.deviceMemory;
    if (typeof mem === 'number') {
      if (mem <= 4) return DEVICE.LOW;
      if (mem <= 6) return DEVICE.MID;
      return DEVICE.HIGH;
    }
    const cores = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 4) : 4;
    if (cores <= 4) return DEVICE.LOW;
    if (cores <= 6) return DEVICE.MID;
    return DEVICE.HIGH;
  }

  function formatBytes(n) {
    if (!n || n < 0) return '0 B';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
    return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  function normalizeFormat(ext, debug) {
    const f = (debug && debug.format) || '';
    if (f === 'plan-gml') return 'planGml';
    if (f === 'citygml' || f === 'gml') return 'gml';
    if (f === 'geojson') return 'geojson';
    if (f === 'shp') return 'geojson';
    if (f === 'dxf') return 'geojson';
    const e = (ext || '').toLowerCase();
    if (e === 'kmz') return 'kmz';
    if (e === 'kml') return 'kml';
    if (e === 'gml' || e === 'xml') return debug?.format === 'plan-gml' ? 'planGml' : 'gml';
    if (e === 'geojson' || e === 'json') return 'geojson';
    if (e === 'tif' || e === 'tiff' || e === 'geotiff') return 'geotiff';
    if (e === 'png' || e === 'jpg' || e === 'jpeg' || e === 'webp') return 'geotiff';
    return 'geojson';
  }

  function countObjectStats(objects) {
    const stats = {
      features: 0,
      polygons: 0,
      polylines: 0,
      points: 0,
      vertices: 0,
      rings: 0,
      hatchPolygons: 0,
      planGmlStyled: 0,
      layers: 0,
    };
    if (!objects || !objects.length) return stats;
    const layerSet = new Set();
    objects.forEach(o => {
      if (!o) return;
      stats.features++;
      if (o.layerId) layerSet.add(o.layerId);
      if (o.type === 'import_polygon') {
        stats.polygons++;
        const rings = o.rings || [];
        stats.rings += rings.length + (o.holes?.length || 0);
        rings.forEach(ring => { stats.vertices += (ring?.length || 0); });
        if (o.hatchPattern && o.hatchPattern !== 'none') stats.hatchPolygons++;
        if (o._planGmlStyled) stats.planGmlStyled++;
      } else if (o.type === 'import_polyline') {
        stats.polylines++;
        stats.vertices += (o.vertices?.length || 0);
      } else if (o.type === 'import_point' || o.type === 'import_text') {
        stats.points++;
        stats.vertices += 1;
      } else if (o.type === 'georef_image') {
        stats.features++;
      }
    });
    stats.layers = layerSet.size || (objects[0]?.layerId ? 1 : 0);
    return stats;
  }

  function analyzeKmlText(text) {
    const placemarks = (text.match(/<Placemark[\s>]/gi) || []).length;
    const coordTokens = (text.match(/<coordinates[\s>]/gi) || []).length;
    const icons = (text.match(/<Icon[\s>]/gi) || []).length;
    return { placemarks, coordBlocks: coordTokens, embeddedIcons: icons };
  }

  function tierFromLimits(value, limits, metricKey) {
    const v = value;
    if (v >= limits.critical) return RISK.RED;
    if (v >= limits.high) return RISK.ORANGE;
    if (v >= limits.warn) return RISK.YELLOW;
    if (v <= limits.safe) return RISK.GREEN;
    return RISK.YELLOW;
  }

  function tierFromSizeMB(mb, limits) {
    if (mb >= limits.critical) return RISK.RED;
    if (mb >= limits.high) return RISK.ORANGE;
    if (mb >= limits.warn) return RISK.YELLOW;
    return RISK.GREEN;
  }

  function worstRisk(a, b) {
    const order = [RISK.GREEN, RISK.YELLOW, RISK.ORANGE, RISK.RED];
    return order.indexOf(a) >= order.indexOf(b) ? a : b;
  }

  function complexityLabel(score) {
    if (score < 8000) return 'low';
    if (score < 35000) return 'medium';
    if (score < 90000) return 'high';
    return 'very_high';
  }

  function estimateMemory(ctx, stats, device) {
    const fileSize = ctx.file?.size || 0;
    const fmt = ctx.formatKey || 'geojson';
    const isXml = ['kml', 'kmz', 'gml', 'planGml'].includes(fmt);
    const isJson = fmt === 'geojson';
    const parseSpike = isXml ? fileSize * 2.4 : isJson ? fileSize * 1.7 : fileSize * 1.15;
    const objectMem = stats.features * 900 + stats.vertices * 48 + stats.polygons * 1400
      + stats.hatchPolygons * 2500;
    let rasterMem = 0;
    if (ctx.rasterMeta) {
      const w = ctx.rasterMeta.width || 0;
      const h = ctx.rasterMeta.height || 0;
      const outPx = Math.min(RASTER_MAX_PX_DEFAULT, Math.max(w, h));
      const decode = Math.min(w * h * (ctx.rasterMeta.bands || 3) * 4, outPx * outPx * 4);
      rasterMem = fileSize + decode + outPx * outPx * 0.5;
    }
    const peakBytes = parseSpike + objectMem + rasterMem;
    const steadyBytes = objectMem + rasterMem * 0.35;
    const budgetMb = MEMORY_BUDGET_MB[device] || MEMORY_BUDGET_MB.mid;
    const peakMb = peakBytes / (1024 * 1024);
    const steadyMb = steadyBytes / (1024 * 1024);
    let memRisk = RISK.GREEN;
    if (peakMb > budgetMb * 1.35) memRisk = RISK.RED;
    else if (peakMb > budgetMb * 1.05) memRisk = RISK.ORANGE;
    else if (peakMb > budgetMb * 0.75) memRisk = RISK.YELLOW;
    return {
      peakMb: Math.round(peakMb),
      steadyMb: Math.round(steadyMb),
      budgetMb,
      memRisk,
    };
  }

  function renderComplexityScore(stats) {
    return Math.round(
      stats.polygons * 12 + stats.polylines * 4 + stats.vertices * 0.15
      + stats.hatchPolygons * 55 + stats.planGmlStyled * 20,
    );
  }

  function computeFormatRisk(ctx, stats) {
    const fmt = ctx.formatKey;
    const mb = (ctx.file?.size || 0) / (1024 * 1024);
    let risk = RISK.GREEN;
    let detail = {};

    if (fmt === 'kml') {
      risk = tierFromSizeMB(mb, LIMITS.kml);
      const pm = ctx.kmlMeta?.placemarks ?? stats.features;
      if (pm > 8000) risk = worstRisk(risk, RISK.ORANGE);
      if (pm > 11000) risk = RISK.RED;
      detail = { placemarks: pm, coordBlocks: ctx.kmlMeta?.coordBlocks || 0, embeddedIcons: ctx.kmlMeta?.embeddedIcons || 0 };
    } else if (fmt === 'kmz') {
      risk = tierFromSizeMB(mb, LIMITS.kmz);
      if ((ctx.kmzMeta?.embeddedImages || 0) > 20) risk = worstRisk(risk, RISK.YELLOW);
      detail = ctx.kmzMeta || {};
    } else if (fmt === 'planGml' || fmt === 'gml') {
      const polys = stats.polygons;
      risk = tierFromLimits(polys, LIMITS[fmt === 'planGml' ? 'planGml' : 'gml']);
      detail = { parcels: polys, rings: stats.rings, hatchDensity: stats.hatchPolygons };
    } else if (fmt === 'geojson') {
      risk = tierFromLimits(stats.features, LIMITS.geojson);
    } else if (fmt === 'geotiff') {
      risk = tierFromSizeMB(mb, LIMITS.geotiff);
      if (ctx.rasterMeta?.width && ctx.rasterMeta?.height) {
        const mp = (ctx.rasterMeta.width * ctx.rasterMeta.height) / 1e6;
        if (mp > 80) risk = worstRisk(risk, RISK.ORANGE);
        if (mp > 200) risk = RISK.RED;
      }
      detail = ctx.rasterMeta || {};
    }
    return { risk, detail };
  }

  async function probeGeoTiff(file) {
    const meta = {
      width: 0,
      height: 0,
      bands: 3,
      fileSize: file?.size || 0,
      compression: 'unknown',
      isCog: false,
    };
    if (!file || typeof GeoTIFF === 'undefined') return meta;
    const tryParse = async (buf) => {
      const tiff = await GeoTIFF.fromArrayBuffer(buf);
      const image = await tiff.getImage();
      meta.width = image.getWidth();
      meta.height = image.getHeight();
      meta.bands = image.getSamplesPerPixel() || 3;
      const fd = image.getFileDirectory?.() || {};
      if (fd.Compression) meta.compression = String(fd.Compression);
      const name = (file.name || '').toLowerCase();
      meta.isCog = name.includes('cog') || !!fd.GDAL_METADATA;
    };
    try {
      const slice = await file.slice(0, Math.min(file.size, 2 * 1024 * 1024)).arrayBuffer();
      await tryParse(slice);
    } catch (_) {
      try {
        const buf = await file.arrayBuffer();
        await tryParse(buf);
      } catch (e2) {
        console.warn('[DatasetAnalyzer] GeoTIFF probe', e2);
      }
    }
    return meta;
  }

  function buildReport(ctx) {
    if (!ctx) return null;
    const device = detectDeviceClass();
    const formatKey = normalizeFormat(ctx.ext, ctx.debug);
    const stats = countObjectStats(ctx.objects || []);
    if (ctx.debug?.layers?.size) stats.layers = Math.max(stats.layers, ctx.debug.layers.size);

    const enriched = { ...ctx, formatKey };
    const mem = estimateMemory(enriched, stats, device);
    const fmtRisk = computeFormatRisk(enriched, stats);
    let risk = worstRisk(fmtRisk.risk, mem.memRisk);
    const renderScore = renderComplexityScore(stats);
    if (renderScore > 120000) risk = worstRisk(risk, RISK.RED);
    else if (renderScore > 60000) risk = worstRisk(risk, RISK.ORANGE);

    const deviceFactor = device === DEVICE.LOW ? 1 : device === DEVICE.MID ? 0 : -1;
    if (deviceFactor > 0 && risk === RISK.ORANGE) risk = RISK.RED;
    if (deviceFactor > 0 && risk === RISK.YELLOW && mem.peakMb > mem.budgetMb * 0.9) risk = RISK.ORANGE;

    const blockRender = risk === RISK.RED && (
      mem.peakMb > mem.budgetMb * 1.1
      || (formatKey === 'geotiff' && (ctx.file?.size || 0) > 80 * 1024 * 1024)
    );

    return {
      fileName: ctx.name || ctx.file?.name || 'import',
      fileSize: ctx.file?.size || 0,
      fileSizeLabel: formatBytes(ctx.file?.size || 0),
      formatKey,
      formatLabel: formatKey,
      device,
      stats,
      kmlMeta: ctx.kmlMeta,
      kmzMeta: ctx.kmzMeta,
      rasterMeta: ctx.rasterMeta,
      memory: mem,
      renderScore,
      complexity: complexityLabel(renderScore),
      risk,
      formatDetail: fmtRisk.detail,
      blockRender,
      recommendations: buildRecommendations(risk, formatKey, device, mem, stats),
    };
  }

  function buildRecommendations(risk, formatKey, device, mem, stats) {
    const rec = [];
    if (risk === RISK.GREEN) {
      rec.push('proceed_normal');
      return rec;
    }
    if (risk === RISK.YELLOW) rec.push('monitor_performance');
    if (risk === RISK.ORANGE || risk === RISK.RED) rec.push('optimized_mode');
    if (formatKey === 'planGml' || formatKey === 'gml') {
      if (stats.hatchPolygons > 500) rec.push('reduce_hatch');
      if (stats.polygons > 5000) rec.push('simplify_geometry');
    }
    if (formatKey === 'geotiff') {
      rec.push('reduce_resolution');
      if (mem.peakMb > mem.budgetMb) rec.push('cog_hint');
    }
    if (formatKey === 'kml' || formatKey === 'kmz') {
      if (stats.vertices > 150000) rec.push('simplify_geometry');
    }
    if (device === DEVICE.LOW && risk !== RISK.GREEN) rec.push('device_low');
    if (risk === RISK.RED) rec.push('cancel_or_optimize');
    return rec;
  }

  function simplifyLatLonRing(ring, maxPts) {
    if (!ring || ring.length <= maxPts) return ring;
    const step = Math.ceil(ring.length / maxPts);
    const out = [];
    for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
    if (out.length && out[out.length - 1] !== ring[ring.length - 1]) out.push(ring[ring.length - 1]);
    return out.slice(0, maxPts);
  }

  function applyOptimizedMode(objects, report) {
    if (!objects?.length) return;
    const maxRing = report?.formatKey === 'planGml' ? 28 : 36;
    const layerCounts = {};
    objects.forEach(o => {
      o._importOptimized = true;
      if (o.type === 'import_polygon') {
        if (o.hatchPattern && o.hatchPattern !== 'none') o._skipHatch = true;
        if (o.rings) {
          o.rings = o.rings.map(r => simplifyLatLonRing(r, maxRing));
        }
        if (o.holes) {
          o.holes = o.holes.map(r => simplifyLatLonRing(r, Math.min(maxRing, 16)));
        }
      } else if (o.type === 'import_polyline' && o.vertices) {
        o.vertices = simplifyLatLonRing(o.vertices, maxRing);
      }
      const lid = o.layerId || '_';
      layerCounts[lid] = (layerCounts[lid] || 0) + 1;
    });
    objects.forEach(o => {
      const lid = o.layerId || '_';
      if (layerCounts[lid] > 250) o._deferRender = true;
    });
    return objects;
  }

  function applyAggressiveSimplify(objects) {
    if (!objects?.length) return;
    const maxRing = 16;
    objects.forEach(o => {
      o._importOptimized = true;
      o._skipHatch = true;
      if (o.type === 'import_polygon' && o.rings) {
        o.rings = o.rings.map(r => simplifyLatLonRing(r, maxRing));
        o.holes = (o.holes || []).map(r => simplifyLatLonRing(r, 12));
      } else if (o.type === 'import_polyline' && o.vertices) {
        o.vertices = simplifyLatLonRing(o.vertices, maxRing);
      }
      o._deferRender = layerHeavy(o, objects);
    });
    return objects;
  }

  function layerHeavy(obj, objects) {
    const lid = obj.layerId;
    let n = 0;
    for (let i = 0; i < objects.length; i++) {
      if (objects[i].layerId === lid) n++;
      if (n > 200) return true;
    }
    return false;
  }

  function markDeferredLayersVisible(layers, objects) {
    if (!layers?.length || !objects?.length) return;
    const deferred = new Set();
    objects.forEach(o => { if (o._deferRender && o.layerId) deferred.add(o.layerId); });
    layers.forEach(l => {
      if (deferred.has(l.id)) {
        l.visible = false;
        l._deferredLoad = true;
      }
    });
  }

  return {
    DEVICE,
    RISK,
    RASTER_MAX_PX_DEFAULT,
    RASTER_MAX_PX_OPTIMIZED,
    detectDeviceClass,
    countObjectStats,
    analyzeKmlText,
    probeGeoTiff,
    buildReport,
    applyOptimizedMode,
    applyAggressiveSimplify,
    markDeferredLayersVisible,
    formatBytes,
  };
})();
