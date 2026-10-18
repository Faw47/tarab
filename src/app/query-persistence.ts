import type { Query } from '@tanstack/react-query';
import { version as appVersion } from '../../package.json';

/** Bump when a persisted query's data shape changes without an app version change. */
const QUERY_CACHE_SCHEMA = 2;

/**
 * Persisted queries are discarded when this changes, so data cached by an older build with a
 * different shape is never hydrated.
 */
export const QUERY_CACHE_BUSTER = `${appVersion}:${QUERY_CACHE_SCHEMA}`;

/** Small library queries that make the first paint after launch useful. */
const PERSISTED_LIBRARY_QUERIES = new Set(['track-count', 'stats', 'recent', 'most-played']);

/**
 * Only small queries are written to the persisted cache. Track pages, album and artist aggregates
 * (one full track per album) and per-search-string results can be megabytes, and every cache
 * change re-serialized all of them on the main thread.
 */
export function shouldPersistQuery(query: Pick<Query, 'queryKey' | 'state'>): boolean {
  if (query.state.status !== 'success') return false;
  const [root, kind] = query.queryKey;
  if (root === 'library') return typeof kind === 'string' && PERSISTED_LIBRARY_QUERIES.has(kind);
  return root === 'playlists' && kind === 'list';
}
