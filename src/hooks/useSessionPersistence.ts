import { useCallback, useEffect, useRef } from 'react';
import type { NavView } from '../components/navigation';
import { isPlayerStateHydrated, savePlayerStateToStore } from '../features/app/player-state-store';
import { getAlbumKeyFromParts } from '../lib/album-key';
import { usePlayerStore } from '../store/player-store';

export function useSessionPersistence(
  currentView: NavView,
  albumDetails: { album: string; artist: string } | null,
) {
  const lastSessionSaveRef = useRef(0);
  const sessionSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedPositionRef = useRef(0);

  const buildSessionPayload = useCallback(() => {
    const state = usePlayerStore.getState();
    const {
      currentTime,
      currentTrack,
      volume,
      isPlaying: stateIsPlaying,
      queue,
      queueIndex,
      playbackSpeed,
      boosterLevel,
      shuffleEnabled,
      loopMode,
      stopAfterCurrent,
    } = state;

    const duration = currentTrack?.duration ?? 0;
    const clampedTime = Math.max(
      0,
      Math.min(currentTime, duration > 0 ? Math.max(0, duration - 0.75) : currentTime),
    );

    return {
      version: 1,
      queueIds: queue.map((t) => t.id),
      currentTrackId: currentTrack?.id ?? null,
      queueIndex,
      currentTime: clampedTime,
      playbackSpeed,
      boosterLevel,
      volume,
      wasPlaying: stateIsPlaying,
      shuffleEnabled,
      loopMode,
      stopAfterCurrent,
      lastView: currentView,
      lastOpenedAlbum: albumDetails?.album ?? null,
      lastOpenedArtist: albumDetails?.artist ?? null,
      lastOpenedAlbumKey: albumDetails
        ? getAlbumKeyFromParts(albumDetails.album, albumDetails.artist)
        : null,
      timestamp: Date.now(),
    };
  }, [currentView, albumDetails?.album, albumDetails?.artist]);

  const cancelScheduledSave = useCallback(() => {
    if (sessionSaveTimeoutRef.current !== null) {
      clearTimeout(sessionSaveTimeoutRef.current);
      sessionSaveTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => cancelScheduledSave, [cancelScheduledSave]);

  const flushSessionSave = useCallback(async () => {
    cancelScheduledSave();
    if (!isPlayerStateHydrated()) return;
    const payload = buildSessionPayload();
    await savePlayerStateToStore(payload);
    lastSessionSaveRef.current = Date.now();
    lastSavedPositionRef.current = payload.currentTime;
  }, [buildSessionPayload, cancelScheduledSave]);

  const scheduleSessionSave = useCallback(
    (immediate = false) => {
      if (!isPlayerStateHydrated()) return;
      if (immediate) {
        if (sessionSaveTimeoutRef.current) {
          clearTimeout(sessionSaveTimeoutRef.current);
          sessionSaveTimeoutRef.current = null;
        }
        void flushSessionSave().catch((error) => {
          console.error('Failed to save playback session:', error);
        });
        return;
      }
      if (sessionSaveTimeoutRef.current) return;
      const now = Date.now();
      const elapsed = now - lastSessionSaveRef.current;
      const delay = elapsed >= 5000 ? 0 : 5000 - elapsed;
      sessionSaveTimeoutRef.current = setTimeout(() => {
        sessionSaveTimeoutRef.current = null;
        void flushSessionSave().catch((error) => {
          console.error('Failed to save playback session:', error);
        });
      }, delay);
    },
    [flushSessionSave],
  );

  return {
    scheduleSessionSave,
    flushSessionSave,
    lastSavedPositionRef,
    lastSessionSaveRef,
  };
}
