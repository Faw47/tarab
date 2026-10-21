import { useEffect, useRef } from 'react';
import type { NavView } from '../../components/navigation';
import {
  dbGetQueueTrackReferences,
  dbGetTracksByAlbumArtist,
  dbGetTracksByIds,
  setAudioBooster,
  setPlaybackSpeed as setAudioPlaybackSpeed,
  setVolume as setAudioVolume,
} from '../../lib/tauri-commands';
import { usePlayerStore } from '../../store/player-store';
import type { Track } from '../../types';
import { createLazyQueueTrack } from '../library/loadTracksForShuffle';
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

/**
 * Maps the saved queue index onto the restored queue. Entries that no longer resolve are dropped,
 * so the saved index shifts left by the number of dropped entries before it. The shifted index is
 * kept when it still points at the saved current track (duplicates in the queue are legal);
 * otherwise the first entry of the current track is used, then the clamped index.
 */
export function restoredQueueIndex(
  queueIds: string[],
  lookup: Map<string, Track>,
  restoredQueue: Track[],
  savedIndex: unknown,
  currentTrackId: string | null | undefined,
): number {
  const last = restoredQueue.length - 1;
  const index = typeof savedIndex === 'number' && Number.isInteger(savedIndex) ? savedIndex : 0;
  const dropped = queueIds.slice(0, Math.max(0, index)).filter((id) => !lookup.has(id)).length;
  const shifted = Math.min(last, Math.max(0, index - dropped));
  if (!currentTrackId || restoredQueue[shifted]?.id === currentTrackId) return shifted;
  const first = restoredQueue.findIndex((track) => track.id === currentTrackId);
  return first >= 0 ? first : shifted;
}

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
      const references = await dbGetQueueTrackReferences(queueIds);
      if (cancelled) return;

      const trackLookup = new Map<string, Track>();
      references.forEach((reference) => {
        trackLookup.set(reference.id, createLazyQueueTrack(reference));
      });

      let restoredCurrentTrack: Track | undefined;
      if (session.currentTrackId) {
        // A failed lookup must propagate: it triggers the retry, and if the retry also fails the
        // store stays unhydrated so an empty queue cannot overwrite the saved session.
        const fetched = await dbGetTracksByIds([session.currentTrackId]);
        if (cancelled) return;
        const current = fetched[0];
        if (current) restoredCurrentTrack = toTrack(current);
      }

      let restoredQueue: Track[] = [];
      let restoredIndex = -1;
      if (queueIds.length > 0) {
        restoredQueue = queueIds
          .map((id) => trackLookup.get(id))
          .filter((track): track is Track => Boolean(track));
        if (restoredQueue.length > 0) {
          restoredIndex = restoredQueueIndex(
            queueIds,
            trackLookup,
            restoredQueue,
            session.queueIndex,
            session.currentTrackId,
          );
          player.setQueue(restoredQueue);
          player.setQueueIndex(restoredIndex);
        }
      }

      let resolvedTrack =
        restoredCurrentTrack ??
        (session.currentTrackId ? trackLookup.get(session.currentTrackId) : undefined);
      if (!resolvedTrack && restoredIndex >= 0) {
        // The saved current track no longer resolves: use the same entry the queue index points at.
        resolvedTrack = restoredQueue[restoredIndex];
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

      const boosterLevel =
        typeof session.boosterLevel === 'number' && Number.isFinite(session.boosterLevel)
          ? Math.max(1, Math.min(2, session.boosterLevel))
          : 1;
      player.setBoosterLevel(boosterLevel);
      setAudioBooster(boosterLevel).catch((err) =>
        console.error('Failed to restore booster:', err),
      );

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
