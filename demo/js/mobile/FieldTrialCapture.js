/**
 * PlanAI Field — trial: kısa video not (konum) + panoramik foto
 */
(function (global) {
  'use strict';

  const VIDEO_MAX_SEC = 15;
  const VIDEO_BITRATE = 750000;
  const PANO_SCAN_MS = 5200;
  const PANO_CAPTURE_MS = 300;
  const PANO_MIN_FRAMES = 5;
  const PANO_MAX_FRAMES = 14;
  const PANO_FILM_SLOTS = 14;
  const PANO_CAPTURE_MAX_W = 960;
  const PANO_MATCH_MAX_W = 240;

  let _videoStream = null;
  let _videoRec = null;
  let _videoChunks = [];
  let _videoStart = 0;
  let _videoTimer = null;
  let _panoFrames = [];
  let _panoDir = 'right';
  let _panoScanning = false;
  let _panoCaptureTimer = null;
  let _panoScanAnim = 0;
  let _panoScanDone = null;

  function $(id) { return document.getElementById(id); }

  function isTrial() {
    return document.body.classList.contains('field-trial-ui');
  }

  function trialT(key, en, tr) {
    if (typeof global.t === 'function') return global.t(key);
    const L = global.PA_LANG === 'en' ? 'en' : 'tr';
    return L === 'en' ? en : tr;
  }

  function isIosWebKit() {
    const ua = navigator.userAgent || '';
    const iPadOs = navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
    return /iPad|iPhone|iPod/.test(ua) || iPadOs;
  }

  function videoMime() {
    const types = isIosWebKit()
      ? ['video/mp4', 'video/mp4;codecs=avc1', 'video/webm']
      : [
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9,opus',
        'video/webm',
        'video/mp4',
      ];
    for (let i = 0; i < types.length; i++) {
      if (global.MediaRecorder?.isTypeSupported?.(types[i])) return types[i];
    }
    if (isIosWebKit() && typeof global.MediaRecorder !== 'undefined') return 'video/mp4';
    return '';
  }

  function recorderInputStream() {
    const preview = $('field-video-preview');
    if (isIosWebKit() && preview?.captureStream) {
      try {
        const cap = preview.captureStream(15);
        if (cap?.getVideoTracks?.().length) return cap;
      } catch (_) {}
    }
    if (!_videoStream) return null;
    if (isIosWebKit()) {
      const vt = _videoStream.getVideoTracks();
      if (vt.length) return new MediaStream(vt);
    }
    return _videoStream;
  }

  async function capturePreviewFrame(preview) {
    if (!preview?.videoWidth) return null;
    const c = document.createElement('canvas');
    c.width = preview.videoWidth;
    c.height = preview.videoHeight;
    c.getContext('2d').drawImage(preview, 0, 0);
    return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.88));
  }

  async function saveFieldVideo(blob, mime, durationSec) {
    if (typeof global.ingestFieldVideo !== 'function') {
      global.showHint?.(trialT('trial.videoUnsupported', 'Video save failed', 'Video kaydedilemedi'));
      return;
    }
    try {
      await global.ingestFieldVideo(blob, mime, durationSec);
    } catch (err) {
      console.error('[FieldTrialCapture] ingestFieldVideo', err);
      global.showHint?.(trialT('trial.videoUnsupported', 'Video save failed', 'Video kaydedilemedi'));
    }
  }

  function closeVideoUi() {
    const ov = $('field-video-overlay');
    ov?.classList.remove('open');
    if (ov) ov.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('field-video-open');
    const video = $('field-video-preview');
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    if (_videoTimer) {
      clearInterval(_videoTimer);
      _videoTimer = null;
    }
    if (_videoRec && _videoRec.state === 'recording') {
      try { _videoRec.stop(); } catch (_) {}
    }
    _videoRec = null;
    if (_videoStream) {
      _videoStream.getTracks().forEach((t) => t.stop());
      _videoStream = null;
    }
    if (global._fieldGpsOn && typeof global.resumeGpsAfterInterruption === 'function') {
      global.resumeGpsAfterInterruption();
    } else if (typeof global.isFieldGpsOn === 'function' && global.isFieldGpsOn() && typeof global.resumeGpsAfterInterruption === 'function') {
      global.resumeGpsAfterInterruption();
    }
  }

  function updateVideoTimer() {
    const el = $('field-video-timer');
    if (!el || !_videoStart) return;
    const sec = Math.min(VIDEO_MAX_SEC, Math.floor((Date.now() - _videoStart) / 1000));
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    el.textContent = mm + ':' + ss;
    if (sec >= VIDEO_MAX_SEC && _videoRec?.state === 'recording') {
      stopVideoRecord();
    }
  }

  async function openVideoUi() {
    const ov = $('field-video-overlay');
    const video = $('field-video-preview');
    if (!ov || !video || !navigator.mediaDevices?.getUserMedia) {
      global.showHint?.(trialT('trial.videoUnsupported', 'Video recording not supported', 'Video kaydı desteklenmiyor'));
      return false;
    }
    if (typeof global.FieldPermissions !== 'undefined') {
      const cam = await global.FieldPermissions.request('camera', { hintDenied: trialT('photo.camDenied', 'Camera denied', 'Kamera izni gerekli') });
      if (!cam) return false;
      if (!isIosWebKit()) {
        const mic = await global.FieldPermissions.request('microphone', { hintDenied: trialT('photo.micDenied', 'Microphone denied', 'Mikrofon izni gerekli') });
        if (!mic) return false;
      } else {
        await global.FieldPermissions.request('microphone', { hintDenied: trialT('photo.micDenied', 'Microphone denied', 'Mikrofon izni gerekli') });
      }
    }
    closeVideoUi();
    try {
      const useAudio = !isIosWebKit() || (typeof global.FieldPermissions !== 'undefined'
        ? (await global.FieldPermissions.check?.('microphone')) === 'granted'
        : false);
      _videoStream = await navigator.mediaDevices.getUserMedia({
        audio: useAudio,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280, max: 1280 },
          height: { ideal: 720, max: 720 },
          frameRate: { ideal: 24, max: 30 },
        },
      });
      video.srcObject = _videoStream;
      video.muted = true;
      await video.play();
      ov.classList.add('open');
      ov.setAttribute('aria-hidden', 'false');
      document.body.classList.add('field-video-open');
      const hint = $('field-video-hint');
      if (hint) hint.textContent = trialT('trial.videoHint', 'Max ' + VIDEO_MAX_SEC + 's · location only', 'Maks ' + VIDEO_MAX_SEC + ' sn · yalnızca konum notu');
      updateVideoTimer();
      return true;
    } catch (_) {
      closeVideoUi();
      global.showHint?.(trialT('trial.videoUnsupported', 'Video recording not supported', 'Video kaydı desteklenmiyor'));
      return false;
    }
  }

  function stopVideoRecord() {
    if (_videoRec && _videoRec.state === 'recording') {
      try { _videoRec.requestData(); } catch (_) {}
      _videoRec.stop();
    }
  }

  async function toggleVideoRecord() {
    const video = $('field-video-preview');
    const btn = $('field-video-record-btn');
    if (!video) return;

    if (_videoRec && _videoRec.state === 'recording') {
      stopVideoRecord();
      return;
    }

    if (!_videoStream || _videoStream.getTracks().every((t) => t.readyState === 'ended')) {
      global.showHint?.(trialT('trial.videoUnsupported', 'Camera not ready', 'Kamera hazır değil'));
      await openVideoUi();
      return;
    }

    const mime = videoMime();
    if (!mime || typeof MediaRecorder === 'undefined') {
      global.showHint?.(trialT('trial.videoUnsupported', 'Video recording not supported', 'Video kaydı desteklenmiyor'));
      return;
    }

    const recordStream = recorderInputStream();
    if (!recordStream) {
      global.showHint?.(trialT('trial.videoUnsupported', 'Camera not ready', 'Kamera hazır değil'));
      await openVideoUi();
      return;
    }

    _videoChunks = [];
    const opts = isIosWebKit()
      ? { mimeType: mime }
      : { mimeType: mime, videoBitsPerSecond: VIDEO_BITRATE, audioBitsPerSecond: 96000 };
    try {
      _videoRec = new MediaRecorder(recordStream, opts);
    } catch (_) {
      try { _videoRec = new MediaRecorder(recordStream, { mimeType: mime }); } catch (e2) {
        global.showHint?.(trialT('trial.videoUnsupported', 'Video recording not supported', 'Video kaydı desteklenmiyor'));
        return;
      }
    }

    _videoRec.ondataavailable = (e) => { if (e.data?.size) _videoChunks.push(e.data); };
    _videoRec.onstop = async () => {
      if (_videoTimer) {
        clearInterval(_videoTimer);
        _videoTimer = null;
      }
      const btn = $('field-video-record-btn');
      if (btn) btn.classList.remove('recording');
      const preview = $('field-video-preview');
      await new Promise((r) => setTimeout(r, isIosWebKit() ? 400 : 80));
      const dur = Math.max(1, Math.min(VIDEO_MAX_SEC, Math.round((Date.now() - _videoStart) / 1000)));
      const outMime = _videoRec?.mimeType || mime;
      let blob = new Blob(_videoChunks, { type: outMime });
      _videoRec = null;
      _videoChunks = [];
      let saveMime = outMime;
      if (!blob.size && preview) {
        const frame = await capturePreviewFrame(preview);
        if (frame?.size) {
          blob = frame;
          saveMime = 'image/jpeg';
        }
      }
      if (!blob.size) {
        closeVideoUi();
        global.showHint?.(trialT('trial.videoEmpty', 'Empty recording', 'Kayıt boş'));
        return;
      }
      global.showHint?.(trialT('trial.videoProcessing', 'Saving video…', 'Video kaydediliyor…'));
      try {
        await saveFieldVideo(blob, saveMime, dur);
      } finally {
        closeVideoUi();
      }
    };
    _videoRec.onerror = () => {
      _videoRec = null;
      global.showHint?.(trialT('trial.videoUnsupported', 'Video recording not supported', 'Video kaydı desteklenmiyor'));
    };

    _videoStart = Date.now();
    if (isIosWebKit()) _videoRec.start(1000);
    else _videoRec.start(500);
    if (btn) btn.classList.add('recording');
    _videoTimer = setInterval(updateVideoTimer, 250);
    updateVideoTimer();
  }

  function startVideoNote() {
    if (!isTrial()) return;
    global.requireProject?.(() => {
      if (typeof global.closeFieldPhotoSheet === 'function') global.closeFieldPhotoSheet();
      if (typeof global.toggleFieldGps === 'function' && typeof global.isFieldGpsOn === 'function') {
        if (!global.isFieldGpsOn()) {
          global.toggleFieldGps();
          global.showHint?.(trialT('trial.gpsForVideo', 'GPS enabled for video note', 'Video not için GPS açıldı'));
        }
      } else if (typeof global.toggleFieldGps === 'function') {
        global.toggleFieldGps();
      }
      openVideoUi();
    });
  }

  function stopPanoScanTimers() {
    if (_panoCaptureTimer) {
      clearInterval(_panoCaptureTimer);
      _panoCaptureTimer = null;
    }
    if (_panoScanAnim) {
      cancelAnimationFrame(_panoScanAnim);
      _panoScanAnim = 0;
    }
    _panoScanning = false;
    document.body.classList.remove('field-pano-scanning');
    $('field-pano-film')?.classList.remove('scanning');
  }

  function ensurePanoFilmSlots() {
    const strip = $('field-pano-film-strip');
    if (!strip || strip.childElementCount === PANO_FILM_SLOTS) return;
    strip.innerHTML = '';
    for (let i = 0; i < PANO_FILM_SLOTS; i++) {
      const slot = document.createElement('span');
      slot.className = 'field-pano-film-slot';
      strip.appendChild(slot);
    }
  }

  function updatePanoFilmUi(progress) {
    ensurePanoFilmSlots();
    const slots = $('field-pano-film-strip')?.querySelectorAll('.field-pano-film-slot');
    if (!slots?.length) return;
    let prog = progress;
    if (!Number.isFinite(prog)) {
      prog = Math.min(1, _panoFrames.length / Math.max(PANO_MIN_FRAMES, PANO_MAX_FRAMES - 1));
    }
    const filledCount = Math.max(0, Math.min(PANO_FILM_SLOTS, Math.round(prog * PANO_FILM_SLOTS)));
    slots.forEach((slot, i) => {
      slot.classList.toggle('filled', i < filledCount);
      slot.style.backgroundImage = '';
    });
  }

  function setScanHeadProgress(t) {
    const head = $('field-pano-scan-head');
    const film = $('field-pano-film');
    if (!head || !film) return;
    const windowEl = film.querySelector('.field-pano-film-window');
    const w = windowEl?.clientWidth || film.clientWidth;
    const p = Math.max(0, Math.min(1, t));
    head.style.left = Math.round(p * w) + 'px';
  }

  function capturePanoFrame(videoEl) {
    if (!videoEl?.videoWidth) return null;
    const srcW = videoEl.videoWidth;
    const srcH = videoEl.videoHeight;
    const scale = Math.min(1, PANO_CAPTURE_MAX_W / srcW);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(srcW * scale));
    c.height = Math.max(1, Math.round(srcH * scale));
    c.getContext('2d').drawImage(videoEl, 0, 0, c.width, c.height);
    return c;
  }

  function downscaleCanvas(src, maxW) {
    if (src.width <= maxW) return src;
    const sc = maxW / src.width;
    const c = document.createElement('canvas');
    c.width = maxW;
    c.height = Math.max(1, Math.round(src.height * sc));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  function grayPlane(ctx, w, h) {
    const sampleW = Math.min(w, 160);
    const sampleH = Math.max(1, Math.round(h * (sampleW / w)));
    const tmp = document.createElement('canvas');
    tmp.width = sampleW;
    tmp.height = sampleH;
    const tctx = tmp.getContext('2d');
    tctx.drawImage(ctx.canvas, 0, 0, w, h, 0, 0, sampleW, sampleH);
    const img = tctx.getImageData(0, 0, sampleW, sampleH).data;
    const out = new Float32Array(sampleW * sampleH);
    for (let i = 0, p = 0; i < img.length; i += 4, p++) {
      out[p] = img[i] * 0.299 + img[i + 1] * 0.587 + img[i + 2] * 0.114;
    }
    return { gray: out, w: sampleW, h: sampleH };
  }

  function overlapScore(planeA, planeB, overlapW) {
    const { gray: grayA, w: wA, h } = planeA;
    const { gray: grayB, w: wB } = planeB;
    const ow = Math.min(overlapW, wA, wB);
    let sum = 0;
    let n = 0;
    const yStep = 4;
    const xStep = 4;
    for (let y = 0; y < h; y += yStep) {
      for (let ox = 0; ox < ow; ox += xStep) {
        const ax = wA - ow + ox;
        const bx = ox;
        const d = grayA[y * wA + ax] - grayB[y * wB + bx];
        sum += d * d;
        n++;
      }
    }
    return n ? sum / n : Infinity;
  }

  function findBestOverlap(smallA, smallB) {
    const h = Math.min(smallA.height, smallB.height);
    const ga = grayPlane(smallA.getContext('2d'), smallA.width, h);
    const gb = grayPlane(smallB.getContext('2d'), smallB.width, h);
    const minOw = Math.max(6, Math.round(smallA.width * 0.16));
    const maxOw = Math.max(minOw + 4, Math.round(smallA.width * 0.38));
    let bestOw = Math.round(smallA.width * 0.26);
    let best = Infinity;
    const step = Math.max(3, Math.round(smallA.width * 0.04));
    for (let ow = minOw; ow <= maxOw; ow += step) {
      const s = overlapScore(ga, gb, ow);
      if (s < best) {
        best = s;
        bestOw = ow;
      }
    }
    return bestOw;
  }

  function stitchPanorama(canvases) {
    if (!canvases.length) return null;
    const h = Math.min.apply(null, canvases.map((c) => c.height));
    const scaled = canvases.map((c) => {
      const sc = h / c.height;
      const w = Math.max(1, Math.round(c.width * sc));
      const oc = document.createElement('canvas');
      oc.width = w;
      oc.height = h;
      oc.getContext('2d').drawImage(c, 0, 0, w, h);
      return oc;
    });

    const placements = [{ x: 0, w: scaled[0].width, canvas: scaled[0], overlap: 0 }];
    for (let i = 1; i < scaled.length; i++) {
      const prevSmall = downscaleCanvas(scaled[i - 1], PANO_MATCH_MAX_W);
      const curSmall = downscaleCanvas(scaled[i], PANO_MATCH_MAX_W);
      const owSmall = findBestOverlap(prevSmall, curSmall);
      const scale = scaled[i - 1].width / prevSmall.width;
      const overlap = Math.max(8, Math.round(owSmall * scale));
      const x = placements[i - 1].x + scaled[i - 1].width - overlap;
      placements.push({ x, w: scaled[i].width, canvas: scaled[i], overlap });
    }

    const totalW = placements[placements.length - 1].x + placements[placements.length - 1].w;
    const out = document.createElement('canvas');
    out.width = Math.max(1, totalW);
    out.height = h;
    const ctx = out.getContext('2d');

    placements.forEach((p) => {
      ctx.drawImage(p.canvas, p.x, 0);
    });
    return out;
  }

  function stitchPanoramaAsync(canvases) {
    return new Promise((resolve) => {
      setTimeout(() => resolve(stitchPanorama(canvases)), 20);
    });
  }

  function updatePanoGuideUi() {
    const guide = $('field-camera-pano-guide');
    const hint = $('field-camera-pano-hint');
    const btnL = $('field-pano-dir-left');
    const btnR = $('field-pano-dir-right');
    const panoBtn = $('field-camera-pano-btn');
    const active = !!global._fieldCameraPanoMode;
    if (guide) guide.hidden = !active;
    if (panoBtn) panoBtn.classList.toggle('active', active);
    if (btnL) {
      btnL.classList.toggle('active', _panoDir === 'left');
      btnL.disabled = _panoScanning;
    }
    if (btnR) {
      btnR.classList.toggle('active', _panoDir === 'right');
      btnR.disabled = _panoScanning;
    }
    if (hint) {
      if (_panoScanning) {
        hint.textContent = _panoDir === 'right'
          ? trialT('trial.panoScanRight', 'Pan slowly to the right…', 'Yavaşça sağa çevirin…')
          : trialT('trial.panoScanLeft', 'Pan slowly to the left…', 'Yavaşça sola çevirin…');
      } else if (_panoFrames.length) {
        hint.textContent = trialT('trial.panoStitch', 'Stitching…', 'Birleştiriliyor…');
      } else {
        hint.textContent = trialT('trial.panoStartScan', 'Choose direction, tap shutter to scan', 'Yön seçin, taramak için deklanşöre basın');
      }
    }
    if (!active) setScanHeadProgress(0);
    else updatePanoFilmUi();
  }

  function setPanoDirection(dir) {
    if (!global._fieldCameraPanoMode || _panoScanning) return;
    _panoDir = dir === 'left' ? 'left' : 'right';
    setScanHeadProgress(_panoDir === 'right' ? 0 : 1);
    updatePanoGuideUi();
  }

  function enterPanoramaMode() {
    if (!isTrial()) return false;
    global._fieldCameraPanoMode = true;
    _panoFrames = [];
    _panoDir = 'right';
    stopPanoScanTimers();
    ensurePanoFilmSlots();
    setScanHeadProgress(0);
    updatePanoGuideUi();
    return true;
  }

  function togglePanoramaMode() {
    if (!isTrial()) return;
    if (global._fieldCameraPanoMode) {
      clearPanoMode();
      return;
    }
    enterPanoramaMode();
    global.showHint?.(trialT('trial.panoModeOn', 'Panorama mode — scan along the film strip', 'Panorama modu — film şeridi boyunca tarayın'));
  }

  function clearPanoMode() {
    stopPanoScanTimers();
    global._fieldCameraPanoMode = false;
    _panoFrames = [];
    updatePanoGuideUi();
  }

  async function finishPanoScan(videoEl) {
    if (_panoScanDone) return _panoScanDone;
    _panoScanDone = (async () => {
      stopPanoScanTimers();
      updatePanoGuideUi();
      if (_panoFrames.length < PANO_MIN_FRAMES) {
        _panoFrames = [];
        updatePanoFilmUi();
        setScanHeadProgress(_panoDir === 'right' ? 0 : 1);
        global.showHint?.(trialT('trial.panoTooFew', 'Scan again — pan more slowly', 'Tekrar tarayın — daha yavaş çevirin'));
        _panoScanDone = null;
        return;
      }
      global.showHint?.(trialT('trial.panoStitch', 'Stitching…', 'Birleştiriliyor…'));
      const frames = _panoFrames.slice();
      _panoFrames = [];
      const stitched = await stitchPanoramaAsync(frames);
      clearPanoMode();
      if (typeof global.closeFieldCameraCaptureUi === 'function') global.closeFieldCameraCaptureUi();
      if (!stitched) {
        _panoScanDone = null;
        return;
      }
      const blob = await new Promise((res) => stitched.toBlob(res, 'image/jpeg', 0.9));
      if (!blob) {
        _panoScanDone = null;
        return;
      }
      const file = new File([blob], 'field-pano-' + Date.now() + '.jpg', { type: 'image/jpeg' });
      if (typeof global.ingestFieldPhoto === 'function') {
        await global.ingestFieldPhoto(file);
        if (typeof global.markLastPhotoPanorama === 'function') global.markLastPhotoPanorama();
      }
      global.showHint?.(trialT('trial.panoSaved', 'Panorama saved', 'Panoramik foto kaydedildi') +
        ' (' + frames.length + ' ' + trialT('trial.panoFrames', 'frames', 'kare') + ')');
      _panoScanDone = null;
    })();
    return _panoScanDone;
  }

  async function onPanoShutter(videoEl) {
    if (!videoEl?.videoWidth || !global._fieldCameraPanoMode) return;
    if (_panoScanning) return;
    _panoFrames = [];
    _panoScanning = true;
    _panoScanDone = null;
    document.body.classList.add('field-pano-scanning');
    const film = $('field-pano-film');
    film?.classList.add('scanning');
    updatePanoGuideUi();

    const first = capturePanoFrame(videoEl);
    if (first) _panoFrames.push(first);
    updatePanoFilmUi(0);

    const start = performance.now();
    const from = _panoDir === 'right' ? 0 : 1;
    const to = _panoDir === 'right' ? 1 : 0;
    setScanHeadProgress(from);

    _panoCaptureTimer = setInterval(() => {
      if (!_panoScanning) return;
      const frame = capturePanoFrame(videoEl);
      if (frame) _panoFrames.push(frame);
      if (_panoFrames.length >= PANO_MAX_FRAMES) finishPanoScan(videoEl);
    }, PANO_CAPTURE_MS);

    const tick = (now) => {
      if (!_panoScanning) return;
      const t = Math.min(1, (now - start) / PANO_SCAN_MS);
      setScanHeadProgress(from + (to - from) * t);
      updatePanoFilmUi(t);
      if (t < 1) {
        _panoScanAnim = requestAnimationFrame(tick);
      } else {
        finishPanoScan(videoEl);
      }
    };
    _panoScanAnim = requestAnimationFrame(tick);
  }

  function startPanorama() {
    if (!isTrial()) return;
    global.requireProject?.(() => {
      if (typeof global.closeFieldPhotoSheet === 'function') global.closeFieldPhotoSheet();
      enterPanoramaMode();
      if (typeof global.fieldPhotoCaptureCamera === 'function') global.fieldPhotoCaptureCamera();
    });
  }

  async function showVideoPanel(obj) {
    if (!obj || obj.type !== 'field_video') return;
    global._fieldCtxPhotoId = obj.id;
    const panel = $('right-panel');
    if (panel?.style.display === 'none') {
      panel.style.display = 'block';
      document.body.classList.add('field-panel-right');
    }
    const objP = $('field-right-obj');
    const noteP = $('field-right-note');
    const photoP = $('field-right-photo');
    if (objP) objP.style.display = 'none';
    if (noteP) noteP.style.display = 'none';
    if (photoP) photoP.style.display = 'block';

    const titleEl = $('field-photo-panel-title');
    if (titleEl) titleEl.textContent = obj.title || trialT('trial.videoTitle', 'Video note', 'Video not');
    const descWrap = $('field-photo-desc')?.closest('.field-text-dictate-wrap');
    const voiceLbl = photoP?.querySelector('.p-label[data-i18n="photo.voice"]');
    const voiceStatus = $('field-voice-status');
    const voiceBtns = photoP?.querySelector('.field-voice-btns');
    if (descWrap) descWrap.style.display = 'none';
    if (voiceLbl) voiceLbl.style.display = 'none';
    if (voiceStatus) voiceStatus.style.display = 'none';
    if (voiceBtns) voiceBtns.style.display = 'none';

    const imgEl = $('field-photo-preview');
    const vidEl = $('field-video-panel-player');
    if (imgEl) imgEl.style.display = 'none';
    if (vidEl) {
      vidEl.style.display = 'block';
      if (vidEl._blobUrl) URL.revokeObjectURL(vidEl._blobUrl);
      const row = typeof global.getPhotoBlobRecord === 'function'
        ? await global.getPhotoBlobRecord(obj.videoId, 'video')
        : null;
      if (row?.data) {
        const mime = row.mime || row.data.type || '';
        if (mime.startsWith('image/')) {
          vidEl.style.display = 'none';
          if (imgEl) {
            imgEl.style.display = 'block';
            if (imgEl._blobUrl) URL.revokeObjectURL(imgEl._blobUrl);
            imgEl._blobUrl = URL.createObjectURL(row.data);
            imgEl.src = imgEl._blobUrl;
          }
        } else {
          vidEl._blobUrl = URL.createObjectURL(row.data);
          vidEl.src = vidEl._blobUrl;
        }
      }
    }
    const meta = $('field-photo-meta');
    if (meta) {
      meta.textContent = (obj.timestamp ? new Date(obj.timestamp).toLocaleString('tr-TR') : '—') + '\n' +
        (obj.lat?.toFixed(5) || '—') + '°, ' + (obj.lon?.toFixed(5) || '—') + '°\n' +
        trialT('trial.videoDur', 'Duration: ' + (obj.duration || 0) + 's', 'Süre: ' + (obj.duration || 0) + ' sn');
    }
    if (typeof global.scheduleRender === 'function') global.scheduleRender();
  }

  function resetPhotoPanelChrome() {
    const descWrap = $('field-photo-desc')?.closest('.field-text-dictate-wrap');
    const photoP = $('field-right-photo');
    const voiceLbl = photoP?.querySelector('.p-label[data-i18n="photo.voice"]');
    const voiceStatus = $('field-voice-status');
    const voiceBtns = photoP?.querySelector('.field-voice-btns');
    const imgEl = $('field-photo-preview');
    const vidEl = $('field-video-panel-player');
    if (descWrap) descWrap.style.display = '';
    if (voiceLbl) voiceLbl.style.display = '';
    if (voiceStatus) voiceStatus.style.display = '';
    if (voiceBtns) voiceBtns.style.display = '';
    if (imgEl) imgEl.style.display = '';
    if (vidEl) {
      vidEl.pause();
      vidEl.removeAttribute('src');
      vidEl.style.display = 'none';
      if (vidEl._blobUrl) URL.revokeObjectURL(vidEl._blobUrl);
      vidEl._blobUrl = null;
    }
  }

  global.FieldTrialCapture = {
    startVideoNote,
    startPanorama,
    togglePanoramaMode,
    setPanoDirection,
    enterPanoramaMode,
    refreshPanoGuide: updatePanoGuideUi,
    closeVideo: closeVideoUi,
    toggleVideoRecord,
    onPanoShutter,
    clearPanoMode,
    showVideoPanel,
    resetPhotoPanelChrome,
    isTrial,
  };
})(window);
