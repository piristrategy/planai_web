'use strict';
/**
 * CSB plan GML CRS çözümleyici — yalnızca dosya içi sinyaller + koordinatlar.
 * srsName / SembolPoz sık hatalı; dosya adı kullanılmaz.
 */
(function (global) {
  const TM_CMS = [27, 30, 33, 36, 39, 42, 45];

  /** Yedek E+N bantları (LUT eşleşmezse) */
  const CSB_TUREF_EN_BANDS = [
    [4020000, 4140000, 560000, 720000, 7930],
    [4040000, 4180000, 430000, 560000, 7931],
    [4080000, 4220000, 320000, 480000, 7931],
    [4120000, 4285000, 460000, 660000, 7932],
    [4280000, 4460000, 480000, 650000, 7932],
    [4200000, 4480000, 220000, 300000, 7933],
    [4280000, 4520000, 120000, 280000, 7934],
    [4430000, 4565000, 250000, 420000, 7936],
    [4350000, 4580000, 40000, 200000, 7935],
    [4340000, 4415000, 370000, 490000, 7930],
    [4360000, 4410000, 470000, 560000, 7931],
    [4090000, 4145000, 450000, 540000, 7934],
    [4190000, 4360000, 370000, 515000, 7930],
    [4190000, 4360000, 515000, 620000, 7931],
    [4360000, 4550000, 60000, 180000, 7936],
  ];

  let _enZoneLut = null;

  function epsg793ToCm(epsg) {
    if (epsg >= 7930 && epsg <= 7936) return 27 + (epsg - 7930) * 3;
    if (epsg >= 5253 && epsg <= 5259) return 27 + (epsg - 5253) * 3;
    if (epsg >= 2319 && epsg <= 2325) return 27 + (epsg - 2319) * 3;
    return null;
  }

  function cmToEpsg793(cm) {
    const hit = TM_CMS.indexOf(cm);
    return hit >= 0 ? 7930 + hit : null;
  }

  function cmToEd50Tm(cm) {
    const hit = TM_CMS.indexOf(cm);
    return hit >= 0 ? 2319 + hit : null;
  }

  function officialEpsg793ForLon(lon) {
    let best = 7930;
    let bestD = Infinity;
    for (let i = 0; i <= 6; i++) {
      const cm = TM_CMS[i];
      const d = Math.abs(lon - cm);
      if (d < bestD) { bestD = d; best = 7930 + i; }
    }
    return best;
  }

  /** Türkiye ızgarası → (E,N) kutusu hangi TM diliminde üretilmiş olmalı */
  function ensureEnZoneLut() {
    if (_enZoneLut) return _enZoneLut;
    const proj = (typeof proj4 !== 'undefined') ? proj4 : null;
    if (!proj || typeof TurkeyCrs === 'undefined') {
      _enZoneLut = new Map();
      return _enZoneLut;
    }
    TurkeyCrs.ensureProjDefs(proj);
    const lut = new Map();
    for (let lat = 35.6; lat <= 42.1; lat += 0.15) {
      for (let lon = 25.8; lon <= 44.9; lon += 0.15) {
        const epsg = officialEpsg793ForLon(lon);
        const code = 'EPSG:' + epsg;
        if (!proj.defs[code]) continue;
        try {
          const fwd = proj('EPSG:4326', code, [lon, lat]);
          const key = `${Math.round(fwd[0] / 25000)},${Math.round(fwd[1] / 25000)}`;
          const bucket = lut.get(key) || {};
          bucket[epsg] = (bucket[epsg] || 0) + 1;
          lut.set(key, bucket);
        } catch (_) { /* skip */ }
      }
    }
    _enZoneLut = lut;
    return _enZoneLut;
  }

  function inferEpsg793FromGrid(avgE, avgN) {
    const lut = ensureEnZoneLut();
    const eBin = Math.round(avgE / 25000);
    const nBin = Math.round(avgN / 25000);
    const votes = {};
    for (let de = -1; de <= 1; de++) {
      for (let dn = -1; dn <= 1; dn++) {
        const bucket = lut.get(`${eBin + de},${nBin + dn}`);
        if (!bucket) continue;
        for (const [code, count] of Object.entries(bucket)) {
          const c = +code;
          votes[c] = (votes[c] || 0) + count;
        }
      }
    }
    return topVote(votes);
  }

  function isTuref793(epsg) {
    return epsg >= 7930 && epsg <= 7936;
  }

  function isEd50Tm(epsg) {
    return epsg >= 2319 && epsg <= 2325;
  }

  function isWgs84UtmTrEpsg(epsg) {
    return epsg >= 32635 && epsg <= 32638;
  }

  function isEd50UtmTrEpsg(epsg) {
    return (epsg >= 23030 && epsg <= 23039)
      || (epsg >= 23035 && epsg <= 23039)
      || (epsg >= 2326 && epsg <= 2329);
  }

  function isInTurkeyBbox(lat, lon) {
    return isFinite(lat) && isFinite(lon) && lat >= 35 && lat <= 43 && lon >= 25 && lon <= 45;
  }

  function topVote(votes) {
    let best = null;
    let n = 0;
    for (const [code, count] of Object.entries(votes || {})) {
      if (count > n) { n = count; best = +code; }
    }
    return best;
  }

  /** Dosya içi CRS ipuçları: SembolPoz, geometri srsName oylaması */
  function parseGmlInternalCrsHints(gmlText, geometrySrsVotes) {
    const hints = {
      sembolVotes: {},
      sembolEpsg: null,
      geometryVotes: geometrySrsVotes || {},
      geometryEpsg: topVote(geometrySrsVotes),
      sembolPoints: [],
    };
    if (!gmlText) return hints;

    const epsgRe = /SembolPoz[^<]*E(793[0-6]|525[3-9]|23(?:1[9]|2[0-5]))/gi;
    let m;
    while ((m = epsgRe.exec(gmlText))) {
      const code = +m[1];
      hints.sembolVotes[code] = (hints.sembolVotes[code] || 0) + 1;
    }
    hints.sembolEpsg = topVote(hints.sembolVotes);

    const xyRe = /SembolPoz[^<]*X([0-9.]+),Y([0-9.]+)[^<]*E(793[0-6])/gi;
    while ((m = xyRe.exec(gmlText))) {
      hints.sembolPoints.push({
        x: +m[1], y: +m[2], epsg: +m[3],
      });
    }

    return hints;
  }

  function parseSembolPozEpsg(gmlText) {
    return parseGmlInternalCrsHints(gmlText, null).sembolEpsg;
  }

  function avgEN(samples) {
    const avgE = samples.reduce((s, p) => s + p.e, 0) / samples.length;
    const avgN = samples.reduce((s, p) => s + p.n, 0) / samples.length;
    return { avgE, avgN };
  }

  function inferEpsg793FromEN(avgE, avgN) {
    let best = null;
    let bestScore = -Infinity;
    for (const [minN, maxN, minE, maxE, epsg] of CSB_TUREF_EN_BANDS) {
      if (avgN < minN || avgN > maxN || avgE < minE || avgE > maxE) continue;
      const cx = (minE + maxE) / 2;
      const cy = (minN + maxN) / 2;
      const score = 1e9 - Math.hypot((avgE - cx) * 0.4, avgN - cy);
      if (score > bestScore) { bestScore = score; best = epsg; }
    }
    if (best != null) return best;
    return inferEpsg793FromGrid(avgE, avgN);
  }

  function validateEpsg(samples, epsg) {
    if (!epsg || typeof TurkeyCrs === 'undefined') return false;
    let ok = 0;
    for (const { e, n } of samples) {
      const g = TurkeyCrs.reprojectToWgs84(e, n, epsg);
      if (g && isInTurkeyBbox(g.lat, g.lon)) ok++;
    }
    return ok >= Math.ceil(samples.length * 0.5);
  }

  function isTrustedUtmTaggedEpsg(epsg, samples) {
    if (!epsg || !samples?.length) return false;
    if (!isWgs84UtmTrEpsg(epsg) && !isEd50UtmTrEpsg(epsg)) return false;
    return validateEpsg(samples, epsg);
  }

  function pickFamily(taggedEpsg, sembolEpsg) {
    const tag = taggedEpsg || sembolEpsg;
    if (isEd50Tm(tag)) return 'ed50';
    if (isWgs84UtmTrEpsg(tag) || isEd50UtmTrEpsg(tag)) return 'utm';
    return 'turef';
  }

  function toFamilyEpsg(epsg793, family) {
    if (family === 'ed50') return cmToEd50Tm(epsg793ToCm(epsg793));
    return epsg793;
  }

  function centroidWgs84(samples, epsg) {
    let sumLat = 0;
    let sumLon = 0;
    let n = 0;
    for (const s of samples) {
      const g = TurkeyCrs.reprojectToWgs84(s.e, s.n, epsg);
      if (!g || !isInTurkeyBbox(g.lat, g.lon)) return null;
      sumLat += g.lat;
      sumLon += g.lon;
      n++;
    }
    if (!n) return null;
    return { lat: sumLat / n, lon: sumLon / n };
  }

  function sembolGeometryFit(samples, epsg, sembolPoints) {
    if (!sembolPoints?.length || !samples?.length) return 0;
    let err = 0;
    let n = 0;
    for (const sp of sembolPoints) {
      if (sp.epsg !== epsg && isTuref793(epsg) && isTuref793(sp.epsg)
        && epsg793ToCm(epsg) !== epsg793ToCm(sp.epsg)) continue;
      let bestD = Infinity;
      for (const s of samples) {
        const d = Math.hypot(s.e - sp.x, s.n - sp.y);
        if (d < bestD) bestD = d;
      }
      if (bestD < 800) { err += bestD; n++; }
    }
    return n > 0 ? 50000 - err : 0;
  }

  function listCandidateEpsgs(taggedEpsg, hints, family, samples) {
    const set = new Set();
    const tagged = taggedEpsg || hints?.geometryEpsg || hints?.sembolEpsg;

    if (tagged && isTrustedUtmTaggedEpsg(tagged, samples)) {
      return [tagged];
    }

    const taggedIsUtm = isWgs84UtmTrEpsg(tagged) || isEd50UtmTrEpsg(tagged);
    const taggedIsTm = isTuref793(tagged) || isEd50Tm(tagged)
      || (tagged >= 5253 && tagged <= 5259);

    if (!taggedIsUtm && family !== 'utm') {
      for (let i = 0; i <= 6; i++) {
        const fam = toFamilyEpsg(7930 + i, family === 'ed50' ? 'ed50' : 'turef');
        if (fam) set.add(fam);
      }
    }

    if (taggedIsUtm || family === 'utm') {
      for (let z = 32635; z <= 32638; z++) set.add(z);
      for (let z = 23035; z <= 23038; z++) set.add(z);
      for (let z = 2326; z <= 2329; z++) set.add(z);
    }

    if (tagged) set.add(tagged);
    if (hints?.sembolEpsg) set.add(hints.sembolEpsg);
    if (hints?.geometryEpsg) set.add(hints.geometryEpsg);
    for (const code of Object.keys(hints?.sembolVotes || {})) set.add(+code);
    for (const code of Object.keys(hints?.geometryVotes || {})) set.add(+code);

    return [...set].filter(e => e && isFinite(e));
  }

  function scoreCandidateEpsg(samples, epsg, ctx) {
    const { hints, gpsAnchor, tagged, avgE, avgN, family } = ctx;
    if (!centroidWgs84(samples, epsg)) return -Infinity;

    let score = 0;
    const enEpsg = inferEpsg793FromEN(avgE, avgN);
    const famEn = enEpsg ? toFamilyEpsg(enEpsg, family === 'ed50' ? 'ed50' : 'turef') : null;
    const bundledMeta = hints?.sembolEpsg != null
      && hints.sembolEpsg === hints?.geometryEpsg;
    const enDisagreesBundle = bundledMeta && enEpsg && isTuref793(hints.sembolEpsg)
      && epsg793ToCm(enEpsg) !== epsg793ToCm(hints.sembolEpsg);

    if (hints?.sembolEpsg === epsg) {
      score += enDisagreesBundle ? 15000 : 220000;
    } else if (hints?.sembolVotes?.[epsg]) {
      score += hints.sembolVotes[epsg] * 800;
    }
    if (enDisagreesBundle && epsg === hints.sembolEpsg) score -= 160000;

    if (famEn === epsg) score += 150000;
    else if (famEn && isTuref793(epsg) && isTuref793(famEn)
      && epsg793ToCm(epsg) !== epsg793ToCm(famEn)) score -= 90000;

    score += sembolGeometryFit(samples, epsg, hints?.sembolPoints);

    if (isWgs84UtmTrEpsg(epsg) && validateEpsg(samples, epsg)) {
      if (isWgs84UtmTrEpsg(tagged) || isWgs84UtmTrEpsg(hints?.geometryEpsg)) score += 200000;
    }
    if (isEd50UtmTrEpsg(epsg) && validateEpsg(samples, epsg)) {
      if (isEd50UtmTrEpsg(tagged) || isEd50UtmTrEpsg(hints?.geometryEpsg)) score += 200000;
    }

    if (isTuref793(tagged) || isEd50Tm(tagged)) {
      if (isTuref793(epsg) || isEd50Tm(epsg)) score += 15000;
      if (isWgs84UtmTrEpsg(epsg) || isEd50UtmTrEpsg(epsg)) score -= 200000;
    }

    if (epsg === hints?.geometryEpsg) score += 8000;
    if (epsg === tagged) {
      if (hints?.sembolEpsg && hints.sembolEpsg !== tagged) score -= 50000;
      else if (famEn && famEn !== tagged) score -= 40000;
      else score += 12000;
    }

    if (isEd50Tm(epsg) && (tagged === epsg || hints?.geometryEpsg === epsg)
        && validateEpsg(samples, epsg)) {
      score += 150000;
    }

    if (gpsAnchor && isInTurkeyBbox(gpsAnchor.lat, gpsAnchor.lon)) {
      const c = centroidWgs84(samples, epsg);
      const dlat = c.lat - gpsAnchor.lat;
      const dlon = c.lon - gpsAnchor.lon;
      score -= (dlat * dlat + dlon * dlon) * 1.5e6;
    }

    return score;
  }

  /**
   * @param {Array<{e:number,n:number}>} samples
   * @param {number|null} taggedEpsg — ilk geometri srsName (zayıf sinyal)
   * @param {string} gmlText — tüm dosya metni (SembolPoz vb.)
   * @param {{lat:number,lon:number}|null} gpsAnchor — yalnızca cihaz GPS
   * @param {Object<number,number>} geometrySrsVotes — tüm geometrilerdeki srsName oyları
   */
  function resolvePlanGmlEpsg(samples, taggedEpsg, gmlText, gpsAnchor, geometrySrsVotes) {
    if (!samples?.length) return taggedEpsg || null;

    const { avgE, avgN } = avgEN(samples);
    const hints = parseGmlInternalCrsHints(gmlText, geometrySrsVotes);
    const tagged = taggedEpsg || hints.geometryEpsg;
    const family = pickFamily(taggedEpsg, hints.sembolEpsg);

    if (isTrustedUtmTaggedEpsg(tagged, samples)) return tagged;

    const candidates = listCandidateEpsgs(taggedEpsg, hints, family, samples);
    const ctx = { hints, gpsAnchor, tagged, avgE, avgN, family };

    let bestEpsg = null;
    let bestScore = -Infinity;
    for (const epsg of candidates) {
      const s = scoreCandidateEpsg(samples, epsg, ctx);
      if (s > bestScore) {
        bestScore = s;
        bestEpsg = epsg;
      }
    }

    if (bestEpsg != null) return bestEpsg;
    if (hints.sembolEpsg && validateEpsg(samples, hints.sembolEpsg)) return hints.sembolEpsg;
    if (tagged && validateEpsg(samples, tagged)) return tagged;
    return cmToEpsg793(33);
  }

  function resolvePlanGmlCm(samples, taggedEpsg, gmlText, gpsAnchor, geometrySrsVotes) {
    const epsg = resolvePlanGmlEpsg(samples, taggedEpsg, gmlText, gpsAnchor, geometrySrsVotes);
    if (!epsg) return null;
    if (isTuref793(epsg)) return epsg793ToCm(epsg);
    if (isEd50Tm(epsg)) return epsg793ToCm(7930 + (epsg - 2319));
    return null;
  }

  global.PlanGmlCrs = {
    CSB_TUREF_EN_BANDS,
    parseGmlInternalCrsHints,
    parseSembolPozEpsg,
    inferEpsg793FromEN,
    inferEpsg793FromGrid,
    resolvePlanGmlEpsg,
    resolvePlanGmlCm,
    scoreCandidateEpsg,
    epsg793ToCm,
    cmToEpsg793,
    cmToEd50Tm,
  };
})(typeof self !== 'undefined' ? self : window);
