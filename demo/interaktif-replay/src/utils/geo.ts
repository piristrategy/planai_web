import type { FieldFeat, FieldReport, ObservationCategory, Severity, TimelineEvent } from '../types/report';

const R = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function getTrack(report: FieldReport) {
  return report.feats.find((f) => f.kind === 'track');
}

export function getEvents(report: FieldReport) {
  return report.feats
    .filter((f) => f.kind !== 'track')
    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
}

export function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(ts: string) {
  return new Date(ts).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function formatDuration(ms: number) {
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h} sa ${m % 60} dk`;
  }
  return m > 0 ? `${m} dk ${s} sn` : `${s} sn`;
}

export function inferCategory(text: string, index: number): ObservationCategory {
  const t = text.toLowerCase();
  if (/yol|trafik|kavşak|otopark|ulaşım/.test(t)) return 'transportation';
  if (/altyapı|boru|elektrik|su|kanal/.test(t)) return 'infrastructure';
  if (/yeşil|ağaç|peyzaj|bitki/.test(t)) return 'landscape';
  if (/tapu|mülk|sınır|parsel/.test(t)) return 'ownership';
  if (/çevre|gürültü|hava|atık/.test(t)) return 'environment';
  if (/kentsel|cephe|mimari|tasarım/.test(t)) return 'urban_design';
  const cats: ObservationCategory[] = [
    'landscape',
    'transportation',
    'infrastructure',
    'urban_design',
    'environment',
    'ownership',
  ];
  return cats[index % cats.length];
}

export function inferSeverity(index: number, total: number): Severity {
  if (index === Math.floor(total * 0.7)) return 'critical';
  if (index % 4 === 0) return 'high';
  if (index % 2 === 0) return 'medium';
  return 'low';
}

export function enrichFeat(feat: FieldFeat, index: number, total: number): FieldFeat {
  if (feat.kind === 'track') return feat;
  const category = inferCategory(feat.text, index);
  const severity = inferSeverity(index, total);
  return { ...feat, category, severity };
}

export function buildTimeline(report: FieldReport): TimelineEvent[] {
  const events = getEvents(report);
  const track = getTrack(report);
  const items: TimelineEvent[] = [];

  if (track?.path?.length) {
    const start = track.path[0];
    items.push({
      id: `${track.id}-start`,
      kind: 'track_start',
      title: 'Denetim başladı',
      subtitle: 'GPS kaydı aktif',
      ts: start.ts,
      lat: start.lat,
      lon: start.lon,
      hasMedia: false,
      hasAudio: false,
    });
  }

  events.forEach((feat) => {
    if (feat.kind === 'photo') {
      items.push({
        id: feat.id,
        kind: 'photo',
        title: feat.text || feat.label,
        subtitle: feat.hasVoice ? 'Sesli fotoğraf' : 'Fotoğraf kaydı',
        ts: feat.ts,
        lat: feat.lat,
        lon: feat.lon,
        feat,
        severity: feat.severity,
        hasMedia: true,
        hasAudio: feat.hasVoice,
        previewUrl: feat.imageDataUrl,
      });
    } else {
      items.push({
        id: feat.id,
        kind: 'note',
        title: feat.text || feat.label,
        subtitle: feat.hasVoice ? 'Sesli not' : 'Saha notu',
        ts: feat.ts,
        lat: feat.lat,
        lon: feat.lon,
        feat,
        severity: feat.severity,
        hasMedia: false,
        hasAudio: !!feat.hasVoice,
      });
    }
  });

  if (track?.path?.length) {
    const end = track.path[track.path.length - 1];
    items.push({
      id: `${track.id}-end`,
      kind: 'track_end',
      title: 'Denetim tamamlandı',
      subtitle: 'Rota kaydı sona erdi',
      ts: end.ts,
      lat: end.lat,
      lon: end.lon,
      hasMedia: false,
      hasAudio: false,
    });
  }

  return items.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
}

export function getMapCenter(bounds: FieldReport['bounds']) {
  return {
    lat: (bounds.minLat + bounds.maxLat) / 2,
    lon: (bounds.minLon + bounds.maxLon) / 2,
  };
}

export function interpolatePath(
  path: { lat: number; lon: number; ts: string }[],
  t: number,
): { lat: number; lon: number; index: number } {
  if (!path.length) return { lat: 0, lon: 0, index: 0 };
  if (path.length === 1) return { lat: path[0].lat, lon: path[0].lon, index: 0 };

  const start = new Date(path[0].ts).getTime();
  const end = new Date(path[path.length - 1].ts).getTime();
  const target = start + t * (end - start);

  for (let i = 0; i < path.length - 1; i++) {
    const a = new Date(path[i].ts).getTime();
    const b = new Date(path[i + 1].ts).getTime();
    if (target >= a && target <= b) {
      const ratio = b === a ? 0 : (target - a) / (b - a);
      return {
        lat: path[i].lat + (path[i + 1].lat - path[i].lat) * ratio,
        lon: path[i].lon + (path[i + 1].lon - path[i].lon) * ratio,
        index: i,
      };
    }
  }
  const last = path[path.length - 1];
  return { lat: last.lat, lon: last.lon, index: path.length - 1 };
}

export function slicePath(
  path: { lat: number; lon: number }[],
  progress: number,
): [number, number][] {
  if (!path.length) return [];
  const idx = Math.max(1, Math.floor(progress * (path.length - 1)));
  return path.slice(0, idx + 1).map((p) => [p.lon, p.lat]);
}
