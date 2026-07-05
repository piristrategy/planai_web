'use strict';
/**
 * PlanAI Field — ölçüm sonrası asistan yorumu (Faz 3).
 */
const FieldInspectionMeasureCoach = (function () {
  const COOLDOWN_MS = 90000;

  let _lastNudgeTs = 0;

  function tr() {
    return (typeof PA_LANG !== 'undefined' && PA_LANG === 'tr');
  }

  function polylineLengthM(obj) {
    const verts = obj?.vertices || [];
    if (verts.length < 2 || typeof worldSegMeters !== 'function') return 0;
    let len = 0;
    for (let i = 0; i < verts.length - 1; i++) {
      len += worldSegMeters(verts[i].x, verts[i].y, verts[i + 1].x, verts[i + 1].y);
    }
    if (obj.closed && verts.length >= 3) {
      const a = verts[verts.length - 1];
      const b = verts[0];
      len += worldSegMeters(a.x, a.y, b.x, b.y);
    }
    return len;
  }

  function polygonAreaM2(obj) {
    const pts = obj?.points || [];
    if (pts.length < 6 || typeof polygonAreaM2FromWorldPts !== 'function') return 0;
    return polygonAreaM2FromWorldPts(pts);
  }

  function fmtLen(m) {
    if (typeof formatLengthReport === 'function') return formatLengthReport(m);
    if (m >= 1000) return (m / 1000).toFixed(2) + ' km';
    return m.toFixed(1) + ' m';
  }

  function fmtArea(m2) {
    if (typeof formatAreaReport === 'function') return formatAreaReport(m2);
    if (m2 >= 10000) return (m2 / 10000).toFixed(2) + ' ha';
    return m2.toFixed(0) + ' m²';
  }

  function recentRefinedObservation() {
    if (typeof S === 'undefined' || typeof FieldInspectionAi === 'undefined') return null;
    const notes = S.objects
      .filter(o => o.type === 'field_note' && o.text && o.visible !== false)
      .slice(-8)
      .reverse();
    for (const n of notes) {
      const refined = FieldInspectionAi.refineObservation(n.text);
      if (!refined?.text) continue;
      const sig = refined.signals || {};
      if (Object.values(sig).some(Boolean) || (refined.themes || []).length) return refined;
    }
    return null;
  }

  function getIntent() {
    if (typeof FieldInspectionModes !== 'undefined') return FieldInspectionModes.getCurrentIntent();
    return FIELD_PROJECT?.metadata?.inspectionIntent || 'general';
  }

  function buildLineNudge(lenM, refined) {
    const signals = refined?.signals || {};
    const themes = new Set((refined?.themes || []).map(t => t.id));
    const lenStr = fmtLen(lenM);

    if (signals.roadWidth && lenM >= 1.2 && lenM <= 12) {
      return {
        id: 'measure_line_road',
        message: tr()
          ? 'Yol genişliği ' + lenStr + ' — dar yol gözleminizle uyumlu.'
          : 'Road width ' + lenStr + ' — matches your narrow-road observation.',
        actionLabel: tr() ? '📷 Fotoğrafla' : '📷 Add photo',
        action: 'photo',
        radar: true,
      };
    }
    if (signals.length || themes.has('access')) {
      return {
        id: 'measure_line_access',
        message: tr()
          ? 'Erişim / mesafe ' + lenStr + ' ölçüldü — gözlemle birlikte rapora gider.'
          : 'Access / distance ' + lenStr + ' measured — links to your field notes in the report.',
        actionLabel: tr() ? '✦ Gözlem ekle' : '✦ Add observation',
        action: 'assistant',
        radar: true,
      };
    }
    if (getIntent() === 'valuation') {
      return {
        id: 'measure_line_valuation',
        message: tr()
          ? 'Cephe veya hat ölçüsü ' + lenStr + ' — değerleme dosyasına eklendi.'
          : 'Façade or line measure ' + lenStr + ' — added to valuation file.',
        actionLabel: tr() ? '📷 Cephe fotoğrafı' : '📷 Façade photo',
        action: 'photo',
        radar: true,
      };
    }
    return {
      id: 'measure_line_generic',
      message: tr()
        ? 'Ölçüm çizgisi ' + lenStr + ' kaydedildi — gözlemle ilişkilendirmek ister misiniz?'
        : 'Measure line ' + lenStr + ' saved — link it to an observation?',
      actionLabel: tr() ? '✦ Asistan' : '✦ Assistant',
      action: 'assistant',
      radar: true,
    };
  }

  function buildAreaNudge(areaM2, refined) {
    const signals = refined?.signals || {};
    const themes = new Set((refined?.themes || []).map(t => t.id));
    const areaStr = fmtArea(areaM2);
    const ha = areaM2 / 10000;

    if (signals.agriculture || themes.has('agriculture')) {
      const haNote = ha >= 0.3 ? (ha.toFixed(1) + (tr() ? ' ha' : ' ha')) : areaStr;
      return {
        id: 'measure_area_agri',
        message: tr()
          ? 'Alan ' + haNote + ' — tarım alanı gözleminizle birlikte rapora eklensin mi?'
          : 'Area ' + haNote + ' — add to report with your farmland observation?',
        actionLabel: tr() ? '✦ Gözlem ekle' : '✦ Add observation',
        action: 'assistant',
        radar: true,
      };
    }
    if (signals.areaSize || signals.boundary || getIntent() === 'valuation') {
      return {
        id: 'measure_area_valuation',
        message: tr()
          ? 'Alan ' + areaStr + ' belgelendi — gayrimenkul ölçümünüz güçlendi.'
          : 'Area ' + areaStr + ' documented — strengthens your property survey.',
        actionLabel: tr() ? '📷 Alan fotoğrafı' : '📷 Area photo',
        action: 'photo',
        radar: true,
      };
    }
    return {
      id: 'measure_area_generic',
      message: tr()
        ? 'Alan ölçümü ' + areaStr + ' kaydedildi.'
        : 'Area measurement ' + areaStr + ' saved.',
      actionLabel: tr() ? '✦ Asistan' : '✦ Assistant',
      action: 'assistant',
      radar: true,
    };
  }

  function canNudge() {
    if (Date.now() - _lastNudgeTs < COOLDOWN_MS) return false;
    if (document.body.classList.contains('field-ai-sheet-open')) return false;
    if (document.body.classList.contains('field-ai-guide-open')) return false;
    if (document.body.classList.contains('field-ai-end-open')) return false;
    return true;
  }

  function onMeasureComplete(obj) {
    if (!window.FIELD_TRIAL_AI_ENABLED || !FIELD_PROJECT?.id || !obj) return;
    if (!canNudge()) return;

    const refined = recentRefinedObservation();
    let nudge = null;

    if (obj.type === 'polyline') {
      const lenM = polylineLengthM(obj);
      if (lenM < 0.4) return;
      nudge = buildLineNudge(lenM, refined);
    } else if (obj.type === 'polygon' && obj.closed) {
      const areaM2 = polygonAreaM2(obj);
      if (areaM2 < 1) return;
      nudge = buildAreaNudge(areaM2, refined);
    } else {
      return;
    }

    if (!nudge || typeof FieldTrialAiShell === 'undefined' || !FieldTrialAiShell.showRadarNudge) return;
    FieldTrialAiShell.showRadarNudge(nudge);
    _lastNudgeTs = Date.now();
  }

  function resetSession() {
    _lastNudgeTs = 0;
  }

  return {
    onMeasureComplete,
    resetSession,
    polylineLengthM,
    polygonAreaM2,
  };
})();

window.FieldInspectionMeasureCoach = FieldInspectionMeasureCoach;
