import type { Track } from '../../types';

/** The queue entry handed to the backend by `preload_next_track`. */
export interface PreloadedGaplessEntry {
  track: Track;
  index: number;
  generation: number | null;
}

/**
 * Finds the queue index of the track the backend actually started at a seamless handoff.
 *
 * The backend appended `incomingPath` to the sink when the track was preloaded, so the UI must
 * follow that entry rather than choosing the next track again (a second choice differs under
 * shuffle, or after queue edits). Matching prefers the preloaded queue entry identity, then the
 * preloaded index, then the first queue entry with the same file. Returns -1 if none matches.
 */
export function resolveGaplessHandoffIndex(
  queue: Track[],
  preloaded: PreloadedGaplessEntry | null,
  incomingPath: string | null,
): number {
  const path = incomingPath ?? preloaded?.track.filePath ?? null;
  if (!path) return -1;

  if (preloaded && preloaded.track.filePath === path) {
    const queueId = preloaded.track._queueId;
    if (queueId) {
      const byQueueId = queue.findIndex((track) => track._queueId === queueId);
      if (byQueueId >= 0) return byQueueId;
    }
    if (queue[preloaded.index]?.filePath === path) return preloaded.index;
  }

  return queue.findIndex((track) => track.filePath === path);
}
