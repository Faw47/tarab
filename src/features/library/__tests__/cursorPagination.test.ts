import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../../types';
import { fetchLibraryTracksCursorPage } from '../api';
import { loadLibraryTrackContinuation, loadLibraryTrackSnapshot } from '../cursorPagination';

vi.mock('../api', () => ({
  fetchLibraryTracksCursorPage: vi.fn(),
}));

const fetchPage = vi.mocked(fetchLibraryTracksCursorPage);

const track = (id: string): Track => ({
  id,
  title: id,
  artist: 'Artist',
  album: 'Album',
  year: null,
  duration: 1,
  filePath: id,
  hasCoverArt: false,
  dateAdded: 1,
});

const cursor = (revision: number, lastId: string) => ({
  revision,
  lastId,
  sortBy: 'dateAdded',
  sortOrder: 'desc',
});

describe('cursor pagination', () => {
  beforeEach(() => {
    fetchPage.mockReset();
  });

  it('aborts before requesting a snapshot when its signal is already cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      loadLibraryTrackSnapshot({ limit: 10, signal: controller.signal }),
    ).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('does not commit a snapshot page when cancelled while a request is in flight', async () => {
    const controller = new AbortController();
    const progress: string[][] = [];
    fetchPage.mockImplementationOnce(async () => {
      controller.abort();
      return {
        status: 'ready',
        tracks: [track('cancelled-page')],
        nextCursor: null,
        revision: 1,
        totalCount: 1,
      };
    });

    await expect(
      loadLibraryTrackSnapshot({
        limit: 1,
        signal: controller.signal,
        onProgress: (tracks) => progress.push(tracks.map(({ id }) => id)),
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(progress).toEqual([]);
  });

  it('restarts a snapshot from the first page when its cursor is stale', async () => {
    const progress: string[][] = [];
    fetchPage
      .mockResolvedValueOnce({
        status: 'ready',
        tracks: [track('old-first')],
        nextCursor: cursor(1, 'old-first'),
        revision: 1,
        totalCount: 2,
      })
      .mockResolvedValueOnce({
        status: 'restartRequired',
        tracks: [],
        nextCursor: null,
        revision: 2,
        totalCount: 2,
      })
      .mockResolvedValueOnce({
        status: 'ready',
        tracks: [track('new-first')],
        nextCursor: cursor(2, 'new-first'),
        revision: 2,
        totalCount: 2,
      })
      .mockResolvedValueOnce({
        status: 'ready',
        tracks: [track('new-second')],
        nextCursor: null,
        revision: 2,
        totalCount: 2,
      });

    const result = await loadLibraryTrackSnapshot({
      limit: 1,
      onProgress: (tracks) => progress.push(tracks.map(({ id }) => id)),
    });

    expect(result.tracks.map(({ id }) => id)).toEqual(['new-first', 'new-second']);
    expect(progress).toEqual([['old-first'], [], ['new-first'], ['new-first', 'new-second']]);
    expect(fetchPage).toHaveBeenNthCalledWith(3, {
      limit: 1,
      sortBy: undefined,
      sortOrder: undefined,
      cursor: null,
    });
  });

  it('restarts infinite loading from the first page when its cursor is stale', async () => {
    fetchPage
      .mockResolvedValueOnce({
        status: 'restartRequired',
        tracks: [],
        nextCursor: null,
        revision: 9,
        totalCount: 1,
      })
      .mockResolvedValueOnce({
        status: 'ready',
        tracks: [track('replacement')],
        nextCursor: null,
        revision: 9,
        totalCount: 1,
      });

    const result = await loadLibraryTrackContinuation(cursor(8, 'removed'), { limit: 50 });

    expect(result.restarted).toBe(true);
    expect(result.page.tracks.map(({ id }) => id)).toEqual(['replacement']);
    expect(fetchPage).toHaveBeenNthCalledWith(2, { limit: 50, cursor: null });
  });

  it('restarts when a ready continuation carries a replacement revision', async () => {
    fetchPage
      .mockResolvedValueOnce({
        status: 'ready',
        tracks: [track('wrong-revision')],
        nextCursor: null,
        revision: 9,
        totalCount: 1,
      })
      .mockResolvedValueOnce({
        status: 'ready',
        tracks: [track('replacement')],
        nextCursor: null,
        revision: 9,
        totalCount: 1,
      });

    const result = await loadLibraryTrackContinuation(cursor(8, 'old-last'), { limit: 50 });

    expect(result.restarted).toBe(true);
    expect(result.page.tracks.map(({ id }) => id)).toEqual(['replacement']);
    expect(fetchPage).toHaveBeenNthCalledWith(2, { limit: 50, cursor: null });
  });

  it('fails predictably when every restarted snapshot is invalidated', async () => {
    fetchPage.mockResolvedValue({
      status: 'restartRequired',
      tracks: [],
      nextCursor: null,
      revision: 12,
      totalCount: 0,
    });

    await expect(loadLibraryTrackSnapshot({ limit: 10 })).rejects.toThrow('Library kept changing');
    expect(fetchPage).toHaveBeenCalledTimes(4);
  });
});
