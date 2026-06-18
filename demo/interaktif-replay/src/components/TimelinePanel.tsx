import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { TimelineEvent } from '../types/report';
import { formatTime } from '../utils/geo';
import { SEVERITY_META } from '../utils/categories';

const KIND_ICON: Record<string, string> = {
  track_start: '▶',
  track_end: '■',
  photo: '📷',
  note: '📝',
};

type Props = {
  events: TimelineEvent[];
  activeIndex: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelect: (index: number) => void;
};

export function TimelinePanel({
  events,
  activeIndex,
  collapsed,
  onToggleCollapse,
  onSelect,
}: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeIndex]);

  return (
    <>
      <button
        type="button"
        onClick={onToggleCollapse}
        className="fixed top-4 left-4 z-40 glass rounded-full px-4 py-2 text-xs text-white/80 md:hidden"
      >
        {collapsed ? 'Zaman Çizelgesi' : 'Kapat'}
      </button>

      <AnimatePresence>
        {!collapsed && (
          <motion.aside
            initial={{ x: -320, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -320, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 260 }}
            className="fixed top-0 left-0 z-30 flex h-full w-[min(100vw,340px)] flex-col border-r border-white/5 glass-strong pt-16 md:pt-20"
          >
            <div className="border-b border-white/5 px-5 pb-4">
              <p className="text-[10px] tracking-[0.25em] text-cyan-glow/70 uppercase">Görev Günlüğü</p>
              <h2 className="text-lg font-light text-white">Denetim Zaman Çizelgesi</h2>
              <p className="text-xs text-white/40">{events.length} olay</p>
            </div>

            <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-3">
              {events.map((ev, i) => {
                const active = i === activeIndex;
                const sev = ev.severity ? SEVERITY_META[ev.severity] : null;
                return (
                  <motion.button
                    key={ev.id}
                    ref={active ? activeRef : undefined}
                    type="button"
                    onClick={() => onSelect(i)}
                    initial={false}
                    animate={{
                      scale: active ? 1.02 : 1,
                      borderColor: active ? 'rgba(77,217,240,0.5)' : 'rgba(255,255,255,0.06)',
                    }}
                    className={`mb-2 flex w-full items-start gap-3 rounded-xl border p-3 text-left transition ${
                      active ? 'bg-cyan-glow/10 glow-cyan' : 'bg-white/[0.03] hover:bg-white/[0.06]'
                    }`}
                  >
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-lg ${
                        active ? 'bg-cyan-glow/20' : 'bg-navy-800'
                      }`}
                    >
                      {ev.previewUrl ? (
                        <img src={ev.previewUrl} alt="" className="h-full w-full rounded-lg object-cover" />
                      ) : (
                        KIND_ICON[ev.kind] ?? '•'
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-cyan-glow/80">{formatTime(ev.ts)}</span>
                        {sev && (
                          <span
                            className="rounded-full px-1.5 py-0.5 text-[10px]"
                            style={{ background: `${sev.color}22`, color: sev.color }}
                          >
                            {sev.label}
                          </span>
                        )}
                      </div>
                      <p className="truncate text-sm font-medium text-white">{ev.title}</p>
                      <p className="truncate text-xs text-white/45">{ev.subtitle}</p>
                      <div className="mt-1 flex gap-2 text-[10px] text-white/35">
                        {ev.hasMedia && <span>📷 Medya</span>}
                        {ev.hasAudio && <span>🎙️ Ses</span>}
                      </div>
                    </div>
                    {active && (
                      <motion.div
                        className="mt-2 h-2 w-2 shrink-0 rounded-full bg-cyan-glow"
                        animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }}
                        transition={{ repeat: Infinity, duration: 1.5 }}
                      />
                    )}
                  </motion.button>
                );
              })}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
