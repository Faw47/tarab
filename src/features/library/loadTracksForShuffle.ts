import type { Track } from '../../types';
import { loadLibraryTrackSnapshot } from './cursorPagination';

export const SHUFFLE_PAGE_SIZE = 1000;

export async function loadTracksForShuffle({
  loadedTracks,
  totalTracks,
  onProgress,
}: {
  loadedTracks: Track[];
  totalTracks: number;
  onProgress?: (progress: number) => void;
}): Promise<Track[]> {
  if (totalTracks === 0 && loadedTracks.length === 0) return loadedTracks;

  const snapshot = await loadLibraryTrackSnapshot({
    limit: SHUFFLE_PAGE_SIZE,
    sortBy: 'dateAdded',
    sortOrder: 'desc',
    onProgress: (tracks, restarted) => {
      if (restarted) {
        onProgress?.(0);
        return;
      }
      const expectedCount = Math.max(totalTracks, tracks.length, 1);
      onProgress?.(
        tracks.length >= expectedCount ? 100 : Math.floor((tracks.length / expectedCount) * 100),
      );
    },
  });
  return snapshot.tracks;
}

export function shuffleTracks<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
