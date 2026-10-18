import { memo, useRef } from 'react';
import { useSmoothTimeSubscription } from '../../contexts/smooth-time';
import { formatTime } from '../../lib/format-time';
import { cn } from '../../lib/utils';
import { usePlayerStore } from '../../store/player-store';

/**
 * Elapsed and total time. The elapsed part is written to the DOM from the smooth-time loop once
 * per second instead of re-rendering on every frame.
 */
export const PlayerTimeReadout = memo(function PlayerTimeReadout({
  className,
}: {
  className?: string;
}) {
  const duration = usePlayerStore((s) => s.duration);
  const initialTime = usePlayerStore.getState().currentTime;
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const shownSecondRef = useRef(Math.floor(initialTime));

  useSmoothTimeSubscription((timeSec) => {
    const second = Math.floor(timeSec);
    if (second === shownSecondRef.current || !elapsedRef.current) return;
    shownSecondRef.current = second;
    elapsedRef.current.textContent = formatTime(second);
  });

  return (
    <div className={cn('font-mono text-xs tabular-nums text-white/60', className)}>
      <span ref={elapsedRef} data-testid="player-elapsed">
        {formatTime(initialTime)}
      </span>
      <span aria-hidden="true"> / </span>
      <span data-testid="player-duration">{formatTime(duration)}</span>
    </div>
  );
});
