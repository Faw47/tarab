import { Volume2, VolumeX } from 'lucide-react';
import { memo, useCallback, useRef } from 'react';
import { Slider, SliderThumb, SliderTrack } from 'react-aria-components';
import { useShallow } from 'zustand/react/shallow';
import { useRenderLog } from '../../lib/performance';
import { reportError } from '../../lib/report-error';
import { setVolume as setAudioVolume } from '../../lib/tauri-commands';
import { usePlayerStore } from '../../store/player-store';

export const PlayerVolume = memo(() => {
  useRenderLog('PlayerVolume');
  const { volume, setVolume } = usePlayerStore(
    useShallow((s) => ({
      volume: s.volume,
      setVolume: s.setVolume,
    })),
  );

  const previousVolumeRef = useRef(0.8);

  const handleVolumeChange = useCallback(
    async (newVolume: number) => {
      if (newVolume > 0) previousVolumeRef.current = newVolume;
      setVolume(newVolume);
      try {
        await setAudioVolume(newVolume);
      } catch (e) {
        reportError('Failed to set volume', { source: 'player-volume', error: e });
      }
    },
    [setVolume],
  );

  const handleToggleMute = useCallback(async () => {
    const newVolume = volume > 0 ? 0 : previousVolumeRef.current;
    if (volume > 0) previousVolumeRef.current = volume;
    setVolume(newVolume);
    try {
      await setAudioVolume(newVolume);
    } catch (e) {
      reportError('Failed to set volume', { source: 'player-volume', error: e });
    }
  }, [volume, setVolume]);

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
          aria-label={volume === 0 ? 'Unmute' : 'Mute'}
        >
          {volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
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
