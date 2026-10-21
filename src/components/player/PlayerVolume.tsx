import * as SliderPrimitive from '@radix-ui/react-slider';
import { Volume2, VolumeX } from 'lucide-react';
import { memo, useCallback } from 'react';
import { useRenderLog } from '../../lib/performance';
import { applyVolume, isMuted, toggleMute } from '../../lib/volume';
import { usePlayerStore } from '../../store/player-store';

export const PlayerVolume = memo(() => {
  useRenderLog('PlayerVolume');
  const volume = usePlayerStore((s) => s.volume);

  const handleVolumeChange = useCallback((newVolume: number) => {
    void applyVolume(newVolume, 'player-volume');
  }, []);

  const handleToggleMute = useCallback(() => {
    void toggleMute('player-volume');
  }, []);

  return (
    <div className="flex w-32 items-center gap-3 md:w-48">
      <button
        type="button"
        onClick={handleToggleMute}
        className="shrink-0 rounded-sm text-text-muted transition-colors hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={isMuted(volume) ? 'Unmute' : 'Mute'}
      >
        {isMuted(volume) ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
      </button>

      <SliderPrimitive.Root
        value={[volume]}
        onValueChange={(values) => {
          const nextVolume = values[0];
          if (nextVolume !== undefined) handleVolumeChange(nextVolume);
        }}
        min={0}
        max={1}
        step={0.01}
        className="group relative flex h-6 min-w-0 flex-1 touch-none select-none items-center"
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full cursor-pointer overflow-hidden rounded-full bg-white/10">
          <SliderPrimitive.Range className="absolute h-full bg-primary/80 transition-colors group-hover:bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          aria-label="Volume"
          className="block h-3 w-3 rounded-full border border-white/20 bg-white shadow-lg transition-transform hover:scale-125 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/40"
        />
      </SliderPrimitive.Root>
    </div>
  );
});

PlayerVolume.displayName = 'PlayerVolume';
