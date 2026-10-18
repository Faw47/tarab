import { describe, expect, it } from 'vitest';
import { libraryKeys } from '../../features/library/queryKeys';
import { playlistKeys } from '../../features/playlists/queryKeys';
import { QUERY_CACHE_BUSTER, shouldPersistQuery } from '../query-persistence';

const query = (queryKey: readonly unknown[], status: 'success' | 'error' = 'success') =>
  ({ queryKey, state: { status } }) as Parameters<typeof shouldPersistQuery>[0];

describe('query persistence', () => {
  it('persists only small queries', () => {
    // Regression for AR-16: every query, including search results and aggregates, was persisted.
    expect(shouldPersistQuery(query(libraryKeys.trackCount()))).toBe(true);
    expect(shouldPersistQuery(query(libraryKeys.stats()))).toBe(true);
    expect(shouldPersistQuery(query(libraryKeys.recent(30, 50)))).toBe(true);
    expect(shouldPersistQuery(query(playlistKeys.lists()))).toBe(true);

    expect(shouldPersistQuery(query(libraryKeys.search('fairuz')))).toBe(false);
    expect(shouldPersistQuery(query(libraryKeys.albums()))).toBe(false);
    expect(shouldPersistQuery(query(libraryKeys.artists()))).toBe(false);
    expect(shouldPersistQuery(query(libraryKeys.tracks('title')))).toBe(false);
    expect(shouldPersistQuery(query(playlistKeys.detail('p1')))).toBe(false);
    expect(shouldPersistQuery(query(libraryKeys.stats(), 'error'))).toBe(false);
  });

  it('busts the persisted cache with the app version', () => {
    expect(QUERY_CACHE_BUSTER).toMatch(/^\d+\.\d+\.\d+.*:\d+$/);
  });
});
