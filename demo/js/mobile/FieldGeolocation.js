'use strict';
/**
 * PlanAI Field — unified geolocation (web + Capacitor iOS/Android).
 * Dual strategy: enableHighAccuracy:false → GSM/Wi‑Fi (coarse), true → GPS (fine).
 */
const FieldGeolocation = (function () {
  let _plugin = null;
  let _native = false;
  let _watchSeq = 0;
  const _capWatchIds = new Map();
  const _pendingClear = new Set();

  function cap() {
    return window.Capacitor || null;
  }

  function platform() {
    const c = cap();
    return (c && typeof c.getPlatform === 'function') ? c.getPlatform() : 'web';
  }

  function isNative() {
    const c = cap();
    return !!(c && typeof c.isNativePlatform === 'function' && c.isNativePlatform());
  }

  function getPlugin() {
    if (_plugin) return _plugin;
    const c = cap();
    if (!c) return null;
    _plugin = c.Plugins?.Geolocation || null;
    if (!_plugin && typeof c.registerPlugin === 'function') {
      try { _plugin = c.registerPlugin('Geolocation'); } catch (_) { /* ignore */ }
    }
    return _plugin;
  }

  function init() {
    _native = isNative();
    if (_native) getPlugin();
  }

  function normalizeError(err) {
    if (!err) return { code: 2, message: 'Position unavailable' };
    if (typeof err.code === 'number') return err;
    const msg = String(err.message || err.errorMessage || err || 'Geolocation error');
    if (/denied|permission/i.test(msg)) return { code: 1, message: msg };
    if (/timeout/i.test(msg)) return { code: 3, message: msg };
    return { code: 2, message: msg };
  }

  function buildOptions(options, channel) {
    options = options || {};
    const hi = !!options.enableHighAccuracy;
    const out = {
      enableHighAccuracy: hi,
      timeout: options.timeout != null ? options.timeout : (hi ? 30000 : 12000),
      maximumAge: options.maximumAge != null ? options.maximumAge : (hi ? 1000 : 10000),
    };
    if (platform() === 'android') {
      out.minimumUpdateInterval = hi ? 1000 : 3500;
    }
    if (channel === 'network') out.enableHighAccuracy = false;
    if (channel === 'gps') out.enableHighAccuracy = true;
    return out;
  }

  function available() {
    if (_native) return !!getPlugin();
    return !!(navigator.geolocation && typeof navigator.geolocation.getCurrentPosition === 'function');
  }

  async function requestPermissions() {
    const plugin = getPlugin();
    if (!plugin?.requestPermissions) return { location: 'granted', coarseLocation: 'granted' };
    try {
      if (platform() === 'android') {
        return await plugin.requestPermissions({ permissions: ['coarseLocation', 'location'] });
      }
      return await plugin.requestPermissions({ permissions: ['location'] });
    } catch (e) {
      console.warn('[FieldGeolocation] requestPermissions', e);
      return { location: 'denied', coarseLocation: 'denied' };
    }
  }

  function getCurrentPosition(success, error, options, channel) {
    const opts = buildOptions(options, channel);
    const plugin = getPlugin();
    if (_native && plugin?.getCurrentPosition) {
      plugin.getCurrentPosition(opts)
        .then((pos) => { if (success) success(pos); })
        .catch((e) => { if (error) error(normalizeError(e)); });
      return;
    }
    if (!navigator.geolocation) {
      if (error) error({ code: 2, message: 'Geolocation not supported' });
      return;
    }
    navigator.geolocation.getCurrentPosition(success, error, opts);
  }

  function watchPosition(success, error, options, channel) {
    const opts = buildOptions(options, channel);
    const plugin = getPlugin();
    const localId = 'fgw_' + (++_watchSeq);
    if (_native && plugin?.watchPosition) {
      plugin.watchPosition(opts, (position, err) => {
        if (err) {
          if (error) error(normalizeError(err));
          return;
        }
        if (position && success) success(position);
      }).then((capId) => {
        if (_pendingClear.has(localId)) {
          plugin.clearWatch({ id: capId }).catch(() => {});
          _pendingClear.delete(localId);
        } else {
          _capWatchIds.set(localId, capId);
        }
      }).catch((e) => {
        if (error) error(normalizeError(e));
      });
      return localId;
    }
    if (!navigator.geolocation) {
      if (error) error({ code: 2, message: 'Geolocation not supported' });
      return null;
    }
    const webId = navigator.geolocation.watchPosition(success, error, opts);
    _capWatchIds.set(localId, webId);
    return localId;
  }

  function clearWatch(localId) {
    if (localId == null) return;
    const mapped = _capWatchIds.get(localId);
    const plugin = getPlugin();
    if (_native && plugin?.clearWatch) {
      if (mapped) {
        plugin.clearWatch({ id: mapped }).catch(() => {});
        _capWatchIds.delete(localId);
      } else {
        _pendingClear.add(localId);
      }
      return;
    }
    if (mapped != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(mapped);
      _capWatchIds.delete(localId);
    }
  }

  init();

  return {
    available,
    isNative: () => _native,
    platform,
    requestPermissions,
    getCurrentPosition,
    watchPosition,
    clearWatch,
    /** @param {'network'|'gps'|undefined} channel */
    getNetworkPosition: (ok, err, opts) => getCurrentPosition(ok, err, opts, 'network'),
    watchNetworkPosition: (ok, err, opts) => watchPosition(ok, err, opts, 'network'),
    getGpsPosition: (ok, err, opts) => getCurrentPosition(ok, err, opts, 'gps'),
    watchGpsPosition: (ok, err, opts) => watchPosition(ok, err, opts, 'gps'),
  };
})();

window.FieldGeolocation = FieldGeolocation;
