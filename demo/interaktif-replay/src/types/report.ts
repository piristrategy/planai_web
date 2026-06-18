export type TrackPoint = { lat: number; lon: number; ts: string };

export type PhotoFeat = {
  kind: 'photo';
  id: string;
  label: string;
  lat: number;
  lon: number;
  text: string;
  hasVoice: boolean;
  voiceDuration: number;
  ts: string;
  imageDataUrl?: string;
  category?: ObservationCategory;
  severity?: Severity;
};

export type NoteFeat = {
  kind: 'note';
  id: string;
  label: string;
  lat: number;
  lon: number;
  text: string;
  ts: string;
  hasVoice?: boolean;
  voiceDuration?: number;
  category?: ObservationCategory;
  severity?: Severity;
};

export type TrackFeat = {
  kind: 'track';
  id: string;
  label: string;
  path: TrackPoint[];
  ts: string;
};

export type FieldFeat = PhotoFeat | NoteFeat | TrackFeat;

export type ObservationCategory =
  | 'transportation'
  | 'infrastructure'
  | 'landscape'
  | 'ownership'
  | 'environment'
  | 'urban_design';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

export type ReportBounds = {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
};

export type ReportStats = {
  photoCount: number;
  noteCount: number;
  audioCount: number;
  durationMs: number;
  distanceKm: number;
  eventCount: number;
};

export type FieldReport = {
  project: {
    title: string;
    name: string;
    date: string;
    brand: string;
    org: string;
  };
  bounds: ReportBounds;
  feats: FieldFeat[];
  stats: ReportStats;
};

export type TimelineEvent = {
  id: string;
  kind: 'photo' | 'note' | 'track_start' | 'track_end';
  title: string;
  subtitle: string;
  ts: string;
  lat: number;
  lon: number;
  feat?: PhotoFeat | NoteFeat;
  severity?: Severity;
  hasMedia: boolean;
  hasAudio: boolean;
  previewUrl?: string;
};

export type ReplayMode = 'cinematic' | 'manual';

export type ReplayState = {
  playing: boolean;
  progress: number;
  speed: number;
  mode: ReplayMode;
  activeEventIndex: number;
  position: { lat: number; lon: number } | null;
  routeIndex: number;
};
