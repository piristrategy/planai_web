'use strict';
/**
 * PlanAI Field — index-trial.html Saha Asistanı arayüzü.
 */
const FieldTrialAiShell = (function () {
  let _lastSummary = null;
  let _activeCoach = null;
  let _selectedIntent = null;

  function tr() {
    return (typeof PA_LANG !== 'undefined' && PA_LANG === 'tr');
  }

  function $(id) {
    return document.getElementById(id);
  }

  function modes() {
    return typeof FieldInspectionModes !== 'undefined' ? FieldInspectionModes : null;
  }

  async function buildSummaryFromCurrentProject() {
    if (typeof ReportDataBuilder === 'undefined' || typeof FieldInspectionAi === 'undefined') {
      throw new Error(tr() ? 'Rapor verisi hazırlanamadı' : 'Report data unavailable');
    }
    const data = await ReportDataBuilder.buildFromCurrentProject();
    const ruleSummary = FieldInspectionAi.generateSummary(data);
    if (typeof FieldInspectionLlm !== 'undefined' && FieldInspectionLlm.isActive()) {
      const out = await FieldInspectionLlm.enhanceSummary(data, ruleSummary);
      return out.summary;
    }
    return { ...ruleSummary, aiSource: 'local' };
  }

  function renderSummary(summary) {
    _lastSummary = summary;
    const out = $('field-ai-summary');
    if (!out || typeof FieldInspectionAi === 'undefined') return;
    out.innerHTML = FieldInspectionAi.renderPanelHtml(summary);
    const block = document.querySelector('.pdet-ai');
    if (block) {
      block.hidden = false;
      block.removeAttribute('aria-hidden');
    }
  }

  async function runSummary(refreshBtn) {
    if (!FIELD_PROJECT?.id) {
      if (typeof showHint === 'function') showHint(tr() ? 'Önce çalışma açın' : 'Open a project first');
      return;
    }
    const btn = refreshBtn || $('pdet-btn-ai-summary');
    if (btn) btn.disabled = true;
    try {
      if (typeof setReportProgress === 'function') {
        const llmOn = typeof FieldInspectionLlm !== 'undefined' && FieldInspectionLlm.isActive();
        setReportProgress(10, llmOn
          ? (tr() ? 'Bulut AI saha özeti…' : 'Cloud AI field summary…')
          : (tr() ? 'AI saha özeti…' : 'AI field summary…'));
      }
      const summary = await buildSummaryFromCurrentProject();
      renderSummary(summary);
      if (typeof showHint === 'function') showHint(tr() ? 'AI özet hazır' : 'AI summary ready');
    } catch (e) {
      console.warn('[FieldTrialAi]', e);
      if (typeof showHint === 'function') showHint((tr() ? 'AI özet: ' : 'AI summary: ') + (e.message || e));
    } finally {
      if (btn) btn.disabled = false;
      if (typeof hideReportProgress === 'function') hideReportProgress();
    }
  }

  function buildIntentChoices() {
    const grid = $('field-ai-intent-choices');
    const M = modes();
    if (!grid || !M) return;
    grid.innerHTML = '';
    M.listChoices().forEach(id => {
      const mode = M.getMode(id);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'field-ai-intent-btn';
      btn.dataset.intent = id;
      btn.innerHTML = '<strong>' + M.text(mode.label) + '</strong><span>' + M.text(mode.hint) + '</span>';
      btn.addEventListener('click', () => selectIntent(id));
      grid.appendChild(btn);
    });
  }

  function updateCapturePlaceholder() {
    const M = modes();
    const input = $('field-ai-note-input');
    if (!input || !M) return;
    const intent = M.getCurrentIntent();
    input.placeholder = M.getPlaceholder(intent);
  }

  function showIntentPhase() {
    closeIntentGuide(false);
    $('field-ai-sheet-intent')?.removeAttribute('hidden');
    $('field-ai-sheet-capture')?.setAttribute('hidden', 'hidden');
    $('field-ai-sheet-result')?.setAttribute('hidden', 'hidden');
    const choices = $('field-ai-intent-choices');
    if (choices) choices.removeAttribute('hidden');
    const sub = $('field-ai-sheet-sub');
    if (sub) sub.textContent = tr() ? 'Ne incelemek istiyorsunuz?' : 'What are you inspecting?';
    hideCoachBar();
  }

  function openIntentGuide(intentId) {
    const M = modes();
    if (!M) return;
    const mode = M.getMode(intentId);
    const tipHtml = M.getTipHtml(intentId);
    if (!tipHtml) {
      goToLiveLocationAfterIntent(intentId);
      return;
    }

    const guide = $('field-ai-intent-guide');
    if (!guide) return;

    const title = $('field-ai-guide-title');
    const sub = $('field-ai-guide-sub');
    const body = $('field-ai-guide-body');
    const importBtn = $('field-ai-guide-import');
    const continueBtn = $('field-ai-guide-continue');

    if (title) title.textContent = M.text(mode.label);
    if (sub) {
      sub.textContent = tr() ? 'Önce canlı konumda gezinin' : 'Start with live location on site';
    }
    if (body) body.innerHTML = tipHtml;
    if (importBtn) {
      if (M.text(mode.importLabel)) {
        importBtn.textContent = M.text(mode.importLabel);
        importBtn.removeAttribute('hidden');
      } else {
        importBtn.setAttribute('hidden', 'hidden');
      }
    }
    if (continueBtn) {
      continueBtn.textContent = tr() ? '📍 Canlı konuma git' : '📍 Go to live location';
    }

    guide.hidden = false;
    guide.removeAttribute('aria-hidden');
    document.body.classList.add('field-ai-guide-open');
  }

  function closeIntentGuide(returnToChoices) {
    const guide = $('field-ai-intent-guide');
    if (!guide) return;
    guide.hidden = true;
    guide.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('field-ai-guide-open');
    if (returnToChoices) showIntentPhase();
  }

  function showCapturePhase() {
    closeIntentGuide(false);
    $('field-ai-sheet-intent')?.setAttribute('hidden', 'hidden');
    $('field-ai-sheet-capture')?.removeAttribute('hidden');
    $('field-ai-sheet-result')?.setAttribute('hidden', 'hidden');
    updateCapturePlaceholder();
    const M = modes();
    const sub = $('field-ai-sheet-sub');
    if (sub && M) {
      const mode = M.getMode(M.getCurrentIntent());
      sub.textContent = tr()
        ? M.text(mode.label) + ' — konuşun veya yazın, süzer ve yönlendirir.'
        : M.text(mode.label) + ' — speak or type; we refine and guide.';
    }
    const input = $('field-ai-note-input');
    if (input) {
      input.value = '';
      setTimeout(() => input.focus(), 80);
    }
    const status = $('field-ai-note-status');
    if (status) status.textContent = '';
    hideCoachBar();
  }

  function showResultPhase(result) {
    if (!result) return;
    $('field-ai-sheet-intent')?.setAttribute('hidden', 'hidden');
    $('field-ai-sheet-capture')?.setAttribute('hidden', 'hidden');
    $('field-ai-sheet-result')?.removeAttribute('hidden');

    const card = $('field-ai-obs-card');
    if (card && typeof FieldInspectionAi !== 'undefined') {
      card.innerHTML = FieldInspectionAi.renderObservationCardHtml(
        result.refined,
        result.note?.noteNum,
        { source: result.refineSource },
      );
    }

    _activeCoach = result.coach || null;
    const coachEl = $('field-ai-coach');
    if (coachEl) {
      if (_activeCoach) {
        coachEl.removeAttribute('hidden');
        $('field-ai-coach-msg').textContent = _activeCoach.message || '';
        $('field-ai-coach-action').textContent = _activeCoach.actionLabel || (tr() ? 'Devam' : 'Continue');
      } else {
        coachEl.setAttribute('hidden', 'hidden');
      }
    }
  }

  function persistIntent(intent) {
    if (!FIELD_PROJECT?.id) return;
    FIELD_PROJECT.metadata = FIELD_PROJECT.metadata || {};
    FIELD_PROJECT.metadata.inspectionIntent = intent;
    FIELD_PROJECT.metadata.aiIntentPromptDone = true;
    if (typeof scheduleProjectSave === 'function') scheduleProjectSave();
    if (typeof FieldInspectionRadar !== 'undefined') FieldInspectionRadar.resetSession();
    if (typeof FieldInspectionMeasureCoach !== 'undefined') FieldInspectionMeasureCoach.resetSession();
  }

  function intentLiveHint(intent) {
    if (!tr()) {
      switch (intent) {
        case 'plan': return 'Live location for plan review — open Assistant when ready';
        case 'valuation': return 'Live location for field survey — open Assistant when ready';
        case 'tourism': return 'Live location for travel log — open Assistant when ready';
        default: return 'Live location active — open Assistant when ready';
      }
    }
    switch (intent) {
      case 'plan': return 'Canlı konumda plan incelemesi — hazır olunca Asistan\'ı açın';
      case 'valuation': return 'Canlı konumda saha gözlemi — hazır olunca Asistan\'ı açın';
      case 'tourism': return 'Canlı konumda gezi — hazır olunca Asistan\'ı açın';
      default: return 'Canlı konum aktif — gözlem eklemek için Asistan\'ı açın';
    }
  }

  function goToLiveLocationAfterIntent(intent) {
    closeSheet(true);
    if (typeof mapControlLocate === 'function') {
      mapControlLocate();
    }
    if (typeof showHint === 'function') {
      showHint(intentLiveHint(intent || 'general'), 5000);
    }
  }

  function continueFromGuide() {
    closeIntentGuide(false);
    const M = modes();
    const intent = M ? M.getCurrentIntent() : 'general';
    goToLiveLocationAfterIntent(intent);
  }

  function selectIntent(intent) {
    const M = modes();
    if (!M) return;
    const id = M.normalizeIntent(intent);
    _selectedIntent = id;
    persistIntent(id);

    if (id === 'general') {
      goToLiveLocationAfterIntent(id);
      return;
    }
    openIntentGuide(id);
  }

  function skipIntent() {
    persistIntent('general');
    goToLiveLocationAfterIntent('general');
  }

  function openSheet(forceIntent) {
    const sheet = $('field-ai-sheet');
    if (!sheet) return;
    sheet.hidden = false;
    sheet.setAttribute('aria-hidden', 'false');
    document.body.classList.add('field-ai-sheet-open');

    const M = modes();
    if (forceIntent || (M && M.shouldShowIntentPicker())) {
      showIntentPhase();
    } else {
      showCapturePhase();
    }

    if (typeof toggleFieldGps === 'function' && typeof isFieldGpsSessionActive === 'function' && !isFieldGpsSessionActive()) {
      toggleFieldGps();
    }
  }

  function closeSheet(skipCoachBar) {
    const sheet = $('field-ai-sheet');
    if (!sheet) return;
    closeIntentGuide(false);
    const pendingCoach = !skipCoachBar ? _activeCoach : null;
    _activeCoach = null;
    sheet.hidden = true;
    sheet.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('field-ai-sheet-open');
    if (pendingCoach) showCoachBar(pendingCoach);
  }

  function hideCoachBar() {
    const bar = $('field-ai-coach-bar');
    if (bar) {
      bar.hidden = true;
      bar.setAttribute('aria-hidden', 'true');
      bar._coachPayload = null;
    }
  }

  function showCoachBar(coach) {
    if (!coach) return;
    const bar = $('field-ai-coach-bar');
    if (!bar) return;
    $('field-ai-coach-bar-msg').textContent = coach.message || '';
    $('field-ai-coach-bar-action').textContent = coach.actionLabel || '';
    bar.hidden = false;
    bar.removeAttribute('aria-hidden');
    bar.dataset.coachId = coach.id || '';
    bar._coachPayload = coach;
  }

  function showRadarNudge(nudge) {
    if (document.body.classList.contains('field-ai-sheet-open')) return;
    if (document.body.classList.contains('field-ai-guide-open')) return;
    if (document.body.classList.contains('field-ai-end-open')) return;
    showCoachBar(nudge);
  }

  async function processSheetInput() {
    const text = $('field-ai-note-input')?.value?.trim() || '';
    if (!text) {
      if (typeof showHint === 'function') showHint(tr() ? 'Ne gördüğünüzü söyleyin veya yazın' : 'Describe what you observed');
      return;
    }
    const saveBtn = $('field-ai-note-save');
    const status = $('field-ai-note-status');
    if (saveBtn) saveBtn.disabled = true;
    if (typeof FieldInspectionAi === 'undefined') return;

    const ruleRefined = FieldInspectionAi.refineObservation(text);
    if (!ruleRefined.text) {
      if (saveBtn) saveBtn.disabled = false;
      if (typeof showHint === 'function') showHint(tr() ? 'Ne gördüğünüzü söyleyin veya yazın' : 'Describe what you observed');
      return;
    }

    const llmOn = typeof FieldInspectionLlm !== 'undefined' && FieldInspectionLlm.isActive();
    if (status) {
      status.textContent = llmOn
        ? (tr() ? 'Bulut AI ile süzülüyor…' : 'Refining with cloud AI…')
        : (tr() ? 'Süzülüyor…' : 'Refining…');
    }

    let refined = ruleRefined;
    let refineSource = 'local';
    if (llmOn) {
      const out = await FieldInspectionLlm.refineObservation(text, ruleRefined);
      refined = out.refined;
      refineSource = out.source || 'local';
    }

    FieldInspectionAi.saveAiObservationFromRefined(refined, text, result => {
      if (saveBtn) saveBtn.disabled = false;
      if (status) status.textContent = '';
      if (!result) return;
      result.refineSource = refineSource;
      showResultPhase(result);
    }, { source: refineSource });
  }

  function runCoachAction(coach) {
    if (!coach) return;
    _activeCoach = null;
    let ok = false;
    if (coach.radar && typeof FieldInspectionRadar !== 'undefined') {
      ok = FieldInspectionRadar.executeRadarAction(coach);
    } else if (coach.action === 'cinematic' && typeof createInteractiveFieldReport === 'function') {
      createInteractiveFieldReport();
      ok = true;
    } else if (typeof FieldInspectionAi !== 'undefined') {
      ok = FieldInspectionAi.executeCoachAction(coach);
    }
    if (!ok && typeof showHint === 'function') showHint(tr() ? 'İşlem başlatılamadı' : 'Could not start action');
    hideCoachBar();
    closeSheet(true);
  }

  function dismissCoach(coach) {
    if (coach?.id) {
      if (coach.radar && typeof FieldInspectionRadar !== 'undefined') FieldInspectionRadar.dismissNudge(coach.id);
      else if (typeof FieldInspectionAi !== 'undefined') FieldInspectionAi.dismissCoach(coach.id);
    }
    hideCoachBar();
    _activeCoach = null;
  }

  function onNewProject() {
    if (!window.FIELD_TRIAL_AI_ENABLED || !FIELD_PROJECT?.id) return;
    if (typeof FieldInspectionRadar !== 'undefined') FieldInspectionRadar.resetSession();
    if (typeof FieldInspectionMeasureCoach !== 'undefined') FieldInspectionMeasureCoach.resetSession();
  }

  function openEndSheet() {
    const sheet = $('field-ai-end-sheet');
    if (!sheet) return;
    const M = modes();
    const sub = $('field-ai-end-sub');
    if (sub && M) sub.textContent = M.getEndLead(M.getCurrentIntent());
    const cinematic = $('field-ai-end-cinematic');
    if (cinematic && M?.getCurrentIntent() === 'tourism') {
      cinematic.textContent = tr() ? '🎬 Sinematik anı raporu' : '🎬 Cinematic memory report';
    } else if (cinematic) {
      cinematic.textContent = tr() ? '🎬 Sinematik rapor' : '🎬 Cinematic report';
    }
    sheet.hidden = false;
    sheet.removeAttribute('aria-hidden');
    document.body.classList.add('field-ai-end-open');
  }

  function closeEndSheet() {
    const sheet = $('field-ai-end-sheet');
    if (!sheet) return;
    sheet.hidden = true;
    sheet.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('field-ai-end-open');
  }

  function maybeOfferEndInspection(reason) {
    if (!window.FIELD_TRIAL_AI_ENABLED || !FIELD_PROJECT?.id) return;
    const stats = typeof FieldInspectionRadar !== 'undefined' ? FieldInspectionRadar.collectStats() : null;
    if (!stats || (!stats.hasContent && stats.routeM < 120)) return;
    const last = FIELD_PROJECT.metadata?.aiEndPromptTs;
    if (last && Date.now() - Date.parse(last) < 3600000) return;
    FIELD_PROJECT.metadata = FIELD_PROJECT.metadata || {};
    FIELD_PROJECT.metadata.aiEndPromptTs = new Date().toISOString();
    if (reason === 'end_time') FIELD_PROJECT.metadata.endTime = FIELD_PROJECT.metadata.endTime || new Date().toISOString();
    if (typeof scheduleProjectSave === 'function') scheduleProjectSave();
    openEndSheet();
  }

  function onInspectionInfoSaved(md) {
    if (!md?.endTime || FIELD_PROJECT.id == null) return;
    const end = Date.parse(md.endTime);
    if (!Number.isFinite(end) || end > Date.now() + 60000) return;
    maybeOfferEndInspection('end_time');
  }

  function onProjectArchived() {
    maybeOfferEndInspection('archive');
  }

  async function toggleDictation() {
    if (typeof toggleFieldDictation !== 'function') {
      if (typeof showHint === 'function') showHint(tr() ? 'Dikte desteklenmiyor' : 'Dictation unsupported');
      return;
    }
    await toggleFieldDictation('field-ai-note-input', 'field-ai-note-status');
  }

  function bindUi() {
    buildIntentChoices();

    $('btn-dock-ai')?.addEventListener('click', () => openSheet(false));
    $('field-ai-sheet-close')?.addEventListener('click', () => closeSheet());
    $('field-ai-sheet-backdrop')?.addEventListener('click', () => closeSheet());
    $('field-ai-note-save')?.addEventListener('click', processSheetInput);
    $('field-ai-note-dictate')?.addEventListener('click', () => { toggleDictation().catch(() => {}); });
    $('field-ai-sheet-done')?.addEventListener('click', () => closeSheet());
    $('field-ai-coach-action')?.addEventListener('click', () => runCoachAction(_activeCoach));
    $('field-ai-coach-dismiss')?.addEventListener('click', () => {
      dismissCoach(_activeCoach);
      $('field-ai-coach')?.setAttribute('hidden', 'hidden');
    });
    $('field-ai-coach-bar-action')?.addEventListener('click', () => runCoachAction($('field-ai-coach-bar')?._coachPayload));
    $('field-ai-coach-bar-dismiss')?.addEventListener('click', () => dismissCoach($('field-ai-coach-bar')?._coachPayload));

    $('field-ai-intent-skip')?.addEventListener('click', skipIntent);

    $('field-ai-guide-close')?.addEventListener('click', () => closeIntentGuide(true));
    $('field-ai-intent-guide-backdrop')?.addEventListener('click', () => closeIntentGuide(true));
    $('field-ai-guide-back')?.addEventListener('click', () => closeIntentGuide(true));
    $('field-ai-guide-continue')?.addEventListener('click', continueFromGuide);
    $('field-ai-guide-import')?.addEventListener('click', () => {
      closeIntentGuide(false);
      closeSheet(true);
      if (typeof onFieldImportClick === 'function') onFieldImportClick();
    });

    $('field-ai-end-close')?.addEventListener('click', closeEndSheet);
    $('field-ai-end-backdrop')?.addEventListener('click', closeEndSheet);
    $('field-ai-end-later')?.addEventListener('click', closeEndSheet);
    $('field-ai-end-cinematic')?.addEventListener('click', async () => {
      closeEndSheet();
      if (typeof createInteractiveFieldReport === 'function') await createInteractiveFieldReport();
    });
    $('field-ai-end-pdf')?.addEventListener('click', async () => {
      closeEndSheet();
      if (typeof createProjectReport === 'function') await createProjectReport();
    });
    $('field-ai-end-summary')?.addEventListener('click', async () => {
      closeEndSheet();
      if (typeof FieldProjectDetails !== 'undefined' && FIELD_PROJECT?.id) {
        await FieldProjectDetails.open(FIELD_PROJECT.id);
      }
      await runSummary();
    });

    $('pdet-btn-ai-summary')?.addEventListener('click', () => runSummary($('pdet-btn-ai-summary')));
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      if (document.body.classList.contains('field-ai-guide-open')) {
        closeIntentGuide(true);
        return;
      }
      if (document.body.classList.contains('field-ai-sheet-open')) closeSheet();
      if (document.body.classList.contains('field-ai-end-open')) closeEndSheet();
    });
  }

  function init() {
    if (!window.FIELD_TRIAL_AI_ENABLED) return;
    if (typeof FieldInspectionAi !== 'undefined') FieldInspectionAi.patchTrialHooks();
    if (typeof FieldInspectionLlm !== 'undefined') FieldInspectionLlm.bindSettingsUi();
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', bindUi, { once: true });
    } else {
      bindUi();
    }
  }

  return {
    init,
    runSummary,
    renderSummary,
    openSheet,
    closeSheet,
    onNewProject,
    showRadarNudge,
    maybeOfferEndInspection,
    onInspectionInfoSaved,
    onProjectArchived,
    getLastSummary: () => _lastSummary,
  };
})();

window.FieldTrialAiShell = FieldTrialAiShell;
if (window.FIELD_TRIAL_AI_ENABLED) {
  FieldTrialAiShell.init();
}
