const fs = require('fs');
const vm = require('vm');

const tpl = fs.readFileSync('D:/planai/field/interaktif/Field_Journey_17_06_2026_interaktif.html', 'utf8');
const cinematicCode = fs.readFileSync('D:/planai/field/js/replay/FieldCinematicReport.js', 'utf8');
const assetsCode = fs.readFileSync('D:/planai/field/js/replay/FieldReplayAssets.js', 'utf8');

const ctx = {
  window: { __PLANAI_REPLAY_TEMPLATE__: tpl },
  ExportSafety: {
    safeJsonInHtml: (o) => JSON.stringify(o).replace(/</g, '\\u003c'),
  },
};
vm.runInNewContext(assetsCode, ctx);
vm.runInNewContext(cinematicCode, ctx);

const payload = {
  lang: 'en',
  projectName: 'Field Journey 18/06/2026 [Simulation]',
  generatedAt: new Date().toISOString(),
  inspectorName: 'Demo User',
  basemapUrl: '',
  brandLogoUrl: 'data:image/png;base64,abc',
  bounds: { minLat: 39.864, maxLat: 39.867, minLon: 32.816, maxLon: 32.819 },
  events: [
    {
      id: 'track_1', kind: 'track', label: 'GPS Route',
      path: [
        { lat: 39.8668, lon: 32.8170, ts: '2026-06-17T23:23:29.425Z' },
        { lat: 39.8669, lon: 32.8172, ts: '2026-06-17T23:24:29.425Z' },
        { lat: 39.8670, lon: 32.8175, ts: '2026-06-17T23:25:29.425Z' },
      ],
    },
    { id: 'evt_start', kind: 'start', label: 'Journey Started', lat: 39.8668, lon: 32.8170, ts: '2026-06-17T23:23:29.425Z' },
  ],
  stats: { routeKm: 0.32, durationMin: 28, photoCount: 3, noteCount: 2, audioCount: 1 },
  insights: ['test'],
};

const html = ctx.window.FieldCinematicReport.buildReplayHtml(payload);
const checks = {
  hasInlineReport: /<script>window\.__PLANAI_REPORT__=/.test(html),
  noCsp: !html.includes('Content-Security-Policy'),
  noJsonScript: !html.includes('id="planai-report-data"'),
  noBootstrap: !html.includes('normalizeReplayReport'),
  hasModule: html.includes('<script type="module">'),
  hasTrack: html.includes('"kind":"track"'),
  hasBasemap: html.includes('"basemapUrl":"data:image'),
};
console.log(checks);
console.log('all ok:', Object.values(checks).every(Boolean));
console.log('html size:', html.length);
