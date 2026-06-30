/**
 * PlanAI Field — lazy OpenCV.js (WASM) loader for panorama stitching.
 */
(function (global) {
  'use strict';

  let _loadPromise = null;

  const SOURCES = [
    'libs/opencv/opencv.js',
    'https://docs.opencv.org/4.9.0/opencv.js',
  ];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.async = true;
      el.src = src;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error('opencv_load_failed:' + src));
      document.head.appendChild(el);
    });
  }

  function waitForCv(timeoutMs) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      (function poll() {
        if (global.cv && global.cv.Mat) {
          if (typeof global.cv.onRuntimeInitialized === 'function' && !global.cv.ready) {
            const prev = global.cv.onRuntimeInitialized;
            global.cv.onRuntimeInitialized = () => {
              if (typeof prev === 'function') prev();
              global.cv.ready = true;
              resolve(global.cv);
            };
            return;
          }
          global.cv.ready = true;
          resolve(global.cv);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error('opencv_timeout'));
          return;
        }
        setTimeout(poll, 40);
      })();
    });
  }

  function ensure() {
    if (global.cv && global.cv.Mat) return waitForCv(120000);
    if (_loadPromise) return _loadPromise;
    _loadPromise = (async () => {
      let lastErr = null;
      for (let i = 0; i < SOURCES.length; i++) {
        try {
          await loadScript(SOURCES[i]);
          return await waitForCv(120000);
        } catch (err) {
          lastErr = err;
        }
      }
      _loadPromise = null;
      throw lastErr || new Error('opencv_unavailable');
    })();
    return _loadPromise;
  }

  global.PanoOpenCvLoader = { ensure };
})(window);
