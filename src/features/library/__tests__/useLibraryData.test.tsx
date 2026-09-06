import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibraryStore } from '../../../store/library-store';
import type { Track } from '../../../types';
import type { LibraryTrackCursorPage } from '../api';
import { libraryKeys } from '../queryKeys';
import { useLibraryData } from '../useLibraryData';

const {
  fetchAlbumAggregatesMock,
  fetchArtistAggregatesMock,
  fetchLibrarySearchMock,
  fetchLibraryStatsMock,
  fetchLibraryTrackCountMock,
  fetchLibraryTracksCursorPageMock,
  fetchMostPlayedTracksMock,
  fetchRecentlyAddedTracksMock,
  rankTracksWithFuseWorkerMock,
} = vi.hoisted(() => ({
  fetchAlbumAggregatesMock: vi.fn(async () => []),
  fetchArtistAggregatesMock: vi.fn(async () => []),
  fetchLibrarySearchMock: vi.fn(),
  fetchLibraryStatsMock: vi.fn(async () => ({
    trackCount: 2,
    totalDuration: 2,
    artistCount: 1,
    albumCount: 1,
    totalPlays: 0,
  })),
  fetchLibraryTrackCountMock: vi.fn(async () => 2),
  fetchLibraryTracksCursorPageMock: vi.fn(),
  fetchMostPlayedTracksMock: vi.fn(async () => []),
  fetchRecentlyAddedTracksMock: vi.fn(async () => []),
  rankTracksWithFuseWorkerMock: vi.fn(),
}));

vi.mock('../api', () => ({
  fetchAlbumAggregates: fetchAlbumAggregatesMock,
  fetchArtistAggregates: fetchArtistAggregatesMock,
  fetchLibrarySearch: fetchLibrarySearchMock,
  fetchLibraryStats: fetchLibraryStatsMock,
  fetchLibraryTrackCount: fetchLibraryTrackCountMock,
  fetchLibraryTracksCursorPage: fetchLibraryTracksCursorPageMock,
  fetchMostPlayedTracks: fetchMostPlayedTracksMock,
  fetchRecentlyAddedTracks: fetchRecentlyAddedTracksMock,
  mapSearchResultToTrack: vi.fn((track: Track) => track),
}));
vi.mock('../../../workers/librarySearchFuseClient', () => ({
  rankTracksWithFuseWorker: rankTracksWithFuseWorkerMock,
}));

const track = (id: string): Track => ({
  id,
  title: id,
  artist: 'Artist',
  album: 'Album',
  year: null,
  duration: 1,
  filePath: `/music/${id}.mp3`,
  hasCoverArt: false,
  dateAdded: 1,
});

