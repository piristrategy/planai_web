/**
 * Erken köprü — file:// açılışında API varsa same-host'a yönlendir.
 * Offline: tanılama + retry (BAT mesajı yok).
 */
(function () {
  var api = window.PLANAI_API_BASE || 'http://localhost:8787';
  var isFile = location.protocol === 'file:';

  function diagnosticsHtml(err) {
    return (
      '<div style="margin-top:8px;font-size:12px;color:var(--cream-dim);line-height:1.5">' +
      'API: <code>' + api + '</code><br>' +
      'Protocol: <code>' + location.protocol + '</code><br>' +
      (err ? ('Hata: ' + String(err) + '<br>') : '') +
      'Sahte veri gösterilmez. Bağlantı gelince otomatik yönlendirilir.' +
      '</div>'
    );
  }

  function showOffline(err) {
    var banner = document.getElementById('liveIntelBanner');
    var text = document.getElementById('liveIntelBannerText');
    if (banner && text) {
      banner.classList.add('show');
      text.innerHTML =
        '<b>API bağlantısı yok</b> — canlı FastAPI\'ye ulaşılamadı. ' +
        '<button type="button" class="pill" id="bootRetryBtn" style="margin-left:8px">Tekrar dene</button>' +
        diagnosticsHtml(err);
      var btn = document.getElementById('bootRetryBtn');
      if (btn) btn.onclick = function () { tryConnect(true); };
    }
    var chip = document.getElementById('topSeasonChip');
    if (chip) chip.textContent = 'Sabah Brifingi · bağlantı yok';
    var meta = document.getElementById('briefMeta');
    if (meta) meta.textContent = 'API bağlantısı yok — tekrar deneniyor';
    var sig = document.getElementById('briefSignals');
    if (sig) {
      sig.innerHTML =
        '<div class="sig-line"><span class="t">—</span><span class="icon" style="background:var(--fall)"></span>' +
        '<p><b>Platforma ulaşılamadı</b> — canlı API bekleniyor.' +
        '<span class="why">Neden önemli: tüm içerik SQLite üzerinden FastAPI ile gelir.</span></p></div>' +
        diagnosticsHtml(err);
    }
  }

  function probe() {
    return fetch(api.replace(/\/$/, '') + '/api/health/live', {
      credentials: 'omit',
      mode: 'cors',
    }).then(function (r) {
      return r.ok;
    });
  }

  function tryConnect(fromClick) {
    probe()
      .then(function (ok) {
        if (ok) {
          location.replace(api.replace(/\/$/, '') + '/');
          return;
        }
        showOffline(fromClick ? 'health not ok' : null);
        if (!window._bootRetry) {
          window._bootRetry = setInterval(function () {
            probe().then(function (ok2) {
              if (ok2) {
                clearInterval(window._bootRetry);
                location.replace(api.replace(/\/$/, '') + '/');
              }
            }).catch(function () {});
          }, 4000);
        }
      })
      .catch(function (e) {
        showOffline(e && e.message ? e.message : e);
        if (!window._bootRetry) {
          window._bootRetry = setInterval(function () {
            tryConnect(false);
          }, 4000);
        }
      });
  }

  if (!isFile) return;
  tryConnect(false);
})();
