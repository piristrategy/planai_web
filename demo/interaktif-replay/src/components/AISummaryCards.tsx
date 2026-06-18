import { motion } from 'framer-motion';
import type { AIInsight } from '../utils/aiSummary';

const ACCENT: Record<AIInsight['accent'], string> = {
  cyan: 'border-cyan-glow/30 text-cyan-glow',
  gold: 'border-gold/30 text-gold',
  green: 'border-gps/30 text-gps',
};

type Props = {
  insights: AIInsight[];
  visible: boolean;
  onToggle: () => void;
};

export function AISummaryCards({ insights, visible, onToggle }: Props) {
  return (
    <div className="fixed top-4 right-4 z-30 flex flex-col items-end gap-2 md:top-20 md:right-[420px]">
      <button
        type="button"
        onClick={onToggle}
        className="glass rounded-full px-3 py-1.5 text-xs text-white/70"
      >
        {visible ? 'AI Özetleri Gizle' : 'AI Özetleri'}
      </button>

      {visible &&
        insights.map((ins, i) => (
          <motion.div
            key={ins.id}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className={`glass max-w-[260px] rounded-xl border px-4 py-3 ${ACCENT[ins.accent]}`}
          >
            {ins.metric && <p className="text-xl font-light">{ins.metric}</p>}
            <p className="text-xs leading-relaxed text-white/70">{ins.text}</p>
          </motion.div>
        ))}
    </div>
  );
}
