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
  /** Queue entries (by `_queueId`) played in the current shuffle pass, in play order. */
  shufflePass: string[];
  /** Queue entries added with Play Next while shuffling; they play before random picks. */
  shufflePriority: string[];
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
  /** `ignoreRepeatOne` is for a user-initiated Next, which moves on from a repeated track. */
  previewNext: (options?: { ignoreRepeatOne?: boolean }) => { track: Track; index: number } | null;
  previewPrevious: () => { track: Track; index: number; restartCurrent: boolean } | null;
  activateTrackAtIndex: (index: number) => Track | null;
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

export const resolveActiveQueueIndex = (
  queue: Track[],
  queueIndex: number,
  currentTrack: Track | null,
): number => {
  if (queue.length === 0) return -1;

  const indexedTrack = queueIndex >= 0 && queueIndex < queue.length ? queue[queueIndex] : null;
  if (
    indexedTrack &&
    (!currentTrack ||
      indexedTrack._queueId === currentTrack._queueId ||
      indexedTrack.id === currentTrack.id)
  ) {
    return queueIndex;
  }

  if (currentTrack?._queueId) {
    const byQueueId = queue.findIndex((track) => track._queueId === currentTrack._queueId);
    if (byQueueId >= 0) return byQueueId;
  }

  if (currentTrack) {
    const byTrackId = queue.findIndex((track) => track.id === currentTrack.id);
    if (byTrackId >= 0) return byTrackId;
  }

  return indexedTrack ? queueIndex : -1;
};

const queueEntryKey = (track: Track): string => track._queueId ?? track.id;

/** Keeps shuffle bookkeeping limited to entries that are still in the queue. */
const pruneShuffleKeys = (keys: string[], queue: Track[]): string[] => {
  if (keys.length === 0) return keys;
  const present = new Set(queue.map(queueEntryKey));
  return keys.filter((key) => present.has(key));
};

/**
 * Records that `index` started playing. Revisiting an entry from the pass (Previous) keeps the
 * pass; playing an entry again after the whole queue was played starts a new pass.
 */
const recordShufflePlay = (
  state: Pick<PlayerState, 'queue' | 'shufflePass' | 'shufflePriority'>,
  index: number,
): Pick<PlayerState, 'shufflePass' | 'shufflePriority'> => {
  const entry = state.queue[index];
  if (!entry) return { shufflePass: state.shufflePass, shufflePriority: state.shufflePriority };
  const key = queueEntryKey(entry);
  const shufflePriority = state.shufflePriority.filter((item) => item !== key);
  if (!state.shufflePass.includes(key)) {
    return { shufflePass: [...state.shufflePass, key], shufflePriority };
  }
  const played = new Set(state.shufflePass);
  const passComplete = state.queue.every((track) => played.has(queueEntryKey(track)));
  return { shufflePass: passComplete ? [key] : state.shufflePass, shufflePriority };
};

