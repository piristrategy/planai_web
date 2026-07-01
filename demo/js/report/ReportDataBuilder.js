'use strict';
/**
 * PlanAI Field — unified report dataset for PDF + interactive cinematic reports.
 */
const ReportDataBuilder = (function () {
  function isVideoNote(v) {
    return v && v.isVideoNote !== false;
  }

  function splitVideos(videos) {
    const all = videos || [];
    return { videoNotes: all, videos: [] };
  }

  function splitPhotos(photos) {
    const all = (photos || []).filter(p => !p.isPanorama);
    const voiceNotes = all.filter(p => p.hasVoice);
    return { photos: all, panoramas: [], voiceNotes };
  }

  function collectLayers(objects) {
    const layers = new Map();
    (objects || []).forEach(o => {
      if (o.visible === false) return;
      const lid = o.layerId || (o._import || o.type === 'georef_image' ? 'import' : 'sketch');
      if (!layers.has(lid)) {
        const layer = typeof S !== 'undefined' ? S.layers?.find(l => l.id === lid) : null;
        layers.set(lid, {
          id: lid,
          name: layer?.name || lid,
          count: 0,
          import: !!(o._import || o.type === 'georef_image'),
        });
      }
      layers.get(lid).count += 1;
    });
    return [...layers.values()];
  }

  async function collectPanoramas() {
    return [];
  }

  async function collectVoiceNotes(photos) {
    return (photos || []).filter(p => p.hasVoice).map(p => ({
      id: p.id,
      photoNum: p.photoNum,
      lat: p.lat,
      lon: p.lon,
      timestamp: p.timestamp,
      caption: p.caption || '',
      voiceDuration: p.voiceDuration || 0,
      audioDataUrl: p.audioDataUrl || '',
      imageDataUrl: p.imageDataUrl || '',
    }));
  }

  async function buildFromCurrentProject(onProgress) {
    const prog = (p, s) => { if (onProgress) onProgress(p, s); };
    const tFn = typeof window.t === 'function' ? window.t : k => k;
    prog(5, tFn('report.doc.progress.collect'));
    if (typeof window.syncProjectInspectionMetadata === 'function') {
      await window.syncProjectInspectionMetadata({ preserveGeo: true });
    }
    if (typeof window.saveCurrentProject === 'function') await window.saveCurrentProject(true);
    const snap = typeof serializeProjectSnapshot === 'function' ? serializeProjectSnapshot() : null;
    const generatedAt = new Date().toISOString();
    const measurements = typeof computeMeasurementsFromObjects === 'function'
      ? computeMeasurementsFromObjects(S.objects)
      : { items: [], totals: {} };
    if (snap) snap.measurements = measurements;

    prog(45, tFn('report.doc.progress.photos'));
    const allPhotos = typeof collectReportPhotos === 'function' ? await collectReportPhotos() : [];
    const { photos, panoramas: panoFromPhotos, voiceNotes: voiceFromPhotos } = splitPhotos(allPhotos);

    prog(52, typeof PA_LANG !== 'undefined' && PA_LANG === 'tr' ? 'Video notlar…' : 'Video notes…');
    const allVideos = typeof collectReportVideos === 'function' ? await collectReportVideos() : [];
    const { videoNotes, videos } = splitVideos(allVideos);

    prog(60, tFn('report.doc.progress.notes'));
    const notes = typeof collectReportNotes === 'function' ? await collectReportNotes() : [];

    let inspectionAnchor = null;
    if (typeof window.ensureReportInspectionGeoReady === 'function') {
      inspectionAnchor = await window.ensureReportInspectionGeoReady(snap, allPhotos, notes);
    } else if (typeof window.resolveReportInspectionAnchor === 'function') {
      inspectionAnchor = window.resolveReportInspectionAnchor(snap, snap, allPhotos, notes);
    } else {
      inspectionAnchor = { lat: S.mapCenter?.lat, lon: S.mapCenter?.lon };
    }

    if (typeof syncGpsTrackObject === 'function') syncGpsTrackObject();

    prog(25, tFn('report.doc.progress.map'));
    const geoBoundsFinal = typeof computeReportGeoBounds === 'function'
      ? computeReportGeoBounds(allPhotos, notes, snap, inspectionAnchor)
      : null;
    let mapDataUrl = '';
    if (typeof resolveReportMapDataUrl === 'function') {
      mapDataUrl = await resolveReportMapDataUrl(null, geoBoundsFinal, snap, allPhotos, notes);
    } else if (typeof buildReportMapFallbackDataUrl === 'function') {
      mapDataUrl = buildReportMapFallbackDataUrl({ snap, project: snap, photos: allPhotos, notes });
    }

    const panoramas = [];
    const voiceNotes = await collectVoiceNotes(allPhotos);
    const layers = collectLayers(snap?.objects || S.objects);
    const areas = (measurements.items || []).filter(it => it.kind === 'polygon');
    const gpsTrack = typeof extractGpsTrackFeat === 'function'
      ? extractGpsTrackFeat(snap, { project: snap }, typeof PA_LANG !== 'undefined' && PA_LANG === 'tr')
      : null;

    prog(68, typeof PA_LANG !== 'undefined' && PA_LANG === 'tr' ? 'Uydu altlığı hazırlanıyor…' : 'Satellite basemap…');
    let interactiveBasemapUrl = '';
    try {
      if (typeof buildSatelliteBasemapDataUrl === 'function' && geoBoundsFinal) {
        interactiveBasemapUrl = await buildSatelliteBasemapDataUrl(geoBoundsFinal);
      }
    } catch (e) {
      console.warn('[ReportDataBuilder] satellite', e);
    }

    const objectCounts = {
      total: S.objects.length,
      photos: photos.length,
      panoramas: 0,
      videos: 0,
      videoNotes: allVideos.length,
      voiceNotes: voiceNotes.length,
      notes: notes.length,
      sketch: S.objects.filter(o => !o._import && o.type !== 'field_photo' && o.type !== 'field_note' && o.type !== 'field_video').length,
      imports: S.objects.filter(o => o._import).length,
      layers: layers.length,
      measurements: (measurements.items || []).length,
    };

    const inspectionAt = FIELD_PROJECT.metadata?.startTime
      || (typeof deriveProjectInspectionDate === 'function'
        ? deriveProjectInspectionDate(snap, allPhotos, notes, allVideos)
        : generatedAt);

    const reportMeta = {
      templateId: typeof REPORT_TEMPLATE_ID !== 'undefined' ? REPORT_TEMPLATE_ID : 'planai-field-v2',
      generatedAt,
      inspectionAt,
      appVersion: typeof PLANAI_FIELD_APP_VERSION !== 'undefined' ? PLANAI_FIELD_APP_VERSION : '2.0.0',
      lang: typeof PA_LANG !== 'undefined' ? PA_LANG : 'tr',
      crs: 'WGS84 (EPSG:4326)',
      mapCenter: {
        lat: inspectionAnchor?.lat ?? S.mapCenter?.lat,
        lon: inspectionAnchor?.lon ?? S.mapCenter?.lon,
      },
      gpsAccuracy: typeof _fieldGpsFix !== 'undefined' ? (_fieldGpsFix?.accuracy ?? null) : null,
      userName: typeof getReportUserName === 'function' ? getReportUserName() : '',
      objectCounts,
      measurements,
      inspectionContext: typeof collectFieldInspectionContext === 'function' ? collectFieldInspectionContext() : null,
    };

    prog(75, typeof PA_LANG !== 'undefined' && PA_LANG === 'tr' ? 'Marka öğeleri…' : 'Brand assets…');
    const brandLogoUrl = typeof loadBrandLogoDataUrl === 'function' ? await loadBrandLogoDataUrl() : '';

    return {
      snap,
      project: snap,
      meta: reportMeta,
      mapPng: null,
      mapDataUrl,
      interactiveBasemapUrl,
      geoBounds: geoBoundsFinal,
      brandLogoUrl,
      photos,
      allPhotos,
      videos,
      videoNotes,
      panoramas,
      voiceNotes,
      notes,
      measurements,
      layers,
      areas,
      gpsTrack,
    };
  }

  return {
    buildFromCurrentProject,
    splitVideos,
    splitPhotos,
    collectLayers,
    isVideoNote,
  };
})();

window.ReportDataBuilder = ReportDataBuilder;
