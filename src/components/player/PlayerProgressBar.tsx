import { clsx } from 'clsx';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSmoothTimeSubscription } from '../../contexts/smooth-time';
import { formatTime } from '../../lib/format-time';
import { useRenderLog } from '../../lib/performance';
import { seekToPosition } from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import { usePlayerStore } from '../../store/player-store';
import { useSettingsStore } from '../../store/settings-store';

interface PlayerProgressBarProps {
  className?: string;
  variant?: 'default' | 'mini';
  showLabels?: boolean;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function updateNeoFill(
  fillEl: HTMLDivElement | null,
  thumbEl: HTMLDivElement | null,
  labelEl: HTMLSpanElement | null,
  timeSec: number,
  duration: number,
  showLabels: boolean,
) {
  const percent = duration > 0 ? (timeSec / duration) * 100 : 0;
  if (fillEl) {
    fillEl.style.width = `${percent}%`;
    fillEl.style.background = 'var(--signal-play)';
  }
  if (thumbEl) thumbEl.style.left = `${percent}%`;
  if (showLabels && labelEl) labelEl.textContent = formatTime(timeSec);
}

export const PlayerProgressBar = memo(
  ({ className, variant = 'default', showLabels = false }: PlayerProgressBarProps) => {
    useRenderLog('PlayerProgressBar');
    const theme = useSettingsStore((s) => s.theme);
    const isNeobrutalism = theme === 'neobrutalism';
    const { duration } = usePlayerStore(
      useShallow((s) => ({
        duration: s.duration,
      })),
    );

    const [isHovering, setIsHovering] = useState(false);
    const [isSeeking, setIsSeeking] = useState(false);

    const isSeekingRef = useRef(false);
    const seekValueRef = useRef(0);
    const fillRef = useRef<HTMLDivElement>(null);
    const thumbRef = useRef<HTMLDivElement>(null);
    const currentLabelRef = useRef<HTMLSpanElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const activePointerRef = useRef<number | null>(null);

    useSmoothTimeSubscription((timeSec) => {
      if (isSeekingRef.current) return;

      const validTime = Math.max(0, Math.min(timeSec, duration || 1));
      const percent = duration > 0 ? (validTime / duration) * 100 : 0;

      if (fillRef.current) fillRef.current.style.width = `${percent}%`;
      if (thumbRef.current) thumbRef.current.style.left = `${percent}%`;
      if (inputRef.current) inputRef.current.value = validTime.toString();

      if (isNeobrutalism && fillRef.current) {
        fillRef.current.style.background = 'var(--signal-play)';
      }

      if (currentLabelRef.current && (showLabels || isNeobrutalism)) {
        currentLabelRef.current.textContent = formatTime(validTime);
      }
    });

    const clientXToTime = useCallback(
      (clientX: number): number => {
        const el = trackRef.current;
        if (!el || duration <= 0) return 0;
        const rect = el.getBoundingClientRect();
        const ratio = rect.width > 0 ? clamp01((clientX - rect.left) / rect.width) : 0;
        return ratio * duration;
      },
      [duration],
    );

    const applySeekVisual = useCallback(
      (timeSec: number) => {
        updateNeoFill(
          fillRef.current,
          thumbRef.current,
          currentLabelRef.current,
          timeSec,
          duration,
          showLabels,
        );
      },
      [duration, showLabels],
    );

    const finishSeek = useCallback(async (value: number) => {
      if (!isSeekingRef.current) return;
      isSeekingRef.current = false;
      activePointerRef.current = null;
      setIsSeeking(false);
      try {
        await seekToPosition(value);
      } catch (e) {
        reportError('Failed to seek playback', { source: 'player-progress', error: e });
      }
    }, []);

    const onNeoPointerDown = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (duration <= 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        activePointerRef.current = e.pointerId;
        isSeekingRef.current = true;
        setIsSeeking(true);
        const t = clientXToTime(e.clientX);
        seekValueRef.current = t;
        applySeekVisual(t);
      },
      [applySeekVisual, clientXToTime, duration],
    );

    const onNeoPointerMove = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (!isSeekingRef.current || activePointerRef.current !== e.pointerId) return;
        const t = clientXToTime(e.clientX);
        seekValueRef.current = t;
        applySeekVisual(t);
      },
      [applySeekVisual, clientXToTime],
    );

    const onNeoPointerUp = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (activePointerRef.current !== e.pointerId) return;
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        activePointerRef.current = null;
        void finishSeek(seekValueRef.current);
      },
      [finishSeek],
    );

    const onNeoPointerCancel = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (activePointerRef.current !== e.pointerId) return;
        activePointerRef.current = null;
        void finishSeek(seekValueRef.current);
      },
      [finishSeek],
    );

    const onNeoKeyDown = useCallback(
      (e: React.KeyboardEvent<HTMLDivElement>) => {
        if (duration <= 0) return;
        if (!isSeekingRef.current) {
          seekValueRef.current = usePlayerStore.getState().currentTime;
        }
        const step = Math.max(1, duration / 100);
        let next = seekValueRef.current;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
          e.preventDefault();
          next = Math.max(0, next - step);
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
          e.preventDefault();
          next = Math.min(duration, next + step);
        } else if (e.key === 'Home') {
          e.preventDefault();
          next = 0;
        } else if (e.key === 'End') {
          e.preventDefault();
          next = duration;
        } else {
          return;
        }
        seekValueRef.current = next;
        applySeekVisual(next);
        void seekToPosition(next).catch((err) =>
          reportError('Failed to seek playback', {
            source: 'player-progress-keyboard',
            error: err,
          }),
        );
      },
      [applySeekVisual, duration],
    );

    const handlePointerDown = useCallback((e: React.PointerEvent<HTMLInputElement>) => {
      isSeekingRef.current = true;
      setIsSeeking(true);
      seekValueRef.current = parseFloat((e.target as HTMLInputElement).value);
    }, []);

    const handlePointerMove = useCallback(
      (e: React.PointerEvent<HTMLInputElement>) => {
        if (!isSeekingRef.current) return;
        const val = parseFloat((e.target as HTMLInputElement).value);
        seekValueRef.current = val;

        const percent = duration > 0 ? (val / duration) * 100 : 0;
        if (fillRef.current) fillRef.current.style.width = `${percent}%`;
        if (thumbRef.current) thumbRef.current.style.left = `${percent}%`;

        if (showLabels && currentLabelRef.current) {
          currentLabelRef.current.textContent = formatTime(val);
        }
      },
      [duration, showLabels],
    );

    const handleInputChange = useCallback(
      async (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseFloat(e.target.value);
        seekValueRef.current = val;

        const percent = duration > 0 ? (val / duration) * 100 : 0;
        if (fillRef.current) fillRef.current.style.width = `${percent}%`;
        if (thumbRef.current) thumbRef.current.style.left = `${percent}%`;

        if (showLabels && currentLabelRef.current) {
          currentLabelRef.current.textContent = formatTime(val);
        }

        if (!isSeekingRef.current) {
          try {
            await seekToPosition(val);
          } catch (err) {
            reportError('Failed to seek playback', { source: 'player-progress', error: err });
          }
        }
      },
      [duration, showLabels],
    );

    const handlePointerUp = useCallback(async () => {
      if (!isSeekingRef.current) return;
      isSeekingRef.current = false;
      setIsSeeking(false);
      try {
        await seekToPosition(seekValueRef.current);
      } catch (err) {
        reportError('Failed to seek playback', { source: 'player-progress', error: err });
      }
    }, []);

    useEffect(() => {
      if (!isSeeking || isNeobrutalism) return;
      const handleGlobalPointerUp = () => {
        if (!isSeekingRef.current) return;
        isSeekingRef.current = false;
        setIsSeeking(false);
        void seekToPosition(seekValueRef.current).catch((err) =>
          reportError('Failed to seek playback', { source: 'player-progress', error: err }),
        );
      };
      window.addEventListener('pointerup', handleGlobalPointerUp);
      return () => window.removeEventListener('pointerup', handleGlobalPointerUp);
    }, [isNeobrutalism, isSeeking]);

    if (isNeobrutalism) {
      const ticks = Array.from({ length: 11 }, (_, i) => i);
      const rail = (
        <div className={clsx('mb-1 w-full relative', variant === 'mini' && 'mb-0')}>
          <div
            ref={trackRef}
            role="slider"
            tabIndex={0}
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.max(0, duration)}
            aria-valuenow={0}
            className="neo-seek-track w-full"
            onPointerDown={onNeoPointerDown}
            onPointerMove={onNeoPointerMove}
            onPointerUp={onNeoPointerUp}
            onPointerCancel={onNeoPointerCancel}
            onKeyDown={onNeoKeyDown}
          >
            <div
              ref={fillRef}
              className="neo-seek-fill"
              style={{ width: '0%', background: 'var(--signal-play)' }}
            />
            {ticks.map((i) => (
              <div key={i} className="neo-seek-tick" style={{ left: `${i * 10}%` }} />
            ))}
            <div ref={thumbRef} className="neo-seek-badge z-10" style={{ left: '0%' }}>
              <span ref={currentLabelRef}>0:00</span>
            </div>
          </div>
          {showLabels && (
            <div className="flex justify-between text-[11px] font-mono text-[#888888] font-bold uppercase tracking-[0.1em] mt-1">
              <span>0:00</span>
              <span>{formatTime(duration)}</span>
            </div>
          )}
        </div>
      );
      return <div className={clsx('w-full', className)}>{rail}</div>;
    }

    if (variant === 'mini') {
      return (
        <div className={clsx('w-full relative overflow-hidden h-[2px] bg-white/10', className)}>
          <div
            ref={fillRef}
            className="h-full transition-none will-change-[width]"
            style={{
              width: '0%',
              background:
                'linear-gradient(90deg, var(--hero-accent) 0%, color-mix(in oklch, var(--hero-accent) 70%, white) 100%)',
              boxShadow: '0 0 14px var(--hero-glow)',
            }}
          />
          <input
            ref={inputRef}
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            defaultValue={0}
            onChange={handleInputChange}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer touch-none"
            aria-label="Seek"
          />
        </div>
      );
    }

    return (
      <div className={clsx('w-full', className)}>
        <div
          className="mb-1 group w-full relative"
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
        >
          <div className="relative w-full h-3 flex items-center cursor-pointer">
            <div className="w-full h-[3px] bg-white/15 rounded-full overflow-hidden group-hover:h-[5px] transition-all duration-200">
              <div
                ref={fillRef}
                className="h-full bg-white/80 group-hover:bg-white transition-none will-change-[width]"
                style={{ width: '0%' }}
              />
            </div>
            <div
              ref={thumbRef}
              className={clsx(
                'absolute h-4 w-4 bg-white rounded-full shadow-lg top-1/2 -translate-y-1/2 -translate-x-2 pointer-events-none transition-opacity duration-200 will-change-[left]',
                isHovering ? 'opacity-100' : 'opacity-0',
              )}
              style={{ left: '0%' }}
            />
            <input
              ref={inputRef}
              type="range"
              min={0}
              max={duration || 1}
              step={0.1}
              defaultValue={0}
              onChange={handleInputChange}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer touch-none"
              aria-label="Seek"
            />
          </div>
          {showLabels && (
            <div className="flex justify-between text-[11px] font-mono text-text-muted mt-1">
              <span ref={currentLabelRef}>0:00</span>
              <span>{formatTime(duration)}</span>
            </div>
          )}
        </div>
      </div>
    );
  },
);

