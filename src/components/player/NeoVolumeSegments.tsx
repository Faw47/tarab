import { clsx } from 'clsx';
import { type KeyboardEvent, memo } from 'react';

const SEGMENTS = 10;

interface NeoVolumeSegmentsProps {
  volume: number;
  onChange: (volume: number) => void;
  /** `bar` is the compact 10-cell strip; `popover` is the larger cells in the bar's popover. */
  variant?: 'bar' | 'popover';
}

/**
 * The neobrutalism volume strip as one slider: a single tab stop with arrow, Page, Home and End
 * keys, instead of ten role="button" divs (FE-16). Cells stay clickable with the pointer.
 */
export const NeoVolumeSegments = memo(function NeoVolumeSegments({
  volume,
  onChange,
  variant = 'bar',
}: NeoVolumeSegmentsProps) {
  const percent = Math.round(volume * 100);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = 1 / SEGMENTS;
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = volume + step;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = volume - step;
    else if (event.key === 'PageUp') next = volume + step * 2;
    else if (event.key === 'PageDown') next = volume - step * 2;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 1;
    if (next === null) return;
    event.preventDefault();
    onChange(Math.max(0, Math.min(1, Math.round(next * SEGMENTS) / SEGMENTS)));
  };

  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="Volume"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      aria-valuetext={`${percent}%`}
      aria-orientation="horizontal"
      onKeyDown={handleKeyDown}
      className={variant === 'bar' ? 'neo-volume-wrap' : 'flex gap-1'}
    >
      {Array.from({ length: SEGMENTS }, (_, i) => {
        const segmentValue = (i + 1) / SEGMENTS;
        const active = volume >= segmentValue - 0.05;
        return (
          <div
            key={i}
            aria-hidden="true"
            data-active={active || undefined}
            className={
              variant === 'bar'
                ? clsx('neo-volume-segment', active && 'active')
                : clsx(
                    'h-8 w-6 cursor-pointer border-2 border-black transition-transform hover:-translate-y-1 hover:scale-105',
                    active ? 'bg-[var(--signal-secondary)]' : 'bg-gray-100',
                  )
            }
            onClick={() => onChange(segmentValue)}
          />
        );
      })}
    </div>
  );
});
