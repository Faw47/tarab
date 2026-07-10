import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../../types';
import { fetchLibraryTracksPage } from '../api';
import { loadTracksForShuffle, SHUFFLE_PAGE_SIZE, shuffleTracks } from '../loadTracksForShuffle';

vi.mock('../api', () => ({
  fetchLibraryTracksPage: vi.fn(),
}));

const mockedFetchPage = vi.mocked(fetchLibraryTracksPage);

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
    mockedFetchPage.mockReset();
  });

  it('uses already-loaded tracks when they cover the library', async () => {
    const loadedTracks = [makeTrack('a'), makeTrack('b')];

    await expect(loadTracksForShuffle({ loadedTracks, totalTracks: 2 })).resolves.toBe(
      loadedTracks,
    );
    expect(mockedFetchPage).not.toHaveBeenCalled();
  });

  it('fetches multiple pages when the loaded tracks are incomplete', async () => {
    const firstPage = Array.from({ length: SHUFFLE_PAGE_SIZE }, (_, index) =>
      makeTrack(`track-${index}`),
    );
    const secondPage = [makeTrack('last')];
    mockedFetchPage.mockResolvedValueOnce(firstPage).mockResolvedValueOnce(secondPage);

    const tracks = await loadTracksForShuffle({
      loadedTracks: [makeTrack('seed')],
      totalTracks: 1001,
    });

    expect(tracks).toHaveLength(1001);
    expect(tracks[0].id).toBe('track-0');
    expect(tracks.at(-1)?.id).toBe('last');
    expect(mockedFetchPage).toHaveBeenNthCalledWith(1, {
      offset: 0,
      limit: SHUFFLE_PAGE_SIZE,
      sortBy: 'dateAdded',
      sortOrder: 'desc',
    });
    expect(mockedFetchPage).toHaveBeenNthCalledWith(2, {
      offset: SHUFFLE_PAGE_SIZE,
      limit: SHUFFLE_PAGE_SIZE,
      sortBy: 'dateAdded',
      sortOrder: 'desc',
    });
  });

  it('stops when a short page is returned', async () => {
    mockedFetchPage.mockResolvedValueOnce([makeTrack('a')]);

    const tracks = await loadTracksForShuffle({ loadedTracks: [], totalTracks: 10_000 });

    expect(tracks.map((track) => track.id)).toEqual(['a']);
    expect(mockedFetchPage).toHaveBeenCalledTimes(1);
  });

  it('dedupes duplicate track IDs while preserving first fetched order', async () => {
    mockedFetchPage.mockResolvedValueOnce([makeTrack('a'), makeTrack('a'), makeTrack('b')]);

    const tracks = await loadTracksForShuffle({ loadedTracks: [], totalTracks: 3 });

    expect(tracks.map((track) => track.id)).toEqual(['a', 'b']);
  });

  it('falls back to loaded tracks when no fetched page has tracks', async () => {
    const loadedTracks = [makeTrack('seed')];
    mockedFetchPage.mockResolvedValueOnce([]);

    await expect(loadTracksForShuffle({ loadedTracks, totalTracks: 2 })).resolves.toBe(
      loadedTracks,
    );
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
