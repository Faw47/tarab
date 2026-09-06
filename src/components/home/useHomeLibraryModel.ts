import { useCallback, useMemo } from 'react';
import { fetchAlbumTracks } from '../../features/library/api';
import { useLibraryData } from '../../features/library/useLibraryData';
import { getAlbumArtist, getAlbumKey } from '../../lib/album-key';
import { startPlayback } from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import { sortAlbumTracks } from '../../lib/track-order';
import type { Track } from '../../types';

export async function fetchCompleteAlbumTracks(album: string, artist: string): Promise<Track[]> {
  return sortAlbumTracks(await fetchAlbumTracks(album, artist));
}

export function useHomeLibraryModel() {
  const {
    tracks,
    libraryStats,
    albumAggregates,
    librarySecondaryError,
    isLibrarySecondaryLoading,
    retryLibrarySecondaryData,
  } = useLibraryData();

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

  const albums = useMemo(() => {
    if (albumAggregates.length > 0) {
      return albumAggregates.map((aggregate) => {
        const key = getAlbumKey(aggregate.track);
        return {
          key,
          track: aggregate.track,
          count: aggregate.count,
          tracks: albumTracksByKey.get(key) ?? [],
        };
      });
    }

    return Array.from(albumTracksByKey.entries())
      .filter(([, albumTracks]) => albumTracks.length > 0)
      .map(([key, albumTracks]) => ({
        key,
        track: albumTracks[0],
        count: albumTracks.length,
        tracks: albumTracks,
      }));
  }, [albumAggregates, albumTracksByKey]);

  const playAlbum = useCallback(async (track: Track, _albumTracks: Track[]) => {
    try {
      const ordered = await fetchCompleteAlbumTracks(track.album, getAlbumArtist(track));
      if (!ordered.length) return;
      await startPlayback(ordered[0], { queue: ordered, queueIndex: 0, shuffleEnabled: false });
    } catch (error) {
      reportError('play album failed', { source: 'home-view', error });
    }
  }, []);

  return {
    tracks,
    libraryStats,
    albumAggregates,
    librarySecondaryError,
    isLibrarySecondaryLoading,
    retryLibrarySecondaryData,
    albumTracksByKey,
    albums,
    playAlbum,
  };
}
