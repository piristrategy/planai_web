/** PlanAI Destination Intelligence — uygulama girişi (JSON → render). */
import { API_BASE, apiCredentials, probeLive, formatDiagnosticsHtml, apiLog } from './api.js';
import { loadPartials } from './partials.js';
import { bindGlobals } from './bindGlobals.js';
import { initRouter } from './router.js';
import { loadMorningBrief } from './modules/morningBrief.js';
import { loadPipelineStatus, loadIntelligenceHub, loadAiVisibility } from './modules/intelligenceHub.js';
import { initLiveIntelligence } from './modules/liveTimeline.js';
import {
  initTranslationListeners,
  initSession,
  initViewMode,
  initBriefUxListeners,
  startWorkstationPolling,
  loadAnkaraReport,
  loadAdvisorLive,
  loadGoTurkiyeLive,
  loadMarketIntelligenceBundle,
} from './destination.core.js';

function showApiOfflineBanner(detail) {
  const banner = document.getElementById('liveIntelBanner');
  const text = document.getElementById('liveIntelBannerText');
  if (banner && text) {
    banner.classList.add('show');
    text.innerHTML =
      '<b>API bağlantısı yok</b> — FastAPI yanıt vermiyor. ' +
      '<button type="button" class="pill" id="appRetryBtn" style="margin-left:8px">Tekrar dene</button>' +
      formatDiagnosticsHtml(detail || '');
    const btn = document.getElementById('appRetryBtn');
    if (btn) {
      btn.onclick = async () => {
        btn.disabled = true;
        btn.textContent = 'Deneniyor…';
        if (await probeLive()) {
          banner.classList.remove('show');
          startDataLoads();
        } else {
          btn.disabled = false;
          btn.textContent = 'Tekrar dene';
          showApiOfflineBanner('Hâlâ yanıt yok');
        }
      };
    }
  }
  const chip = document.getElementById('topSeasonChip');
  if (chip) chip.textContent = 'Sabah Brifingi · bağlantı yok';
  const meta = document.getElementById('briefMeta');
  if (meta) meta.textContent = 'API bağlantısı yok';
  const sig = document.getElementById('briefSignals');
  if (sig && (sig.textContent.indexOf('yükleniyor') !== -1 || sig.textContent.indexOf('ulaşılamadı') !== -1)) {
    sig.innerHTML =
      '<div class="sig-line"><span class="t">—</span><span class="icon" style="background:var(--fall)"></span>' +
      '<p><b>Platforma ulaşılamadı</b> — bağlantı düzelince canlı brifing yüklenir.' +
      '<span class="why">Neden önemli: sahte brifing gösterilmez.</span></p></div>' +
      formatDiagnosticsHtml(detail || '');
  }
}

function startDataLoads() {
  loadMorningBrief();
  loadPipelineStatus();
  loadIntelligenceHub();
  loadAiVisibility();
  initLiveIntelligence();
  loadMarketIntelligenceBundle();
  loadAnkaraReport();
  loadAdvisorLive();
  loadGoTurkiyeLive();
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

    startDataLoads();
    const online = await probeLive();
    if (!online) {
      apiLog('warn', 'startup probe failed', { base: API_BASE });
      showApiOfflineBanner('health/live failed');
      const retry = setInterval(async () => {
        if (await probeLive()) {
          clearInterval(retry);
          const banner = document.getElementById('liveIntelBanner');
          banner?.classList.remove('show');
          startDataLoads();
        }
      }, 5000);
    }
  } catch (err) {
    console.error('PlanAI UI başlatılamadı:', err);
    showApiOfflineBanner(String(err && err.message ? err.message : err));
  }
});
