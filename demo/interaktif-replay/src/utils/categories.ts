import type { ObservationCategory, Severity } from '../types/report';

export const CATEGORY_META: Record<
  ObservationCategory,
  { label: string; icon: string; color: string }
> = {
  transportation: { label: 'Ulaşım', icon: '🛣️', color: '#4dd9f0' },
  infrastructure: { label: 'Altyapı', icon: '⚡', color: '#d4a853' },
  landscape: { label: 'Peyzaj', icon: '🌿', color: '#5ee89a' },
  ownership: { label: 'Mülkiyet', icon: '📋', color: '#a78bfa' },
  environment: { label: 'Çevre', icon: '🌍', color: '#34d399' },
  urban_design: { label: 'Kentsel Tasarım', icon: '🏙️', color: '#f472b6' },
};

export const SEVERITY_META: Record<Severity, { label: string; color: string }> = {
  low: { label: 'Düşük', color: '#64748b' },
  medium: { label: 'Orta', color: '#4dd9f0' },
  high: { label: 'Yüksek', color: '#d4a853' },
  critical: { label: 'Kritik', color: '#f87171' },
};
