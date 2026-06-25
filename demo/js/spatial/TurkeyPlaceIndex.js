'use strict';
/**
 * Türkiye il / yaygın yer adları → yaklaşık WGS84 (CSB plan GML dosya adı ipucu).
 */
(function (global) {
  /** ASCII anahtar → { lat, lon } — 81 il merkezi + sık geçen ilçe/yer adları */
  const PLACES = {
    adana: { lat: 37.00, lon: 35.32 },
    adiyaman: { lat: 37.76, lon: 38.28 },
    afyon: { lat: 38.76, lon: 30.54 },
    afyonkarahisar: { lat: 38.76, lon: 30.54 },
    agri: { lat: 39.72, lon: 43.05 },
    aksaray: { lat: 38.37, lon: 34.03 },
    amasya: { lat: 40.65, lon: 35.83 },
    ankara: { lat: 39.93, lon: 32.85 },
    antalya: { lat: 36.89, lon: 30.71 },
    ardahan: { lat: 41.11, lon: 42.70 },
    artvin: { lat: 41.18, lon: 41.82 },
    aydin: { lat: 37.85, lon: 27.84 },
    balikesir: { lat: 39.65, lon: 27.88 },
    bartin: { lat: 41.64, lon: 32.34 },
    batman: { lat: 37.88, lon: 41.13 },
    bayburt: { lat: 40.26, lon: 40.23 },
    bilecik: { lat: 40.14, lon: 29.98 },
    bingol: { lat: 38.89, lon: 40.50 },
    bitlis: { lat: 38.40, lon: 42.11 },
    bolu: { lat: 40.74, lon: 31.61 },
    burdur: { lat: 37.72, lon: 30.29 },
    bursa: { lat: 40.19, lon: 29.06 },
    canakkale: { lat: 40.15, lon: 26.41 },
    cankiri: { lat: 40.60, lon: 33.62 },
    corum: { lat: 40.55, lon: 34.95 },
    denizli: { lat: 37.77, lon: 29.09 },
    diyarbakir: { lat: 37.91, lon: 40.24 },
    duzce: { lat: 40.84, lon: 31.16 },
    edirne: { lat: 41.68, lon: 26.56 },
    elazig: { lat: 38.68, lon: 39.22 },
    erzincan: { lat: 39.75, lon: 39.49 },
    erzurum: { lat: 39.90, lon: 41.27 },
    eskisehir: { lat: 39.78, lon: 30.52 },
    gaziantep: { lat: 37.07, lon: 37.38 },
    giresun: { lat: 40.91, lon: 38.39 },
    gumushane: { lat: 40.46, lon: 39.48 },
    hakkari: { lat: 37.57, lon: 43.74 },
    hatay: { lat: 36.40, lon: 36.35 },
    igdir: { lat: 39.92, lon: 44.04 },
    isparta: { lat: 37.76, lon: 30.56 },
    istanbul: { lat: 41.01, lon: 28.97 },
    izmir: { lat: 38.42, lon: 27.14 },
    izmit: { lat: 40.77, lon: 29.96 },
    kahramanmaras: { lat: 37.58, lon: 36.93 },
    karabuk: { lat: 41.20, lon: 32.63 },
    karaman: { lat: 37.18, lon: 33.22 },
    kars: { lat: 40.60, lon: 43.10 },
    kastamonu: { lat: 41.38, lon: 33.78 },
    kayseri: { lat: 38.73, lon: 35.48 },
    kilis: { lat: 36.72, lon: 37.12 },
    kirikkale: { lat: 39.85, lon: 33.51 },
    kirklareli: { lat: 41.73, lon: 27.23 },
    kirsehir: { lat: 39.15, lon: 34.16 },
    kocaeli: { lat: 40.77, lon: 29.96 },
    konya: { lat: 37.87, lon: 32.49 },
    kutahya: { lat: 39.42, lon: 29.98 },
    malatya: { lat: 38.35, lon: 38.31 },
    manisa: { lat: 38.62, lon: 27.43 },
    mardin: { lat: 37.31, lon: 40.74 },
    mersin: { lat: 36.80, lon: 34.64 },
    icel: { lat: 36.80, lon: 34.64 },
    mugla: { lat: 37.22, lon: 28.36 },
    mus: { lat: 38.73, lon: 41.49 },
    nevsehir: { lat: 38.62, lon: 34.71 },
    nigde: { lat: 37.97, lon: 34.68 },
    ordu: { lat: 40.98, lon: 37.88 },
    osmaniye: { lat: 37.07, lon: 36.25 },
    rize: { lat: 41.02, lon: 40.52 },
    sakarya: { lat: 40.78, lon: 30.40 },
    samsun: { lat: 41.29, lon: 36.33 },
    sanliurfa: { lat: 37.16, lon: 38.79 },
    urfa: { lat: 37.16, lon: 38.79 },
    siirt: { lat: 37.93, lon: 41.94 },
    sinop: { lat: 42.03, lon: 35.15 },
    sirnak: { lat: 37.52, lon: 42.46 },
    sivas: { lat: 39.75, lon: 37.02 },
    tekirdag: { lat: 40.98, lon: 27.52 },
    tokat: { lat: 40.31, lon: 36.55 },
    trabzon: { lat: 41.00, lon: 39.72 },
    tunceli: { lat: 39.11, lon: 39.55 },
    usak: { lat: 38.68, lon: 29.41 },
    van: { lat: 38.49, lon: 43.38 },
    yalova: { lat: 40.65, lon: 29.27 },
    yozgat: { lat: 39.82, lon: 34.80 },
    zonguldak: { lat: 41.45, lon: 31.80 },
  };

  function normalizeTrName(name) {
    return String(name || '').toLowerCase()
      .replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ş/g, 's')
      .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ç/g, 'c')
      .replace(/İ/g, 'i').replace(/I/g, 'i');
  }

  function geoHintFromFileName(name) {
    const norm = normalizeTrName(name);
    const tokens = norm.split(/[^a-z0-9]+/).filter(t => t.length >= 3);
    let best = null;
    let bestLen = 0;
    for (const [key, hint] of Object.entries(PLACES)) {
      if (key.length < bestLen) continue;
      const hit = norm.includes(key)
        || tokens.some(t => t === key || t.includes(key) || key.includes(t));
      if (hit && key.length >= bestLen) {
        best = hint;
        bestLen = key.length;
      }
    }
    return best;
  }

  global.TurkeyPlaceIndex = {
    PLACES,
    normalizeTrName,
    geoHintFromFileName,
  };
})(typeof self !== 'undefined' ? self : window);
