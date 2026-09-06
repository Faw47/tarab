import { Mic2 } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSmoothTimeSubscription, useSmoothTimeValue } from '../../contexts/smooth-time';
import { usePlayerStore } from '../../store/player-store';
import type { ParsedLyrics } from '../../types';

export function getCurrentLyricLine(lyrics: ParsedLyrics | null, timeSec: number): string | null {
  if (!lyrics?.lines.length) return null;
  const timeMs = timeSec * 1000;
  for (let index = lyrics.lines.length - 1; index >= 0; index -= 1) {
    if (timeMs >= lyrics.lines[index].startTime) return lyrics.lines[index].text;
  }
  return null;
}

export const MiniPlayerLyrics = memo(() => {
  const { lyrics, isPlaying } = usePlayerStore(
    useShallow((s) => ({
      lyrics: s.lyrics,
      isPlaying: s.isPlaying,
    })),
  );
  const { timeSec } = useSmoothTimeValue();
  const [currentLyricLine, setCurrentLyricLine] = useState<string | null>(() =>
    getCurrentLyricLine(lyrics, timeSec),
  );

  const updateCurrentLyricLine = useCallback(
    (nextTimeSec: number) => {
      const nextLine = getCurrentLyricLine(lyrics, nextTimeSec);
      setCurrentLyricLine((previous) => (previous === nextLine ? previous : nextLine));
    },
    [lyrics],
  );

  useSmoothTimeSubscription(updateCurrentLyricLine);

  useEffect(() => {
    updateCurrentLyricLine(timeSec);
  }, [timeSec, updateCurrentLyricLine]);

  if (!currentLyricLine) return null;

  return (
    <div className="mt-1.5 flex items-center gap-2 overflow-hidden">
      <Mic2 className="w-3 h-3 text-primary shrink-0" />
      <p
        className={
          isPlaying
            ? 'text-xs truncate transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-emphasis)] text-primary/[0.9]'
            : 'text-xs truncate transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-emphasis)] text-text-muted'
        }
        title={currentLyricLine}
      >
        {currentLyricLine}
      </p>
    </div>
  );
});

MiniPlayerLyrics.displayName = 'MiniPlayerLyrics';
