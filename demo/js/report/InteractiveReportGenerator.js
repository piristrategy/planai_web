'use strict';
/**
 * PlanAI Field — Interactive cinematic report generator.
 */
const InteractiveReportGenerator = (function () {
  function buildPayload(data) {
    if (typeof buildInspectionPlaybackPayload === 'function') {
      return buildInspectionPlaybackPayload(data);
    }
    throw new Error('buildInspectionPlaybackPayload unavailable');
  }

  async function buildHtml(data, opts) {
    if (typeof buildCinematicInteractiveReportHTML === 'function') {
      return buildCinematicInteractiveReportHTML(data, opts);
    }
    throw new Error('buildCinematicInteractiveReportHTML unavailable');
  }

  async function generateFromProject(onProgress, opts) {
    const data = await ReportDataBuilder.buildFromCurrentProject(onProgress);
    const html = await buildHtml(data, opts);
    return Object.assign({ interactiveHtml: html }, data);
  }

  return { buildPayload, buildHtml, generateFromProject };
})();

window.InteractiveReportGenerator = InteractiveReportGenerator;
