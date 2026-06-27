'use strict';
/** index8 — motor DOM'unu app.js'den önce senkron yükler */
(function () {
  if (document.getElementById('planai-engine-root')) return;
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'partials/index8-engine-dom.html', false);
    xhr.send(null);
    if (xhr.status !== 200 && xhr.status !== 0) return;
    const root = document.createElement('div');
    root.id = 'planai-engine-root';
    root.className = 'planai-engine-root';
    root.innerHTML = xhr.responseText;
    document.body.appendChild(root);

    const map = document.querySelector('#work #map');
    const wrap = document.getElementById('canvas-wrap');
    if (map && wrap) {
      map.prepend(wrap);
      map.classList.add('has-map');
    }

    const mount = document.querySelector('.drawer .shell-right-panel-mount');
    const panel = document.getElementById('right-panel');
    if (mount && panel) mount.appendChild(panel);

    const hub = document.getElementById('field-journey-hub-overlay');
    if (hub) {
      hub.style.display = 'none';
      hub.setAttribute('aria-hidden', 'true');
      new MutationObserver(() => {
        if (hub.style.display === 'flex') {
          hub.style.display = 'none';
          hub.setAttribute('aria-hidden', 'true');
          document.body.classList.remove('field-journey-hub-active');
          const home = document.getElementById('home');
          if (home) home.hidden = false;
        }
      }).observe(hub, { attributes: true, attributeFilter: ['style'] });
    }
  } catch (e) {
    console.warn('[index8-engine-boot]', e);
  }
})();
