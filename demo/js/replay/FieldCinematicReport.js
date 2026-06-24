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

  const OFFLINE_LAUNCHER_SCRIPT = [
    '(function(){',
    '"use strict";',
    'function isIOS(){',
    'var ua=navigator.userAgent||"";',
    'var touchMac=navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1;',
    'return /iPad|iPhone|iPod/.test(ua)||touchMac;',
    '}',
    'function offline(){',
    'var p=(location.protocol||"").toLowerCase();',
    'if(p==="file:"||p==="content:"||p==="capacitor-file:"||p==="about:"||!p||p==="null:")return true;',
    'try{if(window.origin==="null"||location.origin==="null")return true;}catch(e){}',
    'return false;',
    '}',
    'function fail(msg){',
    'document.body.innerHTML="<p style=\\"padding:16px;font-family:system-ui,sans-serif;background:#0f1a28;color:#fff;line-height:1.5\\">PlanAI Field — "+String(msg||"Yüklenemedi")+"</p>";',
    '}',
    'function setStatus(msg){',
    'var s=document.getElementById("planai-launch-status");',
    'if(s)s.textContent=String(msg||"");',
    '}',
    'function collectPayload(){',
    'var chunks=document.querySelectorAll("script[id^=\\"planai-cinematic-chunk-\\"]");',
    'if(chunks&&chunks.length){',
    'var out="";',
    'for(var i=0;i<chunks.length;i++)out+=chunks[i].textContent||"";',
    'return out;',
    '}',
    'var el=document.getElementById("planai-cinematic-payload");',
    'return el?(el.textContent||""):"";',
    '}',
    'function readPayload(cb,attempt){',
    'attempt=attempt||0;',
    'var html=collectPayload();',
    'var lenEl=document.getElementById("planai-payload-len");',
    'var expected=lenEl?parseInt(lenEl.getAttribute("data-len")||"0",10):0;',
    'var minOk=expected>0?Math.floor(expected*0.92):500;',
    'if(!html||html.length<minOk){',
    'if(attempt<120){',
    'if(attempt%8===0)setStatus("PlanAI Field — yükleniyor… ("+Math.round((html?html.length:0)/1024)+" KB)");',
    'return setTimeout(function(){readPayload(cb,attempt+1);},150);',
    '}',
    'fail("Rapor verisi okunamadı ("+(html?html.length:0)+"/"+expected+" bayt)");',
    'return;',
    '}',
    'setStatus("PlanAI Field — başlatılıyor…");',
    'cb(html);',
    '}',
    'function mountFrame(html,src){',
    'document.body.innerHTML="";',
    'document.body.style.margin="0";',
    'document.body.style.background="#0f1a28";',
    'var f=document.createElement("iframe");',
    'f.setAttribute("title","PlanAI Field Replay");',
    'if(!isIOS())f.setAttribute("sandbox","allow-scripts allow-same-origin allow-popups");',
    'f.style.cssText="position:fixed;inset:0;border:0;width:100%;height:100%;background:#0f1a28";',
    'if(src)f.src=src;',
    'else f.srcdoc=html;',
    'document.body.appendChild(f);',
    '}',
    'function launch(html){',
    'try{',
    'if(!offline()){',
    'document.open("text/html","replace");',
    'document.write(html);',
    'document.close();',
    'return;',
    '}',
    'var blobUrl="";',
    'try{blobUrl=URL.createObjectURL(new Blob([html],{type:"text/html;charset=utf-8"}));}catch(e){}',
    'if(isIOS()){',
    'if(blobUrl)mountFrame("",blobUrl);',
    'else mountFrame(html);',
    'return;',
    '}',
    'if(blobUrl){',
    'try{location.replace(blobUrl);return;}catch(e){}',
    'mountFrame("",blobUrl);',
    'return;',
    '}',
    'mountFrame(html);',
    '}catch(e){fail(e&&e.message?e.message:e);}',
    '}',
    'function run(){readPayload(launch);}',
    'if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",run);',
    'else setTimeout(run,0);',
    '})();',
  ].join('');

  const PAYLOAD_CHUNK_BYTES = 380000;

  function escapePayloadForEmbed(html) {
    return String(html).replace(/<\/script/gi, '<\\/script');
  }

  function buildPayloadEmbed(html) {
    const payload = escapePayloadForEmbed(html);
    if (payload.length <= PAYLOAD_CHUNK_BYTES) {
      return '<script type="text/plain" id="planai-cinematic-payload">' + payload + '</script>';
    }
    let embed = '<span id="planai-payload-len" data-len="' + payload.length + '" hidden></span>';
    for (let i = 0, part = 0; i < payload.length; i += PAYLOAD_CHUNK_BYTES, part++) {
      const chunk = payload.slice(i, i + PAYLOAD_CHUNK_BYTES);
      embed += '<script type="text/plain" id="planai-cinematic-chunk-' + part + '">' + chunk + '</script>';
    }
    return embed;
  }

  /** iOS Files / file:// cannot run MapLibre cinematic inline — relaunch inner HTML on blob: URL. */
  function wrapOfflineFileLauncher(html) {
    if (!html || typeof html !== 'string') return html;
    if (html.includes('id="planai-offline-launcher"')) return html;
    if (!html.includes('window.__PLANAI_REPORT__')) return html;
    const titleM = html.match(/<title>([^<]*)<\/title>/i);
    const title = titleM ? titleM[1] : 'PlanAI Field — Inspection Replay';
    return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>' +
      '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>' +
      '<meta name="color-scheme" content="dark light"/>' +
      '<title>' + title.replace(/</g, '') + '</title>' +
      '<style>body{margin:0;background:#0f1a28;color:#e8eef4;font-family:system-ui,-apple-system,sans-serif}' +
      '#planai-launch-status{padding:16px;text-align:center}</style></head><body>' +
      '<p id="planai-launch-status">PlanAI Field — yükleniyor…</p>' +
      buildPayloadEmbed(html) +
      '<script id="planai-offline-launcher">' + OFFLINE_LAUNCHER_SCRIPT + '<\/script>' +
      '</body></html>';
  }

  function demoteModuleScripts(html) {
    if (!html) return html;
    return html.replace(/<script([^>]*)\s+type=["']module["']/gi, '<script$1');
  }

  function collectEmbeddedPayload(html) {
    if (!html || typeof html !== 'string') return '';
    const chunkRe = /<script[^>]*\sid=["']planai-cinematic-chunk-(\d+)["'][^>]*>([\s\S]*?)<\/script>/gi;
    const chunks = [];
    let m;
    while ((m = chunkRe.exec(html)) !== null) {
      chunks[+m[1]] = m[2];
    }
    if (chunks.length) return chunks.join('');
    const single = html.match(/<script[^>]*\sid=["']planai-cinematic-payload["'][^>]*>([\s\S]*?)<\/script>/i);
    return single ? single[1] : '';
  }

  /** Strip offline launcher shell — used for in-app preview of saved/shared exports. */
  function unwrapOfflineLauncher(html) {
    if (!html || typeof html !== 'string') return html;
    if (!html.includes('id="planai-offline-launcher"')) return html;
    const inner = collectEmbeddedPayload(html);
    return inner && inner.length > 500 ? inner : html;
  }

  function finishReplayHtml(html, opts) {
    if (!html) return html;
    if (global.FieldSafeReplay?.stripMobileFallback) {
      html = global.FieldSafeReplay.stripMobileFallback(html);
    }
    if (global.FieldSafeReplay?.stripExternalFonts) {
      html = global.FieldSafeReplay.stripExternalFonts(html);
    }
    html = demoteModuleScripts(html);
    html = exposeReplayMapInHtml(html);
    if (global.FieldReplaySafariRoute?.injectRouteFix) {
      html = global.FieldReplaySafariRoute.injectRouteFix(html);
    }
    if (opts && opts.forShare) {
      return wrapOfflineFileLauncher(html);
    }
    return html;
  }

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

  function buildFromTemplate(prepared, safePayload, opts) {
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
    return finishReplayHtml(html, opts);
  }

  function buildFromAssets(prepared, safePayload, opts) {
    const assets = global.FieldReplayAssets;
    if (!assets?.js) return null;
    const html = '<!DOCTYPE html><html lang="' + (prepared.lang || 'en') + '"><head><meta charset="UTF-8"/>' +
      '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>' +
      '<title>' + escapeAttr((prepared.projectName || 'PlanAI Field') + ' — Inspection Replay') + '</title>' +
      '<style>' + assets.css + '</style></head><body>' +
      '<div id="root"></div>' +
      '<script>window.__PLANAI_REPORT__=' + safePayload + ';<\/script>' +
      '<script>' + assets.js + '<\/script>' +
      '</body></html>';
    return finishReplayHtml(html, opts);
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

  function buildReplayHtml(payload, opts) {
    const tpl = loadTemplateSync();
    let prepared = prepareReplayPayload(payload);
    prepared = mergeTemplateShellFields(prepared, tpl);
    const safePayload = typeof ExportSafety !== 'undefined'
      ? ExportSafety.safeJsonInHtml(prepared)
      : JSON.stringify(prepared).replace(/</g, '\\u003c');

    const fromTemplate = buildFromTemplate(prepared, safePayload, opts);
    if (fromTemplate) return fromTemplate;

    const fromAssets = buildFromAssets(prepared, safePayload, opts);
    if (fromAssets) return fromAssets;

    console.warn('[FieldReplay] No template or assets — check interaktif/ reference and FieldReplayAssets.js');
    return null;
  }

  function wrapForOfflineShare(html) {
    return wrapOfflineFileLauncher(html);
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  global.FieldCinematicReport = {
    buildReplayHtml,
    prepareReplayPayload,
    preloadReplayTemplate,
    exposeReplayMapInHtml,
    unwrapOfflineLauncher,
    wrapForOfflineShare,
  };
})(typeof window !== 'undefined' ? window : globalThis);
