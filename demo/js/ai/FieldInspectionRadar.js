'use strict';
/**
 * PlanAI Field — trial canlı eksiklik radarı (Faz 2).
 */
const FieldInspectionRadar = (function () {
  const PULSE_MS = 45000;
  const COOLDOWN_MS = 180000;
  const DISMISS_MS = 900000;
  const MIN_ROUTE_M = 80;

  let _lastPulseTs = 0;
  let _lastNudgeTs = 0;
  const _dismissed = new Map();
  let _lastObsSignals = null;
  let _lastObsTs = 0;

  function tr() {
    return (typeof PA_LANG !== 'undefined' && PA_LANG === 'tr');
  }

  function collectStats() {
    const photos = S.objects.filter(o => o.type === 'field_photo' && o.visible !== false).length;
    const videos = S.objects.filter(o => o.type === 'field_video').length;
    const notes = S.objects.filter(o => o.type === 'field_note').length;
    const aiObs = S.objects.filter(o => o.type === 'field_note'
      && (o.captureMode === 'ai_observation' || o.captureMode === 'voice_quick')).length;
    const critObs = S.objects.filter(o => o.type === 'field_note' && o.aiSeverity === 'critical').length;
    const circles = S.objects.filter(o => o.type === 'circle').length;
    const measures = S.objects.filter(o => o.type === 'polyline' || o.type === 'polygon').length;
    const hasPlan = S.objects.some(o => o._planOverlay || o.metadata?.planFeatureType);
    const hasGeoTiff = S.objects.some(o => o.type === 'georef_image' && o._planOverlay);
    const hasSiteImport = S.objects.some(o => o._import && !o._planOverlay && !o.metadata?.planFeatureType
      && o.type !== 'georef_image');

    let routeM = 0;
    if (typeof _gpsTrack !== 'undefined' && _gpsTrack.points?.length >= 2 && typeof trackTotalDistanceM === 'function') {
      routeM = trackTotalDistanceM(_gpsTrack.points);
    } else {
      const trk = S.objects.filter(o => o.type === 'field_gps_track').pop();
      if (trk?.vertices?.length >= 2 && typeof trackTotalDistanceM === 'function') {
        routeM = trackTotalDistanceM(trk.vertices);
      } else if (trk?.trackMeta?.distanceM) {
        routeM = trk.trackMeta.distanceM;
      }
    }

    return {
      photos, videos, notes, aiObs, critObs, circles, measures,
      routeM, routeKm: routeM / 1000,
      hasPlan, hasGeoTiff, hasSiteImport,
      photoPerKm: routeM > 0 ? photos / (routeM / 1000) : photos,
      polygons: S.objects.filter(o => o.type === 'polygon').length,
      polylines: S.objects.filter(o => o.type === 'polyline').length,
      hasContent: photos + videos + notes + measures > 0,
    };
  }

  function getIntent() {
    if (typeof FieldInspectionModes !== 'undefined') return FieldInspectionModes.getCurrentIntent();
    const raw = FIELD_PROJECT?.metadata?.inspectionIntent;
    if (raw === 'site') return 'valuation';
    return raw || 'general';
  }

  function intentNudges(intent, stats, candidates) {
    if (intent === 'plan') {
      if (!stats.hasPlan && !stats.hasGeoTiff) {
        candidates.push({
          id: 'radar_plan_import', priority: 93,
          nudge: buildNudge(
            'radar_plan_import',
            tr() ? 'İmar planı modu — Plan GML, GeoJSON veya GeoTIFF yükleyin (MPYY uyumlu).' : 'Plan mode — import Plan GML, GeoJSON or GeoTIFF (MPYY).',
            tr() ? '📂 Plan yükle' : '📂 Import plan',
            'import',
          ),
        });
      } else if ((stats.hasPlan || stats.hasGeoTiff) && stats.aiObs === 0 && stats.routeM > 100) {
        candidates.push({
          id: 'radar_plan_query', priority: 79,
          nudge: buildNudge(
            'radar_plan_query',
            tr() ? 'Plan yüklü — Bilgi aracı ile parsel / fonksiyon sorgulayın, bulguyu Asistan ile kaydedin.' : 'Plan loaded — query parcels with Info tool, log findings via Assistant.',
            tr() ? '✦ Gözlem ekle' : '✦ Add observation',
            'assistant',
          ),
        });
      }
      return;
    }

    if (intent === 'valuation') {
      if (!stats.hasSiteImport && stats.routeM < 120 && !stats.hasContent) {
        candidates.push({
          id: 'radar_val_boundary', priority: 91,
          nudge: buildNudge(
            'radar_val_boundary',
            tr() ? 'Değerleme sahası — parsel sınırını KML veya GeoJSON ile yükleyebilirsiniz.' : 'Valuation — import parcel boundary as KML or GeoJSON.',
            tr() ? '📂 Sınır yükle' : '📂 Import boundary',
            'import',
          ),
        });
      }
      if (stats.measures === 0 && stats.routeM > 50 && (stats.aiObs > 0 || stats.photos > 0)) {
        candidates.push({
          id: 'radar_val_measure', priority: 86,
          nudge: buildNudge(
            'radar_val_measure',
            tr() ? 'Gayrimenkul değerlemesi — alan veya cephe ölçümü eklemek raporu güçlendirir.' : 'Property valuation — add area or façade measurements.',
            tr() ? '⬠ Alan ölç' : '⬠ Measure area',
            'measure_area',
          ),
        });
      }
      if (stats.photos < 3 && stats.routeM > 90) {
        candidates.push({
          id: 'radar_val_photos', priority: 84,
          nudge: buildNudge(
            'radar_val_photos',
            tr() ? 'Yapı özelliklerini belgeleyin — cephe, giriş ve çevre fotoğrafları önerilir.' : 'Document building traits — façade, access and context photos.',
            tr() ? '📷 Fotoğraf çek' : '📷 Take photo',
            'photo',
          ),
        });
      }
      if (stats.videos === 0 && stats.photos >= 2 && stats.routeM > 120) {
        candidates.push({
          id: 'radar_val_video', priority: 81,
          nudge: buildNudge(
            'radar_val_video',
            tr() ? 'Kısa bir bina turu videosu değerleme dosyasını zenginleştirir.' : 'A short building walkthrough video strengthens the valuation file.',
            tr() ? '🎬 Video çek' : '🎬 Record video',
            'video',
          ),
        });
      }
      if (stats.polygons === 0 && stats.polylines >= 1 && stats.routeM > 80) {
        candidates.push({
          id: 'radar_val_area', priority: 80,
          nudge: buildNudge(
            'radar_val_area',
            tr() ? 'Uzunluk ölçtünüz — parsel veya bağımsız bölüm alanı için poligon çizebilirsiniz.' : 'You measured length — draw a polygon for parcel or unit area.',
            tr() ? '⬠ Alan ölç' : '⬠ Measure area',
            'measure_area',
          ),
        });
      }
      return;
    }

    if (intent === 'tourism') {
      if (stats.routeKm >= 0.12 && stats.photos < 2) {
        candidates.push({
          id: 'radar_tour_photo', priority: 88,
          nudge: buildNudge(
            'radar_tour_photo',
            tr() ? 'Turistik gezi — önemli anları fotoğraflayın; sinematik raporda harita üzerinde yaşar.' : 'Travel log — photograph highlights; they live on the map in your cinematic report.',
            tr() ? '📷 Anı fotoğrafı' : '📷 Memory photo',
            'photo',
          ),
        });
      }
      if (stats.routeKm >= 0.25 && stats.photoPerKm < 4) {
        candidates.push({
          id: 'radar_tour_more_photos', priority: 82,
          nudge: buildNudge(
            'radar_tour_more_photos',
            tr() ? 'Güzergâh güzel — birkaç fotoğraf daha anılarınızı güçlendirir.' : 'Nice route — a few more photos enrich your memories.',
            tr() ? '📷 Fotoğraf çek' : '📷 Take photo',
            'photo',
          ),
        });
      }
      if (stats.videos === 0 && stats.photos >= 3 && stats.routeKm >= 0.2) {
        candidates.push({
          id: 'radar_tour_video', priority: 80,
          nudge: buildNudge(
            'radar_tour_video',
            tr() ? 'Hareket ve atmosfer için kısa video — sinematik raporda çok etkili.' : 'Short video for motion and mood — great in cinematic report.',
            tr() ? '🎬 Video kaydet' : '🎬 Record video',
            'video',
          ),
        });
      }
      if (stats.routeKm >= 0.4 && stats.photos + stats.videos >= 4) {
        candidates.push({
          id: 'radar_tour_cinematic', priority: 72,
          nudge: buildNudge(
            'radar_tour_cinematic',
            tr() ? 'Güzel bir rota oluştu — inceleme bitince sinematik rapor anılarınızı saklar.' : 'Nice route building — finish with a cinematic report to keep memories.',
            tr() ? '🎬 Rapor önizle' : '🎬 Preview report',
            'cinematic',
          ),
        });
      }
      return;
    }
  }

  function canNudge(id) {
    if (Date.now() - _lastNudgeTs < COOLDOWN_MS) return false;
    const d = _dismissed.get(id);
    if (d && Date.now() - d < DISMISS_MS) return false;
    return true;
  }

  function markShown() {
    _lastNudgeTs = Date.now();
  }

  function dismissNudge(id) {
    if (id) _dismissed.set(id, Date.now());
  }

  function buildNudge(id, message, actionLabel, action, extra) {
    return { id, message, actionLabel, action, radar: true, ...(extra || {}) };
  }

  function evaluateNudges() {
    if (!window.FIELD_TRIAL_AI_ENABLED || !FIELD_PROJECT?.id) return null;
    const stats = collectStats();
    if (stats.routeM < MIN_ROUTE_M && !stats.hasContent) return null;

    const intent = getIntent();
    const candidates = [];

    intentNudges(intent, stats, candidates);
    if (stats.routeM >= 120 && stats.photos === 0 && stats.notes === 0) {
      candidates.push({
        id: 'radar_no_docs', priority: 88,
        nudge: buildNudge(
          'radar_no_docs',
          tr() ? 'Rota kaydı var ancak henüz fotoğraf veya gözlem yok — Asistan ile kayda başlayın.' : 'GPS route without photos or observations — use the Assistant.',
          tr() ? '✦ Asistan' : '✦ Assistant',
          'assistant',
        ),
      });
    }
    if (stats.critObs > 0 && stats.photos < stats.critObs) {
      candidates.push({
        id: 'radar_crit_photo', priority: 87,
        nudge: buildNudge(
          'radar_crit_photo',
          tr() ? 'Kritik gözlem var — fotoğrafla doğrulama önerilir.' : 'Critical observation — add photo evidence.',
          tr() ? '📷 Fotoğraf çek' : '📷 Take photo',
          'photo',
        ),
      });
    }
    if (stats.routeKm >= 0.22 && stats.photos < 1) {
      candidates.push({
        id: 'radar_thin_photo', priority: 80,
        nudge: buildNudge(
          'radar_thin_photo',
          tr() ? 'Rota uzuyor — en az bir saha fotoğrafı eklemek raporu güçlendirir.' : 'Route is growing — add at least one field photo.',
          tr() ? '📷 Fotoğraf çek' : '📷 Take photo',
          'photo',
        ),
      });
    }
    if (stats.routeKm >= 0.18 && stats.aiObs === 0 && stats.notes === 0) {
      candidates.push({
        id: 'radar_no_obs', priority: 78,
        nudge: buildNudge(
          'radar_no_obs',
          tr() ? 'Henüz saha gözlemi yok — gördüklerinizi Asistan ile söyleyin.' : 'No field observations yet — tell the Assistant what you see.',
          tr() ? '✦ Asistan' : '✦ Assistant',
          'assistant',
        ),
      });
    }
    if (_lastObsSignals?.slope && stats.circles === 0 && stats.routeM >= 60
        && Date.now() - _lastObsTs < 600000) {
      candidates.push({
        id: 'radar_slope_pending', priority: 76,
        nudge: buildNudge(
          'radar_slope_pending',
          tr() ? 'Eğimden bahsettiniz — eğim analizi henüz yapılmadı.' : 'You mentioned slope — slope analysis not saved yet.',
          tr() ? '📐 Eğim analizi' : '📐 Slope analysis',
          'slope',
          { lat: null, lon: null },
        ),
      });
    }
    if (_lastObsSignals?.roadWidth && stats.measures === 0 && Date.now() - _lastObsTs < 600000) {
      candidates.push({
        id: 'radar_measure_width', priority: 77,
        nudge: buildNudge(
          'radar_measure_width',
          tr() ? 'Yol genişliği gözlemi var — ölçüm çizgisi henüz çizilmedi.' : 'Road width noted — no measure line yet.',
          tr() ? '📏 Genişlik ölç' : '📏 Measure width',
          'measure_line',
        ),
      });
    }

    candidates.sort((a, b) => b.priority - a.priority);
    for (const c of candidates) {
      if (canNudge(c.id)) return c.nudge;
    }
    return null;
  }

  function maybePulse() {
    if (!window.FIELD_TRIAL_AI_ENABLED) return;
    const now = Date.now();
    if (now - _lastPulseTs < PULSE_MS) return;
    _lastPulseTs = now;
    const nudge = evaluateNudges();
    if (!nudge) return;
    if (typeof FieldTrialAiShell !== 'undefined' && FieldTrialAiShell.showRadarNudge) {
      FieldTrialAiShell.showRadarNudge(nudge);
      markShown();
    }
  }

  function noteObservation(refined) {
    if (!refined) return;
    _lastObsSignals = refined.signals || (typeof FieldInspectionAi !== 'undefined'
      ? FieldInspectionAi.detectCoachSignals(refined.text)
      : null);
    _lastObsTs = Date.now();
  }

  function onGpsTrackPoint() {
    maybePulse();
  }

  function onGpsTrackStopped() {
    if (!window.FIELD_TRIAL_AI_ENABLED || !FIELD_PROJECT?.id) return;
    const stats = collectStats();
    if (stats.routeM < 150 && !stats.hasContent) return;
    if (typeof FieldTrialAiShell !== 'undefined' && FieldTrialAiShell.maybeOfferEndInspection) {
      setTimeout(() => FieldTrialAiShell.maybeOfferEndInspection('gps_stop'), 600);
    }
  }

  function executeRadarAction(nudge) {
    if (!nudge?.action) return false;
    if (nudge.action === 'import' && typeof onFieldImportClick === 'function') {
      onFieldImportClick();
      return true;
    }
    if (nudge.action === 'assistant' && typeof FieldTrialAiShell !== 'undefined') {
      FieldTrialAiShell.openSheet();
      return true;
    }
    if (nudge.action === 'cinematic' && typeof createInteractiveFieldReport === 'function') {
      createInteractiveFieldReport();
      return true;
    }
    if (nudge.action === 'slope' && (nudge.lat == null) && typeof getGpsDisplayFix === 'function') {
      const g = getGpsDisplayFix();
      if (g) nudge = { ...nudge, lat: g.lat, lon: g.lon };
    }
    if (typeof FieldInspectionAi !== 'undefined') {
      return FieldInspectionAi.executeCoachAction(nudge);
    }
    return false;
  }

  function resetSession() {
    _lastPulseTs = 0;
    _lastNudgeTs = 0;
    _lastObsSignals = null;
    _lastObsTs = 0;
    _dismissed.clear();
  }

  return {
    collectStats,
    evaluateNudges,
    maybePulse,
    noteObservation,
    onGpsTrackPoint,
    onGpsTrackStopped,
    executeRadarAction,
    dismissNudge,
    resetSession,
  };
})();

window.FieldInspectionRadar = FieldInspectionRadar;
