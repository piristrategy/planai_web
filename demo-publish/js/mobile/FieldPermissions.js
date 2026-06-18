'use strict';
/**
 * PlanAI Field™ — in-app permission management (GPS, camera, mic, photos).
 * Developed by PiriStrategy. © Taner Piri / PiriStrategy. All rights reserved.
 */
const FieldPermissions = (function () {
  const PERM_DEFS = [
    { id: 'location', icon: '📍', labelKey: 'perm.location', descKey: 'perm.locationDesc' },
    { id: 'camera', icon: '📷', labelKey: 'perm.camera', descKey: 'perm.cameraDesc' },
    { id: 'microphone', icon: '🎤', labelKey: 'perm.microphone', descKey: 'perm.microphoneDesc' },
    { id: 'photos', icon: '🖼', labelKey: 'perm.photos', descKey: 'perm.photosDesc' },
  ];

  let _status = {};
  let _open = false;

  function isNative() {
    const c = window.Capacitor;
    return !!(c && c.isNativePlatform && c.isNativePlatform());
  }

  function getPlugin() {
    const cap = window.Capacitor;
    if (!cap) return null;
    if (cap.Plugins?.PlanAIMediaPermissions) return cap.Plugins.PlanAIMediaPermissions;
    try { return cap.registerPlugin?.('PlanAIMediaPermissions'); } catch (_) { return null; }
  }

  function getCameraPlugin() {
    const cap = window.Capacitor;
    if (!cap) return null;
    if (cap.Plugins?.Camera) return cap.Plugins.Camera;
    try { return cap.registerPlugin?.('Camera'); } catch (_) { return null; }
  }

  function getDictationPlugin() {
    const cap = window.Capacitor;
    if (!cap) return null;
    if (cap.Plugins?.PlanAIDictation) return cap.Plugins.PlanAIDictation;
    try { return cap.registerPlugin?.('PlanAIDictation'); } catch (_) { return null; }
  }

  function t(key) {
    return typeof window.t === 'function' ? window.t(key) : key;
  }

  function normalizeState(raw) {
    if (!raw) return 'unknown';
    const s = String(raw).toLowerCase();
    if (s === 'granted' || s === 'prompt' || s === 'denied') return s;
    if (s === 'prompt-with-rationale') return 'prompt';
    return 'unknown';
  }

  async function nativeCheck(alias) {
    const plugin = getPlugin();
    if (!plugin?.checkPermissions) return null;
    try {
      const st = await plugin.checkPermissions();
      return normalizeState(st?.[alias]);
    } catch (_) {
      return null;
    }
  }

  async function nativeRequest(alias) {
    const plugin = getPlugin();
    if (!plugin?.requestPermissions) return null;
    try {
      let st = await plugin.checkPermissions();
      if (normalizeState(st?.[alias]) === 'granted') return true;
      st = await plugin.requestPermissions({ permissions: [alias] });
      return normalizeState(st?.[alias]) === 'granted';
    } catch (_) {
      return null;
    }
  }

  async function webCheckLocation() {
    try {
      if (navigator.permissions?.query) {
        const r = await navigator.permissions.query({ name: 'geolocation' });
        return normalizeState(r.state);
      }
    } catch (_) {}
    return 'unknown';
  }

  async function webCheckMic() {
    try {
      if (navigator.permissions?.query) {
        const r = await navigator.permissions.query({ name: 'microphone' });
        return normalizeState(r.state);
      }
    } catch (_) {}
    return 'unknown';
  }

  async function webCheckCamera() {
    try {
      if (navigator.permissions?.query) {
        const r = await navigator.permissions.query({ name: 'camera' });
        return normalizeState(r.state);
      }
    } catch (_) {}
    return 'unknown';
  }

  async function check(id) {
    if (isNative()) {
      let st = await nativeCheck(id);
      if (st !== null) return st;
      if (id === 'camera') {
        const cam = getCameraPlugin();
        if (cam?.checkPermissions) {
          try {
            const r = await cam.checkPermissions();
            return normalizeState(r?.camera);
          } catch (_) {}
        }
      }
      if (id === 'microphone') {
        const dict = getDictationPlugin();
        if (dict?.checkPermissions) {
          try {
            const r = await dict.checkPermissions();
            return normalizeState(r?.microphone);
          } catch (_) {}
        }
      }
      return 'unknown';
    }
    if (id === 'location') return webCheckLocation();
    if (id === 'microphone') return webCheckMic();
    if (id === 'camera') return webCheckCamera();
    if (id === 'photos') return 'granted';
    return 'unknown';
  }

  async function checkAll() {
    const out = {};
    for (const p of PERM_DEFS) {
      out[p.id] = await check(p.id);
    }
    _status = out;
    return out;
  }

  async function requestWebLocation() {
    if (!navigator.geolocation) return false;
    return new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        () => resolve(true),
        () => resolve(false),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
      );
    });
  }

  async function requestWebMedia(kind) {
    if (!navigator.mediaDevices?.getUserMedia) return false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        kind === 'camera' ? { video: true, audio: false } : { audio: true, video: false }
      );
      stream.getTracks().forEach(tr => tr.stop());
      return true;
    } catch (_) {
      return false;
    }
  }

  async function request(id, opts) {
    opts = opts || {};
    let ok = false;
    if (isNative()) {
      ok = await nativeRequest(id);
      if (ok === null && id === 'camera') {
        const cam = getCameraPlugin();
        ok = await nativeRequestVia(cam, 'camera');
      }
      if (ok === null && id === 'microphone') {
        const dict = getDictationPlugin();
        ok = await nativeRequestVia(dict, 'microphone');
      }
      if (ok === null) ok = false;
    } else if (id === 'location') {
      ok = await requestWebLocation();
    } else if (id === 'camera') {
      ok = await requestWebMedia('camera');
    } else if (id === 'microphone') {
      ok = await requestWebMedia('microphone');
    } else if (id === 'photos') {
      ok = true;
    }
    _status[id] = ok ? 'granted' : 'denied';
    if (!ok && opts.hintDenied && typeof showHint === 'function') {
      showHint(opts.hintDenied, 7000);
    } else if (!ok && typeof showHint === 'function') {
      showHint(t('perm.denied'), 6000);
    } else if (ok && opts.hintGranted && typeof showHint === 'function') {
      showHint(opts.hintGranted, 4000);
    }
    renderList();
    return ok;
  }

  async function nativeRequestVia(plugin, alias) {
    if (!plugin?.checkPermissions || !plugin?.requestPermissions) return null;
    try {
      let st = await plugin.checkPermissions();
      if (normalizeState(st?.[alias]) === 'granted') return true;
      st = await plugin.requestPermissions({ permissions: [alias] });
      return normalizeState(st?.[alias]) === 'granted';
    } catch (_) {
      return null;
    }
  }

  async function openAppSettings() {
    const plugin = getPlugin();
    if (plugin?.openAppSettings) {
      try {
        await plugin.openAppSettings();
        return true;
      } catch (_) {}
    }
    if (typeof showHint === 'function') {
      showHint(isNative() ? t('perm.settingsFail') : t('perm.settingsWeb'), 8000);
    }
    return false;
  }

  function statusLabel(state) {
    if (state === 'granted') return t('perm.granted');
    if (state === 'denied') return t('perm.denied');
    if (state === 'prompt') return t('perm.prompt');
    return t('perm.unknown');
  }

  function statusClass(state) {
    if (state === 'granted') return 'granted';
    if (state === 'denied') return 'denied';
    return 'pending';
  }

  function renderList() {
    const el = document.getElementById('field-permissions-list');
    if (!el) return;
    el.innerHTML = '';
    PERM_DEFS.forEach(p => {
      const st = _status[p.id] || 'unknown';
      const row = document.createElement('div');
      row.className = 'fperm-row';
      row.innerHTML =
        '<div class="fperm-row-main">'
        + '<span class="fperm-icon" aria-hidden="true">' + p.icon + '</span>'
        + '<div class="fperm-text">'
        + '<span class="fperm-name">' + escapeHtml(t(p.labelKey)) + '</span>'
        + '<span class="fperm-desc">' + escapeHtml(t(p.descKey)) + '</span>'
        + '</div>'
        + '<span class="fperm-badge ' + statusClass(st) + '">' + escapeHtml(statusLabel(st)) + '</span>'
        + '</div>'
        + '<button type="button" class="fperm-btn" data-perm="' + p.id + '">' + escapeHtml(t('perm.allow')) + '</button>';
      el.appendChild(row);
    });
    el.querySelectorAll('.fperm-btn').forEach(btn => {
      btn.onclick = async () => {
        const id = btn.dataset.perm;
        btn.disabled = true;
        await request(id);
        btn.disabled = false;
      };
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function openPanel() {
    _open = true;
    document.getElementById('field-permissions-sheet')?.classList.add('open');
    document.getElementById('field-permissions-backdrop')?.classList.add('open');
    document.body.classList.add('field-permissions-open');
    checkAll().then(() => renderList());
  }

  function closePanel() {
    _open = false;
    document.getElementById('field-permissions-sheet')?.classList.remove('open');
    document.getElementById('field-permissions-backdrop')?.classList.remove('open');
    document.body.classList.remove('field-permissions-open');
  }

  function bindPanelChrome() {
    const sheet = document.getElementById('field-permissions-sheet');
    const backdrop = document.getElementById('field-permissions-backdrop');
    if (backdrop && !backdrop.dataset.fpermBound) {
      backdrop.dataset.fpermBound = '1';
      backdrop.addEventListener('click', closePanel);
    }
    if (sheet && !sheet.dataset.fpermBound) {
      sheet.dataset.fpermBound = '1';
      sheet.addEventListener('click', (e) => e.stopPropagation());
    }
    const closeX = document.querySelector('.fperm-close');
    if (closeX && !closeX.dataset.fpermBound) {
      closeX.dataset.fpermBound = '1';
      closeX.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closePanel();
      });
    }
    const closeBtn = document.getElementById('fperm-btn-close');
    if (closeBtn && !closeBtn.dataset.fpermBound) {
      closeBtn.dataset.fpermBound = '1';
      closeBtn.addEventListener('click', (e) => {
        e.preventDefault();
        closePanel();
      });
    }
    const settingsBtn = document.getElementById('fperm-btn-settings');
    if (settingsBtn && !settingsBtn.dataset.fpermBound) {
      settingsBtn.dataset.fpermBound = '1';
      settingsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        openAppSettings();
      });
    }
    if (!document.body.dataset.fpermEscBound) {
      document.body.dataset.fpermEscBound = '1';
      document.addEventListener('keydown', (e) => {
        if (!_open) return;
        if (e.key === 'Escape') {
          e.preventDefault();
          closePanel();
        }
      });
    }
  }

  function init() {
    bindPanelChrome();
    document.addEventListener('visibilitychange', () => {
      if (_open && document.visibilityState === 'visible') {
        checkAll().then(() => renderList());
      }
    });
  }

  const api = {
    init,
    check,
    checkAll,
    request,
    openAppSettings,
    openPanel,
    closePanel,
    isNative,
  };

  if (typeof window !== 'undefined') window.FieldPermissions = api;

  return api;
})();
