'use strict';
/**
 * PlanAI Field — Project Details workspace overlay.
 */
const FieldProjectDetails = (function () {
  let _projectId = null;
  let _meta = null;

  function t(key) {
    return typeof window.t === 'function' ? window.t(key) : key;
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function displayName(name) {
    return typeof projectDisplayName === 'function' ? projectDisplayName(name) : (name || t('project.untitled'));
  }

  async function loadMeta(id) {
    const db = await openProjectDb();
    let meta = await idbGet(db, 'projects', id);
    if (!meta) {
      meta = { id, name: t('project.untitled'), updatedAt: new Date().toISOString() };
    }
    if (!meta.stats) {
      const row = await readProjectSnapshotRow(db, id);
      if (row?.json) {
        const snap = JSON.parse(row.json);
        meta.stats = FieldProjectStats.fromSnapshot(snap);
        meta.metadata = meta.metadata || snap.metadata || {};
        meta.createdAt = meta.createdAt || snap.createdAt;
        meta.archived = !!(meta.archived || snap.archived);
      }
    }
    return meta;
  }

  function fillGeneralForm(meta) {
    const md = meta.metadata || {};
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.value = val || '';
    };
    set('pdet-name', displayName(meta.name));
    set('pdet-description', md.description);
    set('pdet-location', md.location);
    set('pdet-inspector', md.inspector);
    const toLocal = typeof isoToDatetimeLocalInput === 'function' ? isoToDatetimeLocalInput : (iso) => iso ? String(iso).slice(0, 16) : '';
    set('pdet-start', toLocal(md.startTime));
    set('pdet-end', toLocal(md.endTime));
  }

  function renderFieldData(stats) {
    const el = document.getElementById('pdet-field-data');
    if (!el) return;
    const rows = [
      ['phub.photos', stats.photos],
      ['phub.videoNotes', (stats.videoNotes || 0) + (stats.videos || 0)],
      ['phub.voice', stats.voice],
      ['phub.notes', stats.notes],
      ['phub.gpsPoints', stats.gpsPoints],
      ['phub.measurements', stats.measurements],
      ['phub.layers', stats.layers],
    ];
    el.innerHTML = rows.map(([key, val]) =>
      '<div class="pdet-stat-row"><span>' + esc(t(key)) + '</span><strong>' + (val || 0) + '</strong></div>'
    ).join('');
  }

  async function open(projectId) {
    if (!projectId) return;
    _projectId = projectId;
    _meta = await loadMeta(projectId);
    if (FIELD_PROJECT.id === projectId && typeof syncProjectInspectionMetadata === 'function') {
      await syncProjectInspectionMetadata().catch(() => {});
      _meta.metadata = FIELD_PROJECT.metadata || _meta.metadata;
    }
    const overlay = document.getElementById('project-details-overlay');
    if (!overlay) return;
    const isCurrent = FIELD_PROJECT.id === projectId;
    const title = document.getElementById('pdet-title');
    if (title) title.textContent = displayName(_meta.name);
    fillGeneralForm(_meta);
    renderFieldData(_meta.stats || FieldProjectStats.fromObjects([], []));
    const openBtn = document.getElementById('pdet-btn-open');
    if (openBtn) {
      openBtn.textContent = isCurrent ? t('phub.continueWork') : t('phub.openProject');
      openBtn.disabled = false;
    }
    const archiveBtn = document.getElementById('pdet-btn-archive');
    if (archiveBtn) {
      archiveBtn.textContent = _meta.archived ? t('phub.unarchive') : t('phub.archive');
    }
    overlay.style.display = 'flex';
    overlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('project-details-open');
  }

  function close(refreshHub) {
    const overlay = document.getElementById('project-details-overlay');
    if (overlay) {
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
    }
    document.body.classList.remove('project-details-open');
    _projectId = null;
    _meta = null;
    if (refreshHub !== false && typeof FieldProjectHub !== 'undefined') FieldProjectHub.refresh();
  }

  async function saveGeneralInfo() {
    if (!_projectId) return;
    const toIso = typeof datetimeLocalInputToIso === 'function' ? datetimeLocalInputToIso : (v) => v || '';
    const md = {
      description: document.getElementById('pdet-description')?.value?.trim() || '',
      location: document.getElementById('pdet-location')?.value?.trim() || '',
      inspector: document.getElementById('pdet-inspector')?.value?.trim() || '',
      startTime: toIso(document.getElementById('pdet-start')?.value || ''),
      endTime: toIso(document.getElementById('pdet-end')?.value || ''),
    };
    const newName = document.getElementById('pdet-name')?.value?.trim();
    const db = await openProjectDb();
    _meta = await loadMeta(_projectId);
    if (newName) _meta.name = newName;
    _meta.metadata = { ...(_meta.metadata || {}), ...md };
    await idbPut(db, 'projects', {
      id: _meta.id,
      name: _meta.name,
      createdAt: _meta.createdAt,
      updatedAt: new Date().toISOString(),
      archived: !!_meta.archived,
      metadata: _meta.metadata,
      stats: _meta.stats,
    });
    if (FIELD_PROJECT.id === _projectId) {
      FIELD_PROJECT.name = _meta.name;
      FIELD_PROJECT.metadata = _meta.metadata;
      updateProjectTitleUi();
      const snap = serializeProjectSnapshot();
      snap.metadata = _meta.metadata;
      await idbPut(db, 'snapshots', { id: _projectId, json: JSON.stringify(snap) });
      _projectDirty = true;
      await saveCurrentProject(true);
    } else {
      const row = await readProjectSnapshotRow(db, _projectId);
      if (row?.json) {
        const snap = JSON.parse(row.json);
        snap.name = _meta.name;
        snap.metadata = _meta.metadata;
        await idbPut(db, 'snapshots', { id: _projectId, json: JSON.stringify(snap) });
      }
    }
    showHint(t('phub.saved'));
    const title = document.getElementById('pdet-title');
    if (title) title.textContent = displayName(_meta.name);
  }

  async function openWorkspace() {
    if (!_projectId) return;
    const id = _projectId;
    close(false);
    if (typeof FieldProjectHub !== 'undefined') FieldProjectHub.close();
    await openProjectById(id);
  }

  async function toggleArchive() {
    if (!_projectId || !_meta) return;
    _meta.archived = !_meta.archived;
    const db = await openProjectDb();
    await idbPut(db, 'projects', {
      id: _meta.id,
      name: _meta.name,
      createdAt: _meta.createdAt,
      updatedAt: new Date().toISOString(),
      archived: _meta.archived,
      metadata: _meta.metadata,
      stats: _meta.stats,
    });
    const row = await readProjectSnapshotRow(db, _projectId);
    if (row?.json) {
      const snap = JSON.parse(row.json);
      snap.archived = _meta.archived;
      await idbPut(db, 'snapshots', { id: _projectId, json: JSON.stringify(snap) });
    }
    if (FIELD_PROJECT.id === _projectId) FIELD_PROJECT.archived = _meta.archived;
    showHint(_meta.archived ? t('phub.archived') : t('phub.unarchived'));
    const archiveBtn = document.getElementById('pdet-btn-archive');
    if (archiveBtn) archiveBtn.textContent = _meta.archived ? t('phub.unarchive') : t('phub.archive');
    if (typeof FieldProjectHub !== 'undefined') FieldProjectHub.refresh();
  }

  async function runOnCurrent(fn) {
    if (!_projectId) return;
    if (FIELD_PROJECT.id !== _projectId) {
      close(false);
      if (typeof FieldProjectHub !== 'undefined') FieldProjectHub.close();
      const ok = await openProjectById(_projectId, { quiet: true });
      if (!ok) return;
    }
    await fn();
  }

  function wireActions() {
    document.getElementById('pdet-btn-close')?.addEventListener('click', () => close());
    document.getElementById('pdet-btn-save-info')?.addEventListener('click', () => saveGeneralInfo());
    document.getElementById('pdet-btn-open')?.addEventListener('click', () => openWorkspace());
    document.getElementById('pdet-btn-archive')?.addEventListener('click', () => toggleArchive());
    document.getElementById('pdet-btn-delete')?.addEventListener('click', async () => {
      if (!_projectId) return;
      const ok = typeof showFieldConfirmDialog === 'function'
        ? await showFieldConfirmDialog({
            title: t('project.delete'),
            message: t('project.deleteConfirm'),
            confirmText: t('project.delete'),
            danger: true,
          })
        : confirm(t('project.deleteConfirm'));
      if (!ok) return;
      const id = _projectId;
      close(false);
      if (typeof FieldProjectHub !== 'undefined') FieldProjectHub.close();
      await deleteProject(id);
    });
    document.getElementById('pdet-btn-rename')?.addEventListener('click', () => runOnCurrent(renameCurrentProject));
    document.getElementById('pdet-btn-save')?.addEventListener('click', () => runOnCurrent(() => saveCurrentProject(false)));
    document.getElementById('pdet-btn-pdf')?.addEventListener('click', () => runOnCurrent(createProjectReport));
    document.getElementById('pdet-btn-interactive')?.addEventListener('click', () => runOnCurrent(createInteractiveFieldReport));
    document.getElementById('pdet-btn-demo')?.addEventListener('click', () => runOnCurrent(createSimulatedFieldReports));
    document.getElementById('pdet-btn-zip')?.addEventListener('click', () => runOnCurrent(exportProjectZip));
    document.getElementById('pdet-btn-geojson')?.addEventListener('click', () => runOnCurrent(exportProjectGeoJson));
    document.getElementById('pdet-btn-kmz')?.addEventListener('click', () => runOnCurrent(exportProjectKmz));
    document.getElementById('pdet-btn-share')?.addEventListener('click', () => runOnCurrent(exportProjectZip));
  }

  function init() {
    wireActions();
  }

  return { open, close, init };
})();

window.FieldProjectDetails = FieldProjectDetails;
