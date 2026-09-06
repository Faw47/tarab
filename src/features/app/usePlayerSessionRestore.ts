import { useEffect, useRef } from 'react';
import type { NavView } from '../../components/navigation';
import { reportError } from '../../lib/report-error';
import {
  dbGetTracksByAlbumArtist,
  dbGetTracksByIds,
  setPlaybackSpeed as setAudioPlaybackSpeed,
  setVolume as setAudioVolume,
} from '../../lib/tauri-commands';
import { usePlayerStore } from '../../store/player-store';
import type { Track } from '../../types';
import { mapDbTrackToTrack } from '../library/api';
import type { AlbumDetailsState } from './app-state-types';
import { getActivePlaybackGeneration } from './playback-generation';
import { loadPlayerStateFromStore, markPlayerStateHydrated } from './player-state-store';

export function usePlayerSessionRestore({
  replaceView,
  navigateView,
  currentView,
}: {
  replaceView: (view: NavView, options?: { albumDetails?: AlbumDetailsState }) => void;
  navigateView: (view: NavView, options?: { albumDetails?: AlbumDetailsState }) => void;
  currentView: NavView;
}) {
  const sessionRestored = useRef(false);
  const restoreAttempt = useRef(0);
  const currentViewRef = useRef(currentView);
  currentViewRef.current = currentView;

  useEffect(() => {
    if (sessionRestored.current) return;
    const attempt = ++restoreAttempt.current;
    let cancelled = false;
    let playerChanged = false;
    let observingPlayer = true;
    const initialView = currentViewRef.current;
    const initialGeneration = getActivePlaybackGeneration();
    const unsubscribePlayer = usePlayerStore.subscribe((state, previous) => {
      if (!observingPlayer) return;
      const restoreRelevantStateChanged =
        state.currentTrack !== previous.currentTrack ||
        state.queue !== previous.queue ||
        state.queueIndex !== previous.queueIndex ||
        state.currentTime !== previous.currentTime ||
        state.duration !== previous.duration ||
        state.isPlaying !== previous.isPlaying ||
        state.hasActivePlayback !== previous.hasActivePlayback ||
        state.volume !== previous.volume ||
        state.playbackSpeed !== previous.playbackSpeed ||
        state.shuffleEnabled !== previous.shuffleEnabled ||
        state.loopMode !== previous.loopMode ||
        state.stopAfterCurrent !== previous.stopAfterCurrent;
      if (restoreRelevantStateChanged) playerChanged = true;
    });

    const isStale = () =>
      cancelled ||
      restoreAttempt.current !== attempt ||
      playerChanged ||
      currentViewRef.current !== initialView ||
      getActivePlaybackGeneration() !== initialGeneration;

    const restoreSession = async () => {
      const session = await loadPlayerStateFromStore();
      if (isStale() || !session) return;

      const queueIds = Array.isArray(session.queueIds) ? session.queueIds : [];
      const allNeededIds = new Set<string>(queueIds);
      if (session.currentTrackId) allNeededIds.add(session.currentTrackId);

      const trackLookup = new Map<string, Track>();
      if (allNeededIds.size > 0) {
        const fetched = await dbGetTracksByIds(Array.from(allNeededIds));
        if (isStale()) return;
        fetched.forEach((track) => trackLookup.set(track.id, mapDbTrackToTrack(track)));
      }

      const restoredQueueEntries = queueIds.flatMap((id, sourceIndex) => {
        const track = trackLookup.get(id);
        return track ? [{ sourceIndex, track }] : [];
      });
      const restoredQueue = restoredQueueEntries.map(({ track }) => track);
      const requestedQueueIndex =
        typeof session.queueIndex === 'number' && queueIds.length > 0
          ? Math.min(queueIds.length - 1, Math.max(0, session.queueIndex))
          : -1;
      let restoredQueueIndex =
        requestedQueueIndex >= 0
          ? restoredQueueEntries.findIndex(({ sourceIndex }) => sourceIndex === requestedQueueIndex)
          : -1;
      if (
        restoredQueueIndex < 0 &&
        typeof session.queueIndex === 'number' &&
        restoredQueue.length > 0
      ) {
        restoredQueueIndex = Math.min(restoredQueue.length - 1, Math.max(0, session.queueIndex));
      }

      let resolvedTrack = session.currentTrackId
        ? trackLookup.get(session.currentTrackId)
        : undefined;
      if (!resolvedTrack && restoredQueueIndex >= 0) {
        resolvedTrack = restoredQueue[restoredQueueIndex];
      }

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
      let restoredAlbumDetails: AlbumDetailsState | null = null;
      if (session.lastOpenedAlbum && session.lastOpenedArtist) {
        try {
          const albumTracks = await dbGetTracksByAlbumArtist(
            session.lastOpenedAlbum,
            session.lastOpenedArtist,
          );
          if (isStale()) return;
          if (albumTracks.length > 0 && lastView === 'album') {
            restoredAlbumDetails = {
              album: session.lastOpenedAlbum,
              artist: session.lastOpenedArtist,
              tracks: albumTracks.map(mapDbTrackToTrack),
              coverArt: undefined,
            };
          }
        } catch (err) {
          console.error('Failed to restore album details:', err);
        }
      }

      if (isStale()) return;
      observingPlayer = false;
      unsubscribePlayer();
      const player = usePlayerStore.getState();

      if (restoredQueue.length > 0) {
        player.setQueue(restoredQueue);
        if (restoredQueueIndex >= 0) player.setQueueIndex(restoredQueueIndex);
      } else if (resolvedTrack) {
        player.setQueue([resolvedTrack]);
        player.setQueueIndex(0);
        restoredQueueIndex = 0;
      }

      if (resolvedTrack) {
        const resolvedTrackId = resolvedTrack.id;
        const queueState = usePlayerStore.getState();
        const indexedTrack =
          restoredQueueIndex >= 0 ? queueState.queue[restoredQueueIndex] : undefined;
        if (indexedTrack?.id === resolvedTrackId) {
          resolvedTrack = indexedTrack;
        } else {
          const matchingIndex = queueState.queue.findIndex((track) => track.id === resolvedTrackId);
          if (matchingIndex >= 0) {
            player.setQueueIndex(matchingIndex);
            resolvedTrack = queueState.queue[matchingIndex];
          }
        }
      }

      if (!resolvedTrack && typeof session.currentTime === 'number') {
        player.setCurrentTime(Math.max(0, session.currentTime));
      }

      if (typeof session.playbackSpeed === 'number' && session.playbackSpeed > 0) {
        player.setPlaybackSpeed(session.playbackSpeed);
        void setAudioPlaybackSpeed(session.playbackSpeed).catch((err) =>
          console.error('Failed to restore speed:', err),
        );
      }

      if (typeof session.volume === 'number' && session.volume >= 0) {
        const clampedVol = Math.max(0, Math.min(1, session.volume));
        player.setVolume(clampedVol);
        void setAudioVolume(clampedVol).catch((err) =>
          console.error('Failed to restore volume:', err),
        );
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

      if (lastView === 'album' && restoredAlbumDetails) {
        navigateView('album', { albumDetails: restoredAlbumDetails });
      } else if (lastView && lastView !== 'album') {
        replaceView(lastView);
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
      let restoreCompleted = false;
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            await restoreSession();
            restoreCompleted = true;
            return;
          } catch (err) {
            if (cancelled) return;
            if (attempt === 1) {
              reportError('Failed to restore playback session', {
                source: 'app-startup',
                error: err,
              });
              return;
            }
            await new Promise((resolve) => setTimeout(resolve, 120));
          }
        }
      } finally {
        unsubscribePlayer();
        if (!cancelled && restoreAttempt.current === attempt && restoreCompleted) {
          sessionRestored.current = true;
          markPlayerStateHydrated();
        }
      }
    };

    void restoreSessionWithRetry();

    return () => {
      cancelled = true;
      unsubscribePlayer();
    };
  }, [navigateView, replaceView]);
}
