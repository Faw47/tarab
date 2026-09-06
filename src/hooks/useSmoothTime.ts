import { useCallback, useEffect, useRef } from 'react';
import { usePlayerStore } from '../store/player-store';

type PlaybackClockState = {
  isPlaying: boolean;
  playbackSpeed: number;
};

type PlaybackClockAnchor = {
  baseMs: number;
  at: number;
};

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const projectTime = (
  anchor: PlaybackClockAnchor,
  state: PlaybackClockState,
  now: number,
): number => {
  if (!state.isPlaying) return anchor.baseMs;
  return anchor.baseMs + (now - anchor.at) * state.playbackSpeed;
};

export const useSmoothTime = () => {
  const initial = usePlayerStore.getState();
  const anchorRef = useRef<PlaybackClockAnchor>({
    baseMs: initial.currentTime * 1000,
    at: nowMs(),
  });
  const playbackStateRef = useRef<PlaybackClockState>({
    isPlaying: initial.isPlaying,
    playbackSpeed: initial.playbackSpeed,
  });

  useEffect(() => {
    let previous = usePlayerStore.getState();

    return usePlayerStore.subscribe((state) => {
      const timeChanged = state.currentTime !== previous.currentTime;
      const playbackChanged =
        state.isPlaying !== previous.isPlaying || state.playbackSpeed !== previous.playbackSpeed;

      if (timeChanged || playbackChanged) {
        const at = nowMs();
        const baseMs = timeChanged
          ? state.currentTime * 1000
          : projectTime(anchorRef.current, playbackStateRef.current, at);
        anchorRef.current = { baseMs, at };
        playbackStateRef.current = {
          isPlaying: state.isPlaying,
          playbackSpeed: state.playbackSpeed,
        };
      }
      previous = state;
    });
  }, []);

  return useCallback(() => projectTime(anchorRef.current, playbackStateRef.current, nowMs()), []);
};
