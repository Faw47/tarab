import type { QueryClient } from '@tanstack/react-query';
import type { Track } from '../../types';
import { libraryKeys } from './queryKeys';

/**
 * Track lists are cached once per sort under the `libraryKeys.tracks()` prefix. Exact-key reads
 * and writes of the prefix itself match no list, so local edits must go through these helpers.
 */
export function getCachedLibraryTracks(queryClient: QueryClient): Track[] {
  const byPath = new Map<string, Track>();
  for (const [, tracks] of queryClient.getQueriesData<Track[]>({
    queryKey: libraryKeys.tracks(),
  })) {
    for (const track of tracks ?? []) {
      if (!byPath.has(track.filePath)) byPath.set(track.filePath, track);
    }
  }
  return Array.from(byPath.values());
}

/** Applies `update` to every cached sorted track list, leaving lists that were never loaded. */
export function updateCachedLibraryTracks(
  queryClient: QueryClient,
  update: (tracks: Track[]) => Track[],
): void {
  queryClient.setQueriesData<Track[]>({ queryKey: libraryKeys.tracks() }, (tracks) =>
    tracks ? update(tracks) : tracks,
  );
}
