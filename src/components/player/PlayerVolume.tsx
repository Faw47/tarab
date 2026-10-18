import { Volume2, VolumeX } from 'lucide-react';
import { memo, useCallback } from 'react';
import { Slider, SliderThumb, SliderTrack } from 'react-aria-components';
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
    <div className="flex items-center gap-3 w-32 md:w-48">
      <Slider
        value={volume}
        onChange={handleVolumeChange}
        minValue={0}
        maxValue={1}
        step={0.01}
        aria-label="Volume"
        className="flex items-center gap-3 w-full group"
      >
        <button
          onClick={(e) => {
            e.preventDefault();
            handleToggleMute();
          }}
          className="text-text-muted hover:text-text-primary transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
          aria-label={isMuted(volume) ? 'Unmute' : 'Mute'}
        >
          {isMuted(volume) ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
        </button>

        <SliderTrack className="relative w-full h-1.5 bg-white/10 rounded-full cursor-pointer overflow-hidden">
          {({ state }) => (
            <>
              {/* Progress bar background */}
              <div
                className="absolute h-full bg-primary/80 group-hover:bg-primary transition-colors"
                style={{ width: `${state.getThumbPercent(0) * 100}%` }}
              />
              <SliderThumb className="block w-3 h-3 bg-white rounded-full shadow-lg border border-white/20 focus-visible:ring-4 focus-visible:ring-primary/40 focus:outline-none transition-transform hover:scale-125 top-1/2 -translate-y-1/2" />
            </>
          )}
        </SliderTrack>
      </Slider>
    </div>
  );
});

PlayerVolume.displayName = 'PlayerVolume';
