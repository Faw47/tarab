import { useCallback } from 'react';
import type { NavView } from '../components/navigation/FloatingDock';
import { startPlayback } from '../lib/playback-actions';
import { reportError } from '../lib/report-error';
import { sortAlbumTracks } from '../lib/track-order';
import type { Track } from '../types';

interface AlbumDetails {
  album: string;
  artist: string;
  coverArt?: string;
  tracks: Track[];
}

interface UseAlbumActionsParams {
  albumDetails: AlbumDetails | null;
  setShowFullPlayer: (show: boolean) => void;
  setAlbumDetails: (details: AlbumDetails | null) => void;
  setCurrentView: (view: NavView) => void;
}

export const useAlbumActions = ({
  albumDetails,
  setShowFullPlayer,
  setAlbumDetails,
  setCurrentView,
}: UseAlbumActionsParams) => {
  const handleOpenAlbumDetails = useCallback(
    (payload: { album: string; artist: string; coverArt?: string; tracks: Track[] }) => {
      setShowFullPlayer(false);
      const sortedTracks = sortAlbumTracks(payload.tracks);
      setAlbumDetails({ ...payload, tracks: sortedTracks });
      setCurrentView('album');
    },
    [setShowFullPlayer, setAlbumDetails, setCurrentView],
  );

  const handlePlayAlbum = useCallback(async () => {
    if (!albumDetails || albumDetails.tracks.length === 0) return;
    const tracks = albumDetails.tracks;
    const first = tracks[0];
    try {
      await startPlayback(first, {
        queue: tracks,
        queueIndex: 0,
        shuffleEnabled: false,
      });
    } catch (err) {
      reportError('Failed to play album', { source: 'app', error: err });
    }
  }, [albumDetails]);

  const handlePlayAlbumTrack = useCallback(
    async (track: Track) => {
      if (!albumDetails || albumDetails.tracks.length === 0) return;
      const tracks = albumDetails.tracks;
      const idx = tracks.findIndex((t) => t.id === track.id);
      try {
        await startPlayback(track, {
          queue: tracks,
          queueIndex: idx >= 0 ? idx : 0,
          shuffleEnabled: false,
        });
      } catch (err) {
        reportError('Failed to play selected album track', { source: 'app', error: err });
      }
    },
    [albumDetails],
  );

  const handleShuffleAlbum = useCallback(async () => {
    if (!albumDetails || albumDetails.tracks.length === 0) return;
    const shuffled = [...albumDetails.tracks].sort(() => Math.random() - 0.5);
    const first = shuffled[0];
    try {
      await startPlayback(first, {
        queue: shuffled,
        queueIndex: 0,
        shuffleEnabled: true,
      });
    } catch (err) {
      reportError('Failed to shuffle-play album', { source: 'app', error: err });
    }
  }, [albumDetails]);

  return {
    handleOpenAlbumDetails,
    handlePlayAlbum,
    handlePlayAlbumTrack,
    handleShuffleAlbum,
  };
};
