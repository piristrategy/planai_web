'use strict';
/**
 * PlanAI Field — Project Hub controller (alias + future cloud hooks).
 */
const ProjectHubController = (function () {
  function open() {
    if (typeof FieldProjectHub !== 'undefined') FieldProjectHub.open();
    else if (typeof openProjectPanel === 'function') openProjectPanel();
  }

  function close() {
    if (typeof FieldProjectHub !== 'undefined') FieldProjectHub.close();
    else if (typeof closeProjectPanel === 'function') closeProjectPanel();
  }

  function refresh() {
    if (typeof FieldProjectHub !== 'undefined') FieldProjectHub.refresh();
    else if (typeof refreshProjectRecentList === 'function') refreshProjectRecentList();
  }

  async function resumeProject(id) {
    if (typeof openProjectById === 'function') return openProjectById(id);
    return false;
  }

  return { open, close, refresh, resumeProject };
})();

window.ProjectHubController = ProjectHubController;
