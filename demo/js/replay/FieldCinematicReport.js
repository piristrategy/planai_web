/**
 * Builds self-contained cinematic spatial inspection playback HTML from Field app data.
 * Uses the verified reference shell (MapLibre cinematic replay).
 */
(function (global) {
  'use strict';

  const REPLAY_TEMPLATE_PATHS = [
    'interaktif/Field_Journey_18_06_2026_interaktif.html',
    'interaktif/Field_Journey_17_06_2026_interaktif.html',
  ];

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
    if (!prepared.basemapUrl && ref.basemapUrl) prepared.basemapUrl = ref.basemapUrl;
    if (!prepared.brandLogoUrl && ref.brandLogoUrl) prepared.brandLogoUrl = ref.brandLogoUrl;
    return prepared;
  }

  function preloadReplayTemplate() {
    return !!loadTemplateSync();
  }

  function loadTemplateSync() {
    if (global.__PLANAI_REPLAY_TEMPLATE__) return global.__PLANAI_REPLAY_TEMPLATE__;
    for (let i = 0; i < REPLAY_TEMPLATE_PATHS.length; i++) {
      const path = REPLAY_TEMPLATE_PATHS[i];
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', path, false);
        xhr.send(null);
        if ((xhr.status === 200 || xhr.status === 0) && xhr.responseText) {
          global.__PLANAI_REPLAY_TEMPLATE__ = xhr.responseText;
          global.__PLANAI_REPLAY_TEMPLATE_PATH__ = path;
          return xhr.responseText;
        }
      } catch (e) {
        console.warn('[FieldReplay] template load failed:', path, e);
      }
    }
    return null;
  }

  function buildFromTemplate(prepared, safePayload) {
    const tpl = loadTemplateSync();
    if (!tpl) return null;
    let html = tpl;
    if (tpl.includes('window.__PLANAI_REPORT__=')) {
      html = html.replace(
        /<script>window\.__PLANAI_REPORT__=[\s\S]*?<\/script>/,
        '<script>window.__PLANAI_REPORT__=' + safePayload + ';<\/script>',
      );
    } else if (tpl.includes('id="planai-report-data"')) {
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
    return finishReplayHtml(html);
  }

  function buildFromAssets(prepared, safePayload) {
    const assets = global.FieldReplayAssets;
    if (!assets?.js) return null;
    const html = '<!DOCTYPE html><html lang="' + (prepared.lang || 'en') + '"><head><meta charset="UTF-8"/>' +
      '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>' +
      '<title>' + escapeAttr((prepared.projectName || 'PlanAI Field') + ' — Inspection Replay') + '</title>' +
      '<style>' + assets.css + '</style></head><body>' +
      '<div id="root"></div>' +
      '<script>window.__PLANAI_REPORT__=' + safePayload + ';<\/script>' +
      '<script type="module">' + assets.js + '<\/script>' +
      '</body></html>';
    return finishReplayHtml(html);
  }

  function exposeReplayMapInHtml(html) {
    if (!html || typeof html !== 'string') return html;
    if (html.includes('__PLANAI_REPLAY_MAP__=Y')) return html;
    const created = 'Y=new qf.Map({container:N.current,style:_b,bounds:[[Z.minLon,Z.minLat],[Z.maxLon,Z.maxLat]],fitBoundsOptions:{padding:48},attributionControl:!0});';
    if (!html.includes(created)) return html;
    return html.replace(
      created,
      created + 'try{Y.getContainer()._map=Y;window.__PLANAI_REPLAY_MAP__=Y}catch(e){};',
    );
  }

  function finishReplayHtml(html) {
    if (!html) return html;
    if (global.FieldSafeReplay?.stripExternalFonts) {
      html = global.FieldSafeReplay.stripExternalFonts(html);
    }
    html = exposeReplayMapInHtml(html);
    if (global.FieldReplaySafariRoute?.injectRouteFix) {
      html = global.FieldReplaySafariRoute.injectRouteFix(html);
    }
    return html;
  }

  function buildReplayHtml(payload) {
    const tpl = loadTemplateSync();
    let prepared = prepareReplayPayload(payload);
    prepared = mergeTemplateShellFields(prepared, tpl);
    const safePayload = typeof ExportSafety !== 'undefined'
      ? ExportSafety.safeJsonInHtml(prepared)
      : JSON.stringify(prepared).replace(/</g, '\\u003c');

    const fromTemplate = buildFromTemplate(prepared, safePayload);
    if (fromTemplate) return fromTemplate;

    const fromAssets = buildFromAssets(prepared, safePayload);
    if (fromAssets) return fromAssets;

    console.warn('[FieldReplay] No template or assets — check interaktif/ reference and FieldReplayAssets.js');
    return null;
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  global.FieldCinematicReport = {
    buildReplayHtml,
    prepareReplayPayload,
    preloadReplayTemplate,
    exposeReplayMapInHtml,
  };
})(typeof window !== 'undefined' ? window : globalThis);
