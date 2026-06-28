import clsx from 'clsx';
import { Pause, Play } from 'lucide-react';
import type React from 'react';
import { memo, useCallback, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { toggleCurrentPlayback } from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import { usePlayerStore } from '../../store/player-store';
import { CoverArtImage } from '../shared/CoverArtImage';

interface PillMiniPlayerProps {
  onExpand: () => void;
}

const RING_SIZE = 58;
const RING_STROKE = 2.5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const ProgressRing = memo(() => {
  const currentTime = usePlayerStore((s) => s.currentTime);
  const duration = usePlayerStore((s) => s.duration);

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const dashOffset = RING_CIRCUMFERENCE * (1 - progress);

  return (
    <svg
      className="absolute inset-0 -rotate-90 pointer-events-none"
      width={RING_SIZE}
      height={RING_SIZE}
      viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
    >
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={RING_STROKE}
      />
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        stroke="var(--color-primary)"
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={dashOffset}
        className="transition-[stroke-dashoffset] duration-300 ease-out"
      />
    </svg>
  );
});
ProgressRing.displayName = 'ProgressRing';

export const PillMiniPlayer = memo(({ onExpand }: PillMiniPlayerProps) => {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const { isPlaying } = usePlayerStore(
    useShallow((s) => ({
      isPlaying: s.isPlaying,
    })),
  );
  const [isHovered, setIsHovered] = useState(false);

  const handleTogglePlay = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        if (!currentTrack) return;
        await toggleCurrentPlayback();
      } catch (e) {
        reportError('Failed to toggle playback', { source: 'pill-mini-player', error: e });
      }
    },
    [currentTrack],
  );

  if (!currentTrack) return null;

  return (
    <div
      className="fixed bottom-6 left-6 z-40 group cursor-pointer"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        onClick={onExpand}
        className={clsx(
          'relative overflow-hidden',
          'transition-all duration-200',
          isHovered && 'scale-110',
          isPlaying && !isHovered && 'animate-breathe',
        )}
        style={{ width: RING_SIZE, height: RING_SIZE }}
      >
        <div
          className="absolute inset-1 rounded-full blur-xl opacity-70 pointer-events-none"
          style={{ background: 'var(--hero-glow)' }}
        />

        <ProgressRing />

        <div
          className={clsx(
            'absolute rounded-full overflow-hidden',
            'bg-black/[0.88] border border-white/10',
            'shadow-[0_8px_30px_rgba(0,0,0,0.45)]',
          )}
          style={{
            top: RING_STROKE + 1,
            left: RING_STROKE + 1,
            right: RING_STROKE + 1,
            bottom: RING_STROKE + 1,
          }}
        >
          <CoverArtImage
            track={currentTrack}
            className="absolute inset-0 w-full h-full"
            imgClassName="absolute inset-0 w-full h-full object-cover"
            roundedClassName="rounded-full"
            iconClassName="w-5 h-5"
            lazy={false}
          />

          <div
            className={clsx(
              'absolute inset-0 flex items-center justify-center bg-black/[0.42] backdrop-blur-md',
              'transition-opacity duration-200',
              isHovered ? 'opacity-100' : 'opacity-0',
            )}
          >
            <button
              onClick={handleTogglePlay}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white/[0.18] hover:bg-white/[0.28] transition-colors duration-200 active:scale-[0.9] shadow-[0_0_18px_var(--hero-glow)]"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="w-3.5 h-3.5 text-white" fill="currentColor" />
              ) : (
                <Play className="w-3.5 h-3.5 text-white ml-0.5" fill="currentColor" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Hover tooltip with track info */}
      <div
        className={clsx(
          'absolute left-full ml-3 top-1/2 -translate-y-1/2 px-3 py-2',
          'backdrop-blur-xl rounded-xl text-xs whitespace-nowrap',
          'border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.42)]',
          'transition-all duration-200',
          isHovered ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2 pointer-events-none',
        )}
        style={{
          background: 'linear-gradient(180deg, rgba(20,15,12,0.86) 0%, rgba(10,10,10,0.94) 100%)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.08)',
        }}
      >
        <p className="text-white font-medium text-[11px] truncate max-w-[160px]">
          {currentTrack.title}
        </p>
        <p className="text-white/[0.55] text-[10px] truncate max-w-[160px]">
          {currentTrack.artist}
        </p>
      </div>
    </div>
  );
});

PillMiniPlayer.displayName = 'PillMiniPlayer';
