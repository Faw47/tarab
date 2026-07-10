import { useCallback, useRef } from 'react';
import type { NavView } from '../components/navigation';
import { savePlayerStateToStore } from '../features/app/player-state-store';
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

  const flushSessionSave = useCallback(async () => {
    const payload = buildSessionPayload();
    lastSessionSaveRef.current = Date.now();
    lastSavedPositionRef.current = payload.currentTime;
    try {
      await savePlayerStateToStore(payload);
    } catch (err) {
      console.error('Failed to save playback session:', err);
    }
  }, [buildSessionPayload]);

  const scheduleSessionSave = useCallback(
    (immediate = false) => {
      if (immediate) {
        if (sessionSaveTimeoutRef.current) {
          clearTimeout(sessionSaveTimeoutRef.current);
          sessionSaveTimeoutRef.current = null;
        }
        flushSessionSave();
        return;
      }
      if (sessionSaveTimeoutRef.current) return;
      const now = Date.now();
      const elapsed = now - lastSessionSaveRef.current;
      const delay = elapsed >= 5000 ? 0 : 5000 - elapsed;
      sessionSaveTimeoutRef.current = setTimeout(() => {
        sessionSaveTimeoutRef.current = null;
        flushSessionSave();
      }, delay);
    },
    [flushSessionSave],
  );

  return {
    scheduleSessionSave,
    lastSavedPositionRef,
    lastSessionSaveRef,
  };
}
