'use strict';
/**
 * PlanAI Field™ — render coordinator (RAF scheduler & perf metrics).
 * Developed by PiriStrategy. © Taner Piri / PiriStrategy. All rights reserved.
 */
const RenderCoordinator = (function () {
  const STATE = { SETTLED: 'SETTLED', INTERACTING: 'INTERACTING' };
  const MODE = { LOW: 'LOW', FULL: 'FULL' };
  const DIRTY = { ALL: 1, VECTORS: 2, OVERLAY: 4 };

  const SETTLE_MS = 150;
  const INTERACT_THROTTLE_MS = 33;

  let state = STATE.SETTLED;
  let interactionKind = null;
  let dirty = DIRTY.ALL;
  let renderFn = null;
  let onFrameComplete = null;

  let rafPending = false;
  let throttleTimer = null;
  let settleTimer = null;
  let lastInteractPaint = 0;

  const metrics = {
    redrawCount: 0,
    fastPathRedraws: 0,
    fullPathRedraws: 0,
    skippedThrottles: 0,
    lastFrameCullCount: 0,
    totalCulled: 0,
    lastFrameMs: 0,
    frameDts: [],
    fps: 0,
    lastLogAt: 0,
    lastPaintAt: 0,
    lastFrameStats: null,
  };

  function init(opts) {
    opts = opts || {};
    renderFn = opts.render;
    onFrameComplete = opts.onFrameComplete || null;
    if (!renderFn) console.warn('[RenderCoordinator] render callback missing');
  }

  function getRenderMode() {
    return state === STATE.INTERACTING ? MODE.LOW : MODE.FULL;
  }

  function beginInteraction(kind) {
    state = STATE.INTERACTING;
    interactionKind = kind || 'pan';
    dirty |= DIRTY.VECTORS;
    scheduleSettle();
    requestPaint();
  }

  function endInteraction() {
    scheduleSettle();
  }

  function scheduleSettle() {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (state !== STATE.INTERACTING) return;
      state = STATE.SETTLED;
      interactionKind = null;
      dirty = DIRTY.ALL;
      requestPaint();
      logMetrics('settle');
    }, SETTLE_MS);
  }

  function schedule(flags) {
    if (state === STATE.SETTLED && flags) dirty |= flags;
    requestPaint();
  }

  function requestPaint() {
    if (rafPending) return;

    const now = performance.now();
    if (state === STATE.INTERACTING) {
      const elapsed = now - lastInteractPaint;
      if (lastInteractPaint > 0 && elapsed < INTERACT_THROTTLE_MS) {
        metrics.skippedThrottles++;
        if (!throttleTimer) {
          const wait = INTERACT_THROTTLE_MS - elapsed;
          throttleTimer = setTimeout(() => {
            throttleTimer = null;
            requestPaint();
          }, wait);
        }
        return;
      }
    }

    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      if (!renderFn) return;

      const t0 = performance.now();
      const fastPath = state === STATE.INTERACTING;
      metrics.lastFrameCullCount = 0;
      metrics.lastFrameStats = null;

      const frameStats = {
        drawCalls: 0,
        visiblePolygons: 0,
        visibleObjects: 0,
        cacheHits: 0,
        cacheMisses: 0,
      };

      renderFn({
        fastPath,
        renderMode: fastPath ? MODE.LOW : MODE.FULL,
        state,
        interactionKind,
        dirty,
        frameStats,
      });

      const dt = performance.now() - t0;
      metrics.lastFrameStats = frameStats;
      recordPaint(dt, fastPath);
      lastInteractPaint = performance.now();
      dirty = 0;

      emitFrameComplete(dt, fastPath, frameStats);
    });
  }

  function emitFrameComplete(dt, fastPath, frameStats) {
    const snap = {
      renderMode: fastPath ? MODE.LOW : MODE.FULL,
      state,
      interactionKind,
      fps: metrics.fps,
      frameMs: dt,
      redrawCount: metrics.redrawCount,
      drawCalls: frameStats.drawCalls,
      visiblePolygons: frameStats.visiblePolygons,
      visibleObjects: frameStats.visibleObjects,
      culled: metrics.lastFrameCullCount,
      cacheHits: frameStats.cacheHits,
      cacheMisses: frameStats.cacheMisses,
      lod: fastPath ? 'LOW' : 'FULL',
      skippedThrottles: metrics.skippedThrottles,
    };
    if (onFrameComplete) onFrameComplete(snap);
  }

  function recordPaint(dt, fastPath) {
    metrics.redrawCount++;
    if (fastPath) metrics.fastPathRedraws++;
    else metrics.fullPathRedraws++;
    metrics.lastFrameMs = dt;

    metrics.frameDts.push(dt);
    if (metrics.frameDts.length > 48) metrics.frameDts.shift();
    if (metrics.frameDts.length >= 2) {
      const avg = metrics.frameDts.reduce((a, b) => a + b, 0) / metrics.frameDts.length;
      metrics.fps = avg > 0 ? Math.round(1000 / avg) : 0;
    }
    metrics.lastPaintAt = performance.now();

    if (metrics.lastPaintAt - metrics.lastLogAt > 2000) {
      logMetrics('periodic');
      metrics.lastLogAt = metrics.lastPaintAt;
    }
  }

  function logMetrics(reason) {
    const fs = metrics.lastFrameStats || {};
    console.debug('[RenderCoordinator]', reason, {
      mode: getRenderMode(),
      state,
      interactionKind,
      redrawCount: metrics.redrawCount,
      fastPathRedraws: metrics.fastPathRedraws,
      fullPathRedraws: metrics.fullPathRedraws,
      skippedThrottles: metrics.skippedThrottles,
      lastFrameCullCount: metrics.lastFrameCullCount,
      frameMs: metrics.lastFrameMs,
      fps: metrics.fps,
      drawCalls: fs.drawCalls,
      visiblePolygons: fs.visiblePolygons,
    });
  }

  function shouldSkipHatch() {
    return state === STATE.INTERACTING;
  }

  function isLowRenderMode() {
    return state === STATE.INTERACTING;
  }

  function shouldUseFastPath() {
    return state === STATE.INTERACTING;
  }

  function recordCulled(n) {
    const c = Math.max(0, n | 0);
    metrics.lastFrameCullCount = c;
    metrics.totalCulled += c;
  }

  function getMetrics() {
    const fs = metrics.lastFrameStats || {};
    return {
      state,
      interactionKind,
      renderMode: getRenderMode(),
      redrawCount: metrics.redrawCount,
      fastPathRedraws: metrics.fastPathRedraws,
      fullPathRedraws: metrics.fullPathRedraws,
      skippedThrottles: metrics.skippedThrottles,
      lastFrameCullCount: metrics.lastFrameCullCount,
      totalCulled: metrics.totalCulled,
      lastFrameMs: metrics.lastFrameMs,
      fps: metrics.fps,
      lastPaintAt: metrics.lastPaintAt,
      drawCalls: fs.drawCalls,
      visiblePolygons: fs.visiblePolygons,
      visibleObjects: fs.visibleObjects,
    };
  }

  function resetMetrics() {
    metrics.redrawCount = 0;
    metrics.fastPathRedraws = 0;
    metrics.fullPathRedraws = 0;
    metrics.skippedThrottles = 0;
    metrics.lastFrameCullCount = 0;
    metrics.totalCulled = 0;
    metrics.lastFrameMs = 0;
    metrics.frameDts.length = 0;
    metrics.fps = 0;
    metrics.lastLogAt = 0;
    metrics.lastFrameStats = null;
  }

  return {
    init,
    schedule,
    beginInteraction,
    endInteraction,
    requestPaint,
    shouldSkipHatch,
    isLowRenderMode,
    shouldUseFastPath,
    getRenderMode,
    recordCulled,
    getMetrics,
    logMetrics,
    resetMetrics,
    STATE,
    MODE,
    DIRTY,
  };
})();
