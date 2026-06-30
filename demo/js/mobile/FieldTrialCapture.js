/**
 * PlanAI Field — trial: kısa video not (konum) + panoramik foto
 */
(function (global) {
  'use strict';

  const VIDEO_MAX_SEC = 15;
  const VIDEO_BITRATE = 750000;

  let _panoEngine = null;
  let _videoRec = null;
  let _videoChunks = [];
  let _videoStart = 0;
  let _videoTimer = null;
  let _videoStream = null;

  function $(id) { return document.getElementById(id); }

  function getPanoEngine() {
    if (!_panoEngine && global.PanoCaptureEngine) {
      _panoEngine = new global.PanoCaptureEngine();
      _panoEngine._onDone = async (file) => {
        if (typeof global.closeFieldCameraCaptureUi === 'function') {
          global.closeFieldCameraCaptureUi();
        }
        if (!file) return;
        if (typeof global.ingestFieldPhoto === 'function') {
          await global.ingestFieldPhoto(file);
          if (typeof global.markLastPhotoPanorama === 'function') global.markLastPhotoPanorama();
        }
        global.showHint?.(trialT('trial.panoSaved', 'Panorama saved', 'Panoramik foto kaydedildi'));
      };
    }
    return _panoEngine;
  }

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

  function updatePanoGuideUi() {
    getPanoEngine()?.updateUi();
  }

  function setPanoDirection(dir) {
    if (!global._fieldCameraPanoMode) return;
    const eng = getPanoEngine();
    if (!eng || eng.scanning) return;
    eng.setDirection(dir);
  }

  function enterPanoramaMode() {
    if (!isTrial()) return false;
    global._fieldCameraPanoMode = true;
    getPanoEngine()?.reset();
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
    global.showHint?.(trialT(
      'trial.panoModeOn',
      'Panorama mode — choose direction, tap shutter once',
      'Panorama modu — yön seçin, deklanşöre bir kez basın'
    ));
  }

  function clearPanoMode() {
    getPanoEngine()?.reset();
    global._fieldCameraPanoMode = false;
    updatePanoGuideUi();
  }

  async function onPanoShutter(videoEl) {
    if (!videoEl?.videoWidth || !global._fieldCameraPanoMode) return;
    const eng = getPanoEngine();
    if (!eng || eng.scanning) return;
    global.showHint?.(trialT('trial.panoLoadingCv', 'Loading panorama engine…', 'Panorama motoru yükleniyor…'));
    try {
      await global.PanoOpenCvLoader.ensure();
    } catch (err) {
      console.error('[FieldTrialCapture] OpenCV', err);
      global.showHint?.(trialT('trial.panoCvFailed', 'Panorama engine unavailable', 'Panorama motoru yüklenemedi'));
      return;
    }
    await eng.start(videoEl);
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
