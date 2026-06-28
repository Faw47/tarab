import { memo, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePlayerStore } from '../../store/player-store';

export const LyricsSnippet = memo(() => {
  const { lyrics, currentTime } = usePlayerStore(
    useShallow((s) => ({
      lyrics: s.lyrics,
      currentTime: s.currentTime,
    })),
  );

  const activeLine = useMemo(() => {
    if (!lyrics || !lyrics.lines.length) return null;

    // Find the current line based on time
    // We look for the last line that has started
    let current = null;
    for (let i = 0; i < lyrics.lines.length; i++) {
      const line = lyrics.lines[i];
      if (line.startTime / 1000 <= currentTime) {
        current = line;
      } else {
        break;
      }
    }
    return current;
  }, [lyrics, currentTime]);

  if (!activeLine) return null;

  return (
    <div className="w-full h-8 overflow-hidden relative group cursor-default">
      <div
        key={activeLine.startTime}
        className="text-text-secondary/80 text-sm italic animate-fade-in-up truncate"
      >
        <span className="opacity-50 mr-2">♪</span>
        {activeLine.text}
      </div>
    </div>
  );
});

LyricsSnippet.displayName = 'LyricsSnippet';
