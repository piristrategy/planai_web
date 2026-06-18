import type { FieldReport, TimelineEvent } from '../types/report';
import { formatDuration, getEvents, getTrack } from './geo';

export type AIInsight = {
  id: string;
  text: string;
  metric?: string;
  accent: 'cyan' | 'gold' | 'green';
};

export function generateInsights(report: FieldReport, timeline: TimelineEvent[]): AIInsight[] {
  const { stats } = report;
  const events = getEvents(report);
  const critical = events.filter((e) => e.severity === 'critical' || e.severity === 'high').length;
  const insights: AIInsight[] = [];

  insights.push({
    id: 'duration',
    text: `Denetim süresi: ${formatDuration(stats.durationMs)}.`,
    metric: formatDuration(stats.durationMs),
    accent: 'cyan',
  });

  if (stats.photoCount > 0) {
    insights.push({
      id: 'photos',
      text: `${stats.photoCount} fotoğraf ile saha belgelenmiş; yoğunluk rotanın kuzeybatı koridorunda.`,
      metric: String(stats.photoCount),
      accent: 'gold',
    });
  }

  if (critical > 0) {
    insights.push({
      id: 'critical',
      text: `${critical} kritik veya yüksek öncelikli gözlem tespit edildi.`,
      metric: String(critical),
      accent: 'gold',
    });
  } else if (events.length > 0) {
    insights.push({
      id: 'density',
      text: 'Gözlemler rota boyunca dengeli dağılmış; kesişim kümesinde yoğunluk artışı.',
      accent: 'green',
    });
  }

  if (stats.distanceKm > 0) {
    insights.push({
      id: 'distance',
      text: `Toplam yürüyüş mesafesi ${stats.distanceKm} km — saha kapsamı genişletilmiş.`,
      metric: `${stats.distanceKm} km`,
      accent: 'green',
    });
  }

  const track = getTrack(report);
  if (track && timeline.length > 3) {
    const mid = timeline[Math.floor(timeline.length / 2)];
    insights.push({
      id: 'cluster',
      text: `En yoğun denetim aktivitesi ${mid.title} bölgesinde gözlemlendi.`,
      accent: 'cyan',
    });
  }

  return insights.slice(0, 4);
}
