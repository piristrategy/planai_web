/**
 * PlanAI Field — demo PDF + mekansal inceleme tekrarı simülasyonu (gerçek saha verisi gerekmez).
 */
(function (global) {
  'use strict';

  const DEMO_CENTER = { lat: 39.0812, lon: 26.8845 };

  const DEMO_I18N = {
    tr: {
      mapLabel: 'Demo saha inceleme',
      simTag: '[Simülasyon]',
      projectSuffix: 'Demo Saha Gezisi',
      user: 'Demo Kullanıcı',
      track: 'GPS Rota',
      photos: [
        { caption: 'Giriş cephesi — cephe kaplaması ve drenaj detayı incelendi.', label: 'Foto 1 · Cephe' },
        { caption: 'Otopark alanı — sınır işaretlemesi ve eğim gözlemi.', label: 'Foto 2 · Otopark' },
        { caption: 'Yeşil alan kenarı — ağaç koridoru ve erişim yolu.', label: 'Foto 3 · Yeşil' },
      ],
      notes: [
        'Ana giriş güneybatı cephesinde rutubet izi gözlendi. Detay fotoğraf alındı.',
        'Otopark kotu yol seviyesinden ~15 cm yüksek. Drenaj oluğu temizlenmeli.',
      ],
      measures: [
        { kind: 'polyline', label: 'Yürüyüş rotası (demo)' },
        { kind: 'polygon', label: 'İnceleme alanı (demo)' },
      ],
      progress: {
        build: 'Demo verisi oluşturuluyor…',
        satellite: 'Uydu altlığı hazırlanıyor…',
        pdf: 'PDF rapor sayfası…',
        interactive: 'Mekansal inceleme tekrarı…',
        pdfGen: 'PDF üretiliyor…',
        done: 'Tamamlandı',
      },
    },
    en: {
      mapLabel: 'Demo field inspection',
      simTag: '[Simulation]',
      projectSuffix: 'Demo Field Journey',
      user: 'Demo User',
      track: 'GPS Route',
      photos: [
        { caption: 'Main entrance — facade cladding and drainage detail inspected.', label: 'Photo 1 · Facade' },
        { caption: 'Parking area — boundary marking and slope observation.', label: 'Photo 2 · Parking' },
        { caption: 'Green area edge — tree corridor and access path.', label: 'Photo 3 · Green' },
      ],
      notes: [
        'Moisture trace observed on the southwest facade at the main entrance. Detail photo captured.',
        'Parking level is ~15 cm above road grade. Drainage channel needs cleaning.',
      ],
      measures: [
        { kind: 'polyline', label: 'Walk route (demo)' },
        { kind: 'polygon', label: 'Inspection area (demo)' },
      ],
      progress: {
        build: 'Building demo data…',
        satellite: 'Preparing satellite basemap…',
        pdf: 'PDF report pages…',
        interactive: 'Spatial inspection playback…',
        pdfGen: 'Generating PDF…',
        done: 'Complete',
      },
    },
  };

  function demoLang(opts) {
    return opts?.lang === 'en' ? 'en' : 'tr';
  }

  function demoSvgPhoto(label, bg) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
      '<stop offset="0%" stop-color="' + bg + '"/><stop offset="100%" stop-color="#1a3358"/></linearGradient></defs>' +
      '<rect width="480" height="360" fill="url(#g)"/>' +
      '<text x="240" y="175" text-anchor="middle" fill="#fff" font-family="Segoe UI,sans-serif" font-size="22" font-weight="700">' +
      label + '</text><text x="240" y="205" text-anchor="middle" fill="rgba(255,255,255,.75)" font-size="12">PlanAI Field · Demo</text></svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  function demoMapSvg(center, feats, mapLabel) {
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    feats.forEach(f => {
      minLat = Math.min(minLat, f.lat); maxLat = Math.max(maxLat, f.lat);
      minLon = Math.min(minLon, f.lon); maxLon = Math.max(maxLon, f.lon);
      if (f.path) {
        f.path.forEach(p => {
          minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
          minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
        });
      }
    });
    const pad = 0.18;
    const dLat = (maxLat - minLat) * pad || 0.003, dLon = (maxLon - minLon) * pad || 0.003;
    minLat -= dLat; maxLat += dLat; minLon -= dLon; maxLon += dLon;
    const proj = (lat, lon) => ({
      x: ((lon - minLon) / (maxLon - minLon || 1)) * 920,
      y: ((maxLat - lat) / (maxLat - minLat || 1)) * 520,
    });
    let body = '<rect width="960" height="560" fill="#dce8f4"/>';
    body += '<text x="16" y="28" font-size="13" fill="#5a6a7a" font-family="Segoe UI,sans-serif">' + mapLabel + ' — ' +
      center.lat.toFixed(4) + '°, ' + center.lon.toFixed(4) + '°</text>';
    feats.forEach(f => {
      if (f.path?.length >= 2) {
        const pts = f.path.map(p => { const q = proj(p.lat, p.lon); return q.x + ',' + q.y; }).join(' ');
        body += '<polyline points="' + pts + '" fill="none" stroke="#1565c0" stroke-width="5" opacity=".9"/>';
      } else {
        const q = proj(f.lat, f.lon);
        body += '<circle cx="' + q.x + '" cy="' + q.y + '" r="10" fill="' + (f.col || '#e67e22') + '" stroke="#fff" stroke-width="3"/>';
      }
    });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 560">' + body + '</svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  function isoMinutesAgo(m) {
    return new Date(Date.now() - m * 60000).toISOString();
  }

  function buildDemoPayload(opts) {
    const lang = demoLang(opts);
    const i18n = DEMO_I18N[lang];
    const center = opts.mapCenter?.lat != null ? opts.mapCenter : DEMO_CENTER;
    const now = new Date().toISOString();
    const track = [
      { lat: center.lat + 0.0012, lon: center.lon - 0.0008, ts: isoMinutesAgo(42) },
      { lat: center.lat + 0.0006, lon: center.lon - 0.0002, ts: isoMinutesAgo(35) },
      { lat: center.lat + 0.0001, lon: center.lon + 0.0004, ts: isoMinutesAgo(28) },
      { lat: center.lat - 0.0005, lon: center.lon + 0.0010, ts: isoMinutesAgo(18) },
      { lat: center.lat - 0.0009, lon: center.lon + 0.0003, ts: isoMinutesAgo(8) },
    ];
    const photoBgs = ['#c0392b', '#d35400', '#27ae60'];
    const photos = i18n.photos.map((p, idx) => ({
      id: 'demo_ph_' + (idx + 1),
      photoNum: idx + 1,
      lat: [center.lat + 0.0008, center.lat + 0.0002, center.lat - 0.0007][idx],
      lon: [center.lon - 0.0005, center.lon + 0.0006, center.lon + 0.0009][idx],
      timestamp: isoMinutesAgo([40, 25, 12][idx]),
      accuracy: [4.2, 3.8, 5.1][idx],
      caption: p.caption,
      imageDataUrl: demoSvgPhoto(p.label, photoBgs[idx]),
      hasVoice: idx === 1,
      voiceDuration: idx === 1 ? 12 : 0,
    }));
    const notes = i18n.notes.map((text, idx) => ({
      id: 'demo_n_' + (idx + 1),
      noteNum: idx + 1,
      lat: [center.lat + 0.0005, center.lat - 0.0004][idx],
      lon: [center.lon - 0.0001, center.lon + 0.0005][idx],
      timestamp: isoMinutesAgo([32, 15][idx]),
      text,
      handwritingDataUrl: '',
    }));
    const measurements = {
      items: [
        { kind: 'polyline', label: i18n.measures[0].label, lengthM: 186.4, perimeterM: 186.4 },
        { kind: 'polygon', label: i18n.measures[1].label, areaM2: 3240, perimeterM: 248.6 },
      ],
      totals: { totalPolylineM: 186.4, totalPolygonAreaM2: 3240 },
    };
    const mapFeats = photos.map(p => ({ lat: p.lat, lon: p.lon, col: '#e67e22' }))
      .concat(notes.map(n => ({ lat: n.lat, lon: n.lon, col: '#1a73e8' })))
      .concat([{ path: track, col: '#1565c0' }]);
    const mapDataUrl = demoMapSvg(center, mapFeats, i18n.mapLabel);
    const project = {
      id: opts.projectId || 'demo_prj',
      name: (opts.projectName || i18n.projectSuffix) + ' ' + i18n.simTag,
      createdAt: opts.projectCreatedAt || now,
      updatedAt: now,
      objects: [{
        type: 'field_gps_track', id: 'demo_track_1', label: i18n.track,
        vertices: track,
      }],
      measurements,
    };
    const meta = {
      templateId: opts.templateId || 'field-saha-v1',
      generatedAt: now,
      appVersion: opts.appVersion || 'demo',
      lang,
      crs: 'WGS84 (EPSG:4326)',
      mapCenter: { ...center },
      gpsAccuracy: 4.5,
      userName: opts.userName || i18n.user,
      objectCounts: { total: 6, photos: 3, notes: 2, sketch: 0, imports: 0 },
      measurements,
      simulation: true,
    };
    return { project, meta, photos, notes, measurements, mapDataUrl, track, lang };
  }

  async function generate(options) {
    const opts = options || {};
    const lang = demoLang(opts);
    const i18n = DEMO_I18N[lang];
    const prog = (p, s) => { if (opts.onProgress) opts.onProgress(p, s); };
    const buildReportHTML = opts.buildReportHTML;
    const buildInteractive = opts.buildInteractiveFieldReportHTML;
    const exportPdf = opts.exportProjectPDF;
    if (!buildReportHTML || !buildInteractive) {
      throw new Error('Report builders missing');
    }

    prog(10, i18n.progress.build);
    const demo = buildDemoPayload(opts);
    await new Promise(r => setTimeout(r, 120));

    prog(25, i18n.progress.satellite);
    let interactiveBasemapUrl = '';
    if (opts.computeReportGeoBounds && opts.buildSatelliteBasemapDataUrl) {
      const bounds = opts.computeReportGeoBounds(demo.photos, demo.notes, demo.project, demo.meta.mapCenter);
      try {
        interactiveBasemapUrl = await opts.buildSatelliteBasemapDataUrl(bounds);
      } catch (e) {
        console.warn('[Demo satellite]', e);
      }
    }
    if (!interactiveBasemapUrl) interactiveBasemapUrl = demo.mapDataUrl;

    let brandLogoUrl = '';
    if (opts.loadBrandLogoDataUrl) {
      try { brandLogoUrl = await opts.loadBrandLogoDataUrl(); } catch (_) {}
    }

    prog(45, i18n.progress.pdf);
    const html = buildReportHTML({
      project: demo.project,
      meta: demo.meta,
      mapDataUrl: demo.mapDataUrl,
      photos: demo.photos,
      notes: demo.notes,
      measurements: demo.measurements,
      brandLogoUrl,
    });

    prog(70, i18n.progress.interactive);
    const geoBounds = opts.computeReportGeoBounds
      ? opts.computeReportGeoBounds(demo.photos, demo.notes, demo.project, demo.meta.mapCenter)
      : null;
    const reportBundle = {
      html,
      pdfBlob: null,
      mapPng: null,
      mapDataUrl: demo.mapDataUrl,
      interactiveBasemapUrl,
      brandLogoUrl,
      geoBounds,
      track: demo.track,
      snap: demo.project,
      project: demo.project,
      meta: demo.meta,
      photos: demo.photos,
      notes: demo.notes,
      measurements: demo.measurements,
      lang: demo.lang,
    };
    const interactiveHtml = typeof buildInteractive === 'function'
      ? await Promise.resolve(buildInteractive(reportBundle))
      : '';

    prog(88, i18n.progress.pdfGen);
    if (exportPdf) {
      try {
        reportBundle.pdfBlob = await exportPdf(html);
      } catch (e) {
        console.warn('[Demo PDF]', e);
      }
    }

    prog(100, i18n.progress.done);
    reportBundle.interactiveHtml = interactiveHtml;
    return reportBundle;
  }

  global.FieldReportSimulation = { generate, buildDemoPayload, DEMO_CENTER };
})(typeof window !== 'undefined' ? window : globalThis);
