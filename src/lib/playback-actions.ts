import { match } from 'ts-pattern';
import { setActivePlaybackGeneration } from '../features/app/playback-generation';
import { usePlayerStore } from '../store/player-store';
import type { Track } from '../types';
import {
  crossfadeToTrack,
  pausePlayback,
  playTrack,
  preloadNextTrack,
  resumePlayback,
  seekPlayback,
  setAudioOutputDevice,
  stopPlayback,
} from './tauri-commands';

interface StartPlaybackOptions {
  queue?: Track[];
  queueIndex?: number;
  startPos?: number;
  shuffleEnabled?: boolean;
}

export const startPlayback = async (
  track: Track,
  options?: StartPlaybackOptions,
): Promise<void> => {
  const startPos = options?.startPos;
  const generation = await playTrack(track.filePath, startPos);
  setActivePlaybackGeneration(generation);

  const state = usePlayerStore.getState();
  if (options?.queue) {
    state.setQueue(options.queue);
  }
  if (typeof options?.queueIndex === 'number') {
    state.setQueueIndex(options.queueIndex);
  }
  state.setCurrentTrack(track);
  state.setDuration(track.duration);
  state.setCurrentTime(Math.max(0, startPos ?? 0));
  state.setIsPlaying(true);
  state.setHasActivePlayback(true);
  if (typeof options?.shuffleEnabled === 'boolean') {
    state.setShuffleEnabled(options.shuffleEnabled);
  }
};

export const pauseCurrentPlayback = async (): Promise<void> => {
  await pausePlayback();
  usePlayerStore.getState().setIsPlaying(false);
};

export const resumeCurrentPlayback = async (): Promise<void> => {
  const state = usePlayerStore.getState();
  const currentTrack = state.currentTrack;
  if (!currentTrack) return;

  if (!state.hasActivePlayback) {
    const resumePos = state.getResumePositionForTrack(currentTrack.id);
    await startPlayback(currentTrack, { startPos: resumePos ?? undefined });
    return;
  }

  await resumePlayback();
  state.setIsPlaying(true);
};

export const toggleCurrentPlayback = async (): Promise<void> => {
  const state = usePlayerStore.getState();
  if (!state.currentTrack) return;

  if (state.isPlaying) {
    await pauseCurrentPlayback();
    return;
  }

  await resumeCurrentPlayback();
};

export const seekToPosition = async (positionSecs: number): Promise<void> => {
  const clamped = Math.max(0, positionSecs);
  await seekPlayback(clamped);
  usePlayerStore.getState().setCurrentTime(clamped);
};

export const stopCurrentPlayback = async (): Promise<void> => {
  await stopPlayback();
  const state = usePlayerStore.getState();
  state.setIsPlaying(false);
  state.setHasActivePlayback(false);
};

export const crossfadeToSource = (
  filePath: string,
  durationSecs: number,
  startPos?: number,
): Promise<number> => crossfadeToTrack(filePath, durationSecs, startPos);

export const preloadGaplessSource = (filePath: string | null): Promise<number | null> =>
  preloadNextTrack(filePath);

export const switchAudioOutputDevice = (deviceId: string): Promise<void> =>
  setAudioOutputDevice(deviceId);

export const startEditorPreview = async (filePath: string): Promise<void> => {
  const generation = await playTrack(filePath);
  setActivePlaybackGeneration(generation);
  const state = usePlayerStore.getState();
  state.setCurrentTime(0);
  state.setIsPlaying(true);
  state.setHasActivePlayback(true);
};

export const playAdjacentTrack = async (direction: 'next' | 'previous'): Promise<Track | null> => {
  const state = usePlayerStore.getState();

  if (direction === 'previous') {
    const previous = state.previewPrevious();
    if (!previous) return null;

    if (previous.restartCurrent) {
      if (state.hasActivePlayback) {
        await seekToPosition(0);
        return previous.track;
      }
      await startPlayback(previous.track, { queueIndex: previous.index, startPos: 0 });
      return previous.track;
    }

    const generation = await playTrack(previous.track.filePath);
    setActivePlaybackGeneration(generation);
    const freshState = usePlayerStore.getState();
    freshState.activateTrackAtIndex(previous.index);
    freshState.setDuration(previous.track.duration);
    freshState.setIsPlaying(true);
    freshState.setHasActivePlayback(true);
    return previous.track;
  }

  const next = state.previewNext();
  if (!next) return null;

  const generation = await playTrack(next.track.filePath);
  setActivePlaybackGeneration(generation);
  const freshState = usePlayerStore.getState();
  freshState.activateTrackAtIndex(next.index);
  freshState.setDuration(next.track.duration);
  freshState.setIsPlaying(true);
  freshState.setHasActivePlayback(true);
  return next.track;
};

export const cyclePlaybackLoopMode = (): void => {
  const { loopMode, setLoopMode } = usePlayerStore.getState();
  const nextMode = match(loopMode)
    .with('off', () => 'all' as const)
    .with('all', () => 'one' as const)
    .with('one', () => 'off' as const)
    .exhaustive();

  setLoopMode(nextMode);
};

export const PlaybackCoordinator = Object.freeze({
  start: startPlayback,
  pause: pauseCurrentPlayback,
  resume: resumeCurrentPlayback,
  toggle: toggleCurrentPlayback,
  stop: stopCurrentPlayback,
  seek: seekToPosition,
  next: () => playAdjacentTrack('next'),
  previous: () => playAdjacentTrack('previous'),
  crossfadeTo: crossfadeToSource,
  preloadNext: preloadGaplessSource,
  switchOutputDevice: switchAudioOutputDevice,
  previewFile: startEditorPreview,
});
