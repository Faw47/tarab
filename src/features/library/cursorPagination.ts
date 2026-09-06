import type { SortBy, Track } from '../../types';
import {
  fetchLibraryTracksCursorPage,
  type LibraryTrackCursorPage,
  type LibraryTrackPageCursor,
} from './api';
import { mergeTrackPages } from './mergeTrackPages';

const MAX_CURSOR_RESTARTS = 3;

interface CursorRequestOptions {
  limit: number;
  sortBy?: SortBy;
  sortOrder?: 'asc' | 'desc';
  signal?: AbortSignal;
}

export interface LibraryTrackSnapshot {
  tracks: Track[];
  revision: number;
  totalCount: number;
}

const cursorRevisionChanged = (
  cursor: LibraryTrackPageCursor | null,
  page: LibraryTrackCursorPage,
): boolean => cursor !== null && page.status === 'ready' && page.revision !== cursor.revision;

const throwIfAborted = (signal?: AbortSignal): void => {
  if (!signal?.aborted) return;
  const error = new Error('Library snapshot loading was cancelled.');
  error.name = 'AbortError';
  throw error;
};

export async function loadLibraryTrackSnapshot(
  options: CursorRequestOptions & {
    onProgress?: (tracks: Track[], restarted: boolean) => void;
  },
): Promise<LibraryTrackSnapshot> {
  let cursor: LibraryTrackPageCursor | null = null;
  let tracks: Track[] = [];
  let restartCount = 0;

  for (;;) {
    throwIfAborted(options.signal);
    const page = await fetchLibraryTracksCursorPage({
      cursor,
      limit: options.limit,
      sortBy: options.sortBy,
      sortOrder: options.sortOrder,
    });
    throwIfAborted(options.signal);
    if (page.status === 'restartRequired' || cursorRevisionChanged(cursor, page)) {
      restartCount += 1;
      if (restartCount > MAX_CURSOR_RESTARTS) {
        throw new Error('Library kept changing while it was being loaded; retry the operation.');
      }
      cursor = null;
      tracks = [];
      options.onProgress?.(tracks, true);
      continue;
    }

    tracks = mergeTrackPages(tracks, page.tracks);
    options.onProgress?.(tracks, false);
    if (!page.nextCursor) {
      return { tracks, revision: page.revision, totalCount: page.totalCount };
    }
    cursor = page.nextCursor;
  }
}

export async function loadLibraryTrackContinuation(
  cursor: LibraryTrackPageCursor,
  options: CursorRequestOptions,
): Promise<{ page: LibraryTrackCursorPage; restarted: boolean }> {
  let nextCursor: LibraryTrackPageCursor | null = cursor;

  for (let restartCount = 0; restartCount <= MAX_CURSOR_RESTARTS; restartCount += 1) {
    throwIfAborted(options.signal);
    const page = await fetchLibraryTracksCursorPage({
      cursor: nextCursor,
      limit: options.limit,
      sortBy: options.sortBy,
      sortOrder: options.sortOrder,
    });
    throwIfAborted(options.signal);
    if (page.status === 'ready') {
      if (cursorRevisionChanged(nextCursor, page)) {
        nextCursor = null;
        continue;
      }
      return { page, restarted: nextCursor === null };
    }
    nextCursor = null;
  }

  throw new Error('Library kept changing while it was being loaded; retry scrolling.');
}
