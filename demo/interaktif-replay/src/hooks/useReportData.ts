import { useEffect, useState } from 'react';
import type { FieldReport } from '../types/report';
import { buildTimeline, enrichFeat, getEvents } from '../utils/geo';

export function useReportData(url = '/demo/report.json') {
  const [report, setReport] = useState<FieldReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Rapor yüklenemedi (${r.status})`);
        return r.json();
      })
      .then((data: FieldReport) => {
        if (cancelled) return;
        const events = getEvents(data);
        const enriched = data.feats.map((f) => {
          if (f.kind === 'track') return f;
          const idx = events.findIndex((e) => e.id === f.id);
          return enrichFeat(f, idx, events.length);
        });
        setReport({ ...data, feats: enriched });
        setError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const timeline = report ? buildTimeline(report) : [];

  return { report, timeline, error, loading };
}
