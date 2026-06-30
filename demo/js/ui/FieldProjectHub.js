'use strict';
/**
 * PlanAI Field — Saha Çalışmaları (Project Hub).
 */
const FieldProjectHub = (function () {
  const RECENT_LIMIT = 8;
  let _refreshing = false;

  function t(key) {
    return typeof window.t === 'function' ? window.t(key) : key;
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function displayName(name) {
    return typeof projectDisplayName === 'function' ? projectDisplayName(name) : (name || t('project.untitled'));
  }

  async function ensureMetaStats(projects) {
    const db = await openProjectDb();
    const out = [];
    for (const p of projects) {
      let row = { ...p };
      if (!row.stats || typeof row.stats.photos !== 'number') {
        try {
          const snapRow = await readProjectSnapshotRow(db, p.id);
          if (snapRow?.json) {
            const snap = JSON.parse(snapRow.json);
            row.stats = FieldProjectStats.fromSnapshot(snap);
            row.createdAt = row.createdAt || snap.createdAt;
            row.metadata = row.metadata || snap.metadata || {};
            row.archived = !!(row.archived || snap.archived || snap.metadata?.archived);
            await idbPut(db, 'projects', {
              id: row.id,
              name: row.name,
              createdAt: row.createdAt,
              updatedAt: row.updatedAt,
              archived: row.archived,
              metadata: row.metadata,
              stats: row.stats,
            });
          }
        } catch (e) {
          console.warn('[ProjectHub] stats', p.id, e);
          row.stats = row.stats || FieldProjectStats.fromObjects([], []);
        }
      }
      out.push(row);
    }
    return out;
  }

  function buildCard(p, opts) {
    const stats = p.stats || FieldProjectStats.fromObjects([], []);
    const wrap = document.createElement('div');
    wrap.className = 'phub-card' + (opts.active ? ' phub-card-active' : '');
    const dateStr = FieldProjectStats.formatCardDate(p.metadata?.inspectionAt || p.createdAt || p.updatedAt, window.PA_LANG);
    const editedStr = (p.updatedAt || '').slice(0, 16).replace('T', ' ');
    const gpsLbl = stats.gpsRecorded ? t('phub.gpsRecorded') : t('phub.gpsNone');
    const reportLbl = FieldProjectStats.reportStatusLabel(stats, t);
    const statChip = (icon, val, lbl) =>
      '<span class="phub-stat-chip" title="' + esc(lbl) + '"><span class="phub-stat-ico" aria-hidden="true">' + icon + '</span><b>' + val + '</b></span>';
    wrap.innerHTML =
      '<div class="phub-card-body">' +
        '<span class="phub-card-name">' + esc(displayName(p.name)) + '</span>' +
        '<span class="phub-card-date">' + esc(dateStr) + '</span>' +
        '<span class="phub-card-edited">' + t('phub.lastEdited') + ': ' + esc(editedStr) + '</span>' +
        '<div class="phub-card-stats">' +
          statChip('📷', stats.photos, t('phub.photos')) +
          statChip('🎬', (stats.videoNotes || 0) + (stats.videos || 0), t('phub.videoNotes')) +
          statChip('🎤', stats.voice, t('phub.voice')) +
          statChip('📝', stats.notes, t('phub.notes')) +
        '</div>' +
        '<div class="phub-card-footer">' +
          '<span class="phub-gps ' + (stats.gpsRecorded ? 'on' : '') + '">📍 ' + esc(gpsLbl) + '</span>' +
          '<span class="phub-report ' + (stats.pdfReady ? 'ready' : stats.interactiveReady ? 'interactive' : '') + '">📄 ' + esc(reportLbl) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="phub-card-actions">' +
        '<button type="button" class="phub-btn primary" data-phub-resume>' + esc(t('phub.continueWork')) + '</button>' +
        '<button type="button" class="phub-btn" data-phub-detail>' + esc(t('phub.details')) + '</button>' +
      '</div>';
    wrap.querySelector('[data-phub-resume]')?.addEventListener('click', async (e) => {
      e.stopPropagation();
      close();
      if (typeof openProjectById === 'function') await openProjectById(p.id);
    });
    wrap.querySelector('[data-phub-detail]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (typeof FieldProjectDetails !== 'undefined') FieldProjectDetails.open(p.id);
    });
    return wrap;
  }

  function renderSection(containerId, projects, opts) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = '';
    if (!projects.length) {
      const empty = document.createElement('div');
      empty.className = 'phub-empty';
      empty.textContent = opts.emptyText || t('project.none');
      el.appendChild(empty);
      return;
    }
    projects.forEach(p => el.appendChild(buildCard(p, opts)));
  }

  async function refresh() {
    if (_refreshing) return;
    _refreshing = true;
    try {
      let projects = await fetchProjectListSorted();
      projects = await ensureMetaStats(projects);
      const activeId = FIELD_PROJECT.id;
      const active = activeId ? projects.filter(p => p.id === activeId && !p.archived) : [];
      const archived = projects.filter(p => p.archived);
      const recent = projects.filter(p => p.id !== activeId && !p.archived).slice(0, RECENT_LIMIT);

      renderSection('phub-active-list', active, { active: true, emptyText: t('phub.noActive') });
      renderSection('phub-recent-list', recent, { emptyText: t('phub.noRecent') });
      renderSection('phub-archive-list', archived, { emptyText: t('phub.noArchive') });

      const archiveSec = document.getElementById('phub-archive-section');
      if (archiveSec) archiveSec.hidden = !archived.length;
    } catch (e) {
      console.error('[ProjectHub] refresh', e);
    } finally {
      _refreshing = false;
    }
  }

  function open() {
    const run = () => {
      const overlay = document.getElementById('project-overlay');
      if (!overlay) return;
      overlay.style.display = 'flex';
      hideNewProjectForm();
      refresh();
      if (typeof FieldProjectDetails !== 'undefined') FieldProjectDetails.close(false);
    };
    if (typeof FieldAccessGate !== 'undefined') FieldAccessGate.requireAccess(run);
    else run();
  }

  function close() {
    const overlay = document.getElementById('project-overlay');
    if (overlay) overlay.style.display = 'none';
    hideNewProjectForm();
  }

  return { open, close, refresh };
})();

window.FieldProjectHub = FieldProjectHub;
