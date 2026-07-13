/**
 * API köprüsü — index çift tıklama (file://) veya API ile aynı kök.
 * Gerekirse yüklemeden önce: window.PLANAI_API_BASE = 'http://localhost:8787';
 */
(function () {
  if (window.PLANAI_API_BASE != null) return;
  var loc = window.location;
  var apiPort = "8787";
  if (loc.protocol === "file:") {
    window.PLANAI_API_BASE = "http://localhost:" + apiPort;
    return;
  }
  var m = loc.pathname.match(/^(\/poland-intelligence)/);
  if (m) {
    window.PLANAI_API_BASE = m[1];
    return;
  }
  if (!loc.port || loc.port === apiPort || loc.port === "8790") {
    window.PLANAI_API_BASE = "";
  } else {
    window.PLANAI_API_BASE = "http://localhost:" + apiPort;
  }
})();
