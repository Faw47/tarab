import { memo } from 'react';
import { useRenderLog } from '../../lib/performance';
import { usePlayerStore } from '../../store/player-store';
import { PlayerContent } from './PlayerContent';
import { ParallaxProvider } from './PlayerParallax';

interface PlayerViewProps {
  onClose: () => void;
}

export const PlayerView = memo(({ onClose }: PlayerViewProps) => {
  useRenderLog('PlayerViewWrapper');

  // Minimal subscription just to check if track exists
  const currentTrack = usePlayerStore((s) => s.currentTrack);

  if (!currentTrack) return null;

  return (
    <ParallaxProvider>
      <PlayerContent onClose={onClose} />
    </ParallaxProvider>
  );
});

PlayerView.displayName = 'PlayerView';
