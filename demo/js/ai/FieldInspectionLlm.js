'use strict';
/**
 * PlanAI Field — isteğe bağlı bulut LLM katmanı (Faz 4).
 * Kural tabanlı motor her zaman yedek (çevrimdışı öncelik).
 */
const FieldInspectionLlm = (function () {
  const LS_KEY = 'planai_field_ai_llm_v1';
  const TIMEOUT_MS = 14000;
  const DEFAULT_MODEL = 'gpt-4o-mini';

  function tr() {
    return (typeof PA_LANG !== 'undefined' && PA_LANG === 'tr');
  }

  function $(id) {
    return document.getElementById(id);
  }

  function defaultConfig() {
    return {
      enabled: false,
      endpoint: '',
      apiKey: '',
      model: DEFAULT_MODEL,
      useRefine: true,
      useSummary: true,
    };
  }

  function getConfig() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return defaultConfig();
      return { ...defaultConfig(), ...JSON.parse(raw) };
    } catch (_) {
      return defaultConfig();
    }
  }

  function saveConfig(cfg) {
    const next = { ...defaultConfig(), ...cfg };
    localStorage.setItem(LS_KEY, JSON.stringify(next));
    return next;
  }

  function isActive() {
    const c = getConfig();
    return !!(c.enabled && c.endpoint && c.endpoint.trim());
  }

  function endpointUrl(path) {
    const base = getConfig().endpoint.trim().replace(/\/+$/, '');
    const p = path.startsWith('/') ? path : '/' + path;
    if (base.endsWith('/v1')) return base + p.replace(/^\/v1/, '');
    return base + p;
  }

  async function postJson(path, body) {
    const cfg = getConfig();
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) headers.Authorization = 'Bearer ' + cfg.apiKey;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(endpointUrl(path), {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error('HTTP ' + res.status + (errText ? ': ' + errText.slice(0, 120) : ''));
      }
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function mergeRefine(ruleRefined, llm) {
    if (!ruleRefined || !llm || typeof llm !== 'object') return ruleRefined;
    let text = String(llm.text || ruleRefined.text || '').trim();
    if (!text) return ruleRefined;
    if (text.length > 480) text = text.slice(0, 477) + '…';
    const severity = ['critical', 'warning', 'info'].includes(llm.severity)
      ? llm.severity : ruleRefined.severity;
    const out = {
      ...ruleRefined,
      raw: ruleRefined.raw,
      text,
      severity,
      themes: ruleRefined.themes || [],
    };
    if (typeof FieldInspectionAi !== 'undefined' && FieldInspectionAi.detectCoachSignals) {
      out.signals = FieldInspectionAi.detectCoachSignals(text);
    }
    return out;
  }

  function mergeSummary(ruleSummary, llm) {
    if (!ruleSummary || !llm || typeof llm !== 'object') return ruleSummary;
    const out = { ...ruleSummary, aiSource: 'llm' };
    if (llm.headline) out.headline = String(llm.headline).slice(0, 140);
    if (llm.narrative) out.narrative = String(llm.narrative).slice(0, 1400);
    if (Array.isArray(llm.actions) && llm.actions.length) {
      out.actions = llm.actions.slice(0, 5).map(a => String(a).slice(0, 220));
    }
    if (Array.isArray(llm.gaps) && llm.gaps.length) {
      out.gaps = llm.gaps.slice(0, 3).map(g => String(g).slice(0, 220));
    }
    if (Array.isArray(llm.findings) && llm.findings.length) {
      out.findings = llm.findings.slice(0, 6).map((f, i) => ({
        id: 'llm' + i,
        severity: ['critical', 'warning', 'info'].includes(f.severity) ? f.severity : 'info',
        title: String(f.title || (tr() ? 'Bulgu' : 'Finding')).slice(0, 90),
        detail: String(f.detail || '').slice(0, 240),
        location: String(f.location || '—').slice(0, 48),
      }));
      const insights = [out.narrative];
      out.findings.slice(0, 2).forEach(f => insights.push(f.title + ': ' + f.detail));
      (out.gaps || []).forEach(g => insights.push(g));
      out.insights = insights.filter(Boolean).slice(0, 6);
    }
    return out;
  }

  function buildRefinePayload(raw, ruleRefined) {
    const intent = typeof FieldInspectionModes !== 'undefined'
      ? FieldInspectionModes.getCurrentIntent() : 'general';
    return {
      lang: tr() ? 'tr' : 'en',
      intent,
      raw: String(raw || '').slice(0, 800),
      ruleText: String(ruleRefined?.text || '').slice(0, 480),
      severity: ruleRefined?.severity || 'info',
      themes: (ruleRefined?.themes || []).map(t => t.id),
    };
  }

  function buildSummaryPayload(data, ruleSummary) {
    const intent = typeof FieldInspectionModes !== 'undefined'
      ? FieldInspectionModes.getCurrentIntent() : 'general';
    const events = [];
    if (typeof FieldInspectionAi !== 'undefined' && FieldInspectionAi.buildLlmEventContext) {
      events.push(...FieldInspectionAi.buildLlmEventContext(data));
    }
    return {
      lang: tr() ? 'tr' : 'en',
      intent,
      projectName: data?.project?.name || data?.snap?.name || '',
      stats: ruleSummary?.stats || {},
      routeKm: ruleSummary?.stats?.routeKm || 0,
      narrativeHint: ruleSummary?.narrative || '',
      themes: (ruleSummary?.themes || []).map(t => ({ label: t.label, count: t.count })),
      events: events.slice(0, 24),
      gaps: (ruleSummary?.gaps || []).slice(0, 3),
    };
  }

  async function refineObservation(raw, ruleRefined) {
    const cfg = getConfig();
    if (!isActive() || !cfg.useRefine) {
      return { refined: ruleRefined, source: 'local' };
    }
    try {
      const llm = await postJson('/refine', buildRefinePayload(raw, ruleRefined));
      return {
        refined: mergeRefine(ruleRefined, llm),
        source: 'llm',
      };
    } catch (e) {
      console.warn('[FieldInspectionLlm] refine', e);
      return { refined: ruleRefined, source: 'local', error: e.message || String(e) };
    }
  }

  async function enhanceSummary(data, ruleSummary) {
    const cfg = getConfig();
    if (!isActive() || !cfg.useSummary) {
      return { summary: { ...ruleSummary, aiSource: 'local' }, source: 'local' };
    }
    try {
      const llm = await postJson('/summary', buildSummaryPayload(data, ruleSummary));
      return {
        summary: mergeSummary({ ...ruleSummary, aiSource: 'local' }, llm),
        source: 'llm',
      };
    } catch (e) {
      console.warn('[FieldInspectionLlm] summary', e);
      return {
        summary: { ...ruleSummary, aiSource: 'local' },
        source: 'local',
        error: e.message || String(e),
      };
    }
  }

  function loadSettingsForm() {
    const cfg = getConfig();
    const en = $('fai-llm-enabled');
    const ep = $('fai-llm-endpoint');
    const model = $('fai-llm-model');
    const key = $('fai-llm-key');
    const refine = $('fai-llm-refine');
    const summary = $('fai-llm-summary');
    const status = $('fai-llm-status');
    if (en) en.checked = !!cfg.enabled;
    if (ep) ep.value = cfg.endpoint || '';
    if (model) model.value = cfg.model || DEFAULT_MODEL;
    if (key) key.value = cfg.apiKey || '';
    if (refine) refine.checked = cfg.useRefine !== false;
    if (summary) summary.checked = cfg.useSummary !== false;
    if (status) {
      status.textContent = isActive()
        ? (tr() ? 'Bulut AI etkin — bağlantı kaydedildi.' : 'Cloud AI on — settings saved.')
        : (tr() ? 'Kapalı — yerel kural motoru kullanılır.' : 'Off — local rule engine is used.');
    }
  }

  function saveSettingsForm() {
    const cfg = saveConfig({
      enabled: !!$('fai-llm-enabled')?.checked,
      endpoint: $('fai-llm-endpoint')?.value?.trim() || '',
      model: $('fai-llm-model')?.value?.trim() || DEFAULT_MODEL,
      apiKey: $('fai-llm-key')?.value?.trim() || '',
      useRefine: !!$('fai-llm-refine')?.checked,
      useSummary: !!$('fai-llm-summary')?.checked,
    });
    const status = $('fai-llm-status');
    if (status) {
      status.textContent = cfg.enabled && cfg.endpoint
        ? (tr() ? 'Kaydedildi — bulut AI hazır.' : 'Saved — cloud AI ready.')
        : (tr() ? 'Kaydedildi — yalnızca yerel motor.' : 'Saved — local engine only.');
    }
    if (typeof showHint === 'function') {
      showHint(tr() ? 'AI ayarları kaydedildi' : 'AI settings saved', 3000);
    }
    return cfg;
  }

  function bindSettingsUi() {
    if (!window.FIELD_TRIAL_AI_ENABLED) return;
    $('fai-llm-save')?.addEventListener('click', saveSettingsForm);
    const nav = document.getElementById('fset-btn-ai');
    if (nav && !nav.dataset.ftaiBound) {
      nav.dataset.ftaiBound = '1';
      nav.addEventListener('click', () => loadSettingsForm());
    }
  }

  function sourceBadge(source) {
    if (source === 'llm') {
      return tr() ? 'Bulut AI' : 'Cloud AI';
    }
    return tr() ? 'Yerel' : 'Local';
  }

  return {
    getConfig,
    saveConfig,
    isActive,
    refineObservation,
    enhanceSummary,
    loadSettingsForm,
    saveSettingsForm,
    bindSettingsUi,
    sourceBadge,
  };
})();

window.FieldInspectionLlm = FieldInspectionLlm;
