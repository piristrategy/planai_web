'use strict';
/**
 * PlanAI Field — project statistics for hub cards and metadata cache.
 */
const FieldProjectStats = (function () {
  function countSketchMeasurements(objects) {
    return (objects || []).filter(o =>
      o.visible !== false &&
      !o._import &&
      o.type !== 'field_photo' &&
      o.type !== 'field_note' &&
      o.type !== 'field_video' &&
      o.type !== 'field_gps_track' &&
      o.type !== 'georef_image'
    ).length;
  }

  function fromObjects(objects, reports) {
    const objs = objects || [];
    const photos = objs.filter(o => o.type === 'field_photo' && o.visible !== false);
    const videos = objs.filter(o => o.type === 'field_video' && o.visible !== false);
    const videoNotes = videos.filter(v => v.isVideoNote !== false);
    const fullVideos = videos.filter(v => v.isVideoNote === false);
    const notes = objs.filter(o => o.type === 'field_note' && o.visible !== false);
    const panoramas = photos.filter(p => p.isPanorama);
    const voice = photos.filter(p => p.hasVoice).length;
    const gpsTracks = objs.filter(o => o.type === 'field_gps_track');
    let gpsPoints = 0;
    gpsTracks.forEach(t => {
      gpsPoints += (t.points && t.points.length) || (t.vertices && t.vertices.length) || 0;
    });
    const layers = new Set(objs.filter(o => o._import || o.type === 'georef_image').map(o => o.layerId || 'import')).size;
    const reps = reports || [];
    const pdfReady = reps.some(r => r.kind === 'pdf' || r.pdfAt || r.hasPdf);
    const interactiveReady = reps.some(r => r.kind === 'interactive' || r.interactiveAt || r.hasInteractive);
    return {
      photos: photos.filter(p => !p.isPanorama).length,
      videos: fullVideos.length,
      videoNotes: videoNotes.length,
      notes: notes.length,
      panoramas: panoramas.length,
      voice,
      gpsPoints,
      gpsRecorded: gpsPoints > 0 || gpsTracks.length > 0,
      layers,
      measurements: countSketchMeasurements(objs),
      pdfReady,
      interactiveReady,
    };
  }

  function fromSnapshot(snap) {
    if (!snap) return fromObjects([], []);
    if (snap.stats && typeof snap.stats.photos === 'number') return { ...snap.stats };
    return fromObjects(snap.objects, snap.reports);
  }

  function formatCardDate(iso, lang) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-US', {
        day: 'numeric', month: 'short', year: 'numeric',
      });
    } catch (_) {
      return String(iso).slice(0, 10);
    }
  }

  function reportStatusLabel(stats, t) {
    const fn = typeof t === 'function' ? t : k => k;
    if (stats.pdfReady) return fn('phub.pdfReady');
    if (stats.interactiveReady) return fn('phub.interactiveReady');
    return fn('phub.noReport');
  }

  return { fromObjects, fromSnapshot, formatCardDate, reportStatusLabel };
})();
