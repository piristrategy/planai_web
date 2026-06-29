/**
 * PlanAI Field — index-trial.html deneme kabuğu
 * REC süresi, konum/rakım üst bar, incelemeyi tamamla → kaydet → hub
 */
(function () {
  'use strict';

  const REC_SS_KEY = 'planai_trial_rec_started_at';
  const SUN_MODE_KEY = 'planai_trial_sun_mode';
  const GEO_CACHE_MS = 45000;
  const ELEV_CACHE_MS = 60000;
  const WX_CACHE_MS = 600000;
  let recTimer = null;
  let geoPending = null;
  let lastGeoAt = 0;
  let lastGeoCoords = '';
  let lastElevKey = '';
  let lastElevAt = 0;
  let lastElevValue = null;
  let elevPending = false;
  let lastWxKey = '';
  let lastWxAt = 0;
  let lastWxLabel = '';
  let wxPending = false;
  let clockTimer = null;

  function $(id) { return document.getElementById(id); }

  function isHubOpen() {
    const o = $('field-journey-hub-overlay');
    return o && o.style.display === 'flex';
  }

  function isInspectionMapActive() {
    return document.body.classList.contains('field-mode') && !isHubOpen();
  }

  function formatRecDuration(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return [h, m, sec].map(n => String(n).padStart(2, '0')).join(':');
  }

  function getRecStartedAt() {
    const v = sessionStorage.getItem(REC_SS_KEY);
    return v ? parseInt(v, 10) : 0;
  }

  function startRecSession() {
    if (!getRecStartedAt()) sessionStorage.setItem(REC_SS_KEY, String(Date.now()));
    const badge = document.querySelector('#trial-inspection-chrome .trial-badge.rec');
    if (badge) badge.classList.remove('paused');
    tickRec();
    if (!recTimer) recTimer = setInterval(tickRec, 1000);
  }

  function stopRecSession() {
    sessionStorage.removeItem(REC_SS_KEY);
    if (recTimer) { clearInterval(recTimer); recTimer = null; }
    const el = $('trial-rec-time');
    if (el) el.textContent = '00:00:00';
    const badge = document.querySelector('#trial-inspection-chrome .trial-badge.rec');
    if (badge) badge.classList.add('paused');
  }

  function tickRec() {
    const el = $('trial-rec-time');
    if (!el) return;
    if (!isInspectionMapActive()) {
      el.textContent = '00:00:00';
      return;
    }
    const started = getRecStartedAt();
    if (!started) {
      el.textContent = '00:00:00';
      return;
    }
    el.textContent = formatRecDuration(Date.now() - started);
  }

  function parseGpsHudAlt() {
    const raw = $('gps-hud-alt')?.textContent?.trim() || '';
    if (!raw || raw === '—') return null;
    const m = raw.match(/(-?\d+)/);
    return m ? m[1] + ' m' : raw;
  }

  function parseGpsHudAcc() {
    const raw = $('gps-hud-acc')?.textContent?.trim() || '';
    if (raw && raw !== '—' && raw !== '…') {
      const n = raw.match(/(\d+)/);
      if (n) return (document.documentElement.lang === 'en' ? 'Accuracy ±' : 'Doğruluk ±') + n[1] + ' m';
    }
    const pill = $('gps-status-pill');
    if (!pill) return '—';
    if (pill.classList.contains('connected') || pill.classList.contains('weak')) {
      const t = pill.textContent || '';
      const m = t.match(/(\d+)\s*m/);
      if (m) return (document.documentElement.lang === 'en' ? 'Accuracy ±' : 'Doğruluk ±') + m[1] + ' m';
    }
    return document.documentElement.lang === 'en' ? 'Searching…' : 'Aranıyor…';
  }

  function syncGpsBadge() {
    const badge = document.querySelector('#trial-inspection-chrome .trial-badge.gps');
    const accEl = $('trial-gps-acc');
    if (!badge || !accEl) return;
    const pill = $('gps-status-pill');
    const live = pill && (pill.classList.contains('connected') || pill.classList.contains('weak') || pill.classList.contains('searching'));
    badge.classList.toggle('off', !live);
    accEl.textContent = parseGpsHudAcc();
    const l1 = badge.querySelector('.l1');
    if (l1) {
      l1.textContent = document.documentElement.lang === 'en'
        ? (live ? 'GPS LIVE' : 'GPS')
        : (live ? 'GPS CANLI' : 'GPS');
    }
  }

  function readAltitudeFromFix() {
    const fix = typeof window.getFieldGpsDisplayFix === 'function' ? window.getFieldGpsDisplayFix() : null;
    if (fix?.altitude != null && !isNaN(fix.altitude)) return Math.round(fix.altitude) + ' m';
    return null;
  }

  async function fetchTrialElevation(lat, lon) {
    const url = 'https://api.open-meteo.com/v1/elevation?latitude='
      + encodeURIComponent(lat.toFixed(5)) + '&longitude=' + encodeURIComponent(lon.toFixed(5));
    const res = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
    if (!res.ok) throw new Error('elevation failed');
    const data = await res.json();
    const elev = data?.elevation;
    const val = Array.isArray(elev) ? elev[0] : elev;
    return val != null && isFinite(val) ? Math.round(val) : null;
  }

  function applyAltitudeText(text) {
    const el = $('trial-alt-value');
    const hudAlt = $('gps-hud-alt');
    if (el) el.textContent = text;
    if (hudAlt && (!hudAlt.textContent || hudAlt.textContent.trim() === '—' || hudAlt.textContent.trim() === '…')) {
      hudAlt.textContent = text;
    }
  }

  async function refreshAltitude() {
    if (!isInspectionMapActive()) return;
    const fromHud = parseGpsHudAlt();
    if (fromHud) {
      lastElevValue = fromHud;
      applyAltitudeText(fromHud);
      return;
    }
    const fromFix = readAltitudeFromFix();
    if (fromFix) {
      lastElevValue = fromFix;
      applyAltitudeText(fromFix);
      return;
    }
    if (lastElevValue) {
      applyAltitudeText(lastElevValue);
      return;
    }
    const coords = readCoordsFromHud();
    if (!coords) return;
    const key = coords.lat.toFixed(3) + ',' + coords.lon.toFixed(3);
    if (key === lastElevKey && Date.now() - lastElevAt < ELEV_CACHE_MS) return;
    if (elevPending) return;
    elevPending = true;
    try {
      const meters = await fetchTrialElevation(coords.lat, coords.lon);
      if (meters == null) return;
      lastElevKey = key;
      lastElevAt = Date.now();
      lastElevValue = meters + ' m';
      applyAltitudeText(lastElevValue);
    } catch (e) {
      console.warn('[TrialShell] elevation', e);
    } finally {
      elevPending = false;
    }
  }

  function syncAltitude() {
    const sub = $('trial-alt-label');
    if (sub) sub.textContent = document.documentElement.lang === 'en' ? 'Altitude' : 'Rakım';
    const fromHud = parseGpsHudAlt();
    const fromFix = readAltitudeFromFix();
    const text = fromHud || fromFix || lastElevValue;
    if (text) {
      lastElevValue = text;
      applyAltitudeText(text);
      return;
    }
    applyAltitudeText('—');
    refreshAltitude();
  }

  function weatherLabel(code) {
    const en = document.documentElement.lang === 'en';
    const c = Number(code);
    if (c === 0) return en ? 'Clear' : 'Açık Hava';
    if (c <= 3) return en ? 'Partly Cloudy' : 'Parçalı Bulutlu';
    if (c === 45 || c === 48) return en ? 'Fog' : 'Sisli';
    if (c >= 51 && c <= 67) return en ? 'Rain' : 'Yağmurlu';
    if (c >= 71 && c <= 77) return en ? 'Snow' : 'Karlı';
    if (c >= 80 && c <= 82) return en ? 'Showers' : 'Sağanak';
    if (c >= 95) return en ? 'Storm' : 'Fırtınalı';
    return en ? 'Weather' : 'Hava';
  }

  async function fetchTrialWeather(lat, lon) {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude='
      + encodeURIComponent(lat.toFixed(4)) + '&longitude=' + encodeURIComponent(lon.toFixed(4))
      + '&current=temperature_2m,weather_code&timezone=auto';
    const res = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
    if (!res.ok) throw new Error('weather failed');
    const data = await res.json();
    const temp = data?.current?.temperature_2m;
    const code = data?.current?.weather_code;
    return {
      temp: temp != null && isFinite(temp) ? Math.round(temp) : null,
      label: weatherLabel(code),
    };
  }

  function applyWeatherText(temp, label) {
    const tempEl = $('trial-wx-temp');
    const lblEl = $('trial-wx-label');
    if (tempEl) tempEl.textContent = temp != null ? temp + '°C' : '—';
    if (lblEl && label) {
      lastWxLabel = label;
      lblEl.textContent = label;
    }
  }

  async function refreshWeather() {
    if (!isInspectionMapActive()) return;
    const coords = readCoordsFromHud();
    if (!coords) {
      applyWeatherText(null, document.documentElement.lang === 'en' ? 'Weather' : 'Hava');
      return;
    }
    const key = coords.lat.toFixed(3) + ',' + coords.lon.toFixed(3);
    const now = Date.now();
    if (key === lastWxKey && now - lastWxAt < WX_CACHE_MS && lastWxLabel) return;
    if (wxPending) return;
    wxPending = true;
    try {
      const wx = await fetchTrialWeather(coords.lat, coords.lon);
      lastWxKey = key;
      lastWxAt = Date.now();
      applyWeatherText(wx.temp, wx.label);
    } catch (e) {
      console.warn('[TrialShell] weather', e);
    } finally {
      wxPending = false;
    }
  }

  function tickClock() {
    const el = $('trial-clock-time');
    const lbl = $('trial-clock-label');
    if (!el) return;
    const en = document.documentElement.lang === 'en';
    if (lbl) lbl.textContent = en ? 'Time' : 'Saat';
    const d = new Date();
    el.textContent = d.toLocaleTimeString(en ? 'en-GB' : 'tr-TR', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  function bindClock() {
    tickClock();
    if (!clockTimer) clockTimer = setInterval(tickClock, 1000);
  }

  function setTrialSunMode(on, persist) {
    const btn = $('btn-trial-sun');
    document.body.classList.toggle('field-trial-sun', !!on);
    if (btn) {
      btn.classList.toggle('active', !!on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    if (persist !== false) {
      try { localStorage.setItem(SUN_MODE_KEY, on ? '1' : '0'); } catch (_) { /* ignore */ }
    }
  }

  function syncTrialSunWithLanguage(lang) {
    setTrialSunMode(lang === 'en');
  }

  function bindSunMode() {
    const btn = $('btn-trial-sun');
    if (!btn) return;
    const lang = (typeof PA_LANG !== 'undefined' && PA_LANG === 'en') ? 'en' : 'tr';
    if (lang === 'en') setTrialSunMode(true, false);
    else setTrialSunMode(localStorage.getItem(SUN_MODE_KEY) === '1', false);
    btn.addEventListener('click', () => {
      setTrialSunMode(!document.body.classList.contains('field-trial-sun'));
    });
  }

  function bindInteractionToggles() {
    const finger = $('btn-finger-mode');
    const pen = $('btn-pen-mode');
    if (!finger || !pen) return;
    const syncPressed = () => {
      const isFinger = finger.classList.contains('active');
      finger.setAttribute('aria-pressed', isFinger ? 'true' : 'false');
      pen.setAttribute('aria-pressed', isFinger ? 'false' : 'true');
    };
    finger.addEventListener('click', () => requestAnimationFrame(syncPressed));
    pen.addEventListener('click', () => requestAnimationFrame(syncPressed));
    syncPressed();
  }

  function pickAddrPart(addr, keys) {
    for (const k of keys) {
      const v = addr[k];
      if (v && typeof v === 'string') return v;
    }
    return '';
  }

  function formatLocationLines(addr) {
    const city = pickAddrPart(addr, ['province', 'state', 'city']);
    const district = pickAddrPart(addr, ['town', 'city_district', 'county', 'district', 'suburb']);
    const line1 = [city, district].filter(Boolean).join(' / ') || '—';
    const mahalle = pickAddrPart(addr, ['neighbourhood', 'quarter', 'suburb', 'village']);
    const road = pickAddrPart(addr, ['road', 'pedestrian', 'footway', 'residential']);
    const line2 = [mahalle ? mahalle + (document.documentElement.lang === 'en' ? ' Neigh.' : ' Mah.') : '', road]
      .filter(Boolean)
      .join(' · ') || (addr.display_name ? String(addr.display_name).split(',').slice(0, 2).join(' · ') : '—');
    return { line1, line2 };
  }

  async function reverseGeocode(lat, lon) {
    const url = 'https://nominatim.openstreetmap.org/reverse?format=json&lat='
      + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon)
      + '&zoom=18&addressdetails=1&accept-language=tr';
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('reverse geocode failed');
    const data = await res.json();
    return formatLocationLines(data.address || {});
  }

  function readCoordsFromHud() {
    const latT = $('gps-hud-lat')?.textContent || '';
    const lonT = $('gps-hud-lon')?.textContent || '';
    const lat = parseFloat(latT);
    const lon = parseFloat(lonT);
    if (!isNaN(lat) && !isNaN(lon)) return { lat, lon };
    return null;
  }

  async function refreshLocation() {
    if (!isInspectionMapActive()) return;
    const coords = readCoordsFromHud();
    if (!coords) {
      $('trial-loc-line1') && ($('trial-loc-line1').textContent = '—');
      $('trial-loc-line2') && ($('trial-loc-line2').textContent = document.documentElement.lang === 'en' ? 'Waiting for GPS…' : 'GPS bekleniyor…');
      return;
    }
    const key = coords.lat.toFixed(4) + ',' + coords.lon.toFixed(4);
    const now = Date.now();
    if (key === lastGeoCoords && now - lastGeoAt < GEO_CACHE_MS) return;
    if (geoPending) return;
    geoPending = true;
    try {
      const loc = await reverseGeocode(coords.lat, coords.lon);
      lastGeoCoords = key;
      lastGeoAt = Date.now();
      const l1 = $('trial-loc-line1');
      const l2 = $('trial-loc-line2');
      if (l1) l1.textContent = loc.line1;
      if (l2) l2.textContent = loc.line2;
      refreshWeather();
    } catch (e) {
      console.warn('[TrialShell] geocode', e);
    } finally {
      geoPending = false;
    }
  }

  function positionLocateCoach() {
    const coach = $('trial-locate-coach');
    const btn = $('btn-map-locate');
    const canvas = $('canvas-wrap');
    if (!coach || !btn || !canvas || !coach.classList.contains('show')) return;

    const cr = canvas.getBoundingClientRect();
    const br = btn.getBoundingClientRect();
    const gap = 12;
    const left = Math.max(8, Math.round(br.left - cr.left - coach.offsetWidth - gap));
    const top = Math.round(br.top - cr.top + br.height / 2);

    coach.style.left = left + 'px';
    coach.style.top = top + 'px';
    coach.style.right = 'auto';
    coach.style.transform = 'translateY(-50%)';
  }

  function bindLocateCoach() {
    const coach = $('trial-locate-coach');
    const btn = $('btn-map-locate');
    if (!coach || !btn) return;

    function dismissCoach() {
      coach.classList.remove('show');
      coach.hidden = true;
      btn.classList.remove('trial-locate-hint');
    }

    function showCoach() {
      if (!isInspectionMapActive()) return;
      coach.hidden = false;
      coach.classList.add('show');
      btn.classList.add('trial-locate-hint');
      requestAnimationFrame(() => {
        positionLocateCoach();
        requestAnimationFrame(positionLocateCoach);
      });
    }

    function hideCoach() {
      coach.classList.remove('show');
      coach.hidden = true;
      btn.classList.remove('trial-locate-hint');
    }

    btn.addEventListener('click', dismissCoach);
    coach.addEventListener('click', dismissCoach);

    const overlay = $('field-journey-hub-overlay');
    if (overlay) {
      new MutationObserver(() => {
        if (isHubOpen()) hideCoach();
        else setTimeout(showCoach, 450);
      }).observe(overlay, { attributes: true, attributeFilter: ['style', 'aria-hidden'] });
    }

    window.addEventListener('resize', () => requestAnimationFrame(positionLocateCoach));
    window.addEventListener('orientationchange', () => setTimeout(positionLocateCoach, 160));
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && isInspectionMapActive()) setTimeout(showCoach, 400);
    });
    setTimeout(showCoach, 900);
  }

  function positionTrialRightColumn() {
    if (!document.body.classList.contains('field-trial-ui') || isHubOpen()) return;
    const mapFloat = $('map-float-controls');
    const wrap = $('trial-finish-wrap');
    const canvas = $('canvas-wrap');
    const rightPanel = $('right-panel');
    if (!canvas) return;

    const cr = canvas.getBoundingClientRect();
    const cs = getComputedStyle(document.body);
    const topBase = parseFloat(cs.getPropertyValue('--field-topbar-h')) || 58;
    const edge = parseFloat(cs.getPropertyValue('--trial-edge')) || 10;
    const gap = parseFloat(cs.getPropertyValue('--trial-gap')) || 8;
    const colGap = parseFloat(cs.getPropertyValue('--trial-finish-locate-gap')) || 12;
    const rightInset = parseFloat(cs.getPropertyValue('--trial-map-col-inset')) || 56;

    const floatW = mapFloat ? mapFloat.offsetWidth : 44;
    const wrapW = wrap ? wrap.offsetWidth : 72;
    const colW = Math.max(floatW, wrapW, 44);

    let rightBound = cr.width - edge;
    if (rightPanel && rightPanel.style.display !== 'none') {
      const pr = rightPanel.getBoundingClientRect();
      rightBound = Math.min(rightBound, pr.left - cr.left - 8);
    }

    let centerX = rightBound - rightInset - colW / 2;
    const minCx = colW / 2 + edge;
    const maxCx = rightBound - colW / 2;
    centerX = Math.round(Math.min(maxCx, Math.max(minCx, centerX)));

    const topFloat = Math.round(topBase + edge + gap);

    if (mapFloat) {
      mapFloat.style.setProperty('position', 'absolute', 'important');
      mapFloat.style.setProperty('left', centerX + 'px', 'important');
      mapFloat.style.setProperty('right', 'auto', 'important');
      mapFloat.style.setProperty('top', topFloat + 'px', 'important');
      mapFloat.style.setProperty('transform', 'translateX(-50%)', 'important');
    }

    if (wrap) {
      let topFinish = topFloat + 120;
      if (mapFloat) {
        topFinish = Math.round(mapFloat.getBoundingClientRect().bottom - cr.top + colGap);
      }
      wrap.style.setProperty('left', centerX + 'px', 'important');
      wrap.style.setProperty('top', topFinish + 'px', 'important');
      wrap.style.setProperty('right', 'auto', 'important');
      wrap.style.setProperty('bottom', 'auto', 'important');
      wrap.style.setProperty('transform', 'translateX(-50%)', 'important');
    }

    const coach = $('trial-locate-coach');
    if (coach && coach.classList.contains('show')) {
      requestAnimationFrame(positionLocateCoach);
    }
  }

  function bindRightColumnAnchor() {
    const mapFloat = $('map-float-controls');
    const wrap = $('trial-finish-wrap');
    const canvas = $('canvas-wrap');
    const rightPanel = $('right-panel');
    if (!mapFloat && !wrap) return;

    const reposition = () => requestAnimationFrame(positionTrialRightColumn);
    window.addEventListener('resize', reposition);
    window.addEventListener('orientationchange', () => setTimeout(reposition, 160));
    if (typeof ResizeObserver !== 'undefined') {
      if (mapFloat) new ResizeObserver(reposition).observe(mapFloat);
      if (wrap) new ResizeObserver(reposition).observe(wrap);
      if (canvas) new ResizeObserver(reposition).observe(canvas);
      if (rightPanel) {
        new ResizeObserver(reposition).observe(rightPanel);
        const panelObs = new MutationObserver(reposition);
        panelObs.observe(rightPanel, { attributes: true, attributeFilter: ['style', 'class'] });
      }
    }
    setInterval(reposition, 700);
    reposition();
  }

  function positionTrialBrandFooter() {
    if (!document.body.classList.contains('field-trial-ui') || isHubOpen()) return;
    const foot = $('planai-brand-footer');
    const dock = $('field-dock');
    const canvas = $('canvas-wrap');
    if (!foot || !dock || !canvas) return;

    const cr = canvas.getBoundingClientRect();
    const dr = dock.getBoundingClientRect();
    const gap = 8;
    const centerX = Math.round(dr.left + dr.width / 2 - cr.left);
    const bottom = Math.max(0, Math.round(cr.bottom - dr.top + gap));

    foot.style.setProperty('left', centerX + 'px', 'important');
    foot.style.setProperty('right', 'auto', 'important');
    foot.style.setProperty('bottom', bottom + 'px', 'important');
    foot.style.setProperty('transform', 'translateX(-50%)', 'important');
  }

  function bindBrandFooterAnchor() {
    const foot = $('planai-brand-footer');
    const dock = $('field-dock');
    const canvas = $('canvas-wrap');
    const rightPanel = $('right-panel');
    if (!foot || !dock) return;

    const reposition = () => requestAnimationFrame(positionTrialBrandFooter);
    window.addEventListener('resize', reposition);
    window.addEventListener('orientationchange', () => setTimeout(reposition, 160));
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(reposition).observe(dock);
      if (canvas) new ResizeObserver(reposition).observe(canvas);
      if (rightPanel) {
        new ResizeObserver(reposition).observe(rightPanel);
        const panelObs = new MutationObserver(reposition);
        panelObs.observe(rightPanel, { attributes: true, attributeFilter: ['style', 'class'] });
      }
    }
    setInterval(reposition, 700);
    reposition();
  }

  function positionTrialGpsHud() {
    if (!document.body.classList.contains('field-trial-ui') || isHubOpen()) return;
    const hud = $('gps-hud');
    const leftBar = $('left-bar');
    const dock = $('field-dock');
    const canvas = $('canvas-wrap');
    if (!hud || !leftBar || !canvas) return;
    if (hud.style.display === 'none') return;

    const cr = canvas.getBoundingClientRect();
    const lbr = leftBar.getBoundingClientRect();
    const hGap = parseFloat(getComputedStyle(document.body).getPropertyValue('--trial-gps-left-gap'))
      || parseFloat(getComputedStyle(document.body).getPropertyValue('--trial-gap')) || 8;
    const left = Math.max(0, Math.round(lbr.right - cr.left + hGap));

    const dockRef = dock || $('btn-dock-projects');
    const vGap = parseFloat(getComputedStyle(document.body).getPropertyValue('--trial-gps-dock-gap')) || 14;
    let bottom = vGap;
    if (dockRef) {
      const dr = dockRef.getBoundingClientRect();
      bottom = Math.max(0, Math.round(cr.bottom - dr.top + vGap));
    }

    const minW = 200;
    const maxW = Math.min(240, Math.round(cr.width - left - 8));

    hud.style.setProperty('left', left + 'px', 'important');
    hud.style.setProperty('right', 'auto', 'important');
    hud.style.setProperty('bottom', bottom + 'px', 'important');
    hud.style.setProperty('min-width', minW + 'px', 'important');
    hud.style.setProperty('max-width', maxW + 'px', 'important');
    hud.style.removeProperty('width');
  }

  function bindGpsHudAnchor() {
    const hud = $('gps-hud');
    const dock = $('field-dock');
    const leftBar = $('left-bar');
    const canvas = $('canvas-wrap');
    const rightPanel = $('right-panel');
    if (!hud || !leftBar) return;

    const reposition = () => requestAnimationFrame(() => {
      positionTrialGpsHud();
      positionTrialBrandFooter();
    });
    window.addEventListener('resize', reposition);
    window.addEventListener('orientationchange', () => setTimeout(reposition, 160));
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(reposition).observe(leftBar);
      if (dock) new ResizeObserver(reposition).observe(dock);
      if (canvas) new ResizeObserver(reposition).observe(canvas);
      if (rightPanel) {
        new ResizeObserver(reposition).observe(rightPanel);
        const panelObs = new MutationObserver(reposition);
        panelObs.observe(rightPanel, { attributes: true, attributeFilter: ['style', 'class'] });
      }
    }
    const obs = new MutationObserver(reposition);
    obs.observe(hud, { attributes: true, attributeFilter: ['style', 'class'] });
    setInterval(reposition, 700);
    reposition();
  }

  function hubWatcher() {
    const overlay = $('field-journey-hub-overlay');
    if (!overlay) return;
    const obs = new MutationObserver(() => {
      if (isHubOpen()) {
        stopRecSession();
      } else if (isInspectionMapActive()) {
        startRecSession();
        requestAnimationFrame(positionTrialGpsHud);
        requestAnimationFrame(positionTrialBrandFooter);
        requestAnimationFrame(positionTrialRightColumn);
      }
    });
    obs.observe(overlay, { attributes: true, attributeFilter: ['style', 'aria-hidden'] });
  }

  function wrapHubAction(name) {
    const orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = async function (...args) {
      const result = await orig.apply(this, args);
      setTimeout(() => {
        if (isInspectionMapActive()) startRecSession();
      }, 120);
      return result;
    };
  }

  async function finishInspection() {
    if (!isInspectionMapActive()) return;
    const busy = $('trial-finish-btn');
    if (busy) busy.disabled = true;
    try {
      if (typeof window.scheduleProjectSave === 'function') window.scheduleProjectSave();
      if (typeof window.flushProjectSave === 'function') await window.flushProjectSave();
      if (typeof window.stopFieldGpsSession === 'function') window.stopFieldGpsSession();
      stopRecSession();
      lastGeoCoords = '';
      if (typeof window.reloadFieldHubProjects === 'function') await window.reloadFieldHubProjects();
      if (typeof window.refreshFieldJourneyHubUi === 'function') await window.refreshFieldJourneyHubUi();
      if (typeof window.showFieldJourneyHub === 'function') window.showFieldJourneyHub();
    } catch (e) {
      console.error('[TrialShell] finish', e);
    } finally {
      if (busy) busy.disabled = false;
    }
  }

  function bindFinish() {
    const btn = $('trial-finish-btn');
    if (btn) btn.addEventListener('click', () => finishInspection());
    window.fieldTrialFinishInspection = finishInspection;
  }

  function init() {
    if (!document.body.classList.contains('field-trial-ui')) return;
    try {
      const build = document.querySelector('meta[name="planai-field-build"]')?.content;
      if (build) console.info('[PlanAI Field] build', build);
    } catch (_) {}
    wrapHubAction('fieldHubActionNew');
    wrapHubAction('fieldHubActionContinue');
    wrapHubAction('fieldHubOpenJourney');
    hubWatcher();
    bindGpsHudAnchor();
    bindBrandFooterAnchor();
    bindRightColumnAnchor();
    bindLocateCoach();
    bindSunMode();
    bindClock();
    bindInteractionToggles();
    bindFinish();
    setInterval(() => {
      syncGpsBadge();
      syncAltitude();
      refreshLocation();
      refreshWeather();
      tickRec();
    }, 1200);
    setTimeout(() => {
      if (isInspectionMapActive()) startRecSession();
    }, 800);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  function getFieldTrialInspectionContext() {
    const altEl = $('trial-alt-value');
    const clockEl = $('trial-clock-time');
    if (!altEl && !clockEl && !$('trial-loc-line1') && !$('trial-wx-temp')) return null;
    const en = document.documentElement.lang === 'en' || (typeof PA_LANG !== 'undefined' && PA_LANG === 'en');
    const coords = readCoordsFromHud();
    const fix = typeof window.getFieldGpsDisplayFix === 'function' ? window.getFieldGpsDisplayFix() : null;
    const d = new Date();
    return {
      capturedAt: d.toISOString(),
      clock: clockEl?.textContent?.trim()
        || d.toLocaleTimeString(en ? 'en-GB' : 'tr-TR', { hour: '2-digit', minute: '2-digit', hour12: false }),
      altitude: altEl?.textContent?.trim() || lastElevValue || readAltitudeFromFix() || '—',
      temperature: $('trial-wx-temp')?.textContent?.trim() || '—',
      weatherLabel: $('trial-wx-label')?.textContent?.trim() || (en ? 'Weather' : 'Hava'),
      locationLine1: $('trial-loc-line1')?.textContent?.trim() || '—',
      locationLine2: $('trial-loc-line2')?.textContent?.trim() || '—',
      lat: coords?.lat ?? fix?.lat ?? null,
      lon: coords?.lon ?? fix?.lon ?? null,
    };
  }

  window.setTrialSunMode = setTrialSunMode;
  window.syncTrialSunWithLanguage = syncTrialSunWithLanguage;
  window.getFieldTrialInspectionContext = getFieldTrialInspectionContext;
})();