const startShufflePass = (
  state: Pick<PlayerState, 'queue' | 'queueIndex' | 'currentTrack'>,
): string[] => {
  const index = resolveActiveQueueIndex(state.queue, state.queueIndex, state.currentTrack);
  const entry = index >= 0 ? state.queue[index] : null;
  return entry ? [queueEntryKey(entry)] : [];
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
      shufflePass: [],
      shufflePriority: [],
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
              const filtered = state.shuffleHistory.filter((id) => id !== track.id);
              filtered.push(track.id);
              const max = state.shuffleHistorySize;
              updates.shuffleHistory = filtered.slice(Math.max(0, filtered.length - max));
              const index = resolveActiveQueueIndex(state.queue, state.queueIndex, track);
              if (index >= 0) Object.assign(updates, recordShufflePlay(state, index));
            } else if (!track) {
              updates.shuffleHistory = [];
              updates.shufflePass = [];
              updates.shufflePriority = [];
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
            const queueWithIds = tracks.map(withQueueId);
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
              shufflePass: pruneShuffleKeys(state.shufflePass, queueWithIds),
              shufflePriority: pruneShuffleKeys(state.shufflePriority, queueWithIds),
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
        const trackWithId = withQueueId(track);
        const { queue, queueIndex } = get();
        if (position === 'next') {
          const newQueue = [...queue];
          const insertIndex = queueIndex + 1;
          newQueue.splice(insertIndex, 0, trackWithId);
          set(
            (state) => ({
              queue: newQueue,
              queueVersion: state.queueVersion + 1,
              // Play Next under shuffle: play it next, then the others in insertion order.
              shufflePriority: state.shuffleEnabled
                ? [...state.shufflePriority, queueEntryKey(trackWithId)]
                : state.shufflePriority,
            }),
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
            if (state.queue.length === 0) {
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
                ? [state.currentTrack.id]
                : [],
            shufflePass: state.shuffleEnabled ? [] : startShufflePass(state),
            shufflePriority: [],
          }),
          false,
          'player/toggleShuffle',
        ),
      setShuffleEnabled: (value) =>
        set(
          (state) => ({
            shuffleEnabled: value,
            shuffleHistory: value && state.currentTrack ? [state.currentTrack.id] : [],
            shufflePass: value ? startShufflePass(state) : [],
            shufflePriority: [],
          }),
          false,
          'player/setShuffleEnabled',
        ),
      resetShuffleHistory: () =>
        set(
          (state) => ({
            shuffleHistory: state.currentTrack ? [state.currentTrack.id] : [],
            shufflePass: startShufflePass(state),
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

      previewNext: (options) => {
        const {
          queue,
          queueIndex,
          currentTrack,
          shuffleEnabled,
          shuffleHistory,
          shufflePass,
          shufflePriority,
        } = get();
        if (queue.length === 0) return null;

        const baseIndex = resolveActiveQueueIndex(queue, queueIndex, currentTrack);
        const repeatOneSkipped = get().loopMode === 'one' && options?.ignoreRepeatOne;
        const loopMode = repeatOneSkipped ? 'all' : get().loopMode;

        let nextIndex: number;

        if (loopMode === 'one') {
          nextIndex = baseIndex >= 0 ? baseIndex : 0;
        } else if (shuffleEnabled) {
          const priorityIndex = shufflePriority
            .map((key) => queue.findIndex((track) => queueEntryKey(track) === key))
            .find((index) => index >= 0 && index !== baseIndex);
          const pool = queue
            .map((track, idx) => ({ track, idx }))
            .filter(({ idx }) => idx !== baseIndex);
          const played = new Set(shufflePass);
          const unplayed = pool.filter(({ track }) => !played.has(queueEntryKey(track)));

          if (priorityIndex !== undefined) {
            nextIndex = priorityIndex;
          } else if (unplayed.length > 0) {
            nextIndex = unplayed[Math.floor(Math.random() * unplayed.length)].idx;
          } else if (loopMode !== 'all') {
            // Every queue entry played in this pass: shuffle ends like the end of the list.
            return null;
          } else if (pool.length === 0) {
            nextIndex = baseIndex >= 0 ? baseIndex : 0;
          } else {
            // New pass: prefer tracks that were not played recently.
            const recent = new Set(shuffleHistory);
            const fresh = pool.filter(({ track }) => !recent.has(track.id));
            const source = fresh.length > 0 ? fresh : pool;
            nextIndex = source[Math.floor(Math.random() * source.length)].idx;
          }
        } else {
          nextIndex = baseIndex + 1;
          if (nextIndex >= queue.length) {
            if (loopMode === 'all') {
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
        const { queue, queueIndex, currentTrack, currentTime, loopMode, shuffleEnabled } = get();
        if (queue.length === 0) return null;

        const baseIndex = resolveActiveQueueIndex(queue, queueIndex, currentTrack);
        const safeIndex = baseIndex >= 0 ? baseIndex : 0;

        if (currentTime > 3) {
          const track = queue[safeIndex];
          return track ? { track, index: safeIndex, restartCurrent: true } : null;
        }

        if (shuffleEnabled) {
          // Go back through the tracks played in this shuffle pass, not the list order.
          const { shufflePass } = get();
          const current = queue[safeIndex];
          const position = current ? shufflePass.lastIndexOf(queueEntryKey(current)) : -1;
          for (let i = position - 1; i >= 0; i -= 1) {
            const index = queue.findIndex((track) => queueEntryKey(track) === shufflePass[i]);
            if (index >= 0) return { track: queue[index], index, restartCurrent: false };
          }
          return current ? { track: current, index: safeIndex, restartCurrent: true } : null;
        }

        let prevIndex = safeIndex - 1;
        if (prevIndex < 0) {
          if (loopMode === 'all') {
            prevIndex = queue.length - 1;
          } else {
            prevIndex = 0;
          }
        }

        const prevTrack = queue[prevIndex];
        if (!prevTrack) return null;
        return { track: prevTrack, index: prevIndex, restartCurrent: false };
      },

      activateTrackAtIndex: (index) => {
        const { queue } = get();
        if (index < 0 || index >= queue.length) return null;
        const track = queue[index];
        set(
          (state) => {
            const updates: Partial<PlayerState> = {
              queueIndex: index,
              currentTrack: track,
              currentTime: 0,
            };
            if (state.shuffleEnabled) {
              const filtered = state.shuffleHistory.filter((id) => id !== track.id);
              filtered.push(track.id);
              updates.shuffleHistory = filtered.slice(
                Math.max(0, filtered.length - state.shuffleHistorySize),
              );
              Object.assign(updates, recordShufflePlay(state, index));
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
        const next = get().previewNext();
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
        get().activateTrackAtIndex(previous.index);
        return previous.track;
      },
    }),
    { name: 'tarab/player-store', enabled: import.meta.env.DEV },
  ),
);
