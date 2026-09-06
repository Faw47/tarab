import { clsx } from 'clsx';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSmoothTimeSubscription, useSmoothTimeValue } from '../../contexts/smooth-time';
import { getCurrentLineIndex, getDisplayLines } from '../../lib/lyrics-parser';
import { useRenderLog } from '../../lib/performance';
import { captureActivePlaybackSource, seekToPosition } from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import { getCoverArtPalette } from '../../lib/tauri-commands';
import { usePlayerStore } from '../../store/player-store';
import { useSettingsStore } from '../../store/settings-store';
import type { ParsedLyrics } from '../../types';
import { LyricsLine } from './LyricsLine';

// Utility moved to top
const hexToRgba = (hex: string, alpha: number): string => {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6) return `rgba(255, 255, 255, ${alpha})`;
  const r = parseInt(cleaned.slice(0, 2), 16);
  const g = parseInt(cleaned.slice(2, 4), 16);
  const b = parseInt(cleaned.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

const updateKaraokeWordProgress = (
  container: HTMLDivElement | null,
  lyrics: ParsedLyrics,
  currentLineIndex: number,
  timeMs: number,
) => {
  if (
    !container ||
    !lyrics.isEnhanced ||
    currentLineIndex < 0 ||
    currentLineIndex >= lyrics.lines.length
  ) {
    return;
  }

  const currentLine = lyrics.lines[currentLineIndex];
  if (currentLine.words.length === 0) return;

  const wordSpans = container.querySelectorAll<HTMLSpanElement>('[data-karaoke-word]');
  wordSpans.forEach((span, wordIdx) => {
    const word = currentLine.words[wordIdx];
    if (!word) return;
    const duration = Math.max(10, word.endTime - word.startTime);
    const progress = Math.min(1, Math.max(0, (timeMs - word.startTime) / duration));

    if (progress <= 0) {
      span.style.backgroundSize = '0% 100%, 100% 100%';
      span.style.textShadow = 'none';
      span.style.filter = 'none';
    } else if (progress >= 1) {
      span.style.backgroundSize = '100% 100%, 100% 100%';
      span.style.textShadow = 'none';
      span.style.filter = 'none';
    } else {
      span.style.backgroundSize = `${progress * 100}% 100%, 100% 100%`;
    }
  });
};
const KARAOKE_DEBUG =
  __DEV__ &&
  typeof localStorage !== 'undefined' &&
  localStorage.getItem('KARAOKE_DEBUG') === 'true';

interface LyricsDisplayProps {
  lyricSize?: number;
  lyricAlignment?: 'left' | 'center' | 'right';
}

export const LyricsDisplay = memo(
  ({ lyricSize = 50, lyricAlignment = 'center' }: LyricsDisplayProps) => {
    useRenderLog('LyricsDisplay');
    const { lyrics, isPlaying, currentTrack } = usePlayerStore(
      useShallow((s) => ({
        lyrics: s.lyrics,
        isPlaying: s.isPlaying,
        currentTrack: s.currentTrack,
      })),
    );
    const lyricsEnabled = useSettingsStore((s) => s.lyricsEnabled);

    const smoothTime = useSmoothTimeValue();

    // Keep line selection in React state, while the hot playback clock remains
    // imperative and shared with every other visible progress surface.
    const [currentLineIndex, setCurrentLineIndex] = useState(() => {
      if (!lyrics || lyrics.lines.length === 0) return -1;
      return getCurrentLineIndex(lyrics, smoothTime.timeSec * 1000);
    });

    const lyricsContainerRef = useRef<HTMLDivElement>(null);
    const [glowColor, setGlowColor] = useState<string>('#fbbf24'); // Default gold

    const updatePlaybackSurface = useCallback(
      (timeSec: number) => {
        if (!lyrics) return;
        const timeMs = Math.max(0, timeSec) * 1000;
        const nextLineIndex = getCurrentLineIndex(lyrics, timeMs);
        setCurrentLineIndex((previous) => (previous === nextLineIndex ? previous : nextLineIndex));
        if (isPlaying) {
          updateKaraokeWordProgress(lyricsContainerRef.current, lyrics, nextLineIndex, timeMs);
        }
      },
      [isPlaying, lyrics],
    );

    useSmoothTimeSubscription(updatePlaybackSurface);

    // Reconcile immediately when the lyric source or transport mode changes;
    // a paused source may not produce another clock tick after this render.
    useEffect(() => {
      if (!lyrics || lyrics.lines.length === 0) {
        setCurrentLineIndex(-1);
        return;
      }
      const idx = getCurrentLineIndex(lyrics, smoothTime.timeSec * 1000);
      setCurrentLineIndex((previous) => (previous === idx ? previous : idx));
    }, [isPlaying, lyrics, smoothTime]);
    // Optimize glow color variations with useMemo to avoid recalc per render
    const glowColors = useMemo(() => {
      // Lighten the glow color for the highlighted text
      const cleaned = glowColor.replace('#', '');
      const r = parseInt(cleaned.slice(0, 2), 16);
      const g = parseInt(cleaned.slice(2, 4), 16);
      const b = parseInt(cleaned.slice(4, 6), 16);
      const lightenedR = Math.min(255, Math.round(r * 0.9 + 255 * 0.1));
      const lightenedG = Math.min(255, Math.round(g * 0.9 + 255 * 0.1));
      const lightenedB = Math.min(255, Math.round(b * 0.9 + 255 * 0.1));
      const highlightedColor = `rgb(${lightenedR}, ${lightenedG}, ${lightenedB})`;

      return {
        highlight: highlightedColor,
        glow1: hexToRgba(glowColor, 0.55),
        glow2: hexToRgba(glowColor, 0.45),
        glow3: hexToRgba(glowColor, 0.35),
        shadow: hexToRgba(glowColor, 0.35),
        textGlow1: hexToRgba(glowColor, 0.4),
        textGlow2: hexToRgba(glowColor, 0.25),
      };
    }, [glowColor]);

    // Sample color from cover art
    useEffect(() => {
      if (!currentTrack?.filePath) {
        setGlowColor('#fbbf24'); // Default gold
        return;
      }

      let cancelled = false;
      const loadColor = async () => {
        try {
          const palette = await getCoverArtPalette(currentTrack.filePath);
          if (!cancelled && palette?.primary) {
            setGlowColor(palette.primary);
          } else if (!cancelled) {
            setGlowColor('#fbbf24');
          }
        } catch (error) {
          if (!cancelled) {
            setGlowColor('#fbbf24');
          }
        }
      };

      loadColor();
      return () => {
        cancelled = true;
      };
    }, [currentTrack?.filePath]);

    const displayLines = useMemo(() => {
      if (!lyrics || lyrics.lines.length === 0) return [];
      return getDisplayLines(lyrics, currentLineIndex);
    }, [lyrics, currentLineIndex]);

    const handleLineClick = useCallback(async (startTimeMs: number) => {
      if (startTimeMs < 0) return;
      const positionSecs = startTimeMs / 1000;
      const expectedSource = captureActivePlaybackSource();
      if (!expectedSource) return;
      try {
        await seekToPosition(positionSecs, expectedSource);
      } catch (error) {
        reportError('Failed to seek', { source: 'lyrics-display', error });
      }
    }, []);

    const handleWordClick = useCallback(async (startTimeMs: number, e: React.MouseEvent) => {
      e.stopPropagation();
      const positionSecs = startTimeMs / 1000;
      const expectedSource = captureActivePlaybackSource();
      if (!expectedSource) return;
      try {
        await seekToPosition(positionSecs, expectedSource);
      } catch (error) {
        reportError('Failed to seek', { source: 'lyrics-display', error });
      }
    }, []);

    if (!lyricsEnabled) {
      return null;
    }

    if (!lyrics || lyrics.lines.length === 0) {
      return (
        <div className="flex items-center justify-center h-full">
          <p className="text-text-muted text-lg">No lyrics available</p>
        </div>
      );
    }

    return (
      <div
        className="w-full h-full overflow-hidden relative"
        style={{
          maskImage:
            'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
          WebkitMaskImage:
            'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
        }}
      >
        <div
          ref={lyricsContainerRef}
          className={clsx(
            'absolute inset-0 flex flex-col justify-center pointer-events-none',
            lyricAlignment === 'left'
              ? 'items-start'
              : lyricAlignment === 'right'
                ? 'items-end'
                : 'items-center',
          )}
        >
          <div
            className={clsx(
              'flex flex-col gap-6 w-full max-w-4xl px-4 lyrics-font pointer-events-auto',
            )}
          >
            {displayLines.map((item, slotIdx) => {
              if (!item.line) {
                return (
                  <div
                    key={`empty-${slotIdx}`}
                    className="h-10 md:h-12 w-full select-none"
                    aria-hidden="true"
                  >
                    &nbsp;
                  </div>
                );
              }

              const { line, isCurrent } = item;
              const isNeighbor = Math.abs(slotIdx - 2) === 1;
              const isFar = Math.abs(slotIdx - 2) === 2;

              const hasWordTimings = line.words.length > 1 || (line.runs?.length ?? 0) > 0;
              const useKaraoke = !!(lyrics.isEnhanced && hasWordTimings && isCurrent);

              return (
                <LyricsLine
                  key={`${line.startTime}-${slotIdx}`}
                  line={line}
                  isCurrent={isCurrent}
                  isNeighbor={isNeighbor}
                  isFar={isFar}
                  glowColors={glowColors}
                  onLineClick={handleLineClick}
                  onWordClick={handleWordClick}
                  useKaraoke={useKaraoke}
                  lyricSize={lyricSize}
                  lyricAlignment={lyricAlignment}
                />
              );
            })}
          </div>
        </div>
        {KARAOKE_DEBUG && (
          <div className="fixed bottom-4 left-4 z-50 rounded-lg bg-black/70 text-white text-xs px-3 py-2 pointer-events-none">
            <div>idx: {currentLineIndex}</div>
          </div>
        )}
      </div>
    );
  },
);

LyricsDisplay.displayName = 'LyricsDisplay';
