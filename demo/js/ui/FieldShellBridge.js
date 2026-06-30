'use strict';
/**
 * PlanAI Field — index8 kabuk ↔ kopya (6) motor senkron köprüsü.
 */
const FieldShellBridge = (function () {
  const TOOL_SHELL_TO_ENGINE = {
    select: 'select',
    info: 'info',
    measure: 'polyline',
    area: 'polygon',
    slope: 'circle',
  };
  const TOOL_ENGINE_TO_SHELL = Object.fromEntries(
    Object.entries(TOOL_SHELL_TO_ENGINE).map(([k, v]) => [v, k])
  );

  let mounted = false;

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return [...(r || document).querySelectorAll(s)]; }

  function callEngine(name, ...args) {
    const fn = window[name];
    if (typeof fn === 'function') {
      try { fn.apply(window, args); return true; } catch (e) { console.warn('[FieldShellBridge]', name, e); }
    }
    return false;
  }

  function clickId(id) {
    const el = document.getElementById(id);
    if (el) { el.click(); return true; }
    return false;
  }

  function mountDom() {
    return !!document.getElementById('planai-engine-root');
  }

  function reparentCanvas() {
    const map = $('#work #map');
    const wrap = document.getElementById('canvas-wrap');
    if (!map || !wrap || wrap.parentElement === map) return;
    map.prepend(wrap);
    map.classList.add('has-map');
  }

  function reparentRightPanel() {
    const mount = $('.drawer .shell-right-panel-mount');
    const panel = document.getElementById('right-panel');
    if (!mount || !panel || panel.parentElement === mount) return;
    mount.appendChild(panel);
  }

  function syncShellToolFromEngine() {
    const active = $('#planai-engine-root .field-main-tool.active[data-tool]')
      || $('#planai-engine-root .tool-btn.active[data-tool]');
    const eng = active?.getAttribute('data-tool');
    const shell = eng ? (TOOL_ENGINE_TO_SHELL[eng] || null) : null;
    $$('.leftdock .dock-item').forEach((btn) => {
      const on = shell && btn.dataset.tool === shell;
      btn.classList.toggle('on', !!on);
      btn.classList.toggle('muted', btn.dataset.tool === 'undo' || btn.dataset.tool === 'delete' ? false : !on && !!shell);
    });
    if (eng === 'info') {
      $$('.leftdock .dock-item').forEach((b) => b.classList.toggle('on', b.dataset.tool === 'info'));
    }
  }

  function syncEngineToolFromShell(shellTool) {
    const eng = TOOL_SHELL_TO_ENGINE[shellTool];
    if (!eng) return;
    if (shellTool === 'layers') {
      callEngine('toggleFieldLayersPanel');
      return;
    }
    if (shellTool === 'undo') {
      if (!clickId('btn-undo')) callEngine('undo');
      return;
    }
    if (shellTool === 'delete') {
      if (!clickId('btn-delete')) callEngine('deleteSelected');
      return;
    }
    callEngine('setTool', eng);
  }

  function syncTopInteractionMode() {
    const fingerOn = $('#btn-finger-mode')?.classList.contains('active');
    const penOn = $('#btn-pen-mode')?.classList.contains('active');
    $$('.tool-toggle').forEach((t) => {
      if (t.id === 'sunBtn') return;
      const mode = t.dataset.action;
      t.classList.toggle('on', (mode === 'finger' && fingerOn) || (mode === 'pen' && penOn));
    });
  }

  function syncLangButtons() {
    const trOn = $('#btn-lang-tr')?.classList.contains('active');
    $$('[data-langgroup]').forEach((g) => {
      $$('button', g).forEach((b) => {
        b.classList.toggle('on', (trOn && b.dataset.lang === 'tr') || (!trOn && b.dataset.lang === 'en'));
      });
    });
  }

  function syncBasemapButton() {
    const lbl = $('#btn-dock-basemap-label');
    const shellLbl = $('#bmLabel');
    const shellBtn = $('#basemapBtn');
    if (!lbl || !shellLbl) return;
    shellLbl.textContent = lbl.textContent.trim() || shellLbl.textContent;
    const isSat = /uydu|satellite/i.test(lbl.textContent);
    shellBtn?.classList.toggle('green', isSat);
  }

  function syncDockActive() {
    const map = {
      projects: 'btn-dock-projects',
      import: 'btn-dock-import',
      gps: 'btn-field-gps',
      photo: 'btn-dock-photo',
      note: 'btn-dock-notes',
      basemap: 'btn-dock-basemap',
    };
    Object.entries(map).forEach(([action, id]) => {
      const eng = document.getElementById(id);
      const shell = $(`.bottomdock [data-action="${action}"]`);
      if (eng && shell) shell.classList.toggle('green', eng.classList.contains('active'));
      if (eng && shell && action === 'gps') shell.classList.toggle('solid', eng.classList.contains('active'));
    });
  }

  function syncHubToHome() {
    const pairs = [
      ['fjh-chip-projects', '#shell-stat-projects', '.home-card .stats .stat-cell:nth-child(1) .n'],
      ['fjh-chip-photos', '#shell-stat-photos', '.home-card .stats .stat-cell:nth-child(2) .n'],
      ['fjh-chip-notes', '#shell-stat-notes', '.home-card .stats .stat-cell:nth-child(3) .n'],
      ['fjh-chip-distance', '#shell-stat-distance', '.home-card .stats .stat-cell:nth-child(4) .n'],
    ];
    pairs.forEach(([src, idSel, dstSel]) => {
      const srcEl = document.getElementById(src);
      const val = srcEl?.textContent?.trim();
      if (!val) return;
      const idEl = $(idSel);
      const dstEl = $(dstSel);
      if (idEl) idEl.textContent = val;
      if (dstEl) dstEl.textContent = val;
    });
    const continueCard = document.getElementById('fjh-card-continue');
    const continuePanel = $('#home .panel:nth-of-type(1)');
    if (continueCard && continuePanel) {
      continuePanel.style.display = continueCard.hidden ? 'none' : '';
    }
    const nameEl = document.getElementById('fjh-continue-name');
    const homeTitle = $('#home .panel:nth-of-type(1) h2');
    if (nameEl && homeTitle && nameEl.textContent) homeTitle.textContent = nameEl.textContent;
  }

  function syncGpsHudVisibility() {
    const hud = document.getElementById('gps-hud');
    const shellPanel = document.getElementById('gpsPanel');
    if (!hud || !shellPanel) return;
    const engOpen = hud.classList.contains('gps-hud-expanded')
      || hud.classList.contains('gps-field-expanded')
      || (hud.style.display !== 'none' && !hud.classList.contains('gps-hud-collapsed'));
    if (shellPanel.hidden && engOpen) {
      hud.classList.add('shell-gps-visible');
    } else if (!shellPanel.hidden) {
      hud.classList.remove('shell-gps-visible');
    }
  }

  function wireSearch() {
    const shellInput = $('.topbar .search input');
    const engInput = document.getElementById('loc-input');
    if (!shellInput || !engInput || shellInput.dataset.shellBridged) return;
    shellInput.dataset.shellBridged = '1';
    shellInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        engInput.value = shellInput.value;
        callEngine('searchLocation');
      }
    });
    shellInput.addEventListener('input', () => { engInput.value = shellInput.value; });
  }

  function wireLang() {
    $$('[data-langgroup]').forEach((g) => {
      $$('button', g).forEach((b) => {
        if (b.dataset.shellLangBridged) return;
        b.dataset.shellLangBridged = '1';
        b.addEventListener('click', () => {
          callEngine('setAppLanguage', b.dataset.lang === 'en' ? 'en' : 'tr');
          setTimeout(syncLangButtons, 0);
        });
      });
    });
  }

  function hijackHub() {
    const hub = document.getElementById('field-start-hub-overlay');
    if (!hub || hub.dataset.shellHubHijacked) return;
    hub.dataset.shellHubHijacked = '1';
    const ui = window.PlanAIFieldUI;
    const observer = new MutationObserver(() => {
      if (hub.style.display === 'flex') {
        hub.style.display = 'none';
        hub.setAttribute('aria-hidden', 'true');
        document.body.classList.remove('field-start-hub-active');
        if (ui?.openHub) ui.openHub();
        else { const home = document.getElementById('home'); if (home) home.hidden = false; }
        syncHubToHome();
      }
    });
    observer.observe(hub, { attributes: true, attributeFilter: ['style'] });
  }

  function observeEngineUi() {
    const root = document.getElementById('planai-engine-root');
    if (!root) return;
    const obs = new MutationObserver(() => {
      syncShellToolFromEngine();
      syncTopInteractionMode();
      syncLangButtons();
      syncBasemapButton();
      syncDockActive();
      syncGpsHudVisibility();
      syncHubToHome();
    });
    obs.observe(root, { subtree: true, attributes: true, attributeFilter: ['class', 'style'] });
    const hub = document.getElementById('field-start-hub-overlay');
    if (hub) obs.observe(hub, { subtree: true, childList: true, characterData: true, attributes: true });
  }

  function hideEngineHub() {
    const hub = document.getElementById('field-start-hub-overlay');
    if (!hub) return;
    hub.style.display = 'none';
    hub.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('field-start-hub-active');
  }

  function patchPlanAiFieldUi() {
    const ui = window.PlanAIFieldUI;
    if (!ui || ui._shellBridgePatched) return;
    ui._shellBridgePatched = true;
    const origGoHome = ui.goHome;
    ui.goHome = function () {
      if (typeof origGoHome === 'function') origGoHome();
      hideEngineHub();
      syncHubToHome();
    };
    document.addEventListener('planai:enter-workspace', hideEngineHub);
    document.addEventListener('planai:tool', (e) => syncEngineToolFromShell(e.detail));
    document.addEventListener('planai:lang', (e) => {
      callEngine('setAppLanguage', e.detail === 'en' ? 'en' : 'tr');
    });
    document.addEventListener('planai:input-mode', (e) => {
      callEngine('setFieldInteractionMode', e.detail);
    });
    document.addEventListener('planai:all-projects', () => callEngine('fieldHubActionPrevious'));
  }

  function init() {
    if (mounted) return;
    if (!mountDom()) {
      console.warn('[FieldShellBridge] planai-engine-root bulunamadı — index8-engine-boot.js kontrol edin');
      return;
    }
    document.body.classList.add('field-shell-v8', 'field-mode', 'render-vertex-touch', 'walk-production');
    reparentCanvas();
    reparentRightPanel();
    wireSearch();
    wireLang();
    hijackHub();
    observeEngineUi();
    patchPlanAiFieldUi();
    syncShellToolFromEngine();
    syncTopInteractionMode();
    syncLangButtons();
    syncBasemapButton();
    syncDockActive();
    syncHubToHome();
    window.dispatchEvent(new Event('resize'));
    mounted = true;
    window.dispatchEvent(new CustomEvent('planai:shell-bridge-ready'));
  }

  return { init, syncEngineToolFromShell, syncHubToHome };
})();

window.FieldShellBridge = FieldShellBridge;
