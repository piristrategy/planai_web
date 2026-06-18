/**
 * PlanAI Field v1.0 — release security static audit.
 * Usage: node scripts/audit-security-release.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const findings = [];

function scanDir(dir, exts) {
  const out = [];
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const fp = path.join(d, name);
      const st = fs.statSync(fp);
      if (st.isDirectory()) {
        if (name !== 'node_modules' && name !== 'releases' && name !== 'libs') walk(fp);
      } else if (exts.some((e) => name.endsWith(e))) out.push(fp);
    }
  };
  walk(dir);
  return out;
}

function add(sev, id, msg, file) {
  findings.push({ sev, id, msg, file: file ? path.relative(ROOT, file) : '' });
}

const jsFiles = scanDir(path.join(ROOT, 'js'), ['.js']);
const htmlFiles = [path.join(ROOT, 'index.html')];

const patterns = [
  { re: /\beval\s*\(/, id: 'eval', sev: 'HIGH', msg: 'eval() usage' },
  { re: /new\s+Function\s*\(/, id: 'function_ctor', sev: 'HIGH', msg: 'Function() constructor' },
  { re: /api[_-]?key\s*[:=]\s*['"][a-zA-Z0-9_\-]{20,}/i, id: 'api_key', sev: 'BLOCKER', msg: 'possible hardcoded API key' },
  { re: /AIza[0-9A-Za-z\-_]{35}/, id: 'google_key', sev: 'BLOCKER', msg: 'Google API key pattern' },
];

for (const fp of [...jsFiles, ...htmlFiles]) {
  const text = fs.readFileSync(fp, 'utf8');
  for (const p of patterns) {
    if (p.re.test(text)) add(p.sev, p.id, p.msg, fp);
  }
  if (/innerHTML\s*=/.test(text) && !fp.includes('sanitize') && !fp.includes('escapeHtml')) {
    add('MEDIUM', 'innerHTML', 'innerHTML assignment (review escaping)', fp);
  }
}

// Import chain checks
const spatial = fs.readFileSync(path.join(ROOT, 'js/spatial/SpatialSecurity.js'), 'utf8');
if (!spatial.includes('assertZipArchive')) add('BLOCKER', 'zip_guard', 'assertZipArchive missing', 'js/spatial/SpatialSecurity.js');
if (!spatial.includes('MAX_ZIP_UNCOMPRESSED: 500')) add('HIGH', 'zip_limit', 'ZIP uncompressed limit not 500MB', 'js/spatial/SpatialSecurity.js');
if (!spatial.includes('assertCrsName')) add('HIGH', 'crs', 'assertCrsName missing', 'js/spatial/SpatialSecurity.js');

const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
if (!app.includes('SpatialSecurity.assertImportFile(file)') || !app.includes('importPlanRasterFile')) {
  add('HIGH', 'raster_gate', 'GeoTIFF assertImportFile may be missing', 'js/app.js');
}
if (!app.includes('loadZipFromFile')) add('HIGH', 'zip_import', 'ZIP loadZipFromFile not used in app.js', 'js/app.js');

const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
if (!idx.includes('walk-production')) add('HIGH', 'prod_class', 'walk-production class missing', 'index.html');
if (!idx.includes('Content-Security-Policy')) add('HIGH', 'csp', 'CSP meta missing', 'index.html');

const manifest = path.join(ROOT, 'integrity-manifest.json');
if (!fs.existsSync(manifest)) add('BLOCKER', 'integrity', 'integrity-manifest.json missing', manifest);

const bySev = { BLOCKER: [], HIGH: [], MEDIUM: [], LOW: [] };
for (const f of findings) (bySev[f.sev] || bySev.MEDIUM).push(f);

console.log('# Security audit summary\n');
for (const sev of ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW']) {
  console.log('##', sev, '(' + bySev[sev].length + ')');
  for (const f of bySev[sev]) console.log('-', f.id + ':', f.msg, f.file ? '@ ' + f.file : '');
}
process.exit(bySev.BLOCKER.length ? 1 : 0);
