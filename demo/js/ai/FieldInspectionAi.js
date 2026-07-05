'use strict';
/**
 * PlanAI Field — trial AI saha sentezi (yerel, çevrimdışı öncelikli).
 * index-trial.html + FIELD_TRIAL_AI_ENABLED ile yüklenir.
 */
const FieldInspectionAi = (function () {
  const THEME_RULES = [
    { id: 'drainage', tr: 'Drenaj / su', en: 'Drainage / water', re: /drenaj|su birik|birikinti|rutubet|moisture|drain|flood|sel/i },
    { id: 'structural', tr: 'Yapısal', en: 'Structural', re: /çatlak|hasar|çök|collapse|crack|damage|struct/i },
    { id: 'access', tr: 'Erişim / yol', en: 'Access / road', re: /yol|erişim|kapı|geçiş|şerit|cadde|sokak|access|road|path|lane/i },
    { id: 'vegetation', tr: 'Vejetasyon', en: 'Vegetation', re: /bitki|ağaç|çalı|ot|vegetation|tree|weed/i },
    { id: 'forest', tr: 'Orman / ağaçlık', en: 'Forest / woodland', re: /orman|ağaçlık|fundalık|çalılık|koru|woodland|forest|tree\s*cover/i },
    { id: 'agriculture', tr: 'Tarım alanı', en: 'Agricultural land', re: /tarım|ekili|hububat|buğday|arpa|çayır|mera|zeytinlik|bağ|crop|farmland|agricult/i },
    { id: 'safety', tr: 'İş güvenliği', en: 'Safety', re: /güvenlik|tehlike|risk|safety|hazard/i },
    { id: 'terrain', tr: 'Arazi / eğim', en: 'Terrain / slope', re: /eğim|rampa|teras|yükseklik|yamaç|diklik|slope|gradient|elevation|inclin/i },
  ];

  const FILLER_RE = /\b(şey|işte|galiba|herhalde|falan|filan|yani|ee+|aa+|ıı+|um+|uh+|hmm+)\b/gi;
  const DIRECTION_RE = /^(kuzey(?:doğu|batı)?|güney(?:doğu|batı)?|doğu|batı)\s*(cephe|taraf|yan|bölge)?[:\s—-]*/i;
  const COACH_COOLDOWN_MS = 120000;
  const COACH_THEME_COOLDOWN_MS = 900000;
  let _lastCoachTs = 0;
  const _dismissedCoachIds = new Map();

  function tr() {
    return (typeof PA_LANG !== 'undefined' && PA_LANG === 'tr');
  }

  function noteSeverity(text) {
    const t = String(text || '');
    if (/kritik|acil|hasar|çök|collapse|tehlike/i.test(t)) return 'critical';
    if (/rutubet|drenaj|sorun|temizle|warning|moisture|drain|uyar/i.test(t)) return 'warning';
    return 'info';
  }

  function classifyThemes(text) {
    const hits = [];
    THEME_RULES.forEach(rule => {
      if (rule.re.test(String(text || ''))) hits.push(rule);
    });
    return hits;
  }

  function coordLon(v) {
    if (!v) return null;
    const lon = v.lon != null ? v.lon : v.lng;
    return Number.isFinite(lon) ? lon : null;
  }

  function collectEvents(data) {
    const photos = (data.allPhotos || data.photos || []).filter(p => !p.isPanorama);
    const notes = data.notes || [];
    const videos = data.videoNotes || data.videos || [];
    const voice = data.voiceNotes || [];
    const events = [];
    notes.forEach(n => {
      const text = n.text || n.textNote || '';
      const aiObs = n.captureMode === 'ai_observation' || n.captureMode === 'voice_quick';
      events.push({
        kind: aiObs ? 'aiObs' : 'note', text, ts: n.timestamp,
        lat: n.lat, lon: n.lon,
        severity: n.aiSeverity || noteSeverity(text),
        captureMode: n.captureMode || '',
      });
    });
    photos.forEach(p => {
      events.push({
        kind: 'photo', text: p.caption || '', ts: p.timestamp,
        lat: p.lat, lon: p.lon, severity: 'info',
      });
    });
    voice.forEach(v => {
      events.push({
        kind: 'audio', text: v.caption || '', ts: v.timestamp,
        lat: v.lat, lon: v.lon, severity: noteSeverity(v.caption),
      });
    });
    videos.forEach(v => {
      events.push({
        kind: 'videoNote', text: v.description || v.title || '', ts: v.timestamp,
        lat: v.lat, lon: v.lon, severity: 'info',
      });
    });
    return events.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  }

  function routeKmFromData(data) {
    const track = data.gpsTrack || data.track;
    const path = track?.path || track?.vertices || [];
    if (path.length < 2) return data.stats?.routeKm || 0;
    let km = 0;
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      if (typeof haversineM === 'function') {
        km += haversineM(a.lat, coordLon(a), b.lat, coordLon(b)) / 1000;
      }
    }
    return km || data.stats?.routeKm || 0;
  }

  function themeSummary(events) {
    const counts = new Map();
    events.forEach(ev => {
      classifyThemes(ev.text).forEach(rule => {
        counts.set(rule.id, (counts.get(rule.id) || 0) + 1);
      });
    });
    return [...counts.entries()]
      .map(([id, count]) => {
        const rule = THEME_RULES.find(r => r.id === id);
        return { id, label: tr() ? rule?.tr : rule?.en, count };
      })
      .sort((a, b) => b.count - a.count);
  }

  function coverageGaps(events, routeKm) {
    const gaps = [];
    const photos = events.filter(e => e.kind === 'photo').length;
    const notes = events.filter(e => e.kind === 'note' || e.kind === 'audio').length;
    if (routeKm > 0.3 && photos < 2) {
      gaps.push(tr()
        ? 'Rota uzun ancak az fotoğraf var — görsel belgeleme artırılabilir.'
        : 'Route is long but photo coverage is thin — add more visual documentation.');
    }
    if (routeKm > 0.15 && notes === 0) {
      gaps.push(tr()
        ? 'Metin veya sesli saha notu yok — kritik gözlemler kayda geçmemiş olabilir.'
        : 'No text or voice field notes — critical observations may be missing.');
    }
    const crit = events.filter(e => e.severity === 'critical');
    if (crit.length && photos < crit.length) {
      gaps.push(tr()
        ? 'Kritik gözlem sayısından az fotoğraf var — bulguları görselle destekleyin.'
        : 'Fewer photos than critical observations — add photos to support findings.');
    }
    return gaps.slice(0, 3);
  }

  function recommendedActions(events, themes) {
    const actions = [];
    const crit = events.filter(e => e.severity === 'critical');
    const warn = events.filter(e => e.severity === 'warning');
    if (crit.length) {
      actions.push(tr()
        ? crit.length + ' kritik bulgu için acil takip ve fotoğraflı doğrulama planlayın.'
        : 'Schedule urgent follow-up and photo verification for ' + crit.length + ' critical finding(s).');
    }
    if (warn.length) {
      actions.push(tr()
        ? warn.length + ' uyarı seviyesi gözlem için bakım veya teknik inceleme önerilir.'
        : 'Recommend maintenance or technical review for ' + warn.length + ' warning-level observation(s).');
    }
    themes.slice(0, 2).forEach(th => {
      if (th.id === 'drainage') {
        actions.push(tr() ? 'Drenaj hattı temizliği ve eğim kontrolü yapılmalı.' : 'Inspect drainage lines and surface grading.');
      } else if (th.id === 'structural') {
        actions.push(tr() ? 'Yapısal hasar için detaylı ölçüm ve fotoğraflı rapor tamamlanmalı.' : 'Complete detailed measurement and photo report for structural issues.');
      }
    });
    if (!actions.length) {
      actions.push(tr()
        ? 'İnceleme düzenli görünüyor — bir sonraki ziyaret için aynı rota referans alınabilir.'
        : 'Inspection looks routine — reuse this route as baseline for the next visit.');
    }
    return actions.slice(0, 4);
  }

  function buildNarrative(data, events, routeKm, themes) {
    const project = data.project || data.snap;
    const name = project?.name || (tr() ? 'Saha çalışması' : 'Field project');
    const mins = Math.round(data.stats?.durationMin
      || data.meta?.durationMin
      || Math.max(8, events.length * 3));
    const photoN = (data.allPhotos || data.photos || []).filter(p => !p.isPanorama).length;
    const videoN = (data.videoNotes || []).length;
    const voiceN = (data.voiceNotes || []).length;
    const loc = data.meta?.inspectionContext?.locationLine1
      || project?.metadata?.location
      || (tr() ? 'belirlenen saha' : 'the site');
    const crit = events.filter(e => e.severity === 'critical').length;
    const warn = events.filter(e => e.severity === 'warning').length;
    const themeLine = themes.length
      ? (tr() ? 'Öne çıkan temalar: ' : 'Dominant themes: ')
        + themes.slice(0, 3).map(t => t.label + ' (' + t.count + ')').join(', ') + '.'
      : '';
    if (tr()) {
      return name + ' kapsamında ' + loc + ' bölgesinde yaklaşık ' + mins + ' dakikalık saha incelemesi tamamlandı. '
        + routeKm.toFixed(1) + ' km GPS rotası, ' + photoN + ' fotoğraf'
        + (videoN ? ', ' + videoN + ' video not' : '')
        + (voiceN ? ', ' + voiceN + ' sesli kayıt' : '')
        + ' üretildi. '
        + (crit ? crit + ' kritik ve ' : '')
        + (warn ? warn + ' uyarı seviyesi gözlem kaydedildi. ' : (events.length ? 'Gözlemler rota boyunca dağıldı. ' : ''))
        + themeLine;
    }
    return 'Field work "' + name + '" at ' + loc + ' completed in about ' + mins + ' minutes. '
      + 'GPS route ' + routeKm.toFixed(1) + ' km with ' + photoN + ' photo(s)'
      + (videoN ? ', ' + videoN + ' video note(s)' : '')
      + (voiceN ? ', ' + voiceN + ' voice clip(s)' : '') + '. '
      + (crit ? crit + ' critical and ' : '')
      + (warn ? warn + ' warning-level observation(s) logged. ' : '')
      + themeLine;
  }

  function buildFindings(events) {
    const ranked = events
      .filter(e => e.text && (e.severity !== 'info' || e.kind === 'note' || e.kind === 'audio'))
      .sort((a, b) => {
        const w = { critical: 3, warning: 2, info: 1 };
        return (w[b.severity] || 0) - (w[a.severity] || 0);
      });
    return ranked.slice(0, 6).map((ev, i) => ({
      id: 'f' + i,
      severity: ev.severity,
      title: (tr()
        ? { note: 'Saha notu', aiObs: 'AI gözlem', photo: 'Fotoğraf', audio: 'Sesli not', videoNote: 'Video not' }[ev.kind]
        : { note: 'Field note', aiObs: 'AI observation', photo: 'Photo', audio: 'Voice note', videoNote: 'Video note' }[ev.kind]) || 'Kayıt',
      detail: String(ev.text).slice(0, 180),
      location: ev.lat != null && ev.lon != null
        ? ev.lat.toFixed(5) + ', ' + Number(coordLon(ev)).toFixed(5)
        : '—',
    }));
  }

  function generateSummary(data) {
    const events = collectEvents(data);
    const routeKm = routeKmFromData(data);
    const themes = themeSummary(events);
    const findings = buildFindings(events);
    const gaps = coverageGaps(events, routeKm);
    const actions = recommendedActions(events, themes);
    const narrative = buildNarrative(data, events, routeKm, themes);
    const headline = tr()
      ? (findings.find(f => f.severity === 'critical')
        ? 'Kritik bulgular içeren saha incelemesi özeti'
        : 'Saha incelemesi AI özeti')
      : (findings.find(f => f.severity === 'critical')
        ? 'Field inspection summary with critical findings'
        : 'AI field inspection summary');
    const insights = [narrative];
    themes.slice(0, 2).forEach(t => {
      insights.push((tr() ? 'Tema: ' : 'Theme: ') + t.label + ' · ' + t.count);
    });
    gaps.forEach(g => insights.push(g));
    actions.slice(0, 2).forEach(a => insights.push(a));
    return { headline, narrative, findings, gaps, actions, insights, themes, stats: { routeKm, eventCount: events.length } };
  }

  function enhancePayload(payload) {
    if (!payload) return payload;
    const summary = generateSummary({
      project: payload.project,
      photos: payload.sections?.photos,
      allPhotos: payload.sections?.photos,
      notes: payload.sections?.notes,
      videoNotes: payload.sections?.videoNotes,
      voiceNotes: payload.sections?.voiceNotes,
      gpsTrack: payload.track,
      stats: payload.stats,
      meta: { inspectionContext: payload.inspectionContext, durationMin: payload.stats?.durationMin },
    });
    payload.aiSummary = summary;
    payload.insights = summary.insights;
    return payload;
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function buildReportAiSectionHtml(summary) {
    if (!summary) return '';
    const sevLabel = { critical: tr() ? 'Kritik' : 'Critical', warning: tr() ? 'Uyarı' : 'Warning', info: tr() ? 'Bilgi' : 'Info' };
    const findings = (summary.findings || []).map(f =>
      '<li class="ftai-sev-' + f.severity + '"><strong>' + escapeHtml(f.title) + '</strong> — '
      + escapeHtml(f.detail) + ' <span class="ftai-loc">📍 ' + escapeHtml(f.location) + '</span></li>',
    ).join('');
    const actions = (summary.actions || []).map(a => '<li>' + escapeHtml(a) + '</li>').join('');
    const gaps = (summary.gaps || []).map(g => '<li>' + escapeHtml(g) + '</li>').join('');
    return '<section class="rpt-page ftai-report">'
      + '<h2>' + escapeHtml(tr() ? 'AI Saha Özeti' : 'AI Field Summary') + '</h2>'
      + '<p class="rpt-text ftai-lead">' + escapeHtml(summary.narrative) + '</p>'
      + (findings ? '<h3>' + escapeHtml(tr() ? 'Bulgular' : 'Findings') + '</h3><ul class="ftai-list">' + findings + '</ul>' : '')
      + (actions ? '<h3>' + escapeHtml(tr() ? 'Önerilen aksiyonlar' : 'Recommended actions') + '</h3><ul class="ftai-list">' + actions + '</ul>' : '')
      + (gaps ? '<h3>' + escapeHtml(tr() ? 'Kapsam notları' : 'Coverage notes') + '</h3><ul class="ftai-list ftai-gaps">' + gaps + '</ul>' : '')
      + '<p class="ftai-badge">' + escapeHtml(tr() ? 'PlanAI Field · yerel AI sentez' : 'PlanAI Field · on-device synthesis') + '</p>'
      + '</section>';
  }

  function renderPanelHtml(summary) {
    if (!summary) return '<p class="ftai-empty">' + escapeHtml(tr() ? 'Özet üretilemedi.' : 'Could not build summary.') + '</p>';
    const src = summary.aiSource === 'llm'
      ? (tr() ? 'Bulut AI özeti' : 'Cloud AI summary')
      : (tr() ? 'Yerel AI özeti' : 'Local AI summary');
    const findings = (summary.findings || []).slice(0, 4).map(f =>
      '<article class="ftai-card ftai-sev-' + f.severity + '">'
      + '<span class="ftai-chip">' + escapeHtml(f.title) + '</span>'
      + '<p>' + escapeHtml(f.detail) + '</p></article>',
    ).join('');
    const actions = (summary.actions || []).slice(0, 3).map(a => '<li>' + escapeHtml(a) + '</li>').join('');
    return '<div class="ftai-panel">'
      + '<p class="ftai-source-badge">' + escapeHtml(src) + '</p>'
      + '<p class="ftai-lead">' + escapeHtml(summary.narrative) + '</p>'
      + (findings ? '<div class="ftai-cards">' + findings + '</div>' : '')
      + (actions ? '<ul class="ftai-actions">' + actions + '</ul>' : '')
      + '</div>';
  }

  function severityLabel(sev) {
    const map = tr()
      ? { critical: 'Kritik', warning: 'Uyarı', info: 'Gözlem' }
      : { critical: 'Critical', warning: 'Warning', info: 'Observation' };
    return map[sev] || map.info;
  }

  function refineObservation(raw) {
    let text = String(raw || '').trim();
    const original = text;
    if (!text) return { raw: original, text: '', themes: [], severity: 'info' };
    let prefix = '';
    const dirMatch = text.match(DIRECTION_RE);
    if (dirMatch) {
      prefix = dirMatch[0].replace(/[:\s—-]+$/, '').trim();
      prefix = prefix.charAt(0).toUpperCase() + prefix.slice(1);
      text = text.slice(dirMatch[0].length).trim();
    }
    text = text.replace(FILLER_RE, ' ').replace(/\s+/g, ' ').trim();
    if (prefix && text) text = prefix + ' — ' + text;
    else if (prefix) text = prefix;
    if (text) text = text.charAt(0).toUpperCase() + text.slice(1);
    if (text && !/[.!?]$/.test(text)) text += '.';
    const themes = classifyThemes(text);
    const severity = noteSeverity(text);
    const signals = detectCoachSignals(text);
    return { raw: original, text, themes, severity, signals };
  }

  function detectCoachSignals(text) {
    const t = String(text || '');
    return {
      roadWidth: /yol\s*genişliği|şerit\s*genişliği|cadde\s*genişliği|dar\s*yol|yol\s*dar|genişlik\s*(yeterli\s*değil|yetersiz|dar|kısa|az)|yeterli\s*değil.*genişlik|genişlik.*yeterli\s*değil|road\s*width|lane\s*width|too\s*narrow/i.test(t),
      length: /uzunluk|mesafe|ne\s*kadar\s*uzun|boyu|metre\s*uzun|kaç\s*metre|length|distance/i.test(t),
      areaSize: /alan\s*büyüklüğü|büyüklük|metrekare|hektar|dönüm|m2|m²|ne\s*kadar\s*alan|geniş\s*alan|parsel\s*büyüklüğü|area\s*size|how\s*large/i.test(t),
      slope: /eğim|rampa|teras|yükseklik|yamaç|diklik|çok\s*eğim|slope|gradient|inclin/i.test(t),
      forest: /orman|ağaçlık|yoğun\s*bitki|fundalık|çalılık|koru|woodland|forest|tree\s*cover/i.test(t),
      forestDense: /yoğun\s*orman|sık\s*ağaç|ağaçlık\s*alan|içinden\s*geç/i.test(t),
      agriculture: /tarım|ekili|hububat|buğday|arpa|çayır|mera|zeytinlik|bağ|crop|farmland|agricult/i.test(t),
      boundary: /sınır|çevre|çit|tel\s*çit|perimeter|boundary|fence/i.test(t),
      water: /su|dere|kanal|nehir|stream|river/i.test(t),
      building: /bina|kat|cephe|daire|net\s*alan|brüt|arsa|gayrimenkul|konut|villa|apart|property|façade|storey|facade/i.test(t),
    };
  }

  function pushCoach(candidates, item) {
    candidates.push({
      id: item.id,
      priority: item.priority,
      action: item.action,
      measureKind: item.measureKind || null,
      message: typeof item.message === 'function' ? item.message() : item.message,
      actionLabel: typeof item.actionLabel === 'function' ? item.actionLabel() : item.actionLabel,
    });
  }

  function pickCoachingSuggestion(refined) {
    if (!refined?.text) return null;
    const { text, severity, themes } = refined;
    const signals = refined.signals || detectCoachSignals(text);
    const themeIds = new Set((themes || []).map(t => t.id));
    const candidates = [];

    if (severity === 'critical' && themeIds.has('structural')) {
      pushCoach(candidates, {
        id: 'video_structural', priority: 100, action: 'video',
        message: () => tr() ? 'Yapısal hasar kritik — kısa video ile belgelemek ister misiniz?' : 'Structural damage is critical — capture a short video?',
        actionLabel: () => tr() ? '🎬 Video çek' : '🎬 Record video',
      });
    }
    if (signals.roadWidth || (themeIds.has('access') && /genişlik|dar\s*yol|yeterli\s*değil/i.test(text))) {
      pushCoach(candidates, {
        id: 'measure_road_width', priority: 98, action: 'measure_line', measureKind: 'line',
        message: () => tr() ? 'Yol genişliği geçti — şerit boyunca ölçüm çizgisi çekelim mi?' : 'Road width mentioned — draw a measure line across the lane?',
        actionLabel: () => tr() ? '📏 Genişlik ölç' : '📏 Measure width',
      });
    }
    if (severity === 'critical') {
      pushCoach(candidates, {
        id: 'photo_critical', priority: 95, action: 'photo',
        message: () => tr() ? 'Kritik gözlem — fotoğrafla kayıt altına almak ister misiniz?' : 'Critical finding — add a photo for evidence?',
        actionLabel: () => tr() ? '📷 Fotoğraf çek' : '📷 Take photo',
      });
    }
    if (signals.areaSize || (signals.agriculture && /büyüklük|alan|hektar|dönüm|metrekare/i.test(text))) {
      pushCoach(candidates, {
        id: 'measure_area_size', priority: 94, action: 'measure_area', measureKind: 'area',
        message: () => tr() ? 'Alan büyüklüğü geçti — poligon ile alanı ölçelim mi?' : 'Area size mentioned — measure with a polygon?',
        actionLabel: () => tr() ? '⬠ Alan ölç' : '⬠ Measure area',
      });
    }
    if (signals.boundary) {
      pushCoach(candidates, {
        id: 'measure_boundary', priority: 92, action: 'measure_area', measureKind: 'area',
        message: () => tr() ? 'Sınır / çevre geçti — alan veya çevre için poligon çizelim mi?' : 'Boundary mentioned — draw a polygon for area or perimeter?',
        actionLabel: () => tr() ? '⬠ Sınır ölç' : '⬠ Measure boundary',
      });
    }
    if (themeIds.has('structural') || themeIds.has('safety')) {
      pushCoach(candidates, {
        id: 'photo_structural', priority: 90, action: 'photo',
        message: () => tr() ? 'Yapısal veya güvenlik bulgusu — yakından fotoğraf önerilir.' : 'Structural or safety issue — a close-up photo is recommended.',
        actionLabel: () => tr() ? '📷 Fotoğraf çek' : '📷 Take photo',
      });
    }
    if (signals.length && !signals.roadWidth) {
      pushCoach(candidates, {
        id: 'measure_length', priority: 89, action: 'measure_line', measureKind: 'line',
        message: () => tr() ? 'Uzunluk / mesafe geçti — kırık ölçüm çizgisi çekelim mi?' : 'Length or distance mentioned — draw a measure line?',
        actionLabel: () => tr() ? '📏 Uzunluk ölç' : '📏 Measure length',
      });
    }
    if (themeIds.has('drainage') || (signals.water && /drenaj|birik|tıkan/i.test(text))) {
      pushCoach(candidates, {
        id: 'photo_drainage', priority: 85, action: 'photo',
        message: () => tr() ? 'Drenaj sorunu — su birikintisini fotoğraflamak ister misiniz?' : 'Drainage issue — photograph the standing water?',
        actionLabel: () => tr() ? '📷 Fotoğraf çek' : '📷 Take photo',
      });
    }
    if (signals.forestDense || (signals.forest && /yoğun|sık/i.test(text))) {
      pushCoach(candidates, {
        id: 'video_forest', priority: 86, action: 'video',
        message: () => tr() ? 'Yoğun ağaçlık / orman — kısa video ile alanı kaydedelim mi?' : 'Dense woodland — record a short video of the area?',
        actionLabel: () => tr() ? '🎬 Video kaydet' : '🎬 Record video',
      });
    } else if (signals.forest || themeIds.has('forest')) {
      pushCoach(candidates, {
        id: 'photo_forest', priority: 84, action: 'photo',
        message: () => tr() ? 'Orman / ağaçlık alan — genel görünüm fotoğrafı önerilir.' : 'Forest or woodland — capture an overview photo.',
        actionLabel: () => tr() ? '📷 Fotoğraf çek' : '📷 Take photo',
      });
    }
    if (signals.agriculture || themeIds.has('agriculture')) {
      pushCoach(candidates, {
        id: 'photo_agriculture', priority: 83, action: 'photo',
        message: () => tr() ? 'Tarım alanı — ekim / arazi durumunu fotoğraflayalım mı?' : 'Agricultural land — photograph crop or field condition?',
        actionLabel: () => tr() ? '📷 Fotoğraf çek' : '📷 Take photo',
      });
    }
    if (signals.slope || themeIds.has('terrain')) {
      pushCoach(candidates, {
        id: 'slope_terrain', priority: 82, action: 'slope',
        message: () => tr() ? 'Eğim / yükseklik geçti — bu noktada eğim analizi yapalım mı?' : 'Slope or elevation mentioned — run slope analysis here?',
        actionLabel: () => tr() ? '📐 Eğim analizi' : '📐 Slope analysis',
      });
    }
    if (themeIds.has('vegetation') && !signals.forest && !signals.agriculture) {
      pushCoach(candidates, {
        id: 'photo_vegetation', priority: 78, action: 'photo',
        message: () => tr() ? 'Bitki örtüsü — yakından fotoğraf eklemek faydalı olabilir.' : 'Vegetation noted — a close-up photo may help.',
        actionLabel: () => tr() ? '📷 Fotoğraf çek' : '📷 Take photo',
      });
    }
    if (themeIds.has('access') && !signals.roadWidth) {
      pushCoach(candidates, {
        id: 'photo_access', priority: 75, action: 'photo',
        message: () => tr() ? 'Erişim / yol — güzergâhı fotoğraflamak ister misiniz?' : 'Access or road — photograph the route?',
        actionLabel: () => tr() ? '📷 Fotoğraf çek' : '📷 Take photo',
      });
    }
    if (severity === 'warning') {
      pushCoach(candidates, {
        id: 'photo_warning', priority: 70, action: 'photo',
        message: () => tr() ? 'Uyarı seviyesi gözlem — görsel kayıt eklemek faydalı olabilir.' : 'Warning-level observation — a visual record may help.',
        actionLabel: () => tr() ? '📷 Fotoğraf çek' : '📷 Take photo',
      });
    }

    const intent = typeof FieldInspectionModes !== 'undefined'
      ? FieldInspectionModes.getCurrentIntent() : 'general';
    if (intent === 'valuation' && (signals.building || signals.areaSize)) {
      pushCoach(candidates, {
        id: 'coach_val_measure', priority: 93, action: 'measure_area', measureKind: 'area',
        message: () => tr() ? 'Gayrimenkul gözlemi — alan veya cephe ölçümü eklemek ister misiniz?' : 'Property note — add area or façade measurement?',
        actionLabel: () => tr() ? '⬠ Alan ölç' : '⬠ Measure area',
      });
      pushCoach(candidates, {
        id: 'coach_val_photo', priority: 88, action: 'photo',
        message: () => tr() ? 'Yapı özelliklerini fotoğrafla — cephe ve hasar detayı.' : 'Photograph building traits — façade and damage detail.',
        actionLabel: () => tr() ? '📷 Fotoğraf çek' : '📷 Take photo',
      });
    }
    if (intent === 'tourism') {
      pushCoach(candidates, {
        id: 'coach_tour_photo', priority: 86, action: 'photo',
        message: () => tr() ? 'Güzel an — fotoğraf çekin; sinematik raporda haritada kalır.' : 'Capture the moment — it stays on your map in the cinematic report.',
        actionLabel: () => tr() ? '📷 Anı fotoğrafı' : '📷 Memory photo',
      });
    }
    if (intent === 'plan' && (themeIds.has('access') || /parsel|fonksiyon|imar|taks|kaks|emsal/i.test(text))) {
      pushCoach(candidates, {
        id: 'coach_plan_photo', priority: 87, action: 'photo',
        message: () => tr() ? 'Plan bulgusu — sahayı fotoğraflayarak rapora bağlayın.' : 'Plan finding — photograph site to link report to map.',
        actionLabel: () => tr() ? '📷 Fotoğraf çek' : '📷 Take photo',
      });
    }

    candidates.sort((a, b) => b.priority - a.priority);
    const top = candidates[0];
    if (!top) return null;
    return {
      id: top.id,
      action: top.action,
      measureKind: top.measureKind,
      message: top.message,
      actionLabel: top.actionLabel,
      lat: null,
      lon: null,
    };
  }

  function canShowCoach(suggestion) {
    if (!suggestion) return false;
    if (Date.now() - _lastCoachTs < COACH_COOLDOWN_MS) return false;
    const dismissed = _dismissedCoachIds.get(suggestion.id);
    if (dismissed && Date.now() - dismissed < COACH_THEME_COOLDOWN_MS) return false;
    return true;
  }

  function markCoachShown() {
    _lastCoachTs = Date.now();
  }

  function dismissCoach(suggestionId) {
    if (suggestionId) _dismissedCoachIds.set(suggestionId, Date.now());
  }

  function buildLlmEventContext(data) {
    const events = collectEvents(data);
    return events.slice(-24).map(ev => ({
      kind: ev.kind,
      text: String(ev.text || '').slice(0, 220),
      severity: ev.severity || 'info',
      lat: ev.lat != null ? Number(ev.lat.toFixed(5)) : null,
      lon: ev.lon != null ? Number(ev.lon.toFixed(5)) : null,
    })).filter(e => e.text);
  }

  function renderObservationCardHtml(refined, noteNum, meta) {
    if (!refined?.text) return '';
    const themes = (refined.themes || []).slice(0, 2).map(t => tr() ? t.tr : t.en).join(' · ');
    const primary = themes || severityLabel(refined.severity);
    const evidence = [];
    const coach = pickCoachingSuggestion(refined);
    if (coach?.action === 'photo') evidence.push(tr() ? 'Fotoğraf önerilir' : 'Photo suggested');
    else if (coach?.action === 'video') evidence.push(tr() ? 'Video önerilir' : 'Video suggested');
    else if (coach?.action === 'measure_line') evidence.push(tr() ? 'Uzunluk ölçümü' : 'Length measure');
    else if (coach?.action === 'measure_area') evidence.push(tr() ? 'Alan ölçümü' : 'Area measure');
    else if (coach?.action === 'slope') evidence.push(tr() ? 'Eğim analizi' : 'Slope analysis');
    const srcBadge = meta?.source === 'llm'
      ? '<span class="ftai-obs-src">' + escapeHtml(tr() ? 'Bulut AI' : 'Cloud AI') + '</span>'
      : '';
    return '<article class="ftai-obs-card ftai-sev-' + refined.severity + '">'
      + '<div class="ftai-obs-meta">'
      + '<span class="ftai-obs-sev">' + escapeHtml(severityLabel(refined.severity)) + '</span>'
      + '<span class="ftai-obs-cat">' + escapeHtml(primary) + '</span>'
      + srcBadge
      + (noteNum ? '<span class="ftai-obs-num">#' + escapeHtml(String(noteNum)) + '</span>' : '')
      + '</div>'
      + '<p class="ftai-obs-text">' + escapeHtml(refined.text) + '</p>'
      + (evidence.length ? '<p class="ftai-obs-evidence">' + escapeHtml(evidence.join(' · ')) + '</p>' : '')
      + '<p class="ftai-obs-gps">' + escapeHtml(tr() ? 'Canlı GPS konumuna kaydedildi' : 'Saved at live GPS position') + '</p>'
      + '</article>';
  }

  function getGpsForAiNote() {
    if (typeof getGpsDisplayFix === 'function') {
      const g = getGpsDisplayFix();
      if (g?.lat != null && g?.lon != null) return { lat: g.lat, lon: g.lon };
    }
    if (typeof S !== 'undefined' && S.mapCenter?.lat != null) {
      return { lat: S.mapCenter.lat, lon: S.mapCenter.lon };
    }
    return null;
  }

  function saveAiObservationFromRefined(refined, raw, onDone, meta) {
    if (!refined?.text) {
      if (onDone) onDone(null);
      return;
    }
    if (typeof requireProject !== 'function' || typeof makeFieldNote !== 'function') {
      if (onDone) onDone(null);
      return;
    }
    requireProject(() => {
      const geo = getGpsForAiNote();
      if (!geo) {
        if (typeof showHint === 'function') showHint(tr() ? 'GPS veya harita konumu gerekli' : 'GPS or map position required');
        if (onDone) onDone(null);
        return;
      }
      const n = makeFieldNote(geo.lat, geo.lon, refined.text, null);
      if (!n || typeof S === 'undefined') {
        if (onDone) onDone(null);
        return;
      }
      n.captureMode = 'ai_observation';
      n.aiSeverity = refined.severity;
      n.aiTagged = true;
      n.aiRawText = raw != null ? raw : refined.raw;
      n.aiThemeIds = (refined.themes || []).map(t => t.id);
      n.aiRefineSource = meta?.source || 'local';
      S.objects.push(n);
      S.selectedIds = [n.id];
      if (typeof pushHistory === 'function') pushHistory();
      if (typeof scheduleProjectSave === 'function') scheduleProjectSave();
      if (typeof buildFieldNotesList === 'function') buildFieldNotesList();
      if (typeof buildLayerPanel === 'function') buildLayerPanel();
      if (typeof scheduleRender === 'function') scheduleRender();

      let coach = pickCoachingSuggestion(refined);
      if (coach) {
        coach = { ...coach, lat: geo.lat, lon: geo.lon };
        if (!canShowCoach(coach)) coach = null;
        else markCoachShown();
      }

      if (typeof showHint === 'function') {
        showHint(tr()
          ? 'Gözlem #' + n.noteNum + ' kaydedildi'
          : 'Observation #' + n.noteNum + ' saved');
      }
      if (onDone) onDone({ note: n, refined, geo, coach, refineSource: meta?.source || 'local' });
      if (typeof FieldInspectionRadar !== 'undefined') FieldInspectionRadar.noteObservation(refined);
    });
  }

  function saveAiObservation(raw, onDone) {
    const refined = refineObservation(raw);
    saveAiObservationFromRefined(refined, raw, onDone, { source: 'local' });
  }

  function saveQuickObservation(text) {
    let ok = false;
    saveAiObservation(text, () => { ok = true; });
    return ok;
  }

  function executeCoachAction(coach) {
    if (!coach?.action) return false;
    if (coach.action === 'photo' && typeof activateFieldPhotoTool === 'function') {
      activateFieldPhotoTool();
      return true;
    }
    if (coach.action === 'video' && typeof activateFieldVideoTool === 'function') {
      activateFieldVideoTool();
      return true;
    }
    if (coach.action === 'slope' && coach.lat != null && typeof createFieldSlopeCircleAtLatLon === 'function') {
      createFieldSlopeCircleAtLatLon(coach.lat, coach.lon, 28);
      if (typeof showHint === 'function') showHint(tr() ? 'Eğim analizi başlatıldı' : 'Slope analysis started');
      return true;
    }
    if ((coach.action === 'measure_line' || coach.action === 'measure_area') && typeof activateFieldMeasureTool === 'function') {
      activateFieldMeasureTool(coach.action === 'measure_area' || coach.measureKind === 'area' ? 'area' : 'line');
      return true;
    }
    return false;
  }

  function patchTrialHooks() {
    if (!window.FIELD_TRIAL_AI_ENABLED) return;
    if (typeof openFieldNotes === 'function' && !openFieldNotes.__ftaiRedirect) {
      const origNotes = openFieldNotes;
      window.openFieldNotes = function ftaiOpenFieldNotes() {
        if (typeof FieldTrialAiShell !== 'undefined' && FieldTrialAiShell.openSheet) {
          FieldTrialAiShell.openSheet();
          return;
        }
        origNotes();
      };
      window.openFieldNotes.__ftaiRedirect = true;
    }
    if (typeof startFieldNotePlacement === 'function' && !startFieldNotePlacement.__ftaiRedirect) {
      const origPin = startFieldNotePlacement;
      window.startFieldNotePlacement = function ftaiStartFieldNotePlacement() {
        if (typeof FieldTrialAiShell !== 'undefined' && FieldTrialAiShell.openSheet) {
          FieldTrialAiShell.openSheet();
          return;
        }
        origPin();
      };
      window.startFieldNotePlacement.__ftaiRedirect = true;
    }
    if (typeof buildInspectionPlaybackPayload === 'function' && !buildInspectionPlaybackPayload.__ftaiPatched) {
      const orig = buildInspectionPlaybackPayload;
      const wrapped = function (data) {
        return enhancePayload(orig(data));
      };
      wrapped.__ftaiPatched = true;
      window.buildInspectionPlaybackPayload = wrapped;
    }
    if (typeof buildReportHTML === 'function' && !buildReportHTML.__ftaiPatched) {
      const origHtml = buildReportHTML;
      const wrappedHtml = function (data) {
        let html = origHtml(data);
        try {
          const summary = generateSummary(data);
          const block = buildReportAiSectionHtml(summary);
          const re = /<section class="rpt-page">\s*<h2>[^<]*AI[^<]*<\/h2>[\s\S]*?<\/section>/i;
          if (re.test(html)) html = html.replace(re, block);
        } catch (e) {
          console.warn('[FieldInspectionAi] report patch', e);
        }
        return html;
      };
      wrappedHtml.__ftaiPatched = true;
      window.buildReportHTML = wrappedHtml;
    }
  }

  return {
    generateSummary,
    enhancePayload,
    buildReportAiSectionHtml,
    renderPanelHtml,
    renderObservationCardHtml,
    refineObservation,
    buildLlmEventContext,
    detectCoachSignals,
    pickCoachingSuggestion,
    canShowCoach,
    dismissCoach,
    saveAiObservation,
    saveAiObservationFromRefined,
    saveQuickObservation,
    saveAiVoiceNote: saveAiObservation,
    executeCoachAction,
    noteSeverity,
    severityLabel,
    patchTrialHooks,
  };
})();

window.FieldInspectionAi = FieldInspectionAi;
