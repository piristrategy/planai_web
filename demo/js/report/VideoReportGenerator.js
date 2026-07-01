'use strict';
/**
 * PlanAI Field — Cinematic video report (MP4/WebM).
 * Mirrors interactive cinematic replay: timeline, context bar, AI insights,
 * GPS chase camera, and detail overlays for every event type.
 */
const VideoReportGenerator = (function () {
  const W = 1280;
  const H = 720;
  const FPS = 24;
  const VIDEO_BPS = 2800000;
  const MAX_TOTAL_SEC = 240;
  const MAX_VIDEO_CLIP_SEC = 10;

  const COLORS = {
    bg: '#0f1a28',
    panel: 'rgba(12, 18, 26, 0.92)',
    text: '#e8eef4',
    muted: '#8a96a6',
    accent: '#40c057',
    cyan: '#5eead4',
    warn: '#f59e0b',
    critical: '#ef4444',
    route: 'rgba(21, 101, 192, 0.92)',
  };

  function pickVideoMime() {
    const types = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    for (let i = 0; i < types.length; i++) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(types[i])) return types[i];
    }
    return '';
  }

  function videoExtFromMime(mime) {
    return mime && mime.indexOf('mp4') >= 0 ? '.mp4' : '.webm';
  }

  function waitMs(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function loadImage(src) {
    return new Promise(resolve => {
      if (!src) return resolve(null);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function coordLon(v) {
    if (!v) return NaN;
    return v.lon != null ? v.lon : v.lng;
  }

  function interpolatePath(path, t) {
    if (!path || path.length < 1) return null;
    if (path.length < 2) return { lat: path[0].lat, lon: coordLon(path[0]), index: 0 };
    const prog = Math.min(1, Math.max(0, t)) * (path.length - 1);
    const i0 = Math.floor(prog);
    const frac = prog - i0;
    const i1 = Math.min(path.length - 1, i0 + 1);
    const a = path[i0];
    const b = path[i1];
    return {
      lat: a.lat + (b.lat - a.lat) * frac,
      lon: coordLon(a) + (coordLon(b) - coordLon(a)) * frac,
      index: i0,
    };
  }

  function projPt(lat, lon, bounds) {
    return {
      x: ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon || 1)) * W,
      y: ((bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat || 1)) * H,
    };
  }

  function wrapLines(ctx, text, maxW, maxLines) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    words.forEach(w => {
      const test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) {
        lines.push(line);
        line = w;
      } else line = test;
    });
    if (line) lines.push(line);
    return lines.slice(0, maxLines || 8);
  }

  function fmtDateTime(iso, tr) {
    if (!iso) return '—';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(tr ? 'tr-TR' : 'en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
        + ' ' + d.toLocaleTimeString(tr ? 'tr-TR' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
    } catch (_) {
      return '—';
    }
  }

  function timelineFromPayload(payload) {
    return (payload.events || []).filter(e => e && e.kind !== 'track');
  }

  function computeEventSchedule(path, timeline) {
    if (!timeline.length) return [];
    if (!path || path.length < 2) {
      return timeline.map((event, i) => ({
        event,
        t: (i + 1) / (timeline.length + 1),
      }));
    }
    const start = Date.parse(path[0].ts || '') || 0;
    const end = Date.parse(path[path.length - 1].ts || '') || start + 1;
    const span = end - start || 1;
    return timeline.map(event => {
      const ts = Date.parse(event.ts || '') || start;
      return {
        event,
        t: Math.min(0.985, Math.max(0.01, (ts - start) / span)),
      };
    });
  }

  function overlayDuration(event) {
    const k = event?.kind;
    if (k === 'start' || k === 'end') return 2.8;
    if (k === 'photo') return 3.6;
    if (k === 'note') return 3.6;
    if (k === 'audio') return Math.min(5.5, Math.max(3, (event.voiceDuration || 3) + 1));
    if (k === 'videoNote') return Math.min(MAX_VIDEO_CLIP_SEC, Math.max(4, event.duration || 6));
    return 3;
  }

  function severityColor(sev) {
    if (sev === 'critical') return COLORS.critical;
    if (sev === 'warning') return COLORS.warn;
    return COLORS.cyan;
  }

  function preparePayload(raw) {
    let payload = raw || {};
    if (typeof FieldCinematicReport !== 'undefined' && FieldCinematicReport.prepareReplayPayload) {
      payload = FieldCinematicReport.prepareReplayPayload(payload);
    }
    if (!payload.bounds && payload.geoBounds) payload.bounds = payload.geoBounds;
    return payload;
  }

  function buildPlaybackPlan(payload) {
    const tr = payload.lang === 'tr';
    const path = payload.track?.path || [];
    const timeline = timelineFromPayload(payload);
    const schedule = computeEventSchedule(path, timeline);
    const stats = payload.stats || {};
    const insights = (payload.insights || []).filter(Boolean);

    const segments = [];
    let budget = MAX_TOTAL_SEC;

    const introDur = 4.2;
    segments.push({ type: 'intro', duration: introDur, tr, stats, title: payload.projectName, ctx: payload.inspectionContext });
    budget -= introDur;

    if (insights.length && budget > 10) {
      const insDur = Math.min(budget * 0.2, Math.max(6, insights.length * 2.2));
      segments.push({ type: 'insights', duration: insDur, tr, insights });
      budget -= insDur;
    }

    const cinematicDur = Math.max(18, Math.min(budget - 3.5, Math.max(24, (stats.durationMin || 12) * 1.8)));
    segments.push({
      type: 'cinematic',
      duration: cinematicDur,
      tr,
      path,
      bounds: payload.bounds || payload.geoBounds,
      schedule,
      stats,
      ctx: payload.inspectionContext,
    });
    budget -= cinematicDur;

    segments.push({ type: 'outro', duration: Math.min(3.5, Math.max(2.5, budget)), tr, stats, insights });
    return segments;
  }

  function drawGlassPanel(ctx, x, y, w, h, radius) {
    radius = radius ?? 14;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
    ctx.fillStyle = COLORS.panel;
    ctx.fill();
    ctx.strokeStyle = 'rgba(64, 192, 87, 0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  function drawContextBar(ctx, ctxData, tr) {
    if (!ctxData) return;
    const h = 44;
    ctx.fillStyle = 'rgba(12, 18, 26, 0.94)';
    ctx.fillRect(0, 0, W, h);
    ctx.fillStyle = 'rgba(64, 192, 87, 0.45)';
    ctx.fillRect(0, h - 1, W, 1);
    const loc = [ctxData.locationLine1, ctxData.locationLine2].filter(v => v && v !== '—').join(' · ') || '—';
    const items = [
      { label: tr ? 'Konum' : 'Location', value: loc },
      { label: tr ? 'Başlangıç' : 'Start', value: fmtDateTime(ctxData.startTime, tr) },
      { label: tr ? 'Bitiş' : 'End', value: fmtDateTime(ctxData.endTime, tr) },
      { label: tr ? 'Rakım' : 'Altitude', value: ctxData.altitude || '—' },
    ];
    ctx.font = '600 10px system-ui, sans-serif';
    let x = 14;
    items.forEach(it => {
      ctx.fillStyle = COLORS.muted;
      ctx.fillText(it.label.toUpperCase(), x, 16);
      ctx.fillStyle = COLORS.accent;
      ctx.font = '700 12px system-ui, sans-serif';
      const val = String(it.value).length > 36 ? String(it.value).slice(0, 34) + '…' : String(it.value);
      ctx.fillText(val, x, 32);
      ctx.font = '600 10px system-ui, sans-serif';
      x += Math.min(220, ctx.measureText(val).width + 48);
    });
  }

  function drawHeaderChip(ctx, title, sub) {
    drawGlassPanel(ctx, 14, 52, Math.min(420, W - 28), 48, 12);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.fillText('PLANAI FIELD', 26, 70);
    ctx.fillStyle = COLORS.text;
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.fillText(String(title || 'PlanAI Field').slice(0, 42), 26, 90);
    if (sub) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.fillText(sub, W - ctx.measureText(sub).width - 20, 82);
    }
  }

  function drawIntro(ctx, seg, logo) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0f1a28');
    g.addColorStop(1, '#1a3358');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    if (logo) ctx.drawImage(logo, (W - 88) / 2, H * 0.12, 88, 88);
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.text;
    ctx.font = 'bold 38px system-ui, sans-serif';
    const title = seg.title || (seg.tr ? 'Saha İncelemesi' : 'Field Inspection');
    ctx.fillText(title.length > 44 ? title.slice(0, 42) + '…' : title, W / 2, H * 0.34);
    const s = seg.stats || {};
    ctx.font = '600 17px system-ui, sans-serif';
    ctx.fillStyle = COLORS.muted;
    const line1 = seg.tr
      ? `${(s.routeKm || 0).toFixed(1)} km · ${s.photoCount || 0} foto · ${s.videoNoteCount || 0} video · ${s.noteCount || 0} not`
      : `${(s.routeKm || 0).toFixed(1)} km · ${s.photoCount || 0} photos · ${s.videoNoteCount || 0} videos · ${s.noteCount || 0} notes`;
    ctx.fillText(line1, W / 2, H * 0.42);
    const gridY = H * 0.5;
    const cols = [
      [seg.tr ? 'Süre' : 'Duration', Math.round(s.durationMin || 0) + (seg.tr ? ' dk' : ' min')],
      [seg.tr ? 'Ses notu' : 'Voice', String(s.voiceNoteCount || 0)],
      [seg.tr ? 'GPS' : 'GPS', s.gpsQuality || '—'],
      [seg.tr ? 'Hız' : 'Speed', (s.avgSpeedKmh || 0).toFixed(1) + ' km/h'],
    ];
    const gw = 260;
    const gh = 56;
    const positions = [
      [W / 2 - gw - 8, gridY],
      [W / 2 + 8, gridY],
      [W / 2 - gw - 8, gridY + gh + 12],
      [W / 2 + 8, gridY + gh + 12],
    ];
    cols.forEach((col, i) => {
      const px = positions[i][0];
      const py = positions[i][1];
      drawGlassPanel(ctx, px, py, gw, gh, 10);
      ctx.textAlign = 'left';
      ctx.fillStyle = COLORS.muted;
      ctx.font = '600 10px system-ui, sans-serif';
      ctx.fillText(col[0].toUpperCase(), px + 14, py + 22);
      ctx.fillStyle = COLORS.accent;
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.fillText(col[1], px + 14, py + 44);
    });
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.accent;
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.fillText(seg.tr ? 'Sinematik Video Rapor' : 'Cinematic Video Report', W / 2, H * 0.82);
    ctx.textAlign = 'left';
  }

  function drawInsights(ctx, seg, t) {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, W, H);
    drawContextBar(ctx, null, seg.tr);
    drawHeaderChip(ctx, seg.tr ? 'AI Özet' : 'AI Summary', 'PlanAI Field');
    const insights = seg.insights || [];
    const visible = Math.min(insights.length, Math.ceil(t * insights.length) || 1);
    const startY = 120;
    insights.slice(0, visible).forEach((txt, i) => {
      const y = startY + i * 72;
      drawGlassPanel(ctx, 40, y, W - 80, 58, 12);
      ctx.fillStyle = COLORS.accent;
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.fillText('◆', 56, y + 36);
      ctx.fillStyle = COLORS.text;
      ctx.font = '600 15px system-ui, sans-serif';
      const lines = wrapLines(ctx, txt, W - 130, 2);
      lines.forEach((ln, li) => ctx.fillText(ln, 80, y + 26 + li * 20));
    });
  }

  function drawPath(ctx, path, bounds, upto) {
    if (!path || path.length < 2) return;
    const end = Math.max(1, Math.min(path.length, Math.ceil(upto)));
    ctx.beginPath();
    for (let i = 0; i < end; i++) {
      const p = projPt(path[i].lat, coordLon(path[i]), bounds);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.strokeStyle = COLORS.route;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  function drawMarker(ctx, lat, lon, bounds, color, r) {
    const p = projPt(lat, lon, bounds);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r || 10, 0, Math.PI * 2);
    ctx.fillStyle = color || COLORS.accent;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }

  function chaseViewBounds(lat, lon, span) {
    span = span || 0.0014;
    return {
      minLat: lat - span,
      maxLat: lat + span,
      minLon: lon - span * 1.25,
      maxLon: lon + span * 1.25,
    };
  }

  function drawMapChase(ctx, seg, routeT, basemap, fullBounds, assets) {
    const path = seg.path || [];
    const fb = fullBounds || { minLat: 39, maxLat: 39.01, minLon: 32, maxLon: 32.01 };
    const pos = path.length
      ? interpolatePath(path, routeT)
      : { lat: (fb.minLat + fb.maxLat) / 2, lon: (fb.minLon + fb.maxLon) / 2 };
    const view = path.length >= 2
      ? chaseViewBounds(pos.lat, pos.lon)
      : fb;
    ctx.fillStyle = '#1a2838';
    ctx.fillRect(0, 0, W, H);
    if (basemap && fullBounds) {
      const sx = ((view.minLon - fullBounds.minLon) / (fullBounds.maxLon - fullBounds.minLon || 1)) * basemap.width;
      const sy = ((fullBounds.maxLat - view.maxLat) / (fullBounds.maxLat - fullBounds.minLat || 1)) * basemap.height;
      const sw = ((view.maxLon - view.minLon) / (fullBounds.maxLon - fullBounds.minLon || 1)) * basemap.width;
      const sh = ((view.maxLat - view.minLat) / (fullBounds.maxLat - fullBounds.minLat || 1)) * basemap.height;
      ctx.drawImage(basemap, sx, sy, sw, sh, 0, 44, W, H - 44);
    } else if (basemap) {
      ctx.drawImage(basemap, 0, 44, W, H - 44);
    }
    if (path.length >= 2) {
      drawPath(ctx, path, view, (routeT * (path.length - 1)) + 1);
      drawMarker(ctx, pos.lat, pos.lon, view, COLORS.accent, 11);
    }
    (seg.schedule || []).forEach(({ event }) => {
      if (event.lat == null || event.lon == null) return;
      const col = event.kind === 'photo' ? '#e67e22' : event.kind === 'videoNote' ? '#8e44ad' : event.kind === 'note' ? '#1a73e8' : '#546e7a';
      drawMarker(ctx, event.lat, event.lon, view, col, 7);
    });
  }

  function drawDetailOverlay(ctx, event, assets, tr, localT) {
    const pad = 24;
    const cardW = Math.min(420, W - 48);
    const cardH = Math.min(380, H - 120);
    const x = W - cardW - pad;
    const y = 108;
    drawGlassPanel(ctx, x, y, cardW, cardH, 16);
    const kindLabel = {
      start: tr ? 'İnceleme Başladı' : 'Inspection Started',
      end: tr ? 'İnceleme Tamamlandı' : 'Inspection Completed',
      photo: tr ? 'Fotoğraf' : 'Photo',
      note: tr ? 'Saha Notu' : 'Field Note',
      audio: tr ? 'Sesli Not' : 'Voice Note',
      videoNote: tr ? 'Video Not' : 'Video Note',
    }[event.kind] || event.label || '';
    ctx.fillStyle = COLORS.muted;
    ctx.font = '600 9px system-ui, sans-serif';
    ctx.fillText((tr ? 'DETAY KARTI' : 'DETAIL CARD'), x + 16, y + 22);
    ctx.fillStyle = COLORS.text;
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.fillText(String(event.label || kindLabel).slice(0, 32), x + 16, y + 44);
    if (event.severity) {
      ctx.fillStyle = severityColor(event.severity);
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.fillText(String(event.severity).toUpperCase(), x + 16, y + 62);
    }
    let textY = y + 86;
    if (event.kind === 'photo' || event.kind === 'audio') {
      const img = assets.photoCache.get(event.id) || assets.photoCache.get(event.id?.replace(/_voice$/, ''));
      if (img) {
        const iw = cardW - 32;
        const ih = 140;
        const scale = Math.min(iw / img.width, ih / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(img, x + 16 + (iw - dw) / 2, textY, dw, dh);
        textY += ih + 10;
      }
      if (event.kind === 'audio') {
        ctx.fillStyle = COLORS.cyan;
        ctx.font = '600 13px system-ui, sans-serif';
        ctx.fillText('🎤 ' + (tr ? 'Ses kaydı' : 'Voice recording') + ' · ' + Math.round(event.voiceDuration || 0) + 's', x + 16, textY);
        textY += 22;
      }
    }
    if (event.kind === 'videoNote' && event.videoDataUrl) {
      const vid = assets.videoCache.get(event.id);
      if (vid && vid.videoWidth) {
        const iw = cardW - 32;
        const ih = 150;
        const scale = Math.min(iw / vid.videoWidth, ih / vid.videoHeight);
        try {
          ctx.drawImage(vid, x + 16, textY, vid.videoWidth * scale, vid.videoHeight * scale);
        } catch (_) {}
        textY += ih + 8;
      }
    }
    const body = event.text || event.description || '';
    if (body) {
      ctx.fillStyle = 'rgba(255,255,255,0.72)';
      ctx.font = '600 14px system-ui, sans-serif';
      wrapLines(ctx, body, cardW - 32, 5).forEach((ln, i) => ctx.fillText(ln, x + 16, textY + i * 20));
    }
    if (event.lat != null && event.lon != null) {
      ctx.fillStyle = COLORS.muted;
      ctx.font = '500 11px system-ui, sans-serif';
      ctx.fillText('📍 ' + event.lat.toFixed(5) + ', ' + Number(coordLon(event)).toFixed(5), x + 16, y + cardH - 16);
    }
  }

  function drawTimelineStrip(ctx, schedule, activeId, progress, tr) {
    const y = H - 36;
    ctx.fillStyle = 'rgba(12, 18, 26, 0.88)';
    ctx.fillRect(0, y, W, 36);
    const n = schedule.length || 1;
    schedule.forEach(({ event }, i) => {
      const px = 20 + (i / Math.max(1, n - 1)) * (W - 40);
      const active = event.id === activeId;
      ctx.beginPath();
      ctx.arc(px, y + 18, active ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = active ? COLORS.accent : 'rgba(255,255,255,0.25)';
      ctx.fill();
    });
    ctx.fillStyle = COLORS.accent;
    ctx.fillRect(20, y + 30, (W - 40) * progress, 2);
  }

  function drawOutro(ctx, seg) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1a3358');
    g.addColorStop(1, '#0f1a28');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.accent;
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.fillText(seg.tr ? 'İnceleme Özeti' : 'Inspection Summary', W / 2, H * 0.38);
    const s = seg.stats || {};
    ctx.fillStyle = COLORS.text;
    ctx.font = '600 18px system-ui, sans-serif';
    const sum = seg.tr
      ? `${(s.routeKm || 0).toFixed(1)} km · ${s.photoCount || 0} foto · ${s.videoNoteCount || 0} video · ${Math.round(s.durationMin || 0)} dk`
      : `${(s.routeKm || 0).toFixed(1)} km · ${s.photoCount || 0} photos · ${s.videoNoteCount || 0} videos · ${Math.round(s.durationMin || 0)} min`;
    ctx.fillText(sum, W / 2, H * 0.48);
    (seg.insights || []).slice(0, 2).forEach((ins, i) => {
      ctx.fillStyle = COLORS.muted;
      ctx.font = '500 14px system-ui, sans-serif';
      ctx.fillText('· ' + String(ins).slice(0, 72), W / 2, H * 0.56 + i * 22);
    });
    ctx.fillStyle = COLORS.muted;
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.fillText('PlanAI Field · PiriStrategy', W / 2, H * 0.72);
    ctx.textAlign = 'left';
  }

  async function prepareAssets(payload) {
    const basemapImg = await loadImage(payload.basemapUrl || '');
    let basemap = basemapImg;
    if (basemapImg) {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      c.getContext('2d').drawImage(basemapImg, 0, 0, W, H);
      basemap = c;
    }
    const logo = await loadImage(payload.brandLogoUrl || '');
    const photoCache = new Map();
    const videoCache = new Map();
    timelineFromPayload(payload).forEach(ev => {
      if (ev.imageDataUrl) photoCache.set(ev.id, null);
      if (ev.kind === 'photo' && ev.imageDataUrl) photoCache.set(ev.id, null);
      if (ev.kind === 'audio' && ev.imageDataUrl) photoCache.set(ev.id, null);
      if (ev.kind === 'videoNote' && ev.videoDataUrl) videoCache.set(ev.id, null);
    });
    for (const [id] of photoCache) {
      const ev = (payload.events || []).find(e => e.id === id);
      const src = ev?.imageDataUrl || ev?.thumbDataUrl || '';
      if (src) photoCache.set(id, await loadImage(src));
    }
    for (const [id] of videoCache) {
      const ev = (payload.events || []).find(e => e.id === id);
      if (!ev?.videoDataUrl) continue;
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      video.src = ev.videoDataUrl;
      await new Promise(res => {
        video.onloadeddata = res;
        video.onerror = res;
        setTimeout(res, 10000);
      });
      videoCache.set(id, video);
    }
    return { basemap, logo, photoCache, videoCache };
  }

  async function renderCinematicSegment(ctx, seg, assets, renderFrame) {
    const frames = Math.max(1, Math.ceil(seg.duration * FPS));
    const schedule = seg.schedule || [];
    let routeT = 0;
    let overlay = null;
    let overlayFramesLeft = 0;
    const fired = new Set();

    for (let f = 0; f < frames; f++) {
      const clock = f / frames;
      if (overlayFramesLeft > 0) {
        overlayFramesLeft--;
      } else {
        routeT = Math.min(1, clock);
        schedule.forEach(({ event, t }) => {
          if (clock >= t && !fired.has(event.id)) {
            fired.add(event.id);
            overlay = event;
            overlayFramesLeft = Math.ceil(overlayDuration(event) * FPS);
          }
        });
      }

      drawMapChase(ctx, seg, routeT, assets.basemap, seg.bounds, assets);
      drawContextBar(ctx, seg.ctx, seg.tr);
      drawHeaderChip(ctx, seg.tr ? 'Sinematik İnceleme' : 'Cinematic Inspection',
        (seg.stats?.routeKm || 0).toFixed(1) + ' km');
      if (overlay && overlayFramesLeft > 0) {
        if (overlay.kind === 'videoNote' && overlay.videoDataUrl) {
          const vid = assets.videoCache.get(overlay.id);
          const elapsed = overlayDuration(overlay) - overlayFramesLeft / FPS;
          if (vid) {
            try {
              vid.currentTime = Math.min(elapsed, vid.duration || elapsed);
              await new Promise(r => { vid.onseeked = r; setTimeout(r, 200); });
            } catch (_) {}
          }
        }
        drawDetailOverlay(ctx, overlay, assets, seg.tr, 1 - overlayFramesLeft / Math.max(1, overlayDuration(overlay) * FPS));
      }
      const activeId = overlay?.id || null;
      drawTimelineStrip(ctx, schedule, activeId, routeT, seg.tr);
      await renderFrame();
    }
  }

  async function renderSegmentFrames(ctx, seg, assets, renderFrame) {
    const frames = Math.max(1, Math.ceil(seg.duration * FPS));
    if (seg.type === 'cinematic') {
      await renderCinematicSegment(ctx, seg, assets, renderFrame);
      return;
    }
    for (let f = 0; f < frames; f++) {
      const t = frames > 1 ? f / (frames - 1) : 1;
      if (seg.type === 'intro') drawIntro(ctx, seg, assets.logo);
      else if (seg.type === 'insights') drawInsights(ctx, seg, t);
      else if (seg.type === 'outro') drawOutro(ctx, seg);
      await renderFrame();
    }
  }

  async function generateFromPayload(payload, onProgress) {
    if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) {
      throw new Error(typeof PA_LANG !== 'undefined' && PA_LANG === 'tr'
        ? 'Bu cihaz video raporu kaydını desteklemiyor'
        : 'Video report recording is not supported on this device');
    }
    const mime = pickVideoMime();
    if (!mime) {
      throw new Error(typeof PA_LANG !== 'undefined' && PA_LANG === 'tr'
        ? 'MP4/WebM kayıt formatı desteklenmiyor'
        : 'No supported video recording format');
    }

    payload = preparePayload(payload);
    const segments = buildPlaybackPlan(payload);
    if (!segments.length) {
      throw new Error(typeof PA_LANG !== 'undefined' && PA_LANG === 'tr'
        ? 'Video raporu için yeterli veri yok'
        : 'Not enough data for video report');
    }

    const assets = await prepareAssets(payload);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');

    const stream = canvas.captureStream(FPS);
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: VIDEO_BPS });
    const chunks = [];
    recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const blobDone = new Promise(resolve => {
      recorder.onstop = () => resolve(new Blob(chunks, { type: mime.split(';')[0] }));
    });

    recorder.start(250);
    const totalFrames = segments.reduce((s, seg) => s + Math.ceil(seg.duration * FPS), 0);
    let doneFrames = 0;
    const frameInterval = 1000 / FPS;

    for (const seg of segments) {
      await renderSegmentFrames(ctx, seg, assets, async () => {
        doneFrames++;
        if (onProgress && totalFrames > 0) {
          const pct = 12 + Math.round((doneFrames / totalFrames) * 82);
          const msg = typeof PA_LANG !== 'undefined' && PA_LANG === 'tr'
            ? 'Sinematik video işleniyor…'
            : 'Rendering cinematic video…';
          onProgress(pct, msg);
        }
        await waitMs(frameInterval);
      });
    }

    recorder.stop();
    const blob = await blobDone;
    return { blob, mime, ext: videoExtFromMime(mime) };
  }

  async function generateFromProjectData(data, onProgress) {
    const build = typeof buildInspectionPlaybackPayload === 'function'
      ? buildInspectionPlaybackPayload
      : null;
    if (!build) throw new Error('buildInspectionPlaybackPayload unavailable');
    const payload = build(data);
    if (!payload.brandLogoUrl) {
      payload.brandLogoUrl = data.brandLogoUrl
        || (typeof embeddedBrandLogoDataUrl === 'function' ? embeddedBrandLogoDataUrl() : '');
    }
    if (!payload.basemapUrl) {
      payload.basemapUrl = data.interactiveBasemapUrl || data.mapDataUrl || '';
    }
    if (!payload.basemapUrl || !/^data:image\//i.test(payload.basemapUrl)) {
      const fallback = typeof buildReportBoundsFallbackDataUrl === 'function'
        ? buildReportBoundsFallbackDataUrl(payload.bounds || payload.geoBounds, payload.events, payload.lang)
        : '';
      if (fallback) payload.basemapUrl = fallback;
    }
    return generateFromPayload(payload, onProgress);
  }

  return {
    pickVideoMime,
    videoExtFromMime,
    generateFromPayload,
    generateFromProjectData,
    preparePayload,
    buildPlaybackPlan,
  };
})();

window.VideoReportGenerator = VideoReportGenerator;
