'use strict';
/** PlanAI Field — panorama field photos. */
const PanoramaManager = (function () {
  function list(objects) {
    return (objects || S.objects || []).filter(o =>
      o.type === 'field_photo' && o.visible !== false && o.isPanorama,
    );
  }
  return { list };
})();
window.PanoramaManager = PanoramaManager;
