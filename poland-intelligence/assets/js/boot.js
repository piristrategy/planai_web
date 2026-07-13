/**
 * Erken köprü — file:// açılışında API varsa localhost'a yönlendir.
 * Bu platform canlı API kullandığı için START_UI.bat / CALISTIR.bat ile başlatılmalıdır.
 */
(function () {
  var api = window.PLANAI_API_BASE || 'http://localhost:8787';
  var isFile = location.protocol === 'file:';

  var hint =
    'Bu platform canlı API kullandığı için <b>START_UI.bat</b> veya <b>CALISTIR.bat</b> ile başlatılmalıdır.';

  function showOffline() {
    var banner = document.getElementById('liveIntelBanner');
    var text = document.getElementById('liveIntelBannerText');
    if (banner && text) {
      banner.classList.add('show');
      text.innerHTML = '<b>API bağlantısı yok</b> — ' + hint;
    }
    var chip = document.getElementById('topSeasonChip');
    if (chip) chip.textContent = 'Sabah Brifingi · bağlantı yok';
    var meta = document.getElementById('briefMeta');
    if (meta) meta.textContent = 'API bağlantısı yok';
    var sig = document.getElementById('briefSignals');
    if (sig) {
      sig.innerHTML =
        '<div class="sig-line"><span class="t">—</span><span class="icon" style="background:var(--fall)"></span>' +
        '<p><b>Platforma ulaşılamadı</b> — ' + hint +
        '<span class="why">Neden önemli: tüm içerik SQLite üzerinden API ile gelir; file:// tek başına yetmez.</span></p></div>';
    }
  }

  function probe() {
    return fetch(api + '/api/health', { credentials: 'omit', mode: 'cors' }).then(function (r) {
      return r.ok;
    });
  }

  if (!isFile) return;

  probe()
    .then(function (ok) {
      if (ok) {
        location.replace(api.replace(/\/$/, '') + '/');
        return;
      }
      showOffline();
    })
    .catch(showOffline);
})();
