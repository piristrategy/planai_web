/**
 * PlanAI Field — trial: kısa video not (konum) + panoramik foto
 */
(function (global) {
  'use strict';

  const VIDEO_MAX_SEC = 15;
  const VIDEO_BITRATE = 750000;
  const PANO_FRAMES = 3;
  const PANO_GAP_MS = 900;

  let _videoStream = null;
  let _videoRec = null;
  let _videoChunks = [];
  let _videoStart = 0;
  let _videoTimer = null;
  let _panoFrames = [];
  let _panoStep = 0;
  let _panoDir = 'left';

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
      ? ['video/mp4', 'video/webm;codecs=vp8,opus', 'video/webm']
      : [
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9,opus',
        'video/webm',
        'video/mp4',
      ];
    for (let i = 0; i < types.length; i++) {
      if (global.MediaRecorder?.isTypeSupported?.(types[i])) return types[i];
    }
    return '';
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
      const mic = await global.FieldPermissions.request('microphone', { hintDenied: trialT('photo.micDenied', 'Microphone denied', 'Mikrofon izni gerekli') });
      if (!cam || !mic) return false;
    }
    closeVideoUi();
    try {
      const mime = videoMime();
      _videoStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
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

    _videoChunks = [];
    const opts = { mimeType: mime, videoBitsPerSecond: VIDEO_BITRATE };
    if (!isIosWebKit()) opts.audioBitsPerSecond = 96000;
    try {
      _videoRec = new MediaRecorder(_videoStream, opts);
    } catch (_) {
      try { _videoRec = new MediaRecorder(_videoStream, { mimeType: mime }); } catch (e2) {
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
      await new Promise((r) => setTimeout(r, isIosWebKit() ? 250 : 80));
      const dur = Math.max(1, Math.min(VIDEO_MAX_SEC, Math.round((Date.now() - _videoStart) / 1000)));
      const outMime = _videoRec?.mimeType || mime;
      const blob = new Blob(_videoChunks, { type: outMime });
      _videoRec = null;
      _videoChunks = [];
      if (!blob.size) {
        closeVideoUi();
        global.showHint?.(trialT('trial.videoEmpty', 'Empty recording', 'Kayıt boş'));
        return;
      }
      global.showHint?.(trialT('trial.videoProcessing', 'Saving video…', 'Video kaydediliyor…'));
      try {
        await saveFieldVideo(blob, outMime, dur);
      } finally {
        closeVideoUi();
      }
    };
    _videoRec.onerror = () => {
      _videoRec = null;
      global.showHint?.(trialT('trial.videoUnsupported', 'Video recording not supported', 'Video kaydı desteklenmiyor'));
    };

    _videoStart = Date.now();
    if (isIosWebKit()) _videoRec.start();
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
    const overlap = 0.18;
    const step = Math.max(1, Math.round(scaled[0].width * (1 - overlap)));
    const out = document.createElement('canvas');
    out.width = scaled[0].width + step * (scaled.length - 1);
    out.height = h;
    const ctx = out.getContext('2d');
    let x = 0;
    scaled.forEach((c, i) => {
      ctx.drawImage(c, x, 0);
      x += step;
    });
    return out;
  }

  function updatePanoGuideUi() {
    const guide = $('field-camera-pano-guide');
    const hint = $('field-camera-pano-hint');
    const btnL = $('field-pano-dir-left');
    const btnR = $('field-pano-dir-right');
    const panoBtn = $('field-camera-pano-btn');
    const dots = $('field-pano-progress')?.querySelectorAll('.field-pano-dot');
    const active = !!global._fieldCameraPanoMode;
    if (guide) guide.hidden = !active;
    if (panoBtn) panoBtn.classList.toggle('active', active);
    if (btnL) btnL.classList.toggle('active', _panoDir === 'left');
    if (btnR) btnR.classList.toggle('active', _panoDir === 'right');
    const line = guide?.querySelector('.field-pano-line');
    if (line) {
      line.classList.toggle('dir-left', _panoDir === 'left');
      line.classList.toggle('dir-right', _panoDir === 'right');
    }
    if (hint) {
      const step = _panoFrames.length;
      if (step === 0) {
        hint.textContent = trialT('trial.panoStart', 'Align with the line, tap shutter', 'Çizgiye hizalayın, deklanşöre basın');
      } else if (step < PANO_FRAMES) {
        hint.textContent = _panoDir === 'left'
          ? trialT('trial.panoPanLeft', 'Slowly pan left along the line, capture again', 'Çizgi boyunca yavaşça sola çevirin, tekrar çekin')
          : trialT('trial.panoPanRight', 'Slowly pan right along the line, capture again', 'Çizgi boyunca yavaşça sağa çevirin, tekrar çekin');
      } else {
        hint.textContent = trialT('trial.panoStitch', 'Stitching…', 'Birleştiriliyor…');
      }
    }
    if (dots) dots.forEach((d, i) => d.classList.toggle('filled', i < _panoFrames.length));
  }

  function setPanoDirection(dir) {
    if (!global._fieldCameraPanoMode) return;
    _panoDir = dir === 'right' ? 'right' : 'left';
    updatePanoGuideUi();
  }

  function enterPanoramaMode() {
    if (!isTrial()) return false;
    global._fieldCameraPanoMode = true;
    _panoFrames = [];
    _panoStep = 0;
    _panoDir = 'left';
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
    global.showHint?.(trialT('trial.panoModeOn', 'Panorama mode — pan along the line', 'Panorama modu — çizgi boyunca hareket edin'));
  }

  function clearPanoMode() {
    global._fieldCameraPanoMode = false;
    _panoFrames = [];
    _panoStep = 0;
    updatePanoGuideUi();
  }

  async function onPanoShutter(videoEl) {
    if (!videoEl?.videoWidth) return;
    const c = document.createElement('canvas');
    c.width = videoEl.videoWidth;
    c.height = videoEl.videoHeight;
    c.getContext('2d').drawImage(videoEl, 0, 0);
    _panoFrames.push(c);
    _panoStep = _panoFrames.length;

    if (_panoFrames.length < PANO_FRAMES) {
      updatePanoGuideUi();
      global.showHint?.(trialT('trial.panoStep', 'Frame ' + _panoFrames.length + '/' + PANO_FRAMES, 'Kare ' + _panoFrames.length + '/' + PANO_FRAMES));
      return;
    }

    updatePanoGuideUi();
    const stitched = stitchPanorama(_panoFrames);
    clearPanoMode();
    if (typeof global.closeFieldCameraCaptureUi === 'function') global.closeFieldCameraCaptureUi();
    if (!stitched) return;
    const blob = await new Promise((res) => stitched.toBlob(res, 'image/jpeg', 0.86));
    if (!blob) return;
    const file = new File([blob], 'field-pano-' + Date.now() + '.jpg', { type: 'image/jpeg' });
    if (typeof global.ingestFieldPhoto === 'function') {
      await global.ingestFieldPhoto(file);
      if (typeof global.markLastPhotoPanorama === 'function') global.markLastPhotoPanorama();
    }
    global.showHint?.(trialT('trial.panoSaved', 'Panorama saved', 'Panoramik foto kaydedildi'));
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
      const row = await global.getPhotoBlobRecord(obj.videoId, 'video');
      if (row?.data) {
        vidEl._blobUrl = URL.createObjectURL(row.data);
        vidEl.src = vidEl._blobUrl;
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
