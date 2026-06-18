import { motion } from 'framer-motion';

type Props = {
  playing: boolean;
  progress: number;
  speed: number;
  mode: 'cinematic' | 'manual';
  onToggle: () => void;
  onSpeedChange: (s: number) => void;
  onModeChange: (m: 'cinematic' | 'manual') => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (p: number) => void;
};

const SPEEDS = [0.5, 1, 1.5, 2, 3];

export function ReplayControls({
  playing,
  progress,
  speed,
  mode,
  onToggle,
  onSpeedChange,
  onModeChange,
  onPrev,
  onNext,
  onSeek,
}: Props) {
  return (
    <motion.div
      initial={{ y: 80, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      className="fixed bottom-6 left-1/2 z-40 w-[min(100vw-2rem,560px)] -translate-x-1/2 rounded-2xl glass-strong px-5 py-4 glow-cyan"
    >
      <div className="mb-3 flex items-center gap-3">
        <input
          type="range"
          min={0}
          max={100}
          value={progress * 100}
          onChange={(e) => onSeek(Number(e.target.value) / 100)}
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-cyan-glow"
        />
        <span className="font-mono text-xs text-white/50">{Math.round(progress * 100)}%</span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button type="button" onClick={onPrev} className="rounded-lg p-2 hover:bg-white/10" aria-label="Önceki">
            ⏮
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-glow text-navy-950 glow-cyan"
            aria-label={playing ? 'Duraklat' : 'Oynat'}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <button type="button" onClick={onNext} className="rounded-lg p-2 hover:bg-white/10" aria-label="Sonraki">
            ⏭
          </button>
        </div>

        <div className="flex items-center gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSpeedChange(s)}
              className={`rounded-lg px-2 py-1 text-xs ${
                speed === s ? 'bg-cyan-glow/20 text-cyan-glow' : 'text-white/50 hover:bg-white/10'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>

        <div className="flex rounded-lg bg-white/5 p-0.5">
          {(['cinematic', 'manual'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onModeChange(m)}
              className={`rounded-md px-2 py-1 text-[10px] uppercase tracking-wider ${
                mode === m ? 'bg-cyan-glow/20 text-cyan-glow' : 'text-white/40'
              }`}
            >
              {m === 'cinematic' ? 'Sinematik' : 'Manuel'}
            </button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
