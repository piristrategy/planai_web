'use strict';
/**
 * PlanAI Field — Project manager facade (storage, hub, resume).
 * Future: cloud sync, sharing, version history.
 */
const ProjectManager = (function () {
  async function list() {
    return typeof fetchProjectListSorted === 'function' ? fetchProjectListSorted() : [];
  }

  async function open(id) {
    return typeof openProjectById === 'function' ? openProjectById(id) : false;
  }

  async function save(flush) {
    if (flush && typeof flushProjectSave === 'function') return flushProjectSave();
    if (typeof scheduleProjectSave === 'function') scheduleProjectSave();
  }

  function hub() {
    return typeof ProjectHubController !== 'undefined' ? ProjectHubController : FieldProjectHub;
  }

  return { list, open, save, hub };
})();

window.ProjectManager = ProjectManager;
