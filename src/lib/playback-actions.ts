import { match } from 'ts-pattern';
import {
  getActivePlaybackGeneration,
  setActivePlaybackGeneration,
} from '../features/app/playback-generation';
import { resolveQueueTrackIndex, usePlayerStore } from '../store/player-store';
import type { Track } from '../types';
import type {
  AudioOutputSelection,
  GaplessCancellationOutcome,
  GaplessPreloadIdentity,
  PlaybackSourceIdentity,
} from './tauri-commands';
import {
  cancelGaplessPreload,
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
  authorityId?: string;
}

export interface PlaybackSourceSnapshot {
  trackId: string;
  generation: number;
}

interface AdjacentPlaybackOptions {
  respectRepeatOne?: boolean;
}

let sourceCommandQueue: Promise<void> = Promise.resolve();

export interface GaplessCancellationNotice {
  cause: 'seek' | 'outputDevice';
  outcome: GaplessCancellationOutcome;
  position: number | null;
}

const gaplessCancellationListeners = new Set<(notice: GaplessCancellationNotice) => void>();

export const subscribeGaplessCancellation = (
  listener: (notice: GaplessCancellationNotice) => void,
): (() => void) => {
  gaplessCancellationListeners.add(listener);
  return () => gaplessCancellationListeners.delete(listener);
};

function publishGaplessCancellation(
  cause: GaplessCancellationNotice['cause'],
  outcome: GaplessCancellationOutcome | null,
  position: number | null = null,
): void {
  if (!outcome) return;
  for (const listener of gaplessCancellationListeners) {
    listener({ cause, outcome, position });
  }
}

