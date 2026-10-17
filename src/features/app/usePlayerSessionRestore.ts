import { useEffect, useRef } from 'react';
import type { NavView } from '../../components/navigation';
import {
  dbGetTracksByAlbumArtist,
  dbGetTracksByIds,
  setPlaybackSpeed as setAudioPlaybackSpeed,
  setVolume as setAudioVolume,
} from '../../lib/tauri-commands';
import { usePlayerStore } from '../../store/player-store';
import type { Track } from '../../types';
import type { AlbumDetailsState } from './app-state-types';
import { loadPlayerStateFromStore, markPlayerStateHydrated } from './player-state-store';

const toTrack = (track: {
  id: string;
  title: string;
  artist: string;
  albumArtist?: string | null;
  album: string;
  year?: number | null;
  duration: number;
  filePath: string;
  hasCoverArt?: boolean;
  coverArtHash?: string | null;
  dateAdded?: number;
}): Track => ({
  id: track.id,
  title: track.title,
  artist: track.artist,
  albumArtist: track.albumArtist ?? null,
  album: track.album,
  year: track.year ?? null,
  duration: track.duration,
  filePath: track.filePath,
  hasCoverArt: track.hasCoverArt ?? false,
  coverArt: undefined,
  coverArtHash: track.coverArtHash ?? null,
  dateAdded: track.dateAdded ?? 0,
});

export function usePlayerSessionRestore({
  replaceView,
}: {
  replaceView: (view: NavView, options?: { albumDetails?: AlbumDetailsState }) => void;
}) {
  const sessionRestored = useRef(false);

  useEffect(() => {
    if (sessionRestored.current) return;
    sessionRestored.current = true;

    let cancelled = false;
    let finished = false;

    const restoreSession = async () => {
      const session = await loadPlayerStateFromStore();
      if (cancelled || !session) return;

      const player = usePlayerStore.getState();
      const queueIds = Array.isArray(session.queueIds) ? session.queueIds : [];
      const allNeededIds = new Set<string>(queueIds);
      if (session.currentTrackId) allNeededIds.add(session.currentTrackId);

      const trackLookup = new Map<string, Track>();
      if (allNeededIds.size > 0) {
        // A failed lookup must propagate: it triggers the retry, and if the retry also fails the
        // store stays unhydrated so an empty queue cannot overwrite the saved session.
        const fetched = await dbGetTracksByIds(Array.from(allNeededIds));
        if (cancelled) return;
        fetched.forEach((track) => trackLookup.set(track.id, toTrack(track)));
      }

      let restoredQueue: Track[] = [];
      if (queueIds.length > 0) {
        restoredQueue = queueIds
          .map((id) => trackLookup.get(id))
          .filter((track): track is Track => Boolean(track));
        if (restoredQueue.length > 0) {
          player.setQueue(restoredQueue);
          const currentIndex = session.currentTrackId
            ? restoredQueue.findIndex((track) => track.id === session.currentTrackId)
            : -1;
          if (currentIndex >= 0) {
            player.setQueueIndex(currentIndex);
          } else if (typeof session.queueIndex === 'number') {
            player.setQueueIndex(
              Math.min(restoredQueue.length - 1, Math.max(0, session.queueIndex)),
            );
          }
        }
      }

      let resolvedTrack = session.currentTrackId
        ? trackLookup.get(session.currentTrackId)
        : undefined;
      if (!resolvedTrack && typeof session.queueIndex === 'number' && restoredQueue.length > 0) {
        resolvedTrack =
          restoredQueue[Math.min(restoredQueue.length - 1, Math.max(0, session.queueIndex))];
      }

      if (resolvedTrack && restoredQueue.length === 0) {
        player.setQueue([resolvedTrack]);
        player.setQueueIndex(0);
      }

      if (!resolvedTrack && typeof session.currentTime === 'number') {
        player.setCurrentTime(Math.max(0, session.currentTime));
      }

      if (typeof session.playbackSpeed === 'number' && session.playbackSpeed > 0) {
        player.setPlaybackSpeed(session.playbackSpeed);
        setAudioPlaybackSpeed(session.playbackSpeed).catch((err) =>
          console.error('Failed to restore speed:', err),
        );
      }

      if (typeof session.volume === 'number' && session.volume >= 0) {
        const clampedVol = Math.max(0, Math.min(1, session.volume));
        player.setVolume(clampedVol);
        setAudioVolume(clampedVol).catch((err) => console.error('Failed to restore volume:', err));
      }

      player.setShuffleEnabled(!!session.shuffleEnabled);
      player.setLoopMode(
        session.loopMode === 'all' || session.loopMode === 'one' || session.loopMode === 'off'
          ? session.loopMode
          : 'all',
      );
      player.setStopAfterCurrent(!!session.stopAfterCurrent);
      player.setHasActivePlayback(false);
      player.setIsPlaying(false);

      const isNavView = (value: unknown): value is NavView =>
        value === 'home' ||
        value === 'library' ||
        value === 'search' ||
        value === 'queue' ||
        value === 'playlists' ||
        value === 'tags' ||
        value === 'settings' ||
        value === 'album';
      const lastView = isNavView(session.lastView) ? session.lastView : null;

      if (lastView && lastView !== 'album') {
        replaceView(lastView);
      }

      if (session.lastOpenedAlbum && session.lastOpenedArtist) {
        try {
          const albumTracks = await dbGetTracksByAlbumArtist(
            session.lastOpenedAlbum,
            session.lastOpenedArtist,
          );
          if (cancelled) return;
          if (albumTracks.length > 0 && lastView === 'album') {
            replaceView('album', {
              albumDetails: {
                album: session.lastOpenedAlbum,
                artist: session.lastOpenedArtist,
                tracks: albumTracks.map(toTrack),
                coverArt: undefined,
              },
            });
          }
        } catch (err) {
          console.error('Failed to restore album details:', err);
        }
      }

      if (resolvedTrack) {
        player.setCurrentTrack(resolvedTrack);
        player.setDuration(resolvedTrack.duration);
        if (typeof session.currentTime === 'number') {
          const clamped = Math.max(
            0,
            Math.min(
              session.currentTime,
              resolvedTrack.duration > 0
                ? Math.max(0, resolvedTrack.duration - 0.75)
                : session.currentTime,
            ),
          );
          player.setCurrentTime(clamped);
          player.setResumePosition(resolvedTrack.id, clamped);
        }
      }
    };

    const restoreSessionWithRetry = async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await restoreSession();
          if (!cancelled) markPlayerStateHydrated();
          return;
        } catch (err) {
          if (cancelled) return;
          if (attempt === 1) {
            // Leave persistence disabled for this run rather than overwrite the stored session
            // with a partially restored one.
            console.error('Failed to restore session; session saving stays disabled:', err);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
      }
    };

    void restoreSessionWithRetry().finally(() => {
      finished = true;
    });

    return () => {
      cancelled = true;
      // React StrictMode runs effects twice in development; an unfinished restore was cancelled
      // here, so allow the next run to restore. A finished restore must never run again.
      if (!finished) sessionRestored.current = false;
    };
  }, [replaceView]);
}
