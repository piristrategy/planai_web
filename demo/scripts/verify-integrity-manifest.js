/**
 * Verify integrity-manifest.json matches on-disk module hashes.
 * Usage: node scripts/verify-integrity-manifest.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const manifestPath = path.join(ROOT, 'integrity-manifest.json');

function sha256File(fp) {
  return crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
}

function main() {
  if (!fs.existsSync(manifestPath)) {
    console.error('FAIL: integrity-manifest.json missing');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  let failed = 0;
  for (const m of manifest.modules || []) {
    const fp = path.join(ROOT, m.path);
    if (!fs.existsSync(fp)) {
      console.error('FAIL missing', m.path);
      failed++;
      continue;
    }
    const hash = sha256File(fp);
    if (hash !== m.sha256) {
      console.error('FAIL mismatch', m.path);
      console.error('  expected', m.sha256);
      console.error('  actual  ', hash);
      failed++;
    } else {
      console.log('PASS', m.path);
    }
  }
  if (failed) {
    console.error('\nRESULT: FAIL (' + failed + ' mismatch)');
    process.exit(1);
  }
  console.log('\nRESULT: PASS — manifest version', manifest.version);
}

main();
