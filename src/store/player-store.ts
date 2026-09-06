import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { LoopMode, ParsedLyrics, Track } from '../types';

export interface PlaybackFailure {
  generation: number;
  filePath: string;
  stage: 'preflight' | 'decode' | 'seek' | 'stream' | 'deviceSwitch';
  message: string;
  recoverable: boolean;
}

interface PlayerState {
  currentTrack: Track | null;
  queue: Track[];
  queueVersion: number;
  queueIndex: number;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  volume: number;
  playbackSpeed: number;
  boosterLevel: number;
  lyrics: ParsedLyrics | null;
  shuffleEnabled: boolean;
  shuffleHistory: string[];
  shuffleHistorySize: number;
  loopMode: LoopMode;
  stopAfterCurrent: boolean;
  hasActivePlayback: boolean;
  resumePositionSec: number | null;
  resumePositionTrackId: string | null;
  playbackError: PlaybackFailure | null;

  // Actions
  setCurrentTrack: (track: Track | null) => void;
  setQueue: (tracks: Track[]) => void;
  applyTrackRatings: (trackIds: string[], rating: number | null) => void;
  addTracksToQueue: (tracks: Track[], position?: 'next' | 'last') => void;
  addToQueue: (track: Track, position?: 'next' | 'last') => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  setQueueIndex: (index: number) => void;
  setCurrentTime: (time: number) => void;
  setDuration: (duration: number) => void;
  setIsPlaying: (playing: boolean) => void;
  setVolume: (volume: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  setLyrics: (lyrics: ParsedLyrics | null) => void;
  setBoosterLevel: (level: number) => void;
  toggleShuffle: () => void;
  setShuffleEnabled: (value: boolean) => void;
  resetShuffleHistory: () => void;
  setShuffleHistorySize: (size: number) => void;
  toggleLoop: () => void;
  cycleLoopMode: () => void;
  setLoopMode: (mode: LoopMode) => void;
  previewNext: (respectRepeatOne?: boolean) => { track: Track; index: number } | null;
  previewPrevious: () => { track: Track; index: number; restartCurrent: boolean } | null;
  activateTrackAtIndex: (index: number, historyDirection?: 'forward' | 'backward') => Track | null;
  playNext: () => Track | null;
  playPrevious: () => Track | null;
  setStopAfterCurrent: (value: boolean) => void;
  setHasActivePlayback: (value: boolean) => void;
  setResumePosition: (trackId: string, positionSec: number) => void;
  clearResumePosition: () => void;
  getResumePositionForTrack: (trackId?: string | null) => number | null;
  setPlaybackError: (error: PlaybackFailure | null) => void;
}

const withQueueId = (track: Track): Track => ({
  ...track,
  _queueId: track._queueId ?? crypto.randomUUID(),
});

const withNewQueueId = (track: Track): Track => ({
  ...track,
  _queueId: crypto.randomUUID(),
});

const playbackHistoryKey = (track: Track): string => track._queueId ?? track.id;

const appendShuffleHistory = (history: string[], track: Track, maxSize: number): string[] => {
  const key = playbackHistoryKey(track);
  if (history.at(-1) === key) return history;
  return [...history, key].slice(-maxSize);
};

const isSameQueueOccurrence = (queuedTrack: Track, selectedTrack: Track): boolean =>
  selectedTrack._queueId !== undefined
    ? queuedTrack._queueId === selectedTrack._queueId
    : queuedTrack.id === selectedTrack.id && queuedTrack.filePath === selectedTrack.filePath;

export const resolveQueueTrackIndex = (queue: Track[], selectedTrack: Track): number => {
  if (selectedTrack._queueId !== undefined) {
    return queue.findIndex((track) => track._queueId === selectedTrack._queueId);
  }
  return queue.findIndex(
    (track) => track.id === selectedTrack.id && track.filePath === selectedTrack.filePath,
  );
};

const resolveShuffleHistoryIndex = (queue: Track[], historyKey: string): number => {
  const byQueueId = queue.findIndex((track) => track._queueId === historyKey);
  return byQueueId >= 0 ? byQueueId : queue.findIndex((track) => track.id === historyKey);
};

export const resolveActiveQueueIndex = (
  queue: Track[],
  queueIndex: number,
  currentTrack: Track | null,
): number => {
  if (queue.length === 0) return -1;

  const indexedTrack = queueIndex >= 0 && queueIndex < queue.length ? queue[queueIndex] : null;
  if (indexedTrack && (!currentTrack || isSameQueueOccurrence(indexedTrack, currentTrack))) {
    return queueIndex;
  }

  if (currentTrack) {
    return resolveQueueTrackIndex(queue, currentTrack);
  }

  return -1;
};

export const usePlayerStore = create<PlayerState>()(
  devtools(
    (set, get) => ({
      currentTrack: null,
      queue: [],
      queueVersion: 0,
      queueIndex: -1,
      currentTime: 0,
      duration: 0,
      isPlaying: false,
      volume: 0.8,
      playbackSpeed: 1,
      boosterLevel: 1,
      lyrics: null,
      shuffleEnabled: false,
      shuffleHistory: [],
      shuffleHistorySize: 50,
      loopMode: 'all',
      stopAfterCurrent: false,
      hasActivePlayback: false,
      resumePositionSec: null,
      resumePositionTrackId: null,
      playbackError: null,

      setCurrentTrack: (track) =>
        set(
          (state) => {
            const updates: Partial<PlayerState> = { currentTrack: track, playbackError: null };
            if (track && state.shuffleEnabled) {
              updates.shuffleHistory = appendShuffleHistory(
                state.shuffleHistory,
                track,
                state.shuffleHistorySize,
              );
            } else if (!track) {
              updates.shuffleHistory = [];
              updates.hasActivePlayback = false;
            }
            return updates;
          },
          false,
          'player/setCurrentTrack',
        ),

      setQueue: (tracks) => {
        set(
          (state) => {
            const queueIds = new Set<string>();
            const queueWithIds = tracks.map((track) => {
              let queuedTrack = withQueueId(track);
              if (queueIds.has(queuedTrack._queueId!)) {
                queuedTrack = withNewQueueId(track);
              }
              queueIds.add(queuedTrack._queueId!);
              return queuedTrack;
            });
            let nextQueueIndex = state.queueIndex;
            if (queueWithIds.length === 0) {
              nextQueueIndex = -1;
            } else if (nextQueueIndex < 0) {
              nextQueueIndex = 0;
            } else if (nextQueueIndex >= queueWithIds.length) {
              nextQueueIndex = queueWithIds.length - 1;
            }
            return {
              queue: queueWithIds,
              queueIndex: nextQueueIndex,
              queueVersion: state.queueVersion + 1,
            };
          },
          false,
          'player/setQueue',
        );
      },

      applyTrackRatings: (trackIds, rating) => {
        if (trackIds.length === 0) return;
        const targetIds = new Set(trackIds);
        set(
          (state) => ({
            queue: state.queue.map((track) =>
              targetIds.has(track.id) ? { ...track, rating } : track,
            ),
            currentTrack:
              state.currentTrack && targetIds.has(state.currentTrack.id)
                ? { ...state.currentTrack, rating }
                : state.currentTrack,
          }),
          false,
          'player/applyTrackRatings',
        );
      },

      addToQueue: (track, position = 'last') => {
        const trackWithId = withNewQueueId(track);
        const { queue, queueIndex } = get();
        if (position === 'next') {
          const newQueue = [...queue];
          const insertIndex = queueIndex + 1;
          newQueue.splice(insertIndex, 0, trackWithId);
          set(
            (state) => ({ queue: newQueue, queueVersion: state.queueVersion + 1 }),
            false,
            'player/addToQueue',
          );
        } else {
          set(
            (state) => ({
              queue: [...queue, trackWithId],
              queueVersion: state.queueVersion + 1,
            }),
            false,
            'player/addToQueue',
          );
        }
      },

      addTracksToQueue: (tracks, position = 'last') => {
        if (tracks.length === 0) return;
        const tracksWithIds = tracks.map(withNewQueueId);
        set(
          (state) => {
            if (position === 'next') {
              const queue = [...state.queue];
              queue.splice(Math.max(0, state.queueIndex + 1), 0, ...tracksWithIds);
              return { queue, queueVersion: state.queueVersion + 1 };
            }

            return {
              queue: [...state.queue, ...tracksWithIds],
              queueVersion: state.queueVersion + 1,
            };
          },
          false,
          'player/addTracksToQueue',
        );
      },

      removeFromQueue: (index) => {
        const { queue, queueIndex } = get();
        if (index < 0 || index >= queue.length) return;

        const newQueue = queue.filter((_, i) => i !== index);
        let newIndex = queueIndex;

        if (index < queueIndex) {
          newIndex = queueIndex - 1;
        } else if (index === queueIndex) {
          // After filter, the next track slides into this position.
          // Keep the index so the next track becomes active.
          newIndex = queueIndex;
        }

        if (newQueue.length === 0) {
          newIndex = -1;
        } else if (newIndex >= newQueue.length) {
          newIndex = newQueue.length - 1;
        }

        set(
          (state) => ({
            queue: newQueue,
            queueIndex: newIndex,
            queueVersion: state.queueVersion + 1,
          }),
          false,
          'player/removeFromQueue',
        );
      },

      clearQueue: () =>
        set(
          (state) => ({
            queue: [],
            queueIndex: -1,
            queueVersion: state.queueVersion + 1,
          }),
          false,
          'player/clearQueue',
        ),

      reorderQueue: (fromIndex, toIndex) => {
        const { queue, queueIndex } = get();
        if (fromIndex < 0 || fromIndex >= queue.length || toIndex < 0 || toIndex >= queue.length)
          return;
        const newQueue = [...queue];
        const [removed] = newQueue.splice(fromIndex, 1);
        newQueue.splice(toIndex, 0, removed);

        let newIndex = queueIndex;
        if (fromIndex === queueIndex) {
          newIndex = toIndex;
        } else if (fromIndex < queueIndex && toIndex >= queueIndex) {
          newIndex = queueIndex - 1;
        } else if (fromIndex > queueIndex && toIndex <= queueIndex) {
          newIndex = queueIndex + 1;
        }

        set(
          (state) => ({
            queue: newQueue,
            queueIndex: newIndex,
            queueVersion: state.queueVersion + 1,
          }),
          false,
          'player/reorderQueue',
        );
      },

      setQueueIndex: (index) => {
        set(
          (state) => {
            if (state.queue.length === 0 || index < 0) {
              return { queueIndex: -1 };
            }
            const clampedIndex = Math.max(0, Math.min(index, state.queue.length - 1));
            return { queueIndex: clampedIndex };
          },
          false,
          'player/setQueueIndex',
        );
      },

      setCurrentTime: (time) => set({ currentTime: time }, false, 'player/setCurrentTime'),

      setPlaybackError: (error) => set({ playbackError: error }, false, 'player/setPlaybackError'),

      setDuration: (duration) => set({ duration }, false, 'player/setDuration'),

      setIsPlaying: (playing) => set({ isPlaying: playing }, false, 'player/setIsPlaying'),

      setVolume: (volume) =>
        set({ volume: Math.max(0, Math.min(1, volume)) }, false, 'player/setVolume'),

      setPlaybackSpeed: (speed) =>
        set({ playbackSpeed: Math.max(0.5, Math.min(2, speed)) }, false, 'player/setPlaybackSpeed'),
      setBoosterLevel: (level) =>
        set({ boosterLevel: Math.max(1, Math.min(2, level)) }, false, 'player/setBoosterLevel'),

      setLyrics: (lyrics) => set({ lyrics }, false, 'player/setLyrics'),

      toggleShuffle: () =>
        set(
          (state) => ({
            shuffleEnabled: !state.shuffleEnabled,
            shuffleHistory: state.shuffleEnabled
              ? []
              : state.currentTrack
                ? [playbackHistoryKey(state.currentTrack)]
                : [],
          }),
          false,
          'player/toggleShuffle',
        ),
      setShuffleEnabled: (value) =>
        set(
          (state) => ({
            shuffleEnabled: value,
            shuffleHistory:
              value && state.currentTrack ? [playbackHistoryKey(state.currentTrack)] : [],
          }),
          false,
          'player/setShuffleEnabled',
        ),
      resetShuffleHistory: () =>
        set(
          (state) => ({
            shuffleHistory: state.currentTrack ? [playbackHistoryKey(state.currentTrack)] : [],
          }),
          false,
          'player/resetShuffleHistory',
        ),
      setShuffleHistorySize: (size) =>
        set(
          (state) => ({
            shuffleHistorySize: Math.max(5, Math.min(300, size)),
            shuffleHistory: state.shuffleHistory.slice(-Math.max(5, Math.min(300, size))),
          }),
          false,
          'player/setShuffleHistorySize',
        ),

      cycleLoopMode: () =>
        set(
          (state) => {
            const modes: LoopMode[] = ['off', 'all', 'one'];
            const currentIndex = modes.indexOf(state.loopMode);
            const nextIndex = (currentIndex + 1) % modes.length;
            return { loopMode: modes[nextIndex] };
          },
          false,
          'player/cycleLoopMode',
        ),

      toggleLoop: () => get().cycleLoopMode(),
      setLoopMode: (mode) => set({ loopMode: mode }, false, 'player/setLoopMode'),

      previewNext: (respectRepeatOne = true) => {
        const { queue, queueIndex, currentTrack, shuffleEnabled, loopMode, shuffleHistory } = get();
        if (queue.length === 0) return null;

        const baseIndex = resolveActiveQueueIndex(queue, queueIndex, currentTrack);
        if (currentTrack && baseIndex < 0) return null;
        const effectiveLoopMode =
          loopMode === 'one' && !respectRepeatOne ? ('all' as const) : loopMode;

        let nextIndex: number;

        if (effectiveLoopMode === 'one') {
          nextIndex = baseIndex >= 0 ? baseIndex : 0;
        } else if (shuffleEnabled) {
          const historySet = new Set(shuffleHistory);
          const pool = queue
            .map((track, idx) => ({ track, idx }))
            .filter(({ idx }) => idx !== baseIndex);
          const unseen = pool.filter(({ track }) => !historySet.has(playbackHistoryKey(track)));
          const source = unseen.length > 0 ? unseen : effectiveLoopMode === 'all' ? pool : [];

          if (source.length === 0) {
            if (effectiveLoopMode === 'all') {
              nextIndex = baseIndex >= 0 ? baseIndex : 0;
            } else {
              return null;
            }
          } else {
            const choice = source[Math.floor(Math.random() * source.length)];
            nextIndex = choice.idx;
          }
        } else {
          nextIndex = baseIndex + 1;
          if (nextIndex >= queue.length) {
            if (effectiveLoopMode === 'all') {
              nextIndex = 0;
            } else {
              return null;
            }
          }
        }

        const nextTrack = queue[nextIndex];
        if (!nextTrack) return null;
        return { track: nextTrack, index: nextIndex };
      },

      previewPrevious: () => {
        const {
          queue,
          queueIndex,
          currentTrack,
          currentTime,
          loopMode,
          shuffleEnabled,
          shuffleHistory,
        } = get();
        if (queue.length === 0) return null;

        const baseIndex = resolveActiveQueueIndex(queue, queueIndex, currentTrack);
        if (currentTrack && baseIndex < 0) return null;
        const safeIndex = baseIndex >= 0 ? baseIndex : 0;

        if (currentTime > 3) {
          const track = queue[safeIndex];
          return track ? { track, index: safeIndex, restartCurrent: true } : null;
        }

        if (shuffleEnabled) {
          const currentKey = currentTrack
            ? playbackHistoryKey(currentTrack)
            : playbackHistoryKey(queue[safeIndex]);
          let currentHistoryIndex = -1;
          for (let index = shuffleHistory.length - 1; index >= 0; index -= 1) {
            if (shuffleHistory[index] === currentKey) {
              currentHistoryIndex = index;
              break;
            }
          }
          if (currentHistoryIndex <= 0) return null;

          const previousKey = shuffleHistory[currentHistoryIndex - 1];
          const previousIndex = resolveShuffleHistoryIndex(queue, previousKey);
          const previousTrack = previousIndex >= 0 ? queue[previousIndex] : null;
          return previousTrack
            ? { track: previousTrack, index: previousIndex, restartCurrent: false }
            : null;
        }

        let prevIndex = safeIndex - 1;
        if (prevIndex < 0) {
          if (loopMode === 'all' || loopMode === 'one') {
            prevIndex = queue.length - 1;
          } else {
            prevIndex = 0;
          }
        }

        const prevTrack = queue[prevIndex];
        if (!prevTrack) return null;
        return { track: prevTrack, index: prevIndex, restartCurrent: false };
      },

      activateTrackAtIndex: (index, historyDirection = 'forward') => {
        const { queue } = get();
        if (index < 0 || index >= queue.length) return null;
        const track = queue[index];
        set(
          (state) => {
            const updates: Partial<PlayerState> = {
              queueIndex: index,
              currentTrack: track,
              currentTime: 0,
              playbackError: null,
            };
            if (state.shuffleEnabled) {
              if (historyDirection === 'backward') {
                const currentKey = state.currentTrack
                  ? playbackHistoryKey(state.currentTrack)
                  : null;
                let currentHistoryIndex = -1;
                if (currentKey) {
                  for (let i = state.shuffleHistory.length - 1; i >= 0; i -= 1) {
                    if (state.shuffleHistory[i] === currentKey) {
                      currentHistoryIndex = i;
                      break;
                    }
                  }
                }
                if (currentHistoryIndex >= 0) {
                  updates.shuffleHistory = state.shuffleHistory.slice(0, currentHistoryIndex);
                }
              } else {
                updates.shuffleHistory = appendShuffleHistory(
                  state.shuffleHistory,
                  track,
                  state.shuffleHistorySize,
                );
              }
            }
            return updates;
          },
          false,
          'player/activateTrackAtIndex',
        );
        return track;
      },

      setStopAfterCurrent: (value) =>
        set({ stopAfterCurrent: value }, false, 'player/setStopAfterCurrent'),
      setHasActivePlayback: (value) =>
        set(
          () => {
            if (value) {
              return {
                hasActivePlayback: true,
                resumePositionSec: null,
                resumePositionTrackId: null,
              };
            }
            return { hasActivePlayback: false };
          },
          false,
          'player/setHasActivePlayback',
        ),
      setResumePosition: (trackId, positionSec) =>
        set(
          {
            resumePositionTrackId: trackId,
            resumePositionSec: Number.isFinite(positionSec) ? Math.max(0, positionSec) : 0,
          },
          false,
          'player/setResumePosition',
        ),
      clearResumePosition: () =>
        set(
          { resumePositionSec: null, resumePositionTrackId: null },
          false,
          'player/clearResumePosition',
        ),
      getResumePositionForTrack: (trackId) => {
        const { resumePositionSec, resumePositionTrackId } = get();
        if (!trackId || resumePositionTrackId !== trackId) return null;
        if (typeof resumePositionSec !== 'number' || resumePositionSec <= 0) return null;
        return resumePositionSec;
      },

      playNext: () => {
        const next = get().previewNext(false);
        if (!next) return null;
        get().activateTrackAtIndex(next.index);
        return next.track;
      },

      playPrevious: () => {
        const previous = get().previewPrevious();
        if (!previous) return null;
        if (previous.restartCurrent) {
          set({ currentTime: 0 }, false, 'player/playPrevious');
          return previous.track;
        }
        get().activateTrackAtIndex(previous.index, 'backward');
        return previous.track;
      },
    }),
    { name: 'tarab/player-store', enabled: import.meta.env.DEV },
  ),
);
