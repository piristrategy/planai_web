/**
 * Extract FieldReplayAssets from reference cinematic HTML into js/replay/FieldReplayAssets.js
 */
const fs = require('fs');
const path = require('path');

const refPath = process.argv[2] || 'C:/Users/Lenovo/Desktop/Field_Journey_18_06_2026_interaktif (2).html';
const outPath = process.argv[3] || 'D:/planai/field/js/replay/FieldReplayAssets.js';

const h = fs.readFileSync(refPath, 'utf8');
const styleM = h.match(/<style>([\s\S]*?)<\/style>/);
const modM = h.match(/<script type="module">([\s\S]*?)<\/script>\s*<\/body>/);
const logoM = h.match(/logoDataUrl:\s*"([^"]+)"/);

if (!styleM || !modM) {
  console.error('Could not extract css/js from', refPath);
  process.exit(1);
}

const css = styleM[1];
const js = modM[1];
const logo = logoM ? logoM[1] : '';

const generated = new Date().toISOString();
const out = `/**
 * PlanAI Field — Cinematic Replay assets (from reference export)
 * @generated ${generated}
 * @source ${path.basename(refPath)}
 */
(function (g) {
  g.FieldReplayAssets = {
    css: ${JSON.stringify(css)},
    js: ${JSON.stringify(js)},
    logoDataUrl: ${JSON.stringify(logo)},
  };
})(typeof window !== 'undefined' ? window : globalThis);
`;

fs.writeFileSync(outPath, out);
console.log('Wrote', outPath);
console.log('css', css.length, 'js', js.length, 'logo', logo.length);

const vm = require('vm');
const ctx = { window: {} };
vm.runInNewContext(out, ctx);
console.log('valid:', !!ctx.window.FieldReplayAssets?.js?.includes('function Pb('));
