import { motion } from 'framer-motion';
import type { FieldReport } from '../types/report';
import { formatDate, formatDuration } from '../utils/geo';

type Props = {
  report: FieldReport;
  onStartReplay: () => void;
  onExploreTimeline: () => void;
};

export function IntroHero({ report, onStartReplay, onExploreTimeline }: Props) {
  const { project, stats } = report;

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-navy-950">
      <div className="absolute inset-0 spatial-grid opacity-60" />
      <div className="absolute inset-0 bg-gradient-to-br from-navy-950 via-navy-900/95 to-navy-800/80" />

      {/* Animated route glow */}
      <svg className="absolute inset-0 h-full w-full opacity-30" preserveAspectRatio="none">
        <defs>
          <linearGradient id="routeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#4dd9f0" stopOpacity="0" />
            <stop offset="50%" stopColor="#4dd9f0" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#d4a853" stopOpacity="0" />
          </linearGradient>
        </defs>
        <motion.path
          d="M -50 400 Q 200 200 400 350 T 800 250 T 1200 400 T 1600 300"
          fill="none"
          stroke="url(#routeGrad)"
          strokeWidth="3"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 3, ease: 'easeInOut' }}
        />
        <motion.path
          d="M 100 600 Q 350 450 550 500 T 950 420 T 1400 550"
          fill="none"
          stroke="rgba(94,232,154,0.4)"
          strokeWidth="2"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 4, delay: 0.5, ease: 'easeInOut' }}
        />
      </svg>

      {/* Particles */}
      {Array.from({ length: 24 }).map((_, i) => (
        <motion.div
          key={i}
          className="absolute h-1 w-1 rounded-full bg-cyan-glow/40"
          style={{ left: `${(i * 17) % 100}%`, top: `${(i * 23) % 100}%` }}
          animate={{
            y: [0, -30, 0],
            opacity: [0.2, 0.8, 0.2],
          }}
          transition={{ duration: 3 + (i % 3), repeat: Infinity, delay: i * 0.15 }}
        />
      ))}

      <div className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="mb-8"
        >
          <div className="mb-4 flex items-center justify-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-navy-800 glow-cyan">
              <span className="text-xl font-bold text-gold">P</span>
            </div>
            <div className="text-left">
              <p className="text-xs tracking-[0.3em] text-cyan-glow/80 uppercase">PlanAI Field</p>
              <p className="text-sm text-white/50">{project.org}</p>
            </div>
          </div>

          <h1 className="mb-2 text-4xl font-light tracking-tight text-white md:text-5xl lg:text-6xl">
            {project.title}
          </h1>
          <p className="text-lg text-white/60">{formatDate(project.date)}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4"
        >
          {[
            { label: 'Mesafe', value: `${stats.distanceKm} km` },
            { label: 'Fotoğraf', value: String(stats.photoCount) },
            { label: 'Not', value: String(stats.noteCount) },
            { label: 'Süre', value: formatDuration(stats.durationMs) },
          ].map((s) => (
            <div key={s.label} className="glass rounded-2xl px-5 py-4 min-w-[120px]">
              <p className="text-2xl font-light text-white">{s.value}</p>
              <p className="text-xs tracking-wider text-white/50 uppercase">{s.label}</p>
            </div>
          ))}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
          className="flex flex-col gap-3 sm:flex-row"
        >
          <button
            type="button"
            onClick={onStartReplay}
            className="rounded-full bg-gradient-to-r from-cyan-glow/90 to-cyan-glow px-8 py-4 text-sm font-semibold tracking-wide text-navy-950 glow-cyan transition hover:scale-[1.02] active:scale-[0.98]"
          >
            Denetim Tekrarını Başlat
          </button>
          <button
            type="button"
            onClick={onExploreTimeline}
            className="glass rounded-full px-8 py-4 text-sm font-medium text-white/90 transition hover:bg-white/10"
          >
            Zaman Çizelgesini Keşfet
          </button>
        </motion.div>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="mt-12 max-w-md text-sm text-white/40"
        >
          Mekânsal hikâye anlatımı ve saha tekrar platformu — denetim yolculuğunu baştan sona yaşayın.
        </motion.p>
      </div>
    </div>
  );
}
