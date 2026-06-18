import { motion, AnimatePresence } from 'framer-motion';
import type { TimelineEvent } from '../types/report';
import { formatTime } from '../utils/geo';
import { CATEGORY_META, SEVERITY_META } from '../utils/categories';

type Props = {
  event: TimelineEvent | null;
  index: number;
  total: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
};

export function DetailCard({ event, index, total, onClose, onPrev, onNext }: Props) {
  const feat = event?.feat;
  const category = feat && 'category' in feat && feat.category ? CATEGORY_META[feat.category] : null;
  const severity = event?.severity ? SEVERITY_META[event.severity] : null;

  return (
    <AnimatePresence>
      {event && (
        <motion.div
          initial={{ opacity: 0, x: 40, scale: 0.96 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 40, scale: 0.96 }}
          transition={{ type: 'spring', damping: 26, stiffness: 280 }}
          className="fixed z-40 w-[min(100vw-2rem,400px)] overflow-hidden rounded-2xl glass-strong glow-cyan bottom-24 right-4 top-auto md:bottom-auto md:top-4 md:right-4"
        >
          {event.previewUrl && (
            <div className="relative aspect-video w-full overflow-hidden bg-navy-900">
              <img src={event.previewUrl} alt={event.title} className="h-full w-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-navy-950/80 to-transparent" />
              <div className="absolute bottom-3 left-3 font-mono text-xs text-white/80">
                {formatTime(event.ts)}
              </div>
            </div>
          )}

          <div className="p-5">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] tracking-widest text-cyan-glow/70 uppercase">Detay Kartı</p>
                <h3 className="text-lg font-medium text-white">{event.title}</h3>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
                aria-label="Kapat"
              >
                ✕
              </button>
            </div>

            <div className="mb-4 flex flex-wrap gap-2">
              {category && (
                <span
                  className="rounded-full px-2.5 py-1 text-xs"
                  style={{ background: `${category.color}22`, color: category.color }}
                >
                  {category.icon} {category.label}
                </span>
              )}
              {severity && (
                <span
                  className="rounded-full px-2.5 py-1 text-xs"
                  style={{ background: `${severity.color}22`, color: severity.color }}
                >
                  {severity.label}
                </span>
              )}
            </div>

            <p className="mb-4 text-sm leading-relaxed text-white/65">{event.subtitle}</p>

            <div className="mb-4 rounded-xl bg-white/[0.04] p-3 text-xs text-white/50">
              <p>
                📍 {event.lat.toFixed(6)}, {event.lon.toFixed(6)}
              </p>
              <p className="mt-1">🕐 {formatTime(event.ts)}</p>
            </div>

            <div className="mb-4 rounded-xl border border-gold/20 bg-gold/5 p-3">
              <p className="text-[10px] tracking-wider text-gold uppercase">AI Özeti</p>
              <p className="mt-1 text-sm text-white/75">
                {event.kind === 'photo'
                  ? 'Saha fotoğrafı konumla eşleştirildi; denetim rotası üzerinde belgeleme noktası.'
                  : 'Gözlem notu saha koordinatlarıyla ilişkilendirildi; zaman çizelgesinde kronolojik sırada.'}
              </p>
            </div>

            <p className="mb-4 text-xs text-white/40">Denetmen: PlanAI Field · PiriStrategy</p>

            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={onPrev}
                disabled={index <= 0}
                className="glass rounded-lg px-4 py-2 text-sm disabled:opacity-30"
              >
                ← Önceki
              </button>
              <span className="text-xs text-white/40">
                {index + 1} / {total}
              </span>
              <button
                type="button"
                onClick={onNext}
                disabled={index >= total - 1}
                className="glass rounded-lg px-4 py-2 text-sm disabled:opacity-30"
              >
                Sonraki →
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
