import type { LibrarySearchScope } from '../../store/library-store';

const root = ['library'] as const;

export const libraryKeys = {
  all: root,
  tracks: () => [...root, 'tracks'] as const,
  trackCount: () => [...root, 'track-count'] as const,
  searchRoot: () => [...root, 'search'] as const,
  search: (query: string, scope: LibrarySearchScope = 'all') =>
    [...root, 'search', scope, query.trim().toLowerCase()] as const,
};
