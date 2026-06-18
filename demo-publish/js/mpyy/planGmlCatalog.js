'use strict';
/**
 * PlanAI Field™ — MPYY catalog → PlanGML import styling.
 * Developed by PiriStrategy. © Taner Piri / PiriStrategy. All rights reserved.
 */
const MpyyPlanGmlCatalog = (function () {
  let bundle = null;
  let ready = false;
  const byKey = new Map();
  const boundaryByKey = new Map();

  const MPYY_SCALE_TO_PLAN = { 1000: 'UIP', 5000: 'NIP', 25000: 'NIP', 100000: 'CDP' };

  const TIP_ALIASES = {
    KonutAlani: 'YerlesikKonutAlani',
    EkoTurizmKirsalTurizmTesisAlani: 'EkoKirsalTurizmTesisAlani',
    KonaklamaTesisAlani: 'PansiyonAlani',
    EnerjiDagitimDepolama: 'TrafoAlani',
    GunesEnerjisiSantraliAlani: 'YenilenebilirEnerjiKaynaklarinaDayaliUretimTesisiAlani',
    GunesEnerjiSantraliAlani: 'YenilenebilirEnerjiKaynaklarinaDayaliUretimTesisiAlani',
  };

  const BOUNDARY_FEATURE_MAP = {
    PlanSiniri: 'PlanOnamaSiniri',
    PlanDegisiklikSiniri: 'PlanDegisikligiOnamaSiniri',
    YapiYaklasmaSiniri: 'YapiYaklasmaSiniri',
    AdaKenari: 'AdaKenari',
    YolCizgisi: 'YolCizgisi',
    MeclisKarariAlani: 'MeclisKarariAlani',
  };

  const RENDER_STYLE_HATCH = {
    ring_stamp: 'stamp',
    staggered_stipple: 'stamp',
    free_stipple: 'dots',
    karolaj_center_dots: 'parkDots',
    karolaj_hollow_dots: 'parkDots',
    karolaj_center_filled_dots: 'parkDots',
    karolaj_grid_hollow_dots: 'parkDots',
    karolaj_center_filled_triangles: 'parkDots',
    karolaj_center_hollow_triangles: 'parkDots',
    karolaj_center_plus: 'cross',
    karolaj_center_thorn: 'cross',
    karolaj_grid_lines: 'grid',
    diagonal_simple: 'diagonal',
    staggered_diagonal_dash: 'diagonal',
    diagonal_tick_hatch: 'diagonal',
    diagonal_triple_lines: 'density',
    diagonal_cross_hatch_pairs: 'cross',
    diagonal_cross_hatch_alternating: 'cross',
    diagonal_cross_per_angle: 'cross',
    orthogonal_cross: 'cross',
    perpendicular_cross_hatch_pairs: 'cross',
    horizontal_diagonal_cross: 'cross',
    horizontal_lines: 'horizontal',
    horizontal_double_pairs: 'horizontal',
    horizontal_triple_lines: 'horizontal',
    vertical_lines: 'vertical',
    vertical_double_hatch_pairs: 'vertical',
    vertical_double_pairs_diagonal_fill: 'cross',
    solid_fill: 'none',
    none: 'none',
    symbol_only: 'none',
  };

  function resolvePlanLevel(scale) {
    return MPYY_SCALE_TO_PLAN[scale] || 'UIP';
  }

  function normAscii(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/İ/g, 'I')
      .replace(/İ/g, 'I')
      .replace(/ı/g, 'i')
      .replace(/i̇/g, 'i')
      .trim();
  }

  function subClassToTipKey(sub) {
    const n = normAscii(sub)
      .replace(/[/\\|]+/g, ' ')
      .replace(/-/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const parts = n.split(' ').filter((w) => w && /^[a-z0-9]/i.test(w));
    if (!parts.length) return '';
    return parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
  }

  function hexToRgba(hex, a) {
    const h = String(hex || '#808080').replace('#', '');
    const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    if (n.length < 6) return `rgba(128,128,128,${a})`;
    const r = parseInt(n.slice(0, 2), 16);
    const g = parseInt(n.slice(2, 4), 16);
    const b = parseInt(n.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function put(map, key, rec) {
    if (!map.has(key)) map.set(key, rec);
  }

  function indexLanduseRecord(plan, rec) {
    const sub = rec.detailSubClass || rec.sketchLayerName || '';
    const tipKey = subClassToTipKey(sub);
    if (tipKey) put(byKey, `${plan}|tip:${tipKey}`, rec);
    if (rec.planGmlFeature) {
      if (tipKey) put(byKey, `${plan}|${rec.planGmlFeature}|${tipKey}`, rec);
      if (rec.planGmlTip) put(byKey, `${plan}|${rec.planGmlFeature}|${rec.planGmlTip}`, rec);
    }
  }

  function indexBoundaryRecord(plan, rec) {
    const sub = rec.detailSubClass || rec.sketchLayerName || '';
    const tipKey = subClassToTipKey(sub);
    if (tipKey) put(boundaryByKey, `${plan}|boundary:${tipKey}`, rec);
    if (rec.planGmlFeature) {
      put(boundaryByKey, `${plan}|boundaryFeature:${rec.planGmlFeature}`, rec);
    }
  }

  function buildIndex(b) {
    byKey.clear();
    boundaryByKey.clear();
    for (const [plan, slice] of Object.entries(b.byPlanLevel || {})) {
      (slice.landUses || []).forEach((rec) => indexLanduseRecord(plan, rec));
      (slice.boundaries || []).forEach((rec) => indexBoundaryRecord(plan, rec));
    }
    ready = true;
  }

  async function load() {
    try {
      const res = await fetch('mpyy/mpyy_catalog_bundle.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      bundle = await res.json();
      buildIndex(bundle);
      console.log('[MPYY] PlanGML katalog hazır —', byKey.size, 'alan,', boundaryByKey.size, 'sınır eşlemesi');
      return true;
    } catch (e) {
      console.warn('[MPYY] katalog yüklenemedi:', e);
      ready = false;
      return false;
    }
  }

  function resolveTipAlias(tip) {
    return TIP_ALIASES[tip] || tip;
  }

  function lookup(featureType, tip, planLevel) {
    if (!ready) return null;
    const ft = String(featureType || '').replace(/^.*:/, '');
    const t = String(tip || '').trim();
    const alias = resolveTipAlias(t);

    const keys = [
      `${planLevel}|${ft}|${alias}`,
      `${planLevel}|${ft}|${t}`,
      `${planLevel}|tip:${alias}`,
      `${planLevel}|tip:${t}`,
    ];
    for (let i = 0; i < keys.length; i++) {
      const hit = byKey.get(keys[i]);
      if (hit) return hit;
    }
    return null;
  }

  function lookupByLabel(label, planLevel) {
    if (!ready || !label) return null;
    const tipKey = subClassToTipKey(label);
    if (!tipKey) return null;
    const keys = [tipKey, resolveTipAlias(tipKey)];
    for (let i = 0; i < keys.length; i++) {
      const hit = byKey.get(`${planLevel}|tip:${keys[i]}`);
      if (hit) return hit;
    }
    return null;
  }

  function lookupBoundary(featureType, props, planLevel) {
    if (!ready) return null;
    const ft = String(featureType || '').replace(/^.*:/, '');
    const mapped = BOUNDARY_FEATURE_MAP[ft] || ft;
    const keys = [
      `${planLevel}|boundaryFeature:${ft}`,
      `${planLevel}|boundaryFeature:${mapped}`,
      `${planLevel}|boundary:${mapped}`,
      `${planLevel}|boundary:${ft}`,
    ];
    for (let i = 0; i < keys.length; i++) {
      const hit = boundaryByKey.get(keys[i]);
      if (hit) return hit;
    }
    const label = props?.Adi || props?.PlanAdi || props?.name || '';
    if (label) {
      const tipKey = subClassToTipKey(label);
      if (tipKey) {
        const hit = boundaryByKey.get(`${planLevel}|boundary:${tipKey}`);
        if (hit) return hit;
      }
    }
    return null;
  }

  function mmToScreenUnits(mm, projectScale, mPerPx) {
    const scale = projectScale || 1000;
    const val = Number(mm);
    if (!val || val <= 0) return 2;
    const meters = (val / 1000) * scale;
    if (!mPerPx || mPerPx <= 0) return Math.max(1.2, val * 0.35);
    return Math.max(1, meters / mPerPx);
  }

  function boundaryDashFromRecord(rec, projectScale, mPerPx) {
    const seg = mmToScreenUnits(rec.segmentLengthMM || 10, projectScale, mPerPx);
    const gap = mmToScreenUnits(rec.gapMM || 2, projectScale, mPerPx);
    const dot = mmToScreenUnits(rec.dotDiameterMM || 1, projectScale, mPerPx);
    const circle = mmToScreenUnits(rec.circleDiameterMM || 5, projectScale, mPerPx);
    const pt = rec.patternType || 'solid';

    switch (pt) {
      case 'dash_dot':
        return [Math.max(2, seg), Math.max(1, gap), Math.max(0.8, dot), Math.max(1, gap)];
      case 'dash_double_dot':
        return [Math.max(2, seg), gap, dot, gap * 0.5, dot, gap];
      case 'dash_group_dots':
      case 'dash_repeated_dots':
        return [Math.max(2, seg), gap, dot, dot * 0.4, dot, gap];
      case 'hollow_circle_repeat':
      case 'alt_filled_hollow_circle':
      case 'filled_circle_dash':
        return [Math.max(1.5, circle), Math.max(1, gap)];
      case 'tick_circle':
      case 'parallel_staggered_ticks':
        return [Math.max(2, seg), Math.max(1, gap)];
      case 'belediye_dot_dash':
        return [Math.max(2, seg), gap, dot, gap];
      case 'dash_gap_repeat':
        return [Math.max(2, seg), Math.max(1, gap)];
      case 'solid':
      case 'point_symbol':
        return [];
      default:
        if (seg > 0 && gap > 0) return [seg, gap];
        return [Math.max(3, seg || 8), Math.max(2, gap || 4)];
    }
  }

  function boundaryPresentationFromRecord(rec, projectScale, mPerPx) {
    const strokeW = Math.max(1, mmToScreenUnits(rec.lineThicknessMM || 0.6, projectScale, mPerPx));
    const pattern = rec.patternType || 'solid';
    const periodMm = (rec.circleDiameterMM || 0) + (rec.gapMM || rec.segmentLengthMM || 10);
    return {
      color: rec.strokeHex || '#000000',
      strokeWidth: strokeW,
      lineStyle: 'mpyy-boundary',
      boundaryPattern: pattern,
      boundaryDash: boundaryDashFromRecord(rec, projectScale, mPerPx),
      boundaryPeriodMm: periodMm,
      boundaryParams: {
        segmentLengthMM: rec.segmentLengthMM,
        gapMM: rec.gapMM,
        dotDiameterMM: rec.dotDiameterMM,
        circleDiameterMM: rec.circleDiameterMM,
        perpendicularLengthMM: rec.perpendicularLengthMM,
        lineThicknessMM: rec.lineThicknessMM,
      },
      noFill: true,
      hatchPattern: 'none',
      mpyyRecordId: rec.id,
      mpyyKind: 'boundary',
      mpyyDetailSubClass: rec.detailSubClass,
    };
  }

  function hatchSpacingMm(hatchParams) {
    if (!hatchParams) return null;
    return hatchParams.karolajMm
      || hatchParams.pairSpacingMm
      || hatchParams.horizontalSpacingMm
      || hatchParams.diagonalSpacingMm
      || hatchParams.spacingMm
      || hatchParams.gridSpacingMm
      || null;
  }

  function presentationFromRecord(rec) {
    const hp = rec.hatchParams || {};
    const rs = hp.renderStyle || rec.patternType || 'none';
    let hatchPattern = RENDER_STYLE_HATCH[rs];
    if (hatchPattern == null) {
      if (/stamp|stipple/i.test(rec.renderPatternId || '')) hatchPattern = 'stamp';
      else if (/diagonal|capraz/i.test(rec.renderPatternId || '')) hatchPattern = 'diagonal';
      else if (/cross|capraz.*capraz/i.test(rec.renderPatternId || '')) hatchPattern = 'cross';
      else if (/horizontal|yatay/i.test(rec.renderPatternId || '')) hatchPattern = 'horizontal';
      else if (/vertical|dikey/i.test(rec.renderPatternId || '')) hatchPattern = 'vertical';
      else if (/grid|karolaj/i.test(rec.renderPatternId || '')) hatchPattern = 'grid';
      else hatchPattern = 'none';
    }
    if (rs === 'solid_fill' || rs === 'none' || rs === 'symbol_only') hatchPattern = 'none';

    const hatchMm = hatchSpacingMm(hp);
    const fillHex = rec.fillHex || rec.fieldSketchMapping?.fillHex || '#9e9e9e';
    const strokeHex = rec.fieldSketchMapping?.strokeHex || rec.hatchInk || '#000000';
    const hatchCol = rec.hatchInk || rec.fieldSketchMapping?.hatchInk || '#212121';
    const hasFill = hatchPattern !== 'none' || (rec.fillRgb || rec.fillHex);

    return {
      color: strokeHex,
      fillColor: hasFill ? hexToRgba(fillHex, hatchPattern === 'none' ? 0.38 : 0.58) : 'transparent',
      strokeWidth: hp.lineThicknessMm ? Math.max(1.5, hp.lineThicknessMm * 4) : 2,
      hatchPattern,
      hatchColor: hatchCol,
      hatchMm,
      noFill: !hasFill,
      mpyyRecordId: rec.id,
      mpyyKind: 'landuse',
      mpyyRenderStyle: rs,
      mpyyDetailSubClass: rec.detailSubClass,
    };
  }

  function symbolCodeFor(featureType, tip, adi, planLevel) {
    if (!ready) return '';
    const ft = String(featureType || '').replace(/^.*:/, '');
    const t = String(tip || '').trim();
    let rec = lookup(ft, t, planLevel);
    if (!rec && t) rec = lookup('', t, planLevel);
    if (!rec && adi) rec = lookupByLabel(adi, planLevel);
    return rec?.symbol?.code || '';
  }

  return {
    load,
    lookup,
    lookupByLabel,
    lookupBoundary,
    presentationFromRecord,
    boundaryPresentationFromRecord,
    boundaryDashFromRecord,
    mmToScreenUnits,
    resolvePlanLevel,
    isReady: () => ready,
    tipKeyFromLabel: subClassToTipKey,
    symbolCodeFor,
  };
})();
