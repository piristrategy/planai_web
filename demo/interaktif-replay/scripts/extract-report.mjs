import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function extractJsonAfter(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) throw new Error(`Missing ${marker}`);
  let p = i + marker.length;
  while (src[p] === ' ' || src[p] === '\n') p++;
  if (src[p] !== '[' && src[p] !== '{') throw new Error(`Expected JSON at ${marker}`);
  const open = src[p];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let k = p; k < src.length; k++) {
    const c = src[k];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') {
      inStr = true;
      continue;
    }
    if (c === open) depth++;
    if (c === close) {
      depth--;
      if (depth === 0) return JSON.parse(src.slice(p, k + 1));
    }
  }
  throw new Error(`Unterminated JSON for ${marker}`);
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(lat2 - lat1);
  const dLon = toR(lon2 - lon1);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function calcDist(path) {
  let d = 0;
  for (let i = 1; i < path.length; i++) {
    d += haversine(path[i - 1].lat, path[i - 1].lon, path[i].lat, path[i].lon);
  }
  return Math.round(d * 100) / 100;
}

function normalizeTs(ts) {
  if (typeof ts === 'number') return new Date(ts).toISOString();
  return ts;
}

const htmlPath = process.argv[2] || path.join(__dirname, '../../interaktif/Proje_7.06.2026_interaktif.html');
const outDir = path.join(__dirname, '../public/demo');

const h = fs.readFileSync(htmlPath, 'utf8');
const title = (h.match(/<title>([^<]+)/) || [])[1] || 'PlanAI Field Inspection';
const feats = extractJsonAfter(h, 'const FEATS=');
const boundsMatch = h.match(/const BOUNDS=(\{[^}]+\})/);
if (!boundsMatch) throw new Error('Missing BOUNDS');
const bounds = Function(`return ${boundsMatch[1]}`)();

for (const f of feats) {
  if (f.ts) f.ts = normalizeTs(f.ts);
  if (f.path) {
    for (const pt of f.path) {
      if (typeof pt.ts === 'number') pt.ts = normalizeTs(pt.ts);
    }
  }
}

const cards = [...h.matchAll(/<article class="ir-card" id="(ph-[^"]+)"[^>]*><img src="(data:image[^"]+)"/g)];
for (const c of cards) {
  const id = c[1].replace('ph-', '');
  const f = feats.find((x) => x.id === id);
  if (f) f.imageDataUrl = c[2];
}

const tracks = feats.filter((f) => f.kind === 'track');
const track = tracks.reduce((best, t) => (t.path?.length > (best?.path?.length ?? 0) ? t : best), tracks[0]);
const events = feats.filter((f) => f.kind !== 'track').sort((a, b) => new Date(a.ts) - new Date(b.ts));
const start = track?.path?.[0]?.ts || events[0]?.ts;
const end = track?.path?.[track.path.length - 1]?.ts || events[events.length - 1]?.ts;
const durMs = start && end ? new Date(end) - new Date(start) : 0;

const report = {
  project: {
    title: title.split(' —')[0].trim(),
    name: title.split(' —')[0].trim(),
    date: start ? new Date(start).toISOString().slice(0, 10) : '2026-06-07',
    brand: 'PlanAI Field',
    org: 'PiriStrategy',
  },
  bounds,
  feats: track ? [...events, track] : feats,
  stats: {
    photoCount: feats.filter((f) => f.kind === 'photo').length,
    noteCount: feats.filter((f) => f.kind === 'note').length,
    audioCount: feats.filter((f) => f.hasVoice).length,
    durationMs: durMs,
    distanceKm: track ? calcDist(track.path) : 0,
    eventCount: events.length,
  },
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report));
console.log('Wrote', path.join(outDir, 'report.json'), report.stats);
