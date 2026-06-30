'use strict';
/** PlanAI Field — video notes (field_video with isVideoNote). */
const VideoNotesManager = (function () {
  function list(objects) {
    return (objects || S.objects || []).filter(o =>
      o.type === 'field_video' && o.visible !== false && o.isVideoNote !== false,
    );
  }
  return { list };
})();
window.VideoNotesManager = VideoNotesManager;
