/**
 * Builds self-contained cinematic / mobile-safe spatial inspection playback HTML.
 * Exported reports use FieldSafeReplay (file:// compatible). Cinematic MapLibre is
 * optional in-app upgrade only when the host origin supports ES modules + workers.
 */
(function (global) {
  'use strict';

  const REPLAY_TEMPLATE_PATH = 'interaktif/Field_Journey_17_06_2026_interaktif.html';

  function coordLon(v) {
    if (!v) return NaN;
    return v.lon != null ? v.lon : v.lng;
  }

  function normTrackPath(verts) {
    return (verts || []).map(v => ({
      lat: v.lat,
      lon: coordLon(v),
      ts: v.ts || v.timestamp || '',
    })).filter(v => Number.isFinite(v.lat) && Number.isFinite(v.lon));
  }

  function prepareReplayPayload(payload) {
    const r = Object.assign({}, payload || {});
    if (!Array.isArray(r.events)) r.events = [];
    if (!r.bounds && r.geoBounds) r.bounds = r.geoBounds;
    if (r.basemapUrl && !/^data:image\//i.test(r.basemapUrl)) r.basemapUrl = '';

    const trLabel = r.lang === 'tr' ? 'GPS Rota' : 'GPS Route';
    let track = r.events.find(e => e?.kind === 'track' && e.path?.length >= 2) || null;

    if (track) {
      track = Object.assign({}, track, { path: normTrackPath(track.path) });
    } else if (r.track?.path?.length >= 2) {
      track = Object.assign({}, r.track, { kind: 'track', path: normTrackPath(r.track.path) });
    } else if (Array.isArray(r.track) && r.track[0]?.lat != null) {
      track = { id: 'track_1', kind: 'track', label: trLabel, path: normTrackPath(r.track) };
    } else if (r.project?.objects) {
      (r.project.objects || []).forEach(o => {
        if (track || o?.type !== 'field_gps_track' || !o.vertices || o.vertices.length < 2) return;
        track = {
          id: o.id || 'track_1',
          kind: 'track',
          label: o.label || trLabel,
          path: normTrackPath(o.vertices),
        };
      });
    }

    if (track?.path?.length >= 2) {
      r.track = track;
      if (!r.events.some(e => e?.kind === 'track')) {
        r.events = [track, ...r.events];
      } else {
        r.events = r.events.map(e => (e?.kind === 'track' ? track : e));
      }
    }
    return r;
  }

  function extractTemplateReport(tpl) {
    if (!tpl) return null;
    const winM = tpl.match(/window\.__PLANAI_REPORT__=([\s\S]*?);<\/script>/);
    if (winM) {
      try { return JSON.parse(winM[1]); } catch (e) { /* ignore */ }
    }
    const dataM = tpl.match(/id="planai-report-data">([\s\S]*?)<\/script>/);
    if (dataM) {
      try { return JSON.parse(dataM[1]); } catch (e) { /* ignore */ }
    }
    return null;
  }

  function mergeTemplateShellFields(prepared, tpl) {
    const ref = extractTemplateReport(tpl);
    if (!ref) return prepared;
    if (!prepared.basemapUrl && ref.basemapUrl && /^data:image\//i.test(ref.basemapUrl)) {
      prepared.basemapUrl = ref.basemapUrl;
    }
    if (!prepared.brandLogoUrl && ref.brandLogoUrl) prepared.brandLogoUrl = ref.brandLogoUrl;
    return prepared;
  }

  function preloadReplayTemplate() {
    return !!loadTemplateSync();
  }

  function loadTemplateSync() {
    if (global.__PLANAI_REPLAY_TEMPLATE__) return global.__PLANAI_REPLAY_TEMPLATE__;
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', REPLAY_TEMPLATE_PATH, false);
      xhr.send(null);
      if ((xhr.status === 200 || xhr.status === 0) && xhr.responseText) {
        global.__PLANAI_REPLAY_TEMPLATE__ = xhr.responseText;
        return xhr.responseText;
      }
    } catch (e) {
      console.warn('[FieldReplay] template load failed', e);
    }
    return null;
  }

  function buildFromTemplate(prepared, safePayload) {
    const tpl = loadTemplateSync();
    if (!tpl) return null;
    let html = global.FieldSafeReplay?.sanitizeShell
      ? global.FieldSafeReplay.sanitizeShell(tpl)
      : tpl;
    if (html.includes('window.__PLANAI_REPORT__=')) {
      html = html.replace(
        /<script>window\.__PLANAI_REPORT__=[\s\S]*?<\/script>/,
        '<script>window.__PLANAI_REPORT__=' + safePayload + ';<\/script>',
      );
    } else if (html.includes('id="planai-report-data"')) {
      html = html.replace(
        /(<script type="application\/json" id="planai-report-data">)[\s\S]*?(<\/script>)/,
        '$1' + safePayload + '$2',
      );
    } else {
      return null;
    }
    const title = escapeAttr((prepared.projectName || 'PlanAI Field') + ' — Inspection Replay');
    html = html.replace(/<title>[^<]*<\/title>/, '<title>' + title + '</title>');
    html = html.replace(/<html lang="[^"]*">/, '<html lang="' + (prepared.lang || 'en') + '">');
    return html;
  }

  function buildFromAssets(prepared, safePayload, opts) {
    const assets = global.FieldReplayAssets;
    if (!assets?.js) return null;
    if (global.FieldSafeReplay?.buildSafeReplayHtml) {
      return global.FieldSafeReplay.buildSafeReplayHtml(prepared, safePayload, {
        cinematicJs: opts?.includeCinematic ? assets.js : '',
      });
    }
    return '<!DOCTYPE html><html lang="' + (prepared.lang || 'en') + '"><head><meta charset="UTF-8"/>' +
      '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>' +
      '<title>' + escapeAttr((prepared.projectName || 'PlanAI Field') + ' — Inspection Replay') + '</title>' +
      '<style>' + assets.css + '</style></head><body>' +
      '<div id="root"></div>' +
      '<script>window.__PLANAI_REPORT__=' + safePayload + ';<\/script>' +
      '<script type="module">' + assets.js + '<\/script>' +
      '</body></html>';
  }

  /**
   * @param {object} payload
   * @param {{ includeCinematic?: boolean }} [opts] — cinematic bundle only for in-app https preview
   */
  function buildReplayHtml(payload, opts) {
    const tpl = loadTemplateSync();
    let prepared = prepareReplayPayload(payload);
    prepared = mergeTemplateShellFields(prepared, tpl);
    const safePayload = typeof ExportSafety !== 'undefined'
      ? ExportSafety.safeJsonInHtml(prepared)
      : JSON.stringify(prepared).replace(/</g, '\\u003c');

    if (global.FieldSafeReplay?.buildSafeReplayHtml) {
      const assets = global.FieldReplayAssets;
      return global.FieldSafeReplay.buildSafeReplayHtml(prepared, safePayload, {
        cinematicJs: (opts?.includeCinematic && assets?.js) ? assets.js : '',
      });
    }

    const fromTemplate = buildFromTemplate(prepared, safePayload);
    if (fromTemplate) return fromTemplate;

    const fromAssets = buildFromAssets(prepared, safePayload, opts);
    if (fromAssets) return fromAssets;

    console.warn('[FieldReplay] No safe replay or assets — check FieldSafeReplay.js');
    return null;
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  global.FieldCinematicReport = {
    buildReplayHtml,
    prepareReplayPayload,
    preloadReplayTemplate,
    detectReplayCapabilities: () => global.FieldSafeReplay?.detectReplayCapabilities?.() || {},
  };
})(typeof window !== 'undefined' ? window : globalThis);
