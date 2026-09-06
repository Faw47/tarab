import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../../types';
import { loadLibraryTrackSnapshot } from '../cursorPagination';
import { loadTracksForShuffle, SHUFFLE_PAGE_SIZE, shuffleTracks } from '../loadTracksForShuffle';

vi.mock('../cursorPagination', () => ({
  loadLibraryTrackSnapshot: vi.fn(),
}));

const mockedLoadSnapshot = vi.mocked(loadLibraryTrackSnapshot);

const makeTrack = (id: string): Track => ({
  id,
  title: `Track ${id}`,
  artist: 'Artist',
  album: 'Album',
  year: null,
  duration: 180,
  filePath: id,
  hasCoverArt: false,
  coverArtHash: null,
  dateAdded: 1,
});

describe('loadTracksForShuffle', () => {
  beforeEach(() => {
    mockedLoadSnapshot.mockReset();
  });

  it('does not open a traversal for an empty library', async () => {
    const loadedTracks: Track[] = [];

    await expect(loadTracksForShuffle({ loadedTracks, totalTracks: 0 })).resolves.toBe(
      loadedTracks,
    );
    expect(mockedLoadSnapshot).not.toHaveBeenCalled();
  });

  it('loads a revision-stable snapshot even when the cache appears complete', async () => {
    const snapshotTracks = [makeTrack('fresh-a'), makeTrack('fresh-b')];
    mockedLoadSnapshot.mockResolvedValue({
      tracks: snapshotTracks,
      revision: 8,
      totalCount: 2,
    });

    const tracks = await loadTracksForShuffle({
      loadedTracks: [makeTrack('stale-a'), makeTrack('stale-b')],
      totalTracks: 2,
    });

    expect(tracks).toBe(snapshotTracks);
    expect(mockedLoadSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        limit: SHUFFLE_PAGE_SIZE,
        sortBy: 'dateAdded',
        sortOrder: 'desc',
      }),
    );
  });
  it('reports cursor progress and resets after a traversal restart', async () => {
    const first = makeTrack('first');
    const second = makeTrack('second');
    const onProgress = vi.fn();
    mockedLoadSnapshot.mockImplementationOnce(async (options) => {
      options.onProgress?.([first], false);
      options.onProgress?.([], true);
      options.onProgress?.([first, second], false);
      return { tracks: [first, second], revision: 3, totalCount: 2 };
    });

    await loadTracksForShuffle({
      loadedTracks: [first],
      totalTracks: 2,
      onProgress,
    });

    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([50, 0, 100]);
  });
});

describe('shuffleTracks', () => {
  it('returns the same members without mutating the input', () => {
    const input = ['a', 'b', 'c'];
    const output = shuffleTracks(input);

    expect(output).toHaveLength(input.length);
    expect(output).toEqual(expect.arrayContaining(input));
    expect(input).toEqual(['a', 'b', 'c']);
    expect(output).not.toBe(input);
  });
});
