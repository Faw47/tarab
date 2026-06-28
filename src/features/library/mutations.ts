import type { QueryClient } from '@tanstack/react-query';
import { libraryKeys } from './queryKeys';

export type LibraryMutationKind = 'upsert' | 'delete' | 'rename' | 'rating' | 'play-stats' | 'scan';

const INVALIDATION_MAP: Record<LibraryMutationKind, ReadonlyArray<readonly unknown[]>> = {
  upsert: [libraryKeys.tracks(), libraryKeys.trackCount(), libraryKeys.searchRoot()],
  delete: [libraryKeys.tracks(), libraryKeys.trackCount(), libraryKeys.searchRoot()],
  rename: [libraryKeys.tracks(), libraryKeys.searchRoot()],
  rating: [libraryKeys.tracks(), libraryKeys.searchRoot()],
  'play-stats': [libraryKeys.tracks()],
  scan: [libraryKeys.tracks(), libraryKeys.trackCount(), libraryKeys.searchRoot()],
};

export async function invalidateLibraryForMutation(
  queryClient: QueryClient,
  kind: LibraryMutationKind,
): Promise<void> {
  const targets = INVALIDATION_MAP[kind];
  await Promise.all(targets.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}
