import { useCallback, useMemo } from 'react';
import { PlaybackCoordinator } from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import { useHomeLibraryModel } from './useHomeLibraryModel';

/** Shared data and transport intents for both Home skins. */
export function useHomeController(hasCurrentTrack: boolean, source: 'home-view' | 'home-neo') {
  const model = useHomeLibraryModel();
  const { libraryStats, tracks, albums } = model;
  const stats = useMemo(() => {
    if (libraryStats)
      return {
        totalTracks: libraryStats.trackCount,
        totalHours: Math.floor(libraryStats.totalDuration / 3600),
        uniqueArtists: libraryStats.artistCount,
        albumCount: libraryStats.albumCount || albums.length,
      };
    return {
      totalTracks: tracks.length,
      totalHours: Math.floor(tracks.reduce((total, track) => total + track.duration, 0) / 3600),
      uniqueArtists: new Set(tracks.map((track) => track.artist)).size,
      albumCount: albums.length,
    };
  }, [libraryStats, tracks, albums.length]);

  const handleTogglePlay = useCallback(async () => {
    if (!hasCurrentTrack) return;
    try {
      await PlaybackCoordinator.toggle();
    } catch (error) {
      reportError('Could not play or pause', { source, error });
    }
  }, [hasCurrentTrack, source]);
  const handlePrevious = useCallback(async () => {
    try {
      await PlaybackCoordinator.previous();
    } catch (error) {
      reportError('Could not play the previous track', { source, error });
    }
  }, [source]);
  const handleNext = useCallback(async () => {
    try {
      await PlaybackCoordinator.next();
    } catch (error) {
      reportError('Could not play the next track', { source, error });
    }
  }, [source]);

  return {
    ...model,
    stats,
    hasStats: stats.totalTracks > 0,
    handleTogglePlay,
    handlePrevious,
    handleNext,
  };
}
