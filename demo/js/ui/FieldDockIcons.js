/**
 * PlanAI Field — bottom dock Lucide-style outline icons (24×24, 2px stroke).
 */
(function (global) {
  'use strict';

  const CAP = ' stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

  function svgInner(body) {
    return '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" class="field-dock-lucide">'
      + body + '</svg>';
  }

  const icons = {
    route: svgInner(
      '<circle cx="6" cy="19" r="3"' + CAP + '/>'
      + '<path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"' + CAP + '/>'
      + '<circle cx="18" cy="5" r="3"' + CAP + '/>',
    ),
    folderInput: svgInner(
      '<path d="M2 9V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-1"' + CAP + '/>'
      + '<path d="M12 12v6"' + CAP + '/>'
      + '<path d="m15 15-3-3-3 3"' + CAP + '/>',
    ),
    crosshair: svgInner(
      '<circle cx="12" cy="12" r="10"' + CAP + '/>'
      + '<path d="M22 12h-4"' + CAP + '/>'
      + '<path d="M6 12H2"' + CAP + '/>'
      + '<path d="M12 6V2"' + CAP + '/>'
      + '<path d="M12 22v-4"' + CAP + '/>',
    ),
    camera: svgInner(
      '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"' + CAP + '/>'
      + '<circle cx="12" cy="13" r="3"' + CAP + '/>',
    ),
    notebookPen: svgInner(
      '<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"' + CAP + '/>'
      + '<path d="M2 6h4"' + CAP + '/>'
      + '<path d="M2 10h4"' + CAP + '/>'
      + '<path d="M2 14h4"' + CAP + '/>'
      + '<path d="M2 18h4"' + CAP + '/>'
      + '<path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"' + CAP + '/>',
    ),
    globe: svgInner(
      '<circle cx="12" cy="12" r="10"' + CAP + '/>'
      + '<path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"' + CAP + '/>'
      + '<path d="M2 12h20"' + CAP + '/>',
    ),
    map: svgInner(
      '<path d="M14.106 5.553a2 2 0 0 0 1.788 0l3.659-1.83A1 1 0 0 1 21 4.619v12.764a1 1 0 0 1-.553.894l-4.553 2.277a2 2 0 0 1-1.788 0l-4.212-2.106a2 2 0 0 0-1.788 0l-3.659 1.83A1 1 0 0 1 3 19.381V6.618a1 1 0 0 1 .553-.894l4.553-2.277a2 2 0 0 1 1.788 0z"' + CAP + '/>'
      + '<path d="M15 5.764v15"' + CAP + '/>'
      + '<path d="M9 3.236v15"' + CAP + '/>',
    ),
    mapOff: svgInner(
      '<circle cx="12" cy="12" r="10"' + CAP + '/>'
      + '<path d="m4.9 4.9 14.2 14.2"' + CAP + '/>',
    ),
    mountain: svgInner(
      '<path d="m8 3 4 8 5-5 5 15H2L8 3z"' + CAP + '/>',
    ),
  };

  const basemapByMode = {
    none: icons.mapOff,
    osm: icons.map,
    satellite: icons.globe,
    topo: icons.mountain,
  };

  function applyDockIcons() {
    const set = [
      ['btn-dock-projects', icons.route],
      ['btn-dock-import', icons.folderInput],
      ['btn-field-gps', icons.crosshair],
      ['btn-dock-photo', icons.camera],
      ['btn-dock-notes', icons.notebookPen],
    ];
    set.forEach(([id, html]) => {
      const btn = document.getElementById(id);
      const wrap = btn?.querySelector('.field-dock-icon');
      if (wrap) wrap.innerHTML = html;
    });
    const basemapIcon = document.getElementById('btn-dock-basemap-icon');
    if (basemapIcon && !basemapIcon.dataset.dynamicBasemap) {
      basemapIcon.innerHTML = icons.globe;
    }
  }

  global.FieldDockIcons = {
    icons,
    basemapByMode,
    applyDockIcons,
    getBasemapIcon(mode) {
      return basemapByMode[mode] || icons.globe;
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyDockIcons);
  } else {
    applyDockIcons();
  }
})(typeof window !== 'undefined' ? window : globalThis);
