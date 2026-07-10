import { useEffect } from 'react';
import { normalizeLyricsTiming, parseLyrics } from '../../lib/lyrics-parser';
import { reportError } from '../../lib/report-error';
import { getLyricsForTrack } from '../../lib/tauri-commands';
import { usePlayerStore } from '../../store/player-store';

export function useCurrentTrackLyrics(autoLyrics: boolean) {
  const currentTrack = usePlayerStore((state) => state.currentTrack);
  const setLyrics = usePlayerStore((state) => state.setLyrics);

  useEffect(() => {
    let cancelled = false;
    const loadLyrics = async () => {
      if (!currentTrack) {
        setLyrics(null);
        return;
      }

      try {
        const lyricsContent = await getLyricsForTrack(
          currentTrack.filePath,
          autoLyrics,
          currentTrack.artist,
          currentTrack.title,
          currentTrack.album,
          currentTrack.duration,
        );
        if (cancelled) return;
        if (lyricsContent) {
          const parsed = parseLyrics(lyricsContent);
          setLyrics(
            normalizeLyricsTiming(
              parsed,
              currentTrack.duration > 0 ? currentTrack.duration * 1000 : undefined,
            ),
          );
        } else {
          setLyrics(null);
        }
      } catch (error) {
        if (!cancelled) {
          reportError('Failed to load lyrics', { source: 'lyrics', error });
          setLyrics(null);
        }
      }
    };

    void loadLyrics();
    return () => {
      cancelled = true;
    };
  }, [autoLyrics, currentTrack, setLyrics]);
}
