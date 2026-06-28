import { clsx } from 'clsx';
import { memo, useRef } from 'react';
import { useSettingsStore } from '../../store/settings-store';
import type { LyricLine } from '../../types';

interface GlowColors {
  highlight: string;
  glow1: string;
  glow2: string;
  glow3: string;
  shadow: string;
  textGlow1: string;
  textGlow2: string;
}

interface LyricsLineProps {
  line: LyricLine;
  isCurrent: boolean;
  isNeighbor: boolean;
  isFar: boolean;
  glowColors: GlowColors;
  onLineClick: (time: number) => void;
  onWordClick: (time: number, e: React.MouseEvent) => void;
  useKaraoke: boolean;
  lyricSize: number;
  lyricAlignment: 'left' | 'center' | 'right';
}

export const LyricsLine = memo(
  ({
    line,
    isCurrent,
    isNeighbor,
    glowColors,
    onLineClick,
    onWordClick,
    useKaraoke,
    lyricSize,
    lyricAlignment,
  }: LyricsLineProps) => {
    const reducedEffects = useSettingsStore((s) => s.reducedEffects);
    const containerRef = useRef<HTMLDivElement>(null);

    // Word animations are handled by parent LyricsDisplay via direct DOM updates

    // Calculate dynamic font size based on lyricSize (1-100, default 50)
    // Base size (50) should be approx 32px (text-4xl) on desktop
    // Range: ~12px to ~80px
    const baseFontSize = Math.max(12, 32 + (lyricSize - 50) * 0.6);
    const fontSize = isCurrent ? baseFontSize : baseFontSize * 0.75;
    const textAlign =
      lyricAlignment === 'left'
        ? 'text-left'
        : lyricAlignment === 'right'
          ? 'text-right'
          : 'text-center';

    // Render
    return (
      <div
        ref={containerRef}
        className={clsx(
          'transition-all duration-400 ease-out w-full py-2',
          textAlign,
          isCurrent && 'scale-[1.02] origin-left',
          isNeighbor && 'scale-[1.0]',
        )}
        style={{
          opacity: isCurrent ? 1 : isNeighbor ? 0.7 : 0.45,
          filter: 'none',
          transform: 'translateZ(0)',
          willChange: isCurrent ? 'transform, opacity' : 'opacity',
        }}
        role="button"
        tabIndex={0}
        aria-label={`Seek to ${line.text}`}
        aria-current={isCurrent ? 'true' : undefined}
        onClick={() => onLineClick(line.startTime)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onLineClick(line.startTime);
          }
        }}
      >
        {(() => {
          if (!useKaraoke) {
            return (
              <span
                className={clsx(
                  'transition-colors duration-300 block leading-tight font-bold',
                  isCurrent ? 'text-text-primary' : 'font-semibold text-text-secondary',
                )}
                style={{
                  fontSize: `${fontSize}px`,
                  textShadow:
                    isCurrent && !reducedEffects ? `0 0 24px ${glowColors.textGlow1}` : undefined,
                  willChange: 'text-shadow',
                }}
              >
                {line.text}
              </span>
            );
          }

          const runs = line.runs || [
            {
              word: { text: line.text, startTime: line.startTime, endTime: line.endTime },
              prefix: '',
            },
          ];
          const unhighlightedColor = 'rgba(248, 250, 252, 0.45)';

          return (
            <span
              className="inline-block font-bold text-text-primary leading-tight"
              style={{ fontSize: `${fontSize}px` }}
            >
              {runs.map((run, wordIdx: number) => {
                const { word } = run;

                return (
                  <span
                    key={`${wordIdx}-${word.startTime}`}
                    className="inline relative whitespace-pre-wrap"
                  >
                    {run.prefix ? (
                      <span aria-hidden="true" className="inline opacity-50">
                        {run.prefix}
                      </span>
                    ) : null}
                    <span
                      data-karaoke-word
                      data-word-start={word.startTime}
                      data-word-end={word.endTime}
                      onClick={(e) => onWordClick(word.startTime, e)}
                      className="relative inline cursor-pointer select-none px-[1px] mx-[-1px] rounded-sm box-decoration-clone"
                      style={{
                        pointerEvents: 'auto',
                        backgroundImage: `linear-gradient(to right, ${glowColors.highlight}, ${glowColors.highlight}), linear-gradient(to right, ${unhighlightedColor}, ${unhighlightedColor})`,
                        backgroundSize: '0% 100%, 100% 100%',
                        backgroundRepeat: 'no-repeat, no-repeat',
                        backgroundPosition: 'left top, left top',
                        WebkitBackgroundClip: 'text',
                        backgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        color: 'transparent',
                        transition: 'text-shadow 0.2s ease, filter 0.2s ease',
                      }}
                    >
                      {word.text}
                    </span>
                    {run.suffix ? (
                      <span aria-hidden="true" className="inline opacity-50">
                        {run.suffix}
                      </span>
                    ) : null}
                  </span>
                );
              })}
            </span>
          );
        })()}
      </div>
    );
  },
);

LyricsLine.displayName = 'LyricsLine';
