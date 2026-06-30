'use strict';
/**
 * PlanAI Field — Settings hub (permissions, security, help).
 */
const FieldSettingsHub = (function () {
  const PERM_IDS = [
    { id: 'location', key: 'perm.location' },
    { id: 'camera', key: 'perm.camera' },
    { id: 'microphone', key: 'perm.microphone' },
    { id: 'photos', key: 'perm.photos', storageAlias: true },
  ];

  function t(key) {
    return typeof window.t === 'function' ? window.t(key) : key;
  }

  function open() {
    const overlay = document.getElementById('field-settings-overlay');
    if (!overlay) return;
    if (overlay.parentElement !== document.body) document.body.appendChild(overlay);
    const verEl = document.getElementById('fset-about-ver');
    if (verEl) verEl.textContent = typeof PLANAI_FIELD_APP_VERSION !== 'undefined' ? ('v' + PLANAI_FIELD_APP_VERSION) : '';
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('field-settings-open');
    showSection('main');
    refreshPermissionsList();
    syncSecuritySummary();
    refreshStorageInfo();
  }

  function close() {
    const overlay = document.getElementById('field-settings-overlay');
    if (overlay) {
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('field-settings-open');
    closeFieldSecuritySettings();
  }

  function showSection(which) {
    document.querySelectorAll('.fset-panel').forEach(p => {
      p.hidden = p.dataset.fsetPanel !== which;
    });
    const back = document.getElementById('fset-btn-back');
    if (back) back.hidden = which === 'main';
    const title = document.getElementById('fset-title');
    if (title) {
      const titles = {
        main: t('settings.title'),
        permissions: t('settings.permissions'),
        security: t('sec.title'),
        help: t('settings.help'),
        about: t('settings.about'),
      };
      title.textContent = titles[which] || t('settings.title');
    }
  }

  async function refreshPermissionsList() {
    const list = document.getElementById('fset-perm-list');
    if (!list) return;
    list.innerHTML = '';
    for (const def of PERM_IDS) {
      const row = document.createElement('div');
      row.className = 'fset-perm-row';
      let granted = false;
      let canRequest = false;
      if (typeof FieldPermissions !== 'undefined') {
        const alias = def.storageAlias ? 'photos' : def.id;
        try {
          const st = await FieldPermissions.check(alias);
          granted = st === 'granted';
          canRequest = FieldPermissions.isNative() || def.id === 'location';
        } catch (_) {}
      }
      const statusKey = granted ? 'settings.permGranted' : 'settings.permNeeds';
      row.innerHTML =
        '<div class="fset-perm-info">' +
          '<span class="fset-perm-name">' + esc(t(def.key)) + '</span>' +
          '<span class="fset-perm-status ' + (granted ? 'granted' : 'needs') + '">' + esc(t(statusKey)) + '</span>' +
        '</div>';
      if (!granted) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fset-btn small';
        btn.textContent = t('settings.grantPermission');
        btn.onclick = async () => {
          if (typeof FieldPermissions !== 'undefined') {
            const alias = def.storageAlias ? 'photos' : def.id;
            await FieldPermissions.request(alias);
            refreshPermissionsList();
          } else {
            showHint(t('perm.settingsWeb'));
          }
        };
        row.appendChild(btn);
      }
      list.appendChild(row);
    }
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function syncSecuritySummary() {
    const pinEl = document.getElementById('fset-sec-pin');
    const encEl = document.getElementById('fset-sec-enc');
    const hasPin = typeof FieldAccessGate !== 'undefined' && FieldAccessGate.hasPin();
    if (pinEl) pinEl.textContent = hasPin ? t('sec.on') : t('sec.off');
    if (encEl && typeof FieldAccessGate !== 'undefined') {
      const st = FieldAccessGate.encryptionStatusLabel();
      const labels = {
        enabled: t('sec.encEnabled'),
        locked: t('sec.encLocked'),
        baseline: t('sec.encBaseline'),
        off: t('sec.encOff'),
      };
      encEl.textContent = labels[st] || labels.off;
    }
  }

  async function refreshStorageInfo() {
    const el = document.getElementById('fset-storage-info');
    if (!el) return;
    try {
      const projects = await fetchProjectListSorted();
      el.textContent = t('settings.storageSummary').replace('{n}', String(projects.length));
    } catch (_) {
      el.textContent = '—';
    }
  }

  function launchTutorial() {
    close();
    setTimeout(() => {
      if (typeof startFieldOnboarding === 'function') startFieldOnboarding(true);
    }, 80);
  }

  function wireNav() {
    document.getElementById('fset-btn-close')?.addEventListener('click', close);
    document.getElementById('fset-btn-back')?.addEventListener('click', () => showSection('main'));
    document.querySelectorAll('[data-fset-go]').forEach(btn => {
      btn.addEventListener('click', () => showSection(btn.dataset.fsetGo));
    });
    document.getElementById('fset-btn-sec-open')?.addEventListener('click', () => {
      openFieldSecuritySettings();
    });
    document.getElementById('fset-btn-tutorial')?.addEventListener('click', launchTutorial);
    document.getElementById('fset-btn-tutorial-main')?.addEventListener('click', launchTutorial);
    async function requestPerm(id) {
      if (typeof FieldPermissions !== 'undefined') {
        await FieldPermissions.request(id);
        refreshPermissionsList();
      } else {
        showHint(t('perm.settingsWeb'));
      }
    }
    document.getElementById('fset-btn-loc')?.addEventListener('click', () => requestPerm('location'));
    document.getElementById('fset-btn-cam')?.addEventListener('click', () => requestPerm('camera'));
    document.getElementById('fset-btn-mic')?.addEventListener('click', () => requestPerm('microphone'));
    document.getElementById('fset-btn-offline')?.addEventListener('click', () => {
      showHint(t('settings.offlineHint'));
    });
    document.getElementById('fset-btn-delete-data')?.addEventListener('click', () => {
      if (confirm(t('settings.deleteConfirm'))) {
        if (typeof FieldAccessGate !== 'undefined' && FieldAccessGate.hasPin()) {
          showHint(t('settings.deletePinBlock'));
          return;
        }
        indexedDB.deleteDatabase(PROJECT_DB_NAME);
        localStorage.clear();
        location.reload();
      }
    });
  }

  function init() {
    wireNav();
  }

  return { open, close, init };
})();

window.FieldSettingsHub = FieldSettingsHub;
window.openFieldSettingsHub = () => FieldSettingsHub.open();
window.closeFieldSettingsHub = () => FieldSettingsHub.close();
