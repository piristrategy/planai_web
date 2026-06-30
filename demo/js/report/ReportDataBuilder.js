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
    return {
      videoNotes: all.filter(isVideoNote),
      videos: all.filter(v => !isVideoNote(v)),
    };
  }

  function splitPhotos(photos) {
    const all = photos || [];
    const panoramas = all.filter(p => p.isPanorama);
    const regular = all.filter(p => !p.isPanorama);
    const voiceNotes = all.filter(p => p.hasVoice);
    return { photos: regular, panoramas, voiceNotes };
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

  async function collectPanoramas(photos) {
    const panos = (photos || []).filter(p => p.isPanorama);
    return panos.map(p => ({
      id: p.id,
      photoNum: p.photoNum,
      lat: p.lat,
      lon: p.lon,
      timestamp: p.timestamp,
      caption: p.caption || '',
      imageDataUrl: p.imageDataUrl || '',
      heading: p.panoHeading ?? p.heading ?? null,
      width: p.width || null,
      height: p.height || null,
    }));
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
    if (typeof window.saveCurrentProject === 'function') await window.saveCurrentProject(true);
    const snap = typeof serializeProjectSnapshot === 'function' ? serializeProjectSnapshot() : null;
    const generatedAt = new Date().toISOString();
    const measurements = typeof computeMeasurementsFromObjects === 'function'
      ? computeMeasurementsFromObjects(S.objects)
      : { items: [], totals: {} };
    if (snap) snap.measurements = measurements;

    prog(25, tFn('report.doc.progress.map'));
    let mapPng = null;
    let mapDataUrl = '';
    if (typeof captureRouteMapSnapshot === 'function') {
      mapPng = await captureRouteMapSnapshot(2);
      mapDataUrl = mapPng && typeof blobToDataUrl === 'function' ? await blobToDataUrl(mapPng) : '';
    }
    if (!mapDataUrl && typeof buildReportMapFallbackDataUrl === 'function') {
      mapDataUrl = buildReportMapFallbackDataUrl();
    }

    prog(45, tFn('report.doc.progress.photos'));
    const allPhotos = typeof collectReportPhotos === 'function' ? await collectReportPhotos() : [];
    const { photos, panoramas: panoFromPhotos, voiceNotes: voiceFromPhotos } = splitPhotos(allPhotos);

    prog(52, typeof PA_LANG !== 'undefined' && PA_LANG === 'tr' ? 'Video notlar…' : 'Video notes…');
    const allVideos = typeof collectReportVideos === 'function' ? await collectReportVideos() : [];
    const { videoNotes, videos } = splitVideos(allVideos);

    prog(60, tFn('report.doc.progress.notes'));
    const notes = typeof collectReportNotes === 'function' ? await collectReportNotes() : [];

    const panoramas = await collectPanoramas(allPhotos);
    const voiceNotes = await collectVoiceNotes(allPhotos);
    const layers = collectLayers(snap?.objects || S.objects);
    const areas = (measurements.items || []).filter(it => it.kind === 'polygon');
    const gpsTrack = typeof extractGpsTrackFeat === 'function'
      ? extractGpsTrackFeat(snap, { project: snap }, typeof PA_LANG !== 'undefined' && PA_LANG === 'tr')
      : null;

    prog(68, typeof PA_LANG !== 'undefined' && PA_LANG === 'tr' ? 'Uydu altlığı hazırlanıyor…' : 'Satellite basemap…');
    const geoBounds = typeof computeReportGeoBounds === 'function'
      ? computeReportGeoBounds(allPhotos, notes, snap, S.mapCenter)
      : null;
    let interactiveBasemapUrl = '';
    try {
      if (typeof buildSatelliteBasemapDataUrl === 'function' && geoBounds) {
        interactiveBasemapUrl = await buildSatelliteBasemapDataUrl(geoBounds);
      }
    } catch (e) {
      console.warn('[ReportDataBuilder] satellite', e);
    }

    const objectCounts = {
      total: S.objects.length,
      photos: photos.length,
      panoramas: panoramas.length,
      videos: videos.length,
      videoNotes: videoNotes.length,
      voiceNotes: voiceNotes.length,
      notes: notes.length,
      sketch: S.objects.filter(o => !o._import && o.type !== 'field_photo' && o.type !== 'field_note' && o.type !== 'field_video').length,
      imports: S.objects.filter(o => o._import).length,
      layers: layers.length,
      measurements: (measurements.items || []).length,
    };

    const inspectionAt = typeof deriveProjectInspectionDate === 'function'
      ? deriveProjectInspectionDate(snap, allPhotos, notes, allVideos)
      : generatedAt;

    const reportMeta = {
      templateId: typeof REPORT_TEMPLATE_ID !== 'undefined' ? REPORT_TEMPLATE_ID : 'planai-field-v2',
      generatedAt,
      inspectionAt,
      appVersion: typeof PLANAI_FIELD_APP_VERSION !== 'undefined' ? PLANAI_FIELD_APP_VERSION : '2.0.0',
      lang: typeof PA_LANG !== 'undefined' ? PA_LANG : 'tr',
      crs: 'WGS84 (EPSG:4326)',
      mapCenter: { ...S.mapCenter },
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
      mapPng,
      mapDataUrl,
      interactiveBasemapUrl,
      geoBounds,
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
