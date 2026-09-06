import { getSmartShuffleQueue } from '../../lib/tauri-commands';
import type { Track } from '../../types';
import { fetchLibraryTrackIds, fetchLibraryTracksByIds } from './api';
import { shuffleTracks } from './loadTracksForShuffle';

const completeShuffleOrder = (trackIds: string[], proposedOrder: string[]): string[] => {
  const available = new Set(trackIds);
  const seen = new Set<string>();
  const ordered = proposedOrder.filter((id) => {
    if (!available.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const missing = trackIds.filter((id) => !seen.has(id));
  return [...ordered, ...shuffleTracks(missing)];
};

export async function loadLargeShufflePlan(
  smartShuffle: boolean,
): Promise<{ orderedIds: string[]; firstTrack: Track } | null> {
  const trackIds = Array.from(new Set(await fetchLibraryTrackIds()));
  if (trackIds.length === 0) return null;

  let orderedIds = smartShuffle ? trackIds : shuffleTracks(trackIds);
  if (smartShuffle) {
    try {
      orderedIds = completeShuffleOrder(trackIds, await getSmartShuffleQueue(trackIds));
    } catch {
      orderedIds = shuffleTracks(trackIds);
    }
  }

  const firstBatch = await fetchLibraryTracksByIds(orderedIds.slice(0, 64));
  const firstTrack = firstBatch.find((track) => track.id === orderedIds[0]) ?? firstBatch[0];
  if (!firstTrack) return null;

  return {
    orderedIds: [firstTrack.id, ...orderedIds.filter((id) => id !== firstTrack.id)],
    firstTrack,
  };
}
