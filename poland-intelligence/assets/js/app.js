/** PlanAI Destination Intelligence — uygulama girişi (JSON → render). */
import { API_BASE, apiCredentials } from './api.js';
import { loadPartials } from './partials.js';
import { bindGlobals } from './bindGlobals.js';
import { initRouter } from './router.js';
import { loadMorningBrief } from './modules/morningBrief.js';
import { loadPipelineStatus, loadIntelligenceHub, loadAiVisibility } from './modules/intelligenceHub.js';
import { initLiveIntelligence } from './modules/liveTimeline.js';
import { initTranslationListeners, initSession, initViewMode, initBriefUxListeners, startWorkstationPolling } from './destination.core.js';

const OFFLINE_HINT =
  '<b>CALISTIR.bat</b> veya <b>START_UI.bat</b> dosyasına çift tıklayın, sonra F5 ile yenileyin.';

function showApiOfflineBanner() {
  const banner = document.getElementById('liveIntelBanner');
  const text = document.getElementById('liveIntelBannerText');
  if (banner && text) {
    banner.classList.add('show');
    text.innerHTML = '<b>API bağlantısı yok</b> — ' + OFFLINE_HINT;
  }
  const chip = document.getElementById('topSeasonChip');
  if (chip) chip.textContent = 'Sabah Brifingi · bağlantı yok';
  const meta = document.getElementById('briefMeta');
  if (meta) meta.textContent = 'API bağlantısı yok';
  const sig = document.getElementById('briefSignals');
  if (sig && sig.textContent.indexOf('yükleniyor') !== -1) {
    sig.innerHTML =
      '<div class="sig-line"><span class="t">—</span><span class="icon" style="background:var(--fall)"></span>' +
      '<p><b>Platforma ulaşılamadı</b> — ' + OFFLINE_HINT +
      '<span class="why">Neden önemli: bağlantı düzeldiğinde canlı sabah brifingi otomatik yüklenir.</span></p></div>';
  }
}

async function probeApi() {
  try {
    const res = await fetch(API_BASE + '/api/health/live', { credentials: apiCredentials() });
    return res.ok;
  } catch (_) {
    return false;
  }
}

function startDataLoads() {
  loadMorningBrief();
  loadPipelineStatus();
  loadIntelligenceHub();
  loadAiVisibility();
  initLiveIntelligence();
}

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadPartials();
    bindGlobals();
    initViewMode();
    initRouter();
    initSession();
    initTranslationListeners();
    initBriefUxListeners();
    startWorkstationPolling();

    // Same-origin UI is served by API — start loads immediately; probe only for offline banner.
    startDataLoads();
    const online = await probeApi();
    if (!online) {
      showApiOfflineBanner();
      const retry = setInterval(async () => {
        if (await probeApi()) {
          clearInterval(retry);
          const banner = document.getElementById('liveIntelBanner');
          banner?.classList.remove('show');
          startDataLoads();
        }
      }, 5000);
    }
  } catch (err) {
    console.error('PlanAI UI başlatılamadı:', err);
    showApiOfflineBanner();
  }
});
