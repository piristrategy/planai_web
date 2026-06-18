import { useState } from 'react';
import { IntroHero } from './components/IntroHero';
import { ReplayExperience } from './components/ReplayExperience';
import { useReportData } from './hooks/useReportData';

type Screen = 'intro' | 'replay' | 'explore';

export default function App() {
  const { report, timeline, error, loading } = useReportData();
  const [screen, setScreen] = useState<Screen>('intro');
  const [autoPlay, setAutoPlay] = useState(false);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-navy-950">
        <div className="text-center">
          <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-cyan-glow/30 border-t-cyan-glow" />
          <p className="text-sm text-white/50">Saha raporu yükleniyor…</p>
        </div>
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="flex h-full items-center justify-center bg-navy-950 px-6">
        <div className="glass max-w-md rounded-2xl p-8 text-center">
          <p className="mb-2 text-gold">Rapor yüklenemedi</p>
          <p className="text-sm text-white/50">{error ?? 'Bilinmeyen hata'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden bg-navy-950">
      {screen === 'intro' && (
        <IntroHero
          report={report}
          onStartReplay={() => {
            setAutoPlay(true);
            setScreen('replay');
          }}
          onExploreTimeline={() => {
            setAutoPlay(false);
            setScreen('explore');
          }}
        />
      )}

      {screen !== 'intro' && (
        <ReplayExperience
          report={report}
          timeline={timeline}
          mode={screen}
          autoPlay={autoPlay}
          onBack={() => setScreen('intro')}
        />
      )}
    </div>
  );
}