interface PlayerTimeDisplayProps {
  className?: string;
  format?: 'current' | 'total' | 'slash';
}

export const PlayerTimeDisplay = memo(
  ({ className, format = 'current' }: PlayerTimeDisplayProps) => {
    useRenderLog('PlayerTimeDisplay');
    const theme = useSettingsStore((s) => s.theme);
    const isNeobrutalism = theme === 'neobrutalism';
    const { duration } = usePlayerStore(
      useShallow((s) => ({
        duration: s.duration,
      })),
    );

    const timeRef = useRef<HTMLSpanElement>(null);

    useSmoothTimeSubscription((timeSec) => {
      if (!timeRef.current) return;
      if (format === 'total') return;
      timeRef.current.textContent = formatTime(timeSec);
    });

    if (format === 'slash') {
      return (
        <div className={clsx('flex items-center gap-1.5 font-mono tabular-nums', className)}>
          <span ref={timeRef}>0:00</span>
          <span className={isNeobrutalism ? 'text-black' : 'text-white/30'}>/</span>
          <span>{formatTime(duration)}</span>
        </div>
      );
    }

    if (format === 'total') {
      return (
        <span className={clsx('font-mono tabular-nums', className)}>{formatTime(duration)}</span>
      );
    }

    return (
      <span ref={timeRef} className={clsx('font-mono tabular-nums', className)}>
        0:00
      </span>
    );
  },
);
