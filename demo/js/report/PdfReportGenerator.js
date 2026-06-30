'use strict';
/**
 * PlanAI Field — PDF report generator (uses ReportDataBuilder dataset + buildReportHTML).
 */
const PdfReportGenerator = (function () {
  function buildHtml(data) {
    if (typeof buildReportHTML === 'function') return buildReportHTML(data);
    throw new Error('buildReportHTML unavailable');
  }

  async function generate(onProgress) {
    const data = await ReportDataBuilder.buildFromCurrentProject(onProgress);
    const tFn = typeof window.t === 'function' ? window.t : k => k;
    if (onProgress) onProgress(75, tFn('report.doc.progress.page'));
    const html = buildHtml(data);
    let pdfBlob = null;
    if (onProgress) onProgress(88, tFn('report.doc.progress.pdf'));
    try {
      if (typeof exportProjectPDF === 'function') pdfBlob = await exportProjectPDF(html);
    } catch (e) {
      console.warn('[PdfReportGenerator]', e);
    }
    if (onProgress) onProgress(100, tFn('report.doc.progress.done'));
    return Object.assign({ html, pdfBlob }, data);
  }

  return { buildHtml, generate };
})();

window.PdfReportGenerator = PdfReportGenerator;
