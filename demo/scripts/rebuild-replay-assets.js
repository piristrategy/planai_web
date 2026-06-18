/**
 * Rebuild FieldReplayAssets.js from working cinematic HTML.
 */
const fs = require('fs');
const path = require('path');

const refPath = process.argv[2] || path.join(__dirname, '../interaktif/Field_Journey_17_06_2026_interaktif.html');
const outPath = process.argv[3] || path.join(__dirname, '../js/replay/FieldReplayAssets.js');
const logoOut = process.argv[4] || path.join(__dirname, '../assets/planai-field-logo.png');

const h = fs.readFileSync(refPath, 'utf8');
const styleM = h.match(/<style>([\s\S]*?)<\/style>/);
const modM = h.match(/<script type="module">([\s\S]*?)<\/script>\s*<\/body>/);

let payload = null;
const dataM = h.match(/id="planai-report-data">([\s\S]*?)<\/script>/);
const winM = h.match(/window\.__PLANAI_REPORT__=([\s\S]*?);<\/script>/);
if (dataM) {
  try { payload = JSON.parse(dataM[1]); } catch (e) { console.warn('planai-report-data parse failed', e.message); }
} else if (winM) {
  try { payload = JSON.parse(winM[1]); } catch (e) { console.warn('__PLANAI_REPORT__ parse failed', e.message); }
}

if (!styleM || !modM) {
  console.error('Missing css/js in', refPath);
  process.exit(1);
}

const js = modM[1];
const css = styleM[1];
let logoDataUrl = payload?.brandLogoUrl || '';
if (logoDataUrl.startsWith('data:image/')) {
  const m = logoDataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
  if (m) {
    fs.mkdirSync(path.dirname(logoOut), { recursive: true });
    fs.writeFileSync(logoOut, Buffer.from(m[2], 'base64'));
    console.log('Wrote logo', logoOut, m[1]);
  }
}

const generated = new Date().toISOString();
const out = `/**
 * PlanAI Field — Cinematic Replay assets
 * @generated ${generated}
 * @source ${path.basename(refPath)}
 */
(function (g) {
  g.FieldReplayAssets = {
    css: ${JSON.stringify(css)},
    js: ${JSON.stringify(js)},
    logoDataUrl: ${JSON.stringify(logoDataUrl)},
  };
})(typeof window !== 'undefined' ? window : globalThis);
`;

fs.writeFileSync(outPath, out);

const vm = require('vm');
const ctx = { window: {} };
vm.runInNewContext(out, ctx);
const a = ctx.window.FieldReplayAssets;
console.log('Wrote', outPath);
console.log('css', css.length, 'js', js.length, 'logo', logoDataUrl.length);
console.log('valid:', a.js.includes('function Pb(') && a.js.includes('route-progress-line'));
console.log('track in ref payload:', payload?.events?.some(e => e.kind === 'track'));
