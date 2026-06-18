import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FieldReport, ReplayMode, ReplayState } from '../types/report';
import type { TimelineEvent } from '../types/report';
import { getTrack, interpolatePath } from '../utils/geo';

type UseReplayEngineOptions = {
  report: FieldReport;
  timeline: TimelineEvent[];
  onEventReached?: (index: number) => void;
  onPositionChange?: (pos: { lat: number; lon: number }, routeIndex: number) => void;
};

export function useReplayEngine({
  report,
  timeline,
  onEventReached,
  onPositionChange,
}: UseReplayEngineOptions) {
  const track = getTrack(report);
  const path = track?.path ?? [];
  const rafRef = useRef<number>(0);
  const lastRef = useRef<number>(0);
  const progressRef = useRef(0);
  const firedRef = useRef<Set<number>>(new Set());

  const [state, setState] = useState<ReplayState>({
    playing: false,
    progress: 0,
    speed: 1,
    mode: 'cinematic',
    activeEventIndex: 0,
    position: path[0] ? { lat: path[0].lat, lon: path[0].lon } : null,
    routeIndex: 0,
  });

  const eventTimes = useMemo(() => {
    if (!path.length) return timeline.map((_, i) => ({ index: i, t: i / Math.max(1, timeline.length - 1) }));
    const start = new Date(path[0].ts).getTime();
    const end = new Date(path[path.length - 1].ts).getTime();
    const span = end - start || 1;
    return timeline.map((e, i) => ({
      index: i,
      t: Math.min(1, Math.max(0, (new Date(e.ts).getTime() - start) / span)),
    }));
  }, [path, timeline]);

  const tick = useCallback(
    (now: number) => {
      if (!lastRef.current) lastRef.current = now;
      const dt = (now - lastRef.current) / 1000;
      lastRef.current = now;

      const durationSec = Math.max(30, (report.stats.durationMs || 60000) / 1000);
      progressRef.current = Math.min(1, progressRef.current + (dt / durationSec) * state.speed);

      const pos = interpolatePath(path, progressRef.current);
      onPositionChange?.({ lat: pos.lat, lon: pos.lon }, pos.index);

      eventTimes.forEach(({ index, t }) => {
        if (progressRef.current >= t && !firedRef.current.has(index)) {
          firedRef.current.add(index);
          onEventReached?.(index);
          setState((s) => ({ ...s, activeEventIndex: index }));
        }
      });

      setState((s) => ({
        ...s,
        progress: progressRef.current,
        position: { lat: pos.lat, lon: pos.lon },
        routeIndex: pos.index,
      }));

      if (progressRef.current < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setState((s) => ({ ...s, playing: false }));
      }
    },
    [eventTimes, onEventReached, onPositionChange, path, report.stats.durationMs, state.speed],
  );

  useEffect(() => {
    if (state.playing) {
      lastRef.current = 0;
      rafRef.current = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(rafRef.current);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [state.playing, tick]);

  const play = useCallback(() => {
    if (progressRef.current >= 1) {
      progressRef.current = 0;
      firedRef.current.clear();
    }
    setState((s) => ({ ...s, playing: true }));
  }, []);

  const pause = useCallback(() => setState((s) => ({ ...s, playing: false })), []);

  const toggle = useCallback(() => {
    setState((s) => {
      if (!s.playing && progressRef.current >= 1) {
        progressRef.current = 0;
        firedRef.current.clear();
      }
      return { ...s, playing: !s.playing };
    });
  }, []);

  const setSpeed = useCallback((speed: number) => setState((s) => ({ ...s, speed })), []);

  const setMode = useCallback((mode: ReplayMode) => setState((s) => ({ ...s, mode })), []);

  const seek = useCallback(
    (progress: number) => {
      progressRef.current = Math.min(1, Math.max(0, progress));
      firedRef.current.clear();
      eventTimes.forEach(({ index, t }) => {
        if (progressRef.current >= t) firedRef.current.add(index);
      });
      const active = [...eventTimes].reverse().find((e) => progressRef.current >= e.t)?.index ?? 0;
      const pos = interpolatePath(path, progressRef.current);
      setState((s) => ({
        ...s,
        progress: progressRef.current,
        activeEventIndex: active,
        position: { lat: pos.lat, lon: pos.lon },
        routeIndex: pos.index,
      }));
    },
    [eventTimes, path],
  );

  const goToEvent = useCallback(
    (index: number) => {
      const et = eventTimes.find((e) => e.index === index);
      if (et) seek(et.t);
      setState((s) => ({ ...s, activeEventIndex: index, playing: false }));
    },
    [eventTimes, seek],
  );

  const nextEvent = useCallback(() => {
    const next = Math.min(timeline.length - 1, state.activeEventIndex + 1);
    goToEvent(next);
  }, [goToEvent, state.activeEventIndex, timeline.length]);

  const prevEvent = useCallback(() => {
    const prev = Math.max(0, state.activeEventIndex - 1);
    goToEvent(prev);
  }, [goToEvent, state.activeEventIndex]);

  return {
    state,
    play,
    pause,
    toggle,
    setSpeed,
    setMode,
    seek,
    goToEvent,
    nextEvent,
    prevEvent,
    path,
  };
}
