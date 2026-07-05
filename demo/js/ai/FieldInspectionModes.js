'use strict';
/**
 * PlanAI Field — inceleme modu profilleri (trial asistan).
 */
const FieldInspectionModes = (function () {
  const MODES = {
    plan: {
      id: 'plan',
      label: { tr: 'İmar planı / harita', en: 'Zoning plan / map' },
      hint: { tr: 'GML · GeoJSON · GeoTIFF · MPYY', en: 'GML · GeoJSON · GeoTIFF · MPYY' },
      placeholder: {
        tr: 'Örn: Bu parselde konut alanı sınırına 8 metre mesafe var…',
        en: 'E.g. Residential zone boundary is about 8 m from this parcel…',
      },
      tipHtml: {
        tr: '<strong>İmar planı incelemesi</strong>'
          + '<p>Plan verisini <strong>İçe Aktar</strong> ile yükleyin:</p>'
          + '<ul><li><strong>Plan GML</strong> veya <strong>GeoJSON</strong> — MPYY katmanları ile uyumlu</li>'
          + '<li><strong>GeoTIFF</strong> — jeoreferanslı plan rasterı</li>'
          + '<li>İsteğe bağlı saha sınırı: KML / KMZ</li></ul>'
          + '<p>İnceleme boyunca <strong>Bilgi</strong> aracı ile plan öğelerini sorgulayın; gözlemleri Asistan ile kaydedin.</p>',
        en: '<strong>Zoning plan review</strong>'
          + '<p>Import via <strong>Import</strong>:</p>'
          + '<ul><li><strong>Plan GML</strong> or <strong>GeoJSON</strong> — MPYY-compatible</li>'
          + '<li><strong>GeoTIFF</strong> — georeferenced plan raster</li>'
          + '<li>Optional site boundary: KML / KMZ</li></ul>'
          + '<p>Use the <strong>Info</strong> tool on plan features; log observations with the Assistant.</p>',
      },
      importLabel: { tr: '📂 Plan yükle', en: '📂 Import plan' },
      endLead: {
        tr: 'Plan incelemenizi sinematik rapor veya PDF ile paylaşın — gözlemler harita ve plan katmanlarıyla birlikte sunulur.',
        en: 'Share your plan review as cinematic or PDF report — observations appear with map and plan layers.',
      },
    },
    valuation: {
      id: 'valuation',
      label: { tr: 'Saha gözlemi', en: 'Field survey' },
      hint: { tr: 'Gayrimenkul değerleme · ölçüm · belgeleme', en: 'Property valuation · measure · document' },
      placeholder: {
        tr: 'Örn: Bina 4 katlı, kuzey cephe sıva dökülmüş, net alan yaklaşık 120 m²…',
        en: 'E.g. 4-storey building, north façade plaster damaged, net area ~120 m²…',
      },
      tipHtml: {
        tr: '<strong>Gayrimenkul değerleme sahası</strong>'
          + '<ul>'
          + '<li>Parsel sınırı için <strong>KML / GeoJSON</strong> yükleyebilirsiniz</li>'
          + '<li><strong>Alan ve cephe ölçümleri</strong> — poligon ve ölçüm çizgisi</li>'
          + '<li><strong>Fotoğraf</strong> — cephe, giriş, hasar, çevre</li>'
          + '<li><strong>Video</strong> — bina turu ve bağlam için kısa kayıt</li>'
          + '<li>Gözlemleri Asistan ile söyleyin; ölçüm ve foto önerileri alırsınız</li>'
          + '</ul>',
        en: '<strong>Property valuation survey</strong>'
          + '<ul>'
          + '<li>Import parcel boundary as <strong>KML / GeoJSON</strong></li>'
          + '<li><strong>Area and façade measures</strong> — polygon and measure line</li>'
          + '<li><strong>Photos</strong> — façades, access, damage, context</li>'
          + '<li><strong>Video</strong> — short building walkthrough</li>'
          + '<li>Speak observations to the Assistant for measure and photo prompts</li>'
          + '</ul>',
      },
      importLabel: { tr: '📂 Parsel / sınır yükle', en: '📂 Import boundary' },
      endLead: {
        tr: 'Değerleme sahasını PDF rapor ile resmileştirin veya sinematik özet ile paylaşın.',
        en: 'Formalize the valuation site in a PDF report or share a cinematic summary.',
      },
    },
    tourism: {
      id: 'tourism',
      label: { tr: 'Turistik gezi', en: 'Travel log' },
      hint: { tr: 'Anılar · fotoğraf · sinematik rota', en: 'Memories · photos · cinematic route' },
      placeholder: {
        tr: 'Örn: Tarihi köprüden muhteşem manzara, gün batımı çok güzel…',
        en: 'E.g. Stunning view from the old bridge, beautiful sunset…',
      },
      tipHtml: {
        tr: '<strong>Turistik seyahat günlüğü</strong>'
          + '<ul>'
          + '<li><strong>Bol fotoğraf</strong> — her önemli noktada duraklayın</li>'
          + '<li><strong>Video not</strong> — hareket ve atmosfer için</li>'
          + '<li>GPS rotası otomatik kaydedilir</li>'
          + '<li>İnceleme sonunda <strong>sinematik rapor</strong> anılarınızı harita + zaman çizelgesi ile sonsuza taşır</li>'
          + '</ul>',
        en: '<strong>Travel journal</strong>'
          + '<ul>'
          + '<li><strong>Plenty of photos</strong> — pause at each highlight</li>'
          + '<li><strong>Video notes</strong> — capture motion and atmosphere</li>'
          + '<li>GPS route records automatically</li>'
          + '<li><strong>Cinematic report</strong> preserves memories on map + timeline</li>'
          + '</ul>',
      },
      importLabel: null,
      endLead: {
        tr: 'Gezinizi sinematik rapor ile ölümsüzleştirin — rota, fotoğraflar ve anılar tek akışta.',
        en: 'Immortalize your trip with a cinematic report — route, photos and moments in one flow.',
      },
    },
    general: {
      id: 'general',
      label: { tr: 'Diğer', en: 'Other' },
      hint: { tr: 'Genel saha çalışması', en: 'General field work' },
      placeholder: {
        tr: 'Örn: Sahada gördüğünüz önemli bir detay…',
        en: 'E.g. An important detail you noticed on site…',
      },
      tipHtml: null,
      importLabel: null,
      endLead: {
        tr: 'İncelemenizi sinematik rapor veya PDF olarak paylaşabilirsiniz.',
        en: 'Share your work as a cinematic or PDF report.',
      },
    },
  };

  const LEGACY_MAP = { site: 'valuation' };

  function tr() {
    return (typeof PA_LANG !== 'undefined' && PA_LANG === 'tr');
  }

  function lang() {
    return tr() ? 'tr' : 'en';
  }

  function normalizeIntent(id) {
    const key = LEGACY_MAP[id] || id;
    return MODES[key] ? key : 'general';
  }

  function getCurrentIntent() {
    const raw = FIELD_PROJECT?.metadata?.inspectionIntent;
    return normalizeIntent(raw || 'general');
  }

  function getMode(id) {
    return MODES[normalizeIntent(id)] || MODES.general;
  }

  function listChoices() {
    return ['plan', 'valuation', 'tourism', 'general'];
  }

  function text(obj) {
    if (!obj) return '';
    return obj[lang()] || obj.tr || '';
  }

  function getPlaceholder(intent) {
    return text(getMode(intent).placeholder);
  }

  function getTipHtml(intent) {
    return text(getMode(intent).tipHtml);
  }

  function getEndLead(intent) {
    return text(getMode(intent || getCurrentIntent()).endLead);
  }

  function shouldShowIntentPicker() {
    return !FIELD_PROJECT?.metadata?.aiIntentPromptDone;
  }

  return {
    MODES,
    listChoices,
    getMode,
    getCurrentIntent,
    normalizeIntent,
    text,
    getPlaceholder,
    getTipHtml,
    getEndLead,
    shouldShowIntentPicker,
  };
})();

window.FieldInspectionModes = FieldInspectionModes;
