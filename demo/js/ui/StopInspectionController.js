'use strict';
/**
 * PlanAI Field — Stop Inspection workflow (confirm → save → project hub).
 */
const StopInspectionController = (function () {
  let _busy = false;

  function t(key) {
    return typeof window.t === 'function' ? window.t(key) : key;
  }

  function ensureOverlay() {
    let el = document.getElementById('stop-inspection-overlay');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'stop-inspection-overlay';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML =
      '<div class="stop-insp-panel" role="dialog" aria-modal="true" aria-labelledby="stop-insp-title">' +
        '<h2 id="stop-insp-title" class="stop-insp-title"></h2>' +
        '<p id="stop-insp-msg" class="stop-insp-msg"></p>' +
        '<div class="stop-insp-actions">' +
          '<button type="button" id="stop-insp-cancel" class="stop-insp-btn"></button>' +
          '<button type="button" id="stop-insp-confirm" class="stop-insp-btn primary"></button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      if (e.target === el) hideOverlay();
    });
    document.getElementById('stop-insp-cancel')?.addEventListener('click', hideOverlay);
    return el;
  }

  function syncCopy() {
    const title = document.getElementById('stop-insp-title');
    const msg = document.getElementById('stop-insp-msg');
    const cancel = document.getElementById('stop-insp-cancel');
    const confirm = document.getElementById('stop-insp-confirm');
    if (title) title.textContent = t('stop.title');
    if (msg) msg.textContent = t('stop.confirm');
    if (cancel) cancel.textContent = t('stop.continue');
    if (confirm) confirm.textContent = t('stop.finish');
  }

  function showOverlay() {
    const el = ensureOverlay();
    syncCopy();
    el.style.display = 'flex';
    el.setAttribute('aria-hidden', 'false');
    document.body.classList.add('stop-inspection-open');
  }

  function hideOverlay() {
    const el = document.getElementById('stop-inspection-overlay');
    if (!el) return;
    el.style.display = 'none';
    el.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('stop-inspection-open');
  }

  async function finalizeInspection() {
    if (_busy) return;
    _busy = true;
    const busyBtn = document.getElementById('trial-stop-inspection');
    if (busyBtn) busyBtn.disabled = true;
    try {
      hideOverlay();
      if (typeof window.scheduleProjectSave === 'function') window.scheduleProjectSave();
      if (typeof window.flushProjectSave === 'function') await window.flushProjectSave();
      if (typeof window.stopFieldGpsSession === 'function') window.stopFieldGpsSession();
      if (typeof window.fieldTrialStopRecSession === 'function') window.fieldTrialStopRecSession();
      if (FIELD_PROJECT?.id) {
        FIELD_PROJECT.metadata = FIELD_PROJECT.metadata || {};
        FIELD_PROJECT.metadata.endTime = new Date().toISOString();
        FIELD_PROJECT.metadata.inspectionEnded = true;
        if (typeof window.scheduleProjectSave === 'function') window.scheduleProjectSave();
        if (typeof window.flushProjectSave === 'function') await window.flushProjectSave();
      }
      if (typeof window.reloadFieldHubProjects === 'function') await window.reloadFieldHubProjects();
      if (typeof window.refreshFieldStartHubUi === 'function') await window.refreshFieldStartHubUi();
      if (typeof FieldProjectHub !== 'undefined') FieldProjectHub.open();
      else if (typeof window.openProjectPanel === 'function') window.openProjectPanel();
    } catch (e) {
      console.error('[StopInspection]', e);
    } finally {
      _busy = false;
      if (busyBtn) busyBtn.disabled = false;
    }
  }

  function requestStop() {
    if (_busy) return;
    if (typeof window.isInspectionMapActive === 'function' && !window.isInspectionMapActive()) return;
    showOverlay();
    const confirm = document.getElementById('stop-insp-confirm');
    if (confirm) {
      confirm.onclick = () => finalizeInspection();
    }
  }

  return { requestStop, finalizeInspection };
})();

window.StopInspectionController = StopInspectionController;
