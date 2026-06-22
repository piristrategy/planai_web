'use strict';
/**
 * PlanAI Field™ — spatial field application.
 * Developed by PiriStrategy.
 * © Taner Piri / PiriStrategy. All rights reserved.
 * Proprietary software — see LICENSE.
 */
(function purgeRenderStatsOverlay() {
  try { localStorage.setItem('planai_render_stats', '0'); } catch (_) {}
  const kill = () => document.getElementById('render-stats-overlay')?.remove();
  kill();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', kill, { once: true });
})();
// ═══════════════════════════════════════════════════════════════
// PLANAI FIELD MODE — controlled reduction (not a rewrite)
// Planning/georef/pafta UI entry points disabled; core map+draw kept.
// Set FIELD_MODE = false to restore full planning prototype surface.
// ═══════════════════════════════════════════════════════════════
const FIELD_MODE = true;
/** Claude build: Android/tablet GPS validation over http://LAN:port (not file://). */
/** Debug UI only — must NOT gate GPS tracking, filtering, smoothing, or watchdog logic. */
const GPS_TEST_BUILD = false;
function isWalkProduction() {
  return document.body?.classList?.contains('walk-production') || false;
}
function getTopBarH() {
  if (!FIELD_MODE) return 34;
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--field-topbar-h'));
  return v > 0 ? v : 46;
}
function getFieldDockH() {
  if (!FIELD_MODE) return 0;
  const dock = document.getElementById('field-dock');
  if (dock && dock.offsetParent !== null) {
    return Math.ceil(dock.getBoundingClientRect().height) || 0;
  }
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--field-dock-total'));
  return v > 0 ? v : 52;
}
function getMapViewBottom() {
  return FIELD_MODE ? CH : CH - getFieldDockH();
}
function syncFieldDockMetrics() {
  if (!FIELD_MODE) return;
  const dock = document.getElementById('field-dock');
  if (!dock || dock.style.display === 'none') return;
  const h = Math.ceil(dock.getBoundingClientRect().height) || 56;
  document.documentElement.style.setProperty('--field-dock-total', h + 'px');
}
function setDeleteButtonVisible(show) {
  const btn = document.getElementById('btn-delete');
  if (!btn) return;
  if (FIELD_MODE) {
    btn.style.display = 'flex';
    btn.disabled = !show;
    return;
  }
  btn.disabled = false;
  btn.style.display = show ? 'flex' : 'none';
}
const FIELD_DISABLED = {
  pafta: true, georef: true, layout: true,
  planningCategories: true, zonePalette: true, symbolLibrary: true,
  planningDemo: true, layoutExport: true,
};
function fieldOff(key) { return FIELD_MODE && !!FIELD_DISABLED[key]; }

let _fieldGpsOn = false;
let _fieldGpsFix = null; // { lat, lon, accuracy, heading, ts }
let _gpsWatchId = null;
let _gpsFollow = false;
let _gpsLastPanTs = 0;
let _gpsStatus = 'off'; // off | searching | connected | weak | denied | unavailable
let _gpsFirstFixTimer = null;
let _gpsRetryTimer = null;
let _gpsDenyStreak = 0;
let _gpsWatchdogTimer = null;
let _gpsLastWatchTick = 0;
let _gpsPositionTick = 0;
let _gpsTestFilterStats = { ok: 0, rej: 0 };
const GPS_TRACK_MAX_ACCURACY_M = 40;
const GPS_TRACK_MAX_JUMP_M = 42;
const GPS_TRACK_JUMP_SEC = 2.5;
const GPS_TRACK_DUP_EPS = 1e-6;
const GPS_STALE_FIX_MS = 12000;
const GPS_JITTER_STANDSTILL_M = 1.6;
const GPS_AGPS_WEAK_THRESHOLD_M = 35;
const GPS_LIVE_REJECT_ACCURACY_M = 120;
const GPS_FIX_FUSE_MAX = 6;
const GPS_AGPS_POLL_WEAK_MS = 3500;
const GPS_AGPS_POLL_OK_MS = 12000;
const GPS_TRACK_VIS_MIN_SEG_M = 2.8;
const GPS_TRACK_VIS_MAX_STEP_M = 6.5;
const GPS_TRACK_VIS_CORNER_DEG = 32;
let _gpsTrackResumeAcceptStale = false;
const GPS_STATIONARY_ENTER_DWELL_MS = 800;
const GPS_STATIONARY_EXIT_DWELL_MS = 600;
const GPS_STATIONARY_FREEZE_M = 0.3;
const GPS_DERIVED_BEARING_MIN_M = 3;
const GPS_COMPASS_MAX_AGE_MS = 2000;
const GPS_HDG_LERP_FLOOR = 0.12;
const GPS_MOVE = { STATIONARY: 'stationary', WALKING: 'walking', ACTIVE: 'active', LOW: 'low' };
let _fieldGpsDisplay = null;
let _gpsMotionRaf = null;
let _gpsMotionTrackUiTs = 0;
let _gpsMoveState = GPS_MOVE.STATIONARY;
let _gpsMoveHist = [];
let _gpsStationaryAnchor = null;
let _gpsDerivedBearing = null;
let _gpsCompassHeading = null;
let _gpsCompassTs = 0;
let _gpsStateCandidate = null;
let _gpsStateCandidateSince = 0;
let _gpsExitCandidateSince = 0;
let _gpsDerivedPathM = 0;
let _gpsDerivedPathRef = null;
let _gpsSpeedSamples = [];
let _gpsCompassBound = false;
let _gpsFixBuffer = [];
let _gpsAgpsPollTimer = null;
let _gpsDisplayAccuracySmooth = null;
let _gpsAgpsHintShown = false;
let _gpsHudSpeedSmooth = null;
let _gpsHudHeadingSmooth = null;
let _gpsHudLongPressTimer = null;
let _gpsHudLongPressFired = false;
const GPS_GUIDANCE_ARRIVAL_M = 10;
let _gpsTarget = null;
let _gpsGuidanceActive = false;
let _gpsGuidanceArrived = false;
let _gpsGuidancePulse = 0;
let _gpsGuidanceBearingSmooth = null;
let _gpsGuidanceDistSmooth = null;
let _fieldMapLongPressTimer = null;
let _fieldMapMenuWp = null;

function isGpsDebugMode() {
  if (isWalkProduction()) return false;
  if (GPS_TEST_BUILD) return true;
  try {
    if (new URLSearchParams(location.search).get('debug') === '1') return true;
    return localStorage.getItem('planai_gps_debug') === '1';
  } catch (_) { return false; }
}

function applyGpsDebugModeUi() {
  document.body.classList.toggle('gps-debug-mode', isGpsDebugMode());
  if (isGpsDebugMode()) {
    const tp = document.getElementById('gps-test-panel');
    if (tp) { tp.style.display = 'flex'; tp.classList.add('collapsed'); }
  }
}

function toggleGpsDebugMode() {
  if (isWalkProduction() || GPS_TEST_BUILD) return;
  try {
    const on = localStorage.getItem('planai_gps_debug') === '1';
    if (on) localStorage.removeItem('planai_gps_debug');
    else localStorage.setItem('planai_gps_debug', '1');
  } catch (_) {}
  applyGpsDebugModeUi();
  updateGpsHud();
  updateGpsTestPanel();
  showHint(isGpsDebugMode() ? t('gps.hud.debugOn') : t('gps.hud.debugOff'), 3500);
}

function gpsMoveLabel(state) {
  const map = {
    [GPS_MOVE.STATIONARY]: 'gps.move.stationary',
    [GPS_MOVE.WALKING]: 'gps.move.walking',
    [GPS_MOVE.ACTIVE]: 'gps.move.active',
    [GPS_MOVE.LOW]: 'gps.move.low',
  };
  return t(map[state] || 'gps.move.walking');
}

function gpsConfidenceLabel(acc, status) {
  if (status === 'weak' || status === 'searching') return t('gps.conf.low');
  if (acc == null || isNaN(acc)) return '—';
  if (acc <= 8) return t('gps.conf.high');
  if (acc <= 18) return t('gps.conf.good');
  if (acc <= 35) return t('gps.conf.mid');
  return t('gps.conf.low');
}

function gpsHudHeadingArrow(deg) {
  if (deg == null || isNaN(deg)) return '—';
  const d = ((Math.round(deg) % 360) + 360) % 360;
  const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  return arrows[Math.round(d / 45) % 8] + ' ' + d + '°';
}

function gpsHudSmoothSpeed(speed) {
  if (speed == null || isNaN(speed)) return _gpsHudSpeedSmooth;
  const target = Math.max(0, speed);
  if (_gpsHudSpeedSmooth == null) _gpsHudSpeedSmooth = target;
  else _gpsHudSpeedSmooth += (target - _gpsHudSpeedSmooth) * 0.16;
  return _gpsHudSpeedSmooth;
}

function gpsHudSmoothHeading(deg) {
  if (deg == null || isNaN(deg)) return _gpsHudHeadingSmooth;
  const target = ((deg % 360) + 360) % 360;
  if (_gpsHudHeadingSmooth == null) _gpsHudHeadingSmooth = target;
  else {
    let diff = target - _gpsHudHeadingSmooth;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    _gpsHudHeadingSmooth = (_gpsHudHeadingSmooth + diff * 0.22 + 360) % 360;
  }
  return _gpsHudHeadingSmooth;
}

function formatGpsHudSpeed(speedMs) {
  if (speedMs == null || isNaN(speedMs) || speedMs < 0.07) return '0 km/h';
  const kmh = speedMs * 3.6;
  if (kmh < 8) return kmh.toFixed(1) + ' km/h';
  if (kmh < 45) return kmh.toFixed(1) + ' km/h';
  return Math.round(kmh) + ' km/h';
}

function updateGpsHudCompass(deg) {
  const h = deg != null && !isNaN(deg) ? gpsHudSmoothHeading(deg) : null;
  const rot = h != null ? 'rotate(' + h + 'deg)' : 'rotate(0deg)';
  ['gps-hud-needle', 'gps-hud-needle-mini'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.transform = rot;
  });
}

function resetGpsHudSmoothing() {
  _gpsHudSpeedSmooth = null;
  _gpsHudHeadingSmooth = null;
}

function gpsDbgLog() {}
let _notePopupId = null;
let _observationPopupPrimaryId = null;
const OBSERVATION_CLUSTER_M = 38;
let _editingNoteId = null;
let _notePinMode = false;
let _pendingNoteGeo = null;
let _notePanelMode = 'text';
let _noteHandStrokes = [];
let _noteHandDrawing = false;
let _noteHandCurrent = null;

const FIELD_PROJECT = { id: null, name: 'Adsız Gezi', createdAt: null };
const PLANAI_FIELD_APP_VERSION = '1.0.0';

function spatialDebugLog() {
  if (typeof SpatialSecurity !== 'undefined') SpatialSecurity.spatialDebugLog.apply(SpatialSecurity, arguments);
  else if (!document.body?.classList?.contains('walk-production')) console.debug('[Spatial]', ...arguments);
}

window.__planaiDisableDebugOverlays = function () {
  try { localStorage.setItem('planai_render_stats', '0'); } catch (_) {}
  document.getElementById('render-stats-overlay')?.remove();
  document.getElementById('gps-test-panel')?.style.setProperty('display', 'none', 'important');
};

function deviceSecurityBlocksExport() {
  if (typeof PlanAISecurity !== 'undefined') return PlanAISecurity.blocksSensitiveExport();
  return typeof DeviceSecurity !== 'undefined' && DeviceSecurity.blocksSensitiveExport();
}

function deviceSecurityBlocksPlanImport() {
  if (typeof PlanAISecurity !== 'undefined') return PlanAISecurity.blocksPlanOverlayImport();
  return typeof DeviceSecurity !== 'undefined' && DeviceSecurity.blocksPlanOverlayImport();
}
const REPORT_TEMPLATE_ID = 'field-saha-v1';
const INTERACTIVE_REPORT_TEMPLATE_ID = 'field-interactive-v1';

// ═══ i18n (lightweight, no reload) ═══════════════════════════
let PA_LANG = 'en';
const PA_I18N = {
  tr: {
    'panel.title': 'Saha Paneli', 'panel.project': 'Gezi', 'panel.projects': 'Geziler',
    'panel.reports': 'Saha Yolculukları',
    'info.title': 'Özellik bilgisi', 'info.back': 'Seçime dön', 'info.noAttrs': 'Bu öğe için ek özellik yok.',
    'info.noPick': 'Özellik yok — boş alana dokunun, panel kapanır',
    'info.measure': 'Ölçü',
    'analysis.menu': 'Analiz', 'analysis.slope': 'Eğim',
    'slope.title': 'Eğim analizi', 'slope.clear': 'Analizi kapat', 'slope.save': '💾 Analizi kaydet',
    'slope.saved': 'Eğim analizi rapor için kaydedildi', 'slope.savedBadge': '✓ Raporda kullanılacak',
    'slope.nothingToSave': 'Önce eğim analizi çalıştırın', 'slope.running': 'Eğim hesaplanıyor…',
    'slope.minElev': 'Min. yükseklik', 'slope.maxElev': 'Maks. yükseklik', 'slope.avgSlope': 'Ort. eğim',
    'slope.maxSlope': 'Maks. eğim', 'slope.aspect': 'Baskın yön', 'slope.area': 'Analiz alanı',
    'slope.needArea': 'Önce poligon veya daire seçin', 'slope.offline': 'DEM yüklenemedi — ağ gerekli',
    'tool.select': 'Seçme aracı', 'tool.info': 'Bilgi aracı', 'tool.point': 'Nokta', 'tool.line': 'Ölçüm', 'tool.polyline': 'Kırık ölçüm',
    'tool.polygon': 'Poligon', 'tool.circle': 'Eğim analizi', 'tool.text': 'Metin', 'tool.eraser': 'Silgi',
    'tool.freedraw': 'Serbest çizim', 'tool.field-note': 'Saha notu',
    'mode.finger': 'Parmak', 'mode.pen': 'Kalem',
    'stat.objects': '{n} nesne', 'search.placeholder': 'Konum ara…', 'search.btn': 'Ara',
    'gps.off': 'Kapalı', 'gps.searching': 'Aranıyor…', 'gps.connected': 'Bağlı', 'gps.weak': 'Zayıf sinyal',
    'gps.denied': 'İzin reddedildi', 'gps.unavailable': 'Kullanılamıyor', 'gps.pill': 'GPS',
    'gps.followOn': 'Takip: AÇIK', 'gps.followOff': 'Takip: KAPALI', 'gps.accuracy': 'Hassasiyet',
    'gps.follow': 'Takip', 'gps.center': 'Merkez', 'gps.trackBtn': 'Rota',
    'gps.start': 'BAŞLAT', 'gps.stop': 'DURDUR', 'gps.pause': 'Duraklat', 'gps.resume': 'Devam',
    'gps.move.stationary': 'Durağan', 'gps.move.walking': 'Yürüyor', 'gps.move.active': 'Aktif', 'gps.move.low': 'Zayıf GPS',
    'gps.conf.high': 'Yüksek güven', 'gps.conf.good': 'İyi güven', 'gps.conf.mid': 'Orta güven', 'gps.conf.low': 'Düşük güven',
    'gps.hud.lat': 'Enlem', 'gps.hud.lon': 'Boylam', 'gps.hud.speed': 'Hız', 'gps.hud.heading': 'Yön',
    'gps.hud.alt': 'Yükseklik', 'gps.hud.acc': 'Hassasiyet', 'gps.hud.route': 'Rota',
    'gps.hud.guide': 'Hedef', 'gps.hud.debugOn': 'GPS geliştirici modu açık', 'gps.hud.debugOff': 'GPS geliştirici modu kapalı',
    'guide.go': 'Buraya Git', 'guide.arrived': 'Varıldı', 'guide.clear': 'Hedefi kaldır',
    'guide.hint': 'Düz rota hazır — HUD yönüne göre yürüyün', 'guide.needGps': 'Önce GPS\'i açın',
    'guide.replayPoint': 'Rota noktasına git', 'guide.route': 'Düz rota',
    'guide.showRoute': 'Rotayı göster', 'guide.walk': 'Bu yönde yürü',
    'dock.projects': 'Geziler', 'dock.import': 'İçe Aktar', 'dock.gps': 'GPS', 'dock.photo': 'Foto',
    'tlbl.select': 'Seç', 'tlbl.info': 'Bilgi', 'tlbl.point': 'Nokta', 'tlbl.line': 'Ölçüm', 'tlbl.polyline': 'Kırık', 'tlbl.area': 'Alan', 'tlbl.slope': 'Eğim', 'tlbl.layers': 'Katman', 'tlbl.undo': 'Geri', 'tlbl.delete': 'Sil',
    'dock.notes': 'Notlar', 'basemap.none': 'Kapalı', 'basemap.osm': 'OSM', 'basemap.satellite': 'Uydu', 'basemap.topo': 'Topo',
    'basemap.hint.none': 'Altlık kapalı', 'basemap.hint.osm': 'OSM harita', 'basemap.hint.satellite': 'Uydu görüntüsü', 'basemap.hint.topo': 'Topoğrafya',
    'layer.sketch': 'Saha', 'layer.points': 'Noktalar', 'layer.imported': 'Diğer içe aktarımlar', 'layer.photos': 'Fotoğraflar', 'layer.notes': 'Notlar', 'layer.gps': 'GPS Rota',
    'layer.geom': '{n} geometri', 'layer.importSources': '{n} kaynak', 'layer.overlay': 'overlay', 'layer.planOverlay': 'Plan overlay (vektör / raster)',
    'layer.dxf': 'DXF katmanları', 'layer.gml': 'GML katmanları',
    'layer.section': 'Katmanlar', 'layer.hide': 'Gizle', 'layer.show': 'Göster', 'layer.lock': 'Kilitle', 'layer.unlock': 'Kilidi aç',
    'layer.go': 'Git', 'layer.goMissing': 'Katman konumu bulunamadı',
    'layer.expandList': 'Nesne listesini aç', 'layer.collapseList': 'Nesne listesini kapat',
    'layer.delete': 'Katmanı sil', 'layer.cannotDelete': 'Bu katman silinemez',
    'layer.deleteConfirm': '"{name}" ve {n} geometri silinsin mi?', 'layer.deleted': 'Katman silindi', 'layer.opacity': 'Şeffaflık',
    'type.point': 'Nokta', 'type.field_note': 'Saha notu', 'type.field_photo': 'Fotoğraf',
    'track.start': 'Rota kaydı başladı', 'track.pause': 'Duraklatıldı', 'track.stop': 'Rota kaydedildi',
    'track.stopHud': 'ROTA DUR', 'track.stopHudHint': 'Rota durdu — GPS ve takip devam ediyor',
    'track.idle': 'Rota kaydı kapalı', 'track.recording': 'Kayıt', 'track.paused': 'Duraklatıldı',
    'track.dist': 'Mesafe', 'track.time': 'Süre', 'track.points': 'Nokta',
    'report.interactive': 'Yolculuğu paylaş veya Drive\'a kaydet',
    'report.savedToProject': 'Yolculuk geziye kaydedildi',
    'report.mapSkipped': 'Harita görüntüsü atlandı (uydu katmanı dışa aktarılamadı)',
    'report.none': 'Henüz kayıt yok — PDF veya mekansal inceleme tekrarı oluşturun',
    'report.view': 'Aç',
    'report.share': 'Paylaş',
    'report.pdf': 'PDF Rapor',
    'report.interactiveShort': 'Yolculuk',
    'report.html': 'Mekansal Tekrar',
    'report.viewerTitle': 'Önizleme',
    'report.playbackViewerTitle': 'Mekansal İnceleme Tekrarı',
    'report.missing': 'Yolculuk dosyası bulunamadı',
    'report.demoReady': 'Demo yolculuk kaydedildi — sağ panelden açın',
    'report.demoRunning': 'Demo yolculuk hazırlanıyor…',
    'report.count': '{n} kayıt',
    'report.delete': 'Sil',
    'report.deleted': 'Kayıt silindi',
    'report.deleteConfirm': 'Bu kaydı silmek istediğinize emin misiniz?',
    'export.sheetTitle': 'Dosyayı gönder',
    'export.sendFile': 'Dosya gönder',
    'export.sendFileHint': 'WhatsApp, Mail, Drive, Bluetooth…',
    'export.whatsapp': 'WhatsApp',
    'export.mail': 'E-posta',
    'export.onedrive': 'OneDrive',
    'export.dropbox': 'Dropbox',
    'export.otherApps': 'Diğer',
    'import.sheetTitle': 'Dosya içe aktar',
    'import.sheetHint': 'PlanGML · KML · KMZ · GeoJSON · GeoTIFF',
    'health.kicker': 'Mekansal veri hazırlığı',
    'health.title': 'Veri Uygunluk Analizi',
    'health.file': 'Dosya', 'health.format': 'Biçim',
    'health.datasetSize': 'Veri seti boyutu', 'health.spatialComplexity': 'Mekansal karmaşıklık',
    'health.expectedPerf': 'Beklenen performans', 'health.renderComplexity': 'Çizim karmaşıklığı',
    'health.features': 'Özellik', 'health.polygons': 'Poligon', 'health.vertices': 'Köşe',
    'health.layers': 'Katman', 'health.rasterRes': 'Raster', 'health.memory': 'Bellek tahmini',
    'health.placemarks': 'Placemark', 'health.embeddedImages': 'Gömülü görsel', 'health.hatchPolys': 'Tarama poligonu',
    'health.cog': 'Cloud Optimized GeoTIFF',
    'health.complexity.low': 'Düşük', 'health.complexity.medium': 'Orta', 'health.complexity.high': 'Yüksek', 'health.complexity.veryHigh': 'Çok yüksek',
    'health.status.ready': 'Hazır',
    'health.status.readyDesc': 'Bu veri seti güvenle açılabilir.',
    'health.status.optimize': 'Optimizasyon Önerilir',
    'health.status.optimizeDesc': 'Veri seti ortalamadan büyük. Optimize Mod önerilir.',
    'health.status.heavy': 'Ağır Veri Seti',
    'health.status.heavyDesc': 'Performans yavaşlamaları beklenebilir.',
    'health.status.critical': 'Kritik Veri Seti',
    'health.status.criticalDesc': 'Bazı cihazlarda açılışta kararsızlık oluşabilir.',
    'health.perf.excellent': 'Mükemmel',
    'health.perf.excellentHint': 'Harita gezintisi akıcı kalmalıdır.',
    'health.perf.good': 'İyi',
    'health.perf.goodHint': 'Harita gezintisi akıcı kalmalıdır.',
    'health.perf.moderate': 'Orta',
    'health.perf.moderateHint': 'Yoğun katmanlarda kaydırma ve zoom yavaşlayabilir.',
    'health.perf.heavy': 'Ağır',
    'health.perf.heavyHint': 'Belirgin yavaşlama veya kararsızlık mümkündür.',
    'health.compat.title': 'Cihaz Uyumluluğu',
    'health.compat.high': 'Üst Segment Tablet',
    'health.compat.mid': 'Orta Segment Tablet',
    'health.compat.low': 'Giriş Seviye Tablet',
    'health.compat.thisDevice': 'Bu cihaz',
    'health.compat.examples': 'Uyumlu Cihazlar',
    'health.compat.examplesLimited': 'En iyi sonuç için üst segment tablet veya Optimize Mod kullanın.',
    'health.mode.title': 'Önerilen Yükleme Modu',
    'health.mode.normal': 'Normal Mod',
    'health.mode.optimized': 'Optimize Mod',
    'health.opt.lead': 'Optimize Mod bellek kullanımını şu şekilde azaltır:',
    'health.opt.simplify': 'karmaşık geometriyi sadeleştirir',
    'health.opt.raster': 'ağır raster çözünürlüğünü düşürür',
    'health.opt.defer': 'büyük katman çizimini erteler',
    'health.opt.result': 'Beklenen sonuç: daha hızlı ve kararlı çalışma.',
    'health.advanced.title': 'Gelişmiş Veri Seti Detayları',
    'health.rec.critical': 'Bu cihazda çökme riski yüksek. Yüklemeden önce geometri sadeleştirin veya çözünürlüğü düşürün.',
    'health.btn.optimized': 'Optimize Modda Aç',
    'health.btn.continue': 'Normal Aç',
    'health.btn.proceedRisky': 'Normal Aç (önerilmez)',
    'health.btn.cancel': 'İptal',
    'health.optimizedOn': 'Optimize mod etkin — katmanlar ve efektler hafifletildi',
    'health.importCancelled': 'İçe aktarma iptal edildi',
    'import.device': 'Telefon / tablet hafızası',
    'import.deviceHint': 'Dosya yöneticisi',
    'import.cloud': 'Drive, OneDrive, Dropbox…',
    'import.cloudHint': 'WhatsApp, Gmail veya bulut uygulamaları',
    'import.openedHtml': 'Mekansal inceleme tekrarı açıldı',
    'import.openedPdf': 'PDF açıldı',
    'export.share': 'Dosya gönder — WhatsApp, Mail, Drive…',
    'export.drive': 'Google Drive\'a kaydet',
    'export.download': 'Cihaza indir',
    'export.preview': 'Önizle',
    'export.cancel': 'İptal',
    'export.downloaded': 'İndirme başlatıldı',
    'export.shareFail': 'Paylaşım açılamadı — cihaza indiriliyor',
    'export.ready': 'Dosya hazır — gönderin veya indirin',
    'export.openingShare': 'Gönder menüsü açılıyor…',
    'feat.landUse': 'Alan türü', 'feat.plan': 'Plan kararı', 'feat.far': 'Emsal', 'feat.height': 'Yükseklik', 'feat.type': 'Tür',
    'autosave.idle': 'Otomatik kayıt', 'autosave.pending': '○ Kaydedilecek…', 'autosave.saving': '… Kaydediliyor',
    'project.menu': 'Gezi', 'project.new': '+ Yeni Gezi', 'project.newName': 'Gezi adı', 'project.create': 'Oluştur', 'project.cancel': 'İptal', 'project.rename': 'Yeniden Adlandır', 'project.save': 'Kaydet',
    'entry.tagline': 'Mekansal İnceleme Tekrar Platformu',
    'entry.headline': 'Mekansal İnceleme Yolculuğunuza Başlayın',
    'entry.subheadline': 'Rotaları, notları, fotoğrafları ve mekansal gözlemleri sinematik bir saha deneyimi içinde kaydedin.',
    'entry.startTitle': 'Yeni İnceleme Başlat',
    'entry.startDesc': 'GPS takibi, notlar, fotoğraflar ve mekansal tekrar ile yeni bir saha yolculuğu oluşturun.',
    'entry.continueTitle': 'İncelemeye Devam Et',
    'entry.continueDesc': 'Mevcut inceleme yolculuğunuza kaldığınız yerden devam edin.',
    'entry.exploreTitle': 'Önceki Yolculukları Keşfet',
    'entry.exploreDesc': 'Tamamlanan incelemeleri gözden geçirin ve saha yolculuklarını tekrar oynatın.',
    'entry.journeyName': 'Yolculuk adı',
    'entry.createJourney': 'Yolculuğu Başlat',
    'entry.back': 'Geri',
    'entry.noRecent': 'Devam edilecek kayıtlı inceleme yok — yeni bir yolculuk başlatın.',
    'entry.noJourneys': 'Henüz kayıtlı yolculuk yok.',
    'entry.journeysHead': 'Önceki Yolculuklar',
    'project.reportPdf': 'PDF Rapor', 'project.reportInteractive': 'Saha Yolculuğunu Başlat',
    'project.reportDemo': 'Demo Yolculuk Simülasyonu',
    'project.exportZip': 'Dışa Aktar (ZIP)', 'project.importZip': 'ZIP İçe Aktar', 'project.recent': 'Son geziler',
    'project.none': 'Henüz gezi yok',
    'project.delete': 'Geziyi sil', 'project.deleted': 'Gezi silindi',
    'project.head': 'Geziler', 'project.autosaveNote': 'Değişiklikler otomatik kaydedilir. Durum üst çubukta görünür.',
    'hub.title': 'Saha Yolculuk Merkezi',
    'hub.subtitle': 'Rotaları, gözlemleri, fotoğrafları ve saha verisini kaydedin.',
    'hub.newInspection': 'Yeni İnceleme',
    'hub.tagline': 'GPS İzleme • Fotoğraf • Ses Notları • Raporlar',
    'hub.missionNewTitle': 'Yeni İnceleme Başlat',
    'hub.missionNewSub': 'Saha verisini tek akışta kaydedin.',
    'hub.activeJourney': 'Aktif Yolculuk',
    'hub.heroCta': 'İncelemeyi Başlat',
    'hub.featGps': 'GPS İzleme',
    'hub.featPhotoCapture': 'Fotoğraf Çekimi',
    'hub.featVoice': 'Ses Notları',
    'hub.featReports': 'İnteraktif Raporlar',
    'hub.cardContinueEmpty': 'Aktif yolculuk yok',
    'hub.cardContinueDesc': 'Son yolculuğa devam edin.',
    'hub.continueCta': 'Devam Et',
    'hub.continueInspectionCta': 'İncelemeye Devam Et',
    'hub.openFailed': 'İnceleme açılamadı. PIN varsa kilidi açın veya yeni inceleme başlatın.',
    'hub.noSavedInspection': 'Kayıtlı inceleme bulunamadı.',
    'hub.snapshotMissing': 'İnceleme verisi eksik veya kilitli.',
    'hub.saveFailed': 'İnceleme kaydedilemedi. Kapatmadan önce tekrar deneyin.',
    'hub.startInspectionCta': 'Yeni İnceleme Başlat',
    'hub.archiveLink': 'Tüm Yolculukları Gör',
    'hub.lastActivity': 'Son aktivite:',
    'hub.recentKicker': 'Son Yolculuklar',
    'hub.viewAllJourneys': 'Tüm Yolculukları Gör',
    'hub.recentEmpty': 'Başka kayıtlı yolculuk yok',
    'hub.colName': 'Yolculuk',
    'hub.colDistance': 'Mesafe',
    'hub.colPhotos': 'Fotoğraf',
    'hub.colDate': 'Tarih',
    'hub.datasetImport': 'Veri İçe Aktar',
    'hub.importFormats': 'PlanGML · GML · GeoTIFF · KML · KMZ · GeoJSON',
    'hub.importCtaFull': 'Veri İçe Aktar',
    'hub.asideJourneys': 'Yolculuk',
    'hub.asidePhotos': 'Fotoğraf',
    'hub.asideNotes': 'Not',
    'hub.asideDistance': 'Mesafe',
    'sec.title': 'Güvenlik',
    'sec.pinProtection': 'PIN Koruması',
    'sec.pinHint': 'Rotaları, fotoğrafları, notları ve raporları korur.',
    'sec.encryption': 'Şifreleme Durumu',
    'sec.encEnabled': 'Etkin',
    'sec.encLocked': 'Kilitli',
    'sec.encBaseline': 'Temel',
    'sec.encOff': 'Kapalı',
    'sec.on': 'AÇIK',
    'sec.off': 'KAPALI',
    'sec.enablePin': 'PIN Oluştur',
    'sec.lockNow': 'Şimdi kilitle',
    'sec.viewRecovery': 'Kurtarma kodunu göster',
    'sec.regenRecovery': 'Kurtarma kodunu yenile',
    'sec.recoveryRegenerated': 'Yeni kurtarma kodu oluşturuldu',
    'gate.title': 'PlanAI Field',
    'gate.offerTitle': 'Saha Verilerini Koruyalım mı?',
    'gate.offerSub': 'Korumak için cihaz PIN\'i oluşturun:',
    'gate.offerRoutes': 'rotalar',
    'gate.offerPhotos': 'fotoğraflar',
    'gate.offerNotes': 'notlar',
    'gate.offerReports': 'raporlar',
    'gate.offerCreate': 'PIN Oluştur',
    'gate.offerSkip': 'Şimdilik Atla',
    'gate.setupSub': 'Bu cihazda saha verilerini korumak için PIN belirleyin.',
    'gate.unlockSub': 'Devam etmek için PIN girin.',
    'gate.pinNew': 'Yeni PIN',
    'gate.pinConfirm': 'PIN tekrar',
    'gate.pinInput': 'PIN',
    'gate.create': 'PIN oluştur',
    'gate.unlock': 'Kilidi aç',
    'gate.cancel': 'İptal',
    'gate.wrongPin': 'PIN hatalı',
    'gate.pinMismatch': 'PIN eşleşmiyor',
    'gate.pinShort': 'PIN 4–12 karakter olmalı',
    'gate.forgot': 'PIN\'i unuttum',
    'gate.setupRecoveryNote': 'Kurtarma kodu yalnızca bir kez gösterilir. Saha verileriniz silinmez.',
    'gate.recoverSub': 'Yolculuklarınız korunur. Yeni PIN için kurtarma kodunuzu kullanın.',
    'gate.recoverUseCode': 'Kurtarma kodu ile PIN sıfırla',
    'gate.recoverCodeSub': 'PIN oluştururken kaydettiğiniz kurtarma kodunu girin.',
    'gate.recoveryCode': 'Kurtarma kodu',
    'gate.recoverSetPin': 'Yeni PIN kaydet',
    'gate.recoverEmailHint': 'Kayıtlı adres',
    'gate.recoverEmailHintNone': 'PIN oluştururken kaydettiğiniz e-posta adresini girin.',
    'gate.recoverSendOtp': 'Doğrulama kodu gönder',
    'gate.recoverOtp': 'Doğrulama kodu',
    'gate.recoveryShowSub': 'Bu kurtarma kodunu güvenli bir yere kaydedin. PIN unutulursa verilerinizi kurtarmak için gereklidir.',
    'gate.recoverySaved': 'Kodu kaydettim',
    'gate.recoverBadCode': 'Kurtarma kodu hatalı',
    'gate.recoverNoCode': 'Bu cihazda kurtarma kodu yok.',
    'gate.recoverFailed': 'Kurtarma başarısız',
    'gate.back': 'Geri',
    'ctx.selectedObject': 'Seçili nesne', 'ctx.fieldNote': 'Saha notu', 'ctx.description': 'Açıklama',
    'ctx.photo': 'Fotoğraf', 'ctx.voiceNote': 'Sesli not', 'draw.color': 'Çizim rengi', 'draw.width': 'Kalınlık',
    'draw.opacity': 'Şeffaflık', 'stat.drawing': '· Çiziliyor…', 'stat.grid': 'IZGARA {n}cm',
    'tool.closed': 'Bu araç saha modunda kapalı',
    'mode.chipTitle': 'Parmak / Kalem modu',
    'lang.title': 'Dil',
    'group.field': 'Saha',
    'hint.finger': 'Parmak modu — çizim araçlarıyla haritaya işaretleyin',
    'hint.pen': 'Kalem modu — stylus ile çizin; haritayı parmakla kaydırın',
    'hint.line': 'Kalem ile sürükleyerek çizgi çiz · parmakla kaydır',
    'hint.polyline': 'Köşelere tıkla · Enter / Çift tıkla — bitir · ESC iptal',
    'hint.penDetected': 'Kalem algılandı — çizim modu',
    'hint.select': 'Tıkla seç · Sürükle taşı · Çift tıkla düzenle',
    'hint.point': 'Tıkla — saha işareti / not noktası',
    'hint.polygon': 'Köşelere tıkla · Enter / çift tık — bitir · ESC iptal',
    'hint.circle': 'Merkez noktayı işaretleyin, ardından çap için sürükleyin',
    'circle.step1': '1. Merkez noktayı işaretleyin',
    'circle.step2': '2. Çap için sürükleyin — daire canlı görünür',
    'circle.drawing': 'Çapı işaretliyorsunuz…',
    'slope.legendTitle': 'Eğim renkleri (°)',
    'hint.fieldNote': 'Haritada konuma dokun — raptiye ile saha notu',
    'hint.info': 'İçe aktarılan öğeye dokunun — özellikler sağ panelde',
    'hint.layersPanel': 'Katmanlar paneli',
    'tt.select': 'Seç / Taşı / Döndür <kbd>V</kbd>',
    'tt.info': 'Bilgi — Öznitelik incele', 'tt.point': 'Nokta — Saha işareti',
    'tt.line': 'Çizgi — Kalem ile sürükleyerek', 'tt.polyline': 'Ölçüm — Köşelere tıkla', 'tt.polygon': 'Alan — Poligon', 'tt.circle': 'Eğim analizi',
    'tt.note': 'Not — Haritaya not', 'tt.photo': 'Fotoğraf — Kamera (saha)', 'tt.layers': 'Katmanlar',
    'tt.undo': 'Geri Al <kbd>Ctrl+Z</kbd>', 'tt.delete': 'Sil <kbd>Del</kbd>',
    'note.book': 'Saha Defteri', 'note.close': 'Kapat', 'note.infoTitle': 'Not Bilgisi', 'note.pinMap': 'Haritada konuma dokunun.',
    'note.tabText': 'Metin', 'note.tabHand': '✏️ El yazısı', 'note.placeholder': 'Saha gözlemi…',
    'dictation.btn': 'Dikte', 'dictation.listening': 'Dinleniyor…', 'dictation.prompt': 'Konuşun',
    'dictation.done': 'Metne eklendi', 'dictation.fail': 'Dikte kullanılamadı', 'dictation.unsupported': 'Ses tanıma desteklenmiyor',
    'dictation.cancelled': 'Dikte iptal',
    'dictation.micRequired': 'Dikte için mikrofon izni gerekli',
    'dictation.micDenied': 'Mikrofon izni verilmedi — tekrar deneyin',
    'dictation.noEngine': 'Bu cihazda ses tanıma motoru yok',
    'dictation.noEngineHint': 'Metin/el yazısı kullanın veya fotoğrafta «Sesli not kaydet» ile ses dosyası ekleyin',
    'dictation.live': 'Canlı',
    'perm.title': 'Uygulama İzinleri',
    'perm.intro': 'GPS, kamera, mikrofon ve galeri erişimi için izinleri buradan yönetin.',
    'perm.location': 'Konum (GPS)',
    'perm.locationDesc': 'Saha konumu, rota kaydı ve harita takibi',
    'perm.camera': 'Kamera',
    'perm.cameraDesc': 'Saha fotoğrafı çekme',
    'perm.microphone': 'Mikrofon',
    'perm.microphoneDesc': 'Sesli not, dikte ve ses kaydı',
    'perm.photos': 'Galeri / Fotoğraflar',
    'perm.photosDesc': 'Galeriden fotoğraf seçme',
    'perm.allow': 'İzin ver',
    'perm.granted': 'Açık',
    'perm.denied': 'Kapalı',
    'perm.prompt': 'İstenmedi',
    'perm.unknown': 'Bilinmiyor',
    'perm.openSettings': 'Sistem ayarlarını aç',
    'perm.close': 'Kapat',
    'perm.manage': '🔐 İzinler',
    'perm.settingsFail': 'Ayarlar açılamadı — cihaz ayarlarından PlanAI Field izinlerine gidin.',
    'perm.settingsWeb': 'Tarayıcı adres çubuğundaki kilit simgesinden site izinlerini açın.',
    'perm.openFromGps': 'Konum izni kapalı — İzinler panelinden açın.',
    'import.err.shpMissing': 'Eksik SHP bileşenleri — .shp dosyası gerekli',
    'import.err.shpIncomplete': 'Eksik SHP bileşenleri — .shp ile birlikte .dbf ve .shx seçin',
    'import.err.citygml': 'Bu CityGML sürümü desteklenmiyor veya geometri bulunamadı',
    'import.err.geotiffPos': 'GeoTIFF konumu doğrulanamadı',
    'import.err.geotiffCrs': 'GeoTIFF koordinat sistemi desteklenmiyor',
    'import.err.kml': 'KML ayrıştırılamadı — dosya bozuk veya boş',
    'import.err.noGeom': 'Dosyada görüntülenebilir geometri bulunamadı',
    'report.pdfReady': 'PDF rapor hazır',
    'report.interactiveReady': 'Mekansal inceleme tekrarı hazır',
    'report.journeyBundleReady': 'Yolculuk ve PDF rapor kaydedildi',
    'report.previewFirst': 'Yolculuğu önizleyin, kaydedin veya paylaşın',
    'report.doc.titleSuffix': 'PlanAI Field Raporu',
    'report.doc.subtitle': 'Saha İnceleme Raporu',
    'report.doc.projectDefault': 'Saha Gezisi',
    'report.doc.cover.project': 'Gezi',
    'report.doc.cover.date': 'Tarih',
    'report.doc.cover.time': 'Saat',
    'report.doc.cover.user': 'Kullanıcı',
    'report.doc.cover.center': 'Merkez koordinat',
    'report.doc.cover.totalObjects': 'Toplam nesne',
    'report.doc.summary.title': 'Gezi Özeti',
    'report.doc.summary.photos': 'Fotoğraf',
    'report.doc.summary.notes': 'Not',
    'report.doc.summary.measured': 'Ölçülü çizim',
    'report.doc.summary.imports': 'İçe aktarım',
    'report.doc.summary.totalLine': 'Toplam ölçüm uzunluğu',
    'report.doc.summary.totalArea': 'Toplam alan',
    'report.doc.projectInfo': 'Gezi bilgisi',
    'report.doc.projectId': 'Gezi ID',
    'report.doc.created': 'Oluşturulma',
    'report.doc.updated': 'Son güncelleme',
    'report.doc.map.title': 'Harita Görünümü',
    'report.doc.map.unavailable': 'Harita görüntüsü alınamadı.',
    'report.doc.map.basemap': 'Altlık',
    'report.doc.measure.title': 'Çizim / Ölçü Özeti',
    'report.doc.measure.element': 'Öğe',
    'report.doc.measure.type': 'Tür',
    'report.doc.measure.length': 'Uzunluk',
    'report.doc.measure.area': 'Alan',
    'report.doc.measure.perimeter': 'Çevre',
    'report.doc.measure.kindLine': 'Ölçüm',
    'report.doc.measure.kindArea': 'Alan',
    'report.doc.measure.empty': 'Ölçülü çizim yok',
    'report.doc.photos.title': 'Fotoğraflar',
    'report.doc.photos.noImage': 'Görsel yok',
    'report.doc.photos.photoNo': 'Foto No',
    'report.doc.photos.coordinate': 'Koordinat',
    'report.doc.photos.dateTime': 'Tarih / Saat',
    'report.doc.photos.gpsAccuracy': 'GPS hassasiyeti',
    'report.doc.photos.caption': 'Açıklama',
    'report.doc.photos.handwritingAlt': 'El yazısı',
    'report.doc.photos.empty': 'Kayıtlı fotoğraf yok.',
    'report.doc.notes.title': 'Notlar',
    'report.doc.notes.label': 'Not',
    'report.doc.notes.empty': 'Kayıtlı not yok.',
    'report.doc.tech.title': 'Teknik Bilgiler',
    'report.doc.tech.crs': 'CRS',
    'report.doc.tech.app': 'Uygulama',
    'report.doc.tech.template': 'Rapor şablonu',
    'report.doc.tech.gpsInstant': 'GPS hassasiyeti (anlık)',
    'report.doc.tech.generated': 'Rapor oluşturulma',
    'report.doc.progress.collect': 'Gezi verisi toplanıyor…',
    'report.doc.progress.map': 'Harita görüntüsü alınıyor…',
    'report.doc.progress.photos': 'Fotoğraflar işleniyor…',
    'report.doc.progress.notes': 'Notlar işleniyor…',
    'report.doc.progress.page': 'Rapor sayfası oluşturuluyor…',
    'report.doc.progress.pdf': 'PDF üretiliyor…',
    'report.doc.progress.done': 'Tamamlandı',
    'note.clearHand': 'Temizle', 'note.save': 'Kaydet', 'note.delete': 'Sil', 'note.cancel': 'İptal',
    'note.deleteConfirm': 'Not {n} silinsin mi?', 'note.deleted': 'Not silindi', 'note.deleteNone': 'Silinecek kayıtlı not yok',
    'point.deleteConfirm': 'Nokta {n} silinsin mi?', 'point.deleted': 'Nokta silindi',
    'photo.deleteConfirm': '{name} silinsin mi?', 'photo.deleted': 'Fotoğraf silindi',
    'obj.deleteConfirm': '{name} silinsin mi?', 'obj.deleted': 'Öğe silindi',
    'photo.desc': 'Açıklama', 'photo.voice': '🎤 Sesli not', 'photo.noVoice': 'Ses kaydı yok',
    'photo.record': '🎤 Kaydet', 'photo.play': '▶ Oynat', 'photo.delVoice': '🗑 Sil',
    'photo.centerMap': '🎯 Ortala', 'photo.save': '💾 Kaydet', 'photo.delete': '🗑 Sil',
    'photo.micDenied': 'Mikrofon izni verilmedi — tekrar deneyin',
    'photo.camRequired': 'Fotoğraf için kamera izni gerekli — «İzin ver» seçin',
    'photo.camDenied': 'Kamera izni verilmedi — tekrar deneyin',
    'photo.placeholder': 'Saha gözlemi…', 'photo.recording': 'Kayıt devam ediyor…',
    'photo.stopRecord': '⏹ Durdur', 'photo.voiceDur': 'Sesli not · {n} sn',
    'gps.err.denied': 'Konum izni kapalı. Ayarlardan Konum → İzin ver, ardından GPS\'i yeniden açın.',
    'gps.err.weak': 'GPS sinyali alınamıyor. Açık alana çıkın veya bekleyin.',
    'gps.err.timeout': 'Konum zaman aşımı — sinyal aranıyor…',
    'gps.err.unknown': 'GPS hatası: {msg}',
    'gps.err.needHttps': 'GPS için HTTPS veya localhost gerekir.',
    'gps.err.noApi': 'Bu cihazda GPS API desteklenmiyor',
    'gps.hint.acquire': 'Konum alınıyor… birkaç saniye bekleyin.',
    'gps.hint.deniedHelp': 'Konum izni gerekli. Tarayıcı kilit → Site ayarları → Konum → İzin ver.',
    'gps.hint.waiting': 'GPS sinyali bekleniyor — açık alanda deneyin',
    'gps.hint.agpsWeak': 'Zayıf GPS — AGPS konum iyileştiriliyor, açık alanda bekleyin',
    'gps.hint.on': 'GPS açıldı — konum aranıyor', 'gps.hint.off': 'GPS durduruldu',
    'gps.hint.followOn': 'GPS ve harita takibi açıldı', 'gps.hint.noFix': 'Konum henüz alınamadı — bekleyin',
    'gps.hint.openFirst': 'Önce GPS\'i açın', 'gps.hint.centered': 'Merkeze gidildi',
    'gps.hint.liveOn': 'Canlı konum açıldı', 'gps.hint.pending': 'Konum bekleniyor…',
    'autosave.err': 'Kayıt hatası', 'autosave.failed': 'Kayıt başarısız',
    'draw.widthLabel': 'Kalınlık',
    'draw.size': 'Boyut',
    'draw.widthWithVal': 'Kalınlık · {n}px',
    'draw.sizeWithVal': 'Boyut · {n}px',
    'draw.opacityWithVal': 'Şeffaflık · {n}%',
    'project.untitled': 'Adsız Gezi',
    'project.namePrefix': 'Saha Yolculuğu',
    'common.confirm': 'Onayla', 'common.cancel': 'İptal',
    'ctx.pointLabel': 'Nokta #{n}',
    'photo.openCamera': '📷 Kamerayı Aç', 'photo.fromGallery': '🖼 Galeriden Seç', 'photo.cancelSheet': 'İptal',
    'photo.voiceSheetLabel': 'Sesli saha notu', 'photo.voiceSheetHint': 'İsteğe bağlı ses kaydı. Saha paneli üzerinde açılır.',
    'photo.voiceSheetRecord': '🎤 Sesli not kaydet', 'photo.skip': 'Atla', 'photo.done': 'Tamam',
    'photo.recordingLive': '🔴 Kayıt devam ediyor…', 'photo.stopRecordLong': '⏹ Kaydı durdur',
    'photo.voiceReady': '✓ Sesli not · {n} sn', 'photo.noVoiceTap': 'Ses kaydı yok — dokunarak kaydedin',
    'photo.micRequired': 'Ses kaydı için mikrofon izni gerekli — «İzin ver» seçin',
    'photo.micUnsupported': 'Bu cihazda ses kaydı desteklenmiyor',
    'photo.micPrompt': 'Sesli not için mikrofon izni verin',
    'photo.ready': 'Fotoğraf hazır',
    'slope.leg0': '0–5° düz', 'slope.leg1': '5–10°', 'slope.leg2': '10–15°', 'slope.leg3': '15–20°',
    'slope.leg4': '20–30°', 'slope.leg5': '30°+ uygunsuz',
    'hint.slopeAfterCircle': 'Daire çizildi — eğim analizi hesaplanıyor…',
    'onboard.badge': 'Kullanım turu',
    'onboard.welcome.title': 'PlanAI Field\'a hoş geldiniz',
    'onboard.welcome.body': 'Saha incelemenizi adım adım öğrenin. İkonların yerini göstererek kısa bir tanıtım turu atalım.',
    'onboard.s1.title': '1 · Gezi oluştur',
    'onboard.s1.body': 'Alttaki Geziler düğmesinden yeni gezi oluşturun veya son gezilerden birini açın. Tüm saha verileri geziye kaydedilir.',
    'onboard.s2.title': '2 · İçe aktar',
    'onboard.s2.body': 'KML, KMZ, GML, GeoJSON, SHP, GeoTIFF veya DXF dosyalarını İçe Aktar ile haritaya ekleyin. WhatsApp veya Drive\'dan paylaşılan dosyalar da açılabilir.',
    'onboard.s3.title': '3 · Bilgi aracı',
    'onboard.s3.body': 'İçe aktardığınız KML, KMZ veya GML öğelerine Bilgi aracı ile dokunun — öznitelikler ve ölçüler sağ panelde görünür.',
    'onboard.s4.title': '4 · Konum ara',
    'onboard.s4.body': 'Üst çubuktaki Konum ara ile il, ilçe veya yer adı yazın; harita o bölgeye gider.',
    'onboard.s5.title': '5 · GPS ve güzergâh',
    'onboard.s5.body': 'GPS\'i başlatın, konumunuzu takip edin. ▶ Rota ile inceleme güzergâhınızı kaydedin; rota katmanında listelenir.',
    'onboard.s6.title': '6 · Fotoğraf ve sesli not',
    'onboard.s6.body': 'Foto ile saha görüntüsü çekin. Fotoğrafa açıklama ve sesli not ekleyebilir; haritada konumla ilişkilendirebilirsiniz.',
    'onboard.s7.title': '7 · Saha notu',
    'onboard.s7.body': 'Notlar ile haritaya metin veya el yazısı not sabitleyin. Mikrofon ikonu ile konuşarak metne dikte edebilirsiniz.',
    'onboard.s8.title': '8 · Altlık değiştir',
    'onboard.s8.body': 'Uydu ikonu ile uydu, OSM harita veya topoğrafya altlığı arasında geçiş yapın.',
    'onboard.s9.title': '9 · Parmak ve kalem',
    'onboard.s9.body': '👆 Parmak modu: haritayı kaydırın, dokunarak işaretleyin. ✏️ Kalem modu: stylus ile çizin; parmakla pan yapın.',
    'onboard.s10.title': '10 · Mesafe ölçümü',
    'onboard.s10.body': 'Sol menüdeki ölçüm aracı ile köşelere dokunarak mesafe ölçün. Enter veya çift dokunuşla bitirin.',
    'onboard.s11.title': '11 · Alan ölçümü',
    'onboard.s11.body': 'Poligon aracı ile alan sınırı çizin ve yüzey alanını ölçün.',
    'onboard.s12.title': '12 · Eğim analizi',
    'onboard.s12.body': 'Eğim aracı ile inceleme alanını daire olarak işaretleyin; eğim analizi otomatik hesaplanır ve rapora eklenebilir.',
    'onboard.s13.title': '13 · Katman yönetimi',
    'onboard.s13.body': 'Sağ panelde Katmanlar bölümünden not, foto, GPS rotası ve içe aktarımları yönetin; görünürlük ve sırayı ayarlayın.',
    'onboard.s14.title': '14 · Renk ve kalınlık',
    'onboard.s14.body': 'Çizim rengi ve kalınlığını sağ panelden ayarlayın. Bir çizgi veya poligon seçtiğinizde aynı panelden düzenleyebilirsiniz.',
    'onboard.s15.title': '15 · Mekansal Hikâye Anlatımı',
    'onboard.s15.body': 'Geziler menüsünden PDF saha özeti veya mekansal inceleme tekrarı oluşturun; WhatsApp, Mail veya Drive ile paylaşın.',
    'offline.badge': 'Çevrimdışı',
    'offline.tilesCached': 'Harita önbelleği kullanılıyor',
    'onboard.start': 'Tura başla',
    'onboard.next': 'İleri',
    'onboard.prev': 'Geri',
    'onboard.skip': 'Atla',
    'onboard.done': 'Tamam',
    'onboard.stepOf': '{n} / {t}',
    'onboard.finished': 'Tanıtım tamamlandı — iyi çalışmalar!',
    'onboard.replay': 'Kullanım turunu tekrar göster',
  },
  en: {
    'panel.title': 'Field Panel', 'panel.project': 'Journey', 'panel.projects': 'Journeys',
    'panel.reports': 'Field Journeys',
    'info.title': 'Feature info', 'info.back': 'Back to select', 'info.noAttrs': 'No attributes for this feature.',
    'info.noPick': 'No feature — tap empty map to close panel',
    'info.measure': 'Measure',
    'analysis.menu': 'Analysis', 'analysis.slope': 'Slope',
    'slope.title': 'Slope analysis', 'slope.clear': 'Clear analysis', 'slope.save': '💾 Save analysis',
    'slope.saved': 'Slope analysis saved for report', 'slope.savedBadge': '✓ Included in reports',
    'slope.nothingToSave': 'Run slope analysis first', 'slope.running': 'Computing slope…',
    'slope.minElev': 'Min elevation', 'slope.maxElev': 'Max elevation', 'slope.avgSlope': 'Avg slope',
    'slope.maxSlope': 'Max slope', 'slope.aspect': 'Dominant aspect', 'slope.area': 'Analysis area',
    'slope.needArea': 'Select a polygon or circle first', 'slope.offline': 'DEM failed — network required',
    'tool.select': 'Select tool', 'tool.info': 'Info tool', 'tool.point': 'Point', 'tool.line': 'Measure', 'tool.polyline': 'Polyline measure',
    'tool.polygon': 'Polygon', 'tool.circle': 'Slope analysis', 'tool.text': 'Text', 'tool.eraser': 'Eraser',
    'tool.freedraw': 'Free draw', 'tool.field-note': 'Field note',
    'mode.finger': 'Finger', 'mode.pen': 'Pen',
    'stat.objects': '{n} objects', 'search.placeholder': 'Search location…', 'search.btn': 'Search',
    'gps.off': 'Off', 'gps.searching': 'Searching…', 'gps.connected': 'Connected', 'gps.weak': 'Weak signal',
    'gps.denied': 'Permission denied', 'gps.unavailable': 'Unavailable', 'gps.pill': 'GPS',
    'gps.followOn': 'Follow: ON', 'gps.followOff': 'Follow: OFF', 'gps.accuracy': 'Accuracy',
    'gps.follow': 'Follow', 'gps.center': 'Center', 'gps.trackBtn': 'Track',
    'gps.start': 'START', 'gps.stop': 'STOP', 'gps.pause': 'Pause', 'gps.resume': 'Resume',
    'gps.move.stationary': 'Stationary', 'gps.move.walking': 'Walking', 'gps.move.active': 'Active', 'gps.move.low': 'Weak GPS',
    'gps.conf.high': 'High confidence', 'gps.conf.good': 'Good confidence', 'gps.conf.mid': 'Moderate confidence', 'gps.conf.low': 'Low confidence',
    'gps.hud.lat': 'Latitude', 'gps.hud.lon': 'Longitude', 'gps.hud.speed': 'Speed', 'gps.hud.heading': 'Heading',
    'gps.hud.alt': 'Altitude', 'gps.hud.acc': 'Accuracy', 'gps.hud.route': 'Route',
    'gps.hud.guide': 'Target', 'gps.hud.debugOn': 'GPS developer mode on', 'gps.hud.debugOff': 'GPS developer mode off',
    'guide.go': 'Go here', 'guide.arrived': 'Arrived', 'guide.clear': 'Clear target',
    'guide.hint': 'Direct route ready — walk per HUD bearing', 'guide.needGps': 'Turn on GPS first',
    'guide.replayPoint': 'Go to track point', 'guide.route': 'Direct route',
    'guide.showRoute': 'Show route', 'guide.walk': 'Walk this way',
    'dock.projects': 'Journeys', 'dock.import': 'Import', 'dock.gps': 'GPS', 'dock.photo': 'Photo',
    'tlbl.select': 'Select', 'tlbl.info': 'Info', 'tlbl.point': 'Point', 'tlbl.line': 'Measure', 'tlbl.polyline': 'Polyline', 'tlbl.area': 'Area', 'tlbl.slope': 'Slope', 'tlbl.layers': 'Layers', 'tlbl.undo': 'Undo', 'tlbl.delete': 'Delete',
    'dock.notes': 'Notes', 'basemap.none': 'Off', 'basemap.osm': 'OSM', 'basemap.satellite': 'Satellite', 'basemap.topo': 'Topo',
    'basemap.hint.none': 'Basemap off', 'basemap.hint.osm': 'OSM map', 'basemap.hint.satellite': 'Satellite imagery', 'basemap.hint.topo': 'Topography',
    'layer.sketch': 'Field', 'layer.points': 'Points', 'layer.imported': 'Other imports', 'layer.photos': 'Photos', 'layer.notes': 'Notes', 'layer.gps': 'GPS track',
    'project.menu': 'Journey', 'project.new': '+ New journey', 'project.newName': 'Journey name', 'project.create': 'Create', 'project.cancel': 'Cancel', 'project.rename': 'Rename', 'project.save': 'Save',
    'entry.tagline': 'Spatial Inspection Playback Platform',
    'entry.headline': 'Start Your Spatial Inspection Journey',
    'entry.subheadline': 'Capture routes, notes, photos and spatial observations within a cinematic field experience.',
    'entry.startTitle': 'Start New Inspection',
    'entry.startDesc': 'Create a new field journey with GPS tracking, notes, photos and spatial playback.',
    'entry.continueTitle': 'Continue Inspection',
    'entry.continueDesc': 'Resume an existing inspection journey and continue spatial playback.',
    'entry.exploreTitle': 'Explore Previous Journeys',
    'entry.exploreDesc': 'Review completed inspections and replay field journeys.',
    'entry.journeyName': 'Journey name',
    'entry.createJourney': 'Start Journey',
    'entry.back': 'Back',
    'entry.noRecent': 'No saved inspection to continue — start a new journey.',
    'entry.noJourneys': 'No saved journeys yet.',
    'entry.journeysHead': 'Previous Journeys',
    'project.reportPdf': 'PDF Report', 'project.reportInteractive': 'Start Field Journey',
    'project.reportDemo': 'Demo Journey Simulation',
    'project.exportZip': 'Export ZIP', 'project.importZip': 'Import ZIP', 'project.recent': 'Recent journeys',
    'project.none': 'No journeys yet',
    'project.delete': 'Delete journey', 'project.deleted': 'Journey deleted',
    'project.head': 'Journeys', 'project.autosaveNote': 'Changes autosave (IndexedDB). Status shown in top bar.',
    'hub.title': 'Field Journey Hub',
    'hub.subtitle': 'Capture routes, observations, photos and field intelligence.',
    'hub.newInspection': 'New Inspection',
    'hub.tagline': 'GPS Tracking • Photos • Voice Notes • Reports',
    'hub.missionNewTitle': 'Start New Inspection',
    'hub.missionNewSub': 'Capture field data in one simple workflow.',
    'hub.activeJourney': 'Active Journey',
    'hub.heroCta': 'Start Inspection',
    'hub.featGps': 'GPS Tracking',
    'hub.featPhotoCapture': 'Photo Capture',
    'hub.featVoice': 'Voice Notes',
    'hub.featReports': 'Interactive Reports',
    'hub.cardContinueEmpty': 'No active journey',
    'hub.cardContinueDesc': 'Resume your latest journey.',
    'hub.continueCta': 'Continue',
    'hub.continueInspectionCta': 'Continue Inspection',
    'hub.openFailed': 'Could not open inspection. Unlock PIN if required, or start a new inspection.',
    'hub.noSavedInspection': 'No saved inspection found.',
    'hub.snapshotMissing': 'Inspection data is missing or locked.',
    'hub.saveFailed': 'Inspection could not be saved. Try again before closing the app.',
    'hub.startInspectionCta': 'Start New Inspection',
    'hub.archiveLink': 'View All Journeys',
    'hub.lastActivity': 'Last activity:',
    'hub.recentKicker': 'Recent Journeys',
    'hub.viewAllJourneys': 'View All Journeys',
    'hub.recentEmpty': 'No other saved journeys',
    'hub.colName': 'Journey',
    'hub.colDistance': 'Distance',
    'hub.colPhotos': 'Photos',
    'hub.colDate': 'Date',
    'hub.datasetImport': 'Dataset Import',
    'hub.importFormats': 'PlanGML · GML · GeoTIFF · KML · KMZ · GeoJSON',
    'hub.importCtaFull': 'Import Dataset',
    'hub.asideJourneys': 'Journeys',
    'hub.asidePhotos': 'Photos',
    'hub.asideNotes': 'Notes',
    'hub.asideDistance': 'Distance',
    'sec.title': 'Security',
    'sec.pinProtection': 'PIN Protection',
    'sec.pinHint': 'Protect routes, photos, notes and reports on this device.',
    'sec.encryption': 'Encryption Status',
    'sec.encEnabled': 'Enabled',
    'sec.encLocked': 'Locked',
    'sec.encBaseline': 'Baseline',
    'sec.encOff': 'Off',
    'sec.on': 'ON',
    'sec.off': 'OFF',
    'sec.enablePin': 'Create PIN',
    'sec.lockNow': 'Lock now',
    'sec.viewRecovery': 'View recovery code',
    'sec.regenRecovery': 'Regenerate recovery code',
    'sec.recoveryRegenerated': 'New recovery code generated',
    'gate.title': 'PlanAI Field',
    'gate.offerTitle': 'Protect Field Data?',
    'gate.offerSub': 'Create a device PIN to protect:',
    'gate.offerRoutes': 'routes',
    'gate.offerPhotos': 'photos',
    'gate.offerNotes': 'notes',
    'gate.offerReports': 'reports',
    'gate.offerCreate': 'Create PIN',
    'gate.offerSkip': 'Skip for Now',
    'gate.setupSub': 'Protect field data on this device with a PIN.',
    'gate.unlockSub': 'Enter your PIN to continue.',
    'gate.pinNew': 'New PIN',
    'gate.pinConfirm': 'Confirm PIN',
    'gate.pinInput': 'PIN',
    'gate.create': 'Create PIN',
    'gate.unlock': 'Unlock',
    'gate.cancel': 'Cancel',
    'gate.wrongPin': 'Incorrect PIN',
    'gate.pinMismatch': 'PINs do not match',
    'gate.pinShort': 'PIN must be 4–12 characters',
    'gate.forgot': 'Forgot PIN?',
    'gate.setupRecoveryNote': 'A recovery code is shown once. Your field data is never deleted.',
    'gate.recoverSub': 'Your journeys are preserved. Use your recovery code to set a new PIN.',
    'gate.recoverUseCode': 'Reset PIN with recovery code',
    'gate.recoverCodeSub': 'Enter the recovery code you saved when creating your PIN.',
    'gate.recoveryCode': 'Recovery code',
    'gate.recoverSetPin': 'Save new PIN',
    'gate.recoverEmailHint': 'Registered',
    'gate.recoverEmailHintNone': 'Enter the e-mail used when creating your PIN.',
    'gate.recoverSendOtp': 'Send verification code',
    'gate.recoverOtp': 'Verification code',
    'gate.recoveryShowSub': 'Save this recovery code in a safe place. It can be used if you forget your PIN.',
    'gate.recoverySaved': 'I saved the code',
    'gate.recoverBadCode': 'Incorrect recovery code',
    'gate.recoverNoCode': 'No recovery code on this device.',
    'gate.recoverFailed': 'Recovery failed',
    'gate.back': 'Back',
    'ctx.selectedObject': 'Selected object', 'ctx.fieldNote': 'Field note', 'ctx.description': 'Description',
    'ctx.photo': 'Photo', 'ctx.voiceNote': 'Voice note', 'draw.color': 'Draw color', 'draw.width': 'Width',
    'draw.opacity': 'Opacity', 'stat.drawing': '· Drawing…', 'stat.grid': 'GRID {n}cm',
    'tool.closed': 'This tool is disabled in Field mode',
    'layer.geom': '{n} features', 'layer.importSources': '{n} sources', 'layer.overlay': 'overlay', 'layer.planOverlay': 'Plan overlay (vector / raster)',
    'layer.dxf': 'DXF layers', 'layer.gml': 'GML layers',
    'layer.section': 'Layers', 'layer.hide': 'Hide', 'layer.show': 'Show', 'layer.lock': 'Lock', 'layer.unlock': 'Unlock',
    'layer.go': 'Go', 'layer.goMissing': 'Layer extent not found',
    'layer.expandList': 'Expand feature list', 'layer.collapseList': 'Collapse feature list',
    'layer.delete': 'Delete layer', 'layer.cannotDelete': 'Cannot delete this layer',
    'layer.deleteConfirm': 'Delete "{name}" and {n} features?', 'layer.deleted': 'Layer deleted', 'layer.opacity': 'Opacity',
    'type.point': 'Point', 'type.field_note': 'Field note', 'type.field_photo': 'Photo',
    'track.start': 'Track recording started', 'track.pause': 'Paused', 'track.stop': 'Track saved',
    'track.stopHud': 'STOP ROUTE', 'track.stopHudHint': 'Route stopped — GPS and follow still on',
    'track.idle': 'Track recording off', 'track.recording': 'Recording', 'track.paused': 'Paused',
    'track.dist': 'Distance', 'track.time': 'Duration', 'track.points': 'Points',
    'report.interactive': 'Share journey or save to Drive',
    'report.savedToProject': 'Journey saved',
    'report.mapSkipped': 'Map snapshot skipped (basemap could not be exported)',
    'report.none': 'No journeys yet — create PDF or spatial inspection playback',
    'report.view': 'Open',
    'report.share': 'Share',
    'report.pdf': 'PDF Report',
    'report.interactiveShort': 'Journey',
    'report.html': 'Spatial Playback',
    'report.viewerTitle': 'Preview',
    'report.playbackViewerTitle': 'Spatial Inspection Playback',
    'report.missing': 'Journey file not found',
    'report.demoReady': 'Demo journey saved — open from the right panel',
    'report.demoRunning': 'Preparing demo journey…',
    'report.count': '{n} journeys',
    'report.delete': 'Delete',
    'report.deleted': 'Journey deleted',
    'report.deleteConfirm': 'Delete this journey?',
    'export.sheetTitle': 'Send file',
    'export.sendFile': 'Send file',
    'export.sendFileHint': 'WhatsApp, Mail, Drive, Bluetooth…',
    'export.whatsapp': 'WhatsApp',
    'export.mail': 'Email',
    'export.onedrive': 'OneDrive',
    'export.dropbox': 'Dropbox',
    'export.otherApps': 'Other',
    'import.sheetTitle': 'Import file',
    'import.sheetHint': 'PlanGML · KML · KMZ · GeoJSON · GeoTIFF',
    'health.kicker': 'Spatial Data Readiness',
    'health.title': 'Spatial Data Readiness Assessment',
    'health.file': 'File', 'health.format': 'Format',
    'health.datasetSize': 'Dataset Size', 'health.spatialComplexity': 'Spatial Complexity',
    'health.expectedPerf': 'Expected Performance', 'health.renderComplexity': 'Render complexity',
    'health.features': 'Features', 'health.polygons': 'Polygons', 'health.vertices': 'Vertices',
    'health.layers': 'Layers', 'health.rasterRes': 'Raster', 'health.memory': 'Memory estimate',
    'health.placemarks': 'Placemarks', 'health.embeddedImages': 'Embedded images', 'health.hatchPolys': 'Hatch polygons',
    'health.cog': 'Cloud Optimized GeoTIFF',
    'health.complexity.low': 'Low', 'health.complexity.medium': 'Medium', 'health.complexity.high': 'High', 'health.complexity.veryHigh': 'Very High',
    'health.status.ready': 'Ready',
    'health.status.readyDesc': 'This dataset can be opened safely.',
    'health.status.optimize': 'Optimization Recommended',
    'health.status.optimizeDesc': 'The dataset is larger than average. Optimized Mode is recommended.',
    'health.status.heavy': 'Heavy Dataset',
    'health.status.heavyDesc': 'Performance slowdowns are expected.',
    'health.status.critical': 'Critical Dataset',
    'health.status.criticalDesc': 'Opening may cause instability on some devices.',
    'health.perf.excellent': 'Excellent',
    'health.perf.excellentHint': 'Map navigation should remain smooth.',
    'health.perf.good': 'Good',
    'health.perf.goodHint': 'Map navigation should remain smooth.',
    'health.perf.moderate': 'Moderate',
    'health.perf.moderateHint': 'Pan and zoom may feel slower during heavy layers.',
    'health.perf.heavy': 'Heavy',
    'health.perf.heavyHint': 'Significant slowdowns or instability are possible.',
    'health.compat.title': 'Device Compatibility',
    'health.compat.high': 'High-End Tablet',
    'health.compat.mid': 'Mid-Range Tablet',
    'health.compat.low': 'Entry-Level Tablet',
    'health.compat.thisDevice': 'This device',
    'health.compat.examples': 'Compatible Devices',
    'health.compat.examplesLimited': 'Use a high-end tablet or Optimized Mode for best results.',
    'health.mode.title': 'Recommended Loading Mode',
    'health.mode.normal': 'Normal Mode',
    'health.mode.optimized': 'Optimized Mode',
    'health.opt.lead': 'Optimized Mode reduces memory usage by:',
    'health.opt.simplify': 'simplifying complex geometry',
    'health.opt.raster': 'reducing heavy raster resolution',
    'health.opt.defer': 'postponing large layer rendering',
    'health.opt.result': 'Expected result: faster and more stable operation.',
    'health.advanced.title': 'Advanced Dataset Details',
    'health.rec.critical': 'High crash probability on this device. Simplify geometry or reduce resolution before loading.',
    'health.btn.optimized': 'Open in Optimized Mode',
    'health.btn.continue': 'Open Normally',
    'health.btn.proceedRisky': 'Open Normally (not recommended)',
    'health.btn.cancel': 'Cancel',
    'health.optimizedOn': 'Optimized mode on — layers and effects reduced',
    'health.importCancelled': 'Import cancelled',
    'import.device': 'Phone / tablet storage',
    'import.deviceHint': 'File manager',
    'import.cloud': 'Drive, OneDrive, Dropbox…',
    'import.cloudHint': 'WhatsApp, Gmail or cloud apps',
    'import.openedHtml': 'Spatial inspection playback opened',
    'import.openedPdf': 'PDF opened',
    'export.share': 'Send file — WhatsApp, Mail, Drive…',
    'export.drive': 'Save to Google Drive',
    'export.download': 'Save to device',
    'export.preview': 'Preview',
    'export.cancel': 'Cancel',
    'export.downloaded': 'Download started',
    'export.shareFail': 'Could not share — saving to device',
    'export.ready': 'File ready — send or download',
    'export.openingShare': 'Opening share menu…',
    'feat.landUse': 'Land use', 'feat.plan': 'Plan decision', 'feat.far': 'FAR', 'feat.height': 'Height', 'feat.type': 'Type',
    'autosave.idle': 'Autosave', 'autosave.pending': '○ Pending save…', 'autosave.saving': '… Saving',
    'project.menu': 'Journey', 'project.new': '+ New journey', 'project.newName': 'Journey name', 'project.create': 'Create', 'project.cancel': 'Cancel', 'project.rename': 'Rename', 'project.save': 'Save',
    'entry.tagline': 'Spatial Inspection Playback Platform',
    'entry.headline': 'Start Your Spatial Inspection Journey',
    'entry.subheadline': 'Capture routes, notes, photos and spatial observations within a cinematic field experience.',
    'entry.startTitle': 'Start New Inspection',
    'entry.startDesc': 'Create a new field journey with GPS tracking, notes, photos and spatial playback.',
    'entry.continueTitle': 'Continue Inspection',
    'entry.continueDesc': 'Resume an existing inspection journey and continue spatial playback.',
    'entry.exploreTitle': 'Explore Previous Journeys',
    'entry.exploreDesc': 'Review completed inspections and replay field journeys.',
    'entry.journeyName': 'Journey name',
    'entry.createJourney': 'Start Journey',
    'entry.back': 'Back',
    'entry.noRecent': 'No saved inspection to continue — start a new journey.',
    'entry.noJourneys': 'No saved journeys yet.',
    'entry.journeysHead': 'Previous Journeys',
    'project.reportPdf': 'PDF Report', 'project.reportInteractive': 'Start Field Journey',
    'project.reportDemo': 'Demo Journey Simulation',
    'project.exportZip': 'Export ZIP', 'project.importZip': 'Import ZIP', 'project.recent': 'Recent journeys',
    'project.none': 'No journeys yet',
    'project.delete': 'Delete journey', 'project.deleted': 'Journey deleted',
    'project.head': 'Journeys', 'project.autosaveNote': 'Changes autosave to IndexedDB. Status is shown in the top bar.',
    'hub.title': 'Field Journey Hub',
    'hub.subtitle': 'Capture routes, observations, photos and field intelligence.',
    'hub.newInspection': 'New Inspection',
    'hub.tagline': 'GPS Tracking • Photos • Voice Notes • Reports',
    'hub.missionNewTitle': 'Start New Inspection',
    'hub.missionNewSub': 'Capture field data in one simple workflow.',
    'hub.activeJourney': 'Active Journey',
    'hub.heroCta': 'Start Inspection',
    'hub.featGps': 'GPS Tracking',
    'hub.featPhotoCapture': 'Photo Capture',
    'hub.featVoice': 'Voice Notes',
    'hub.featReports': 'Interactive Reports',
    'hub.cardContinueEmpty': 'No active journey',
    'hub.cardContinueDesc': 'Resume your latest journey.',
    'hub.continueCta': 'Continue',
    'hub.continueInspectionCta': 'Continue Inspection',
    'hub.openFailed': 'Could not open inspection. Unlock PIN if required, or start a new inspection.',
    'hub.noSavedInspection': 'No saved inspection found.',
    'hub.snapshotMissing': 'Inspection data is missing or locked.',
    'hub.saveFailed': 'Inspection could not be saved. Try again before closing the app.',
    'hub.startInspectionCta': 'Start New Inspection',
    'hub.archiveLink': 'View All Journeys',
    'hub.lastActivity': 'Last activity:',
    'hub.recentKicker': 'Recent Journeys',
    'hub.viewAllJourneys': 'View All Journeys',
    'hub.recentEmpty': 'No other saved journeys',
    'hub.colName': 'Journey',
    'hub.colDistance': 'Distance',
    'hub.colPhotos': 'Photos',
    'hub.colDate': 'Date',
    'hub.datasetImport': 'Dataset Import',
    'hub.importFormats': 'PlanGML · GML · GeoTIFF · KML · KMZ · GeoJSON',
    'hub.importCtaFull': 'Import Dataset',
    'hub.asideJourneys': 'Journeys',
    'hub.asidePhotos': 'Photos',
    'hub.asideNotes': 'Notes',
    'hub.asideDistance': 'Distance',
    'sec.title': 'Security',
    'sec.pinProtection': 'PIN Protection',
    'sec.pinHint': 'Protect routes, photos, notes and reports on this device.',
    'sec.encryption': 'Encryption Status',
    'sec.encEnabled': 'Enabled',
    'sec.encLocked': 'Locked',
    'sec.encBaseline': 'Baseline',
    'sec.encOff': 'Off',
    'sec.on': 'ON',
    'sec.off': 'OFF',
    'sec.enablePin': 'Create PIN',
    'sec.lockNow': 'Lock now',
    'sec.viewRecovery': 'View recovery code',
    'sec.regenRecovery': 'Regenerate recovery code',
    'sec.recoveryRegenerated': 'New recovery code generated',
    'gate.title': 'PlanAI Field',
    'gate.offerTitle': 'Protect Field Data?',
    'gate.offerSub': 'Create a device PIN to protect:',
    'gate.offerRoutes': 'routes',
    'gate.offerPhotos': 'photos',
    'gate.offerNotes': 'notes',
    'gate.offerReports': 'reports',
    'gate.offerCreate': 'Create PIN',
    'gate.offerSkip': 'Skip for Now',
    'gate.setupSub': 'Protect field data on this device with a PIN.',
    'gate.unlockSub': 'Enter your PIN to continue.',
    'gate.pinNew': 'New PIN',
    'gate.pinConfirm': 'Confirm PIN',
    'gate.pinInput': 'PIN',
    'gate.create': 'Create PIN',
    'gate.unlock': 'Unlock',
    'gate.cancel': 'Cancel',
    'gate.wrongPin': 'Incorrect PIN',
    'gate.pinMismatch': 'PINs do not match',
    'gate.pinShort': 'PIN must be 4–12 characters',
    'gate.forgot': 'Forgot PIN?',
    'gate.setupRecoveryNote': 'A recovery code is shown once. Your field data is never deleted.',
    'gate.recoverSub': 'Your journeys are preserved. Use your recovery code to set a new PIN.',
    'gate.recoverUseCode': 'Reset PIN with recovery code',
    'gate.recoverCodeSub': 'Enter the recovery code you saved when creating your PIN.',
    'gate.recoveryCode': 'Recovery code',
    'gate.recoverSetPin': 'Save new PIN',
    'gate.recoverEmailHint': 'Registered',
    'gate.recoverEmailHintNone': 'Enter the e-mail used when creating your PIN.',
    'gate.recoverSendOtp': 'Send verification code',
    'gate.recoverOtp': 'Verification code',
    'gate.recoveryShowSub': 'Save this recovery code in a safe place. It can be used if you forget your PIN.',
    'gate.recoverySaved': 'I saved the code',
    'gate.recoverBadCode': 'Incorrect recovery code',
    'gate.recoverNoCode': 'No recovery code on this device.',
    'gate.recoverFailed': 'Recovery failed',
    'gate.back': 'Back',
    'ctx.selectedObject': 'Selected object', 'ctx.fieldNote': 'Field note', 'ctx.description': 'Description',
    'ctx.photo': 'Photo', 'ctx.voiceNote': 'Voice note', 'draw.color': 'Draw color', 'draw.width': 'Width',
    'draw.opacity': 'Opacity', 'stat.drawing': '· Drawing…', 'stat.grid': 'GRID {n}cm',
    'tool.closed': 'This tool is disabled in Field mode',
    'mode.chipTitle': 'Finger / Pen mode',
    'lang.title': 'Language',
    'group.field': 'Field',
    'hint.finger': 'Finger mode — use draw tools on the map',
    'hint.pen': 'Pen mode — draw with stylus; pan with finger',
    'hint.line': 'Drag with pen to draw a line · pan with finger',
    'hint.penDetected': 'Stylus — draw; pan with finger',
    'hint.select': 'Tap to select · Drag to move · Double-tap to edit',
    'hint.point': 'Tap — field marker / note point',
    'hint.polyline': 'Tap vertices · Enter / double-tap finish · ESC cancel',
    'hint.polygon': 'Tap vertices · Enter / double-tap finish · ESC cancel',
    'hint.circle': 'Mark the center, then drag to set the diameter',
    'circle.step1': '1. Mark the center point',
    'circle.step2': '2. Drag for diameter — live circle preview',
    'circle.drawing': 'Dragging diameter…',
    'slope.legendTitle': 'Slope colors (°)',
    'hint.fieldNote': 'Tap map location — pin a field note',
    'hint.info': 'Tap imported feature — details in right panel',
    'hint.layersPanel': 'Layers panel',
    'tt.select': 'Select / Move / Rotate <kbd>V</kbd>',
    'tt.info': 'Info — Inspect attributes', 'tt.point': 'Point — Field marker',
    'tt.line': 'Line — Drag with pen', 'tt.polyline': 'Measure — Tap vertices', 'tt.polygon': 'Area — Polygon', 'tt.circle': 'Slope analysis',
    'tt.note': 'Note — Map note', 'tt.photo': 'Photo — Camera (field)', 'tt.layers': 'Layers',
    'tt.undo': 'Undo <kbd>Ctrl+Z</kbd>', 'tt.delete': 'Delete <kbd>Del</kbd>',
    'note.book': 'Field notebook', 'note.close': 'Close', 'note.infoTitle': 'Note info', 'note.pinMap': 'Tap a location on the map.',
    'note.tabText': 'Text', 'note.tabHand': '✏️ Handwriting', 'note.placeholder': 'Field observation…',
    'dictation.btn': 'Dictate', 'dictation.listening': 'Listening…', 'dictation.prompt': 'Speak now',
    'dictation.done': 'Added to text', 'dictation.fail': 'Dictation failed', 'dictation.unsupported': 'Speech recognition not supported',
    'dictation.cancelled': 'Dictation cancelled',
    'dictation.micRequired': 'Microphone permission required for dictation',
    'dictation.micDenied': 'Microphone not allowed — try again',
    'dictation.noEngine': 'Speech recognition is not available on this device',
    'dictation.noEngineHint': 'Use text/handwriting, or attach audio via photo «Record voice note»',
    'dictation.live': 'Live',
    'perm.title': 'App permissions',
    'perm.intro': 'Manage GPS, camera, microphone and gallery access here.',
    'perm.location': 'Location (GPS)',
    'perm.locationDesc': 'Field position, route recording and map tracking',
    'perm.camera': 'Camera',
    'perm.cameraDesc': 'Capture field photos',
    'perm.microphone': 'Microphone',
    'perm.microphoneDesc': 'Voice notes, dictation and audio recording',
    'perm.photos': 'Gallery / Photos',
    'perm.photosDesc': 'Pick photos from gallery',
    'perm.allow': 'Allow',
    'perm.granted': 'On',
    'perm.denied': 'Off',
    'perm.prompt': 'Not asked',
    'perm.unknown': 'Unknown',
    'perm.openSettings': 'Open system settings',
    'perm.close': 'Close',
    'perm.manage': '🔐 Permissions',
    'perm.settingsFail': 'Could not open settings — open PlanAI Field permissions in device settings.',
    'perm.settingsWeb': 'Use the lock icon in the browser address bar to manage site permissions.',
    'perm.openFromGps': 'Location is off — open the Permissions panel.',
    'import.err.crs': 'Coordinate system not recognized',
    'import.err.shpMissing': 'Missing SHP components — .shp file required',
    'import.err.shpIncomplete': 'Missing SHP components — select .shp with .dbf and .shx',
    'import.err.citygml': 'This CityGML version is unsupported or has no geometry',
    'import.err.geotiffPos': 'GeoTIFF position could not be verified',
    'import.err.geotiffCrs': 'GeoTIFF coordinate system is not supported',
    'import.err.kml': 'KML could not be parsed — file may be corrupt or empty',
    'import.err.noGeom': 'No displayable geometry found in file',
    'report.pdfReady': 'PDF report ready',
    'report.interactiveReady': 'Spatial playback ready',
    'report.journeyBundleReady': 'Journey and PDF report saved',
    'report.previewFirst': 'Preview, save, or share the journey',
    'report.doc.titleSuffix': 'PlanAI Field Report',
    'report.doc.subtitle': 'Field Inspection Report',
    'report.doc.projectDefault': 'Field Journey',
    'report.doc.cover.project': 'Journey',
    'report.doc.cover.date': 'Date',
    'report.doc.cover.time': 'Time',
    'report.doc.cover.user': 'User',
    'report.doc.cover.center': 'Center coordinate',
    'report.doc.cover.totalObjects': 'Total objects',
    'report.doc.summary.title': 'Journey Summary',
    'report.doc.summary.photos': 'Photos',
    'report.doc.summary.notes': 'Notes',
    'report.doc.summary.measured': 'Measured drawings',
    'report.doc.summary.imports': 'Imports',
    'report.doc.summary.totalLine': 'Total measure length',
    'report.doc.summary.totalArea': 'Total area',
    'report.doc.projectInfo': 'Journey information',
    'report.doc.projectId': 'Journey ID',
    'report.doc.created': 'Created',
    'report.doc.updated': 'Last updated',
    'report.doc.map.title': 'Map View',
    'report.doc.map.unavailable': 'Map snapshot could not be captured.',
    'report.doc.map.basemap': 'Basemap',
    'report.doc.measure.title': 'Drawing / Measurement Summary',
    'report.doc.measure.element': 'Item',
    'report.doc.measure.type': 'Type',
    'report.doc.measure.length': 'Length',
    'report.doc.measure.area': 'Area',
    'report.doc.measure.perimeter': 'Perimeter',
    'report.doc.measure.kindLine': 'Measure',
    'report.doc.measure.kindArea': 'Area',
    'report.doc.measure.empty': 'No measured drawings',
    'report.doc.photos.title': 'Photos',
    'report.doc.photos.noImage': 'No image',
    'report.doc.photos.photoNo': 'Photo No',
    'report.doc.photos.coordinate': 'Coordinate',
    'report.doc.photos.dateTime': 'Date / Time',
    'report.doc.photos.gpsAccuracy': 'GPS accuracy',
    'report.doc.photos.caption': 'Description',
    'report.doc.photos.handwritingAlt': 'Handwriting',
    'report.doc.photos.empty': 'No photos recorded.',
    'report.doc.notes.title': 'Notes',
    'report.doc.notes.label': 'Note',
    'report.doc.notes.empty': 'No notes recorded.',
    'report.doc.tech.title': 'Technical Information',
    'report.doc.tech.crs': 'CRS',
    'report.doc.tech.app': 'Application',
    'report.doc.tech.template': 'Report template',
    'report.doc.tech.gpsInstant': 'GPS accuracy (instant)',
    'report.doc.tech.generated': 'Report generated',
    'report.doc.progress.collect': 'Collecting journey data…',
    'report.doc.progress.map': 'Capturing map snapshot…',
    'report.doc.progress.photos': 'Processing photos…',
    'report.doc.progress.notes': 'Processing notes…',
    'report.doc.progress.page': 'Building report pages…',
    'report.doc.progress.pdf': 'Generating PDF…',
    'report.doc.progress.done': 'Complete',
    'note.clearHand': 'Clear', 'note.save': 'Save', 'note.delete': 'Delete', 'note.cancel': 'Cancel',
    'note.deleteConfirm': 'Delete note {n}?', 'note.deleted': 'Note deleted', 'note.deleteNone': 'No saved note to delete',
    'point.deleteConfirm': 'Delete point {n}?', 'point.deleted': 'Point deleted',
    'photo.deleteConfirm': 'Delete {name}?', 'photo.deleted': 'Photo deleted',
    'obj.deleteConfirm': 'Delete {name}?', 'obj.deleted': 'Item deleted',
    'photo.desc': 'Description', 'photo.voice': '🎤 Voice note', 'photo.noVoice': 'No voice recording',
    'photo.record': '🎤 Record', 'photo.play': '▶ Play', 'photo.delVoice': '🗑 Delete',
    'photo.centerMap': '🎯 Center', 'photo.save': '💾 Save', 'photo.delete': '🗑 Delete',
    'photo.micDenied': 'Microphone not allowed — try again',
    'photo.camRequired': 'Camera required for photos — tap Allow in the prompt',
    'photo.camDenied': 'Camera not allowed — try again',
    'photo.placeholder': 'Field observation…', 'photo.recording': 'Recording…',
    'photo.stopRecord': '⏹ Stop', 'photo.voiceDur': 'Voice note · {n} s',
    'gps.err.denied': 'Location permission off. Enable Location in settings, then reopen GPS.',
    'gps.err.weak': 'No GPS signal. Move outdoors or wait.',
    'gps.err.timeout': 'Location timeout — still searching…',
    'gps.err.unknown': 'GPS error: {msg}',
    'gps.err.needHttps': 'GPS requires HTTPS or localhost.',
    'gps.err.noApi': 'Geolocation not supported on this device',
    'gps.hint.acquire': 'Getting location… wait a few seconds.',
    'gps.hint.deniedHelp': 'Location permission required. Browser lock → Site settings → Location → Allow.',
    'gps.hint.waiting': 'Waiting for GPS — try outdoors',
    'gps.hint.agpsWeak': 'Weak GPS — refining position (AGPS); try open sky',
    'gps.hint.on': 'GPS on — locating', 'gps.hint.off': 'GPS stopped',
    'gps.hint.followOn': 'GPS and map follow enabled', 'gps.hint.noFix': 'No fix yet — wait',
    'gps.hint.openFirst': 'Turn on GPS first', 'gps.hint.centered': 'Centered on GPS',
    'gps.hint.liveOn': 'Live location on', 'gps.hint.pending': 'Waiting for location…',
    'autosave.err': 'Save error', 'autosave.failed': 'Save failed',
    'draw.widthLabel': 'Width',
    'draw.size': 'Size',
    'draw.widthWithVal': 'Width · {n}px',
    'draw.sizeWithVal': 'Size · {n}px',
    'draw.opacityWithVal': 'Opacity · {n}%',
    'project.untitled': 'Untitled journey',
    'project.namePrefix': 'Field Journey',
    'common.confirm': 'Confirm', 'common.cancel': 'Cancel',
    'ctx.pointLabel': 'Point #{n}',
    'photo.openCamera': '📷 Open camera', 'photo.fromGallery': '🖼 Choose from gallery', 'photo.cancelSheet': 'Cancel',
    'photo.voiceSheetLabel': 'Voice field note', 'photo.voiceSheetHint': 'Optional voice note after capture.',
    'photo.voiceSheetRecord': '🎤 Record voice note', 'photo.skip': 'Skip', 'photo.done': 'Done',
    'photo.recordingLive': '🔴 Recording…', 'photo.stopRecordLong': '⏹ Stop recording',
    'photo.voiceReady': '✓ Voice note · {n} s', 'photo.noVoiceTap': 'No recording — tap to record',
    'photo.micRequired': 'Microphone required for voice notes — tap Allow in the prompt',
    'photo.micUnsupported': 'Voice recording is not supported on this device',
    'photo.micPrompt': 'Allow microphone access for voice notes',
    'photo.ready': 'Photo ready',
    'slope.leg0': '0–5° flat', 'slope.leg1': '5–10°', 'slope.leg2': '10–15°', 'slope.leg3': '15–20°',
    'slope.leg4': '20–30°', 'slope.leg5': '30°+ steep',
    'hint.slopeAfterCircle': 'Circle drawn — computing slope…',
    'onboard.badge': 'Quick tour',
    'onboard.welcome.title': 'Welcome to PlanAI Field',
    'onboard.welcome.body': 'Learn the field workflow step by step. We will highlight each icon on screen.',
    'onboard.s1.title': '1 · Create a journey',
    'onboard.s1.body': 'Use Journeys at the bottom to create a new journey or open a recent one. All field data is saved to the journey.',
    'onboard.s2.title': '2 · Import data',
    'onboard.s2.body': 'Import KML, KMZ, GML, GeoJSON, SHP, GeoTIFF or DXF via Import. Files shared from WhatsApp or Drive can be opened too.',
    'onboard.s3.title': '3 · Info tool',
    'onboard.s3.body': 'Tap imported KML, KMZ or GML features with the Info tool — attributes and measures appear in the right panel.',
    'onboard.s4.title': '4 · Search location',
    'onboard.s4.body': 'Use Search location in the top bar to find a place name; the map pans to that area.',
    'onboard.s5.title': '5 · GPS & route',
    'onboard.s5.body': 'Start GPS and follow your position. Use ▶ Route to record your inspection path; tracks appear in the GPS layer.',
    'onboard.s6.title': '6 · Photo & voice',
    'onboard.s6.body': 'Capture field photos. Add a description and optional voice note; each photo is pinned on the map.',
    'onboard.s7.title': '7 · Field notes',
    'onboard.s7.body': 'Pin text or handwriting notes on the map. Use the microphone to dictate into text.',
    'onboard.s8.title': '8 · Basemap',
    'onboard.s8.body': 'Tap the satellite icon to switch between satellite, OSM map and topography.',
    'onboard.s9.title': '9 · Finger & pen',
    'onboard.s9.body': '👆 Finger mode: pan the map and tap to mark. ✏️ Pen mode: draw with stylus; pan with finger.',
    'onboard.s10.title': '10 · Distance',
    'onboard.s10.body': 'Use the polyline tool on the left toolbar — tap corners to measure distance. Finish with Enter or double-tap.',
    'onboard.s11.title': '11 · Area',
    'onboard.s11.body': 'Use the polygon tool to draw boundaries and measure area.',
    'onboard.s12.title': '12 · Slope analysis',
    'onboard.s12.body': 'Use the slope tool to mark an inspection circle; slope is computed automatically and can be saved to reports.',
    'onboard.s13.title': '13 · Layers',
    'onboard.s13.body': 'Manage notes, photos, GPS tracks and imports in the Layers section of the right panel.',
    'onboard.s14.title': '14 · Color & width',
    'onboard.s14.body': 'Set draw color and stroke width in the right panel. Select a line or polygon to edit it there too.',
    'onboard.s15.title': '15 · Spatial Storytelling',
    'onboard.s15.body': 'From Journeys, create a PDF field summary or spatial inspection playback — share via WhatsApp, Mail or Drive.',
    'offline.badge': 'Offline',
    'offline.tilesCached': 'Using cached map tiles',
    'onboard.start': 'Start tour',
    'onboard.next': 'Next',
    'onboard.prev': 'Back',
    'onboard.skip': 'Skip',
    'onboard.done': 'Done',
    'onboard.stepOf': '{n} / {t}',
    'onboard.finished': 'Tour complete — happy mapping!',
    'onboard.replay': 'Show quick tour again',
  },
};
const FIELD_HINT_KEYS = {
  select: 'hint.select', info: 'hint.info', polyline: 'hint.polyline',
  polygon: 'hint.polygon', circle: 'hint.circle', 'field-note': 'hint.fieldNote',
};
const FIELD_TOOLBAR_I18N = [
  { sel: '.field-main-tool[data-tool="select"]', tt: 'tt.select' },
  { sel: '.field-main-tool[data-tool="info"]', title: 'tool.info', tt: 'tt.info' },
  { sel: '.field-main-tool[data-tool="polyline"]', title: 'tool.line', tt: 'tt.polyline' },
  { sel: '.field-main-tool[data-tool="polygon"]', title: 'tool.polygon', tt: 'tt.polygon' },
  { sel: '.field-main-tool[data-tool="circle"]', title: 'tool.circle', tt: 'tt.circle' },
  { sel: '#btn-field-note-tool', title: 'tool.field-note', tt: 'tt.note' },
  { sel: '#btn-field-photo-tool', title: 'ctx.photo', tt: 'tt.photo' },
  { sel: '#btn-field-layers', title: 'layer.section', tt: 'tt.layers' },
  { sel: '#btn-undo', tt: 'tt.undo' },
  { sel: '#btn-delete', tt: 'tt.delete' },
];
const FIELD_PANEL_TOOL_KEYS = {
  select: 'tool.select', info: 'tool.info', polyline: 'tool.line',
  polygon: 'tool.polygon', circle: 'tool.circle', text: 'tool.text', eraser: 'tool.eraser',
  freedraw: 'tool.freedraw', 'field-note': 'tool.field-note',
};
function t(key, vars) {
  let s = (PA_I18N[PA_LANG] && PA_I18N[PA_LANG][key]) || (PA_I18N.en[key]) || key;
  if (vars) Object.keys(vars).forEach(k => { s = s.replace('{' + k + '}', String(vars[k])); });
  return s;
}

function tLang(lang, key, vars) {
  const L = lang === 'tr' ? 'tr' : 'en';
  let s = (PA_I18N[L] && PA_I18N[L][key]) || (PA_I18N.en[key]) || key;
  if (vars) Object.keys(vars).forEach(k => { s = s.replace('{' + k + '}', String(vars[k])); });
  return s;
}

function resolveReportLang(data) {
  const lang = data?.meta?.lang || data?.lang || PA_LANG;
  return lang === 'tr' ? 'tr' : 'en';
}

const PROJECT_UNTITLED_NAMES = new Set(['Adsız Gezi', 'Adsız Proje', 'Untitled journey', 'Untitled project', 'Untitled Project']);
const PROJECT_NAME_PREFIX_RE = /^(?:Saha(?:\s+Yolculuğu)?|Gezi(?:ler)?|Proje(?:ler)?|Journey(?:s)?|Project|Field(?:\s+Journey)?)\s+(.+)$/i;

function formatProjectDefaultDate(d) {
  const date = d || new Date();
  const loc = PA_LANG === 'tr' ? 'tr-TR' : 'en-GB';
  return date.toLocaleDateString(loc);
}

function defaultProjectName(d) {
  return t('project.namePrefix') + ' ' + formatProjectDefaultDate(d);
}

function projectDisplayName(name) {
  if (!name || PROJECT_UNTITLED_NAMES.has(name)) return t('project.untitled');
  const m = String(name).match(PROJECT_NAME_PREFIX_RE);
  if (m) return t('project.namePrefix') + ' ' + m[1];
  return name;
}

function setFieldStrokeWidthLabel(el, val, isPoint) {
  if (!el) return;
  el.textContent = t(isPoint ? 'draw.sizeWithVal' : 'draw.widthWithVal', { n: isPoint ? Math.round(+val) : val });
}

function setFieldOpacityLabel(el, pct) {
  if (!el) return;
  el.textContent = t('draw.opacityWithVal', { n: pct });
}

function syncFieldStrokeWidthPickers(val, isPoint) {
  if (val == null || isNaN(+val)) return;
  const v = +val;
  ['field-draw-sw', 'field-ctx-sw'].forEach((id, i) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (isPoint) {
      el.min = 4; el.max = 32; el.step = 1;
    } else {
      el.min = 0.5; el.max = 24; el.step = 0.5;
    }
    el.value = v;
    const labelId = id === 'field-draw-sw' ? 'field-draw-sw-label' : 'field-ctx-sw-label';
    setFieldStrokeWidthLabel(document.getElementById(labelId), v, isPoint);
  });
}

function syncFieldOpacityPickers(opacity) {
  if (opacity == null || isNaN(+opacity)) return;
  const v = +opacity;
  ['field-draw-op', 'field-ctx-op'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = v;
  });
  const pct = Math.round(v * 100);
  setFieldOpacityLabel(document.getElementById('field-draw-op-label'), pct);
  setFieldOpacityLabel(document.getElementById('field-ctx-op-label'), pct);
}

function selectedFieldDrawObjects() {
  return S.selectedIds
    .map(id => S.objects.find(o => o.id === id))
    .filter(isFieldCtxDrawObject);
}

function applyFieldStrokeStyle(swVal, opVal, opts) {
  const silent = opts?.silent;
  const fromCtx = opts?.fromCtx;
  const selObj = S.selectedIds[0] ? S.objects.find(o => o.id === S.selectedIds[0]) : null;
  const isPoint = opts?.isPoint ?? (selObj?.type === 'point' || S.tool === 'point');

  if (swVal != null && !isNaN(+swVal)) {
    S.strokeWidth = +swVal;
    syncFieldStrokeWidthPickers(+swVal, isPoint);
  }
  if (opVal != null && !isNaN(+opVal)) {
    S.opacity = +opVal;
    syncFieldOpacityPickers(+opVal);
  }

  const sw = swVal != null && !isNaN(+swVal) ? +swVal : S.strokeWidth;
  const op = opVal != null && !isNaN(+opVal) ? +opVal : S.opacity;

  if (S.activeId) {
    const active = S.objects.find(o => o.id === S.activeId);
    if (active && isFieldCtxDrawObject(active)) applyFieldStyleToObject(active, sw, op);
  }

  selectedFieldDrawObjects().forEach(obj => applyFieldStyleToObject(obj, sw, op));
  syncFieldDrawSettingsUi();

  scheduleRender();
  if (!silent) scheduleProjectSave();
}

function refreshFieldDrawPanelLabels() {
  syncFieldDrawSettingsUi();
  const opEl = document.getElementById('field-draw-op');
  const opPct = opEl ? Math.round(+opEl.value * 100) : Math.round(S.opacity * 100);
  setFieldOpacityLabel(document.getElementById('field-draw-op-label'), opPct);
  const sel = S.selectedIds[0] ? S.objects.find(o => o.id === S.selectedIds[0]) : null;
  if (sel && isFieldCtxDrawObject(sel)) fillFieldObjectPanel(sel);
}
function layerI18nName(layer) {
  if (!layer) return '';
  const idMap = { sketch: 'layer.sketch', points: 'layer.points', imported: 'layer.imported', photos: 'layer.photos', notes: 'layer.notes', gps: 'layer.gps' };
  if (idMap[layer.id]) return t(idMap[layer.id]);
  return layer.name;
}
function gpsStatusLabel(status) {
  return t('gps.' + (status || 'off')) || status;
}
function computeImportMeasurement(obj) {
  if (!obj) return '';
  if (obj.type === 'import_polygon' && obj.rings?.[0]?.length >= 3) {
    const ring = obj.rings[0];
    let perim = 0;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      perim += haversineM(a.lat, a.lon, b.lat, b.lon);
    }
    return formatAreaReport(polygonAreaM2FromRing(ring)) + ' · ' + formatLengthReport(perim);
  }
  if (obj.type === 'import_polyline' && obj.vertices?.length >= 2) {
    let d = 0;
    for (let i = 1; i < obj.vertices.length; i++) {
      d += haversineM(obj.vertices[i - 1].lat, obj.vertices[i - 1].lon, obj.vertices[i].lat, obj.vertices[i].lon);
    }
    return formatLengthReport(d);
  }
  return '';
}
function applyFieldToolbarI18n() {
  if (!FIELD_MODE) return;
  document.querySelectorAll('.tool-group-label.field-only').forEach(el => {
    if (!el.dataset.i18n) el.dataset.i18n = 'group.field';
    el.textContent = t('group.field');
  });
  FIELD_TOOLBAR_I18N.forEach(({ sel, title, tt }) => {
    const el = document.querySelector(sel);
    if (!el) return;
    if (title) el.title = t(title);
    const tip = el.querySelector('.tooltip');
    if (tip && tt) tip.innerHTML = t(tt);
  });
  const langSw = document.getElementById('field-lang-switch');
  if (langSw) langSw.title = t('lang.title');
  const gpsPill = document.getElementById('gps-status-pill');
  if (gpsPill && !_fieldGpsOn) gpsPill.title = t('gps.pill');
}

function applyFieldPanelsI18n() {
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    const k = el.getAttribute('data-i18n-aria');
    if (k) el.setAttribute('aria-label', t(k));
  });
  const voiceSt = document.getElementById('field-voice-status');
  if (voiceSt && !voiceSt.dataset.hasVoice) voiceSt.textContent = t('photo.noVoice');
}

function applyFieldI18n() {
  document.documentElement.classList.toggle('lang-en', PA_LANG === 'en');
  document.documentElement.classList.toggle('lang-tr', PA_LANG === 'tr');
  applyFieldToolbarI18n();
  applyFieldPanelsI18n();
  mountSlopeAnalysisIcons();
  updateSlopeSaveButtonUi();
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.getAttribute('data-i18n');
    if (k) el.textContent = t(k);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const k = el.getAttribute('data-i18n-placeholder');
    if (k) el.placeholder = t(k);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const k = el.getAttribute('data-i18n-title');
    if (k) el.title = t(k);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    const k = el.getAttribute('data-i18n-aria');
    if (k) el.setAttribute('aria-label', t(k));
  });
  const pt = document.querySelector('#right-panel .panel-title');
  if (pt) pt.textContent = t('panel.title');
  updateFieldOfflineUi();
  const projLbl = document.getElementById('field-ctx-project-label');
  if (projLbl) projLbl.textContent = t('panel.project');
  const modeLbl = document.getElementById('field-mode-label');
  if (modeLbl) modeLbl.textContent = FIELD_INTERACTION === 'pen' ? t('mode.pen') : t('mode.finger');
  const modeChip = document.getElementById('field-mode-chip');
  if (modeChip) modeChip.title = t('mode.chipTitle');
  updateProjectTitleUi();
  const pHead = document.getElementById('project-panel-head');
  if (pHead) pHead.textContent = t('project.head');
  document.querySelectorAll('.field-dock-label[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
  const searchBtn = document.querySelector('#loc-search button');
  if (searchBtn) searchBtn.textContent = t('search.btn');
  const saveInd = document.getElementById('project-save-indicator');
  if (saveInd && saveInd.classList.contains('autosave-idle')) {
    const longEl = saveInd.querySelector('.autosave-long');
    if (longEl) longEl.textContent = t('autosave.idle');
    else saveInd.textContent = t('autosave.idle');
    saveInd.title = t('autosave.idle');
  }
  updateActiveToolPanelLabels(S.tool);
  updateGpsHud();
  updateGpsTrackHud();
  updateBasemapDockUi();
  buildLayerPanel();
  updateProjectTitleUi();
  refreshFieldDrawPanelLabels();
  updateFieldJourneyHubI18n();
  if (_slopeState.stats) renderSlopeStatsPanel(_slopeState.stats);
  refreshSlopeLegends();
  if (_fieldInfoObjId) {
    const obj = S.objects.find(o => o.id === _fieldInfoObjId);
    if (obj && isImportInspectable(obj)) showFeatureInfoPanel(obj);
  }
}
function setAppLanguage(lang) {
  PA_LANG = lang === 'en' ? 'en' : 'tr';
  document.documentElement.lang = PA_LANG;
  document.getElementById('btn-lang-tr')?.classList.toggle('active', PA_LANG === 'tr');
  document.getElementById('btn-lang-en')?.classList.toggle('active', PA_LANG === 'en');
  document.getElementById('btn-hub-lang-tr')?.classList.toggle('active', PA_LANG === 'tr');
  document.getElementById('btn-hub-lang-en')?.classList.toggle('active', PA_LANG === 'en');
  applyFieldI18n();
  scheduleRender();
}

// ═══ Feature attributes (import inspection) ════════════════════
const FEATURE_ATTR_ALIASES = {
  landUse: ['KULLANIM', 'LAND_USE', 'LANDUSE', 'kullanim', 'land_use', 'usage', 'class', 'CLASS', 'Nitelik', 'TurizmTip', 'AcikYesilTip', 'KonutTip'],
  plan: ['PLAN_KARARI', 'PLAN_KARAR', 'plan_karari', 'PLAN_DECISION', 'planDecision', 'PlanAdi', 'Pin', 'GosterimKodu', 'GosterimDetayKodu'],
  far: ['EMSAL', 'FAR', 'emsal', 'EmsalKaks', 'Emsal', 'KAKS', 'floor_area_ratio', 'FAR_RATIO', 'Taks'],
  height: ['YUKSEKLIK', 'YUKSEKLİK', 'HEIGHT', 'yukseklik', 'YapiYuksekligi', 'KatAdedi', 'max_height', 'MAX_HEIGHT', 'kat', 'KAT'],
  type: ['TYPE', 'TUR', 'TÜR', 'type', 'featureType', 'FEAT_TYPE', 'TurizmTip', 'AcikYesilTip', 'YapiDuzeni'],
};

function kmlExtendedData(pm) {
  const attrs = {};
  pm.querySelectorAll('ExtendedData Data, ExtendedData SimpleData, SchemaData SimpleData').forEach(el => {
    const n = el.getAttribute('name') || el.getAttribute('id');
    if (n) attrs[n] = (el.textContent || '').trim();
  });
  return attrs;
}

function mergeImportMetadata(name, extra) {
  return { name: name || '', ...(extra || {}) };
}

function getObjectFeatureAttrs(obj) {
  if (!obj?.metadata) return {};
  const m = obj.metadata;
  const raw = m.attributes || m.attrs || m.properties || {};
  const out = (raw && typeof raw === 'object' && !Array.isArray(raw)) ? { ...raw } : {};
  if (m.planFeatureType && !out.PlanFeatureType) out.PlanFeatureType = m.planFeatureType;
  if (m.planLabel && !out.Adi && m.planLabel !== 'Plan') out.Adi = m.planLabel;
  if (m.name && !out.Adi) out.Adi = m.name;
  return out;
}

function planGmlAttrLabel(key) {
  if (PA_LANG === 'tr' && PLAN_GML_ATTR_LABELS[key]) return PLAN_GML_ATTR_LABELS[key];
  return key;
}

function pickAttr(attrs, keys) {
  const lower = {};
  Object.keys(attrs).forEach(k => { lower[k.toLowerCase()] = attrs[k]; });
  for (const k of keys) {
    if (attrs[k] != null && attrs[k] !== '') return String(attrs[k]);
    if (lower[k.toLowerCase()] != null && lower[k.toLowerCase()] !== '') return String(lower[k.toLowerCase()]);
  }
  return '';
}

function normalizeFeatureDisplay(obj) {
  const attrs = getObjectFeatureAttrs(obj);
  const title = pickAttr(attrs, ['name', 'NAME', 'ad', 'AD', 'Adi', 'PlanAdi']) || obj.metadata?.planLabel || obj.metadata?.name || t('info.title');
  const rows = [];
  const land = pickAttr(attrs, FEATURE_ATTR_ALIASES.landUse);
  const plan = pickAttr(attrs, FEATURE_ATTR_ALIASES.plan);
  const far = pickAttr(attrs, FEATURE_ATTR_ALIASES.far);
  const height = pickAttr(attrs, FEATURE_ATTR_ALIASES.height);
  const typ = pickAttr(attrs, FEATURE_ATTR_ALIASES.type);
  if (land) rows.push({ label: t('feat.landUse'), value: land });
  if (plan) rows.push({ label: t('feat.plan'), value: plan });
  if (far) rows.push({ label: t('feat.far'), value: far });
  if (height) rows.push({ label: t('feat.height'), value: height });
  if (typ) rows.push({ label: t('feat.type'), value: typ });
  const used = new Set([...FEATURE_ATTR_ALIASES.landUse, ...FEATURE_ATTR_ALIASES.plan,
    ...FEATURE_ATTR_ALIASES.far, ...FEATURE_ATTR_ALIASES.height, ...FEATURE_ATTR_ALIASES.type,
    'name', 'NAME', 'ad', 'AD', 'Adi', 'PlanAdi', 'PlanFeatureType'].map(x => x.toLowerCase()));
  Object.keys(attrs).forEach(k => {
    if (used.has(k.toLowerCase())) return;
    const v = attrs[k];
    if (v != null && String(v).trim()) rows.push({ label: planGmlAttrLabel(k), value: String(v) });
  });
  if (!rows.length && attrs.PlanFeatureType) {
    rows.push({ label: planGmlAttrLabel('PlanFeatureType'), value: String(attrs.PlanFeatureType) });
  }
  return { title, rows };
}

function isImportInspectable(obj) {
  return obj && (obj.type === 'import_polygon' || obj.type === 'import_polyline' ||
    obj.type === 'import_point' || obj.type === 'import_text');
}

let _fieldInfoObjId = null;

function hideFeatureInfoPanel() {
  _fieldInfoObjId = null;
  const feat = document.getElementById('field-right-feature');
  const rp = document.getElementById('right-panel');
  if (feat) feat.style.display = 'none';
  if (S.tool === 'info') {
    if (rp) rp.classList.remove('field-has-selection');
    const def = document.getElementById('field-right-default');
    if (def) def.style.display = 'block';
    updateFieldAnalysisActions(null);
  }
  scheduleRender();
}

function showFeatureInfoPanel(obj) {
  if (!FIELD_MODE || !obj) return;
  _fieldInfoObjId = obj.id;
  const rp = document.getElementById('right-panel');
  ['field-right-default', 'field-right-object', 'field-right-note', 'field-right-photo', 'field-right-slope']
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  const feat = document.getElementById('field-right-feature');
  if (feat) feat.style.display = 'block';
  if (rp) rp.classList.add('field-has-selection');
  const card = document.getElementById('field-feature-card');
  if (!card) return;
  const { title, rows } = normalizeFeatureDisplay(obj);
  const meas = computeImportMeasurement(obj);
  let html = '<h3>' + escapeHtml(title) + '</h3>';
  if (meas) html += '<p style="font-size:12px;font-weight:700;color:#1a3358;margin:0 0 8px">' + escapeHtml(t('info.measure')) + ': ' + escapeHtml(meas) + '</p>';
  if (!rows.length) html += '<p style="font-size:13px;color:#6a7a8a;margin:0">' + escapeHtml(t('info.noAttrs')) + '</p>';
  else {
    html += '<dl>';
    rows.forEach(r => {
      html += '<div class="field-feature-row"><dt>' + escapeHtml(r.label) + '</dt><dd>' + escapeHtml(r.value) + '</dd></div>';
    });
    html += '</dl>';
  }
  card.innerHTML = html;
  const guideBtn = document.getElementById('btn-feature-guide');
  if (guideBtn) guideBtn.style.display = resolveObjectGuidanceLatLon(obj) ? 'block' : 'none';
  S.selectedIds = [];
  setDeleteButtonVisible(false);
  scheduleRender();
}

function fieldInfoToolPick(wp) {
  for (let i = S.objects.length - 1; i >= 0; i--) {
    const o = S.objects[i];
    if (!isImportInspectable(o)) continue;
    const p = unrotateForHit(o, wp.x, wp.y);
    if (hitTest(o, p.x, p.y)) {
      showFeatureInfoPanel(o);
      return;
    }
  }
  hideFeatureInfoPanel();
  showHint(t('info.noPick'));
}

function closeFeatureInfoAndSelect() {
  hideFeatureInfoPanel();
  setTool('select');
}

const SLOPE_ANALYSIS_ICON_SVG =
  '<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">' +
  '<path d="M9 7v32h32" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M9 7 41 39" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>' +
  '<g stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
  '<line x1="13" y1="39" x2="13" y2="35"/><line x1="17" y1="39" x2="17" y2="35"/>' +
  '<line x1="21" y1="39" x2="21" y2="35"/><line x1="25" y1="39" x2="25" y2="35"/>' +
  '<line x1="29" y1="39" x2="29" y2="35"/><line x1="33" y1="39" x2="33" y2="35"/><line x1="37" y1="39" x2="37" y2="35"/>' +
  '</g>' +
  '<circle cx="21" cy="25" r="5.5" stroke="currentColor" stroke-width="2.8"/>' +
  '<path d="M13 17 19 23" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>' +
  '<path d="M17 19 19 23 21 21" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M25 29 31 35" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/>' +
  '<path d="M29 31 31 35 33 33" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>' +
  '</svg>';

function mountSlopeAnalysisIcons() {
  document.querySelectorAll('.slope-analysis-icon').forEach(el => {
    el.innerHTML = SLOPE_ANALYSIS_ICON_SVG;
  });
  const btn = document.getElementById('btn-run-slope');
  if (btn) btn.title = t('analysis.slope');
}

function updateFieldAnalysisActions(obj) {
  const box = document.getElementById('field-analysis-actions');
  if (!box) return;
  const ok = obj && (obj.type === 'polygon' || obj.type === 'circle' || obj.type === 'import_polygon');
  const toolOk = S.tool === 'select' || S.tool === 'circle' || S.tool === 'polygon';
  box.style.display = toolOk ? 'block' : 'none';
  updateFieldCircleGuide(S.tool === 'circle' && !ok);
  const btn = document.getElementById('btn-run-slope');
  if (btn) btn.disabled = !ok;
}

// ═══ Local slope (Terrarium DEM — same math as PlanAI slopedem) ═
const _demTileCache = {};
const _slopeState = { active: false, objId: null, imageCanvas: null, worldBounds: null, clipWorld: null, stats: null };
let _slopeAnalysisReport = null;

const SLOPE_LEGEND_STOPS = [
  { key: 'slope.leg0', rgb: 'rgb(80,200,100)' },
  { key: 'slope.leg1', rgb: 'rgb(160,230,80)' },
  { key: 'slope.leg2', rgb: 'rgb(255,220,0)' },
  { key: 'slope.leg3', rgb: 'rgb(255,150,0)' },
  { key: 'slope.leg4', rgb: 'rgb(230,60,20)' },
  { key: 'slope.leg5', rgb: 'rgb(100,0,0)' },
];

function buildSlopeLegendHtml(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = SLOPE_LEGEND_STOPS.map(s =>
    '<div class="slope-leg-item"><span>' + escapeHtml(t(s.key)) + '</span>' +
    '<i class="slope-leg-swatch" style="background:' + s.rgb + '"></i></div>'
  ).join('');
}

function refreshSlopeLegends() {
  buildSlopeLegendHtml('field-slope-legend');
  buildSlopeLegendHtml('field-slope-legend-guide');
}

function updateFieldCircleGuide(show) {
  const guide = document.getElementById('field-circle-guide');
  if (guide) guide.style.display = show ? 'block' : 'none';
}

/** PlanAI v4 slopedem palette (Terrarium DEM → degrees) */
function slopeColorRgb(deg) {
  if (deg < 5) return [80, 200, 100];
  if (deg < 10) return [160, 230, 80];
  if (deg < 15) return [255, 220, 0];
  if (deg < 20) return [255, 150, 0];
  if (deg < 30) return [230, 60, 20];
  if (deg < 40) return [180, 20, 10];
  return [100, 0, 0];
}

/** Slope (°) and aspect from DEM — horizontal spacing in meters (not pixel index). */
function slopeDegAspectFromElevGrid(elevGrid, row, col, rows, cols, bb) {
  const lat = bb.maxLat - (row / Math.max(1, rows - 1)) * (bb.maxLat - bb.minLat);
  const dLatDeg = (bb.maxLat - bb.minLat) / Math.max(1, rows - 1);
  const dLonDeg = (bb.maxLon - bb.minLon) / Math.max(1, cols - 1);
  const dxM = dLonDeg * 111320 * Math.cos(lat * Math.PI / 180);
  const dyM = dLatDeg * 111320;
  const r1 = row > 0 ? row - 1 : row;
  const r2 = row < rows - 1 ? row + 1 : row;
  const c1 = col > 0 ? col - 1 : col;
  const c2 = col < cols - 1 ? col + 1 : col;
  const v = elevGrid[row * cols + col];
  const vx1 = elevGrid[row * cols + c1], vx2 = elevGrid[row * cols + c2];
  const vy1 = elevGrid[r1 * cols + col], vy2 = elevGrid[r2 * cols + col];
  if (v == null || isNaN(v) || [vx1, vx2, vy1, vy2].some(x => x == null || isNaN(x))) return { deg: NaN, aspect: NaN };
  const spanX = (c2 - c1) * dxM;
  const spanY = (r2 - r1) * dyM;
  const dzdx = spanX > 1e-6 ? (vx2 - vx1) / spanX : 0;
  const dzdy = spanY > 1e-6 ? (vy2 - vy1) / spanY : 0;
  const deg = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * 180 / Math.PI;
  const aspect = (Math.atan2(dzdy, dzdx) * 180 / Math.PI + 360) % 360;
  return { deg, aspect };
}

function slopeDegFromElevGrid(elevGrid, row, col, rows, cols, bb) {
  return slopeDegAspectFromElevGrid(elevGrid, row, col, rows, cols, bb).deg;
}

function formatSlopeStatValue(v, suffix) {
  return (v != null && isFinite(v)) ? (Number(v).toFixed(1) + suffix) : '—';
}

function buildSlopeAnalysisReportPayload() {
  if (!_slopeState.active || !_slopeState.stats || !_slopeState.imageCanvas) return null;
  const obj = S.objects.find(o => o.id === _slopeState.objId);
  return {
    objId: _slopeState.objId,
    objectType: obj?.type || '',
    stats: { ..._slopeState.stats },
    overlayDataUrl: _slopeState.imageCanvas.toDataURL('image/png'),
    worldBounds: _slopeState.worldBounds ? { ..._slopeState.worldBounds } : null,
    clipRing: obj ? analysisRegionLatLonRing(obj) : null,
    savedAt: new Date().toISOString(),
  };
}

function saveSlopeAnalysisForReport() {
  const payload = buildSlopeAnalysisReportPayload();
  if (!payload) {
    showHint(t('slope.nothingToSave'));
    return;
  }
  _slopeAnalysisReport = payload;
  scheduleProjectSave();
  updateSlopeSaveButtonUi();
  showHint(t('slope.saved'));
}

function updateSlopeSaveButtonUi() {
  const badge = document.getElementById('slope-saved-badge');
  const btn = document.getElementById('btn-save-slope');
  const saved = !!_slopeAnalysisReport;
  if (badge) {
    badge.textContent = saved ? t('slope.savedBadge') : '';
    badge.classList.toggle('visible', saved);
  }
  if (btn) btn.disabled = !_slopeState.active;
}

function buildReportSlopeSection(slopeReport, lang) {
  if (!slopeReport?.stats) return '';
  const st = slopeReport.stats;
  const L = lang || PA_LANG;
  const tr = L === 'tr';
  const title = tr ? 'Eğim Analizi' : 'Slope Analysis';
  const saved = slopeReport.savedAt ? formatReportDateTime(slopeReport.savedAt, L) : '—';
  const legend = SLOPE_LEGEND_STOPS.map(s =>
    '<div class="rpt-slope-leg"><span>' + escapeHtml(t(s.key)) + '</span>' +
    '<i style="background:' + s.rgb + '"></i></div>'
  ).join('');
  const overlay = slopeReport.overlayDataUrl
    ? '<img class="rpt-slope-map" src="' + slopeReport.overlayDataUrl + '" alt="Slope overlay"/>'
    : '';
  return `<section class="rpt-page">
  <h2>${title}</h2>
  <p class="rpt-meta">${tr ? 'Kayıt' : 'Saved'}: ${saved} · ${tr ? 'Alan' : 'Area'}: ${formatAreaReport(st.areaM2 || 0)}</p>
  <div class="rpt-summary">
    <div class="rpt-stat"><b>${st.minElev != null ? Math.round(st.minElev) + ' m' : '—'}</b><span>${tr ? 'Min. yükseklik' : 'Min elevation'}</span></div>
    <div class="rpt-stat"><b>${st.maxElev != null ? Math.round(st.maxElev) + ' m' : '—'}</b><span>${tr ? 'Maks. yükseklik' : 'Max elevation'}</span></div>
    <div class="rpt-stat"><b>${formatSlopeStatValue(st.avgSlope, '°')}</b><span>${tr ? 'Ort. eğim' : 'Avg slope'}</span></div>
    <div class="rpt-stat"><b>${formatSlopeStatValue(st.maxSlope, '°')}</b><span>${tr ? 'Maks. eğim' : 'Max slope'}</span></div>
    <div class="rpt-stat"><b>${escapeHtml(st.aspect || '—')}</b><span>${tr ? 'Baskın yön' : 'Aspect'}</span></div>
  </div>
  ${overlay}
  <div class="rpt-slope-legend-grid">${legend}</div>
  <p class="rpt-tech">DEM: Mapzen Terrarium · ${tr ? 'Renk skalası derece (°)' : 'Color scale in degrees (°)'}</p>
</section>`;
}

function terrariumElev(r, g, b) {
  return r * 256 + g + b / 256 - 32768;
}

function latLonToTileXY(lat, lon, z) {
  const n = Math.pow(2, z);
  const x = Math.floor((lon + 180) / 360 * n);
  const latRad = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

function terrariumElevFromImage(img) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const cx = c.getContext('2d');
  cx.drawImage(img, 0, 0);
  const px = cx.getImageData(0, 0, 256, 256).data;
  const elev = new Float32Array(256 * 256);
  for (let i = 0; i < 256 * 256; i++) {
    elev[i] = terrariumElev(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
  }
  return elev;
}

function fetchTerrariumElevTile(z, tx, ty) {
  const key = z + '/' + tx + '/' + ty;
  if (_demTileCache[key]) return _demTileCache[key];
  _demTileCache[key] = (async () => {
    try {
      const db = await openProjectDb();
      const row = await idbGet(db, 'dem_tiles', key);
      if (row?.buffer) return new Float32Array(row.buffer);
    } catch (_) {}
    if (!navigator.onLine) return null;
    if (typeof SpatialSecurity !== 'undefined') await SpatialSecurity.acquireDemSlot();
    let elev = null;
    try {
      const url = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/' + z + '/' + tx + '/' + ty + '.png';
      elev = await new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try { resolve(terrariumElevFromImage(img)); } catch (_) { resolve(null); }
        };
        img.onerror = () => resolve(null);
        img.src = url;
      });
    } finally {
      if (typeof SpatialSecurity !== 'undefined') SpatialSecurity.releaseDemSlot();
    }
    if (elev) {
      try {
        const db = await openProjectDb();
        await idbPut(db, 'dem_tiles', { key, buffer: elev.buffer, savedAt: Date.now() });
        pruneIdbStore(db, 'dem_tiles', DEM_TILE_CACHE_MAX, 'savedAt');
      } catch (_) {}
    }
    return elev;
  })();
  if (typeof SpatialSecurity !== 'undefined') {
    SpatialSecurity.pruneMemoryCache(_demTileCache, DEM_TILE_CACHE_MAX);
  }
  return _demTileCache[key];
}

function elevAtTilePixel(elevTiles, z, tileX, tileY, px, py) {
  const tile = elevTiles[z + '/' + tileX + '/' + tileY];
  if (!tile) return null;
  const x = Math.min(255, Math.max(0, px));
  const y = Math.min(255, Math.max(0, py));
  return tile[y * 256 + x];
}

function sampleElevAtLatLon(elevTiles, z, lat, lon) {
  const n = Math.pow(2, z);
  const x = (lon + 180) / 360 * n;
  const latRad = lat * Math.PI / 180;
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
  const tx = Math.floor(x), ty = Math.floor(y);
  const lx = (x - tx) * 256, ly = (y - ty) * 256;
  const x1 = Math.floor(lx), y1 = Math.floor(ly);
  const x2 = x1 + 1, y2 = y1 + 1;
  const fx = lx - x1, fy = ly - y1;
  const pick = (tox, toy, px, py) => elevAtTilePixel(elevTiles, z, tox, toy, px, py);
  const e00 = pick(tx, ty, x1, y1);
  const e10 = x2 < 256 ? pick(tx, ty, x2, y1) : pick(tx + 1, ty, 0, y1);
  const e01 = y2 < 256 ? pick(tx, ty, x1, y2) : pick(tx, ty + 1, x1, 0);
  const e11 = (x2 < 256 && y2 < 256) ? pick(tx, ty, x2, y2)
    : (x2 < 256) ? pick(tx, ty + 1, x2, 0)
    : (y2 < 256) ? pick(tx + 1, ty, 0, y2)
    : pick(tx + 1, ty + 1, 0, 0);
  const corners = [e00, e10, e01, e11].filter(v => v != null && isFinite(v));
  if (!corners.length) return null;
  if (corners.length < 4) return corners.reduce((a, b) => a + b, 0) / corners.length;
  return e00 * (1 - fx) * (1 - fy) + e10 * fx * (1 - fy) + e01 * (1 - fx) * fy + e11 * fx * fy;
}

function analysisRegionLatLonRing(obj) {
  if (!obj) return null;
  if (obj.type === 'import_polygon' && obj.rings?.[0]?.length >= 3) {
    return obj.rings[0].map(c => ({ lat: c.lat, lon: c.lon }));
  }
  if (obj.type === 'polygon' && obj.points?.length >= 6) {
    const ring = [];
    for (let i = 0; i < obj.points.length; i += 2) {
      const g = worldToLatLon(obj.points[i], obj.points[i + 1]);
      ring.push({ lat: g.lat, lon: g.lon });
    }
    return ring;
  }
  if (obj.type === 'circle' && obj.cx != null) {
    const ring = [];
    const n = 48;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const g = worldToLatLon(obj.cx + Math.cos(a) * obj.r, obj.cy + Math.sin(a) * obj.r);
      ring.push({ lat: g.lat, lon: g.lon });
    }
    return ring;
  }
  return null;
}

function ringToWorldClip(ring) {
  return ring.map(c => latLonToWorld(c.lat, c.lon));
}

function bboxFromLatLonRing(ring) {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  ring.forEach(c => {
    minLat = Math.min(minLat, c.lat); maxLat = Math.max(maxLat, c.lat);
    minLon = Math.min(minLon, c.lon); maxLon = Math.max(maxLon, c.lon);
  });
  return { minLat, maxLat, minLon, maxLon };
}

function pointInLatLonRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].lat, xi = ring[i].lon, yj = ring[j].lat, xj = ring[j].lon;
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

function aspectLabel(deg) {
  const d = ((deg % 360) + 360) % 360;
  const names = PA_LANG === 'tr'
    ? ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB']
    : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round(d / 45) % 8];
}

async function runLocalSlopeAnalysis(obj) {
  const ring = analysisRegionLatLonRing(obj);
  if (!ring || ring.length < 3) {
    showHint(t('slope.needArea'));
    return;
  }
  showHint(t('slope.running'));
  const bb = bboxFromLatLonRing(ring);
  const span = Math.max(bb.maxLat - bb.minLat, bb.maxLon - bb.minLon);
  let z = 14;
  if (span > 0.08) z = 11;
  else if (span > 0.025) z = 12;
  else if (span > 0.008) z = 13;
  const tl = latLonToTileXY(bb.maxLat, bb.minLon, z);
  const br = latLonToTileXY(bb.minLat, bb.maxLon, z);
  const tiles = [];
  for (let tx = tl.x; tx <= br.x; tx++) {
    for (let ty = tl.y; ty <= br.y; ty++) {
      tiles.push([z, tx, ty]);
      if (tiles.length > 20) break;
    }
    if (tiles.length > 20) break;
  }
  const elevTiles = {};
  for (const [tz, tx, ty] of tiles) {
    const elev = await fetchTerrariumElevTile(tz, tx, ty);
    elevTiles[tz + '/' + tx + '/' + ty] = elev;
  }
  const cols = 144, rows = 144;
  const wTL = latLonToWorld(bb.maxLat, bb.minLon);
  const wBR = latLonToWorld(bb.minLat, bb.maxLon);
  const worldBounds = { minX: wTL.x, minY: wTL.y, maxX: wBR.x, maxY: wBR.y, w: wBR.x - wTL.x, h: wBR.y - wTL.y };
  const cv = document.createElement('canvas');
  cv.width = cols; cv.height = rows;
  const cx = cv.getContext('2d');
  const img = cx.createImageData(cols, rows);
  let minElev = Infinity, maxElev = -Infinity, sumSlope = 0, maxSlope = 0, nSlope = 0;
  const aspectBins = new Array(8).fill(0);
  const elevGrid = new Float32Array(cols * rows);
  elevGrid.fill(NaN);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const lat = bb.maxLat - (row / (rows - 1)) * (bb.maxLat - bb.minLat);
      const lon = bb.minLon + (col / (cols - 1)) * (bb.maxLon - bb.minLon);
      const e0 = sampleElevAtLatLon(elevTiles, z, lat, lon);
      if (e0 != null) elevGrid[row * cols + col] = e0;
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const lat = bb.maxLat - (row / (rows - 1)) * (bb.maxLat - bb.minLat);
      const lon = bb.minLon + (col / (cols - 1)) * (bb.maxLon - bb.minLon);
      const idx = (row * cols + col) * 4;
      if (!pointInLatLonRing(lat, lon, ring)) {
        img.data[idx + 3] = 0;
        continue;
      }
      const e0 = elevGrid[row * cols + col];
      if (e0 == null || isNaN(e0)) { img.data[idx + 3] = 0; continue; }
      minElev = Math.min(minElev, e0);
      maxElev = Math.max(maxElev, e0);
      const { deg, aspect: asp } = slopeDegAspectFromElevGrid(elevGrid, row, col, rows, cols, bb);
      if (!isFinite(deg)) { img.data[idx + 3] = 0; continue; }
      const rgb = slopeColorRgb(deg);
      img.data[idx] = rgb[0]; img.data[idx + 1] = rgb[1]; img.data[idx + 2] = rgb[2];
      img.data[idx + 3] = 255;
      sumSlope += deg; maxSlope = Math.max(maxSlope, deg); nSlope++;
      if (isFinite(asp)) aspectBins[Math.round(asp / 45) % 8]++;
    }
  }
  cx.putImageData(img, 0, 0);
  let domAspect = 0;
  aspectBins.forEach((v, i) => { if (v > aspectBins[domAspect]) domAspect = i; });
  const areaM2 = polygonAreaM2FromRing(ring);
  const stats = {
    minElev: isFinite(minElev) ? minElev : null,
    maxElev: isFinite(maxElev) ? maxElev : null,
    avgSlope: nSlope ? sumSlope / nSlope : null,
    maxSlope: nSlope ? maxSlope : null,
    aspect: aspectLabel(domAspect * 45),
    areaM2,
  };
  _slopeState.active = true;
  _slopeState.objId = obj.id;
  _slopeState.imageCanvas = cv;
  _slopeState.worldBounds = worldBounds;
  _slopeState.clipWorld = ringToWorldClip(ring);
  _slopeState.stats = stats;
  showSlopeResultsPanel(stats);
  updateSlopeSaveButtonUi();
  scheduleRender();
  scheduleProjectSave();
}

function polygonAreaM2FromRing(ring) {
  if (ring.length < 3) return 0;
  const pts = ring.map(c => latLonToWorld(c.lat, c.lon));
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const j = (i + 1) % n;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  const m2 = Math.abs(a) * pxToMeters(1) * pxToMeters(1);
  return m2;
}

function runLocalSlopeOnSelection() {
  const obj = S.objects.find(o => o.id === S.selectedIds[0]);
  if (!obj) { showHint(t('slope.needArea')); return; }
  runLocalSlopeAnalysis(obj);
}

function clearLocalSlopeAnalysis(removeRegion) {
  const objId = _slopeState.objId;
  _slopeState.active = false;
  _slopeState.objId = null;
  _slopeState.imageCanvas = null;
  _slopeState.worldBounds = null;
  _slopeState.clipWorld = null;
  _slopeState.stats = null;

  if (removeRegion && objId) {
    S.objects = S.objects.filter(o => o.id !== objId);
    S.selectedIds = S.selectedIds.filter(id => id !== objId);
    if (S.activeId === objId) {
      S.activeId = null;
      S.drawing = false;
    }
    hideMeasLabel();
    pushHistory();
  }

  const slopeP = document.getElementById('field-right-slope');
  if (slopeP) slopeP.style.display = 'none';
  updateSlopeSaveButtonUi();

  if (removeRegion) {
    updateFieldRightPanel(null);
    updateFieldAnalysisActions(null);
    const def = document.getElementById('field-right-default');
    if (def) def.style.display = 'block';
  }

  scheduleRender();
  if (removeRegion) scheduleProjectSave();
}

function showSlopeResultsPanel(stats) {
  ['field-right-default', 'field-right-object', 'field-right-note', 'field-right-photo', 'field-right-feature']
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
  const sp = document.getElementById('field-right-slope');
  if (sp) sp.style.display = 'block';
  renderSlopeStatsPanel(stats);
  refreshSlopeLegends();
  updateSlopeSaveButtonUi();
}

function renderSlopeStatsPanel(stats) {
  const el = document.getElementById('field-slope-stats');
  if (!el || !stats) return;
  el.innerHTML =
    '<b>' + escapeHtml(t('slope.title')) + '</b>' +
    t('slope.minElev') + ': ' + (stats.minElev != null ? Math.round(stats.minElev) + ' m' : '—') + '<br>' +
    t('slope.maxElev') + ': ' + (stats.maxElev != null ? Math.round(stats.maxElev) + ' m' : '—') + '<br>' +
    t('slope.avgSlope') + ': ' + formatSlopeStatValue(stats.avgSlope, '°') + '<br>' +
    t('slope.maxSlope') + ': ' + formatSlopeStatValue(stats.maxSlope, '°') + '<br>' +
    t('slope.aspect') + ': ' + escapeHtml(stats.aspect || '—') + '<br>' +
    t('slope.area') + ': ' + formatAreaReport(stats.areaM2 || 0);
}

function renderSlopeOverlay() {
  if (!_slopeState.active || !_slopeState.imageCanvas || !_slopeState.clipWorld?.length) return;
  const b = _slopeState.worldBounds;
  ctx.save();
  ctx.beginPath();
  const clip = _slopeState.clipWorld;
  ctx.moveTo(clip[0].x, clip[0].y);
  for (let i = 1; i < clip.length; i++) ctx.lineTo(clip[i].x, clip[i].y);
  ctx.closePath();
  ctx.clip();
  ctx.globalAlpha = 0.72;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(_slopeState.imageCanvas, b.minX, b.minY, b.w, b.h);
  ctx.restore();
}

// ═══ GPS track recording + smart motion ═══════════════════════
let _gpsTrack = { state: 'idle', points: [], startTs: null, pausedAt: null, pauseMs: 0, objId: null };

function gpsLerpLatLon(a, b, t) {
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

function gpsLerpHeading(from, to, t) {
  if (from == null || isNaN(from)) return to;
  if (to == null || isNaN(to)) return from;
  let d = ((to - from + 540) % 360) - 180;
  return (from + d * t + 360) % 360;
}

function gpsBearingFromPoints(a, b) {
  const lat1 = a.lat * Math.PI / 180, lat2 = b.lat * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function gpsHudTargetBearingArrow(deg) {
  if (deg == null || isNaN(deg)) return '—';
  const d = ((Math.round(deg) % 360) + 360) % 360;
  const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
  return arrows[Math.round(d / 45) % 8] + ' ' + d + '°';
}

function gpsSmoothGuidanceBearing(deg) {
  if (deg == null || isNaN(deg)) return _gpsGuidanceBearingSmooth;
  const target = ((deg % 360) + 360) % 360;
  if (_gpsGuidanceBearingSmooth == null) _gpsGuidanceBearingSmooth = target;
  else {
    let diff = target - _gpsGuidanceBearingSmooth;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    _gpsGuidanceBearingSmooth = (_gpsGuidanceBearingSmooth + diff * 0.2 + 360) % 360;
  }
  return _gpsGuidanceBearingSmooth;
}

function gpsSmoothGuidanceDist(m) {
  if (m == null || isNaN(m)) return _gpsGuidanceDistSmooth;
  if (_gpsGuidanceDistSmooth == null) _gpsGuidanceDistSmooth = m;
  else _gpsGuidanceDistSmooth += (m - _gpsGuidanceDistSmooth) * 0.18;
  return _gpsGuidanceDistSmooth;
}

function resolveObjectGuidanceLatLon(obj) {
  if (!obj) return null;
  if (obj.lat != null && obj.lon != null) return { lat: obj.lat, lon: obj.lon };
  if (obj.type === 'import_polygon' || obj.type === 'import_polyline') {
    const verts = obj.vertices || [];
    if (!verts.length) return null;
    let lat = 0, lon = 0, n = 0;
    verts.forEach(v => {
      if (v.lat == null || v.lon == null) return;
      lat += v.lat;
      lon += v.lon;
      n++;
    });
    return n ? { lat: lat / n, lon: lon / n } : null;
  }
  if (obj.cx != null && obj.cy != null) {
    const g = worldToLatLon(obj.cx, obj.cy);
    return { lat: g.lat, lon: g.lon };
  }
  if (obj.points && obj.points.length >= 2) {
    const g = worldToLatLon(obj.points[0], obj.points[1]);
    return { lat: g.lat, lon: g.lon };
  }
  return null;
}

function getGpsGuidanceMetrics() {
  if (!_gpsGuidanceActive || !_gpsTarget) return null;
  const disp = getGpsDisplayFix();
  if (!disp) return { bearing: null, distance: null, arrived: false };
  const dist = haversineM(disp.lat, disp.lon, _gpsTarget.lat, _gpsTarget.lon);
  const bearing = gpsBearingFromPoints(disp, _gpsTarget);
  const arrived = dist <= GPS_GUIDANCE_ARRIVAL_M;
  return {
    bearing: gpsSmoothGuidanceBearing(bearing),
    distance: gpsSmoothGuidanceDist(dist),
    arrived,
  };
}

function formatGpsGuidanceDistance(m) {
  if (m == null || isNaN(m)) return '—';
  if (m >= 1000) return (m / 1000).toFixed(1) + ' km';
  if (m >= 100) return Math.round(m) + ' m';
  if (m >= 1) return m.toFixed(0) + ' m';
  return Math.max(1, Math.round(m)) + ' m';
}

function gpsHudGuidanceCompactLine() {
  const m = getGpsGuidanceMetrics();
  if (!m) return t('guide.route');
  if (m.arrived) return t('guide.arrived');
  const parts = [t('guide.route')];
  if (m.bearing != null) parts.push(gpsHudTargetBearingArrow(m.bearing));
  if (m.distance != null) parts.push(formatGpsGuidanceDistance(m.distance));
  return parts.join(' · ');
}

function boundsForGuidanceRoute() {
  if (!_gpsTarget) return { ok: false };
  const disp = getGpsDisplayFix();
  const pts = disp ? [disp, _gpsTarget] : [_gpsTarget];
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  pts.forEach(p => {
    minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
    minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
  });
  return { minLat, maxLat, minLon, maxLon, ok: true };
}

function fitMapToGuidanceRoute() {
  const b = boundsForGuidanceRoute();
  if (!b.ok) return;
  if (_gpsFollow) {
    _gpsFollow = false;
    document.getElementById('btn-gps-follow')?.classList.remove('active');
    document.getElementById('btn-map-locate')?.classList.toggle('active', _fieldGpsOn && !!_fieldGpsFix);
  }
  fitMapToLatLonBounds(b);
  scheduleRender();
  showHint(t('guide.route'), 1800);
}

function startGpsGuidance(lat, lon, label) {
  if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return;
  if (!_fieldGpsOn) {
    toggleFieldGps();
    showHint(t('guide.needGps'), 2800);
  }
  _gpsTarget = { lat, lon, label: label || '' };
  _gpsGuidanceActive = true;
  _gpsGuidanceArrived = false;
  _gpsGuidanceBearingSmooth = null;
  _gpsGuidanceDistSmooth = null;
  _gpsGuidancePulse = 0;
  hideFieldMapContextMenu();
  closeNotePopup();
  ensureGpsMotionLoop();
  requestAnimationFrame(() => fitMapToGuidanceRoute());
  updateGpsHud();
  scheduleRender();
  showHint(t('guide.hint'), 3200);
}

function clearGpsGuidance() {
  _gpsTarget = null;
  _gpsGuidanceActive = false;
  _gpsGuidanceArrived = false;
  _gpsGuidanceBearingSmooth = null;
  _gpsGuidanceDistSmooth = null;
  hideFieldMapContextMenu();
  ensureFieldLiveLocationFollow();
  const g = getGpsDisplayFix();
  if (g && fieldLiveLocationLocked()) setMapCenter(g.lat, g.lon);
  updateGpsHud();
  scheduleRender();
}

function startGpsGuidanceFromCoords(lat, lon, label) {
  startGpsGuidance(lat, lon, label);
}

function startGpsGuidanceFromObject(obj) {
  const g = resolveObjectGuidanceLatLon(obj);
  if (!g) return;
  const label = obj.metadata?.name || obj.title || obj.textNote || obj.text || '';
  startGpsGuidance(g.lat, g.lon, label);
}

function startGpsGuidanceFromMapPoint(wp) {
  const g = worldToLatLon(wp.x, wp.y);
  startGpsGuidance(g.lat, g.lon, '');
}

function guideFromSelected() {
  const id = _fieldCtxNoteId || _fieldCtxPhotoId || S.selectedIds[0];
  const obj = S.objects.find(o => o.id === id);
  if (!obj) return;
  startGpsGuidanceFromObject(obj);
}

function guideFromNotePopup() {
  const obj = S.objects.find(o => o.id === _observationPopupPrimaryId) ||
    S.objects.find(o => o.id === _notePopupId) ||
    S.objects.find(o => o.id === _fieldCtxPhotoId);
  if (!obj) return;
  startGpsGuidanceFromObject(obj);
}

function guideFromFeaturePanel() {
  const obj = S.objects.find(o => o.id === _fieldInfoObjId);
  if (!obj) return;
  startGpsGuidanceFromObject(obj);
}

function guideToReplayPoint() {
  if (!_gpsTrackReplay.pos) return;
  startGpsGuidance(_gpsTrackReplay.pos.lat, _gpsTrackReplay.pos.lon, t('guide.replayPoint'));
}

function fieldMapRightClickAllowed() {
  if (!FIELD_MODE) return false;
  if (S.polyActive || S.plSession) return false;
  if (fieldActiveDrawTool()) return false;
  return true;
}

function openFieldMapContextMenuAt(e) {
  if (!fieldMapRightClickAllowed()) return false;
  const wp = clientToWorld(e.clientX, e.clientY);
  showFieldMapContextMenu(e.clientX, e.clientY, wp);
  return true;
}

function hideFieldMapContextMenu() {
  const m = document.getElementById('field-map-menu');
  if (m) m.style.display = 'none';
  _fieldMapMenuWp = null;
}

function showFieldMapContextMenu(clientX, clientY, wp) {
  const m = document.getElementById('field-map-menu');
  if (!m || !FIELD_MODE) return;
  _fieldMapMenuWp = wp;
  const items = [];
  items.push({
    label: t('guide.go'),
    cls: 'guide-primary',
    fn: () => startGpsGuidanceFromMapPoint(wp),
  });
  if (_gpsTrackReplay.pos) {
    items.push({
      label: t('guide.replayPoint'),
      cls: 'guide-primary',
      fn: () => guideToReplayPoint(),
    });
  }
  if (_gpsGuidanceActive) {
    items.push({
      label: t('guide.clear'),
      cls: 'guide-muted',
      fn: () => clearGpsGuidance(),
    });
  }
  m.innerHTML = '';
  items.forEach(it => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = it.label;
    if (it.cls) b.className = it.cls;
    b.onclick = e => { e.stopPropagation(); hideFieldMapContextMenu(); it.fn(); };
    m.appendChild(b);
  });
  m.style.display = 'flex';
  const pad = 8;
  const mw = m.offsetWidth || 180;
  const mh = m.offsetHeight || 96;
  let left = clientX + 6;
  let top = clientY - mh / 2;
  left = Math.max(pad, Math.min(left, window.innerWidth - mw - pad));
  top = Math.max(pad + getTopBarH(), Math.min(top, window.innerHeight - getFieldDockH() - mh - pad));
  m.style.left = left + 'px';
  m.style.top = top + 'px';
}

function drawGuideRouteChevrons(x0, y0, x1, y1, arrived) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 12 / S.scale) return;
  const ux = dx / len, uy = dy / len;
  const color = arrived ? '#27ae60' : '#2d6fa0';
  const step = Math.max(36 / S.scale, len / 7);
  const n = Math.min(10, Math.max(1, Math.floor(len / step)));
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.6, 2.2 / S.scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (let i = 1; i <= n; i++) {
    const t = i / (n + 1);
    const cx = x0 + dx * t;
    const cy = y0 + dy * t;
    const sz = Math.max(4, 5.5 / S.scale);
    ctx.beginPath();
    ctx.moveTo(cx - uy * sz - ux * sz * 0.6, cy + ux * sz - uy * sz * 0.6);
    ctx.lineTo(cx + ux * sz, cy + uy * sz);
    ctx.lineTo(cx + uy * sz - ux * sz * 0.6, cy - ux * sz - uy * sz * 0.6);
    ctx.stroke();
  }
}

function renderGpsGuidance() {
  if (!_gpsGuidanceActive || !_gpsTarget) return;
  const disp = getGpsDisplayFix();
  if (!disp) return;
  ctx.save();
  ctx.translate(S.tx, S.ty);
  ctx.scale(S.scale, S.scale);
  const wFrom = latLonToWorld(disp.lat, disp.lon);
  const wTo = latLonToWorld(_gpsTarget.lat, _gpsTarget.lon);
  const pulse = 0.5 + 0.5 * Math.sin(_gpsGuidancePulse);
  const arrived = _gpsGuidanceArrived;
  const m = getGpsGuidanceMetrics();
  const distLabel = m?.distance != null ? formatGpsGuidanceDistance(m.distance) : '';

  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.72)';
  ctx.lineWidth = Math.max(3.5, 5 / S.scale);
  ctx.beginPath();
  ctx.moveTo(wFrom.x, wFrom.y);
  ctx.lineTo(wTo.x, wTo.y);
  ctx.stroke();

  ctx.strokeStyle = arrived ? 'rgba(39,174,96,0.82)' : 'rgba(45,111,160,0.88)';
  ctx.lineWidth = Math.max(2, 2.6 / S.scale);
  ctx.setLineDash([10 / S.scale, 7 / S.scale]);
  ctx.beginPath();
  ctx.moveTo(wFrom.x, wFrom.y);
  ctx.lineTo(wTo.x, wTo.y);
  ctx.stroke();
  ctx.setLineDash([]);

  drawGuideRouteChevrons(wFrom.x, wFrom.y, wTo.x, wTo.y, arrived);

  if (distLabel) {
    const mx = (wFrom.x + wTo.x) / 2;
    const my = (wFrom.y + wTo.y) / 2;
    const dx = wTo.x - wFrom.x;
    const dy = wTo.y - wFrom.y;
    const segLen = Math.hypot(dx, dy) || 1;
    const off = 11 / S.scale;
    drawOnMapMeasureLabel(mx - (dy / segLen) * off, my + (dx / segLen) * off, distLabel);
  }

  const pr = (14 + pulse * (arrived ? 12 : 8)) / S.scale;
  ctx.fillStyle = arrived
    ? `rgba(39,174,96,${0.09 + pulse * 0.08})`
    : `rgba(45,111,160,${0.07 + pulse * 0.07})`;
  ctx.beginPath();
  ctx.arc(wTo.x, wTo.y, pr, 0, Math.PI * 2);
  ctx.fill();

  const pinH = Math.max(14, 18 / S.scale);
  const pinW = Math.max(8, 10 / S.scale);
  ctx.fillStyle = arrived ? '#27ae60' : '#2d6fa0';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = Math.max(1.5, 2 / S.scale);
  ctx.beginPath();
  ctx.moveTo(wTo.x, wTo.y - pinH);
  ctx.bezierCurveTo(wTo.x + pinW, wTo.y - pinH * 0.45, wTo.x + pinW * 0.55, wTo.y, wTo.x, wTo.y);
  ctx.bezierCurveTo(wTo.x - pinW * 0.55, wTo.y, wTo.x - pinW, wTo.y - pinH * 0.45, wTo.x, wTo.y - pinH);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(wTo.x, wTo.y - pinH * 0.62, Math.max(2.5, 3.2 / S.scale), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function gpsPushMoveHistory(fix) {
  const now = fix.ts || Date.now();
  _gpsMoveHist.push({ lat: fix.lat, lon: fix.lon, ts: now });
  const cutoff = now - 14000;
  _gpsMoveHist = _gpsMoveHist.filter(p => p.ts >= cutoff);
  if (_gpsMoveHist.length > 28) _gpsMoveHist = _gpsMoveHist.slice(-28);
}

function gpsRecentMoveRadius() {
  if (_gpsMoveHist.length < 2) return 0;
  const ref = _gpsMoveHist[_gpsMoveHist.length - 1];
  let maxR = 0;
  for (const p of _gpsMoveHist) maxR = Math.max(maxR, haversineM(ref.lat, ref.lon, p.lat, p.lon));
  return maxR;
}

function gpsClearFixFusion() {
  _gpsFixBuffer = [];
  _gpsDisplayAccuracySmooth = null;
  _gpsAgpsHintShown = false;
  clearTimeout(_gpsAgpsPollTimer);
  _gpsAgpsPollTimer = null;
}

function gpsPushFixBuffer(fix) {
  _gpsFixBuffer.push({
    lat: fix.lat,
    lon: fix.lon,
    accuracy: fix.accuracy,
    ts: fix.ts || Date.now(),
  });
  if (_gpsFixBuffer.length > GPS_FIX_FUSE_MAX) _gpsFixBuffer.shift();
}

function gpsFuseLiveFix(incoming) {
  gpsPushFixBuffer(incoming);
  if (_gpsFixBuffer.length < 2) return { ...incoming };
  let wSum = 0;
  let lat = 0;
  let lon = 0;
  let accBest = incoming.accuracy || 999;
  for (const f of _gpsFixBuffer) {
    const acc = Math.max(4, f.accuracy || 50);
    accBest = Math.min(accBest, f.accuracy || acc);
    const w = 1 / (acc * acc);
    lat += f.lat * w;
    lon += f.lon * w;
    wSum += w;
  }
  if (wSum <= 0) return { ...incoming };
  return {
    ...incoming,
    lat: lat / wSum,
    lon: lon / wSum,
    accuracy: accBest,
  };
}

function gpsAcceptLiveFix(fix) {
  const acc = fix.accuracy || 999;
  const prev = _fieldGpsFix;
  if (!prev) return acc <= GPS_LIVE_REJECT_ACCURACY_M || acc <= 180;
  const dist = haversineM(prev.lat, prev.lon, fix.lat, fix.lon);
  const dt = Math.max(0.05, ((fix.ts || Date.now()) - (prev.ts || 0)) / 1000);
  const spd = fix.speed != null && !isNaN(fix.speed) ? fix.speed : dist / dt;
  const gate = Math.max(10, Math.min(prev.accuracy || 25, acc) * 1.25);
  if (acc > GPS_AGPS_WEAK_THRESHOLD_M && dist > gate && spd < 1.8) {
    gpsDbgLog('LIVE', 'reject weak outlier', dist.toFixed(1) + 'm', '±' + Math.round(acc) + 'm');
    return false;
  }
  if (acc > GPS_LIVE_REJECT_ACCURACY_M && dist > gate * 1.4) {
    gpsDbgLog('LIVE', 'reject poor accuracy jump', dist.toFixed(1) + 'm');
    return false;
  }
  return true;
}

function gpsSmoothDisplayAccuracy(acc) {
  if (acc == null || isNaN(acc)) return _gpsDisplayAccuracySmooth;
  const a = Math.max(4, acc);
  if (_gpsDisplayAccuracySmooth == null) _gpsDisplayAccuracySmooth = a;
  else _gpsDisplayAccuracySmooth += (a - _gpsDisplayAccuracySmooth) * 0.2;
  return _gpsDisplayAccuracySmooth;
}

function gpsScheduleAgpsRefresh(urgent) {
  clearTimeout(_gpsAgpsPollTimer);
  if (!_fieldGpsOn) return;
  const delay = urgent ? GPS_AGPS_POLL_WEAK_MS : GPS_AGPS_POLL_OK_MS;
  _gpsAgpsPollTimer = setTimeout(() => gpsPollAgpsFix(), delay);
}

function gpsPollAgpsFix() {
  if (!_fieldGpsOn || !navigator.geolocation) return;
  const acc = _fieldGpsFix?.accuracy || 999;
  const urgent = acc > GPS_AGPS_WEAK_THRESHOLD_M || _gpsStatus === 'weak' || _gpsStatus === 'searching';
  navigator.geolocation.getCurrentPosition(onGpsPosition, () => {}, {
    enableHighAccuracy: true,
    maximumAge: urgent ? 0 : 2500,
    timeout: urgent ? 28000 : 16000,
  });
  gpsScheduleAgpsRefresh(urgent);
}

function gpsClassifyFixAccuracy(acc) {
  if (acc == null || isNaN(acc)) return 'searching';
  if (acc > 65) return 'weak';
  if (acc > 28) return 'connected';
  return 'connected';
}

function gpsDerivedSpeed(fix) {
  if (fix.speed != null && !isNaN(fix.speed) && fix.speed >= 0) return fix.speed;
  if (_gpsMoveHist.length < 2) return 0;
  const a = _gpsMoveHist[_gpsMoveHist.length - 2];
  const b = _gpsMoveHist[_gpsMoveHist.length - 1];
  const dt = (b.ts - a.ts) / 1000;
  if (dt <= 0) return 0;
  return haversineM(a.lat, a.lon, b.lat, b.lon) / dt;
}

/** Median-smoothed speed for movement-state decisions (display-only path). */
function gpsDecisionSpeed(fix) {
  let v = 0;
  if (fix.speed != null && !isNaN(fix.speed) && fix.speed >= 0) v = fix.speed;
  else v = gpsDerivedSpeed(fix);
  _gpsSpeedSamples.push(v);
  if (_gpsSpeedSamples.length > 3) _gpsSpeedSamples.shift();
  if (_gpsSpeedSamples.length < 2) return v;
  const sorted = _gpsSpeedSamples.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function gpsResetDerivedPath() {
  _gpsDerivedPathM = 0;
  _gpsDerivedPathRef = null;
}

function updateGpsDerivedPathAndBearing(fix) {
  if (_gpsMoveState === GPS_MOVE.STATIONARY) return;
  if (!_gpsDerivedPathRef) {
    _gpsDerivedPathRef = { lat: fix.lat, lon: fix.lon };
    return;
  }
  const d = haversineM(_gpsDerivedPathRef.lat, _gpsDerivedPathRef.lon, fix.lat, fix.lon);
  if (d > 0.04) {
    _gpsDerivedPathM += d;
    _gpsDerivedPathRef = { lat: fix.lat, lon: fix.lon };
  }
  if (_gpsDerivedPathM >= GPS_DERIVED_BEARING_MIN_M && _gpsMoveHist.length >= 2) {
    const a = _gpsMoveHist[_gpsMoveHist.length - 2];
    const b = _gpsMoveHist[_gpsMoveHist.length - 1];
    _gpsDerivedBearing = gpsBearingFromPoints(a, b);
  }
}

function gpsCompassHeadingFresh() {
  if (_gpsCompassHeading == null || isNaN(_gpsCompassHeading)) return null;
  if (!_gpsCompassTs || Date.now() - _gpsCompassTs > GPS_COMPASS_MAX_AGE_MS) return null;
  return _gpsCompassHeading;
}

function gpsAdaptiveParams(state) {
  switch (state) {
    case GPS_MOVE.STATIONARY:
      return { posLerp: 0.05, posBoost: 0.12, follow: 0.035, hdgLerp: 0.04 };
    case GPS_MOVE.WALKING:
      return { posLerp: 0.30, posBoost: 0.44, follow: 0.20, hdgLerp: 0.24 };
    case GPS_MOVE.ACTIVE:
      return { posLerp: 0.44, posBoost: 0.58, follow: 0.27, hdgLerp: 0.36 };
    case GPS_MOVE.LOW:
      return { posLerp: 0.05, posBoost: 0.09, follow: 0.04, hdgLerp: 0.06 };
    default:
      return { posLerp: 0.20, posBoost: 0.32, follow: 0.17, hdgLerp: 0.20 };
  }
}

function gpsAdaptivePosLerp(distM, state, spd) {
  const p = gpsAdaptiveParams(state);
  let a = p.posLerp;
  if (distM > 20) a = p.posBoost;
  else if (distM > 5) a = p.posLerp + (p.posBoost - p.posLerp) * 0.55;
  if (state === GPS_MOVE.WALKING && spd > 0.5 && distM > 2) a = Math.min(p.posBoost, a + 0.06);
  return a;
}

function resolveDisplayHeadingTarget(raw, spd) {
  const gnssSpd = raw.speed != null && !isNaN(raw.speed) ? raw.speed : null;
  const moveSpd = gnssSpd != null ? gnssSpd : spd;
  if (raw.heading != null && !isNaN(raw.heading) && moveSpd > 0.65) return raw.heading;
  const derivedOk = _gpsMoveState !== GPS_MOVE.STATIONARY &&
    _gpsDerivedPathM >= GPS_DERIVED_BEARING_MIN_M &&
    moveSpd > 0.3 && _gpsDerivedBearing != null;
  if (derivedOk) return _gpsDerivedBearing;
  const compass = gpsCompassHeadingFresh();
  if (compass != null) return compass;
  if (raw.heading != null && !isNaN(raw.heading)) return raw.heading;
  return _fieldGpsDisplay?.heading ?? null;
}

function gpsTryUnlockStationary(fix) {
  if (_gpsMoveState !== GPS_MOVE.STATIONARY) {
    _gpsExitCandidateSince = 0;
    return false;
  }
  const anchor = _gpsStationaryAnchor || _fieldGpsDisplay;
  if (!anchor || !fix) return false;
  const breakDist = haversineM(anchor.lat, anchor.lon, fix.lat, fix.lon);
  const exitR = Math.max(5, (fix.accuracy || 12) * 0.8);
  const hasGnssSpeed = fix.speed != null && !isNaN(fix.speed);
  let shouldExit = breakDist > exitR;
  if (hasGnssSpeed && fix.speed > 0.8) shouldExit = true;
  const now = fix.ts || Date.now();
  if (!shouldExit) {
    _gpsExitCandidateSince = 0;
    return false;
  }
  if (!_gpsExitCandidateSince) {
    _gpsExitCandidateSince = now;
    return false;
  }
  if (now - _gpsExitCandidateSince < GPS_STATIONARY_EXIT_DWELL_MS) return false;
  _gpsMoveState = GPS_MOVE.WALKING;
  _gpsStationaryAnchor = null;
  _gpsStateCandidate = null;
  _gpsExitCandidateSince = 0;
  gpsResetDerivedPath();
  return true;
}

function updateGpsMovementState(fix) {
  gpsPushMoveHistory(fix);
  updateGpsDerivedPathAndBearing(fix);
  const acc = fix.accuracy || 18;
  const decisionSpd = gpsDecisionSpeed(fix);
  const hasGnssSpeed = fix.speed != null && !isNaN(fix.speed);
  const radius = gpsRecentMoveRadius();
  const enterR = Math.max(3, acc * 0.5);
  let wantsStationary = radius < enterR || acc > GPS_AGPS_WEAK_THRESHOLD_M;
  if (hasGnssSpeed) wantsStationary = wantsStationary && decisionSpd < 0.5;

  let next = GPS_MOVE.WALKING;
  if (acc > 22 || _gpsStatus === 'weak') next = GPS_MOVE.LOW;
  else if (wantsStationary) next = GPS_MOVE.STATIONARY;
  else if (decisionSpd > 1.55 || (hasGnssSpeed && decisionSpd > 0.95 && radius > enterR * 1.8)) next = GPS_MOVE.ACTIVE;

  if (gpsTryUnlockStationary(fix)) return;

  if (next !== _gpsMoveState) {
    const now = fix.ts || Date.now();
    if (_gpsStateCandidate !== next) {
      _gpsStateCandidate = next;
      _gpsStateCandidateSince = now;
    } else if (now - _gpsStateCandidateSince > GPS_STATIONARY_ENTER_DWELL_MS) {
      const prev = _gpsMoveState;
      _gpsMoveState = next;
      if (next === GPS_MOVE.STATIONARY && prev !== GPS_MOVE.STATIONARY && _fieldGpsDisplay) {
        _gpsStationaryAnchor = { lat: _fieldGpsDisplay.lat, lon: _fieldGpsDisplay.lon };
        _gpsExitCandidateSince = 0;
      } else if (next !== GPS_MOVE.STATIONARY) {
        _gpsStationaryAnchor = null;
        gpsResetDerivedPath();
      }
      _gpsStateCandidate = null;
    }
  } else {
    _gpsStateCandidate = null;
  }
}

function onGpsDeviceOrientation(e) {
  if (e.webkitCompassHeading != null && !isNaN(e.webkitCompassHeading)) {
    _gpsCompassHeading = e.webkitCompassHeading;
    _gpsCompassTs = Date.now();
    return;
  }
  if (e.alpha == null || isNaN(e.alpha)) return;
  if (e.absolute) _gpsCompassHeading = (360 - e.alpha + 360) % 360;
  else if (_gpsMoveState === GPS_MOVE.STATIONARY || (_fieldGpsFix && gpsDerivedSpeed(_fieldGpsFix) < 0.5)) {
    _gpsCompassHeading = (360 - e.alpha + 360) % 360;
  }
  _gpsCompassTs = Date.now();
}

function bindGpsCompassListener() {
  if (_gpsCompassBound) return;
  _gpsCompassBound = true;
  if ('ondeviceorientationabsolute' in window) {
    window.addEventListener('deviceorientationabsolute', onGpsDeviceOrientation, true);
  }
  window.addEventListener('deviceorientation', onGpsDeviceOrientation, true);
}

function unbindGpsCompassListener() {
  if (!_gpsCompassBound) return;
  _gpsCompassBound = false;
  window.removeEventListener('deviceorientationabsolute', onGpsDeviceOrientation, true);
  window.removeEventListener('deviceorientation', onGpsDeviceOrientation, true);
  _gpsCompassHeading = null;
  _gpsCompassTs = 0;
}

async function startGpsCompassIfAllowed() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      const state = await DeviceOrientationEvent.requestPermission();
      if (state === 'granted') bindGpsCompassListener();
      return;
    }
  } catch (_) {}
  bindGpsCompassListener();
}

function fieldLiveLocationLocked() {
  return FIELD_MODE && !!FIELD_PROJECT.id;
}

function ensureFieldLiveLocationFollow() {
  if (!fieldLiveLocationLocked()) return;
  _gpsFollow = true;
  document.getElementById('btn-gps-follow')?.classList.add('active');
  document.getElementById('btn-map-locate')?.classList.add('active');
}

function disableGpsFollowFromPan() {
  if (fieldLiveLocationLocked()) return;
  if (!_gpsFollow) return;
  _gpsFollow = false;
  document.getElementById('btn-gps-follow')?.classList.remove('active');
  document.getElementById('btn-map-locate')?.classList.toggle('active', _fieldGpsOn && !!_fieldGpsFix);
}

function resetGpsMovementEngine() {
  _gpsMoveState = GPS_MOVE.STATIONARY;
  _gpsMoveHist = [];
  _gpsStationaryAnchor = null;
  _gpsDerivedBearing = null;
  _gpsStateCandidate = null;
  _gpsStateCandidateSince = 0;
  _gpsExitCandidateSince = 0;
  _gpsSpeedSamples = [];
  gpsClearFixFusion();
  gpsResetDerivedPath();
}

function stopGpsMotionLoop() {
  if (_gpsMotionRaf) cancelAnimationFrame(_gpsMotionRaf);
  _gpsMotionRaf = null;
}

function ensureGpsMotionLoop() {
  if (_gpsMotionRaf || !_fieldGpsOn) return;
  let lastFrame = performance.now();
  const tick = (now) => {
    if (!_fieldGpsOn) {
      stopGpsMotionLoop();
      return;
    }
    const dt = Math.min(0.12, (now - lastFrame) / 1000);
    lastFrame = now;
    let moved = false;
    if (_fieldGpsFix && _fieldGpsDisplay) {
      const raw = _fieldGpsFix;
      const spd = gpsDerivedSpeed(raw);
      gpsTryUnlockStationary(raw);
      const params = gpsAdaptiveParams(_gpsMoveState);
      let target = raw;
      if (_gpsMoveState === GPS_MOVE.STATIONARY && _gpsStationaryAnchor) {
        target = { lat: _gpsStationaryAnchor.lat, lon: _gpsStationaryAnchor.lon };
      }
      const dist = haversineM(_fieldGpsDisplay.lat, _fieldGpsDisplay.lon, target.lat, target.lon);
      const a = gpsAdaptivePosLerp(dist, _gpsMoveState, spd);
      if (_gpsMoveState !== GPS_MOVE.STATIONARY || dist > GPS_STATIONARY_FREEZE_M) {
        const p = gpsLerpLatLon(_fieldGpsDisplay, target, a);
        _fieldGpsDisplay.lat = p.lat;
        _fieldGpsDisplay.lon = p.lon;
      }
      _fieldGpsDisplay.accuracy = gpsSmoothDisplayAccuracy(raw.accuracy);
      _fieldGpsDisplay.speed = spd;
      _fieldGpsDisplay.moveState = _gpsMoveState;
      const hdgTarget = resolveDisplayHeadingTarget(raw, spd);
      if (hdgTarget != null) {
        const hdgBase = _gpsMoveState === GPS_MOVE.STATIONARY ? params.hdgLerp * 0.65 : params.hdgLerp;
        const hdgA = Math.max(GPS_HDG_LERP_FLOOR, hdgBase);
        _fieldGpsDisplay.heading = gpsLerpHeading(_fieldGpsDisplay.heading, hdgTarget, hdgA);
      }
      _fieldGpsDisplay.ts = raw.ts;
      if (dist > (_gpsMoveState === GPS_MOVE.STATIONARY ? GPS_STATIONARY_FREEZE_M : 0.2)) moved = true;
    }
    if (_gpsTrack.state !== 'idle' && (!_gpsMotionTrackUiTs || now - _gpsMotionTrackUiTs > 2000)) {
      _gpsMotionTrackUiTs = now;
      updateGpsTrackHud();
    }
    if (_gpsFollow && _fieldGpsDisplay) {
      const followA = (fieldLiveLocationLocked() && _gpsMoveState === GPS_MOVE.STATIONARY)
        ? 1
        : (_gpsMoveState !== GPS_MOVE.STATIONARY ? gpsAdaptiveParams(_gpsMoveState).follow : 0);
      if (followA > 0) {
        const dLat = _fieldGpsDisplay.lat - S.mapCenter.lat;
        const dLon = _fieldGpsDisplay.lon - S.mapCenter.lon;
        if (Math.abs(dLat) > 1e-8 || Math.abs(dLon) > 1e-8) {
          S.mapCenter.lat += dLat * followA;
          S.mapCenter.lon += dLon * followA;
          moved = true;
        }
      }
    }
    if (_gpsGuidanceActive && _gpsTarget) {
      _gpsGuidancePulse += dt * 3.2;
      const gm = getGpsGuidanceMetrics();
      if (gm) {
        const wasArrived = _gpsGuidanceArrived;
        _gpsGuidanceArrived = gm.arrived;
        if (_gpsGuidanceArrived !== wasArrived) updateGpsHud();
        moved = true;
      }
    }
    if (_gpsTrack.state === 'recording' && _fieldGpsDisplay) moved = true;
    if (moved) scheduleRender();
    _gpsMotionRaf = requestAnimationFrame(tick);
  };
  _gpsMotionRaf = requestAnimationFrame(tick);
}

function getGpsDisplayFix() {
  return _fieldGpsDisplay || _fieldGpsFix;
}

/** Display-only live route tip — suppresses micro drift while stationary. */
function getGpsLiveRouteTip() {
  const disp = getGpsDisplayFix();
  if (!disp) return null;
  if (_gpsMoveState === GPS_MOVE.STATIONARY && _gpsTrack.points.length) {
    const last = _gpsTrack.points[_gpsTrack.points.length - 1];
    return { lat: last.lat, lon: last.lon, accuracy: disp.accuracy, heading: disp.heading, speed: disp.speed, ts: disp.ts };
  }
  return disp;
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
  const dp = (lat2 - lat1) * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function gpsDestinationPoint(lat, lon, bearingDeg, distM) {
  if (distM <= 0) return { lat, lon };
  const R = 6371000;
  const br = bearingDeg * Math.PI / 180;
  const p1 = lat * Math.PI / 180;
  const l1 = lon * Math.PI / 180;
  const ang = distM / R;
  const sinP1 = Math.sin(p1), cosP1 = Math.cos(p1);
  const sinAng = Math.sin(ang), cosAng = Math.cos(ang);
  const p2 = Math.asin(sinP1 * cosAng + cosP1 * sinAng * Math.cos(br));
  const l2 = l1 + Math.atan2(Math.sin(br) * sinAng * cosP1, cosAng - sinP1 * Math.sin(p2));
  return { lat: p2 * 180 / Math.PI, lon: l2 * 180 / Math.PI };
}

function gpsSegmentTurnDeg(p0, p1, p2) {
  if (!p0 || !p1 || !p2) return 0;
  const b0 = gpsBearingFromPoints(p0, p1);
  const b1 = gpsBearingFromPoints(p1, p2);
  return Math.abs(((b1 - b0 + 540) % 360) - 180);
}

/** Display-only densified vertices — raw track / export data stay untouched. */
function buildGpsTrackDisplayVerts(rawVerts, liveTip) {
  if (!rawVerts || !rawVerts.length) {
    return liveTip ? [{ lat: liveTip.lat, lon: liveTip.lon }] : [];
  }
  const src = rawVerts.map(v => ({ lat: v.lat, lon: v.lon }));
  if (liveTip) src.push({ lat: liveTip.lat, lon: liveTip.lon });
  if (src.length < 2) return src.slice();

  const out = [{ lat: src[0].lat, lon: src[0].lon }];
  for (let i = 1; i < src.length; i++) {
    const a = src[i - 1];
    const b = src[i];
    const dist = haversineM(a.lat, a.lon, b.lat, b.lon);
    if (dist < GPS_TRACK_VIS_MIN_SEG_M) {
      out.push({ lat: b.lat, lon: b.lon });
      continue;
    }
    const prev = i >= 2 ? src[i - 2] : null;
    const next = i + 1 < src.length ? src[i + 1] : null;
    const turn = Math.max(
      prev ? gpsSegmentTurnDeg(prev, a, b) : 0,
      next ? gpsSegmentTurnDeg(a, b, next) : 0,
    );
    let stepM = Math.max(GPS_TRACK_VIS_MIN_SEG_M, Math.min(GPS_TRACK_VIS_MAX_STEP_M, dist / 4));
    if (turn >= GPS_TRACK_VIS_CORNER_DEG) stepM = Math.max(2.0, stepM * 0.45);
    else if (turn >= 18) stepM = Math.max(2.4, stepM * 0.72);
    if (liveTip && i === src.length - 1) stepM = Math.max(2.0, stepM * 0.85);
    const nSteps = Math.max(1, Math.ceil(dist / stepM));
    const bearing = gpsBearingFromPoints(a, b);
    for (let s = 1; s <= nSteps; s++) {
      if (s === nSteps) out.push({ lat: b.lat, lon: b.lon });
      else out.push(gpsDestinationPoint(a.lat, a.lon, bearing, (dist * s) / nSteps));
    }
  }
  return out;
}

function trackTotalDistanceM(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += haversineM(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon);
  return d;
}

function gpsAcceptTrackPoint(lat, lon, accuracy, speed, ts, lastPt) {
  if (accuracy != null && accuracy > GPS_TRACK_MAX_ACCURACY_M) {
    gpsDbgLog('TRACK', 'reject accuracy', accuracy);
    return false;
  }
  if (lastPt) {
    if (Math.abs(lat - lastPt.lat) < GPS_TRACK_DUP_EPS && Math.abs(lon - lastPt.lon) < GPS_TRACK_DUP_EPS) {
      gpsDbgLog('TRACK', 'reject duplicate');
      return false;
    }
    const dt = (ts - lastPt.ts) / 1000;
    if (dt <= 0) return false;
    const dist = haversineM(lastPt.lat, lastPt.lon, lat, lon);
    if (_gpsTrackResumeAcceptStale) {
      _gpsTrackResumeAcceptStale = false;
      gpsDbgLog('TRACK', 'resume accept after gap', dt.toFixed(0) + 's', dist.toFixed(1) + 'm');
      if (dt <= GPS_TRACK_JUMP_SEC && dist > GPS_TRACK_MAX_JUMP_M) {
        gpsDbgLog('TRACK', 'reject jump on resume', dist.toFixed(1) + 'm');
        return false;
      }
      return true;
    }
    if (dt > GPS_STALE_FIX_MS / 1000) {
      gpsDbgLog('TRACK', 'reject stale gap', dt.toFixed(0) + 's');
      return false;
    }
    if (dt <= GPS_TRACK_JUMP_SEC && dist > GPS_TRACK_MAX_JUMP_M) {
      gpsDbgLog('TRACK', 'reject jump', dist.toFixed(1) + 'm', dt.toFixed(1) + 's');
      return false;
    }
    if (dt > 0 && dist / dt > 42) {
      gpsDbgLog('TRACK', 'reject speed', (dist / dt).toFixed(1) + 'm/s');
      return false;
    }
    const minDt = (speed != null && speed > 1.1) ? 0.75 : 1.35;
    if (dt < minDt) return false;
    if (dist < GPS_JITTER_STANDSTILL_M && (speed == null || speed < 0.35) && dt < 3) return false;
  }
  return true;
}

function gpsTrackOnPosition(pos) {
  if (_gpsTrack.state !== 'recording') return;
  const fix = _fieldGpsFix;
  if (!fix) return;
  const lat = fix.lat;
  const lon = fix.lon;
  const ts = fix.ts || Date.now();
  const acc = fix.accuracy;
  const speed = fix.speed != null ? fix.speed : pos.coords.speed;
  const pts = _gpsTrack.points;
  const last = pts.length ? pts[pts.length - 1] : null;
  if (!gpsAcceptTrackPoint(lat, lon, acc, speed, ts, last)) {
    if (isGpsDebugMode()) { _gpsTestFilterStats.rej++; updateGpsTestPanel(); }
    return;
  }
  if (isGpsDebugMode()) { _gpsTestFilterStats.ok++; updateGpsTestPanel(); }
  const trackCap = typeof SpatialSecurity !== 'undefined' ? SpatialSecurity.LIMITS.MAX_GPS_TRACK_POINTS : 500000;
  if (pts.length >= trackCap) return;
  pts.push({ lat, lon, ts, accuracy: acc, speed: speed });
  gpsDbgLog('TRACK', 'point', lat.toFixed(6), lon.toFixed(6), '±' + Math.round(acc || 0) + 'm');
  syncGpsTrackObject();
  updateGpsTrackHud();
  scheduleRender();
}

function syncGpsTrackObject() {
  if (!_gpsTrack.points.length) return;
  let obj = _gpsTrack.objId ? S.objects.find(o => o.id === _gpsTrack.objId) : null;
  if (!obj) {
    obj = {
      id: uid(), type: 'field_gps_track', vertices: [], color: '#1565c0',
      strokeWidth: 3, opacity: 1, visible: true, locked: false, layerId: FIELD_GPS_LAYER,
      trackMeta: {},
    };
    ensureGpsLayer();
    obj.trackNum = getNextGpsTrackNumber();
    normalizeFieldGpsTrackObject(obj);
    S.objects.push(obj);
    _gpsTrack.objId = obj.id;
    buildLayerPanel();
  }
  obj.vertices = _gpsTrack.points.map(p => ({ lat: p.lat, lon: p.lon, ts: p.ts }));
  obj.trackMeta = {
    startTs: _gpsTrack.startTs,
    endTs: _gpsTrack.points[_gpsTrack.points.length - 1].ts,
    distanceM: trackTotalDistanceM(_gpsTrack.points),
    state: _gpsTrack.state,
  };
}

function beginGpsTrackRecording() {
  if (_gpsTrack.state !== 'idle') return false;
  stopGpsTrackReplay();
  _gpsTrack.state = 'recording';
  _gpsTrack.points = [];
  _gpsTrack.startTs = Date.now();
  _gpsTrack.pausedAt = null;
  _gpsTrack.pauseMs = 0;
  _gpsTrack.objId = null;
  updateGpsTrackHud();
  return true;
}

function startGpsTrackRecording() {
  requireProject(() => {
    if (!_fieldGpsOn && !startGpsWatch()) return;
    if (beginGpsTrackRecording()) showHint(t('track.start'));
  });
}

function toggleGpsTrackPause() {
  touchGpsHudActivity();
  if (_gpsTrack.state === 'recording') pauseGpsTrackRecording();
  else if (_gpsTrack.state === 'paused') resumeGpsTrackRecording();
}

function pauseGpsTrackRecording() {
  if (_gpsTrack.state !== 'recording') return;
  _gpsTrack.state = 'paused';
  _gpsTrack.pausedAt = Date.now();
  touchGpsHudActivity();
  updateGpsTrackHud();
  updateGpsHud();
  showHint(t('track.pause'));
}

function resumeGpsTrackRecording() {
  if (_gpsTrack.state !== 'paused') return;
  if (_gpsTrack.pausedAt) _gpsTrack.pauseMs += Date.now() - _gpsTrack.pausedAt;
  _gpsTrack.state = 'recording';
  _gpsTrack.pausedAt = null;
  touchGpsHudActivity();
  updateGpsTrackHud();
  updateGpsHud();
  showHint(t('track.start'));
}

function stopGpsTrackRecording(keepGps) {
  if (_gpsTrack.state === 'idle') return;
  _gpsTrack.state = 'idle';
  syncGpsTrackObject();
  pushHistory();
  scheduleProjectSave();
  updateGpsTrackHud();
  updateGpsTestPanel();
  if (keepGps && _fieldGpsOn) {
    showHint(t('track.stop') + ' — ' + t('track.stopHudHint'));
    updateGpsHud();
    scheduleRender();
  } else {
    showHint(t('track.stop'));
  }
}

function clearGpsTrackTest() {
  if (_gpsTrack.objId) {
    S.objects = S.objects.filter(o => o.id !== _gpsTrack.objId);
    S.selectedIds = S.selectedIds.filter(id => id !== _gpsTrack.objId);
  }
  _gpsTrack = { state: 'idle', points: [], startTs: null, pausedAt: null, pauseMs: 0, objId: null };
  _gpsTestFilterStats = { ok: 0, rej: 0 };
  pushHistory();
  updateGpsTrackHud();
  updateGpsTestPanel();
  scheduleRender();
  scheduleProjectSave();
  gpsDbgLog('TRACK', 'cleared');
  showHint('Track cleared');
}

function gpsTestStartGps() { startGpsWatch(); }
function gpsTestStopGps() { stopGpsTracking(); }
function gpsTestStartTrack() { startGpsTrackRecording(); }
function gpsTestPauseTrack() { toggleGpsTrackPause(); }
function gpsTestStopTrack() { stopGpsTrackRecording(); }
function gpsTestClearTrack() { clearGpsTrackTest(); }

async function refreshGpsTestPermission() {
  const perm = await queryGpsPermissionState();
  const el = document.getElementById('gps-test-perm');
  if (el) el.textContent = 'perm: ' + perm;
  gpsDbgLog('PERMISSION', perm, 'secure=' + gpsSecureContextOk(), location.href);
  return perm;
}

let _gpsTestPanelExpanded = false;
let _gpsHudExpanded = false;
let _gpsHudInactivityTimer = null;
const GPS_HUD_AUTO_COLLAPSE_MS = 22000;

function resetGpsHudInactivityTimer() {
  if (_gpsHudInactivityTimer) clearTimeout(_gpsHudInactivityTimer);
  if (!_fieldGpsOn) return;
  _gpsHudInactivityTimer = setTimeout(() => collapseGpsFieldHud(), GPS_HUD_AUTO_COLLAPSE_MS);
}

function touchGpsHudActivity() {
  if (_gpsHudExpanded) resetGpsHudInactivityTimer();
}

function collapseGpsFieldHud() {
  const tp = document.getElementById('gps-test-panel');
  if (tp && isGpsDebugMode()) {
    tp.classList.remove('expanded');
    tp.classList.add('collapsed');
    const chip = document.getElementById('gps-test-chip');
    if (chip) chip.setAttribute('aria-expanded', 'false');
    const tg = document.getElementById('gps-test-chip-toggle');
    if (tg) tg.textContent = '▲';
    _gpsTestPanelExpanded = false;
  }
  const hud = document.getElementById('gps-hud');
  if (hud) {
    hud.classList.add('gps-hud-collapsed');
    hud.classList.remove('gps-hud-expanded');
    const chip = document.getElementById('gps-hud-chip');
    if (chip) chip.setAttribute('aria-expanded', 'false');
    const tg = document.getElementById('gps-hud-chip-toggle');
    if (tg) tg.textContent = '▲';
  }
  _gpsHudExpanded = false;
  if (_gpsHudInactivityTimer) clearTimeout(_gpsHudInactivityTimer);
}

function toggleGpsTestPanelExpand(ev) {
  ev?.stopPropagation?.();
  const tp = document.getElementById('gps-test-panel');
  if (!tp) return;
  const expand = !tp.classList.contains('expanded');
  tp.classList.toggle('expanded', expand);
  tp.classList.toggle('collapsed', !expand);
  _gpsTestPanelExpanded = expand;
  const chip = document.getElementById('gps-test-chip');
  const tg = document.getElementById('gps-test-chip-toggle');
  if (chip) chip.setAttribute('aria-expanded', expand ? 'true' : 'false');
  if (tg) tg.textContent = expand ? '▼' : '▲';
  if (expand) resetGpsHudInactivityTimer();
  else if (_gpsHudInactivityTimer) clearTimeout(_gpsHudInactivityTimer);
}

function toggleGpsHudExpand(ev) {
  ev?.stopPropagation?.();
  if (_gpsHudLongPressFired) { _gpsHudLongPressFired = false; return; }
  if (!_fieldGpsOn) { startFieldGpsSession(); return; }
  if (isGpsDebugMode()) {
    const tp = document.getElementById('gps-test-panel');
    if (tp && getComputedStyle(tp).display !== 'none') {
      toggleGpsTestPanelExpand(ev);
      return;
    }
  }
  const hud = document.getElementById('gps-hud');
  if (!hud || hud.style.display === 'none') return;
  const expand = !hud.classList.contains('gps-hud-expanded');
  hud.classList.toggle('gps-hud-collapsed', !expand);
  hud.classList.toggle('gps-hud-expanded', expand);
  _gpsHudExpanded = expand;
  const chip = document.getElementById('gps-hud-chip');
  const tg = document.getElementById('gps-hud-chip-toggle');
  if (chip) chip.setAttribute('aria-expanded', expand ? 'true' : 'false');
  if (tg) tg.textContent = expand ? '▼' : '▲';
  if (expand) resetGpsHudInactivityTimer();
  else if (_gpsHudInactivityTimer) clearTimeout(_gpsHudInactivityTimer);
}

function gpsHudCompactLines() {
  const label = gpsStatusLabel(_gpsStatus);
  let acc = '';
  if (_fieldGpsFix && (_gpsStatus === 'connected' || _gpsStatus === 'weak')) {
    acc = ' · ' + Math.round(_fieldGpsFix.accuracy || 0) + ' m';
  }
  const line1 = t('gps.pill') + ' · ' + label + acc;
  let line2 = '';
  if (_gpsGuidanceActive && _gpsTarget) {
    line2 = gpsHudGuidanceCompactLine();
    const disp = getGpsDisplayFix() || _fieldGpsFix;
    const hdg = disp ? resolveDisplayHeadingTarget(disp, gpsDerivedSpeed(disp)) : null;
    updateGpsHudCompass(hdg);
  } else if (_fieldGpsOn && _fieldGpsFix && (_gpsStatus === 'connected' || _gpsStatus === 'weak')) {
    const disp = getGpsDisplayFix() || _fieldGpsFix;
    const spd = gpsHudSmoothSpeed(gpsDerivedSpeed(disp));
    const hdg = resolveDisplayHeadingTarget(disp, spd);
    const parts = [];
    if (hdg != null && !isNaN(hdg)) parts.push(gpsHudHeadingArrow(hdg));
    parts.push(formatGpsHudSpeed(spd));
    line2 = parts.join(' · ');
    updateGpsHudCompass(hdg);
  } else {
    updateGpsHudCompass(null);
  }
  return { line1, line2 };
}

function gpsHudCompactLabel() {
  const { line1, line2 } = gpsHudCompactLines();
  return line2 ? line1 + '\n' + line2 : line1;
}

function applyGpsHudPosition() {
  try {
    const raw = localStorage.getItem('planai_gps_prod_hud_pos');
    if (!raw) return;
    const pos = JSON.parse(raw);
    const hud = document.getElementById('gps-hud');
    if (hud && pos.left != null) {
      hud.style.left = pos.left + 'px';
      if (pos.bottom != null) hud.style.bottom = pos.bottom + 'px';
    }
  } catch (_) {}
}

function saveGpsHudPosition() {
  const hud = document.getElementById('gps-hud');
  if (!hud) return;
  try {
    localStorage.setItem('planai_gps_prod_hud_pos', JSON.stringify({
      left: parseFloat(hud.style.left) || hud.offsetLeft,
      bottom: parseFloat(hud.style.bottom) || null,
    }));
  } catch (_) {}
}

function initGpsHudDrag() {
  const hud = document.getElementById('gps-hud');
  const handle = document.getElementById('gps-hud-chip');
  if (!hud || !handle) return;
  let drag = null;
  handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    clearTimeout(_gpsHudLongPressTimer);
    _gpsHudLongPressTimer = setTimeout(() => {
      _gpsHudLongPressTimer = null;
      if (!drag || !drag.moved) {
        _gpsHudLongPressFired = true;
        toggleGpsDebugMode();
      }
    }, 900);
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, l0: hud.offsetLeft, b0: hud.offsetTop, moved: false };
    hud.classList.add('dragging');
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
  });
  handle.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    if (Math.abs(e.clientX - drag.x0) > 8 || Math.abs(e.clientY - drag.y0) > 8) {
      drag.moved = true;
      clearTimeout(_gpsHudLongPressTimer);
    }
    const r = document.getElementById('canvas-wrap')?.getBoundingClientRect();
    if (!r) return;
    const nl = Math.max(4, drag.l0 + (e.clientX - drag.x0));
    const nb = Math.max(4, r.height - (drag.b0 + (e.clientY - drag.y0)) - hud.offsetHeight);
    hud.style.left = nl + 'px';
    hud.style.bottom = nb + 'px';
    touchGpsHudActivity();
  });
  const endDrag = e => {
    if (!drag || drag.id !== e.pointerId) return;
    clearTimeout(_gpsHudLongPressTimer);
    drag = null;
    hud.classList.remove('dragging');
    saveGpsHudPosition();
    try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
}

function initGpsFieldHud() {
  applyGpsDebugModeUi();
  applyGpsHudPosition();
  initGpsHudDrag();
  collapseGpsFieldHud();
}

function applyGpsTestPanelPosition() {
  try {
    const raw = localStorage.getItem('planai_gps_hud_pos');
    if (!raw) return;
    const pos = JSON.parse(raw);
    const p = document.getElementById('gps-test-panel');
    if (p && pos.left != null) {
      p.style.left = pos.left + 'px';
      if (pos.bottom != null) p.style.bottom = pos.bottom + 'px';
    }
  } catch (_) {}
}

function saveGpsTestPanelPosition() {
  const p = document.getElementById('gps-test-panel');
  if (!p) return;
  try {
    localStorage.setItem('planai_gps_hud_pos', JSON.stringify({
      left: parseFloat(p.style.left) || p.offsetLeft,
      bottom: parseFloat(p.style.bottom) || null,
    }));
  } catch (_) {}
}

function initGpsTestPanelDrag() {
  const panel = document.getElementById('gps-test-panel');
  const handle = document.getElementById('gps-test-chip');
  if (!panel || !handle) return;
  let drag = null;
  handle.addEventListener('pointerdown', e => {
    if (!panel.classList.contains('expanded') || e.button !== 0) return;
    if (e.target.closest('.gps-test-btns')) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, l0: panel.offsetLeft, b0: panel.offsetTop };
    panel.classList.add('dragging');
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}
  });
  handle.addEventListener('pointermove', e => {
    if (!drag || drag.id !== e.pointerId) return;
    const r = document.getElementById('canvas-wrap')?.getBoundingClientRect();
    if (!r) return;
    const nl = Math.max(4, drag.l0 + (e.clientX - drag.x0));
    const nb = Math.max(4, r.height - (drag.b0 + (e.clientY - drag.y0)) - panel.offsetHeight);
    panel.style.left = nl + 'px';
    panel.style.bottom = nb + 'px';
  });
  const endDrag = e => {
    if (!drag || drag.id !== e.pointerId) return;
    drag = null;
    panel.classList.remove('dragging');
    saveGpsTestPanelPosition();
    try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
}

function updateGpsTestChipLabel() {
  const chip = document.getElementById('gps-test-chip-label');
  const panel = document.getElementById('gps-test-panel');
  if (!chip) return;
  const label = gpsStatusLabel(_gpsStatus);
  const acc = _fieldGpsFix && _gpsStatus === 'connected' ? ' · ' + Math.round(_fieldGpsFix.accuracy || 0) + ' m' : '';
  chip.textContent = t('gps.pill') + ' · ' + label + acc;
  if (panel) {
    panel.classList.remove('gps-status-off', 'gps-status-searching', 'gps-status-connected',
      'gps-status-weak', 'gps-status-denied', 'gps-status-unavailable');
    panel.classList.add('gps-status-' + (_gpsStatus || 'off'));
  }
}

function updateGpsTestPanel() {
  if (!isGpsDebugMode()) return;
  updateGpsTestChipLabel();
  const coords = document.getElementById('gps-test-coords');
  const meta = document.getElementById('gps-test-meta');
  const watch = document.getElementById('gps-test-watch');
  const filt = document.getElementById('gps-test-filter');
  const fill = document.getElementById('gps-test-acc-fill');
  if (_fieldGpsFix) {
    if (coords) coords.textContent = 'lat: ' + _fieldGpsFix.lat.toFixed(6) + ' · lon: ' + _fieldGpsFix.lon.toFixed(6);
    const acc = _fieldGpsFix.accuracy;
    const hdg = _fieldGpsFix.heading;
    const spd = _fieldGpsFix.speed;
    const ts = _fieldGpsFix.ts ? new Date(_fieldGpsFix.ts).toLocaleTimeString() : '—';
    if (meta) meta.textContent = 'acc: ' + (acc != null ? Math.round(acc) + ' m' : '—') +
      ' · hdg: ' + (hdg != null && !isNaN(hdg) ? Math.round(hdg) + '°' : '—') +
      ' · spd: ' + (spd != null && !isNaN(spd) ? (spd * 3.6).toFixed(1) + ' km/h' : '—') +
      ' · ts: ' + ts;
    if (fill && acc != null) {
      const pct = Math.max(4, Math.min(100, 100 - (acc / 50) * 100));
      fill.style.width = pct + '%';
      fill.style.background = acc > 40 ? '#e74c3c' : acc > 18 ? '#f39c12' : '#27ae60';
    }
  } else {
    if (coords) coords.textContent = 'lat: — · lon: —';
    if (meta) meta.textContent = 'acc: — · hdg: — · spd: — · ts: —';
    if (fill) { fill.style.width = '0%'; fill.style.background = '#27ae60'; }
  }
  if (watch) {
    watch.textContent = 'status: ' + _gpsStatus +
      ' · watch: ' + (_gpsWatchId != null ? 'on' : 'off') +
      ' · ticks: ' + _gpsPositionTick +
      ' · track: ' + _gpsTrack.state + ' (' + _gpsTrack.points.length + ')';
  }
  if (filt) filt.textContent = 'track filter: ok ' + _gpsTestFilterStats.ok + ' · rej ' + _gpsTestFilterStats.rej;
}

function stopGpsWatchdog() {
  if (_gpsWatchdogTimer) clearInterval(_gpsWatchdogTimer);
  _gpsWatchdogTimer = null;
}

function restartGpsWatchOnly() {
  if (!_fieldGpsOn || !navigator.geolocation) return;
  if (_gpsWatchId != null) navigator.geolocation.clearWatch(_gpsWatchId);
  const optsHi = { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 };
  _gpsWatchId = navigator.geolocation.watchPosition(onGpsPosition, onGpsWatchError, optsHi);
  scheduleGpsFallbackFix();
  gpsDbgLog('GPS', 'watchPosition restarted');
}

function startGpsWatchdog() {
  stopGpsWatchdog();
  _gpsLastWatchTick = Date.now();
  _gpsWatchdogTimer = setInterval(() => {
    if (!_fieldGpsOn) return;
    const stale = Date.now() - _gpsLastWatchTick;
    if (stale > 16000) {
      gpsDbgLog('GPS', 'watchdog stale', stale + 'ms');
      restartGpsWatchOnly();
      _gpsLastWatchTick = Date.now();
    }
  }, 5000);
}

function initGpsTestBuild() {
  if (!GPS_TEST_BUILD) return;
  document.body.classList.add('gps-test-build');
  const panel = document.getElementById('gps-test-panel');
  if (panel) {
    panel.style.display = 'flex';
    panel.classList.add('collapsed');
    panel.classList.remove('expanded');
  }
  applyGpsTestPanelPosition();
  initGpsTestPanelDrag();
  gpsDbgLog('GPS', 'test build', PLANAI_FIELD_APP_VERSION, location.href);
  if (!gpsSecureContextOk()) {
    gpsDbgLog('GPS', 'WARN: not secure context — use http://PC_IP:8765/sketch-engine.html');
    showHint('GPS: localhost/LAN gerekli (file:// çalışmaz)', 12000);
  }
  refreshGpsTestPermission();
  updateGpsTestPanel();
}

function updateGpsGuidanceHud() {
  const el = document.getElementById('gps-hud-guidance');
  const hud = document.getElementById('gps-hud');
  const routeBtn = document.getElementById('btn-gps-show-route');
  if (!el) return;
  if (!_gpsGuidanceActive || !_gpsTarget) {
    el.style.display = 'none';
    el.textContent = '';
    el.classList.remove('arrived');
    hud?.classList.remove('gps-guidance-active');
    if (routeBtn) routeBtn.style.display = 'none';
    return;
  }
  hud?.classList.add('gps-guidance-active');
  if (routeBtn) routeBtn.style.display = '';
  el.style.display = 'block';
  const m = getGpsGuidanceMetrics();
  if (!m || m.arrived) {
    el.classList.add('arrived');
    el.textContent = t('guide.arrived');
    return;
  }
  el.classList.remove('arrived');
  const parts = [t('guide.route') + ' · ' + t('guide.walk')];
  if (m.bearing != null) parts.push(gpsHudTargetBearingArrow(m.bearing));
  if (m.distance != null) parts.push(formatGpsGuidanceDistance(m.distance));
  el.textContent = parts.join(' · ');
}

function updateGpsTrackHud() {
  const route = document.getElementById('gps-hud-route');
  const bPause = document.getElementById('btn-gps-pause');
  updateGpsGuidanceHud();
  if (_gpsTrack.state === 'idle') {
    if (route) {
      if (_gpsTrackReplay.pos) {
        route.textContent = (PA_LANG === 'tr' ? 'Rota oynatılıyor' : 'Track replay') +
          ' · ' + t('guide.replayPoint');
      } else route.textContent = '';
    }
    if (bPause) { bPause.disabled = true; bPause.textContent = '⏸'; bPause.classList.remove('active'); }
    return;
  }
  const dist = trackTotalDistanceM(_gpsTrack.points);
  const elapsed = Math.max(0, Date.now() - (_gpsTrack.startTs || Date.now()) - _gpsTrack.pauseMs);
  const mins = Math.floor(elapsed / 60000);
  const secs = Math.floor((elapsed % 60000) / 1000);
  if (route) {
    route.textContent = t('gps.hud.route') + ': ' +
      (_gpsTrack.state === 'recording' ? t('track.recording') : t('track.paused')) +
      ' · ' + formatLengthReport(dist) + ' · ' + mins + ':' + String(secs).padStart(2, '0');
  }
  if (bPause) {
    bPause.disabled = false;
    bPause.textContent = _gpsTrack.state === 'paused' ? '▶' : '⏸';
    bPause.title = _gpsTrack.state === 'paused' ? t('gps.resume') : t('gps.pause');
    bPause.classList.toggle('active', _gpsTrack.state === 'paused');
  }
  const l1 = document.getElementById('gps-hud-chip-line1');
  const l2 = document.getElementById('gps-hud-chip-line2');
  if (_fieldGpsOn && l1) {
    const lines = gpsHudCompactLines();
    l1.textContent = lines.line1;
    if (l2) l2.textContent = lines.line2 || '';
  }
}
let _projectDb = null;
let _projectSaveTimer = null;
let _projectAutosaveInterval = null;
let _projectSaving = false;
let _projectDirty = false;
const FIELD_AUTOSAVE_DEBOUNCE_MS = 800;
const FIELD_AUTOSAVE_INTERVAL_MS = 20000;
const FIELD_AUTOSAVE_LS_KEY = 'planai_field_autosave';

const PROJECT_DB_NAME = 'planai_field_db';
const PROJECT_DB_VER = 2;
const MAP_TILE_CACHE_MAX = 600;
const DEM_TILE_CACHE_MAX = 120;
const TILE_MISS_RETRY_MS = 8000;
const _tileCache = {};
const _tileLoadingSince = {};
let _tileLoadQueue = 0;
let _basemapRefreshTimer = null;
let _basemapZoomState = { z: -1, ideal: -1 };

const FIELD_IMPORT_ACCEPT =
  (typeof FieldFileBridge !== 'undefined' && FieldFileBridge.IMPORT_ACCEPT) ||
  '.kml,.kmz,.geojson,.json,.dxf,.gml,.xml,.shp,.dbf,.shx,.prj,.zip,.planai.zip,' +
  '.html,.htm,.pdf,.tif,.tiff,.geotiff,.png,.jpg,.jpeg,.webp,' +
  'application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz,' +
  'application/json,application/geo+json,application/xml,text/xml,text/html,text/plain,' +
  'application/pdf,application/zip,application/x-esri-shape,image/tiff,image/png,image/jpeg,image/webp';
const FIELD_IMPORT_FORMATS_HINT = 'ZIP · PDF · HTML · KML · KMZ · GeoJSON · GML · SHP · GeoTIFF · DXF';

const IMPORT_STYLE = {
  polygon:  { color:'#1a6fb5', fillColor:'rgba(26,111,181,0.15)', strokeWidth:3, opacity:1 },
  polyline: { color:'#d35400', strokeWidth:4, opacity:1 },
  point:    { color:'#27ae60', strokeWidth:2, r:10, opacity:1 },
};

const PLAN_OVERLAY_DEFAULT_OPACITY = 0.55;
/** CSB PlanGML / e-Plan — tek MPYY çözümleyici (tüm GML dosyaları). */
const PLAN_GML_OUTLINE_ONLY = new Set([
  'PlanSiniri', 'PlanDegisiklikSiniri', 'YapiYaklasmaSiniri', 'AdaKenari', 'YolCizgisi',
]);
const PLAN_GML_CONTAINER_TYPES = new Set([
  'AcikYesilAlan', 'TurizmAlani', 'KentselCalisma', 'EnerjiDagitimDepolama',
  'KonutAlani', 'TicaretAlani', 'SanayiAlani', 'MeclisKarariAlani',
]);
const PLAN_GML_TIP_KEYS = [
  'CalismaTip', 'TurizmTip', 'AcikYesilTip', 'EnerjiTesisTip', 'KonutTip', 'TicaretTip',
  'SanayiTip', 'EgitimTesisTip', 'AfetTip',
];
const PLAN_GML_STYLES = {
  _default: { color: '#546e7a', fillColor: 'transparent', strokeWidth: 2, hatchPattern: 'none', noFill: true },
  PlanSiniri: { color: '#0d47a1', fillColor: 'transparent', strokeWidth: 3.5, hatchPattern: 'none', noFill: true },
  PlanDegisiklikSiniri: { color: '#1565c0', fillColor: 'transparent', strokeWidth: 3, hatchPattern: 'none', noFill: true },
  AcikYesilAlan: { color: '#2e7d32', fillColor: 'transparent', strokeWidth: 2, hatchPattern: 'none', noFill: true },
  Park: { color: '#1b5e20', fillColor: 'rgba(56,142,60,0.68)', strokeWidth: 2, hatchPattern: 'parkDots', hatchColor: '#1a1a1a' },
  MilletBahcesi: { color: '#388e3c', fillColor: 'rgba(129,199,132,0.55)', strokeWidth: 2, hatchPattern: 'parkDots', hatchColor: '#1a1a1a' },
  RekreatifAlan: { color: '#43a047', fillColor: 'rgba(102,187,106,0.5)', strokeWidth: 2, hatchPattern: 'parkDots', hatchColor: '#1a1a1a' },
  ParkAlani: { color: '#1b5e20', fillColor: 'rgba(102,187,106,0.58)', strokeWidth: 2, hatchPattern: 'parkDots', hatchColor: '#1a1a1a' },
  KumsalPlaj: { color: '#f9a825', fillColor: 'rgba(255,236,179,0.58)', strokeWidth: 2, hatchPattern: 'diagonal' },
  TurizmAlani: { color: '#ef6c00', fillColor: 'rgba(255,152,0,0.72)', strokeWidth: 2, hatchPattern: 'stamp', hatchColor: '#212121' },
  OtelAlani: { color: '#e65100', fillColor: 'rgba(255,111,0,0.84)', strokeWidth: 2, hatchPattern: 'stamp', hatchColor: '#212121' },
  GunubirlikTesisAlani: { color: '#f57c00', fillColor: 'rgba(255,183,77,0.78)', strokeWidth: 2, hatchPattern: 'stamp', hatchColor: '#212121' },
  KonaklamaTesisAlani: { color: '#fb8c00', fillColor: 'rgba(255,167,38,0.55)', strokeWidth: 2, hatchPattern: 'stamp', hatchColor: '#212121' },
  KonutAlani: { color: '#c62828', fillColor: 'rgba(229,57,53,0.58)', strokeWidth: 2, hatchPattern: 'cross', hatchColor: '#212121' },
  TicaretAlani: { color: '#b71c1c', fillColor: 'rgba(229,57,53,0.62)', strokeWidth: 2, hatchPattern: 'cross', hatchColor: '#212121' },
  TicaretTurizmAlani: { color: '#1565c0', fillColor: 'rgba(255,152,0,0.88)', strokeWidth: 2, hatchPattern: 'grid', hatchColor: '#212121' },
  SanayiAlani: { color: '#6d4c41', fillColor: 'rgba(141,110,99,0.52)', strokeWidth: 2, hatchPattern: 'cross', hatchColor: '#212121' },
  EkoTurizmKirsalTurizmTesisAlani: { color: '#ef6c00', fillColor: 'rgba(255,183,77,0.72)', strokeWidth: 2, hatchPattern: 'stamp', hatchColor: '#212121' },
  TrafoAlani: { color: '#f57f17', fillColor: 'rgba(255,235,59,0.58)', strokeWidth: 2, hatchPattern: 'cross', hatchColor: '#795548' },
  EnerjiDagitimDepolama: { color: '#f9a825', fillColor: 'rgba(255,213,79,0.48)', strokeWidth: 2, hatchPattern: 'cross', hatchColor: '#6d4c41' },
  EgitimTesisAlani: { color: '#5c6bc0', fillColor: 'rgba(92,107,192,0.45)', strokeWidth: 2, hatchPattern: 'none' },
  SaglikTesisAlani: { color: '#ec407a', fillColor: 'rgba(236,64,122,0.42)', strokeWidth: 2, hatchPattern: 'none' },
  AfetTehlikeliAlanlar: { color: '#757575', fillColor: 'rgba(158,158,158,0.35)', strokeWidth: 2, hatchPattern: 'horizontal' },
  YapiYaklasmaSiniri: { color: '#d32f2f', fillColor: 'transparent', strokeWidth: 2.5, hatchPattern: 'none', lineStyle: 'dashed', noFill: true },
  AdaKenari: { color: '#546e7a', fillColor: 'transparent', strokeWidth: 1.8, hatchPattern: 'none', lineStyle: 'dashed', noFill: true },
  YolCizgisi: { color: '#37474f', strokeWidth: 2.5, hatchPattern: 'none', noFill: true },
  MeclisKarariAlani: { color: '#1565c0', fillColor: 'rgba(21,101,192,0.15)', strokeWidth: 2, hatchPattern: 'none' },
};
/** PlanGML dosyalarında TaramaTip yok — MPYY gösterim kodları tip alanından türetilir (mm @ 1:1000). */
const PLAN_GML_TIP_TARAMA = {
  OtelAlani: 'T-55', GunubirlikTesisAlani: 'T-55', KonaklamaTesisAlani: 'T-55',
  EkoTurizmKirsalTurizmTesisAlani: 'T-55', TurizmAlani: 'T-05',
  Park: 'T-91', ParkAlani: 'T-91', MilletBahcesi: 'T-01', RekreatifAlan: 'T-01',
  TicaretTurizmAlani: 'T-08', TicaretAlani: 'T-09', KonutAlani: 'T-14',
  SanayiAlani: 'T-20', TrafoAlani: 'T-20', EnerjiDagitimDepolama: 'T-20',
};
const PLAN_GML_PATTERN_TARAMA = {
  stamp: 'T-55', parkDots: 'T-91', grid: 'T-08', concentric: 'T-05', dots: 'T-55',
  cross: 'T-02', diagonal: 'T-12', horizontal: 'T-07',
};
/** MPYY tarama kodu → kağıt üzerinde hücre aralığı (mm, 1:1000 referans). */
const PLAN_GML_TARAMA_MM = {
  'T-55': 18, 'T-05': 4, 'T-91': 2.5, 'T-01': 4, 'T-08': 5, 'T-09': 5,
  'T-14': 4, 'T-02': 3, 'T-12': 4, 'T-07': 3, 'T-20': 3,
};
const PLAN_GML_SCALE_HATCH_PATTERNS = new Set([
  'stamp', 'parkDots', 'grid', 'concentric', 'dots',
]);
/** MPYY / gösterim kodu → katman adı (bilinmeyenler PlanGML fallback). */
const PLAN_GML_MPY_LAYER_MAP = {
  PlanSiniri: 'Plan Sınırı',
  PlanDegisiklikSiniri: 'Plan Değişiklik Sınırı',
  KonutAlani: 'Konut Alanı',
  TicaretAlani: 'Ticaret Alanı',
  SanayiAlani: 'Sanayi Alanı',
  TurizmAlani: 'Turizm Alanı',
  KumsalPlaj: 'Kumsal / Plaj',
  AcikYesilAlan: 'Açık Yeşil Alan',
  MilletBahcesi: 'Millet Bahçesi',
  RekreatifAlan: 'Rekreatif Alan',
  ParkAlani: 'Park Alanı',
  Park: 'Park',
  OtelAlani: 'Otel Alanı',
  GunubirlikTesisAlani: 'Günübirlik Tesis Alanı',
  KonaklamaTesisAlani: 'Konaklama Tesis Alanı',
  EgitimTesisAlani: 'Eğitim Tesis Alanı',
  SaglikTesisAlani: 'Sağlık Tesis Alanı',
  AfetTehlikeliAlanlar: 'Afet Tehlikeli Alan',
  YapiYaklasmaSiniri: 'Yapı Yaklaşma Sınırı',
  AdaKenari: 'Ada Kenarı',
  YolCizgisi: 'Yol',
  MeclisKarariAlani: 'Meclis Kararı Alanı',
  KentselCalisma: 'Kentsel Çalışma',
  TicaretTurizmAlani: 'Ticaret-Turizm Alanı',
  EkoTurizmKirsalTurizmTesisAlani: 'Eko / Kırsal Turizm',
  TrafoAlani: 'Trafo Alanı',
  EnerjiDagitimDepolama: 'Enerji Dağıtım / Depolama',
};
/** Bilinmeyen alt tip → ana MPYY stili. */
const PLAN_GML_TIP_ALIASES = {
  EkoTurizmKirsalTurizmTesisAlani: 'TurizmAlani',
};
const PLAN_GML_FALLBACK_LAYER = 'PlanGML İçe Aktarım';
const PLAN_OVERLAY_STYLE = {
  polygon:  { color:'#0d5a8a', fillColor:'rgba(13,90,138,0.22)', strokeWidth:2.5 },
  polyline: { color:'#c0392b', strokeWidth:3 },
  point:    { color:'#1e8449', r:8 },
  text:     { color:'#1a3358', fontSize:11 },
};
const FIELD_PLAN_OVERLAY_EXTS = new Set(['kml', 'kmz', 'geojson', 'json', 'gml', 'xml']);
const FIELD_RASTER_OVERLAY_EXTS = new Set(['tif', 'tiff', 'geotiff', 'png', 'jpg', 'jpeg', 'webp']);
const PLAN_RASTER_MAX_PX = 2048;
const PLAN_RASTER_JPEG_Q = 0.78;
let _activePlanOverlayLayerId = null;

function importStyleFor(kind, props) {
  const d = IMPORT_STYLE[kind] || IMPORT_STYLE.polyline;
  const strokeW = parseFloat(props?.strokeWidth ?? props?.['stroke-width'] ?? props?.weight);
  const stroke = props?.stroke || props?.color || props?.line;
  const fill = props?.fill;
  const op = parseFloat(props?.['fill-opacity'] ?? props?.fillOpacity);
  return {
    color: (typeof stroke === 'string' && stroke) ? stroke : d.color,
    fillColor: (typeof fill === 'string' && fill)
      ? (fill.startsWith('#') && !isNaN(op) ? hexToRgba(fill, op) : fill)
      : d.fillColor,
    strokeWidth: !isNaN(strokeW) && strokeW > 0 ? Math.max(3, strokeW) : d.strokeWidth,
    opacity: d.opacity,
    r: d.r,
  };
}

function hexToRgba(hex, a) {
  const h = hex.replace('#','');
  const n = h.length === 3 ? h.split('').map(c => c+c).join('') : h;
  const r = parseInt(n.slice(0,2),16), g = parseInt(n.slice(2,4),16), b = parseInt(n.slice(4,6),16);
  return `rgba(${r},${g},${b},${isNaN(a) ? 0.15 : a})`;
}

function isFieldImportChildLayer(layer) {
  if (!layer || !layer.id) return false;
  if (layer.id === 'imported' || isPlanOverlayLayer(layer)) return false;
  const id = layer.id;
  return id.startsWith('import_') || id.startsWith('dxf_') || id.startsWith('gml_');
}

function getNextImportLayerNumber() {
  let max = 0;
  S.layers.forEach(l => {
    if (isFieldImportChildLayer(l) && l.importNum) max = Math.max(max, l.importNum);
  });
  return max + 1;
}

function ensureImportLayerNumbers() {
  const layers = S.layers.filter(isFieldImportChildLayer)
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  layers.forEach((l, i) => { l.importNum = i + 1; });
}

function getFieldImportLayersSorted() {
  ensureImportLayerNumbers();
  return S.layers.filter(isFieldImportChildLayer)
    .sort((a, b) => (a.importNum || 0) - (b.importNum || 0));
}

/** Plan overlay vector imports + import_/gml_/dxf_ child layers for layer panel. */
function getFieldImportPanelEntries() {
  ensureImportLayerNumbers();
  const entries = [];
  getPlanOverlayLayers().forEach(layer => {
    const geomN = S.objects.filter(o =>
      (o.layerId || '') === layer.id && o._import && o.type !== 'georef_image'
    ).length;
    if (geomN > 0) entries.push({ layer, geomN, overlay: true });
  });
  getFieldImportLayersSorted().forEach(layer => {
    const geomN = S.objects.filter(o => (o.layerId || '') === layer.id).length;
    if (geomN > 0) entries.push({ layer, geomN, overlay: false });
  });
  return entries;
}

function freshGeoBounds() {
  return { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity, ok: false };
}

function copyGeoBounds(b) {
  if (!b?.ok) return null;
  return { minLat: b.minLat, maxLat: b.maxLat, minLon: b.minLon, maxLon: b.maxLon, ok: true };
}

function expandCoordBounds(b, lat, lon) {
  if (lat == null || lon == null || !isFinite(lat) || !isFinite(lon)) return;
  expandBounds(b, lat, lon);
}

/** WGS84 extent from import/overlay objects (not canvas-relative world coords). */
function expandObjectGeoBounds(b, o) {
  if (!o) return;
  if (o.type === 'georef_image') {
    if (o.wgsBounds?.ok) {
      expandBounds(b, o.wgsBounds.minLat, o.wgsBounds.minLon);
      expandBounds(b, o.wgsBounds.maxLat, o.wgsBounds.maxLon);
    }
    return;
  }
  if (o.lat != null && o.lon != null) expandCoordBounds(b, o.lat, o.lon);
  (o.vertices || []).forEach(c => {
    if (!c) return;
    if (c.lat != null) expandCoordBounds(b, c.lat, c.lon);
    else if (Array.isArray(c) && c.length >= 2) expandCoordBounds(b, c[1], c[0]);
  });
  const ringLists = [...(o.rings || []), ...(o.holes || [])];
  ringLists.forEach(ring => {
    (ring || []).forEach(c => {
      if (!c) return;
      if (typeof c === 'object' && c.lat != null) expandCoordBounds(b, c.lat, c.lon);
      else if (Array.isArray(c) && c.length >= 2) expandCoordBounds(b, c[1], c[0]);
    });
  });
}

function savePlanOverlayGeoExtent(layerId, bounds) {
  const snap = copyGeoBounds(bounds);
  if (!snap) return;
  const layer = S.layers.find(l => l.id === layerId);
  if (layer) layer.geoExtent = snap;
}

function refreshPlanOverlayGeoExtents() {
  getPlanOverlayLayers().forEach(layer => {
    const b = freshGeoBounds();
    S.objects.filter(o => (o.layerId || '') === layer.id).forEach(o => expandObjectGeoBounds(b, o));
    if (b.ok) savePlanOverlayGeoExtent(layer.id, b);
    else if (layer.geoExtent) delete layer.geoExtent;
  });
}

function boundsForImportLayer(layerId) {
  const b = freshGeoBounds();
  S.objects.filter(o => (o.layerId || '') === layerId).forEach(o => expandObjectGeoBounds(b, o));
  return b;
}

function boundsWorldFromGeorefCorners(corners) {
  if (!corners) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const k of ['tl', 'tr', 'br', 'bl']) {
    const p = corners[k];
    if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  if (!isFinite(minX)) return null;
  return { minX, minY, maxX, maxY, ok: true };
}

function planOverlayWorldBounds(layerId) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, ok = false;
  S.objects.filter(o => (o.layerId || '') === layerId && o.type === 'georef_image').forEach(o => {
    const wb = boundsWorldFromGeorefCorners(o.corners);
    if (!wb) return;
    ok = true;
    minX = Math.min(minX, wb.minX);
    maxX = Math.max(maxX, wb.maxX);
    minY = Math.min(minY, wb.minY);
    maxY = Math.max(maxY, wb.maxY);
  });
  return ok ? { minX, minY, maxX, maxY, ok: true } : { ok: false };
}

function boundsForPlanOverlayLayer(layerId) {
  const b = freshGeoBounds();
  S.objects.filter(o => (o.layerId || '') === layerId).forEach(o => expandObjectGeoBounds(b, o));
  return b;
}

function goToPlanOverlayLayer(layerId, ev) {
  ev?.stopPropagation?.();
  const layer = S.layers.find(l => l.id === layerId);
  if (!layer || !isPlanOverlayLayer(layer)) return;
  _activePlanOverlayLayerId = layerId;
  const objs = S.objects.filter(o => (o.layerId || '') === layerId);

  // Raster: always use canvas corner positions (where the image is actually drawn).
  const wb = planOverlayWorldBounds(layerId);
  if (wb.ok) {
    fitMapToWorldBounds(wb.minX, wb.minY, wb.maxX, wb.maxY);
    showHint(t('layer.go') + ': ' + (layer.name || layerId));
    openPlanOverlayPanel(layerId);
    buildLayerPanel();
    scheduleRender();
    return;
  }

  // Vector overlay: WGS84 from live geometry (ignore stale cached geoExtent).
  const b = freshGeoBounds();
  objs.forEach(o => expandObjectGeoBounds(b, o));
  if (b.ok) {
    fitMapToLatLonBounds(b);
    savePlanOverlayGeoExtent(layerId, b);
    showHint(t('layer.go') + ': ' + (layer.name || layerId));
  } else if (layer.geoExtent?.ok) {
    fitMapToLatLonBounds(layer.geoExtent);
    showHint(t('layer.go') + ': ' + (layer.name || layerId));
  } else {
    showHint(t('layer.goMissing'));
  }
  openPlanOverlayPanel(layerId);
  buildLayerPanel();
  scheduleRender();
}

function selectImportLayerFromPanel(layerId) {
  const layer = S.layers.find(l => l.id === layerId);
  if (!layer || !isFieldImportChildLayer(layer)) return;
  setActiveLayer(layerId);
  const b = boundsForImportLayer(layerId);
  if (b.ok) fitMapToLatLonBounds(b);
  S.selectedIds = [];
  setDeleteButtonVisible(false);
  updateFieldRightPanel(null);
  buildLayerPanel();
  scheduleRender();
}

function ensureImportLayer(name) {
  const slug = (name || 'import').replace(/\.[^.]+$/,'').slice(0, 28).replace(/[^a-zA-Z0-9_-]+/g, '_') || 'import';
  const id = 'import_' + slug;
  if (!S.layers.find(l => l.id === id)) {
    const order = 5 + S.layers.filter(l => l.id.startsWith('import_')).length;
    S.layers.push({
      id, name: name || 'İçe Aktarılan', color:'#2980b9', order, visible:true, locked:false,
      importNum: getNextImportLayerNumber(),
    });
  } else {
    const L = S.layers.find(l => l.id === id);
    if (L) L.visible = true;
  }
  return id;
}

function isPlanOverlayLayer(layerOrId) {
  const id = typeof layerOrId === 'string' ? layerOrId : layerOrId?.id;
  const layer = S.layers.find(l => l.id === id);
  return !!(layer && (layer.planOverlay || (id && id.startsWith('overlay_'))));
}

function getPlanOverlayLayers() {
  return S.layers.filter(l => isPlanOverlayLayer(l)).sort((a, b) => (a.order || 0) - (b.order || 0));
}

function ensurePlanOverlayLayer(name) {
  const base = (name || 'plan').replace(/\.[^.]+$/,'').slice(0, 32).replace(/[^a-zA-Z0-9_-]+/g, '_') || 'plan';
  const id = 'overlay_' + base;
  let layer = S.layers.find(l => l.id === id);
  const displayName = (name || 'Plan').replace(/\.[^.]+$/i, '');
  if (!layer) {
    const order = 0;
    layer = {
      id,
      name: displayName,
      color: '#2980b9',
      order,
      visible: true,
      locked: true,
      planOverlay: true,
      overlayOpacity: PLAN_OVERLAY_DEFAULT_OPACITY,
    };
    S.layers.push(layer);
  } else {
    layer.visible = true;
    layer.planOverlay = true;
    if (layer.overlayOpacity == null) layer.overlayOpacity = PLAN_OVERLAY_DEFAULT_OPACITY;
  }
  _activePlanOverlayLayerId = id;
  return id;
}

function planOverlayStyleFor(kind) {
  return PLAN_OVERLAY_STYLE[kind] || PLAN_OVERLAY_STYLE.polyline;
}

function planGmlNormalizeFeatureType(ft) {
  return String(ft || '').replace(/^.*:/, '');
}

const PLAN_GML_TIP_BY_FEATURE = {
  KentselCalisma: 'CalismaTip',
  TurizmAlani: 'TurizmTip',
  AcikYesilAlan: 'AcikYesilTip',
  EnerjiDagitimDepolama: 'EnerjiTesisTip',
  KonutAlani: 'KonutTip',
  TicaretAlani: 'TicaretTip',
  SanayiAlani: 'CalismaTip',
};

function planGmlResolveTip(props, featureType) {
  if (!props) return '';
  const ft = planGmlNormalizeFeatureType(featureType);
  const primary = PLAN_GML_TIP_BY_FEATURE[ft];
  if (primary) {
    const v = String(props[primary] || '').trim();
    if (v) return v;
    return '';
  }
  for (let i = 0; i < PLAN_GML_TIP_KEYS.length; i++) {
    const v = String(props[PLAN_GML_TIP_KEYS[i]] || '').trim();
    if (v) return v;
  }
  return '';
}

function planGmlFeatureCoordKey(nums, kind) {
  const p = kind === 'line' ? 'L:' : 'P:';
  return p + (nums || []).slice(0, 12).join(',');
}

function planGmlDrawOrder(obj) {
  if (!obj._planOverlay || obj.type !== 'import_polygon' || !isPlanGmlImportObj(obj)) return 40;
  const attrs = planGmlInferProps(obj);
  const ft = planGmlNormalizeFeatureType(obj.metadata?.planFeatureType || attrs.PlanFeatureType);
  if (planGmlIsOutlineOnly(ft)) return 5;
  const tip = planGmlResolveTip(attrs, ft);
  if (tip === 'Park' || ft === 'AcikYesilAlan') return 22;
  if (ft === 'TurizmAlani' || tip === 'OtelAlani' || tip === 'GunubirlikTesisAlani' || tip === 'KonaklamaTesisAlani') return 58;
  if (ft === 'KentselCalisma' || tip === 'TicaretTurizmAlani' || tip === 'TicaretAlani' || tip === 'KonutAlani') return 52;
  return 35;
}

function planGmlIsOutlineOnly(featureType) {
  return PLAN_GML_OUTLINE_ONLY.has(planGmlNormalizeFeatureType(featureType));
}

function planGmlApplyOutlineOnly(style) {
  const base = style || PLAN_GML_STYLES._default;
  return {
    ...base,
    fillColor: 'transparent',
    hatchPattern: 'none',
    noFill: true,
  };
}

function planGmlResolvePresentation(featureType, props) {
  const ft = planGmlNormalizeFeatureType(featureType);
  const tip = planGmlResolveTip(props, ft);
  const mPerPx = typeof pxToMeters === 'function' ? pxToMeters(1) : null;

  if (typeof MpyyPlanGmlCatalog !== 'undefined' && MpyyPlanGmlCatalog.isReady()) {
    const planLevel = MpyyPlanGmlCatalog.resolvePlanLevel(S.projectScale || 1000);

    if (planGmlIsOutlineOnly(ft) || planGmlIsOutlineOnly(tip)) {
      const brec = MpyyPlanGmlCatalog.lookupBoundary(ft, props || {}, planLevel);
      if (brec) {
        return MpyyPlanGmlCatalog.boundaryPresentationFromRecord(brec, S.projectScale, mPerPx);
      }
    }

    let rec = MpyyPlanGmlCatalog.lookup(ft, tip, planLevel);
    if (!rec && tip) rec = MpyyPlanGmlCatalog.lookup('', tip, planLevel);
    if (!rec && props?.Adi) rec = MpyyPlanGmlCatalog.lookupByLabel(props.Adi, planLevel);
    if (!rec && props?.PlanAdi) rec = MpyyPlanGmlCatalog.lookupByLabel(props.PlanAdi, planLevel);
    if (rec) return MpyyPlanGmlCatalog.presentationFromRecord(rec);
  }

  if (planGmlIsOutlineOnly(ft) || planGmlIsOutlineOnly(tip)) {
    return planGmlApplyOutlineOnly(PLAN_GML_STYLES[ft] || PLAN_GML_STYLES._default);
  }

  if (tip && PLAN_GML_STYLES[tip]) {
    const tarama = PLAN_GML_TIP_TARAMA[tip] || '';
    return tarama ? { ...PLAN_GML_STYLES[tip], taramaCode: tarama } : { ...PLAN_GML_STYLES[tip] };
  }
  if (tip && PLAN_GML_TIP_ALIASES[tip] && PLAN_GML_STYLES[PLAN_GML_TIP_ALIASES[tip]]) {
    return { ...PLAN_GML_STYLES[PLAN_GML_TIP_ALIASES[tip]] };
  }

  if (PLAN_GML_CONTAINER_TYPES.has(ft) && !tip) {
    return planGmlApplyOutlineOnly(PLAN_GML_STYLES._default);
  }

  if (PLAN_GML_STYLES[ft]) return { ...PLAN_GML_STYLES[ft] };
  return planGmlApplyOutlineOnly(PLAN_GML_STYLES._default);
}

function planGmlStyleForFeature(featureType, props) {
  return planGmlResolvePresentation(featureType, props);
}

function planGmlInferProps(obj) {
  const attrs = { ...getObjectFeatureAttrs(obj) };
  const ft = planGmlNormalizeFeatureType(obj.metadata?.planFeatureType || attrs.PlanFeatureType);
  if (ft && !attrs.PlanFeatureType) attrs.PlanFeatureType = ft;
  if (planGmlIsOutlineOnly(ft)) return attrs;
  if (planGmlResolveTip(attrs, ft)) return attrs;

  const adiRaw = String(attrs.Adi || attrs.PlanAdi || obj.metadata?.planLabel || obj.metadata?.name || '').trim();
  const u = adiRaw.toUpperCase()
    .replace(/İ/g, 'I').replace(/İ/g, 'I').replace(/Ü/g, 'U').replace(/Ö/g, 'O').replace(/Ş/g, 'S').replace(/Ç/g, 'C').replace(/Ğ/g, 'G');

  if (ft === 'TurizmAlani') {
    if (/OTEL/.test(u)) attrs.TurizmTip = 'OtelAlani';
    else if (/GUNUBIRLIK/.test(u)) attrs.TurizmTip = 'GunubirlikTesisAlani';
    else if (/EKO.*TUR|KIRSAL.*TUR/.test(u)) attrs.TurizmTip = 'EkoTurizmKirsalTurizmTesisAlani';
    return attrs;
  }
  if (ft === 'AcikYesilAlan') {
    if (/^PARK$/i.test(adiRaw)) attrs.AcikYesilTip = 'Park';
    return attrs;
  }
  if (ft === 'KentselCalisma') {
    if (/TICARET.*TURIZM|TİCARET.*TURİZM/.test(u)) attrs.CalismaTip = 'TicaretTurizmAlani';
    else if (/TICARET/.test(u)) attrs.CalismaTip = 'TicaretAlani';
    else if (/KONUT/.test(u)) attrs.CalismaTip = 'KonutAlani';
    return attrs;
  }
  if (ft === 'EnerjiDagitimDepolama' || /TRAFO|GÜNEŞ|GUNES|ENERJI|ENERJİ/i.test(u)) {
    if (/GÜNEŞ|GUNES|YENILENEBILIR|YENİLENEBİLİR/i.test(u)) {
      attrs.EnerjiTesisTip = 'YenilenebilirEnerjiKaynaklarinaDayaliUretimTesisiAlani';
    } else if (/TRAFO/.test(u) || ft === 'EnerjiDagitimDepolama') {
      attrs.EnerjiTesisTip = attrs.EnerjiTesisTip || 'TrafoAlani';
    }
  }
  if (ft === 'KentselCalisma' && /SANAYI|SANAYİ/i.test(u) && !attrs.CalismaTip) {
    attrs.CalismaTip = 'SanayiAlani';
  }
  return attrs;
}

function isPlanGmlImportObj(obj) {
  if (!obj) return false;
  if (obj._planGmlStyled || obj.metadata?.source === 'plan-gml') return true;
  if (!obj._planOverlay) return false;
  const ft = planGmlNormalizeFeatureType(obj.metadata?.planFeatureType || obj.metadata?.attributes?.PlanFeatureType);
  if (ft && (PLAN_GML_STYLES[ft] || PLAN_GML_MPY_LAYER_MAP[ft] || planGmlIsOutlineOnly(ft))) return true;
  const a = obj.metadata?.attributes;
  if (a && planGmlResolveTip(a, ft)) return true;
  if (typeof MpyyPlanGmlCatalog !== 'undefined' && MpyyPlanGmlCatalog.isReady() && ft) {
    const planLevel = MpyyPlanGmlCatalog.resolvePlanLevel(S.projectScale || 1000);
    const tip = planGmlResolveTip(a || {}, ft);
    if (MpyyPlanGmlCatalog.lookupBoundary(ft, a || {}, planLevel)) return true;
    if (MpyyPlanGmlCatalog.lookup(ft, tip, planLevel)) return true;
    if (a?.Adi && MpyyPlanGmlCatalog.lookupByLabel(a.Adi, planLevel)) return true;
  }
  return false;
}

function planGmlStyleForObject(obj) {
  if (!isPlanGmlImportObj(obj)) return null;
  const attrs = planGmlInferProps(obj);
  const ft = obj.metadata?.planFeatureType || attrs.PlanFeatureType || '';
  return planGmlStyleForFeature(ft, attrs);
}

function planGmlShortLabel(attrs, planFeatureType) {
  if (!attrs) return '';
  const ft = String(planFeatureType || attrs.PlanFeatureType || '').replace(/^.*:/, '');
  if (/PlanDegisiklikSiniri|PlanSiniri|YapiYaklasma|AdaKenari|YolCizgisi/i.test(ft)) return '';
  const calisma = String(attrs.CalismaTip || '').trim();
  if (calisma === 'TicaretTurizmAlani') return 'TİCT';
  if (calisma === 'TicaretAlani') return 'TİC';
  if (calisma === 'KonutAlani') return 'KON';
  const adi = String(attrs.Adi || attrs.PlanAdi || '').trim();
  const tip = String(attrs.TurizmTip || attrs.AcikYesilTip || attrs.KonutTip || '').trim();

  if (typeof MpyyPlanGmlCatalog !== 'undefined' && MpyyPlanGmlCatalog.isReady()) {
    const planLevel = MpyyPlanGmlCatalog.resolvePlanLevel(S.projectScale || 1000);
    const mpyyCode = MpyyPlanGmlCatalog.symbolCodeFor(ft, tip, adi, planLevel);
    if (mpyyCode) return mpyyCode;
  }

  if (tip === 'OtelAlani' || /otel/i.test(adi)) return 'OTEL';
  if (tip === 'GunubirlikTesisAlani' || /günübirlik|gunubirlik/i.test(adi)) return 'G';
  if (tip === 'EkoTurizmKirsalTurizmTesisAlani' || /eko.*tur|kırsal.*tur/i.test(adi)) return 'EKO';
  if (tip === 'Park' || /^park$/i.test(adi)) return 'PARK';
  if (adi.length >= 2 && adi.length <= 14) return adi.toUpperCase();
  return '';
}

function planGmlMapLabelLines(attrs, planFeatureType) {
  if (!attrs) return [];
  const ft = planGmlNormalizeFeatureType(planFeatureType || attrs.PlanFeatureType);
  if (planGmlIsOutlineOnly(ft)) return [];
  const tip = planGmlResolveTip(attrs, ft);
  if (!tip && PLAN_GML_CONTAINER_TYPES.has(ft)) return [];
  const lines = [];
  const short = planGmlShortLabel(attrs, planFeatureType);
  if (short) lines.push(short);
  const emsalRaw = attrs.EmsalKaks ?? attrs.Emsal;
  if (emsalRaw != null && emsalRaw !== '' && String(emsalRaw) !== '0') {
    const n = parseFloat(String(emsalRaw).replace(',', '.'));
    if (!isNaN(n) && n > 0) {
      const emsalTxt = Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '');
      lines.push('E = ' + emsalTxt);
    }
  }
  return lines;
}

function applyPlanGmlStyleToObject(obj, ps) {
  if (!ps) return;
  obj.color = ps.color;
  obj.strokeWidth = ps.strokeWidth ?? obj.strokeWidth;
  if (ps.noFill) {
    obj.fillColor = 'transparent';
    obj.hatchPattern = 'none';
    delete obj.hatchColor;
    delete obj.taramaCode;
    delete obj.hatchMm;
  } else {
    obj.fillColor = ps.fillColor;
    obj.hatchPattern = ps.hatchPattern || 'none';
    if (ps.hatchColor) obj.hatchColor = ps.hatchColor;
    else delete obj.hatchColor;
    if (ps.taramaCode) obj.taramaCode = ps.taramaCode;
    else delete obj.taramaCode;
    if (ps.hatchMm != null && ps.hatchMm > 0) obj.hatchMm = ps.hatchMm;
    else delete obj.hatchMm;
  }
  if (ps.lineStyle) obj.lineStyle = ps.lineStyle;
  else if (obj.type === 'import_polyline' && obj.lineStyle === 'dashed' && !ps.lineStyle) obj.lineStyle = 'solid';
  if (ps.boundaryPattern) {
    obj.boundaryPattern = ps.boundaryPattern;
    obj.boundaryParams = ps.boundaryParams || null;
    obj.boundaryPeriodMm = ps.boundaryPeriodMm || null;
    if (ps.boundaryDash?.length) obj.boundaryDash = ps.boundaryDash.slice();
    else delete obj.boundaryDash;
  } else {
    delete obj.boundaryPattern;
    delete obj.boundaryParams;
    delete obj.boundaryPeriodMm;
    delete obj.boundaryDash;
  }
  if (ps.mpyyRecordId) obj.mpyyRecordId = ps.mpyyRecordId;
  else delete obj.mpyyRecordId;
  obj._planGmlStyled = true;
}

function refreshPlanGmlPresentation() {
  S.objects.forEach(obj => {
    if (!isPlanGmlImportObj(obj)) return;
    if (obj.type !== 'import_polygon' && obj.type !== 'import_polyline') return;
    const attrs = planGmlInferProps(obj);
    if (!obj.metadata) obj.metadata = {};
    obj.metadata.source = 'plan-gml';
    obj.metadata.attributes = { ...(obj.metadata.attributes || {}), ...attrs };
    if (!obj.metadata.planFeatureType && attrs.PlanFeatureType) obj.metadata.planFeatureType = attrs.PlanFeatureType;
    const ps = planGmlResolvePresentation(obj.metadata.planFeatureType || attrs.PlanFeatureType, attrs);
    applyPlanGmlStyleToObject(obj, ps);
  });
}

function importObjGeoArea(obj) {
  if (obj?.type !== 'import_polygon') return 0;
  const ring = obj.rings?.[0];
  if (!ring || ring.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    a += ring[i].lon * ring[j].lat - ring[j].lon * ring[i].lat;
  }
  return Math.abs(a * 0.5);
}

function gmlXmlParent(el) {
  const p = el?.parentElement ?? el?.parentNode;
  return p && p.nodeType === 1 ? p : null;
}

function planGmlReadFeatureProps(parentEl) {
  if (!parentEl) return {};
  return gmlAttrs(parentEl);
}

function planGmlBuildMeta(f, layerName, isPlanGml) {
  const attrs = planGmlMergeAttributes(f);
  const meta = {
    source: isPlanGml ? 'plan-gml' : 'gml',
    attributes: attrs,
    layer: layerName,
    planFeatureType: f.planFeatureType || null,
    planLabel: f.planFeatureLabel || layerName,
    name: attrs.Adi || attrs.PlanAdi || f.planFeatureLabel || layerName,
  };
  return meta;
}

function planGmlMergeAttributes(f) {
  const raw = { ...(f.props || {}) };
  if (f.planFeatureType) raw.PlanFeatureType = f.planFeatureType;
  if (f.planFeatureLabel && !raw.Adi) raw.Adi = f.planFeatureLabel;
  return typeof SpatialSecurity !== 'undefined'
    ? SpatialSecurity.sanitizeProperties(raw)
    : raw;
}

const PLAN_GML_ATTR_LABELS = {
  PlanFeatureType: 'Plan öğesi',
  Adi: 'Ad',
  PlanAdi: 'Plan adı',
  EmsalKaks: 'Emsal (KAKS)',
  EmsalKaksTip: 'Emsal tipi',
  Taks: 'TAKS',
  TaksTip: 'TAKS tipi',
  YapiYuksekligi: 'Yapı yüksekliği',
  YapiYuksekligiTip: 'Yükseklik tipi',
  KatAdedi: 'Kat adedi',
  OnBahceMesafesi: 'Ön bahçe',
  YanBahceMesafesi: 'Yan bahçe',
  ArkaBahceMesafesi: 'Arka bahçe',
  YapiDuzeni: 'Yapı nizamı',
  CalismaTip: 'Çalışma tipi',
  EnerjiTesisTip: 'Enerji tesis tipi',
  TurizmTip: 'Turizm tipi',
  AcikYesilTip: 'Yeşil alan tipi',
  KonutTip: 'Konut tipi',
  TicaretTip: 'Ticaret tipi',
  Pin: 'PIN',
  Nitelik: 'Nitelik',
  GosterimKodu: 'Gösterim kodu',
  GosterimDetayKodu: 'Detay kodu',
};

const PLAN_OVERLAY_HATCH_MIN_SCALE = 0.28;
const PLAN_GML_LABEL_MIN_SCALE = 0.35;
const PLAN_GML_RING_SIMPLIFY = 48;

function planGmlAnnotateFeature(f, parentEl) {
  if (parentEl) {
    f.planFeatureType = parentEl.localName || gmlLocalName(parentEl);
  } else if (!f.planFeatureType && f.props?.PlanFeatureType) {
    f.planFeatureType = f.props.PlanFeatureType;
  }
  f.planFeatureLabel = f.props?.Adi || f.props?.PlanAdi || f.layer || f.planFeatureType;
}

function planGmlResolveLayerName(f) {
  const props = f.props || {};
  const gk = props.GosterimKodu || props.GosterimDetayKodu || props.GosterimKod || props.DetayKodu || props.MpyyKodu;
  if (gk && PLAN_GML_MPY_LAYER_MAP[gk]) return PLAN_GML_MPY_LAYER_MAP[gk];
  if (gk) return 'Plan · ' + gk;
  const ft = String(f.planFeatureType || '').replace(/^.*:/, '');
  if (props.CalismaTip && PLAN_GML_MPY_LAYER_MAP[props.CalismaTip]) return PLAN_GML_MPY_LAYER_MAP[props.CalismaTip];
  if (props.TurizmTip && PLAN_GML_MPY_LAYER_MAP[props.TurizmTip]) return PLAN_GML_MPY_LAYER_MAP[props.TurizmTip];
  if (props.AcikYesilTip && PLAN_GML_MPY_LAYER_MAP[props.AcikYesilTip]) return PLAN_GML_MPY_LAYER_MAP[props.AcikYesilTip];
  if (props.EnerjiTesisTip && PLAN_GML_MPY_LAYER_MAP[props.EnerjiTesisTip]) return PLAN_GML_MPY_LAYER_MAP[props.EnerjiTesisTip];
  if (ft && PLAN_GML_MPY_LAYER_MAP[ft]) return PLAN_GML_MPY_LAYER_MAP[ft];
  if (f.planFeatureLabel && f.planFeatureLabel !== ft && f.planFeatureLabel !== 'Plan') return f.planFeatureLabel;
  if (ft && !/^(featuremember|featurecollection|geometryproperty)$/i.test(ft)) return ft;
  return PLAN_GML_FALLBACK_LAYER;
}

function stampPlanOverlayObject(obj, layerId, layerOpacity) {
  const op = layerOpacity ?? PLAN_OVERLAY_DEFAULT_OPACITY;
  obj.layerId = layerId;
  obj._planOverlay = true;
  obj._import = true;
  obj.locked = true;
  obj.visible = obj.visible !== false;
  obj.opacity = op;
  if (obj.type === 'import_polygon' && !obj._planGmlStyled) {
    const s = planOverlayStyleFor('polygon');
    obj.color = s.color;
    obj.fillColor = s.fillColor;
    obj.strokeWidth = s.strokeWidth;
  } else if (obj.type === 'import_polyline' && !obj._planGmlStyled) {
    const s = planOverlayStyleFor('polyline');
    obj.color = s.color;
    obj.strokeWidth = s.strokeWidth;
  } else if (obj.type === 'import_point') {
    const s = planOverlayStyleFor('point');
    obj.color = s.color;
    obj.r = s.r;
  } else if (obj.type === 'import_text') {
    const s = planOverlayStyleFor('text');
    obj.color = s.color;
    obj.fontSize = s.fontSize;
  }
}

function applyPlanOverlayOpacityToLayer(layerId, opacity) {
  const layer = S.layers.find(l => l.id === layerId);
  if (!layer) return;
  const op = Math.max(0.05, Math.min(1, +opacity || PLAN_OVERLAY_DEFAULT_OPACITY));
  layer.overlayOpacity = op;
  S.objects.forEach(o => {
    if ((o.layerId || '') !== layerId) return;
    if (o._planOverlay || o.type === 'georef_image') o.opacity = op;
  });
  scheduleRender();
  scheduleProjectSave();
}

function onPlanOverlayOpacityInput(val) {
  if (!_activePlanOverlayLayerId) return;
  applyPlanOverlayOpacityToLayer(_activePlanOverlayLayerId, val);
  const el = document.getElementById('plan-overlay-op-val');
  if (el) el.textContent = Math.round(+val * 100) + '%';
}

function openPlanOverlayPanel(layerId) {
  const panel = document.getElementById('plan-overlay-panel');
  if (!panel) return;
  const layer = S.layers.find(l => l.id === layerId);
  if (!layer || !isPlanOverlayLayer(layer)) return;
  _activePlanOverlayLayerId = layerId;
  const title = document.getElementById('plan-overlay-title');
  const slider = document.getElementById('plan-overlay-opacity');
  const opVal = document.getElementById('plan-overlay-op-val');
  const op = layer.overlayOpacity ?? PLAN_OVERLAY_DEFAULT_OPACITY;
  if (title) {
    const kind = layer.overlayKind === 'raster' ? 'Plan raster' : 'Plan vektör';
    title.textContent = (layer.name || 'Plan') + ' · ' + kind;
  }
  if (slider) slider.value = op;
  if (opVal) opVal.textContent = Math.round(op * 100) + '%';
  panel.classList.add('open');
}

function closePlanOverlayPanel() {
  document.getElementById('plan-overlay-panel')?.classList.remove('open');
}

function toggleActivePlanOverlayVisibility() {
  if (!_activePlanOverlayLayerId) return;
  toggleLayerVisibility(_activePlanOverlayLayerId);
  scheduleRender();
}

function removeActivePlanOverlay() {
  if (!_activePlanOverlayLayerId) return;
  const lid = _activePlanOverlayLayerId;
  S.objects.filter(o => (o.layerId || '') === lid && o.type === 'georef_image').forEach(o => deletePlanRasterBlob(o.id));
  S.objects = S.objects.filter(o => (o.layerId || '') !== lid);
  S.layers = S.layers.filter(l => l.id !== lid);
  if (S.activeLayerId === lid) setActiveLayer('sketch');
  _activePlanOverlayLayerId = getPlanOverlayLayers().slice(-1)[0]?.id || null;
  if (_activePlanOverlayLayerId) openPlanOverlayPanel(_activePlanOverlayLayerId);
  else closePlanOverlayPanel();
  buildLayerPanel();
  pushHistory();
  scheduleRender();
  scheduleProjectSave();
  showHint('Plan katmanı kaldırıldı');
}

function isFieldPlanOverlayExt(ext) {
  return FIELD_PLAN_OVERLAY_EXTS.has((ext || '').toLowerCase());
}

function isFieldRasterOverlayExt(ext) {
  return FIELD_RASTER_OVERLAY_EXTS.has((ext || '').toLowerCase());
}

function planRasterBlobKey(objId) {
  return (FIELD_PROJECT.id || 'none') + ':planRaster:' + objId;
}

function clearPlanOverlayLayerGeoref(layerId) {
  S.objects = S.objects.filter(o => !((o.layerId || '') === layerId && o.type === 'georef_image'));
}

function cornersFromWgs84Bounds(b) {
  const tl = latLonToWorld(b.maxLat, b.minLon);
  const tr = latLonToWorld(b.maxLat, b.maxLon);
  const br = latLonToWorld(b.minLat, b.maxLon);
  const bl = latLonToWorld(b.minLat, b.minLon);
  return { tl, tr, br, bl };
}

/** Geographic envelope of georef canvas corners (uses current S.mapCenter). */
function georefWgsBoundsFromCorners(o) {
  const c = o?.corners;
  if (!c) return null;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const k of ['tl', 'tr', 'br', 'bl']) {
    const p = c[k];
    if (!p || !isFinite(p.x) || !isFinite(p.y)) continue;
    const g = worldToLatLon(p.x, p.y);
    minLat = Math.min(minLat, g.lat);
    maxLat = Math.max(maxLat, g.lat);
    minLon = Math.min(minLon, g.lon);
    maxLon = Math.max(maxLon, g.lon);
  }
  if (!isFinite(minLat)) return null;
  return { minLat, maxLat, minLon, maxLon, ok: true };
}

function defaultRasterCornersOnMap(imgW, imgH) {
  const cx = (CW / 2 - S.tx) / S.scale;
  const cy = (CH / 2 - S.ty) / S.scale;
  const heightM = 700;
  const mpp = pxToMeters(1);
  const h = heightM / Math.max(mpp, 1e-9);
  const w = h * (imgW / Math.max(imgH, 1));
  return {
    tl: { x: cx - w / 2, y: cy - h / 2 },
    tr: { x: cx + w / 2, y: cy - h / 2 },
    br: { x: cx + w / 2, y: cy + h / 2 },
    bl: { x: cx - w / 2, y: cy + h / 2 },
  };
}

function resolveGeoTiffEpsg(geoKeys) {
  if (!geoKeys) return 4326;
  const pc = geoKeys.ProjectedCSTypeGeoKey || geoKeys.ProjectedTypeGeoKey;
  const gc = geoKeys.GeographicTypeGeoKey || geoKeys.GeographicTypeGeoKey;
  if (pc && pc !== 32767) return pc;
  if (gc && gc !== 32767) return gc;
  return 4326;
}

function projBboxToWgs84(bbox, epsg) {
  if (!bbox || bbox.length < 4) return null;
  const x0 = bbox[0], y0 = bbox[1], x1 = bbox[2], y1 = bbox[3];
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
  if (epsg === 4326 || epsg === 4258) {
    return { minLon: minX, minLat: minY, maxLon: maxX, maxLat: maxY };
  }
  try {
    const from = 'EPSG:' + epsg;
    const sw = proj4(from, 'WGS84', [minX, minY]);
    const ne = proj4(from, 'WGS84', [maxX, maxY]);
    return { minLon: sw[0], minLat: sw[1], maxLon: ne[0], maxLat: ne[1] };
  } catch (err) {
    console.warn('[PlanAI GeoTIFF] proj4', epsg, err);
    return null;
  }
}

function rasterBandsToCanvas(rasters, width, height, spp) {
  const cv = document.createElement('canvas');
  cv.width = width;
  cv.height = height;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(width, height);
  const n = width * height;
  const r = rasters[0], g = rasters[1] || r, b = rasters[2] || r;
  const a = rasters[3];
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    if (spp >= 3) {
      img.data[o] = r[i];
      img.data[o + 1] = g[i];
      img.data[o + 2] = b[i];
      img.data[o + 3] = a ? a[i] : 255;
    } else {
      const v = r[i];
      img.data[o] = v;
      img.data[o + 1] = v;
      img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

function downscaleCanvasToMax(cv, maxPx) {
  const w = cv.width, h = cv.height;
  if (w <= maxPx && h <= maxPx) return cv;
  const s = maxPx / Math.max(w, h);
  const nw = Math.max(1, Math.round(w * s));
  const nh = Math.max(1, Math.round(h * s));
  const out = document.createElement('canvas');
  out.width = nw;
  out.height = nh;
  out.getContext('2d').drawImage(cv, 0, 0, nw, nh);
  return out;
}

function canvasToPlanRasterDataUrl(cv) {
  const scaled = downscaleCanvasToMax(cv, PLAN_RASTER_MAX_PX);
  return { dataUrl: scaled.toDataURL('image/jpeg', PLAN_RASTER_JPEG_Q), w: scaled.width, h: scaled.height };
}

function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Görsel yüklenemedi'));
    img.src = dataUrl;
  });
}

async function persistPlanRasterBlob(obj) {
  if (!obj?.dataUrl || !FIELD_PROJECT.id) return;
  try {
    const db = await openProjectDb();
    const res = await fetch(obj.dataUrl);
    const blob = await res.blob();
    await idbPut(db, 'blobs', { key: planRasterBlobKey(obj.id), data: blob, mime: 'image/jpeg' });
    obj.rasterPersisted = true;
  } catch (e) {
    console.warn('[PlanAI] plan raster blob', e);
  }
}

async function restorePlanRasterImages() {
  if (!FIELD_PROJECT.id) return;
  const db = await openProjectDb();
  for (const o of S.objects) {
    if (o.type !== 'georef_image' || !o._planOverlay) continue;
    if (o.dataUrl && o._imgEl?.complete) continue;
    if (!o.rasterPersisted) continue;
    try {
      const row = await idbGet(db, 'blobs', planRasterBlobKey(o.id));
      if (!row?.data) continue;
      const url = URL.createObjectURL(row.data);
      o.dataUrl = url;
      o._imgEl = await loadImageFromDataUrl(url);
    } catch (e) {
      console.warn('[PlanAI] restore raster', o.id, e);
    }
  }
  scheduleRender();
}

async function deletePlanRasterBlob(objId) {
  try {
    const db = await openProjectDb();
    await idbDelete(db, 'blobs', planRasterBlobKey(objId));
  } catch (_) {}
}

async function parseGeoTiffToRaster(file, opts) {
  if (typeof GeoTIFF === 'undefined') throw new Error('GeoTIFF kütüphanesi yüklenemedi');
  const maxPx = (opts && opts.maxPx) || PLAN_RASTER_MAX_PX;
  const buf = await file.arrayBuffer();
  const tiff = await GeoTIFF.fromArrayBuffer(buf);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  const bbox = image.getBoundingBox();
  const geoKeys = image.getGeoKeys();
  const epsg = resolveGeoTiffEpsg(geoKeys);
  if (epsg && typeof SpatialSecurity !== 'undefined') {
    SpatialSecurity.assertCrsName('EPSG:' + epsg, file.name || 'geotiff');
  }
  if (!bbox || bbox.length < 4) throw new Error(t('import.err.geotiffPos'));
  if (geoKeys?.ProjectedCSTypeGeoKey === 32767 || geoKeys?.GeographicTypeGeoKey === 32767) {
    console.warn('[PlanAI GeoTIFF] user-defined CRS — WGS84 varsayılıyor');
  }
  const wgs = projBboxToWgs84(bbox, epsg);
  if (!wgs) throw new Error(epsg ? t('import.err.geotiffCrs') : t('import.err.geotiffPos'));
  const scale = Math.min(1, maxPx / Math.max(width, height));
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));
  const rasters = await image.readRasters({
    width: outW,
    height: outH,
    resampleMethod: 'bilinear',
  });
  const spp = image.getSamplesPerPixel();
  const cv = rasterBandsToCanvas(rasters, outW, outH, spp);
  const { dataUrl, w, h } = canvasToPlanRasterDataUrl(cv);
  return { dataUrl, w, h, wgs, epsg };
}

function tryExifGpsBounds(dataUrl) {
  return new Promise(resolve => {
    if (typeof EXIF === 'undefined') return resolve(null);
    const img = new Image();
    img.onload = function () {
      EXIF.getData(img, function () {
        const lat = EXIF.getTag(this, 'GPSLatitude');
        const lon = EXIF.getTag(this, 'GPSLongitude');
        const latRef = EXIF.getTag(this, 'GPSLatitudeRef');
        const lonRef = EXIF.getTag(this, 'GPSLongitudeRef');
        if (!lat || !lon) return resolve(null);
        const gps = typeof SpatialSecurity !== 'undefined'
          ? SpatialSecurity.validateExifGps(lat, lon, latRef, lonRef)
          : null;
        if (gps) {
          return resolve({
            minLat: gps.lat - 0.002, maxLat: gps.lat + 0.002,
            minLon: gps.lon - 0.002, maxLon: gps.lon + 0.002,
          });
        }
        const toDec = (d, m, s) => (d || 0) + (m || 0) / 60 + (s || 0) / 3600;
        let la = toDec(lat[0], lat[1], lat[2]);
        let lo = toDec(lon[0], lon[1], lon[2]);
        if (latRef === 'S') la = -la;
        if (lonRef === 'W') lo = -lo;
        if (typeof SpatialSecurity !== 'undefined' && !SpatialSecurity.isFiniteCoord(la, lo)) return resolve(null);
        resolve({ minLat: la - 0.002, maxLat: la + 0.002, minLon: lo - 0.002, maxLon: lo + 0.002 });
      });
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

async function loadRasterFileAsDataUrl(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('Dosya okunamadı'));
    r.readAsDataURL(file);
  });
  const img = await loadImageFromDataUrl(dataUrl);
  const cv = document.createElement('canvas');
  cv.width = img.naturalWidth;
  cv.height = img.naturalHeight;
  cv.getContext('2d').drawImage(img, 0, 0);
  const out = canvasToPlanRasterDataUrl(cv);
  return { dataUrl: out.dataUrl, w: out.w, h: out.h, img: await loadImageFromDataUrl(out.dataUrl) };
}

function addPlanRasterGeorefObject({ dataUrl, img, w, h, corners, fileName, bounds }) {
  const layerId = ensurePlanOverlayLayer(fileName);
  const layer = S.layers.find(l => l.id === layerId);
  if (layer) {
    layer.overlayKind = 'raster';
    layer.locked = true;
  }
  clearPlanOverlayLayerGeoref(layerId);
  const op = layer?.overlayOpacity ?? PLAN_OVERLAY_DEFAULT_OPACITY;
  const obj = {
    id: uid(),
    type: 'georef_image',
    dataUrl,
    _imgEl: img,
    imgW: w,
    imgH: h,
    corners,
    clipInset: 0,
    opacity: op,
    visible: true,
    locked: true,
    layerId,
    _planOverlay: true,
    wgsBounds: bounds?.ok ? copyGeoBounds(bounds) : null,
    method: 'geotiff',
    metadata: { name: (fileName || 'Plan').replace(/\.[^.]+$/i, ''), source: 'plan_raster' },
  };
  S.objects.unshift(obj);
  if (obj.dataUrl.length > 180000) persistPlanRasterBlob(obj);
  _activePlanOverlayLayerId = layerId;
  if (bounds?.ok) {
    savePlanOverlayGeoExtent(layerId, bounds);
    fitMapToLatLonBounds(bounds);
  }
  else scheduleRender();
  buildLayerPanel();
  pushHistory();
  openPlanOverlayPanel(layerId);
  scheduleProjectSave();
  return obj;
}

async function importPlanRasterFile(file) {
  if (!file) return;
  if (typeof SpatialSecurity !== 'undefined') SpatialSecurity.assertImportFile(file);
  if (!FIELD_PROJECT.id) { openProjectPanel(); showHint('Önce gezi oluşturun veya açın'); return; }
  const name = file.name || 'plan.tif';
  const ext = (name.split('.').pop() || '').toLowerCase();
  showHint('Plan raster analiz ediliyor…');
  await new Promise(r => setTimeout(r, 0));

  try {
    let rasterMeta = { fileSize: file.size, width: 0, height: 0, bands: 3 };
    if (ext === 'tif' || ext === 'tiff' || ext === 'geotiff') {
      if (typeof DatasetAnalyzer !== 'undefined') rasterMeta = await DatasetAnalyzer.probeGeoTiff(file);
    }
    const gate = await runDatasetHealthGate({
      file, ext, objects: [], debug: { format: 'geotiff' }, name, rasterMeta,
    });
    if (!gate.proceed) {
      showHint(t('health.importCancelled'));
      return;
    }
    const rasterMaxPx = gate.rasterMaxPx || PLAN_RASTER_MAX_PX;
    showHint('Plan raster yükleniyor…');

    let dataUrl, w, h, img, wgsBounds = null;
    const bounds = { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity, ok: false };

    if (ext === 'tif' || ext === 'tiff' || ext === 'geotiff') {
      const parsed = await parseGeoTiffToRaster(file, { maxPx: rasterMaxPx });
      dataUrl = parsed.dataUrl;
      w = parsed.w;
      h = parsed.h;
      img = await loadImageFromDataUrl(dataUrl);
      if (parsed.wgs) {
        wgsBounds = parsed.wgs;
        expandBounds(bounds, wgsBounds.minLat, wgsBounds.minLon);
        expandBounds(bounds, wgsBounds.maxLat, wgsBounds.maxLon);
        setMapCenter((wgsBounds.minLat + wgsBounds.maxLat) / 2, (wgsBounds.minLon + wgsBounds.maxLon) / 2);
        if (S.basemap === 'none') toggleOSM();
      }
    } else {
      const loaded = await loadRasterFileAsDataUrl(file);
      dataUrl = loaded.dataUrl;
      w = loaded.w;
      h = loaded.h;
      img = loaded.img;
      const exifBox = await tryExifGpsBounds(dataUrl);
      if (exifBox) {
        wgsBounds = exifBox;
        expandBounds(bounds, exifBox.minLat, exifBox.minLon);
        expandBounds(bounds, exifBox.maxLat, exifBox.maxLon);
        setMapCenter((exifBox.minLat + exifBox.maxLat) / 2, (exifBox.minLon + exifBox.maxLon) / 2);
      }
    }

    const corners = wgsBounds
      ? cornersFromWgs84Bounds(wgsBounds)
      : defaultRasterCornersOnMap(w, h);

    addPlanRasterGeorefObject({ dataUrl, img, w, h, corners, fileName: name, bounds });
    const tag = wgsBounds ? 'GeoTIFF konumlu' : 'görsel (manuel hizalama gerekebilir)';
    showHint('🗺 Plan raster: ' + name + ' — ' + tag);
    if ((ext === 'tif' || ext === 'tiff' || ext === 'geotiff') && !wgsBounds) {
      showHint(t('import.err.geotiffPos') + ' — manuel hizalama gerekebilir', 8000);
    }
    console.log('[PlanAI Field PlanRaster]', { file: name, w, h, georef: !!wgsBounds });
  } catch (err) {
    console.error('[PlanAI Field PlanRaster]', err);
    showHint((err.message || err).indexOf('import.err') >= 0 ? (err.message || err) : ('Raster: ' + (err.message || err)));
  }
}

function expandBounds(b, lat, lon) {
  if (lat < b.minLat) b.minLat = lat;
  if (lat > b.maxLat) b.maxLat = lat;
  if (lon < b.minLon) b.minLon = lon;
  if (lon > b.maxLon) b.maxLon = lon;
  b.ok = true;
}

function fitMapToLatLonBounds(b) {
  if (!b.ok) return;
  const pad = 0.12;
  let { minLat, maxLat, minLon, maxLon } = b;
  if (Math.abs(maxLat - minLat) < 1e-8) { minLat -= 0.002; maxLat += 0.002; }
  if (Math.abs(maxLon - minLon) < 1e-8) { minLon -= 0.002; maxLon += 0.002; }
  const dLat = (maxLat - minLat) * pad, dLon = (maxLon - minLon) * pad;
  minLat -= dLat; maxLat += dLat; minLon -= dLon; maxLon += dLon;
  setMapCenter((minLat + maxLat) / 2, (minLon + maxLon) / 2);
  const tl = latLonToWorld(maxLat, minLon);
  const br = latLonToWorld(minLat, maxLon);
  const ww = Math.max(20, Math.abs(br.x - tl.x));
  const wh = Math.max(20, Math.abs(br.y - tl.y));
  const topBar = getTopBarH(), dock = getFieldDockH();
  const viewW = Math.max(100, CW - 48);
  const viewH = Math.max(100, CH - topBar - dock - 24);
  S.scale = Math.min(viewW / ww, viewH / wh, 80);
  const cx = (tl.x + br.x) / 2, cy = (tl.y + br.y) / 2;
  S.tx = CW / 2 - cx * S.scale;
  S.ty = topBar + viewH / 2 - cy * S.scale;
  scheduleRender();
}

/** Fit view to canvas world bounds (georef corners — not lat/lon). */
function fitMapToWorldBounds(minX, minY, maxX, maxY) {
  const pad = 0.12;
  let w = Math.max(20, maxX - minX);
  let h = Math.max(20, maxY - minY);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const pw = w * (1 + pad * 2), ph = h * (1 + pad * 2);
  const topBar = getTopBarH(), dock = getFieldDockH();
  const viewW = Math.max(100, CW - 48);
  const viewH = Math.max(100, CH - topBar - dock - 24);
  S.scale = Math.min(viewW / pw, viewH / ph, 80);
  S.tx = CW / 2 - cx * S.scale;
  S.ty = topBar + viewH / 2 - cy * S.scale;
  scheduleRender();
}

function geoRingToWorldFlat(ring) {
  const pts = [];
  for (const c of ring) {
    const w = latLonToWorld(c.lat, c.lon);
    pts.push(w.x, w.y);
  }
  return pts;
}

function flatPtsBounds(pts) {
  if (!pts || pts.length < 2) return null;
  let minX = pts[0], maxX = pts[0], minY = pts[1], maxY = pts[1];
  for (let i = 2; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function getHatchViewportBounds(pad) {
  if (typeof ViewportManager === 'undefined') return null;
  return ViewportManager.getWorldBounds({
    tx: S.tx, ty: S.ty, scale: S.scale,
    cw: CW, topBar: getTopBarH(), mapBottom: getMapViewBottom(),
  });
}

function resolveHatchDrawRect(bounds, sp) {
  const pad = Math.max(sp * 3, 16);
  const vb = getHatchViewportBounds(pad);
  let x0, y0, x1, y1;
  if (bounds && bounds.maxX > bounds.minX && bounds.maxY > bounds.minY) {
    x0 = bounds.minX - pad;
    y0 = bounds.minY - pad;
    x1 = bounds.maxX + pad;
    y1 = bounds.maxY + pad;
  } else if (vb) {
    x0 = vb.minX - pad;
    y0 = vb.minY - pad;
    x1 = vb.maxX + pad;
    y1 = vb.maxY + pad;
  } else {
    return { x0: -800, y0: -800, x1: 1600, y1: 1600 };
  }
  if (vb) {
    x0 = Math.max(x0, vb.minX - pad);
    y0 = Math.max(y0, vb.minY - pad);
    x1 = Math.min(x1, vb.maxX + pad);
    y1 = Math.min(y1, vb.maxY + pad);
  }
  if (x1 <= x0 || y1 <= y0) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return { x0, y0, x1, y1 };
}

function pushImportObjects(objects, layerId, bounds, debug) {
  for (const o of objects) {
    o.layerId = layerId;
    o.visible = true;
    o.locked = false;
    o._import = true;
    S.objects.push(o);
    debug.count++;
    debug.types[o.type] = (debug.types[o.type] || 0) + 1;
  }
  debug.layers.add(layerId);
}

function geoJsonToImportObjects(geo, layerId, bounds, debug, name) {
  const out = [];
  const feats = geo.type === 'FeatureCollection' ? (geo.features || [])
    : geo.type === 'Feature' ? [geo] : [{ type:'Feature', properties:{}, geometry: geo }];

  feats.forEach((f, fi) => {
    const g = f.geometry;
    if (!g) return;
    const st = importStyleFor(
      g.type.includes('Polygon') ? 'polygon' : g.type.includes('Line') ? 'polyline' : 'point',
      f.properties
    );
    const pushRing = (ring, holes) => {
      if (!ring || ring.length < 3) return;
      ring.forEach(c => expandBounds(bounds, c.lat, c.lon));
      out.push({
        id: uid(), type:'import_polygon', rings:[ring], holes: holes || [],
        color: st.color, fillColor: st.fillColor, strokeWidth: st.strokeWidth, opacity: st.opacity,
        visible:true, locked:false,
        metadata:{ name: f.properties?.name || name, featureIndex: fi, attributes: typeof SpatialSecurity !== 'undefined' ? SpatialSecurity.sanitizeProperties(f.properties) : { ...(f.properties || {}) }, source: 'geojson' },
      });
    };

    if (g.type === 'Polygon') {
      const rings = geoJsonRings(g.coordinates);
      if (rings.length) pushRing(rings[0], rings.slice(1));
    } else if (g.type === 'MultiPolygon') {
      (g.coordinates || []).forEach(poly => {
        const rings = geoJsonRings(poly);
        if (rings.length) pushRing(rings[0], rings.slice(1));
      });
    } else if (g.type === 'LineString') {
      const verts = geoJsonLine(g.coordinates);
      if (verts.length < 2) return;
      verts.forEach(c => expandBounds(bounds, c.lat, c.lon));
      out.push({
        id: uid(), type:'import_polyline', vertices: verts,
        color: st.color, strokeWidth: st.strokeWidth, opacity: st.opacity,
        visible:true, locked:false,
        metadata:{ name: f.properties?.name || name, attributes: typeof SpatialSecurity !== 'undefined' ? SpatialSecurity.sanitizeProperties(f.properties) : { ...(f.properties || {}) }, source: 'geojson' },
      });
    } else if (g.type === 'MultiLineString') {
      (g.coordinates || []).forEach(line => {
        const verts = geoJsonLine(line);
        if (verts.length < 2) return;
        verts.forEach(c => expandBounds(bounds, c.lat, c.lon));
        out.push({
          id: uid(), type:'import_polyline', vertices: verts,
          color: st.color, strokeWidth: st.strokeWidth, opacity: st.opacity,
          visible:true, locked:false,
          metadata:{ name: f.properties?.name || name, attributes: typeof SpatialSecurity !== 'undefined' ? SpatialSecurity.sanitizeProperties(f.properties) : { ...(f.properties || {}) }, source: 'geojson' },
        });
      });
    } else if (g.type === 'Point') {
      const c = geoJsonPoint(g.coordinates);
      if (!c) return;
      expandBounds(bounds, c.lat, c.lon);
      out.push({
        id: uid(), type:'import_point', lon: c.lon, lat: c.lat,
        color: st.color, r: st.r, strokeWidth: st.strokeWidth, opacity: st.opacity,
        visible:true, locked:false,
        metadata:{ name: f.properties?.name || name, attributes: typeof SpatialSecurity !== 'undefined' ? SpatialSecurity.sanitizeProperties(f.properties) : { ...(f.properties || {}) }, source: 'geojson' },
      });
    } else if (g.type === 'MultiPoint') {
      (g.coordinates || []).forEach(coord => {
        const c = geoJsonPoint(coord);
        if (!c) return;
        expandBounds(bounds, c.lat, c.lon);
        out.push({
          id: uid(), type:'import_point', lon: c.lon, lat: c.lat,
          color: st.color, r: st.r, strokeWidth: st.strokeWidth, opacity: st.opacity,
          visible:true, locked:false,
          metadata:{ name: f.properties?.name || name, attributes: typeof SpatialSecurity !== 'undefined' ? SpatialSecurity.sanitizeProperties(f.properties) : { ...(f.properties || {}) }, source: 'geojson' },
        });
      });
    }
  });
  return out;
}

function geoJsonPoint(coord) {
  if (!coord || coord.length < 2) return null;
  const lon = +coord[0], lat = +coord[1];
  if (isNaN(lat) || isNaN(lon)) return null;
  if (typeof SpatialSecurity !== 'undefined' && !SpatialSecurity.isFiniteCoord(lat, lon)) return null;
  return { lat, lon };
}
function geoJsonLine(coords) {
  const max = typeof SpatialSecurity !== 'undefined' ? SpatialSecurity.LIMITS.MAX_RING_VERTICES : 8000;
  return (coords || []).slice(0, max).map(geoJsonPoint).filter(Boolean);
}
function geoJsonRings(polyCoords) {
  const ringMax = typeof SpatialSecurity !== 'undefined' ? SpatialSecurity.LIMITS.MAX_POLYGON_RINGS : 48;
  return (polyCoords || []).slice(0, ringMax).map(ring => {
    const line = geoJsonLine(ring);
    return typeof SpatialSecurity !== 'undefined' ? SpatialSecurity.clampRing(line) : line;
  }).filter(r => r.length >= 3);
}

function normalizeKmlCoordPair(a, b) {
  if (isNaN(a) || isNaN(b)) return null;
  if (looksLikeTurefEN(a, b) || Math.abs(a) > 180 || Math.abs(b) > 180) {
    const g = gmlToWgs84(a, b, 'EPSG:4326');
    if (isFinite(g.lat) && isFinite(g.lon)) return { lon: g.lon, lat: g.lat };
  }
  let lon = a, lat = b;
  if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) { lon = b; lat = a; }
  const aIsLat = a >= 35 && a <= 43, bIsLon = b >= 25 && b <= 46;
  const aIsLon = a >= 25 && a <= 46, bIsLat = b >= 35 && b <= 43;
  if (aIsLat && bIsLon && !(aIsLon && bIsLat)) return { lon: b, lat: a };
  if (aIsLon && bIsLat) return { lon: a, lat: b };
  if (aIsLat && bIsLon && aIsLon && bIsLat) {
    return a > b ? { lon: b, lat: a } : { lon: a, lat: b };
  }
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90) return null;
  return { lon, lat };
}

function parseKmlCoordPairs(text) {
  const out = [];
  if (!text) return out;
  const tokens = text.trim().replace(/\s+/g, ' ').split(/\s+/);
  if (typeof SpatialSecurity !== 'undefined') SpatialSecurity.assertCoordCount(tokens, 'KML');
  const max = typeof SpatialSecurity !== 'undefined' ? SpatialSecurity.LIMITS.MAX_RING_VERTICES : 8000;
  for (let i = 0; i < tokens.length && out.length < max; i++) {
    const p = tokens[i].split(',');
    const c = normalizeKmlCoordPair(+p[0], +p[1]);
    if (c && (typeof SpatialSecurity === 'undefined' || SpatialSecurity.isFiniteCoord(c.lat, c.lon))) out.push(c);
  }
  return out;
}

function kmlLocalChildren(el, localName) {
  return [...(el?.children || [])].filter(c => c.localName === localName);
}

function kmlLocalDescendants(el, localName) {
  return [...el.getElementsByTagName('*')].filter(c => c.localName === localName);
}

function kmlFirstText(el, localName) {
  const n = kmlLocalDescendants(el, localName).find(x => x.parentElement === el || x.localName === localName);
  const direct = kmlLocalChildren(el, localName)[0];
  return (direct || n)?.textContent?.trim() || '';
}

function kmlCoordElements(root) {
  return kmlLocalDescendants(root, 'coordinates');
}

function kmlParsePlacemarkGeometry(pm, handlers) {
  const walk = node => {
    if (!node) return;
    const ln = node.localName;
    if (ln === 'Point') {
      const c = parseKmlCoordPairs(kmlCoordElements(node)[0]?.textContent);
      if (c[0]) handlers.point(c[0]);
    } else if (ln === 'LineString') {
      handlers.line(parseKmlCoordPairs(kmlCoordElements(node)[0]?.textContent));
    } else if (ln === 'LinearRing') {
      handlers.polygon(parseKmlCoordPairs(kmlCoordElements(node)[0]?.textContent));
    } else if (ln === 'Polygon') {
      const outer = kmlLocalDescendants(node, 'outerBoundaryIs')[0];
      const ringEl = outer ? kmlCoordElements(outer)[0] : kmlLocalDescendants(node, 'LinearRing')[0];
      const coords = ringEl ? (kmlCoordElements(ringEl)[0] || ringEl) : null;
      if (coords) handlers.polygon(parseKmlCoordPairs(coords.textContent));
    } else if (ln === 'MultiGeometry' || ln === 'MultiTrack') {
      kmlLocalChildren(node, 'Point').forEach(walk);
      kmlLocalChildren(node, 'LineString').forEach(walk);
      kmlLocalChildren(node, 'LinearRing').forEach(walk);
      kmlLocalChildren(node, 'Polygon').forEach(walk);
      kmlLocalChildren(node, 'MultiGeometry').forEach(walk);
    }
  };
  kmlLocalChildren(pm, 'Point').forEach(walk);
  kmlLocalChildren(pm, 'LineString').forEach(walk);
  kmlLocalChildren(pm, 'LinearRing').forEach(walk);
  kmlLocalChildren(pm, 'Polygon').forEach(walk);
  kmlLocalChildren(pm, 'MultiGeometry').forEach(walk);
  if (!kmlLocalChildren(pm, 'Point').length && !kmlLocalChildren(pm, 'LineString').length &&
      !kmlLocalChildren(pm, 'Polygon').length && !kmlLocalChildren(pm, 'MultiGeometry').length) {
    kmlCoordElements(pm).forEach(el => {
      const pts = parseKmlCoordPairs(el.textContent);
      if (pts.length >= 3) handlers.polygon(pts);
      else if (pts.length === 2) handlers.line(pts);
      else if (pts.length === 1) handlers.point(pts[0]);
    });
  }
}

function kmlToImportObjects(xmlText, layerId, bounds, debug, name) {
  if (typeof SpatialSecurity !== 'undefined') SpatialSecurity.assertKmlPreParse(xmlText);
  const out = [];
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error(t('import.err.kml'));
  const placemarks = kmlLocalDescendants(doc, 'Placemark');
  if (!placemarks.length) throw new Error(t('import.err.noGeom'));
  debug.format = 'kml';
  placemarks.forEach((pm, i) => {
    const label = kmlFirstText(pm, 'name') || name;
    const desc = typeof SpatialSecurity !== 'undefined'
      ? SpatialSecurity.sanitizeFieldNoteText(kmlFirstText(pm, 'description'))
      : kmlFirstText(pm, 'description');
    const extAttrs = typeof SpatialSecurity !== 'undefined'
      ? SpatialSecurity.sanitizeProperties(kmlExtendedData(pm))
      : kmlExtendedData(pm);
    const metaBase = { attributes: extAttrs, featureIndex: i, source: 'kml', description: desc };
    const addPoly = (ring) => {
      if (!ring || ring.length < 3) return;
      ring.forEach(c => expandBounds(bounds, c.lat, c.lon));
      out.push({
        id: uid(), type:'import_polygon', rings:[ring], holes:[],
        color: IMPORT_STYLE.polygon.color, fillColor: IMPORT_STYLE.polygon.fillColor,
        strokeWidth: IMPORT_STYLE.polygon.strokeWidth, opacity: 1,
        visible:true, locked:false, metadata:{ name: label, ...metaBase },
      });
    };
    const addLine = (verts) => {
      if (!verts || verts.length < 2) return;
      verts.forEach(c => expandBounds(bounds, c.lat, c.lon));
      out.push({
        id: uid(), type:'import_polyline', vertices: verts,
        color: IMPORT_STYLE.polyline.color, strokeWidth: IMPORT_STYLE.polyline.strokeWidth, opacity: 1,
        visible:true, locked:false, metadata:{ name: label, ...metaBase },
      });
    };
    const addPt = (c) => {
      if (!c) return;
      expandBounds(bounds, c.lat, c.lon);
      out.push({
        id: uid(), type:'import_point', lon: c.lon, lat: c.lat,
        color: IMPORT_STYLE.point.color, r: IMPORT_STYLE.point.r, strokeWidth: 2, opacity: 1,
        visible:true, locked:false, metadata:{ name: label, ...metaBase },
      });
    };
    kmlParsePlacemarkGeometry(pm, { point: addPt, line: addLine, polygon: addPoly });
  });
  return out;
}

function parsePrjEpsg(prjText) {
  if (!prjText) return null;
  const m = prjText.match(/AUTHORITY\["EPSG","(\d+)"\]/i);
  if (m) return +m[1];
  if (/WGS[\s_]*84|EPSG["\s,]*4326/i.test(prjText)) return 4326;
  if (/Turkey|TUREF|ITRF/i.test(prjText)) return 5254;
  return null;
}

function shpReadParts(dv, offset, numParts, numPoints) {
  const parts = [];
  for (let i = 0; i < numParts; i++) parts.push(dv.getInt32(offset + i * 4, true));
  parts.push(numPoints);
  const rings = [];
  for (let p = 0; p < numParts; p++) {
    const start = parts[p], end = parts[p + 1];
    const ring = [];
    for (let i = start; i < end; i++) {
      const x = dv.getFloat64(offset + numParts * 4 + i * 16, true);
      const y = dv.getFloat64(offset + numParts * 4 + i * 16 + 8, true);
      ring.push({ x, y });
    }
    if (ring.length) rings.push(ring);
  }
  return rings;
}

function shpRingToLatLon(ring, epsg) {
  const out = [];
  for (const p of ring) {
    let lon = p.x, lat = p.y;
    if (epsg && epsg !== 4326) {
      try {
        const w = proj4('EPSG:' + epsg, 'WGS84', [p.x, p.y]);
        lon = w[0]; lat = w[1];
      } catch (_) { return null; }
    }
    if (isNaN(lat) || isNaN(lon)) continue;
    out.push({ lat, lon });
  }
  return out.length >= 2 ? out : null;
}

function parseDbfRecords(dbfBuf) {
  const attrs = [];
  if (!dbfBuf || dbfBuf.byteLength < 32) return attrs;
  const dv = new DataView(dbfBuf);
  const numRecords = dv.getUint32(4, true);
  const headerLen = dv.getUint16(8, true);
  const recordLen = dv.getUint16(10, true);
  const fields = [];
  let pos = 32;
  while (pos < headerLen - 1) {
    const name = String.fromCharCode(...new Uint8Array(dbfBuf, pos, 11)).replace(/\0/g, '').trim();
    const type = String.fromCharCode(dv.getUint8(pos + 11));
    const len = dv.getUint8(pos + 16);
    if (name) fields.push({ name, type, len });
    pos += 32;
  }
  let rpos = headerLen;
  for (let r = 0; r < numRecords && rpos + recordLen <= dbfBuf.byteLength; r++) {
    const row = {};
    let fpos = rpos + 1;
    fields.forEach(f => {
      const raw = String.fromCharCode(...new Uint8Array(dbfBuf, fpos, f.len)).trim();
      row[f.name] = raw;
      fpos += f.len;
    });
    attrs.push(row);
    rpos += recordLen;
  }
  return attrs;
}

function shapefileToImportObjects(shpBuf, dbfBuf, prjText, layerId, bounds, debug, name) {
  const out = [];
  if (!shpBuf || shpBuf.byteLength < 100) throw new Error(t('import.err.shpIncomplete'));
  const dv = new DataView(shpBuf);
  const fileCode = dv.getInt32(0, false);
  if (fileCode !== 9994) throw new Error(t('import.err.shpIncomplete'));
  const epsg = parsePrjEpsg(prjText) || 4326;
  if (!epsg) throw new Error(t('import.err.crs'));
  debug.format = 'shp';
  debug.entityCounts = {};
  const dbfRows = parseDbfRecords(dbfBuf);
  let recOff = 100, featIdx = 0;
  while (recOff + 8 <= shpBuf.byteLength) {
    const recNum = dv.getInt32(recOff, false);
    const contentWords = dv.getInt32(recOff + 4, false);
    const contentLen = contentWords * 2;
    const shapeOff = recOff + 8;
    if (contentLen < 4 || shapeOff + contentLen > shpBuf.byteLength) break;
    const shapeType = dv.getInt32(shapeOff, true);
    const attrs = dbfRows[featIdx] || {};
    const label = attrs.NAME || attrs.name || attrs.ADI || attrs.Adi || (name + ' #' + (featIdx + 1));
    const meta = { source: 'shp', attributes: attrs, featureIndex: featIdx };
    if (shapeType === 1) {
      const x = dv.getFloat64(shapeOff + 4, true), y = dv.getFloat64(shapeOff + 12, true);
      const ring = shpRingToLatLon([{ x, y }], epsg);
      if (ring?.[0]) {
        expandBounds(bounds, ring[0].lat, ring[0].lon);
        out.push(makeImportPoint(ring[0].lat, ring[0].lon, layerId, IMPORT_STYLE.point.color, { ...meta, name: label }));
        debug.entityCounts.Point = (debug.entityCounts.Point || 0) + 1;
      }
    } else if (shapeType === 3 || shapeType === 5) {
      const numParts = dv.getInt32(shapeOff + 36, true);
      const numPoints = dv.getInt32(shapeOff + 40, true);
      const parts = shpReadParts(dv, shapeOff + 44, numParts, numPoints);
      parts.forEach(ring => {
        const verts = shpRingToLatLon(ring, epsg);
        if (!verts) return;
        verts.forEach(c => expandBounds(bounds, c.lat, c.lon));
        if (shapeType === 3 && verts.length >= 2) {
          out.push(makeImportPolyline(verts, layerId, IMPORT_STYLE.polyline.color, IMPORT_STYLE.polyline.strokeWidth, { ...meta, name: label }));
          debug.entityCounts.PolyLine = (debug.entityCounts.PolyLine || 0) + 1;
        } else if (shapeType === 5 && verts.length >= 3) {
          out.push(makeImportPolygon(verts, layerId, IMPORT_STYLE.polygon.color, IMPORT_STYLE.polygon.fillColor, IMPORT_STYLE.polygon.strokeWidth, { ...meta, name: label }));
          debug.entityCounts.Polygon = (debug.entityCounts.Polygon || 0) + 1;
        }
      });
    }
    featIdx++;
    recOff = shapeOff + contentLen;
    if (!recNum) break;
  }
  if (!out.length) throw new Error(t('import.err.noGeom'));
  return out;
}

async function importShapefileBundle(parts, baseName) {
  if (!parts.shp) { showHint(t('import.err.shpMissing')); return; }
  if (!parts.shx) showHint('SHX eksik — sınırlı modda okunuyor');
  const shpBuf = await parts.shp.arrayBuffer();
  const dbfBuf = parts.dbf ? await parts.dbf.arrayBuffer() : null;
  const prjText = parts.prj ? await parts.prj.text() : '';
  const name = baseName || parts.shp.name;
  const bounds = { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity, ok: false };
  const debug = { file: name, count: 0, types: {}, layers: new Set(), format: 'shp' };
  const layerId = ensureImportLayer(name);
  const objects = shapefileToImportObjects(shpBuf, dbfBuf, prjText, layerId, bounds, debug, name);
  await finalizeFieldImport(objects, bounds, debug, name, layerId, {});
}

async function importShapefileZip(file) {
  if (typeof JSZip === 'undefined') throw new Error('ZIP desteği yüklenemedi');
  const zip = typeof SpatialSecurity !== 'undefined' && SpatialSecurity.loadZipFromFile
    ? await SpatialSecurity.loadZipFromFile(file, 'shapefile.zip')
    : await JSZip.loadAsync(await file.arrayBuffer());
  if (typeof SpatialSecurity !== 'undefined' && !SpatialSecurity.loadZipFromFile) {
    SpatialSecurity.assertZipArchive(zip, 'shapefile.zip');
  }
  const shpPath = Object.keys(zip.files).find(p => /\.shp$/i.test(p) && !p.startsWith('__MACOSX'));
  if (!shpPath) throw new Error(t('import.err.shpMissing'));
  const base = shpPath.replace(/\.shp$/i, '');
  const parts = {};
  for (const ext of ['shp', 'dbf', 'shx', 'prj']) {
    const p = Object.keys(zip.files).find(k => k.toLowerCase() === (base + '.' + ext).toLowerCase());
    if (p && !zip.files[p].dir) {
      const blob = await zip.files[p].async('blob');
      parts[ext] = new File([blob], p.split('/').pop());
    }
  }
  await importShapefileBundle(parts, base.split('/').pop());
}

// ═══ DXF / GML field import (view-only, chunked) ═════════════════
const DXF_SUPPORTED = new Set(['LINE','LWPOLYLINE','POLYLINE','POINT','CIRCLE','TEXT','MTEXT']);
const DXF_HUGE_LAYER = 300;
const DXF_HUGE_TOTAL = 800;
const DXF_PARSE_BATCH = 40;
const GML_PARSE_BATCH = 30;
const GML_NS = 'http://www.opengis.net/gml';
const CITYGML_NS_HINT = 'citygml';
const CITYGML_MAX_POLYGONS = 8000;
const CITYGML_RING_MAX = 80;
const CITYGML_REGEX_FALLBACK_MIN = 0;

const DXF_ACI = {
  1:'#ff0000',2:'#ffff00',3:'#00ff00',4:'#00ffff',5:'#0000ff',6:'#ff00ff',7:'#ffffff',
  8:'#808080',9:'#c0c0c0',10:'#ff0000',11:'#ff7f7f',12:'#a52a2a',13:'#ffbf00',14:'#ffff7f',
  30:'#ff6600',40:'#ffaa66',50:'#ffcc99',90:'#999999',140:'#666666',150:'#333333',
};

function importSlug(s) {
  return (s || 'layer').slice(0, 24).replace(/[^a-zA-Z0-9_-]+/g, '_') || 'layer';
}

function dxfAciColor(aci, fallback) {
  const n = parseInt(aci, 10);
  if (!isNaN(n) && DXF_ACI[n]) return DXF_ACI[n];
  if (!isNaN(n) && n >= 1 && n <= 255) {
    const hue = (n * 47) % 360;
    return `hsl(${hue},55%,45%)`;
  }
  return fallback || IMPORT_STYLE.polyline.color;
}

function dxfTrueColor(raw) {
  const v = parseInt(raw, 10);
  if (isNaN(v) || v < 0) return null;
  const b = (v >> 16) & 0xff, g = (v >> 8) & 0xff, r = v & 0xff;
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}

function stripMtext(s) {
  if (!s) return '';
  return String(s)
    .replace(/\\P/gi, '\n')
    .replace(/\\[A-Za-z][^;]*;/g, '')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function* dxfPairIterator(text) {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (isNaN(code)) continue;
    yield { code, value: (lines[i + 1] ?? '').trim() };
  }
}

function extractDxfEntities(text) {
  const entities = [];
  let cur = null;
  const multiCodes = new Set([10, 11, 20, 21, 42]);
  for (const { code, value } of dxfPairIterator(text)) {
    if (code === 0) {
      if (cur) entities.push(cur);
      if (value === 'SEQEND' || DXF_SUPPORTED.has(value) || value === 'VERTEX') {
        cur = { type: value, props: {} };
      } else {
        cur = null;
      }
      continue;
    }
    if (!cur) continue;
    if (multiCodes.has(code)) {
      if (!cur.props[code]) cur.props[code] = [value];
      else if (Array.isArray(cur.props[code])) cur.props[code].push(value);
      else cur.props[code] = [cur.props[code], value];
    } else if (cur.props[code] === undefined) {
      cur.props[code] = value;
    }
  }
  if (cur) entities.push(cur);
  return entities;
}

function consolidateDxfEntities(raw) {
  const out = [];
  let poly = null;
  for (const e of raw) {
    if (e.type === 'POLYLINE') {
      poly = e;
      poly.vertices = [];
      continue;
    }
    if (e.type === 'VERTEX' && poly) {
      const x = dxfNums(e, 10)[0], y = dxfNums(e, 20)[0];
      if (!isNaN(x) && !isNaN(y)) poly.vertices.push({ x, y });
      continue;
    }
    if (e.type === 'SEQEND' && poly) {
      out.push(poly);
      poly = null;
      continue;
    }
    if (e.type !== 'SEQEND') out.push(e);
  }
  return out;
}

function dxfNums(ent, code) {
  const p = ent.props[code];
  if (p === undefined) return [];
  return (Array.isArray(p) ? p : [p]).map(Number).filter(n => !isNaN(n));
}

function dxfLayerName(ent) {
  return (ent.props[8] || '0').toString().trim() || '0';
}

function dxfEntityColor(ent, fallback) {
  const tc = dxfTrueColor(ent.props[420]);
  if (tc) return tc;
  return dxfAciColor(ent.props[62], fallback);
}

function collectDxfPlanarPoints(entities) {
  const pts = [];
  const add = (x, y) => { if (!isNaN(x) && !isNaN(y)) pts.push({ x, y }); };
  entities.forEach(ent => {
    if (ent.type === 'LINE') {
      dxfNums(ent, 10).forEach((x, i) => add(x, dxfNums(ent, 20)[i]));
      dxfNums(ent, 11).forEach((x, i) => add(x, dxfNums(ent, 21)[i]));
    } else if (ent.type === 'POINT' || ent.type === 'TEXT' || ent.type === 'MTEXT' || ent.type === 'CIRCLE') {
      add(dxfNums(ent, 10)[0], dxfNums(ent, 20)[0]);
    } else if (ent.type === 'LWPOLYLINE') {
      const xs = dxfNums(ent, 10), ys = dxfNums(ent, 20);
      xs.forEach((x, i) => add(x, ys[i]));
    } else if (ent.type === 'POLYLINE' && ent.vertices) {
      ent.vertices.forEach(v => add(v.x, v.y));
    }
  });
  return pts;
}

function buildDxfCoordContext(entities) {
  const pts = collectDxfPlanarPoints(entities);
  if (!pts.length) {
    return { mode: 'local', cx: 0, cy: 0, anchorLat: S.mapCenter.lat, anchorLon: S.mapCenter.lon };
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  pts.forEach(p => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  });
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const spanX = maxX - minX, spanY = maxY - minY;
  const looksGeo = minX >= -180 && maxX <= 180 && minY >= -90 && maxY <= 90 &&
    spanX < 15 && spanY < 15 && (Math.abs(cx) > 0.01 || Math.abs(cy) > 0.01);
  if (looksGeo) {
    return { mode: 'wgs84', cx, cy, minX, maxX, minY, maxY };
  }
  return {
    mode: 'local',
    cx, cy,
    anchorLat: S.mapCenter.lat,
    anchorLon: S.mapCenter.lon,
    minX, maxX, minY, maxY,
  };
}

function dxfXYToLatLon(x, y, ctx) {
  if (ctx.mode === 'wgs84') {
    return { lon: x, lat: y };
  }
  const dX = x - ctx.cx, dY = y - ctx.cy;
  const lat = ctx.anchorLat - dY / 111320;
  const lon = ctx.anchorLon + dX / (111320 * Math.cos(ctx.anchorLat * Math.PI / 180));
  return { lat, lon };
}

function simplifyLatLonVerts(verts, maxPts) {
  if (verts.length <= maxPts) return verts;
  const step = Math.ceil(verts.length / maxPts);
  const out = [];
  for (let i = 0; i < verts.length; i += step) out.push(verts[i]);
  if (out[out.length - 1] !== verts[verts.length - 1]) out.push(verts[verts.length - 1]);
  return out;
}

function circleToLatLonRing(cx, cy, r, ctx, segments) {
  const n = segments || 28;
  const ring = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    ring.push(dxfXYToLatLon(cx + Math.cos(a) * r, cy + Math.sin(a) * r, ctx));
  }
  return ring;
}

function ensureDxfLayer(dxfLayerName, fileSlug, entityCount) {
  const id = 'dxf_' + fileSlug + '_' + importSlug(dxfLayerName);
  let layer = S.layers.find(l => l.id === id);
  if (!layer) {
    const order = 5 + S.layers.filter(l => l.id.startsWith('dxf_') || l.id.startsWith('import_')).length;
    const huge = entityCount > DXF_HUGE_LAYER;
    layer = {
      id,
      name: 'DXF · ' + (dxfLayerName || '0'),
      color: '#7f8c8d',
      order,
      visible: !huge,
      locked: false,
      _dxfGroup: true,
      _dxfLayer: dxfLayerName,
      importNum: getNextImportLayerNumber(),
    };
    S.layers.push(layer);
  }
  return id;
}

function ensureGmlLayer(layerName, fileSlug) {
  const id = 'gml_' + fileSlug + '_' + importSlug(layerName);
  if (!S.layers.find(l => l.id === id)) {
    const order = 5 + S.layers.filter(l => l.id.startsWith('gml_') || l.id.startsWith('import_')).length;
    S.layers.push({
      id,
      name: 'GML · ' + (layerName || 'Özellikler'),
      color: '#16a085',
      order,
      visible: true,
      locked: false,
      _gmlGroup: true,
      importNum: getNextImportLayerNumber(),
    });
  }
  return id;
}

function makeImportPolyline(verts, layerId, color, strokeW, meta) {
  return {
    id: uid(), type: 'import_polyline', vertices: verts,
    color: color || IMPORT_STYLE.polyline.color,
    strokeWidth: strokeW || IMPORT_STYLE.polyline.strokeWidth,
    opacity: 1, visible: true, locked: false,
    layerId, metadata: meta || {},
  };
}

function makeImportPolygon(ring, layerId, color, fillColor, strokeW, meta) {
  return {
    id: uid(), type: 'import_polygon', rings: [ring], holes: [],
    color: color || IMPORT_STYLE.polygon.color,
    fillColor: fillColor || IMPORT_STYLE.polygon.fillColor,
    strokeWidth: strokeW || IMPORT_STYLE.polygon.strokeWidth,
    opacity: 1, visible: true, locked: false,
    layerId, metadata: meta || {},
  };
}

function makeImportPoint(lat, lon, layerId, color, meta) {
  return {
    id: uid(), type: 'import_point', lat, lon,
    color: color || IMPORT_STYLE.point.color,
    r: IMPORT_STYLE.point.r, strokeWidth: 2, opacity: 1,
    visible: true, locked: false, layerId, metadata: meta || {},
  };
}

function makeImportText(lat, lon, text, layerId, color, fontSize, meta) {
  return {
    id: uid(), type: 'import_text', lat, lon, text: text || '',
    fontSize: fontSize || 12, color: color || '#1a1a2e',
    visible: true, locked: false, layerId, metadata: meta || {},
  };
}

function dxfEntityToObjects(ent, ctx, fileSlug, layerCounts, bounds, debug) {
  const out = [];
  const layerName = dxfLayerName(ent);
  const color = dxfEntityColor(ent, IMPORT_STYLE.polyline.color);
  const lid = ensureDxfLayer(layerName, fileSlug, layerCounts[layerName] || 0);
  const meta = { source: 'dxf', dxfLayer: layerName, dxfType: ent.type };
  const addVerts = (xyList, closed) => {
    let verts = xyList.map(p => {
      const g = dxfXYToLatLon(p.x, p.y, ctx);
      expandBounds(bounds, g.lat, g.lon);
      return g;
    });
    if (verts.length < 2) return;
    verts = simplifyLatLonVerts(verts, 120);
    if (closed && verts.length >= 3) {
      const f = verts[0];
      const closedRing = Math.hypot(f.lat - verts[verts.length - 1].lat, f.lon - verts[verts.length - 1].lon) < 1e-9
        ? verts : verts.concat([f]);
      out.push(makeImportPolygon(closedRing, lid, color, IMPORT_STYLE.polygon.fillColor, IMPORT_STYLE.polygon.strokeWidth, meta));
    } else {
      out.push(makeImportPolyline(verts, lid, color, IMPORT_STYLE.polyline.strokeWidth, meta));
    }
  };

  if (ent.type === 'LINE') {
    const x1 = dxfNums(ent, 10)[0], y1 = dxfNums(ent, 20)[0];
    const x2 = dxfNums(ent, 11)[0] ?? dxfNums(ent, 10)[1];
    const y2 = dxfNums(ent, 21)[0] ?? dxfNums(ent, 20)[1];
    addVerts([{ x: x1, y: y1 }, { x: x2, y: y2 }], false);
  } else if (ent.type === 'POINT') {
    const g = dxfXYToLatLon(dxfNums(ent, 10)[0], dxfNums(ent, 20)[0], ctx);
    expandBounds(bounds, g.lat, g.lon);
    out.push(makeImportPoint(g.lat, g.lon, lid, color, meta));
  } else if (ent.type === 'CIRCLE') {
    const cx = dxfNums(ent, 10)[0], cy = dxfNums(ent, 20)[0], r = dxfNums(ent, 40)[0];
    if (r > 0) {
      const ring = circleToLatLonRing(cx, cy, r, ctx, 32);
      ring.forEach(c => expandBounds(bounds, c.lat, c.lon));
      out.push(makeImportPolygon(ring, lid, color, 'rgba(127,140,141,0.12)', IMPORT_STYLE.polygon.strokeWidth, meta));
    }
  } else if (ent.type === 'LWPOLYLINE') {
    const xs = dxfNums(ent, 10), ys = dxfNums(ent, 20);
    const pts = xs.map((x, i) => ({ x, y: ys[i] }));
    const flags = parseInt(ent.props[70] || '0', 10);
    const closed = !!(flags & 1) || (pts.length > 2 &&
      Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 1e-6);
    addVerts(pts, closed);
  } else if (ent.type === 'POLYLINE' && ent.vertices && ent.vertices.length) {
    const flags = parseInt(ent.props[70] || '0', 10);
    const closed = !!(flags & 1);
    addVerts(ent.vertices, closed);
  } else if (ent.type === 'TEXT') {
    const g = dxfXYToLatLon(dxfNums(ent, 10)[0], dxfNums(ent, 20)[0], ctx);
    const txt = (ent.props[1] || '').toString();
    const fs = Math.max(8, Math.min(48, dxfNums(ent, 40)[0] || 12));
    expandBounds(bounds, g.lat, g.lon);
    out.push(makeImportText(g.lat, g.lon, txt, lid, color, fs, meta));
  } else if (ent.type === 'MTEXT') {
    const g = dxfXYToLatLon(dxfNums(ent, 10)[0], dxfNums(ent, 20)[0], ctx);
    const txt = stripMtext(ent.props[1] || ent.props[3] || '');
    const fs = Math.max(8, Math.min(48, dxfNums(ent, 40)[0] || 12));
    expandBounds(bounds, g.lat, g.lon);
    out.push(makeImportText(g.lat, g.lon, txt, lid, color, fs, meta));
  }
  return out;
}

async function dxfToImportObjects(text, fileName, bounds, debug) {
  debug.format = 'dxf';
  debug.entityCounts = {};
  debug.unsupported = {};
  debug.dxfLayers = new Set();
  showHint('DXF ayrıştırılıyor…');
  await new Promise(r => setTimeout(r, 0));

  const raw = extractDxfEntities(text);
  const entities = consolidateDxfEntities(raw);
  const ctx = buildDxfCoordContext(entities);
  const fileSlug = importSlug(fileName.replace(/\.[^.]+$/i, ''));
  const layerCounts = {};
  entities.forEach(e => {
    if (!DXF_SUPPORTED.has(e.type)) {
      debug.unsupported[e.type] = (debug.unsupported[e.type] || 0) + 1;
      return;
    }
    const ln = dxfLayerName(e);
    layerCounts[ln] = (layerCounts[ln] || 0) + 1;
  });

  const objects = [];
  for (let i = 0; i < entities.length; i += DXF_PARSE_BATCH) {
    const batch = entities.slice(i, i + DXF_PARSE_BATCH);
    for (const ent of batch) {
      if (!DXF_SUPPORTED.has(ent.type)) continue;
      debug.entityCounts[ent.type] = (debug.entityCounts[ent.type] || 0) + 1;
      const ln = dxfLayerName(ent);
      debug.dxfLayers.add(ln);
      const created = dxfEntityToObjects(ent, ctx, fileSlug, layerCounts, bounds, debug);
      created.forEach(o => {
        objects.push(o);
        debug.count++;
        debug.types[o.type] = (debug.types[o.type] || 0) + 1;
        debug.layers.add(o.layerId);
      });
    }
    if (i % (DXF_PARSE_BATCH * 4) === 0 && entities.length > 200) {
      showHint('DXF… ' + Math.min(100, Math.round((i / entities.length) * 100)) + '%');
      await new Promise(r => setTimeout(r, 0));
    }
  }

  const perLayer = {};
  objects.forEach(o => { perLayer[o.layerId] = (perLayer[o.layerId] || 0) + 1; });
  Object.entries(perLayer).forEach(([id, cnt]) => {
    const L = S.layers.find(l => l.id === id);
    if (L && cnt > DXF_HUGE_LAYER) L.visible = false;
  });
  if (objects.length > DXF_HUGE_TOTAL) {
    showHint('Büyük DXF: yoğun katmanlar kapalı — panelden açın');
  }

  console.log('[PlanAI Field DXF]', {
    file: debug.file,
    coordMode: ctx.mode,
    entityCounts: debug.entityCounts,
    unsupported: debug.unsupported,
    dxfLayerNames: [...debug.dxfLayers],
    objectCount: objects.length,
  });
  return objects;
}

// ── GML (lightweight XML + optional proj4) ─────────────────────
const TUREF_ZONE_DEFS = [
  [5253, 27], [5254, 30], [5255, 33], [5256, 36], [5257, 39], [5258, 42], [5259, 45],
  // CSB plan GML (GGRS87 / TM zones — alias to TUREF meridians)
  [7930, 27], [7931, 30], [7932, 33], [7933, 36], [7934, 39], [7935, 42], [7936, 45],
];
let _gmlProjReady = false;
let _gmlCrsWarned = new Set();
/** Per-import TM band — fixes ambiguous EPSG:793x tags (Çeşme CM27 vs CM30, etc.). */
let _gmlFileCmOverride = null;
/** Per-import E/N swap before TUREF reproject (axis-order recovery). */
let _gmlFileSwapEN = false;

function turefProj4String(cm) {
  return '+proj=tmerc +lat_0=0 +lon_0=' + cm + ' +k=1 +x_0=500000 +y_0=0 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';
}

function looksLikeTurefEN(x, y) {
  const ax = Math.abs(x), ay = Math.abs(y);
  return (ax > 100000 || ay > 100000) && ay > 3000000 && ax < 900000;
}

function normalizeTurefEN(valE, valN) {
  let e = valE, n = valN;
  if (e > 3000000 && n < 1000000) { e = valN; n = valE; }
  if (e > 3000000 && n > 3000000 && e > n) { const tmp = e; e = n; n = tmp; }
  return { e, n };
}

function detectTurefCm(e) {
  if (e < 350000) return 27;
  if (e < 550000) return 30;
  if (e < 650000) return 33;
  if (e < 750000) return 36;
  if (e < 850000) return 39;
  return 42;
}

function epsgFromTurefCm(cm) {
  const hit = TUREF_ZONE_DEFS.find(([, c]) => c === cm);
  return hit ? hit[0] : 7933;
}

function turefCmFromEpsg(epsg) {
  const hit = TUREF_ZONE_DEFS.find(([code]) => code === epsg);
  return hit ? hit[1] : null;
}

function turefReprojHit(normE, normN, cm) {
  const ll = inverseTM(normE, normN, cm);
  if (ll.lat < 35.5 || ll.lat > 42.5 || ll.lon < 25.5 || ll.lon > 45.5) return null;
  const k = 111320 * Math.cos(ll.lat * Math.PI / 180);
  return { score: Math.abs(500000 + (ll.lon - cm) * k - normE), lat: ll.lat, lon: ll.lon };
}

function getGmlImportAnchor() {
  const fix = _fieldGpsFix || _fieldGpsDisplay;
  if (fix?.lat != null && fix?.lon != null && isFinite(fix.lat) && isFinite(fix.lon)) {
    return { lat: fix.lat, lon: fix.lon };
  }
  if (S.mapCenter?.lat != null && isFinite(S.mapCenter.lat)) {
    return { lat: S.mapCenter.lat, lon: S.mapCenter.lon };
  }
  return null;
}

function collectTurefSamplesFromFeats(feats, maxSamples = 24) {
  const samples = [];
  if (!feats?.length) return samples;
  const step = Math.max(1, Math.floor(feats.length / maxSamples));
  for (let i = 0; i < feats.length && samples.length < maxSamples; i += step) {
    const f = feats[i];
    if (!f.nums || f.nums.length < 2) continue;
    const epsg = parseEpsgFromSrs(f.srs || '');
    if (!looksLikeTurefEN(f.nums[0], f.nums[1]) && !(epsg >= 7930 && epsg <= 7936)) continue;
    const norm = normalizeTurefEN(f.nums[0], f.nums[1]);
    samples.push({ e: norm.e, n: norm.n });
  }
  if (!samples.length && feats[0]?.nums?.length >= 2) {
    const norm = normalizeTurefEN(feats[0].nums[0], feats[0].nums[1]);
    samples.push({ e: norm.e, n: norm.n });
  }
  return samples;
}

function avgSampleEN(samples) {
  const avgE = samples.reduce((s, p) => s + p.e, 0) / samples.length;
  const avgN = samples.reduce((s, p) => s + p.n, 0) / samples.length;
  return { avgE, avgN };
}

/** Yer adı → yaklaşık WGS84 (CSB GML dosya adından konum ipucu). */
const PLACE_GEO_HINTS = {
  ozdere: { lat: 38.02, lon: 27.13 },
  menderes: { lat: 38.25, lon: 27.13 },
  alacati: { lat: 38.28, lon: 26.37 },
  cesme: { lat: 38.32, lon: 26.30 },
  izmir: { lat: 38.42, lon: 27.14 },
  kusadasi: { lat: 37.86, lon: 27.26 },
  didim: { lat: 37.38, lon: 27.27 },
  bodrum: { lat: 37.03, lon: 27.43 },
  antalya: { lat: 36.89, lon: 30.71 },
  burdur: { lat: 37.72, lon: 30.29 },
  afyon: { lat: 38.76, lon: 30.54 },
  konya: { lat: 37.87, lon: 32.49 },
  ankara: { lat: 39.93, lon: 32.85 },
  istanbul: { lat: 41.01, lon: 28.97 },
};

function geoHintFromImportName(name) {
  const norm = String(name || '').toLowerCase()
    .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's').replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c');
  const tokens = norm.split(/[^a-z0-9]+/).filter(Boolean);
  let best = null, bestLen = 0;
  for (const [key, hint] of Object.entries(PLACE_GEO_HINTS)) {
    if (!hint) continue;
    if (key.length < bestLen) continue;
    if (norm.includes(key) || tokens.some(t => t.includes(key) || key.includes(t))) {
      best = hint;
      bestLen = key.length;
    }
  }
  return best;
}

function geoHintDistDeg(lat, lon, hint) {
  if (!hint) return 0;
  const dlat = lat - hint.lat, dlon = lon - hint.lon;
  return Math.sqrt(dlat * dlat + dlon * dlon);
}

/** CSB GML E+N bölgesel TM band önceliği (EPSG:793x etiketi sık hatalı). */
function regionalTurefCmPrior(avgE, avgN) {
  if (avgN >= 4190000 && avgE >= 370000 && avgE < 515000) return 27;
  if (avgN >= 4040000 && avgN < 4170000 && avgE >= 440000 && avgE < 620000) return 30;
  if (avgN >= 4260000 && avgE >= 520000 && avgE < 600000) return 30;
  if (avgN >= 4150000 && avgN < 4280000 && avgE >= 520000 && avgE < 700000) return 33;
  return detectTurefCm(avgE);
}

/** File-level TM band — reproj + bölge/dosya adı (GPS kullanılmaz). */
function pickTurefCmForFile(samples, taggedEpsg, importName) {
  if (!samples.length) return detectTurefCm(500000);
  const { avgE, avgN } = avgSampleEN(samples);
  const taggedCm = taggedEpsg ? turefCmFromEpsg(taggedEpsg) : null;
  const geoHint = geoHintFromImportName(importName);
  const priorCm = regionalTurefCmPrior(avgE, avgN);
  const cms = [27, 30, 33, 36, 39, 42, 45];
  const rated = [];
  for (const cm of cms) {
    let reprojSum = 0, latSum = 0, lonSum = 0, n = 0;
    for (const { e, n: northing } of samples) {
      const hit = turefReprojHit(e, northing, cm);
      if (!hit) { n = -1; break; }
      reprojSum += hit.score;
      latSum += hit.lat;
      lonSum += hit.lon;
      n++;
    }
    if (n <= 0) continue;
    rated.push({ cm, reproj: reprojSum / n, lat: latSum / n, lon: lonSum / n });
  }
  if (!rated.length) return priorCm;

  const minReproj = Math.min(...rated.map(r => r.reproj));
  const ambiguous = rated.filter(r => r.reproj - minReproj < 15);
  const pool = ambiguous.length > 1 ? ambiguous : rated;
  let best = pool[0];
  let bestScore = Infinity;
  for (const r of pool) {
    let score = r.reproj;
    score += Math.abs(r.cm - priorCm) * 10;
    if (geoHint) score += geoHintDistDeg(r.lat, r.lon, geoHint) * 45;
    if (ambiguous.length <= 1 && taggedCm && r.cm === taggedCm) score *= 0.96;
    if (score < bestScore) { bestScore = score; best = r; }
  }
  return best.cm;
}

function isInTurkeyBbox(lat, lon) {
  return isFinite(lat) && isFinite(lon) && lat >= 35 && lat <= 43 && lon >= 25 && lon <= 45;
}

function sampleGmlFeatLatLon(f, swapEN) {
  if (!f?.nums || f.nums.length < 2) return null;
  let x = f.nums[0], y = f.nums[1];
  if (swapEN) { const t = x; x = y; y = t; }
  const g = gmlToWgs84Raw(x, y, f.srs || 'EPSG:4326');
  if (!g || !isFinite(g.lat) || !isFinite(g.lon)) return null;
  if (!isInTurkeyBbox(g.lat, g.lon) && isInTurkeyBbox(g.lon, g.lat)) {
    return { lat: g.lon, lon: g.lat };
  }
  return g;
}

function detectGmlFileCoordSwap(feats) {
  const samples = feats.filter(f => f.nums?.length >= 2).slice(0, 8);
  if (!samples.length) return false;
  let okNormal = 0, okSwap = 0;
  for (const f of samples) {
    const g0 = sampleGmlFeatLatLon(f, false);
    const g1 = sampleGmlFeatLatLon(f, true);
    if (g0 && isInTurkeyBbox(g0.lat, g0.lon)) okNormal++;
    if (g1 && isInTurkeyBbox(g1.lat, g1.lon)) okSwap++;
  }
  if (okSwap > okNormal) return true;
  return false;
}

function flipPlanOverlayLayerCoords(layerId) {
  if (!layerId) return;
  let n = 0;
  S.objects.forEach(o => {
    if ((o.layerId || '') !== layerId) return;
    const swap = v => {
      if (v?.lat == null || v?.lon == null) return;
      const t = v.lat; v.lat = v.lon; v.lon = t;
    };
    (o.rings || []).forEach(ring => ring.forEach(swap));
    (o.holes || []).forEach(ring => ring.forEach(swap));
    (o.vertices || []).forEach(swap);
    if (o.lat != null) swap(o);
    n++;
  });
  if (!n) { showHint('Plan katmanında geometri yok'); return; }
  const layer = S.layers.find(l => l.id === layerId);
  if (layer?.geoExtent) {
    const b = { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity, ok: false };
    S.objects.forEach(o => {
      if ((o.layerId || '') !== layerId) return;
      (o.rings?.[0] || o.vertices || []).forEach(c => { if (c.lat != null) expandBounds(b, c.lat, c.lon); });
      if (o.lat != null) expandBounds(b, o.lat, o.lon);
    });
    if (b.ok) savePlanOverlayGeoExtent(layerId, b);
  }
  scheduleRender();
  scheduleProjectSave();
  showHint('Koordinat ekseni çevrildi (X/Y) — ' + n + ' geometri');
}

function flipActivePlanOverlayCoords() {
  flipPlanOverlayLayerCoords(_activePlanOverlayLayerId);
}

/** Pick TM band by easting reconstruction — uses file override when set. */
function pickTurefCm(e, n, taggedEpsg) {
  if (_gmlFileCmOverride != null) return _gmlFileCmOverride;
  const norm = normalizeTurefEN(e, n);
  return pickTurefCmForFile([{ e: norm.e, n: norm.n }], taggedEpsg);
}

/** CSB plan GML often tags EPSG:793x while E coordinate belongs to another TM band — use easting fit (e-Plan behaviour). */
function turefENtoWgs84(e, n, cmOverride, srs) {
  ensureGmlProjDefs();
  const norm = normalizeTurefEN(e, n);
  const taggedEpsg = parseEpsgFromSrs(srs);
  const cm = cmOverride ?? pickTurefCm(norm.e, norm.n, taggedEpsg);
  const epsg = epsgFromTurefCm(cm);
  if (typeof proj4 !== 'undefined' && proj4.defs['EPSG:' + epsg]) {
    try {
      const p = proj4('EPSG:' + epsg, 'EPSG:4326', [norm.e, norm.n]);
      return { lat: p[1], lon: p[0], cm };
    } catch (err) {
      console.warn('[GML] TUREF reproject', epsg, err);
    }
  }
  const ll = inverseTM(norm.e, norm.n, cm);
  return { lat: ll.lat, lon: ll.lon, cm };
}

function inverseTM(E, N, cm) {
  const a = 6378137, f = 1 / 298.257222101, e2 = 2 * f - f * f, ep2 = e2 / (1 - e2);
  const k0 = 1, E0 = 500000, lon0 = cm * Math.PI / 180;
  const x = E - E0, y = N;
  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * e2 ** 3 / 256));
  let phi1 = mu;
  for (let i = 0; i < 5; i++) {
    const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    phi1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * phi1)
      + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * phi1)
      + (151 * e1 ** 3 / 96) * Math.sin(6 * phi1);
  }
  const sinP = Math.sin(phi1), cosP = Math.cos(phi1), tanP = Math.tan(phi1);
  const N1 = a / Math.sqrt(1 - e2 * sinP * sinP);
  const T = tanP * tanP, C = ep2 * cosP * cosP;
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sinP * sinP, 1.5);
  const D = x / (N1 * k0);
  const lat = phi1 - (N1 * tanP / R1) * (D * D / 2 - (5 + 3 * T + 10 * C - 4 * C * C - 9 * ep2) * D ** 4 / 24);
  const lon = lon0 + (D - (1 + 2 * T + C) * D ** 3 / 6 + (5 - 2 * C + 28 * T - 3 * C * C + 8 * ep2 + 24 * T * T) * D ** 5 / 120) / cosP;
  return { lat: lat * 180 / Math.PI, lon: lon * 180 / Math.PI };
}

function bestTurefENtoWgs84(e, n, srs) {
  const norm = normalizeTurefEN(e, n);
  return turefENtoWgs84(norm.e, norm.n, null, srs);
}

function warnUnknownCrs(srs, epsg) {
  const key = srs || String(epsg);
  if (_gmlCrsWarned.has(key)) return;
  _gmlCrsWarned.add(key);
  showHint('CRS uyarısı: ' + (srs || 'EPSG:' + epsg) + ' — TUREF tahmini kullanıldı', 8000);
}

function ensureGmlProjDefs() {
  if (_gmlProjReady || typeof proj4 === 'undefined') return;
  try {
    if (!proj4.defs['EPSG:3857']) {
      proj4.defs('EPSG:3857', '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs');
    }
    TUREF_ZONE_DEFS.forEach(([epsg, cm]) => {
      const code = 'EPSG:' + epsg;
      if (!proj4.defs[code]) proj4.defs(code, turefProj4String(cm));
    });
    if (!proj4.defs['EPSG:32636']) {
      proj4.defs('EPSG:32636', '+proj=utm +zone=36 +datum=WGS84 +units=m +no_defs');
    }
    if (!proj4.defs['EPSG:32635']) {
      proj4.defs('EPSG:32635', '+proj=utm +zone=35 +datum=WGS84 +units=m +no_defs');
    }
    _gmlProjReady = true;
  } catch (e) {
    console.warn('[GML] proj4 defs', e);
  }
}

function parseEpsgFromSrs(srs) {
  if (!srs) return null;
  const m = String(srs).match(/EPSG[:/]*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

function gmlToWgs84Raw(x, y, srs) {
  const epsg = parseEpsgFromSrs(srs);
  let ax = x, ay = y;
  if (_gmlFileSwapEN) { ax = y; ay = x; }
  if ((epsg >= 7930 && epsg <= 7936) || (epsg >= 5253 && epsg <= 5259) || looksLikeTurefEN(ax, ay)) {
    const r = turefENtoWgs84(ax, ay, null, srs);
    return { lat: r.lat, lon: r.lon };
  }
  if (!epsg || epsg === 4326) {
    const isGeoLatLon = Math.abs(ax) <= 90 && Math.abs(ay) <= 180;
    const isGeoLonLat = Math.abs(ay) <= 90 && Math.abs(ax) <= 180;
    if (isGeoLatLon && !isGeoLonLat) return { lat: ax, lon: ay };
    if (isGeoLonLat && !isGeoLatLon) return { lat: ay, lon: ax };
    if (isGeoLatLon && isGeoLonLat) {
      if (isInTurkeyBbox(ay, ax) && !isInTurkeyBbox(ax, ay)) return { lat: ay, lon: ax };
      return { lat: ax, lon: ay };
    }
    return { lat: ay, lon: ax };
  }
  ensureGmlProjDefs();
  if (typeof proj4 !== 'undefined') {
    try {
      const src = 'EPSG:' + epsg;
      if (proj4.defs[src]) {
        const p = proj4(src, 'EPSG:4326', [ax, ay]);
        return { lon: p[0], lat: p[1] };
      }
    } catch (e) {
      console.warn('[GML] reproject', srs, e);
    }
  }
  if (epsg) warnUnknownCrs(srs, epsg);
  const dX = ax - 500000, dY = ay;
  const lat = S.mapCenter.lat - dY / 111320;
  const lon = S.mapCenter.lon + dX / (111320 * Math.cos(S.mapCenter.lat * Math.PI / 180));
  return { lat, lon };
}

function gmlToWgs84(x, y, srs) {
  const g = gmlToWgs84Raw(x, y, srs);
  if (g && isFinite(g.lat) && isFinite(g.lon)) return g;
  return { lat: y, lon: x };
}

function parseGmlPosList(text) {
  return text.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
}

/** GML 2.0 coordinates: "x,y x,y" — honors cs/ts when present. */
function parseGmlCoordinates(text, coordEl) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const cs = (coordEl?.getAttribute?.('cs') || coordEl?.getAttribute?.('gml:cs') || ',').trim() || ',';
  const ts = (coordEl?.getAttribute?.('ts') || coordEl?.getAttribute?.('gml:ts') || ' ').trim() || ' ';
  const pairSep = ts === '' ? /\s+/ : new RegExp('\\s*' + ts.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '+\\s*');
  const nums = [];
  for (const token of raw.split(pairSep)) {
    if (!token) continue;
    const parts = cs ? token.split(cs) : [token];
    for (const part of parts) {
      const n = Number(String(part).trim());
      if (!isNaN(n)) nums.push(n);
    }
  }
  if (nums.length >= 2) return nums;
  return parseGmlPosList(raw);
}

function gmlCoordNumsFromNode(node) {
  if (!node) return [];
  if (gmlLocalName(node) === 'coordinates') return parseGmlCoordinates(node.textContent, node);
  return parseGmlPosList(node.textContent);
}

function gmlPosListStride(nums, posNode) {
  if (!nums.length) return 2;
  const dim = posNode?.getAttribute?.('srsDimension') || posNode?.parentElement?.getAttribute?.('srsDimension');
  if (dim === '3' || dim === 3) return 3;
  if (nums.length >= 9 && nums.length % 3 === 0) {
    let maxHoriz = 0, maxZ = 0;
    for (let i = 0; i < nums.length; i += 3) {
      maxHoriz = Math.max(maxHoriz, Math.abs(nums[i]), Math.abs(nums[i + 1]));
      maxZ = Math.max(maxZ, Math.abs(nums[i + 2]));
    }
    if (maxZ < Math.max(maxHoriz * 3, 9000)) return 3;
  }
  return 2;
}

function gmlPosListToRing(nums, srs, posNode) {
  const stride = gmlPosListStride(nums, posNode);
  const ring = [];
  for (let i = 0; i + stride - 1 < nums.length; i += stride) {
    const g = gmlToWgs84(nums[i], nums[i + 1], srs || 'EPSG:4326');
    if (!isFinite(g.lat) || !isFinite(g.lon)) continue;
    ring.push(g);
  }
  if (ring.length >= 2) {
    const a = ring[0], b = ring[ring.length - 1];
    if (Math.abs(a.lat - b.lat) < 1e-7 && Math.abs(a.lon - b.lon) < 1e-7) ring.pop();
  }
  return ring.length >= 3 ? ring : [];
}

function gmlDocumentDefaultSrs(doc, text) {
  const root = doc?.documentElement;
  if (doc) {
    const envs = doc.getElementsByTagNameNS(GML_NS, 'Envelope');
    if (envs.length) {
      const envSrs = envs[0].getAttribute('srsName');
      if (envSrs) return envSrs;
    }
    const walkEnv = el => {
      if (!el || el.nodeType !== 1) return null;
      if (gmlLocalName(el) === 'envelope') {
        const envSrs = el.getAttribute('srsName');
        if (envSrs) return envSrs;
      }
      for (const ch of el.children || []) {
        const s = walkEnv(ch);
        if (s) return s;
      }
      return null;
    };
    const envSrs = root && walkEnv(root);
    if (envSrs) return envSrs;
  }
  const srs = root?.getAttribute('srsName') || root?.getAttribute('gml:srsName');
  if (srs) return srs;
  const m = String(text || '').match(/<(?:[\w.-]+:)?Envelope[^>]*\ssrsName=["']([^"']+)["']/i)
    || String(text || '').match(/srsName=["']([^"']+)["']/i);
  return m ? m[1] : 'EPSG:4326';
}

function detectCityGml(doc, text) {
  const root = doc?.documentElement;
  if (!root) return false;
  const ln = (root.localName || '').toLowerCase();
  if (ln === 'citymodel') return true;
  const ns = root.namespaceURI || '';
  if (ns.includes(CITYGML_NS_HINT)) return true;
  return /<(?:\w+:)?CityModel\b/i.test(text || '') || /citygml\/2\.0/i.test(text || '');
}

function detectPlanGml(doc, text) {
  const root = doc?.documentElement;
  if (!root) return false;
  const ln = (root.localName || root.nodeName?.replace(/^.*:/, '') || '').toLowerCase();
  if (ln !== 'featurecollection') return false;
  const ns = root.namespaceURI || '';
  if (ns.includes('csb.gov.tr')) return true;
  const raw = String(text || '');
  return /xmlns:plan=["'][^"']*csb\.gov\.tr/i.test(raw)
    || /<(?:plan:)?FeatureCollection\b/i.test(raw) && /csb\.gov\.tr/i.test(raw)
    || /uip\.v\.\d/i.test(raw);
}

function planGmlPropsFromTextBefore(text, index) {
  const before = text.slice(Math.max(0, index - 6000), index);
  const props = {};
  let featType = null;
  const tags = [...before.matchAll(/<(?:plan:)?([A-Z][A-Za-z0-9]*)\b/g)];
  for (let i = tags.length - 1; i >= 0; i--) {
    const n = tags[i][1];
    if (PLAN_GML_MPY_LAYER_MAP[n] || /Alani|Siniri|Plaj|Tip|Bahcesi|Kenari|Cizgisi/i.test(n)) {
      featType = n;
      break;
    }
  }
  if (featType) props.PlanFeatureType = featType;
  const blockStart = featType
    ? Math.max(
      before.lastIndexOf('<plan:' + featType),
      before.lastIndexOf('<' + featType),
    )
    : 0;
  const blockSlice = blockStart >= 0 ? before.slice(blockStart) : before;
  for (const m of blockSlice.matchAll(/<(?:plan:)?([A-Za-z][\w]+)>([^<]*)<\/(?:plan:)?\1>/g)) {
    const v = m[2]?.trim();
    if (v) props[m[1]] = v;
  }
  return props;
}

function planGmlExtractCoordinatesRegex(text, defaultSrs) {
  const feats = [];
  const seen = new Set();
  const re = /<(?:([A-Za-z_][\w.-]*):)?coordinates\b([^>]*)>([\s\S]*?)<\/(?:\1:)?coordinates>/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    let srs = defaultSrs || 'EPSG:7931';
    const attrSrs = (m[2] || '').match(/srsName=["']([^"']+)["']/i);
    if (attrSrs) srs = attrSrs[1];
    else {
      const before = text.slice(Math.max(0, m.index - 500), m.index);
      const hits = before.match(/srsName=["'](EPSG:\d+)["']/gi);
      if (hits?.length) srs = hits[hits.length - 1].replace(/.*(EPSG:\d+).*/i, '$1');
    }
    const nums = parseGmlCoordinates(m[3]);
    if (nums.length < 4) continue;
    const kind = nums.length >= 6 ? 'polygon' : 'line';
    const key = planGmlFeatureCoordKey(nums, kind);
    if (seen.has(key)) continue;
    seen.add(key);
    const props = planGmlPropsFromTextBefore(text, m.index);
    const f = { props, layer: 'Plan', planFeatureType: props.PlanFeatureType || null };
    planGmlAnnotateFeature(f, null);
    f.layer = planGmlResolveLayerName(f);
    feats.push({
      kind: nums.length >= 6 ? 'polygon' : 'line',
      nums, srs,
      posNode: null,
      props: f.props,
      layer: f.layer,
      planFeatureType: f.planFeatureType,
      planFeatureLabel: f.planFeatureLabel,
    });
  }
  return feats;
}

function planGmlInheritedSrs(el, defaultSrs) {
  return gmlInheritedSrs(el) || defaultSrs || 'EPSG:7931';
}

function planGmlLineNumsFromElement(lineEl, defaultSrs) {
  if (!lineEl) return null;
  const srs = planGmlInheritedSrs(lineEl, defaultSrs);
  const pl = lineEl.getElementsByTagNameNS(GML_NS, 'posList')[0]
    || gmlFindChildByLocalName(lineEl, 'posList')
    || gmlFindDescendantByLocalName(lineEl, 'posList');
  if (pl) {
    const nums = parseGmlPosList(pl.textContent);
    if (nums.length >= 4) return { nums, posNode: pl, srs: planGmlInheritedSrs(pl, srs) };
  }
  const coords = lineEl.getElementsByTagNameNS(GML_NS, 'coordinates')[0]
    || gmlFindChildByLocalName(lineEl, 'coordinates')
    || gmlFindDescendantByLocalName(lineEl, 'coordinates');
  if (coords) {
    const nums = parseGmlCoordinates(coords.textContent, coords);
    if (nums.length >= 4) return { nums, posNode: coords, srs: planGmlInheritedSrs(coords, srs) };
  }
  const posEls = gmlCollectPosElements(lineEl);
  if (posEls.length >= 2) {
    const nums = [];
    posEls.forEach(p => nums.push(...parseGmlPosList(p.textContent)));
    if (nums.length >= 4) return { nums, posNode: posEls[0], srs: planGmlInheritedSrs(posEls[0], srs) };
  }
  return null;
}

function planGmlPointNumsFromElement(ptEl, defaultSrs) {
  if (!ptEl) return null;
  const srs = planGmlInheritedSrs(ptEl, defaultSrs);
  const pos = ptEl.getElementsByTagNameNS(GML_NS, 'pos')[0] || gmlFindChildByLocalName(ptEl, 'pos');
  if (pos) {
    const nums = parseGmlPosList(pos.textContent);
    if (nums.length >= 2) return { nums, posNode: pos, srs: planGmlInheritedSrs(pos, srs) };
  }
  const coords = ptEl.getElementsByTagNameNS(GML_NS, 'coordinates')[0] || gmlFindChildByLocalName(ptEl, 'coordinates');
  if (coords) {
    const nums = parseGmlCoordinates(coords.textContent, coords);
    if (nums.length >= 2) return { nums, posNode: coords, srs: planGmlInheritedSrs(coords, srs) };
  }
  return null;
}

function planGmlPushLineFeats(feats, seen, lineEl, defaultSrs) {
  const parsed = planGmlLineNumsFromElement(lineEl, defaultSrs);
  if (!parsed) return;
  const { nums, srs, posNode } = parsed;
  const key = 'L:' + nums.slice(0, 8).join(',');
  if (seen.has(key)) return;
  seen.add(key);
  const parent = planGmlFeatureParent(lineEl);
  const props = parent ? planGmlReadFeatureProps(parent) : {};
  const f = { props, layer: planGmlLayerName(lineEl) };
  planGmlAnnotateFeature(f, parent);
  feats.push({
    kind: 'line', nums, srs, posNode,
    props: f.props,
    layer: planGmlResolveLayerName(f),
    planFeatureType: f.planFeatureType,
    planFeatureLabel: f.planFeatureLabel,
  });
}

function planGmlPushCurveFeats(feats, seen, curveEl, defaultSrs) {
  planGmlPushLineFeats(feats, seen, curveEl, defaultSrs);
}

function planGmlPushPointFeats(feats, seen, ptEl, defaultSrs) {
  const parsed = planGmlPointNumsFromElement(ptEl, defaultSrs);
  if (!parsed) return;
  const { nums, srs, posNode } = parsed;
  const key = 'P:' + nums.slice(0, 2).join(',');
  if (seen.has(key)) return;
  seen.add(key);
  const parent = planGmlFeatureParent(ptEl);
  const props = parent ? planGmlReadFeatureProps(parent) : {};
  const f = { props, layer: planGmlLayerName(ptEl) };
  planGmlAnnotateFeature(f, parent);
  feats.push({
    kind: 'point', nums, srs, posNode,
    props: f.props,
    layer: planGmlResolveLayerName(f),
    planFeatureType: f.planFeatureType,
    planFeatureLabel: f.planFeatureLabel,
  });
}

function planGmlPushMultiSurfaceFeats(feats, seen, msEl, defaultSrs) {
  const srs = planGmlInheritedSrs(msEl, defaultSrs);
  const polys = msEl.getElementsByTagNameNS(GML_NS, 'Polygon');
  for (let i = 0; i < polys.length; i++) {
    planGmlPushPolygonFeats(feats, seen, polys[i], srs, null);
  }
  for (const poly of gmlAllElementsByLocalName(msEl, 'Polygon')) {
    planGmlPushPolygonFeats(feats, seen, poly, srs, null);
  }
}

function planGmlPushPolygonFeats(feats, seen, poly, defaultSrs, doc) {
  let srs = gmlInheritedSrs(poly);
  if (!srs) {
    let p = poly.parentElement;
    while (p && !srs) {
      srs = p.getAttribute?.('srsName');
      p = p.parentElement;
    }
  }
  if (!srs) srs = defaultSrs || 'EPSG:7931';
  const f = cityGmlPolygonFeatureFromElement(poly, srs);
  if (!f) return;
  const key = planGmlFeatureCoordKey(f.nums, 'polygon');
  if (seen.has(key)) return;
  seen.add(key);
  const parent = planGmlFeatureParent(poly);
  f.layer = planGmlLayerName(poly);
  f.props = parent ? planGmlReadFeatureProps(parent) : {};
  planGmlAnnotateFeature(f, parent);
  f.layer = planGmlResolveLayerName(f);
  feats.push(f);
}

function planGmlExtractFeatures(doc, text) {
  const feats = [];
  const seen = new Set();
  const defaultSrs = gmlDocumentDefaultSrs(doc, text) || 'EPSG:7931';
  const polys = doc.getElementsByTagNameNS(GML_NS, 'Polygon');
  for (let i = 0; i < polys.length; i++) {
    planGmlPushPolygonFeats(feats, seen, polys[i], defaultSrs, doc);
  }
  if (!feats.length) {
    for (const poly of gmlAllElementsByLocalName(doc, 'Polygon')) {
      planGmlPushPolygonFeats(feats, seen, poly, defaultSrs, doc);
    }
  }
  const lines = doc.getElementsByTagNameNS(GML_NS, 'LineString');
  for (let i = 0; i < lines.length; i++) {
    planGmlPushLineFeats(feats, seen, lines[i], defaultSrs);
  }
  for (const ls of gmlAllElementsByLocalName(doc, 'LineString')) {
    planGmlPushLineFeats(feats, seen, ls, defaultSrs);
  }
  for (const curve of gmlAllElementsByLocalName(doc, 'Curve')) {
    planGmlPushCurveFeats(feats, seen, curve, defaultSrs);
  }
  for (const pt of gmlAllElementsByLocalName(doc, 'Point')) {
    planGmlPushPointFeats(feats, seen, pt, defaultSrs);
  }
  for (const ms of gmlAllElementsByLocalName(doc, 'MultiSurface')) {
    planGmlPushMultiSurfaceFeats(feats, seen, ms, defaultSrs);
  }
  for (const ms of gmlAllElementsByLocalName(doc, 'CompositeSurface')) {
    planGmlPushMultiSurfaceFeats(feats, seen, ms, defaultSrs);
  }
  if (text && !feats.length) {
    planGmlExtractCoordinatesRegex(text, defaultSrs).forEach(f => {
      const key = planGmlFeatureCoordKey(f.nums, f.kind === 'line' ? 'line' : 'polygon');
      if (seen.has(key)) return;
      seen.add(key);
      feats.push(f);
    });
  }
  return feats;
}

function planGmlFeatureParent(el) {
  let p = gmlXmlParent(el);
  while (p) {
    const ln = gmlLocalName(p);
    if (ln === 'featurecollection' || ln === 'featuremember' || ln === 'geometryproperty') {
      p = gmlXmlParent(p);
      continue;
    }
    if (ln === 'polygon' || ln === 'multipolygon' || ln === 'polygonmember' || ln === 'linearring'
      || ln === 'multisurface' || ln === 'compositesurface' || ln === 'surfacemember'
      || ln === 'linestring' || ln === 'curve' || ln === 'point'
      || ln === 'outerboundaryis' || ln === 'exterior' || ln === 'interior') {
      p = gmlXmlParent(p);
      continue;
    }
    const ns = p.namespaceURI || '';
    if (ns.includes('csb.gov.tr') || (ln && PLAN_GML_MPY_LAYER_MAP[ln])) return p;
    if (ln && ln !== 'gml') return p;
    p = gmlXmlParent(p);
  }
  return null;
}

function planGmlLayerName(polyEl) {
  let p = gmlXmlParent(polyEl);
  while (p) {
    const adi = gmlFindChildByLocalName(p, 'Adi');
    if (adi?.textContent?.trim()) return adi.textContent.trim();
    p = gmlXmlParent(p);
  }
  p = planGmlFeatureParent(polyEl);
  if (p?.localName && gmlLocalName(p) !== 'featuremember') return p.localName;
  return 'Plan';
}

function gmlInheritedSrs(el) {
  let n = el;
  while (n && n.nodeType === 1) {
    const srs = n.getAttribute?.('srsName');
    if (srs) return srs;
    n = gmlXmlParent(n);
  }
  return null;
}

function gmlLocalName(el) {
  return (el?.localName || '').toLowerCase();
}

function gmlFindChildByLocalName(el, name) {
  const want = name.toLowerCase();
  return [...(el?.children || [])].find(ch => gmlLocalName(ch) === want) || null;
}

function gmlFindDescendantByLocalName(el, name) {
  const want = name.toLowerCase();
  return [...(el?.getElementsByTagName?.('*') || [])].find(ch => gmlLocalName(ch) === want) || null;
}

function gmlFindExteriorLinearRing(polygonEl) {
  if (!polygonEl) return null;
  const exteriors = polygonEl.getElementsByTagNameNS(GML_NS, 'exterior');
  for (let i = 0; i < exteriors.length; i++) {
    const ring = exteriors[i].getElementsByTagNameNS(GML_NS, 'LinearRing')[0]
      || gmlFindChildByLocalName(exteriors[i], 'LinearRing')
      || gmlFindDescendantByLocalName(exteriors[i], 'LinearRing');
    if (ring) return ring;
  }
  const outer = polygonEl.getElementsByTagNameNS(GML_NS, 'outerBoundaryIs');
  for (let i = 0; i < outer.length; i++) {
    const ring = gmlFindChildByLocalName(outer[i], 'LinearRing') || gmlFindDescendantByLocalName(outer[i], 'LinearRing');
    if (ring) return ring;
  }
  return polygonEl.getElementsByTagNameNS(GML_NS, 'LinearRing')[0]
    || gmlFindChildByLocalName(polygonEl, 'LinearRing')
    || gmlFindDescendantByLocalName(polygonEl, 'LinearRing');
}

function gmlCollectPosElements(ringEl) {
  const posEls = [];
  const walk = el => {
    if (!el || el.nodeType !== 1) return;
    if (gmlLocalName(el) === 'pos') posEls.push(el);
    else if (gmlLocalName(el) !== 'poslist') [...el.children].forEach(walk);
  };
  walk(ringEl);
  return posEls;
}

function gmlLinearRingToNums(ringEl, defaultSrs) {
  if (!ringEl) return null;
  const pl = ringEl.getElementsByTagNameNS(GML_NS, 'posList')[0]
    || gmlFindChildByLocalName(ringEl, 'posList');
  if (pl) {
    const nums = parseGmlPosList(pl.textContent);
    if (nums.length >= 4) {
      return {
        nums,
        posNode: pl,
        srs: gmlInheritedSrs(pl) || gmlInheritedSrs(ringEl) || defaultSrs,
      };
    }
  }
  const coords = ringEl.getElementsByTagNameNS(GML_NS, 'coordinates')[0]
    || gmlFindChildByLocalName(ringEl, 'coordinates');
  if (coords) {
    const nums = parseGmlCoordinates(coords.textContent);
    if (nums.length >= 4) {
      return {
        nums,
        posNode: coords,
        srs: gmlInheritedSrs(coords) || gmlInheritedSrs(ringEl) || defaultSrs,
      };
    }
  }
  const posEls = gmlCollectPosElements(ringEl);
  if (posEls.length >= 3) {
    const nums = [];
    posEls.forEach(p => nums.push(...parseGmlPosList(p.textContent)));
    if (nums.length >= 6) {
      return {
        nums,
        posNode: posEls[0],
        srs: gmlInheritedSrs(posEls[0]) || gmlInheritedSrs(ringEl) || defaultSrs,
      };
    }
  }
  return null;
}

function gmlPosNodeFromContainer(el) {
  if (!el) return null;
  const ring = gmlFindChildByLocalName(el, 'LinearRing') || gmlFindDescendantByLocalName(el, 'LinearRing');
  const pl = gmlFindChildByLocalName(el, 'posList')
    || (ring && gmlFindChildByLocalName(ring, 'posList'))
    || gmlFindDescendantByLocalName(el, 'posList');
  if (pl) return pl;
  const coords = gmlFindChildByLocalName(el, 'coordinates')
    || (ring && gmlFindChildByLocalName(ring, 'coordinates'))
    || gmlFindDescendantByLocalName(el, 'coordinates');
  if (coords) return coords;
  return gmlFindChildByLocalName(el, 'pos')
    || (ring && gmlFindChildByLocalName(ring, 'pos'))
    || gmlFindDescendantByLocalName(el, 'pos');
}

function gmlFindExteriorPosNode(polygonEl) {
  if (!polygonEl) return null;
  const exteriors = polygonEl.getElementsByTagNameNS(GML_NS, 'exterior');
  for (let i = 0; i < exteriors.length; i++) {
    const n = gmlPosNodeFromContainer(exteriors[i]);
    if (n) return n;
  }
  const outer = polygonEl.getElementsByTagNameNS(GML_NS, 'outerBoundaryIs');
  for (let i = 0; i < outer.length; i++) {
    const n = gmlPosNodeFromContainer(outer[i]);
    if (n) return n;
  }
  const rings = polygonEl.getElementsByTagNameNS(GML_NS, 'LinearRing');
  for (let i = 0; i < rings.length; i++) {
    const n = gmlPosNodeFromContainer(rings[i]);
    if (n) return n;
  }
  let n = polygonEl.getElementsByTagNameNS(GML_NS, 'posList')[0]
    || polygonEl.getElementsByTagNameNS(GML_NS, 'pos')[0]
    || polygonEl.getElementsByTagNameNS(GML_NS, 'coordinates')[0];
  if (n) return n;
  const extLocal = gmlFindChildByLocalName(polygonEl, 'exterior') || gmlFindDescendantByLocalName(polygonEl, 'exterior');
  if (extLocal) {
    n = gmlPosNodeFromContainer(extLocal);
    if (n) return n;
  }
  return gmlPosNodeFromContainer(polygonEl);
}

function cityGmlPolygonFeatureFromElement(polygonEl, defaultSrs) {
  const ring = gmlFindExteriorLinearRing(polygonEl);
  let parsed = ring ? gmlLinearRingToNums(ring, defaultSrs) : null;
  if (!parsed) {
    const posNode = gmlFindExteriorPosNode(polygonEl);
    if (!posNode) return null;
    const nums = parseGmlPosList(posNode.textContent);
    if (nums.length < 4) {
      const alt = gmlCoordNumsFromNode(posNode);
      if (alt.length >= 4) parsed = { nums: alt, posNode, srs: gmlInheritedSrs(polygonEl) || gmlInheritedSrs(posNode) || defaultSrs };
    } else {
      parsed = {
        nums,
        posNode,
        srs: gmlInheritedSrs(polygonEl) || gmlInheritedSrs(posNode) || defaultSrs,
      };
    }
    if (!parsed) return null;
  }
  if (!parsed?.nums || parsed.nums.length < 4) return null;
  const srs = parsed.srs || defaultSrs || 'EPSG:4326';
  return { kind: 'polygon', nums: parsed.nums, srs, posNode: parsed.posNode, props: {}, layer: 'CityGML' };
}

function cityGmlExtractPolygonFeatures(doc, text) {
  const defaultSrs = gmlDocumentDefaultSrs(doc, text);
  const feats = [];
  const seen = new Set();
  const polys = doc.getElementsByTagNameNS(GML_NS, 'Polygon');
  for (let i = 0; i < polys.length && feats.length < CITYGML_MAX_POLYGONS; i++) {
    const poly = polys[i];
    const f = cityGmlPolygonFeatureFromElement(poly, defaultSrs);
    if (!f) continue;
    const key = f.nums.slice(0, 12).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    feats.push(f);
  }
  if (!feats.length) {
    const rings = doc.getElementsByTagNameNS(GML_NS, 'LinearRing');
    for (let i = 0; i < rings.length && feats.length < CITYGML_MAX_POLYGONS; i++) {
      const parsed = gmlLinearRingToNums(rings[i], defaultSrs);
      if (!parsed) continue;
      const key = parsed.nums.slice(0, 12).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      feats.push({
        kind: 'polygon', nums: parsed.nums, srs: parsed.srs || defaultSrs,
        posNode: parsed.posNode, props: {}, layer: 'CityGML',
      });
    }
  }
  return feats;
}

function gmlAllElementsByLocalName(doc, localName) {
  const out = [];
  const want = localName.toLowerCase();
  const walk = el => {
    if (!el || el.nodeType !== 1) return;
    if (gmlLocalName(el) === want) out.push(el);
    [...el.children].forEach(walk);
  };
  if (doc?.documentElement) walk(doc.documentElement);
  return out;
}

function cityGmlExtractLocalNamePolygons(doc, defaultSrs) {
  const feats = [];
  const seen = new Set();
  const push = f => {
    if (!f) return;
    const key = f.nums.slice(0, 12).join(',');
    if (seen.has(key)) return;
    seen.add(key);
    feats.push(f);
  };
  for (const poly of gmlAllElementsByLocalName(doc, 'Polygon')) {
    push(cityGmlPolygonFeatureFromElement(poly, defaultSrs));
  }
  if (!feats.length) {
    for (const ring of gmlAllElementsByLocalName(doc, 'LinearRing')) {
      const parsed = gmlLinearRingToNums(ring, defaultSrs);
      if (!parsed) continue;
      push({
        kind: 'polygon', nums: parsed.nums,
        srs: parsed.srs || defaultSrs,
        posNode: parsed.posNode, props: {}, layer: 'CityGML',
      });
    }
  }
  if (!feats.length) {
    for (const pl of gmlAllElementsByLocalName(doc, 'posList')) {
      const nums = parseGmlPosList(pl.textContent);
      if (nums.length < 4) continue;
      push({
        kind: 'polygon', nums,
        srs: gmlInheritedSrs(pl) || defaultSrs,
        posNode: pl, props: {}, layer: 'CityGML',
      });
    }
  }
  return feats;
}

function cityGmlExtractLod0Footprints(doc, defaultSrs) {
  const feats = [];
  const seen = new Set();
  for (const container of gmlAllElementsByLocalName(doc, 'lod0FootPrint')) {
    const polys = [];
    const walk = el => {
      if (gmlLocalName(el) === 'polygon') polys.push(el);
      [...el.children].forEach(walk);
    };
    walk(container);
    for (const poly of polys) {
      const f = cityGmlPolygonFeatureFromElement(poly, defaultSrs);
      if (!f) continue;
      const key = f.nums.slice(0, 12).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      f.props = { ...(f.props || {}), lod: 'lod0FootPrint' };
      f.layer = 'CityGML';
      feats.push(f);
    }
  }
  return feats;
}

/** Regex fallback when namespaces break querySelector (large CityGML). */
function cityGmlExtractPosListsRegex(text, defaultSrs) {
  const feats = [];
  const seen = new Set();
  const pushNums = (nums, srsHint) => {
    if (nums.length < 4) return;
    const key = nums.slice(0, 12).join(',');
    if (seen.has(key)) return;
    seen.add(key);
    feats.push({
      kind: 'polygon', nums,
      srs: srsHint || defaultSrs || 'EPSG:4326',
      posNode: null, props: {}, layer: 'CityGML',
    });
  };
  const reList = /<(?:([A-Za-z_][\w.-]*):)?posList\b([^>]*)>([\s\S]*?)<\/(?:\1:)?posList>/gi;
  let m;
  while ((m = reList.exec(text)) !== null && feats.length < CITYGML_MAX_POLYGONS) {
    const attrs = m[2] || '';
    const srsM = attrs.match(/srsName=["']([^"']+)["']/i);
    pushNums(parseGmlPosList(m[3]), srsM ? srsM[1] : null);
  }
  const reCoords = /<(?:([A-Za-z_][\w.-]*):)?coordinates\b[^>]*>([\s\S]*?)<\/(?:\1:)?coordinates>/gi;
  while ((m = reCoords.exec(text)) !== null && feats.length < CITYGML_MAX_POLYGONS) {
    pushNums(parseGmlCoordinates(m[2]), defaultSrs);
  }
  const reRing = /<(?:([A-Za-z_][\w.-]*):)?LinearRing\b[^>]*>([\s\S]*?)<\/(?:\1:)?LinearRing>/gi;
  while ((m = reRing.exec(text)) !== null && feats.length < CITYGML_MAX_POLYGONS) {
    const inner = m[2] || '';
    const posRe = /<(?:([A-Za-z_][\w.-]*):)?pos\b[^>]*>([\s\S]*?)<\/(?:\1:)?pos>/gi;
    const nums = [];
    let pm;
    while ((pm = posRe.exec(inner)) !== null) nums.push(...parseGmlPosList(pm[2]));
    if (nums.length >= 6) pushNums(nums, defaultSrs);
  }
  return feats;
}

function gmlAttrs(el, prefix) {
  const props = {};
  if (!el || el.nodeType !== 1) return props;
  const walk = (node, pfx) => {
    [...(node.children || [])].forEach(ch => {
      if (ch.nodeType !== 1) return;
      if (ch.namespaceURI === GML_NS) return;
      const ln = ch.localName;
      if (!ln) return;
      if (/^geometry/i.test(ln)) return;
      const key = pfx ? pfx + '.' + ln : ln;
      const childEls = [...ch.children].filter(c => c.nodeType === 1 && c.namespaceURI !== GML_NS);
      if (childEls.length) {
        walk(ch, key);
      } else {
        const t = (ch.textContent || '').trim();
        if (t) props[key] = t;
      }
    });
  };
  walk(el, prefix || '');
  return props;
}

function gmlFindGeometries(root) {
  const feats = [];
  const walk = (el, inheritedSrs, layerHint) => {
    if (!el || el.nodeType !== 1) return;
    const srs = el.getAttribute('srsName') || el.getAttribute('srsDimension') && inheritedSrs || inheritedSrs;
    const ln = el.localName;
    if (ln === 'Point' || ln === 'point') {
      const pos = el.querySelector('pos, gml\\:pos, coordinates, gml\\:coordinates');
      if (pos) {
        const nums = parseGmlPosList(pos.textContent);
        if (nums.length >= 2) feats.push({ kind: 'point', nums, srs, props: gmlAttrs(el.parentElement || el), layer: layerHint });
      }
    } else if (ln === 'LineString' || ln === 'lineString' || ln === 'Curve') {
      const posList = el.querySelector('posList, gml\\:posList, coordinates, gml\\:coordinates');
      if (posList) {
        const nums = gmlCoordNumsFromNode(posList);
        if (nums.length >= 4) feats.push({ kind: 'line', nums, srs, posNode: posList, props: gmlAttrs(el.parentElement || el), layer: layerHint });
      }
    } else if (ln === 'Polygon' || ln === 'polygon') {
      const f = cityGmlPolygonFeatureFromElement(el, srs || 'EPSG:4326');
      if (f) {
        f.props = gmlAttrs(el.parentElement?.parentElement || el.parentElement || el);
        f.layer = layerHint || f.layer;
        feats.push(f);
      }
    } else if (ln === 'MultiPolygon' || ln === 'multiPolygon'
        || ln === 'MultiSurface' || ln === 'multiSurface'
        || ln === 'CompositeSurface' || ln === 'surfaceMember') {
      const polys = el.getElementsByTagNameNS
        ? el.getElementsByTagNameNS(GML_NS, 'Polygon')
        : [];
      for (let pi = 0; pi < polys.length; pi++) {
        const f = cityGmlPolygonFeatureFromElement(polys[pi], gmlInheritedSrs(polys[pi]) || srs || 'EPSG:4326');
        if (f) {
          f.props = gmlAttrs(el.parentElement || el);
          f.layer = layerHint || f.layer;
          feats.push(f);
        }
      }
      return;
    } else if (ln === 'featureMember' || ln === 'member' || ln === 'Feature' || ln.endsWith('Feature')) {
      const name = el.querySelector('name')?.textContent?.trim() || layerHint;
      [...el.children].forEach(ch => walk(ch, srs, name || layerHint));
      return;
    }
    [...el.children].forEach(ch => walk(ch, srs, layerHint));
  };
  walk(root, root.documentElement?.getAttribute('srsName') || null, null);
  return feats;
}

async function gmlToImportObjects(text, fileName, bounds, debug, singleLayerId) {
  if (typeof SpatialSecurity !== 'undefined') SpatialSecurity.assertGmlPreParse(text);
  debug.entityCounts = {};
  debug.gmlLayers = new Set();
  await new Promise(r => setTimeout(r, 0));

  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('GML XML parse error');

  const docSrs = gmlDocumentDefaultSrs(doc, text);
  if (typeof SpatialSecurity !== 'undefined') SpatialSecurity.assertCrsName(docSrs, fileName);

  let isCityGml = detectCityGml(doc, text);
  debug.format = isCityGml ? 'citygml' : 'gml';
  let feats = [];

  if (isCityGml) {
    showHint('CityGML plan modeli algılandı — geometriler yükleniyor…');
    await new Promise(r => setTimeout(r, 0));
    const defaultSrs = gmlDocumentDefaultSrs(doc, text);
    const mergeFeats = (next) => {
      if (!next?.length) return;
      const seen = new Set(feats.map(f => f.nums.slice(0, 12).join(',')));
      for (const f of next) {
        const key = f.nums.slice(0, 12).join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        feats.push(f);
      }
    };
    mergeFeats(cityGmlExtractLod0Footprints(doc, defaultSrs));
    if (!feats.length) {
      if (text.length >= CITYGML_REGEX_FALLBACK_MIN) {
        mergeFeats(cityGmlExtractPosListsRegex(text, defaultSrs));
      }
      mergeFeats(cityGmlExtractPolygonFeatures(doc, text));
      if (!feats.length) mergeFeats(cityGmlExtractPosListsRegex(text, defaultSrs));
      if (!feats.length) mergeFeats(cityGmlExtractLocalNamePolygons(doc, defaultSrs));
    }
    if (!feats.length) {
      const generic = gmlFindGeometries(doc);
      if (generic.length) {
        feats = generic;
        isCityGml = false;
        debug.format = 'gml';
        showHint('CityGML footprint — standart GML geometri okuyucu kullanıldı');
      }
    }
    if (!feats.length) {
      throw new Error(t('import.err.citygml'));
    }
  } else {
    showHint('GML ayrıştırılıyor…');
    if (detectPlanGml(doc, text)) {
      showHint('CSB plan GML algılandı — plan katmanları yükleniyor…');
      feats = planGmlExtractFeatures(doc, text);
      debug.format = 'plan-gml';
    }
    if (!feats.length) feats = gmlFindGeometries(doc);
  }
  if (!feats.length) throw new Error(t('import.err.noGeom'));

  _gmlFileCmOverride = null;
  _gmlFileSwapEN = false;
  try {
    const turefSamples = collectTurefSamplesFromFeats(feats);
    if (turefSamples.length) {
      const taggedEpsg = parseEpsgFromSrs(feats[0]?.srs || gmlDocumentDefaultSrs(doc, text));
      _gmlFileCmOverride = pickTurefCmForFile(turefSamples, taggedEpsg, fileName);
    }
    _gmlFileSwapEN = detectGmlFileCoordSwap(feats);

    const isPlanGml = debug.format === 'plan-gml';
    const fileSlug = importSlug(fileName.replace(/\.[^.]+$/i, ''));
    const objects = [];
    const defaultLayer = singleLayerId || ensureGmlLayer(isCityGml ? 'CityGML' : 'Özellikler', fileSlug);
    const ringMax = isCityGml ? CITYGML_RING_MAX : (isPlanGml ? PLAN_GML_RING_SIMPLIFY : 100);
    const planPolyCap = typeof SpatialSecurity !== 'undefined' ? SpatialSecurity.LIMITS.MAX_PLAN_GML_POLYGONS : 6000;
    const polyCap = isCityGml ? CITYGML_MAX_POLYGONS : (isPlanGml ? planPolyCap : 8000);
    let polyCount = 0;

    for (let i = 0; i < feats.length; i += GML_PARSE_BATCH) {
      const batch = feats.slice(i, i + GML_PARSE_BATCH);
      for (const f of batch) {
        const layerName = f.layer || f.props?.name || (isPlanGml ? PLAN_GML_FALLBACK_LAYER : (isCityGml ? 'CityGML' : 'Özellikler'));
        const lid = singleLayerId || ensureGmlLayer(layerName, fileSlug);
        debug.gmlLayers.add(layerName);
        const planStyle = isPlanGml ? planGmlStyleForFeature(f.planFeatureType, f.props) : null;
        const meta = isPlanGml
          ? planGmlBuildMeta(f, layerName, true)
          : {
            source: isCityGml ? 'citygml' : 'gml',
            attributes: typeof SpatialSecurity !== 'undefined'
              ? SpatialSecurity.sanitizeProperties(f.props)
              : (f.props || {}),
            layer: layerName,
            planFeatureType: f.planFeatureType || null,
            planLabel: f.planFeatureLabel || layerName,
          };

        if (f.srs && typeof SpatialSecurity !== 'undefined') {
          SpatialSecurity.assertCrsName(f.srs, fileName);
        }

        if (f.kind === 'point') {
          const g = gmlToWgs84(f.nums[0], f.nums[1], f.srs || 'EPSG:4326');
          expandBounds(bounds, g.lat, g.lon);
          const ptColor = planStyle?.color || IMPORT_STYLE.point.color;
          objects.push(makeImportPoint(g.lat, g.lon, lid, ptColor, meta));
          debug.entityCounts.Point = (debug.entityCounts.Point || 0) + 1;
        } else if (f.kind === 'line') {
          let verts = gmlPosListToRing(f.nums, f.srs, f.posNode);
          verts = simplifyLatLonVerts(verts, 120);
          verts.forEach(c => expandBounds(bounds, c.lat, c.lon));
          if (verts.length >= 2) {
            const obj = makeImportPolyline(
              verts, lid,
              planStyle?.color || IMPORT_STYLE.polyline.color,
              planStyle?.strokeWidth || IMPORT_STYLE.polyline.strokeWidth,
              meta,
            );
            if (planStyle?.lineStyle) obj.lineStyle = planStyle.lineStyle;
            if (planStyle?.boundaryPattern) {
              obj.boundaryPattern = planStyle.boundaryPattern;
              obj.boundaryParams = planStyle.boundaryParams || null;
              obj.boundaryPeriodMm = planStyle.boundaryPeriodMm || null;
              if (planStyle.boundaryDash?.length) obj.boundaryDash = planStyle.boundaryDash.slice();
            }
            if (isPlanGml) obj._planGmlStyled = true;
            objects.push(obj);
            debug.entityCounts.LineString = (debug.entityCounts.LineString || 0) + 1;
          }
        } else if (f.kind === 'polygon') {
          if (polyCount >= polyCap) continue;
          let ring = gmlPosListToRing(f.nums, f.srs, f.posNode);
          ring = simplifyLatLonVerts(ring, ringMax);
          ring.forEach(c => expandBounds(bounds, c.lat, c.lon));
          if (ring.length >= 3) {
            const obj = makeImportPolygon(
              ring, lid,
              planStyle?.color || IMPORT_STYLE.polygon.color,
              planStyle?.fillColor || IMPORT_STYLE.polygon.fillColor,
              planStyle?.strokeWidth || IMPORT_STYLE.polygon.strokeWidth,
              meta,
            );
            if (planStyle?.hatchPattern) obj.hatchPattern = planStyle.hatchPattern;
            if (planStyle?.hatchColor) obj.hatchColor = planStyle.hatchColor;
            if (planStyle?.taramaCode) obj.taramaCode = planStyle.taramaCode;
            if (planStyle?.hatchMm) obj.hatchMm = planStyle.hatchMm;
            if (planStyle?.boundaryPattern) {
              obj.boundaryPattern = planStyle.boundaryPattern;
              obj.boundaryParams = planStyle.boundaryParams || null;
              obj.boundaryPeriodMm = planStyle.boundaryPeriodMm || null;
              if (planStyle.boundaryDash?.length) obj.boundaryDash = planStyle.boundaryDash.slice();
            }
            if (planStyle?.lineStyle) obj.lineStyle = planStyle.lineStyle;
            if (isPlanGml) obj._planGmlStyled = true;
            objects.push(obj);
            debug.entityCounts.Polygon = (debug.entityCounts.Polygon || 0) + 1;
            polyCount++;
          }
        }
        debug.count++;
        debug.types.import = (debug.types.import || 0) + 1;
        debug.layers.add(lid);
      }
      if (feats.length > 40) await new Promise(r => setTimeout(r, 0));
    }

    if (isCityGml && polyCount >= CITYGML_MAX_POLYGONS) {
      showHint('CityGML: ' + CITYGML_MAX_POLYGONS + ' poligon sınırına ulaşıldı (performans)');
    } else if (isPlanGml && polyCount >= planPolyCap) {
      showHint('Plan GML: ' + planPolyCap + ' poligon sınırına ulaşıldı');
    }

    spatialDebugLog('GML import', {
      file: debug.file,
      featureCount: objects.length,
      polygonsParsed: polyCount,
      entityCounts: debug.entityCounts,
      layerNames: [...debug.gmlLayers],
      srsSample: feats[0]?.srs || gmlDocumentDefaultSrs(doc, text),
      turefCm: _gmlFileCmOverride,
      swapEN: _gmlFileSwapEN,
      citygml: isCityGml,
    });
    return objects;
  } finally {
    _gmlFileCmOverride = null;
    _gmlFileSwapEN = false;
  }
}

function collectKmzAssetMeta(zip) {
  const meta = { embeddedImages: 0, embeddedIcons: 0 };
  if (!zip?.files) return meta;
  Object.keys(zip.files).forEach(p => {
    if (zip.files[p].dir || p.startsWith('__MACOSX')) return;
    if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(p)) meta.embeddedImages++;
    if (/\/icons?\//i.test(p) || /icon.*\.(png|jpe?g)/i.test(p)) meta.embeddedIcons++;
  });
  return meta;
}

async function runDatasetHealthGate(ctx) {
  const noop = { proceed: true, optimized: false, rasterMaxPx: PLAN_RASTER_MAX_PX };
  if (!FIELD_MODE || typeof DatasetAnalyzer === 'undefined' || typeof DatasetHealthUI === 'undefined') {
    return noop;
  }
  const report = DatasetAnalyzer.buildReport(ctx);
  if (!report) return noop;
  const choice = await DatasetHealthUI.prompt(report);
  if (!choice || choice.action === 'cancel') return { proceed: false };

  if (report.blockRender && choice.action === 'continue' && report.device === 'low'
      && report.memory?.peakMb > report.memory?.budgetMb * 1.1) {
    showHint(t('health.rec.critical'));
    return { proceed: false };
  }

  let rasterMaxPx = choice.rasterMaxPx || PLAN_RASTER_MAX_PX;
  let optimized = false;
  if (choice.action === 'optimized' || choice.optimized) {
    if (ctx.objects?.length) DatasetAnalyzer.applyOptimizedMode(ctx.objects, report);
    optimized = true;
  } else if (choice.action === 'simplify') {
    if (ctx.objects?.length) DatasetAnalyzer.applyAggressiveSimplify(ctx.objects);
    optimized = true;
  } else if (choice.action === 'reduce_resolution') {
    rasterMaxPx = DatasetAnalyzer.RASTER_MAX_PX_OPTIMIZED || 1024;
    optimized = true;
  }
  if (optimized) {
    S.importOptimizedActive = true;
    showHint(t('health.optimizedOn'), 5000);
  }
  return { proceed: true, optimized, rasterMaxPx, report };
}

async function finalizeFieldImport(objects, bounds, debug, name, primaryLayerId, opts) {
  if (!objects.length) {
    showHint(t('import.err.noGeom'));
    console.warn('[PlanAI Field Import]', debug, 'no geometries');
    return;
  }
  const planOverlay = !!(opts && opts.planOverlay);
  const defaultLayer = primaryLayerId || objects[0]?.layerId;
  const overlayLayer = planOverlay ? (primaryLayerId || ensurePlanOverlayLayer(name)) : null;
  const layerOpacity = overlayLayer
    ? (S.layers.find(l => l.id === overlayLayer)?.overlayOpacity ?? PLAN_OVERLAY_DEFAULT_OPACITY)
    : null;

  if (planOverlay && overlayLayer) {
    objects.forEach(o => {
      stampPlanOverlayObject(o, overlayLayer, layerOpacity);
      S.objects.push(o);
      debug.count++;
      debug.types[o.type] = (debug.types[o.type] || 0) + 1;
      debug.layers.add(overlayLayer);
    });
    refreshPlanGmlPresentation();
  } else if (defaultLayer && !debug.format) {
    pushImportObjects(objects, defaultLayer, bounds, debug);
  } else {
    objects.forEach(o => {
      o.layerId = o.layerId || defaultLayer;
      o.visible = o.visible !== false;
      o.locked = false;
      o._import = true;
      S.objects.push(o);
      debug.count++;
      debug.types[o.type] = (debug.types[o.type] || 0) + 1;
      if (o.layerId) debug.layers.add(o.layerId);
      const verts = o.vertices || (o.rings && o.rings[0]) || [];
      verts.forEach(c => { if (c.lat != null) expandBounds(bounds, c.lat, c.lon); });
      if (o.lat != null) expandBounds(bounds, o.lat, o.lon);
    });
  }

  const visLayer = S.layers.find(l => l.id === (planOverlay ? overlayLayer : (objects[0]?.layerId || defaultLayer)));
  if (visLayer && debug.format !== 'dxf') visLayer.visible = true;
  if (!planOverlay) setActiveLayer(objects[0]?.layerId || defaultLayer);
  else if (S.activeLayerId === overlayLayer || !S.activeLayerId) setActiveLayer('sketch');

  buildLayerPanel();
  pushHistory();
  fitMapToLatLonBounds(bounds);
  if (S.basemap === 'none') toggleOSM();

  const tag = planOverlay ? 'PlanOverlay' : debug.format === 'dxf' ? 'DXF' : debug.format === 'gml' ? 'GML' : 'Import';
  spatialDebugLog(tag + ' finalize', {
    file: debug.file,
    featureCount: objects.length,
    geometryTypes: debug.types,
    entityCounts: debug.entityCounts,
    unsupported: debug.unsupported,
    layerNames: [...debug.layers].map(id => (S.layers.find(l => l.id === id)?.name || id)),
  });
  if (planOverlay && overlayLayer) {
    if (bounds.ok) savePlanOverlayGeoExtent(overlayLayer, bounds);
    openPlanOverlayPanel(overlayLayer);
    showHint('🗺 Plan overlay: ' + name + ' (' + objects.length + ' geometri)');
  } else {
    showHint('📁 ' + name + ' — ' + objects.length + ' geometri yüklendi');
  }
  if (FIELD_MODE) _layerPanelExpanded.add('imported');
  if (opts?.optimized && typeof DatasetAnalyzer !== 'undefined') {
    DatasetAnalyzer.markDeferredLayersVisible(S.layers, objects);
  }
  scheduleProjectSave();
}

function importErrorHint(err, ext) {
  if (typeof SpatialSecurity !== 'undefined') {
    const sec = SpatialSecurity.importErrorMessage(err);
    if (sec) return sec;
  }
  const msg = String(err?.message || err || '');
  if (/Koordinat sistemi|Coordinate system/i.test(msg)) return t('import.err.crs');
  if (/SHP|shapefile/i.test(msg)) return msg;
  if (/CityGML|citygml/i.test(msg)) return t('import.err.citygml');
  if (/GeoTIFF|geotiff/i.test(msg)) return msg.indexOf('import.err') >= 0 ? msg : t('import.err.geotiffPos');
  if (/KML|kml/i.test(msg)) return t('import.err.kml');
  if (/geometri|geometry/i.test(msg)) return t('import.err.noGeom');
  return msg || t('import.err.noGeom');
}

async function routeFieldImportFiles(files) {
  const byBase = new Map();
  const singles = [];
  for (const f of files) {
    if (!f) continue;
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (['shp', 'dbf', 'shx', 'prj', 'cpg'].includes(ext)) {
      const base = f.name.replace(/\.[^.]+$/i, '').toLowerCase();
      if (!byBase.has(base)) byBase.set(base, {});
      byBase.get(base)[ext] = f;
    } else singles.push(f);
  }
  for (const [, parts] of byBase) {
    if (parts.shp) await importShapefileBundle(parts, parts.shp.name.replace(/\.shp$/i, ''));
  }
  for (const f of singles) {
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (ext === 'zip' || f.name.endsWith('.planai.zip')) {
      await importProjectZipFile(f);
    } else if (ext === 'html' || ext === 'htm' || ext === 'pdf') {
      await routeSharedFieldFile(f);
    } else {
      await importFieldFile(f);
    }
  }
}

async function importFieldFile(file, opts) {
  if (!file) return;
  if (!ensureFieldImportProject()) return;
  let name = file.name || 'import';
  if (typeof SpatialSecurity !== 'undefined') {
    const checked = SpatialSecurity.assertImportFile(file);
    name = checked.name;
  }
  const ext = (name.split('.').pop() || '').toLowerCase();
  const bounds = { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity, ok: false };
  const debug = { file: name, count: 0, types: {}, layers: new Set() };
  let objects = [];
  let primaryLayerId = null;
  const wantOverlay = !!(opts && opts.planOverlay) || (FIELD_MODE && isFieldPlanOverlayExt(ext));
  if (wantOverlay && deviceSecurityBlocksPlanImport()) {
    showHint('Güvenlik modu: plan/municipality overlay içe aktarımı kısıtlı');
    return;
  }
  const importOpts = wantOverlay ? { planOverlay: true } : {};
  let kmlMeta = null;
  let kmzMeta = null;

  try {
    S.importOptimizedActive = false;
    if (ext === 'shp') {
      await importShapefileBundle({ shp: file }, name.replace(/\.shp$/i, ''));
      return;
    }
    if (ext === 'zip') {
      if (typeof JSZip !== 'undefined') {
        const zip = typeof SpatialSecurity !== 'undefined' && SpatialSecurity.loadZipFromFile
          ? await SpatialSecurity.loadZipFromFile(file, name)
          : await JSZip.loadAsync(await file.arrayBuffer());
        if (typeof SpatialSecurity !== 'undefined' && !SpatialSecurity.loadZipFromFile) {
          SpatialSecurity.assertZipArchive(zip, name);
        }
        const entries = Object.keys(zip.files).filter(p => !p.startsWith('__MACOSX') && !zip.files[p].dir);
        const hasShp = entries.some(p => /\.shp$/i.test(p));
        if (hasShp) { await importShapefileZip(file); return; }
      }
      showHint('ZIP: Shapefile (.shp) veya gezi ZIP kullanın');
      return;
    }
    if (ext === 'geojson' || ext === 'json') {
      const text = await file.text();
      if (typeof ImportSandbox !== 'undefined') await ImportSandbox.validateFilePreParse(file, ext, text);
      let geo;
      if (typeof SpatialSecurity !== 'undefined') {
        geo = SpatialSecurity.parseJsonSafe(text, name);
        SpatialSecurity.validateGeoJsonRoot(geo);
      } else {
        geo = JSON.parse(text);
      }
      primaryLayerId = wantOverlay ? ensurePlanOverlayLayer(name) : ensureImportLayer(name);
      objects = geoJsonToImportObjects(geo, primaryLayerId, bounds, debug, name);
    } else if (ext === 'kml') {
      const text = await file.text();
      if (typeof ImportSandbox !== 'undefined') await ImportSandbox.validateFilePreParse(file, ext, text);
      else if (typeof SpatialSecurity !== 'undefined') SpatialSecurity.assertKmlPreParse(text);
      if (typeof DatasetAnalyzer !== 'undefined') kmlMeta = DatasetAnalyzer.analyzeKmlText(text);
      primaryLayerId = wantOverlay ? ensurePlanOverlayLayer(name) : ensureImportLayer(name);
      objects = kmlToImportObjects(text, primaryLayerId, bounds, debug, name);
    } else if (ext === 'kmz') {
      if (typeof JSZip === 'undefined') throw new Error('KMZ desteği yüklenemedi (JSZip)');
      const zip = typeof SpatialSecurity !== 'undefined' && SpatialSecurity.loadZipFromFile
        ? await SpatialSecurity.loadZipFromFile(file, name)
        : await JSZip.loadAsync(await file.arrayBuffer());
      if (typeof SpatialSecurity !== 'undefined' && !SpatialSecurity.loadZipFromFile) {
        SpatialSecurity.assertZipArchive(zip, name);
      }
      kmzMeta = collectKmzAssetMeta(zip);
      const kmlPath = Object.keys(zip.files).find(p => /\.kml$/i.test(p) && !p.startsWith('__MACOSX'));
      if (!kmlPath) throw new Error('KMZ içinde KML bulunamadı');
      const text = await zip.files[kmlPath].async('string');
      if (typeof ImportSandbox !== 'undefined') await ImportSandbox.validateFilePreParse(file, 'kml', text);
      else if (typeof SpatialSecurity !== 'undefined') SpatialSecurity.assertKmlPreParse(text);
      if (typeof DatasetAnalyzer !== 'undefined') kmlMeta = DatasetAnalyzer.analyzeKmlText(text);
      primaryLayerId = wantOverlay ? ensurePlanOverlayLayer(name) : ensureImportLayer(name);
      objects = kmlToImportObjects(text, primaryLayerId, bounds, debug, name);
    } else if (ext === 'dxf') {
      if (wantOverlay) {
        showHint('Plan overlay: KML, GML veya GeoJSON kullanın (DXF ayrı içe aktarılır)');
        return;
      }
      const text = await file.text();
      objects = await dxfToImportObjects(text, name, bounds, debug);
    } else if (ext === 'gml') {
      const text = await file.text();
      if (typeof ImportSandbox !== 'undefined') await ImportSandbox.validateFilePreParse(file, ext, text);
      primaryLayerId = wantOverlay ? ensurePlanOverlayLayer(name) : null;
      objects = await gmlToImportObjects(text, name, bounds, debug, primaryLayerId);
    } else if (ext === 'xml') {
      const text = await file.text();
      if (typeof ImportSandbox !== 'undefined' && /<gml:|FeatureCollection|featureMember|posList/i.test(text)) {
        await ImportSandbox.validateFilePreParse(file, 'gml', text);
      }
      if (/<gml:|FeatureCollection|featureMember|posList/i.test(text)) {
        primaryLayerId = wantOverlay ? ensurePlanOverlayLayer(name) : null;
        objects = await gmlToImportObjects(text, name, bounds, debug, primaryLayerId);
      } else {
        showHint('Desteklenen: ' + FIELD_IMPORT_FORMATS_HINT);
        return;
      }
    } else if (isFieldRasterOverlayExt(ext)) {
      await importPlanRasterFile(file);
      return;
    } else {
      showHint('Desteklenen: ' + FIELD_IMPORT_FORMATS_HINT);
      return;
    }

    const healthFormats = new Set(['geojson', 'json', 'kml', 'kmz', 'gml', 'xml', 'dxf']);
    if (healthFormats.has(ext) || (ext === 'xml' && objects.length)) {
      const gate = await runDatasetHealthGate({
        file, ext, objects, debug, name, kmlMeta, kmzMeta,
      });
      if (!gate.proceed) {
        showHint(t('health.importCancelled'));
        return;
      }
      importOpts.optimized = gate.optimized;
    }

    await finalizeFieldImport(objects, bounds, debug, name, primaryLayerId, importOpts);
  } catch (err) {
    if (primaryLayerId && isPlanOverlayLayer(primaryLayerId)) {
      const hasObjs = S.objects.some(o => (o.layerId || '') === primaryLayerId);
      if (!hasObjs) {
        S.layers = S.layers.filter(l => l.id !== primaryLayerId);
        if (_activePlanOverlayLayerId === primaryLayerId) {
          _activePlanOverlayLayerId = getPlanOverlayLayers().slice(-1)[0]?.id || null;
          if (_activePlanOverlayLayerId) openPlanOverlayPanel(_activePlanOverlayLayerId);
          else closePlanOverlayPanel();
        }
        buildLayerPanel();
      }
    }
    console.error('[PlanAI Field Import]', err);
    showHint('İçe aktarma: ' + importErrorHint(err, ext));
  }
}

function ensureFieldImportProject() {
  if (!FIELD_PROJECT.id) {
    if (bootstrapFieldProjectSync()) {
      ensureFieldProjectId().catch(() => {});
      return true;
    }
    openProjectPanel();
    showHint('Önce gezi oluşturun veya açın');
    return false;
  }
  return true;
}

function initFieldImportInput() {
  const inp = document.getElementById('field-import-file-input');
  if (!inp || inp._planaiBound) return;
  inp._planaiBound = true;
  inp.setAttribute('accept', FIELD_IMPORT_ACCEPT);
  inp.setAttribute('multiple', '');
  inp.addEventListener('change', e => {
    const list = e.target.files;
    if (!list?.length) return;
    routeFieldImportFiles(Array.from(list));
    e.target.value = '';
  });
  initFieldShareIntentHandler();
}

/** Android: WhatsApp / Gmail / Drive → Birlikte aç → PlanAI Field */
const _shareFileQueue = [];
let _shareFileProcessTimer = null;

window.__planaiOnShareFile = function(payload) {
  if (!payload || !payload.uri) return false;
  _shareFileQueue.push(payload);
  scheduleProcessShareFileQueue();
  return true;
};

function scheduleProcessShareFileQueue() {
  if (_shareFileProcessTimer) return;
  _shareFileProcessTimer = setTimeout(() => {
    _shareFileProcessTimer = null;
    processShareFileQueue();
  }, 150);
}

function shareBase64ToUint8Array(b64) {
  const raw = atob(b64);
  const u = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i);
  return u;
}

function shareMimeFromName(name) {
  const ext = (String(name || '').split('.').pop() || '').toLowerCase();
  const map = {
    kml: 'application/vnd.google-earth.kml+xml',
    kmz: 'application/vnd.google-earth.kmz',
    geojson: 'application/geo+json',
    json: 'application/json',
    xml: 'application/xml',
    gml: 'application/xml',
    zip: 'application/zip',
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    tif: 'image/tiff',
    tiff: 'image/tiff',
  };
  return map[ext] || 'application/octet-stream';
}

function shareGuessName(uri, mimeType) {
  const u = String(uri || '');
  const seg = decodeURIComponent((u.split('/').pop() || '').split('?')[0]);
  if (seg && seg.includes('.')) return seg;
  if (mimeType && /kml/i.test(mimeType)) return 'shared.kml';
  if (mimeType && /kmz|zip/i.test(mimeType)) return 'shared.kmz';
  if (mimeType && /geo\+json|json/i.test(mimeType)) return 'shared.geojson';
  if (mimeType && /zip/i.test(mimeType)) return 'shared.zip';
  return 'shared-file';
}

async function sharePayloadToFile(payload) {
  const cap = window.Capacitor;
  const Fs = cap?.Plugins?.Filesystem;
  if (!Fs?.readFile) throw new Error('Dosya okunamadı (Filesystem)');
  const res = await Fs.readFile({ path: payload.uri });
  const name = payload.name || shareGuessName(payload.uri, payload.mimeType);
  const mime = payload.mimeType || shareMimeFromName(name);
  const bin = shareBase64ToUint8Array(res.data);
  return new File([bin], name, { type: mime });
}

async function routeSharedFieldFile(file) {
  const name = file.name || 'dosya';
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (!FIELD_PROJECT.id) {
    if (!bootstrapFieldProjectSync()) {
      openProjectPanel();
      showHint('Önce gezi oluşturun veya açın — ardından dosyayı tekrar paylaşın: ' + name);
      return;
    }
    ensureFieldProjectId().catch(() => {});
  }
  if (ext === 'zip' || name.endsWith('.planai.zip')) {
    await importProjectZipFile(file);
    showHint('📥 Gezi ZIP içe aktarıldı: ' + name);
    return;
  }
  if (ext === 'html' || ext === 'htm') {
    showHint(PA_LANG === 'tr' ? 'HTML dosyası güvenlik nedeniyle açılmıyor — raporu uygulama içinden görüntüleyin' : 'HTML files cannot be opened for security — view reports inside the app');
    return;
  }
  if (ext === 'pdf') {
    const url = URL.createObjectURL(file);
    const w = window.open(url, '_blank');
    if (!w) showHint('Pop-up engellendi — PDF indiriliyor');
    else showHint(t('import.openedPdf'));
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 60000);
    return;
  }
  if (isFieldRasterOverlayExt(ext)) {
    await importPlanRasterFile(file);
    showHint('📂 ' + name + ' haritaya eklendi');
    return;
  }
  await importFieldFile(file);
  showHint('📂 ' + name + ' içe aktarıldı');
}

async function processShareFileQueue() {
  if (!_shareFileQueue.length) return;
  if (!FIELD_MODE) return;
  while (_shareFileQueue.length) {
    const payload = _shareFileQueue.shift();
    try {
      const file = await sharePayloadToFile(payload);
      await routeSharedFieldFile(file);
    } catch (err) {
      console.error('[PlanAI share intent]', err);
      showHint('Dosya açılamadı: ' + (err.message || err));
    }
  }
}

function initFieldShareIntentHandler() {
  if (initFieldShareIntentHandler._done) return;
  initFieldShareIntentHandler._done = true;
  scheduleProcessShareFileQueue();
}

/** Native OS document picker (Android SAF, iOS Files, desktop). Drive/WhatsApp/Gmail via system providers. */
function openNativeFieldImportPicker(cloudPreferred) {
  if (!ensureFieldImportProject()) return;
  if (typeof FieldFileBridge !== 'undefined' && FieldFileBridge.pickImportFiles) {
    FieldFileBridge.pickImportFiles({ cloud: !!cloudPreferred, multiple: true })
      .then(files => { if (files?.length) routeFieldImportFiles(files); })
      .catch(() => {});
    return;
  }
  const inp = document.getElementById('field-import-file-input');
  if (!inp) return;
  inp.value = '';
  if (typeof inp.showPicker === 'function') {
    try {
      inp.showPicker();
      return;
    } catch (_) {}
  }
  inp.click();
}

function showFieldImportSheet() {
  if (!ensureFieldImportProject()) return;
  document.getElementById('field-import-backdrop')?.classList.add('open');
  document.getElementById('field-import-sheet')?.classList.add('open');
  document.body.classList.add('field-import-open');
}

function closeFieldImportSheet() {
  document.getElementById('field-import-sheet')?.classList.remove('open');
  document.getElementById('field-import-backdrop')?.classList.remove('open');
  document.body.classList.remove('field-import-open');
}

function fieldImportFromDevice() {
  closeFieldImportSheet();
  openNativeFieldImportPicker(false);
  showHint(FIELD_IMPORT_FORMATS_HINT);
}

function fieldImportFromCloud() {
  closeFieldImportSheet();
  openNativeFieldImportPicker(true);
  showHint(PA_LANG === 'tr'
    ? 'Drive, OneDrive, Dropbox veya WhatsApp’tan dosya seçin'
    : 'Pick a file from Drive, OneDrive, Dropbox or WhatsApp');
}

function onFieldImportClick() {
  showFieldImportSheet();
}

// ═══ IndexedDB project workspace ═══════════════════════════════
function openProjectDb() {
  return new Promise((resolve, reject) => {
    if (_projectDb) return resolve(_projectDb);
    const req = indexedDB.open(PROJECT_DB_NAME, PROJECT_DB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('snapshots')) {
        db.createObjectStore('snapshots', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('map_tiles')) {
        db.createObjectStore('map_tiles', { keyPath: 'url' });
      }
      if (!db.objectStoreNames.contains('dem_tiles')) {
        db.createObjectStore('dem_tiles', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => { _projectDb = req.result; resolve(_projectDb); };
    req.onerror = () => reject(req.error);
  });
}

function projectBlobKey(photoId, kind) {
  const k = kind || 'full';
  return (FIELD_PROJECT.id || 'none') + ':' + photoId + ':' + k;
}

function legacyPhotoBlobKey(photoId) {
  return (FIELD_PROJECT.id || 'none') + ':' + photoId;
}

function serializeProjectSnapshot() {
  const objects = S.objects.map(o => {
    const c = JSON.parse(JSON.stringify(o));
    delete c._imgEl;
    delete c._thumbImg;
    delete c._thumbUrl;
    delete c._thumbReady;
    if (c.type === 'georef_image' && c._planOverlay && c.dataUrl && c.dataUrl.length > 120000) {
      c.rasterPersisted = true;
      delete c.dataUrl;
      delete c._imgEl;
    } else if (c.dataUrl && c.dataUrl.length > 200000) delete c.dataUrl;
    return c;
  });
  if (!FIELD_PROJECT.createdAt) FIELD_PROJECT.createdAt = new Date().toISOString();
  const photos = S.objects.filter(o => o.type === 'field_photo').map(p => ({
    id: p.photoId || p.id, photoNum: p.photoNum, lat: p.lat, lon: p.lon,
    timestamp: p.timestamp || p.createdAt, description: p.description || p.caption || '',
    title: p.title, accuracy: p.gpsAccuracy ?? p.accuracy ?? null,
  }));
  const notes = S.objects.filter(o => o.type === 'field_note').map(n => ({
    id: n.id, noteNum: n.noteNum, lat: n.lat, lon: n.lon,
    text: getNoteText(n), hasHandwriting: noteHasHandwriting(n),
    timestamp: n.timestamp || n.createdAt,
  }));
  return {
    version: 2,
    id: FIELD_PROJECT.id,
    name: FIELD_PROJECT.name,
    createdAt: FIELD_PROJECT.createdAt,
    updatedAt: new Date().toISOString(),
    mapState: {
      center: { ...S.mapCenter },
      basemap: S.basemap,
      tx: S.tx, ty: S.ty, scale: S.scale,
      showGrid: S.showGrid, snapGrid: S.snapGrid,
    },
    map: {
      center: { ...S.mapCenter },
      basemap: S.basemap,
      tx: S.tx, ty: S.ty, scale: S.scale,
      showGrid: S.showGrid, snapGrid: S.snapGrid,
    },
    layers: JSON.parse(JSON.stringify(S.layers)),
    photos,
    notes,
    measurements: null,
    reports: _fieldProjectReports.map(r => ({ ...r })),
    objects,
    activeLayerId: S.activeLayerId,
    selectedIds: [],
    tool: S.tool,
    color: S.color,
    strokeWidth: S.strokeWidth,
    opacity: S.opacity,
    slopeAnalysis: _slopeState.active ? { objId: _slopeState.objId, stats: _slopeState.stats } : null,
    slopeAnalysisReport: _slopeAnalysisReport ? JSON.parse(JSON.stringify(_slopeAnalysisReport)) : null,
  };
}

function applyProjectSnapshot(snap) {
  if (!snap) return;
  finalizeFieldInspectionPanels();
  FIELD_PROJECT.id = snap.id;
  FIELD_PROJECT.name = snap.name || 'Gezi';
  FIELD_PROJECT.createdAt = snap.createdAt || snap.updatedAt || new Date().toISOString();
  const mapRef = snap.mapState || snap.map;
  S.mapCenter = mapRef?.center ? { ...mapRef.center } : S.mapCenter;
  S.basemap = mapRef?.basemap || 'satellite';
  if (FIELD_MODE && S.basemap !== 'satellite') S.basemap = 'satellite';
  ensureFieldBasemapOn();
  updateBasemapDockUi();
  clearBasemapTileCache();
  S.tx = mapRef?.tx ?? 0;
  S.ty = mapRef?.ty ?? 0;
  S.scale = mapRef?.scale ?? 1;
  S.showGrid = !!mapRef?.showGrid;
  S.snapGrid = !!mapRef?.snapGrid;
  S.layers = (snap.layers && snap.layers.length) ? snap.layers : FIELD_LAYER_DEFS.map(d => ({ ...d, visible: true, locked: false }));
  ensureFieldNotesLayer();
  _fieldProjectReports = Array.isArray(snap.reports) ? snap.reports.map(r => ({ ...r })) : [];
  S.objects = (snap.objects || []).map(o => {
    if (o.type === 'georef_image' && o.dataUrl) {
      const img = new Image();
      img.src = o.dataUrl;
      o._imgEl = img;
    }
    if (o.type === 'field_photo') normalizeFieldPhotoObject(o);
    if (o.type === 'field_note') normalizeFieldNoteObject(o);
    if (o.type === 'field_gps_track') normalizeFieldGpsTrackObject(o);
    return o;
  });
  ensurePhotosLayer();
  ensureGpsLayer();
  preloadPhotoThumbs();
  ensureFieldNoteNumbers();
  ensureFieldGpsTrackNumbers();
  sanitizeFieldProjectLayers();
  ensureImportLayerNumbers();
  refreshPlanGmlPresentation();
  S.activeLayerId = snap.activeLayerId || 'sketch';
  S.selectedIds = [];
  S.color = snap.color || S.color;
  S.strokeWidth = snap.strokeWidth ?? S.strokeWidth;
  S.opacity = snap.opacity ?? S.opacity;
  S.history = [JSON.parse(JSON.stringify(S.objects))];
  S.histIdx = 0;
  updateBasemapDockUi();
  updateProjectTitleUi();
  const poLayers = getPlanOverlayLayers();
  _activePlanOverlayLayerId = poLayers.length ? poLayers[poLayers.length - 1].id : null;
  buildLayerPanel();
  buildFieldNotesList();
  updateHistBtns();
  restorePlanRasterImages();
  refreshPlanOverlayGeoExtents();
  _slopeAnalysisReport = snap.slopeAnalysisReport || null;
  _fieldInfoObjId = null;
  clearLocalSlopeAnalysis();
  hideFeatureInfoPanel();
  updateSlopeSaveButtonUi();
  const tr = S.objects.filter(o => o.type === 'field_gps_track').pop();
  if (tr?.vertices?.length) {
    _gpsTrack.state = 'idle';
    _gpsTrack.objId = tr.id;
    _gpsTrack.points = tr.vertices.map(v => ({ lat: v.lat, lon: v.lon, ts: v.ts || Date.now() }));
  } else {
    _gpsTrack.state = 'idle';
    _gpsTrack.points = [];
    _gpsTrack.objId = null;
  }
  updateGpsTrackHud();
  scheduleEnsureFieldGpsSessionActive();
  if (S.basemap !== 'none') {
    warmViewportTilesFromDb();
    scheduleBasemapRefresh(2400);
  }
  if (snap.slopeAnalysis?.objId) {
    const obj = S.objects.find(o => o.id === snap.slopeAnalysis.objId);
    if (obj) {
      _slopeState.stats = snap.slopeAnalysis.stats;
      showSlopeResultsPanel(snap.slopeAnalysis.stats);
      runLocalSlopeAnalysis(obj).catch(() => {});
    }
  }
  syncFieldDrawSettingsUi();
  scheduleRender();
}

function isProjectAutosaveEnabled() {
  try {
    const v = localStorage.getItem(FIELD_AUTOSAVE_LS_KEY);
    if (v === '0') return false;
  } catch (_) {}
  return true;
}

function setAutosaveIndicator(state, detail) {
  const ind = document.getElementById('project-save-indicator');
  if (!ind) return;
  const longEl = ind.querySelector('.autosave-long');
  const setLabel = txt => {
    if (longEl) longEl.textContent = txt;
    else ind.textContent = txt;
  };
  ind.classList.remove('autosave-pending', 'autosave-saving', 'autosave-ok', 'autosave-err', 'autosave-idle');
  if (state === 'pending') {
    ind.classList.add('autosave-pending');
    setLabel(t('autosave.pending'));
    ind.title = t('autosave.pending');
  } else if (state === 'saving') {
    ind.classList.add('autosave-saving');
    setLabel(t('autosave.saving'));
    ind.title = t('autosave.saving');
  } else if (state === 'saved') {
    ind.classList.add('autosave-ok');
    const ts = detail || new Date().toLocaleTimeString(PA_LANG === 'tr' ? 'tr-TR' : 'en-GB', { hour: '2-digit', minute: '2-digit' });
    setLabel('✓ ' + ts);
    ind.title = ts;
  } else if (state === 'error') {
    ind.classList.add('autosave-err');
    setLabel('! ' + t('autosave.err'));
    ind.title = detail || t('autosave.failed');
  } else {
    ind.classList.add('autosave-idle');
    setLabel(t('autosave.idle'));
    ind.title = t('autosave.idle');
  }
}

/** Sync project id so UI actions work before async IDB workspace init finishes. */
function bootstrapFieldProjectSync() {
  if (FIELD_PROJECT.id || !FIELD_MODE) return false;
  FIELD_PROJECT.id = 'prj_' + Date.now();
  FIELD_PROJECT.name = defaultProjectName();
  FIELD_PROJECT.createdAt = new Date().toISOString();
  if (!S.history?.length) {
    S.history = [JSON.parse(JSON.stringify(S.objects || []))];
    S.histIdx = 0;
  }
  initLayers();
  buildLayerPanel();
  updateProjectTitleUi();
  return true;
}

async function ensureFieldProjectId() {
  if (FIELD_PROJECT.id) return true;
  if (!FIELD_MODE) return false;
  bootstrapFieldProjectSync();
  try {
    await saveCurrentProject(true);
    showHint('Gezi otomatik oluşturuldu: ' + FIELD_PROJECT.name);
  } catch (_) {}
  return true;
}

async function persistAllPlanRasterBlobs() {
  const list = S.objects.filter(o => o.type === 'georef_image' && o._planOverlay && o.dataUrl);
  await Promise.all(list.map(o => persistPlanRasterBlob(o)));
}

async function saveCurrentProject(silent) {
  if (!FIELD_PROJECT.id || _projectSaving) return false;
  if (typeof FieldAccessGate !== 'undefined' && !_persistProtectionChecked) {
    _persistProtectionChecked = true;
    if (!FieldAccessGate.hasPin() && !FieldAccessGate.hasDeferredPin()) {
      FieldAccessGate.deferPin();
    }
  }
  _projectSaving = true;
  setAutosaveIndicator('saving');
  try {
    await persistAllPlanRasterBlobs();
    const db = await openProjectDb();
    const snap = serializeProjectSnapshot();
    const meta = { id: FIELD_PROJECT.id, name: FIELD_PROJECT.name, updatedAt: snap.updatedAt };
    const snapRow = { id: FIELD_PROJECT.id, json: JSON.stringify(snap) };
    await idbPut(db, 'snapshots', snapRow);
    await idbPut(db, 'projects', meta);
    localStorage.setItem('planai_field_last_project', FIELD_PROJECT.id);
    _projectDirty = false;
    const t = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    setAutosaveIndicator('saved', t);
    if (!silent) showHint('Gezi kaydedildi');
    return true;
  } catch (e) {
    console.error('[Project Save]', e);
    setAutosaveIndicator('error', e.message || '');
    if (!silent) showHint('Kayıt hatası: ' + (e.message || e));
    return false;
  } finally {
    _projectSaving = false;
  }
}

async function flushProjectSave() {
  clearTimeout(_projectSaveTimer);
  _projectSaveTimer = null;
  if (!isProjectAutosaveEnabled()) return;
  if (!FIELD_PROJECT.id) {
    const ok = await ensureFieldProjectId();
    if (!ok) return;
  }
  if (!_projectDirty || _projectSaving) return;
  await saveCurrentProject(true);
}

function scheduleProjectSaveDebounced() {
  clearTimeout(_projectSaveTimer);
  _projectSaveTimer = setTimeout(() => flushProjectSave(), FIELD_AUTOSAVE_DEBOUNCE_MS);
}

function scheduleProjectSave() {
  if (!FIELD_MODE || !isProjectAutosaveEnabled()) return;
  _projectDirty = true;
  setAutosaveIndicator('pending');
  if (!FIELD_PROJECT.id) {
    ensureFieldProjectId().then(() => scheduleProjectSaveDebounced());
    return;
  }
  scheduleProjectSaveDebounced();
}

function startProjectAutosaveInterval() {
  if (_projectAutosaveInterval) clearInterval(_projectAutosaveInterval);
  _projectAutosaveInterval = setInterval(() => {
    if (FIELD_PROJECT.id && _projectDirty && isProjectAutosaveEnabled()) flushProjectSave();
  }, FIELD_AUTOSAVE_INTERVAL_MS);
}

function idbPut(db, store, val) {
  return (async () => {
    let row = val;
    if (typeof FieldDbCrypto !== 'undefined' && FieldDbCrypto.sensitiveStore(store)) {
      try {
        row = await FieldDbCrypto.encryptRecord(store, val);
      } catch (e) {
        console.warn('[idbPut] encrypt skipped', store, e);
        row = val;
      }
    }
    return new Promise((res, rej) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(row);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  })();
}

function idbGet(db, store, key) {
  return (async () => {
    const row = await new Promise((res, rej) => {
      const tx = db.transaction(store, 'readonly');
      const r = tx.objectStore(store).get(key);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    if (!row || typeof FieldDbCrypto === 'undefined' || !FieldDbCrypto.sensitiveStore(store)) return row;
    return FieldDbCrypto.decryptRecord(store, row);
  })();
}

function idbGetAll(db, store) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}

function idbDelete(db, store, key) {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

async function pruneIdbStore(db, store, maxCount, sortKey) {
  try {
    const rows = await idbGetAll(db, store);
    if (rows.length <= maxCount) return;
    rows.sort((a, b) => (a[sortKey] || 0) - (b[sortKey] || 0));
    const drop = rows.length - maxCount;
    for (let i = 0; i < drop; i++) {
      const key = rows[i].url || rows[i].key;
      if (key) await idbDelete(db, store, key);
    }
  } catch (_) {}
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('blob')); };
    img.src = url;
  });
}

function imageToBlob(img) {
  return new Promise((resolve, reject) => {
    try {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth || 256;
      c.height = img.naturalHeight || 256;
      c.getContext('2d').drawImage(img, 0, 0);
      c.toBlob(b => b ? resolve(b) : reject(new Error('toBlob')), 'image/png');
    } catch (e) { reject(e); }
  });
}

async function persistMapTile(url, img) {
  try {
    const blob = await imageToBlob(img);
    const db = await openProjectDb();
    await idbPut(db, 'map_tiles', { url, blob, savedAt: Date.now() });
    pruneIdbStore(db, 'map_tiles', MAP_TILE_CACHE_MAX, 'savedAt');
  } catch (_) {}
}

function isTileCacheMiss(entry) {
  return entry && entry.miss === true;
}

function canRetryMapTile(url) {
  const c = _tileCache[url];
  if (!c) return true;
  if (c === 'loading') {
    const since = _tileLoadingSince[url] || 0;
    return since > 0 && Date.now() - since > 12000;
  }
  if (c instanceof Image) return !c.complete || c.naturalWidth <= 0;
  if (isTileCacheMiss(c)) return Date.now() - (c.at || 0) > TILE_MISS_RETRY_MS;
  return false;
}

function markTileCacheMiss(url) {
  _tileCache[url] = { miss: true, at: Date.now() };
}

function ensureFieldBasemapOn() {
  if (!FIELD_MODE) return;
  if (!S.basemap || S.basemap === 'none') {
    S.basemap = 'satellite';
    updateBasemapDockUi();
  }
}

function basemapTileUrl(zoom, tx, ty) {
  if (S.basemap === 'satellite') {
    return 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + zoom + '/' + ty + '/' + tx;
  }
  if (S.basemap === 'topo') {
    return 'https://tile.opentopomap.org/' + zoom + '/' + tx + '/' + ty + '.png';
  }
  const sub = ['a', 'b', 'c'][((tx + ty) % 3 + 3) % 3];
  return 'https://' + sub + '.tile.openstreetmap.org/' + zoom + '/' + tx + '/' + ty + '.png';
}

function basemapTileFallbackUrls(url) {
  const out = [];
  if (S.basemap === 'satellite') {
    if (url.indexOf('services.arcgisonline.com') >= 0) {
      out.push(url.replace('services.arcgisonline.com', 'server.arcgisonline.com'));
    } else if (url.indexOf('server.arcgisonline.com') >= 0) {
      out.push(url.replace('server.arcgisonline.com', 'services.arcgisonline.com'));
    }
  }
  return out;
}

function basemapMaxTileZoom() {
  if (S.basemap === 'satellite') return 19;
  if (S.basemap === 'topo') return 17;
  return 19;
}

function clampBasemapZoom(z) {
  return Math.max(1, Math.min(basemapMaxTileZoom(), z | 0));
}

/** Yanlış altlık karolarını önbellekten temizle (OSM/uydu karışmasını önler). */
function purgeWrongBasemapCache() {
  const mode = S.basemap || 'none';
  Object.keys(_tileCache).forEach(k => {
    const isOsm = k.indexOf('openstreetmap') >= 0 || k.indexOf('opentopomap') >= 0;
    const isSat = k.indexOf('arcgisonline') >= 0;
    if (mode === 'satellite' && isOsm) delete _tileCache[k];
    else if (mode === 'osm' && (isSat || k.indexOf('opentopomap') >= 0)) delete _tileCache[k];
    else if (mode === 'topo' && (isSat || k.indexOf('openstreetmap') >= 0)) delete _tileCache[k];
  });
}

/** Web mercator karo zoom — yakınlaştırmada anında yükselir. */
function computeBasemapTileZoom(mPerScreenPx) {
  const lat = (S.mapCenter && S.mapCenter.lat) || 39;
  const cosLat = Math.max(0.2, Math.cos(lat * Math.PI / 180));
  const m = Math.max(mPerScreenPx, 1e-8);
  const ideal = Math.log2((156543.03392 * cosLat) / m);
  const maxZ = basemapMaxTileZoom();
  let z = clampBasemapZoom(Math.round(ideal));
  const prev = _basemapZoomState;
  if (prev.z > 0 && ideal < prev.ideal - 0.45) {
    z = clampBasemapZoom(Math.min(prev.z, Math.floor(ideal)));
  }
  _basemapZoomState = { z, ideal };
  return z;
}

function tryDrawBasemapTile(tx, ty, zoom, sx, sy, sw, sh) {
  if (!(sw > 0.5 && sh > 0.5)) return { drawn: false, native: false };
  const url = basemapTileUrl(zoom, tx, ty);
  const cached = _tileCache[url];
  if (cached && cached instanceof Image && cached.complete && cached.naturalWidth > 0) {
    const prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = true;
    if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cached, sx, sy, sw, sh);
    ctx.imageSmoothingEnabled = prevSmooth;
    return { drawn: true, native: true };
  }
  for (let pz = zoom - 1; pz >= Math.max(1, zoom - 4); pz--) {
    const shift = zoom - pz;
    const scale = Math.pow(2, shift);
    const ptx = Math.floor(tx / scale);
    const pty = Math.floor(ty / scale);
    const purl = basemapTileUrl(pz, ptx, pty);
    const parent = _tileCache[purl];
    if (parent && parent instanceof Image && parent.complete && parent.naturalWidth > 0) {
      const localTx = tx - ptx * scale;
      const localTy = ty - pty * scale;
      const tilePx = 256 / scale;
      const prevSmooth = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = true;
      if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(
        parent,
        localTx * tilePx, localTy * tilePx, tilePx, tilePx,
        sx, sy, sw, sh
      );
      ctx.imageSmoothingEnabled = prevSmooth;
      return { drawn: true, native: false };
    }
  }
  return { drawn: false, native: false };
}

function startBasemapTileImageLoad(url) {
  const cached = _tileCache[url];
  if (cached instanceof Image) {
    if (!cached.complete) return;
    if (cached.naturalWidth > 0) return;
  }
  if (cached === 'loading' && !canRetryMapTile(url)) return;
  if (isTileCacheMiss(cached) && !canRetryMapTile(url)) return;

  const img = new Image();
  if (mapTileUseCrossOrigin()) img.crossOrigin = 'anonymous';
  img.referrerPolicy = 'no-referrer';
  img.decoding = 'async';
  _tileLoadingSince[url] = Date.now();
  _tileCache[url] = img;
  _tileLoadQueue++;
  img.onload = () => {
    _tileLoadQueue--;
    delete _tileLoadingSince[url];
    scheduleRender();
    scheduleBasemapRefresh(300);
    if (mapTileUseCrossOrigin() && img.naturalWidth > 0) {
      persistMapTile(url, img).catch(() => {});
    }
  };
  img.onerror = () => {
    _tileLoadQueue--;
    delete _tileLoadingSince[url];
    const fallbacks = basemapTileFallbackUrls(url);
    if (fallbacks.length) {
      tryBasemapTileFallback(url, fallbacks, 0);
    } else {
      markTileCacheMiss(url);
      delete _tileCache[url];
    }
    scheduleRender();
  };
  img.src = url;
}

function tryBasemapTileFallback(origUrl, fallbacks, idx) {
  if (idx >= fallbacks.length) {
    markTileCacheMiss(origUrl);
    delete _tileCache[origUrl];
    scheduleRender();
    return;
  }
  const img = new Image();
  if (mapTileUseCrossOrigin()) img.crossOrigin = 'anonymous';
  img.referrerPolicy = 'no-referrer';
  img.decoding = 'async';
  img.onload = () => {
    _tileCache[origUrl] = img;
    scheduleRender();
    scheduleBasemapRefresh(300);
  };
  img.onerror = () => tryBasemapTileFallback(origUrl, fallbacks, idx + 1);
  img.src = fallbacks[idx];
}

function kickoffBasemapTileLoad(zoom, tx, ty) {
  startBasemapTileImageLoad(basemapTileUrl(zoom, tx, ty));
  for (let pz = zoom - 1; pz >= Math.max(1, zoom - 3); pz--) {
    const shift = zoom - pz;
    const scale = Math.pow(2, shift);
    startBasemapTileImageLoad(basemapTileUrl(pz, Math.floor(tx / scale), Math.floor(ty / scale)));
  }
}

function normalizeTileXYRange(tl, br) {
  return {
    tlx: Math.min(tl.x, br.x),
    brx: Math.max(tl.x, br.x),
    tly: Math.min(tl.y, br.y),
    bry: Math.max(tl.y, br.y),
  };
}

function getVisibleMapTileUrls() {
  if (S.basemap === 'none') return [];
  const topBar = getTopBarH();
  const topLeftW = { x: (0 - S.tx) / S.scale, y: (topBar - S.ty) / S.scale };
  const botRightW = { x: (CW - S.tx) / S.scale, y: (getMapViewBottom() - S.ty) / S.scale };
  const tlGeo = worldToLatLon(topLeftW.x, topLeftW.y);
  const brGeo = worldToLatLon(botRightW.x, botRightW.y);
  const mPerScreenPx = pxToMeters(1) / S.scale;
  const zoom = computeBasemapTileZoom(mPerScreenPx);
  const tl = latLonToTileXY(tlGeo.lat, tlGeo.lon, zoom);
  const br = latLonToTileXY(brGeo.lat, brGeo.lon, zoom);
  const norm = normalizeTileXYRange(tl, br);
  if ((norm.brx - norm.tlx + 1) * (norm.bry - norm.tly + 1) > 200) return [];
  const urls = [];
  for (let tx = norm.tlx; tx <= norm.brx; tx++) {
    for (let ty = norm.tly; ty <= norm.bry; ty++) urls.push(basemapTileUrl(zoom, tx, ty));
  }
  return urls;
}

let _tileWarmHintShown = false;
async function warmViewportTilesFromDb() {
  const urls = getVisibleMapTileUrls();
  if (!urls.length) return;
  try {
    const db = await openProjectDb();
    let warmed = 0;
    for (const url of urls) {
      const cached = _tileCache[url];
      if (cached && cached !== 'loading' && !isTileCacheMiss(cached)) continue;
      const row = await idbGet(db, 'map_tiles', url);
      if (!row?.blob) continue;
      try {
        _tileCache[url] = await blobToImage(row.blob);
        warmed++;
      } catch (_) {}
    }
    if (warmed) {
      scheduleRender();
      if (!navigator.onLine && !_tileWarmHintShown) {
        _tileWarmHintShown = true;
        showHint(t('offline.tilesCached'), 4000);
      }
    }
  } catch (_) {}
}

function mapTileUseCrossOrigin() {
  if (location.protocol === 'file:') return false;
  if (!window.isSecureContext) return false;
  return true;
}

function loadMapTileViaImage(url, useCors) {
  return new Promise(resolve => {
    const img = new Image();
    if (useCors) img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function loadMapTileViaFetch(url) {
  if (location.protocol === 'file:') return null;
  try {
    const res = await fetch(url, { mode: 'cors', cache: 'force-cache', referrerPolicy: 'no-referrer' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob || !blob.size) return null;
    return await blobToImage(blob);
  } catch (_) {
    return null;
  }
}

async function loadMapTileFromNetwork(url) {
  const useCors = mapTileUseCrossOrigin();
  const urls = [url].concat(basemapTileFallbackUrls(url));
  for (const u of urls) {
    let img = useCors ? await loadMapTileViaFetch(u) : null;
    if (!img) img = await loadMapTileViaImage(u, useCors);
    if (!img && useCors) img = await loadMapTileViaImage(u, false);
    if (img && img.naturalWidth > 0) return { img, persist: useCors && u === url };
  }
  return null;
}

function scheduleBasemapRefresh(ms) {
  if (_basemapRefreshTimer) clearTimeout(_basemapRefreshTimer);
  if (!S.basemap || S.basemap === 'none') return;
  _basemapRefreshTimer = setTimeout(() => {
    _basemapRefreshTimer = null;
    scheduleRender();
    if (_tileLoadQueue > 0 || Object.values(_tileCache).some(v => v === 'loading')) {
      scheduleBasemapRefresh(400);
    }
  }, ms || 500);
}

async function loadMapTileImage(url) {
  if (_tileCache[url] === 'loading' && !canRetryMapTile(url)) return;
  if (!canRetryMapTile(url)) return;
  _tileCache[url] = 'loading';
  _tileLoadingSince[url] = Date.now();
  try {
    try {
      const db = await openProjectDb();
      const row = await idbGet(db, 'map_tiles', url);
      if (row?.blob) {
        const img = await blobToImage(row.blob);
        delete _tileLoadingSince[url];
        _tileCache[url] = img;
        scheduleRender();
        scheduleBasemapRefresh(300);
        return;
      }
    } catch (_) {}
    if (!navigator.onLine) {
      markTileCacheMiss(url);
      delete _tileLoadingSince[url];
      return;
    }
    _tileLoadQueue++;
    const loaded = await loadMapTileFromNetwork(url);
    _tileLoadQueue--;
    delete _tileLoadingSince[url];
    if (loaded?.img) {
      _tileCache[url] = loaded.img;
      scheduleRender();
      scheduleBasemapRefresh(300);
      if (loaded.persist) persistMapTile(url, loaded.img);
    } else {
      markTileCacheMiss(url);
    }
  } catch (_) {
    delete _tileLoadingSince[url];
    markTileCacheMiss(url);
  }
}

function updateFieldOfflineUi() {
  const pill = document.getElementById('field-offline-pill');
  if (!pill) return;
  const off = typeof navigator !== 'undefined' && navigator.onLine === false;
  pill.style.display = off ? 'inline-flex' : 'none';
  if (off) pill.textContent = t('offline.badge');
  document.body.classList.toggle('field-offline', off);
  if (off) warmViewportTilesFromDb();
}

function onFieldNetworkOnline() {
  Object.keys(_tileCache).forEach(url => {
    if (isTileCacheMiss(_tileCache[url])) delete _tileCache[url];
  });
  _tileWarmHintShown = false;
  updateFieldOfflineUi();
  ensureFieldBasemapOn();
  warmViewportTilesFromDb();
  scheduleRender();
  scheduleBasemapRefresh(600);
}

function updateProjectTitleUi() {
  const btn = document.getElementById('btn-project-menu');
  if (btn) btn.textContent = '📁 ' + projectDisplayName(FIELD_PROJECT.name || t('project.menu'));
  updateFieldCtxProject();
}

function openProjectPanel() {
  const open = () => {
    document.getElementById('project-overlay').style.display = 'flex';
    hideNewProjectForm();
    refreshProjectRecentList();
  };
  if (typeof FieldAccessGate !== 'undefined') FieldAccessGate.requireAccess(open);
  else open();
}
function closeProjectPanel() {
  document.getElementById('project-overlay').style.display = 'none';
}

async function fetchProjectListSorted() {
  const db = await openProjectDb();
  return (await idbGetAll(db, 'projects')).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
}

function attachProjectDeleteButton(row, projectId) {
  const delWrap = document.createElement('div');
  delWrap.className = 'ln-del-wrap';
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'ln-del';
  del.textContent = '✕';
  del.title = t('project.delete');
  del.setAttribute('aria-label', t('project.delete'));
  del.onclick = e => {
    e.stopPropagation();
    e.preventDefault();
    if (delWrap.classList.contains('ln-del-confirming')) return;
    showLayerListDeleteConfirm(row, delWrap, del, () => deleteProject(projectId));
  };
  delWrap.appendChild(del);
  row.appendChild(delWrap);
}

function renderProjectListRows(container, projects, opts) {
  const mode = (opts && opts.mode) || 'modal';
  container.innerHTML = '';
  if (!projects.length) {
    const empty = document.createElement('div');
    empty.className = 'proj-empty';
    empty.textContent = t('project.none');
    container.appendChild(empty);
    return;
  }
  projects.forEach(p => {
    if (mode === 'panel') {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'field-proj-pick' + (p.id === FIELD_PROJECT.id ? ' active' : '');
      row.innerHTML = '<span class="field-proj-name">' + escapeHtml(projectDisplayName(p.name)) + '</span>';
      row.onclick = () => {
        openProjectById(p.id).then(() => renderFieldProjectReportsList());
      };
      attachProjectDeleteButton(row, p.id);
      container.appendChild(row);
    } else {
      const row = document.createElement('div');
      row.className = 'proj-row';
      row.innerHTML = `<span class="proj-row-name">${escapeHtml(projectDisplayName(p.name))}</span><span class="proj-row-meta">${(p.updatedAt || '').slice(0, 16).replace('T', ' ')}</span>`;
      row.onclick = () => {
        if (row.classList.contains('ln-del-pending')) return;
        openProjectById(p.id);
      };
      attachProjectDeleteButton(row, p.id);
      container.appendChild(row);
    }
  });
}

async function refreshProjectRecentList() {
  const el = document.getElementById('project-recent');
  if (!el) return;
  try {
    let projects = await fetchProjectListSorted();
    if (FIELD_PROJECT.id && !projects.some(p => p.id === FIELD_PROJECT.id)) {
      projects = [{
        id: FIELD_PROJECT.id,
        name: FIELD_PROJECT.name,
        updatedAt: FIELD_PROJECT.createdAt || new Date().toISOString(),
      }, ...projects];
    }
    renderProjectListRows(el, projects, { mode: 'modal' });
  } catch (e) {
    el.textContent = 'Liste yüklenemedi';
  }
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function renameCurrentProject() {
  if (!FIELD_PROJECT.id) return;
  const name = prompt('Gezi adı:', FIELD_PROJECT.name);
  if (!name || !name.trim()) return;
  FIELD_PROJECT.name = name.trim();
  updateProjectTitleUi();
  await saveCurrentProject(false);
  refreshProjectRecentList();
  showHint('Gezi adı güncellendi');
}

function showNewProjectForm() {
  const form = document.getElementById('project-new-form');
  const btn = document.getElementById('btn-project-new');
  const inp = document.getElementById('project-new-name');
  if (!form || !inp) {
    createNewProject(defaultProjectName());
    return;
  }
  if (btn) btn.style.display = 'none';
  form.hidden = false;
  inp.value = defaultProjectName();
  setTimeout(() => { inp.focus(); inp.select(); }, 30);
}

function hideNewProjectForm() {
  const form = document.getElementById('project-new-form');
  const btn = document.getElementById('btn-project-new');
  if (form) form.hidden = true;
  if (btn) btn.style.display = '';
}

async function submitNewProject() {
  const inp = document.getElementById('project-new-name');
  const name = inp?.value?.trim() || defaultProjectName();
  hideNewProjectForm();
  await createNewProject(name);
}

function finalizeFieldInspectionPanels() {
  closeNotePopup();
  const sheet = document.getElementById('field-photo-voice-sheet');
  if (sheet?.classList.contains('open')) {
    saveFieldPhotoDetail();
    if (sheet._thumbUrl) { URL.revokeObjectURL(sheet._thumbUrl); sheet._thumbUrl = null; }
    sheet.classList.remove('open');
    if (_fieldVoiceRec?.state === 'recording') try { _fieldVoiceRec.stop(); } catch (_) {}
  }
  closeFieldPhotoViewer();
  if (typeof closeFieldExportSheet === 'function') closeFieldExportSheet();
  hideFeatureInfoPanel();
  clearGpsGuidance();
}

function clearFieldInspectionWorkspaceState() {
  _fieldCtxPhotoId = null;
  _fieldCtxNoteId = null;
  _notePopupId = null;
  _observationPopupPrimaryId = null;
  _fieldInfoObjId = null;
  S.selectedIds = [];
  setDeleteButtonVisible(false);
  if (_fieldPhotoPreviewUrl) {
    URL.revokeObjectURL(_fieldPhotoPreviewUrl);
    _fieldPhotoPreviewUrl = null;
  }
  _photoThumbCache.clear();
  updateFieldRightPanel(null);
  document.getElementById('right-panel')?.classList.remove('field-has-selection');
  buildFieldNotesList();
}

function resetGpsTrackForFreshInspection() {
  stopGpsTrackReplay();
  _gpsTrack.state = 'idle';
  _gpsTrack.points = [];
  _gpsTrack.objId = null;
  _gpsTrack.startTs = null;
  _gpsTrack.pausedAt = null;
  _gpsTrack.pauseMs = 0;
  _gpsStationaryAnchor = null;
  updateGpsTrackHud();
}

async function createNewProject(name) {
  try {
    if (FIELD_PROJECT.id && _projectDirty) {
      await saveCurrentProject(true);
    }
    finalizeFieldInspectionPanels();

    const projName = (name || '').trim() || defaultProjectName();
    FIELD_PROJECT.id = 'prj_' + Date.now();
    FIELD_PROJECT.name = projName;
    FIELD_PROJECT.createdAt = new Date().toISOString();
    S.objects = [];
    S.history = [[]];
    S.histIdx = 0;
    S.selectedIds = [];
    _slopeAnalysisReport = null;
    _fieldInfoObjId = null;
    _activePlanOverlayLayerId = null;
    _fieldProjectReports = [];
    clearFieldInspectionWorkspaceState();
    resetGpsTrackForFreshInspection();
    clearLocalSlopeAnalysis();
    closePlanOverlayPanel();
    initLayers();
    buildLayerPanel();
    sanitizeFieldProjectLayers();
    if (S.tool === 'point' || S.tool === 'line') setTool('select');
    updateProjectTitleUi();
    _projectDirty = true;
    const ok = await saveCurrentProject(false);
    if (!ok) {
      showHint(t('hub.saveFailed'), 8000);
      scheduleProjectSaveDebounced();
    } else {
      showHint((PA_LANG === 'tr' ? 'Gezi oluşturuldu: ' : 'Inspection created: ') + projectDisplayName(projName));
    }
    _fieldHubProjects = await reloadFieldHubProjects();
    refreshFieldJourneyHubUi();
    await refreshProjectRecentList();
    await updateFieldCtxProject();
    hideNewProjectForm();
    closeProjectPanel();
    scheduleRender();
    renderFieldProjectReportsList();
    if (FIELD_MODE) await activateFieldLocationSession(true);
  } catch (e) {
    console.error('[New Project]', e);
    showHint('Gezi oluşturulamadı: ' + (e.message || e));
  }
}

async function readProjectSnapshotRow(db, id) {
  let row = await idbGet(db, 'snapshots', id);
  if (row?.json) return row;
  const raw = await new Promise((res, rej) => {
    const tx = db.transaction('snapshots', 'readonly');
    const r = tx.objectStore('snapshots').get(id);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  });
  if (!raw) return null;
  if (raw.json) return raw;
  if (raw.jsonEnc && typeof FieldDbCrypto !== 'undefined') {
    const dec = await FieldDbCrypto.decryptRecord('snapshots', raw);
    if (dec?.json) return dec;
  }
  return raw;
}

async function openProjectById(id, opts = {}) {
  try {
    if (typeof FieldAccessGate !== 'undefined' && FieldAccessGate.hasPin()) {
      const unlocked = await FieldAccessGate.requireUnlock();
      if (!unlocked) {
        if (!opts.quiet) showHint(t('gate.unlockSub'), 5000);
        return false;
      }
    }
    const db = await openProjectDb();
    const row = await readProjectSnapshotRow(db, id);
    if (!row?.json) {
      if (!opts.quiet) {
        if (row?.jsonEnc && typeof FieldAccessGate !== 'undefined' && FieldAccessGate.hasPin() && !FieldAccessGate.isUnlocked()) {
          showHint(t('gate.unlockSub'), 7000);
        } else {
          showHint(t('hub.snapshotMissing'), 7000);
        }
      }
      if (!opts.quiet) localStorage.removeItem('planai_field_last_project');
      return false;
    }
    const meta = await idbGet(db, 'projects', id);
    finalizeFieldInspectionPanels();
    applyProjectSnapshot(JSON.parse(row.json));
    _projectDirty = false;
    localStorage.setItem('planai_field_last_project', id);
    closeProjectPanel();
    updateProjectTitleUi();
    await refreshProjectRecentList();
    await updateFieldCtxProject();
    renderFieldProjectReportsList();
    const savedAt = meta?.updatedAt
      ? new Date(meta.updatedAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
      : '';
    setAutosaveIndicator('saved', savedAt);
    if (!opts.quiet) showHint('Gezi açıldı');
    if (!opts.keepHub) hideFieldJourneyHub();
    scheduleRender();
    warmViewportTilesFromDb();
    return true;
  } catch (e) {
    showHint('Açılamadı: ' + (e.message || e));
    return false;
  }
}

async function idbDeleteByKeyPrefix(db, store, prefix) {
  const rows = await idbGetAll(db, store);
  const matches = rows.filter(r => r.key && String(r.key).startsWith(prefix));
  for (const r of matches) {
    await idbDelete(db, store, r.key);
  }
}

async function deleteProject(id) {
  try {
    const db = await openProjectDb();
    await idbDeleteByKeyPrefix(db, 'blobs', id + ':');
    await idbDelete(db, 'projects', id);
    await idbDelete(db, 'snapshots', id);
    if (FIELD_PROJECT.id === id) {
      FIELD_PROJECT.id = null;
      FIELD_PROJECT.name = t('project.untitled');
      localStorage.removeItem('planai_field_last_project');
      S.objects = [];
      resetFieldWorkspaceShell();
      showFieldJourneyHub();
    }
    _fieldHubProjects = await reloadFieldHubProjects();
    refreshFieldJourneyHubUi();
    refreshProjectRecentList();
    updateFieldCtxProject();
    showHint(t('project.deleted'));
  } catch (e) {
    showHint('Silinemedi: ' + e.message);
  }
}

window.openProjectPanel = openProjectPanel;
window.closeProjectPanel = closeProjectPanel;
window.showNewProjectForm = showNewProjectForm;
window.hideNewProjectForm = hideNewProjectForm;
window.submitNewProject = submitNewProject;
window.createNewProject = createNewProject;

async function snapshotRowExists(db, id) {
  const raw = await new Promise((res, rej) => {
    const tx = db.transaction('snapshots', 'readonly');
    const r = tx.objectStore('snapshots').get(id);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  });
  return !!(raw && (raw.json || raw.jsonEnc));
}

async function reloadFieldHubProjects() {
  try {
    const db = await openProjectDb();
    const all = await fetchProjectListSorted();
    const resumable = [];
    for (const p of all) {
      if (await snapshotRowExists(db, p.id)) {
        const row = await readProjectSnapshotRow(db, p.id);
        if (row?.json) resumable.push(p);
        else if (!row?.jsonEnc) {
          try { await idbDelete(db, 'projects', p.id); await idbDelete(db, 'snapshots', p.id); } catch (_) {}
        } else {
          resumable.push(p);
        }
        continue;
      }
      try { await idbDelete(db, 'projects', p.id); } catch (_) {}
    }
    _fieldHubProjects = resumable;
    return resumable;
  } catch (e) {
    console.warn('[Hub] reload projects', e);
    _fieldHubProjects = [];
    return [];
  }
}

let _fieldHubProjects = [];
let _persistProtectionChecked = false;
let _hubRefreshGen = 0;

function formatHubActivityDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(PA_LANG === 'tr' ? 'tr-TR' : 'en-US', {
      day: 'numeric', month: 'short', year: 'numeric',
    });
  } catch (_) {
    return '—';
  }
}

function formatHubActivityTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const now = new Date();
    const locale = PA_LANG === 'tr' ? 'tr-TR' : 'en-US';
    const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) {
      return (PA_LANG === 'tr' ? 'Bugün ' : 'Today ') + time;
    }
    return formatHubActivityDate(iso) + ' ' + time;
  } catch (_) {
    return '—';
  }
}

function formatHubDistanceKm(distanceM) {
  const m = Number(distanceM) || 0;
  if (m < 1) return '0 km';
  const km = m / 1000;
  return (km >= 10 ? Math.round(km) : km.toFixed(1)) + ' km';
}

function summarizeSnapshotForHub(snap) {
  if (!snap) return { photos: 0, notes: 0, distanceM: 0 };
  const objects = snap.objects || [];
  const photos = Array.isArray(snap.photos)
    ? snap.photos.length
    : objects.filter(o => o.type === 'field_photo').length;
  const notes = Array.isArray(snap.notes)
    ? snap.notes.length
    : objects.filter(o => o.type === 'field_note').length;
  let distanceM = 0;
  objects.forEach(o => {
    if (o.type === 'field_gps_track' && o.vertices?.length >= 2) {
      distanceM += trackTotalDistanceM(o.vertices);
    }
  });
  return { photos, notes, distanceM };
}

function formatHubRelativeActivity(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const diffMs = Date.now() - d.getTime();
    if (diffMs < 0) return formatHubActivityTime(iso);
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return PA_LANG === 'tr' ? 'az önce' : 'just now';
    if (mins < 60) return PA_LANG === 'tr' ? (mins + ' dakika önce') : (mins + ' minutes ago');
    const hours = Math.floor(mins / 60);
    if (hours < 24) return PA_LANG === 'tr' ? (hours + ' saat önce') : (hours + ' hours ago');
    const days = Math.floor(hours / 24);
    if (days < 7) return PA_LANG === 'tr' ? (days + ' gün önce') : (days + ' days ago');
    return formatHubActivityDate(iso);
  } catch (_) {
    return '—';
  }
}

function updateHubSummaryChips(totals) {
  const j = document.getElementById('fjh-chip-journeys');
  const p = document.getElementById('fjh-chip-photos');
  const n = document.getElementById('fjh-chip-notes');
  const d = document.getElementById('fjh-chip-distance');
  if (j) j.textContent = String(totals.journeys || 0);
  if (p) p.textContent = String(totals.photos || 0);
  if (n) n.textContent = String(totals.notes || 0);
  if (d) d.textContent = formatHubDistanceKm(totals.distanceM || 0);
}

let _hubResizeTimer = null;
function scheduleHubLayoutRefresh() {
  if (_hubResizeTimer) clearTimeout(_hubResizeTimer);
  _hubResizeTimer = setTimeout(() => {
    _hubResizeTimer = null;
    if (isFieldJourneyHubOpen()) refreshFieldJourneyHubUi();
  }, 120);
}

function updateFieldJourneyHubI18n() {
  document.querySelectorAll('#field-journey-hub-overlay [data-i18n], #field-security-settings-overlay [data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
  document.getElementById('btn-hub-lang-tr')?.classList.toggle('active', PA_LANG === 'tr');
  document.getElementById('btn-hub-lang-en')?.classList.toggle('active', PA_LANG === 'en');
  refreshFieldJourneyHubUi();
  syncFieldSecuritySettingsUi();
}

async function refreshFieldJourneyHubUi() {
  const gen = ++_hubRefreshGen;
  const projects = _fieldHubProjects || [];
  const continueCard = document.getElementById('fjh-card-continue');
  const newCard = document.getElementById('fjh-card-new');
  const continueCta = document.getElementById('fjh-continue-cta');
  const continueName = document.getElementById('fjh-continue-name');
  const continueActivity = document.getElementById('fjh-continue-activity');
  const metricsEl = document.getElementById('fjh-continue-metrics');
  const photosLbl = PA_LANG === 'tr' ? 'Fotoğraf' : 'Photos';
  const notesLbl = PA_LANG === 'tr' ? 'Not' : 'Notes';

  if (!projects.length) {
    if (continueCard) continueCard.hidden = true;
    if (newCard) newCard.classList.add('fjh-mission-new--solo');
    updateHubSummaryChips({ journeys: 0, photos: 0, notes: 0, distanceM: 0 });
    return;
  }

  if (continueCard) continueCard.hidden = false;
  if (continueCta) continueCta.disabled = false;
  if (newCard) newCard.classList.remove('fjh-mission-new--solo');
  const last = localStorage.getItem('planai_field_last_project');
  const latest = projects.find(p => p.id === last) || projects[0];
  if (continueName) continueName.textContent = projectDisplayName(latest?.name || t('project.untitled'));

  let totalPhotos = 0;
  let totalNotes = 0;
  let totalDistM = 0;
  let latestStats = { photos: 0, notes: 0, distanceM: 0 };

  try {
    const db = await openProjectDb();
    for (const p of projects) {
      if (gen !== _hubRefreshGen) return;
      const row = await readProjectSnapshotRow(db, p.id);
      if (!row?.json) continue;
      const snap = JSON.parse(row.json);
      const s = summarizeSnapshotForHub(snap);
      totalPhotos += s.photos;
      totalNotes += s.notes;
      totalDistM += s.distanceM;
      if (p.id === latest.id) latestStats = s;
    }
  } catch (_) {}

  if (gen !== _hubRefreshGen) return;

  if (metricsEl) {
    metricsEl.textContent =
      formatHubDistanceKm(latestStats.distanceM) + ' • ' +
      latestStats.photos + ' ' + photosLbl + ' • ' +
      latestStats.notes + ' ' + notesLbl;
  }
  if (continueActivity) {
    continueActivity.textContent = formatHubRelativeActivity(latest?.updatedAt);
  }
  updateHubSummaryChips({
    journeys: projects.length,
    photos: totalPhotos,
    notes: totalNotes,
    distanceM: totalDistM,
  });
}
function showFieldJourneyHub() {
  const overlay = document.getElementById('field-journey-hub-overlay');
  if (!overlay) return;
  if (overlay.parentElement !== document.body) document.body.appendChild(overlay);
  if (typeof FieldAccessGate !== 'undefined') FieldAccessGate.hideOverlay();
  updateFieldJourneyHubI18n();
  overlay.style.display = 'flex';
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('field-journey-hub-active');
  if (!window._fjhResizeBound) {
    window._fjhResizeBound = true;
    window.addEventListener('resize', scheduleHubLayoutRefresh, { passive: true });
    window.addEventListener('orientationchange', scheduleHubLayoutRefresh, { passive: true });
  }
}

function hideFieldJourneyHub() {
  const overlay = document.getElementById('field-journey-hub-overlay');
  if (!overlay) return;
  overlay.style.display = 'none';
  overlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('field-journey-hub-active');
}

function isFieldJourneyHubOpen() {
  return document.getElementById('field-journey-hub-overlay')?.style.display === 'flex';
}

async function fieldHubEnterMapAfterAction() {
  hideFieldJourneyHub();
  scheduleEnsureFieldGpsSessionActive();
}

async function fieldHubActionNew() {
  hideFieldJourneyHub();
  await createNewProject(defaultProjectName());
  maybeStartFieldOnboarding();
}

async function fieldHubActionContinue() {
  try {
    await reloadFieldHubProjects();
    const projects = _fieldHubProjects || [];
    if (!projects.length) {
      showHint(t('hub.noSavedInspection'), 6000);
      return;
    }
    const last = localStorage.getItem('planai_field_last_project');
    const targetId = (last && projects.some(p => p.id === last)) ? last : projects[0].id;
    hideFieldJourneyHub();
    const opened = await openProjectById(targetId);
    if (opened) {
      scheduleEnsureFieldGpsSessionActive();
      return;
    }
    showFieldJourneyHub();
    showHint(t('hub.openFailed'), 8000);
  } catch (e) {
    console.error('[Hub] continue', e);
    showFieldJourneyHub();
    showHint(t('hub.openFailed') + ' ' + (e.message || ''), 8000);
  }
}

async function fieldHubOpenJourney(id) {
  if (!id) return;
  const opened = await openProjectById(id);
  if (opened) await fieldHubEnterMapAfterAction();
}

function fieldHubActionPrevious() {
  openProjectPanel();
}

async function fieldHubActionImport() {
  const run = () => {
    hideFieldJourneyHub();
    showFieldImportSheet();
  };
  if (typeof FieldAccessGate !== 'undefined') {
    const ok = await FieldAccessGate.ensureBeforePersist(run);
    if (!ok) return;
  } else run();
}

function openFieldSecuritySettings() {
  const overlay = document.getElementById('field-security-settings-overlay');
  if (!overlay) return;
  if (overlay.parentElement !== document.body) document.body.appendChild(overlay);
  syncFieldSecuritySettingsUi();
  overlay.style.display = 'flex';
  overlay.setAttribute('aria-hidden', 'false');
  document.body.classList.add('field-security-settings-active');
}

function closeFieldSecuritySettings() {
  const overlay = document.getElementById('field-security-settings-overlay');
  if (!overlay) return;
  overlay.style.display = 'none';
  overlay.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('field-security-settings-active');
}

function syncFieldSecuritySettingsUi() {
  const pinEl = document.getElementById('field-security-pin-status');
  const encEl = document.getElementById('field-security-enc-status');
  const enableBtn = document.getElementById('btn-security-enable-pin');
  const lockBtn = document.getElementById('btn-security-lock-now');
  const viewRecBtn = document.getElementById('btn-security-view-recovery');
  const regenBtn = document.getElementById('btn-security-regen-recovery');
  const hasPin = typeof FieldAccessGate !== 'undefined' && FieldAccessGate.hasPin();
  const unlocked = hasPin && FieldAccessGate.isUnlocked();
  if (pinEl) {
    pinEl.textContent = hasPin ? t('sec.on') : t('sec.off');
    pinEl.classList.toggle('off', !hasPin);
  }
  if (encEl) {
    const st = typeof FieldAccessGate !== 'undefined' ? FieldAccessGate.encryptionStatusLabel() : 'off';
    const labels = {
      enabled: t('sec.encEnabled'),
      locked: t('sec.encLocked'),
      baseline: t('sec.encBaseline'),
      off: t('sec.encOff'),
    };
    encEl.textContent = labels[st] || labels.off;
    encEl.classList.toggle('off', st === 'off');
    encEl.classList.toggle('locked', st === 'locked');
  }
  if (enableBtn) {
    enableBtn.style.display = hasPin ? 'none' : 'block';
    enableBtn.textContent = t('sec.enablePin');
  }
  if (lockBtn) lockBtn.style.display = hasPin && unlocked ? 'block' : 'none';
  if (viewRecBtn) viewRecBtn.style.display = hasPin && unlocked && FieldAccessGate.hasRecovery() ? 'block' : 'none';
  if (regenBtn) regenBtn.style.display = hasPin && unlocked ? 'block' : 'none';
}

function fieldSecurityEnablePin() {
  if (typeof FieldAccessGate === 'undefined') return;
  closeFieldSecuritySettings();
  FieldAccessGate.promptSetupFromSettings(() => syncFieldSecuritySettingsUi());
}

function fieldSecurityLockNow() {
  if (typeof FieldAccessGate === 'undefined') return;
  FieldAccessGate.lock();
  syncFieldSecuritySettingsUi();
  showHint(PA_LANG === 'tr' ? 'Oturum kilitlendi' : 'Session locked');
}

function fieldSecurityViewRecovery() {
  if (typeof FieldAccessGate === 'undefined' || !FieldAccessGate.isUnlocked()) return;
  showHint(PA_LANG === 'tr'
    ? 'Kurtarma kodu yalnızca oluşturulduğunda gösterilir. Yeni kod için yenileyin.'
    : 'Recovery code is only shown once. Regenerate if you need a new code.');
}

async function fieldSecurityRegenRecovery() {
  if (typeof FieldAccessGate === 'undefined' || !FieldAccessGate.isUnlocked()) return;
  const res = await FieldAccessGate.regenerateRecoveryCode();
  if (!res.ok || !res.recoveryCode) return;
  closeFieldSecuritySettings();
  FieldAccessGate.showRecoveryCodePanel(res.recoveryCode);
  showHint(t('sec.recoveryRegenerated'));
}

window.fieldHubActionNew = fieldHubActionNew;
window.fieldHubActionContinue = fieldHubActionContinue;
window.fieldHubOpenJourney = fieldHubOpenJourney;
window.fieldHubActionPrevious = fieldHubActionPrevious;
window.fieldHubActionImport = fieldHubActionImport;
window.openFieldSecuritySettings = openFieldSecuritySettings;
window.closeFieldSecuritySettings = closeFieldSecuritySettings;
window.syncFieldSecuritySettingsUi = syncFieldSecuritySettingsUi;
window.fieldSecurityEnablePin = fieldSecurityEnablePin;
window.fieldSecurityLockNow = fieldSecurityLockNow;
window.fieldSecurityViewRecovery = fieldSecurityViewRecovery;
window.fieldSecurityRegenRecovery = fieldSecurityRegenRecovery;

function resetFieldWorkspaceShell() {
  FIELD_PROJECT.id = null;
  FIELD_PROJECT.name = typeof t === 'function' ? t('project.untitled') : 'Untitled';
  FIELD_PROJECT.createdAt = null;
  S.objects = [];
  S.history = [[]];
  S.histIdx = 0;
  S.selectedIds = [];
  _fieldProjectReports = [];
  _projectDirty = false;
  finalizeFieldInspectionPanels();
  clearFieldInspectionWorkspaceState();
  resetGpsTrackForFreshInspection();
  initLayers();
  buildLayerPanel();
  updateProjectTitleUi();
  setAutosaveIndicator('off');
  scheduleRender();
}

async function createDefaultFieldProject() {
  if (!FIELD_PROJECT.id) {
    FIELD_PROJECT.id = 'prj_' + Date.now();
    FIELD_PROJECT.name = defaultProjectName();
    FIELD_PROJECT.createdAt = new Date().toISOString();
  } else if (!FIELD_PROJECT.name || FIELD_PROJECT.name === 'Adsız Gezi' || FIELD_PROJECT.name === 'Adsız Proje') {
    FIELD_PROJECT.name = defaultProjectName();
  }
  finalizeFieldInspectionPanels();
  S.objects = [];
  S.history = [[]];
  S.histIdx = 0;
  clearFieldInspectionWorkspaceState();
  resetGpsTrackForFreshInspection();
  initLayers();
  buildLayerPanel();
  updateProjectTitleUi();
  _projectDirty = true;
  await saveCurrentProject(true);
  await refreshProjectRecentList();
  await updateFieldCtxProject();
  await activateFieldLocationSession(true);
}

async function wipeFieldLocalWorkspace() {
  try {
    if (_projectDb) {
      _projectDb.close();
      _projectDb = null;
    }
    await new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(PROJECT_DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
      req.onblocked = () => resolve();
    });
  } catch (e) {
    console.warn('[Project] wipe', e);
  }
  try { localStorage.removeItem('planai_field_last_project'); } catch (_) {}
  FIELD_PROJECT.id = null;
  FIELD_PROJECT.name = typeof t === 'function' ? t('project.untitled') : 'Adsız Gezi';
  FIELD_PROJECT.createdAt = null;
  S.objects = [];
  S.history = [[]];
  S.histIdx = 0;
  _fieldProjectReports = [];
  _projectDirty = false;
  initLayers();
  buildLayerPanel();
  updateProjectTitleUi();
  scheduleRender();
}

async function initProjectWorkspace() {
  try {
    await openProjectDb();
    startProjectAutosaveInterval();
    resetFieldWorkspaceShell();
    await reloadFieldHubProjects();
    await refreshProjectRecentList();
    await refreshFieldJourneyHubUi();
    showFieldJourneyHub();
  } catch (e) {
    console.warn('[Project] workspace init', e);
    showFieldJourneyHub();
  }
}

function importObjectsToGeoJson(objects) {
  const features = [];
  objects.filter(o => o._import).forEach(o => {
    if (o.type === 'import_point') {
      features.push({ type:'Feature', properties:{ name: o.metadata?.name }, geometry:{ type:'Point', coordinates:[o.lon, o.lat] } });
    } else if (o.type === 'import_polyline') {
      features.push({ type:'Feature', properties:{}, geometry:{ type:'LineString', coordinates: (o.vertices||[]).map(v => [v.lon, v.lat]) } });
    } else if (o.type === 'import_polygon' && o.rings?.[0]) {
      features.push({ type:'Feature', properties:{}, geometry:{ type:'Polygon', coordinates: [o.rings[0].map(c => [c.lon, c.lat])] } });
    }
  });
  return { type:'FeatureCollection', features };
}

let _fieldExportPending = null;
let _fieldExportPreviewWin = null;
let _fieldExportPreviewWatch = null;
let _fieldExportReturnToSheet = false;
let _fieldProjectReports = [];

function safeProjectExportFilename(ext) {
  const base = (FIELD_PROJECT.name || 'gezi').replace(/[^\w\-\.]+/g, '_').replace(/_+/g, '_');
  return base + ext;
}

function hideFieldExportSheet() {
  document.getElementById('field-export-sheet')?.classList.remove('open');
  document.getElementById('field-export-backdrop')?.classList.remove('open');
  document.body.classList.remove('field-export-open');
}

function closeFieldExportSheet() {
  hideFieldExportSheet();
  stopFieldExportPreviewWatch();
  if (_fieldExportPending?.objectUrl) {
    try { URL.revokeObjectURL(_fieldExportPending.objectUrl); } catch (_) {}
  }
  _fieldExportPending = null;
}

function stopFieldExportPreviewWatch() {
  if (_fieldExportPreviewWatch) {
    clearInterval(_fieldExportPreviewWatch);
    _fieldExportPreviewWatch = null;
  }
  _fieldExportPreviewWin = null;
}

function watchFieldExportPreviewClose(win) {
  stopFieldExportPreviewWatch();
  if (!win) return;
  _fieldExportPreviewWin = win;
  _fieldExportPreviewWatch = setInterval(() => {
    if (!_fieldExportPreviewWin || _fieldExportPreviewWin.closed) {
      stopFieldExportPreviewWatch();
      _fieldExportReturnToSheet = false;
      if (_fieldExportPending) showFieldExportSheet();
    }
  }, 350);
}

function getPlanAISharePlugin() {
  const cap = window.Capacitor;
  if (!cap) return null;
  if (cap.Plugins?.PlanAIShare) return cap.Plugins.PlanAIShare;
  try { return cap.registerPlugin?.('PlanAIShare'); } catch (_) { return null; }
}

function showFieldExportSheet() {
  const p = _fieldExportPending;
  if (!p) return;
  const titleEl = document.getElementById('fex-title');
  const fnameEl = document.getElementById('fex-filename');
  const prevBtn = document.getElementById('fex-btn-preview');
  if (titleEl) {
    titleEl.textContent = p.kind === 'interactive' ? t('report.interactiveReady')
      : p.kind === 'pdf' ? t('report.pdfReady') : t('export.sheetTitle');
  }
  if (fnameEl) fnameEl.textContent = p.filename || '';
  if (prevBtn) prevBtn.style.display = (p.previewHtml || p.pdfBlob || (p.blob && p.kind === 'pdf')) ? 'block' : 'none';
  document.getElementById('field-export-backdrop')?.classList.add('open');
  document.getElementById('field-export-sheet')?.classList.add('open');
  document.body.classList.add('field-export-open');
}

async function offerFieldExport(opts) {
  hideReportProgress();
  closeFieldExportSheet();
  if (!opts?.blob) return;
  if (deviceSecurityBlocksExport()) {
    showHint(typeof PlanAISecurity !== 'undefined' ? PlanAISecurity.exportBlockedMessage()
      : (typeof DeviceSecurity !== 'undefined' ? DeviceSecurity.exportBlockedMessage() : 'Güvenlik modu: dışa aktarma kısıtlı'));
    return;
  }
  _fieldExportPending = {
    blob: opts.blob,
    filename: opts.filename || 'export.bin',
    mimeType: opts.mimeType || 'application/octet-stream',
    previewHtml: opts.previewHtml || null,
    pdfBlob: opts.pdfBlob || null,
    kind: opts.kind || 'file',
    objectUrl: URL.createObjectURL(opts.blob),
    cachePath: null,
  };
  if (opts.autoShare === true) {
    showHint(t('export.openingShare'));
    const sent = await shareFieldExportFile(t('export.sendFile'));
    if (sent) return;
    showHint(t('export.shareFail'));
  }
  showFieldExportSheet();
  showHint(t('export.ready'));
}

async function writeFieldExportBlobToCache(blob, filename) {
  const cap = window.Capacitor;
  const Fs = cap?.Plugins?.Filesystem;
  if (!Fs?.writeFile || !Fs?.getUri) throw new Error('Filesystem');
  const safe = String(filename || 'export.bin').replace(/[^\w.\-]+/g, '_');
  const rel = 'planai-share/' + Date.now() + '_' + safe;
  const b64 = await blobToBase64Data(blob);
  await Fs.writeFile({ path: rel, data: b64, directory: 'CACHE' });
  const uriRes = await Fs.getUri({ path: rel, directory: 'CACHE' });
  return { rel, uri: uriRes.uri };
}

function blobToBase64Data(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = fr.result;
      resolve(typeof s === 'string' && s.includes(',') ? s.split(',')[1] : s);
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

async function shareReportPreviewHtml(html, filename, title) {
  if (!html) return false;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const name = filename || safeProjectExportFilename('_interaktif.html');
  if (_fieldExportPending?.objectUrl) {
    try { URL.revokeObjectURL(_fieldExportPending.objectUrl); } catch (_) {}
  }
  _fieldExportPending = {
    blob,
    filename: name,
    mimeType: 'text/html;charset=utf-8',
    previewHtml: html,
    pdfBlob: null,
    kind: 'interactive',
    objectUrl: URL.createObjectURL(blob),
    cachePath: null,
  };
  const ok = await shareFieldExportFile(title || t('export.sendFile'));
  if (!ok) {
    downloadReportPreviewHtml(html, name);
    return false;
  }
  return true;
}

function downloadReportPreviewHtml(html, filename) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename || safeProjectExportFilename('_interaktif.html');
  document.body.appendChild(a);
  a.click();
  a.remove();
  showHint(t('export.downloaded'));
}

async function triggerReportHtmlShareOrDownload(html, htmlName, projectName) {
  if (!html) return false;
  const name = htmlName || safeProjectExportFilename('_interaktif.html');
  const title = projectName || 'PlanAI Field';
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  try {
    const file = new File([blob], name, { type: 'text/html' });
    if (navigator.share) {
      try {
        if (!navigator.canShare || navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title });
          return true;
        }
      } catch (shareErr) {
        if (/abort|cancel/i.test(String(shareErr?.message || shareErr))) return true;
      }
    }
  } catch (_) {}
  downloadReportPreviewHtml(html, name);
  return false;
}
window.shareReportPreviewHtml = shareReportPreviewHtml;
window.downloadReportPreviewHtml = downloadReportPreviewHtml;
window.triggerReportHtmlShareOrDownload = triggerReportHtmlShareOrDownload;

async function shareFieldExportFile(dialogTitle, target) {
  const p = _fieldExportPending;
  if (!p?.blob) return false;
  const shareTarget = target || 'any';
  if (typeof FieldFileBridge !== 'undefined' && FieldFileBridge.shareFile) {
    try {
      showHint(t('export.openingShare'));
      const ok = await FieldFileBridge.shareFile({
        blob: p.blob,
        filename: p.filename,
        mimeType: p.mimeType,
        title: FIELD_PROJECT.name || p.filename,
        target: shareTarget,
      });
      if (ok) {
        closeFieldExportSheet();
        return true;
      }
    } catch (e) {
      const msg = String(e?.message || e || '');
      if (/cancel|abort|dismiss|closed/i.test(msg)) return true;
      console.warn('[Share bridge]', e);
    }
  }
  const cap = window.Capacitor;
  if (isCapacitorNative()) {
    try {
      showHint(t('export.openingShare'));
      const cached = await writeFieldExportBlobToCache(p.blob, p.filename);
      p.cachePath = cached.rel;
      const PlanAIShare = getPlanAISharePlugin();
      if (PlanAIShare?.shareCachedFile) {
        const rec = FieldFileBridge?.SHARE_TARGETS?.[shareTarget];
        await PlanAIShare.shareCachedFile({
          path: cached.rel,
          mimeType: p.mimeType || 'application/octet-stream',
          dialogTitle: dialogTitle || (rec ? FieldFileBridge.tTarget(shareTarget) : t('export.sendFile')),
          packageName: rec?.android || undefined,
          target: shareTarget,
        });
        closeFieldExportSheet();
        return true;
      }
      const Share = cap.Plugins?.Share;
      if (Share?.share && cached.uri) {
        await Share.share({
          title: FIELD_PROJECT.name || 'PlanAI Field',
          dialogTitle: dialogTitle || t('export.sendFile'),
          files: [cached.uri],
        });
        closeFieldExportSheet();
        return true;
      }
    } catch (e) {
      const msg = String(e?.message || e || '');
      if (/cancel|abort|dismiss|closed/i.test(msg)) {
        return true;
      }
      console.warn('[Share native]', e);
    }
  }
  try {
    const file = new File([p.blob], p.filename || 'export', { type: p.mimeType || 'application/octet-stream' });
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ files: [file], title: FIELD_PROJECT.name || p.filename });
      closeFieldExportSheet();
      return true;
    }
  } catch (e) {
    if (/abort/i.test(String(e?.message || e))) {
      closeFieldExportSheet();
      return true;
    }
  }
  return false;
}

async function fieldExportActionTarget(target) {
  const ok = await shareFieldExportFile(
    typeof FieldFileBridge !== 'undefined' ? FieldFileBridge.tTarget(target) : t('export.sendFile'),
    target
  );
  if (!ok) {
    showHint(t('export.shareFail'));
    showFieldExportSheet();
  }
}

async function fieldExportActionShare() {
  return fieldExportActionTarget('any');
}

async function fieldExportActionDrive() {
  return fieldExportActionTarget('drive');
}

function fieldExportActionDownload() {
  const p = _fieldExportPending;
  if (!p?.blob) return;
  const a = document.createElement('a');
  a.href = p.objectUrl || URL.createObjectURL(p.blob);
  a.download = p.filename || 'export';
  document.body.appendChild(a);
  a.click();
  a.remove();
  showHint(t('export.downloaded'));
  closeFieldExportSheet();
}

function fieldExportActionPreview() {
  const p = _fieldExportPending;
  if (!p) return;
  hideFieldExportSheet();
  _fieldExportReturnToSheet = true;
  const done = () => {
    if (!_fieldExportReturnToSheet) return;
    _fieldExportReturnToSheet = false;
    showFieldExportSheet();
  };
  if (p.kind === 'pdf' && (p.pdfBlob || p.blob)) {
    const blob = p.pdfBlob || p.blob;
    openFieldReportViewerBlob(blob, p.filename || FIELD_PROJECT.name, p, 'pdf').catch((e) => {
      console.warn('[Export preview PDF]', e);
      done();
    });
    return;
  }
  if (p.previewHtml && p.kind === 'interactive') {
    const blob = new Blob([p.previewHtml], { type: 'text/html;charset=utf-8' });
    openFieldReportViewerBlob(blob, p.filename || FIELD_PROJECT.name, p, 'interactive').catch((e) => {
      console.warn('[Export preview interactive]', e);
      done();
    });
    return;
  }
  if (p.previewHtml) {
    const win = openReportPreview(p.previewHtml, p.pdfBlob || null, FIELD_PROJECT.name, p.kind);
    if (!win) {
      done();
      return;
    }
    watchFieldExportPreviewClose(win);
    return;
  }
  done();
}

async function exportProjectZip() {
  if (!FIELD_PROJECT.id) { showHint('Önce gezi oluşturun'); return; }
  await saveCurrentProject(true);
  const zip = new JSZip();
  setReportProgress(0, 'ZIP ve rapor hazırlanıyor…');
  try {
    await addReportBundleToZip(zip);
    const notes = S.objects.filter(o => o.type === 'field_note');
    zip.file('notes.json', JSON.stringify(notes, null, 2));
    zip.file('metadata.json', JSON.stringify({
      exportedAt: new Date().toISOString(), version: 2, name: FIELD_PROJECT.name,
      appVersion: PLANAI_FIELD_APP_VERSION,
    }, null, 2));
    const imports = importObjectsToGeoJson(S.objects);
    zip.file('imports/all.geojson', JSON.stringify(imports, null, 2));
    const photos = S.objects.filter(o => o.type === 'field_photo');
    zip.file('photos/manifest.json', JSON.stringify(photos.map(p => ({
      photoId: p.photoId, title: p.title, photoNum: p.photoNum, lat: p.lat, lon: p.lon,
      timestamp: p.timestamp || p.createdAt, description: p.description || '',
      accuracy: p.gpsAccuracy ?? p.accuracy ?? null,
      hasVoice: !!p.hasVoice, voiceDuration: p.voiceDuration || 0, projectId: p.projectId,
    })), null, 2));
    for (const ph of photos) {
      const full = await getPhotoBlobRecord(ph.photoId, 'full');
      if (full?.data) zip.file('photos/' + ph.photoId + '/full.jpg', full.data);
      const thumb = await getPhotoBlobRecord(ph.photoId, 'thumb');
      if (thumb?.data) zip.file('photos/' + ph.photoId + '/thumb.jpg', thumb.data);
      if (ph.hasVoice) {
        const aud = await getPhotoBlobRecord(ph.photoId, 'audio');
        if (aud?.data) zip.file('photos/' + ph.photoId + '/voice.webm', aud.data);
      }
    }
    const out = await zip.generateAsync({ type: 'blob' });
    await offerFieldExport({
      blob: out,
      filename: safeProjectExportFilename('.planai.zip'),
      mimeType: 'application/zip',
      kind: 'zip',
    });
  } catch (e) {
    console.error('[ZIP Export]', e);
    showHint('ZIP hatası: ' + (e.message || e));
  } finally {
    hideReportProgress();
  }
}

function importProjectZipClick() {
  showFieldImportSheet();
}

async function importProjectZipFile(file) {
  if (!file) return;
  if (typeof SpatialSecurity !== 'undefined') SpatialSecurity.assertImportFile(file);
  if (typeof JSZip === 'undefined') { showHint('ZIP desteği yüklenemedi'); return; }
  let zip;
  try {
    zip = typeof SpatialSecurity !== 'undefined' && SpatialSecurity.loadZipFromFile
      ? await SpatialSecurity.loadZipFromFile(file, 'project.zip')
      : await JSZip.loadAsync(await file.arrayBuffer());
    if (typeof SpatialSecurity !== 'undefined' && !SpatialSecurity.loadZipFromFile) {
      SpatialSecurity.assertZipArchive(zip, 'project.zip');
    }
  } catch (err) {
    const msg = typeof SpatialSecurity !== 'undefined' && SpatialSecurity.importErrorMessage(err);
    showHint(msg || ('ZIP: ' + (err.message || err)));
    return;
  }
  const pj = zip.file('project.json');
  if (!pj) { showHint('Geçersiz ZIP: project.json yok'); return; }
  let snap;
  try {
    snap = JSON.parse(await pj.async('string'));
  } catch (_) {
    showHint('Geçersiz ZIP: project.json ayrıştırılamadı');
    return;
  }
  if (!snap || typeof snap !== 'object') { showHint('Geçersiz ZIP: project.json'); return; }
  FIELD_PROJECT.id = 'prj_' + Date.now();
  FIELD_PROJECT.name = (snap.name || 'İçe Aktarılan') + ' (ZIP)';
  snap.id = FIELD_PROJECT.id;
  snap.name = FIELD_PROJECT.name;
  applyProjectSnapshot(snap);
  ensurePhotosLayer();
  ensureGpsLayer();
  preloadPhotoThumbs();
  const db = await openProjectDb();
  const photosFolder = zip.folder('photos');
  if (photosFolder) {
    for (const path of Object.keys(photosFolder.files)) {
      const f = photosFolder.files[path];
      if (f.dir) continue;
      if (typeof SpatialSecurity !== 'undefined') {
        try { SpatialSecurity.assertZipEntryPath(path); } catch (err) {
          console.warn('[ProjectZIP] skip path', path, err.message);
          continue;
        }
      }
      if (!/^photos\/[^/]+\/(full|thumb)\.jpe?g$/i.test(path) && !/^photos\/[^/]+\/voice\.webm$/i.test(path)) {
        console.warn('[ProjectZIP] skip non-whitelist path', path);
        continue;
      }
      const parts = path.split('/');
      const photoId = parts.length >= 3 ? parts[1] : parts.pop().replace(/\.[^.]+$/, '');
      const data = await f.async('blob');
      if (path.includes('/thumb.')) {
        await idbPut(db, 'blobs', { key: projectBlobKey(photoId, 'thumb'), data, mime: 'image/jpeg' });
      } else if (path.includes('/voice.')) {
        await idbPut(db, 'blobs', { key: projectBlobKey(photoId, 'audio'), data, mime: data.type || 'audio/webm' });
      } else {
        await idbPut(db, 'blobs', { key: projectBlobKey(photoId, 'full'), data, mime: 'image/jpeg' });
      }
    }
  }
  S.objects.filter(o => o.type === 'field_photo').forEach(normalizeFieldPhotoObject);
  preloadPhotoThumbs();
  await saveCurrentProject(false);
  showHint('Gezi ZIP içe aktarıldı');
}

// ═══ PLANAI FIELD — Raporlama modülü (MVP) ════════════════════
function formatAreaReport(m2) {
  if (!m2 || m2 < 0) return '—';
  if (m2 >= 1e6) return (m2 / 1e6).toFixed(2) + ' km²';
  if (m2 >= 10000) return (m2 / 10000).toFixed(2) + ' ha';
  return m2.toFixed(0) + ' m²';
}

function formatLengthReport(m) {
  if (!m || m < 0) return '—';
  if (m >= 1000) return (m / 1000).toFixed(2) + ' km';
  if (m >= 1) return m.toFixed(1) + ' m';
  return (m * 100).toFixed(0) + ' cm';
}

function formatReportDateTime(iso, lang) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const loc = (lang || PA_LANG) === 'tr' ? 'tr-TR' : 'en-GB';
    return d.toLocaleDateString(loc) + ' ' + d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
  } catch (_) { return String(iso); }
}

function formatCoord(lat, lon) {
  if (lat == null || lon == null) return '—';
  return lat.toFixed(6) + '°, ' + lon.toFixed(6) + '°';
}

function getReportUserName() {
  try { return localStorage.getItem('planai_field_user_name') || ''; } catch (_) { return ''; }
}

function setReportProgress(pct, step) {
  const ov = document.getElementById('report-progress-overlay');
  const fill = document.getElementById('report-progress-fill');
  const st = document.getElementById('report-progress-step');
  if (ov) ov.style.display = 'flex';
  if (fill) fill.style.width = Math.min(100, Math.max(0, pct)) + '%';
  if (st && step) st.textContent = step;
}

function hideReportProgress() {
  const ov = document.getElementById('report-progress-overlay');
  if (ov) ov.style.display = 'none';
}

function importRingAreaM2(ring) {
  if (!ring || ring.length < 3) return 0;
  const n = ring.length;
  const clat = ring.reduce((s, c) => s + c.lat, 0) / n;
  const clon = ring.reduce((s, c) => s + c.lon, 0) / n;
  const cos = Math.cos(clat * Math.PI / 180);
  const xy = ring.map(c => ({
    x: (c.lon - clon) * 111320 * cos,
    y: (c.lat - clat) * 111320,
  }));
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += xy[i].x * xy[j].y - xy[j].x * xy[i].y;
  }
  return Math.abs(area) / 2;
}

function computeMeasurementsFromObjects(objects) {
  const items = [];
  let pi = 0, po = 0, totalLineM = 0, totalAreaM2 = 0;
  objects.forEach(o => {
    if (!o || o.visible === false) return;
    if (o.type === 'polyline') {
      const verts = o.vertices || [];
      let len = 0;
      for (let i = 0; i < verts.length - 1; i++) {
        len += worldSegMeters(verts[i].x, verts[i].y, verts[i + 1].x, verts[i + 1].y);
      }
      if (o.closed && verts.length >= 3) {
        const a = verts[verts.length - 1], b = verts[0];
        len += worldSegMeters(a.x, a.y, b.x, b.y);
      }
      totalLineM += len;
      items.push({ kind: 'polyline', label: t('report.doc.measure.kindLine') + ' ' + (++pi), lengthM: len, perimeterM: len });
    } else if ((o.type === 'polygon' && o.closed) || o.type === 'zone') {
      const pts = o.points || [];
      if (pts.length < 6) return;
      const area = polygonAreaM2FromWorldPts(pts);
      let perim = 0;
      const n = pts.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        perim += worldSegMeters(pts[i * 2], pts[i * 2 + 1], pts[j * 2], pts[j * 2 + 1]);
      }
      totalAreaM2 += area;
      items.push({ kind: 'polygon', label: 'Alan ' + (++po), areaM2: area, perimeterM: perim });
    } else if (o.type === 'import_polyline') {
      const verts = o.vertices || [];
      let len = 0;
      for (let i = 0; i < verts.length - 1; i++) {
        len += haversineM(verts[i].lat, verts[i].lon, verts[i + 1].lat, verts[i + 1].lon);
      }
      totalLineM += len;
      items.push({ kind: 'polyline', label: 'İçe aktarılan çizgi ' + (++pi), lengthM: len, perimeterM: len });
    } else if (o.type === 'import_polygon' && o.rings?.[0]) {
      const ring = o.rings[0];
      const area = importRingAreaM2(ring);
      let perim = 0;
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        perim += haversineM(ring[i].lat, ring[i].lon, ring[j].lat, ring[j].lon);
      }
      totalAreaM2 += area;
      items.push({ kind: 'polygon', label: 'İçe aktarılan alan ' + (++po), areaM2: area, perimeterM: perim });
    }
  });
  return {
    items,
    totals: {
      polylineCount: pi,
      polygonCount: po,
      totalPolylineM: totalLineM,
      totalPolygonAreaM2: totalAreaM2,
    },
  };
}

async function blobToDataUrl(blob) {
  if (!blob) return '';
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(blob);
  });
}

async function resizeImageBlob(blob, maxPx) {
  if (!blob) return null;
  maxPx = maxPx || 900;
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(maxPx / img.width, maxPx / img.height, 1);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob(b => resolve(b || blob), 'image/jpeg', 0.82);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(blob); };
    img.src = url;
  });
}

function canvasToBlobSafe(cnv, type, quality) {
  return new Promise(resolve => {
    try {
      cnv.toBlob(b => resolve(b || null), type || 'image/png', quality ?? 0.92);
    } catch (e) {
      console.warn('[canvasToBlob]', e);
      resolve(null);
    }
  });
}

async function captureMapSnapshotOnce(scaleFactor) {
  scaleFactor = scaleFactor || 2;
  const prevSel = S.selectedIds.slice();
  S.selectedIds = [];
  scheduleRender();
  await new Promise(r => setTimeout(r, 120));
  render();
  const topBar = getTopBarH();
  const mapBottom = FIELD_MODE ? CH : CH - getFieldDockH();
  const mapH = Math.max(1, mapBottom - topBar);
  const out = document.createElement('canvas');
  out.width = Math.round(CW * scaleFactor);
  out.height = Math.round(mapH * scaleFactor);
  const octx = out.getContext('2d');
  octx.fillStyle = '#e8eef4';
  octx.fillRect(0, 0, out.width, out.height);
  try {
    octx.drawImage(
      canvas,
      0, topBar * DPR, CW * DPR, mapH * DPR,
      0, 0, out.width, out.height
    );
  } catch (e) {
    console.warn('[Map snapshot draw]', e);
    S.selectedIds = prevSel;
    scheduleRender();
    return null;
  }
  S.selectedIds = prevSel;
  scheduleRender();
  const blob = await canvasToBlobSafe(out, 'image/png', 0.92);
  out.width = 0;
  out.height = 0;
  return blob;
}

async function captureMapSnapshot(scaleFactor) {
  if (location.protocol === 'file:') {
    return null;
  }
  let blob = await captureMapSnapshotOnce(scaleFactor);
  if (blob) return blob;
  const prevBm = S.basemap;
  if (prevBm && prevBm !== 'none') {
    S.basemap = 'none';
    clearBasemapTileCache();
    scheduleRender();
    render();
    await new Promise(r => setTimeout(r, 220));
    blob = await captureMapSnapshotOnce(scaleFactor);
    S.basemap = prevBm;
    clearBasemapTileCache();
    scheduleRender();
  }
  return blob;
}

const FIELD_REPORT_LOGO_ASSET = 'assets/planai-field-logo.png?v=4';
let _brandLogoDataUrlCache = null;

function embeddedBrandLogoDataUrl() {
  if (typeof FieldReplayAssets !== 'undefined' && FieldReplayAssets.logoDataUrl) {
    return FieldReplayAssets.logoDataUrl;
  }
  return '';
}

function loadImageAssetAsDataUrl(src) {
  return new Promise((resolve) => {
    const finish = (url) => resolve(url || embeddedBrandLogoDataUrl() || '');
    const tryImg = () => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = img.naturalWidth || 256;
          c.height = img.naturalHeight || 256;
          c.getContext('2d').drawImage(img, 0, 0);
          finish(c.toDataURL('image/png'));
        } catch (_) { finish(''); }
      };
      img.onerror = () => finish('');
      img.src = src;
    };
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', src, true);
      xhr.responseType = 'blob';
      xhr.onload = () => {
        if ((xhr.status === 0 || xhr.status === 200) && xhr.response) {
          blobToDataUrl(xhr.response).then(finish).catch(tryImg);
        } else tryImg();
      };
      xhr.onerror = tryImg;
      xhr.send();
    } catch (_) {
      fetch(src).then(async (resp) => {
        if (!resp.ok) throw new Error('fetch failed');
        finish(await blobToDataUrl(await resp.blob()));
      }).catch(tryImg);
    }
  });
}

async function loadBrandLogoDataUrl() {
  if (_brandLogoDataUrlCache) return _brandLogoDataUrlCache;
  const embedded = embeddedBrandLogoDataUrl();
  if (embedded) {
    _brandLogoDataUrlCache = embedded;
    return embedded;
  }
  const dataUrl = await loadImageAssetAsDataUrl(FIELD_REPORT_LOGO_ASSET);
  _brandLogoDataUrlCache = dataUrl || embedded;
  return _brandLogoDataUrlCache;
}

function tileXYToLatLonEdge(x, y, z) {
  const n = Math.pow(2, z);
  const lon = x / n * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n)));
  return { lat: latRad * 180 / Math.PI, lon };
}

function computeReportGeoBounds(photos, notes, project, mapCenter) {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  const bump = (lat, lon) => {
    if (lat == null || lon == null) return;
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
  };
  (photos || []).forEach(p => bump(p.lat, p.lon));
  (notes || []).forEach(n => bump(n.lat, n.lon));
  (project?.objects || []).forEach(o => {
    if (o.type === 'field_gps_track' && o.vertices?.length) o.vertices.forEach(v => bump(v.lat, v.lon));
    else bump(o.lat, o.lon);
  });
  if (minLat > maxLat) {
    const c = mapCenter || S.mapCenter || { lat: 39.08, lon: 26.88 };
    minLat = c.lat - 0.008; maxLat = c.lat + 0.008;
    minLon = c.lon - 0.008; maxLon = c.lon + 0.008;
  }
  const pad = 0.15;
  const dLat = (maxLat - minLat) * pad || 0.005;
  const dLon = (maxLon - minLon) * pad || 0.005;
  return { minLat: minLat - dLat, maxLat: maxLat + dLat, minLon: minLon - dLon, maxLon: maxLon + dLon };
}

async function loadSatelliteTileImageForReport(z, tx, ty) {
  const url = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' + z + '/' + ty + '/' + tx;
  try {
    const db = await openProjectDb();
    const row = await idbGet(db, 'map_tiles', url);
    if (row?.blob) return blobToImage(row.blob);
  } catch (_) {}
  if (!navigator.onLine) return null;
  try {
    let img = await loadMapTileViaImage(url, true);
    if (!img) img = await loadMapTileViaImage(url, false);
    return img;
  } catch (_) {
    return null;
  }
}

async function buildSatelliteBasemapDataUrl(bounds, w, h) {
  if (!bounds || bounds.minLat >= bounds.maxLat) return '';
  w = w || 1000;
  h = h || 700;
  let z = 17;
  for (z = 17; z >= 11; z--) {
    const tl = latLonToTileXY(bounds.maxLat, bounds.minLon, z);
    const br = latLonToTileXY(bounds.minLat, bounds.maxLon, z);
    const tiles = (br.x - tl.x + 1) * (br.y - tl.y + 1);
    if (tiles <= 20) break;
  }
  const tl = latLonToTileXY(bounds.maxLat, bounds.minLon, z);
  const br = latLonToTileXY(bounds.minLat, bounds.maxLon, z);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1a2838';
  ctx.fillRect(0, 0, w, h);
  const geoToPx = (lat, lon) => ({
    x: ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon || 1)) * w,
    y: ((bounds.maxLat - lat) / (bounds.maxLat - bounds.minLat || 1)) * h,
  });
  let drew = 0;
  for (let ty = tl.y; ty <= br.y; ty++) {
    for (let tx = tl.x; tx <= br.x; tx++) {
      const img = await loadSatelliteTileImageForReport(z, tx, ty);
      if (!img?.naturalWidth) continue;
      const nw = tileXYToLatLonEdge(tx, ty, z);
      const se = tileXYToLatLonEdge(tx + 1, ty + 1, z);
      const p1 = geoToPx(nw.lat, nw.lon);
      const p2 = geoToPx(se.lat, se.lon);
      ctx.drawImage(img, p1.x, p1.y, p2.x - p1.x, p2.y - p1.y);
      drew++;
    }
  }
  if (!drew) return '';
  try {
    return canvas.toDataURL('image/jpeg', 0.88);
  } catch (_) {
    return '';
  }
}

function buildReportMapFallbackDataUrl() {
  const feats = [];
  S.objects.forEach(o => {
    if (o.type === 'field_photo' || o.type === 'field_note') {
      if (o.lat != null && o.lon != null) feats.push({ lat: o.lat, lon: o.lon, col: o.type === 'field_photo' ? '#e67e22' : '#1a73e8' });
    } else if (o.type === 'field_gps_track' && o.vertices?.length >= 2) {
      o.vertices.forEach(v => feats.push({ lat: v.lat, lon: v.lon, col: '#1565c0', track: true }));
    } else if (o.lat != null && o.lon != null) {
      feats.push({ lat: o.lat, lon: o.lon, col: '#546e7a' });
    }
  });
  if (!feats.length && S.mapCenter?.lat != null) {
    feats.push({ lat: S.mapCenter.lat, lon: S.mapCenter.lon, col: '#1a73e8' });
  }
  if (!feats.length) return '';
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  feats.forEach(f => {
    minLat = Math.min(minLat, f.lat); maxLat = Math.max(maxLat, f.lat);
    minLon = Math.min(minLon, f.lon); maxLon = Math.max(maxLon, f.lon);
  });
  const pad = 0.12;
  const dLat = (maxLat - minLat) * pad || 0.004, dLon = (maxLon - minLon) * pad || 0.004;
  minLat -= dLat; maxLat += dLat; minLon -= dLon; maxLon += dLon;
  const proj = (lat, lon) => ({
    x: ((lon - minLon) / (maxLon - minLon || 1)) * 960,
    y: ((maxLat - lat) / (maxLat - minLat || 1)) * 540,
  });
  let body = '<rect width="960" height="540" fill="#e8eef4"/>';
  body += '<text x="12" y="22" font-size="12" fill="#5a6a7a">PlanAI Field — vektör özet (uydu katmanı dışa aktarılamadı)</text>';
  feats.forEach(f => {
    const q = proj(f.lat, f.lon);
    body += '<circle cx="' + q.x.toFixed(1) + '" cy="' + q.y.toFixed(1) + '" r="7" fill="' + f.col + '" stroke="#fff" stroke-width="2"/>';
  });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540">' + body + '</svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

/** Offline-safe basemap for exported replay when satellite tiles unavailable. */
function buildReportBoundsFallbackDataUrl(bounds, events, lang) {
  const tr = lang === 'tr';
  const feats = [];
  (events || []).forEach(e => {
    if (!e) return;
    if (e.kind === 'track' && e.path) {
      e.path.forEach(p => {
        if (p?.lat != null && (p.lon != null || p.lng != null)) {
          feats.push({ lat: p.lat, lon: p.lon != null ? p.lon : p.lng, col: '#1565c0' });
        }
      });
    } else if (e.lat != null && (e.lon != null || e.lng != null)) {
      const col = (e.kind === 'photo' || e.kind === 'audio') ? '#e67e22' : '#1a73e8';
      feats.push({ lat: e.lat, lon: e.lon != null ? e.lon : e.lng, col });
    }
  });
  if (!feats.length && bounds?.minLat != null) {
    feats.push({ lat: (bounds.minLat + bounds.maxLat) / 2, lon: (bounds.minLon + bounds.maxLon) / 2, col: '#1a73e8' });
  }
  if (!feats.length) return '';
  let minLat = bounds?.minLat ?? 90;
  let maxLat = bounds?.maxLat ?? -90;
  let minLon = bounds?.minLon ?? 180;
  let maxLon = bounds?.maxLon ?? -180;
  if (minLat > maxLat) {
    feats.forEach(f => {
      minLat = Math.min(minLat, f.lat); maxLat = Math.max(maxLat, f.lat);
      minLon = Math.min(minLon, f.lon); maxLon = Math.max(maxLon, f.lon);
    });
  }
  const pad = 0.12;
  const dLat = (maxLat - minLat) * pad || 0.004;
  const dLon = (maxLon - minLon) * pad || 0.004;
  minLat -= dLat; maxLat += dLat; minLon -= dLon; maxLon += dLon;
  const proj = (lat, lon) => ({
    x: ((lon - minLon) / (maxLon - minLon || 1)) * 960,
    y: ((maxLat - lat) / (maxLat - minLat || 1)) * 540,
  });
  let body = '<rect width="960" height="540" fill="#1a2838"/>';
  body += '<text x="12" y="22" font-size="12" fill="#9ab0c8">' +
    (tr ? 'PlanAI Field — vektör özet (çevrimdışı)' : 'PlanAI Field — vector summary (offline)') + '</text>';
  feats.forEach(f => {
    const q = proj(f.lat, f.lon);
    body += '<circle cx="' + q.x.toFixed(1) + '" cy="' + q.y.toFixed(1) + '" r="6" fill="' + f.col + '" stroke="#fff" stroke-width="1.5"/>';
  });
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540">' + body + '</svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function reportArtifactBlobKey(rptId, kind) {
  return (FIELD_PROJECT.id || 'none') + ':report:' + rptId + ':' + kind;
}

async function persistProjectReportBundle(report, opts) {
  if (!FIELD_PROJECT.id || !report) return null;
  if (typeof FieldAccessGate !== 'undefined' && FieldAccessGate.hasPin() && !FieldAccessGate.isUnlocked()) {
    const unlocked = await FieldAccessGate.requireUnlock();
    if (!unlocked) {
      showHint(t('gate.unlockSub'), 6000);
      return null;
    }
  }
  const rptId = 'rpt_' + Date.now();
  const db = await openProjectDb();
  const meta = {
    id: rptId,
    templateId: report.meta?.templateId || REPORT_TEMPLATE_ID,
    generatedAt: report.meta?.generatedAt || new Date().toISOString(),
    kinds: [],
    pdfName: safeProjectExportFilename('.pdf'),
    htmlName: safeProjectExportFilename('.html'),
    interactiveName: safeProjectExportFilename('_interaktif.html'),
    hasMap: !!report.mapDataUrl,
  };
  if (report.html) {
    await idbPut(db, 'blobs', {
      key: reportArtifactBlobKey(rptId, 'html'),
      data: new Blob([report.html], { type: 'text/html;charset=utf-8' }),
    });
    meta.kinds.push('html');
  }
  if (opts?.interactiveHtml) {
    await idbPut(db, 'blobs', {
      key: reportArtifactBlobKey(rptId, 'interactive'),
      data: new Blob([opts.interactiveHtml], { type: 'text/html;charset=utf-8' }),
    });
    meta.kinds.push('interactive');
  }
  if (report.pdfBlob) {
    await idbPut(db, 'blobs', { key: reportArtifactBlobKey(rptId, 'pdf'), data: report.pdfBlob });
    meta.kinds.push('pdf');
  }
  if (report.mapPng) {
    await idbPut(db, 'blobs', { key: reportArtifactBlobKey(rptId, 'map'), data: report.mapPng });
  }
  _fieldProjectReports.unshift(meta);
  if (_fieldProjectReports.length > 10) _fieldProjectReports.length = 10;
  _projectDirty = true;
  const saved = await saveCurrentProject(true);
  if (!saved) {
    showHint(t('hub.saveFailed'), 7000);
    scheduleProjectSaveDebounced();
    return null;
  }
  _fieldReportsPanelOpen = true;
  renderFieldProjectReportsList();
  return { rptId, meta };
}

async function loadReportArtifactBlob(rptId, kind) {
  if (!FIELD_PROJECT.id || !rptId || !kind) return null;
  const db = await openProjectDb();
  const row = await idbGet(db, 'blobs', reportArtifactBlobKey(rptId, kind));
  return row?.data || null;
}

function reportMetaById(rptId) {
  return _fieldProjectReports.find(r => r.id === rptId) || null;
}

function reportFilenameForKind(meta, kind) {
  if (!meta) return 'report';
  if (kind === 'pdf') return meta.pdfName || safeProjectExportFilename('.pdf');
  if (kind === 'interactive') return meta.interactiveName || safeProjectExportFilename('_interaktif.html');
  return meta.htmlName || safeProjectExportFilename('.html');
}

let _fieldReportViewerUrl = null;
let _fieldReportViewerPending = null;
let _fieldReportsPanelOpen = false;

function toggleFieldProjectReportsPanel() {
  const toggle = () => {
  _fieldReportsPanelOpen = !_fieldReportsPanelOpen;
  const list = document.getElementById('field-project-reports-list');
  const btn = document.getElementById('field-rpt-toggle');
  if (list) list.classList.toggle('collapsed', !_fieldReportsPanelOpen);
  if (btn) btn.setAttribute('aria-expanded', _fieldReportsPanelOpen ? 'true' : 'false');
  };
  if (_fieldReportsPanelOpen) { toggle(); return; }
  if (typeof FieldAccessGate !== 'undefined') FieldAccessGate.requireAccess(toggle);
  else toggle();
}

function closeFieldReportViewer() {
  const restoreExportSheet = _fieldExportReturnToSheet;
  _fieldExportReturnToSheet = false;
  document.getElementById('field-report-viewer')?.classList.remove('open');
  document.getElementById('field-report-viewer-backdrop')?.classList.remove('open');
  document.body.classList.remove('field-report-viewer-open');
  const frame = document.getElementById('field-report-viewer-frame');
  const embed = document.getElementById('field-report-viewer-embed');
  const pdfPane = document.getElementById('field-report-viewer-pdf');
  if (frame) { frame.removeAttribute('src'); frame.style.display = ''; }
  if (embed) { embed.removeAttribute('src'); embed.style.display = 'none'; }
  if (pdfPane) { pdfPane.innerHTML = ''; pdfPane.classList.remove('open'); pdfPane.style.display = 'none'; }
  if (_fieldReportViewerUrl) {
    try { URL.revokeObjectURL(_fieldReportViewerUrl); } catch (_) {}
    _fieldReportViewerUrl = null;
  }
  _fieldReportViewerPending = null;
  if (restoreExportSheet && _fieldExportPending) showFieldExportSheet();
}

let _pdfJsModule = null;
async function ensurePdfJsLib() {
  if (_pdfJsModule) return _pdfJsModule;
  if (window.pdfjsLib) {
    _pdfJsModule = window.pdfjsLib;
    return _pdfJsModule;
  }
  const base = 'libs/pdfjs/';
  _pdfJsModule = await import(base + 'pdf.min.mjs');
  _pdfJsModule.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
  window.pdfjsLib = _pdfJsModule;
  return _pdfJsModule;
}

async function renderPdfInViewer(blob) {
  const pane = document.getElementById('field-report-viewer-pdf');
  if (!pane) return false;
  pane.style.display = 'block';
  pane.classList.add('open');
  pane.innerHTML = '<div class="frv-pdf-loading">' + (PA_LANG === 'tr' ? 'PDF yükleniyor…' : 'Loading PDF…') + '</div>';
  try {
    const pdfjs = await ensurePdfJsLib();
    const data = await blob.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data }).promise;
    pane.innerHTML = '';
    const scale = Math.min(2, Math.max(1, (pane.clientWidth || 800) / 595));
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      pane.appendChild(canvas);
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    }
    return true;
  } catch (e) {
    console.error('[PDF viewer]', e);
    pane.innerHTML = '<div class="frv-pdf-loading">' + (PA_LANG === 'tr' ? 'PDF görüntülenemedi' : 'Could not render PDF') + '</div>';
    return false;
  }
}

async function openFieldReportViewerBlob(blob, title, pendingShare, viewKind) {
  if (!blob) return;
  closeFieldReportViewer();
  _fieldReportViewerPending = pendingShare || null;
  const titleEl = document.getElementById('frv-title');
  if (titleEl) {
    const fallback = viewKind === 'interactive' ? t('report.playbackViewerTitle')
      : viewKind === 'pdf' ? t('report.pdf')
      : t('report.viewerTitle');
    titleEl.textContent = title || fallback;
  }
  const frame = document.getElementById('field-report-viewer-frame');
  const embed = document.getElementById('field-report-viewer-embed');
  const pdfPane = document.getElementById('field-report-viewer-pdf');
  const isPdf = viewKind === 'pdf' || (blob.type && blob.type.indexOf('pdf') >= 0);
  if (isPdf) {
    if (frame) { frame.removeAttribute('src'); frame.style.display = 'none'; }
    if (embed) { embed.removeAttribute('src'); embed.style.display = 'none'; }
    document.getElementById('field-report-viewer-backdrop')?.classList.add('open');
    document.getElementById('field-report-viewer')?.classList.add('open');
    document.body.classList.add('field-report-viewer-open');
    const ok = await renderPdfInViewer(blob);
    if (!ok) {
      const url = URL.createObjectURL(blob);
      _fieldReportViewerUrl = url;
      const opened = window.open(url, '_blank');
      if (!opened) showHint(PA_LANG === 'tr' ? 'PDF açılamadı — Paylaş ile gönderin' : 'Could not open PDF — use Share');
      closeFieldReportViewer();
    }
    return;
  }
  if (pdfPane) { pdfPane.innerHTML = ''; pdfPane.style.display = 'none'; pdfPane.classList.remove('open'); }
  const url = URL.createObjectURL(blob);
  _fieldReportViewerUrl = url;
  if (embed) { embed.removeAttribute('src'); embed.style.display = 'none'; }
  if (frame) { frame.style.display = 'block'; frame.src = url; }
  document.getElementById('field-report-viewer-backdrop')?.classList.add('open');
  document.getElementById('field-report-viewer')?.classList.add('open');
  document.body.classList.add('field-report-viewer-open');
}

async function shareFieldReportViewer() {
  const p = _fieldReportViewerPending;
  if (!p?.blob) return;
  await offerFieldExport({
    blob: p.blob,
    filename: p.filename,
    mimeType: p.mimeType,
    previewHtml: p.previewHtml || null,
    pdfBlob: p.kind === 'pdf' ? p.blob : null,
    kind: p.kind || 'file',
  });
}

async function openSavedProjectReport(rptId, kind) {
  const open = async () => {
  const meta = reportMetaById(rptId);
  const blob = await loadReportArtifactBlob(rptId, kind);
  if (!blob) {
    showHint(t('report.missing'));
    return;
  }
  const fname = reportFilenameForKind(meta, kind);
  if (kind === 'pdf') {
    await openFieldReportViewerBlob(blob, fname, {
      blob, filename: fname, mimeType: 'application/pdf', kind: 'pdf',
    }, 'pdf');
    return;
  }
  if (kind === 'interactive' || kind === 'html') {
    const html = await blob.text();
    const win = openReportPreview(html, null, FIELD_PROJECT.name, kind === 'interactive' ? 'interactive' : 'pdf');
    if (!win) {
      await openFieldReportViewerBlob(blob, fname, {
        blob, filename: fname, mimeType: 'text/html', previewHtml: html, kind: kind === 'interactive' ? 'interactive' : 'pdf',
      }, 'html');
    }
    return;
  }
  await openFieldReportViewerBlob(blob, fname, { blob, filename: fname, mimeType: blob.type || 'application/octet-stream', kind: 'file' });
  };
  if (typeof FieldAccessGate !== 'undefined') await FieldAccessGate.requireAccess(open);
  else await open();
}

async function shareSavedProjectReport(rptId, kind) {
  const meta = reportMetaById(rptId);
  const blob = await loadReportArtifactBlob(rptId, kind);
  if (!blob) {
    showHint(t('report.missing'));
    return;
  }
  const filename = reportFilenameForKind(meta, kind);
  let previewHtml = null;
  if (kind === 'interactive' || kind === 'html') {
    try { previewHtml = await blob.text(); } catch (_) {}
  }
  await offerFieldExport({
    blob,
    filename,
    mimeType: blob.type || (kind === 'pdf' ? 'application/pdf' : 'text/html'),
    previewHtml,
    pdfBlob: kind === 'pdf' ? blob : null,
    kind: kind === 'pdf' ? 'pdf' : (kind === 'interactive' ? 'interactive' : 'file'),
  });
}

async function deleteProjectReport(rptId) {
  if (!FIELD_PROJECT.id || !rptId) return;
  const db = await openProjectDb();
  const kinds = ['pdf', 'html', 'interactive', 'map'];
  for (const k of kinds) {
    try { await idbDelete(db, 'blobs', reportArtifactBlobKey(rptId, k)); } catch (_) {}
  }
  _fieldProjectReports = _fieldProjectReports.filter(r => r.id !== rptId);
  _projectDirty = true;
  await saveCurrentProject(true);
  renderFieldProjectReportsList();
  showHint(t('report.deleted'));
}

function buildFieldReportRow(rptId, kind, icon, label) {
  const row = document.createElement('div');
  row.className = 'field-rpt-row';
  const lbl = document.createElement('span');
  lbl.className = 'field-rpt-label';
  lbl.textContent = icon + ' ' + label;
  const btns = document.createElement('div');
  btns.className = 'field-rpt-btns';
  const viewBtn = document.createElement('button');
  viewBtn.type = 'button';
  viewBtn.className = 'field-rpt-btn';
  viewBtn.textContent = t('report.view');
  viewBtn.onclick = () => openSavedProjectReport(rptId, kind);
  const shareBtn = document.createElement('button');
  shareBtn.type = 'button';
  shareBtn.className = 'field-rpt-btn primary';
  shareBtn.textContent = t('report.share');
  shareBtn.onclick = () => shareSavedProjectReport(rptId, kind);
  btns.appendChild(viewBtn);
  btns.appendChild(shareBtn);
  row.appendChild(lbl);
  row.appendChild(btns);
  return row;
}

function renderFieldProjectReportsList() {
  const block = document.getElementById('field-project-reports-block');
  const list = document.getElementById('field-project-reports-list');
  const toggle = document.getElementById('field-rpt-toggle');
  const projName = document.getElementById('field-rpt-proj-name');
  const countEl = document.getElementById('field-rpt-count');
  if (!block || !list) return;
  if (!FIELD_PROJECT.id) {
    block.style.display = 'none';
    list.innerHTML = '';
    return;
  }
  block.style.display = '';
  if (projName) projName.textContent = projectDisplayName(FIELD_PROJECT.name || t('project.menu'));
  const n = _fieldProjectReports.length;
  if (countEl) countEl.textContent = n ? t('report.count').replace('{n}', String(n)) : '';
  if (toggle) toggle.setAttribute('aria-expanded', _fieldReportsPanelOpen ? 'true' : 'false');
  list.classList.toggle('collapsed', !_fieldReportsPanelOpen);
  if (!n) {
    list.innerHTML = '<div class="field-rpt-empty">' + escapeHtml(t('report.none')) + '</div>';
    return;
  }
  list.innerHTML = '';
  _fieldProjectReports.forEach(meta => {
    const card = document.createElement('div');
    card.className = 'field-rpt-card';
    const headRow = document.createElement('div');
    headRow.className = 'field-rpt-head-row';
    const head = document.createElement('div');
    head.className = 'field-rpt-head';
    head.textContent = formatReportDateTime(meta.generatedAt);
    headRow.appendChild(head);
    const delWrap = document.createElement('div');
    delWrap.className = 'ln-del-wrap field-rpt-del-wrap';
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'ln-del lyr-btn lyr-btn-del';
    delBtn.title = t('report.delete');
    delBtn.setAttribute('aria-label', t('report.delete'));
    delBtn.textContent = '🗑';
    delBtn.onclick = ev => {
      ev.stopPropagation();
      if (delWrap.classList.contains('ln-del-confirming')) return;
      showLayerListDeleteConfirm(card, delWrap, delBtn, () => deleteProjectReport(meta.id));
    };
    delWrap.appendChild(delBtn);
    headRow.appendChild(delWrap);
    card.appendChild(headRow);
    const kinds = meta.kinds || [];
    if (kinds.includes('pdf')) card.appendChild(buildFieldReportRow(meta.id, 'pdf', '📄', t('report.pdf')));
    if (kinds.includes('interactive')) card.appendChild(buildFieldReportRow(meta.id, 'interactive', '🎬', t('report.interactiveShort')));
    if (kinds.includes('html') && !kinds.includes('pdf')) {
      card.appendChild(buildFieldReportRow(meta.id, 'html', '📄', t('report.html')));
    }
    list.appendChild(card);
  });
}

window.openSavedProjectReport = openSavedProjectReport;
window.shareSavedProjectReport = shareSavedProjectReport;
window.closeFieldReportViewer = closeFieldReportViewer;
window.shareFieldReportViewer = shareFieldReportViewer;
window.toggleFieldProjectReportsPanel = toggleFieldProjectReportsPanel;
window.deleteProjectReport = deleteProjectReport;

async function collectReportPhotos() {
  const list = S.objects.filter(o => o.type === 'field_photo' && o.visible !== false);
  const out = [];
  const exportMaxPx = 680;
  for (const ph of list) {
    let blob = (await getPhotoBlobRecord(ph.photoId, 'thumb'))?.data;
    if (!blob) blob = (await getPhotoBlobRecord(ph.photoId, 'full'))?.data;
    if (blob) blob = await resizeImageBlob(blob, exportMaxPx);
    const dataUrl = blob ? await blobToDataUrl(blob) : '';
    const row = {
      id: ph.photoId || ph.id,
      photoNum: ph.photoNum,
      lat: ph.lat,
      lon: ph.lon,
      timestamp: ph.timestamp || ph.createdAt,
      accuracy: ph.gpsAccuracy ?? ph.accuracy ?? (_fieldGpsFix?.accuracy) ?? null,
      caption: ph.description || ph.caption || ph.title || '',
      imageDataUrl: dataUrl,
      hasVoice: !!ph.hasVoice,
      voiceDuration: ph.voiceDuration || 0,
      audioDataUrl: '',
    };
    if (ph.hasVoice) {
      try {
        const aud = await getPhotoAudioBlob([ph.photoId, ph.id]);
        if (aud?.data) row.audioDataUrl = await blobToDataUrl(aud.data);
      } catch (e) {
        console.warn('[Report audio]', ph.photoId || ph.id, e);
      }
    }
    out.push(row);
  }
  return out;
}

async function collectReportNotes() {
  const list = S.objects.filter(o => o.type === 'field_note' && o.visible !== false);
  ensureFieldNoteNumbers();
  return list.map(n => ({
    id: n.id,
    noteNum: n.noteNum,
    lat: n.lat,
    lon: n.lon,
    text: getNoteText(n),
    timestamp: n.timestamp || n.createdAt,
    handwritingDataUrl: (noteHasHandwriting(n) && n.handwritingData?.snapshot) ? n.handwritingData.snapshot : '',
  }));
}

async function generateProjectReport(onProgress) {
  const prog = (p, s) => { if (onProgress) onProgress(p, s); };
  prog(5, t('report.doc.progress.collect'));
  await saveCurrentProject(true);
  const snap = serializeProjectSnapshot();
  const generatedAt = new Date().toISOString();
  const measurements = computeMeasurementsFromObjects(S.objects);
  snap.measurements = measurements;

  prog(25, t('report.doc.progress.map'));
  const mapPng = await captureMapSnapshot(2);
  let mapDataUrl = mapPng ? await blobToDataUrl(mapPng) : '';
  if (!mapDataUrl) {
    mapDataUrl = buildReportMapFallbackDataUrl();
    if (mapDataUrl && location.protocol === 'file:') {
      console.info('[Report] file:// — using vector map fallback');
    }
  }

  prog(45, t('report.doc.progress.photos'));
  const photos = await collectReportPhotos();

  prog(60, t('report.doc.progress.notes'));
  const notes = await collectReportNotes();

  prog(68, PA_LANG === 'tr' ? 'Uydu altlığı hazırlanıyor…' : 'Satellite basemap…');
  const geoBounds = computeReportGeoBounds(photos, notes, snap, S.mapCenter);
  let interactiveBasemapUrl = '';
  try {
    interactiveBasemapUrl = await buildSatelliteBasemapDataUrl(geoBounds);
  } catch (e) {
    console.warn('[Report satellite]', e);
  }

  const objectCounts = {
    total: S.objects.length,
    photos: photos.length,
    notes: notes.length,
    sketch: S.objects.filter(o => !o._import && o.type !== 'field_photo' && o.type !== 'field_note').length,
    imports: S.objects.filter(o => o._import).length,
  };

  const reportMeta = {
    templateId: REPORT_TEMPLATE_ID,
    generatedAt,
    appVersion: PLANAI_FIELD_APP_VERSION,
    lang: PA_LANG,
    crs: 'WGS84 (EPSG:4326)',
    mapCenter: { ...S.mapCenter },
    gpsAccuracy: _fieldGpsFix?.accuracy ?? null,
    userName: getReportUserName(),
    objectCounts,
    measurements,
  };

  prog(68, PA_LANG === 'tr' ? 'Marka öğeleri…' : 'Brand assets…');
  const brandLogoUrl = await loadBrandLogoDataUrl();

  prog(75, t('report.doc.progress.page'));
  const html = buildReportHTML({
    project: snap,
    meta: reportMeta,
    mapDataUrl,
    photos,
    notes,
    measurements,
    brandLogoUrl,
  });

  prog(88, t('report.doc.progress.pdf'));
  let pdfBlob = null;
  try {
    pdfBlob = await exportProjectPDF(html);
  } catch (e) {
    console.warn('[Report PDF]', e);
  }

  prog(100, t('report.doc.progress.done'));
  return {
    html, pdfBlob, mapPng, mapDataUrl, interactiveBasemapUrl, geoBounds, brandLogoUrl,
    snap, project: snap, meta: reportMeta, photos, notes, measurements,
  };
}

function buildReportHTML(data) {
  const { project, meta, mapDataUrl, photos, notes, measurements } = data;
  const lang = resolveReportLang(data);
  const L = (key, vars) => tLang(lang, key, vars);
  const name = escapeHtml(project.name || L('report.doc.projectDefault'));
  const user = escapeHtml(meta.userName || '—');
  const gen = formatReportDateTime(meta.generatedAt, lang);
  const created = formatReportDateTime(project.createdAt, lang);
  const center = formatCoord(meta.mapCenter?.lat, meta.mapCenter?.lon);
  const totals = measurements.totals || {};
  const logoSrc = data.brandLogoUrl || FIELD_REPORT_LOGO_ASSET;
  const secureMark = typeof PlanAISecurity !== 'undefined' ? PlanAISecurity.reportWatermarkHtml()
    : (typeof DeviceSecurity !== 'undefined' ? DeviceSecurity.reportWatermarkHtml() : '');

  const measureRows = (measurements.items || []).map(it => {
    if (it.kind === 'polyline') {
      return `<tr><td>${escapeHtml(it.label)}</td><td>${L('report.doc.measure.kindLine')}</td><td>${formatLengthReport(it.lengthM)}</td><td>—</td><td>${formatLengthReport(it.perimeterM)}</td></tr>`;
    }
    return `<tr><td>${escapeHtml(it.label)}</td><td>${L('report.doc.measure.kindArea')}</td><td>—</td><td>${formatAreaReport(it.areaM2)}</td><td>${formatLengthReport(it.perimeterM)}</td></tr>`;
  }).join('');

  const photoBlocks = photos.map(ph => `
    <article class="rpt-card">
      <div class="rpt-photo-grid">
        ${ph.imageDataUrl ? `<img src="${ph.imageDataUrl}" alt="Foto ${ph.photoNum}"/>` : `<div class="rpt-noimg">${L('report.doc.photos.noImage')}</div>`}
        <dl>
          <dt>${L('report.doc.photos.photoNo')}</dt><dd>F${ph.photoNum || '—'}</dd>
          <dt>${L('report.doc.photos.coordinate')}</dt><dd>${formatCoord(ph.lat, ph.lon)}</dd>
          <dt>${L('report.doc.photos.dateTime')}</dt><dd>${formatReportDateTime(ph.timestamp, lang)}</dd>
          <dt>${L('report.doc.photos.gpsAccuracy')}</dt><dd>${ph.accuracy != null ? Math.round(ph.accuracy) + ' m' : '—'}</dd>
          <dt>${L('report.doc.photos.caption')}</dt><dd>${escapeHtml(ph.caption || '—')}</dd>
        </dl>
      </div>
    </article>`).join('');

  const noteBlocks = notes.map(n => `
    <article class="rpt-card">
      <h4>${L('report.doc.notes.label')} #${n.noteNum || '—'}</h4>
      <p class="rpt-meta">${formatCoord(n.lat, n.lon)} · ${formatReportDateTime(n.timestamp, lang)}</p>
      ${n.handwritingDataUrl ? `<img class="rpt-hand" src="${n.handwritingDataUrl}" alt="${L('report.doc.photos.handwritingAlt')}"/>` : ''}
      <p class="rpt-text">${escapeHtml(n.text || '—')}</p>
    </article>`).join('');

  const slopeSection = buildReportSlopeSection(project.slopeAnalysisReport, lang);

  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${name} — ${L('report.doc.titleSuffix')}</title>
<style>
@page{size:A4 portrait;margin:14mm;}
*{box-sizing:border-box;}
body{margin:0;font-family:Inter,system-ui,sans-serif;color:#1a2838;background:#fff;}
.planai-report-root{max-width:210mm;margin:0 auto;}
.rpt-page{padding:18mm 16mm;page-break-after:always;}
.rpt-page:last-child{page-break-after:auto;}
.rpt-cover{text-align:center;padding-top:28mm;}
.rpt-cover img{width:88px;height:88px;object-fit:contain;margin:0 auto 10px;display:block;}
.rpt-cover .brand-by{font-size:11px;letter-spacing:.22em;color:#8a96a6;margin:0 0 18px;text-transform:lowercase;font-weight:500;}
.rpt-cover h1{font-size:26px;color:#1a3358;margin:0 0 8px;letter-spacing:.04em;}
.rpt-cover .sub{font-size:14px;color:#5a6a7a;margin-bottom:24px;}
.rpt-cover table{margin:24px auto 0;border-collapse:collapse;font-size:13px;}
.rpt-cover td{padding:6px 14px;text-align:left;border-bottom:1px solid #e4e9ef;}
.rpt-cover td:first-child{font-weight:700;color:#1a3358;width:140px;}
h2{font-size:18px;color:#1a3358;border-bottom:2px solid #1a3358;padding-bottom:6px;margin:0 0 14px;}
h3{font-size:14px;color:#2c3e50;margin:18px 0 8px;}
.rpt-summary{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.rpt-stat{background:#f4f6f9;border:1px solid #dde3ea;border-radius:8px;padding:12px;}
.rpt-stat b{display:block;font-size:20px;color:#1a3358;}
.rpt-stat span{font-size:11px;color:#6a7a8a;}
.rpt-map{width:100%;border:1px solid #c5d0dc;border-radius:8px;display:block;max-height:240mm;object-fit:contain;background:#f0f3f7;}
table.rpt-table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px;}
table.rpt-table th,table.rpt-table td{border:1px solid #dde3ea;padding:8px;text-align:left;}
table.rpt-table th{background:#eef2f7;color:#1a3358;}
.rpt-card{border:1px solid #dde3ea;border-radius:8px;padding:12px;margin-bottom:12px;page-break-inside:avoid;}
.rpt-photo-grid{display:grid;grid-template-columns:140px 1fr;gap:12px;align-items:start;}
.rpt-photo-grid img{width:140px;height:105px;object-fit:cover;border-radius:6px;border:1px solid #ccc;}
.rpt-photo-grid dl{margin:0;font-size:12px;}
.rpt-photo-grid dt{font-weight:700;color:#1a3358;float:left;clear:left;width:110px;}
.rpt-photo-grid dd{margin:0 0 4px 112px;color:#333;}
.rpt-hand{max-width:100%;max-height:160px;border:1px solid #ccc;border-radius:6px;display:block;margin:8px 0;}
.rpt-meta{font-size:11px;color:#6a7a8a;}
.rpt-text{font-size:13px;line-height:1.5;white-space:pre-wrap;}
.rpt-tech{font-size:11px;color:#5a6a7a;line-height:1.6;}
.rpt-noimg{background:#eef2f7;height:105px;display:flex;align-items:center;justify-content:center;font-size:11px;color:#888;}
.rpt-slope-map{width:100%;max-height:120mm;object-fit:contain;border:1px solid #c5d0dc;border-radius:8px;margin:12px 0;background:#f0f3f7;}
.rpt-slope-legend-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px;}
.rpt-slope-leg{text-align:center;font-size:10px;font-weight:700;color:#2c3e50;}
.rpt-slope-leg i{display:block;width:100%;height:14px;border-radius:4px;margin-top:4px;border:1px solid rgba(0,0,0,.12);}
.rpt-brand-footer{margin-top:18px;padding-top:12px;border-top:1px solid #dde3ea;text-align:center;}
.rpt-brand-footer p{margin:4px 0;font-size:10px;color:#6a7a8a;line-height:1.5;}
.rpt-brand-primary{color:#5a6a7a;}
.rpt-brand-secondary{color:#6a7a8a;font-size:9px;letter-spacing:.03em;}
.rpt-brand-copy{color:#8a96a6;font-size:9px;}
</style></head><body><div class="planai-report-root">
${secureMark}

<section class="rpt-page rpt-cover">
  <img src="${logoSrc}" alt="PlanAI Field" onerror="this.style.display='none'"/>
  <p class="brand-by">by piristrategy</p>
  <h1>PLANAI FIELD</h1>
  <p class="sub">${L('report.doc.subtitle')}</p>
  <table>
    <tr><td>${L('report.doc.cover.project')}</td><td>${name}</td></tr>
    <tr><td>${L('report.doc.cover.date')}</td><td>${gen.split(' ')[0] || gen}</td></tr>
    <tr><td>${L('report.doc.cover.time')}</td><td>${gen.split(' ')[1] || '—'}</td></tr>
    <tr><td>${L('report.doc.cover.user')}</td><td>${user}</td></tr>
    <tr><td>${L('report.doc.cover.center')}</td><td>${center}</td></tr>
    <tr><td>${L('report.doc.cover.totalObjects')}</td><td>${meta.objectCounts?.total ?? 0}</td></tr>
  </table>
</section>

<section class="rpt-page">
  <h2>${L('report.doc.summary.title')}</h2>
  <div class="rpt-summary">
    <div class="rpt-stat"><b>${meta.objectCounts?.photos ?? 0}</b><span>${L('report.doc.summary.photos')}</span></div>
    <div class="rpt-stat"><b>${meta.objectCounts?.notes ?? 0}</b><span>${L('report.doc.summary.notes')}</span></div>
    <div class="rpt-stat"><b>${measurements.items?.length ?? 0}</b><span>${L('report.doc.summary.measured')}</span></div>
    <div class="rpt-stat"><b>${meta.objectCounts?.imports ?? 0}</b><span>${L('report.doc.summary.imports')}</span></div>
    <div class="rpt-stat"><b>${formatLengthReport(totals.totalPolylineM)}</b><span>${L('report.doc.summary.totalLine')}</span></div>
    <div class="rpt-stat"><b>${formatAreaReport(totals.totalPolygonAreaM2)}</b><span>${L('report.doc.summary.totalArea')}</span></div>
  </div>
  <h3>${L('report.doc.projectInfo')}</h3>
  <p class="rpt-tech">${L('report.doc.projectId')}: ${escapeHtml(project.id || '—')}<br/>${L('report.doc.created')}: ${created}<br/>${L('report.doc.updated')}: ${formatReportDateTime(project.updatedAt, lang)}</p>
</section>

<section class="rpt-page">
  <h2>${L('report.doc.map.title')}</h2>
  ${mapDataUrl ? `<img class="rpt-map" src="${mapDataUrl}" alt="${L('report.doc.map.title')}"/>` : `<p class="rpt-tech">${L('report.doc.map.unavailable')}</p>`}
  <p class="rpt-meta">${L('report.doc.map.basemap')}: ${escapeHtml(S.basemap || '—')} · CRS: WGS84</p>
</section>

<section class="rpt-page">
  <h2>${L('report.doc.measure.title')}</h2>
  <table class="rpt-table">
    <thead><tr><th>${L('report.doc.measure.element')}</th><th>${L('report.doc.measure.type')}</th><th>${L('report.doc.measure.length')}</th><th>${L('report.doc.measure.area')}</th><th>${L('report.doc.measure.perimeter')}</th></tr></thead>
    <tbody>${measureRows || `<tr><td colspan="5">${L('report.doc.measure.empty')}</td></tr>`}</tbody>
  </table>
</section>

${slopeSection}

<section class="rpt-page">
  <h2>${L('report.doc.photos.title')}</h2>
  ${photoBlocks || `<p class="rpt-tech">${L('report.doc.photos.empty')}</p>`}
</section>

<section class="rpt-page">
  <h2>${L('report.doc.notes.title')}</h2>
  ${noteBlocks || `<p class="rpt-tech">${L('report.doc.notes.empty')}</p>`}
</section>

<section class="rpt-page">
  <h2>${L('report.doc.tech.title')}</h2>
  <p class="rpt-tech">
    ${L('report.doc.tech.crs')}: ${escapeHtml(meta.crs)}<br/>
    ${L('report.doc.tech.app')}: PlanAI Field ${escapeHtml(meta.appVersion)}<br/>
    ${L('report.doc.tech.template')}: ${escapeHtml(meta.templateId)}<br/>
    ${L('report.doc.tech.gpsInstant')}: ${meta.gpsAccuracy != null ? Math.round(meta.gpsAccuracy) + ' m' : '—'}<br/>
    ${L('report.doc.tech.generated')}: ${gen}<br/>
    ${L('report.doc.projectId')}: ${escapeHtml(project.id || '—')}
  </p>
</section>

${typeof PlanAIBranding !== 'undefined' ? PlanAIBranding.reportFooterHtml() : '<footer class="rpt-brand-footer"><p>Generated with PlanAI Field by PiriStrategy</p><p>© Taner Piri / PiriStrategy. All rights reserved.</p></footer>'}

</div></body></html>`;
}

async function exportProjectPDF(htmlString) {
  if (typeof html2pdf === 'undefined') throw new Error('html2pdf yüklenemedi');
  if (typeof PlanAISecurity !== 'undefined') htmlString = PlanAISecurity.sanitizeExportHtml(htmlString);
  else if (typeof SpatialSecurity !== 'undefined') htmlString = SpatialSecurity.sanitizePdfHtml(htmlString);
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;left:-99999px;top:0;width:210mm;';
  wrap.innerHTML = htmlString;
  document.body.appendChild(wrap);
  const el = wrap.querySelector('.planai-report-root');
  if (!el) {
    document.body.removeChild(wrap);
    throw new Error('Rapor HTML bulunamadı');
  }
  try {
    const blob = await html2pdf().set({
      margin: [12, 12, 12, 12],
      filename: 'report.pdf',
      image: { type: 'jpeg', quality: 0.9 },
      html2canvas: { scale: 2, useCORS: true, logging: false, letterRendering: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'], avoid: '.rpt-card' },
    }).from(el).outputPdf('blob');
    return blob;
  } finally {
    document.body.removeChild(wrap);
  }
}

function openReportPreview(html, pdfBlob, projectName, kind) {
  const safe = (projectName || 'saha_raporu').replace(/[^\w.\-]+/g, '_');
  const htmlName = safe + '_interaktif.html';
  const w = window.open('', 'planai_report_preview');
  if (!w) {
    showHint(PA_LANG === 'tr' ? 'Önizleme açılamadı — dosya indiriliyor' : 'Preview blocked — downloading');
    if (kind === 'interactive' || !pdfBlob) downloadReportPreviewHtml(html, htmlName);
    else if (pdfBlob) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(pdfBlob);
      a.download = safe + '.pdf';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    return null;
  }
  w.__planaiPreview = { html, htmlName, projectName: projectName || 'PlanAI Field', kind };
  try {
    w.shareReportPreviewHtml = shareReportPreviewHtml;
    w.downloadReportPreviewHtml = downloadReportPreviewHtml;
    w.triggerReportHtmlShareOrDownload = triggerReportHtmlShareOrDownload;
  } catch (_) {}
  w.document.open();
  if (pdfBlob && kind === 'pdf') {
    const pdfUrl = URL.createObjectURL(pdfBlob);
    w.__planaiPreview.pdfUrl = pdfUrl;
    const title = (projectName || 'PlanAI Field').replace(/</g, '');
    w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>'
      + '<title>' + title + '</title>'
      + '<style>html,body{margin:0;height:100%;background:#525659}#pdf-frame{width:100%;height:100%;border:0}'
      + '.planai-close{position:fixed;top:max(12px,env(safe-area-inset-top));right:max(12px,env(safe-area-inset-right));z-index:9;'
      + 'min-width:48px;min-height:48px;border-radius:50%;border:2px solid rgba(255,255,255,.45);background:rgba(0,0,0,.55);color:#fff;font-size:20px;font-weight:700;cursor:pointer}</style></head><body>'
      + '<embed id="pdf-frame" type="application/pdf" src="' + pdfUrl + '"/>'
      + '<button type="button" class="planai-close" onclick="window.close()" aria-label="Close">✕</button></body></html>');
  } else {
    w.document.write(html);
  }
  w.document.close();
  if (pdfBlob && kind === 'pdf') return w;
  setTimeout(() => {
    try {
      const doc = w.document;
      const closeBtn = doc.createElement('button');
      closeBtn.type = 'button';
      closeBtn.textContent = '✕';
      closeBtn.setAttribute('aria-label', PA_LANG === 'tr' ? 'Kapat' : 'Close');
      closeBtn.style.cssText = 'position:fixed;top:max(12px,env(safe-area-inset-top));right:max(12px,env(safe-area-inset-right));z-index:2147483647;min-width:48px;min-height:48px;border-radius:50%;border:2px solid rgba(255,255,255,.45);background:rgba(0,0,0,.55);color:#fff;font-size:20px;font-weight:700;line-height:1;cursor:pointer;touch-action:manipulation;';
      closeBtn.onclick = () => { try { w.close(); } catch (_) {} };
      doc.body.appendChild(closeBtn);
    } catch (_) {}
  }, 300);
  return w;
}

async function createProjectReport() {
  if (!FIELD_PROJECT.id) {
    showHint('Önce gezi oluşturun veya açın');
    openProjectPanel();
    return;
  }
  if (deviceSecurityBlocksExport()) {
    showHint(typeof PlanAISecurity !== 'undefined' ? PlanAISecurity.exportBlockedMessage()
      : (typeof DeviceSecurity !== 'undefined' ? DeviceSecurity.exportBlockedMessage() : 'Güvenlik modu: dışa aktarma kısıtlı'));
    return;
  }
  closeProjectPanel();
  setReportProgress(0, 'Başlatılıyor…');
  try {
    const report = await generateProjectReport((p, s) => setReportProgress(p, s));
    await persistProjectReportBundle(report, {});
    showHint(t('report.savedToProject'));
    renderFieldProjectReportsList();
    if (report.pdfBlob) {
      await offerFieldExport({
        blob: report.pdfBlob,
        filename: safeProjectExportFilename('.pdf'),
        mimeType: 'application/pdf',
        previewHtml: report.html,
        pdfBlob: report.pdfBlob,
        kind: 'pdf',
      });
    } else {
      await offerFieldExport({
        blob: new Blob([report.html], { type: 'text/html;charset=utf-8' }),
        filename: safeProjectExportFilename('.html'),
        mimeType: 'text/html',
        previewHtml: report.html,
        kind: 'pdf',
      });
    }
  } catch (e) {
    console.error('[Report]', e);
    showHint((PA_LANG === 'tr' ? 'Rapor hatası: ' : 'Report error: ') + (e.message || e));
  } finally {
    hideReportProgress();
  }
}

function extractGpsTrackFeat(project, data, tr) {
  const label = tr ? 'GPS Rota' : 'GPS Route';
  const normPath = (verts) => (verts || []).map(v => ({
    lat: v.lat,
    lon: v.lon != null ? v.lon : v.lng,
    ts: v.ts || v.timestamp || '',
  })).filter(v => Number.isFinite(v.lat) && Number.isFinite(v.lon));
  let track = null;
  (project?.objects || []).forEach(o => {
    if (track || o?.type !== 'field_gps_track' || !o.vertices || o.vertices.length < 2) return;
    track = {
      id: o.id || 'track_1',
      kind: 'track',
      label: o.label || label,
      path: normPath(o.vertices),
    };
  });
  if (!track && Array.isArray(data?.track) && data.track.length >= 2 && data.track[0]?.lat != null) {
    track = { id: 'track_1', kind: 'track', label, path: normPath(data.track) };
  }
  if (!track && Array.isArray(data?.feats)) {
    const feat = data.feats.find(f => f?.kind === 'track' && f.path?.length >= 2);
    if (feat) {
      track = {
        id: feat.id || 'track_1',
        kind: 'track',
        label: feat.label || label,
        path: normPath(feat.path),
      };
    }
  }
  return track;
}

function buildReplayPayloadFromReport(data) {
  const project = data.project || data.snap;
  const { meta, photos, notes } = data;
  const lang = resolveReportLang(data);
  const tr = lang === 'tr';
  const basemapUrl = data.interactiveBasemapUrl || data.mapDataUrl || '';
  const bounds = data.geoBounds || computeReportGeoBounds(photos, notes, project, meta?.mapCenter);
  const track = extractGpsTrackFeat(project, data, tr);
  const timeline = [];

  const noteSeverity = (text) => {
    const t = String(text || '');
    if (/kritik|acil|hasar|çök|collapse/i.test(t)) return 'critical';
    if (/rutubet|drenaj|sorun|temizle|warning|moisture|drain/i.test(t)) return 'warning';
    return 'info';
  };

  notes.forEach(n => {
    timeline.push({
      id: n.id || ('n_' + n.noteNum),
      kind: 'note',
      label: (tr ? 'Not #' : 'Note #') + (n.noteNum || ''),
      text: n.text || '',
      ts: n.timestamp,
      lat: n.lat,
      lon: n.lon,
      severity: noteSeverity(n.text),
    });
  });
  photos.forEach(p => {
    const ev = {
      id: p.id || ('p_' + p.photoNum),
      kind: p.hasVoice ? 'audio' : 'photo',
      label: 'F' + (p.photoNum || ''),
      text: p.caption || '',
      ts: p.timestamp,
      lat: p.lat,
      lon: p.lon,
      imageDataUrl: p.imageDataUrl || '',
      audioDataUrl: p.audioDataUrl || '',
      hasVoice: !!p.hasVoice,
      voiceDuration: p.voiceDuration || 0,
    };
    timeline.push(ev);
  });
  timeline.sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));

  const first = timeline[0] || track?.path?.[0];
  const last = timeline[timeline.length - 1] || track?.path?.[track.path.length - 1];
  const events = [];
  if (track) events.push(track);
  if (first?.ts || first?.lat != null) {
    events.push({
      id: 'evt_start',
      kind: 'start',
      label: tr ? 'Yolculuk Başladı' : 'Journey Started',
      text: tr ? 'Saha incelemesi başlangıcı' : 'Field inspection journey start',
      ts: first.ts,
      lat: first.lat,
      lon: first.lon,
    });
  }
  events.push(...timeline);
  if (last?.ts || last?.lat != null) {
    events.push({
      id: 'evt_end',
      kind: 'end',
      label: tr ? 'Yolculuk Tamamlandı' : 'Journey Completed',
      text: tr ? 'Yolculuk sonu' : 'Journey end',
      ts: last.ts,
      lat: last.lat,
      lon: last.lon,
    });
  }

  let routeKm = 0;
  if (track?.path?.length >= 2) {
    for (let i = 1; i < track.path.length; i++) {
      routeKm += haversineM(track.path[i - 1].lat, track.path[i - 1].lon, track.path[i].lat, track.path[i].lon);
    }
    routeKm /= 1000;
  }
  if (routeKm < 0.05) routeKm = 0.2;

  const t0 = Date.parse(first?.ts || '') || 0;
  const t1 = Date.parse(last?.ts || '') || 0;
  let durationMin = t1 > t0 ? (t1 - t0) / 60000 : Math.max(12, timeline.length * 4);
  if (!Number.isFinite(durationMin) || durationMin < 1) durationMin = Math.max(12, timeline.length * 4);

  const audioCount = photos.filter(p => p.hasVoice).length;
  const insights = [];
  const warnNotes = notes.filter(n => noteSeverity(n.text) !== 'info');
  if (warnNotes.length) {
    insights.push(tr
      ? warnNotes.length + ' kritik saha gözlemi tespit edildi.'
      : warnNotes.length + ' critical field observations identified.');
  }
  if (photos.length >= 2) {
    insights.push(tr
      ? 'Yolculuk boyunca inceleme aktivitesi yoğunlaştı.'
      : 'Inspection activity concentrated along the journey corridor.');
  }
  insights.push(tr
    ? 'Yolculuk süresi: ' + Math.round(durationMin) + ' dakika.'
    : 'Journey duration: ' + Math.round(durationMin) + ' minutes.');

  return {
    lang,
    projectName: project?.name || (tr ? 'Saha Gezisi' : 'Field Journey'),
    generatedAt: meta?.generatedAt || new Date().toISOString(),
    inspectorName: meta?.userName || '',
    basemapUrl,
    brandLogoUrl: data.brandLogoUrl || embeddedBrandLogoDataUrl() || '',
    bounds,
    geoBounds: bounds,
    track,
    project: project ? { id: project.id, name: project.name, objects: project.objects || [] } : null,
    events,
    stats: {
      routeKm,
      durationMin,
      photoCount: photos.length,
      noteCount: notes.length,
      audioCount,
      startTime: first?.ts,
      endTime: last?.ts,
      gpsQuality: meta?.gpsAccuracy != null
        ? (meta.gpsAccuracy <= 6 ? (tr ? 'Yüksek hassasiyet' : 'High precision') : (tr ? 'Orta hassasiyet' : 'Medium precision'))
        : (tr ? '—' : '—'),
      avgSpeedKmh: durationMin > 0 ? (routeKm / (durationMin / 60)) : 0,
    },
    insights,
  };
}

async function buildCinematicInteractiveReportHTML(data, opts) {
  if (typeof FieldCinematicReport === 'undefined') {
    return null;
  }
  try {
    if (!data.brandLogoUrl) data.brandLogoUrl = await loadBrandLogoDataUrl();
    if (!data.brandLogoUrl) data.brandLogoUrl = embeddedBrandLogoDataUrl();
    if (Array.isArray(data.photos)) {
      data.photos = await enrichPhotosWithAudio(data.photos);
      const voiceMissing = data.photos.find(p => p.hasVoice && !p.audioDataUrl);
      if (voiceMissing && data.meta?.simulation) {
        voiceMissing.audioDataUrl = await synthesizeDemoVoiceDataUrl(voiceMissing.voiceDuration || 12);
      }
    }
    const payload = buildReplayPayloadFromReport(data);
    if (!payload.brandLogoUrl) payload.brandLogoUrl = data.brandLogoUrl || embeddedBrandLogoDataUrl() || '';
    if (!payload.basemapUrl) {
      payload.basemapUrl = data.interactiveBasemapUrl || data.mapDataUrl || '';
    }
    if (!payload.basemapUrl || !/^data:image\//i.test(payload.basemapUrl)) {
      payload.basemapUrl = buildReportBoundsFallbackDataUrl(
        payload.bounds || payload.geoBounds,
        payload.events,
        payload.lang,
      ) || '';
    }
    const prepared = typeof FieldCinematicReport.prepareReplayPayload === 'function'
      ? FieldCinematicReport.prepareReplayPayload(payload)
      : payload;
    if (prepared.track && !(prepared.events || []).some(e => e?.kind === 'track' && e.path?.length >= 2)) {
      prepared.events = [prepared.track, ...(prepared.events || [])];
    }
    return FieldCinematicReport.buildReplayHtml(prepared);
  } catch (e) {
    console.warn('[CinematicReport]', e);
    return null;
  }
}

function reportBasemapImgSrc(url) {
  if (!url || typeof url !== 'string') return '';
  if (typeof ExportSafety !== 'undefined') {
    const safe = ExportSafety.sanitizeExportImageUrl(url);
    if (safe) return safe.replace(/"/g, '');
  }
  if (/^data:image\/(jpeg|jpg|png|webp|gif|svg\+xml)/i.test(url)) return url.replace(/"/g, '');
  if (/^https:\/\//i.test(url)) return url.replace(/"/g, '');
  return '';
}

async function buildInteractiveFieldReportHTML(data) {
  if (!data.brandLogoUrl) data.brandLogoUrl = await loadBrandLogoDataUrl();
  if (!data.geoBounds) {
    const project = data.project || data.snap;
    data.geoBounds = computeReportGeoBounds(data.photos, data.notes, project, data.meta?.mapCenter);
  }
  const cinematic = await buildCinematicInteractiveReportHTML(data);
  if (cinematic) return cinematic;
  return buildInteractiveFieldReportHTMLLegacy(data);
}

function buildInteractiveFieldReportHTMLLegacy(data) {
  const project = data.project || data.snap;
  const { meta, photos, notes, measurements } = data;
  const lang = resolveReportLang(data);
  const tr = lang === 'tr';
  const basemapUrl = data.interactiveBasemapUrl || data.mapDataUrl || '';
  if (!project) throw new Error(tr ? 'Gezi verisi bulunamadı' : 'Journey data not found');
  const name = escapeHtml(project.name || (tr ? 'Saha Gezisi' : 'Field Journey'));
  const feats = [];
  notes.forEach(n => feats.push({ kind: 'note', id: n.id, label: (tr ? 'Not #' : 'Note #') + (n.noteNum || ''), lat: n.lat, lon: n.lon, text: n.text, ts: n.timestamp }));
  photos.forEach(p => feats.push({
    kind: 'photo', id: p.id, label: 'F' + (p.photoNum || ''), lat: p.lat, lon: p.lon,
    text: p.caption, hasVoice: !!p.hasVoice, voiceDuration: p.voiceDuration || 0, ts: p.timestamp,
  }));
  (project.objects || []).forEach(o => {
    if (o.type === 'field_gps_track' && o.vertices?.length >= 2) {
      feats.push({ kind: 'track', id: o.id, label: tr ? 'GPS Rota' : 'GPS Route', path: o.vertices, ts: o.vertices[0]?.ts });
    }
  });
  feats.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  const bump = (lat, lon) => {
    if (lat == null || lon == null) return;
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
  };
  feats.forEach(f => {
    if (f.path) f.path.forEach(p => bump(p.lat, p.lon));
    else bump(f.lat, f.lon);
  });
  if (minLat > maxLat) { minLat = meta.mapCenter?.lat - 0.01; maxLat = meta.mapCenter?.lat + 0.01; }
  if (minLon > maxLon) { minLon = meta.mapCenter?.lon - 0.01; maxLon = meta.mapCenter?.lon + 0.01; }
  const pad = 0.15;
  const dLat = (maxLat - minLat) * pad || 0.005, dLon = (maxLon - minLon) * pad || 0.005;
  minLat -= dLat; maxLat += dLat; minLon -= dLon; maxLon += dLon;
  const proj = (lat, lon) => {
    const x = ((lon - minLon) / (maxLon - minLon)) * 1000;
    const y = ((maxLat - lat) / (maxLat - minLat)) * 700;
    return { x, y };
  };
  let svgMarks = '';
  feats.forEach((f, i) => {
    if (f.kind === 'track' && f.path) {
      const pts = f.path.map(p => { const q = proj(p.lat, p.lon); return q.x + ',' + q.y; }).join(' ');
      svgMarks += '<polyline data-idx="' + i + '" points="' + pts + '" fill="none" stroke="#ffffff" stroke-width="5" opacity=".95" stroke-linecap="round" stroke-linejoin="round"/>';
      svgMarks += '<polyline data-idx="' + i + '" points="' + pts + '" fill="none" stroke="#1565c0" stroke-width="3" opacity=".85" stroke-linecap="round" stroke-linejoin="round"/>';
    } else {
      const q = proj(f.lat, f.lon);
      const col = f.kind === 'photo' ? '#e67e22' : f.kind === 'note' ? '#1a73e8' : '#8e44ad';
      const voice = f.hasVoice ? '<text x="' + q.x + '" y="' + (q.y - 16) + '" text-anchor="middle" font-size="14">🎤</text>' : '';
      svgMarks += voice + '<circle data-idx="' + i + '" cx="' + q.x + '" cy="' + q.y + '" r="12" fill="' + col + '" stroke="#fff" stroke-width="3" style="cursor:pointer"/>';
    }
  });
  const listItems = feats.map((f, i) => {
    const replay = f.kind === 'track'
      ? '<span class="ir-replay" data-replay="' + i + '" title="Rota oynat">▶</span>' : '';
    const voice = f.hasVoice ? ' <span class="ir-voice">🎤</span>' : '';
    const when = f.ts ? '<small class="ir-time">' + escapeHtml(formatReportDateTime(f.ts)) + '</small>' : '';
    return '<button type="button" class="ir-item" data-idx="' + i + '">' + replay + escapeHtml(f.label) + voice + when +
      (f.text ? '<small>' + escapeHtml(String(f.text).slice(0, 80)) + '</small>' : '') + '</button>';
  }).join('');
  const photoCards = photos.map(ph => {
    const imgUrl = typeof ExportSafety !== 'undefined'
      ? ExportSafety.sanitizeExportImageUrl(ph.imageDataUrl)
      : (ph.imageDataUrl && /^data:image\//i.test(ph.imageDataUrl) ? ph.imageDataUrl : '');
    return '<article class="ir-card" id="ph-' + escapeHtml(ph.id) + '">' +
    (imgUrl ? '<img src="' + imgUrl + '" alt=""/>' : '') +
    '<p><b>F' + escapeHtml(String(ph.photoNum || '')) + '</b> · ' + formatCoord(ph.lat, ph.lon) + '</p></article>';
  }).join('');
  const es = typeof ExportSafety !== 'undefined' ? ExportSafety : null;
  const featsJson = es ? es.jsonScriptBlock('planai-feats', feats) : '';
  const boundsJson = es ? es.jsonScriptBlock('planai-bounds', { minLat, maxLat, minLon, maxLon }) : '';
  const irScript = [
    es ? es.readJsonScriptBootstrap('FEATS', 'planai-feats') : 'const FEATS=' + JSON.stringify(feats) + ';',
    es ? es.readJsonScriptBootstrap('BOUNDS', 'planai-bounds') : 'const BOUNDS={minLat:' + minLat + ',maxLat:' + maxLat + ',minLon:' + minLon + ',maxLon:' + maxLon + '};',
    'const DET=document.getElementById("ir-detail");',
    'const SVG=document.querySelector("svg");',
    'let replayRaf=null;',
    'function proj(lat,lon){',
    '  const x=((lon-BOUNDS.minLon)/(BOUNDS.maxLon-BOUNDS.minLon))*1000;',
    '  const y=((BOUNDS.maxLat-lat)/(BOUNDS.maxLat-BOUNDS.minLat))*700;',
    '  return{x,y};',
    '}',
    'function focusIdx(i){',
    '  document.querySelectorAll(".ir-item").forEach(b=>b.classList.toggle("active",+b.dataset.idx===i));',
    '  document.querySelectorAll("svg [data-idx]").forEach(el=>el.classList.remove("ir-highlight"));',
    '  const f=FEATS[i]; if(!f) return;',
    '  DET.textContent=f.label+(f.text?" — "+f.text:"");',
    '  document.querySelectorAll(\'svg [data-idx="\'+i+\'"]\').forEach(el=>el.classList.add("ir-highlight"));',
    '}',
    'function pathTs(ts){if(!ts)return 0;const n=Date.parse(ts);return Number.isFinite(n)?n:0;}',
    'function stopReplay(){',
    '  if(replayRaf)cancelAnimationFrame(replayRaf);',
    '  replayRaf=null;',
    '  const dot=document.getElementById("ir-replay-dot");',
    '  if(dot)dot.style.display="none";',
    '  document.querySelectorAll(".ir-replay-active").forEach(el=>el.classList.remove("ir-replay-active"));',
    '  document.querySelectorAll(".ir-replay-near").forEach(el=>el.classList.remove("ir-replay-near"));',
    '}',
    'function lerpAlongPath(path,t){',
    '  const pts=path.map(p=>proj(p.lat,p.lon));',
    '  if(pts.length<2)return pts[0]||{x:500,y:350};',
    '  let total=0,segs=[];',
    '  for(let i=1;i<pts.length;i++){const d=Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y);segs.push(d);total+=d;}',
    '  if(total<1)return pts[0];',
    '  const target=total*t; let acc=0;',
    '  for(let i=0;i<segs.length;i++){',
    '    if(acc+segs[i]>=target){',
    '      const u=(target-acc)/segs[i];',
    '      return{x:pts[i].x+u*(pts[i+1].x-pts[i].x),y:pts[i].y+u*(pts[i+1].y-pts[i].y)};',
    '    }',
    '    acc+=segs[i];',
    '  }',
    '  return pts[pts.length-1];',
    '}',
    'function syncReplayObs(pos){',
    '  FEATS.forEach((f,j)=>{',
    '    if(f.kind==="track"||f.lat==null)return;',
    '    const q=proj(f.lat,f.lon);',
    '    const near=Math.hypot(q.x-pos.x,q.y-pos.y)<40;',
    '    document.querySelector(\'.ir-item[data-idx="\'+j+\'"]\')?.classList.toggle("ir-replay-near",near);',
    '  });',
    '}',
    'function startReplay(i){',
    '  stopReplay();',
    '  const f=FEATS[i];',
    '  if(!f||!f.path||f.path.length<2)return;',
    '  focusIdx(i);',
    '  document.querySelectorAll(\'svg [data-idx="\'+i+\'"]\').forEach(el=>el.classList.add("ir-replay-active"));',
    '  let dot=document.getElementById("ir-replay-dot");',
    '  if(!dot){',
    '    dot=document.createElementNS("http://www.w3.org/2000/svg","circle");',
    '    dot.id="ir-replay-dot";dot.setAttribute("r","11");dot.setAttribute("fill","#27ae60");',
    '    dot.setAttribute("stroke","#fff");dot.setAttribute("stroke-width","3");',
    '    SVG.appendChild(dot);',
    '  }',
    '  dot.style.display="block";',
    '  const t0=pathTs(f.path[0].ts),t1=pathTs(f.path[f.path.length-1].ts);',
    '  const dur=Math.max(4500,Math.min(90000,t1>t0?t1-t0:f.path.length*700));',
    '  const tStart=performance.now();',
    '  function step(now){',
    '    const u=Math.min(1,(now-tStart)/dur);',
    '    const p=lerpAlongPath(f.path,u);',
    '    dot.setAttribute("cx",p.x);dot.setAttribute("cy",p.y);',
    '    syncReplayObs(p);',
    '    DET.textContent=f.label+" — "+Math.round(u*100)+"%";',
    '    if(u<1)replayRaf=requestAnimationFrame(step);',
    '    else replayRaf=null;',
    '  }',
    '  replayRaf=requestAnimationFrame(step);',
    '}',
    'document.querySelectorAll(".ir-item").forEach(b=>b.onclick=()=>{stopReplay();focusIdx(+b.dataset.idx);});',
    'document.querySelectorAll("svg [data-idx]").forEach(el=>el.onclick=()=>{stopReplay();focusIdx(+el.dataset.idx);});',
    'document.querySelectorAll(".ir-replay").forEach(b=>b.onclick=e=>{e.stopPropagation();startReplay(+b.dataset.replay);});',
    'const trackIdx=FEATS.findIndex(f=>f.kind==="track");',
    'if(trackIdx>=0){setTimeout(()=>startReplay(trackIdx),1400);}',
  ].join('\n');
  const scrOpen = '<scr' + 'ipt>';
  const scrClose = '</scr' + 'ipt>';
  const cspTag = es ? es.cspMetaTag() : '';
  const safeBasemap = reportBasemapImgSrc(basemapUrl);
  return `<!DOCTYPE html><html lang="${lang}"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
${cspTag}
<title>${name} — PlanAI Field</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:Inter,system-ui,sans-serif;background:#f0f3f7;color:#1a2838}
.ir-head{padding:14px 16px;background:#fff;border-bottom:2px solid #dde3ea;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.ir-head h1{margin:0;font-size:18px;flex:1}
.ir-layout{display:grid;grid-template-columns:1fr;min-height:calc(100vh - 56px)}
@media(min-width:900px){.ir-layout{grid-template-columns:320px 1fr}}
.ir-side{background:#fff;border-right:1px solid #dde3ea;overflow-y:auto;max-height:calc(100vh - 56px)}
.ir-map{background:#1a2838;position:relative;min-height:360px}
.ir-map svg{width:100%;height:auto;display:block;position:relative;z-index:1;background:transparent}
.ir-map img.rpt-map{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:1;pointer-events:none;z-index:0}
.ir-item{display:block;width:100%;text-align:left;padding:12px 14px;border:none;border-bottom:1px solid #eef2f6;background:#fff;cursor:pointer}
.ir-item:hover,.ir-item.active{background:#e8f0fe}
.ir-item small{display:block;color:#6a7a8a;margin-top:4px;font-size:11px}
.ir-detail{padding:14px;font-size:13px;line-height:1.5}
.ir-card{border:1px solid #dde3ea;border-radius:8px;padding:10px;margin:10px;background:#fff}
.ir-card img{max-width:100%;border-radius:6px}
.ir-highlight{stroke:#ffcc00!important;stroke-width:6!important}
.ir-replay{float:right;color:#1565c0;font-size:15px;padding:2px 6px;cursor:pointer}
.ir-replay:hover{color:#0d47a1}
.ir-replay-active{stroke:#27ae60!important;stroke-width:6!important;opacity:1!important}
.ir-replay-near{background:#fff8e1!important;border-left:3px solid #f9a825}
.ir-voice{color:#6a1b9a;font-size:12px}
.ir-time{display:block;color:#7a8a9a;font-size:10px;margin-top:2px}
.ir-journey{padding:10px 14px;background:linear-gradient(135deg,#e8f0fe,#f3e8fd);border-bottom:1px solid #dde3ea;font-size:12px;line-height:1.5}
.ir-journey b{color:#1a3358}
.ir-map{transition:opacity .35s ease}
.ir-map.ir-map-focus{opacity:1}
#ir-replay-dot{filter:drop-shadow(0 2px 5px rgba(0,0,0,.35))}
</style></head><body>
<header class="ir-head"><h1>${name}</h1><span>${formatReportDateTime(meta.generatedAt)}</span></header>
<div class="ir-journey"><b>${tr ? 'Saha yolculuğu' : 'Field journey'}</b> — ${feats.filter(f=>f.kind==='track').length ? (tr ? 'Rota otomatik oynatılır' : 'Route auto-plays') : ''} · ${photos.length} ${tr ? 'foto' : 'photos'} · ${notes.length} ${tr ? 'not' : 'notes'}</div>
<div class="ir-layout">
<aside class="ir-side">
<div class="ir-detail" id="ir-detail">${tr ? 'Öğeye tıklayın — haritada odaklanır' : 'Click an item to focus on map'}</div>
<div>${listItems || '<p class="ir-detail">—</p>'}</div>
${photoCards ? '<div style="padding:8px">' + photoCards + '</div>' : ''}
</aside>
<main class="ir-map">
${safeBasemap ? '<img class="rpt-map" src="' + safeBasemap + '" alt="map"/>' : ''}
<svg viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid meet">${svgMarks}</svg>
</main></div>
${featsJson}${boundsJson}
${scrOpen}
${irScript}
${scrClose}</body></html>`;
}

async function createInteractiveFieldReport() {
  if (!FIELD_PROJECT.id) { showHint(PA_LANG === 'tr' ? 'Önce gezi açın' : 'Open a journey first'); openProjectPanel(); return; }
  if (typeof FieldAccessGate !== 'undefined' && FieldAccessGate.hasPin() && !FieldAccessGate.isUnlocked()) {
    const unlocked = await FieldAccessGate.requireUnlock();
    if (!unlocked) {
      showHint(t('gate.unlockSub'), 6000);
      return;
    }
  }
  closeProjectPanel();
  setReportProgress(0, 'Başlatılıyor…');
  try {
    const report = await generateProjectReport((p, s) => setReportProgress(p, s));
    if (!report.pdfBlob && report.html) {
      setReportProgress(90, t('report.doc.progress.pdf'));
      try { report.pdfBlob = await exportProjectPDF(report.html); } catch (e) { console.warn('[Journey PDF]', e); }
    }
    setReportProgress(95, PA_LANG === 'tr' ? 'Mekansal tekrar hazırlanıyor…' : 'Preparing spatial playback…');
    const interactiveHtml = await buildInteractiveFieldReportHTML(report);
    await persistProjectReportBundle(report, { interactiveHtml });
    showHint(report.pdfBlob ? t('report.journeyBundleReady') : t('report.savedToProject'));
    await offerFieldExport({
      blob: new Blob([interactiveHtml], { type: 'text/html;charset=utf-8' }),
      filename: safeProjectExportFilename('_interaktif.html'),
      mimeType: 'text/html',
      previewHtml: interactiveHtml,
      kind: 'interactive',
    });
  } catch (e) {
    console.error('[InteractiveReport]', e);
    showHint('Rapor: ' + (e.message || e));
  } finally {
    hideReportProgress();
  }
}

async function createSimulatedFieldReports() {
  if (!FIELD_PROJECT.id) {
    showHint(PA_LANG === 'tr' ? 'Önce gezi açın veya oluşturun' : 'Open or create a journey first');
    openProjectPanel();
    return;
  }
  if (typeof FieldAccessGate !== 'undefined' && FieldAccessGate.hasPin() && !FieldAccessGate.isUnlocked()) {
    const unlocked = await FieldAccessGate.requireUnlock();
    if (!unlocked) {
      showHint(t('gate.unlockSub'), 6000);
      return;
    }
  }
  if (typeof FieldReportSimulation === 'undefined') {
    showHint(PA_LANG === 'tr' ? 'Demo modülü yüklenemedi' : 'Demo module failed to load');
    return;
  }
  closeProjectPanel();
  setReportProgress(0, t('report.demoRunning'));
  try {
    const report = await FieldReportSimulation.generate({
      projectName: FIELD_PROJECT.name,
      projectId: FIELD_PROJECT.id,
      projectCreatedAt: FIELD_PROJECT.createdAt,
      mapCenter: { ...S.mapCenter },
      userName: getReportUserName(),
      appVersion: PLANAI_FIELD_APP_VERSION,
      templateId: REPORT_TEMPLATE_ID,
      lang: PA_LANG,
      onProgress: (p, s) => setReportProgress(p, s),
      buildReportHTML,
      buildInteractiveFieldReportHTML,
      exportProjectPDF,
      computeReportGeoBounds,
      buildSatelliteBasemapDataUrl,
      loadBrandLogoDataUrl,
      synthesizeDemoVoiceDataUrl,
    });
    const saved = await persistProjectReportBundle(report, { interactiveHtml: report.interactiveHtml });
    showHint(report.pdfBlob ? t('report.journeyBundleReady') : t('report.demoReady'));
    if (saved?.rptId) {
      setTimeout(() => { openSavedProjectReport(saved.rptId, 'interactive'); }, 400);
    }
  } catch (e) {
    console.error('[DemoReport]', e);
    showHint('Demo: ' + (e.message || e));
  } finally {
    hideReportProgress();
  }
}
window.createSimulatedFieldReports = createSimulatedFieldReports;

async function addReportBundleToZip(zip) {
  const report = await generateProjectReport((p, s) => setReportProgress(p, s));
  zip.file('report/report.html', report.html);
  zip.file('report/interactive.html', await buildInteractiveFieldReportHTML(report));
  if (report.mapPng) zip.file('report/mapshot.png', report.mapPng);
  if (report.pdfBlob) zip.file('report/report.pdf', report.pdfBlob);
  zip.file('layers/measurements.json', JSON.stringify(report.measurements, null, 2));
  const slopeRpt = report.snap?.slopeAnalysisReport;
  if (slopeRpt) {
    zip.file('report/slope-analysis.json', JSON.stringify(slopeRpt, null, 2));
    if (slopeRpt.overlayDataUrl) {
      const m = slopeRpt.overlayDataUrl.match(/^data:image\/png;base64,(.+)$/);
      if (m) zip.file('report/slope-overlay.png', m[1], { base64: true });
    }
  }
  zip.folder('exports');
  zip.file('project.json', JSON.stringify(report.snap, null, 2));
  return report;
}

// ═══ GPS field workflow ═══════════════════════════════════════
function gpsSecureContextOk() {
  if (window.isSecureContext) return true;
  const h = location.hostname;
  if (location.protocol === 'https:') return true;
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return true;
  if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return true;
  return false;
}

async function queryGpsPermissionState() {
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const r = await navigator.permissions.query({ name: 'geolocation' });
      gpsDbgLog('PERMISSION', 'query', r.state);
      return r.state;
    }
  } catch (e) {
    gpsDbgLog('PERMISSION', 'query failed', e && e.message);
  }
  return 'unknown';
}

function confirmGpsDenied(msg) {
  stopGpsWatch(true);
  setGpsStatus('denied');
  showHint(msg || t('gps.hint.deniedHelp'), 9000);
  if (typeof FieldPermissions !== 'undefined') {
    setTimeout(() => showHint(t('perm.openFromGps'), 6000), 1200);
  }
}

function setGpsStatus(status) {
  _gpsStatus = status;
  updateGpsHud();
}

function gpsErrorMessage(err) {
  const code = err && err.code;
  if (code === 1) {
    setGpsStatus('denied');
    return t('gps.err.denied');
  }
  if (code === 2) {
    setGpsStatus('weak');
    return t('gps.err.weak');
  }
  if (code === 3) {
    if (_fieldGpsOn && _gpsStatus !== 'denied') setGpsStatus('searching');
    return t('gps.err.timeout');
  }
  setGpsStatus('unavailable');
  return t('gps.err.unknown', { msg: (err && err.message) ? err.message : (PA_LANG === 'tr' ? 'bilinmiyor' : 'unknown') });
}

async function onGpsError(err, fromWatch) {
  gpsDbgLog('GPS', 'error', fromWatch ? 'watch' : 'once', err && err.code, err && err.message);
  const code = err && err.code;
  if (code === 1) {
    _gpsDenyStreak++;
    const perm = await queryGpsPermissionState();
    if (perm === 'granted' || (_gpsDenyStreak < 5 && perm !== 'denied')) {
      setGpsStatus('searching');
      scheduleGpsFallbackFix();
      if (!fromWatch && _gpsDenyStreak === 1) {
        showHint(t('gps.hint.acquire'), 4000);
      }
      return;
    }
    if (fromWatch && _gpsDenyStreak < 4) {
      setGpsStatus('searching');
      scheduleGpsFallbackFix();
      return;
    }
    confirmGpsDenied(gpsErrorMessage(err));
    return;
  }
  const msg = gpsErrorMessage(err);
  if (fromWatch && _fieldGpsOn && code === 3) {
    scheduleGpsFallbackFix();
    return;
  }
  if (_fieldGpsOn && code !== 1) showHint(msg, 5000);
}

function onGpsWatchError(err) {
  onGpsError(err, true);
}

function scheduleGpsFallbackFix() {
  clearTimeout(_gpsRetryTimer);
  _gpsRetryTimer = setTimeout(() => {
    if (!_fieldGpsOn || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(onGpsPosition, onGpsError, {
      enableHighAccuracy: true, maximumAge: 8000, timeout: 22000,
    });
    navigator.geolocation.getCurrentPosition(onGpsPosition, () => {}, {
      enableHighAccuracy: false, maximumAge: 15000, timeout: 12000,
    });
  }, 1200);
}

function clearGpsTimers() {
  clearTimeout(_gpsFirstFixTimer);
  clearTimeout(_gpsRetryTimer);
  clearTimeout(_gpsAgpsPollTimer);
  _gpsFirstFixTimer = null;
  _gpsRetryTimer = null;
  _gpsAgpsPollTimer = null;
}

function updateGpsHud() {
  const hud = document.getElementById('gps-hud');
  const pill = document.getElementById('gps-status-pill');
  const dot = document.getElementById('gps-status-dot');
  const line1 = document.getElementById('gps-hud-chip-line1');
  const line2 = document.getElementById('gps-hud-chip-line2');
  const primaryBtn = document.getElementById('btn-gps-primary');
  const showHud = _fieldGpsOn && _gpsStatus !== 'denied' && _gpsStatus !== 'unavailable' && !isGpsDebugMode();
  if (hud) {
    hud.style.display = showHud ? 'flex' : 'none';
    hud.classList.remove('gps-status-off', 'gps-status-searching', 'gps-status-connected',
      'gps-status-weak', 'gps-status-denied', 'gps-status-unavailable');
    hud.classList.add('gps-status-' + (_gpsStatus || 'off'));
    if (showHud && !_gpsHudExpanded) {
      hud.classList.add('gps-hud-collapsed');
      hud.classList.remove('gps-hud-expanded');
    }
  }
  document.getElementById('btn-field-gps')?.classList.toggle('active', _fieldGpsOn);
  document.getElementById('btn-field-gps-tb')?.classList.toggle('active', _fieldGpsOn);
  const label = gpsStatusLabel(_gpsStatus);
  const lines = showHud ? gpsHudCompactLines() : { line1: t('gps.pill') + ' · ' + label, line2: '' };
  if (line1) line1.textContent = lines.line1;
  if (line2) line2.textContent = lines.line2 || '';
  if (pill) {
    pill.className = 'gps-status-pill ' + _gpsStatus;
    const accShort = _fieldGpsFix && (_gpsStatus === 'connected' || _gpsStatus === 'weak')
      ? ' · ' + Math.round(_fieldGpsFix.accuracy || 0) + ' m' : '';
    pill.textContent = t('gps.pill') + ' · ' + label + accShort;
  }
  if (dot) dot.className = 'gps-dot ' + _gpsStatus;
  const disp = getGpsDisplayFix() || _fieldGpsFix;
  const acc = disp?.accuracy ?? _fieldGpsFix?.accuracy;
  const spd = disp ? gpsHudSmoothSpeed(gpsDerivedSpeed(disp)) : null;
  const hdg = disp ? resolveDisplayHeadingTarget(disp, spd || 0) : null;
  const moveEl = document.getElementById('gps-hud-move');
  const confEl = document.getElementById('gps-hud-conf');
  if (moveEl) moveEl.textContent = gpsMoveLabel(_gpsMoveState);
  if (confEl) confEl.textContent = gpsConfidenceLabel(acc, _gpsStatus);
  const setVal = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  setVal('gps-hud-lat', disp ? disp.lat.toFixed(5) + '°' : '—');
  setVal('gps-hud-lon', disp ? disp.lon.toFixed(5) + '°' : '—');
  setVal('gps-hud-speed', spd != null ? formatGpsHudSpeed(spd) : '—');
  setVal('gps-hud-heading', hdg != null ? gpsHudHeadingArrow(hdg) : '—');
  const alt = _fieldGpsFix?.altitude;
  setVal('gps-hud-alt', alt != null && !isNaN(alt) ? Math.round(alt) + ' m' : '—');
  setVal('gps-hud-acc', acc != null ? Math.round(acc) + ' m' : (_fieldGpsOn ? '…' : '—'));
  if (primaryBtn) {
    const routeActive = _gpsTrack.state === 'recording' || _gpsTrack.state === 'paused';
    primaryBtn.textContent = routeActive ? t('track.stopHud') : t('gps.stop');
    primaryBtn.title = routeActive ? t('track.stopHudHint') : t('gps.stop');
    primaryBtn.classList.add('stop');
  }
  document.getElementById('btn-gps-follow')?.classList.toggle('active', _gpsFollow);
  const liveLocateOn = _fieldGpsOn && (fieldLiveLocationLocked() ? _gpsFollow : (_gpsFollow || !!_fieldGpsFix));
  document.getElementById('btn-map-locate')?.classList.toggle('active', liveLocateOn);
  updateGpsTrackHud();
  updateGpsTestPanel();
}

function onGpsPosition(pos) {
  clearTimeout(_gpsFirstFixTimer);
  _gpsDenyStreak = 0;
  _gpsLastWatchTick = Date.now();
  _gpsPositionTick++;
  const hwAge = pos.timestamp ? Date.now() - pos.timestamp : 0;
  if (hwAge > GPS_STALE_FIX_MS) {
    gpsDbgLog('POSITION', 'stale fix skipped', Math.round(hwAge) + 'ms');
    gpsScheduleAgpsRefresh(true);
    return;
  }
  const rawFix = {
    lat: pos.coords.latitude,
    lon: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    altitude: pos.coords.altitude,
    heading: pos.coords.heading,
    speed: pos.coords.speed,
    ts: Date.now(),
  };
  if (!gpsAcceptLiveFix(rawFix)) {
    gpsScheduleAgpsRefresh(true);
    if (!_fieldGpsFix) setGpsStatus('searching');
    return;
  }
  _fieldGpsFix = gpsFuseLiveFix(rawFix);
  gpsDbgLog('POSITION', _fieldGpsFix.lat.toFixed(6), _fieldGpsFix.lon.toFixed(6),
    '±' + Math.round(_fieldGpsFix.accuracy || 0) + 'm', 'tick', _gpsPositionTick);
  const acc = _fieldGpsFix.accuracy || 999;
  setGpsStatus(gpsClassifyFixAccuracy(acc));
  if (acc > 65 && !_gpsAgpsHintShown) {
    _gpsAgpsHintShown = true;
    showHint(t('gps.hint.agpsWeak'), 5500);
  }
  if (!_fieldGpsDisplay) {
    _fieldGpsDisplay = { lat: _fieldGpsFix.lat, lon: _fieldGpsFix.lon,
      accuracy: gpsSmoothDisplayAccuracy(acc),
      heading: _fieldGpsFix.heading, speed: _fieldGpsFix.speed, ts: _fieldGpsFix.ts, moveState: GPS_MOVE.WALKING };
    _gpsStationaryAnchor = { lat: _fieldGpsFix.lat, lon: _fieldGpsFix.lon };
    if (fieldLiveLocationLocked()) {
      ensureFieldLiveLocationFollow();
      setMapCenter(_fieldGpsFix.lat, _fieldGpsFix.lon);
    }
  }
  updateGpsMovementState(_fieldGpsFix);
  if (fieldLiveLocationLocked()) ensureFieldLiveLocationFollow();
  ensureGpsMotionLoop();
  updateGpsHud();
  gpsTrackOnPosition(pos);
  gpsScheduleAgpsRefresh(acc > GPS_AGPS_WEAK_THRESHOLD_M);
}

function startGpsWatch() {
  clearGpsTimers();
  if (!navigator.geolocation) {
    setGpsStatus('unavailable');
    showHint(t('gps.err.noApi'));
    return false;
  }
  if (!gpsSecureContextOk()) {
    setGpsStatus('unavailable');
    showHint(t('gps.err.needHttps'), 9000);
    gpsDbgLog('GPS', 'blocked: insecure context', location.href);
    return false;
  }
  stopGpsWatch(false);
  _fieldGpsOn = true;
  setGpsStatus('searching');
  document.getElementById('btn-field-gps')?.classList.add('active');
  _gpsDenyStreak = 0;
  _gpsPositionTick = 0;
  gpsClearFixFusion();
  const optsHi = { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 };
  const optsLo = { enableHighAccuracy: false, maximumAge: 8000, timeout: 20000 };
  const optsAgps = { enableHighAccuracy: true, maximumAge: 0, timeout: 35000 };
  gpsDbgLog('GPS', 'watchPosition start', optsHi);
  _gpsWatchId = navigator.geolocation.watchPosition(onGpsPosition, onGpsWatchError, optsHi);
  startGpsWatchdog();
  refreshGpsTestPermission();
  navigator.geolocation.getCurrentPosition(onGpsPosition, e => onGpsError(e, false), optsAgps);
  scheduleGpsFallbackFix();
  gpsScheduleAgpsRefresh(true);
  _gpsFirstFixTimer = setTimeout(() => {
    if (_fieldGpsOn && !_fieldGpsFix) {
      setGpsStatus('searching');
      navigator.geolocation.getCurrentPosition(onGpsPosition, e => onGpsError(e, false), optsLo);
      showHint(t('gps.hint.waiting'), 5000);
    }
  }, 14000);
  updateGpsHud();
  ensureGpsMotionLoop();
  if (S.basemap === 'none') { S.basemap = 'satellite'; document.getElementById('btn-osm')?.classList.add('active'); }
  return true;
}

function stopGpsWatch(clearUi) {
  clearGpsTimers();
  stopGpsWatchdog();
  stopGpsMotionLoop();
  unbindGpsCompassListener();
  resetGpsMovementEngine();
  if (_gpsWatchId != null) {
    navigator.geolocation.clearWatch(_gpsWatchId);
    _gpsWatchId = null;
    gpsDbgLog('GPS', 'watchPosition cleared');
  }
  if (clearUi !== false) {
    _fieldGpsOn = false;
    _gpsFollow = false;
    _fieldGpsFix = null;
    _fieldGpsDisplay = null;
    resetGpsHudSmoothing();
    setGpsStatus('off');
    document.getElementById('btn-field-gps')?.classList.remove('active');
    document.getElementById('btn-field-gps-tb')?.classList.remove('active');
    updateGpsHud();
    scheduleRender();
  }
}

/** Keep live GPS + route recording active until the user explicitly stops. */
function ensureFieldGpsSessionActive(silent) {
  if (!FIELD_MODE || !FIELD_PROJECT.id) return false;
  let started = false;
  if (!_fieldGpsOn) {
    if (!startGpsWatch()) return false;
    startGpsCompassIfAllowed();
    _gpsFollow = true;
    collapseGpsFieldHud();
    resetGpsHudInactivityTimer();
    started = true;
  }
  if (_gpsTrack.state === 'idle') {
    if (beginGpsTrackRecording()) started = true;
  } else if (_gpsTrack.state === 'paused') {
    resumeGpsTrackRecording();
    started = true;
  }
  ensureGpsMotionLoop();
  updateGpsHud();
  scheduleRender();
  if (started && !silent) showHint(t('gps.hint.on'), 2800);
  return true;
}

/** After hub / project open: request location permission, then keep GPS + follow on. */
async function activateFieldLocationSession(silent) {
  if (!FIELD_MODE || !FIELD_PROJECT.id) return false;
  if (typeof FieldPermissions !== 'undefined') {
    const ok = await FieldPermissions.request('location', {
      hintDenied: silent ? undefined : t('gps.err.denied'),
    });
    if (!ok && FieldPermissions.isNative()) return false;
  }
  const started = ensureFieldGpsSessionActive(!!silent);
  if (started || _fieldGpsOn) {
    ensureFieldLiveLocationFollow();
    const g = getGpsDisplayFix();
    if (g) setMapCenter(g.lat, g.lon);
    updateGpsHud();
  }
  return started || _fieldGpsOn;
}

function scheduleEnsureFieldGpsSessionActive(silent) {
  if (!FIELD_MODE) return;
  setTimeout(() => { void activateFieldLocationSession(silent !== false); }, 120);
}

function startFieldGpsSession() {
  requireProject(() => {
    void (async () => {
      if (_fieldGpsOn && _gpsTrack.state === 'recording') return;
      if (typeof FieldPermissions !== 'undefined') {
        const ok = await FieldPermissions.request('location', { hintDenied: t('gps.err.denied') });
        if (!ok && FieldPermissions.isNative()) return;
      }
      ensureFieldGpsSessionActive(false);
      const g = getGpsDisplayFix();
      if (g) setMapCenter(g.lat, g.lon);
    })();
  });
}

function stopFieldGpsSession() {
  if (_gpsTrack.state !== 'idle') stopGpsTrackRecording();
  stopGpsWatch(true);
  collapseGpsFieldHud();
  showHint(t('gps.hint.off'));
}

function toggleFieldGps() {
  if (_fieldGpsOn) { stopFieldGpsSession(); return; }
  startFieldGpsSession();
}

function toggleFieldGpsPrimary(ev) {
  ev?.stopPropagation?.();
  touchGpsHudActivity();
  if (_fieldGpsOn) {
    if (_gpsTrack.state === 'recording' || _gpsTrack.state === 'paused') {
      stopGpsTrackRecording(true);
      return;
    }
    stopFieldGpsSession();
    return;
  }
  startFieldGpsSession();
}

function stopGpsTracking() {
  stopFieldGpsSession();
}

function toggleGpsFollow() {
  touchGpsHudActivity();
  if (!_fieldGpsOn) {
    startFieldGpsSession();
    return;
  }
  if (fieldLiveLocationLocked()) {
    ensureFieldLiveLocationFollow();
    const g = getGpsDisplayFix();
    if (g) setMapCenter(g.lat, g.lon);
    updateGpsHud();
    showHint(t('gps.followOn'));
    return;
  }
  _gpsFollow = !_gpsFollow;
  if (_gpsFollow) {
    const g = getGpsDisplayFix();
    if (g) setMapCenter(g.lat, g.lon);
  }
  updateGpsHud();
  showHint(_gpsFollow ? t('gps.followOn') : t('gps.followOff'));
}

function centerMapToGps() {
  touchGpsHudActivity();
  const g = getGpsDisplayFix();
  if (!g) {
    if (_fieldGpsOn) showHint(t('gps.hint.noFix'));
    else showHint(t('gps.hint.openFirst'));
    return;
  }
  setMapCenter(g.lat, g.lon);
  scheduleRender();
  showHint(t('gps.hint.centered'));
}

function mapControlLocate() {
  const btn = document.getElementById('btn-map-locate');
  if (!_fieldGpsOn) {
    startFieldGpsSession();
    btn?.classList.add('active');
    showHint(t('gps.hint.liveOn'));
    return;
  }
  if (fieldLiveLocationLocked()) {
    ensureFieldLiveLocationFollow();
    const g = getGpsDisplayFix();
    if (g) {
      _gpsLastPanTs = 0;
      setMapCenter(g.lat, g.lon);
      scheduleRender();
      showHint(t('gps.hint.liveOn'));
    } else {
      showHint(t('gps.hint.pending'));
    }
    updateGpsHud();
    return;
  }
  if (_fieldGpsFix) {
    _gpsFollow = !_gpsFollow;
    updateGpsHud();
    btn?.classList.toggle('active', _gpsFollow);
    if (_gpsFollow) {
      _gpsLastPanTs = 0;
      setMapCenter(_fieldGpsFix.lat, _fieldGpsFix.lon);
      showHint(t('gps.followOn'));
    } else {
      centerMapToGps();
    }
    scheduleRender();
    return;
  }
  showHint(t('gps.hint.pending'));
}

function mapZoomStep(factor) {
  const r = canvas.getBoundingClientRect();
  const mx = r.width / 2;
  const my = r.height / 2;
  const wx = (mx - S.tx) / S.scale;
  const wy = (my - S.ty) / S.scale;
  S.scale = Math.max(0.05, Math.min(120, S.scale * factor));
  S.tx = mx - wx * S.scale;
  S.ty = my - wy * S.scale;
  _basemapZoomState = { z: -1, ideal: -1 };
  scheduleRender();
}

function worldToClient(wx, wy) {
  const r = canvas.getBoundingClientRect();
  return { x: r.left + S.tx + wx * S.scale, y: r.top + S.ty + wy * S.scale };
}

function accuracyWorldRadius(lat, accuracyM) {
  if (!accuracyM || accuracyM <= 0) return 8 / S.scale;
  const lon2 = S.mapCenter.lon + (accuracyM / (111320 * Math.cos(lat * Math.PI / 180)));
  const w0 = latLonToWorld(lat, S.mapCenter.lon);
  const w1 = latLonToWorld(lat, lon2);
  return Math.max(4 / S.scale, Math.hypot(w1.x - w0.x, w1.y - w0.y));
}

function resumeGpsAfterInterruption() {
  if (!_fieldGpsOn) return;
  const stale = Date.now() - (_gpsLastWatchTick || 0);
  if (_gpsWatchId == null || stale > 8000) {
    if (_gpsWatchId != null) {
      navigator.geolocation.clearWatch(_gpsWatchId);
      _gpsWatchId = null;
    }
    restartGpsWatchOnly();
    if (!_gpsWatchdogTimer) startGpsWatchdog();
  } else if (!_gpsWatchdogTimer) {
    startGpsWatchdog();
  }
  ensureGpsMotionLoop();
  startGpsCompassIfAllowed();
  if (_gpsTrack.state === 'recording') _gpsTrackResumeAcceptStale = true;
  scheduleRender();
  gpsDbgLog('GPS', 'resumed after interruption', 'stale=' + stale + 'ms', 'track=' + _gpsTrack.state);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    flushProjectSave();
    return;
  }
  resumeGpsAfterInterruption();
});

window.addEventListener('pageshow', () => {
  if (_fieldGpsOn) resumeGpsAfterInterruption();
});

window.addEventListener('pagehide', () => { flushProjectSave(); });

// ═══ Spatial field notes ══════════════════════════════════════
function getNoteText(n) {
  return (n.textNote ?? n.text ?? '').trim();
}

function normalizeFieldNoteObject(n) {
  if (!n || n.type !== 'field_note') return n;
  if (!n.timestamp) n.timestamp = n.createdAt || new Date().toISOString();
  if (!n.createdAt) n.createdAt = n.timestamp;
  if (n.textNote == null && n.text != null) n.textNote = n.text;
  if (n.text == null) n.text = n.textNote || '';
  if (!Array.isArray(n.photoRefs)) n.photoRefs = [];
  if (!Array.isArray(n.voiceRefs)) n.voiceRefs = [];
  if (n.handwritingData && !n.handwritingData.strokes && n.handwritingData.snapshot) {
    n.handwritingData = { strokes: [], snapshot: n.handwritingData.snapshot, w: n.handwritingData.w, h: n.handwritingData.h };
  }
  return n;
}

function ensureFieldNoteNumbers() {
  const notes = S.objects.filter(o => o.type === 'field_note');
  let max = 0;
  const used = new Set();
  notes.forEach(n => {
    if (n.noteNum > 0) { max = Math.max(max, n.noteNum); used.add(n.noteNum); }
  });
  let next = max + 1;
  notes.forEach(n => {
    if (!n.noteNum || n.noteNum < 1) {
      while (used.has(next)) next++;
      n.noteNum = next;
      used.add(next);
      next++;
    }
  });
}

function getFieldNotesSorted() {
  return S.objects.filter(o => o.type === 'field_note')
    .map(o => normalizeFieldNoteObject(o))
    .sort((a, b) => (a.noteNum || 0) - (b.noteNum || 0));
}

function getNextNoteNumber() {
  let max = 0;
  S.objects.forEach(o => {
    if (o.type !== 'field_note') return;
    if (o.noteNum) max = Math.max(max, o.noteNum);
  });
  return max + 1;
}

function makeFieldNote(lat, lon, textNote, handwritingData) {
  const ts = new Date().toISOString();
  const text = typeof SpatialSecurity !== 'undefined'
    ? SpatialSecurity.sanitizeFieldNoteText(textNote)
    : (textNote || '').trim();
  return normalizeFieldNoteObject({
    id: uid(), type: 'field_note', lat, lon,
    noteNum: getNextNoteNumber(),
    timestamp: ts, createdAt: ts,
    textNote: text, text: text || 'Not',
    handwritingData: handwritingData || null,
    photoRefs: [], voiceRefs: [],
    layerId: 'notes', visible: true, locked: false, color: '#ffca28',
  });
}

function drawEarthPushpin(ctx, x, y, scale, selected, noteNum) {
  const s = 1 / scale;
  const headR = 11 * s;
  const headCy = y - 22 * s;
  const headColor = selected ? '#E53935' : '#FFCA28';
  const headDark = selected ? '#B71C1C' : '#F9A825';
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,.45)';
  ctx.lineWidth = 1.2 * s;
  ctx.fillStyle = '#9E9E9E';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - 3 * s, headCy + headR * 0.35);
  ctx.lineTo(x + 3 * s, headCy + headR * 0.35);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  const grad = ctx.createRadialGradient(x - 3 * s, headCy - 3 * s, 2 * s, x, headCy, headR);
  grad.addColorStop(0, selected ? '#EF5350' : '#FFE082');
  grad.addColorStop(0.55, headColor);
  grad.addColorStop(1, headDark);
  ctx.fillStyle = grad;
  ctx.strokeStyle = 'rgba(0,0,0,.35)';
  ctx.lineWidth = 1.5 * s;
  ctx.beginPath();
  ctx.arc(x, headCy, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (noteNum != null) {
    ctx.fillStyle = selected ? '#fff' : '#3E2723';
    ctx.font = `bold ${Math.max(10, 11 * s)}px Inter,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(noteNum), x, headCy + 0.5 * s);
  }
  ctx.restore();
}

function getNotePinScreenAnchor(note) {
  return getFieldMarkerScreenAnchor(note);
}

function getFieldMarkerScreenAnchor(obj) {
  const w = latLonToWorld(obj.lat, obj.lon);
  const headLift = (obj.type === 'field_note' ? 32 : 20) / S.scale;
  const tip = worldToClient(w.x, w.y);
  const head = worldToClient(w.x, w.y - headLift);
  return { tipX: tip.x, tipY: tip.y, headX: head.x, headY: head.y };
}

function getObservationCluster(lat, lon, radiusM) {
  const r = radiusM || OBSERVATION_CLUSTER_M;
  const photos = getFieldPhotosSorted().filter(p =>
    p.lat != null && p.lon != null && haversineM(lat, lon, p.lat, p.lon) <= r
  );
  const notes = getFieldNotesSorted().filter(n =>
    n.lat != null && n.lon != null && haversineM(lat, lon, n.lat, n.lon) <= r
  );
  return { photos, notes };
}

function revokeObservationPopupImages() {
  document.querySelectorAll('#fnp-body .fnp-photo-img').forEach(img => {
    if (img._blobUrl) {
      URL.revokeObjectURL(img._blobUrl);
      img._blobUrl = null;
    }
  });
  document.querySelectorAll('#fnp-body .fnp-photo-audio').forEach(aud => {
    if (aud._blobUrl) {
      URL.revokeObjectURL(aud._blobUrl);
      aud._blobUrl = null;
    }
    aud.removeAttribute('src');
    aud.pause?.();
  });
}

function fieldPhotoNoteText(photo) {
  const desc = String(photo?.description || '').trim();
  if (desc) return desc;
  const cap = String(photo?.caption || '').trim();
  const title = String(photo?.title || '').trim();
  if (cap && cap !== title) return cap;
  return '';
}

async function loadPhotoIntoObservationPopup(photo) {
  const img = document.querySelector('#fnp-body .fnp-photo-img[data-photo-id="' + photo.id + '"]');
  if (!img) return;
  const row = await getPhotoBlobRecord(photo.photoId, 'thumb');
  const blob = row?.data || (await getPhotoBlobRecord(photo.photoId, 'full'))?.data;
  if (!blob) {
    img.alt = 'Fotoğraf yüklenemedi';
    return;
  }
  if (img._blobUrl) URL.revokeObjectURL(img._blobUrl);
  img._blobUrl = URL.createObjectURL(blob);
  img.src = img._blobUrl;
  img.title = 'Büyütmek için tıklayın';
  img.onclick = e => { e.stopPropagation(); openFieldPhotoEarthViewer(photo.id); };
}

async function loadPhotoVoiceIntoObservationPopup(photo) {
  const aud = document.querySelector('#fnp-body .fnp-photo-audio[data-photo-id="' + photo.id + '"]');
  if (!aud || !photo.hasVoice) return;
  const row = await getPhotoAudioBlob([photo.photoId, photo.id]);
  const src = await resolvePhotoAudioPlaySrc(row);
  if (!src) {
    const wrap = aud.closest('.fnp-photo-voice-wrap');
    if (wrap) {
      wrap.insertAdjacentHTML('beforeend',
        '<div class="fnp-photo-voice-missing">' +
        (PA_LANG === 'tr' ? 'Ses dosyası bulunamadı' : 'Voice file not found') + '</div>');
    }
    aud.remove();
    return;
  }
  if (aud._blobUrl) {
    URL.revokeObjectURL(aud._blobUrl);
    aud._blobUrl = null;
  }
  if (src.startsWith('blob:')) aud._blobUrl = src;
  aud.src = src;
  aud.load();
  aud.onerror = () => {
    const wrap = aud.closest('.fnp-photo-voice-wrap');
    if (wrap && !wrap.querySelector('.fnp-photo-voice-missing')) {
      wrap.insertAdjacentHTML('beforeend',
        '<div class="fnp-photo-voice-missing">' +
        (PA_LANG === 'tr' ? 'Ses oynatılamadı — notu yeniden kaydedin' : 'Could not play — re-record the voice note') +
        '</div>');
    }
  };
}

function openNoteInfoSheet() {
  const pop = document.getElementById('field-note-popup');
  if (!pop) return;
  pop.classList.add('open');
  document.body.classList.add('field-note-info-open');
}

function closeNotePopup() {
  revokeObservationPopupImages();
  const pop = document.getElementById('field-note-popup');
  if (pop) pop.classList.remove('open');
  document.body.classList.remove('field-note-info-open');
  _notePopupId = null;
  _observationPopupPrimaryId = null;
}

function showNotePopup(note) {
  showFieldObservationPopup(note);
}

async function showFieldObservationPopup(primary) {
  if (!primary || primary.lat == null || primary.lon == null) return;
  if (primary.type === 'field_note') normalizeFieldNoteObject(primary);
  if (primary.type === 'field_photo') normalizeFieldPhotoObject(primary);

  closeFieldPhotoViewer();
  revokeObservationPopupImages();

  const cluster = getObservationCluster(primary.lat, primary.lon);
  _observationPopupPrimaryId = primary.id;
  _notePopupId = primary.type === 'field_note' ? primary.id : (cluster.notes[0]?.id || null);
  _fieldCtxPhotoId = primary.type === 'field_photo' ? primary.id : (cluster.photos[0]?.id || null);
  S.selectedIds = [primary.id];
  setDeleteButtonVisible(true);

  const pop = document.getElementById('field-note-popup');
  const body = document.getElementById('fnp-body');
  const numEl = document.getElementById('fnp-num');
  const editBtn = document.getElementById('fnp-edit-btn');
  if (!pop || !body) return;

  if (numEl) {
    if (primary.type === 'field_photo') {
      numEl.textContent = '📷 #' + (primary.photoNum || '?');
    } else {
      numEl.textContent = '#' + (primary.noteNum || '?');
    }
    if (cluster.photos.length && cluster.notes.length) {
      numEl.textContent += ' · ' + cluster.photos.length + '📷 ' + cluster.notes.length + '📝';
    }
  }
  if (editBtn) {
    editBtn.textContent = primary.type === 'field_photo'
      ? (PA_LANG === 'tr' ? 'Fotoğraf' : 'Photo')
      : (PA_LANG === 'tr' ? 'Düzenle' : 'Edit');
  }

  let html = '';

  if (cluster.photos.length) {
    html += '<div class="fnp-section-title">' + (PA_LANG === 'tr' ? 'Fotoğraflar' : 'Photos') + '</div>';
    cluster.photos.forEach(photo => {
      normalizeFieldPhotoObject(photo);
      html += '<div class="fnp-photo-block">';
      html += '<div class="fnp-photo-lbl">📷 ' + escapeHtml(photo.title || 'Fotoğraf') + '</div>';
      html += '<div class="fnp-photo-img-wrap"><img class="fnp-photo-img" data-photo-id="' + photo.id + '" alt=""/></div>';
      const noteText = fieldPhotoNoteText(photo);
      html += '<div class="fnp-photo-desc-label">' + (PA_LANG === 'tr' ? 'Not' : 'Note') + '</div>';
      if (noteText) {
        html += '<div class="fnp-photo-desc">' + escapeHtml(noteText).replace(/\n/g, '<br>') + '</div>';
      } else {
        html += '<div class="fnp-photo-desc fnp-photo-desc-empty">' +
          (PA_LANG === 'tr' ? 'Foto notu yok' : 'No photo note') + '</div>';
      }
      if (photo.hasVoice) {
        html += '<div class="fnp-photo-voice-wrap">';
        html += '<div class="fnp-photo-voice-lbl">🎤 ' +
          (PA_LANG === 'tr' ? 'Sesli not' : 'Voice note') +
          (photo.voiceDuration ? ' · ' + Math.round(photo.voiceDuration) + ' sn' : '') + '</div>';
        html += '<audio class="fnp-photo-audio" controls preload="metadata" data-photo-id="' + photo.id + '"></audio>';
        html += '</div>';
      }
      html += '<div class="fnp-meta">' + (photo.timestamp || '').slice(0, 16).replace('T', ' ') + '</div>';
      html += '</div>';
    });
  }

  if (cluster.notes.length) {
    html += '<div class="fnp-notes-section"><div class="fnp-section-title">' +
      (PA_LANG === 'tr' ? 'Notlar' : 'Notes') + '</div>';
    cluster.notes.forEach(n => {
      normalizeFieldNoteObject(n);
      html += '<div class="fnp-note-item">';
      html += '<div class="fnp-note-lbl">#' + (n.noteNum || '?') + '</div>';
      const txt = getNoteText(n);
      if (txt) html += '<div>' + escapeHtml(txt).replace(/\n/g, '<br>') + '</div>';
      else if (!noteHasHandwriting(n)) {
        html += '<div style="color:var(--muted);">' + (PA_LANG === 'tr' ? 'Boş not' : 'Empty note') + '</div>';
      }
      if (noteHasHandwriting(n) && n.handwritingData.snapshot) {
        html += '<img class="fnp-hand" src="' + n.handwritingData.snapshot + '" alt="El yazısı"/>';
      } else if (noteHasHandwriting(n)) {
        html += '<div style="color:var(--muted);margin-top:4px;">✏️ ' +
          (PA_LANG === 'tr' ? 'El yazısı eki' : 'Handwriting') + '</div>';
      }
      html += '<div class="fnp-meta">' + (n.timestamp || n.createdAt || '').slice(0, 16).replace('T', ' ') + '</div>';
      html += '</div>';
    });
    html += '</div>';
  }

  if (!cluster.photos.length && !cluster.notes.length) {
    html = '<div style="color:var(--muted);">' + (PA_LANG === 'tr' ? 'İçerik yok' : 'No content') + '</div>';
  }

  body.innerHTML = html;
  openNoteInfoSheet();
  updateSelPanel(primary);
  updateFieldRightPanel(primary);
  buildLayerPanel();
  scheduleRender();

  await Promise.all(cluster.photos.flatMap(p => [
    loadPhotoIntoObservationPopup(p),
    loadPhotoVoiceIntoObservationPopup(p),
  ]));
}

function editFromObservationPopup() {
  const id = _observationPopupPrimaryId || _notePopupId || _fieldCtxPhotoId || S.selectedIds[0];
  const obj = S.objects.find(o => o.id === id);
  if (!obj) return;
  closeNotePopup();
  if (obj.type === 'field_note') openFieldNoteEditor(obj.id);
  else if (obj.type === 'field_photo') openFieldPhotoDetail(obj.id);
}

function editNoteFromPopup() {
  editFromObservationPopup();
}

function selectNoteFromLayer(id) {
  const n = S.objects.find(o => o.id === id);
  if (!n) return;
  setActiveLayer('notes');
  const b = { minLat: n.lat, maxLat: n.lat, minLon: n.lon, maxLon: n.lon, ok: true };
  fitMapToLatLonBounds(b);
  scheduleRender();
  requestAnimationFrame(() => showNotePopup(n));
}

function noteHasHandwriting(n) {
  const h = n && n.handwritingData;
  return !!(h && ((h.strokes && h.strokes.length) || h.snapshot));
}

function buildFieldNotesList() {
  const el = document.getElementById('field-notes-list');
  if (!el) return;
  el.innerHTML = '';
  const notes = getFieldNotesSorted();
  if (!notes.length) {
    el.innerHTML = '<div style="padding:12px 14px;font-size:12px;color:var(--muted);">Henüz not yok</div>';
    return;
  }
  notes.forEach(n => {
    const row = document.createElement('div');
    row.className = 'note-row' + (S.selectedIds.includes(n.id) ? ' active' : '');
    const handTag = noteHasHandwriting(n) ? '<span class="note-hand-tag"> ✏️</span>' : '';
    const preview = getNoteText(n) || (noteHasHandwriting(n) ? 'El yazısı notu' : 'Not');
    row.innerHTML = '<strong>#' + (n.noteNum || '?') + '</strong> ' + escapeHtml(preview.slice(0, 50)) + handTag +
      '<small>' + (n.timestamp || n.createdAt || '').slice(0, 16).replace('T', ' ') + '</small>';
    row.onclick = () => selectNoteFromLayer(n.id);
    el.appendChild(row);
  });
}

function openFieldNotesSheet() {
  document.getElementById('field-notes-panel')?.classList.add('open');
}

function closeFieldNotesSheet() {
  document.getElementById('field-notes-panel')?.classList.remove('open');
  document.getElementById('field-notes-sheet-backdrop')?.classList.remove('open');
  document.body.classList.remove('field-notes-sheet-open');
}

function cancelFieldNotePinMode() {
  cancelFieldNoteEditor(true);
  showHint(PA_LANG === 'tr' ? 'Raptiye iptal edildi' : 'Pin placement cancelled');
}

function startFieldNotePlacement() {
  requireProject(() => {
    _editingNoteId = null;
    _notePinMode = true;
    _pendingNoteGeo = null;
    document.body.classList.add('note-pin-mode');
    closeFieldNotesSheet();
    const banner = document.getElementById('field-note-pin-banner');
    if (banner) banner.style.display = 'block';
    document.getElementById('field-note-input').value = '';
    clearNoteHandwriting();
    buildFieldNotesList();
    setTool('select');
    showHint('Not almak istediğiniz konuma raptiyeyi yerleştirin.', 7000);
    scheduleRender();
  });
}

function openFieldNotes() {
  startFieldNotePlacement();
}

function openFieldNoteEditorPanel() {
  buildFieldNotesList();
  openFieldNotesSheet();
  setNotePanelMode(_notePanelMode || 'text');
  updateFieldNoteDeleteButton();
  requestAnimationFrame(() => initNoteHandCanvas());
}

function updateFieldNoteDeleteButton() {
  const btn = document.getElementById('fn-delete-note');
  if (!btn) return;
  btn.disabled = !_editingNoteId;
}

function deleteFieldNoteById(objId) {
  const obj = S.objects.find(o => o.id === objId);
  if (!obj || obj.type !== 'field_note') return;
  S.objects = S.objects.filter(o => o.id !== objId);
  if (_notePopupId === objId) closeNotePopup();
  if (_fieldCtxNoteId === objId) _fieldCtxNoteId = null;
  if (_editingNoteId === objId) _editingNoteId = null;
  _pendingNoteGeo = null;
  S.selectedIds = S.selectedIds.filter(id => id !== objId);
  pushHistory();
  buildFieldNotesList();
  buildLayerPanel();
  scheduleProjectSave();
  cancelFieldNoteEditor(true);
  updateFieldRightPanel(null);
  setDeleteButtonVisible(false);
  scheduleRender();
  showHint(t('note.deleted'));
}

function deleteFieldNoteFromPanel() {
  requireProject(() => {
    if (!_editingNoteId) {
      showHint(t('note.deleteNone'));
      return;
    }
    deleteFieldNoteById(_editingNoteId);
  });
}

function closeFieldNotes() {
  cancelFieldNoteEditor(true);
}

function cancelFieldNoteEditor(clearPin) {
  closeFieldNotesSheet();
  _editingNoteId = null;
  _pendingNoteGeo = null;
  updateFieldNoteDeleteButton();
  if (clearPin) {
    _notePinMode = false;
    document.body.classList.remove('note-pin-mode');
    const banner = document.getElementById('field-note-pin-banner');
    if (banner) banner.style.display = 'none';
  }
  scheduleRender();
}

function requireProject(fn) {
  if (!FIELD_PROJECT.id) {
    if (bootstrapFieldProjectSync()) {
      ensureFieldProjectId().catch(() => {});
      fn();
      return;
    }
    openProjectPanel();
    showHint('Önce gezi oluşturun veya açın');
    return;
  }
  fn();
}

function placeFieldNotePin(wp) {
  const geo = worldToLatLon(wp.x, wp.y);
  _notePinMode = false;
  document.body.classList.remove('note-pin-mode');
  _pendingNoteGeo = { lat: geo.lat, lon: geo.lon };
  _editingNoteId = null;
  document.getElementById('field-note-input').value = '';
  clearNoteHandwriting();
  const banner = document.getElementById('field-note-pin-banner');
  if (banner) banner.style.display = 'none';
  setNotePanelMode('text');
  openFieldNoteEditorPanel();
  S.selectedIds = [];
  scheduleRender();
  showHint('Notu yazın veya el yazısı ekleyin');
}

function saveFieldNoteFromPanel() {
  requireProject(() => {
    const rawText = document.getElementById('field-note-input').value.trim();
    const text = typeof SpatialSecurity !== 'undefined'
      ? SpatialSecurity.sanitizeFieldNoteText(rawText)
      : rawText;
    const hand = collectNoteHandwriting();
    if (!text && !noteHasHandwriting({ handwritingData: hand })) {
      showHint('Metin veya el yazısı ekleyin');
      return;
    }
    if (_editingNoteId) {
      const n = S.objects.find(o => o.id === _editingNoteId);
      if (n) {
        n.textNote = text;
        n.text = text || (noteHasHandwriting(n) ? 'El yazısı' : 'Not');
        n.handwritingData = hand;
        n.timestamp = new Date().toISOString();
        pushHistory();
        scheduleProjectSave();
        buildFieldNotesList();
        showHint('Not güncellendi');
      }
      cancelFieldNoteEditor(true);
      return;
    }
    if (!_pendingNoteGeo) {
      showHint('Önce haritada konum seçin');
      startFieldNotePlacement();
      return;
    }
    const n = makeFieldNote(_pendingNoteGeo.lat, _pendingNoteGeo.lon, text, hand);
    S.objects.push(n);
    S.selectedIds = [n.id];
    pushHistory();
    document.getElementById('field-note-input').value = '';
    clearNoteHandwriting();
    buildFieldNotesList();
    scheduleProjectSave();
    cancelFieldNoteEditor(true);
    buildLayerPanel();
    updateSelPanel(n);
    showNotePopup(n);
    showHint('Saha notu #' + n.noteNum + ' kaydedildi');
    scheduleRender();
  });
}

function openFieldNoteEditor(id) {
  const n = S.objects.find(o => o.id === id);
  if (!n) return;
  closeNotePopup();
  normalizeFieldNoteObject(n);
  _notePinMode = false;
  document.body.classList.remove('note-pin-mode');
  _editingNoteId = id;
  _pendingNoteGeo = { lat: n.lat, lon: n.lon };
  document.getElementById('field-note-input').value = getNoteText(n);
  loadNoteHandwriting(n);
  setNotePanelMode(noteHasHandwriting(n) && !getNoteText(n) ? 'handwriting' : 'text');
  openFieldNoteEditorPanel();
  updateFieldNoteDeleteButton();
  const b = { minLat: n.lat, maxLat: n.lat, minLon: n.lon, maxLon: n.lon, ok: true };
  fitMapToLatLonBounds(b);
  S.selectedIds = [id];
  scheduleRender();
}

function setNotePanelMode(mode) {
  _notePanelMode = mode === 'handwriting' ? 'handwriting' : 'text';
  document.getElementById('fn-tab-text')?.classList.toggle('active', _notePanelMode === 'text');
  document.getElementById('fn-tab-hand')?.classList.toggle('active', _notePanelMode === 'handwriting');
  const pt = document.getElementById('fn-pane-text');
  const ph = document.getElementById('fn-pane-hand');
  if (pt) pt.style.display = _notePanelMode === 'text' ? 'block' : 'none';
  if (ph) ph.style.display = _notePanelMode === 'handwriting' ? 'block' : 'none';
  if (_notePanelMode === 'handwriting') requestAnimationFrame(() => initNoteHandCanvas());
}

function initNoteHandCanvas() {
  const c = document.getElementById('field-note-hand-canvas');
  if (!c) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(200, c.parentElement?.clientWidth || 300) - 4;
  const panel = document.getElementById('field-notes-panel');
  const panelH = panel?.clientHeight || 420;
  const h = Math.max(72, Math.min(120, panelH - 248));
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  c.style.width = w + 'px';
  c.style.height = h + 'px';
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  redrawNoteHandCanvas();
  if (!c._handBound) {
    c._handBound = true;
    c.addEventListener('pointerdown', noteHandDown);
    c.addEventListener('pointermove', noteHandMove);
    c.addEventListener('pointerup', noteHandUp);
    c.addEventListener('pointercancel', noteHandUp);
    c.addEventListener('lostpointercapture', noteHandUp);
  }
}

function noteHandPos(e, c) {
  const r = c.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

function noteHandDown(e) {
  const c = document.getElementById('field-note-hand-canvas');
  if (!c) return;
  e.preventDefault();
  c.setPointerCapture(e.pointerId);
  _noteHandDrawing = true;
  const p = noteHandPos(e, c);
  _noteHandCurrent = { points: [[p.x, p.y]], color: '#1a2a38', width: 2.2 };
  _noteHandStrokes.push(_noteHandCurrent);
}

function noteHandMove(e) {
  if (!_noteHandDrawing || !_noteHandCurrent) return;
  const c = document.getElementById('field-note-hand-canvas');
  if (!c) return;
  e.preventDefault();
  const p = noteHandPos(e, c);
  const pts = _noteHandCurrent.points;
  const last = pts[pts.length - 1];
  if (Math.hypot(p.x - last[0], p.y - last[1]) < 1.2) return;
  pts.push([p.x, p.y]);
  redrawNoteHandCanvas();
}

function noteHandUp(e) {
  if (!_noteHandDrawing) return;
  _noteHandDrawing = false;
  _noteHandCurrent = null;
  try { e.target.releasePointerCapture(e.pointerId); } catch (_) {}
}

function redrawNoteHandCanvas() {
  const c = document.getElementById('field-note-hand-canvas');
  if (!c) return;
  const ctx = c.getContext('2d');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = c.width / dpr;
  const h = c.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#fffef8';
  ctx.fillRect(0, 0, w, h);
  _noteHandStrokes.forEach(st => {
    if (!st.points || st.points.length < 2) return;
    ctx.strokeStyle = st.color || '#1a2a38';
    ctx.lineWidth = st.width || 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(st.points[0][0], st.points[0][1]);
    for (let i = 1; i < st.points.length; i++) ctx.lineTo(st.points[i][0], st.points[i][1]);
    ctx.stroke();
  });
}

function clearNoteHandwriting() {
  _noteHandStrokes = [];
  _noteHandDrawing = false;
  _noteHandCurrent = null;
  redrawNoteHandCanvas();
}

function loadNoteHandwriting(n) {
  clearNoteHandwriting();
  const h = n && n.handwritingData;
  if (h && h.strokes && h.strokes.length) {
    _noteHandStrokes = JSON.parse(JSON.stringify(h.strokes));
    redrawNoteHandCanvas();
  } else if (h && h.snapshot) {
    const img = new Image();
    img.onload = () => {
      const c = document.getElementById('field-note-hand-canvas');
      if (!c) return;
      initNoteHandCanvas();
      const ctx = c.getContext('2d');
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = c.width / dpr;
      const hpx = c.height / dpr;
      ctx.drawImage(img, 0, 0, w, hpx);
    };
    img.src = h.snapshot;
  }
}

function collectNoteHandwriting() {
  if (!_noteHandStrokes.length) return null;
  const c = document.getElementById('field-note-hand-canvas');
  let snapshot = null;
  if (c && _noteHandStrokes.some(s => s.points && s.points.length > 1)) {
    try { snapshot = c.toDataURL('image/png', 0.82); } catch (_) {}
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  return {
    strokes: JSON.parse(JSON.stringify(_noteHandStrokes)),
    snapshot,
    w: c ? c.width / dpr : 300,
    h: c ? c.height / dpr : 160,
  };
}

// ═══ Field photos + voice notes ═════════════════════════════════
const _photoThumbCache = new Map();
let _fieldCtxPhotoId = null;
let _fieldVoiceRec = null;
let _fieldVoiceChunks = [];
let _fieldVoiceStart = 0;
let _fieldVoicePlayUrl = null;
let _fieldPhotoPreviewUrl = null;

function isFieldMobileDevice() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 0 && window.innerWidth < 1280);
}

function isCapacitorNative() {
  const c = window.Capacitor;
  return !!(c && (c.isNativePlatform?.() || c.platform === 'android' || c.platform === 'ios'));
}

let _fieldCameraStream = null;
let _fieldCameraFacing = 'environment';

function bindFieldPhotoFileInputs() {
  const cam = document.getElementById('field-photo-camera-input');
  const gal = document.getElementById('field-photo-gallery-input');
  if (cam && !cam._bound) {
    cam._bound = true;
    cam.addEventListener('change', async e => {
      const f = e.target.files?.[0];
      if (f) await ingestFieldPhoto(f);
      e.target.value = '';
    });
  }
  if (gal && !gal._bound) {
    gal._bound = true;
    gal.addEventListener('change', async e => {
      const f = e.target.files?.[0];
      if (f) await ingestFieldPhoto(f);
      e.target.value = '';
    });
  }
}

async function fieldPhotoCaptureViaCapacitor() {
  const cap = window.Capacitor;
  if (!cap || !isCapacitorNative()) return false;
  if (typeof FieldPermissions !== 'undefined') {
    const camOk = await FieldPermissions.request('camera', { hintDenied: t('photo.camDenied') });
    if (!camOk) return false;
  }
  const Camera = cap.Plugins?.Camera || (cap.registerPlugin && cap.registerPlugin('Camera'));
  if (!Camera?.getPhoto) return false;
  try {
    const photo = await Camera.getPhoto({
      quality: 90,
      allowEditing: false,
      resultType: 'uri',
      source: 'CAMERA',
      direction: 'REAR',
      correctOrientation: true,
      saveToGallery: false,
    });
    const webPath = photo.webPath || Capacitor.convertFileSrc?.(photo.path) || photo.path;
    if (!webPath) return false;
    const resp = await fetch(webPath);
    const blob = await resp.blob();
    const file = new File([blob], 'field-photo-' + Date.now() + '.jpg', { type: blob.type || 'image/jpeg' });
    await ingestFieldPhoto(file);
    return true;
  } catch (e) {
    const msg = (e && (e.message || e.errorMessage)) || '';
    if (/cancel|dismiss|abort/i.test(msg)) return true;
    return false;
  }
}

function closeFieldCameraCaptureUi() {
  const ov = document.getElementById('field-camera-overlay');
  const video = document.getElementById('field-camera-video');
  ov?.classList.remove('open');
  if (ov) ov.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('field-camera-open');
  if (video) video.srcObject = null;
  if (_fieldCameraStream) {
    _fieldCameraStream.getTracks().forEach(t => t.stop());
    _fieldCameraStream = null;
  }
  if (_fieldGpsOn) resumeGpsAfterInterruption();
}

async function openFieldCameraCaptureUi() {
  closeFieldPhotoSheet();
  const ov = document.getElementById('field-camera-overlay');
  const video = document.getElementById('field-camera-video');
  if (!ov || !video || !navigator.mediaDevices?.getUserMedia) return false;
  if (typeof FieldPermissions !== 'undefined') {
    const ok = await FieldPermissions.request('camera', { hintDenied: t('photo.camDenied') });
    if (!ok) return false;
  }
  closeFieldCameraCaptureUi();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: _fieldCameraFacing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    _fieldCameraStream = stream;
    video.srcObject = stream;
    await video.play();
    ov.classList.add('open');
    ov.setAttribute('aria-hidden', 'false');
    document.body.classList.add('field-camera-open');
    return true;
  } catch (_) {
    return false;
  }
}

async function fieldCameraFlip() {
  _fieldCameraFacing = _fieldCameraFacing === 'environment' ? 'user' : 'environment';
  if (!_fieldCameraStream) return;
  closeFieldCameraCaptureUi();
  await openFieldCameraCaptureUi();
}

async function fieldCameraShutter() {
  const video = document.getElementById('field-camera-video');
  if (!video?.videoWidth) return;
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext('2d').drawImage(video, 0, 0);
  closeFieldCameraCaptureUi();
  const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.88));
  if (blob) await ingestFieldPhoto(new File([blob], 'field-capture.jpg', { type: 'image/jpeg' }));
}

function fieldPhotoCaptureCameraFileInput() {
  bindFieldPhotoFileInputs();
  const inp = document.getElementById('field-photo-camera-input');
  if (!inp) return;
  inp.value = '';
  if (typeof inp.showPicker === 'function') {
    try { inp.showPicker(); return; } catch (_) {}
  }
  inp.click();
}

function ensurePhotosLayer() {
  if (!S.layers.find(l => l.id === FIELD_PHOTOS_LAYER)) {
    S.layers.push({
      id: FIELD_PHOTOS_LAYER, name: '📷 Fotoğraflar', color: '#8e44ad',
      order: 6, visible: true, locked: false,
    });
  }
}

function ensureGpsLayer() {
  const def = FIELD_LAYER_DEFS.find(d => d.id === FIELD_GPS_LAYER);
  if (!def) return;
  if (!S.layers.find(l => l.id === FIELD_GPS_LAYER)) {
    S.layers.push({ ...def, visible: true, locked: false });
  }
}

function normalizeFieldGpsTrackObject(o) {
  if (!o || o.type !== 'field_gps_track') return o;
  o.layerId = FIELD_GPS_LAYER;
  if (!o.color) o.color = '#1565c0';
  if (Array.isArray(o.vertices) && typeof SpatialSecurity !== 'undefined') {
    const cap = SpatialSecurity.LIMITS.MAX_GPS_TRACK_POINTS;
    o.vertices = o.vertices
      .filter(v => v && SpatialSecurity.isFiniteCoord(v.lat, v.lon))
      .slice(-cap);
  }
  return o;
}

function ensureFieldGpsTrackNumbers() {
  const tracks = S.objects.filter(o => o.type === 'field_gps_track');
  const used = new Set();
  let max = 0;
  tracks.forEach(t => {
    if (t.trackNum) { used.add(t.trackNum); max = Math.max(max, t.trackNum); }
  });
  let next = max + 1;
  tracks.forEach(t => {
    normalizeFieldGpsTrackObject(t);
    if (!t.trackNum || t.trackNum < 1) {
      while (used.has(next)) next++;
      t.trackNum = next;
      used.add(next);
      next++;
    }
  });
}

function getNextGpsTrackNumber() {
  let max = 0;
  S.objects.forEach(o => {
    if (o.type !== 'field_gps_track') return;
    if (o.trackNum) max = Math.max(max, o.trackNum);
  });
  return max + 1;
}

function getFieldGpsTracksSorted() {
  return S.objects
    .filter(o => o.type === 'field_gps_track' && (o.vertices || []).length >= 2)
    .map(o => normalizeFieldGpsTrackObject(o))
    .sort((a, b) => (a.trackNum || 0) - (b.trackNum || 0));
}

function gpsTrackPanelLabel(obj) {
  if (!obj) return '';
  const live = _gpsTrack.objId === obj.id && _gpsTrack.state !== 'idle';
  if (live) return t('track.recording') + ' · ' + formatLengthReport(trackTotalDistanceM(_gpsTrack.points));
  const dist = obj.trackMeta?.distanceM ?? trackTotalDistanceM(obj.vertices || []);
  const ts = obj.trackMeta?.startTs;
  const loc = PA_LANG === 'en' ? 'en' : 'tr-TR';
  const dateStr = ts ? new Date(ts).toLocaleString(loc, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  return (dateStr ? dateStr + ' · ' : '') + formatLengthReport(dist);
}

function boundsForGpsTrack(obj) {
  const verts = obj?.vertices || [];
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  verts.forEach(v => {
    if (v.lat == null || v.lon == null) return;
    minLat = Math.min(minLat, v.lat); maxLat = Math.max(maxLat, v.lat);
    minLon = Math.min(minLon, v.lon); maxLon = Math.max(maxLon, v.lon);
  });
  return { minLat, maxLat, minLon, maxLon, ok: minLat <= maxLat && minLon <= maxLon };
}

let _gpsTrackReplay = { raf: null, objId: null, verts: null, u: 0, pos: null };

function lerpAlongTrackVerts(verts, u) {
  if (!verts || verts.length < 2) return verts?.[0] ? { lat: verts[0].lat, lon: verts[0].lon } : null;
  let total = 0;
  const segs = [];
  for (let i = 1; i < verts.length; i++) {
    const d = haversineM(verts[i - 1].lat, verts[i - 1].lon, verts[i].lat, verts[i].lon);
    segs.push(d);
    total += d;
  }
  if (total < 0.5) return { lat: verts[0].lat, lon: verts[0].lon };
  const target = total * u;
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    if (acc + segs[i] >= target) {
      const t = (target - acc) / segs[i];
      return gpsLerpLatLon(verts[i], verts[i + 1], t);
    }
    acc += segs[i];
  }
  return { lat: verts[verts.length - 1].lat, lon: verts[verts.length - 1].lon };
}

function stopGpsTrackReplay() {
  if (_gpsTrackReplay.raf) cancelAnimationFrame(_gpsTrackReplay.raf);
  _gpsTrackReplay = { raf: null, objId: null, verts: null, u: 0, pos: null };
  scheduleRender();
}

function playGpsTrackReplay(objId) {
  const obj = S.objects.find(o => o.id === objId);
  const verts = obj?.vertices;
  if (!obj || obj.type !== 'field_gps_track' || !verts || verts.length < 2) return;
  if (_gpsTrack.state !== 'idle') {
    showHint(PA_LANG === 'tr' ? 'Önce rota kaydını durdurun' : 'Stop track recording first');
    return;
  }
  stopGpsTrackReplay();
  selectGpsTrackFromLayer(objId);
  const t0 = verts[0].ts || 0;
  const t1 = verts[verts.length - 1].ts || 0;
  const dur = Math.max(4000, Math.min(90000, t1 > t0 ? t1 - t0 : verts.length * 700));
  const start = performance.now();
  _gpsTrackReplay.objId = objId;
  _gpsTrackReplay.verts = verts;
  showHint(PA_LANG === 'tr' ? 'Rota oynatılıyor…' : 'Playing track…');
  const tick = (now) => {
    const u = Math.min(1, (now - start) / dur);
    _gpsTrackReplay.u = u;
    _gpsTrackReplay.pos = lerpAlongTrackVerts(verts, u);
    if (_gpsTrackReplay.pos) {
      S.mapCenter.lat += (_gpsTrackReplay.pos.lat - S.mapCenter.lat) * 0.11;
      S.mapCenter.lon += (_gpsTrackReplay.pos.lon - S.mapCenter.lon) * 0.11;
    }
    scheduleRender();
    if (u < 1) _gpsTrackReplay.raf = requestAnimationFrame(tick);
    else {
      _gpsTrackReplay.raf = null;
      showHint(PA_LANG === 'tr' ? 'Rota oynatma tamamlandı' : 'Track replay finished');
    }
  };
  _gpsTrackReplay.raf = requestAnimationFrame(tick);
}

function selectGpsTrackFromLayer(id) {
  const tr = S.objects.find(o => o.id === id);
  if (!tr || tr.type !== 'field_gps_track') return;
  stopGpsTrackReplay();
  normalizeFieldGpsTrackObject(tr);
  setActiveLayer(FIELD_GPS_LAYER);
  S.selectedIds = [tr.id];
  setDeleteButtonVisible(true);
  updateSelPanel(tr);
  const b = boundsForGpsTrack(tr);
  if (b.ok) fitMapToLatLonBounds(b);
  buildLayerPanel();
  scheduleRender();
}

function deleteFieldGpsTrackById(objId, ev) {
  if (ev) ev.stopPropagation();
  const obj = S.objects.find(o => o.id === objId);
  if (!obj || obj.type !== 'field_gps_track') return;
  S.objects = S.objects.filter(o => o.id !== objId);
  S.selectedIds = S.selectedIds.filter(id => id !== objId);
  if (_gpsTrack.objId === objId) {
    _gpsTrack = { state: 'idle', points: [], startTs: null, pausedAt: null, pauseMs: 0, objId: null };
    updateGpsTrackHud();
    updateGpsTestPanel();
  }
  ensureFieldGpsTrackNumbers();
  pushHistory();
  buildLayerPanel();
  updateFieldRightPanel(null);
  setDeleteButtonVisible(false);
  scheduleRender();
  showHint(t('obj.deleted'));
}

function deleteFieldGpsTrackFromLayer(objId, ev) {
  deleteFieldGpsTrackById(objId, ev);
}

function getNextPhotoNumber() {
  let max = 0;
  S.objects.forEach(o => {
    if (o.type !== 'field_photo') return;
    if (o.photoNum) max = Math.max(max, o.photoNum);
    else {
      const m = (o.title || o.caption || '').match(/Foto\s*(\d+)/i);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  });
  return max + 1;
}

function getFieldPhotosSorted() {
  return S.objects
    .filter(o => o.type === 'field_photo')
    .map(o => { normalizeFieldPhotoObject(o); return o; })
    .sort((a, b) => (a.photoNum || 0) - (b.photoNum || 0));
}

function selectPhotoFromLayer(id) {
  const p = S.objects.find(o => o.id === id);
  if (!p || p.type !== 'field_photo') return;
  normalizeFieldPhotoObject(p);
  setActiveLayer(FIELD_PHOTOS_LAYER);
  const b = { minLat: p.lat, maxLat: p.lat, minLon: p.lon, maxLon: p.lon, ok: true };
  fitMapToLatLonBounds(b);
  scheduleRender();
  requestAnimationFrame(() => showFieldObservationPopup(p));
}

function normalizeFieldPhotoObject(o) {
  if (o.type !== 'field_photo') return;
  o.layerId = FIELD_PHOTOS_LAYER;
  o.projectId = o.projectId || FIELD_PROJECT.id;
  if (!o.photoNum) {
    const m = (o.title || o.caption || '').match(/Foto\s*(\d+)/i);
    o.photoNum = m ? parseInt(m[1], 10) : getNextPhotoNumber();
  }
  if (!o.title) o.title = 'Foto ' + o.photoNum;
  o.timestamp = o.timestamp || o.createdAt || new Date().toISOString();
  o.description = o.description ?? (o.caption && o.caption !== o.title ? o.caption : '') ?? '';
}

function makeFieldPhoto(lat, lon, photoId, photoNum, title) {
  const ts = new Date().toISOString();
  return {
    id: uid(),
    type: 'field_photo',
    photoId,
    projectId: FIELD_PROJECT.id,
    title: title || ('Foto ' + photoNum),
    photoNum,
    lat,
    lon,
    timestamp: ts,
    createdAt: ts,
    description: '',
    hasVoice: false,
    voiceDuration: 0,
    caption: title || ('Foto ' + photoNum),
    layerId: FIELD_PHOTOS_LAYER,
    visible: true,
    locked: false,
  };
}

async function getPhotoBlobRecord(photoId, kind) {
  const db = await openProjectDb();
  let row = await idbGet(db, 'blobs', projectBlobKey(photoId, kind));
  if (!row && kind === 'full') row = await idbGet(db, 'blobs', legacyPhotoBlobKey(photoId));
  return row;
}

async function getPhotoAudioBlob(photoIds) {
  const ids = [...new Set((photoIds || []).filter(Boolean))];
  for (let i = 0; i < ids.length; i++) {
    const aud = await getPhotoBlobRecord(ids[i], 'audio');
    if (aud?.data) return aud;
  }
  return null;
}

function ensureBlobWithMime(data, mime) {
  const m = mime || 'application/octet-stream';
  if (!data) return null;
  if (data instanceof Blob) return data.type ? data : new Blob([data], { type: m });
  if (data instanceof ArrayBuffer) return new Blob([data], { type: m });
  if (ArrayBuffer.isView(data)) {
    return new Blob([data.buffer, data.byteOffset, data.byteLength], { type: m });
  }
  return null;
}

async function resolvePhotoAudioPlaySrc(row) {
  const blob = ensureBlobWithMime(row?.data, row?.mime || 'audio/webm');
  if (!blob?.size) return null;
  const wav = await audioBlobToWavDataUrl(blob);
  if (wav) return wav;
  try {
    return await blobToDataUrl(blob);
  } catch (_) {
    return URL.createObjectURL(blob);
  }
}

async function audioBlobToWavDataUrl(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx || !blob?.size) return '';
  try {
    const ab = await blob.arrayBuffer();
    if (!ab.byteLength) return '';
    const ctx = new Ctx();
    const decoded = await ctx.decodeAudioData(ab.slice(0));
    if (ctx.close) await ctx.close();
    return audioBufferToWavDataUrl(decoded);
  } catch (e) {
    console.warn('[Photo audio decode]', e);
    return '';
  }
}

function audioBufferToWavDataUrl(buffer) {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const samples = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = samples * blockAlign;
  const buf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buf);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  let off = 44;
  const ch0 = buffer.getChannelData(0);
  for (let i = 0; i < samples; i++) {
    let s = ch0[i];
    if (numCh > 1) {
      let mix = ch0[i];
      for (let c = 1; c < numCh; c++) mix += buffer.getChannelData(c)[i];
      s = mix / numCh;
    }
    s = Math.max(-1, Math.min(1, s));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  const b64 = arrayBufferToBase64(buf);
  return 'data:audio/wav;base64,' + b64;
}

function arrayBufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function synthesizeDemoVoiceDataUrl(durationSec) {
  try {
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Ctx) return '';
    const sec = Math.min(30, Math.max(1, Number(durationSec) || 3));
    const sr = 22050;
    const len = Math.round(sec * sr);
    const ctx = new Ctx(1, len, sr);
    const buf = ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      data[i] = 0.12 * Math.sin(2 * Math.PI * 440 * t) * (0.35 + 0.65 * Math.exp(-t * 0.25));
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    const rendered = await ctx.startRendering();
    return audioBufferToWavDataUrl(rendered);
  } catch (e) {
    console.warn('[Demo voice synth]', e);
    return '';
  }
}

async function enrichPhotosWithAudio(photos) {
  if (!Array.isArray(photos)) return photos;
  const out = [];
  for (const p of photos) {
    const row = Object.assign({}, p);
    if (row.hasVoice && !row.audioDataUrl) {
      const aud = await getPhotoAudioBlob([row.photoId, row.id, p.photoId, p.id]);
      if (aud?.data) {
        try { row.audioDataUrl = await blobToDataUrl(aud.data); } catch (e) { console.warn('[Report audio]', e); }
      }
    }
    out.push(row);
  }
  return out;
}

async function generatePhotoThumbnail(file, maxPx) {
  maxPx = maxPx || 96;
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(maxPx / img.width, maxPx / img.height, 1);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob(b => resolve(b || file), 'image/jpeg', 0.7);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

function activateFieldPhotoTool() {
  requireProject(() => {
    document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
    document.getElementById('btn-field-photo-tool')?.classList.add('active');
    if (!_fieldGpsOn) {
      toggleFieldGps();
      showHint('Konum için GPS açıldı');
    }
    openFieldPhotoSheet();
  });
}

function attachFieldPhoto() { activateFieldPhotoTool(); }

function openFieldPermissionsPanel() {
  if (typeof FieldPermissions !== 'undefined') FieldPermissions.openPanel();
  else showHint(t('perm.settingsWeb'));
}

function openFieldPhotoSheet() {
  document.getElementById('field-photo-sheet')?.classList.add('open');
  document.body.classList.add('field-photo-sheet-open');
}

function closeFieldPhotoSheet() {
  document.getElementById('field-photo-sheet')?.classList.remove('open');
  document.body.classList.remove('field-photo-sheet-open');
}

async function fieldPhotoCaptureCamera() {
  closeFieldPhotoSheet();
  if (await fieldPhotoCaptureViaCapacitor()) return;
  if (await openFieldCameraCaptureUi()) return;
  fieldPhotoCaptureCameraFileInput();
}

async function fieldPhotoCaptureGallery() {
  closeFieldPhotoSheet();
  if (typeof FieldPermissions !== 'undefined' && FieldPermissions.isNative()) {
    await FieldPermissions.request('photos');
  }
  bindFieldPhotoFileInputs();
  const inp = document.getElementById('field-photo-gallery-input');
  if (!inp) return;
  inp.value = '';
  if (typeof inp.showPicker === 'function') {
    try { inp.showPicker(); return; } catch (_) {}
  }
  inp.click();
}

async function stripPhotoExif(file, maxDim) {
  maxDim = maxDim || 4096;
  if (!file) return file;
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      const s = Math.min(1, maxDim / Math.max(w, h, 1));
      w = Math.max(1, Math.round(w * s));
      h = Math.max(1, Math.round(h * s));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      c.toBlob(b => resolve(b || file), 'image/jpeg', 0.88);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

async function resizePhotoFile(file, maxDim) {
  return stripPhotoExif(file, maxDim || 2048);
}

async function ingestFieldPhoto(file) {
  if (!file || !FIELD_PROJECT.id) return;
  showHint('Fotoğraf işleniyor…');
  await new Promise(r => setTimeout(r, 0));

  let lat, lon, gpsSource = 'map';
  const gpsFromExif = await readExifGps(file);
  if (gpsFromExif) {
    lat = gpsFromExif.lat;
    lon = gpsFromExif.lon;
    gpsSource = 'exif';
  } else if (_fieldGpsFix) {
    lat = _fieldGpsFix.lat;
    lon = _fieldGpsFix.lon;
    gpsSource = 'gps';
  } else {
    const p = notePlacementLatLon();
    lat = p.lat;
    lon = p.lon;
    gpsSource = 'map';
  }

  const fileToStore = await resizePhotoFile(file, 2048);
  const photoId = 'ph_' + Date.now();
  const photoNum = getNextPhotoNumber();
  const title = 'Foto ' + photoNum;

  let thumbBlob = null;
  try { thumbBlob = await generatePhotoThumbnail(fileToStore); } catch (_) {}

  const db = await openProjectDb();
  await idbPut(db, 'blobs', { key: projectBlobKey(photoId, 'full'), data: fileToStore, mime: fileToStore.type || 'image/jpeg' });
  if (thumbBlob) {
    await idbPut(db, 'blobs', { key: projectBlobKey(photoId, 'thumb'), data: thumbBlob, mime: 'image/jpeg' });
  }

  const obj = makeFieldPhoto(lat, lon, photoId, photoNum, title);
  obj.gpsSource = gpsSource;
  S.objects.push(obj);
  ensurePhotosLayer();
  await prefetchPhotoThumb(obj);
  S.selectedIds = [obj.id];
  pushHistory();
  buildLayerPanel();
  scheduleProjectSave();
  scheduleRender();
  openFieldPhotoVoiceSheet(obj.id);
  if (_fieldGpsOn) resumeGpsAfterInterruption();
  showHint(title + ' kaydedildi · ' + (gpsSource === 'exif' ? 'EXIF GPS' : gpsSource === 'gps' ? 'Canlı GPS' : 'Harita merkezi'));
}

function notePlacementLatLon() {
  if (_fieldGpsFix) return { lat: _fieldGpsFix.lat, lon: _fieldGpsFix.lon };
  const c = worldToLatLon((CW / 2 - S.tx) / S.scale, (CH / 2 - getTopBarH() - S.ty) / S.scale);
  return { lat: c.lat, lon: c.lon };
}

function ensureRightPanelVisible() {
  const panel = document.getElementById('right-panel');
  if (!panel || panel.style.display !== 'none') return;
  panel.style.display = 'block';
  document.body.classList.add('field-panel-right');
  document.body.classList.remove('field-panel-right-hidden');
  const btn = document.getElementById('right-toggle');
  if (btn) btn.textContent = '▶';
  resizeCanvas();
}

async function openFieldPhotoVoiceSheet(objId) {
  const obj = S.objects.find(o => o.id === objId);
  if (!obj || obj.type !== 'field_photo') return;
  ensureRightPanelVisible();
  normalizeFieldPhotoObject(obj);
  _fieldCtxPhotoId = objId;
  S.selectedIds = [objId];
  const sheet = document.getElementById('field-photo-voice-sheet');
  const thumbEl = document.getElementById('fpvs-thumb');
  const titleEl = document.getElementById('fpvs-title');
  if (titleEl) titleEl.textContent = obj.title || 'Fotoğraf';
  if (thumbEl) {
    const row = await getPhotoBlobRecord(obj.photoId, 'thumb') || await getPhotoBlobRecord(obj.photoId, 'full');
    if (row?.data) {
      if (sheet._thumbUrl) URL.revokeObjectURL(sheet._thumbUrl);
      sheet._thumbUrl = URL.createObjectURL(row.data);
      thumbEl.src = sheet._thumbUrl;
      thumbEl.style.display = 'block';
    } else thumbEl.style.display = 'none';
  }
  updateFieldPhotoVoiceSheetUi(obj);
  const fpvsDesc = document.getElementById('field-fpvs-desc');
  const panelDesc = document.getElementById('field-photo-desc');
  const descText = obj.description || '';
  if (fpvsDesc) fpvsDesc.value = descText;
  if (panelDesc) panelDesc.value = descText;
  sheet?.classList.add('open');
  closeFieldPhotoSheet();
  const b = { minLat: obj.lat, maxLat: obj.lat, minLon: obj.lon, maxLon: obj.lon, ok: true };
  fitMapToLatLonBounds(b);
  scheduleRender();
}

function updateFieldPhotoVoiceSheetUi(obj) {
  const st = document.getElementById('fpvs-voice-status');
  const btn = document.getElementById('fpvs-record-btn');
  if (!st) return;
  if (_fieldVoiceRec && _fieldVoiceRec.state === 'recording') {
    st.dataset.hasVoice = '1';
    st.textContent = t('photo.recordingLive');
    if (btn) { btn.textContent = t('photo.stopRecordLong'); btn.classList.add('recording'); }
    return;
  }
  if (btn) { btn.classList.remove('recording'); btn.textContent = t('photo.voiceSheetRecord'); }
  if (obj?.hasVoice) {
    st.dataset.hasVoice = '1';
    st.textContent = t('photo.voiceReady', { n: Math.round(obj.voiceDuration || 0) });
  } else {
    delete st.dataset.hasVoice;
    st.textContent = t('photo.noVoiceTap');
  }
}

function toggleFieldVoiceRecordFromSheet() {
  toggleFieldVoiceRecord();
}

function closeFieldPhotoVoiceSheet(skipOnly) {
  const sheet = document.getElementById('field-photo-voice-sheet');
  saveFieldPhotoDetail();
  if (sheet?._thumbUrl) { URL.revokeObjectURL(sheet._thumbUrl); sheet._thumbUrl = null; }
  sheet?.classList.remove('open');
  if (_fieldVoiceRec && _fieldVoiceRec.state === 'recording') _fieldVoiceRec.stop();
  if (!skipOnly) showHint(t('photo.ready'));
  scheduleRender();
}

async function openFieldPhotoEarthViewer(id) {
  const obj = S.objects.find(o => o.id === id);
  if (!obj || obj.type !== 'field_photo') return;
  normalizeFieldPhotoObject(obj);
  _fieldCtxPhotoId = id;
  S.selectedIds = [id];
  setDeleteButtonVisible(true);
  updateFieldRightPanel(obj);
  const ov = document.getElementById('field-photo-viewer');
  const img = document.getElementById('fpv-img');
  const title = document.getElementById('fpv-title');
  const foot = document.getElementById('fpv-foot');
  if (!ov || !img) return;
  if (title) title.textContent = obj.title || 'Fotoğraf';
  const guideBtn = document.getElementById('fpv-guide');
  if (guideBtn) guideBtn.style.display = resolveObjectGuidanceLatLon(obj) ? 'block' : 'none';
  if (foot) {
    foot.textContent = (obj.timestamp ? new Date(obj.timestamp).toLocaleString('tr-TR') : '') +
      (obj.lat != null ? '\n' + obj.lat.toFixed(5) + '°, ' + obj.lon.toFixed(5) + '°' : '') +
      (obj.gpsSource ? '\nKonum: ' + String(obj.gpsSource).toUpperCase() : '') +
      (obj.hasVoice ? '\n🎤 Sesli not (' + Math.round(obj.voiceDuration || 0) + ' sn)' : '');
  }
  const row = await getPhotoBlobRecord(obj.photoId, 'full');
  if (!row?.data) { showHint('Fotoğraf dosyası bulunamadı'); return; }
  if (ov._blobUrl) URL.revokeObjectURL(ov._blobUrl);
  ov._blobUrl = URL.createObjectURL(row.data);
  img.src = ov._blobUrl;
  ov.classList.add('open');
  closeNotePopup();
  const b = { minLat: obj.lat, maxLat: obj.lat, minLon: obj.lon, maxLon: obj.lon, ok: true };
  fitMapToLatLonBounds(b);
  buildLayerPanel();
  scheduleRender();
}

async function prefetchPhotoThumb(obj) {
  if (!obj || obj.type !== 'field_photo' || obj._thumbReady) return;
  const row = await getPhotoBlobRecord(obj.photoId, 'thumb');
  if (!row?.data) return;
  if (_photoThumbCache.has(obj.photoId)) {
    obj._thumbImg = _photoThumbCache.get(obj.photoId);
    obj._thumbReady = true;
    return;
  }
  const url = URL.createObjectURL(row.data);
  const img = new Image();
  img.onload = () => {
    obj._thumbImg = img;
    obj._thumbUrl = url;
    obj._thumbReady = true;
    _photoThumbCache.set(obj.photoId, img);
    scheduleRender();
  };
  img.src = url;
}

function preloadPhotoThumbs() {
  S.objects.filter(o => o.type === 'field_photo' && o.visible !== false).forEach(o => {
    prefetchPhotoThumb(o);
  });
}

function openFieldPhotoDetail(id) {
  const obj = S.objects.find(o => o.id === id);
  if (!obj || obj.type !== 'field_photo') return;
  normalizeFieldPhotoObject(obj);
  _fieldCtxPhotoId = id;
  S.selectedIds = [id];
  const panel = document.getElementById('right-panel');
  if (panel?.style.display === 'none') {
    panel.style.display = 'block';
    document.body.classList.add('field-panel-right');
  }
  updateFieldRightPanel(obj);
  loadFieldPhotoPreview(obj);
  const b = { minLat: obj.lat, maxLat: obj.lat, minLon: obj.lon, maxLon: obj.lon, ok: true };
  fitMapToLatLonBounds(b);
  scheduleRender();
}

async function loadFieldPhotoPreview(obj) {
  const imgEl = document.getElementById('field-photo-preview');
  if (!imgEl) return;
  if (_fieldPhotoPreviewUrl) URL.revokeObjectURL(_fieldPhotoPreviewUrl);
  const row = await getPhotoBlobRecord(obj.photoId, 'full');
  if (!row?.data) {
    imgEl.removeAttribute('src');
    return;
  }
  _fieldPhotoPreviewUrl = URL.createObjectURL(row.data);
  imgEl.src = _fieldPhotoPreviewUrl;
}

function viewFieldPhoto(id) { openFieldPhotoEarthViewer(id); }

function closeFieldPhotoViewer() {
  const ov = document.getElementById('field-photo-viewer');
  if (!ov) return;
  if (ov._blobUrl) URL.revokeObjectURL(ov._blobUrl);
  ov._blobUrl = null;
  ov.classList.remove('open');
  const img = document.getElementById('fpv-img');
  if (img) img.removeAttribute('src');
}

function centerMapOnSelectedPhoto() {
  const obj = S.objects.find(o => o.id === _fieldCtxPhotoId);
  if (!obj) return;
  const b = { minLat: obj.lat, maxLat: obj.lat, minLon: obj.lon, maxLon: obj.lon, ok: true };
  fitMapToLatLonBounds(b);
}

function saveFieldPhotoDetail() {
  const obj = S.objects.find(o => o.id === _fieldCtxPhotoId);
  if (!obj) return;
  const fpvsDesc = document.getElementById('field-fpvs-desc');
  const panelDesc = document.getElementById('field-photo-desc');
  const sheetOpen = document.getElementById('field-photo-voice-sheet')?.classList.contains('open');
  const text = (sheetOpen && fpvsDesc ? fpvsDesc.value : panelDesc?.value) || '';
  obj.description = text.trim();
  if (panelDesc) panelDesc.value = obj.description;
  if (fpvsDesc) fpvsDesc.value = obj.description;
  pushHistory();
  scheduleProjectSave();
  showHint('Fotoğraf kaydedildi');
}

async function deleteFieldPhotoById(objId) {
  const obj = S.objects.find(o => o.id === objId);
  if (!obj || obj.type !== 'field_photo') return;
  const db = await openProjectDb();
  await idbDelete(db, 'blobs', projectBlobKey(obj.photoId, 'full'));
  await idbDelete(db, 'blobs', projectBlobKey(obj.photoId, 'thumb'));
  await idbDelete(db, 'blobs', projectBlobKey(obj.photoId, 'audio'));
  await idbDelete(db, 'blobs', legacyPhotoBlobKey(obj.photoId));
  if (obj._thumbUrl) URL.revokeObjectURL(obj._thumbUrl);
  _photoThumbCache.delete(obj.photoId);
  S.objects = S.objects.filter(o => o.id !== objId);
  if (_fieldCtxPhotoId === objId) _fieldCtxPhotoId = null;
  if (_fieldPhotoPreviewUrl) { URL.revokeObjectURL(_fieldPhotoPreviewUrl); _fieldPhotoPreviewUrl = null; }
  closeFieldPhotoVoiceSheet(true);
  closeFieldPhotoViewer();
  S.selectedIds = [];
  pushHistory();
  buildLayerPanel();
  updateFieldRightPanel(null);
  scheduleProjectSave();
  scheduleRender();
  showHint(t('photo.deleted'));
}

function deleteFieldPhotoSelected() { deleteFieldPhotoById(_fieldCtxPhotoId); }

function updateFieldPhotoVoiceUi(obj) {
  const st = document.getElementById('field-voice-status');
  const play = document.getElementById('btn-voice-play');
  const del = document.getElementById('btn-voice-del');
  const rec = document.getElementById('btn-voice-record');
  if (!st) return;
  if (_fieldVoiceRec && _fieldVoiceRec.state === 'recording') {
    st.dataset.hasVoice = '1';
    st.textContent = t('photo.recording');
    if (rec) rec.textContent = t('photo.stopRecord');
    updateFieldPhotoVoiceSheetUi(obj);
    return;
  }
  if (rec) rec.textContent = t('photo.record');
  if (obj?.hasVoice) {
    st.dataset.hasVoice = '1';
    st.textContent = t('photo.voiceDur', { n: Math.round(obj.voiceDuration || 0) });
    if (play) play.disabled = false;
    if (del) del.disabled = false;
  } else {
    delete st.dataset.hasVoice;
    st.textContent = t('photo.noVoice');
    if (play) play.disabled = true;
    if (del) del.disabled = true;
  }
  updateFieldPhotoVoiceSheetUi(obj);
}

function fieldVoiceRecorderMime() {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
  for (const m of types) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return 'audio/webm';
}

async function requestFieldMicrophoneStream() {
  if (typeof FieldPermissions !== 'undefined') {
    const ok = await FieldPermissions.request('microphone', { hintDenied: t('photo.micDenied') });
    if (!ok) return null;
  }
  if (!navigator.mediaDevices?.getUserMedia) return null;
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
  } catch (e) {
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError');
    showHint(denied ? t('photo.micDenied') : t('photo.micRequired'));
    return null;
  }
}

async function ensureFieldDictationMicPermission() {
  if (typeof FieldPermissions !== 'undefined') {
    return FieldPermissions.request('microphone', { hintDenied: t('dictation.micDenied') });
  }
  const plugin = getPlanAIDictationPlugin();
  if (plugin) {
    try {
      if (typeof plugin.checkPermissions === 'function') {
        let st = await plugin.checkPermissions();
        if (st?.microphone === 'granted') return true;
        if (typeof plugin.requestPermissions === 'function') {
          st = await plugin.requestPermissions();
          if (st?.microphone === 'granted') return true;
        }
        showHint(t('dictation.micDenied'));
        return false;
      }
    } catch (_) {}
  }
  const stream = await requestFieldMicrophoneStream();
  if (stream) {
    stream.getTracks().forEach(tr => tr.stop());
    return true;
  }
  return false;
}

function fieldDictationNoEngine(msg) {
  const m = String(msg || '').toLowerCase();
  return /not available|no engine|recognition|recognizer/.test(m);
}

function fieldDictationErrorHint(msg) {
  const m = String(msg || '').toLowerCase();
  if (/cancel/.test(m)) return t('dictation.cancelled');
  if (/permission|denied|not allowed/.test(m)) return t('dictation.micDenied');
  if (fieldDictationNoEngine(m)) return t('dictation.noEngine');
  return t('dictation.fail');
}

let _fieldWebDictation = null;
let _fieldDictationTargetId = null;
let _fieldDictateBusy = false;
let _fieldDictationBase = '';
let _fieldDictationCommitted = '';
let _fieldDictationInterim = '';
let _fieldDictationPartialListener = null;

function getPlanAIDictationPlugin() {
  const cap = window.Capacitor;
  if (!cap) return null;
  if (cap.Plugins?.PlanAIDictation) return cap.Plugins.PlanAIDictation;
  try { return cap.registerPlugin?.('PlanAIDictation'); } catch (_) { return null; }
}

function fieldDictationLang() {
  return PA_LANG === 'en' ? 'en-US' : 'tr-TR';
}

function setFieldDictationUi(statusId, listening, msg) {
  document.querySelectorAll('.field-dictate-btn.active').forEach(b => b.classList.remove('active'));
  if (listening && _fieldDictationTargetId) {
    const btn = document.querySelector('.field-dictate-btn[onclick*="' + _fieldDictationTargetId + '"]');
    if (btn) btn.classList.add('active');
  }
  if (statusId) {
    const el = document.getElementById(statusId);
    if (el) el.textContent = msg || (listening ? t('dictation.listening') : '');
  }
}

function composeFieldDictationValue() {
  let s = _fieldDictationBase || '';
  if (_fieldDictationCommitted) s = s ? (s + ' ' + _fieldDictationCommitted) : _fieldDictationCommitted;
  if (_fieldDictationInterim) s = s ? (s + ' ' + _fieldDictationInterim) : _fieldDictationInterim;
  return s;
}

function beginFieldDictationSession(textarea) {
  _fieldDictationBase = (textarea?.value || '').trimEnd();
  _fieldDictationCommitted = '';
  _fieldDictationInterim = '';
  textarea?.classList.add('field-dictating');
}

function endFieldDictationSession(textarea) {
  textarea?.classList.remove('field-dictating');
  _fieldDictationBase = '';
  _fieldDictationCommitted = '';
  _fieldDictationInterim = '';
}

function updateFieldDictationLive(textarea, statusId, text, isFinal) {
  if (!textarea) return;
  const chunk = String(text || '').trim();
  if (isFinal) {
    if (chunk) {
      _fieldDictationCommitted = _fieldDictationCommitted
        ? (_fieldDictationCommitted + ' ' + chunk).trim()
        : chunk;
    }
    _fieldDictationInterim = '';
  } else {
    _fieldDictationInterim = chunk;
  }
  const composed = composeFieldDictationValue();
  const atEnd = textarea.selectionStart >= (textarea.value?.length || 0) - 1;
  if (textarea.value !== composed) {
    textarea.value = composed;
    if (atEnd || document.activeElement !== textarea) {
      textarea.selectionStart = textarea.selectionEnd = composed.length;
    }
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }
  if (statusId) {
    const el = document.getElementById(statusId);
    if (el) {
      if (_fieldDictationInterim) {
        el.innerHTML = t('dictation.listening') + ' <span class="dict-live-interim">' + escapeHtml(_fieldDictationInterim) + '</span>';
      } else {
        el.textContent = t('dictation.listening');
      }
    }
  }
}

function appendFieldDictationText(textarea, text) {
  if (!textarea || !text) return;
  updateFieldDictationLive(textarea, null, text, true);
}

async function removeFieldDictationPartialListener() {
  if (_fieldDictationPartialListener) {
    try { await _fieldDictationPartialListener.remove(); } catch (_) {}
    _fieldDictationPartialListener = null;
  }
}

function stopFieldWebDictation() {
  if (_fieldWebDictation) {
    try { _fieldWebDictation.stop(); } catch (_) {}
    try { _fieldWebDictation.abort(); } catch (_) {}
    _fieldWebDictation = null;
  }
}

async function toggleFieldDictation(textareaId, statusId) {
  const ta = document.getElementById(textareaId);
  if (!ta) return;
  if (_fieldDictationTargetId === textareaId && (_fieldWebDictation || _fieldDictateBusy)) {
    stopFieldWebDictation();
    removeFieldDictationPartialListener();
    endFieldDictationSession(ta);
    _fieldDictationTargetId = null;
    _fieldDictateBusy = false;
    setFieldDictationUi(statusId, false, '');
    return;
  }
  stopFieldWebDictation();
  _fieldDictationTargetId = textareaId;
  setFieldDictationUi(statusId, true, t('dictation.listening'));

  beginFieldDictationSession(ta);

  if (isCapacitorNative()) {
    const plugin = getPlanAIDictationPlugin();
    if (plugin?.start) {
      const micOk = await ensureFieldDictationMicPermission();
      if (!micOk) {
        endFieldDictationSession(ta);
        setFieldDictationUi(statusId, false, '');
        _fieldDictationTargetId = null;
        return;
      }
      _fieldDictateBusy = true;
      await removeFieldDictationPartialListener();
      if (plugin.addListener) {
        try {
          _fieldDictationPartialListener = await plugin.addListener('partialResult', ev => {
            if (_fieldDictationTargetId === textareaId) {
              updateFieldDictationLive(ta, statusId, ev?.text || '', false);
            }
          });
        } catch (_) {}
      }
      try {
        const res = await plugin.start({ language: fieldDictationLang(), prompt: t('dictation.prompt') });
        if (res?.text) updateFieldDictationLive(ta, statusId, res.text, true);
        endFieldDictationSession(ta);
        setFieldDictationUi(statusId, false, t('dictation.done'));
        showHint(t('dictation.done'));
      } catch (e) {
        const msg = String(e?.message || e || '');
        if (fieldDictationNoEngine(msg)) {
          _fieldDictateBusy = false;
          await removeFieldDictationPartialListener();
          const webOk = await startFieldWebDictation(ta, statusId, true);
          if (!webOk) {
            endFieldDictationSession(ta);
            setFieldDictationUi(statusId, false, '');
            _fieldDictationTargetId = null;
            showHint(t('dictation.noEngine') + ' — ' + t('dictation.noEngineHint'), 10000);
          }
          return;
        }
        endFieldDictationSession(ta);
        setFieldDictationUi(statusId, false, /cancel/i.test(msg) ? t('dictation.cancelled') : '');
        showHint(fieldDictationErrorHint(msg));
      } finally {
        _fieldDictateBusy = false;
        await removeFieldDictationPartialListener();
        if (!_fieldWebDictation) _fieldDictationTargetId = null;
      }
      return;
    }
  }
  await startFieldWebDictation(ta, statusId);
}

function startFieldWebDictation(ta, statusId, silentFail) {
  return new Promise(resolve => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      endFieldDictationSession(ta);
      setFieldDictationUi(statusId, false, '');
      _fieldDictationTargetId = null;
      if (!silentFail) showHint(t('dictation.unsupported'));
      resolve(false);
      return;
    }
    let settled = false;
    let gotSpeech = false;
    const finish = ok => {
      if (settled) return;
      settled = true;
      resolve(!!ok);
    };
    const cleanup = (doneMsg) => {
      endFieldDictationSession(ta);
      _fieldWebDictation = null;
      if (_fieldDictationTargetId === ta.id) {
        setFieldDictationUi(statusId, false, doneMsg || '');
        _fieldDictationTargetId = null;
      }
    };
    const rec = new SR();
    rec.lang = fieldDictationLang();
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.continuous = true;
    _fieldWebDictation = rec;
    rec.onresult = ev => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const text = r[0]?.transcript || '';
        if (!text) continue;
        gotSpeech = true;
        updateFieldDictationLive(ta, statusId, text, r.isFinal);
      }
    };
    rec.onerror = ev => {
      if (ev.error === 'aborted') { cleanup(''); finish(false); return; }
      if (ev.error === 'no-speech' && gotSpeech) { try { rec.stop(); } catch (_) {} return; }
      if (!silentFail) {
        if (ev.error === 'not-allowed') showHint(t('dictation.micDenied'));
        else if (ev.error !== 'no-speech') showHint(t('dictation.fail'));
      }
      cleanup('');
      finish(false);
    };
    rec.onend = () => {
      if (_fieldWebDictation === rec && _fieldDictationTargetId === ta.id && !settled) {
        if (gotSpeech) {
          cleanup(t('dictation.done'));
          showHint(t('dictation.done'));
          finish(true);
          return;
        }
        try {
          rec.start();
          return;
        } catch (_) {}
      }
      cleanup(gotSpeech ? t('dictation.done') : '');
      if (gotSpeech) showHint(t('dictation.done'));
      finish(gotSpeech);
    };
    try {
      rec.start();
    } catch (_) {
      if (!silentFail) showHint(t('dictation.fail'));
      cleanup('');
      finish(false);
    }
  });
}

function initFieldBrandLogo() {
  const img = document.getElementById('field-brand-logo');
  if (!img) return;
  const asset = FIELD_REPORT_LOGO_ASSET;
  const probe = new Image();
  probe.onload = () => { img.src = asset; };
  probe.onerror = () => {};
  probe.src = asset + '?v=1';
}

async function toggleFieldVoiceRecord() {
  const obj = S.objects.find(o => o.id === _fieldCtxPhotoId);
  if (!obj) return;
  if (_fieldVoiceRec && _fieldVoiceRec.state === 'recording') {
    try { _fieldVoiceRec.requestData(); } catch (_) {}
    _fieldVoiceRec.stop();
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    showHint(t('photo.micUnsupported'));
    return;
  }
  const stream = await requestFieldMicrophoneStream();
  if (!stream) return;
  try {
    _fieldVoiceChunks = [];
    const mime = fieldVoiceRecorderMime();
    _fieldVoiceRec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    _fieldVoiceRec.ondataavailable = e => { if (e.data?.size) _fieldVoiceChunks.push(e.data); };
    _fieldVoiceRec.onstop = async () => {
      stream.getTracks().forEach(tr => tr.stop());
      const dur = Math.max(1, Math.round((Date.now() - _fieldVoiceStart) / 1000));
      const outMime = _fieldVoiceRec.mimeType || mime || 'audio/webm';
      const blob = new Blob(_fieldVoiceChunks, { type: outMime });
      if (!blob.size) {
        _fieldVoiceRec = null;
        showHint(PA_LANG === 'tr' ? 'Ses kaydı boş — tekrar deneyin' : 'Empty recording — try again');
        return;
      }
      const db = await openProjectDb();
      await idbPut(db, 'blobs', { key: projectBlobKey(obj.photoId, 'audio'), data: blob, mime: outMime });
      obj.hasVoice = true;
      obj.voiceDuration = dur;
      pushHistory();
      scheduleProjectSave();
      updateFieldPhotoVoiceUi(obj);
      const sheet = document.getElementById('field-photo-voice-sheet');
      if (sheet?.classList.contains('open')) updateFieldPhotoVoiceSheetUi(obj);
      showHint('Sesli not kaydedildi (' + dur + ' sn)');
      _fieldVoiceRec = null;
    };
    _fieldVoiceRec.onerror = () => {
      stream.getTracks().forEach(tr => tr.stop());
      _fieldVoiceRec = null;
      showHint(t('photo.micUnsupported'));
    };
    _fieldVoiceStart = Date.now();
    _fieldVoiceRec.start(250);
    updateFieldPhotoVoiceUi(obj);
    const sheet = document.getElementById('field-photo-voice-sheet');
    if (sheet?.classList.contains('open')) updateFieldPhotoVoiceSheetUi(obj);
    if (isCapacitorNative()) showHint(t('photo.micPrompt'));
  } catch (_) {
    stream.getTracks().forEach(tr => tr.stop());
    showHint(t('photo.micUnsupported'));
  }
}

async function playFieldVoiceNote() {
  const obj = S.objects.find(o => o.id === _fieldCtxPhotoId);
  if (!obj?.hasVoice) return;
  const row = await getPhotoBlobRecord(obj.photoId, 'audio');
  const src = await resolvePhotoAudioPlaySrc(row);
  if (!src) { showHint('Ses dosyası bulunamadı'); return; }
  if (_fieldVoicePlayUrl) URL.revokeObjectURL(_fieldVoicePlayUrl);
  _fieldVoicePlayUrl = src.startsWith('blob:') ? src : null;
  const a = new Audio(src);
  try {
    await a.play();
    showHint('Oynatılıyor…');
  } catch (_) {
    showHint(PA_LANG === 'tr' ? 'Ses oynatılamadı' : 'Could not play audio');
  }
}

async function deleteFieldVoiceNote() {
  const obj = S.objects.find(o => o.id === _fieldCtxPhotoId);
  if (!obj) return;
  const db = await openProjectDb();
  await idbDelete(db, 'blobs', projectBlobKey(obj.photoId, 'audio'));
  obj.hasVoice = false;
  obj.voiceDuration = 0;
  pushHistory();
  scheduleProjectSave();
  updateFieldPhotoVoiceUi(obj);
  showHint('Sesli not silindi');
}

function readExifGps(file) {
  return new Promise(resolve => {
    if (typeof EXIF === 'undefined') return resolve(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = function() {
      EXIF.getData(img, function() {
        try {
          const lat = EXIF.getTag(this, 'GPSLatitude');
          const lon = EXIF.getTag(this, 'GPSLongitude');
          const latRef = EXIF.getTag(this, 'GPSLatitudeRef');
          const lonRef = EXIF.getTag(this, 'GPSLongitudeRef');
          URL.revokeObjectURL(url);
          if (!lat || !lon) return resolve(null);
          let la = dmsToDec(lat, latRef);
          let lo = dmsToDec(lon, lonRef);
          if (typeof SpatialSecurity !== 'undefined') {
            const v = SpatialSecurity.validateExifGps(la, lo, latRef, lonRef);
            if (!v) return resolve(null);
            la = v.lat;
            lo = v.lon;
          } else if (isNaN(la) || isNaN(lo)) {
            return resolve(null);
          }
          resolve({ lat: la, lon: lo });
        } catch (_) { URL.revokeObjectURL(url); resolve(null); }
      });
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

function dmsToDec(dms, ref) {
  const d = dms[0] + dms[1] / 60 + (dms[2] || 0) / 3600;
  return (ref === 'S' || ref === 'W') ? -d : d;
}

function applyFieldModeBoot() {
  if (!FIELD_MODE) return;
  if (typeof FieldAccessGate !== 'undefined') {
    FieldAccessGate.init();
    if (!FieldAccessGate.hasPin() && !FieldAccessGate.hasDeferredPin()) {
      FieldAccessGate.deferPin();
    }
  }
  const hubEl = document.getElementById('field-journey-hub-overlay');
  if (hubEl && hubEl.parentElement !== document.body) document.body.appendChild(hubEl);
  const secEl = document.getElementById('field-security-settings-overlay');
  if (secEl && secEl.parentElement !== document.body) document.body.appendChild(secEl);
  try { localStorage.setItem('planai_render_stats', '0'); } catch (_) {}
  document.getElementById('render-stats-overlay')?.remove();
  ensureFieldBasemapOn();
  const osmBtn = document.getElementById('btn-osm');
  if (osmBtn) osmBtn.classList.add('active');
  updateBasemapDockUi();
  if (location.protocol === 'file:') {
    showHint('Altlık için dosyayı çift tıklamak yerine yerel sunucu kullanın (ör. npx serve)', 9000);
  }
  S.planningCat = 'none';
  S.showPafta = false;
  if (LAYOUT.mode !== 'off') cancelLayoutDraw();
  document.body.classList.add('field-panel-right');
  document.body.classList.remove('field-panel-right-hidden');
  initFieldInteractionUx();
  initFieldBrandLogo();
  setDeleteButtonVisible(false);
  sanitizeFieldProjectLayers();
  if (S.tool === 'point' || S.tool === 'line') setTool('select');
  updateActiveToolPanelLabels(S.tool);
  initFieldDrawSettingsPanel();
  document.body.classList.add('field-tool-select');
  updateFieldPanelForTool(S.tool);
  requestAnimationFrame(syncFieldDockMetrics);
  setAppLanguage(PA_LANG);
  updateGpsTrackHud();
  if (typeof MpyyPlanGmlCatalog !== 'undefined') {
    MpyyPlanGmlCatalog.load().then((ok) => {
      if (ok) {
        refreshPlanGmlPresentation();
        scheduleRender();
      }
    });
  }
}

// ═══ Field UX — Finger / Pen modes, touch, contextual panel ═══
let FIELD_INTERACTION = 'finger';
const _fieldPointers = new Map();
let _pinchDist0 = null;
let _pinchScale0 = null;
let _pinchMid0 = null;
let _fieldTouch = null;
let _fieldLastPointerAt = 0;
const FIELD_TAP_VERTEX_MOVE_PX = 12;
const FIELD_GHOST_MOUSE_MS = 700;
let _fieldMoreTimer = null;
let _fieldCtxNoteId = null;

const FIELD_DRAW_TOOLS = new Set(['polyline','polygon','text','eraser','freedraw','field-note','circle']);

function initFieldInteractionUx() {
  if (!FIELD_MODE) return;
  setFieldInteractionMode('finger', false);
  ensurePhotosLayer();
  ensureGpsLayer();
  updateFieldCtxProject();
  updateFieldDrawFab();
  preloadPhotoThumbs();
  setGpsStatus('off');
  updateGpsHud();
  document.addEventListener('click', e => {
    const m = document.getElementById('field-more-menu');
    if (m) m.style.display = 'none';
    const mapMenu = document.getElementById('field-map-menu');
    if (mapMenu && mapMenu.style.display === 'flex' && !mapMenu.contains(e.target)) {
      hideFieldMapContextMenu();
    }
  });
  window.addEventListener('resize', () => {
    const m = document.getElementById('field-more-menu');
    if (m && m.style.display === 'flex') positionFieldMoreMenu();
  });
  window.addEventListener('orientationchange', () => {
    setTimeout(() => {
      const m = document.getElementById('field-more-menu');
      if (m && m.style.display === 'flex') positionFieldMoreMenu();
      initNoteHandCanvas();
      fitFieldTopBar();
      fieldOnboardRepositionActiveStep();
    }, 200);
  });
  window.addEventListener('resize', () => fieldOnboardRepositionActiveStep());
  window.addEventListener('online', onFieldNetworkOnline);
  window.addEventListener('offline', updateFieldOfflineUi);
  updateFieldOfflineUi();
  initFieldResponsiveLayout();
  requestAnimationFrame(() => {
    ensureFieldBasemapOn();
    if (S.basemap !== 'none') {
      warmViewportTilesFromDb();
      scheduleRender();
      scheduleBasemapRefresh(600);
    }
  });
}

function fieldOnboardRepositionActiveStep() {
  if (!_fieldOnboardOpen || _fieldOnboardIdx < 0) return;
  const step = FIELD_ONBOARD_STEPS[_fieldOnboardIdx];
  if (!step || step.welcome) return;
  const rect = fieldOnboardUnionRect(fieldOnboardTargets(step));
  fieldOnboardPositionSpotlight(rect);
  fieldOnboardPositionCard(rect);
}

function updateFieldMobileViewportClass() {
  if (!FIELD_MODE) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  document.body.classList.toggle('field-viewport-phone', w <= 600);
  document.body.classList.toggle('field-viewport-tablet', w > 600 && w <= 1024);
  document.body.classList.toggle('field-viewport-short', h <= 520);
  document.body.classList.toggle('field-viewport-landscape', w > h);
}

function initFieldResponsiveLayout() {
  if (!FIELD_MODE) return;
  const topBar = document.getElementById('top-bar');
  const onLayout = () => requestAnimationFrame(() => {
    updateFieldMobileViewportClass();
    fitFieldTopBar();
    syncFieldTopbarHeight();
  });
  if (topBar) {
    const ro = new ResizeObserver(onLayout);
    ro.observe(topBar);
  }
  onLayout();
  window.addEventListener('resize', onLayout);
  window.addEventListener('orientationchange', () => setTimeout(onLayout, 160));
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onLayout);
    window.visualViewport.addEventListener('scroll', onLayout);
  }
}

function syncFieldTopbarHeight() {
  const bar = document.getElementById('top-bar');
  if (!bar || !FIELD_MODE) return;
  const h = Math.ceil(bar.getBoundingClientRect().height) || 46;
  document.documentElement.style.setProperty('--field-topbar-h', h + 'px');
}

function fitFieldTopBar() {
  const topBar = document.getElementById('top-bar');
  if (!topBar || !FIELD_MODE) return;
  document.body.classList.remove('field-top-overflow-1', 'field-top-overflow-2', 'field-top-overflow-3');
  let guard = 0;
  while (topBar.scrollWidth > topBar.clientWidth + 2 && guard < 3) {
    guard++;
    document.body.classList.add('field-top-overflow-' + guard);
  }
}

function setFieldInteractionMode(mode, fromStylus) {
  if (!FIELD_MODE) return;
  FIELD_INTERACTION = mode === 'pen' ? 'pen' : 'finger';
  document.body.classList.toggle('finger-mode', FIELD_INTERACTION === 'finger');
  document.body.classList.toggle('pen-mode', FIELD_INTERACTION === 'pen');
  document.getElementById('btn-finger-mode')?.classList.toggle('active', FIELD_INTERACTION === 'finger');
  document.getElementById('btn-pen-mode')?.classList.toggle('active', FIELD_INTERACTION === 'pen');
  const lbl = document.getElementById('field-mode-label');
  if (lbl) lbl.textContent = FIELD_INTERACTION === 'pen' ? t('mode.pen') : t('mode.finger');
  if (FIELD_INTERACTION === 'finger') {
    showHint(fromStylus ? '' : t('hint.finger'));
  } else {
    showHint(fromStylus ? t('hint.penDetected') : t('hint.pen'));
  }
}

function fieldActiveDrawTool() {
  if (!isFieldDrawTool(S.tool) || S.tool === 'select' || S.tool === 'field-note') return false;
  if (S.polyActive || S.plSession) return true;
  if (S.selectedIds.length && S.tool === 'circle') return false;
  return true;
}

function fieldTapVertexTool() {
  return FIELD_MODE && (S.tool === 'polyline' || S.tool === 'spline' || S.tool === 'polygon');
}

function fieldTapVertexPointer(pointerType) {
  return pointerType === 'touch' || pointerType === 'pen';
}

function fieldSuppressGhostMouse() {
  return FIELD_MODE && _fieldLastPointerAt > 0 && (Date.now() - _fieldLastPointerAt) < FIELD_GHOST_MOUSE_MS;
}

function fieldAddDrawVertex(wp) {
  const pt = snapPt(wp.x, wp.y);
  if (S.tool === 'polygon') {
    if (!S.polyActive) startPolygon();
    if (nearFirstVertex(pt.x, pt.y)) { finishPolygon(); return; }
    S.polyPts.push(pt.x, pt.y);
    updateFieldDrawFab();
    scheduleRender();
    return;
  }
  if (S.tool === 'polyline' || S.tool === 'spline') {
    if (!S.plSession) startPlSession(S.tool === 'spline');
    if (S.plVerts.length >= 2) {
      const first = S.plVerts[0];
      if (Math.hypot(pt.x - first.x, pt.y - first.y) < 10 / S.scale) {
        finishPlSession();
        return;
      }
    }
    S.plVerts.push({ x: pt.x, y: pt.y });
    updateFieldDrawFab();
    scheduleRender();
  }
}

function fieldStylusDrawMode() {
  return FIELD_MODE && FIELD_INTERACTION === 'pen';
}

function fieldDrawingAllowed(pointerType) {
  if (!FIELD_MODE) return true;
  if (fieldStylusDrawMode() && pointerType === 'pen') {
    if (S.tool === 'select' || S.tool === 'info' || S.tool === 'field-note') return false;
    return true;
  }
  if (fieldActiveDrawTool()) {
    return pointerType === 'pen' || pointerType === 'mouse' || pointerType === 'touch';
  }
  if (FIELD_INTERACTION === 'pen') return pointerType === 'mouse';
  return pointerType === 'mouse';
}

function fieldNavigationPointer(pointerType) {
  if (!FIELD_MODE) return false;
  if (S.tool === 'info') return false;
  if (fieldStylusDrawMode() && pointerType === 'pen') return false;
  if (fieldActiveDrawTool()) return false;
  if (pointerType === 'touch') return true;
  if (FIELD_INTERACTION === 'finger' && pointerType !== 'pen') return true;
  if (FIELD_INTERACTION === 'pen' && pointerType === 'touch') return true;
  return false;
}

function isFieldDrawTool(t) {
  return FIELD_DRAW_TOOLS.has(t) || t === 'field-note';
}

function buildFieldMoreMenu() {
  const m = document.getElementById('field-more-menu');
  if (!m) return;
  const items = [
    ['Metin etiketi', () => setTool('text')],
    ['Serbest çizim', () => setTool('freedraw')],
    ['Silgi', () => setTool('eraser')],
    ['📷 Fotoğraf çek', () => activateFieldPhotoTool()],
    ['Dosya içe aktar', () => onFieldImportClick()],
    ['Izgara', () => toggleGrid()],
    ['Snap', () => toggleSnap()],
    ['Geri al', () => undo()],
  ];
  m.innerHTML = '';
  items.forEach(([label, fn]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = e => { e.stopPropagation(); m.style.display = 'none'; fn(); };
    m.appendChild(b);
  });
}

function fieldMorePressStart(e) {
  clearTimeout(_fieldMoreTimer);
  _fieldMoreTimer = setTimeout(() => {
    toggleFieldMoreMenu(e, true);
  }, 520);
}
function fieldMorePressEnd() {
  clearTimeout(_fieldMoreTimer);
}

function positionFieldMoreMenu() {
  const m = document.getElementById('field-more-menu');
  const btn = document.getElementById('btn-field-more');
  if (!m || !btn) return;
  const r = btn.getBoundingClientRect();
  const dockH = getFieldDockH() + 12;
  const safeB = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('env(safe-area-inset-bottom)')) || 0;
  const bottomEdge = window.innerHeight - dockH - safeB - 8;
  const maxH = Math.max(120, bottomEdge - r.top);
  m.style.maxHeight = maxH + 'px';
  m.style.top = Math.max(8, Math.min(r.top, bottomEdge - 48)) + 'px';
  m.style.left = (r.right + 8) + 'px';
  m.style.right = 'auto';
  m.style.bottom = 'auto';
  const menuW = m.offsetWidth || 180;
  if (r.right + 8 + menuW > window.innerWidth - 8) {
    m.style.left = Math.max(r.right + 8, window.innerWidth - menuW - 8) + 'px';
  }
}

function toggleFieldMoreMenu(e, fromLong) {
  if (e) e.stopPropagation();
  const m = document.getElementById('field-more-menu');
  const btn = document.getElementById('btn-field-more');
  if (!m || !btn) return;
  const open = m.style.display === 'flex';
  if (open && !fromLong) { m.style.display = 'none'; return; }
  m.style.display = 'flex';
  positionFieldMoreMenu();
}

// ═══ Field onboarding tour ═══════════════════════════════════
const FIELD_ONBOARD_LS = 'planai_field_onboarding_v2';
let _fieldOnboardIdx = -1;
let _fieldOnboardOpen = false;

const FIELD_ONBOARD_STEPS = [
  { welcome: true, title: 'onboard.welcome.title', body: 'onboard.welcome.body' },
  { sel: '#btn-dock-projects', title: 'onboard.s1.title', body: 'onboard.s1.body' },
  { sel: '#btn-dock-import', title: 'onboard.s2.title', body: 'onboard.s2.body' },
  { sel: '#btn-field-info-tool', title: 'onboard.s3.title', body: 'onboard.s3.body' },
  { sel: '#loc-search', title: 'onboard.s4.title', body: 'onboard.s4.body' },
  { sel: '#btn-field-gps', title: 'onboard.s5.title', body: 'onboard.s5.body',
    before: () => {
      const hud = document.getElementById('gps-hud');
      if (hud && hud.style.display === 'none') toggleFieldGps();
    } },
  { sel: '#btn-dock-photo', title: 'onboard.s6.title', body: 'onboard.s6.body' },
  { sel: '#btn-dock-notes', title: 'onboard.s7.title', body: 'onboard.s7.body' },
  { sel: '#btn-dock-basemap', title: 'onboard.s8.title', body: 'onboard.s8.body' },
  { sel: '#field-mode-chip', title: 'onboard.s9.title', body: 'onboard.s9.body' },
  { sel: '#left-bar .field-main-tool[data-tool="polyline"]', title: 'onboard.s10.title', body: 'onboard.s10.body' },
  { sel: '#left-bar .field-main-tool[data-tool="polygon"]', title: 'onboard.s11.title', body: 'onboard.s11.body' },
  { sel: '#left-bar .field-main-tool[data-tool="circle"]', title: 'onboard.s12.title', body: 'onboard.s12.body' },
  { sel: '#sec-layers', title: 'onboard.s13.title', body: 'onboard.s13.body',
    before: () => {
      const rp = document.getElementById('right-panel');
      if (rp && rp.style.display === 'none') {
        rp.style.display = 'block';
        document.getElementById('right-toggle').textContent = '▶';
        document.body.classList.add('field-panel-right');
      }
      const body = document.getElementById('sec-layers');
      if (body) body.style.maxHeight = '2000px';
      const arrow = document.getElementById('sec-layers-arrow');
      if (arrow) arrow.classList.add('open');
      buildLayerPanel();
    } },
  { sel: '#field-draw-settings-panel', title: 'onboard.s14.title', body: 'onboard.s14.body',
    before: () => {
      setTool('polyline');
      const rp = document.getElementById('right-panel');
      if (rp && rp.style.display === 'none') {
        rp.style.display = 'block';
        document.body.classList.add('field-panel-right');
      }
    } },
  { sels: ['button.proj-btn.report[data-i18n="project.reportPdf"]', 'button.proj-btn.report[data-i18n="project.reportInteractive"]'],
    title: 'onboard.s15.title', body: 'onboard.s15.body',
    before: () => openProjectPanel() },
];

function fieldOnboardTargets(step) {
  const sels = step.sels || (step.sel ? [step.sel] : []);
  const nodes = sels.map(s => document.querySelector(s)).filter(Boolean);
  if (!nodes.length && step.sel) {
    const one = document.querySelector(step.sel);
    if (one) nodes.push(one);
  }
  return nodes;
}

function fieldOnboardUnionRect(nodes) {
  if (!nodes.length) return null;
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  nodes.forEach(n => {
    const rc = n.getBoundingClientRect();
    l = Math.min(l, rc.left); t = Math.min(t, rc.top);
    r = Math.max(r, rc.right); b = Math.max(b, rc.bottom);
  });
  const pad = 8;
  return { left: l - pad, top: t - pad, width: r - l + pad * 2, height: b - t + pad * 2 };
}

function fieldOnboardPositionCard(rect) {
  const card = document.getElementById('field-onboard-card');
  if (!card || !rect) return;
  card.classList.remove('welcome');
  card.style.transform = '';
  const cw = card.offsetWidth || 320;
  const ch = card.offsetHeight || 180;
  const margin = 14;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = rect.top + rect.height + margin;
  let left = rect.left + rect.width / 2 - cw / 2;
  if (top + ch > vh - margin) top = rect.top - ch - margin;
  if (top < margin) top = margin;
  left = Math.max(margin, Math.min(left, vw - cw - margin));
  card.style.left = left + 'px';
  card.style.top = top + 'px';
}

function fieldOnboardPositionSpotlight(rect) {
  const spot = document.getElementById('field-onboard-spot');
  if (!spot) return;
  if (!rect) {
    spot.classList.remove('visible');
    return;
  }
  spot.style.left = rect.left + 'px';
  spot.style.top = rect.top + 'px';
  spot.style.width = Math.max(24, rect.width) + 'px';
  spot.style.height = Math.max(24, rect.height) + 'px';
  spot.classList.add('visible');
}

function fieldOnboardUpdateUi() {
  const badge = document.getElementById('field-onboard-badge');
  const title = document.getElementById('field-onboard-title');
  const body = document.getElementById('field-onboard-body');
  const stepEl = document.getElementById('field-onboard-step');
  const skip = document.getElementById('field-onboard-skip');
  const prev = document.getElementById('field-onboard-prev');
  const next = document.getElementById('field-onboard-next');
  if (badge) badge.textContent = t('onboard.badge');
  if (skip) skip.textContent = t('onboard.skip');
  if (prev) prev.textContent = t('onboard.prev');
}

function fieldOnboardShowStep(idx) {
  const step = FIELD_ONBOARD_STEPS[idx];
  if (!step) return;
  _fieldOnboardIdx = idx;
  fieldOnboardUpdateUi();
  const title = document.getElementById('field-onboard-title');
  const body = document.getElementById('field-onboard-body');
  const stepEl = document.getElementById('field-onboard-step');
  const prev = document.getElementById('field-onboard-prev');
  const next = document.getElementById('field-onboard-next');
  const card = document.getElementById('field-onboard-card');
  if (title) title.textContent = t(step.title);
  if (body) body.textContent = t(step.body);
  const tourSteps = FIELD_ONBOARD_STEPS.length - 1;
  if (stepEl) {
    stepEl.textContent = step.welcome ? '' : t('onboard.stepOf', { n: idx, t: tourSteps });
  }
  if (prev) prev.style.display = idx > 0 ? '' : 'none';
  if (next) next.textContent = step.welcome ? t('onboard.start') : (idx >= FIELD_ONBOARD_STEPS.length - 1 ? t('onboard.done') : t('onboard.next'));
  if (typeof step.before === 'function') step.before();
  requestAnimationFrame(() => {
    if (step.welcome) {
      if (card) {
        card.classList.add('welcome');
        card.style.left = '';
        card.style.top = '';
      }
      fieldOnboardPositionSpotlight(null);
      return;
    }
    const nodes = fieldOnboardTargets(step);
    const rect = fieldOnboardUnionRect(nodes);
    if (card) card.classList.remove('welcome');
    fieldOnboardPositionSpotlight(rect);
    fieldOnboardPositionCard(rect);
    nodes[0]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  });
}

function fieldOnboardCleanup() {
  closeProjectPanel();
  const notes = document.getElementById('field-notes-panel');
  if (notes?.classList.contains('open')) closeFieldNotes();
}

function fieldOnboardFinish(skipped) {
  const root = document.getElementById('field-onboard-root');
  if (root) {
    root.classList.remove('active');
    root.setAttribute('aria-hidden', 'true');
  }
  document.body.classList.remove('field-onboarding-active');
  _fieldOnboardOpen = false;
  fieldOnboardCleanup();
  try { localStorage.setItem(FIELD_ONBOARD_LS, skipped ? 'skipped' : 'done'); } catch (_) {}
  if (!skipped) showHint(t('onboard.finished'));
}

function fieldOnboardSkip() {
  if (!_fieldOnboardOpen) return;
  fieldOnboardFinish(true);
}

function fieldOnboardNext() {
  if (!_fieldOnboardOpen) return;
  if (_fieldOnboardIdx >= FIELD_ONBOARD_STEPS.length - 1) {
    fieldOnboardFinish(false);
    return;
  }
  fieldOnboardShowStep(_fieldOnboardIdx + 1);
}

function fieldOnboardPrev() {
  if (!_fieldOnboardOpen || _fieldOnboardIdx <= 0) return;
  fieldOnboardShowStep(_fieldOnboardIdx - 1);
}

function startFieldOnboarding(force) {
  if (!FIELD_MODE) return;
  if (!force) {
    try {
      if (localStorage.getItem(FIELD_ONBOARD_LS)) return;
    } catch (_) {}
  }
  const root = document.getElementById('field-onboard-root');
  if (!root) return;
  _fieldOnboardOpen = true;
  document.body.classList.add('field-onboarding-active');
  root.classList.add('active');
  root.setAttribute('aria-hidden', 'false');
  fieldOnboardShowStep(0);
}

function maybeStartFieldOnboarding() {
  if (!FIELD_MODE) return;
  setTimeout(() => startFieldOnboarding(false), 600);
}

function toggleFieldLayersPanel() {
  const panel = document.getElementById('right-panel');
  if (panel.style.display === 'none') {
    panel.style.display = 'block';
    document.getElementById('right-toggle').textContent = '▶';
    document.body.classList.add('field-panel-right');
  }
  toggleSec('sec-layers');
  buildLayerPanel();
  showHint(t('hint.layersPanel'));
}

function setFieldNoteTool() {
  if (!FIELD_PROJECT.id) { openProjectPanel(); showHint('Önce gezi açın'); return; }
  startFieldNotePlacement();
}

function updateFieldDrawFab() {
  const fab = document.getElementById('field-draw-fab');
  if (!fab) return;
  const on = FIELD_MODE && (S.polyActive || S.plSession);
  fab.style.display = on ? 'flex' : 'none';
  const done = fab.querySelector('.fab-done');
  if (done) {
    const ok = S.plSession ? S.plVerts.length >= 2 : (S.polyPts.length >= 6);
    done.style.opacity = ok ? '1' : '0.55';
  }
}

function fieldDrawFinish(ev) {
  ev?.stopPropagation?.();
  ev?.preventDefault?.();
  if (S.plSession) {
    if (S.plVerts.length < 2) { showHint('Polyline için en az 2 köşe gerekli'); return; }
    finishPlSession();
  } else if (S.polyActive) {
    if (S.polyPts.length < 6) { showHint('Poligon için en az 3 köşe gerekli'); return; }
    finishPolygon();
  }
  updateFieldDrawFab();
}

function fieldDrawCancel(ev) {
  ev?.stopPropagation?.();
  ev?.preventDefault?.();
  if (S.plSession) cancelPlSession();
  else if (S.polyActive) cancelPolygon();
  updateFieldDrawFab();
}

const FIELD_DRAW_PANEL_TOOLS = new Set(['polyline', 'polygon', 'circle']);
let _fieldDrawTap = { t: 0, x: 0, y: 0 };

function tryFieldDrawDoubleTap(wp) {
  if (!S.plSession && !S.polyActive) return false;
  if (S.plSession && S.plVerts.length < 1) return false;
  if (S.polyActive && S.polyPts.length < 2) return false;
  const now = Date.now();
  const dist = Math.hypot(wp.x - _fieldDrawTap.x, wp.y - _fieldDrawTap.y);
  if (now - _fieldDrawTap.t < 480 && dist < 20 / S.scale) {
    if (S.plSession) {
      if (S.plVerts.length > 1) S.plVerts.pop();
      finishPlSession();
    } else finishPolygon();
    _fieldDrawTap.t = 0;
    return true;
  }
  _fieldDrawTap.t = now;
  _fieldDrawTap.x = wp.x;
  _fieldDrawTap.y = wp.y;
  return false;
}

function fieldStrokeWidthFromObject(obj) {
  if (!obj) return S.strokeWidth;
  if (obj.type === 'point') return obj.r ?? obj.strokeWidth ?? 10;
  return obj.strokeWidth ?? S.strokeWidth;
}

function absorbFieldStrokeFromObject(obj) {
  if (!obj || !isFieldCtxDrawObject(obj)) return;
  if (obj.color && String(obj.color).startsWith('#')) S.color = obj.color;
  const sw = fieldStrokeWidthFromObject(obj);
  if (!isNaN(+sw)) S.strokeWidth = +sw;
  if (obj.opacity != null && !isNaN(+obj.opacity)) S.opacity = +obj.opacity;
}

function syncFieldDrawSettingsUi() {
  const sel = S.selectedIds[0] ? S.objects.find(o => o.id === S.selectedIds[0]) : null;
  const isPoint = sel?.type === 'point' || S.tool === 'point';
  syncFieldStrokeWidthPickers(S.strokeWidth, isPoint);
  syncFieldOpacityPickers(S.opacity);
  if (S.color && String(S.color).startsWith('#')) updateFieldStrokeColorPickers(S.color);
}

function isFieldCtxDrawObject(obj) {
  return obj && ['point', 'polyline', 'polygon', 'line', 'arrow', 'zone', 'circle', 'freedraw', 'text', 'import_polyline', 'import_polygon'].includes(obj.type);
}

function applyFieldStyleToObject(obj, sw, op) {
  if (!obj || isNaN(sw)) return;
  if (obj.type === 'point') {
    obj.r = Math.max(4, Math.min(32, sw));
    obj.strokeWidth = sw;
  } else {
    obj.strokeWidth = sw;
  }
  if (!isNaN(op)) obj.opacity = op;
}

function applyFieldObjectColor(obj, hex) {
  if (!obj || !hex) return;
  obj.color = hex;
  if (obj.type === 'polygon' || obj.type === 'zone' || obj.type === 'circle' || obj.type === 'import_polygon') {
    if (hex.startsWith('#') && hex.length === 7) obj.fillColor = hex + '28';
  }
}

function fieldObjectTypeLabel(obj) {
  const keyMap = {
    point: 'type.point', circle: 'tool.circle', polygon: 'tool.polygon', polyline: 'tool.polyline',
    line: 'tool.line', text: 'tool.text', freedraw: 'tool.freedraw',
  };
  if (keyMap[obj.type]) return t(keyMap[obj.type]);
  return TYPE_LABELS[obj.type] || obj.type;
}

function fillFieldObjectPanel(obj) {
  if (!obj) return;
  absorbFieldStrokeFromObject(obj);
  const isPoint = obj.type === 'point';
  const descRow = document.getElementById('field-point-desc-row');
  if (descRow) descRow.style.display = isPoint ? 'block' : 'none';
  const typeEl = document.getElementById('field-ctx-obj-type');
  if (typeEl) {
    typeEl.textContent = isPoint
      ? t('ctx.pointLabel', { n: obj.pointNum || '?' })
      : fieldObjectTypeLabel(obj);
  }
  const descTa = document.getElementById('field-ctx-point-desc');
  if (descTa && isPoint) descTa.value = obj.description || '';
  syncFieldDrawSettingsUi();
  const guideBtn = document.getElementById('btn-obj-guide');
  if (guideBtn) guideBtn.style.display = resolveObjectGuidanceLatLon(obj) ? 'block' : 'none';
}

function updateFieldStrokeColorPickers(hex, hue) {
  if (!hex || !String(hex).startsWith('#')) return;
  const h = hue != null ? hue : hexToHue(hex);
  ['field-draw-hue', 'field-ctx-hue'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (+el.value !== h) el.value = h;
    el.style.setProperty('--stroke-pick', hex);
  });
}

function setFieldStrokeHue(hue, opts) {
  const silent = opts?.silent;
  const h = ((+hue % 360) + 360) % 360;
  const hex = hslToHex(h, 78, 44);
  S.color = hex;
  updateFieldStrokeColorPickers(hex, h);
  selectedFieldDrawObjects().forEach(obj => applyFieldObjectColor(obj, hex));
  scheduleRender();
  if (!silent) scheduleProjectSave();
}

function syncFieldCtxColor(hex, silent) {
  if (!hex || !String(hex).startsWith('#')) return;
  updateFieldStrokeColorPickers(hex);
  if (!silent) scheduleProjectSave();
}

function onFieldCtxHueInput(v) {
  setFieldStrokeHue(v, { fromCtx: true });
}

function showFieldObjectPanel(obj) {
  const rp = document.getElementById('right-panel');
  const def = document.getElementById('field-right-default');
  const objP = document.getElementById('field-right-object');
  const noteP = document.getElementById('field-right-note');
  const photoP = document.getElementById('field-right-photo');
  document.body.classList.remove('field-tool-draw');
  document.body.classList.add('field-tool-select');
  if (rp) rp.classList.add('field-has-selection');
  if (def) def.style.display = 'none';
  if (noteP) noteP.style.display = 'none';
  if (photoP) photoP.style.display = 'none';
  if (objP) objP.style.display = 'block';
  fillFieldObjectPanel(obj);
}

function applyFieldDrawStyle() {
  const sw = document.getElementById('field-draw-sw');
  const op = document.getElementById('field-draw-op');
  applyFieldStrokeStyle(sw ? +sw.value : null, op ? +op.value : null, {});
}

function updateFieldPanelForTool(t) {
  if (!FIELD_MODE) return;
  document.body.classList.remove('field-tool-select', 'field-tool-draw');
  const rp = document.getElementById('right-panel');
  const objP = document.getElementById('field-right-object');
  const noteP = document.getElementById('field-right-note');
  const photoP = document.getElementById('field-right-photo');
  const def = document.getElementById('field-right-default');
  if (t === 'select') {
    document.body.classList.add('field-tool-select');
    if (S.selectedIds.length) {
      const sel = S.objects.find(o => o.id === S.selectedIds[0]);
      if (isFieldCtxDrawObject(sel)) {
        showFieldObjectPanel(sel);
        return;
      }
    }
    if (rp) rp.classList.remove('field-has-selection');
    if (def) def.style.display = 'block';
    if (objP) objP.style.display = 'none';
    if (noteP) noteP.style.display = 'none';
    if (photoP) photoP.style.display = 'none';
    updateFieldAnalysisActions(S.selectedIds[0] ? S.objects.find(o => o.id === S.selectedIds[0]) : null);
    return;
  }
  if (t === 'info') {
    document.body.classList.add('field-tool-select');
    if (rp) rp.classList.remove('field-has-selection');
    if (def) def.style.display = 'block';
    if (objP) objP.style.display = 'none';
    if (noteP) noteP.style.display = 'none';
    if (photoP) photoP.style.display = 'none';
    return;
  }
  if (FIELD_DRAW_PANEL_TOOLS.has(t)) {
    document.body.classList.add('field-tool-draw');
    if (rp) rp.classList.remove('field-has-selection');
    if (def) def.style.display = 'block';
    if (objP) objP.style.display = 'none';
    if (noteP) noteP.style.display = 'none';
    if (photoP) photoP.style.display = 'none';
    syncFieldDrawSettingsUi();
    if (t === 'circle') updateFieldAnalysisActions(null);
  }
}

async function updateFieldCtxProject() {
  const label = document.getElementById('field-ctx-project-label');
  const listEl = document.getElementById('field-ctx-project-list');
  if (!listEl) return;
  try {
    let projects = await fetchProjectListSorted();
    if (FIELD_PROJECT.id && !projects.some(p => p.id === FIELD_PROJECT.id)) {
      projects = [{
        id: FIELD_PROJECT.id,
        name: FIELD_PROJECT.name,
        updatedAt: FIELD_PROJECT.createdAt || new Date().toISOString(),
      }, ...projects];
    }
    if (label) label.textContent = projects.length > 1 ? t('panel.projects') : t('panel.project');
    if (!projects.length) {
      listEl.innerHTML = '';
      const solo = document.createElement('div');
      solo.style.cssText = 'font-size:12px;font-weight:600;padding:4px 2px;';
      solo.textContent = projectDisplayName(FIELD_PROJECT.name);
      listEl.appendChild(solo);
      renderFieldProjectReportsList();
      return;
    }
    renderProjectListRows(listEl, projects, { mode: 'panel' });
    renderFieldProjectReportsList();
  } catch (_) {
    listEl.textContent = projectDisplayName(FIELD_PROJECT.name) || '—';
    if (label) label.textContent = t('panel.project');
  }
}

function setFieldPanelChrome() {
  const projB = document.getElementById('field-project-block');
  if (projB) projB.style.display = '';
}

function updateFieldRightPanel(obj) {
  if (!FIELD_MODE) return;
  const rp = document.getElementById('right-panel');
  const def = document.getElementById('field-right-default');
  const objP = document.getElementById('field-right-object');
  const noteP = document.getElementById('field-right-note');
  const featP = document.getElementById('field-right-feature');
  const slopeP = document.getElementById('field-right-slope');
  if (!rp) return;
  if (!_fieldInfoObjId && featP) featP.style.display = 'none';
  if (!_slopeState.active && slopeP) slopeP.style.display = 'none';
  updateFieldCtxProject();
  setFieldPanelChrome();
  const photoP = document.getElementById('field-right-photo');
  if (fieldActiveDrawTool()) {
    updateFieldPanelForTool(S.tool);
    if (obj && isFieldCtxDrawObject(obj) && !S.plSession && !S.polyActive) {
      absorbFieldStrokeFromObject(obj);
      syncFieldDrawSettingsUi();
    }
    updateFieldAnalysisActions(obj && isFieldCtxDrawObject(obj) ? obj : null);
    return;
  }
  if (!obj) {
    updateFieldPanelForTool(S.tool);
    _fieldCtxNoteId = null;
    _fieldCtxPhotoId = null;
    return;
  }
  document.body.classList.remove('field-tool-draw');
  document.body.classList.add('field-tool-select');
  rp.classList.add('field-has-selection');
  if (def) def.style.display = 'none';
  if (obj.type === 'field_note') {
    if (objP) objP.style.display = 'none';
    if (photoP) photoP.style.display = 'none';
    if (noteP) noteP.style.display = 'block';
    _fieldCtxNoteId = obj.id;
    _fieldCtxPhotoId = null;
    document.getElementById('field-ctx-note-text').value = getNoteText(obj);
    const ts = obj.createdAt ? new Date(obj.createdAt).toLocaleString('tr-TR') : '—';
    document.getElementById('field-ctx-note-meta').textContent =
      ts + '\n' + (obj.lat?.toFixed(5) || '—') + '°, ' + (obj.lon?.toFixed(5) || '—') + '°';
    return;
  }
  if (obj.type === 'field_photo') {
    normalizeFieldPhotoObject(obj);
    if (objP) objP.style.display = 'none';
    if (noteP) noteP.style.display = 'none';
    if (photoP) photoP.style.display = 'block';
    _fieldCtxPhotoId = obj.id;
    _fieldCtxNoteId = null;
    const titleEl = document.getElementById('field-photo-panel-title');
    if (titleEl) titleEl.textContent = obj.title || 'Fotoğraf';
    const desc = document.getElementById('field-photo-desc');
    if (desc) desc.value = obj.description || '';
    const meta = document.getElementById('field-photo-meta');
    if (meta) {
      meta.textContent = (obj.timestamp ? new Date(obj.timestamp).toLocaleString('tr-TR') : '—') + '\n' +
        (obj.lat?.toFixed(5) || '—') + '°, ' + (obj.lon?.toFixed(5) || '—') + '°' +
        (obj.gpsSource ? '\nKonum: ' + obj.gpsSource.toUpperCase() : '');
    }
    updateFieldPhotoVoiceUi(obj);
    loadFieldPhotoPreview(obj);
    return;
  }
  if (isImportInspectable(obj) && S.tool === 'info' && _fieldInfoObjId === obj.id) {
    showFeatureInfoPanel(obj);
    return;
  }
  if (isFieldCtxDrawObject(obj)) {
    showFieldObjectPanel(obj);
    _fieldCtxNoteId = null;
    updateFieldAnalysisActions(obj);
    return;
  }
  updateFieldAnalysisActions(obj);
}

function applyFieldCtxPointDesc() {
  const obj = S.objects.find(o => o.id === S.selectedIds[0] && o.type === 'point');
  if (!obj) return;
  obj.description = document.getElementById('field-ctx-point-desc')?.value || '';
  buildLayerPanel();
  scheduleRender();
  scheduleProjectSave();
}

function applyFieldCtxObject() {
  const sw = +document.getElementById('field-ctx-sw')?.value;
  const op = +document.getElementById('field-ctx-op')?.value;
  const selObj = S.selectedIds[0] ? S.objects.find(o => o.id === S.selectedIds[0]) : null;
  applyFieldStrokeStyle(sw, op, { fromCtx: true, isPoint: selObj?.type === 'point' });
}

function saveFieldCtxNote() {
  if (!_fieldCtxNoteId) return;
  const n = S.objects.find(o => o.id === _fieldCtxNoteId);
  if (!n) return;
  const raw = document.getElementById('field-ctx-note-text').value.trim() || 'Saha notu';
  const text = typeof SpatialSecurity !== 'undefined'
    ? SpatialSecurity.sanitizeFieldNoteText(raw) || 'Saha notu'
    : raw;
  n.textNote = text;
  n.text = text;
  n.timestamp = new Date().toISOString();
  pushHistory();
  buildFieldNotesList();
  scheduleProjectSave();
  showHint('Not kaydedildi');
}

function fieldPointerDown(e) {
  if (!FIELD_MODE) return false;
  if (S.tool === 'info') return false;
  if (_notePinMode) {
    if (e.pointerType === 'pen') setFieldInteractionMode('pen', true);
    _fieldPointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    _fieldTouch = {
      id: e.pointerId,
      x0: e.clientX, y0: e.clientY,
      t0: Date.now(),
      moved: false, panning: false, longPressed: false,
      lastX: e.clientX, lastY: e.clientY,
      pinMode: true,
    };
    clearTimeout(_fieldMapLongPressTimer);
    return true;
  }
  if (e.pointerType === 'pen') setFieldInteractionMode('pen', true);
  _fieldPointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
  if (_fieldPointers.size === 2) {
    if (_fieldTouch?.drawVertex) _fieldTouch = null;
    const pts = [..._fieldPointers.values()];
    _pinchDist0 = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    _pinchScale0 = S.scale;
    _pinchMid0 = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
    RenderCoordinator.beginInteraction('zoom');
    return true;
  }
  if (fieldTapVertexTool() && fieldTapVertexPointer(e.pointerType) && fieldDrawingAllowed(e.pointerType)) {
    _fieldTouch = {
      id: e.pointerId,
      x0: e.clientX, y0: e.clientY,
      t0: Date.now(),
      moved: false, panning: false, longPressed: false,
      lastX: e.clientX, lastY: e.clientY,
      drawVertex: true,
    };
    clearTimeout(_fieldMapLongPressTimer);
    return true;
  }
  if (fieldNavigationPointer(e.pointerType)) {
    if (S.tool === 'select' && !S.polyActive && !S.plSession) {
      const wp = clientToWorld(e.clientX, e.clientY);
      for (let i = S.objects.length - 1; i >= 0; i--) {
        const o = S.objects[i];
        if (!isObjectSelectableInField(o)) continue;
        const p = unrotateForHit(o, wp.x, wp.y);
        if (hitTest(o, p.x, p.y)) return false;
      }
    }
    _fieldTouch = {
      id: e.pointerId,
      x0: e.clientX, y0: e.clientY,
      t0: Date.now(),
      moved: false,
      panning: false,
      longPressed: false,
      lastX: e.clientX, lastY: e.clientY,
    };
    clearTimeout(_fieldMapLongPressTimer);
    const ptrId = e.pointerId;
    const cx0 = e.clientX;
    const cy0 = e.clientY;
    _fieldMapLongPressTimer = setTimeout(() => {
      if (!_fieldTouch || _fieldTouch.id !== ptrId || _fieldTouch.moved || _fieldTouch.panning) return;
      const wp = clientToWorld(cx0, cy0);
      _fieldTouch.longPressed = true;
      showFieldMapContextMenu(cx0, cy0, wp);
    }, 580);
    return true;
  }
  return false;
}

function fieldPointerMove(e) {
  if (!FIELD_MODE) return false;
  if (_fieldPointers.size === 2 && _pinchDist0) {
    const pts = [..._fieldPointers.values()];
    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    if (_pinchDist0 > 10) {
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const r = canvas.getBoundingClientRect();
      const wx = (mid.x - r.left - S.tx) / S.scale;
      const wy = (mid.y - r.top - S.ty) / S.scale;
      S.scale = Math.max(0.05, Math.min(120, _pinchScale0 * (dist / _pinchDist0)));
      S.tx = mid.x - r.left - wx * S.scale;
      S.ty = mid.y - r.top - wy * S.scale;
      scheduleRender();
    }
    _fieldPointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    return true;
  }
  if (_fieldTouch && _fieldTouch.id === e.pointerId) {
    if (_fieldTouch.drawVertex) {
      const dx = e.clientX - _fieldTouch.x0;
      const dy = e.clientY - _fieldTouch.y0;
      if (!_fieldTouch.moved && Math.hypot(dx, dy) > FIELD_TAP_VERTEX_MOVE_PX) {
        _fieldTouch.moved = true;
      }
      _fieldPointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      onMouseMove(_pe(e));
      return true;
    }
    if (_fieldTouch.pinMode) return true;
    const dx = e.clientX - _fieldTouch.x0;
    const dy = e.clientY - _fieldTouch.y0;
    if (!_fieldTouch.moved && Math.hypot(dx, dy) > 10) {
      clearTimeout(_fieldMapLongPressTimer);
      _fieldTouch.moved = true;
      _fieldTouch.panning = true;
      S.panning = true;
      S.panLastX = e.clientX;
      S.panLastY = e.clientY;
      canvas.style.cursor = 'grabbing';
      disableGpsFollowFromPan();
      RenderCoordinator.beginInteraction('pan');
    }
    if (_fieldTouch.panning) {
      S.tx += e.clientX - _fieldTouch.lastX;
      S.ty += e.clientY - _fieldTouch.lastY;
      _fieldTouch.lastX = e.clientX;
      _fieldTouch.lastY = e.clientY;
      scheduleRender();
      return true;
    }
  }
  return false;
}

function fieldPointerUp(e, wp) {
  if (!FIELD_MODE) return false;
  _fieldPointers.delete(e.pointerId);
  if (_fieldPointers.size < 2) {
    if (_pinchDist0) RenderCoordinator.endInteraction();
    _pinchDist0 = null;
    _pinchScale0 = null;
  }
  clearTimeout(_fieldMapLongPressTimer);
  if (_fieldTouch && _fieldTouch.id === e.pointerId) {
    if (_fieldTouch.drawVertex) {
      const tap = !_fieldTouch.moved && !_fieldTouch.longPressed && (Date.now() - _fieldTouch.t0) < 480;
      if (tap && !tryFieldDrawDoubleTap(wp)) fieldAddDrawVertex(wp);
      _fieldTouch = null;
      return true;
    }
    if (_fieldTouch.pinMode || _notePinMode) {
      placeFieldNotePin(wp);
      _fieldTouch = null;
      return true;
    }
    const tap = !_fieldTouch.moved && !_fieldTouch.longPressed && (Date.now() - _fieldTouch.t0) < 480;
    if (_fieldTouch.panning) {
      S.panning = false;
      canvas.style.cursor = getCursor();
      RenderCoordinator.endInteraction();
    } else if (tap) {
      if (tryFieldDrawDoubleTap(wp)) { _fieldTouch = null; return true; }
      fieldTapSelect(wp, e);
    }
    _fieldTouch = null;
    return true;
  }
  return false;
}

function fieldTapSelect(wp, e) {
  if (_notePinMode) {
    placeFieldNotePin(wp);
    return;
  }
  if (S.polyActive || S.plSession) return;
  if (_gpsTrackReplay.pos) {
    const w = latLonToWorld(_gpsTrackReplay.pos.lat, _gpsTrackReplay.pos.lon);
    if (Math.hypot(wp.x - w.x, wp.y - w.y) < 24 / S.scale) {
      if (e?.clientX != null) showFieldMapContextMenu(e.clientX, e.clientY, wp);
      else showFieldMapContextMenu(window.innerWidth / 2, window.innerHeight / 2, wp);
      return;
    }
  }
  let found = null;
  for (let i = S.objects.length - 1; i >= 0; i--) {
    const o = S.objects[i];
    const p = unrotateForHit(o, wp.x, wp.y);
    if (hitTest(o, p.x, p.y)) { found = o.id; break; }
  }
  S.selectedIds = found ? [found] : [];
  setDeleteButtonVisible(S.selectedIds.length > 0);
  const selObj = found ? S.objects.find(o => o.id === found) : null;
  updateSelPanel(selObj);
  if (selObj?.type === 'field_note' || selObj?.type === 'field_photo') {
    showFieldObservationPopup(selObj);
  } else {
    closeNotePopup();
  }
  if (!found) buildLayerPanel();
  scheduleRender();
}

// ═══════════════════════════════════════════════════════════════
// PLANAI SKETCH ENGINE v3 (core retained under Field mode)
// ═══════════════════════════════════════════════════════════════

const canvas = document.getElementById('canvas');
const wrap   = document.getElementById('canvas-wrap');
const ctx    = canvas.getContext('2d');

// ─────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────
const S = {
  tool: 'select',

  // Pen settings
  color:          '#e53935',
  strokeWidth:    2,
  opacity:        1,
  lineStyle:      'solid',
  lineDecoration: 'none',
  arrowStyle:     'solid',
  circleStyle:    'outline',
  analysisStyle:  'radial',  // radial | noise | visibility | heat
  hatchPattern:   'none',
  tension:        0.5,
  planningCat:    'none',
  activeLayerId:  'sketch',

  // Canvas transform
  tx: 0, ty: 0, scale: 1,

  // Objects + layers
  objects:     [],
  layers:      [],        // populated in INIT
  selectedIds: [],

  // Draw state
  drawing:    false,
  activeId:   null,
  drawStartX: 0,
  drawStartY: 0,

  // ── DRAG-MOVE ─────────────────────────────────────────────
  dragging:        false,
  dragStartWorldX: 0,
  dragStartWorldY: 0,
  dragSnapshot:    null,

  // ── VERTEX EDITING ────────────────────────────────────────
  vertexDragging:  false,
  vertexObjId:     null,
  vertexIdx:       -1,    // index in points[] (step 2) or 'radius'/'center'
  vertexSnapshot:  null,  // copy of obj before drag

  // ── ROTATION ──────────────────────────────────────────────
  rotating:           false,
  rotateId:           null,
  rotateCX:           0,
  rotateCY:           0,
  rotateStartAngle:   0,
  rotateInitialAngle: 0,

  // ── TEXT EDITING ──────────────────────────────────────────
  editingTextId: null,

  // ── POLYGON ───────────────────────────────────────────────
  polyActive:   false,
  polyPts:      [],
  polyPreviewX: 0,
  polyPreviewY: 0,

  // ── POLYLINE / SPLINE SESSION ────────────────────────────
  plSession:   false,
  plVerts:     [],    // [{x,y}] — exact clicked coords
  plSmooth:    false, // false=polyline, true=smooth spline
  plPrevX:     0,
  plPrevY:     0,
  plSnapped:   null,  // {x,y} or null — current snap target

  // ── BEZIER CURVE ──────────────────────────────────────────

  // Pan
  panning:  false,
  panLastX: 0,
  panLastY: 0,

  // Grid — cm based
  showGrid:    true,
  gridSize:    76,         // pixels (2 cm @ 96dpi = 75.6px ≈ 76)
  gridSizeCm:  2,          // cm on screen
  snapGrid:    false,

  // Project scale + measurement
  projectScale:    1000,  // 1:1000
  showMeasurement: true,

  // ── MAP / OSM ─────────────────────────────────────────────
  basemap:     'none',  // 'none' | 'osm' | 'satellite' | 'topo'
  showPafta:   false,
  mapCenter:   { lat: 39.93, lon: 32.85 },  // Ankara default

  // History
  history: [[]],
  histIdx: 0,
  importOptimizedActive: false,
};

let DPR = window.devicePixelRatio || 1;
let CW = 0, CH = 0;
let _id = 0;
const uid = () => `sk_${Date.now()}_${++_id}`;

// ─────────────────────────────────────────────────────────────
// MEASUREMENT SYSTEM
// ─────────────────────────────────────────────────────────────
const SCREEN_DPI = 96;
const PX_PER_CM  = SCREEN_DPI / 2.54;   // ~37.795 px/cm at 96dpi

// World pixels → real-world meters (using project scale + cm grid)
function pxToMeters(px) {
  // 1 world-px = gridSizeCm/gridSize [cm/px] × projectScale [cm_real/cm_screen] / 100 [m/cm]
  const cmPerPx = S.gridSizeCm / S.gridSize;
  return px * cmPerPx * S.projectScale / 100;
}
// px² → m²
function pxSqToM2(px2) {
  const m = pxToMeters(1);
  return px2 * m * m;
}
function formatLength(m) {
  if (m >= 1000) return (m/1000).toFixed(2) + ' km';
  if (m >= 1)    return m.toFixed(1) + ' m';
  return (m*100).toFixed(0) + ' cm';
}
function formatArea(m2) {
  if (m2 >= 10000) return (m2/10000).toFixed(2) + ' ha';
  return m2.toFixed(0) + ' m²';
}

function useGeoMeasurements() {
  return FIELD_MODE || (S.basemap && S.basemap !== 'none');
}

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function worldSegMeters(x1, y1, x2, y2) {
  if (useGeoMeasurements()) {
    const a = worldToLatLon(x1, y1);
    const b = worldToLatLon(x2, y2);
    return haversineM(a.lat, a.lon, b.lat, b.lon);
  }
  return pxToMeters(Math.hypot(x2 - x1, y2 - y1));
}

function shoelacePx2(pts) {
  let area = 0;
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += pts[i * 2] * pts[j * 2 + 1] - pts[j * 2] * pts[i * 2 + 1];
  }
  return Math.abs(area) / 2;
}

function polygonAreaM2FromWorldPts(pts) {
  const n = pts.length / 2;
  if (n < 3) return 0;
  if (useGeoMeasurements()) {
    const ring = [];
    for (let i = 0; i < n; i++) {
      const g = worldToLatLon(pts[i * 2], pts[i * 2 + 1]);
      ring.push(g);
    }
    const clat = ring.reduce((s, p) => s + p.lat, 0) / n;
    const clon = ring.reduce((s, p) => s + p.lon, 0) / n;
    const cos = Math.cos(clat * Math.PI / 180);
    const xy = ring.map(p => ({
      x: (p.lon - clon) * 111320 * cos,
      y: (p.lat - clat) * 111320,
    }));
    let area = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += xy[i].x * xy[j].y - xy[j].x * xy[i].y;
    }
    return Math.abs(area) / 2;
  }
  return pxSqToM2(shoelacePx2(pts));
}

function polygonCentroidXY(pts) {
  const n = pts.length / 2;
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += pts[i * 2]; cy += pts[i * 2 + 1]; }
  return { x: cx / n, y: cy / n };
}

function drawOnMapMeasureLabel(wx, wy, text) {
  if (!text) return;
  const fs = Math.max(10, 12 / S.scale);
  const pad = 4 / S.scale;
  ctx.save();
  ctx.font = `600 ${fs}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tw = ctx.measureText(text).width;
  const bw = tw + pad * 2;
  const bh = fs * 1.2 + pad;
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.strokeStyle = 'rgba(15,25,40,0.38)';
  ctx.lineWidth = Math.max(1, 1.2 / S.scale);
  ctx.fillRect(wx - bw / 2, wy - bh / 2, bw, bh);
  ctx.strokeRect(wx - bw / 2, wy - bh / 2, bw, bh);
  ctx.fillStyle = '#0f1928';
  ctx.fillText(text, wx, wy);
  ctx.restore();
}

function renderSegmentMeasureLabels(verts, closed) {
  if (!S.showMeasurement || !verts || verts.length < 2) return;
  const n = verts.length;
  const segs = closed && n >= 3 ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const ax = a.x ?? a[0];
    const ay = a.y ?? a[1];
    const bx = b.x ?? b[0];
    const by = b.y ?? b[1];
    const m = worldSegMeters(ax, ay, bx, by);
    if (m < 0.05) continue;
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const off = 9 / S.scale;
    drawOnMapMeasureLabel(mx - (dy / len) * off, my + (dx / len) * off, formatLength(m));
  }
}

function renderImportSegmentLabels(verts) {
  if (!S.showMeasurement || !verts || verts.length < 2) return;
  for (let i = 0; i < verts.length - 1; i++) {
    const a = verts[i];
    const b = verts[i + 1];
    const m = haversineM(a.lat, a.lon, b.lat, b.lon);
    if (m < 0.05) continue;
    const w0 = latLonToWorld(a.lat, a.lon);
    const w1 = latLonToWorld(b.lat, b.lon);
    const mx = (w0.x + w1.x) / 2;
    const my = (w0.y + w1.y) / 2;
    const dx = w1.x - w0.x;
    const dy = w1.y - w0.y;
    const len = Math.hypot(dx, dy) || 1;
    const off = 9 / S.scale;
    drawOnMapMeasureLabel(mx - (dy / len) * off, my + (dx / len) * off, formatLength(m));
  }
}

function renderClosedAreaLabel(pts) {
  if (!S.showMeasurement || !pts || pts.length < 6) return;
  const area = polygonAreaM2FromWorldPts(pts);
  if (area < 0.5) return;
  const c = polygonCentroidXY(pts);
  drawOnMapMeasureLabel(c.x, c.y, formatArea(area));
}

function renderSegmentLabelsFromFlatPts(pts, includeClosing) {
  if (!S.showMeasurement || pts.length < 4) return;
  const n = pts.length / 2;
  const segs = includeClosing && n >= 3 ? n : n - 1;
  const verts = [];
  for (let i = 0; i < n; i++) verts.push({ x: pts[i * 2], y: pts[i * 2 + 1] });
  renderSegmentMeasureLabels(verts, includeClosing && n >= 3);
}

// Compute length of a line/arrow/bezier in world px
function computeObjLength(obj) {
  if (obj.type === 'line' || obj.type === 'arrow') {
    const [x1,y1,x2,y2] = obj.points;
    return Math.hypot(x2-x1, y2-y1);
  }
  if (obj.type === 'polyline') {
    const verts = obj.vertices || [];
    let len = 0;
    for (let i = 0; i < verts.length - 1; i++) {
      len += Math.hypot(verts[i + 1].x - verts[i].x, verts[i + 1].y - verts[i].y);
    }
    return len;
  }
  if (obj.type === 'freedraw' || obj.type === 'bezier' || obj.type === 'polygon') {
    let len = 0;
    const pts = obj.points;
    for (let i = 0; i < pts.length-2; i+=2)
      len += Math.hypot(pts[i+2]-pts[i], pts[i+3]-pts[i+1]);
    return len;
  }
  if (obj.type === 'circle' || obj.type === 'analysis_zone') {
    return obj.r * 2 * Math.PI; // circumference
  }
  return 0;
}

// Compute area of a closed polygon/zone/circle in world px²
function computeObjArea(obj) {
  if (obj.type === 'circle' || obj.type === 'analysis_zone') {
    return Math.PI * obj.r * obj.r;
  }
  if ((obj.type === 'polygon' && obj.closed) || obj.type === 'zone') {
    return shoelacePx2(obj.points);
  }
  return 0;
}

// Format measurement string for an object
function objMeasurement(obj) {
  if (!obj) return '';
  const area = computeObjArea(obj);
  if (area > 0) {
    const lenPx = computeObjLength(obj);
    const lenStr = lenPx > 0 ? formatLength(pxToMeters(lenPx)) : '';
    return `${formatArea(pxSqToM2(area))}${lenStr ? '  ·  ' + lenStr : ''}`;
  }
  const len = computeObjLength(obj);
  if (len > 0) return formatLength(pxToMeters(len));
  return '';
}

// Show floating measurement label near cursor
function showMeasLabel(clientX, clientY, text) {
  const el = document.getElementById('meas-label');
  if (!el || !text) { if (el) el.style.display = 'none'; return; }
  const r  = canvas.getBoundingClientRect();
  let lx   = clientX - r.left + 14;
  let ly   = clientY - r.top  - 32;
  if (lx + 180 > CW) lx = clientX - r.left - 180;
  if (ly < 38) ly = clientY - r.top + 12;
  el.style.left    = lx + 'px';
  el.style.top     = ly + 'px';
  el.textContent   = text;
  el.style.display = 'block';
}
function hideMeasLabel() {
  const el = document.getElementById('meas-label');
  if (el) el.style.display = 'none';
}

// ─────────────────────────────────────────────────────────────
// LAYER SYSTEM — Semantic layer architecture
// ─────────────────────────────────────────────────────────────
const LAYER_DEFS = [
  { id:'sketch',         name:'Eskiz',          color:'#546e7a', order:0 },
  { id:'zoning',         name:'Zonlama',         color:'#ab47bc', order:1 },
  { id:'circulation',    name:'Sirkülasyon',     color:'#ef5350', order:2 },
  { id:'ecology',        name:'Ekoloji',         color:'#66bb6a', order:3 },
  { id:'infrastructure', name:'Altyapı',         color:'#42a5f5', order:4 },
  { id:'analysis',       name:'Analiz',          color:'#ff7043', order:5 },
  { id:'annotation',     name:'Notasyon',        color:'#e8b84b', order:6 },
];
/** Field-mode layer stack (planning layers hidden from UI, code retained) */
const FIELD_PHOTOS_LAYER = 'photos';
const FIELD_GPS_LAYER = 'gps';
const FIELD_POINTS_LAYER = 'points';
const FIELD_LAYER_DEFS = [
  { id:'sketch',    name:'Saha Çizimi',          color:'#d48f10', order:1 },
  { id:'imported',  name:'Diğer içe aktarımlar', color:'#2980b9', order:5 },
  { id:'photos',    name:'📷 Fotoğraflar',       color:'#8e44ad', order:6 },
  { id:'notes',     name:'Notlar',               color:'#ffca28', order:7 },
  { id:'gps',       name:'GPS Rota',             color:'#1565c0', order:8 },
];

function sanitizeFieldProjectLayers() {
  if (!FIELD_MODE) return;
  S.layers = S.layers.filter(l => l.id !== FIELD_POINTS_LAYER);
  ensureGpsLayer();
  S.objects.forEach(o => {
    if (o.type === 'point') normalizeFieldPointObject(o);
    if (o.type === 'field_gps_track') normalizeFieldGpsTrackObject(o);
  });
  if (S.activeLayerId === FIELD_POINTS_LAYER) S.activeLayerId = 'sketch';
}

// ─────────────────────────────────────────────────────────────
// STYLE PRESETS — Semantic auto-styling per category
// ─────────────────────────────────────────────────────────────
const STYLE_PRESETS = {
  none: {
    color:'#1a1a2e', strokeWidth:1.5, lineStyle:'solid',
    hatchPattern:'none', opacity:0.9, arrowStyle:'solid', tension:0.5, layerId:'sketch'
  },
  zoning: {
    color:'#ab47bc', strokeWidth:1.5, lineStyle:'dashed',
    hatchPattern:'diagonal', opacity:0.82, fillOpacity:0.18, layerId:'zoning'
  },
  circulation: {
    color:'#ef5350', strokeWidth:4, lineStyle:'solid',
    arrowStyle:'flow', hatchPattern:'none', opacity:0.9, layerId:'circulation'
  },
  infrastructure: {
    color:'#42a5f5', strokeWidth:3, lineStyle:'solid',
    hatchPattern:'density', opacity:0.85, arrowStyle:'double', layerId:'infrastructure'
  },
  ecology: {
    color:'#66bb6a', strokeWidth:2, lineStyle:'solid',
    hatchPattern:'ecology', opacity:0.85, arrowStyle:'ecology', layerId:'ecology'
  },
  analysis: {
    color:'#ff7043', strokeWidth:1.5, lineStyle:'solid',
    hatchPattern:'gradient', opacity:0.75, circleStyle:'radial', layerId:'analysis'
  },
  annotation: {
    color:'#d48f10', strokeWidth:1.5, lineStyle:'solid',
    hatchPattern:'none', opacity:0.92, layerId:'annotation'
  },
  concept: {
    color:'#26c6da', strokeWidth:2, lineStyle:'solid',
    hatchPattern:'sketch', opacity:0.85, arrowStyle:'sketch', tension:0.8, layerId:'sketch'
  },
};

// Category → Layer mapping
const CAT_TO_LAYER = {
  none:'sketch', zoning:'zoning', circulation:'circulation',
  infrastructure:'infrastructure', ecology:'ecology',
  analysis:'analysis', annotation:'annotation', concept:'sketch',
};

// Category → preferred drawing tool
const CAT_TOOL = {
  none:'select', zoning:'polygon', circulation:'arrow',
  infrastructure:'line', ecology:'polygon', analysis:'analysis',
  annotation:'text', concept:'freedraw',
};

// ─────────────────────────────────────────────────────────────
// CANVAS SIZING
// ─────────────────────────────────────────────────────────────
function resizeCanvas() {
  syncFieldDockMetrics();
  if (FIELD_MODE) syncFieldTopbarHeight();
  DPR = window.devicePixelRatio || 1;
  CW  = wrap.clientWidth;
  CH  = wrap.clientHeight;
  canvas.width  = Math.round(CW * DPR);
  canvas.height = Math.round(CH * DPR);
  canvas.style.width  = CW + 'px';
  canvas.style.height = CH + 'px';
  scheduleRender();
  if (FIELD_MODE && S.basemap !== 'none') scheduleBasemapRefresh(400);
}

// ─────────────────────────────────────────────────────────────
// COORD HELPERS
// ─────────────────────────────────────────────────────────────
function clientToWorld(cx, cy) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (cx - r.left  - S.tx) / S.scale,
    y: (cy - r.top   - S.ty) / S.scale,
  };
}
function worldToScreen(wx, wy) {
  const r = canvas.getBoundingClientRect();
  return {
    x: wx * S.scale + S.tx + r.left,
    y: wy * S.scale + S.ty + r.top,
  };
}
function snapPt(x, y) {
  if (!S.snapGrid) {
    // No snap: return exact coords, reset indicator
    _snapX = x; _snapY = y;
    return { x, y };
  }
  const g  = S.gridSize;
  const sx = Math.round(x / g) * g;
  const sy = Math.round(y / g) * g;
  _snapX = sx; _snapY = sy;
  return { x: sx, y: sy };
}
// Vertex snapping: snap to existing object vertices
function snapToVertices(x, y, excludeId) {
  if (!S.snapGrid) return null;
  const T = 12 / S.scale;
  for (const obj of S.objects) {
    if (obj.id === excludeId) continue;
    const pts = obj.vertices || obj.points;
    if (!pts) continue;
    for (let i = 0; i < pts.length; i += (obj.vertices ? 1 : 2)) {
      const vx = obj.vertices ? pts[i].x : pts[i];
      const vy = obj.vertices ? pts[i].y : pts[i+1];
      if (Math.hypot(x-vx, y-vy) < T) return { x: vx, y: vy };
    }
  }
  return null;
}

// ── Grid size control ─────────────────────────────────────────
function setGridSizeCm(cm) {
  S.gridSizeCm = cm;
  S.gridSize   = Math.round(cm * PX_PER_CM);
  [1,2,3,4].forEach(c => {
    const btn = document.getElementById(`grid-sz-${c}`);
    if (btn) btn.classList.toggle('active', c === cm);
  });
  updateScaleInfo();
  document.getElementById('stat-grid').textContent = S.showGrid ? `· GRID ${cm}cm` : '';
  scheduleRender();
}

function setProjectScale(scale) {
  S.projectScale = scale;
  _hatchPatternCache.clear();
  refreshPlanGmlPresentation();
  updateScaleInfo();
  scheduleRender();
}

function updateScaleInfo() {
  const cmEl = document.getElementById('scale-info');
  const grEl = document.getElementById('grid-real-info');
  if (cmEl) {
    const mPer1cm = S.projectScale / 100;
    cmEl.textContent = mPer1cm >= 1000 ? (mPer1cm/1000).toFixed(1)+'km' : mPer1cm+'m';
  }
  if (grEl) {
    const gridM = pxToMeters(S.gridSize);
    grEl.textContent = `${S.gridSizeCm}cm = ${formatLength(gridM)}`;
  }
  // Update snap hint
  document.getElementById('stat-grid').textContent = S.showGrid ? `· GRID ${S.gridSizeCm}cm` : '';
}

// ── Move an object by (dx, dy) using its snapshot as base ──
function translateObject(obj, snap, dx, dy) {
  if (obj.type === 'freedraw' || obj.type === 'line' || obj.type === 'arrow' ||
      obj.type === 'zone'     || obj.type === 'polygon') {
    for (let i = 0; i < snap.points.length; i += 2) {
      obj.points[i]     = snap.points[i]     + dx;
      obj.points[i + 1] = snap.points[i + 1] + dy;
    }
  } else if (obj.type === 'polyline') {
    snap.vertices.forEach((v, i) => {
      obj.vertices[i] = { x: v.x + dx, y: v.y + dy };
    });
  } else if (obj.type === 'georef_image') {
    translateGeoref(obj, snap, dx, dy);
  } else if (obj.type === 'circle' || obj.type === 'analysis_zone') {
    obj.cx = snap.cx + dx;  obj.cy = snap.cy + dy;
  } else if (obj.type === 'import_point') {
    const g0 = worldToLatLon(snap._w0x ?? 0, snap._w0y ?? 0);
    const g1 = worldToLatLon((snap._w0x ?? 0) + dx, (snap._w0y ?? 0) + dy);
    obj.lat = snap.lat + (g1.lat - g0.lat);
    obj.lon = snap.lon + (g1.lon - g0.lon);
  } else if (obj.type === 'import_polyline') {
    const g0 = worldToLatLon(0, 0);
    const g1 = worldToLatLon(dx, dy);
    const dLa = g1.lat - g0.lat, dLo = g1.lon - g0.lon;
    obj.vertices = snap.vertices.map(v => ({ lat: v.lat + dLa, lon: v.lon + dLo }));
  } else if (obj.type === 'import_polygon') {
    const g0 = worldToLatLon(0, 0);
    const g1 = worldToLatLon(dx, dy);
    const dLa = g1.lat - g0.lat, dLo = g1.lon - g0.lon;
    obj.rings = snap.rings.map(ring => ring.map(c => ({ lat: c.lat + dLa, lon: c.lon + dLo })));
    obj.holes = (snap.holes || []).map(ring => ring.map(c => ({ lat: c.lat + dLa, lon: c.lon + dLo })));
  } else if (obj.type === 'field_note' || obj.type === 'field_photo') {
    const g0 = worldToLatLon(snap._w0x ?? 0, snap._w0y ?? 0);
    const g1 = worldToLatLon((snap._w0x ?? 0) + dx, (snap._w0y ?? 0) + dy);
    obj.lat = snap.lat + (g1.lat - g0.lat);
    obj.lon = snap.lon + (g1.lon - g0.lon);
  } else if (obj.type === 'import_text') {
    const g0 = worldToLatLon(snap._w0x ?? 0, snap._w0y ?? 0);
    const g1 = worldToLatLon((snap._w0x ?? 0) + dx, (snap._w0y ?? 0) + dy);
    obj.lat = snap.lat + (g1.lat - g0.lat);
    obj.lon = snap.lon + (g1.lon - g0.lon);
  } else if (obj.type === 'text' || obj.type === 'point') {
    obj.x  = snap.x  + dx;  obj.y  = snap.y  + dy;
  } else if (obj.type === 'symbol') {
    obj.x = snap.x + dx;    obj.y = snap.y + dy;
  }
}

// ── Hit-test vertices — returns index or 'radius'/'center' or -1
function nearVertex(obj, wx, wy) {
  const T = (FIELD_MODE ? Math.max(14, 18) : Math.max(8, 10)) / S.scale;
  if (obj.type === 'line' || obj.type === 'arrow' ||
      obj.type === 'polygon' || obj.type === 'zone') {
    const pts = obj.points;
    for (let i = 0; i < pts.length; i += 2) {
      if (Math.hypot(wx - pts[i], wy - pts[i+1]) < T) return i;
    }
  }
  if (obj.type === 'polyline') {
    const verts = obj.vertices || [];
    for (let i = 0; i < verts.length; i++) {
      if (Math.hypot(wx - verts[i].x, wy - verts[i].y) < T) return i;
    }
  }
  if (obj.type === 'circle' || obj.type === 'analysis_zone') {
    const rx = obj.cx + obj.r;
    if (Math.hypot(wx - rx, wy - obj.cy) < T) return 'radius';
    if (Math.hypot(wx - obj.cx, wy - obj.cy) < T) return 'center';
  }
  if (obj.type === 'point') {
    if (Math.hypot(wx - obj.x, wy - obj.y) < Math.max(10, 14) / S.scale) return 'center';
  }
  return -1;
}

function getBoundingCenter(obj) {
  if (obj.type === 'circle' || obj.type === 'analysis_zone') return { x: obj.cx, y: obj.cy };
  if (obj.type === 'field_note' || obj.type === 'field_photo') {
    const w = latLonToWorld(obj.lat, obj.lon);
    return { x: w.x, y: w.y };
  }
  if (obj.type === 'text' || obj.type === 'symbol' || obj.type === 'point') return { x: obj.x, y: obj.y };
  if (obj.type === 'polyline') {
    const verts = obj.vertices || [];
    if (!verts.length) return { x:0, y:0 };
    const xs = verts.map(v=>v.x), ys = verts.map(v=>v.y);
    return { x:(Math.min(...xs)+Math.max(...xs))/2, y:(Math.min(...ys)+Math.max(...ys))/2 };
  }
  const pts = obj.points;
  let minX=1e9, maxX=-1e9, minY=1e9, maxY=-1e9;
  for (let i=0; i<pts.length; i+=2) {
    if (pts[i]   < minX) minX = pts[i];
    if (pts[i]   > maxX) maxX = pts[i];
    if (pts[i+1] < minY) minY = pts[i+1];
    if (pts[i+1] > maxY) maxY = pts[i+1];
  }
  return { x: (minX+maxX)/2, y: (minY+maxY)/2 };
}

// ── Rotate point around center ────────────────────────────────
function rotatePoint(px, py, cx, cy, angle) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  return {
    x: cx + (px-cx)*cos - (py-cy)*sin,
    y: cy + (px-cx)*sin + (py-cy)*cos,
  };
}

// ── Inverse-rotate test point for hit testing ─────────────────
function unrotateForHit(obj, wx, wy) {
  const rot = obj.rotation || 0;
  if (!rot) return { x: wx, y: wy };
  const c = getBoundingCenter(obj);
  return rotatePoint(wx, wy, c.x, c.y, -rot);
}

// ── Rotation handle screen position ──────────────────────────
function getRotateHandleWorld(obj) {
  const c = getBoundingCenter(obj);
  const dist = 44 / S.scale;
  const base = { x: c.x, y: c.y - dist };
  const rot = obj.rotation || 0;
  if (!rot) return { ...base, cx: c.x, cy: c.y };
  const rp = rotatePoint(base.x, base.y, c.x, c.y, rot);
  return { ...rp, cx: c.x, cy: c.y };
}

function geoRingCentroidWorldFlat(flatPts) {
  let x = 0, y = 0;
  const n = flatPts.length / 2;
  if (!n) return { x: 0, y: 0 };
  for (let i = 0; i < flatPts.length; i += 2) {
    x += flatPts[i];
    y += flatPts[i + 1];
  }
  return { x: x / n, y: y / n };
}

function renderPlanGmlMapLabel(text, wx, wy) {
  if (!text) return;
  const lines = String(text).split('\n').filter(Boolean);
  if (!lines.length) return;
  const fs = Math.max(8, 12 / S.scale);
  const lineGap = Math.max(1, 2 / S.scale);
  ctx.save();
  ctx.font = `700 ${fs}px Inter, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const pad = Math.max(2, 4 / S.scale);
  let maxW = 0;
  lines.forEach(line => { maxW = Math.max(maxW, ctx.measureText(line).width); });
  const bw = maxW + pad * 2;
  const bh = lines.length * fs + (lines.length - 1) * lineGap + pad * 2;
  const top = wy - bh / 2;
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = Math.max(0.8, 1.2 / S.scale);
  ctx.fillRect(wx - bw / 2, top, bw, bh);
  ctx.strokeRect(wx - bw / 2, top, bw, bh);
  ctx.fillStyle = '#111';
  lines.forEach((line, i) => {
    const ly = top + pad + fs / 2 + i * (fs + lineGap);
    ctx.fillText(line, wx, ly);
  });
  ctx.restore();
}

// ── Draw hatch pattern inside a closed path (ctx path already set) ─
const _hatchPatternCache = new Map();
const HATCH_PATTERN_CACHE_MAX = 48;

function hatchPatternCacheGet(key) {
  const hit = _hatchPatternCache.get(key);
  if (!hit) return null;
  hit.ts = Date.now();
  return hit.pattern;
}

function hatchPatternCacheSet(key, pattern) {
  if (_hatchPatternCache.size >= HATCH_PATTERN_CACHE_MAX) {
    let oldestKey = null;
    let oldestTs = Infinity;
    _hatchPatternCache.forEach((v, k) => {
      if (v.ts < oldestTs) { oldestTs = v.ts; oldestKey = k; }
    });
    if (oldestKey) _hatchPatternCache.delete(oldestKey);
  }
  _hatchPatternCache.set(key, { pattern, ts: Date.now() });
}

/** MPYY patates baskı — merkez + konsantrik halka noktaları (stippleLayout ile uyumlu). */
function drawRingStampDotsOnCanvas(c, cx, cy, radius, simplified) {
  const dotR = Math.max(0.95, radius * 0.085);
  c.fillStyle = c.strokeStyle;
  c.beginPath();
  c.arc(cx, cy, dotR * 1.05, 0, Math.PI * 2);
  c.fill();
  if (simplified) return;

  const ring1R = radius * 0.32;
  const ring1N = 8;
  for (let i = 0; i < ring1N; i++) {
    const a = (i / ring1N) * Math.PI * 2;
    c.beginPath();
    c.arc(cx + Math.cos(a) * ring1R, cy + Math.sin(a) * ring1R, dotR, 0, Math.PI * 2);
    c.fill();
  }
  const ring2R = radius * 0.52;
  for (let i = 0; i < ring1N; i++) {
    const a = (i / ring1N) * Math.PI * 2 + Math.PI / ring1N;
    c.beginPath();
    c.arc(cx + Math.cos(a) * ring2R, cy + Math.sin(a) * ring2R, dotR * 0.82, 0, Math.PI * 2);
    c.fill();
  }
  const ring3R = radius * 0.72;
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
    c.beginPath();
    c.arc(cx + Math.cos(a) * ring3R, cy + Math.sin(a) * ring3R, dotR * 0.68, 0, Math.PI * 2);
    c.fill();
  }
}

/** Şaşırtmalı karolajda tek damga döşemesi — CanvasPattern ile tek fillRect. */
function getStampHatchPattern(color, cellPx) {
  const cell = Math.max(8, Math.round(cellPx));
  const simplified = cell < 14;
  const key = 'stamp|' + color + '|' + cell + '|' + (simplified ? 's' : 'f');
  const cached = hatchPatternCacheGet(key);
  if (cached) return cached;

  const rowH = Math.round(cell * 0.866);
  const tileH = rowH * 2;
  const off = document.createElement('canvas');
  off.width = cell;
  off.height = tileH;
  const c = off.getContext('2d');
  const circleR = cell * (6 / 18);
  c.fillStyle = color;
  c.strokeStyle = color;

  // staggeredStippleHatchSvg ile aynı: satır0 merkez cell/2, satır1 merkez 0 (cell ≡ 0 döşeme)
  drawRingStampDotsOnCanvas(c, cell / 2, cell / 2, circleR, simplified);
  drawRingStampDotsOnCanvas(c, 0, rowH + cell / 2, circleR, simplified);

  const pattern = ctx.createPattern(off, 'repeat');
  if (pattern) hatchPatternCacheSet(key, pattern);
  return pattern;
}

/** MPYY tarama aralığı: sabit dünya aralığı (mm @ plan ölçeği). LOD yalnızca tile detayı. */
function planGmlHatchMmToWorld(mm) {
  const mapScale = S.projectScale || 1000;
  const meters = (mm / 1000) * mapScale;
  const mPerPx = pxToMeters(1);
  if (!mPerPx || mPerPx <= 0) return 8;
  return Math.max(3, meters / mPerPx);
}

function planGmlHatchCellWorld(pattern, taramaCode, hatchMm) {
  if (hatchMm != null && hatchMm > 0) return planGmlHatchMmToWorld(hatchMm);
  const code = taramaCode || PLAN_GML_PATTERN_TARAMA[pattern] || '';
  const mm = PLAN_GML_TARAMA_MM[code] || PLAN_GML_TARAMA_MM['T-05'] || 4;
  const mapScale = S.projectScale || 1000;
  const meters = (mm / 1000) * mapScale;
  const mPerPx = pxToMeters(1);
  if (!mPerPx || mPerPx <= 0) return 8;
  return Math.max(4, meters / mPerPx);
}

function hatchCellSpacing(pattern, strokeWidth, taramaCode, hatchMm) {
  if (hatchMm != null && hatchMm > 0) return planGmlHatchMmToWorld(hatchMm);
  if (PLAN_GML_SCALE_HATCH_PATTERNS.has(pattern)) {
    return planGmlHatchCellWorld(pattern, taramaCode, hatchMm);
  }
  return Math.max(strokeWidth * 5, 9);
}

function drawHatch(pattern, color, strokeWidth, taramaCode, bounds, hatchMm) {
  if (!pattern || pattern === 'none') return;
  ctx.save();
  ctx.clip();  // clip to current path
  const sp = hatchCellSpacing(pattern, strokeWidth, taramaCode, hatchMm);
  if (!sp || sp <= 0) { ctx.restore(); return; }

  const { x0, y0, x1, y1 } = resolveHatchDrawRect(bounds, sp);
  const w = x1 - x0;
  const h = y1 - y0;

  ctx.strokeStyle = color;
  ctx.fillStyle   = color;
  ctx.setLineDash([]);
  ctx.lineCap = 'round';

  const hatchBounds = { x0, y0, x1, y1 };
  const worldGrid = typeof HatchWorldSpace !== 'undefined';

  switch (pattern) {
    case 'diagonal':
      ctx.lineWidth = strokeWidth * 0.6;
      ctx.globalAlpha = 0.4;
      if (worldGrid) {
        HatchWorldSpace.forEachWorldDiagonal(x0, y0, x1, y1, sp, d => {
          ctx.beginPath(); ctx.moveTo(d, y0); ctx.lineTo(d + h, y1); ctx.stroke();
        });
      } else {
        for (let d = x0 - h; d < x1 + h; d += sp) {
          ctx.beginPath(); ctx.moveTo(d, y0); ctx.lineTo(d + h, y1); ctx.stroke();
        }
      }
      break;

    case 'cross':
      ctx.lineWidth = strokeWidth * 0.5;
      ctx.globalAlpha = 0.35;
      if (worldGrid) {
        HatchWorldSpace.forEachWorldDiagonal(x0, y0, x1, y1, sp, d => {
          ctx.beginPath(); ctx.moveTo(d, y0); ctx.lineTo(d + h, y1); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x0, d); ctx.lineTo(x1, d - w); ctx.stroke();
        });
      } else {
        for (let d = x0 - h; d < x1 + h; d += sp) {
          ctx.beginPath(); ctx.moveTo(d, y0); ctx.lineTo(d + h, y1); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x0, d); ctx.lineTo(x1, d - w); ctx.stroke();
        }
      }
      break;

    case 'grid':
      ctx.lineWidth = Math.max(0.7, strokeWidth * 0.55);
      ctx.globalAlpha = 0.62;
      if (worldGrid) {
        HatchWorldSpace.forEachWorldGrid(x0, y0, x1, y1, sp, (axis, v) => {
          ctx.beginPath();
          if (axis === 'h') { ctx.moveTo(x0, v); ctx.lineTo(x1, v); }
          else { ctx.moveTo(v, y0); ctx.lineTo(v, y1); }
          ctx.stroke();
        });
      } else {
        for (let y = y0; y < y1; y += sp) {
          ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        }
        for (let x = x0; x < x1; x += sp) {
          ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
        }
      }
      break;

    case 'horizontal':
      ctx.lineWidth = strokeWidth * 0.5;
      ctx.globalAlpha = 0.35;
      if (worldGrid) {
        const oy = HatchWorldSpace.snapOrigin(x0, y0, sp).y;
        for (let y = oy; y < y1; y += sp) {
          ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        }
      } else {
        for (let y = y0; y < y1; y += sp) {
          ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        }
      }
      break;

    case 'vertical':
      ctx.lineWidth = strokeWidth * 0.5;
      ctx.globalAlpha = 0.35;
      if (worldGrid) {
        const ox = HatchWorldSpace.snapOrigin(x0, y0, sp).x;
        for (let x = ox; x < x1; x += sp) {
          ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
        }
      } else {
        for (let x = x0; x < x1; x += sp) {
          ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
        }
      }
      break;

    case 'dots':
      if (worldGrid) {
        HatchWorldSpace.fillRepeating(ctx, 'dots', color, sp, hatchBounds, 0.5);
      } else {
        ctx.globalAlpha = 0.5;
        const r = Math.max(0.8, sp * 0.08);
        const o = HatchWorldSpace ? HatchWorldSpace.snapOrigin(x0, y0, sp) : { x: x0, y: y0 };
        for (let x = o.x; x < x1; x += sp)
          for (let y = o.y; y < y1; y += sp) {
            ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
          }
      }
      break;

    case 'parkDots':
      if (worldGrid) {
        HatchWorldSpace.fillRepeating(ctx, 'parkDots', color, sp, hatchBounds, 0.72);
      }
      break;

    case 'stamp':
      if (worldGrid) {
        HatchWorldSpace.fillRepeating(ctx, 'stamp', color, sp, hatchBounds, 0.68);
      }
      break;

    case 'concentric': {
      ctx.lineWidth = Math.max(0.6, strokeWidth * 0.45);
      ctx.globalAlpha = 0.42;
      const cell = sp * 1.15;
      const r1 = Math.max(1.1, cell * 0.18);
      const r2 = r1 * 0.42;
      const o = worldGrid ? HatchWorldSpace.snapOrigin(x0, y0, cell) : { x: x0, y: y0 };
      for (let x = o.x; x < x1; x += cell) {
        for (let y = o.y; y < y1; y += cell) {
          ctx.beginPath(); ctx.arc(x, y, r1, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.arc(x, y, r2, 0, Math.PI * 2); ctx.stroke();
        }
      }
      break;
    }

    case 'ecology': {
      // Organic wavy lines — like vegetation/ecology symbols
      ctx.lineWidth = strokeWidth * 0.55;
      ctx.globalAlpha = 0.45;
      const freq = sp * 0.7, amp = sp * 0.35;
      for (let y = y0; y < y1; y += sp) {
        ctx.beginPath();
        for (let x = x0; x < x1; x += 4) {
          const wy = y + Math.sin(x / freq) * amp;
          if (x === x0) ctx.moveTo(x, wy); else ctx.lineTo(x, wy);
        }
        ctx.stroke();
      }
      break;
    }

    case 'density': {
      // Fine tight cross-hatch at 45° both ways
      const dsp = sp * 0.55;
      ctx.lineWidth = strokeWidth * 0.35;
      ctx.globalAlpha = 0.3;
      for (let d = x0 - h; d < x1 + h; d += dsp) {
        ctx.beginPath(); ctx.moveTo(d, y0); ctx.lineTo(d + h, y1); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x0, d); ctx.lineTo(x1, d - w); ctx.stroke();
      }
      break;
    }

    case 'circulation': {
      // Diagonal dashes with slight movement feel
      ctx.lineWidth = strokeWidth * 0.7;
      ctx.globalAlpha = 0.4;
      ctx.setLineDash([sp * 0.6, sp * 0.5]);
      for (let d = x0 - h; d < x1 + h; d += sp * 1.4) {
        ctx.beginPath(); ctx.moveTo(d, y0); ctx.lineTo(d + h, y1); ctx.stroke();
      }
      ctx.setLineDash([]);
      break;
    }

    case 'sketch': {
      // Irregular hand-drawn lines at varying angles
      ctx.lineWidth = strokeWidth * 0.55;
      ctx.globalAlpha = 0.38;
      const rng = (s) => (Math.sin(s * 127.1 + 311.7) * 0.5 + 0.5);
      for (let y = y0; y < y1; y += sp * 1.2) {
        const jitter = rng(y) * sp * 0.4;
        ctx.beginPath();
        for (let x = x0; x < x1; x += 6) {
          const wy = y + jitter + Math.sin(x * 0.07 + y * 0.05) * sp * 0.22;
          if (x === x0) ctx.moveTo(x, wy); else ctx.lineTo(x, wy);
        }
        ctx.stroke();
      }
      break;
    }

    case 'gradient':
      // Radial gradient overlay — analysis zone feel
      ctx.globalAlpha = 0.4;
      try {
        const cx = (x0 + x1) / 2;
        const cy = (y0 + y1) / 2;
        const rad = Math.max(w, h) * 0.6;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        grad.addColorStop(0,   color + 'cc');
        grad.addColorStop(0.5, color + '55');
        grad.addColorStop(1,   color + '00');
        ctx.fillStyle = grad;
        ctx.fillRect(x0, y0, w, h);
      } catch(e) {}
      break;

    case 'watercolor': {
      // Soft layered color blobs — impressionistic fill
      ctx.globalAlpha = 0.08;
      const blobSz = sp * 3;
      for (let x = x0; x < x1; x += blobSz * 0.8) {
        for (let y = y0; y < y1; y += blobSz * 0.8) {
          const ox = (Math.sin(x * 0.12 + y * 0.07) * blobSz * 0.3);
          const oy = (Math.cos(x * 0.09 - y * 0.11) * blobSz * 0.3);
          const r  = blobSz * (0.5 + Math.sin(x * 0.05 + y * 0.08) * 0.2);
          ctx.beginPath(); ctx.arc(x+ox, y+oy, r, 0, Math.PI*2); ctx.fill();
        }
      }
      break;
    }
  }
  ctx.restore();
}

// ── Render rotation handle for selected object ─────────────────
function renderRotationHandle(obj) {
  if (obj.type === 'circle') return; // circles have no direction
  const h  = getRotateHandleWorld(obj);
  const sz = 5 / S.scale;

  ctx.save();
  // Line from center to handle
  ctx.strokeStyle = 'rgba(80,160,255,0.5)';
  ctx.lineWidth   = 1 / S.scale;
  ctx.setLineDash([3/S.scale, 3/S.scale]);
  ctx.beginPath(); ctx.moveTo(h.cx, h.cy); ctx.lineTo(h.x, h.y); ctx.stroke();

  // Handle dot
  ctx.setLineDash([]);
  ctx.fillStyle   = S.rotating && S.rotateId === obj.id ? '#4fc3f7' : '#ffffff';
  ctx.strokeStyle = '#4488ff';
  ctx.lineWidth   = 1.5 / S.scale;
  ctx.beginPath(); ctx.arc(h.x, h.y, sz, 0, Math.PI*2);
  ctx.fill(); ctx.stroke();

  // Rotation arc hint
  ctx.strokeStyle = 'rgba(80,160,255,0.25)';
  ctx.lineWidth   = 1 / S.scale;
  ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(h.cx, h.cy, 44/S.scale, -Math.PI*0.7, -Math.PI*0.3);
  ctx.stroke();
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────
// LINE DASH
// ─────────────────────────────────────────────────────────────
function applyDash(style, w) {
  const map = {
    solid:      [],
    dashed:     [w*5, w*2.5],
    dotted:     [w*0.8, w*3],
    'dash-dot': [w*5, w*2, w, w*2],
    'long-dash':[w*10, w*3],
    boundary:   [w*6, w*3, w*2, w*3],
    barrier:    [w*2, w*1.5],
    ecological: [w*3, w],
  };
  ctx.setLineDash(map[style] || []);
  if (style === 'dotted') ctx.lineCap = 'round';
}

// ─────────────────────────────────────────────────────────────
// ARROWHEAD
// ─────────────────────────────────────────────────────────────
function drawHead(x1, y1, x2, y2, size, style, color, sw) {
  const ang = Math.atan2(y2-y1, x2-x1);
  const sp  = Math.PI / 6;
  const lx  = x2 - size * Math.cos(ang - sp);
  const ly  = y2 - size * Math.sin(ang - sp);
  const rx  = x2 - size * Math.cos(ang + sp);
  const ry  = y2 - size * Math.sin(ang + sp);

  ctx.save();
  ctx.setLineDash([]);
  ctx.strokeStyle = color; ctx.fillStyle = color;
  ctx.lineWidth = sw; ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  switch (style) {
    case 'open':
      ctx.beginPath(); ctx.moveTo(lx,ly); ctx.lineTo(x2,y2); ctx.lineTo(rx,ry); ctx.stroke(); break;
    case 'outline':
      ctx.beginPath(); ctx.moveTo(x2,y2); ctx.lineTo(lx,ly); ctx.lineTo(rx,ry); ctx.closePath();
      ctx.fillStyle = 'transparent'; ctx.stroke(); break;
    case 'chevron': {
      const sp2 = Math.PI/7;
      ctx.beginPath();
      ctx.moveTo(x2-size*.6*Math.cos(ang-sp2), y2-size*.6*Math.sin(ang-sp2));
      ctx.lineTo(x2,y2);
      ctx.lineTo(x2-size*.6*Math.cos(ang+sp2), y2-size*.6*Math.sin(ang+sp2));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x2-size*Math.cos(ang-sp2), y2-size*Math.sin(ang-sp2));
      ctx.lineTo(x2-size*.4, y2);
      ctx.lineTo(x2-size*Math.cos(ang+sp2), y2-size*Math.sin(ang+sp2));
      ctx.stroke();
      break;
    }
    case 'block': {
      // Filled block/play-button style arrow
      const w2 = size * 0.6;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - size * Math.cos(ang - sp), y2 - size * Math.sin(ang - sp));
      ctx.lineTo(x2 - size * Math.cos(ang), y2 - size * Math.sin(ang));
      ctx.lineTo(x2 - size * Math.cos(ang + sp), y2 - size * Math.sin(ang + sp));
      ctx.closePath(); ctx.fill(); break;
    }
    case 'double': {
      // Two concentric filled heads
      ctx.beginPath(); ctx.moveTo(x2,y2); ctx.lineTo(lx,ly); ctx.lineTo(rx,ry); ctx.closePath(); ctx.fill();
      const off = size * 0.55;
      const ox = x2 - off * Math.cos(ang), oy = y2 - off * Math.sin(ang);
      const lx2 = ox - size*0.75*Math.cos(ang-sp), ly2 = oy - size*0.75*Math.sin(ang-sp);
      const rx2 = ox - size*0.75*Math.cos(ang+sp), ry2 = oy - size*0.75*Math.sin(ang+sp);
      ctx.beginPath(); ctx.moveTo(ox,oy); ctx.lineTo(lx2,ly2); ctx.lineTo(rx2,ry2); ctx.closePath(); ctx.fill();
      break;
    }
    default: // filled
      ctx.beginPath(); ctx.moveTo(x2,y2); ctx.lineTo(lx,ly); ctx.lineTo(rx,ry); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

/** MPYY sınır — dünya koordinatlı çizgi üzerinde periyot (mm @ plan ölçeği). */
function planGmlBoundaryPeriodPx(periodMm) {
  if (typeof MpyyPlanGmlCatalog !== 'undefined' && MpyyPlanGmlCatalog.mmToScreenUnits) {
    return MpyyPlanGmlCatalog.mmToScreenUnits(periodMm || 10, S.projectScale || 1000, pxToMeters(1));
  }
  return Math.max(6, (periodMm || 10) * 0.35);
}

function forEachPointOnFlatPath(flatPts, intervalPx, fn) {
  if (!flatPts || flatPts.length < 4 || intervalPx <= 0) return;
  let traveled = 0;
  let nextMark = intervalPx * 0.5;
  for (let i = 0; i < flatPts.length - 2; i += 2) {
    const x0 = flatPts[i];
    const y0 = flatPts[i + 1];
    const x1 = flatPts[i + 2];
    const y1 = flatPts[i + 3];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const segLen = Math.hypot(dx, dy);
    if (segLen <= 0) continue;
    const ang = Math.atan2(dy, dx);
    while (nextMark <= traveled + segLen) {
      const t = (nextMark - traveled) / segLen;
      if (t >= 0 && t <= 1) {
        fn(x0 + dx * t, y0 + dy * t, ang);
      }
      nextMark += intervalPx;
    }
    traveled += segLen;
  }
}

function drawMpyyBoundaryDecorations(flatPts, pattern, params, color, strokeW) {
  if (!pattern || !flatPts || flatPts.length < 4) return;
  const p = params || {};
  const mPerPx = pxToMeters(1);
  const scale = S.projectScale || 1000;
  const mmPx = (mm) => (typeof MpyyPlanGmlCatalog !== 'undefined'
    ? MpyyPlanGmlCatalog.mmToScreenUnits(mm, scale, mPerPx)
    : Math.max(1, mm * 0.35));

  const circleR = mmPx(p.circleDiameterMM || 5) * 0.5;
  const dotR = Math.max(0.6, mmPx(p.dotDiameterMM || 1) * 0.5);
  const tickLen = mmPx(p.perpendicularLengthMM || 5);
  const period = mmPx((p.circleDiameterMM || 0) + (p.gapMM || 0))
    || planGmlBoundaryPeriodPx((p.circleDiameterMM || 5) + (p.gapMM || 2.5));

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(0.8, strokeW * 0.85);
  ctx.lineCap = 'round';

  const decoPatterns = new Set([
    'hollow_circle_repeat', 'alt_filled_hollow_circle', 'filled_circle_dash',
    'dash_repeated_dots', 'dash_group_dots', 'tick_circle', 'parallel_staggered_ticks',
    'plus_in_circle_repeat', 'plus_repeat', 'hollow_triangle_dot_repeat',
  ]);

  if (!decoPatterns.has(pattern)) {
    ctx.restore();
    return;
  }

  let idx = 0;
  forEachPointOnFlatPath(flatPts, period, (x, y, ang) => {
    idx++;
    if (/circle|filled_circle/i.test(pattern)) {
      ctx.beginPath();
      ctx.arc(x, y, circleR, 0, Math.PI * 2);
      if (/filled/i.test(pattern)) ctx.fill();
      else ctx.stroke();
    } else if (/dot/i.test(pattern)) {
      ctx.beginPath();
      ctx.arc(x, y, dotR, 0, Math.PI * 2);
      ctx.fill();
    } else if (/tick/i.test(pattern)) {
      const nx = -Math.sin(ang);
      const ny = Math.cos(ang);
      ctx.beginPath();
      ctx.moveTo(x - nx * tickLen * 0.5, y - ny * tickLen * 0.5);
      ctx.lineTo(x + nx * tickLen * 0.5, y + ny * tickLen * 0.5);
      ctx.stroke();
    } else if (/plus/i.test(pattern)) {
      const s = dotR * 2.2;
      ctx.beginPath();
      ctx.moveTo(x - s, y); ctx.lineTo(x + s, y);
      ctx.moveTo(x, y - s); ctx.lineTo(x, y + s);
      ctx.stroke();
    }
  });
  ctx.restore();
}

function resolvePlanGmlBoundaryDash(obj, planStyle, strokeW) {
  if (obj.boundaryDash?.length) return obj.boundaryDash;
  if (planStyle?.boundaryDash?.length) return planStyle.boundaryDash;
  if ((planStyle?.lineStyle || obj.lineStyle) === 'dashed') {
    return [strokeW * 2.2 / S.scale, strokeW * 1.6 / S.scale];
  }
  return [];
}

function strokePlanGmlBoundaryPath(flatPts, obj, planStyle, stroke, strokeW, closed) {
  if (!flatPts || flatPts.length < 4) return;
  const pattern = obj.boundaryPattern || planStyle?.boundaryPattern;
  const params = obj.boundaryParams || planStyle?.boundaryParams;
  const dash = resolvePlanGmlBoundaryDash(obj, planStyle, strokeW);

  ctx.strokeStyle = stroke;
  ctx.lineWidth = strokeW;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(flatPts[0], flatPts[1]);
  for (let i = 2; i < flatPts.length; i += 2) ctx.lineTo(flatPts[i], flatPts[i + 1]);
  if (closed) ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);

  const decoPts = closed && flatPts.length >= 4
    ? flatPts.concat(flatPts[0], flatPts[1])
    : flatPts;
  if (pattern && !RenderCoordinator.isLowRenderMode()) {
    drawMpyyBoundaryDecorations(decoPts, pattern, params, stroke, strokeW);
  }
}

// ─────────────────────────────────────────────────────────────
// RENDER OBJECT
// ─────────────────────────────────────────────────────────────
// Wrap with rotation transform, then draw handle
function renderImportObj(obj, sel) {
  if (!obj.visible) return;
  const infoFocus = FIELD_MODE && _fieldInfoObjId === obj.id;
  const showMeasureLabels = sel && !infoFocus && S.tool !== 'info' && !obj._planOverlay;
  const showHighlight = (sel && !infoFocus) || infoFocus;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (obj.type === 'import_polygon') {
    const rings = obj.rings || [];
    if (!rings.length) { ctx.restore(); return; }
    const planStyle = planGmlStyleForObject(obj);
    const strokeW = planStyle?.strokeWidth || obj.strokeWidth || IMPORT_STYLE.polygon.strokeWidth;
    const noFill = !!(planStyle?.noFill || planGmlIsOutlineOnly(obj.metadata?.planFeatureType));
    const fill = noFill ? 'transparent' : (planStyle?.fillColor || obj.fillColor || IMPORT_STYLE.polygon.fillColor);
    const stroke = planStyle?.color || obj.color || IMPORT_STYLE.polygon.color;
    const hatchPat = noFill ? 'none' : (planStyle?.hatchPattern || obj.hatchPattern);
    const hatchCol = obj.hatchColor || planStyle?.hatchColor || stroke;
    const taramaCode = obj.taramaCode || planStyle?.taramaCode || '';
    const hatchMm = obj.hatchMm ?? planStyle?.hatchMm ?? null;
    const drawRing = (ring, fillIt) => {
      const pts = geoRingToWorldFlat(ring);
      if (pts.length < 6) return;
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.closePath();
      if (fillIt && !noFill) {
        ctx.globalAlpha = obj.opacity ?? 1;
        ctx.fillStyle = fill;
        ctx.fill();
        if (hatchPat && hatchPat !== 'none'
            && !obj._skipHatch
            && !RenderCoordinator.shouldSkipHatch()
            && (!obj._planOverlay || S.scale >= PLAN_OVERLAY_HATCH_MIN_SCALE)) {
          drawHatch(hatchPat, hatchCol, strokeW, taramaCode, flatPtsBounds(pts), hatchMm);
        }
      }
      ctx.globalAlpha = obj.opacity ?? 1;
      if (obj.boundaryPattern || planStyle?.boundaryPattern) {
        strokePlanGmlBoundaryPath(pts, obj, planStyle, stroke, strokeW, true);
      } else {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = strokeW;
        ctx.setLineDash(obj.lineStyle === 'dashed' ? [strokeW * 2.2 / S.scale, strokeW * 1.6 / S.scale] : []);
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      }
    };
    drawRing(rings[0], !noFill);
    (obj.holes || []).forEach(h => drawRing(h, false));
    const ringPts = geoRingToWorldFlat(rings[0]);
    if (showMeasureLabels && !RenderCoordinator.isLowRenderMode() && ringPts.length >= 6) {
      renderClosedAreaLabel(ringPts);
    }
    if (obj._planOverlay && isPlanGmlImportObj(obj) && !RenderCoordinator.isLowRenderMode()
        && !obj._skipHatch
        && S.scale >= PLAN_GML_LABEL_MIN_SCALE) {
      const lblLines = planGmlMapLabelLines(planGmlInferProps(obj), obj.metadata?.planFeatureType);
      if (lblLines.length) {
        const c = geoRingCentroidWorldFlat(ringPts);
        renderPlanGmlMapLabel(lblLines.join('\n'), c.x, c.y);
      }
    }
    if (showHighlight) {
      const pts = ringPts;
      ctx.save();
      ctx.strokeStyle = infoFocus ? '#1a73e8' : '#4488ff';
      ctx.lineWidth = strokeW + 4;
      ctx.globalAlpha = infoFocus ? 0.28 : 0.2;
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  } else if (obj.type === 'import_polyline') {
    const verts = obj.vertices || [];
    if (verts.length < 2) { ctx.restore(); return; }
    const planStyle = planGmlStyleForObject(obj);
    const strokeW = planStyle?.strokeWidth || obj.strokeWidth || IMPORT_STYLE.polyline.strokeWidth;
    const stroke = planStyle?.color || obj.color || IMPORT_STYLE.polyline.color;
    ctx.globalAlpha = obj.opacity ?? 1;
    const flatPts = [];
    for (let i = 0; i < verts.length; i++) {
      const w = latLonToWorld(verts[i].lat, verts[i].lon);
      flatPts.push(w.x, w.y);
    }
    if (obj.boundaryPattern || planStyle?.boundaryPattern) {
      strokePlanGmlBoundaryPath(flatPts, obj, planStyle, stroke, strokeW);
    } else {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = strokeW;
      ctx.setLineDash((planStyle?.lineStyle || obj.lineStyle) === 'dashed'
        ? [strokeW * 2.2 / S.scale, strokeW * 1.6 / S.scale] : []);
      ctx.beginPath();
      ctx.moveTo(flatPts[0], flatPts[1]);
      for (let i = 2; i < flatPts.length; i += 2) ctx.lineTo(flatPts[i], flatPts[i + 1]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (showMeasureLabels) renderImportSegmentLabels(verts);
    if (showHighlight) {
      ctx.save();
      ctx.strokeStyle = infoFocus ? '#1a73e8' : '#4488ff';
      ctx.lineWidth = strokeW + (infoFocus ? 3 : 5);
      ctx.globalAlpha = infoFocus ? 0.28 : 0.18;
      ctx.stroke();
      ctx.restore();
    }
  } else if (obj.type === 'import_text') {
    const w = latLonToWorld(obj.lat, obj.lon);
    const fs = Math.max(8, (obj.fontSize || 12) / S.scale);
    ctx.font = `${fs}px Inter, sans-serif`;
    ctx.textBaseline = 'top';
    const m = ctx.measureText(obj.text || '');
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(w.x - 2, w.y - 2, m.width + 4, fs * 1.25);
    ctx.fillStyle = obj.color || '#1a1a2e';
    ctx.fillText(obj.text || '', w.x, w.y);
    if (showHighlight) {
      ctx.strokeStyle = infoFocus ? '#1a73e8' : '#4488ff';
      ctx.lineWidth = 2 / S.scale;
      ctx.strokeRect(w.x - 3, w.y - 3, m.width + 6, fs * 1.3);
    }
  } else if (obj.type === 'import_point') {
    const w = latLonToWorld(obj.lat, obj.lon);
    const r = obj.r || IMPORT_STYLE.point.r;
    ctx.globalAlpha = obj.opacity ?? 1;
    ctx.fillStyle = obj.color || IMPORT_STYLE.point.color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(2, (obj.strokeWidth || 2) / S.scale);
    ctx.beginPath();
    ctx.arc(w.x, w.y, Math.max(r / S.scale, 6 / S.scale), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (showHighlight) {
      ctx.strokeStyle = infoFocus ? '#1a73e8' : '#4488ff';
      ctx.lineWidth = 2 / S.scale;
      ctx.setLineDash([4 / S.scale, 3 / S.scale]);
      ctx.beginPath();
      ctx.arc(w.x, w.y, Math.max(r / S.scale, 6 / S.scale) + 5 / S.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  ctx.restore();
}

function drawEarthPhotoMarker(ctx, x, y, scale, selected, obj) {
  const s = 1 / scale;
  const tw = 40 * s;
  const th = 30 * s;
  const tx = x - tw / 2;
  const ty = y - th - 8 * s;
  const r = 4 * s;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = 6 * s;
  ctx.shadowOffsetY = 2 * s;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = selected ? '#E53935' : 'rgba(0,0,0,.25)';
  ctx.lineWidth = (selected ? 2.5 : 1.5) * s;
  ctx.beginPath();
  ctx.moveTo(tx + r, ty);
  ctx.lineTo(tx + tw - r, ty);
  ctx.quadraticCurveTo(tx + tw, ty, tx + tw, ty + r);
  ctx.lineTo(tx + tw, ty + th - r);
  ctx.quadraticCurveTo(tx + tw, ty + th, tx + tw - r, ty + th);
  ctx.lineTo(tx + r, ty + th);
  ctx.quadraticCurveTo(tx, ty + th, tx, ty + th - r);
  ctx.lineTo(tx, ty + r);
  ctx.quadraticCurveTo(tx, ty, tx + r, ty);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.shadowColor = 'transparent';
  const pad = 3 * s;
  const iw = tw - pad * 2;
  const ih = th - pad * 2 - (obj.title && scale > 0.2 ? 8 * s : 0);
  if (obj._thumbImg && obj._thumbImg.complete && obj._thumbImg.naturalWidth) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(tx + pad, ty + pad, iw, ih);
    ctx.clip();
    ctx.drawImage(obj._thumbImg, tx + pad, ty + pad, iw, ih);
    ctx.restore();
  } else {
    ctx.fillStyle = '#e8eaed';
    ctx.fillRect(tx + pad, ty + pad, iw, ih);
    ctx.fillStyle = '#5f6368';
    ctx.font = `bold ${Math.max(14, 18 * s)}px Inter,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('📷', x, ty + pad + ih / 2);
  }
  if (obj.photoNum != null && scale > 0.15) {
    ctx.fillStyle = selected ? '#E53935' : '#1a73e8';
    ctx.beginPath();
    ctx.arc(tx + tw - 6 * s, ty + 6 * s, 7 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${Math.max(8, 9 * s)}px Inter,sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(obj.photoNum), tx + tw - 6 * s, ty + 6 * s);
  }
  if (obj.hasVoice) {
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.arc(tx + 8 * s, ty + 8 * s, 5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `bold ${Math.max(7, 8 * s)}px sans-serif`;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText('🎤', tx + 8 * s, ty + 8 * s + 1 * s);
  }
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = selected ? '#E53935' : 'rgba(0,0,0,.2)';
  ctx.lineWidth = 1 * s;
  ctx.beginPath();
  ctx.moveTo(x - 5 * s, y - 8 * s);
  ctx.lineTo(x + 5 * s, y - 8 * s);
  ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function renderFieldSpatialObj(obj, sel) {
  if (!obj.visible) return;
  const w = latLonToWorld(obj.lat, obj.lon);
  if (obj.type === 'field_note') {
    ctx.save();
    ctx.globalAlpha = obj.opacity ?? 1;
    const isSel = sel || S.selectedIds.includes(obj.id);
    drawEarthPushpin(ctx, w.x, w.y, S.scale, isSel, obj.noteNum);
    ctx.restore();
  } else if (obj.type === 'field_photo') {
    if (!obj._thumbReady) prefetchPhotoThumb(obj);
    const isSel = sel || S.selectedIds.includes(obj.id);
    drawEarthPhotoMarker(ctx, w.x, w.y, S.scale, isSel, obj);
  }
}

function renderObjFull(obj, sel) {
  if (obj.type === 'field_note' || obj.type === 'field_photo') {
    renderFieldSpatialObj(obj, sel);
    return;
  }
  if (obj.type === 'field_gps_track') {
    const verts = obj.vertices || [];
    const replaying = _gpsTrackReplay.objId === obj.id && _gpsTrackReplay.pos;
    const isLiveObj = _gpsTrack.objId === obj.id && (_gpsTrack.state === 'recording' || _gpsTrack.state === 'paused');
    const liveRecording = isLiveObj && _gpsTrack.state === 'recording';
    const disp = liveRecording ? getGpsLiveRouteTip() : null;
    const hasTip = liveRecording && disp && verts.length >= 1;
    const drawVerts = buildGpsTrackDisplayVerts(verts, hasTip ? disp : null);
    if (drawVerts.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = obj.opacity ?? 0.92;
    ctx.strokeStyle = replaying ? '#27ae60' : (isLiveObj ? '#0d47a1' : (obj.color || '#1565c0'));
    ctx.lineWidth = replaying ? (obj.strokeWidth || 3) + 1 : (isLiveObj ? (obj.strokeWidth || 3) + 0.5 : (obj.strokeWidth || 3));
    if (!isLiveObj) ctx.setLineDash([8 / S.scale, 6 / S.scale]);
    const w0 = latLonToWorld(drawVerts[0].lat, drawVerts[0].lon);
    ctx.beginPath();
    ctx.moveTo(w0.x, w0.y);
    for (let i = 1; i < drawVerts.length; i++) {
      const w = latLonToWorld(drawVerts[i].lat, drawVerts[i].lon);
      ctx.lineTo(w.x, w.y);
    }
    ctx.stroke();
    if (hasTip && verts.length >= 1) {
      const wA = verts.length >= 2
        ? latLonToWorld(verts[verts.length - 1].lat, verts[verts.length - 1].lon)
        : w0;
      const wB = latLonToWorld(disp.lat, disp.lon);
      ctx.strokeStyle = '#42a5f5';
      ctx.globalAlpha = 0.38;
      ctx.lineWidth = (obj.strokeWidth || 3) + 3.5;
      ctx.beginPath();
      ctx.moveTo(wA.x, wA.y);
      ctx.lineTo(wB.x, wB.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (sel) {
      ctx.strokeStyle = '#4488ff';
      ctx.lineWidth = (obj.strokeWidth || 3) + 3;
      ctx.globalAlpha = 0.2;
      ctx.beginPath();
      ctx.moveTo(w0.x, w0.y);
      for (let i = 1; i < drawVerts.length; i++) {
        const w = latLonToWorld(drawVerts[i].lat, drawVerts[i].lon);
        ctx.lineTo(w.x, w.y);
      }
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  if (obj.type === 'import_polygon' || obj.type === 'import_polyline' || obj.type === 'import_point' || obj.type === 'import_text') {
    renderImportObj(obj, sel);
    return;
  }
  const rot = obj.rotation || 0;
  if (rot) {
    const c = getBoundingCenter(obj);
    ctx.save();
    ctx.translate(c.x, c.y); ctx.rotate(rot); ctx.translate(-c.x, -c.y);
    renderObj(obj, sel);
    ctx.restore();
  } else {
    renderObj(obj, sel);
  }
  if (sel) renderRotationHandle(obj);
}

// Draw vertex/endpoint handles on points array
function renderVertexHandles(pts, isEndpointsOnly) {
  ctx.save(); ctx.setLineDash([]);
  const sz = FIELD_MODE ? Math.max(8, 14 / S.scale) : Math.max(4, 5 / S.scale);
  for (let i = 0; i < pts.length; i += 2) {
    const isEndpoint = i === 0 || i === pts.length - 2;
    // Highlight active vertex being dragged
    const isActive = S.vertexDragging && S.vertexObjId && S.vertexIdx === i;
    ctx.fillStyle   = isActive ? '#ffcc00' : (isEndpoint ? '#4488ff' : '#fff');
    ctx.strokeStyle = isActive ? '#ff8800' : '#4488ff';
    ctx.lineWidth   = isEndpointsOnly ? 1.5 / S.scale : 1.2 / S.scale;
    if (isEndpointsOnly && !isEndpoint) continue;
    ctx.beginPath(); ctx.arc(pts[i], pts[i+1], sz, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

function renderObj(obj, sel) {
  if (!obj.visible) return;
  if (obj.type === 'field_note' || obj.type === 'field_photo') {
    renderFieldSpatialObj(obj, sel);
    return;
  }
  if (obj.type === 'import_polygon' || obj.type === 'import_polyline' || obj.type === 'import_point' || obj.type === 'import_text') {
    renderImportObj(obj, sel);
    return;
  }
  ctx.save();
  ctx.globalAlpha = obj.opacity;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  function selHalo(path) {
    if (!sel) return;
    ctx.save();
    ctx.strokeStyle = '#4488ff'; ctx.lineWidth = obj.strokeWidth + 9;
    ctx.globalAlpha = 0.15; ctx.setLineDash([]);
    path(); ctx.stroke();
    ctx.restore();
  }

  // FREEDRAW
  if (obj.type === 'freedraw') {
    const pts = obj.points;
    if (pts.length < 2) { ctx.restore(); return; }
    ctx.strokeStyle = obj.color; ctx.lineWidth = obj.strokeWidth;
    applyDash(obj.lineStyle, obj.strokeWidth);

    const drawPath = () => {
      ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
      if (pts.length <= 4) {
        if (pts.length >= 4) ctx.lineTo(pts[2], pts[3]);
      } else {
        const t = obj.tension * 2;
        for (let i = 0; i < pts.length - 2; i += 2) {
          const x0 = i > 0 ? pts[i-2] : pts[0], y0 = i > 0 ? pts[i-1] : pts[1];
          const x1 = pts[i], y1 = pts[i+1];
          const x2 = pts[i+2], y2 = pts[i+3];
          const x3 = i+4 < pts.length ? pts[i+4] : x2, y3 = i+5 < pts.length ? pts[i+5] : y2;
          ctx.bezierCurveTo(x1+(x2-x0)/6*t, y1+(y2-y0)/6*t, x2-(x3-x1)/6*t, y2-(y3-y1)/6*t, x2, y2);
        }
      }
    };
    selHalo(drawPath); drawPath(); ctx.stroke();
    if (pts.length < 4) {
      ctx.fillStyle = obj.color;
      ctx.beginPath(); ctx.arc(pts[0], pts[1], obj.strokeWidth/2, 0, Math.PI*2); ctx.fill();
    }
  }

  // LINE
  else if (obj.type === 'line') {
    const [x1,y1,x2,y2] = obj.points;
    const sw = obj.strokeWidth;
    const ang = Math.atan2(y2-y1, x2-x1);
    const len = Math.hypot(x2-x1, y2-y1);
    if (len < 1) { ctx.restore(); return; }

    const deco = obj.lineDecoration || 'none';
    const headSz = sw * 5 + 8;
    const offStart = (deco==='start'||deco==='both') ? headSz * 0.85 : 0;
    const offEnd   = (deco==='end'  ||deco==='both') ? headSz * 0.85 : 0;
    const lx1 = x1 + offStart * Math.cos(ang), ly1 = y1 + offStart * Math.sin(ang);
    const lx2 = x2 - offEnd   * Math.cos(ang), ly2 = y2 - offEnd   * Math.sin(ang);

    if (obj.lineStyle === 'parallel') {
      const perp = ang + Math.PI/2, off = sw * 1.6;
      ctx.strokeStyle = obj.color; ctx.lineWidth = sw * 0.7; ctx.setLineDash([]);
      selHalo(()=>{ ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); });
      for (const sign of [-1, 1]) {
        const ox = Math.cos(perp)*off*sign, oy = Math.sin(perp)*off*sign;
        ctx.beginPath(); ctx.moveTo(lx1+ox,ly1+oy); ctx.lineTo(lx2+ox,ly2+oy); ctx.stroke();
      }
    } else {
      ctx.strokeStyle = obj.color; ctx.lineWidth = sw;
      applyDash(obj.lineStyle, sw);
      selHalo(()=>{ ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); });
      ctx.beginPath(); ctx.moveTo(lx1,ly1); ctx.lineTo(lx2,ly2); ctx.stroke();
    }
    ctx.setLineDash([]);
    if (deco==='end'   || deco==='both') drawHead(x1,y1,x2,y2,headSz,'filled',obj.color,sw);
    if (deco==='start' || deco==='both') drawHead(x2,y2,x1,y1,headSz,'filled',obj.color,sw);
    // Endpoint handles
    if (sel) renderVertexHandles(obj.points, true);
  }

  // ARROW
  else if (obj.type === 'arrow') {
    const [x1,y1,x2,y2] = obj.points;
    const { arrowStyle: style, color, strokeWidth: sw } = obj;
    const len = Math.hypot(x2-x1, y2-y1);
    if (len < 2) { ctx.restore(); return; }
    const headSz = sw * 5 + 10;
    const ang    = Math.atan2(y2-y1, x2-x1);
    // Retract = headSz + half stroke so thick lines don't visually protrude into head
    const retract = headSz * 0.92 + sw * 0.5;
    const ex = x2 - retract * Math.cos(ang);
    const ey = y2 - retract * Math.sin(ang);

    if (style === 'flow') {
      const seg = sw*3.5, gap = sw*1.5, half = sw*1.4;
      ctx.save(); ctx.fillStyle = color; ctx.translate(x1,y1); ctx.rotate(ang);
      for (let d = 0; d+seg < len-retract; d += seg+gap) ctx.fillRect(d,-half,seg,half*2);
      ctx.restore();
      drawHead(x1,y1,x2,y2, headSz, 'filled', color, sw);
    }
    else if (style === 'ecology') {
      const amp = sw*2.5, freq = len/60;
      ctx.strokeStyle = color; ctx.lineWidth = sw*1.5;
      for (const side of [-1,1]) {
        ctx.save(); ctx.translate(x1,y1); ctx.rotate(ang); ctx.globalAlpha = obj.opacity*.75;
        ctx.beginPath();
        for (let t=0; t<=len-retract; t+=3) {
          const wy = Math.sin(t/freq+(side<0?Math.PI:0))*amp;
          if (t===0) ctx.moveTo(t, side*amp*.4+wy*.6); else ctx.lineTo(t, side*amp*.4+wy*.6);
        }
        ctx.stroke(); ctx.restore();
      }
      drawHead(x1,y1,x2,y2, headSz,'filled',color,sw);
    }
    else if (style === 'wind') {
      const mx=(x1+x2)/2, my=(y1+y2)/2;
      const perp=ang+Math.PI/2, bulge=len*.28;
      const cpx=mx+Math.cos(perp)*bulge, cpy=my+Math.sin(perp)*bulge;
      // All streams retract fully behind arrowhead
      const allRetract = headSz * 1.15;
      const cex = x2 - allRetract*Math.cos(ang);
      const cey = y2 - allRetract*Math.sin(ang);
      // 1. Side streams (dashed, behind)
      for (const off of [-sw*2.8, sw*2.8]) {
        const ox=Math.cos(perp)*off, oy=Math.sin(perp)*off;
        ctx.save();
        ctx.strokeStyle=color; ctx.lineWidth=sw*1.0;
        ctx.globalAlpha=obj.opacity*.35;
        ctx.setLineDash([sw*4, sw*2.5]);
        ctx.lineCap='round';
        ctx.beginPath(); ctx.moveTo(x1+ox, y1+oy);
        ctx.quadraticCurveTo(cpx+ox, cpy+oy, cex+ox, cey+oy);
        ctx.stroke(); ctx.restore();
      }
      // 2. Center stream (solid, behind arrowhead)
      ctx.save();
      ctx.strokeStyle=color; ctx.lineWidth=sw*2.4;
      ctx.globalAlpha=obj.opacity*.9;
      ctx.setLineDash([]); ctx.lineCap='round';
      ctx.beginPath(); ctx.moveTo(x1,y1);
      ctx.quadraticCurveTo(cpx,cpy,cex,cey);
      ctx.stroke(); ctx.restore();
      // 3. Arrowhead — drawn LAST so it's always on top of all streams
      ctx.save(); ctx.globalAlpha=obj.opacity;
      drawHead(cpx,cpy,x2,y2,headSz,'filled',color,sw);
      ctx.restore();
    }
    else if (style === 'pedestrian') {
      ctx.strokeStyle=color; ctx.lineWidth=sw;
      ctx.setLineDash([sw*5,sw*3,sw,sw*3]);
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(ex,ey); ctx.stroke();
      ctx.setLineDash([]);
      drawHead(x1,y1,x2,y2,headSz*.8,'open',color,sw);
    }
    else if (style === 'sketch') {
      for (let i=0;i<2;i++) {
        const j=sw*.25*(i+1);
        ctx.strokeStyle=color; ctx.lineWidth=sw*(i===0?1:.55); ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(x1+(Math.random()-.5)*j, y1+(Math.random()-.5)*j);
        ctx.lineTo(ex+(Math.random()-.5)*j, ey+(Math.random()-.5)*j);
        ctx.stroke();
      }
      drawHead(x1,y1,x2,y2,headSz*.8,'open',color,sw);
    }
    else if (style === 'double') {
      ctx.strokeStyle=color; ctx.lineWidth=sw;
      applyDash(obj.lineStyle,sw);
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
      ctx.setLineDash([]);
      drawHead(x1,y1,x2,y2,headSz,'filled',color,sw);
      drawHead(x2,y2,x1,y1,headSz,'filled',color,sw);
    }
    else if (style === 'curved') {
      const mx=(x1+x2)/2, my=(y1+y2)/2;
      const perp=ang+Math.PI/2, bulge=len*.3;
      const cpx=mx+Math.cos(perp)*bulge, cpy=my+Math.sin(perp)*bulge;
      ctx.strokeStyle=color; ctx.lineWidth=sw;
      applyDash(obj.lineStyle,sw);
      ctx.beginPath(); ctx.moveTo(x1,y1);
      ctx.quadraticCurveTo(cpx,cpy,ex,ey); ctx.stroke();
      ctx.setLineDash([]);
      drawHead(cpx,cpy,x2,y2,headSz,'filled',color,sw);
    }
    else {
      const dashMap = { dashed:[sw*4,sw*2.5], dotted:[sw*.8,sw*3], chevron:[sw*3,sw*1.5] };
      ctx.strokeStyle=color; ctx.lineWidth=sw;
      ctx.setLineDash(dashMap[style]||[]);
      selHalo(()=>{ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(ex,ey);});
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(ex,ey); ctx.stroke();
      ctx.setLineDash([]);
      const ht = style==='outline'?'outline':style==='chevron'?'chevron':style==='block'?'block':style==='double-chevron'?'double':'filled';
      drawHead(x1,y1,x2,y2,headSz,ht,color,sw);
    }
    // Arrow endpoint handles
    if (sel) renderVertexHandles(obj.points, true);
  }

  // BEZIER / SPLINE — smooth catmull-rom through control points
  else if (obj.type === 'bezier') {
    const pts = obj.points;
    if (pts.length < 4) { ctx.restore(); return; }
    const t = (obj.tension ?? 0.5) * 2;
    const isSpline = obj.lineStyle === 'spline' || obj.showHull;

    // ── Draw curve ──────────────────────────────────────────
    ctx.strokeStyle = obj.color; ctx.lineWidth = obj.strokeWidth;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (!isSpline) applyDash(obj.lineStyle, obj.strokeWidth);

    const drawBez = () => {
      ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
      for (let i=0; i<pts.length-2; i+=2) {
        const x0=i>0?pts[i-2]:pts[0], y0=i>0?pts[i-1]:pts[1];
        const x1=pts[i], y1=pts[i+1], x2=pts[i+2], y2=pts[i+3];
        const x3=i+4<pts.length?pts[i+4]:x2, y3=i+5<pts.length?pts[i+5]:y2;
        ctx.bezierCurveTo(x1+(x2-x0)/6*t, y1+(y2-y0)/6*t, x2-(x3-x1)/6*t, y2-(y3-y1)/6*t, x2, y2);
      }
    };
    selHalo(drawBez); drawBez(); ctx.stroke();

    // Decorations
    if (obj.lineDecoration && obj.lineDecoration !== 'none') {
      const headSz = obj.strokeWidth*5+8;
      if (obj.lineDecoration==='end'  ||obj.lineDecoration==='both') drawHead(pts[pts.length-4],pts[pts.length-3],pts[pts.length-2],pts[pts.length-1],headSz,'filled',obj.color,obj.strokeWidth);
      if (obj.lineDecoration==='start'||obj.lineDecoration==='both') drawHead(pts[2],pts[3],pts[0],pts[1],headSz,'filled',obj.color,obj.strokeWidth);
    }

    // ── Spline hull + handles (when selected) ────────────────
    if (sel) {
      ctx.save();

      if (isSpline) {
        // 1. Hull lines (dashed orange — like reference image)
        ctx.strokeStyle = 'rgba(200,110,30,0.65)';
        ctx.lineWidth   = 1 / S.scale;
        ctx.setLineDash([4/S.scale, 3/S.scale]);
        ctx.lineCap = 'butt';
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1]);
        for (let i=2; i<pts.length; i+=2) ctx.lineTo(pts[i], pts[i+1]);
        ctx.stroke();
        ctx.setLineDash([]);

        // 2. Control vertices
        for (let i=0; i<pts.length; i+=2) {
          const isEnd = i===0 || i===pts.length-2;
          const isActive = S.vertexDragging && S.vertexObjId===obj.id && S.vertexIdx===i;
          const r = (isEnd ? 6 : 5) / S.scale;
          ctx.lineWidth = 1.5 / S.scale;
          if (isEnd) {
            // Open circles for endpoints
            ctx.fillStyle   = isActive ? '#ffcc00' : '#ffffff';
            ctx.strokeStyle = isActive ? '#ff8800' : '#3366cc';
          } else {
            // Filled dark circles for interior control vertices
            ctx.fillStyle   = isActive ? '#ffcc00' : '#3d3d4a';
            ctx.strokeStyle = isActive ? '#ff8800' : '#666688';
          }
          ctx.beginPath(); ctx.arc(pts[i], pts[i+1], r, 0, Math.PI*2);
          ctx.fill(); ctx.stroke();
        }
      } else {
        // Standard bezier handles
        for (let i=0; i<pts.length; i+=2) {
          const isActive = S.vertexDragging && S.vertexObjId===obj.id && S.vertexIdx===i;
          ctx.fillStyle   = isActive ? '#ffcc00' : (i===0||i===pts.length-2?'#4488ff':'#fff');
          ctx.strokeStyle = isActive ? '#ff8800' : '#4488ff';
          ctx.lineWidth   = 1.5/S.scale; ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(pts[i], pts[i+1], 4/S.scale, 0, Math.PI*2);
          ctx.fill(); ctx.stroke();
        }
      }
      ctx.restore();
    }
  }

  // POLYGON
  else if (obj.type === 'polygon') {
    const pts = obj.points;
    if (pts.length < 4) { ctx.restore(); return; }
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    for (let i=2; i<pts.length; i+=2) ctx.lineTo(pts[i], pts[i+1]);
    if (obj.closed) ctx.closePath();

    if (obj.closed) {
      const fillPath = () => {
        ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
        for (let i=2; i<pts.length; i+=2) ctx.lineTo(pts[i], pts[i+1]);
        ctx.closePath();
      };
      fillPath();
      ctx.fillStyle = obj.fillColor || 'rgba(232,184,75,0.08)';
      ctx.fill();
      // Hatch overlay
      if (obj.hatchPattern && obj.hatchPattern !== 'none' && !RenderCoordinator.shouldSkipHatch()) {
        fillPath();
        drawHatch(obj.hatchPattern, obj.color, obj.strokeWidth, undefined, flatPtsBounds(pts));
      }
    }
    ctx.strokeStyle = obj.color; ctx.lineWidth = obj.strokeWidth;
    applyDash(obj.lineStyle, obj.strokeWidth);
    selHalo(() => {
      ctx.beginPath(); ctx.moveTo(pts[0],pts[1]);
      for (let i=2;i<pts.length;i+=2) ctx.lineTo(pts[i],pts[i+1]);
      if(obj.closed) ctx.closePath();
    });
    ctx.stroke();

    if (obj.closed) {
      renderSegmentLabelsFromFlatPts(pts, true);
      renderClosedAreaLabel(pts);
    }

    // Vertex dots
    if (sel) {
      for (let i=0; i<pts.length; i+=2) {
        ctx.save();
        ctx.fillStyle='#4488ff'; ctx.strokeStyle='#fff';
        ctx.lineWidth=1.5; ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(pts[i],pts[i+1],4,0,Math.PI*2);
        ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }
  }

  // ZONE (filled rectangle)
  else if (obj.type === 'zone') {
    const pts = obj.points;
    if (pts.length < 4) { ctx.restore(); return; }

    const drawZonePath = () => {
      ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
      for (let i=2; i<pts.length; i+=2) ctx.lineTo(pts[i], pts[i+1]);
      ctx.closePath();
    };

    // Fill
    drawZonePath();
    ctx.fillStyle = obj.fillColor || 'rgba(232,184,75,0.15)';
    ctx.fill();
    // Hatch
    if (obj.hatchPattern && obj.hatchPattern !== 'none' && !RenderCoordinator.shouldSkipHatch()) {
      drawZonePath(); drawHatch(obj.hatchPattern, obj.color, obj.strokeWidth, undefined, flatPtsBounds(pts));
    }
    // Border
    ctx.strokeStyle = obj.color; ctx.lineWidth = obj.strokeWidth;
    applyDash(obj.lineStyle, obj.strokeWidth);
    selHalo(drawZonePath);
    drawZonePath(); ctx.stroke();
    renderSegmentLabelsFromFlatPts(pts, true);
    renderClosedAreaLabel(pts);
    // Vertex handles when selected
    if (sel) renderVertexHandles(pts);
  }

  // ANALYSIS ZONE — influence circles, noise, visibility
  else if (obj.type === 'analysis_zone') {
    if (obj.r < 1) { ctx.restore(); return; }
    const { cx, cy, r, analysisStyle: style, color, strokeWidth: sw, opacity: op } = obj;

    switch (style || 'radial') {
      case 'radial': {
        // Gradient influence zone (most common in urban analysis refs)
        try {
          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          grad.addColorStop(0,   color + 'cc');
          grad.addColorStop(0.45, color + '66');
          grad.addColorStop(0.8, color + '22');
          grad.addColorStop(1,   color + '00');
          ctx.fillStyle = grad;
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2);
          ctx.fill();
        } catch(e) {}
        // Outer ring
        ctx.strokeStyle = color; ctx.lineWidth = sw;
        ctx.setLineDash([sw*3, sw*2]);
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();
        break;
      }

      case 'noise': {
        // Concentric decay rings (noise/sound propagation)
        const rings = 5;
        for (let i = rings; i >= 1; i--) {
          const rr = r * i / rings;
          const a  = (rings - i + 1) / rings * 0.5;
          ctx.fillStyle   = color + Math.round(a * 255).toString(16).padStart(2,'0');
          ctx.strokeStyle = color;
          ctx.lineWidth   = sw * 0.5;
          ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(cx, cy, rr, 0, Math.PI*2);
          ctx.fill(); ctx.stroke();
        }
        break;
      }

      case 'visibility': {
        // Visibility cone (sector + gradient)
        const spread = (obj.spread || Math.PI * 0.6);
        const dir    = (obj.direction || -Math.PI/2);
        try {
          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          grad.addColorStop(0, color + 'bb');
          grad.addColorStop(1, color + '11');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, r, dir - spread/2, dir + spread/2);
          ctx.closePath(); ctx.fill();
        } catch(e) {}
        ctx.strokeStyle = color; ctx.lineWidth = sw * 0.8;
        ctx.setLineDash([sw*3, sw*2]);
        ctx.beginPath(); ctx.arc(cx, cy, r, dir-spread/2, dir+spread/2);
        ctx.stroke();
        break;
      }

      case 'heat': {
        // Heat field — warm gradient overlay
        try {
          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          grad.addColorStop(0, '#ff4444ee');
          grad.addColorStop(0.4, '#ff8800aa');
          grad.addColorStop(0.75,'#ffcc0055');
          grad.addColorStop(1, '#ffff0000');
          ctx.fillStyle = grad; ctx.globalAlpha = op;
          ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.fill();
        } catch(e) {}
        break;
      }
    }

    // Center dot
    ctx.save();
    ctx.fillStyle = color; ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(cx, cy, Math.max(3, sw*2), 0, Math.PI*2); ctx.fill();
    ctx.restore();

    if (sel) {
      ctx.save();
      ctx.strokeStyle='#4488ff'; ctx.lineWidth=1.5/S.scale; ctx.setLineDash([3/S.scale,2/S.scale]);
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI*2); ctx.stroke();
      ctx.restore();
    }
  }

  // CIRCLE
  else if (obj.type === 'circle') {
    if (obj.r < 1) { ctx.restore(); return; }
    const style = obj.circleStyle || 'outline';

    ctx.strokeStyle = obj.color;
    ctx.lineWidth   = obj.strokeWidth;
    applyDash(style === 'dashed' ? 'dashed' : style === 'dotted' ? 'dotted' : 'solid', obj.strokeWidth);

    selHalo(() => { ctx.beginPath(); ctx.arc(obj.cx, obj.cy, obj.r, 0, Math.PI*2); });

    // Fill variants
    if (style === 'filled') {
      ctx.beginPath(); ctx.arc(obj.cx, obj.cy, obj.r, 0, Math.PI*2);
      ctx.fillStyle = obj.fillColor || obj.color + '55';
      ctx.fill();
    } else if (style === 'half') {
      ctx.beginPath(); ctx.arc(obj.cx, obj.cy, obj.r, -Math.PI/2, Math.PI/2);
      ctx.closePath();
      ctx.fillStyle = obj.fillColor || obj.color + '55';
      ctx.fill();
    } else if (style === 'concentric') {
      for (let i = 1; i <= 3; i++) {
        ctx.beginPath(); ctx.arc(obj.cx, obj.cy, obj.r * i / 3, 0, Math.PI*2);
        ctx.globalAlpha = obj.opacity * (0.3 + i * 0.2);
        ctx.stroke();
      }
      ctx.globalAlpha = obj.opacity;
    }

    // Main outline stroke (all variants)
    if (style !== 'concentric') {
      ctx.beginPath(); ctx.arc(obj.cx, obj.cy, obj.r, 0, Math.PI*2);
      ctx.stroke();
    }

    // Selection handles — center + radius drag point
    if (sel) {
      ctx.save(); ctx.setLineDash([]);
      const isVertDragR = S.vertexDragging && S.vertexObjId===obj.id && S.vertexIdx==='radius';
      const isVertDragC = S.vertexDragging && S.vertexObjId===obj.id && S.vertexIdx==='center';
      const sz = 5 / S.scale;
      // Radius handle (east side by default)
      ctx.fillStyle   = isVertDragR ? '#ffcc00' : '#4488ff';
      ctx.strokeStyle = isVertDragR ? '#ff8800' : '#fff';
      ctx.lineWidth   = 1.5 / S.scale;
      ctx.beginPath(); ctx.arc(obj.cx + obj.r, obj.cy, sz, 0, Math.PI*2);
      ctx.fill(); ctx.stroke();
      // Center handle
      ctx.fillStyle   = isVertDragC ? '#ffcc00' : '#4488ff';
      ctx.strokeStyle = isVertDragC ? '#ff8800' : '#fff';
      ctx.beginPath(); ctx.arc(obj.cx, obj.cy, sz, 0, Math.PI*2);
      ctx.fill(); ctx.stroke();
      // Measurement ring line
      ctx.strokeStyle = 'rgba(68,136,255,0.3)'; ctx.lineWidth = 0.8 / S.scale;
      ctx.beginPath(); ctx.moveTo(obj.cx, obj.cy); ctx.lineTo(obj.cx + obj.r, obj.cy);
      ctx.stroke();
      ctx.restore();
    }
  }

  // GEOREF IMAGE — positioned raster plan layer (renders as background)
  else if (obj.type === 'georef_image') {
    renderGeorefImage(obj);
    if (sel) {
      ctx.save();
      // Outer image border (thin gray dashed)
      const co = obj.corners;
      ctx.strokeStyle='rgba(100,120,140,0.3)'; ctx.lineWidth=0.8/S.scale;
      ctx.setLineDash([6/S.scale,4/S.scale]);
      ctx.beginPath();ctx.moveTo(co.tl.x,co.tl.y);ctx.lineTo(co.tr.x,co.tr.y);ctx.lineTo(co.br.x,co.br.y);ctx.lineTo(co.bl.x,co.bl.y);ctx.closePath();ctx.stroke();

      // Inner clip frame border (solid blue) + handles
      const ci = getGeorefClipCorners(obj);
      ctx.strokeStyle='#2980b9'; ctx.lineWidth=1.5/S.scale;
      ctx.setLineDash([]);
      ctx.beginPath();ctx.moveTo(ci.tl.x,ci.tl.y);ctx.lineTo(ci.tr.x,ci.tr.y);ctx.lineTo(ci.br.x,ci.br.y);ctx.lineTo(ci.bl.x,ci.bl.y);ctx.closePath();ctx.stroke();

      // Inner corner handles (orange — draggable GCP points)
      const hsz = 6/S.scale;
      ctx.lineWidth=2/S.scale;
      [ci.tl,ci.tr,ci.br,ci.bl].forEach((p,i) => {
        ctx.fillStyle='#ff8c00'; ctx.strokeStyle='#ffffff';
        ctx.beginPath(); ctx.arc(p.x,p.y,hsz,0,Math.PI*2); ctx.fill(); ctx.stroke();
      });

      // Coordinate label at bottom-left handle
      if (obj.clipInset > 0.01) {
        const fs = Math.max(9, 11/S.scale);
        ctx.font = `bold ${fs}px JetBrains Mono, monospace`;
        ctx.fillStyle='#2980b9'; ctx.textAlign='left'; ctx.textBaseline='top';
        ctx.fillText('İç çerçeve (koordinat noktaları)', ci.tl.x, ci.tl.y - 14/S.scale);
      }
      ctx.restore();
    }
  }

  // POLYLINE / SPLINE
  else if (obj.type === 'polyline') {
    renderPolylineObj(obj, sel);
  }

  // POINT (field marker)
  else if (obj.type === 'point') {
    const r = obj.r || Math.max(6, 10 / S.scale);
    ctx.save();
    ctx.globalAlpha = obj.opacity ?? 1;
    ctx.fillStyle = obj.color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = Math.max(1.5, 2 / S.scale);
    ctx.beginPath();
    ctx.arc(obj.x, obj.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (obj.pointNum) {
      const fs = Math.max(9, Math.min(r * 1.15, 14 / S.scale));
      ctx.font = '700 ' + fs + 'px Inter,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(String(obj.pointNum), obj.x, obj.y);
    }
    if (obj.description) {
      const fs2 = Math.max(9, 11 / S.scale);
      ctx.font = '600 ' + fs2 + 'px Inter,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(15,25,40,.92)';
      const lines = String(obj.description).split('\n').slice(0, 2);
      lines.forEach((ln, i) => {
        ctx.fillText(ln.slice(0, 28), obj.x, obj.y + r + 4 / S.scale + i * (fs2 + 2));
      });
    }
    if (sel) {
      ctx.strokeStyle = '#4488ff';
      ctx.lineWidth = 2 / S.scale;
      ctx.setLineDash([4 / S.scale, 3 / S.scale]);
      ctx.beginPath();
      ctx.arc(obj.x, obj.y, r + 6 / S.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  // SYMBOL
  else if (obj.type === 'symbol') {
    const symDef = Object.values(SYMBOL_CATS).flat().find(s => s.id === obj.symbolId);
    if (!symDef) { ctx.restore(); return; }
    const sz = obj.size || 40;
    ctx.save();
    ctx.globalAlpha = obj.opacity;
    ctx.translate(obj.x, obj.y);
    ctx.rotate(obj.rotation || 0);
    symDef.draw(ctx, 0, 0, sz, obj.color);
    if (sel) {
      ctx.strokeStyle='#4488ff'; ctx.lineWidth=1.5/S.scale;
      ctx.setLineDash([3/S.scale,2/S.scale]);
      ctx.beginPath(); ctx.rect(-sz*.6,-sz*.6,sz*1.2,sz*1.2); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  // TEXT
  else if (obj.type === 'text') {
    const ff = obj.fontFamily || 'Inter, sans-serif';
    ctx.font = `${obj.bold?'bold ':''}${obj.fontSize}px '${ff}', Inter, sans-serif`;
    ctx.textBaseline = 'top';
    const m  = ctx.measureText(obj.text);
    const th = obj.fontSize * 1.3;
    if (obj.hasBg) {
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.fillRect(obj.x-5, obj.y-4, m.width+10, th+4);
    }
    ctx.fillStyle = obj.color;
    ctx.fillText(obj.text, obj.x, obj.y);
    if (sel) {
      ctx.save(); ctx.strokeStyle='#4488ff'; ctx.lineWidth=1.5;
      ctx.globalAlpha=.7; ctx.setLineDash([3,2]);
      ctx.strokeRect(obj.x-6, obj.y-5, m.width+12, th+6);
      ctx.restore();
    }
  }

  ctx.restore();
}

// ─────────────────────────────────────────────────────────────
// IN-PROGRESS POLYGON PREVIEW
// ─────────────────────────────────────────────────────────────
function renderPolyPreview() {
  if (!S.polyActive || S.polyPts.length < 2) return;
  ctx.save();
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = S.color;
  ctx.lineWidth   = S.strokeWidth;
  ctx.setLineDash([4, 3]);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // Draw existing edges
  ctx.beginPath();
  ctx.moveTo(S.polyPts[0], S.polyPts[1]);
  for (let i = 2; i < S.polyPts.length; i += 2) {
    ctx.lineTo(S.polyPts[i], S.polyPts[i+1]);
  }
  // Preview edge to cursor
  ctx.lineTo(S.polyPreviewX, S.polyPreviewY);
  ctx.stroke();

  // Closing guide line (from cursor back to start)
  if (S.polyPts.length >= 4) {
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.moveTo(S.polyPreviewX, S.polyPreviewY);
    ctx.lineTo(S.polyPts[0], S.polyPts[1]);
    ctx.stroke();
  }

  // Vertex dots
  ctx.setLineDash([]);
  for (let i = 0; i < S.polyPts.length; i += 2) {
    ctx.save();
    const isFirst = i === 0;
    ctx.fillStyle   = isFirst ? S.color : 'rgba(255,255,255,0.9)';
    ctx.strokeStyle = isFirst ? '#fff' : S.color;
    ctx.lineWidth   = 1.5;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(S.polyPts[i], S.polyPts[i+1], isFirst ? 6 : 4, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  const previewVerts = [];
  for (let i = 0; i < S.polyPts.length; i += 2) previewVerts.push({ x: S.polyPts[i], y: S.polyPts[i + 1] });
  previewVerts.push({ x: S.polyPreviewX, y: S.polyPreviewY });
  renderSegmentMeasureLabels(previewVerts, false);
  if (S.polyPts.length >= 6) {
    const areaPts = [];
    for (let i = 0; i < S.polyPts.length; i += 2) areaPts.push(S.polyPts[i], S.polyPts[i + 1]);
    areaPts.push(S.polyPreviewX, S.polyPreviewY);
    renderClosedAreaLabel(areaPts);
  }
  ctx.restore();
}

/** Live circle preview while drawing analysis area (center + radius drag). */
function renderCircleDrawPreview() {
  if (!S.drawing || !S.activeId || S.tool !== 'circle') return;
  const obj = S.objects.find(o => o.id === S.activeId);
  if (!obj || obj.type !== 'circle') return;
  const r = Math.max(obj.r || 0, 2 / S.scale);
  const col = obj.color || S.color || '#d48f10';
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = (obj.fillColor || col) + '33';
  ctx.strokeStyle = col;
  ctx.lineWidth = Math.max(2 / S.scale, obj.strokeWidth || 2);
  ctx.setLineDash([8 / S.scale, 5 / S.scale]);
  ctx.beginPath();
  ctx.arc(obj.cx, obj.cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(26,115,232,0.85)';
  ctx.lineWidth = Math.max(1.5 / S.scale, 1.5);
  ctx.beginPath();
  ctx.moveTo(obj.cx, obj.cy);
  ctx.lineTo(obj.cx + r, obj.cy);
  ctx.stroke();
  const sz = Math.max(6 / S.scale, 5);
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = col;
  ctx.lineWidth = 2 / S.scale;
  ctx.beginPath();
  ctx.arc(obj.cx, obj.cy, sz, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.5 / S.scale;
  ctx.beginPath();
  ctx.moveTo(obj.cx - sz * 1.4, obj.cy);
  ctx.lineTo(obj.cx + sz * 1.4, obj.cy);
  ctx.moveTo(obj.cx, obj.cy - sz * 1.4);
  ctx.lineTo(obj.cx, obj.cy + sz * 1.4);
  ctx.stroke();
  if (S.showMeasurement && r >= 3 / S.scale) {
    const diamM = pxToMeters(r * 2);
    const label = formatLengthReport(diamM) + ' Ø';
    ctx.font = `bold ${Math.max(11 / S.scale, 10)}px system-ui`;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 3 / S.scale;
    const tx = obj.cx + r * 0.35;
    const ty = obj.cy - r * 0.35;
    ctx.strokeText(label, tx, ty);
    ctx.fillStyle = '#1a3358';
    ctx.fillText(label, tx, ty);
  }
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────
// GRID — Architectural tracing-paper style
// ─────────────────────────────────────────────────────────────
let _snapX = 0, _snapY = 0;  // snap indicator coords (world space)

// ═══════════════════════════════════════════════════════════════
// OSM BASEMAP + PAFTA INDEX GRID
// ═══════════════════════════════════════════════════════════════

// ── Canvas world ↔ geographic conversions ─────────────────────
function worldToLatLon(wx, wy) {
  const mpp = pxToMeters(1);
  const dlat = -wy * mpp / 111320;
  const dlon = wx * mpp / (111320 * Math.cos(S.mapCenter.lat * Math.PI / 180));
  return { lat: S.mapCenter.lat + dlat, lon: S.mapCenter.lon + dlon };
}
function latLonToWorld(lat, lon) {
  const mpp = pxToMeters(1);
  const wy = -(lat - S.mapCenter.lat) * 111320 / mpp;
  const wx = (lon - S.mapCenter.lon) * 111320 * Math.cos(S.mapCenter.lat * Math.PI / 180) / mpp;
  return { x: wx, y: wy };
}

// ── Tile math ─────────────────────────────────────────────────
function latLonToTileXY(lat, lon, z) {
  const n = Math.pow(2, z);
  const x = Math.floor((lon + 180) / 360 * n);
  const r = lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}
function tileToLatLon(x, y, z) {
  const n = Math.pow(2, z);
  const lon = x / n * 360 - 180;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
  return { lat, lon };
}

// ── Inverse Transverse Mercator (TUREF → WGS84 lat/lon) ──────
function inverseTM(easting, northing, cm) {
  const k0 = 0.9996, a = 6378137, f = 1/298.257223563;
  const e2 = 2*f - f*f;
  const e1 = (1 - Math.sqrt(1-e2)) / (1 + Math.sqrt(1-e2));
  const x = (easting - 500000) / k0;
  const M = northing / k0;
  const mu = M / (a * (1 - e2/4 - 3*e2**2/64 - 5*e2**3/256));
  const phi1 = mu
    + (3*e1/2 - 27*e1**3/32) * Math.sin(2*mu)
    + (21*e1**2/16 - 55*e1**4/32) * Math.sin(4*mu)
    + (151*e1**3/96) * Math.sin(6*mu)
    + (1097*e1**4/512) * Math.sin(8*mu);
  const sp = Math.sin(phi1), cp = Math.cos(phi1), tp = Math.tan(phi1);
  const ep2 = e2/(1-e2);
  const N1 = a / Math.sqrt(1 - e2*sp*sp);
  const T1 = tp*tp, C1 = ep2*cp*cp;
  const R1 = a*(1-e2) / Math.pow(1-e2*sp*sp, 1.5);
  const D = x / N1;
  const lat = phi1 - (N1*tp/R1) * (
    D**2/2
    - (5+3*T1+10*C1-4*C1*C1-9*ep2)*D**4/24
    + (61+90*T1+298*C1+45*T1*T1-252*ep2-3*C1*C1)*D**6/720
  );
  const lon = (
    D
    - (1+2*T1+C1)*D**3/6
    + (5-2*C1+28*T1-3*C1*C1+8*ep2+24*T1*T1)*D**5/120
  ) / cp;
  return { lat: lat*180/Math.PI, lon: cm + lon*180/Math.PI };
}

// ── Render OSM tiles ──────────────────────────────────────────
function renderOSMTiles() {
  if (S.basemap === 'none') return;
  if (FIELD_MODE) ensureFieldBasemapOn();
  purgeWrongBasemapCache();

  // Visible viewport in world coords
  const topBar = getTopBarH();
  const topLeftW  = { x: (0  - S.tx) / S.scale, y: (topBar - S.ty) / S.scale };
  const botRightW = { x: (CW - S.tx) / S.scale, y: (getMapViewBottom() - S.ty) / S.scale };

  // Convert to lat/lon
  const tlGeo = worldToLatLon(topLeftW.x,  topLeftW.y);
  const brGeo = worldToLatLon(botRightW.x, botRightW.y);

  const mPerScreenPx = pxToMeters(1) / S.scale;
  const zoom = computeBasemapTileZoom(mPerScreenPx);

  const tl = latLonToTileXY(tlGeo.lat, tlGeo.lon, zoom);
  const br = latLonToTileXY(brGeo.lat, brGeo.lon, zoom);
  const norm = normalizeTileXYRange(tl, br);

  const maxTiles = 200;
  let tlx = norm.tlx, tly = norm.tly, brx = norm.brx, bry = norm.bry;
  const tileCount = (brx - tlx + 1) * (bry - tly + 1);
  if (tileCount > maxTiles) {
    const cx = Math.floor((tlx + brx) / 2);
    const cy = Math.floor((tly + bry) / 2);
    const half = Math.max(1, Math.floor(Math.sqrt(maxTiles) / 2));
    tlx = Math.max(0, cx - half);
    brx = cx + half;
    tly = Math.max(0, cy - half);
    bry = cy + half;
  }

  ctx.save();
  ctx.globalAlpha = 1;
  const prevSmooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = true;
  if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = 'high';

  for (let tx = tlx; tx <= brx; tx++) {
    for (let ty = tly; ty <= bry; ty++) {
      // Tile corners in lat/lon
      const tileTL = tileToLatLon(tx,     ty,     zoom);
      const tileBR = tileToLatLon(tx + 1, ty + 1, zoom);

      // Convert to canvas world
      const wTL = latLonToWorld(tileTL.lat, tileTL.lon);
      const wBR = latLonToWorld(tileBR.lat, tileBR.lon);

      // Convert to screen pixels
      const sx = wTL.x * S.scale + S.tx;
      const sy = wTL.y * S.scale + S.ty;
      const sw = (wBR.x - wTL.x) * S.scale;
      const sh = (wBR.y - wTL.y) * S.scale;

      // Skip offscreen
      if (sx + sw < 0 || sy + sh < 0 || sx > CW || sy > CH) continue;

      const url = basemapTileUrl(zoom, tx, ty);
      if (isTileCacheMiss(_tileCache[url])) delete _tileCache[url];

      const tileDraw = tryDrawBasemapTile(tx, ty, zoom, sx, sy, sw, sh);
      if (!tileDraw.native) kickoffBasemapTileLoad(zoom, tx, ty);
    }
  }

  ctx.imageSmoothingEnabled = prevSmooth;
  // OSM attribution (required)
  ctx.restore();
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); // keep DPR
  ctx.font = '9px Inter, sans-serif';
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.textAlign = 'right';
  const attr = S.basemap === 'satellite' ? '© Esri World Imagery'
    : S.basemap === 'topo' ? '© OpenTopoMap © OSM'
    : '© OpenStreetMap contributors';
  ctx.fillText(attr, CW - 8, CH - 8);
  ctx.restore();
}

// ── Render Pafta Grid Overlay ─────────────────────────────────
function renderPaftaGrid() {
  if (fieldOff('pafta')) return;
  if (!S.showPafta) return;
  ctx.save();

  const topBar = getTopBarH();
  const topLeftW  = { x: (0  - S.tx) / S.scale, y: (topBar - S.ty) / S.scale };
  const botRightW = { x: (CW - S.tx) / S.scale, y: (getMapViewBottom() - S.ty) / S.scale };
  const tlGeo = worldToLatLon(topLeftW.x, topLeftW.y);
  const brGeo = worldToLatLon(botRightW.x, botRightW.y);

  const mPerScreenPx = pxToMeters(1) / S.scale;
  // Adaptive grid: finer when zoomed in
  let gridDeg, gridLabel;
  if (mPerScreenPx < 1.5)      { gridDeg = 1/120;  gridLabel = '1:1.000'; }    // 30" ≈ 0.5km
  else if (mPerScreenPx < 8)   { gridDeg = 1/24;   gridLabel = '1:5.000'; }    // 2.5' ≈ 4km
  else if (mPerScreenPx < 40)  { gridDeg = 0.25;   gridLabel = '1:25.000'; }   // 15'
  else if (mPerScreenPx < 200) { gridDeg = 0.5;    gridLabel = '1:100.000'; }  // 30'
  else                         { gridDeg = 1.5;    gridLabel = '1:250.000'; }  // 1.5°

  const minLon = Math.floor(tlGeo.lon / gridDeg) * gridDeg;
  const maxLon = Math.ceil(brGeo.lon / gridDeg) * gridDeg;
  const minLat = Math.floor(brGeo.lat / gridDeg) * gridDeg;
  const maxLat = Math.ceil(tlGeo.lat / gridDeg) * gridDeg;

  const cols = (maxLon-minLon)/gridDeg, rows = (maxLat-minLat)/gridDeg;
  if (cols > 80 || rows > 80) { ctx.restore(); return; }

  // Grid lines — bold red dashed
  ctx.strokeStyle = 'rgba(200,50,50,0.55)';
  ctx.lineWidth   = Math.max(1, 1.5/S.scale);
  ctx.setLineDash([6/S.scale, 4/S.scale]);

  for (let lon = minLon; lon <= maxLon; lon += gridDeg) {
    const wTop = latLonToWorld(maxLat, lon);
    const wBot = latLonToWorld(minLat, lon);
    ctx.beginPath(); ctx.moveTo(wTop.x, wTop.y); ctx.lineTo(wBot.x, wBot.y); ctx.stroke();
  }
  for (let lat = minLat; lat <= maxLat; lat += gridDeg) {
    const wL = latLonToWorld(lat, minLon);
    const wR = latLonToWorld(lat, maxLon);
    ctx.beginPath(); ctx.moveTo(wL.x, wL.y); ctx.lineTo(wR.x, wR.y); ctx.stroke();
  }
  ctx.setLineDash([]);

  // Cell labels — pafta name or coordinate
  if (cols < 30 && rows < 30) {
    const fs = Math.max(9, Math.min(14, 18/S.scale));
    ctx.font = `bold ${fs}px JetBrains Mono, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    for (let lon = minLon; lon < maxLon; lon += gridDeg) {
      for (let lat = minLat; lat < maxLat; lat += gridDeg) {
        const cw = latLonToWorld(lat + gridDeg/2, lon + gridDeg/2);
        const pName = getPaftaNameAtLatLon(lat + gridDeg/2, lon + gridDeg/2);

        // Background pill
        const tw = ctx.measureText(pName || '').width + 8/S.scale;
        const th = fs + 4/S.scale;
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        ctx.fillRect(cw.x - tw/2, cw.y - th/2, tw, th);
        ctx.strokeStyle = 'rgba(200,50,50,0.3)';
        ctx.lineWidth = 0.5/S.scale;
        ctx.strokeRect(cw.x - tw/2, cw.y - th/2, tw, th);

        // Text
        ctx.fillStyle = 'rgba(180,40,40,0.85)';
        ctx.fillText(pName || `${lat.toFixed(2)}°`, cw.x, cw.y);
      }
    }
  }

  // Scale badge (screen space)
  ctx.save();
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.fillStyle = 'rgba(180,40,40,0.6)';
  ctx.textAlign = 'left';
  ctx.fillText(`📐 Pafta Grid: ${gridLabel}`, 70, CH - 8);
  ctx.restore();

  ctx.restore();
}

// ── Toggle functions ──────────────────────────────────────────
const FIELD_DOCK_BASEMAP_SVG = {
  none: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" stroke="#888" stroke-width="1.8"/><path d="M8 8l8 8M16 8l-8 8" stroke="#c0392b" stroke-width="1.8" stroke-linecap="round"/></svg>',
  osm: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="16" rx="2" fill="#a8d4f5" stroke="#1a6fb5" stroke-width="1.4"/><path d="M6 9h5M6 12h8M6 15h6" stroke="#1a6fb5" stroke-width="1.3" stroke-linecap="round"/><path d="M14 8l3 2-3 2" stroke="#1a6fb5" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  satellite: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 5.5l2.5 6.5h1.8l.9-2.8 3.5 1-.9 2.8h1.7L12.5 5.5H5z" fill="#e8ecf0" stroke="#1a1a1a" stroke-width="1.2" stroke-linejoin="round"/><path d="M3.5 13.5c1.8.3 3 1.2 3.4 2.5" stroke="#1a1a1a" stroke-width="1.2" stroke-linecap="round"/><path d="M12 19.5a5.5 5.5 0 1 0 0-.01" stroke="#1a1a1a" stroke-width="1.5"/><path d="M9.5 17.5h5" stroke="#1a1a1a" stroke-width="1.2" stroke-linecap="round"/></svg>',
  topo: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 18l4-6 4 4 4-7 4 9" stroke="#6d4c2e" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="#c9a66b" fill-opacity=".35"/><path d="M3 19h18" stroke="#6d4c2e" stroke-width="1.3"/></svg>',
};

function updateBasemapDockUi() {
  const dockBtn = document.getElementById('btn-dock-basemap');
  const leftBtn = document.getElementById('btn-osm');
  const short = { none: t('basemap.none'), osm: t('basemap.osm'), satellite: t('basemap.satellite'), topo: t('basemap.topo') };
  const mode = S.basemap || 'none';
  if (dockBtn) {
    const labelEl = document.getElementById('btn-dock-basemap-label');
    const iconEl = document.getElementById('btn-dock-basemap-icon');
    if (labelEl) labelEl.textContent = short[mode] || t('basemap.osm');
    if (iconEl) iconEl.innerHTML = FIELD_DOCK_BASEMAP_SVG[mode] || FIELD_DOCK_BASEMAP_SVG.osm;
    dockBtn.classList.toggle('active', mode !== 'none');
  }
  if (leftBtn) leftBtn.classList.toggle('active', mode !== 'none');
}

function clearBasemapTileCache() {
  Object.keys(_tileCache).forEach(k => delete _tileCache[k]);
  Object.keys(_tileLoadingSince).forEach(k => delete _tileLoadingSince[k]);
  _basemapZoomState = { z: -1, ideal: -1 };
}

function toggleOSM() {
  // Cycle: none → osm → satellite → topo → none
  const modes = ['none', 'osm', 'satellite', 'topo'];
  const hintKeys = { none: 'basemap.hint.none', osm: 'basemap.hint.osm', satellite: 'basemap.hint.satellite', topo: 'basemap.hint.topo' };
  const idx = (modes.indexOf(S.basemap) + 1) % modes.length;
  S.basemap = modes[idx];
  if (S.basemap !== 'none') {
    clearBasemapTileCache();
    purgeWrongBasemapCache();
  }
  updateBasemapDockUi();
  showHint(t(hintKeys[S.basemap]));
  scheduleRender();
  if (S.basemap !== 'none') {
    warmViewportTilesFromDb();
    scheduleBasemapRefresh(800);
  }
}
function togglePaftaGrid() {
  if (fieldOff('pafta')) { showHint('Pafta indeksi PlanAI Field modunda kapalı'); return; }
  S.showPafta = !S.showPafta;
  document.getElementById('btn-pafta').classList.toggle('active', S.showPafta);
  if (S.showPafta) showHint('📐 Pafta indeksi grid açıldı');
  scheduleRender();
}

// ── Set map center (called from pafta parser or georef) ───────
function setMapCenter(lat, lon) {
  const georefSnaps = [];
  S.objects.forEach(o => {
    if (o.type !== 'georef_image' || !o.corners) return;
    if (o.wgsBounds?.ok) georefSnaps.push({ o, b: o.wgsBounds });
    else {
      const b = georefWgsBoundsFromCorners(o);
      if (b?.ok) {
        o.wgsBounds = copyGeoBounds(b);
        georefSnaps.push({ o, b });
      }
    }
  });

  S.mapCenter = { lat, lon };
  S.tx = CW / 2;
  S.ty = CH / 2;

  georefSnaps.forEach(({ o, b }) => {
    o.corners = cornersFromWgs84Bounds(b);
  });
  scheduleRender();
}

function renderGrid() {
  ctx.save();
  const { tx, ty, scale, gridSize } = S;
  const g = gridSize * scale;

  // Minor grid dots at every cell (only when not too dense)
  if (g >= 6) {
    const ox = ((tx % g) + g) % g;
    const oy = ((ty % g) + g) % g;
    const alpha = Math.min(0.45, Math.max(0.08, g / 100));
    const r = Math.min(1.5, Math.max(0.5, g / 45));
    ctx.fillStyle = `rgba(70,95,140,${alpha})`;
    for (let gx = ox; gx < CW; gx += g)
      for (let gy = oy; gy < CH; gy += g) {
        ctx.beginPath(); ctx.arc(gx, gy, r, 0, Math.PI*2); ctx.fill();
      }
  }

  // Major lines every 5 cells
  const majorG = g * 5;
  const mox = ((tx % majorG) + majorG) % majorG;
  const moy = ((ty % majorG) + majorG) % majorG;
  const la  = Math.min(0.3, Math.max(0.08, g / 60));

  ctx.strokeStyle = `rgba(60,85,130,${la})`;
  ctx.lineWidth   = Math.max(0.5, Math.min(1, g / 60));
  ctx.setLineDash([]);
  for (let gx = mox; gx < CW; gx += majorG) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, CH); ctx.stroke();
  }
  for (let gy = moy; gy < CH; gy += majorG) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(CW, gy); ctx.stroke();
  }

  // Cross marks at major intersections
  if (g >= 12) {
    const cs = Math.max(3, Math.min(8, majorG * 0.06));
    ctx.strokeStyle = `rgba(50,75,120,${la * 1.6})`;
    ctx.lineWidth   = Math.max(0.8, Math.min(1.5, g / 50));
    for (let gx = mox; gx < CW; gx += majorG)
      for (let gy = moy; gy < CH; gy += majorG) {
        ctx.beginPath();
        ctx.moveTo(gx-cs, gy); ctx.lineTo(gx+cs, gy);
        ctx.moveTo(gx, gy-cs); ctx.lineTo(gx, gy+cs);
        ctx.stroke();
      }
  }

  // Coordinate labels — show real-world distance (meters)
  if (g >= 25) {
    const fs = Math.max(8, Math.min(11, g * 0.18));
    ctx.font      = `${fs}px JetBrains Mono, monospace`;
    ctx.fillStyle = `rgba(70,95,140,${la * 2.2})`;
    ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    for (let gx = mox; gx < CW; gx += majorG) {
      const wx = Math.round((gx - tx) / scale);
      if (Math.abs(wx) < 1) continue;
      ctx.fillText(formatLength(Math.abs(pxToMeters(wx))), gx + 3, 38);
    }
    for (let gy = moy; gy < CH; gy += majorG) {
      if (gy < 50) continue;
      const wy = Math.round((gy - ty) / scale);
      if (Math.abs(wy) < 1) continue;
      ctx.fillText(formatLength(Math.abs(pxToMeters(wy))), 3, gy + 2);
    }
  }

  ctx.restore();
}

function renderSnapIndicator() {
  if (!S.snapGrid || (!S.drawing && !S.polyActive && !S.plSession)) return;
  const sz = 6 / S.scale;
  const sw = 1.5 / S.scale;
  ctx.save();
  ctx.translate(_snapX, _snapY);
  ctx.strokeStyle = 'rgba(212,143,16,0.85)';
  ctx.lineWidth   = sw;
  ctx.setLineDash([sz * 0.35, sz * 0.25]);
  ctx.beginPath();
  ctx.moveTo(-sz*2.8, 0); ctx.lineTo(sz*2.8, 0);
  ctx.moveTo(0, -sz*2.8); ctx.lineTo(0, sz*2.8);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = 'rgba(212,143,16,0.95)';
  ctx.lineWidth   = sw * 1.3;
  ctx.beginPath();
  ctx.moveTo(0, -sz); ctx.lineTo(sz, 0);
  ctx.lineTo(0, sz); ctx.lineTo(-sz, 0);
  ctx.closePath(); ctx.stroke();
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────
// RENDER — RenderCoordinator (FAZ 1A) RAF + throttle + fast-path
// ─────────────────────────────────────────────────────────────
function scheduleRender() {
  RenderCoordinator.schedule(RenderCoordinator.DIRTY.ALL);
}

// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// LAYOUT / PRINT — Sürükle-Çiz + Sağ Tık Onayla
// ═══════════════════════════════════════════════════════════
const LAYOUT={mode:'off',paper:'a4',orient:'portrait',wx:0,wy:0,ww:0,wh:0,
  drawStartX:0,drawStartY:0,dragging:false,resizing:false,resizeCorner:'',dragOX:0,dragOY:0};
const PAPER_MM={a1:{w:594,h:841},a2:{w:420,h:594},a3:{w:297,h:420},a4:{w:210,h:297}};
function getAspect(){const p=PAPER_MM[LAYOUT.paper];return LAYOUT.orient==='portrait'?p.h/p.w:p.w/p.h}

function startLayoutDraw(){
  if (fieldOff('layout')) { showHint('Layout composer Field modunda kapalı'); return; }
  if(LAYOUT.mode==='drawing'){cancelLayoutDraw();return}
  if(LAYOUT.mode==='placed'){openLayoutComposer();return}
  LAYOUT.mode='drawing';LAYOUT.ww=0;LAYOUT.wh=0;
  document.getElementById('btn-layout').style.cssText='background:var(--accent);color:#111;padding:3px 10px;border-radius:5px;border:1.5px solid var(--accent);cursor:pointer;font-size:10px;font-weight:600;pointer-events:auto;font-family:var(--font)';
  document.getElementById('layout-format').style.display='flex';
  document.querySelector('canvas').style.cursor='crosshair';
  showHint('📐 Format seçin, sonra sürükleyerek alan çizin — Sağ tık: onayla — Esc: iptal');scheduleRender();
}
function cancelLayoutDraw(){
  LAYOUT.mode='off';LAYOUT.ww=0;LAYOUT.wh=0;
  document.getElementById('btn-layout').style.cssText='padding:3px 10px;border-radius:5px;border:1.5px solid var(--border);background:var(--panel-bg);cursor:pointer;font-size:10px;color:var(--muted);font-weight:600;pointer-events:auto;font-family:var(--font)';
  document.getElementById('layout-format').style.display='none';
  // layout-ctrl removed — composer is separate window
  document.querySelector('canvas').style.cursor='';scheduleRender();
}
function pickLayoutFormat(f,btn){LAYOUT.paper=f;document.querySelectorAll('[data-lf]').forEach(b=>b.classList.toggle('on',b.dataset.lf===f));if(LAYOUT.ww>0){LAYOUT.wh=LAYOUT.ww*getAspect();scheduleRender()}}
function pickLayoutOrient(o,btn){LAYOUT.orient=o;document.querySelectorAll('[data-lo]').forEach(b=>b.classList.toggle('on',b.dataset.lo===o));if(LAYOUT.ww>0){LAYOUT.wh=LAYOUT.ww*getAspect();scheduleRender()}}
function confirmLayout(){
  if(LAYOUT.ww<20||LAYOUT.wh<20){cancelLayoutDraw();return}
  LAYOUT.mode='placed';
  document.querySelector('canvas').style.cursor='';
  scheduleRender();
  // Open Layout Composer in new window
  setTimeout(() => openLayoutComposer(), 200);
}
function openLayoutComposer(){
  const w = window.open('layout-composer.html', 'PlanAI_Layout', 
    'width=1200,height=800,menubar=no,toolbar=no,location=no,status=no');
  if (!w) { showHint('⚠ Popup engellenmiş — tarayıcı izin verin'); return; }
  showHint('📐 Layout Composer açıldı — düzenleme orada devam ediyor');
}
function setLayoutPaper(p,btn){LAYOUT.paper=p;btn.parentElement.querySelectorAll('.lc-chip').forEach(c=>c.classList.remove('on'));btn.classList.add('on');LAYOUT.wh=LAYOUT.ww*getAspect();scheduleRender()}
function setLayoutOrient(o,btn){LAYOUT.orient=o;btn.parentElement.querySelectorAll('.lc-chip').forEach(c=>c.classList.remove('on'));btn.classList.add('on');LAYOUT.wh=LAYOUT.ww*getAspect();scheduleRender()}
function updateLayoutScale(){const pp=PAPER_MM[LAYOUT.paper];const pw=LAYOUT.orient==='portrait'?pp.w:pp.h;const sc=parseInt('1000')||1000;const gw=pw*sc/1000;const cx=LAYOUT.wx+LAYOUT.ww/2,cy=LAYOUT.wy+LAYOUT.wh/2;LAYOUT.ww=gw;LAYOUT.wh=gw*getAspect();LAYOUT.wx=cx-LAYOUT.ww/2;LAYOUT.wy=cy-LAYOUT.wh/2;scheduleRender()}

function layoutMouseDown(sx,sy){
  if(LAYOUT.mode==='drawing'){LAYOUT.drawStartX=(sx-S.tx)/S.scale;LAYOUT.drawStartY=(sy-S.ty)/S.scale;LAYOUT.wx=LAYOUT.drawStartX;LAYOUT.wy=LAYOUT.drawStartY;LAYOUT.ww=0;LAYOUT.wh=0;return true}
  if(LAYOUT.mode==='placed'){const h=layoutHitTest(sx,sy);if(!h)return false;if(h.type==='drag'){LAYOUT.dragging=true;LAYOUT.dragOX=(sx-S.tx)/S.scale-LAYOUT.wx;LAYOUT.dragOY=(sy-S.ty)/S.scale-LAYOUT.wy;return true}if(h.type==='resize'){LAYOUT.resizing=true;LAYOUT.resizeCorner=h.corner;LAYOUT.dragOX=sx;LAYOUT.dragOY=sy;return true}}
  return false;
}
function layoutMouseMove(sx,sy){
  if(LAYOUT.mode==='drawing'&&(LAYOUT.drawStartX||LAYOUT.drawStartY)){
    const wx=(sx-S.tx)/S.scale,wy=(sy-S.ty)/S.scale;const dx=wx-LAYOUT.drawStartX;
    if(Math.abs(dx)>2){const w=Math.abs(dx),h=w*getAspect();LAYOUT.wx=dx>0?LAYOUT.drawStartX:LAYOUT.drawStartX-w;LAYOUT.wy=wy<LAYOUT.drawStartY?LAYOUT.drawStartY-h:LAYOUT.drawStartY;LAYOUT.ww=w;LAYOUT.wh=h;scheduleRender()}return true}
  if(LAYOUT.mode==='placed'){
    if(LAYOUT.dragging){LAYOUT.wx=(sx-S.tx)/S.scale-LAYOUT.dragOX;LAYOUT.wy=(sy-S.ty)/S.scale-LAYOUT.dragOY;scheduleRender();return true}
    if(LAYOUT.resizing){const dx=(sx-LAYOUT.dragOX)/S.scale;const asp=getAspect();const cn=LAYOUT.resizeCorner;if(cn==='br'||cn==='tr')LAYOUT.ww=Math.max(30,LAYOUT.ww+dx);if(cn==='bl'||cn==='tl'){const nw=Math.max(30,LAYOUT.ww-dx);LAYOUT.wx+=LAYOUT.ww-nw;LAYOUT.ww=nw}if(cn==='tl'||cn==='tr'){const oh=LAYOUT.wh;LAYOUT.wh=LAYOUT.ww*asp;LAYOUT.wy+=oh-LAYOUT.wh}else LAYOUT.wh=LAYOUT.ww*asp;LAYOUT.dragOX=sx;LAYOUT.dragOY=sy;scheduleRender();return true}
    const h=layoutHitTest(sx,sy);const can=document.querySelector('canvas');if(h?.type==='resize')can.style.cursor='nwse-resize';else if(h?.type==='drag')can.style.cursor='move';else can.style.cursor=''}
  return false;
}
function layoutMouseUp(){LAYOUT.dragging=false;LAYOUT.resizing=false}
function layoutRightClick(e){if(LAYOUT.mode==='drawing'&&LAYOUT.ww>20){e.preventDefault();confirmLayout();return true}if(LAYOUT.mode==='placed'){e.preventDefault();cancelLayoutDraw();return true}return false}
function layoutHitTest(sx,sy){if(LAYOUT.mode!=='placed')return null;const fx=LAYOUT.wx*S.scale+S.tx,fy=LAYOUT.wy*S.scale+S.ty,fw=LAYOUT.ww*S.scale,fh=LAYOUT.wh*S.scale;const cs=[{x:fx,y:fy,id:'tl'},{x:fx+fw,y:fy,id:'tr'},{x:fx+fw,y:fy+fh,id:'br'},{x:fx,y:fy+fh,id:'bl'}];for(const cn of cs)if(Math.abs(sx-cn.x)<12&&Math.abs(sy-cn.y)<12)return{type:'resize',corner:cn.id};if(sx>=fx&&sx<=fx+fw&&sy>=fy&&sy<=fy+fh)return{type:'drag'};return null}

function renderLayoutFrame(){
  if (fieldOff('layout')) return;
  if(LAYOUT.mode==='off'||LAYOUT.ww<2)return;
  const fx=LAYOUT.wx*S.scale+S.tx,fy=LAYOUT.wy*S.scale+S.ty,fw=LAYOUT.ww*S.scale,fh=LAYOUT.wh*S.scale;
  ctx.save();ctx.setTransform(DPR,0,0,DPR,0,0);
  // Dark overlay
  const oa=LAYOUT.mode==='drawing'?'rgba(0,0,0,0.18)':'rgba(0,0,0,0.35)';
  ctx.fillStyle=oa;ctx.fillRect(0,0,CW,fy);ctx.fillRect(0,fy+fh,CW,CH-fy-fh);ctx.fillRect(0,fy,fx,fh);ctx.fillRect(fx+fw,fy,CW-fx-fw,fh);
  // Frame
  ctx.strokeStyle='#d4a017';ctx.lineWidth=LAYOUT.mode==='drawing'?1.5:2.5;ctx.setLineDash(LAYOUT.mode==='drawing'?[6,4]:[]);ctx.strokeRect(fx,fy,fw,fh);ctx.setLineDash([]);
  if(LAYOUT.mode==='placed'){
    const tH=Math.max(22,fh*.075),tY=fy+fh-tH;
    ctx.fillStyle='rgba(255,255,255,0.9)';ctx.fillRect(fx,tY,fw,tH);ctx.strokeStyle='rgba(212,160,23,0.5)';ctx.lineWidth=1;ctx.strokeRect(fx,tY,fw,tH);
    const fs=Math.max(7,Math.min(14,tH*.32));
    ctx.fillStyle='#111';ctx.textAlign='left';ctx.font=`bold ${fs}px serif`;ctx.fillText('İMAR PLANI',fx+6,tY+tH*.32);
    ctx.font=`${fs*.55}px system-ui`;ctx.fillStyle='#555';ctx.fillText('Uygulama İmar Planı',fx+6,tY+tH*.58);
    ctx.fillText(''+' · '+'',fx+6,tY+tH*.82);
    ctx.font=`bold ${fs*.65}px monospace`;ctx.fillStyle='#222';ctx.textAlign='right';ctx.fillText('1:'+parseInt('1000').toLocaleString('tr-TR'),fx+fw-8,tY+tH*.38);
    // North arrow
    if(true){const ns=Math.max(10,Math.min(20,fw*.022)),nx=fx+fw-ns*1.8,ny=fy+ns*2;ctx.fillStyle='#222';ctx.beginPath();ctx.moveTo(nx,ny-ns);ctx.lineTo(nx+ns*.22,ny+ns*.25);ctx.lineTo(nx,ny+ns*.04);ctx.closePath();ctx.fill();ctx.fillStyle='#fff';ctx.strokeStyle='#222';ctx.lineWidth=.8;ctx.beginPath();ctx.moveTo(nx,ny-ns);ctx.lineTo(nx-ns*.22,ny+ns*.25);ctx.lineTo(nx,ny+ns*.04);ctx.closePath();ctx.fill();ctx.stroke();ctx.font=`bold ${ns*.45}px serif`;ctx.fillStyle='#222';ctx.textAlign='center';ctx.fillText('N',nx,ny-ns-3)}
    // Scale bar
    if(true){const sc=parseInt('1000'),pp=PAPER_MM[LAYOUT.paper],pw=LAYOUT.orient==='portrait'?pp.w:pp.h,barGround=(pw*.18)*sc/1000,nice=[1,2,5,10,20,50,100,200,500,1000,2000,5000],gn=nice.find(n=>n>=barGround*.5)||barGround,barPx=(gn/LAYOUT.ww)*fw,bx=fx+8,by=fy+fh-tH-14;ctx.fillStyle='rgba(255,255,255,.8)';ctx.fillRect(bx-3,by-10,barPx+6,20);for(let i=0;i<4;i++){ctx.fillStyle=i%2===0?'#000':'#fff';ctx.fillRect(bx+i*barPx/4,by,barPx/4,4)}ctx.strokeStyle='#000';ctx.lineWidth=.5;ctx.strokeRect(bx,by,barPx,4);ctx.font='7px system-ui';ctx.fillStyle='#000';ctx.textAlign='left';ctx.fillText('0',bx,by+11);ctx.textAlign='right';ctx.fillText(gn>=1000?(gn/1000)+'km':gn+'m',bx+barPx,by+11);ctx.textAlign='left';ctx.font='bold 7px monospace';ctx.fillText('1:'+sc.toLocaleString('tr-TR'),bx,by-3)}
    // Corner handles
    [[fx,fy],[fx+fw,fy],[fx+fw,fy+fh],[fx,fy+fh]].forEach(([hx,hy])=>{ctx.fillStyle='#d4a017';ctx.fillRect(hx-5,hy-5,10,10);ctx.strokeStyle='#fff';ctx.lineWidth=1;ctx.strokeRect(hx-5,hy-5,10,10)});
  }
  // Label
  ctx.font='bold 10px system-ui';ctx.fillStyle='#d4a017';ctx.textAlign='left';
  ctx.fillText(LAYOUT.mode==='drawing'?'Sürükleyin → Sağ tık onaylayın':`${LAYOUT.paper.toUpperCase()} ${LAYOUT.orient==='portrait'?'Dikey':'Yatay'}`,fx+4,fy-6);
  ctx.restore();
}

function exportLayoutPDF(){const url=renderLayoutExport().toDataURL('image/png');const pp=PAPER_MM[LAYOUT.paper];const pw=LAYOUT.orient==='portrait'?pp.w:pp.h,ph=LAYOUT.orient==='portrait'?pp.h:pp.w;const w=window.open('','_blank');w.document.write(`<!DOCTYPE html><html><head><title>PlanAI</title><style>@page{size:${pw}mm ${ph}mm;margin:0}body{margin:0}img{width:${pw}mm;height:${ph}mm}</style></head><body><img src="${url}" onload="setTimeout(()=>window.print(),400)"></body></html>`);w.document.close()}
function exportLayoutPNG(){const a=document.createElement('a');a.download=`layout_${Date.now()}.png`;a.href=renderLayoutExport().toDataURL('image/png');a.click()}
function renderLayoutExport(){const dpi=200,mmPx=dpi/25.4,pp=PAPER_MM[LAYOUT.paper],pw=LAYOUT.orient==='portrait'?pp.w:pp.h,ph=LAYOUT.orient==='portrait'?pp.h:pp.w,W=Math.round(pw*mmPx),H=Math.round(ph*mmPx),mm=v=>v*mmPx;const cv2=document.createElement('canvas');cv2.width=W;cv2.height=H;const c2=cv2.getContext('2d');c2.fillStyle='#fff';c2.fillRect(0,0,W,H);const mg=mm(8),tH=mm(28),mW=W-mg*2,mH=H-mg*2-tH;const srcX=(LAYOUT.wx*S.scale+S.tx)*DPR,srcY=(LAYOUT.wy*S.scale+S.ty)*DPR,srcW=LAYOUT.ww*S.scale*DPR,srcH=LAYOUT.wh*S.scale*DPR;c2.drawImage(canvas,srcX,srcY,srcW,srcH,mg,mg,mW,mH);c2.strokeStyle='#000';c2.lineWidth=mm(.3);c2.strokeRect(mg,mg,mW,mH);const ty=mg+mH;c2.strokeRect(mg,ty,mW,tH);const sp=mW*.55;c2.beginPath();c2.moveTo(mg+sp,ty);c2.lineTo(mg+sp,ty+tH);c2.stroke();c2.fillStyle='#111';c2.textAlign='left';c2.font=`bold ${mm(5)}px serif`;c2.fillText('İMAR PLANI',mg+mm(4),ty+mm(8));c2.font=`${mm(2.8)}px system-ui`;c2.fillStyle='#333';c2.fillText('Uygulama İmar Planı',mg+mm(4),ty+mm(14));c2.font=`500 ${mm(2.3)}px system-ui`;c2.fillStyle='#555';c2.fillText('',mg+mm(4),ty+mm(19));c2.font=`600 ${mm(2.2)}px monospace`;c2.fillStyle='#222';c2.fillText('Pafta: '+'',mg+mm(4),ty+mm(24));const rx=mg+sp+mm(3),sc=parseInt('1000');[['Ölçek','1:'+sc.toLocaleString('tr-TR')],['Tarih',new Date().toLocaleDateString('tr-TR')]].forEach(([k,v],i)=>{c2.font=`${mm(1.8)}px system-ui`;c2.fillStyle='#999';c2.fillText(k,rx,ty+mm(5)+i*mm(6));c2.font=`600 ${mm(2.5)}px system-ui`;c2.fillStyle='#222';c2.fillText(v,rx+mm(20),ty+mm(5)+i*mm(6))});return cv2}

function render(coordOpts) {
  if (!CW || !CH) return;

  const fastPath = !!(coordOpts && coordOpts.fastPath);
  const lowMode = fastPath || RenderCoordinator.isLowRenderMode();
  const frameStats = (coordOpts && coordOpts.frameStats) || null;

  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  // ── Light paper background ─────────────────────────────────
  ctx.fillStyle = '#f8f9fb';
  ctx.fillRect(0, 0, CW, CH);

  // Page boundary (white inner area)
  const pad = 0;
  ctx.fillStyle = '#ffffff';
  const topBar = getTopBarH();
  const mapBottom = FIELD_MODE ? CH : CH - getFieldDockH();
  ctx.fillRect(pad, topBar, CW - pad*2, mapBottom - topBar - pad);

  // ── OSM basemap (screen space) ──────────────────────────
  renderOSMTiles();

  // Grid (LOW mode: atla)
  if (S.showGrid && !lowMode) renderGrid();

  // Objects — render in layer order, skip invisible/locked layers
  ctx.save();
  ctx.translate(S.tx, S.ty);
  ctx.scale(S.scale, S.scale);

  // Pafta grid overlay (world space) — planning only
  if (!fieldOff('pafta')) renderPaftaGrid();

  // Build visible layer set
  const visibleLayers = new Set(S.layers.filter(l => l.visible).map(l => l.id));
  // Sort by layer order
  const layerOrder = Object.fromEntries(S.layers.map((l,i) => [l.id, l.order ?? i]));
  const sorted = [...S.objects].sort((a,b) => {
    const la = layerOrder[a.layerId || 'sketch'] ?? 99;
    const lb = layerOrder[b.layerId || 'sketch'] ?? 99;
    if (la !== lb) return la - lb;
    if (a._planOverlay && b._planOverlay) {
      const oa = planGmlDrawOrder(a), ob = planGmlDrawOrder(b);
      if (oa !== ob) return oa - ob;
      if (a.type === 'import_polygon' && b.type === 'import_polygon') {
        return importObjGeoArea(b) - importObjGeoArea(a);
      }
    }
    const pa = a._planOverlay ? 0 : 1, pb = b._planOverlay ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const ia = a._import ? 1 : 0, ib = b._import ? 1 : 0;
    return ia - ib;
  });

  const viewport = ViewportManager.getWorldBounds({
    tx: S.tx, ty: S.ty, scale: S.scale,
    cw: CW, topBar, mapBottom,
  });
  let culledCount = 0;
  let visibleObjects = 0;
  let visiblePolygons = 0;

  for (const obj of sorted) {
    const lid = obj.layerId || 'sketch';
    if (!visibleLayers.has(lid)) continue;
    if (viewport && !ViewportManager.isObjectVisible(obj, viewport, latLonToWorld)) {
      culledCount++;
      continue;
    }
    visibleObjects++;
    if (obj.type === 'import_polygon' || obj.type === 'polygon' || obj.type === 'zone') {
      visiblePolygons++;
    }
    if (frameStats) frameStats.drawCalls++;
    renderObjFull(obj, S.selectedIds.includes(obj.id));
  }
  RenderCoordinator.recordCulled(culledCount);
  if (frameStats) {
    frameStats.visibleObjects = visibleObjects;
    frameStats.visiblePolygons = visiblePolygons;
    frameStats.culled = culledCount;
  }
  renderPolyPreview();
  renderPlPreview();
  renderCircleDrawPreview();
  renderSnapIndicator();
  if (_slopeState.active && !lowMode) renderSlopeOverlay();
  if (FIELD_MODE && _pendingNoteGeo) {
    const pw = latLonToWorld(_pendingNoteGeo.lat, _pendingNoteGeo.lon);
    drawEarthPushpin(ctx, pw.x, pw.y, S.scale, true, getNextNoteNumber());
  }
  ctx.restore();

  // Field GPS — smooth puck (interpolated display fix)
  const gpsDraw = FIELD_MODE && _fieldGpsOn ? getGpsDisplayFix() : null;
  if (gpsDraw) {
    ctx.save();
    ctx.translate(S.tx, S.ty);
    ctx.scale(S.scale, S.scale);
    const w = latLonToWorld(gpsDraw.lat, gpsDraw.lon);
    const accR = accuracyWorldRadius(gpsDraw.lat, gpsDraw.accuracy);
    const lowConf = gpsDraw.moveState === GPS_MOVE.LOW || _gpsMoveState === GPS_MOVE.LOW;
    const statLock = gpsDraw.moveState === GPS_MOVE.STATIONARY || _gpsMoveState === GPS_MOVE.STATIONARY;
    ctx.fillStyle = lowConf ? 'rgba(230,126,34,0.12)' : 'rgba(26,115,232,0.14)';
    ctx.strokeStyle = lowConf ? 'rgba(230,126,34,0.38)' : 'rgba(26,115,232,0.35)';
    ctx.lineWidth = 1.5 / S.scale;
    ctx.beginPath();
    ctx.arc(w.x, w.y, accR, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const r = Math.max(7 / S.scale, 9);
    ctx.fillStyle = 'rgba(26,115,232,0.25)';
    ctx.beginPath();
    ctx.arc(w.x, w.y, r * 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1a73e8';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5 / S.scale;
    ctx.beginPath();
    ctx.arc(w.x, w.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    if (gpsDraw.heading != null && !isNaN(gpsDraw.heading)) {
      const h = (gpsDraw.heading * Math.PI) / 180;
      const hLen = statLock ? r * 1.5 : r * 2.2;
      ctx.strokeStyle = lowConf ? 'rgba(230,126,34,0.85)' : '#1a73e8';
      ctx.lineWidth = (statLock ? 1.6 : 2) / S.scale;
      ctx.beginPath();
      ctx.moveTo(w.x, w.y);
      ctx.lineTo(w.x + Math.sin(h) * hLen, w.y - Math.cos(h) * hLen);
      ctx.stroke();
    }
    ctx.restore();
  }
  renderGpsGuidance();
  if (_gpsTrackReplay.pos) {
    ctx.save();
    ctx.translate(S.tx, S.ty);
    ctx.scale(S.scale, S.scale);
    const w = latLonToWorld(_gpsTrackReplay.pos.lat, _gpsTrackReplay.pos.lon);
    const r = Math.max(8 / S.scale, 10);
    ctx.fillStyle = 'rgba(39,174,96,0.28)';
    ctx.beginPath();
    ctx.arc(w.x, w.y, r * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#27ae60';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5 / S.scale;
    ctx.beginPath();
    ctx.arc(w.x, w.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  updateGpsHud();

  // HUD overlay
  ctx.save();
  ctx.setTransform(1,0,0,1,0,0);
  ctx.font      = '10px JetBrains Mono, monospace';
  ctx.fillStyle = 'rgba(80,100,140,0.4)';
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(S.scale*100)}%`, CW*DPR - 8, CH*DPR - 10);
  if (S.snapGrid) {
    ctx.fillStyle = 'rgba(212,143,16,0.6)';
    ctx.textAlign = 'right';
    ctx.fillText(`SNAP ${S.gridSizeCm}cm`, CW*DPR - 68, CH*DPR - 10);
  }
  ctx.restore();

  // ── Layout frame overlay (planning only) ──
  if (!fieldOff('layout')) renderLayoutFrame();

  // DOM status
  document.getElementById('stat-objs').textContent    = t('stat.objects', { n: S.objects.length });
  const statZoom = document.getElementById('stat-zoom');
  if (statZoom) statZoom.textContent = `${Math.round(S.scale * 100)}%`;
  const drawEl = document.getElementById('stat-drawing');
  if (drawEl) {
    if (S.drawing && S.tool === 'circle') drawEl.textContent = t('circle.drawing');
    else drawEl.textContent = (S.drawing || S.polyActive || S.plSession) ? t('stat.drawing') : '';
  }
  const gridEl = document.getElementById('stat-grid');
  if (gridEl && S.showGrid) gridEl.textContent = t('stat.grid', { n: S.gridSizeCm });
}

RenderCoordinator.init({ render: render });

// ─────────────────────────────────────────────────────────────
// HIT TEST
// ─────────────────────────────────────────────────────────────
function hitTest(obj, wx, wy) {
  const T = 10 / S.scale;
  const distSeg = (ax,ay,bx,by) => {
    const dx=bx-ax, dy=by-ay, l2=dx*dx+dy*dy;
    if (!l2) return Math.hypot(wx-ax,wy-ay);
    const t=Math.max(0,Math.min(1,((wx-ax)*dx+(wy-ay)*dy)/l2));
    return Math.hypot(wx-(ax+t*dx),wy-(ay+t*dy));
  };
  if (obj.type === 'line' || obj.type === 'arrow') {
    return distSeg(obj.points[0],obj.points[1],obj.points[2],obj.points[3]) < T;
  }
  if (obj.type === 'georef_image') { return hitTestGeoref(obj, wx, wy); }
  if (obj.type === 'freedraw') {
    const pts = obj.points;
    for (let i=0;i<pts.length-2;i+=2)
      if (distSeg(pts[i],pts[i+1],pts[i+2],pts[i+3]) < T) return true;
    return false;
  }
  if (obj.type === 'polyline') {
    const verts = obj.vertices || [];
    for (let i=0; i<verts.length-1; i++)
      if (distSeg(verts[i].x,verts[i].y,verts[i+1].x,verts[i+1].y) < T) return true;
    return false;
  }
  if (obj.type === 'polygon' || obj.type === 'zone') {
    const pts=obj.points, n=pts.length/2;
    let inside=false;
    for (let i=0,j=n-1;i<n;j=i++) {
      const xi=pts[i*2],yi=pts[i*2+1],xj=pts[j*2],yj=pts[j*2+1];
      if ((yi>wy)!==(yj>wy) && wx<(xj-xi)*(wy-yi)/(yj-yi)+xi) inside=!inside;
    }
    return inside;
  }
  if (obj.type === 'circle' || obj.type === 'analysis_zone') {
    return Math.abs(Math.hypot(wx-obj.cx, wy-obj.cy) - obj.r) < T * 2 ||
           Math.hypot(wx-obj.cx, wy-obj.cy) < obj.r;
  }
  if (obj.type === 'symbol') {
    const sz = (obj.size || 40) * 0.7;
    return Math.abs(wx-obj.x) < sz && Math.abs(wy-obj.y) < sz;
  }
  if (obj.type === 'text') {
    return wx>=obj.x-4 && wx<=obj.x+300 && wy>=obj.y-3 && wy<=obj.y+obj.fontSize+6;
  }
  if (obj.type === 'point') {
    const r = (obj.r || 10) + 8 / S.scale;
    return Math.hypot(wx - obj.x, wy - obj.y) <= r;
  }
  if (obj.type === 'import_text') {
    const w = latLonToWorld(obj.lat, obj.lon);
    const fs = (obj.fontSize || 12) / S.scale;
    return wx >= w.x - 4 && wx <= w.x + 220 && wy >= w.y - 4 && wy <= w.y + fs * 1.4;
  }
  if (obj.type === 'import_point') {
    const w = latLonToWorld(obj.lat, obj.lon);
    return Math.hypot(wx - w.x, wy - w.y) <= Math.max((obj.r || 10) + 8, 14) / S.scale;
  }
  if (obj.type === 'import_polyline') {
    const verts = obj.vertices || [];
    for (let i = 0; i < verts.length - 1; i++) {
      const a = latLonToWorld(verts[i].lat, verts[i].lon);
      const b = latLonToWorld(verts[i + 1].lat, verts[i + 1].lon);
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      if (!l2) continue;
      const t = Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / l2));
      if (Math.hypot(wx - (a.x + t * dx), wy - (a.y + t * dy)) < T * 1.5) return true;
    }
    return false;
  }
  if (obj.type === 'import_polygon') {
    const ring = (obj.rings && obj.rings[0]) || [];
    const pts = geoRingToWorldFlat(ring);
    const n = pts.length / 2;
    let inside = false;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = pts[i * 2], yi = pts[i * 2 + 1], xj = pts[j * 2], yj = pts[j * 2 + 1];
      if ((yi > wy) !== (yj > wy) && wx < (xj - xi) * (wy - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  if (obj.type === 'field_note') {
    const w = latLonToWorld(obj.lat, obj.lon);
    const headY = w.y - 22 / S.scale;
    return Math.hypot(wx - w.x, wy - headY) <= Math.max(14, 20) / S.scale;
  }
  if (obj.type === 'field_photo') {
    const w = latLonToWorld(obj.lat, obj.lon);
    const s = 1 / S.scale;
    const tw = 36 * s;
    const th = 28 * s;
    const tx = w.x - tw / 2;
    const ty = w.y - th - 6 * s;
    return wx >= tx - 4 * s && wx <= tx + tw + 4 * s && wy >= ty - 4 * s && wy <= w.y + 4 * s;
  }
  if (obj.type === 'field_gps_track') {
    const verts = obj.vertices || [];
    for (let i = 0; i < verts.length - 1; i++) {
      const a = latLonToWorld(verts[i].lat, verts[i].lon);
      const b = latLonToWorld(verts[i + 1].lat, verts[i + 1].lon);
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      if (!l2) continue;
      const t = Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / l2));
      if (Math.hypot(wx - (a.x + t * dx), wy - (a.y + t * dy)) < T * 1.5) return true;
    }
    return false;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────
// OBJECT FACTORIES — Extended semantic schema
// ─────────────────────────────────────────────────────────────
const catColor = () => (CATEGORIES.find(c=>c.id===S.planningCat)?.color ?? S.color) + '30';

const baseProps = () => ({
  id:uid(), locked:false, visible:true,
  layerId:     S.activeLayerId || 'sketch',
  planningCat: S.planningCat,
  semanticType:S.planningCat,
  stylePreset: S.planningCat,
  metadata:    {},
});

const makeFreedraw     = (x,y) => ({...baseProps(), type:'freedraw', points:[x,y], color:S.color, strokeWidth:S.strokeWidth, opacity:S.opacity, lineStyle:S.lineStyle, tension:S.tension });
const makeLine         = (x,y) => ({...baseProps(), type:'line', points:[x,y,x,y], color:S.color, strokeWidth:S.strokeWidth, opacity:S.opacity, lineStyle:S.lineStyle, lineDecoration:S.lineDecoration });
const makeArrow        = (x,y) => ({...baseProps(), type:'arrow', points:[x,y,x,y], arrowStyle:S.arrowStyle, lineStyle:S.lineStyle, color:S.color, strokeWidth:S.strokeWidth, opacity:S.opacity });
const makeZone         = (x,y) => ({...baseProps(), type:'zone', points:rectPoints(x,y,x,y), fillColor:catColor(), color:S.color, strokeWidth:S.strokeWidth, opacity:S.opacity, lineStyle:S.lineStyle, hatchPattern:S.hatchPattern });
const makeCircle       = (x,y) => ({...baseProps(), type:'circle', cx:x, cy:y, r:0, circleStyle:S.circleStyle, fillColor:catColor(), color:S.color, strokeWidth:S.strokeWidth, opacity:S.opacity, lineStyle:S.lineStyle });
const makePolygon      = ()    => ({...baseProps(), type:'polygon', points:[], closed:false, fillColor:catColor(), color:S.color, strokeWidth:S.strokeWidth, opacity:S.opacity, lineStyle:S.lineStyle, hatchPattern:S.hatchPattern });
const makeAnalysisZone = (x,y) => ({...baseProps(), type:'analysis_zone', cx:x, cy:y, r:0, analysisStyle:S.analysisStyle, color:S.color, strokeWidth:S.strokeWidth, opacity:S.opacity, layerId:'analysis' });
function renumberFieldPoints() {
  let n = 1;
  for (const o of S.objects) {
    if (o.type === 'point') o.pointNum = n++;
  }
}
function ensureFieldNotesLayer() {
  const def = FIELD_LAYER_DEFS.find(d => d.id === 'notes');
  if (!def) return;
  let layer = S.layers.find(l => l.id === 'notes');
  if (!layer) S.layers.push({ ...def, visible: true, locked: false });
  else layer.visible = true;
}

function normalizeFieldPointObject(o) {
  if (!o || o.type !== 'point') return o;
  if (FIELD_MODE) {
    if (o.layerId === FIELD_POINTS_LAYER || !o.layerId) o.layerId = 'sketch';
    if (o.description == null) o.description = '';
  }
  return o;
}

const makePoint = (x, y) => {
  const ptSize = FIELD_MODE
    ? Math.max(6, Math.min(32, S.strokeWidth >= 4 ? S.strokeWidth : 10))
    : Math.max(6, 12 / S.scale);
  return {
    ...baseProps(), type: 'point', x, y,
    pointNum: S.objects.filter(o => o.type === 'point').length + 1,
    description: '',
    r: ptSize,
    color: S.color, strokeWidth: S.strokeWidth, opacity: S.opacity,
    layerId: S.activeLayerId || 'sketch',
  };
};

function rectPoints(x1,y1,x2,y2) { return [x1,y1,x2,y1,x2,y2,x1,y2]; }

// ─────────────────────────────────────────────────────────────
// CENTRIPETAL CATMULL-ROM — stable, no loops, natural flow
// Passes through every vertex (interpolating spline)
// ─────────────────────────────────────────────────────────────
function catmullRomPath(ctx2, verts, tension) {
  if (verts.length < 2) return;
  const t = (tension === undefined ? 0.5 : tension);
  ctx2.moveTo(verts[0].x, verts[0].y);
  if (verts.length === 2) {
    ctx2.lineTo(verts[1].x, verts[1].y);
    return;
  }
  for (let i = 0; i < verts.length - 1; i++) {
    const p0 = verts[Math.max(0, i-1)];
    const p1 = verts[i];
    const p2 = verts[i+1];
    const p3 = verts[Math.min(verts.length-1, i+2)];
    // Catmull-Rom → cubic bezier control points
    const cp1x = p1.x + (p2.x - p0.x) * t / 6;
    const cp1y = p1.y + (p2.y - p0.y) * t / 6;
    const cp2x = p2.x - (p3.x - p1.x) * t / 6;
    const cp2y = p2.y - (p3.y - p1.y) * t / 6;
    ctx2.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
}

// ─────────────────────────────────────────────────────────────
// POLYLINE / SPLINE LIVE PREVIEW
// ─────────────────────────────────────────────────────────────
function renderPlPreview() {
  if (!S.plSession || S.plVerts.length < 1) return;
  const verts = [...S.plVerts, { x: S.plPrevX, y: S.plPrevY }];
  ctx.save();
  ctx.globalAlpha = 0.72;
  ctx.strokeStyle = S.color;
  ctx.lineWidth   = S.strokeWidth;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';

  if (S.plSmooth && verts.length >= 2) {
    // Smooth spline preview
    ctx.setLineDash([]);
    ctx.beginPath();
    catmullRomPath(ctx, verts, S.tension || 0.5);
    ctx.stroke();
    // Dashed future segment
    ctx.globalAlpha = 0.3;
    ctx.setLineDash([4/S.scale, 3/S.scale]);
    ctx.beginPath();
    ctx.moveTo(S.plPrevX, S.plPrevY);
    ctx.stroke();
  } else {
    // Polyline: solid drawn segments + dashed preview
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(S.plVerts[0].x, S.plVerts[0].y);
    S.plVerts.slice(1).forEach(v => ctx.lineTo(v.x, v.y));
    ctx.stroke();
    // Preview segment to cursor
    ctx.globalAlpha = 0.38;
    ctx.setLineDash([6/S.scale, 4/S.scale]);
    ctx.beginPath();
    ctx.moveTo(S.plVerts[S.plVerts.length-1].x, S.plVerts[S.plVerts.length-1].y);
    ctx.lineTo(S.plPrevX, S.plPrevY);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // Vertex handles
  ctx.globalAlpha = 1;
  S.plVerts.forEach((v, i) => {
    const isFirst = i === 0, isLast = i === S.plVerts.length-1;
    const r = (isFirst ? 6 : 4) / S.scale;
    if (S.plSmooth) {
      // Spline style: open circles for endpoints, filled dark for middle
      ctx.fillStyle   = (isFirst||isLast) ? '#ffffff' : '#333344';
      ctx.strokeStyle = (isFirst||isLast) ? '#3366cc' : '#5555aa';
    } else {
      ctx.fillStyle   = isFirst ? S.color : '#ffffff';
      ctx.strokeStyle = S.color;
    }
    ctx.lineWidth = 1.5 / S.scale;
    ctx.beginPath(); ctx.arc(v.x, v.y, r, 0, Math.PI*2);
    ctx.fill(); ctx.stroke();
  });

  // Snap crosshair at current position
  if (S.snapGrid && S.plSnapped) {
    ctx.strokeStyle = 'rgba(212,143,16,0.9)';
    ctx.lineWidth   = 1.2/S.scale;
    const sc = 5/S.scale;
    ctx.setLineDash([sc*.4, sc*.3]);
    ctx.beginPath();
    ctx.moveTo(S.plSnapped.x-sc*2.5, S.plSnapped.y);
    ctx.lineTo(S.plSnapped.x+sc*2.5, S.plSnapped.y);
    ctx.moveTo(S.plSnapped.x, S.plSnapped.y-sc*2.5);
    ctx.lineTo(S.plSnapped.x, S.plSnapped.y+sc*2.5);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Hull lines for spline (dashed orange)
  if (S.plSmooth && S.plVerts.length >= 2) {
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = 'rgba(200,110,30,0.7)';
    ctx.lineWidth   = 0.8/S.scale;
    ctx.setLineDash([3/S.scale, 3/S.scale]);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(S.plVerts[0].x, S.plVerts[0].y);
    S.plVerts.forEach((v,i)=>{ if(i>0) ctx.lineTo(v.x,v.y); });
    ctx.lineTo(S.plPrevX, S.plPrevY);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}
// ─────────────────────────────────────────────────────────────
// CENTRIPETAL CATMULL-ROM — stable, no loops, passes through verts
// ─────────────────────────────────────────────────────────────
function catmullRomPath(c2, verts, tension) {
  if(verts.length<2) return;
  const t=tension===undefined?0.5:tension;
  c2.moveTo(verts[0].x,verts[0].y);
  if(verts.length===2){c2.lineTo(verts[1].x,verts[1].y);return;}
  for(let i=0;i<verts.length-1;i++){
    const p0=verts[Math.max(0,i-1)],p1=verts[i],p2=verts[i+1],p3=verts[Math.min(verts.length-1,i+2)];
    const cp1x=p1.x+(p2.x-p0.x)*t/6, cp1y=p1.y+(p2.y-p0.y)*t/6;
    const cp2x=p2.x-(p3.x-p1.x)*t/6, cp2y=p2.y-(p3.y-p1.y)*t/6;
    c2.bezierCurveTo(cp1x,cp1y,cp2x,cp2y,p2.x,p2.y);
  }
}

// Polyline/Spline live preview while session is active
function renderPlPreview() {
  if(!S.plSession||S.plVerts.length<1) return;
  const verts=[...S.plVerts,{x:S.plPrevX,y:S.plPrevY}];
  ctx.save(); ctx.globalAlpha=0.72;
  ctx.strokeStyle=S.color; ctx.lineWidth=S.strokeWidth;
  ctx.lineCap='round'; ctx.lineJoin='round';

  if(S.plSmooth&&verts.length>=2){
    ctx.setLineDash([]);ctx.beginPath();catmullRomPath(ctx,verts,S.tension||0.5);ctx.stroke();
  } else {
    ctx.setLineDash([]);ctx.beginPath();
    ctx.moveTo(S.plVerts[0].x,S.plVerts[0].y);
    S.plVerts.slice(1).forEach(v=>ctx.lineTo(v.x,v.y));ctx.stroke();
    ctx.globalAlpha=0.38;ctx.setLineDash([6/S.scale,4/S.scale]);ctx.beginPath();
    ctx.moveTo(S.plVerts[S.plVerts.length-1].x,S.plVerts[S.plVerts.length-1].y);
    ctx.lineTo(S.plPrevX,S.plPrevY);ctx.stroke();
  }
  ctx.setLineDash([]);

  // Hull for spline
  if(S.plSmooth&&S.plVerts.length>=2){
    ctx.globalAlpha=0.35;ctx.strokeStyle='rgba(200,110,30,0.65)';ctx.lineWidth=0.8/S.scale;
    ctx.setLineDash([3/S.scale,3/S.scale]);ctx.lineCap='butt';
    ctx.beginPath();ctx.moveTo(S.plVerts[0].x,S.plVerts[0].y);
    S.plVerts.forEach((v,i)=>{if(i>0)ctx.lineTo(v.x,v.y);});ctx.lineTo(S.plPrevX,S.plPrevY);
    ctx.stroke();ctx.setLineDash([]);
  }

  // Vertex handles
  ctx.globalAlpha=1;
  S.plVerts.forEach((v,i)=>{
    const isFirst=i===0,isLast=i===S.plVerts.length-1,r=(isFirst?6:4)/S.scale;
    ctx.fillStyle=S.plSmooth?(isFirst||isLast?'#ffffff':'#333344'):(isFirst?S.color:'#ffffff');
    ctx.strokeStyle=S.plSmooth?(isFirst||isLast?'#3366cc':'#5555aa'):S.color;
    ctx.lineWidth=1.5/S.scale;ctx.beginPath();ctx.arc(v.x,v.y,r,0,Math.PI*2);ctx.fill();ctx.stroke();
  });

  // Snap crosshair
  if(S.snapGrid){
    ctx.strokeStyle='rgba(212,143,16,0.85)';ctx.lineWidth=1.2/S.scale;
    const sc=5/S.scale;ctx.setLineDash([sc*.4,sc*.3]);
    ctx.beginPath();ctx.moveTo(S.plPrevX-sc*2.5,S.plPrevY);ctx.lineTo(S.plPrevX+sc*2.5,S.plPrevY);
    ctx.moveTo(S.plPrevX,S.plPrevY-sc*2.5);ctx.lineTo(S.plPrevX,S.plPrevY+sc*2.5);ctx.stroke();
    ctx.setLineDash([]);
  }
  renderSegmentMeasureLabels(verts, false);
  ctx.restore();
}



// ─────────────────────────────────────────────────────────────
// POLYLINE / SPLINE SESSION
// ─────────────────────────────────────────────────────────────
function startPlSession(smooth) {
  S.plSession=true; S.plVerts=[]; S.plSmooth=smooth; S.plSnapped=null;
  _fieldDrawTap.t = 0;
  updateFieldDrawFab();
  if (!FIELD_MODE) {
    const el = document.getElementById('poly-hint');
    if (el) {
      el.textContent = smooth
        ? 'Spline: Köşelere tıkla · Enter / Çift tıkla bitir · Esc iptal'
        : 'Polyline: Köşelere tıkla · Enter / Çift tıkla bitir · Esc iptal';
      el.style.display = 'block';
    }
  }
}
function finishPlSession() {
  if(!S.plSession||S.plVerts.length<2){ cancelPlSession(); return; }
  const obj={...baseProps(),type:'polyline',vertices:[...S.plVerts],smoothing:S.plSmooth,tension:S.tension||0.5,closed:false,color:S.color,strokeWidth:S.strokeWidth,opacity:S.opacity,lineStyle:S.lineStyle==='spline'?'solid':S.lineStyle,lineDecoration:S.lineDecoration||'none'};
  S.objects.push(obj); pushHistory();
  S.selectedIds = [obj.id];
  updateSelPanel(obj);
  cancelPlSession(); scheduleRender();
}
function cancelPlSession() {
  S.plSession=false; S.plVerts=[]; S.plSnapped=null;
  hideMeasLabel();
  const el=document.getElementById('poly-hint');
  if(el) el.style.display='none';
  updateFieldDrawFab();
  scheduleRender();
}

// Polyline/Spline object rendering
function renderPolylineObj(obj, sel) {
  const verts=obj.vertices; if(!verts||verts.length<2) return;
  ctx.save(); ctx.globalAlpha=obj.opacity;
  ctx.strokeStyle=obj.color; ctx.lineWidth=obj.strokeWidth;
  ctx.lineCap='round'; ctx.lineJoin='round';
  const drawPath=()=>{ ctx.beginPath();
    if(obj.smoothing&&verts.length>=2){ catmullRomPath(ctx,verts,obj.tension??0.5); }
    else{ ctx.moveTo(verts[0].x,verts[0].y); verts.slice(1).forEach(v=>ctx.lineTo(v.x,v.y)); }
  };
  applyDash(obj.lineStyle,obj.strokeWidth);
  if(sel){ctx.save();ctx.strokeStyle='#4488ff';ctx.lineWidth=obj.strokeWidth+9;ctx.globalAlpha=.15;ctx.setLineDash([]);drawPath();ctx.stroke();ctx.restore();}
  drawPath(); ctx.stroke(); ctx.setLineDash([]);
  if(obj.lineDecoration&&obj.lineDecoration!=='none'){
    const hs=obj.strokeWidth*5+8,first=verts[0],second=verts[1],last=verts[verts.length-1],prev=verts[verts.length-2];
    if(obj.lineDecoration==='end'||obj.lineDecoration==='both') drawHead(prev.x,prev.y,last.x,last.y,hs,'filled',obj.color,obj.strokeWidth);
    if(obj.lineDecoration==='start'||obj.lineDecoration==='both') drawHead(second.x,second.y,first.x,first.y,hs,'filled',obj.color,obj.strokeWidth);
  }
  if(sel){
    ctx.save();
    if(obj.smoothing){ctx.strokeStyle='rgba(200,110,30,0.45)';ctx.lineWidth=0.8/S.scale;ctx.setLineDash([3/S.scale,3/S.scale]);ctx.lineCap='butt';ctx.beginPath();ctx.moveTo(verts[0].x,verts[0].y);verts.slice(1).forEach(v=>ctx.lineTo(v.x,v.y));ctx.stroke();ctx.setLineDash([]);}
    verts.forEach((v,i)=>{
      const isEnd=i===0||i===verts.length-1,isAct=S.vertexDragging&&S.vertexObjId===obj.id&&S.vertexIdx===i;
      ctx.fillStyle=isAct?'#ffcc00':(obj.smoothing?(isEnd?'#fff':'#333344'):'#4488ff');
      ctx.strokeStyle=isAct?'#ff8800':(obj.smoothing?(isEnd?'#3366cc':'#5555aa'):'#fff');
      ctx.lineWidth=1.5/S.scale;ctx.setLineDash([]);
      const vR = FIELD_MODE ? (isEnd ? 10 : 8) : (isEnd ? 6 : 4);
      ctx.beginPath();ctx.arc(v.x,v.y,vR/S.scale,0,Math.PI*2);ctx.fill();ctx.stroke();
    });
    ctx.restore();
  }
  renderSegmentMeasureLabels(verts, !!obj.closed);
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────
// POLYGON SESSION
// ─────────────────────────────────────────────────────────────
function startPolygon() {
  S.polyActive = true;
  S.polyPts    = [];
  _fieldDrawTap.t = 0;
  if (!FIELD_MODE) {
    const ph = document.getElementById('poly-hint');
    if (ph) ph.style.display = 'block';
  }
  updateFieldDrawFab();
}

function finishPolygon() {
  if (!S.polyActive) return;
  if (S.polyPts.length >= 6) { // at least 3 vertices
    const obj = makePolygon();
    obj.points = [...S.polyPts];
    obj.closed = true;
    S.objects.push(obj);
    pushHistory();
    if (FIELD_MODE) {
      S.selectedIds = [obj.id];
      updateSelPanel(obj);
    }
  }
  cancelPolygon();
}

function cancelPolygon() {
  S.polyActive = false;
  S.polyPts    = [];
  const ph = document.getElementById('poly-hint');
  if (ph) ph.style.display = 'none';
  updateFieldDrawFab();
  scheduleRender();
}

// Check if click is near first vertex (close polygon)
function nearFirstVertex(x, y) {
  if (S.polyPts.length < 6) return false;
  return Math.hypot(x - S.polyPts[0], y - S.polyPts[1]) < 14 / S.scale;
}

// ─────────────────────────────────────────────────────────────
// MOUSE EVENTS
// ─────────────────────────────────────────────────────────────
canvas.addEventListener('mousedown', onMouseDown);
canvas.addEventListener('mousemove', onMouseMove);
canvas.addEventListener('mouseup',   onMouseUp);
canvas.addEventListener('mouseleave', onMouseLeave);
canvas.addEventListener('dblclick',  onDblClick);
canvas.addEventListener('wheel', onWheel, { passive: false });
canvas.addEventListener('contextmenu', e => {
  if (FIELD_MODE && openFieldMapContextMenuAt(e)) {
    e.preventDefault();
    return;
  }
  if (!layoutRightClick(e)) e.preventDefault();
});

// Touch / pen — mirror mouse handlers for tablet field use
function _pe(e) {
  return {
    clientX: e.clientX, clientY: e.clientY,
    button: e.button, buttons: e.buttons,
    altKey: e.altKey, shiftKey: e.shiftKey,
    target: e.target,
    pointerType: e.pointerType || 'touch',
    pointerId: e.pointerId,
    preventDefault: () => e.preventDefault(),
  };
}
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') return;
  _fieldLastPointerAt = Date.now();
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  S._activePointerType = e.pointerType;
  if (fieldPointerDown(e)) return;
  const pe = _pe(e);
  if (FIELD_MODE && fieldNavigationPointer(e.pointerType) && !fieldDrawingAllowed(e.pointerType)) {
    const wp = clientToWorld(pe.clientX, pe.clientY);
    if (_fieldTouch) return;
  }
  onMouseDown(pe);
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') return;
  if (fieldPointerMove(e)) return;
  if (FIELD_MODE && _fieldTouch) return;
  onMouseMove(_pe(e));
});
canvas.addEventListener('pointerup', e => {
  if (e.pointerType === 'mouse') return;
  const pe = _pe(e);
  const wp = clientToWorld(pe.clientX, pe.clientY);
  if (fieldPointerUp(e, wp)) {
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    return;
  }
  if (FIELD_MODE && _fieldTouch) return;
  onMouseUp(pe);
  try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
});
canvas.addEventListener('pointercancel', e => {
  if (e.pointerType === 'mouse') return;
  _fieldPointers.delete(e.pointerId);
  _fieldTouch = null;
  S.panning = false;
  onMouseLeave(_pe(e));
});

function onMouseDown(e) {
  if (fieldSuppressGhostMouse()) return;
  e.preventDefault();
  S._activePointerType = e.pointerType || 'mouse';
  // Layout mode intercept (planning only)
  if (!fieldOff('layout') && LAYOUT.mode !== 'off' && e.button === 0) {
    const r = canvas.getBoundingClientRect();
    if (layoutMouseDown(e.clientX - r.left, e.clientY - r.top)) return;
  }
  const wp = clientToWorld(e.clientX, e.clientY);
  const pt = snapPt(wp.x, wp.y);

  if (FIELD_MODE && _notePinMode) {
    placeFieldNotePin(wp);
    return;
  }
  if (FIELD_MODE && tryFieldDrawDoubleTap(wp)) return;
  if (FIELD_MODE && !fieldDrawingAllowed(S._activePointerType)) {
    if (S.tool === 'field-note') {
      startFieldNotePlacement();
      return;
    }
  }

  // Close text editor if clicking outside it
  const te = document.getElementById('text-editor');
  if (te.style.display !== 'none' && !te.contains(e.target)) {
    closeTextEditor(true);
  }

  // Field mode: right-click opens Buraya Git menu (contextmenu handler)
  if (e.button === 2 && FIELD_MODE && fieldMapRightClickAllowed()) return;

  // Pan: middle / alt+left / right-click (planning or while drawing in field)
  if (e.button === 1 || (e.button === 2 && LAYOUT.mode === 'off') || (e.button === 0 && e.altKey)) {
    S.panning = true; S.panLastX = e.clientX; S.panLastY = e.clientY;
    RenderCoordinator.beginInteraction('pan');
    if (e.button === 2 && FIELD_MODE) disableGpsFollowFromPan();
    canvas.style.cursor = 'grabbing'; return;
  }
  if (e.button !== 0) return;

  if (S.tool === 'info') {
    fieldInfoToolPick(wp);
    canvas.style.cursor = 'default';
    return;
  }

  // SELECT TOOL
  if (S.tool === 'select') {
    if (_fieldInfoObjId) hideFeatureInfoPanel();
    // 0. Check vertex handles on selected objects (highest priority)
    if (S.selectedIds.length > 0) {
      for (const sid of S.selectedIds) {
        const selObj = S.objects.find(o => o.id === sid);
        if (!selObj) continue;
        const p   = unrotateForHit(selObj, wp.x, wp.y);
        const vIdx = nearVertex(selObj, p.x, p.y);
        if (vIdx !== -1) {
          S.vertexDragging = true;
          S.vertexObjId    = selObj.id;
          S.vertexIdx      = vIdx;
          S.vertexSnapshot = JSON.parse(JSON.stringify(selObj));
          canvas.style.cursor = 'crosshair';
          return;
        }
      }
    }
    if (S.selectedIds.length > 0) {
      const selObj = S.objects.find(o => S.selectedIds.includes(o.id));
      if (selObj && selObj.type !== 'circle') {
        const h = getRotateHandleWorld(selObj);
        if (Math.hypot(wp.x - h.x, wp.y - h.y) < 10 / S.scale) {
          const c = getBoundingCenter(selObj);
          S.rotating           = true;
          S.rotateId           = selObj.id;
          S.rotateCX           = c.x;
          S.rotateCY           = c.y;
          S.rotateStartAngle   = Math.atan2(wp.y - c.y, wp.x - c.x);
          S.rotateInitialAngle = selObj.rotation || 0;
          canvas.style.cursor  = 'crosshair';
          return;
        }
      }
    }
    // 2. Check drag on selected object
    if (S.selectedIds.length > 0) {
      const selObj = S.objects.find(o => {
        if (!S.selectedIds.includes(o.id) || !isObjectSelectableInField(o)) return false;
        const p = unrotateForHit(o, wp.x, wp.y);
        return hitTest(o, p.x, p.y);
      });
      if (selObj) {
        if (FIELD_MODE && (selObj.type === 'field_note' || selObj.type === 'field_photo')) {
          showFieldObservationPopup(selObj);
          scheduleRender();
          return;
        }
        S.dragging        = true;
        S.dragStartWorldX = wp.x;
        S.dragStartWorldY = wp.y;
        S.dragSnapshot    = JSON.parse(JSON.stringify(
          S.objects.filter(o => S.selectedIds.includes(o.id))
        )).map(s => {
          if (s.type === 'import_point' || s.type === 'field_note' || s.type === 'field_photo' || s.type === 'import_text') {
            const w = latLonToWorld(s.lat, s.lon);
            s._w0x = w.x; s._w0y = w.y;
          }
          return s;
        });
        canvas.style.cursor = 'grabbing';
        return;
      }
    }
    // 3. Pick new selection
    let found = null;
    for (let i = S.objects.length - 1; i >= 0; i--) {
      const o = S.objects[i];
      if (!isObjectSelectableInField(o)) continue;
      const p = unrotateForHit(o, wp.x, wp.y);
      if (hitTest(o, p.x, p.y)) { found = o.id; break; }
    }
    S.selectedIds = found ? [found] : [];
    setDeleteButtonVisible(S.selectedIds.length > 0);
    const selObj = found ? S.objects.find(o => o.id === found) : null;
    updateSelPanel(selObj);
    updateFieldAnalysisActions(selObj);
    if (selObj?.type === 'field_note' || selObj?.type === 'field_photo') {
      showFieldObservationPopup(selObj);
    } else {
      closeNotePopup();
    }
    scheduleRender(); return;
  }

  if (S.tool === 'field-note') {
    placeFieldNotePin(wp);
    return;
  }

  // POINT — planning only (field uses saha notları)
  if (!FIELD_MODE && S.tool === 'point') {
    const obj = makePoint(pt.x, pt.y);
    S.objects.push(obj);
    renumberFieldPoints();
    S.selectedIds = [obj.id];
    updateSelPanel(obj);
    buildLayerPanel();
    pushHistory();
    scheduleRender();
    return;
  }

  // SYMBOL — click to place
  if (S.tool === 'symbol') {
    if (fieldOff('symbolLibrary')) return;
    if (!_symPlaceId) { showHint('Önce sembol kütüphanesinden bir sembol seçin'); return; }
    const symObj = {
      ...baseProps(), type:'symbol', x:pt.x, y:pt.y,
      symbolId:  _symPlaceId,
      size:      36 / S.scale,
      color:     S.color,
      opacity:   S.opacity,
      rotation:  0,
    };
    S.objects.push(symObj);
    S.selectedIds = [symObj.id];
    updateSelPanel(symObj);
    pushHistory(); scheduleRender(); return;
  }

  // TEXT TOOL — place new text
  if (S.tool === 'text') {
    const id = uid();
    const obj = { id, type:'text', x:pt.x, y:pt.y, text:'Metin', color:S.color,
      fontSize:16, fontFamily:'Caveat', bold:false, opacity:S.opacity,
      strokeWidth:1, visible:true, locked:false, hasBg:true, planningCat:S.planningCat };
    S.objects.push(obj);
    pushHistory();
    S.selectedIds = [id];
    scheduleRender();
    openTextEditor(obj);
    return;
  }

  // POLYGON
  if (S.tool === 'polygon') {
    if (!S.polyActive) startPolygon();
    if (nearFirstVertex(pt.x, pt.y)) { finishPolygon(); return; }
    S.polyPts.push(pt.x, pt.y);
    updateFieldDrawFab();
    scheduleRender(); return;
  }

  // POLYLINE / SPLINE — click-to-add vertex session
  if (S.tool === 'polyline' || S.tool === 'spline') {
    if (!S.plSession) startPlSession(S.tool === 'spline');
    // Check if near first vertex → close/finish
    if (S.plVerts.length >= 2) {
      const first = S.plVerts[0];
      if (Math.hypot(pt.x - first.x, pt.y - first.y) < 10/S.scale) {
        finishPlSession(); return;
      }
    }
    S.plVerts.push({ x: pt.x, y: pt.y });
    updateFieldDrawFab();
    scheduleRender(); return;
  }

  // ERASER
  if (S.tool === 'eraser') return;

  // Drag-draw tools
  S.drawing    = true;
  S.drawStartX = pt.x;
  S.drawStartY = pt.y;

  let obj = null;
  if (S.tool === 'freedraw')  obj = makeFreedraw(pt.x, pt.y);
  if (!FIELD_MODE && S.tool === 'line') obj = makeLine(pt.x, pt.y);
  if (S.tool === 'arrow')     obj = makeArrow(pt.x, pt.y);
  if (S.tool === 'zone')      obj = makeZone(pt.x, pt.y);
  if (S.tool === 'circle')    obj = makeCircle(pt.x, pt.y);
  if (S.tool === 'analysis')  obj = makeAnalysisZone(pt.x, pt.y);

  if (obj) {
    S.objects.push(obj);
    S.activeId = obj.id;
    if (FIELD_MODE && S.tool === 'circle') showHint(t('circle.step2'));
    scheduleRender();
  }
}

function onMouseMove(e) {
  if (fieldSuppressGhostMouse()) return;
  const r = canvas.getBoundingClientRect();
  // Layout mode intercept
  if (!fieldOff('layout') && LAYOUT.mode !== 'off' && layoutMouseMove(e.clientX - r.left, e.clientY - r.top)) return;

  const wp = clientToWorld(e.clientX, e.clientY);
  const pt = snapPt(wp.x, wp.y);

  if (S.panning) {
    S.tx += e.clientX - S.panLastX; S.ty += e.clientY - S.panLastY;
    S.panLastX = e.clientX; S.panLastY = e.clientY;
    scheduleRender(); return;
  }

  // ── ROTATION ──────────────────────────────────────────────
  if (S.rotating && S.rotateId) {
    const currentAngle = Math.atan2(wp.y - S.rotateCY, wp.x - S.rotateCX);
    const delta = currentAngle - S.rotateStartAngle;
    const obj = S.objects.find(o => o.id === S.rotateId);
    if (obj) { obj.rotation = S.rotateInitialAngle + delta; }
    scheduleRender(); return;
  }

  // ── VERTEX DRAG ────────────────────────────────────────────
  if (S.vertexDragging && S.vertexObjId) {
    const obj = S.objects.find(o => o.id === S.vertexObjId);
    if (obj) {
      const vIdx = S.vertexIdx;
      if (vIdx === 'center') {
        if (obj.type === 'point') { obj.x = pt.x; obj.y = pt.y; }
        else { obj.cx = pt.x; obj.cy = pt.y; }
      } else if (vIdx === 'radius') {
        obj.r = Math.hypot(pt.x - obj.cx, pt.y - obj.cy);
      } else if (typeof vIdx === 'number' && vIdx >= 0) {
        if (obj.type === 'polyline') {
          // polyline uses {x,y} vertex array
          if (obj.vertices[vIdx]) { obj.vertices[vIdx] = { x: pt.x, y: pt.y }; }
        } else if (obj.type === 'zone' && obj.points.length === 8) {
          const snap = S.vertexSnapshot;
          const oppMap = { 0:4, 2:6, 4:0, 6:2 };
          const opp = oppMap[vIdx];
          if (opp !== undefined) {
            const ox = snap.points[opp], oy = snap.points[opp+1];
            obj.points = rectPoints(Math.min(pt.x,ox),Math.min(pt.y,oy),Math.max(pt.x,ox),Math.max(pt.y,oy));
          }
        } else {
          obj.points[vIdx]   = pt.x;
          obj.points[vIdx+1] = pt.y;
        }
      }
      if (S.showMeasurement) {
        const meas = objMeasurement(obj);
        if (meas) showMeasLabel(e.clientX, e.clientY, meas);
      }
    }
    scheduleRender(); return;
  }

  // ── DRAG-MOVE selected objects ──────────────────────────
  if (S.dragging && S.dragSnapshot) {
    const dx = wp.x - S.dragStartWorldX;
    const dy = wp.y - S.dragStartWorldY;
    for (const obj of S.objects) {
      if (!S.selectedIds.includes(obj.id)) continue;
      const snap = S.dragSnapshot.find(s => s.id === obj.id);
      if (snap) translateObject(obj, snap, dx, dy);
    }
    scheduleRender(); return;
  }

  if (S.tool === 'eraser' && e.buttons === 1) {
    const before = S.objects.length;
    S.objects = S.objects.filter(o => !hitTest(o, wp.x, wp.y));
    if (S.objects.length !== before) { pushHistory(); scheduleRender(); }
    return;
  }

  if (S.polyActive) {
    S.polyPreviewX = pt.x; S.polyPreviewY = pt.y;
    canvas.style.cursor = nearFirstVertex(pt.x, pt.y) ? 'cell' : 'crosshair';
    scheduleRender(); return;
  }

  // ── POLYLINE / SPLINE session preview ─────────────────────
  if (S.plSession) {
    S.plPrevX = pt.x; S.plPrevY = pt.y;
    // Cursor hint: near first vertex = close
    if (S.plVerts.length >= 2) {
      const first = S.plVerts[0];
      canvas.style.cursor = Math.hypot(pt.x-first.x, pt.y-first.y) < 10/S.scale ? 'cell' : 'crosshair';
    }
    if (S.showMeasurement && S.plVerts.length >= 1) {
      const last = S.plVerts[S.plVerts.length-1];
      const segM = pxToMeters(Math.hypot(pt.x-last.x, pt.y-last.y));
      const totalPx = S.plVerts.reduce((acc,v,i) => i===0?0:acc+Math.hypot(v.x-S.plVerts[i-1].x,v.y-S.plVerts[i-1].y), 0);
      const totalM = pxToMeters(totalPx + Math.hypot(pt.x-last.x, pt.y-last.y));
      showMeasLabel(e.clientX, e.clientY,
        `seg ${formatLength(segM)}  ·  top ${formatLength(totalM)}  [${S.plVerts.length+1} pt]`);
    }
    scheduleRender(); return;
  }

  if (!S.drawing || !S.activeId) return;
  const obj = S.objects.find(o => o.id === S.activeId);
  if (!obj) return;

  if (obj.type === 'freedraw') {
    const last2 = obj.points.length - 2;
    const dx = pt.x - obj.points[last2], dy = pt.y - obj.points[last2+1];
    if (Math.hypot(dx,dy) > 2/S.scale) obj.points.push(pt.x, pt.y);
  }
  else if (obj.type === 'line' || obj.type === 'arrow') {
    obj.points[2] = pt.x; obj.points[3] = pt.y;
  }
  else if (obj.type === 'zone') {
    obj.points = rectPoints(S.drawStartX, S.drawStartY, pt.x, pt.y);
  }
  else if (obj.type === 'circle') {
    obj.r = Math.hypot(pt.x - obj.cx, pt.y - obj.cy);
  }
  else if (obj.type === 'analysis_zone') {
    obj.r = Math.hypot(pt.x - obj.cx, pt.y - obj.cy);
  }

  // Bezier preview update

  // ── Live measurement label ──────────────────────────────────
  if (S.drawing && S.activeId && S.showMeasurement) {
    const obj = S.objects.find(o => o.id === S.activeId);
    if (obj) {
      const meas = objMeasurement(obj);
      if (meas) showMeasLabel(e.clientX, e.clientY, meas);
    }
  }

  scheduleRender();
}

function onMouseUp(e) {
  if (fieldSuppressGhostMouse()) return;
  if (S.panning) {
    S.panning = false;
    canvas.style.cursor = getCursor();
    RenderCoordinator.endInteraction();
    if (FIELD_MODE) scheduleProjectSave();
    return;
  }
  // Layout mode
  layoutMouseUp();

  // End rotation
  if (S.rotating) {
    S.rotating = false; S.rotateId = null;
    canvas.style.cursor = getCursor();
    pushHistory(); scheduleRender(); return;
  }
  // End vertex drag
  if (S.vertexDragging) {
    S.vertexDragging = false; S.vertexObjId = null;
    S.vertexIdx = -1; S.vertexSnapshot = null;
    hideMeasLabel();
    canvas.style.cursor = getCursor();
    pushHistory(); scheduleRender(); return;
  }
  // End drag-move
  if (S.dragging) {
    S.dragging      = false;
    S.dragSnapshot  = null;
    canvas.style.cursor = getCursor();
    pushHistory();
    scheduleRender(); return;
  }

  if (S.drawing) {
    S.drawing = false;
    hideMeasLabel();
    const obj = S.objects.find(o => o.id === S.activeId);
    if (obj) {
      const tooSmall =
        (obj.type==='line'||obj.type==='arrow') && Math.hypot(obj.points[2]-obj.points[0],obj.points[3]-obj.points[1])<3 ||
        obj.type==='zone' && Math.abs(obj.points[2]-obj.points[0])<4 ||
        obj.type==='circle' && obj.r < 3 ||
        obj.type==='freedraw' && obj.points.length<4;
      if (tooSmall) S.objects = S.objects.filter(o => o.id !== S.activeId);
      else {
        pushHistory();
        S.selectedIds = [obj.id];
        updateSelPanel(obj);
        if (FIELD_MODE && obj.type === 'circle' && obj.r >= 8) {
          updateFieldAnalysisActions(obj);
          showHint(t('hint.slopeAfterCircle'));
          runLocalSlopeAnalysis(obj).catch(() => showHint(t('slope.offline')));
        }
      }
    }
    S.activeId = null; scheduleRender();
  }
}

function onMouseLeave(e) {
  if (S.panning)        { S.panning  = false; canvas.style.cursor = getCursor(); }
  if (S.dragging)       { S.dragging = false; S.dragSnapshot = null; pushHistory(); scheduleRender(); }
  if (S.vertexDragging) { S.vertexDragging = false; S.vertexObjId = null; S.vertexIdx = -1; S.vertexSnapshot = null; hideMeasLabel(); pushHistory(); scheduleRender(); }
  if (S.drawing)        onMouseUp(e);
}

function onDblClick(e) {
  // Last click that ended the double-click: remove duplicate vertex if polyline/spline session
  if (S.plSession) {
    // The dblclick fires after two mousedowns added 2 vertices; remove the last one
    if (S.plVerts.length > 1) S.plVerts.pop();
    finishPlSession();
    return;
  }
  if (S.tool === 'polygon' && S.polyActive) { finishPolygon(); return; }

  if (S.tool === 'select') {
    const wp = clientToWorld(e.clientX, e.clientY);

    // Check pafta grid — show pafta name at click location
    if (S.showPafta) {
      const geo = worldToLatLon(wp.x, wp.y);
      const pName = getPaftaNameAtLatLon(geo.lat, geo.lon);
      if (pName) showHint(`📐 Pafta: ${pName} — ${geo.lat.toFixed(4)}°N, ${geo.lon.toFixed(4)}°E`);
    }

    for (let i = S.objects.length - 1; i >= 0; i--) {
      const obj = S.objects[i];
      if (!isObjectSelectableInField(obj)) continue;
      const p   = unrotateForHit(obj, wp.x, wp.y);
      if (!hitTest(obj, p.x, p.y)) continue;
      S.selectedIds = [obj.id];
      updateSelPanel(obj);

      if (obj.type === 'georef_image') {
        if (obj._planOverlay) openPlanOverlayPanel(obj.layerId);
        else if (!fieldOff('georef')) reopenGeorefForObj(obj);
      } else if (obj.type === 'text') {
        openTextEditor(obj);
      } else {
        openObjEditor(obj);
      }
      scheduleRender();
      return;
    }
  }
}

function onWheel(e) {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  RenderCoordinator.beginInteraction(e.shiftKey ? 'pan' : 'zoom');
  // Zoom with wheel (no ctrl needed), pan with shift+wheel
  if (e.shiftKey) {
    S.tx -= e.deltaX || e.deltaY; S.ty -= e.deltaX ? e.deltaY : 0;
  } else {
    const f  = e.deltaY > 0 ? 0.88 : 1.12;
    const ns = Math.min(Math.max(S.scale*f, 0.0002), 30); // 0.0002 = see all Turkey
    const cx = e.clientX-r.left, cy = e.clientY-r.top;
    S.tx = cx-(cx-S.tx)*(ns/S.scale); S.ty = cy-(cy-S.ty)*(ns/S.scale);
    S.scale = ns;
    _basemapZoomState = { z: -1, ideal: -1 };
  }
  scheduleRender();
}

// ─────────────────────────────────────────────────────────────
// HISTORY
// ─────────────────────────────────────────────────────────────
function pushHistory() {
  S.history = S.history.slice(0, S.histIdx+1);
  S.history.push(JSON.parse(JSON.stringify(S.objects)));
  if (S.history.length > 60) S.history.shift(); else S.histIdx++;
  updateHistBtns();
  buildLayerPanel();
  buildFieldNotesList();
  scheduleProjectSave();
}
function undo() {
  if (S.histIdx <= 0) return;
  S.histIdx--;
  S.objects = JSON.parse(JSON.stringify(S.history[S.histIdx]));
  S.selectedIds = []; updateHistBtns(); buildFieldNotesList(); scheduleProjectSave(); scheduleRender();
}
function redo() {
  if (S.histIdx >= S.history.length-1) return;
  S.histIdx++;
  S.objects = JSON.parse(JSON.stringify(S.history[S.histIdx]));
  updateHistBtns(); buildFieldNotesList(); scheduleProjectSave(); scheduleRender();
}
function updateHistBtns() {
  document.getElementById('btn-undo').disabled = S.histIdx <= 0;
  document.getElementById('btn-redo').disabled = S.histIdx >= S.history.length-1;
}

// ─────────────────────────────────────────────────────────────
// TOOL ACTIONS
// ─────────────────────────────────────────────────────────────
function getCursor() {
  if (S.panning)  return 'grabbing';
  if (S.dragging) return 'grabbing';
  return { select:'default', info:'default', text:'text', eraser:'cell' }[S.tool] || 'crosshair';
}

const TOOL_LABELS = {
  select:'Seç / Taşı', point:'Nokta / İşaret', freedraw:'Eskiz Kalemi', line:'Çizgi',
  arrow:'Ok', polygon:'Poligon', circle:'Daire', zone:'Dikdörtgen',
  text:'Metin', eraser:'Silgi',
  polyline:'Polyline — Kırık Çizgi', spline:'Spline — Düzgün Eğri',
  analysis:'Analiz Zonu', symbol:'Sembol Yerleştir', 'field-note': 'Saha notu',
};
const FIELD_PANEL_TOOLS = {
  select: 'Seçme aracı', info: 'Bilgi aracı', polyline: 'Ölçüm', polygon: 'Poligon',
  circle: 'Eğim analizi', text: 'Metin', eraser: 'Silgi', freedraw: 'Serbest çizim', 'field-note': 'Saha notu',
};

function updateActiveToolPanelLabels(tool) {
  const panelLabel = FIELD_MODE
    ? (FIELD_PANEL_TOOL_KEYS[tool] ? t(FIELD_PANEL_TOOL_KEYS[tool]) : (FIELD_PANEL_TOOLS[tool] || TOOL_LABELS[tool] || tool))
    : (TOOL_LABELS[tool] || tool);
  const topEl = document.getElementById('field-top-tool-label');
  const sideEl = document.getElementById('field-panel-active-tool');
  if (topEl) topEl.textContent = panelLabel;
  if (sideEl) sideEl.textContent = panelLabel;
}

function setTool(tool) {
  if (FIELD_MODE && tool !== 'info' && _fieldInfoObjId) hideFeatureInfoPanel();
  if (FIELD_MODE) {
    const allowed = new Set(['select','info','polyline','polygon','circle','text','eraser','freedraw','field-note']);
    if (!allowed.has(tool)) {
      showHint(t('tool.closed'));
      return;
    }
  }
  if (S.polyActive) cancelPolygon();
  if (S.plSession)  cancelPlSession();
  if (FIELD_MODE && FIELD_DRAW_PANEL_TOOLS.has(tool)) {
    S.selectedIds = [];
    setDeleteButtonVisible(false);
  }
  if (FIELD_MODE && (tool === 'polygon' || tool === 'polyline')) {
    ensureFieldSketchLayerActive();
  }
  S.tool = tool;
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  document.getElementById('btn-field-note-tool')?.classList.toggle('active', tool === 'field-note');
  document.getElementById('btn-field-info-tool')?.classList.toggle('active', tool === 'info');
  canvas.style.cursor = getCursor();
  updateFieldDrawFab();
  updateActiveToolPanelLabels(tool);
  document.getElementById('freedraw-panel').style.display = tool==='freedraw'?'block':'none';
  const hints = {
    point:    'Tıkla — saha işareti / not noktası',
    freedraw: 'Sürükle çiz — bırak bitir',
    line:     'Sürükle çizgi çiz',
    arrow:    'Sürükle ok çiz',
    zone:     'Sürükle dikdörtgen çiz',
    circle:   'Merkeze tıkla, yarıçap sürükle',
    polygon:  'Köşelere tıkla · Enter / Çift tıkla — bitir · ESC iptal',
    polyline: 'Polyline: Köşelere tıkla · Enter / Çift tıkla — bitir · ESC iptal  [W]',
    spline:   'Spline: Noktalara tıkla (eğri noktalardan geçer) · Enter / Çift tıkla — bitir  [K]',
    analysis: 'Merkeze tıkla, etki alanı yarıçapı sürükle',
    text:     'Tıkla metin yerleştir · Çift tıkla düzenle',
    select:   'Tıkla seç · Sürükle taşı · Çift tıkla düzenle',
    eraser:   'Sürükle sil',
    'field-note': 'Haritada konuma dokun — raptiye ile saha notu',
  };
  if (FIELD_MODE) {
    if (tool === 'circle') {
      showHint(t('hint.circle'));
      updateFieldAnalysisActions(null);
    } else {
      const hk = FIELD_HINT_KEYS[tool];
      if (hk) showHint(t(hk));
    }
  } else if (tool === 'select' || tool === 'field-note') {
    showHint(hints[tool] || '');
  }
  if (FIELD_MODE) {
    if (tool === 'select' && S.selectedIds[0]) {
      updateFieldRightPanel(S.objects.find(o => o.id === S.selectedIds[0]));
    } else {
      updateFieldPanelForTool(tool);
      if (tool === 'select') updateFieldRightPanel(null);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// TEXT EDITOR
// ─────────────────────────────────────────────────────────────
const SKETCH_FONTS = [
  { name:'Caveat',              label:'Caveat — El yazısı' },
  { name:'Permanent Marker',    label:'Permanent Marker — Kalemkâr' },
  { name:'Architects Daughter', label:'Architects Daughter — Teknik' },
  { name:'Patrick Hand',        label:'Patrick Hand — Baskı el' },
  { name:'Kalam',               label:'Kalam — Doğal' },
  { name:'Comic Neue',          label:'Comic Neue — Rahat' },
  { name:'Josefin Sans',        label:'Josefin Sans — Modern' },
  { name:'Inter',               label:'Inter — Profesyonel' },
  { name:'JetBrains Mono',      label:'JetBrains Mono — Teknik mono' },
];

function buildFontSelect() {
  const sel = document.getElementById('te-font');
  sel.innerHTML = '';
  SKETCH_FONTS.forEach(f => {
    const opt = document.createElement('option');
    opt.value = f.name;
    opt.textContent = f.label;
    opt.style.fontFamily = f.name;
    sel.appendChild(opt);
  });
}

function openTextEditor(obj) {
  S.editingTextId = obj.id;
  const te = document.getElementById('text-editor');

  // Fill controls
  document.getElementById('te-input').value          = obj.text || '';
  document.getElementById('te-size').value           = obj.fontSize || 16;
  document.getElementById('te-color').value          = obj.color.startsWith('#') ? obj.color : '#1a1a2e';
  document.getElementById('te-bold').checked         = !!obj.bold;
  document.getElementById('te-bg').checked           = !!obj.hasBg;
  document.getElementById('te-font').value           = obj.fontFamily || 'Caveat';
  document.getElementById('te-input').style.fontFamily = obj.fontFamily || 'Caveat';
  document.getElementById('te-input').style.fontSize   = (obj.fontSize || 16) + 'px';

  // Position editor near the text object
  const sc = worldToScreen(obj.x, obj.y);
  const teW = 320, teH = 170;
  let left = sc.x;
  let top  = sc.y + 24 * S.scale;
  // Keep within viewport
  const vw = window.innerWidth, vh = window.innerHeight;
  if (left + teW > vw - 20)   left = vw - teW - 20;
  if (top  + teH > vh - 20)   top  = sc.y - teH - 8;
  if (left < 70)               left = 70;
  if (top  < 40)               top  = 40;

  te.style.left    = left + 'px';
  te.style.top     = top  + 'px';
  te.style.display = 'flex';
  setTimeout(() => document.getElementById('te-input').focus(), 30);
}

function closeTextEditor(save) {
  const te = document.getElementById('text-editor');
  te.style.display = 'none';
  if (save && S.editingTextId) {
    const obj = S.objects.find(o => o.id === S.editingTextId);
    if (obj) {
      obj.text       = document.getElementById('te-input').value || '…';
      obj.fontSize   = +document.getElementById('te-size').value || 16;
      obj.color      = document.getElementById('te-color').value;
      obj.bold       = document.getElementById('te-bold').checked;
      obj.hasBg      = document.getElementById('te-bg').checked;
      obj.fontFamily = document.getElementById('te-font').value;
      pushHistory();
      scheduleRender();
    }
  }
  S.editingTextId = null;
}

function onTeUpdate() {
  // Live preview while editor is open
  if (!S.editingTextId) return;
  const obj = S.objects.find(o => o.id === S.editingTextId);
  if (!obj) return;
  obj.text       = document.getElementById('te-input').value || '…';
  obj.fontSize   = +document.getElementById('te-size').value || 16;
  obj.color      = document.getElementById('te-color').value;
  obj.bold       = document.getElementById('te-bold').checked;
  obj.hasBg      = document.getElementById('te-bg').checked;
  obj.fontFamily = document.getElementById('te-font').value;
  // Update textarea preview font
  document.getElementById('te-input').style.fontFamily = obj.fontFamily;
  document.getElementById('te-input').style.fontSize   = Math.min(obj.fontSize, 24) + 'px';
  scheduleRender();
}

function onTeKey(e) {
  if (e.key === 'Escape') { closeTextEditor(false); return; }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); closeTextEditor(true); return; }
  // Live update while typing
  setTimeout(onTeUpdate, 0);
}

// Draggable text editor header
(function() {
  let dragging = false, ox = 0, oy = 0;
  document.getElementById('text-editor-header').addEventListener('mousedown', e => {
    dragging = true;
    const te = document.getElementById('text-editor');
    ox = e.clientX - te.offsetLeft;
    oy = e.clientY - te.offsetTop;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!dragging) return;
    const te = document.getElementById('text-editor');
    te.style.left = (e.clientX - ox) + 'px';
    te.style.top  = (e.clientY - oy) + 'px';
  });
  document.addEventListener('mouseup', () => dragging = false);
})();

function toggleGrid() {
  S.showGrid = !S.showGrid;
  document.getElementById('btn-grid').classList.toggle('active', S.showGrid);
  document.getElementById('stat-grid').textContent = S.showGrid ? `· GRID ${S.gridSizeCm}cm` : '';
  scheduleRender();
}
function toggleSnap() {
  S.snapGrid = !S.snapGrid;
  const btn = document.getElementById('btn-snap');
  btn.classList.toggle('active', S.snapGrid);
  const gridM = formatLength(pxToMeters(S.gridSize));
  showHint(S.snapGrid ? `🧲 Snap AKTİF — ${S.gridSizeCm}cm (${gridM}) ızgara noktasına yapışıyor` : 'Snap kapatıldı');
  scheduleRender();
}
function resetView()    { S.tx=0;S.ty=0;S.scale=1;scheduleRender(); }
async function deleteSelected() {
  if (!S.selectedIds.length) return;
  const photos = S.selectedIds.filter(id => S.objects.find(o => o.id === id)?.type === 'field_photo');
  if (photos.length === 1) {
    await deleteFieldPhotoById(photos[0]);
    setDeleteButtonVisible(false);
    return;
  }
  if (photos.length > 1) {
    for (const id of photos) await deleteFieldPhotoById(id);
    setDeleteButtonVisible(false);
    return;
  }
  S.objects = S.objects.filter(o => !S.selectedIds.includes(o.id));
  S.selectedIds = [];
  renumberFieldPoints();
  setDeleteButtonVisible(false);
  updateFieldRightPanel(null);
  pushHistory();
  scheduleRender();
}
function clearAll() {
  if (!confirm('Tüm çizimler silinsin mi?')) return;
  S.objects=[]; S.selectedIds=[]; S.history=[[]]; S.histIdx=0;
  updateHistBtns(); buildFieldNotesList(); scheduleProjectSave(); scheduleRender();
}
function setStrokeWidth(v) { S.strokeWidth=+v; document.getElementById('sw-val').textContent=v; }
function setOpacity(v)     { S.opacity=+v;     document.getElementById('op-val').textContent=Math.round(v*100); }
function setTension(v)     { S.tension=+v;     document.getElementById('tens-val').textContent=Math.round(v*100); }
function showHint(msg, ms) {
  const el = document.getElementById('hint');
  if (!msg) { el.style.display='none'; return; }
  el.textContent=msg; el.style.display='block';
  clearTimeout(el._t); el._t=setTimeout(()=>el.style.display='none', ms || 2500);
}

// ─────────────────────────────────────────────────────────────
// COLLAPSIBLE SECTIONS
// ─────────────────────────────────────────────────────────────
function toggleSec(id) {
  const body   = document.getElementById(id);
  const arrow  = document.getElementById(id + '-arrow');
  const isOpen = body.style.maxHeight !== '0px' && body.style.maxHeight !== '';
  body.style.maxHeight  = isOpen ? '0px' : '1000px';
  if (arrow) arrow.classList.toggle('open', !isOpen);
}

// ─────────────────────────────────────────────────────────────
// KEYBOARD
// ─────────────────────────────────────────────────────────────
window.addEventListener('keydown', e => {
  if (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
  // Layout Escape
  if (!fieldOff('layout') && e.key === 'Escape' && LAYOUT.mode !== 'off') { cancelLayoutDraw(); return; }
  const k = e.key.toLowerCase();
  if ((e.ctrlKey||e.metaKey) && k==='z') { e.preventDefault(); undo(); return; }
  if ((e.ctrlKey||e.metaKey) && (k==='y'||(k==='z'&&e.shiftKey))) { e.preventDefault(); redo(); return; }
  const map = { v:'select',m:'point',p:'freedraw',l:'line',a:'arrow',o:'polygon',c:'circle',z:'zone',t:'text',e:'eraser',w:'polyline',k:'spline',n:'analysis' };
  if (map[k]) {
    if (FIELD_MODE && (k === 'm' || k === 'l')) return;
    if (FIELD_MODE && map[k]==='freedraw' && fieldOff('planningCategories')) return;
    if (FIELD_MODE && (map[k]==='analysis'||map[k]==='spline') && fieldOff('planningCategories')) return;
    setTool(map[k]);
    return;
  }
  if (k==='g') { toggleGrid(); return; }
  if (k==='enter') {
    if (S.polyActive) finishPolygon();
    if (S.plSession)  finishPlSession();
    return;
  }
  if (k==='escape') {
    if (S.polyActive) {
      if (S.polyPts.length >= 6) finishPolygon();
      else cancelPolygon();
    } else if (S.plSession) {
      if (S.plVerts.length >= 2) finishPlSession();
      else cancelPlSession();
    } else { S.selectedIds=[]; setDeleteButtonVisible(false); scheduleRender(); updateFieldPanelForTool(S.tool); }
    return;
  }
  if (k==='delete'||k==='backspace') { e.preventDefault(); deleteSelected(); }
});

// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// SYMBOL LIBRARY — Urban Planning & Smart City Symbols
// Each symbol is a draw function: (ctx, x, y, size, color)
// ─────────────────────────────────────────────────────────────
const SYMBOL_CATS = {
  'Planlama': [
    { id:'node',      label:'Aktivite Nodu',    draw:(c,x,y,s,col)=>{c.save();c.strokeStyle=col;c.fillStyle=col+'44';c.lineWidth=2;c.beginPath();c.arc(x,y,s*.5,0,Math.PI*2);c.fill();c.stroke();c.beginPath();c.arc(x,y,s*.22,0,Math.PI*2);c.fillStyle=col;c.fill();c.restore();} },
    { id:'cluster',   label:'Küme/Merkez',      draw:(c,x,y,s,col)=>{c.save();c.strokeStyle=col;c.lineWidth=1.5;for(let i=0;i<5;i++){const a=i*Math.PI*2/5-Math.PI/2;const r=i===0?s*.52:s*.3;c.beginPath();c.arc(x+Math.cos(a)*s*.25,y+Math.sin(a)*s*.25,r*.55,0,Math.PI*2);c.fillStyle=col+(i===0?'99':'33');c.fill();c.stroke();}c.restore();} },
    { id:'landmark',  label:'Referans Nokta',   draw:(c,x,y,s,col)=>{c.save();c.strokeStyle=col;c.fillStyle=col+'55';c.lineWidth=2;c.beginPath();c.moveTo(x,y-s*.55);c.lineTo(x+s*.3,y-s*.15);c.lineTo(x+s*.3,y+s*.3);c.lineTo(x-s*.3,y+s*.3);c.lineTo(x-s*.3,y-s*.15);c.closePath();c.fill();c.stroke();c.fillStyle=col;c.beginPath();c.arc(x,y-s*.52,s*.1,0,Math.PI*2);c.fill();c.restore();} },
    { id:'park',      label:'Yeşil Alan/Park',  draw:(c,x,y,s,col)=>{c.save();c.fillStyle=col;c.lineWidth=1.5;const draw=(cx,cy,r)=>{c.beginPath();c.arc(cx,cy,r,Math.PI,0);c.closePath();c.fill();};draw(x-s*.2,y,s*.28);draw(x+s*.2,y,s*.28);draw(x,y-s*.12,s*.3);c.fillStyle=col+'aa';c.beginPath();c.rect(x-s*.08,y,s*.16,s*.35);c.fill();c.restore();} },
    { id:'water',     label:'Su Kütlesi',       draw:(c,x,y,s,col)=>{c.save();c.fillStyle=col+'55';c.strokeStyle=col;c.lineWidth=1.5;c.beginPath();c.ellipse(x,y,s*.5,s*.32,0,0,Math.PI*2);c.fill();c.stroke();c.strokeStyle=col+'99';c.lineWidth=1;for(let i=-1;i<=1;i++){c.beginPath();c.moveTo(x-s*.3,y+i*s*.1);c.quadraticCurveTo(x,y+i*s*.1-s*.08,x+s*.3,y+i*s*.1);c.stroke();}c.restore();} },
    { id:'housing',   label:'Konut Bölgesi',    draw:(c,x,y,s,col)=>{c.save();c.strokeStyle=col;c.fillStyle=col+'33';c.lineWidth=1.5;const draw=(cx,cy,w,h)=>{c.beginPath();c.rect(cx-w/2,cy,w,h);c.fill();c.stroke();c.beginPath();c.moveTo(cx-w/2-2,cy);c.lineTo(cx,cy-h*.6);c.lineTo(cx+w/2+2,cy);c.stroke();};draw(x-s*.2,y-s*.1,s*.25,s*.4);draw(x+s*.2,y-s*.15,s*.3,s*.45);c.restore();} },
    { id:'mixed',     label:'Karma Kullanım',   draw:(c,x,y,s,col)=>{c.save();c.strokeStyle=col;c.lineWidth=1.5;const cols=[col+'33',col+'66',col+'99'];[0,1,2].forEach(i=>{c.fillStyle=cols[i];c.beginPath();c.rect(x-s*.4+i*s*.27,y-s*.15+i*s*.12,s*.25,s*.4-i*s*.12);c.fill();c.stroke();});c.restore();} },
    { id:'industrial',label:'Sanayi Bölgesi',   draw:(c,x,y,s,col)=>{c.save();c.strokeStyle=col;c.fillStyle=col+'33';c.lineWidth=1.5;c.beginPath();c.rect(x-s*.45,y-s*.2,s*.9,s*.45);c.fill();c.stroke();c.fillStyle=col;[-.25,0,.25].forEach(ox=>{c.beginPath();c.rect(x+ox*s-s*.06,y-s*.45,s*.12,s*.28);c.fill();});c.restore();} },
  ],
  'Sirkülasyon': [
    { id:'road_int',  label:'Kavşak',           draw:(c,x,y,s,col)=>{c.save();c.strokeStyle=col;c.lineWidth=s*.14;c.lineCap='round';[[0,-s*.5,0,s*.5],[-s*.5,0,s*.5,0]].forEach(([ax,ay,bx,by])=>{c.beginPath();c.moveTo(x+ax,y+ay);c.lineTo(x+bx,y+by);c.stroke();});c.strokeStyle='#fff';c.lineWidth=s*.06;c.setLineDash([s*.06,s*.07]);[[0,-s*.4,0,s*.4],[-s*.4,0,s*.4,0]].forEach(([ax,ay,bx,by])=>{c.beginPath();c.moveTo(x+ax,y+ay);c.lineTo(x+bx,y+by);c.stroke();});c.setLineDash([]);c.restore();} },
    { id:'roundabout',label:'Dönel Kavşak',     draw:(c,x,y,s,col)=>{c.save();c.strokeStyle=col;c.lineWidth=s*.14;c.beginPath();c.arc(x,y,s*.28,0,Math.PI*2);c.stroke();c.lineWidth=s*.07;[[0,-s*.5],[s*.5,0],[0,s*.5],[-s*.5,0]].forEach(([ox,oy])=>{c.beginPath();c.moveTo(x+ox*.56,y+oy*.56);c.lineTo(x+ox,y+oy);c.stroke();});c.restore();} },
    { id:'transit',   label:'Toplu Taşıma',     draw:(c,x,y,s,col)=>{c.save();c.strokeStyle=col;c.fillStyle=col+'33';c.lineWidth=1.8;c.beginPath();c.roundRect?c.roundRect(x-s*.38,y-s*.3,s*.76,s*.55,s*.08):c.rect(x-s*.38,y-s*.3,s*.76,s*.55);c.fill();c.stroke();c.fillStyle=col;c.font=`bold ${s*.28}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText('T',x,y+s*.06);c.restore();} },
    { id:'cycling',   label:'Bisiklet Yolu',    draw:(c,x,y,s,col)=>{c.save();c.strokeStyle=col;c.lineWidth=2;c.setLineDash([s*.12,s*.1]);c.beginPath();c.moveTo(x-s*.45,y);c.lineTo(x+s*.45,y);c.stroke();c.setLineDash([]);c.fillStyle=col;c.beginPath();c.arc(x-s*.2,y,s*.14,0,Math.PI*2);c.stroke();c.beginPath();c.arc(x+s*.2,y,s*.14,0,Math.PI*2);c.stroke();c.beginPath();c.moveTo(x-s*.05,y-s*.3);c.lineTo(x,y);c.lineTo(x+s*.12,y-s*.18);c.stroke();c.restore();} },
    { id:'parking',   label:'Otopark',          draw:(c,x,y,s,col)=>{c.save();c.strokeStyle=col;c.fillStyle=col+'22';c.lineWidth=1.8;c.beginPath();c.rect(x-s*.38,y-s*.38,s*.76,s*.76);c.fill();c.stroke();c.fillStyle=col;c.font=`bold ${s*.38}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText('P',x+s*.03,y+s*.02);c.restore();} },
    { id:'pedestrian2',label:'Yaya Bölgesi',   draw:(c,x,y,s,col)=>{c.save();c.strokeStyle=col;c.fillStyle=col;c.lineWidth=1.5;const head=s*.12;c.beginPath();c.arc(x,y-s*.3,head,0,Math.PI*2);c.fill();c.lineWidth=2;c.beginPath();c.moveTo(x,y-s*.18);c.lineTo(x,y+s*.1);c.moveTo(x-s*.18,y-s*.05);c.lineTo(x+s*.18,y-s*.05);c.moveTo(x,y+s*.1);c.lineTo(x-s*.14,y+s*.4);c.moveTo(x,y+s*.1);c.lineTo(x+s*.14,y+s*.4);c.stroke();c.restore();} },
  ],
  'Smart City': [
    { id:'wifi',      label:'Bağlantı / Wi-Fi', draw:(c,x,y,s,col)=>{c.save();c.strokeStyle=col;c.lineWidth=2;c.lineCap='round';[s*.5,s*.33,s*.18].forEach((r,i)=>{c.globalAlpha=1-i*.25;c.beginPath();c.arc(x,y+s*.1,r,Math.PI+Math.PI/5,-Math.PI/5);c.stroke();});c.globalAlpha=1;c.fillStyle=col;c.beginPath();c.arc(x,y+s*.1,s*.06,0,Math.PI*2);c.fill();c.restore();} },
    { id:'energy',    label:'Enerji / Güneş',   draw:(c,x,y,s,col)=>{c.save();c.strokeStyle=col;c.fillStyle=col+'44';c.lineWidth=1.8;c.beginPath();c.arc(x,y,s*.28,0,Math.PI*2);c.fill();c.stroke();c.lineWidth=1.5;for(let i=0;i<8;i++){const a=i*Math.PI/4;const r1=s*.32,r2=s*.48;c.beginPath();c.moveTo(x+Math.cos(a)*r1,y+Math.sin(a)*r1);c.lineTo(x+Math.cos(a)*r2,y+Math.sin(a)*r2);c.stroke();}c.restore();} },
    { id:'sensor',    label:'Sensör / IoT',     draw:(c,x,y,s,col)=>{c.save();c.strokeStyle=col;c.lineWidth=1.8;c.fillStyle=col+'33';c.beginPath();c.arc(x,y,s*.28,0,Math.PI*2);c.fill();c.stroke();c.lineWidth=1.2;c.setLineDash([2,2]);c.beginPath();c.arc(x,y,s*.42,0,Math.PI*2);c.stroke();c.setLineDash([]);c.fillStyle=col;c.beginPath();c.arc(x,y,s*.1,0,Math.PI*2);c.fill();c.restore();} },
    { id:'camera',    label:'Güvenlik/Kamera',  draw:(c,x,y,s,col)=>{c.save();c.strokeStyle=col;c.fillStyle=col+'44';c.lineWidth=1.8;c.beginPath();c.roundRect?c.roundRect(x-s*.32,y-s*.2,s*.45,s*.32,s*.05):c.rect(x-s*.32,y-s*.2,s*.45,s*.32);c.fill();c.stroke();c.beginPath();c.moveTo(x+s*.13,y-s*.14);c.lineTo(x+s*.42,y-s*.24);c.lineTo(x+s*.42,y+s*.08);c.lineTo(x+s*.13,y+s*.06);c.closePath();c.fill();c.stroke();c.restore();} },
    { id:'ev',        label:'Elektrikli Araç',  draw:(c,x,y,s,col)=>{c.save();c.strokeStyle=col;c.fillStyle=col+'33';c.lineWidth=1.8;c.beginPath();c.roundRect?c.roundRect(x-s*.42,y-s*.15,s*.84,s*.35,s*.09):c.rect(x-s*.42,y-s*.15,s*.84,s*.35);c.fill();c.stroke();c.fillStyle=col;c.beginPath();c.arc(x-s*.24,y+s*.2,s*.11,0,Math.PI*2);c.fill();c.beginPath();c.arc(x+s*.24,y+s*.2,s*.11,0,Math.PI*2);c.fill();c.lineWidth=2;c.beginPath();c.moveTo(x+s*.06,y-s*.3);c.lineTo(x-s*.06,y-s*.06);c.lineTo(x+s*.06,y-s*.06);c.lineTo(x-s*.06,y+s*.1);c.stroke();c.restore();} },
    { id:'data',      label:'Veri Merkezi',     draw:(c,x,y,s,col)=>{c.save();c.strokeStyle=col;c.fillStyle=col+'22';c.lineWidth=1.5;for(let i=0;i<3;i++){c.beginPath();c.rect(x-s*.35,y-s*.38+i*s*.27,s*.7,s*.2);c.fill();c.stroke();c.fillStyle=col;c.beginPath();c.arc(x+s*.24,y-s*.28+i*s*.27,s*.04,0,Math.PI*2);c.fill();c.fillStyle=col+'22';}c.restore();} },
    { id:'greenroof', label:'Yeşil Çatı/Ekoloji',draw:(c,x,y,s,col)=>{c.save();c.strokeStyle=col;c.fillStyle=col+'33';c.lineWidth=1.8;c.beginPath();c.rect(x-s*.38,y-s*.05,s*.76,s*.42);c.fill();c.stroke();c.fillStyle=col;const bushes=[[-.22,-.14,.14],[0,-.18,.16],[.22,-.12,.13]];bushes.forEach(([ox,oy,r])=>{c.beginPath();c.arc(x+ox*s,y+oy*s,r*s,0,Math.PI*2);c.fill();});c.restore();} },
    { id:'waste',     label:'Atık Yönetimi',    draw:(c,x,y,s,col)=>{c.save();c.strokeStyle=col;c.fillStyle=col+'33';c.lineWidth=1.8;c.beginPath();c.moveTo(x-s*.25,y-s*.15);c.lineTo(x-s*.32,y+s*.35);c.lineTo(x+s*.32,y+s*.35);c.lineTo(x+s*.25,y-s*.15);c.closePath();c.fill();c.stroke();c.beginPath();c.moveTo(x-s*.38,y-s*.15);c.lineTo(x+s*.38,y-s*.15);c.stroke();c.fillStyle=col;c.font=`${s*.2}px sans-serif`;c.textAlign='center';c.textBaseline='middle';c.fillText('♻',x,y+s*.12);c.restore();} },
  ],
  'Analiz': [
    { id:'influence', label:'Etki Alanı',       draw:(c,x,y,s,col)=>{c.save();const grad=c.createRadialGradient(x,y,0,x,y,s*.5);grad.addColorStop(0,col+'cc');grad.addColorStop(.5,col+'55');grad.addColorStop(1,col+'00');c.fillStyle=grad;c.beginPath();c.arc(x,y,s*.5,0,Math.PI*2);c.fill();c.strokeStyle=col;c.lineWidth=1.5;c.setLineDash([3,2]);c.beginPath();c.arc(x,y,s*.5,0,Math.PI*2);c.stroke();c.setLineDash([]);c.fillStyle=col;c.beginPath();c.arc(x,y,s*.08,0,Math.PI*2);c.fill();c.restore();} },
    { id:'noise_sym', label:'Gürültü Haritası', draw:(c,x,y,s,col)=>{c.save();c.strokeStyle=col;c.lineWidth=1.2;for(let i=3;i>=1;i--){c.globalAlpha=.15+i*.15;c.beginPath();c.arc(x,y,s*.18*i,0,Math.PI*2);c.strokeStyle=col;c.stroke();}c.globalAlpha=1;c.fillStyle=col;c.beginPath();c.arc(x,y,s*.08,0,Math.PI*2);c.fill();c.restore();} },
    { id:'visibility2',label:'Görüş Alanı',    draw:(c,x,y,s,col)=>{c.save();const grad=c.createRadialGradient(x,y,0,x,y,s*.5);grad.addColorStop(0,col+'99');grad.addColorStop(1,col+'00');c.fillStyle=grad;c.beginPath();c.moveTo(x,y);c.arc(x,y,s*.5,-Math.PI*.35,Math.PI*.35);c.closePath();c.fill();c.strokeStyle=col;c.lineWidth=1.5;c.setLineDash([3,2]);c.stroke();c.setLineDash([]);c.fillStyle=col;c.beginPath();c.arc(x,y,s*.07,0,Math.PI*2);c.fill();c.restore();} },
    { id:'density2',  label:'Yoğunluk',         draw:(c,x,y,s,col)=>{c.save();const pts=[[-.3,-.3],[.1,-.35],[.35,.1],[0,.3],[-.25,.05]];pts.forEach(([ox,oy],i)=>{c.fillStyle=col+(i<2?'44':'88');c.strokeStyle=col;c.lineWidth=1.2;const r=s*(i<2?.16:.12);c.beginPath();c.arc(x+ox*s,y+oy*s,r,0,Math.PI*2);c.fill();c.stroke();});c.restore();} },
    { id:'flow_field',label:'Akış Alanı',       draw:(c,x,y,s,col)=>{c.save();c.strokeStyle=col;c.lineWidth=1.5;c.lineCap='round';const arrows=[[-.3,-.1,.3,-.25],[-.15,.25,.3,.1],[-.25,-.3,.15,.2]];arrows.forEach(([ax,ay,bx,by])=>{const x1=x+ax*s,y1=y+ay*s,x2=x+bx*s,y2=y+by*s;c.beginPath();c.moveTo(x1,y1);c.lineTo(x2,y2);c.stroke();const ang=Math.atan2(y2-y1,x2-x1),hs=s*.12;c.beginPath();c.moveTo(x2,y2);c.lineTo(x2-hs*Math.cos(ang-.4),y2-hs*Math.sin(ang-.4));c.lineTo(x2-hs*Math.cos(ang+.4),y2-hs*Math.sin(ang+.4));c.closePath();c.fillStyle=col;c.fill();});c.restore();} },
    { id:'sun_path',  label:'Güneş Yolu',       draw:(c,x,y,s,col)=>{c.save();c.strokeStyle=col;c.lineWidth=1.8;c.setLineDash([]);c.beginPath();c.arc(x,y+s*.15,s*.42,Math.PI+.3,-Math.PI*.05);c.stroke();c.lineWidth=1.2;c.setLineDash([2,2]);c.beginPath();c.arc(x,y+s*.15,s*.42,-Math.PI*.05,-.3,true);c.stroke();c.setLineDash([]);c.fillStyle=col+'88';c.lineWidth=1.5;c.beginPath();c.arc(x,y-s*.28,s*.1,0,Math.PI*2);c.fill();c.stroke();c.restore();} },
  ],
};

// Symbol object type rendering + placement
let _symPlaceId = null;  // currently selected symbol for placement

// DATA DEFINITIONS
// ─────────────────────────────────────────────────────────────
const SWATCHES = [
  '#1a1a2e','#16213e','#0f3460','#333333',
  '#e8b84b','#ef5350','#42a5f5','#66bb6a','#ab47bc',
  '#ff7043','#26c6da','#ec407a','#78909c',
  '#FFB347','#FF7F7F','#82C341','#5DADE2','#F4D03F',
  '#76D7C4','#F0B27A','#E74C3C','#27AE60',
  '#ffffff','#f0f0f0','#cccccc','#888888',
];

const LINE_STYLES = [
  { id:'solid',      label:'Solid',          preview:'——————' },
  { id:'dashed',     label:'Dashed',         preview:'—  —  —' },
  { id:'dotted',     label:'Dotted',         preview:'· · · · ·' },
  { id:'dash-dot',   label:'Dash · Dot',     preview:'–·–·–·–' },
  { id:'long-dash',  label:'Long Dash',      preview:'———  ———' },
  { id:'boundary',   label:'Boundary',       preview:'– – – –' },
  { id:'barrier',    label:'Barrier',        preview:'|‒|‒|‒|' },
  { id:'ecological', label:'Ecological',     preview:'≋≋≋≋≋≋' },
  { id:'parallel',   label:'Parallel (═)',   preview:'══════' },
];

const ARROW_STYLES = [
  // Basic
  { id:'solid',          label:'Solid Arrow',        cat:'Basic',       icon:'→',  preview:'——→' },
  { id:'outline',        label:'Outline Arrow',       cat:'Basic',       icon:'⇒',  preview:'——⇒' },
  { id:'double',         label:'Bidirectional',       cat:'Basic',       icon:'↔',  preview:'←——→' },
  { id:'block',          label:'Block / Play',        cat:'Basic',       icon:'▶',  preview:'——▶' },
  { id:'double-chevron', label:'Double Chevron',      cat:'Basic',       icon:'»',  preview:'——»' },
  // Flow
  { id:'dashed',         label:'Dashed Flow',         cat:'Flow',        icon:'⇢',  preview:'- - →' },
  { id:'dotted',         label:'Dotted Path',         cat:'Flow',        icon:'⋯→', preview:'·····→' },
  { id:'curved',         label:'Curved Arrow',        cat:'Flow',        icon:'↷',  preview:'⌒→' },
  // Circulation
  { id:'flow',           label:'Vehicle Flow',        cat:'Circulation', icon:'▶▶', preview:'▬▬▬→' },
  { id:'pedestrian',     label:'Pedestrian Path',     cat:'Circulation', icon:'⇢',  preview:'- · →' },
  { id:'chevron',        label:'Chevron Stream',      cat:'Circulation', icon:'>>>',preview:'>>>→' },
  // Nature / Analysis
  { id:'ecology',        label:'Ecology Corridor',    cat:'Nature',      icon:'~→', preview:'≋≋→' },
  { id:'wind',           label:'Wind Direction',      cat:'Analysis',    icon:'≈→', preview:'≈≈→' },
  // Concept
  { id:'sketch',         label:'Sketch Arrow',        cat:'Concept',     icon:'↗',  preview:'↗' },
];

const CIRCLE_STYLES = [
  { id:'outline',     label:'Outline',       preview:'○',  desc:'Sadece çember' },
  { id:'filled',      label:'Filled',        preview:'●',  desc:'Dolgulu daire' },
  { id:'dashed',      label:'Dashed',        preview:'◌',  desc:'Kesikli çember' },
  { id:'dotted',      label:'Dotted',        preview:'⊙',  desc:'Noktalı çember' },
  { id:'half',        label:'Half-filled',   preview:'◑',  desc:'Yarı dolgulu' },
  { id:'concentric',  label:'Concentric',    preview:'◎',  desc:'İç içe halkalar' },
];

const CATEGORIES = [
  { id:'none',           label:'General',        color:'#555e6e', defaults:{ color:'#555e6e', arrowStyle:'solid',    lineStyle:'solid' } },
  { id:'circulation',    label:'Circulation',    color:'#ef5350', defaults:{ color:'#ef5350', arrowStyle:'flow',     lineStyle:'solid',  strokeWidth:4 } },
  { id:'zoning',         label:'Zoning',         color:'#ab47bc', defaults:{ color:'#ab47bc', arrowStyle:'solid',    lineStyle:'dashed', strokeWidth:2 } },
  { id:'infrastructure', label:'Infrastructure', color:'#42a5f5', defaults:{ color:'#42a5f5', arrowStyle:'double',   lineStyle:'solid',  strokeWidth:3 } },
  { id:'ecology',        label:'Ecology',        color:'#66bb6a', defaults:{ color:'#66bb6a', arrowStyle:'ecology',  lineStyle:'solid',  strokeWidth:3 } },
  { id:'analysis',       label:'Analysis',       color:'#ff7043', defaults:{ color:'#ff7043', arrowStyle:'wind',     lineStyle:'solid',  strokeWidth:2 } },
  { id:'annotation',     label:'Annotation',     color:'#e8b84b', defaults:{ color:'#e8b84b', arrowStyle:'solid',    lineStyle:'solid',  strokeWidth:1.5 } },
  { id:'concept',        label:'Concept',        color:'#26c6da', defaults:{ color:'#26c6da', arrowStyle:'sketch',   lineStyle:'solid',  strokeWidth:2 } },
];

const ZONE_PALETTE = {
  Residential:'#FFB347',Commercial:'#FF7F7F',Industrial:'#A569BD',
  Green:'#82C341',Water:'#5DADE2',Transport:'#F4D03F',
  Mixed:'#76D7C4',Special:'#F0B27A',Vehicular:'#E74C3C',
  Pedestrian:'#27AE60',Ecology:'#1ABC9C',Wind:'#85C1E9',
};

// ─────────────────────────────────────────────────────────────
// PANEL BUILDERS
// ─────────────────────────────────────────────────────────────
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const r = Math.round(255 * f(0)), g = Math.round(255 * f(8)), b = Math.round(255 * f(4));
  return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
}
function hexToHue(hex) {
  if (!hex || !hex.startsWith('#')) return 220;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  let hue = 0;
  const d = max - min;
  if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) hue = ((b - r) / d + 2) / 6;
  else hue = ((r - g) / d + 4) / 6;
  return Math.round(hue * 360);
}
function getFieldSelectedDrawObjects() {
  return S.selectedIds
    .map(id => S.objects.find(o => o.id === id))
    .filter(o => o && o.type !== 'field_note' && o.type !== 'field_photo');
}

function applyFieldDrawHue(hue, silent) {
  setFieldStrokeHue(hue, { silent });
}
function onFieldDrawHueInput(v) { applyFieldDrawHue(v); }
function initFieldDrawSettingsPanel() {
  applyFieldDrawHue(hexToHue(S.color), true);
  syncFieldDrawSettingsUi();
}

function buildSwatches() {
  const el = document.getElementById('swatches');
  SWATCHES.forEach(c => {
    const d = document.createElement('div');
    d.className = 'swatch' + (c===S.color?' active':'');
    d.style.background = c; d.title = c;
    d.onclick = () => { S.color=c; el.querySelectorAll('.swatch').forEach(s=>s.classList.toggle('active',s.style.background===c||s.style.backgroundColor===c)); };
    el.appendChild(d);
  });
  const inp = document.createElement('input');
  inp.type='color'; inp.value='#333333';
  inp.style.cssText='width:22px;height:22px;border:none;border-radius:5px;cursor:pointer;padding:0;flex-shrink:0;';
  inp.oninput = e => { S.color=e.target.value; };
  el.appendChild(inp);
}

function makeStyleBtn(label, preview, id, isActive, onClick) {
  const b = document.createElement('button');
  b.className    = 'style-btn' + (isActive ? ' active' : '');
  b.dataset.style = id;
  b.innerHTML    = `<span>${label}</span><span class="style-preview">${preview}</span>`;
  b.onclick      = onClick;
  return b;
}

function buildLineStyles() {
  const el = document.getElementById('line-styles');
  LINE_STYLES.forEach(ls => {
    const b = makeStyleBtn(ls.label, ls.preview, ls.id, ls.id===S.lineStyle,
      () => {
        setTool('line');
        S.lineStyle = ls.id;
        el.querySelectorAll('.style-btn').forEach(x=>x.classList.remove('active'));
        b.classList.add('active');
      }
    );
    el.appendChild(b);
  });
}

function buildLineDecos() {
  const el = document.getElementById('line-decos');
  const DECOS = [
    { id:'none',  label:'No Arrow Ends',    preview:'———' },
    { id:'end',   label:'Arrow at End →',   preview:'——→' },
    { id:'start', label:'Arrow at Start ←', preview:'←——' },
    { id:'both',  label:'Both Ends ↔',      preview:'←——→' },
  ];
  DECOS.forEach(d => {
    const b = makeStyleBtn(d.label, d.preview, d.id, d.id===S.lineDecoration, () => {
      setTool('line');
      S.lineDecoration = d.id;
      el.querySelectorAll('.style-btn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
    });
    el.appendChild(b);
  });
}

const HATCH_PATTERNS = [
  { id:'none',         label:'Tarama Yok',    preview:'□' },
  { id:'diagonal',     label:'Diyagonal //',   preview:'///' },
  { id:'cross',        label:'Çapraz ××',      preview:'×××' },
  { id:'horizontal',   label:'Yatay ═',        preview:'═══' },
  { id:'vertical',     label:'Dikey ║',        preview:'║║║' },
  { id:'dots',         label:'Nokta ∷',        preview:'∷∷∷' },
  { id:'ecology',      label:'Ekoloji ~',       preview:'≈≈≈' },
  { id:'density',      label:'Yoğunluk ▓',      preview:'▓▓▓' },
  { id:'circulation',  label:'Sirkülasyon ⇢',  preview:'⇢⇢⇢' },
  { id:'sketch',       label:'Eskiz ∿',         preview:'∿∿∿' },
  { id:'watercolor',   label:'Suluboya ☁',      preview:'☁☁☁' },
  { id:'gradient',     label:'Gradyan ◐',       preview:'◐◐◐' },
];

function buildHatchStyles() {
  const el = document.getElementById('hatch-styles');
  if (!el) return;
  el.innerHTML = '';
  HATCH_PATTERNS.forEach(h => {
    const b = makeStyleBtn(h.label, h.preview, h.id, h.id===S.hatchPattern, () => {
      S.hatchPattern = h.id;
      el.querySelectorAll('.style-btn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
    });
    el.appendChild(b);
  });
}

function buildArrowStyles() {
  const el = document.getElementById('arrow-styles');
  el.innerHTML = '';

  function drawArrowPreview(style, color) {
    const cv = document.createElement('canvas');
    cv.width = 56; cv.height = 22;
    const c2 = cv.getContext('2d');
    const x1=4,y1=13,x2=46,y2=9;
    const sw=2, ang=Math.atan2(y2-y1,x2-x1);
    const headSz=7, ex=x2-headSz*1.0*Math.cos(ang), ey=y2-headSz*1.0*Math.sin(ang);
    c2.strokeStyle=color; c2.fillStyle=color; c2.lineCap='butt'; c2.lineJoin='round';

    // Line body
    c2.lineWidth=sw;
    const dashMap={dashed:[5,2.5],dotted:[1,3]};
    if (style==='flow') {
      const seg=6.5,gap=2,half=2.6; c2.fillStyle=color;
      c2.save(); c2.translate(x1,y1); c2.rotate(ang);
      for(let d=0;d+seg<38;d+=seg+gap) c2.fillRect(d,-half,seg,half*2);
      c2.restore();
    } else if (style==='ecology') {
      c2.lineWidth=sw*1.1; c2.globalAlpha=.7;
      const freq=20,amp=2.8;
      for(const side of[-1,1]){c2.save();c2.translate(x1,y1);c2.rotate(ang);c2.beginPath();
        for(let t=0;t<=40;t+=2){const wy=Math.sin(t/freq+(side<0?Math.PI:0))*amp;if(t===0)c2.moveTo(t,side*amp*.4+wy*.6);else c2.lineTo(t,side*amp*.4+wy*.6);}
        c2.stroke();c2.restore();}
      c2.globalAlpha=1;
    } else if (style==='wind') {
      const mx=(x1+x2)/2,my=(y1+y2)/2,perp=ang+Math.PI/2,bulge=9;
      const cpx=mx+Math.cos(perp)*bulge,cpy=my+Math.sin(perp)*bulge;
      const cex=x2-headSz*1.15*Math.cos(ang),cey=y2-headSz*1.15*Math.sin(ang);
      for(const off of[-3,0,3]){const ox=Math.cos(perp)*off,oy=Math.sin(perp)*off;
        c2.save();c2.strokeStyle=color;c2.lineWidth=off===0?sw*2:sw*.9;c2.globalAlpha=off===0?.88:.35;
        c2.setLineDash(off!==0?[3,2]:[]);c2.lineCap='round';
        c2.beginPath();c2.moveTo(x1+ox,y1+oy);c2.quadraticCurveTo(cpx+ox,cpy+oy,cex+ox,cey+oy);c2.stroke();c2.restore();}
    } else if (style==='curved') {
      const mx=(x1+x2)/2,my=(y1+y2)/2,perp=ang+Math.PI/2;
      const cpx=mx+Math.cos(perp)*9,cpy=my+Math.sin(perp)*9;
      c2.beginPath();c2.moveTo(x1,y1);c2.quadraticCurveTo(cpx,cpy,ex,ey);c2.stroke();
    } else if (style==='pedestrian') {
      c2.setLineDash([4,2.5]);c2.beginPath();c2.moveTo(x1,y1);c2.lineTo(ex,ey);c2.stroke();c2.setLineDash([]);
    } else if (style==='sketch') {
      for(let i=0;i<2;i++){c2.lineWidth=sw*(i===0?1:.5);c2.beginPath();
        c2.moveTo(x1+(Math.random()-.5),y1+(Math.random()-.5));c2.lineTo(ex+(Math.random()-.5),ey+(Math.random()-.5));c2.stroke();}
    } else if (style==='double') {
      c2.beginPath();c2.moveTo(x1,y1);c2.lineTo(ex,ey);c2.stroke();
    } else {
      c2.setLineDash(dashMap[style]||[]);
      c2.beginPath();c2.moveTo(x1,y1);c2.lineTo(ex,ey);c2.stroke();c2.setLineDash([]);
    }

    // Arrowhead — always on top
    const sp=Math.PI/6;
    const lx=x2-headSz*Math.cos(ang-sp),ly=y2-headSz*Math.sin(ang-sp);
    const rx=x2-headSz*Math.cos(ang+sp),ry=y2-headSz*Math.sin(ang+sp);
    c2.setLineDash([]); c2.fillStyle=color; c2.strokeStyle=color; c2.lineWidth=sw;
    if (style==='outline'){c2.beginPath();c2.moveTo(x2,y2);c2.lineTo(lx,ly);c2.lineTo(rx,ry);c2.closePath();c2.stroke();}
    else if (style==='pedestrian'||style==='sketch'){c2.beginPath();c2.moveTo(lx,ly);c2.lineTo(x2,y2);c2.lineTo(rx,ry);c2.stroke();}
    else if (style==='double'){c2.beginPath();c2.moveTo(x2,y2);c2.lineTo(lx,ly);c2.lineTo(rx,ry);c2.closePath();c2.fill();c2.beginPath();c2.moveTo(x1,y1);c2.lineTo(x1+headSz*Math.cos(ang-sp),y1+headSz*Math.sin(ang-sp));c2.lineTo(x1+headSz*Math.cos(ang+sp),y1+headSz*Math.sin(ang+sp));c2.closePath();c2.fill();}
    else if (style==='chevron'){const sp2=Math.PI/7;c2.beginPath();c2.moveTo(x2-headSz*.6*Math.cos(ang-sp2),y2-headSz*.6*Math.sin(ang-sp2));c2.lineTo(x2,y2);c2.lineTo(x2-headSz*.6*Math.cos(ang+sp2),y2-headSz*.6*Math.sin(ang+sp2));c2.stroke();}
    else{c2.beginPath();c2.moveTo(x2,y2);c2.lineTo(lx,ly);c2.lineTo(rx,ry);c2.closePath();c2.fill();}
    return cv;
  }

  const cats = {};
  ARROW_STYLES.forEach(a => (cats[a.cat]=cats[a.cat]||[]).push(a));
  Object.entries(cats).forEach(([cat, styles]) => {
    const h = document.createElement('div');
    h.className = 'sym-cat-label'; h.textContent = cat; el.appendChild(h);
    const grid = document.createElement('div'); grid.className='arrow-grid'; el.appendChild(grid);
    styles.forEach(a => {
      const btn = document.createElement('div');
      btn.className='arrow-grid-btn'+(a.id===S.arrowStyle?' active':'');
      btn.dataset.style=a.id;
      btn.appendChild(drawArrowPreview(a.id,'#1e2d3d'));
      const info=document.createElement('div'); info.className='arrow-btn-info';
      info.innerHTML=`<span class="arrow-btn-name">${a.label}</span><span class="arrow-btn-cat">${a.cat}</span>`;
      btn.appendChild(info);
      btn.onclick=()=>{setTool('arrow');S.arrowStyle=a.id;el.querySelectorAll('.arrow-grid-btn').forEach(b=>b.classList.toggle('active',b.dataset.style===a.id));};
      grid.appendChild(btn);
    });
  });
}

function buildCircleStyles() {
  const el = document.getElementById('circle-styles');
  CIRCLE_STYLES.forEach(cs => {
    const b = makeStyleBtn(`${cs.label} ${cs.preview}`, cs.desc, cs.id, cs.id===S.circleStyle, () => {
      setTool('circle');           // ← auto-activate circle tool
      S.circleStyle = cs.id;
      el.querySelectorAll('.style-btn').forEach(x=>x.classList.remove('active'));
      b.classList.add('active');
    });
    el.appendChild(b);
  });
}

// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// SELECTED OBJECT PANEL
// ─────────────────────────────────────────────────────────────
const TYPE_LABELS = {
  import_polygon:'İçe Aktarılan Alan', import_polyline:'İçe Aktarılan Ölçüm', import_point:'İçe Aktarılan Nokta',
  import_text:'İçe Aktarılan Etiket',
  field_note:'Saha Notu', field_photo:'Fotoğraf', field_gps_track:'GPS Rotası',
  point:'Nokta', polyline:'Polyline', freedraw:'Serbest Çizim', line:'Çizgi', arrow:'Ok', bezier:'Bezier Eğrisi',
  polygon:'Poligon', zone:'Dikdörtgen', circle:'Daire',
  analysis_zone:'Analiz Zonu', text:'Metin',
};
function updateSelPanel(obj) {
  updateFieldRightPanel(obj);
  const panel = document.getElementById('sel-obj-panel');
  if (!panel) return;
  if (!obj) { panel.style.display='none'; return; }
  panel.style.display = FIELD_MODE ? 'none' : 'block';
  document.getElementById('sel-type').textContent = TYPE_LABELS[obj.type] || obj.type;
  document.getElementById('sel-meas').textContent = objMeasurement(obj) || '—';
  const sel = document.getElementById('sel-layer-sel');
  sel.innerHTML = '';
  S.layers.forEach(l => {
    const opt = document.createElement('option');
    opt.value=l.id; opt.textContent=l.name;
    if (l.id===(obj.layerId||'sketch')) opt.selected=true;
    sel.appendChild(opt);
  });
}
function changeSelectedObjLayer(layerId) {
  S.selectedIds.forEach(id => {
    const obj = S.objects.find(o=>o.id===id);
    if (obj) obj.layerId = layerId;
  });
  pushHistory(); buildLayerPanel(); scheduleRender();
}
function openObjEditorForSelected() {
  if (!S.selectedIds.length) return;
  const obj = S.objects.find(o=>o.id===S.selectedIds[0]);
  if (obj) openObjEditor(obj);
}

// ─────────────────────────────────────────────────────────────
// OBJECT PROPERTIES EDITOR
// ─────────────────────────────────────────────────────────────
let _editObjId = null;
function openObjEditor(obj) {
  _editObjId = obj.id;
  const ed = document.getElementById('obj-editor');
  document.getElementById('oe-title').textContent = (TYPE_LABELS[obj.type]||obj.type)+' Düzenle';
  document.getElementById('oe-color').value  = obj.color.startsWith('#')?obj.color:'#1a1a2e';
  document.getElementById('oe-sw').value     = obj.strokeWidth||2;
  document.getElementById('oe-op').value     = obj.opacity??1;
  document.getElementById('oe-op-val').textContent = Math.round((obj.opacity??1)*100)+'%';
  const meas = objMeasurement(obj);
  const infoRow = document.getElementById('oe-info-row');
  document.getElementById('oe-meas').textContent = meas||'';
  infoRow.style.display = meas?'flex':'none';
  // Layer
  const lsel=document.getElementById('oe-layer'); lsel.innerHTML='';
  S.layers.forEach(l=>{const o=document.createElement('option');o.value=l.id;o.textContent=l.name;if(l.id===(obj.layerId||'sketch'))o.selected=true;lsel.appendChild(o);});
  // Style
  const styleRow=document.getElementById('oe-style-row');
  const styleSel=document.getElementById('oe-style'); styleSel.innerHTML='';
  const hatchRow=document.getElementById('oe-hatch-row');
  const hatchSel=document.getElementById('oe-hatch');
  if (obj.type==='arrow') {
    styleRow.querySelector('.oe-label').textContent='Ok Stili';
    ARROW_STYLES.forEach(a=>{const o=document.createElement('option');o.value=a.id;o.textContent=a.label;if(a.id===obj.arrowStyle)o.selected=true;styleSel.appendChild(o);});
    styleRow.style.display='flex';
  } else if (obj.type==='circle') {
    styleRow.querySelector('.oe-label').textContent='Daire Stili';
    [['outline','Çember'],['filled','Dolu'],['dashed','Kesikli'],['dotted','Noktalı'],['half','Yarı'],['concentric','İç İçe']].forEach(([v,l])=>{const o=document.createElement('option');o.value=v;o.textContent=l;if(v===obj.circleStyle)o.selected=true;styleSel.appendChild(o);});
    styleRow.style.display='flex';
  } else if (obj.type==='analysis_zone') {
    styleRow.querySelector('.oe-label').textContent='Analiz';
    [['radial','Etki Alanı'],['noise','Gürültü'],['visibility','Görüş'],['heat','Isı']].forEach(([v,l])=>{const o=document.createElement('option');o.value=v;o.textContent=l;if(v===(obj.analysisStyle||'radial'))o.selected=true;styleSel.appendChild(o);});
    styleRow.style.display='flex';
  } else if (obj.type==='line'||obj.type==='bezier'||obj.type==='freedraw') {
    styleRow.querySelector('.oe-label').textContent='Çizgi Stili';
    [['solid','Düz'],['dashed','Kesikli'],['dotted','Noktalı'],['parallel','Paralel'],['ecological','Ekolojik']].forEach(([v,l])=>{const o=document.createElement('option');o.value=v;o.textContent=l;if(v===(obj.lineStyle||'solid'))o.selected=true;styleSel.appendChild(o);});
    styleRow.style.display='flex';
  } else { styleRow.style.display='none'; }
  if ((obj.type==='polygon'||obj.type==='zone') && !FIELD_MODE) {
    hatchRow.style.display='flex'; hatchSel.innerHTML='';
    HATCH_PATTERNS.forEach(h=>{const o=document.createElement('option');o.value=h.id;o.textContent=h.label;if(h.id===(obj.hatchPattern||'none'))o.selected=true;hatchSel.appendChild(o);});
  } else { hatchRow.style.display='none'; }
  document.getElementById('obj-info-bar').textContent =
    `${S.layers.find(l=>l.id===(obj.layerId||'sketch'))?.name||'?'} · ${TYPE_LABELS[obj.type]||obj.type}`;
  // Position
  const c=getBoundingCenter(obj), sc=worldToScreen(c.x,c.y);
  const r=canvas.getBoundingClientRect();
  let lx=sc.x-r.left+20, ly=sc.y-r.top-20;
  if(lx+270>CW-10) lx=CW-280; if(ly+290>CH-10) ly=ly-290;
  if(lx<70) lx=70; if(ly<38) ly=38;
  ed.style.left=lx+'px'; ed.style.top=ly+'px'; ed.style.display='flex';
}
function onOeChange() {
  if (!_editObjId) return;
  const obj = S.objects.find(o=>o.id===_editObjId); if(!obj) return;
  obj.color       = document.getElementById('oe-color').value;
  obj.strokeWidth = +document.getElementById('oe-sw').value;
  obj.opacity     = +document.getElementById('oe-op').value;
  obj.layerId     = document.getElementById('oe-layer').value;
  document.getElementById('oe-op-val').textContent = Math.round(obj.opacity*100)+'%';
  const sv = document.getElementById('oe-style').value;
  if (obj.type==='arrow') obj.arrowStyle=sv;
  else if (obj.type==='circle') obj.circleStyle=sv;
  else if (obj.type==='analysis_zone') obj.analysisStyle=sv;
  else if (obj.lineStyle!==undefined) obj.lineStyle=sv;
  if (!FIELD_MODE && (obj.type==='polygon'||obj.type==='zone')) obj.hatchPattern=document.getElementById('oe-hatch').value;
  scheduleRender();
}
function applyObjEdit() { onOeChange(); pushHistory(); buildLayerPanel(); closeObjEditor(); }
function closeObjEditor() { document.getElementById('obj-editor').style.display='none'; _editObjId=null; }

// Obj editor drag
(function(){
  let d=false,ox=0,oy=0;
  const hdr=document.getElementById('obj-editor-header');
  if(hdr){
    hdr.addEventListener('mousedown',e=>{d=true;const ed=document.getElementById('obj-editor');ox=e.clientX-ed.offsetLeft;oy=e.clientY-ed.offsetTop;e.preventDefault();});
    document.addEventListener('mousemove',e=>{if(!d)return;const ed=document.getElementById('obj-editor');ed.style.left=(e.clientX-ox)+'px';ed.style.top=(e.clientY-oy)+'px';});
    document.addEventListener('mouseup',()=>d=false);
  }
})();

// ─────────────────────────────────────────────────────────────
// LAYER SYSTEM
// ─────────────────────────────────────────────────────────────
function initLayers() {
  const defs = FIELD_MODE ? FIELD_LAYER_DEFS : LAYER_DEFS;
  S.layers = defs.map(d => ({ ...d, visible: true, locked: false }));
  S.activeLayerId = FIELD_MODE ? 'sketch' : 'sketch';
  if (FIELD_MODE) sanitizeFieldProjectLayers();
}

function ensureFieldSketchLayerActive() {
  if (!FIELD_MODE) return;
  if (S.activeLayerId !== 'sketch') setActiveLayer('sketch');
  else buildLayerPanel();
}

function setActiveLayer(id) {
  S.activeLayerId = id;
  buildLayerPanel(); // refresh UI
  // Update active badge
  const ldef = S.layers.find(l => l.id === id);
  const badge = document.getElementById('active-layer-label');
  if (badge && ldef) {
    badge.textContent = ldef.name.toUpperCase();
    badge.style.color = ldef.color;
    badge.style.borderColor = ldef.color;
  }
  scheduleRender();
}

function toggleLayerVisibility(id, e) {
  if (e) e.stopPropagation();
  const layer = S.layers.find(l => l.id === id);
  if (layer) { layer.visible = !layer.visible; buildLayerPanel(); scheduleRender(); scheduleProjectSave(); }
}

function toggleLayerLock(id, e) {
  if (e) e.stopPropagation();
  const layer = S.layers.find(l => l.id === id);
  if (layer) { layer.locked = !layer.locked; buildLayerPanel(); scheduleProjectSave(); }
}

const FIELD_CORE_LAYER_IDS = new Set(['sketch', 'points', 'notes', 'photos', 'gps', 'imported']);

function canDeleteFieldLayer(layer) {
  if (!layer) return false;
  if (!FIELD_MODE) return !FIELD_CORE_LAYER_IDS.has(layer.id);
  return !FIELD_CORE_LAYER_IDS.has(layer.id);
}

function deleteFieldLayer(id, e) {
  if (e) e.stopPropagation();
  const layer = S.layers.find(l => l.id === id);
  if (!canDeleteFieldLayer(layer)) {
    showHint(t('layer.cannotDelete'));
    return;
  }
  const cnt = S.objects.filter(o => (o.layerId || 'sketch') === id).length;
  if (isPlanOverlayLayer(layer)) {
    S.objects.filter(o => (o.layerId || '') === id && o.type === 'georef_image').forEach(o => deletePlanRasterBlob(o.id));
    if (_activePlanOverlayLayerId === id) {
      _activePlanOverlayLayerId = null;
      closePlanOverlayPanel();
    }
  }
  S.objects = S.objects.filter(o => (o.layerId || 'sketch') !== id);
  S.layers = S.layers.filter(l => l.id !== id);
  S.selectedIds = S.selectedIds.filter(sid => S.objects.some(o => o.id === sid));
  if (S.activeLayerId === id) setActiveLayer('sketch');
  else buildLayerPanel();
  pushHistory();
  scheduleRender();
  scheduleProjectSave();
  showHint(t('layer.deleted'));
}

let _activeLayerDelConfirm = null;

function dismissLayerListDeleteConfirm() {
  if (!_activeLayerDelConfirm) return;
  const { wrap, trash, item } = _activeLayerDelConfirm;
  wrap?.classList.remove('ln-del-confirming');
  item?.classList.remove('ln-del-pending');
  wrap?.querySelector('.ln-del-confirm')?.remove();
  if (trash) trash.hidden = false;
  _activeLayerDelConfirm = null;
}

function showLayerListDeleteConfirm(item, wrap, trashBtn, onDelete) {
  dismissLayerListDeleteConfirm();
  wrap.classList.add('ln-del-confirming');
  item.classList.add('ln-del-pending');
  trashBtn.hidden = true;
  const bar = document.createElement('div');
  bar.className = 'ln-del-confirm';
  bar.setAttribute('role', 'group');
  const yes = document.createElement('button');
  yes.type = 'button';
  yes.className = 'ln-del-yes';
  yes.textContent = '✓';
  yes.title = t('common.confirm');
  yes.setAttribute('aria-label', t('common.confirm'));
  yes.onclick = ev => {
    ev.stopPropagation();
    dismissLayerListDeleteConfirm();
    onDelete(ev);
  };
  const no = document.createElement('button');
  no.type = 'button';
  no.className = 'ln-del-no';
  no.textContent = '✕';
  no.title = t('common.cancel');
  no.setAttribute('aria-label', t('common.cancel'));
  no.onclick = ev => {
    ev.stopPropagation();
    dismissLayerListDeleteConfirm();
  };
  bar.append(yes, no);
  wrap.appendChild(bar);
  _activeLayerDelConfirm = { wrap, trash: trashBtn, item };
}

function appendLayerListDeleteButton(item, onDelete) {
  const wrap = document.createElement('div');
  wrap.className = 'ln-del-wrap';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ln-del lyr-btn lyr-btn-del';
  btn.title = t('layer.delete');
  btn.setAttribute('aria-label', t('layer.delete'));
  btn.textContent = '🗑';
  btn.onclick = ev => {
    ev.stopPropagation();
    if (wrap.classList.contains('ln-del-confirming')) return;
    showLayerListDeleteConfirm(item, wrap, btn, onDelete);
  };
  wrap.appendChild(btn);
  item.appendChild(wrap);
}

if (!window._layerDelConfirmClickBound) {
  window._layerDelConfirmClickBound = true;
  document.addEventListener('click', ev => {
    if (_activeLayerDelConfirm && !ev.target.closest('.ln-del-wrap.ln-del-confirming')) {
      dismissLayerListDeleteConfirm();
    }
  }, true);
}

function deleteFieldPointById(objId, ev) {
  if (ev) ev.stopPropagation();
  const obj = S.objects.find(o => o.id === objId);
  if (!obj || obj.type !== 'point') return;
  S.objects = S.objects.filter(o => o.id !== objId);
  S.selectedIds = S.selectedIds.filter(id => id !== objId);
  renumberFieldPoints();
  pushHistory();
  buildLayerPanel();
  updateFieldRightPanel(null);
  setDeleteButtonVisible(false);
  scheduleProjectSave();
  scheduleRender();
  showHint(t('point.deleted'));
}

function deleteFieldNoteFromLayer(objId, ev) {
  if (ev) ev.stopPropagation();
  deleteFieldNoteById(objId);
}

function deleteFieldPhotoFromLayer(objId, ev) {
  if (ev) ev.stopPropagation();
  deleteFieldPhotoById(objId);
}

function deleteImportLayerFromPanel(layerId, ev) {
  if (ev) ev.stopPropagation();
  deleteFieldLayer(layerId, ev);
}

function fieldSketchPanelLabel(obj) {
  const base = FIELD_MODE ? fieldObjectTypeLabel(obj) : ((TYPE_LABELS || {})[obj.type] || obj.type);
  const m = objMeasurement(obj);
  return m ? base + ' · ' + m : base;
}

function getFieldSketchObjectsForPanel() {
  return S.objects.filter(o => {
    if (!o || o._import || o._planOverlay) return false;
    if (['field_photo', 'field_note', 'field_gps_track', 'georef_image'].includes(o.type)) return false;
    return (o.layerId || 'sketch') === 'sketch';
  });
}

function deleteFieldSketchObjectById(objId, ev) {
  if (ev) ev.stopPropagation();
  const obj = S.objects.find(o => o.id === objId);
  if (!obj || (obj.layerId || 'sketch') !== 'sketch' || obj._import) return;
  S.objects = S.objects.filter(o => o.id !== objId);
  S.selectedIds = S.selectedIds.filter(id => id !== objId);
  if (_fieldCtxPhotoId === objId) _fieldCtxPhotoId = null;
  if (_notePopupId === objId) closeNotePopup();
  if (_editingNoteId === objId) cancelFieldNoteEditor(true);
  pushHistory();
  buildLayerPanel();
  updateFieldRightPanel(null);
  setDeleteButtonVisible(false);
  scheduleProjectSave();
  scheduleRender();
  showHint(t('obj.deleted'));
}

function isObjectSelectableInField(obj) {
  if (!FIELD_MODE || !obj) return true;
  if (obj._planOverlay) return false;
  if (obj.type === 'georef_image' && isPlanOverlayLayer(obj.layerId)) return false;
  const layer = S.layers.find(l => l.id === (obj.layerId || 'sketch'));
  if (layer && isPlanOverlayLayer(layer)) return false;
  return true;
}

const _layerPanelExpanded = new Set();

function fieldLayerSublistCount(layerId) {
  if (!FIELD_MODE) return 0;
  if (layerId === 'sketch') return getFieldSketchObjectsForPanel().length;
  if (layerId === 'notes') return getFieldNotesSorted().length;
  if (layerId === FIELD_PHOTOS_LAYER) return getFieldPhotosSorted().length;
  if (layerId === FIELD_GPS_LAYER) return getFieldGpsTracksSorted().length;
  if (layerId === 'imported') return getFieldImportPanelEntries().length;
  return 0;
}

function fieldLayerHasSublist(layerId) {
  if (layerId === 'imported') return false;
  return fieldLayerSublistCount(layerId) > 0;
}

function isLayerPanelExpanded(layerId) {
  return _layerPanelExpanded.has(layerId);
}

function toggleLayerPanelExpand(layerId) {
  if (_layerPanelExpanded.has(layerId)) _layerPanelExpanded.delete(layerId);
  else _layerPanelExpanded.add(layerId);
}

function ensureLayerPanelExpandedForSelection() {
  if (!FIELD_MODE || !S.selectedIds.length) return;
  const obj = S.objects.find(o => o.id === S.selectedIds[0]);
  if (!obj) return;
  if (obj.type === 'point') _layerPanelExpanded.add('sketch');
  else if (obj.type === 'field_note') _layerPanelExpanded.add('notes');
  else if (obj.type === 'field_photo') _layerPanelExpanded.add(FIELD_PHOTOS_LAYER);
  else if (obj.type === 'field_gps_track') _layerPanelExpanded.add(FIELD_GPS_LAYER);
  else if (obj._import) {
    _layerPanelExpanded.add('imported');
    if (obj._planOverlay && obj.layerId) openPlanOverlayPanel(obj.layerId);
  }
  else if ((obj.layerId || 'sketch') === 'sketch' && !obj._import && !obj._planOverlay) _layerPanelExpanded.add('sketch');
}

function buildLayerPanel() {
  const el = document.getElementById('layer-panel');
  if (!el) return;
  dismissLayerListDeleteConfirm();
  if (FIELD_MODE) ensureLayerPanelExpandedForSelection();
  el.innerHTML = '';

  if (FIELD_MODE) ensureImportLayerNumbers();
  const sorted = [...S.layers].sort((a, b) => (a.order || 0) - (b.order || 0));
  let dxfHdr = false, gmlHdr = false, overlayHdr = false;
  sorted.forEach(layer => {
    if (FIELD_MODE && isFieldImportChildLayer(layer)) return;
    if (isPlanOverlayLayer(layer) && !overlayHdr) {
      const hdr = document.createElement('div');
      hdr.className = 'layer-group-label';
      hdr.textContent = t('layer.planOverlay');
      el.appendChild(hdr);
      overlayHdr = true;
    }
    if (layer._dxfGroup && !dxfHdr) {
      const hdr = document.createElement('div');
      hdr.className = 'layer-group-label';
      hdr.textContent = t('layer.dxf');
      el.appendChild(hdr);
      dxfHdr = true;
    }
    if (layer._gmlGroup && !gmlHdr) {
      const hdr = document.createElement('div');
      hdr.className = 'layer-group-label';
      hdr.textContent = t('layer.gml');
      el.appendChild(hdr);
      gmlHdr = true;
    }
    const row = document.createElement('div');
    const isPo = isPlanOverlayLayer(layer);
    const hasSublist = FIELD_MODE && fieldLayerHasSublist(layer.id);
    const subExpanded = hasSublist && isLayerPanelExpanded(layer.id);
    row.className = 'layer-row' + (layer.id === S.activeLayerId ? ' active-layer' : '') + (layer.locked ? ' locked-layer' : '') +
      (hasSublist ? ' layer-row-expandable' : '') + (subExpanded ? ' layer-row-expanded' : '');
    row.onclick = ev => {
      if (ev.target.closest('.layer-actions')) return;
      if (hasSublist) {
        toggleLayerPanelExpand(layer.id);
        if (!isPo) setActiveLayer(layer.id);
        else buildLayerPanel();
        return;
      }
      if (isPo) openPlanOverlayPanel(layer.id);
      else setActiveLayer(layer.id);
    };

    // Count objects on this layer
    let cnt;
    if (FIELD_MODE && layer.id === 'notes') {
      cnt = S.objects.filter(o => o.type === 'field_note').length;
    } else if (FIELD_MODE && layer.id === FIELD_PHOTOS_LAYER) {
      cnt = S.objects.filter(o => o.type === 'field_photo').length;
    } else if (FIELD_MODE && layer.id === FIELD_GPS_LAYER) {
      cnt = getFieldGpsTracksSorted().length;
    } else if (FIELD_MODE && layer.id === 'imported') {
      cnt = getFieldImportPanelEntries().length;
    } else {
      cnt = S.objects.filter(o => (o.layerId || 'sketch') === layer.id).length;
    }

    const lockCls = layer.locked ? ' lyr-btn-locked-on' : '';
    const goBtn = isPo
      ? `<button type="button" class="lyr-btn lyr-btn-go" onclick="goToPlanOverlayLayer('${layer.id}',event)" title="${t('layer.go')}" aria-label="${t('layer.go')}">⌖</button>`
      : '';
    const delBtn = (!FIELD_MODE && canDeleteFieldLayer(layer))
      ? `<button type="button" class="lyr-btn lyr-btn-del" onclick="deleteFieldLayer('${layer.id}',event)" title="${t('layer.delete')}" aria-label="${t('layer.delete')}">🗑</button>`
      : '';
    const chevron = hasSublist
      ? `<span class="layer-chevron" aria-hidden="true">▶</span>`
      : '';
    const expandTitle = subExpanded ? t('layer.collapseList') : t('layer.expandList');
    row.title = hasSublist ? expandTitle : '';
    row.innerHTML = `
      <div class="layer-color-dot" style="background:${layer.color}"></div>
      <div style="flex:1;min-width:0;">
        <div class="layer-name-text">${chevron}${escapeHtml(layerI18nName(layer))}</div>
        <div class="layer-sub">${FIELD_MODE && layer.id === 'imported'
          ? t('layer.importSources', { n: cnt })
          : t('layer.geom', { n: cnt })}${isPo ? ' · ' + t('layer.overlay') : ''}</div>
      </div>
      <div class="layer-actions">
        ${goBtn}
        <button type="button" class="lyr-btn ${!layer.visible?'off':''}" onclick="toggleLayerVisibility('${layer.id}',event)" title="${layer.visible ? t('layer.hide') : t('layer.show')}" aria-label="${layer.visible ? t('layer.hide') : t('layer.show')}">
          ${layer.visible ? '👁' : '◌'}
        </button>
        <button type="button" class="lyr-btn${lockCls}" onclick="toggleLayerLock('${layer.id}',event)" title="${layer.locked ? t('layer.unlock') : t('layer.lock')}" aria-label="${layer.locked ? t('layer.unlock') : t('layer.lock')}">
          ${layer.locked ? '🔒' : '○'}
        </button>
        ${delBtn}
      </div>`;
    el.appendChild(row);

    if (FIELD_MODE && layer.id === 'sketch' && subExpanded) {
      const sketchObjs = getFieldSketchObjectsForPanel();
      if (sketchObjs.length) {
        const slist = document.createElement('div');
        slist.className = 'layer-sketch-list layer-notes-list';
        slist.style.borderLeftColor = '#d48f10';
        sketchObjs.forEach((o, idx) => {
          const item = document.createElement('div');
          item.className = 'layer-sketch-item layer-note-item' + (S.selectedIds.includes(o.id) ? ' active' : '');
          const preview = fieldSketchPanelLabel(o);
          item.innerHTML = '<span class="ln-num">#' + (idx + 1) + '</span><span class="ln-text">' +
            escapeHtml(preview.slice(0, 80)) + '</span>';
          item.onclick = ev => {
            if (ev.target.closest('.ln-del-wrap')) return;
            setActiveLayer('sketch');
            S.selectedIds = [o.id];
            setDeleteButtonVisible(true);
            updateSelPanel(o);
            buildLayerPanel();
            scheduleRender();
          };
          appendLayerListDeleteButton(item, ev => deleteFieldSketchObjectById(o.id, ev));
          slist.appendChild(item);
        });
        el.appendChild(slist);
      }
    }

    if (FIELD_MODE && layer.id === 'notes' && subExpanded) {
      const notes = getFieldNotesSorted();
      if (notes.length) {
        const list = document.createElement('div');
        list.className = 'layer-notes-list';
        notes.forEach(n => {
          const item = document.createElement('div');
          item.className = 'layer-note-item' + (S.selectedIds.includes(n.id) ? ' active' : '');
          const preview = getNoteText(n) || (noteHasHandwriting(n) ? 'El yazısı' : 'Not');
          item.innerHTML = '<span class="ln-num">#' + (n.noteNum || '?') + '</span><span class="ln-text">' +
            escapeHtml(preview.slice(0, 80)) + '</span>';
          item.onclick = ev => { if (ev.target.closest('.ln-del-wrap')) return; selectNoteFromLayer(n.id); };
          appendLayerListDeleteButton(item, ev => deleteFieldNoteFromLayer(n.id, ev));
          list.appendChild(item);
        });
        el.appendChild(list);
      }
    }

    if (FIELD_MODE && layer.id === FIELD_PHOTOS_LAYER && subExpanded) {
      const photos = getFieldPhotosSorted();
      if (photos.length) {
        const list = document.createElement('div');
        list.className = 'layer-photos-list';
        photos.forEach(p => {
          const item = document.createElement('div');
          item.className = 'layer-photo-item layer-note-item' + (S.selectedIds.includes(p.id) ? ' active' : '');
          const preview = (p.description || p.title || p.caption || '').trim() || t('type.field_photo');
          item.innerHTML = '<span class="ln-num">#' + (p.photoNum || '?') + '</span><span class="ln-text">' +
            escapeHtml(preview.slice(0, 80)) + (p.hasVoice ? ' 🎤' : '') + '</span>';
          item.onclick = ev => { if (ev.target.closest('.ln-del-wrap')) return; selectPhotoFromLayer(p.id); };
          appendLayerListDeleteButton(item, ev => deleteFieldPhotoFromLayer(p.id, ev));
          list.appendChild(item);
        });
        el.appendChild(list);
      }
    }

    if (FIELD_MODE && layer.id === FIELD_GPS_LAYER && subExpanded) {
      const tracks = getFieldGpsTracksSorted();
      if (tracks.length) {
        const list = document.createElement('div');
        list.className = 'layer-gps-list layer-notes-list';
        list.style.borderLeftColor = '#1565c0';
        tracks.forEach(tr => {
          const item = document.createElement('div');
          item.className = 'layer-gps-item layer-note-item' + (S.selectedIds.includes(tr.id) ? ' active' : '');
          const preview = gpsTrackPanelLabel(tr);
          item.innerHTML = '<span class="ln-num">#' + (tr.trackNum || '?') + '</span><span class="ln-text">' +
            escapeHtml(preview.slice(0, 80)) + '</span>' +
            '<button type="button" class="ln-replay-btn" title="' + (PA_LANG === 'tr' ? 'Rota oynat' : 'Play track') + '">▶</button>';
          item.querySelector('.ln-replay-btn').onclick = ev => { ev.stopPropagation(); playGpsTrackReplay(tr.id); };
          item.onclick = ev => { if (ev.target.closest('.ln-del-wrap') || ev.target.closest('.ln-replay-btn')) return; selectGpsTrackFromLayer(tr.id); };
          appendLayerListDeleteButton(item, ev => deleteFieldGpsTrackFromLayer(tr.id, ev));
          list.appendChild(item);
        });
        el.appendChild(list);
      }
    }

    if (FIELD_MODE && layer.id === 'imported') {
      const imports = getFieldImportPanelEntries();
      if (imports.length) {
        const list = document.createElement('div');
        list.className = 'layer-imports-list';
        imports.forEach((entry, idx) => {
          const imp = entry.layer;
          const item = document.createElement('div');
          const active = S.activeLayerId === imp.id;
          item.className = 'layer-import-item layer-note-item' + (active ? ' active' : '');
          const preview = (imp.name || imp.id).trim();
          const tag = entry.overlay ? ' · overlay' : '';
          item.innerHTML = '<span class="ln-num">#' + (imp.importNum || (idx + 1)) + '</span><span class="ln-text">' +
            escapeHtml(preview.slice(0, 80)) +
            '<small>' + t('layer.geom', { n: entry.geomN }) + tag + '</small></span>';
          item.onclick = ev => {
            if (ev.target.closest('.ln-del-wrap')) return;
            if (entry.overlay) openPlanOverlayPanel(imp.id);
            else selectImportLayerFromPanel(imp.id);
          };
          if (!entry.overlay) appendLayerListDeleteButton(item, ev => deleteImportLayerFromPanel(imp.id, ev));
          list.appendChild(item);
        });
        el.appendChild(list);
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────
// STYLE PRESET ENGINE
// ─────────────────────────────────────────────────────────────
function applyStylePreset(preset) {
  if (!preset) return;
  if (preset.color)        { S.color = preset.color; syncColorUI(preset.color); }
  if (preset.strokeWidth)  { S.strokeWidth = preset.strokeWidth; const sl=document.getElementById('slider-sw'),vl=document.getElementById('sw-val'); if(sl)sl.value=preset.strokeWidth; if(vl)vl.textContent=preset.strokeWidth; }
  if (preset.lineStyle)    { S.lineStyle = preset.lineStyle;   syncStyleUI('#line-styles', preset.lineStyle); }
  if (preset.arrowStyle)   { S.arrowStyle = preset.arrowStyle; syncStyleUI('#arrow-styles', preset.arrowStyle); }
  if (preset.hatchPattern) { S.hatchPattern = preset.hatchPattern; syncStyleUI('#hatch-styles', preset.hatchPattern); }
  if (preset.circleStyle)  { S.circleStyle = preset.circleStyle; }
  if (preset.tension !== undefined) S.tension = preset.tension;
  if (preset.opacity !== undefined) S.opacity = preset.opacity;
  if (preset.layerId) {
    S.activeLayerId = preset.layerId;
    setActiveLayer(preset.layerId);
  }
}

function applyCategoryDefaults(cat) {
  if (!cat) return;
  // Apply semantic style preset
  const preset = STYLE_PRESETS[cat.id] || STYLE_PRESETS.none;
  applyStylePreset(preset);
  // Activate matching tool
  const tool = CAT_TO_LAYER[cat.id] === 'analysis' ? 'analysis'
             : CAT_TOOL[cat.id] || 'select';
  setTool(tool);
  // Show/hide hatch panel
  const HATCH_CATS = new Set(['zoning','ecology','infrastructure','concept']);
  const hp = document.getElementById('hatch-panel');
  if (hp) {
    const show = HATCH_CATS.has(cat.id);
    hp.style.display = show ? 'block' : 'none';
    if (show) {
      const body = document.getElementById('sec-hatch');
      if (body && body.style.maxHeight === '0px') toggleSec('sec-hatch');
      buildHatchStyles();
    }
  }
}
function syncColorUI(c) {
  document.querySelectorAll('.swatch').forEach(s=>s.classList.toggle('active',s.style.background===c||s.style.backgroundColor===c));
}
function syncStyleUI(sel, id) {
  document.querySelectorAll(sel+' .style-btn').forEach(b=>b.classList.toggle('active',b.dataset.style===id));
}
function setCatChipActive(btn, active) {
  const color=btn.dataset.catColor||'#78909c';
  btn.style.borderColor=active?color:'rgba(255,255,255,.1)';
  btn.style.background =active?color+'28':'transparent';
  btn.style.color      =active?color:'rgba(180,205,235,.55)';
  btn.style.fontWeight =active?'600':'400';
}
function buildCategories() {
  if (fieldOff('planningCategories')) return;
  const el=document.getElementById('cat-chips'); el.innerHTML='';
  CATEGORIES.forEach(cat => {
    const b=document.createElement('button');
    b.className='cat-chip'; b.textContent=cat.label;
    b.dataset.catId=cat.id; b.dataset.catColor=cat.color;
    setCatChipActive(b, cat.id===S.planningCat);
    b.addEventListener('click',()=>{
      S.planningCat=cat.id;
      el.querySelectorAll('.cat-chip[data-cat-id]').forEach(chip=>setCatChipActive(chip,chip.dataset.catId===cat.id));
      applyCategoryDefaults(cat);
      showHint(`${cat.label} kategorisi seçildi`);
    });
    el.appendChild(b);
  });
}
function buildZonePalette() {
  if (fieldOff('zonePalette')) return;
  const el=document.getElementById('zone-palette');
  el.style.cssText='display:grid;grid-template-columns:repeat(4,1fr);gap:3px;margin-top:4px;';
  Object.entries(ZONE_PALETTE).forEach(([name,color])=>{
    const d=document.createElement('div');
    d.title=name; d.style.cssText=`height:20px;border-radius:4px;background:${color};cursor:pointer;border:2px solid transparent;opacity:.85;transition:all .1s;`;
    d.onclick=()=>{ S.color=color; };
    d.onmouseenter=()=>{ d.style.opacity='1'; d.style.transform='scale(1.04)'; };
    d.onmouseleave=()=>{ d.style.opacity='.85'; d.style.transform=''; };
    el.appendChild(d);
  });
}
function buildShortcuts() {
  const el=document.getElementById('shortcuts-list');
  [['V','Select'],['P','Pen'],['L','Line'],['A','Arrow'],
   ['O','Polygon'],['C','Circle'],['Z','Rect'],['T','Text'],['E','Eraser'],
   ['G','Grid'],['Enter','Poly bitir'],['Esc','İptal'],['Del','Sil'],['Ctrl+Z','Geri Al'],
   ['Ctrl+scroll','Zoom'],['Alt+drag','Kaydır'],
  ].forEach(([key,label])=>{
    const row=document.createElement('div');
    row.style.cssText='display:flex;justify-content:space-between;margin-bottom:4px;align-items:center;';
    row.innerHTML=`<span style="font-size:11px;color:rgba(180,205,235,.5);">${label}</span><code style="font-size:9px;background:rgba(255,255,255,.06);padding:2px 6px;border-radius:4px;color:rgba(200,220,248,.5);font-family:var(--mono);">${key}</code>`;
    el.appendChild(row);
  });
}

// ─────────────────────────────────────────────────────────────
// SYMBOL LIBRARY UI
// ─────────────────────────────────────────────────────────────
function toggleSymbolLibrary() {
  if (fieldOff('symbolLibrary')) { showHint('Sembol kütüphanesi Field modunda kapalı'); return; }
  const panel = document.getElementById('sym-picker');
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'flex';
  document.getElementById('btn-sym-lib').classList.toggle('active', !isOpen);
  if (!isOpen) buildSymbolLibrary();
}

function buildSymbolLibrary() {
  const tabBar  = document.getElementById('sym-tab-bar');
  const body    = document.getElementById('sym-picker-body');
  tabBar.innerHTML = ''; body.innerHTML = '';

  const cats = Object.keys(SYMBOL_CATS);
  let activeCat = cats[0];

  function renderCat(cat) {
    activeCat = cat;
    body.innerHTML = '';
    tabBar.querySelectorAll('.sym-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.cat === cat)
    );
    const syms = SYMBOL_CATS[cat];
    const grid = document.createElement('div');
    grid.className = 'sym-grid';

    syms.forEach(sym => {
      const btn = document.createElement('div');
      btn.className = 'sym-btn' + (_symPlaceId === sym.id ? ' active' : '');

      // Mini canvas preview
      const cv = document.createElement('canvas');
      cv.width = 44; cv.height = 44;
      const c2 = cv.getContext('2d');
      sym.draw(c2, 22, 22, 18, S.color || '#2c3e50');

      const lbl = document.createElement('div');
      lbl.className = 'sym-btn-label';
      lbl.textContent = sym.label;

      btn.appendChild(cv); btn.appendChild(lbl);
      btn.onclick = () => {
        _symPlaceId = sym.id;
        setTool('symbol');
        body.querySelectorAll('.sym-btn').forEach(b => b.classList.toggle('active', b === btn));
        showHint(`${sym.label} — Tıkla yerleştir`);
      };
      grid.appendChild(btn);
    });
    body.appendChild(grid);
  }

  // Build tabs
  cats.forEach(cat => {
    const tab = document.createElement('button');
    tab.className = 'sym-tab' + (cat === activeCat ? ' active' : '');
    tab.dataset.cat = cat;
    tab.textContent = cat;
    tab.onclick = () => renderCat(cat);
    tabBar.appendChild(tab);
  });

  renderCat(activeCat);
}

// Draggable symbol picker
(function() {
  let d=false, ox=0, oy=0;
  const hdr = document.getElementById('sym-picker-header');
  if (hdr) {
    hdr.addEventListener('mousedown', e => {
      d=true; const el=document.getElementById('sym-picker');
      ox=e.clientX-el.offsetLeft; oy=e.clientY-el.offsetTop; e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!d) return;
      const el=document.getElementById('sym-picker');
      el.style.left=(e.clientX-ox)+'px'; el.style.top=(e.clientY-oy)+'px';
    });
    document.addEventListener('mouseup', () => d=false);
  }
})();

// ═══════════════════════════════════════════════════════════════
// SMART GEOREFERENCING SYSTEM
// ═══════════════════════════════════════════════════════════════

// ── State ──
let _georef = {
  dataUrl:    null,
  imgEl:      null,
  w: 0, h: 0,
  method:     'center',
  opacity:    0.75,
  clipInset:  0.06,   // 6% border clip (removes title block/legend)
  paftaCoords: null,
};

// ── georef_image renderObj ──
function renderGeorefImage(obj) {
  if (!obj.visible) return;
  const img = obj._imgEl;
  if (!img || !img.complete) return;

  ctx.save();
  ctx.globalAlpha = obj.opacity ?? 0.75;

  // Affine transform: image pixels → world coords
  const { tl, tr, bl } = obj.corners;
  const w = obj.imgW, h = obj.imgH;
  const a = (tr.x - tl.x) / w;
  const b = (tr.y - tl.y) / w;
  const c2 = (bl.x - tl.x) / h;
  const d2 = (bl.y - tl.y) / h;
  ctx.transform(a, b, c2, d2, tl.x, tl.y);

  // Clip to inner drawing frame (remove title block/legend/margins)
  const ci = obj.clipInset || 0;
  if (ci > 0.001) {
    const cx1 = w * ci, cy1 = h * ci;
    const cx2 = w * (1 - ci), cy2 = h * (1 - ci * 2.5); // bottom legend area → clip more
    ctx.beginPath();
    ctx.rect(cx1, cy1, cx2 - cx1, cy2 - cy1);
    ctx.clip();
  }

  ctx.drawImage(img, 0, 0, w, h);
  ctx.restore();
}

// Get inner clip frame corners in world coordinates
function getGeorefClipCorners(obj) {
  const ci = obj.clipInset || 0;
  const cib = ci * 2.5; // bottom legend area → clip more
  const { tl, tr, bl } = obj.corners;
  const w = obj.imgW, h = obj.imgH;
  // Affine coefficients
  const ax = (tr.x - tl.x) / w, bx = (tr.y - tl.y) / w;
  const cx = (bl.x - tl.x) / h, dx = (bl.y - tl.y) / h;
  const imgToW = (ix, iy) => ({
    x: ax*ix + cx*iy + tl.x,
    y: bx*ix + dx*iy + tl.y
  });
  return {
    tl: imgToW(w*ci,     h*ci),
    tr: imgToW(w*(1-ci), h*ci),
    br: imgToW(w*(1-ci), h*(1-cib)),
    bl: imgToW(w*ci,     h*(1-cib)),
  };
}

function updateGeorefClip(v) {
  _georef.clipInset = v;
  document.getElementById('georef-clip-val').textContent = Math.round(v*100) + '%';
  // Update any existing georef_image objects
  S.objects.forEach(obj => {
    if (obj.type === 'georef_image') obj.clipInset = v;
  });
  scheduleRender();
}

// ── Drag-and-drop handlers ──
function initDragDrop() {
  const cv = document.getElementById('canvas-wrap');
  cv.addEventListener('dragenter', e => { e.preventDefault(); document.getElementById('drop-overlay').style.display='flex'; });
  cv.addEventListener('dragover',  e => { e.preventDefault(); });
  cv.addEventListener('dragleave', e => { if (e.relatedTarget && cv.contains(e.relatedTarget)) return; document.getElementById('drop-overlay').style.display='none'; });
  cv.addEventListener('drop', e => {
    e.preventDefault();
    document.getElementById('drop-overlay').style.display = 'none';
    const files = Array.from(e.dataTransfer.files || []);
    if (!files.length) return;
    if (fieldOff('georef')) {
      const rasters = files.filter(f => isFieldRasterOverlayExt((f.name.split('.').pop() || '').toLowerCase()));
      const vectors = files.filter(f => !rasters.includes(f));
      rasters.forEach(f => importPlanRasterFile(f));
      if (vectors.length) routeFieldImportFiles(vectors);
      else if (!rasters.length) showHint(FIELD_IMPORT_FORMATS_HINT);
      return;
    }
    const file = files[0];
    const ok = /\.(jpe?g|png|tiff?|pdf|bmp|webp)$/i.test(file.name);
    if (!ok) { showHint('Desteklenmeyen dosya türü'); return; }
    loadGeorefFile(file);
  });
}

function loadGeorefFile(file) {
  if (fieldOff('georef')) {
    showHint('Plan görseli georeferansı Field modunda kapalı — KML/KMZ/GeoJSON kullanın');
    return;
  }
  const reader = new FileReader();
  reader.onload = ev => {
    const dataUrl = ev.target.result;
    const img = new Image();
    img.onload = () => {
      _georef.dataUrl  = dataUrl;
      _georef.imgEl    = img;
      _georef.w        = img.naturalWidth;
      _georef.h        = img.naturalHeight;
      _georef.method   = 'corners';
      _georef.paftaCoords = null;
      openGeorefPanel(dataUrl, file.name);
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(file);
}

function openGeorefImport() {
  if (fieldOff('georef')) { onFieldImportClick(); return; }
  // Open file picker as alternative to drag-drop
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*,.pdf';
  inp.onchange = e => { if (e.target.files[0]) loadGeorefFile(e.target.files[0]); };
  inp.click();
}

function openGeorefPanel(dataUrl, filename) {
  const panel = document.getElementById('georef-panel');
  document.getElementById('georef-thumb').src = dataUrl;
  const cleanName = filename ? filename.replace(/\.[^.]+$/, '').slice(0,28) : '';
  document.getElementById('georef-title').textContent = cleanName || 'Georeferanslama';

  // Position + show panel
  const r = canvas.getBoundingClientRect();
  panel.style.left = (r.left + 80) + 'px';
  panel.style.top  = (r.top  + 60) + 'px';
  panel.style.display = 'flex';

  // Pre-fill corners based on current view center
  const cx = (CW/2 - S.tx) / S.scale;
  const cy = (CH/2 - S.ty) / S.scale;
  const defaultW = Math.min(500, _georef.w) / S.scale;
  const defaultH = defaultW * (_georef.h / _georef.w);
  const tl = { x: cx - defaultW/2, y: cy - defaultH/2 };
  document.getElementById('gc-tlx').value = tl.x.toFixed(1);
  document.getElementById('gc-tly').value = tl.y.toFixed(1);
  document.getElementById('gc-trx').value = (tl.x + defaultW).toFixed(1);
  document.getElementById('gc-try').value = tl.y.toFixed(1);
  document.getElementById('gc-brx').value = (tl.x + defaultW).toFixed(1);
  document.getElementById('gc-bry').value = (tl.y + defaultH).toFixed(1);
  document.getElementById('gc-blx').value = tl.x.toFixed(1);
  document.getElementById('gc-bly').value = (tl.y + defaultH).toFixed(1);

  // Reset clip + opacity
  document.getElementById('georef-clip').value  = 0.06;
  document.getElementById('georef-clip-val').textContent = '6%';
  document.getElementById('georef-opacity').value = 0.75;
  document.getElementById('georef-op-val').textContent = '75%';
  _georef.clipInset = 0.06; _georef.opacity = 0.75;

  // ── Auto-detect pafta name from filename ──────────────────
  const paftaMatch = (filename || '').replace(/[-_\s.]/g, '').match(/([A-ZÇĞIİÖŞÜa-zçğıiöşü]\d{2}[A-Da-d]?\d{0,2}[A-Da-d]?\d?[A-Da-d]?)/i);
  if (paftaMatch) {
    setGeorefMethod('pafta');
    document.getElementById('pafta-name').value = paftaMatch[1].toUpperCase();
    parsePaftaName(paftaMatch[1].toUpperCase());
    showHint('📐 Pafta adı dosya adından otomatik tespit edildi: ' + paftaMatch[1].toUpperCase());
  } else {
    // Default to "Merkeze Yerleştir" — simplest workflow
    setGeorefMethod('center');
  }
}

function closeGeoref() {
  document.getElementById('georef-panel').style.display = 'none';
  document.getElementById('georef-detect-result').style.display = 'none';
}

function setGeorefMethod(method) {
  _georef.method = method;
  document.querySelectorAll('.georef-tab').forEach(t =>
    t.classList.toggle('active', t.dataset.method === method)
  );
  ['corners','pafta','gcps'].forEach(m => {
    const el = document.getElementById('georef-' + m);
    if (el) el.style.display = m === method ? 'flex' : 'none';
  });
  // For 'center' mode, hide all coordinate sections
  if (method === 'center') {
    ['corners','pafta','gcps'].forEach(m => {
      const el = document.getElementById('georef-' + m);
      if (el) el.style.display = 'none';
    });
  }
}

function updateGeorefOpacity(v) {
  _georef.opacity = v;
  document.getElementById('georef-op-val').textContent = Math.round(v*100) + '%';
  S.objects.forEach(obj => {
    if (obj.type === 'georef_image') obj.opacity = v;
  });
  scheduleRender();
}

// ── Turkish Pafta Sheet Parser ──────────────────────────────
// Türkiye 1:25000 sheet system based on EM/NTM grid
const PAFTA_ORIGIN = { lat: 0, lon: 21 }; // TM zone origins vary

function parsePaftaName(name) {
  const el = document.getElementById('pafta-result');
  if (!name || !name.trim()) { el.textContent = ''; _georef.paftaCoords = null; return; }

  // Normalize: remove city prefix, whitespace, dashes for parsing
  let raw = name.trim().toUpperCase().replace(/\s+/g,'');
  // Remove city name prefix if present (e.g. "BALIKESİR-İ18..." → "İ18...")
  const cityMatch = raw.match(/^[A-ZÇĞIİÖŞÜ]{3,}[_-]?(.+)$/);
  if (cityMatch && /^[A-ZİĞ]\d{2}/.test(cityMatch[1])) raw = cityMatch[1];

  // Remove all separators
  const clean = raw.replace(/[-_\.]/g, '');

  // ── Full Turkish cadastral pafta format ──────────────────
  // İ18D17C3B → base(İ18) + sub levels
  // Pattern: [Letter][2-digit] + pairs of [Letter][Number] ...
  const base = clean.match(/^([A-ZÇĞIİÖŞÜ])(\d{2})/);
  if (!base) {
    el.style.color = 'var(--red)';
    el.textContent = '⚠ Pafta adı tanınamadı. Örnek: İ18D17C3B, G22A4, F23';
    _georef.paftaCoords = null; return;
  }

  const rowLetter = base[1];
  const colNum    = parseInt(base[2]);
  let rest = clean.slice(base[0].length); // remaining after base

  // Parse sub-levels: each is [Letter][Number] or just [Letter] or [Number]
  const subs = [];
  while (rest.length > 0) {
    const m = rest.match(/^([A-DÇ])(\d{0,2})/i);
    if (m && m[0].length > 0) {
      subs.push({ letter: m[1].toUpperCase(), num: m[2] ? parseInt(m[2]) : null });
      rest = rest.slice(m[0].length);
    } else {
      const nm = rest.match(/^(\d{1,2})/);
      if (nm) { subs.push({ letter:null, num:parseInt(nm[1]) }); rest=rest.slice(nm[0].length); }
      else { rest = rest.slice(1); } // skip unknown char
    }
  }

  // ── Determine scale from subdivision depth ────────────────
  const scaleMap = ['1:250.000','1:100.000','1:50.000','1:25.000','1:10.000','1:5.000','1:2.000','1:1.000'];
  const depth = subs.length;
  const scale = scaleMap[Math.min(depth, scaleMap.length-1)] || '1:1.000';

  // ── Calculate approximate coordinates ─────────────────────
  // Turkish 1:250,000 grid (HGM/TKGM standard)
  // Row letters: A=36°N, B=37°N, C=38°N, D=39°N, E=40°N, F=41°N, G=42°N, H=43°N, İ=44°N ...
  // BUT: in practice for Turkey, rows go roughly:
  // Row A starts at ~36°N, each row = 1° lat, 1.5° lon per column
  const turkishRows = 'ABCÇDEFGHIIJKLMNOÖPQRSŞTUVWYZ';
  // Map İ → I for index calculation, handle Turkish İ
  let rowIdx;
  if (rowLetter === 'İ' || rowLetter === 'I') {
    rowIdx = 8; // İ → row 8 (39.5°N = Balıkesir bölgesi)
  } else {
    rowIdx = 'ABCDEFGH'.indexOf(rowLetter);
    if (rowIdx < 0) rowIdx = rowLetter.charCodeAt(0) - 65;
  }

  // Turkish HGM/TKGM pafta grid
  // Her baz pafta: 30' lat × 90' lon (0.5° × 1.5°)
  // Satır: baseLat = 35.5 + rowIdx × 0.5  (İ=8 → 39.5°N)
  // Sütun: baseLon = 25.5 + (colNum-17) × 1.5  (18 → 27.0°E)
  const baseLat = 35.5 + rowIdx * 0.5;
  const baseLon = 25.5 + (colNum - 17) * 1.5;

  let lat0 = baseLat, lon0 = baseLon;
  let dLat = 0.5, dLon = 1.5;

  // Each subdivision roughly halves or quarters the area
  subs.forEach((sub, i) => {
    const letter = sub.letter;
    const num    = sub.num;

    if (letter && 'ABCD'.includes(letter)) {
      // Quadrant subdivision (A=NW, B=NE, C=SW, D=SE)
      dLat /= 2; dLon /= 2;
      const qi = 'ABCD'.indexOf(letter);
      lon0 += (qi % 2) * dLon;       // B,D → east half
      lat0 += (qi < 2 ? 1 : 0) * dLat; // A,B → north half
    }
    if (num !== null && num > 0) {
      // Numbered grid subdivision
      const gridSize = num <= 4 ? 2 : num <= 16 ? 4 : num <= 36 ? 6 : 4;
      const idx = num - 1;
      const subDLat = dLat / gridSize;
      const subDLon = dLon / gridSize;
      const col = idx % gridSize;
      const row = Math.floor(idx / gridSize);
      lat0 += (gridSize - 1 - row) * subDLat; // top to bottom
      lon0 += col * subDLon;
      dLat = subDLat; dLon = subDLon;
    }
  });

  // ── Convert to TUREF TM coordinates (approximate) ─────────
  // TUREF uses TM zones: TM27 (CM=27°E), TM30 (CM=30°E), TM33, TM36
  const centerLon = (lon0 + dLon/2);
  const centerLat = (lat0 + dLat/2);
  let cm = 30; // default central meridian
  if (centerLon < 28.5) cm = 27;
  else if (centerLon < 31.5) cm = 30;
  else if (centerLon < 34.5) cm = 33;
  else cm = 36;

  // Simplified UTM-like projection (Transverse Mercator)
  const toRad = d => d * Math.PI / 180;
  const a = 6378137; // WGS84 semi-major axis
  const f = 1/298.257223563;
  const e2 = 2*f - f*f;
  function latLonToTM(lat, lon, cm) {
    const phi = toRad(lat), lam = toRad(lon - cm);
    const N = a / Math.sqrt(1 - e2 * Math.sin(phi)**2);
    const T = Math.tan(phi)**2;
    const C = e2 / (1-e2) * Math.cos(phi)**2;
    const A = Math.cos(phi) * lam;
    const M = a * ((1 - e2/4 - 3*e2*e2/64)*phi - (3*e2/8 + 3*e2*e2/32)*Math.sin(2*phi)
              + (15*e2*e2/256)*Math.sin(4*phi));
    const x = 500000 + 0.9996 * N * (A + (1-T+C)*A**3/6);
    const y = 0.9996 * (M + N * Math.tan(phi) * (A**2/2 + (5-T+9*C+4*C*C)*A**4/24));
    return { easting: x, northing: y };
  }

  const tlGeo = latLonToTM(lat0 + dLat, lon0, cm);
  const trGeo = latLonToTM(lat0 + dLat, lon0 + dLon, cm);
  const brGeo = latLonToTM(lat0, lon0 + dLon, cm);
  const blGeo = latLonToTM(lat0, lon0, cm);

  // ── Display result ──────────────────────────────────────────
  const widthKm = (dLon * 111 * Math.cos(toRad(centerLat))).toFixed(2);
  const heightKm = (dLat * 111).toFixed(2);

  _georef.paftaCoords = { tl:tlGeo, tr:trGeo, br:brGeo, bl:blGeo, cm };
  _georef.paftaScale  = scale;

  // Center map on this pafta + enable OSM for visual verification
  setMapCenter(centerLat, centerLon);
  if (S.basemap === 'none') { S.basemap = 'osm'; document.getElementById('btn-osm').classList.add('active'); }
  if (!S.showPafta) { S.showPafta = true; document.getElementById('btn-pafta').classList.add('active'); }

  el.style.color = 'var(--green)';
  el.innerHTML = `<strong>✓ ${scale}</strong><br>` +
    `📍 ${centerLat.toFixed(4)}°N  ${centerLon.toFixed(4)}°E<br>` +
    `📐 ${widthKm}×${heightKm} km · TUREF TM${cm}<br>` +
    `SW: E${blGeo.easting.toFixed(0)} N${blGeo.northing.toFixed(0)}<br>` +
    `NE: E${trGeo.easting.toFixed(0)} N${trGeo.northing.toFixed(0)}`;

  // Fill corner inputs with CANVAS world coordinates (not TUREF!)
  // latLonToWorld maps lat/lon → canvas world pixels relative to mapCenter
  let tlW = latLonToWorld(lat0 + dLat, lon0);
  let trW = latLonToWorld(lat0 + dLat, lon0 + dLon);
  let brW = latLonToWorld(lat0,        lon0 + dLon);
  let blW = latLonToWorld(lat0,        lon0);

  // ── Aspect ratio correction ──────────────────────────────
  // Pafta grid gives wrong aspect (3:1) — fix using image's native ratio
  if (_georef.w && _georef.h) {
    const canvasW = Math.abs(trW.x - tlW.x);
    const canvasH = Math.abs(blW.y - tlW.y);
    const imgAspect = _georef.w / _georef.h;  // <1 for portrait maps
    const cx = (tlW.x + trW.x) / 2;
    const cy = (tlW.y + blW.y) / 2;
    // Keep height, adjust width to match image aspect
    const fixedW = canvasH * imgAspect;
    tlW = { x: cx - fixedW/2, y: cy - canvasH/2 };
    trW = { x: cx + fixedW/2, y: cy - canvasH/2 };
    brW = { x: cx + fixedW/2, y: cy + canvasH/2 };
    blW = { x: cx - fixedW/2, y: cy + canvasH/2 };
  }

  document.getElementById('gc-tlx').value = tlW.x.toFixed(1);
  document.getElementById('gc-tly').value = tlW.y.toFixed(1);
  document.getElementById('gc-trx').value = trW.x.toFixed(1);
  document.getElementById('gc-try').value = trW.y.toFixed(1);
  document.getElementById('gc-brx').value = brW.x.toFixed(1);
  document.getElementById('gc-bry').value = brW.y.toFixed(1);
  document.getElementById('gc-blx').value = blW.x.toFixed(1);
  document.getElementById('gc-bly').value = blW.y.toFixed(1);
}

// ── AI-Assisted Detection ────────────────────────────────────
function showGeorefHelp() {
  const el = document.getElementById('georef-detect-result');
  el.style.display = 'block';
  el.className = 'georef-detect-result';
  el.style.whiteSpace = 'pre-wrap';
  el.innerHTML = `<strong>📋 Pafta Bilgileri Nasıl Girilir:</strong>

<strong>1. Pafta Adı yöntemi:</strong>
   → "Pafta Adı" tabını seç
   → Pafta adını gir (ör: İ18D17C3B)
   → Koordinatlar otomatik hesaplanır
   → OSM harita açılır, doğru yeri gösterir

<strong>2. Manuel köşe koordinatları:</strong>
   → Haritanın kenarlarındaki koordinatları oku
   → "4 Köşe" tabında Easting (X) ve Northing (Y) gir
   → Ör: Sol-Üst X: 601506  Y: 4380957

<strong>3. Merkeze yerleştir:</strong>
   → Hızlı görsel yerleştirme
   → Sonra select ile taşı/döndür`;
}


// ── Apply Georeferencing ──────────────────────────────────────
function applyGeoref() {
  if (fieldOff('georef')) return;
  if (!_georef.imgEl) return;
  const get = id => { const r=(document.getElementById(id).value||'').replace(/\s+/g,''); return parseFloat(r)||0; };

  let corners;
  if (_georef.method === 'center') {
    // Place at canvas center with correct image aspect ratio
    const cx = (CW/2 - S.tx) / S.scale;
    const cy = (CH/2 - S.ty) / S.scale;
    const heightM = 700;
    const mpp = pxToMeters(1);
    const h  = heightM / mpp;
    const w  = h * (_georef.w / _georef.h);
    corners = {
      tl: { x: cx-w/2, y: cy-h/2 },
      tr: { x: cx+w/2, y: cy-h/2 },
      br: { x: cx+w/2, y: cy+h/2 },
      bl: { x: cx-w/2, y: cy+h/2 },
    };
  } else {
    // Read corner coordinates
    let tl={x:get('gc-tlx'),y:get('gc-tly')}, tr={x:get('gc-trx'),y:get('gc-try')};
    let br={x:get('gc-brx'),y:get('gc-bry')}, bl={x:get('gc-blx'),y:get('gc-bly')};

    // ── Auto-detect TUREF coordinates and convert ──────────
    const vals = [tl.x,tl.y,tr.x,tr.y,br.x,br.y,bl.x,bl.y];
    const maxVal = Math.max(...vals.map(Math.abs));
    if (maxVal > 100000) {
      // Smart E/N detection: Easting ~400K-700K, Northing ~3.5M-5M
      const smartEN = (valE, valN) => bestTurefENtoWgs84(valE, valN);
      const llTL = smartEN(tl.x, tl.y);
      const llTR = smartEN(tr.x, tr.y);
      const llBR = smartEN(br.x, br.y);
      const llBL = smartEN(bl.x, bl.y);
      // Center map FIRST
      const avgLat = (llTL.lat + llBR.lat) / 2;
      const avgLon = (llTL.lon + llBR.lon) / 2;
      setMapCenter(avgLat, avgLon);
      if (!S.showPafta) { S.showPafta=true; document.getElementById('btn-pafta').classList.add('active'); }
      if (S.basemap==='none') { S.basemap='osm'; document.getElementById('btn-osm').classList.add('active'); }
      // Convert to canvas coords
      tl = latLonToWorld(llTL.lat, llTL.lon);
      tr = latLonToWorld(llTR.lat, llTR.lon);
      br = latLonToWorld(llBR.lat, llBR.lon);
      bl = latLonToWorld(llBL.lat, llBL.lon);
      const tmZone = smartEN(vals[0], vals[1]).cm || detectTurefCm(vals[0]);
      showHint(`📍 TUREF → ${avgLat.toFixed(4)}°N, ${avgLon.toFixed(4)}°E (TM${tmZone})`);
    }
    corners = { tl, tr, br, bl };
  }

  const obj = {
    id:       uid(),
    type:     'georef_image',
    dataUrl:  _georef.dataUrl,
    _imgEl:   _georef.imgEl,
    imgW:     _georef.w,
    imgH:     _georef.h,
    corners,
    clipInset: _georef.clipInset ?? 0.06,
    opacity:  _georef.opacity,
    visible:  true,
    locked:   false,
    layerId:  'sketch',
    method:   _georef.method,
    metadata: { name: document.getElementById('georef-title').textContent || 'Pafta' },
  };

  // Prepend so it renders below other objects
  S.objects.unshift(obj);
  S.selectedIds = [obj.id];
  pushHistory();
  closeGeoref();

  // Auto-zoom to placed pafta
  zoomToPafta(obj.id);

  // Auto-open layer manager
  if (document.getElementById('pafta-mgr').style.display === 'none') togglePaftaMgr();
  else buildPaftaMgr();

  showHint('📍 Pafta yerleştirildi — 🔍 ile görüntüle, ✏ ile düzenle');
}

// ── georef_image hitTest (bounding box) ──────────────────────
function hitTestGeoref(obj, wx, wy) {
  const c = obj.corners;
  if (!c) return false;
  // Point-in-parallelogram test using cross products
  const inTri = (p0,p1,p2) => {
    const d1 = (wx-p1.x)*(p0.y-p1.y) - (p0.x-p1.x)*(wy-p1.y);
    const d2 = (wx-p2.x)*(p1.y-p2.y) - (p1.x-p2.x)*(wy-p2.y);
    const d3 = (wx-p0.x)*(p2.y-p0.y) - (p2.x-p0.x)*(wy-p0.y);
    const hasNeg = d1<0||d2<0||d3<0, hasPos = d1>0||d2>0||d3>0;
    return !(hasNeg&&hasPos);
  };
  return inTri(c.tl,c.tr,c.br) || inTri(c.tl,c.br,c.bl);
}

// ── Translate georef_image ────────────────────────────────────
function translateGeoref(obj, snap, dx, dy) {
  const sc = snap.corners;
  obj.corners = {
    tl: { x:sc.tl.x+dx, y:sc.tl.y+dy },
    tr: { x:sc.tr.x+dx, y:sc.tr.y+dy },
    br: { x:sc.br.x+dx, y:sc.br.y+dy },
    bl: { x:sc.bl.x+dx, y:sc.bl.y+dy },
  };
}

// Make georef panel draggable
(function(){
  let d=false,ox=0,oy=0;
  const hdr=document.getElementById('georef-header');
  if(hdr){
    hdr.addEventListener('mousedown',e=>{d=true;const el=document.getElementById('georef-panel');ox=e.clientX-el.offsetLeft;oy=e.clientY-el.offsetTop;e.preventDefault();});
    document.addEventListener('mousemove',e=>{if(!d)return;const el=document.getElementById('georef-panel');el.style.left=(e.clientX-ox)+'px';el.style.top=(e.clientY-oy)+'px';});
    document.addEventListener('mouseup',()=>d=false);
  }
})();

// ═══════════════════════════════════════════════════════════════
// PAFTA LAYER MANAGER — manage multiple georef images
// ═══════════════════════════════════════════════════════════════
function togglePaftaMgr() {
  if (fieldOff('pafta')) return;
  const el = document.getElementById('pafta-mgr');
  const isOpen = el.style.display !== 'none';
  el.style.display = isOpen ? 'none' : 'flex';
  document.getElementById('btn-pafta-mgr').classList.toggle('active', !isOpen);
  if (!isOpen) buildPaftaMgr();
}

function buildPaftaMgr() {
  const body = document.getElementById('pafta-mgr-body');
  const georefs = S.objects.filter(o => o.type === 'georef_image');
  const empty = document.getElementById('pm-empty');

  body.innerHTML = '';
  if (georefs.length === 0) {
    body.innerHTML = '<div class="pm-empty">Henüz pafta yüklenmedi.<br>Sürükle-bırak veya 📷 butonuyla yükle.</div>';
    return;
  }

  georefs.forEach((obj, idx) => {
    const row = document.createElement('div');
    row.className = 'pm-row' + (obj.visible === false ? ' hidden-layer' : '');
    row.innerHTML = `
      <img class="pm-thumb" src="${obj.dataUrl}" alt="pafta">
      <div class="pm-info">
        <div class="pm-name">${obj.metadata?.name || 'Pafta ' + (idx+1)}</div>
        <div class="pm-meta">${obj.imgW}×${obj.imgH} · Klip ${Math.round((obj.clipInset||0)*100)}%</div>
        <input type="range" class="pm-opacity" min="0.1" max="1" step="0.05" value="${obj.opacity||0.75}"
          oninput="setPaftaOpacity('${obj.id}',+this.value)" title="Şeffaflık">
      </div>
      <button class="pm-btn" onclick="zoomToPafta('${obj.id}')" title="Paftaya Git">🔍</button>
      <button class="pm-btn" onclick="togglePaftaVis('${obj.id}')" title="Göster/Gizle">${obj.visible!==false?'👁':'◌'}</button>
      <button class="pm-btn" onclick="editPaftaLayer('${obj.id}')" title="Düzenle">✏</button>
      <button class="pm-btn danger" onclick="removePaftaLayer('${obj.id}')" title="Sil">🗑</button>
    `;
    body.appendChild(row);
  });
}

function togglePaftaVis(id) {
  const obj = S.objects.find(o => o.id === id);
  if (obj) { obj.visible = obj.visible === false ? true : false; }
  buildPaftaMgr(); scheduleRender();
}

function setPaftaOpacity(id, val) {
  const obj = S.objects.find(o => o.id === id);
  if (obj) obj.opacity = val;
  scheduleRender();
}

function editPaftaLayer(id) {
  const obj = S.objects.find(o => o.id === id);
  if (obj) { S.selectedIds = [id]; reopenGeorefForObj(obj); }
}

function removePaftaLayer(id) {
  if (!confirm('Bu pafta katmanı silinsin mi?')) return;
  S.objects = S.objects.filter(o => o.id !== id);
  pushHistory(); buildPaftaMgr(); scheduleRender();
}

function zoomToPafta(id) {
  const obj = S.objects.find(o => o.id === id);
  if (!obj || !obj.corners) return;
  const c = obj.corners;
  const cx = (c.tl.x + c.br.x) / 2;
  const cy = (c.tl.y + c.br.y) / 2;
  const w  = Math.abs(c.tr.x - c.tl.x) || 100;
  const h  = Math.abs(c.bl.y - c.tl.y) || 100;
  // Fit with 30% margin for context (show surrounding OSM)
  const scaleX = (CW * 0.6) / w;
  const scaleY = (CH * 0.6) / h;
  S.scale = Math.min(scaleX, scaleY, 2);
  S.tx = CW/2 - cx * S.scale;
  S.ty = CH/2 - cy * S.scale;
  S.selectedIds = [id];
  scheduleRender();
  showHint('🔍 Paftaya zoom yapıldı — fare tekerleği ile yakınlaştır');
}


// ── Reopen georef panel for an existing georef_image object ──
function reopenGeorefForObj(obj) {
  _georef.dataUrl   = obj.dataUrl;
  _georef.imgEl     = obj._imgEl;
  _georef.w         = obj.imgW;
  _georef.h         = obj.imgH;
  _georef.opacity   = obj.opacity ?? 0.75;
  _georef.clipInset = obj.clipInset ?? 0.06;
  _georef.method    = 'corners';

  const panel = document.getElementById('georef-panel');
  document.getElementById('georef-thumb').src = obj.dataUrl;
  document.getElementById('georef-title').textContent = 'Pafta Düzenle';

  // Fill clip + opacity sliders
  document.getElementById('georef-opacity').value = _georef.opacity;
  document.getElementById('georef-op-val').textContent = Math.round(_georef.opacity*100)+'%';
  document.getElementById('georef-clip').value = _georef.clipInset;
  document.getElementById('georef-clip-val').textContent = Math.round(_georef.clipInset*100)+'%';

  // Fill corner coords from current corners
  const c = obj.corners;
  document.getElementById('gc-tlx').value = c.tl.x.toFixed(1);
  document.getElementById('gc-tly').value = c.tl.y.toFixed(1);
  document.getElementById('gc-trx').value = c.tr.x.toFixed(1);
  document.getElementById('gc-try').value = c.tr.y.toFixed(1);
  document.getElementById('gc-brx').value = c.br.x.toFixed(1);
  document.getElementById('gc-bry').value = c.br.y.toFixed(1);
  document.getElementById('gc-blx').value = c.bl.x.toFixed(1);
  document.getElementById('gc-bly').value = c.bl.y.toFixed(1);

  setGeorefMethod('corners');
  panel.style.left = '80px'; panel.style.top = '60px';
  panel.style.display = 'flex';

  // Override apply to UPDATE existing obj instead of creating new
  document.getElementById('georef-apply-btn').onclick = function() {
    const get = id => { const r=(document.getElementById(id).value||'').replace(/\s+/g,''); return parseFloat(r)||0; };
    obj.corners = {
      tl: { x: get('gc-tlx'), y: get('gc-tly') },
      tr: { x: get('gc-trx'), y: get('gc-try') },
      br: { x: get('gc-brx'), y: get('gc-bry') },
      bl: { x: get('gc-blx'), y: get('gc-bly') },
    };
    obj.opacity   = _georef.opacity;
    obj.clipInset = _georef.clipInset;
    pushHistory();
    closeGeoref();
    scheduleRender();
    showHint('✓ Pafta ayarları güncellendi');
    // Restore default apply behavior
    document.getElementById('georef-apply-btn').onclick = applyGeoref;
  };
}

// ── Get pafta name at a geographic coordinate ────────────────
function getPaftaNameAtLatLon(lat, lon) {
  if (lat < 35 || lat > 45 || lon < 24 || lon > 46) return null;
  const rowIdx = Math.floor((lat - 35.5) / 0.5);
  const colNum = Math.floor((lon - 18.0) / 0.5);
  if (rowIdx < 0 || rowIdx > 20 || colNum < 0) return null;
  const letters = 'ABCÇDEFGHİ';
  const letter  = rowIdx < letters.length ? letters[rowIdx] : String.fromCharCode(65 + rowIdx);
  return `${letter}${colNum}`;
}

// ═══════════════════════════════════════════════════════════════
// LOCATION SEARCH (Nominatim/OSM Geocoding)
// ═══════════════════════════════════════════════════════════════
function positionLocResults() {
  const input = document.getElementById('loc-input');
  const resultsEl = document.getElementById('loc-results');
  if (!input || !resultsEl || resultsEl.style.display === 'none') return;
  const r = input.getBoundingClientRect();
  const pad = 8;
  const w = Math.max(r.width, 260);
  let left = r.left;
  if (left + w > window.innerWidth - pad) left = window.innerWidth - w - pad;
  left = Math.max(pad, left);
  resultsEl.style.top = (r.bottom + 6) + 'px';
  resultsEl.style.left = left + 'px';
  resultsEl.style.width = w + 'px';
}

function showLocResults() {
  const resultsEl = document.getElementById('loc-results');
  if (!resultsEl) return;
  resultsEl.style.display = 'flex';
  positionLocResults();
}

function hideLocResults() {
  const el = document.getElementById('loc-results');
  if (el) el.style.display = 'none';
}

async function searchLocation() {
  const q = document.getElementById('loc-input').value.trim();
  if (!q) return;
  const resultsEl = document.getElementById('loc-results');
  showLocResults();
  resultsEl.innerHTML = '<div class="loc-item" style="color:var(--muted)">Aranıyor...</div>';
  positionLocResults();

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5&countrycodes=tr&accept-language=tr`;
    const res = await fetch(url);
    const data = await res.json();
    resultsEl.innerHTML = '';

    if (data.length === 0) {
      resultsEl.innerHTML = '<div class="loc-item" style="color:var(--muted)">Sonuç bulunamadı</div>';
      setTimeout(() => hideLocResults(), 2000);
      return;
    }

    data.forEach(item => {
      const div = document.createElement('div');
      div.className = 'loc-item';
      div.innerHTML = `${item.display_name.split(',').slice(0,3).join(', ')}<small>${parseFloat(item.lat).toFixed(4)}°N, ${parseFloat(item.lon).toFixed(4)}°E</small>`;
      div.onclick = () => {
        setMapCenter(parseFloat(item.lat), parseFloat(item.lon));
        if (S.basemap === 'none') { S.basemap='osm'; document.getElementById('btn-osm').classList.add('active'); }
        hideLocResults();
        showHint(`📍 ${item.display_name.split(',')[0]}`);
      };
      resultsEl.appendChild(div);
    });
    positionLocResults();
  } catch(e) {
    resultsEl.innerHTML = '<div class="loc-item" style="color:var(--red)">Arama hatası: ' + e.message + '</div>';
    positionLocResults();
    setTimeout(() => hideLocResults(), 3000);
  }
}

window.addEventListener('resize', positionLocResults);
window.addEventListener('orientationchange', () => setTimeout(positionLocResults, 120));

// Close search results on click outside
document.addEventListener('click', e => {
  if (!e.target.closest('#loc-search') && !e.target.closest('#loc-results'))
    hideLocResults();
});

// ── Panel collapse ────────────────────────────────────────────
function toggleLeftPanel() {
  const bar = document.getElementById('left-bar');
  const btn = document.getElementById('left-toggle');
  const collapsed = bar.style.display === 'none';
  bar.style.display = collapsed ? 'flex' : 'none';
  btn.textContent = collapsed ? '◀' : '▶';
  btn.style.left = collapsed ? 'var(--panel-w)' : '0';
  resizeCanvas();
}

function toggleRightPanel() {
  const panel = document.getElementById('right-panel');
  const btn = document.getElementById('right-toggle');
  const collapsed = panel.style.display === 'none';
  panel.style.display = collapsed ? 'block' : 'none';
  btn.textContent = collapsed ? '▶' : '◀';
  document.body.classList.toggle('field-panel-right', collapsed);
  document.body.classList.toggle('field-panel-right-hidden', !collapsed);
  resizeCanvas();
}

// Draggable pafta manager
(function(){
  let d=false,ox=0,oy=0;
  const hdr=document.getElementById('pafta-mgr-header');
  if(hdr){
    hdr.addEventListener('mousedown',e=>{d=true;const el=document.getElementById('pafta-mgr');ox=e.clientX-el.offsetLeft;oy=e.clientY-el.offsetTop;e.preventDefault();});
    document.addEventListener('mousemove',e=>{if(!d)return;const el=document.getElementById('pafta-mgr');el.style.left=(e.clientX-ox)+'px';el.style.top=(e.clientY-oy)+'px';el.style.right='auto';});
    document.addEventListener('mouseup',()=>d=false);
  }
})();

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────
buildSwatches();
initFieldDrawSettingsPanel();
if (FIELD_MODE) {
  document.body.classList.add('field-tool-select');
  updateFieldPanelForTool(S.tool);
}
buildLineStyles();
buildLineDecos();
buildArrowStyles();
buildCircleStyles();
buildFontSelect();
buildCategories();
buildZonePalette();
buildShortcuts();
initLayers();
buildLayerPanel();
updateHistBtns();
// Grid: 2cm default
setGridSizeCm(2);
// Scale info panel
updateScaleInfo();
// Init drag-drop (georef in planning mode; field hints for vectors)
initDragDrop();
applyFieldModeBoot();
initFieldImportInput();
bindFieldPhotoFileInputs();
// Open style sections
['sec-line','sec-deco','sec-arrow','sec-circle','sec-layers','sec-scale'].forEach(id => {
  const body  = document.getElementById(id);
  const arrow = document.getElementById(id + '-arrow');
  if (body)  body.style.maxHeight  = '2000px';
  if (arrow) arrow.classList.add('open');
});
// Initial button states
document.getElementById('btn-grid').classList.add('active');

const ro = new ResizeObserver(() => resizeCanvas());
ro.observe(wrap);
const fieldDockEl = document.getElementById('field-dock');
if (fieldDockEl) ro.observe(fieldDockEl);
resizeCanvas();

// Demo objects (planning showcase — skipped in Field mode)
if (!fieldOff('planningDemo')) setTimeout(() => {
  const cx=CW/2-160, cy=CH/2-110;
  S.objects.push(
    { id:uid(),type:'arrow',points:[cx,cy,cx+200,cy],arrowStyle:'flow',lineStyle:'solid',color:'#ef5350',strokeWidth:5,opacity:.9,visible:true,locked:false },
    { id:uid(),type:'arrow',points:[cx,cy+50,cx+200,cy+50],arrowStyle:'pedestrian',lineStyle:'solid',color:'#66bb6a',strokeWidth:2.5,opacity:.9,visible:true,locked:false },
    { id:uid(),type:'arrow',points:[cx,cy+100,cx+200,cy+100],arrowStyle:'ecology',lineStyle:'solid',color:'#1abc9c',strokeWidth:3,opacity:.85,visible:true,locked:false },
    { id:uid(),type:'arrow',points:[cx,cy+148,cx+200,cy+148],arrowStyle:'wind',lineStyle:'solid',color:'#5DADE2',strokeWidth:2,opacity:.8,visible:true,locked:false },
    { id:uid(),type:'zone',points:rectPoints(cx+240,cy-15,cx+420,cy+90),fillColor:'rgba(255,179,71,0.18)',color:'#FFB347',strokeWidth:1.5,lineStyle:'dashed',opacity:.9,visible:true,locked:false },
    { id:uid(),type:'polygon',points:[cx+240,cy+115, cx+340,cy+100, cx+420,cy+140, cx+390,cy+195, cx+270,cy+200],closed:true,fillColor:'rgba(130,195,65,0.15)',color:'#82C341',strokeWidth:1.5,lineStyle:'dashed',opacity:.9,visible:true,locked:false },
    { id:uid(),type:'circle',cx:cx+490,cy:cy+50,r:52,circleStyle:'outline',fillColor:'rgba(93,173,226,0.12)',color:'#5DADE2',strokeWidth:2,opacity:.9,visible:true,locked:false },
    { id:uid(),type:'circle',cx:cx+490,cy:cy+155,r:38,circleStyle:'concentric',fillColor:'rgba(232,184,75,0.1)',color:'#e8b84b',strokeWidth:1.5,opacity:.9,visible:true,locked:false },
    { id:uid(),type:'text',x:cx+242,y:cy-10,text:'RESIDENTIAL',color:'#FFB347',fontSize:12,bold:true,fontFamily:'Architects Daughter',opacity:.9,strokeWidth:1,visible:true,locked:false,hasBg:true },
    { id:uid(),type:'text',x:cx+242,y:cy+120,text:'GREEN AREA',color:'#82C341',fontSize:12,bold:true,fontFamily:'Architects Daughter',opacity:.9,strokeWidth:1,visible:true,locked:false,hasBg:true },
    { id:uid(),type:'text',x:cx+2,y:cy-18,text:'Vehicle',color:'#ef5350',fontSize:10,bold:false,fontFamily:'Caveat',opacity:.75,strokeWidth:1,visible:true,locked:false,hasBg:false },
    { id:uid(),type:'text',x:cx+2,y:cy+32,text:'Pedestrian',color:'#66bb6a',fontSize:10,bold:false,fontFamily:'Caveat',opacity:.75,strokeWidth:1,visible:true,locked:false,hasBg:false },
    { id:uid(),type:'text',x:cx+2,y:cy+82,text:'Ecology',color:'#1abc9c',fontSize:10,bold:false,fontFamily:'Caveat',opacity:.75,strokeWidth:1,visible:true,locked:false,hasBg:false },
    { id:uid(),type:'text',x:cx+2,y:cy+130,text:'Wind',color:'#5DADE2',fontSize:10,bold:false,fontFamily:'Caveat',opacity:.75,strokeWidth:1,visible:true,locked:false,hasBg:false },
    { id:uid(),type:'line',points:[cx-20,cy-35,cx+560,cy-35],color:'rgba(0,0,0,0.08)',strokeWidth:0.8,lineStyle:'solid',opacity:1,visible:true,locked:false },
  );
  pushHistory();
  scheduleRender();
}, 80);
else {
  setTool('select');
  initProjectWorkspace();
}
if (FIELD_MODE) initGpsFieldHud();
if (typeof FieldPermissions !== 'undefined') FieldPermissions.init();
if (typeof PlanAISecurity !== 'undefined') PlanAISecurity.init().catch(() => {});
else if (typeof DeviceSecurity !== 'undefined') DeviceSecurity.init().catch(() => {});
if (GPS_TEST_BUILD && !(typeof PlanAISecurity !== 'undefined' ? PlanAISecurity.isSecureModeActive()
  : (typeof DeviceSecurity !== 'undefined' && DeviceSecurity.isSecureModeActive()))) initGpsTestBuild();
