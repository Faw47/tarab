import { match } from 'ts-pattern';
import {
  notePlaybackIntervention,
  setActivePlaybackGeneration,
} from '../features/app/playback-generation';
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
  notePlaybackIntervention();
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
  notePlaybackIntervention();
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

// Seek and device switches apply to whichever source is current, including one a crossfade
// just started, so they do not invalidate a pending crossfade.
export const switchAudioOutputDevice = (deviceId: string): Promise<void> =>
  setAudioOutputDevice(deviceId);

export const startEditorPreview = async (filePath: string): Promise<void> => {
  notePlaybackIntervention();
  const generation = await playTrack(filePath);
  setActivePlaybackGeneration(generation);
  const state = usePlayerStore.getState();
  state.setCurrentTime(0);
  state.setIsPlaying(true);
  state.setHasActivePlayback(true);
};

/**
 * Plays the previous or next queue entry. A user-initiated Next moves on under Repeat One;
 * `automatic` (the queue advancing after a track ended) repeats the track instead. `entry` plays
 * that already previewed next entry, since a second shuffle preview picks a different one.
 */
const playAdjacentTrackOnce = async (
  direction: 'next' | 'previous',
  options?: { automatic?: boolean; entry?: { track: Track; index: number } },
): Promise<Track | null> => {
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

    notePlaybackIntervention();
    const generation = await playTrack(previous.track.filePath);
    setActivePlaybackGeneration(generation);
    const freshState = usePlayerStore.getState();
    freshState.activateTrackAtIndex(previous.index, { backward: true });
    freshState.setDuration(previous.track.duration);
    freshState.setIsPlaying(true);
    freshState.setHasActivePlayback(true);
    return previous.track;
  }

  const next = options?.entry ?? state.previewNext({ ignoreRepeatOne: !options?.automatic });
  if (!next) return null;

  notePlaybackIntervention();
  const generation = await playTrack(next.track.filePath);
  setActivePlaybackGeneration(generation);
  const freshState = usePlayerStore.getState();
  freshState.activateTrackAtIndex(next.index);
  freshState.setDuration(next.track.duration);
  freshState.setIsPlaying(true);
  freshState.setHasActivePlayback(true);
  return next.track;
};

// Read the next queue entry only after the previous adjacent transition has committed.
// Two quick Next/Previous requests must not preview and play the same entry.
let adjacentTransition: Promise<void> = Promise.resolve();

export const playAdjacentTrack = (
  direction: 'next' | 'previous',
  options?: { automatic?: boolean; entry?: { track: Track; index: number } },
): Promise<Track | null> => {
  const result = adjacentTransition.then(() => playAdjacentTrackOnce(direction, options));
  // A failed load must not prevent later transport actions from running.
  adjacentTransition = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
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
