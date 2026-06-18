/**
 * PlanAI Field™ — integrity manifest generator.
 * Developed by PiriStrategy. © Taner Piri / PiriStrategy. All rights reserved.
 * Usage: node scripts/generate-integrity-manifest.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const MODULES = [
  'js/app.js',
  'js/spatial/SpatialSecurity.js',
  'js/security/DeviceSecurity.js',
  'js/security/SecurityOrchestrator.js',
  'js/import/ImportSandbox.js',
  'js/spatial/SpatialLimitsCore.js',
];

function sha256File(fp) {
  const buf = fs.readFileSync(fp);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function main() {
  const appVersion = '1.0.0';
  const out = {
    version: appVersion,
    generatedAt: new Date().toISOString(),
    modules: [],
  };
  for (const rel of MODULES) {
    const fp = path.join(ROOT, rel);
    if (!fs.existsSync(fp)) {
      console.warn('skip missing', rel);
      continue;
    }
    out.modules.push({ path: rel.replace(/\\/g, '/'), sha256: sha256File(fp) });
    console.log(rel, out.modules[out.modules.length - 1].sha256.slice(0, 16) + '…');
  }
  const dest = path.join(ROOT, 'integrity-manifest.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 2));
  console.log('Wrote', dest);
}

main();
