import type { LibrarySearchScope } from '../../store/library-store';
import type { SortBy } from '../../types';

const root = ['library'] as const;

export const libraryKeys = {
  all: root,
  /** Without `sortBy` this is the prefix of every sorted track list (use it to invalidate). */
  tracks: (sortBy?: SortBy) =>
    sortBy ? ([...root, 'tracks', sortBy] as const) : ([...root, 'tracks'] as const),
  stats: () => [...root, 'stats'] as const,
  albums: () => [...root, 'albums'] as const,
  artists: () => [...root, 'artists'] as const,
  recent: (days: number, limit: number) => [...root, 'recent', days, limit] as const,
  mostPlayed: (limit: number) => [...root, 'most-played', limit] as const,
  trackCount: () => [...root, 'track-count'] as const,
  searchRoot: () => [...root, 'search'] as const,
  search: (query: string, scope: LibrarySearchScope = 'all') =>
    [...root, 'search', scope, query.trim().toLowerCase()] as const,
};
