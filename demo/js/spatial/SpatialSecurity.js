'use strict';
/**
 * PlanAI Field™ — GIS/spatial import security sandbox.
 * Developed by PiriStrategy. © Taner Piri / PiriStrategy. All rights reserved.
 */
const SpatialSecurity = (function () {
  const PRODUCTION = document.body?.classList?.contains('walk-production') || false;
  const _core = typeof SpatialLimitsCore !== 'undefined' ? SpatialLimitsCore : null;
  const _san = typeof ContentSanitizer !== 'undefined' ? ContentSanitizer : null;

  const LIMITS = _core ? Object.assign({}, _core.LIMITS, {
    MAX_FIELD_NOTE_LEN: 8000,
    MAX_EXIF_TAG_LEN: 512,
    MAX_GPS_TRACK_POINTS: 500000,
    MAX_DEM_TILE_CACHE: 120,
    MAX_DEM_FETCH_CONCURRENT: 4,
  }) : {
    MAX_IMPORT_FILE_BYTES: 80 * 1024 * 1024,
    MAX_TEXT_CHARS: 48 * 1024 * 1024,
    MAX_GEOJSON_FEATURES: 15000,
    MAX_KML_PLACEMARKS: 12000,
    MAX_GML_FEATURES: 12000,
    MAX_PLAN_GML_POLYGONS: 6000,
    MAX_RING_VERTICES: 8000,
    MAX_COORDS_PER_POSLIST: 65536,
    MAX_GEOMETRY_NESTING: 8,
    MAX_POLYGON_RINGS: 48,
    MAX_PROPERTY_KEYS: 128,
    MAX_PROPERTY_VALUE_LEN: 4096,
    MAX_METADATA_STRING_LEN: 8192,
    MAX_FIELD_NOTE_LEN: 8000,
    MAX_EXIF_TAG_LEN: 512,
    MAX_GPS_TRACK_POINTS: 500000,
    MAX_DEM_TILE_CACHE: 120,
    MAX_DEM_FETCH_CONCURRENT: 4,
    MAX_ZIP_ENTRIES: 1000,
    MAX_ZIP_UNCOMPRESSED: 500 * 1024 * 1024,
  };

  const ALLOWED_IMPORT_EXT = new Set([
    'geojson', 'json', 'kml', 'kmz', 'gml', 'xml', 'dxf', 'shp', 'dbf', 'shx', 'prj', 'zip',
    'tif', 'tiff', 'geotiff', 'png', 'jpg', 'jpeg', 'webp',
  ]);

  const DANGEROUS_XML = /<!(ENTITY|DOCTYPE)|<\?xml-stylesheet|javascript:|data:text\/html/i;
  const SCRIPTISH = /<script|on\w+\s*=|javascript:/i;

  let _demInflight = 0;

  function spatialDebugLog() {
    if (PRODUCTION) return;
    if (typeof console !== 'undefined' && console.debug) console.debug.apply(console, ['[SpatialSecurity]', ...arguments]);
  }

  function fail(code, detail) {
    const err = new Error(code + (detail ? ': ' + detail : ''));
    err.spatialSecurity = code;
    throw err;
  }

  function sanitizeFileName(name) {
    const base = String(name || 'import').split(/[/\\]/).pop() || 'import';
    return base.replace(/[^\w.\- ()\u00C0-\u024F\u0400-\u04FF]/g, '_').slice(0, 200);
  }

  function assertImportFile(file) {
    if (!file) fail('SPATIAL_EMPTY_FILE');
    const name = sanitizeFileName(file.name);
    const ext = (name.split('.').pop() || '').toLowerCase();
    if (!ALLOWED_IMPORT_EXT.has(ext)) fail('SPATIAL_UNSUPPORTED_EXT', ext);
    if (file.size > LIMITS.MAX_IMPORT_FILE_BYTES) {
      fail('SPATIAL_FILE_TOO_LARGE', Math.round(file.size / 1024 / 1024) + 'MB');
    }
    if (/\.\.|^\/|^[a-zA-Z]:\\/.test(String(file.name || ''))) fail('SPATIAL_PATH_TRAVERSAL');
    return { name, ext };
  }

  function recordThreat(type, detail) {
    if (typeof PlanAISecurity !== 'undefined') PlanAISecurity.recordThreat(type, detail);
    else if (typeof SecurityTelemetry !== 'undefined') SecurityTelemetry.record(type, detail);
  }

  function assertTextSize(text, label) {
    if (_core) return _core.assertTextSize(text, label);
    if (text == null) fail('SPATIAL_EMPTY_TEXT', label);
    if (text.length > LIMITS.MAX_TEXT_CHARS) {
      fail('SPATIAL_TEXT_TOO_LARGE', label + ' ' + Math.round(text.length / 1024 / 1024) + 'MB');
    }
  }

  function assertXmlSafe(text, label) {
    if (_core) return _core.assertXmlSafe(text, label);
    assertTextSize(text, label);
    if (DANGEROUS_XML.test(text.slice(0, 8192))) fail('SPATIAL_XML_ENTITY', label);
  }

  function parseJsonSafe(text, label) {
    assertTextSize(text, label);
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      fail('SPATIAL_JSON_INVALID', label);
    }
    if (!data || typeof data !== 'object') fail('SPATIAL_JSON_ROOT', label);
    return data;
  }

  function geometryDepth(geom, depth) {
    if (!geom || depth > LIMITS.MAX_GEOMETRY_NESTING) return depth;
    if (geom.type === 'GeometryCollection') {
      return Math.max(depth, ...(geom.geometries || []).map((g) => geometryDepth(g, depth + 1)));
    }
    const c = geom.coordinates;
    if (!c) return depth;
    const walk = (arr, d) => {
      if (!Array.isArray(arr)) return d;
      if (typeof arr[0] === 'number') return d;
      let max = d;
      for (let i = 0; i < arr.length; i++) max = Math.max(max, walk(arr[i], d + 1));
      return max;
    };
    return walk(c, depth + 1);
  }

  function validateGeoJsonRoot(geo) {
    try {
      if (_core) return _core.validateGeoJsonRoot(geo);
      const feats = geo.type === 'FeatureCollection' ? (geo.features || [])
        : geo.type === 'Feature' ? [geo]
          : [{ type: 'Feature', properties: {}, geometry: geo }];
      if (feats.length > LIMITS.MAX_GEOJSON_FEATURES) {
        fail('SPATIAL_TOO_MANY_FEATURES', String(feats.length));
      }
      for (let i = 0; i < Math.min(feats.length, 64); i++) {
        const g = feats[i]?.geometry;
        if (!g) continue;
        if (geometryDepth(g, 0) > LIMITS.MAX_GEOMETRY_NESTING) fail('SPATIAL_GEOM_DEPTH');
      }
      return feats;
    } catch (e) {
      recordThreat('spatial.geojson', e.spatialSecurity || e.message);
      throw e;
    }
  }

  function isFiniteCoord(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
    if (Math.abs(lat) < 1e-12 && Math.abs(lon) < 1e-12) return true;
    return true;
  }

  function clampRing(ring, maxVerts) {
    if (!ring || !ring.length) return ring;
    const cap = maxVerts || LIMITS.MAX_RING_VERTICES;
    if (ring.length <= cap) return ring;
    spatialDebugLog('ring clamped', ring.length, '→', cap);
    const step = Math.ceil(ring.length / cap);
    const out = [];
    for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
    if (out.length >= 3 && out[out.length - 1] !== out[0]) out.push(out[0]);
    return out.slice(0, cap);
  }

  function sanitizeProperties(props) {
    if (_san) return _san.sanitizeProperties(props);
    if (!props || typeof props !== 'object' || Array.isArray(props)) return {};
    const out = {};
    const keys = Object.keys(props).slice(0, LIMITS.MAX_PROPERTY_KEYS);
    for (const k of keys) {
      const key = String(k).slice(0, 128);
      if (/^[@$]|^__proto__|^constructor$|^prototype$/i.test(key)) continue;
      let v = props[k];
      if (v == null) { out[key] = v; continue; }
      if (typeof v === 'object') {
        try { v = JSON.stringify(v); } catch (_) { continue; }
      }
      v = String(v).slice(0, LIMITS.MAX_PROPERTY_VALUE_LEN);
      if (SCRIPTISH.test(v)) v = v.replace(/<[^>]+>/g, '').slice(0, 512);
      out[key] = v;
    }
    return out;
  }

  function sanitizeFieldNoteText(text) {
    if (_san) return _san.sanitizeFieldNoteText(text);
    let s = String(text ?? '').slice(0, LIMITS.MAX_FIELD_NOTE_LEN);
    s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
    s = s.replace(/<[^>]+>/g, '');
    s = s.replace(/javascript:/gi, '');
    return s.trim();
  }

  function sanitizePdfHtml(html) {
    if (_san) return _san.sanitizePdfHtml(html);
    let s = String(html ?? '');
    s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
    s = s.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
    s = s.replace(/javascript:/gi, '');
    return s.slice(0, 512 * 1024);
  }

  function validateExifGps(lat, lon, latRef, lonRef) {
    if (lat == null || lon == null) return null;
    const toDec = (d, m, s) => (Number(d) || 0) + (Number(m) || 0) / 60 + (Number(s) || 0) / 3600;
    let la = Array.isArray(lat) ? toDec(lat[0], lat[1], lat[2]) : Number(lat);
    let lo = Array.isArray(lon) ? toDec(lon[0], lon[1], lon[2]) : Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
    if (String(latRef || '').toUpperCase() === 'S') la = -la;
    if (String(lonRef || '').toUpperCase() === 'W') lo = -lo;
    if (!isFiniteCoord(la, lo)) return null;
    return { lat: la, lon: lo };
  }

  function assertGmlPreParse(text) {
    try {
      if (_core) return _core.assertGmlPreParse(text);
      assertXmlSafe(text, 'GML');
      if ((text.match(/<gml:Polygon|<gml:posList/gi) || []).length > LIMITS.MAX_GML_FEATURES * 2) {
        fail('SPATIAL_GML_TOO_MANY');
      }
    } catch (e) {
      recordThreat('spatial.gml', e.spatialSecurity || e.message);
      throw e;
    }
  }

  function assertKmlPreParse(text) {
    try {
      if (_core) return _core.assertKmlPreParse(text);
      assertXmlSafe(text, 'KML');
      const n = (text.match(/<Placemark[\s>]/gi) || []).length;
      if (n > LIMITS.MAX_KML_PLACEMARKS) fail('SPATIAL_KML_TOO_MANY', String(n));
    } catch (e) {
      recordThreat('spatial.kml', e.spatialSecurity || e.message);
      throw e;
    }
  }

  function assertCoordCount(nums, label) {
    if (!nums || nums.length > LIMITS.MAX_COORDS_PER_POSLIST) {
      fail('SPATIAL_COORD_OVERFLOW', label);
    }
  }

  function pruneMemoryCache(cacheObj, maxKeys) {
    const keys = Object.keys(cacheObj || {});
    while (keys.length > (maxKeys || LIMITS.MAX_DEM_TILE_CACHE)) {
      const k = keys.shift();
      delete cacheObj[k];
    }
  }

  async function acquireDemSlot() {
    while (_demInflight >= LIMITS.MAX_DEM_FETCH_CONCURRENT) {
      await new Promise((r) => setTimeout(r, 40));
    }
    _demInflight++;
  }

  function releaseDemSlot() {
    _demInflight = Math.max(0, _demInflight - 1);
  }

  function zipEntryUncompressedSize(entry) {
    if (!entry || entry.dir) return 0;
    if (typeof entry.uncompressedSize === 'number') return entry.uncompressedSize;
    if (entry._data && typeof entry._data.uncompressedSize === 'number') return entry._data.uncompressedSize;
    return 0;
  }

  function assertZipEntryPath(path) {
    const p = String(path || '');
    if (!p || p.includes('..') || /^[/\\]/.test(p) || /:[\\/]/.test(p)) {
      fail('SPATIAL_PATH_TRAVERSAL', p);
    }
  }

  /** Validate ZIP/KMZ archive before extracting entries (zip bomb / traversal). */
  function assertZipArchive(zip, label) {
    if (!zip || !zip.files) fail('SPATIAL_ZIP_INVALID', label);
    const paths = Object.keys(zip.files).filter((p) => !p.startsWith('__MACOSX'));
    if (paths.length > LIMITS.MAX_ZIP_ENTRIES) fail('SPATIAL_ZIP_ENTRIES', String(paths.length));
    let uncompressed = 0;
    for (const p of paths) {
      assertZipEntryPath(p);
      const entry = zip.files[p];
      if (entry?.dir) continue;
      uncompressed += zipEntryUncompressedSize(entry);
      if (uncompressed > LIMITS.MAX_ZIP_UNCOMPRESSED) fail('SPATIAL_ZIP_UNCOMPRESSED');
    }
  }

  async function loadZipFromFile(file, label) {
    assertImportFile(file);
    const buf = await file.arrayBuffer();
    if (typeof JSZip === 'undefined') fail('SPATIAL_ZIP_INVALID', 'JSZip');
    const zip = await JSZip.loadAsync(buf);
    assertZipArchive(zip, label || file.name);
    return zip;
  }

  function assertGpsTrackPointCount(n) {
    if (n > LIMITS.MAX_GPS_TRACK_POINTS) fail('SPATIAL_TRACK_TOO_LONG', String(n));
  }

  function validateCrsName(srs) {
    if (_core) return _core.validateCrsName(srs);
    if (!srs) return true;
    const s = String(srs).trim();
    return /^(EPSG:4326|EPSG:3857)$/i.test(s)
      || /EPSG:793[0-9]|EPSG:525[0-9]|EPSG:2303[0-9]|EPSG:23(1[9]|2[0-9])|EPSG:3263[5-8]/i.test(s)
      || /TUREF|ED50|GGRS/i.test(s)
      || /WGS\s*84|CRS84/i.test(s);
  }

  function assertCrsName(srs, label) {
    if (_core?.assertCrsName) return _core.assertCrsName(srs, label);
    if (!srs) return;
    if (!validateCrsName(srs)) fail('SPATIAL_CRS_UNSUPPORTED', label || srs);
  }

  function importErrorMessage(err) {
    const code = err?.spatialSecurity || '';
    const map = {
      SPATIAL_FILE_TOO_LARGE: 'Dosya çok büyük (maks. 80 MB)',
      SPATIAL_TEXT_TOO_LARGE: 'Metin içeriği çok büyük',
      SPATIAL_TOO_MANY_FEATURES: 'Çok fazla özellik — dosyayı bölün',
      SPATIAL_GML_TOO_MANY: 'GML: çok fazla geometri',
      SPATIAL_KML_TOO_MANY: 'KML: çok fazla Placemark',
      SPATIAL_XML_ENTITY: 'Güvenlik: geçersiz XML yapısı',
      SPATIAL_JSON_INVALID: 'GeoJSON ayrıştırılamadı',
      SPATIAL_UNSUPPORTED_EXT: 'Desteklenmeyen dosya türü',
      SPATIAL_PATH_TRAVERSAL: 'Geçersiz dosya adı',
      SPATIAL_COORD_OVERFLOW: 'Koordinat dizisi çok uzun',
      SPATIAL_GEOM_DEPTH: 'Geometri iç içe geçme sınırı aşıldı',
      SPATIAL_TRACK_TOO_LONG: 'GPS izi çok uzun',
      SPATIAL_ZIP_ENTRIES: 'Dataset exceeds safe import limits.',
      SPATIAL_ZIP_UNCOMPRESSED: 'Dataset exceeds safe import limits.',
      SPATIAL_ZIP_INVALID: 'Dataset exceeds safe import limits.',
      SPATIAL_CRS_UNSUPPORTED: 'Desteklenmeyen koordinat sistemi.',
    };
    return map[code] || null;
  }

  return {
    LIMITS,
    PRODUCTION,
    spatialDebugLog,
    sanitizeFileName,
    assertImportFile,
    assertTextSize,
    assertXmlSafe,
    parseJsonSafe,
    validateGeoJsonRoot,
    isFiniteCoord,
    clampRing,
    sanitizeProperties,
    sanitizeFieldNoteText,
    sanitizePdfHtml,
    validateExifGps,
    assertGmlPreParse,
    assertKmlPreParse,
    assertCoordCount,
    validateCrsName,
    assertCrsName,
    assertZipArchive,
    loadZipFromFile,
    assertZipEntryPath,
    pruneMemoryCache,
    acquireDemSlot,
    releaseDemSlot,
    assertGpsTrackPointCount,
    importErrorMessage,
  };
})();
