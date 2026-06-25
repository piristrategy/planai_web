'use strict';
/**
 * PlanAI Field™ — shared spatial limits (main thread & Web Workers).
 * Developed by PiriStrategy. © Taner Piri / PiriStrategy. All rights reserved.
 */
(function (global) {
  const LIMITS = {
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
    MAX_COMPLEXITY_SCORE: 250000,
    MAX_ZIP_ENTRIES: 1000,
    MAX_ZIP_UNCOMPRESSED: 500 * 1024 * 1024,
  };

  const CRS_WHITELIST = [
    /^EPSG:4326$/i,
    /^EPSG:3857$/i,
    /^EPSG:5252$/i,
    /^urn:ogc:def:crs:EPSG::4326$/i,
    /^urn:ogc:def:crs:EPSG::3857$/i,
    /^EPSG:793[0-9]$/i,
    /^EPSG:525[0-9]$/i,
    /^EPSG:2303[0-9]$/i,
    /^EPSG:23(1[9]|2[0-5])$/i,
    /^EPSG:23(26|27|28|29)$/i,
    /^EPSG:3263[5-8]$/i,
    /^urn:ogc:def:crs:EPSG::(2319|23[12][0-9]|2303[0-9]|3263[5-8]|525[2-9]|793[0-6])$/i,
    /WGS\s*84/i,
    /CRS84/i,
    /TUREF/i,
    /Turkish\s*National\s*Reference/i,
    /ED50\s*\/?\s*TM\s*\d+/i,
    /ED50.*UTM/i,
    /GGRS\s*87/i,
    /ITRF\s*96/i,
  ];

  const DANGEROUS_XML = /<!(ENTITY|DOCTYPE)|<\?xml-stylesheet|javascript:|data:text\/html/i;

  function fail(code, detail) {
    const err = new Error(code + (detail ? ': ' + detail : ''));
    err.spatialSecurity = code;
    throw err;
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

  function countVertices(geom, n) {
    n = n || 0;
    if (!geom || !geom.coordinates) return n;
    const walk = (arr) => {
      if (!Array.isArray(arr)) return;
      if (typeof arr[0] === 'number') { n++; return; }
      for (let i = 0; i < arr.length; i++) walk(arr[i]);
    };
    walk(geom.coordinates);
    return n;
  }

  function complexityScore(geo) {
    const feats = geo.type === 'FeatureCollection' ? (geo.features || [])
      : geo.type === 'Feature' ? [geo] : [{ geometry: geo }];
    let verts = 0;
    for (let i = 0; i < feats.length; i++) {
      verts += countVertices(feats[i]?.geometry, 0);
    }
    return feats.length * 10 + verts;
  }

  function validateGeoJsonRoot(geo) {
    const feats = geo.type === 'FeatureCollection' ? (geo.features || [])
      : geo.type === 'Feature' ? [geo]
        : [{ type: 'Feature', properties: {}, geometry: geo }];
    if (feats.length > LIMITS.MAX_GEOJSON_FEATURES) fail('SPATIAL_TOO_MANY_FEATURES', String(feats.length));
    const score = complexityScore(geo);
    if (score > LIMITS.MAX_COMPLEXITY_SCORE) fail('SPATIAL_COMPLEXITY', String(score));
    for (let i = 0; i < Math.min(feats.length, 64); i++) {
      const g = feats[i]?.geometry;
      if (!g) continue;
      if (geometryDepth(g, 0) > LIMITS.MAX_GEOMETRY_NESTING) fail('SPATIAL_GEOM_DEPTH');
    }
    return feats;
  }

  function assertTextSize(text, label) {
    if (text == null) fail('SPATIAL_EMPTY_TEXT', label);
    if (text.length > LIMITS.MAX_TEXT_CHARS) fail('SPATIAL_TEXT_TOO_LARGE', label);
  }

  function assertXmlSafe(text, label) {
    assertTextSize(text, label);
    if (DANGEROUS_XML.test(text.slice(0, 8192))) fail('SPATIAL_XML_ENTITY', label);
  }

  function assertKmlPreParse(text) {
    assertXmlSafe(text, 'KML');
    const n = (text.match(/<Placemark[\s>]/gi) || []).length;
    if (n > LIMITS.MAX_KML_PLACEMARKS) fail('SPATIAL_KML_TOO_MANY', String(n));
  }

  function assertGmlPreParse(text) {
    assertXmlSafe(text, 'GML');
    if ((text.match(/<gml:Polygon|<gml:posList/gi) || []).length > LIMITS.MAX_GML_FEATURES * 2) {
      fail('SPATIAL_GML_TOO_MANY');
    }
  }

  function validateCrsName(srs) {
    if (!srs) return true;
    const s = String(srs).trim();
    return CRS_WHITELIST.some((re) => re.test(s));
  }

  function assertCrsName(srs, label) {
    if (!srs) return;
    if (!validateCrsName(srs)) fail('SPATIAL_CRS_UNSUPPORTED', label || srs);
  }

  global.SpatialLimitsCore = {
    LIMITS,
    CRS_WHITELIST,
    fail,
    validateGeoJsonRoot,
    assertTextSize,
    assertXmlSafe,
    assertKmlPreParse,
    assertGmlPreParse,
    validateCrsName,
    assertCrsName,
    complexityScore,
    geometryDepth,
  };
})(typeof self !== 'undefined' ? self : window);
