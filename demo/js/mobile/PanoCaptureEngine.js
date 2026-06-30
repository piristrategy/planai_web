/**
 * PlanAI Field — panorama capture engine (motion-gated frames + live guide UI).
 */
(function (global) {
  'use strict';

  const TARGET_OVERLAP = 0.35;
  const TARGET_YAW_DEG = 72;
  const MIN_FRAMES = 3;
  const MAX_FRAMES = 14;
  const CAPTURE_MAX_W = 1440;
  const ANALYSIS_W = 360;
  const MIN_CAPTURE_INTERVAL_MS = 450;
  const SCAN_TIMEOUT_MS = 22000;
  const FAST_DEG_PER_SEC = 42;
  const SLOW_DEG_PER_SEC = 4;
  const PITCH_DRIFT_DEG = 11;

  function $(id) { return document.getElementById(id); }

  function trialT(key, en, tr) {
    if (typeof global.t === 'function') return global.t(key);
    const L = global.PA_LANG === 'en' ? 'en' : 'tr';
    return L === 'en' ? en : tr;
  }

  function angleDelta(from, to) {
    let d = to - from;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  }

  function readHeading(e) {
    if (e && typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) {
      return e.webkitCompassHeading;
    }
    if (e && typeof e.alpha === 'number' && Number.isFinite(e.alpha)) return e.alpha;
    return null;
  }

  function readPitch(e) {
    if (e && typeof e.beta === 'number' && Number.isFinite(e.beta)) return e.beta;
    return null;
  }

  function grabGray(video, maxW) {
    if (!video?.videoWidth) return null;
    const sc = Math.min(1, maxW / video.videoWidth);
    const w = Math.max(1, Math.round(video.videoWidth * sc));
    const h = Math.max(1, Math.round(video.videoHeight * sc));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(video, 0, 0, w, h);
    const img = ctx.getImageData(0, 0, w, h);
    const gray = new Float32Array(w * h);
    const d = img.data;
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      gray[p] = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    }
    return { gray, w, h, canvas: c };
  }

  function captureFrameCanvas(video) {
    const sc = Math.min(1, CAPTURE_MAX_W / video.videoWidth);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(video.videoWidth * sc));
    c.height = Math.max(1, Math.round(video.videoHeight * sc));
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    return c;
  }

  function stripNcc(prev, curr, dir) {
    const w = prev.w;
    const h = prev.h;
    const band = Math.max(24, Math.round(w * 0.38));
    let best = -1;
    let bestDx = 0;
    const maxShift = Math.round(w * 0.22);
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      let sum = 0;
      let n = 0;
      for (let y = 4; y < h - 4; y += 3) {
        for (let x = 0; x < band; x++) {
          let xPrev;
          let xCurr;
          if (dir === 'right') {
            xPrev = w - band + x;
            xCurr = x + dx;
          } else {
            xPrev = x;
            xCurr = w - band + x + dx;
          }
          if (xCurr < 0 || xCurr >= w || xPrev < 0 || xPrev >= w) continue;
          const a = prev.gray[y * w + xPrev];
          const b = curr.gray[y * w + xCurr];
          sum += 1 - Math.abs(a - b) / 255;
          n++;
        }
      }
      if (n && sum / n > best) {
        best = sum / n;
        bestDx = dx;
      }
    }
    return { score: best, dx: bestDx };
  }

  function overlapReady(prev, curr, dir, state) {
    const w = curr.w;
    const { score, dx } = stripNcc(prev, curr, dir);
    if (score < 0.5) return false;
    if (state._lastMatchDx == null) {
      state._lastMatchDx = dx;
      return false;
    }
    const delta = Math.abs(dx - state._lastMatchDx);
    state._opticalTravel += delta;
    state._lastMatchDx = dx;
    const need = w * (1 - TARGET_OVERLAP);
    if (state._opticalTravel >= need * 0.88) {
      state._opticalTravel = 0;
      state._lastMatchDx = dx;
      return true;
    }
    return false;
  }

  function bandWidth(w) { return Math.max(24, Math.round(w * 0.38)); }

  class PanoCaptureEngine {
    constructor() {
      this.dir = 'right';
      this.scanning = false;
      this.frames = [];
      this.lastGray = null;
      this.lastCaptureAt = 0;
      this.lastHeading = null;
      this.basePitch = null;
      this.totalYaw = 0;
      this._video = null;
      this._raf = 0;
      this._orientHandler = null;
      this._lastOrientTs = 0;
      this._lastYawSpeed = 0;
      this._motion = 'guide';
      this._scanStart = 0;
      this._useOrient = false;
      this._onDone = null;
      this._opticalTravel = 0;
      this._lastMatchDx = null;
    }

    setDirection(dir) {
      if (this.scanning) return;
      this.dir = dir === 'left' ? 'left' : 'right';
      this.updateUi();
    }

    async requestOrientation() {
      if (typeof global.DeviceOrientationEvent === 'undefined') return false;
      if (typeof global.DeviceOrientationEvent.requestPermission === 'function') {
        try {
          const res = await global.DeviceOrientationEvent.requestPermission();
          this._useOrient = res === 'granted';
          return this._useOrient;
        } catch (_) {
          return false;
        }
      }
      this._useOrient = true;
      return true;
    }

    updateUi() {
      const guide = $('field-camera-pano-guide');
      const dirRow = $('field-pano-dir-row');
      const hint = $('field-pano-motion-hint');
      const pct = $('field-pano-progress-pct');
      const fill = $('field-pano-progress-fill');
      const preview = $('field-pano-stitch-preview');
      const panoBtn = $('field-camera-pano-btn');

      if (guide) guide.hidden = !global._fieldCameraPanoMode;
      if (panoBtn) panoBtn.classList.toggle('active', !!global._fieldCameraPanoMode);
      if (dirRow) dirRow.hidden = this.scanning;
      $('field-pano-dir-left')?.classList.toggle('active', this.dir === 'left');
      $('field-pano-dir-right')?.classList.toggle('active', this.dir === 'right');

      const progress = Math.min(100, Math.round((this.totalYaw / TARGET_YAW_DEG) * 100));
      if (pct) pct.textContent = progress + '%';
      if (fill) fill.style.width = progress + '%';

      if (!this.scanning && hint) {
        hint.textContent = trialT('trial.panoStartScan', 'Choose direction, tap shutter to scan', 'Yön seçin, taramak için deklanşöre basın');
        hint.dataset.state = 'idle';
      } else if (this.scanning && hint) {
        const key = {
          guide: ['trial.panoKeepMoving', 'Keep moving…', 'Çevirmeye devam edin…'],
          fast: ['trial.panoTooFast', 'Too fast', 'Çok hızlı'],
          slow: ['trial.panoTooSlow', 'Too slow', 'Çok yavaş'],
          up: ['trial.panoMoveUp', 'Move up', 'Yukarı kaydırın'],
          down: ['trial.panoMoveDown', 'Move down', 'Aşağı kaydırın'],
          return: ['trial.panoReturnGuide', 'Return to guide', 'Çizgiye dönün'],
        }[this._motion] || ['trial.panoKeepMoving', 'Keep moving…', 'Çevirmeye devam edin…'];
        hint.textContent = trialT(key[0], key[1], key[2]);
        hint.dataset.state = this._motion;
      }

      if (preview) preview.hidden = !this.scanning || preview.width < 2;
      document.body.classList.toggle('field-pano-scanning', this.scanning);
    }

    setMotion(state) {
      if (this._motion !== state) {
        this._motion = state;
        this.updateUi();
      }
    }

    bindOrientation() {
      this._orientHandler = (e) => {
        if (!this.scanning) return;
        const now = performance.now();
        const h = readHeading(e);
        const pitch = readPitch(e);
        if (pitch != null && this.basePitch == null) this.basePitch = pitch;
        if (h != null) {
          if (this.lastHeading != null && this._lastOrientTs) {
            const dt = (now - this._lastOrientTs) / 1000;
            if (dt > 0 && dt < 0.5) {
              const delta = angleDelta(this.lastHeading, h);
              const signed = this.dir === 'right' ? delta : -delta;
              this._lastYawSpeed = signed / dt;
              if (signed > 0.2) this.totalYaw += signed;
            }
          }
          this.lastHeading = h;
          this._lastOrientTs = now;
        }
        if (pitch != null && this.basePitch != null) {
          const drift = pitch - this.basePitch;
          if (drift > PITCH_DRIFT_DEG) this.setMotion('down');
          else if (drift < -PITCH_DRIFT_DEG) this.setMotion('up');
        }
        if (Math.abs(this._lastYawSpeed) > FAST_DEG_PER_SEC) this.setMotion('fast');
        else if (this._lastYawSpeed < -2) this.setMotion('return');
      };
      window.addEventListener('deviceorientation', this._orientHandler, true);
    }

    stopOrientation() {
      if (this._orientHandler) {
        window.removeEventListener('deviceorientation', this._orientHandler, true);
        this._orientHandler = null;
      }
    }

    shouldCaptureOptical(curr) {
      if (!this.lastGray) return true;
      if (this._motion === 'fast' || this._motion === 'return' || this._motion === 'up' || this._motion === 'down') {
        return false;
      }
      const ready = overlapReady(this.lastGray, curr, this.dir, this);
      if (!ready) {
        if (this._useOrient && this._lastYawSpeed > 0 && this._lastYawSpeed < SLOW_DEG_PER_SEC) {
          this.setMotion('slow');
        } else {
          this.setMotion('guide');
        }
        return false;
      }
      this.setMotion('guide');
      return true;
    }

    tick = () => {
      if (!this.scanning || !this._video) return;
      const now = performance.now();
      if (now - this._scanStart > SCAN_TIMEOUT_MS) {
        this.finishScan();
        return;
      }
      const curr = grabGray(this._video, ANALYSIS_W);
      if (!curr) {
        this._raf = requestAnimationFrame(this.tick);
        return;
      }
      if (this.frames.length === 0) {
        this.frames.push(captureFrameCanvas(this._video));
        this.lastGray = curr;
        this.lastCaptureAt = now;
        this._opticalTravel = 0;
        this._lastMatchDx = null;
        this.updateUi();
      } else if (now - this.lastCaptureAt >= MIN_CAPTURE_INTERVAL_MS && this.shouldCaptureOptical(curr)) {
        const yawGate = !this._useOrient || this._lastYawSpeed >= SLOW_DEG_PER_SEC;
        if (yawGate) {
          this.frames.push(captureFrameCanvas(this._video));
          this.lastGray = curr;
          this.lastCaptureAt = now;
          this._opticalTravel = 0;
          this._lastMatchDx = null;
          this.updateUi();
          if (this.frames.length >= MAX_FRAMES || this.totalYaw >= TARGET_YAW_DEG) {
            this.finishScan();
            return;
          }
        }
      }
      if (this._useOrient && this._lastYawSpeed > 0 && this._lastYawSpeed < SLOW_DEG_PER_SEC && this._motion === 'guide') {
        this.setMotion('slow');
      }
      this._raf = requestAnimationFrame(this.tick);
    };

    async start(video) {
      if (!video?.videoWidth || this.scanning) return;
      await this.requestOrientation();
      this._video = video;
      this.scanning = true;
      this.frames = [];
      this.lastGray = null;
      this.lastHeading = null;
      this.basePitch = null;
      this.totalYaw = 0;
      this._scanStart = performance.now();
      this._motion = 'guide';
      this.updateUi();
      if (this._useOrient) this.bindOrientation();
      this._raf = requestAnimationFrame(this.tick);
    }

    stopCapture() {
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = 0;
      this.stopOrientation();
      this.scanning = false;
      document.body.classList.remove('field-pano-scanning');
    }

    async finishScan() {
      if (!this.scanning) return;
      this.stopCapture();
      const frames = this.frames.slice();
      this.frames = [];
      this.updateUi();

      if (frames.length < MIN_FRAMES) {
        global._fieldCameraPanoMode = true;
        this.updateUi();
        global.showHint?.(trialT('trial.panoFailed', 'Panorama failed. Please move slower.', 'Panorama başarısız. Daha yavaş hareket edin.'));
        return;
      }

      const preview = $('field-pano-stitch-preview');
      if (preview) {
        preview.hidden = false;
        preview.classList.add('visible');
      }
      $('field-pano-motion-hint').textContent = trialT('trial.panoStitch', 'Stitching…', 'Birleştiriliyor…');

      let stitched = null;
      try {
        stitched = await global.PanoStitcher.stitch(frames, (pct, canvas) => {
          $('field-pano-progress-pct').textContent = pct + '%';
          $('field-pano-progress-fill').style.width = pct + '%';
          if (canvas && preview) {
            preview.width = canvas.width;
            preview.height = canvas.height;
            preview.getContext('2d').drawImage(canvas, 0, 0);
            preview.hidden = false;
          }
        });
      } catch (err) {
        console.error('[PanoCaptureEngine] stitch', err);
      }

      if (preview) preview.classList.remove('visible');

      if (!stitched) {
        global._fieldCameraPanoMode = true;
        this.updateUi();
        global.showHint?.(trialT('trial.panoFailed', 'Panorama failed. Please move slower.', 'Panorama başarısız. Daha yavaş hareket edin.'));
        if (this._onDone) this._onDone(null);
        return;
      }

      global._fieldCameraPanoMode = false;
      this.updateUi();

      const blob = await new Promise((res) => stitched.toBlob(res, 'image/jpeg', 0.93));
      if (this._onDone) this._onDone(blob ? new File([blob], 'field-pano-' + Date.now() + '.jpg', { type: 'image/jpeg' }) : null);
    }

    reset() {
      this.stopCapture();
      this.frames = [];
      this.totalYaw = 0;
      this._opticalTravel = 0;
      this._lastMatchDx = null;
      this.updateUi();
    }
  }

  global.PanoCaptureEngine = PanoCaptureEngine;
})(window);
