import { clsx } from 'clsx';
import { memo, useCallback, useRef, useState } from 'react';
import { seekToPosition } from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import { usePlayerStore } from '../../store/player-store';
import { useSettingsStore } from '../../store/settings-store';
import { usePrefersReducedMotion } from '../ui/liquid-glass';

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const formatTime = (sec: number): string => {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

interface HidingProgressBarProps {
  accentColor?: string;
  className?: string;
}

/**
 * HidingProgressBar
 * A seek bar that "hides in plain sight" by showing only a persistent accent dot
 * until hovered or dragged. Positioned at the very top of its container.
 * Extracted from the original HomeView.tsx Hero.
 */
export const HidingProgressBar = memo(
  ({ accentColor = 'var(--hero-accent)', className }: HidingProgressBarProps) => {
    const duration = usePlayerStore((s) => s.duration);
    const currentTime = usePlayerStore((s) => s.currentTime);
    const reducedEffects = useSettingsStore((s) => s.reducedEffects);
    const prefersReducedMotion = usePrefersReducedMotion();
    const reduceMotion = reducedEffects || prefersReducedMotion;
    const [isDragging, setIsDragging] = useState(false);
    const [isHovering, setIsHovering] = useState(false);
    const [dragVal, setDragVal] = useState(0);
    const barRef = useRef<HTMLDivElement>(null);
    const activePid = useRef<number | null>(null);

    const display = isDragging ? dragVal : currentTime;
    const pct = duration > 0 ? clamp01(display / duration) * 100 : 0;
    const edgeSafePct = Math.max(0.75, Math.min(99.25, pct));
    const tooltipPct = Math.max(6, Math.min(94, pct));
    const showTooltip = isDragging || isHovering;

    const timeAt = (clientX: number): number => {
      if (!barRef.current || duration <= 0) return 0;
      const r = barRef.current.getBoundingClientRect();
      return clamp01((clientX - r.left) / r.width) * duration;
    };

    const seek = useCallback(
      async (t: number) => {
        try {
          await seekToPosition(Math.max(0, Math.min(duration || 0, t)));
        } catch (e) {
          reportError('seek failed', { source: 'hiding-progress-bar', error: e });
        }
      },
      [duration],
    );

    const onPointerDown = (e: React.PointerEvent) => {
      if (!barRef.current || duration <= 0) return;
      e.preventDefault();
      activePid.current = e.pointerId;
      barRef.current.setPointerCapture(e.pointerId);
      setDragVal(timeAt(e.clientX));
      setIsDragging(true);
    };

    const onPointerMove = (e: React.PointerEvent) => {
      if (!isDragging || activePid.current !== e.pointerId) return;
      setDragVal(timeAt(e.clientX));
    };

    const onPointerUp = async (e: React.PointerEvent) => {
      if (activePid.current !== e.pointerId) return;
      activePid.current = null;
      const t = timeAt(e.clientX);
      setDragVal(t);
      if (barRef.current?.hasPointerCapture(e.pointerId))
        barRef.current.releasePointerCapture(e.pointerId);
      try {
        await seek(t);
      } finally {
        setIsDragging(false);
      }
    };

    const onPointerCancel = (e: React.PointerEvent) => {
      if (barRef.current?.hasPointerCapture(e.pointerId))
        barRef.current.releasePointerCapture(e.pointerId);
      activePid.current = null;
      setIsDragging(false);
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (duration <= 0) return;
      const sm = Math.max(1, duration * 0.01);
      const lg = Math.max(5, duration * 0.05);
      let next = display;
      let hit = true;
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowDown':
          next = Math.max(0, display - sm);
          break;
        case 'ArrowRight':
        case 'ArrowUp':
          next = Math.min(duration, display + sm);
          break;
        case 'PageDown':
          next = Math.max(0, display - lg);
          break;
        case 'PageUp':
          next = Math.min(duration, display + lg);
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = duration;
          break;
        default:
          hit = false;
      }
      if (!hit) return;
      e.preventDefault();
      void seek(next);
    };

    return (
      <div className={clsx('absolute inset-x-0 top-0 z-50 h-6', className)}>
        {/* Persistent accent dot - always visible, fades when seek bar shows */}
        <div
          className={clsx(
            'absolute top-0 z-20 pointer-events-none',
            !reduceMotion && 'transition-opacity duration-[var(--motion-standard)]',
          )}
          style={{ left: `${edgeSafePct}%` }}
        >
          <div
            className={clsx(
              'w-[6px] h-[6px] rounded-full -translate-x-1/2 -translate-y-[1px]',
              !reduceMotion && 'transition-opacity duration-[var(--motion-standard)]',
              isDragging ? 'opacity-0' : 'opacity-55 group-hover:opacity-0',
            )}
            style={{ background: accentColor, boxShadow: `0 0 7px ${accentColor}cc` }}
          />
        </div>

        {/* Seek bar (hover + drag reveal) */}
        <div
          ref={barRef}
          className={clsx(
            'absolute inset-x-0 top-0 z-30 h-full min-h-5 select-none touch-none cursor-pointer',
            !reduceMotion && 'transition-opacity duration-[var(--motion-fast)]',
            isDragging
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none group-hover:opacity-100 group-focus-within:opacity-100 group-hover:pointer-events-auto group-focus-within:pointer-events-auto',
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onPointerEnter={() => setIsHovering(true)}
          onPointerLeave={() => setIsHovering(false)}
          onKeyDown={onKeyDown}
          tabIndex={duration > 0 ? 0 : -1}
          role="slider"
          aria-label="Seek"
          aria-valuenow={Math.round(display)}
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuetext={`${formatTime(display)} of ${formatTime(duration)}`}
        >
          {/* Track */}
          <div className="absolute inset-x-0 top-0 h-[2px] bg-white/[0.09]" />
          {/* Fill */}
          <div
            className={clsx(
              'absolute left-0 top-0 h-[2px]',
              !reduceMotion && 'transition-[width] duration-[var(--motion-fast)] ease-out',
            )}
            style={{
              width: `${pct}%`,
              backgroundColor: accentColor,
              boxShadow: `0 0 8px ${accentColor}88`,
            }}
          />
          {/* Knob */}
          <div
            className={clsx(
              'absolute top-0 w-3.5 h-3.5 rounded-full shadow-md',
              '-translate-y-[calc(50%-1px)] -translate-x-1/2',
              !reduceMotion && 'transition-transform duration-[var(--motion-standard)]',
              isDragging
                ? 'scale-100'
                : 'scale-0 group-hover:scale-100 group-focus-within:scale-100',
            )}
            style={{ left: `${edgeSafePct}%`, background: accentColor }}
          />
          {/* Floating time tooltip */}
          <div
            className={clsx(
              'absolute z-40 top-4 -translate-x-1/2 px-2 py-0.5 rounded-md',
              'text-[12px] font-mono tabular-nums text-white/90',
              'bg-black/80 backdrop-blur-md shadow-lg',
              'pointer-events-none',
              !reduceMotion && 'transition-opacity duration-[var(--motion-fast)]',
              showTooltip ? 'opacity-100' : 'opacity-0',
            )}
            style={{ left: `${tooltipPct}%` }}
          >
            {formatTime(display)}
          </div>
        </div>
      </div>
    );
  },
);

HidingProgressBar.displayName = 'HidingProgressBar';