function enqueueSourceCommand<T>(command: () => Promise<T>): Promise<T> {
  const result = sourceCommandQueue.catch(() => undefined).then(command);
  sourceCommandQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function performSourceBoundSeek(
  positionSecs: number,
  expectedSource: PlaybackSourceIdentity,
): Promise<boolean> {
  const outcome = await seekPlayback(positionSecs, expectedSource);
  publishGaplessCancellation(
    'seek',
    outcome.gaplessCancellation,
    outcome.status === 'applied' ? outcome.position : null,
  );
  if (outcome.status === 'failed') throw new Error(outcome.message);
  return outcome.status === 'applied';
}

export const captureActivePlaybackSource = (): PlaybackSourceSnapshot | null => {
  const state = usePlayerStore.getState();
  if (!state.currentTrack || !state.hasActivePlayback) return null;
  return {
    trackId: state.currentTrack.id,
    generation: getActivePlaybackGeneration(),
  };
};

const startPlaybackInQueue = async (
  track: Track,
  options?: StartPlaybackOptions,
): Promise<void> => {
  const startPos = options?.startPos;
  const generation = options?.authorityId
    ? await playTrack(track.filePath, startPos, options.authorityId)
    : await playTrack(track.filePath, startPos);
  setActivePlaybackGeneration(generation);

  let state = usePlayerStore.getState();
  if (options?.queue) {
    state.setQueue(options.queue);
    state = usePlayerStore.getState();
  }
  if (typeof options?.queueIndex === 'number') {
    state.setQueueIndex(options.queueIndex);
  } else {
    state.setQueueIndex(resolveQueueTrackIndex(state.queue, track));
  }
  state = usePlayerStore.getState();
  const queuedTrack =
    state.queueIndex >= 0 && state.queueIndex < state.queue.length
      ? state.queue[state.queueIndex]
      : null;
  const activeTrack = queuedTrack && isSelectedQueueTrack(queuedTrack, track) ? queuedTrack : track;
  state.setCurrentTrack(activeTrack);
  state.setDuration(activeTrack.duration);
  state.setCurrentTime(Math.max(0, startPos ?? 0));
  state.setIsPlaying(true);
  state.setHasActivePlayback(true);
  if (typeof options?.shuffleEnabled === 'boolean') {
    state.setShuffleEnabled(options.shuffleEnabled);
  }
};

const pausePlaybackInQueue = async (): Promise<void> => {
  await pausePlayback();
  usePlayerStore.getState().setIsPlaying(false);
};

const resumePlaybackInQueue = async (): Promise<void> => {
  const state = usePlayerStore.getState();
  const currentTrack = state.currentTrack;
  if (!currentTrack) return;

  if (!state.hasActivePlayback) {
    const resumePos = state.getResumePositionForTrack(currentTrack.id);
    await startPlaybackInQueue(currentTrack, { startPos: resumePos ?? undefined });
    return;
  }

  await resumePlayback();
  usePlayerStore.getState().setIsPlaying(true);
};

export const startPlayback = async (
  track: Track,
  options?: StartPlaybackOptions,
): Promise<void> => {
  await enqueueSourceCommand(() => startPlaybackInQueue(track, options));
};

export const pauseCurrentPlayback = async (): Promise<void> => {
  await enqueueSourceCommand(pausePlaybackInQueue);
};

export const resumeCurrentPlayback = async (): Promise<void> => {
  await enqueueSourceCommand(resumePlaybackInQueue);
};

export const toggleCurrentPlayback = async (): Promise<void> => {
  await enqueueSourceCommand(async () => {
    const state = usePlayerStore.getState();
    if (!state.currentTrack) return;
    if (state.isPlaying) {
      await pausePlaybackInQueue();
      return;
    }
    await resumePlaybackInQueue();
  });
};
export const seekToPosition = async (
  positionSecs: number,
  expectedSource: PlaybackSourceSnapshot,
): Promise<boolean> => {
  const clamped = Math.max(0, positionSecs);
  return enqueueSourceCommand(async () => {
    const state = usePlayerStore.getState();
    if (
      getActivePlaybackGeneration() !== expectedSource.generation ||
      state.currentTrack?.id !== expectedSource.trackId ||
      !state.hasActivePlayback
    ) {
      return false;
    }
    return performSourceBoundSeek(clamped, {
      generation: expectedSource.generation,
      path: state.currentTrack.filePath,
    });
  });
};

export const stopCurrentPlayback = async (): Promise<void> => {
  await enqueueSourceCommand(async () => {
    const generation = await stopPlayback();
    setActivePlaybackGeneration(generation);
    const state = usePlayerStore.getState();
    state.setIsPlaying(false);
    state.setHasActivePlayback(false);
  });
};

export const crossfadeToSource = (
  filePath: string,
  durationSecs: number,
  startPos?: number,
): Promise<number> =>
  enqueueSourceCommand(() => crossfadeToTrack(filePath, durationSecs, startPos));

export const preloadGaplessSource = (filePath: string): Promise<GaplessPreloadIdentity> =>
  enqueueSourceCommand(() => preloadNextTrack(filePath));

export const cancelGaplessSource = (
  preload: GaplessPreloadIdentity,
): Promise<GaplessCancellationOutcome> => enqueueSourceCommand(() => cancelGaplessPreload(preload));

export const switchAudioOutputDevice = (deviceId: string): Promise<AudioOutputSelection> =>
  enqueueSourceCommand(async () => {
    const outcome = await setAudioOutputDevice(deviceId);
    publishGaplessCancellation('outputDevice', outcome.gaplessCancellation);
    return outcome.selection;
  });

export const startEditorPreview = async (track: Track): Promise<void> => startPlayback(track);

const isSelectedQueueTrack = (queuedTrack: Track, selectedTrack: Track): boolean =>
  selectedTrack._queueId !== undefined
    ? queuedTrack._queueId === selectedTrack._queueId
    : queuedTrack.id === selectedTrack.id && queuedTrack.filePath === selectedTrack.filePath;

export const playAdjacentTrack = async (
  direction: 'next' | 'previous',
  options?: AdjacentPlaybackOptions,
): Promise<Track | null> => {
  return enqueueSourceCommand(async () => {
    const state = usePlayerStore.getState();

    if (direction === 'previous') {
      const previous = state.previewPrevious();
      if (!previous) return null;

      if (previous.restartCurrent) {
        if (state.hasActivePlayback && state.currentTrack) {
          const applied = await performSourceBoundSeek(0, {
            generation: getActivePlaybackGeneration(),
            path: state.currentTrack.filePath,
          });
          return applied ? previous.track : null;
        }
      } else {
        const generation = await playTrack(previous.track.filePath);
        setActivePlaybackGeneration(generation);
        const freshState = usePlayerStore.getState();
        const freshIndex = resolveQueueTrackIndex(freshState.queue, previous.track);
        if (freshIndex >= 0) freshState.activateTrackAtIndex(freshIndex, 'backward');
        else {
          freshState.setCurrentTrack(previous.track);
          freshState.setCurrentTime(0);
        }
        freshState.setDuration(previous.track.duration);
        freshState.setIsPlaying(true);
        freshState.setHasActivePlayback(true);
        return previous.track;
      }

      const generation = await playTrack(previous.track.filePath, 0);
      setActivePlaybackGeneration(generation);
      const freshState = usePlayerStore.getState();
      freshState.activateTrackAtIndex(previous.index, 'backward');
      freshState.setDuration(previous.track.duration);
      freshState.setIsPlaying(true);
      freshState.setHasActivePlayback(true);
      return previous.track;
    }

    const next = state.previewNext(options?.respectRepeatOne ?? false);
    if (!next) return null;

    const generation = await playTrack(next.track.filePath);
    setActivePlaybackGeneration(generation);
    const freshState = usePlayerStore.getState();
    const freshIndex = resolveQueueTrackIndex(freshState.queue, next.track);
    if (freshIndex >= 0) freshState.activateTrackAtIndex(freshIndex);
    else {
      freshState.setCurrentTrack(next.track);
      freshState.setCurrentTime(0);
    }
    freshState.setDuration(next.track.duration);
    freshState.setIsPlaying(true);
    freshState.setHasActivePlayback(true);
    return next.track;
  });
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
