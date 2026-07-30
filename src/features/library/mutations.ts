import type { QueryClient } from '@tanstack/react-query';
import { playlistKeys } from '../playlists/queryKeys';
import { libraryKeys } from './queryKeys';

export type LibraryMutationKind = 'upsert' | 'delete' | 'rename' | 'rating' | 'play-stats' | 'scan';

const INVALIDATION_MAP: Record<LibraryMutationKind, ReadonlyArray<readonly unknown[]>> = {
  upsert: [
    libraryKeys.tracks(),
    libraryKeys.stats(),
    libraryKeys.albums(),
    libraryKeys.artists(),
    libraryKeys.recent(30, 50),
    libraryKeys.mostPlayed(100),
    libraryKeys.trackCount(),
    libraryKeys.searchRoot(),
  ],
  delete: [
    libraryKeys.tracks(),
    libraryKeys.stats(),
    libraryKeys.albums(),
    libraryKeys.artists(),
    libraryKeys.recent(30, 50),
    libraryKeys.mostPlayed(100),
    libraryKeys.trackCount(),
    libraryKeys.searchRoot(),
  ],
  rename: [
    libraryKeys.tracks(),
    libraryKeys.albums(),
    libraryKeys.artists(),
    libraryKeys.searchRoot(),
  ],
  rating: [libraryKeys.tracks(), libraryKeys.searchRoot()],
  'play-stats': [
    libraryKeys.tracks(),
    libraryKeys.stats(),
    libraryKeys.albums(),
    libraryKeys.artists(),
    libraryKeys.mostPlayed(100),
  ],
  scan: [
    libraryKeys.tracks(),
    libraryKeys.stats(),
    libraryKeys.albums(),
    libraryKeys.artists(),
    libraryKeys.recent(30, 50),
    libraryKeys.mostPlayed(100),
    libraryKeys.trackCount(),
    libraryKeys.searchRoot(),
  ],
};

export async function invalidateLibraryForMutation(
  queryClient: QueryClient,
  kind: LibraryMutationKind,
): Promise<void> {
  const targets = INVALIDATION_MAP[kind];
  await Promise.all(targets.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
  if (kind === 'rating' || kind === 'play-stats' || kind === 'scan' || kind === 'upsert') {
    await queryClient.invalidateQueries({ queryKey: playlistKeys.all });
  }
}
