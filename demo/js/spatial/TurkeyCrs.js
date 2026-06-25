'use strict';
/**
 * PlanAI Field — Turkey national / cadastre / plan CRS (EPSG + proj4).
 * ED50 TM, ED50 UTM, TUREF TM, WGS84 UTM (Turkey bands).
 */
(function (global) {
  /** EPSG:2319–2325 — ED50 / TM27 … TM45 */
  const ED50_TM_ZONES = [
    [2319, 27], [2320, 30], [2321, 33], [2322, 36], [2323, 39], [2324, 42], [2325, 45],
  ];
  /** Official + alias ED50 UTM (Turkey) */
  const ED50_UTM_ZONES = [
    [23035, 35], [23036, 36], [23037, 37], [23038, 38], [23039, 39],
    [2326, 35], [2327, 36], [2328, 37], [2329, 38],
  ];
  const WGS84_UTM_TR = [
    [32635, 35], [32636, 36], [32637, 37], [32638, 38],
  ];
  const TUREF_TM_ZONES = [
    [5253, 27], [5254, 30], [5255, 33], [5256, 36], [5257, 39], [5258, 42], [5259, 45],
    [7930, 27], [7931, 30], [7932, 33], [7933, 36], [7934, 39], [7935, 42], [7936, 45],
  ];

  let _ready = false;

  function ed50TmProj4(cm) {
    return '+proj=tmerc +lat_0=0 +lon_0=' + cm + ' +k=1 +x_0=500000 +y_0=0 +ellps=intl +towgs84=-87,-98,-121,0,0,0,0 +units=m +no_defs';
  }

  function ed50UtmProj4(zone) {
    return '+proj=utm +zone=' + zone + ' +ellps=intl +towgs84=-87,-98,-121,0,0,0,0 +units=m +no_defs';
  }

  function turefTmProj4(cm) {
    return '+proj=tmerc +lat_0=0 +lon_0=' + cm + ' +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
  }

  function wgs84UtmProj4(zone) {
    return '+proj=utm +zone=' + zone + ' +datum=WGS84 +units=m +no_defs';
  }

  function ensureProjDefs(proj4) {
    if (_ready || !proj4 || typeof proj4.defs !== 'function') return;
    try {
      ED50_TM_ZONES.forEach(([code, cm]) => {
        const id = 'EPSG:' + code;
        if (!proj4.defs[id]) proj4.defs(id, ed50TmProj4(cm));
      });
      ED50_UTM_ZONES.forEach(([code, zone]) => {
        const id = 'EPSG:' + code;
        if (!proj4.defs[id]) proj4.defs(id, ed50UtmProj4(zone));
      });
      for (let epsg = 23030; epsg <= 23039; epsg++) {
        const id = 'EPSG:' + epsg;
        if (!proj4.defs[id]) proj4.defs(id, ed50UtmProj4(epsg - 23000));
      }
      TUREF_TM_ZONES.forEach(([code, cm]) => {
        const id = 'EPSG:' + code;
        if (!proj4.defs[id]) proj4.defs(id, turefTmProj4(cm));
      });
      WGS84_UTM_TR.forEach(([code, zone]) => {
        const id = 'EPSG:' + code;
        if (!proj4.defs[id]) proj4.defs(id, wgs84UtmProj4(zone));
      });
      if (!proj4.defs['EPSG:5252']) {
        proj4.defs('EPSG:5252', '+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs');
      }
      if (!proj4.defs['EPSG:3857']) {
        proj4.defs('EPSG:3857', '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs');
      }
      _ready = true;
    } catch (e) {
      console.warn('[TurkeyCrs] proj4 defs', e);
    }
  }

  function isEd50TmEpsg(epsg) {
    return epsg >= 2319 && epsg <= 2325;
  }

  function isCsbLegacyUtmEpsg(epsg) {
    return epsg >= 23030 && epsg <= 23039;
  }

  function isEd50UtmEpsg(epsg) {
    return isCsbLegacyUtmEpsg(epsg)
      || (epsg >= 23035 && epsg <= 23039)
      || (epsg >= 2326 && epsg <= 2329);
  }

  function isTurefTmEpsg(epsg) {
    return (epsg >= 5253 && epsg <= 5259) || (epsg >= 7930 && epsg <= 7936);
  }

  function isWgs84UtmTrEpsg(epsg) {
    return epsg >= 32635 && epsg <= 32638;
  }

  function isTurkeyProjectedEpsg(epsg) {
    if (!epsg || !isFinite(epsg)) return false;
    return isEd50TmEpsg(epsg) || isEd50UtmEpsg(epsg) || isTurefTmEpsg(epsg) || isWgs84UtmTrEpsg(epsg);
  }

  function ed50TmCmFromEpsg(epsg) {
    const hit = ED50_TM_ZONES.find(([code]) => code === epsg);
    return hit ? hit[1] : null;
  }

  function reprojectToWgs84(e, n, epsg) {
    const proj = typeof proj4 !== 'undefined' ? proj4 : null;
    if (!proj || !epsg) return null;
    ensureProjDefs(proj);
    try {
      const p = proj('EPSG:' + epsg, 'EPSG:4326', [e, n]);
      if (isFinite(p[0]) && isFinite(p[1])) return { lon: p[0], lat: p[1] };
    } catch (err) {
      console.warn('[TurkeyCrs] reproject EPSG:' + epsg, err);
    }
    return null;
  }

  function parseEpsgFromPrj(prjText) {
    if (!prjText) return null;
    const auth = prjText.match(/AUTHORITY\["EPSG","(\d+)"\]/i);
    if (auth) return +auth[1];
    if (/WGS[\s_]*84|EPSG["\s,]*4326/i.test(prjText)) return 4326;
    const ed50Tm = prjText.match(/ED50\s*\/\s*TM\s*(\d{2})/i);
    if (ed50Tm) {
      const cm = parseInt(ed50Tm[1], 10);
      const hit = ED50_TM_ZONES.find(([, c]) => c === cm);
      if (hit) return hit[0];
    }
    const utmZ = prjText.match(/UTM\s*zone\s*(\d{1,2})/i);
    if (utmZ && /ED50|European_Datum_1950/i.test(prjText)) {
      const z = parseInt(utmZ[1], 10);
      if (z >= 35 && z <= 39) return 23000 + z;
      if (z >= 35 && z <= 38) {
        const alt = ED50_UTM_ZONES.find(([, zone]) => zone === z);
        if (alt) return alt[0];
      }
    }
    if (/Turkey|TUREF|ITRF|GGRS|Turkiye/i.test(prjText)) {
      const cmM = prjText.match(/(?:lon_0|central_meridian)[=:\s]+(\d+)/i);
      if (cmM) {
        const cm = parseInt(cmM[1], 10);
        const hit = TUREF_TM_ZONES.find(([, c]) => c === cm);
        if (hit) return hit[0];
      }
      return 5254;
    }
    return null;
  }

  global.TurkeyCrs = {
    ED50_TM_ZONES,
    ED50_UTM_ZONES,
    TUREF_TM_ZONES,
    WGS84_UTM_TR,
    ensureProjDefs,
    isEd50TmEpsg,
    isEd50UtmEpsg,
    isCsbLegacyUtmEpsg,
    isTurefTmEpsg,
    isWgs84UtmTrEpsg,
    isTurkeyProjectedEpsg,
    ed50TmCmFromEpsg,
    reprojectToWgs84,
    parseEpsgFromPrj,
  };
})(typeof self !== 'undefined' ? self : window);
