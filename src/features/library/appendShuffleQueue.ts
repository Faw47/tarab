import { usePlayerStore } from '../../store/player-store';
import type { Track } from '../../types';
import { fetchLibraryTracksByIds } from './api';

export const SHUFFLE_METADATA_BATCH_SIZE = 200;

interface AppendShuffleQueueOptions {
  orderedIds: string[];
  firstTrack: Track;
  addToQueue: (track: Track) => void;
  addTracksToQueue?: (tracks: Track[]) => void;
  onProgress?: (progress: number) => void;
}

export async function appendShuffleQueue({
  orderedIds,
  firstTrack,
  addToQueue,
  addTracksToQueue,
  onProgress,
}: AppendShuffleQueueOptions): Promise<{ cancelled: boolean; appended: number }> {
  const remainingIds = orderedIds.filter((id) => id !== firstTrack.id);
  let expectedQueueVersion = usePlayerStore.getState().queueVersion;
  const expectedQueueId = usePlayerStore.getState().currentTrack?._queueId;
  const isExpectedFirstTrackActive = (currentTrack: Track | null) =>
    currentTrack?.id === firstTrack.id &&
    currentTrack.filePath === firstTrack.filePath &&
    (expectedQueueId === undefined || currentTrack._queueId === expectedQueueId);
  let appended = 0;

  if (remainingIds.length === 0) {
    onProgress?.(100);
    return { cancelled: false, appended };
  }

  for (let offset = 0; offset < remainingIds.length; offset += SHUFFLE_METADATA_BATCH_SIZE) {
    const beforeFetch = usePlayerStore.getState();
    if (
      !isExpectedFirstTrackActive(beforeFetch.currentTrack) ||
      beforeFetch.queueVersion !== expectedQueueVersion
    ) {
      return { cancelled: true, appended };
    }

    const batchIds = remainingIds.slice(offset, offset + SHUFFLE_METADATA_BATCH_SIZE);
    const tracks = await fetchLibraryTracksByIds(batchIds);
    const tracksById = new Map(tracks.map((track) => [track.id, track] as const));

    const tracksToAppend = batchIds
      .map((id) => tracksById.get(id))
      .filter((track): track is Track => Boolean(track));
    const state = usePlayerStore.getState();
    if (
      !isExpectedFirstTrackActive(state.currentTrack) ||
      state.queueVersion !== expectedQueueVersion
    ) {
      return { cancelled: true, appended };
    }
    if (tracksToAppend.length > 0) {
      if (addTracksToQueue) {
        addTracksToQueue(tracksToAppend);
      } else {
        for (const track of tracksToAppend) addToQueue(track);
      }
      expectedQueueVersion = usePlayerStore.getState().queueVersion;
      appended += tracksToAppend.length;
    }

    onProgress?.(Math.floor(((offset + batchIds.length) / remainingIds.length) * 100));
  }

  return { cancelled: false, appended };
}
