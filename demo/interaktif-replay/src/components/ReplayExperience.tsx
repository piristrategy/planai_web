import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FieldReport } from '../types/report';
import type { TimelineEvent } from '../types/report';
import { ReplayMap } from './ReplayMap';
import { TimelinePanel } from './TimelinePanel';
import { DetailCard } from './DetailCard';
import { ReplayControls } from './ReplayControls';
import { AISummaryCards } from './AISummaryCards';
import { useReplayEngine } from '../hooks/useReplayEngine';
import { generateInsights } from '../utils/aiSummary';

type Props = {
  report: FieldReport;
  timeline: TimelineEvent[];
  mode: 'replay' | 'explore';
  autoPlay: boolean;
  onBack: () => void;
};

export function ReplayExperience({ report, timeline, mode, autoPlay, onBack }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [timelineCollapsed, setTimelineCollapsed] = useState(false);
  const [aiVisible, setAiVisible] = useState(true);

  const onEventReached = useCallback(
    (index: number) => {
      const ev = timeline[index];
      if (ev && (ev.kind === 'photo' || ev.kind === 'note')) {
        setSelectedId(ev.id);
      }
    },
    [timeline],
  );

  const replay = useReplayEngine({ report, timeline, onEventReached });
  const insights = useMemo(() => generateInsights(report, timeline), [report, timeline]);

  useEffect(() => {
    if (autoPlay && mode === 'replay') {
      const t = setTimeout(() => replay.play(), 400);
      return () => clearTimeout(t);
    }
  }, [autoPlay, mode, replay]);

  const selectedIndex = timeline.findIndex((e) => e.id === selectedId);
  const selectedEvent = selectedIndex >= 0 ? timeline[selectedIndex] : null;

  const handleSelectEvent = useCallback(
    (index: number) => {
      replay.goToEvent(index);
      const ev = timeline[index];
      if (ev) setSelectedId(ev.id);
    },
    [replay, timeline],
  );

  const handleMapSelect = useCallback(
    (id: string) => {
      setSelectedId(id);
      const idx = timeline.findIndex((e) => e.id === id);
      if (idx >= 0) replay.goToEvent(idx);
    },
    [replay, timeline],
  );

  return (
    <>
      <ReplayMap
        report={report}
        timeline={timeline}
        progress={replay.state.progress}
        position={replay.state.position}
        activeEventIndex={replay.state.activeEventIndex}
        selectedId={selectedId}
        onSelect={handleMapSelect}
        cinematic={replay.state.mode === 'cinematic' && mode === 'replay'}
      />

      <header className="pointer-events-none fixed top-0 right-0 left-0 z-20 flex items-center justify-between px-5 py-4 md:pl-[360px]">
        <div className="pointer-events-auto glass rounded-xl px-4 py-2">
          <p className="text-[10px] tracking-widest text-cyan-glow/70 uppercase">PlanAI Field</p>
          <p className="text-sm font-medium text-white">{report.project.title}</p>
        </div>
        <button
          type="button"
          onClick={onBack}
          className="pointer-events-auto glass rounded-full px-4 py-2 text-xs text-white/70 hover:text-white"
        >
          ← Giriş
        </button>
      </header>

      <TimelinePanel
        events={timeline}
        activeIndex={replay.state.activeEventIndex}
        collapsed={timelineCollapsed}
        onToggleCollapse={() => setTimelineCollapsed((c) => !c)}
        onSelect={handleSelectEvent}
      />

      <AISummaryCards insights={insights} visible={aiVisible} onToggle={() => setAiVisible((v) => !v)} />

      <DetailCard
        event={selectedEvent}
        index={selectedIndex}
        total={timeline.length}
        onClose={() => setSelectedId(null)}
        onPrev={() => {
          replay.prevEvent();
          const prev = Math.max(0, selectedIndex - 1);
          setSelectedId(timeline[prev]?.id ?? null);
        }}
        onNext={() => {
          replay.nextEvent();
          const next = Math.min(timeline.length - 1, selectedIndex + 1);
          setSelectedId(timeline[next]?.id ?? null);
        }}
      />

      <ReplayControls
        playing={replay.state.playing}
        progress={replay.state.progress}
        speed={replay.state.speed}
        mode={replay.state.mode}
        onToggle={replay.toggle}
        onSpeedChange={replay.setSpeed}
        onModeChange={replay.setMode}
        onPrev={replay.prevEvent}
        onNext={replay.nextEvent}
        onSeek={replay.seek}
      />
    </>
  );
}
