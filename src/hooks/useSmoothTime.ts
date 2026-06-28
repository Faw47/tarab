import { useCallback, useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { usePlayerStore } from '../store/player-store';

export const useSmoothTime = () => {
  const { currentTime, isPlaying, playbackSpeed } = usePlayerStore(
    useShallow((s) => ({
      currentTime: s.currentTime,
      isPlaying: s.isPlaying,
      playbackSpeed: s.playbackSpeed,
    })),
  );

  const anchorRef = useRef<{ baseMs: number; at: number }>({
    baseMs: currentTime * 1000,
    at: typeof performance !== 'undefined' ? performance.now() : Date.now(),
  });

  // Sync anchor when coarse time changes (seek, track change)
  // We use a threshold to avoid resetting on minor drift updates if we wanted,
  // but simpler to just reset for now as store.currentTime is usually stable unless polled or sought.
  useEffect(() => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    anchorRef.current = { baseMs: currentTime * 1000, at: now };
  }, [currentTime]);

  const getTimeMs = useCallback(() => {
    if (!isPlaying) {
      return anchorRef.current.baseMs;
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsed = now - anchorRef.current.at;
    return anchorRef.current.baseMs + elapsed * playbackSpeed;
  }, [isPlaying, playbackSpeed]);

  return getTimeMs;
};
