import { useCallback, useMemo } from 'react';
import { useLibraryData } from '../../features/library/useLibraryData';
import { getAlbumKey } from '../../lib/album-key';
import { startPlayback } from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import { sortAlbumTracks } from '../../lib/track-order';
import type { Track } from '../../types';

export function useHomeLibraryModel() {
  const { tracks, libraryStats } = useLibraryData();

  const albumTracksByKey = useMemo(() => {
    const map = new Map<string, Track[]>();
    for (const track of tracks) {
      const key = getAlbumKey(track);
      const existing = map.get(key);
      if (existing) existing.push(track);
      else map.set(key, [track]);
    }
    return map;
  }, [tracks]);

  const albums = useMemo(
    () =>
      Array.from(albumTracksByKey.entries())
        .filter(([, albumTracks]) => albumTracks.length > 0)
        .map(([key, albumTracks]) => ({
          key,
          track: albumTracks[0],
          count: albumTracks.length,
          tracks: albumTracks,
        })),
    [albumTracksByKey],
  );

  const playAlbum = useCallback(async (_track: Track, albumTracks: Track[]) => {
    const ordered = sortAlbumTracks(albumTracks);
    if (!ordered.length) return;
    try {
      await startPlayback(ordered[0], { queue: ordered, queueIndex: 0, shuffleEnabled: false });
    } catch (error) {
      reportError('play album failed', { source: 'home-view', error });
    }
  }, []);

  return { tracks, libraryStats, albumTracksByKey, albums, playAlbum };
}