const cursorPage = (
  revision: number,
  tracks: Track[],
  lastId: string | null,
): LibraryTrackCursorPage => ({
  status: 'ready',
  tracks,
  nextCursor: lastId ? { revision, lastId, sortBy: 'dateAdded', sortOrder: 'desc' } : null,
  revision,
  totalCount: 2,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('useLibraryData cursor commits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLibraryStore.setState({ searchQuery: '', searchScope: 'all', sortBy: 'dateAdded' });
  });

  it('discards an in-flight old continuation and restarts from a replacement traversal', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const oldFirst = track('old-first');
    const newFirst = track('new-first');
    const newSecond = track('new-second');
    const initialTraversal = cursorPage(1, [oldFirst], oldFirst.id);
    const replacementTraversal = cursorPage(2, [newFirst], newFirst.id);
    queryClient.setQueryData(libraryKeys.tracks(), [oldFirst]);
    queryClient.setQueryData(libraryKeys.traversal(), initialTraversal);
    queryClient.setQueryData(libraryKeys.trackCount(), 2);

    const oldContinuation = deferred<LibraryTrackCursorPage>();
    fetchLibraryTracksCursorPageMock.mockImplementation(
      ({ cursor }: { cursor?: { revision: number } | null }) => {
        if (cursor?.revision === 1) return oldContinuation.promise;
        if (cursor?.revision === 2) return Promise.resolve(cursorPage(2, [newSecond], null));
        throw new Error('Unexpected cursor');
      },
    );

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useLibraryData(), { wrapper });

    let loadPromise!: ReturnType<typeof result.current.loadMoreTracks>;
    act(() => {
      loadPromise = result.current.loadMoreTracks(1);
    });
    await waitFor(() => expect(fetchLibraryTracksCursorPageMock).toHaveBeenCalledTimes(1));

    act(() => {
      queryClient.setQueryData(libraryKeys.tracks(), [newFirst]);
      queryClient.setQueryData(libraryKeys.traversal(), replacementTraversal);
    });
    oldContinuation.resolve(cursorPage(1, [track('old-second')], null));

    let loadResult!: Awaited<typeof loadPromise>;
    await act(async () => {
      loadResult = await loadPromise;
    });

    expect(loadResult.tracks).toEqual([newSecond]);
    expect(queryClient.getQueryData<Track[]>(libraryKeys.tracks())).toEqual([newFirst, newSecond]);
    expect(
      queryClient.getQueryData<LibraryTrackCursorPage>(libraryKeys.traversal())?.revision,
    ).toBe(2);
    expect(fetchLibraryTracksCursorPageMock).toHaveBeenCalledTimes(2);
    expect(fetchLibraryTracksCursorPageMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: replacementTraversal.nextCursor }),
    );
    queryClient.clear();
  });

  it('falls back to query order when the Fuse worker fails', async () => {
    const first = track('first');
    const second = track('second');
    useLibraryStore.setState({ searchQuery: 'jazz', searchScope: 'all', sortBy: 'dateAdded' });

    fetchLibrarySearchMock.mockResolvedValue({
      metadata: [first, second],
      lyrics: [],
    });
    rankTracksWithFuseWorkerMock
      .mockRejectedValueOnce(new Error('Worker unavailable'))
      .mockResolvedValue([]);

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(libraryKeys.tracks(), [first, second]);
    queryClient.setQueryData(libraryKeys.trackCount(), 2);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useLibraryData(), { wrapper });

    await waitFor(() =>
      expect(result.current.getFilteredTracks().map((item) => item.id)).toEqual([
        first.id,
        second.id,
      ]),
    );
    expect(rankTracksWithFuseWorkerMock).toHaveBeenCalledWith(expect.any(Array), 'jazz', 'all');
    queryClient.clear();
  });

  it('exposes partial search failures while preserving fulfilled results', async () => {
    const first = track('first');
    useLibraryStore.setState({ searchQuery: 'jazz', searchScope: 'all', sortBy: 'dateAdded' });
    fetchLibrarySearchMock.mockResolvedValue({
      metadata: [first],
      lyrics: [],
      unavailableBranches: ['lyrics'],
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(libraryKeys.tracks(), [first]);
    queryClient.setQueryData(libraryKeys.trackCount(), 1);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result, unmount } = renderHook(() => useLibraryData(), { wrapper });

    await waitFor(() => {
      expect(result.current.getFilteredTracks()).toEqual([first]);
      expect(result.current.searchPartialError).toBe(
        'Some search sources are unavailable (lyrics index). Results may be incomplete.',
      );
    });

    expect(result.current.searchError).toBeNull();
    unmount();
    queryClient.clear();
  });
  it('propagates cover-art hashes to cached library surfaces', () => {
    const albumTrack = {
      ...track('album-track'),
      filePath: '/music/album-track.mp3',
      album: 'Shared Album',
    };
    const artistTrack = {
      ...track('artist-track'),
      filePath: '/music/artist-track.mp3',
      artist: 'Artist',
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
    });
    queryClient.setQueryData(libraryKeys.tracks(), [albumTrack, artistTrack]);
    queryClient.setQueryData(libraryKeys.trackCount(), 2);
    queryClient.setQueryData(libraryKeys.stats(), {
      trackCount: 2,
      totalDuration: 2,
      artistCount: 1,
      albumCount: 1,
      totalPlays: 0,
    });
    queryClient.setQueryData(libraryKeys.recent(30, 50), [albumTrack]);
    queryClient.setQueryData(libraryKeys.mostPlayed(100), [artistTrack]);
    queryClient.setQueryData(libraryKeys.albums(), [
      { album: 'Shared Album', artist: 'Artist', count: 1, track: albumTrack },
    ]);
    queryClient.setQueryData(libraryKeys.artists(), [
      { artist: 'Artist', count: 1, tracks: [artistTrack] },
    ]);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useLibraryData(), { wrapper });

    act(() => {
      result.current.applyCoverArtHashes([
        [albumTrack.filePath, 'album-hash'],
        [artistTrack.filePath, 'artist-hash'],
      ]);
    });

    expect(queryClient.getQueryData<Track[]>(libraryKeys.tracks())).toEqual([
      expect.objectContaining({
        filePath: albumTrack.filePath,
        hasCoverArt: true,
        coverArtHash: 'album-hash',
      }),
      expect.objectContaining({
        filePath: artistTrack.filePath,
        hasCoverArt: true,
        coverArtHash: 'artist-hash',
      }),
    ]);
    expect(queryClient.getQueryData<Track[]>(libraryKeys.recent(30, 50))?.[0]).toEqual(
      expect.objectContaining({ coverArtHash: 'album-hash' }),
    );
    expect(queryClient.getQueryData<Track[]>(libraryKeys.mostPlayed(100))?.[0]).toEqual(
      expect.objectContaining({ coverArtHash: 'artist-hash' }),
    );
    expect(
      queryClient.getQueryData<Array<{ track: Track }>>(libraryKeys.albums())?.[0].track,
    ).toEqual(expect.objectContaining({ coverArtHash: 'album-hash' }));
    expect(
      queryClient.getQueryData<Array<{ tracks: Track[] }>>(libraryKeys.artists())?.[0].tracks[0],
    ).toEqual(expect.objectContaining({ coverArtHash: 'artist-hash' }));
    queryClient.clear();
  });
  it('does not show the previous query ranking while a new worker request is pending', async () => {
    const first = track('first');
    const second = track('second');
    const jazzRanking = deferred<Track[]>();
    const rockRanking = deferred<Track[]>();
    useLibraryStore.setState({ searchQuery: 'jazz', searchScope: 'all', sortBy: 'dateAdded' });

    fetchLibrarySearchMock.mockImplementation(async (query: string) => ({
      metadata: query === 'jazz' ? [first, second] : [second, first],
      lyrics: [],
    }));
    rankTracksWithFuseWorkerMock.mockImplementation((_tracks: unknown[], query: string) =>
      query === 'jazz' ? jazzRanking.promise : rockRanking.promise,
    );

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(libraryKeys.tracks(), [first, second]);
    queryClient.setQueryData(libraryKeys.trackCount(), 2);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useLibraryData(), { wrapper });

    await waitFor(() =>
      expect(rankTracksWithFuseWorkerMock).toHaveBeenCalledWith(expect.anything(), 'jazz', 'all'),
    );
    jazzRanking.resolve([first, second]);
    await waitFor(() =>
      expect(result.current.getFilteredTracks().map((item) => item.id)).toEqual([
        first.id,
        second.id,
      ]),
    );

    act(() => {
      useLibraryStore.setState({ searchQuery: 'rock' });
    });
    await waitFor(() =>
      expect(result.current.getFilteredTracks().map((item) => item.id)).toEqual([
        second.id,
        first.id,
      ]),
    );
    rockRanking.resolve([second, first]);
    queryClient.clear();
  });
  it('surfaces secondary data failures and retries every affected query', async () => {
    const first = track('first');
    fetchLibraryTracksCursorPageMock.mockResolvedValueOnce(cursorPage(1, [first], null));
    fetchLibraryStatsMock.mockRejectedValueOnce(new Error('stats unavailable'));
    fetchAlbumAggregatesMock.mockRejectedValueOnce(new Error('albums unavailable'));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result, unmount } = renderHook(() => useLibraryData(), { wrapper });

    await waitFor(() => {
      expect(result.current.librarySecondaryError).toContain('library statistics');
      expect(result.current.librarySecondaryError).toContain('album groups');
    });

    await act(async () => {
      await result.current.retryLibrarySecondaryData();
    });

    await waitFor(() => expect(result.current.librarySecondaryError).toBeNull());
    expect(fetchLibraryStatsMock).toHaveBeenCalledTimes(2);
    expect(fetchAlbumAggregatesMock).toHaveBeenCalledTimes(2);
    unmount();
    queryClient.clear();
  });
});
