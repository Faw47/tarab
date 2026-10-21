import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibraryStore } from '../../../store/library-store';
import type { Track } from '../../../types';
import { useLibraryData } from '../useLibraryData';

const { fetchPageMock } = vi.hoisted(() => ({ fetchPageMock: vi.fn() }));

vi.mock('../api', async (importOriginal) => ({
  sortOrderFor: (await importOriginal<typeof import('../api')>()).sortOrderFor,
  fetchLibraryTracksPage: fetchPageMock,
  fetchAlbumAggregates: vi.fn(async () => []),
  fetchArtistAggregates: vi.fn(async () => []),
  fetchLibrarySearch: vi.fn(async () => ({ metadata: [], lyrics: [] })),
  fetchLibraryStats: vi.fn(async () => null),
  fetchLibraryTrackCount: vi.fn(async () => 3),
  fetchMostPlayedTracks: vi.fn(async () => []),
  fetchRecentlyAddedTracks: vi.fn(async () => []),
  mapSearchResultToTrack: vi.fn(),
}));

vi.mock('../../../workers/librarySearchFuseClient', () => ({
  rankTracksWithFuseWorker: vi.fn(async () => []),
}));

const track = (id: string, title: string): Track => ({
  id,
  title,
  artist: 'Artist',
  album: 'Album',
  year: null,
  duration: 100,
  filePath: `/music/${id}.flac`,
  hasCoverArt: false,
  dateAdded: 1,
});

let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useLibraryData sorting', () => {
  beforeEach(() => {
    fetchPageMock.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    useLibraryStore.setState({ searchQuery: '', sortBy: 'dateAdded' });
  });

  it('asks the database for the selected sort instead of sorting loaded pages', async () => {
    // The database returns its own (case-insensitive) order; the hook must keep it.
    fetchPageMock.mockResolvedValue([track('b', 'beta'), track('a', 'Alpha'), track('c', 'gamma')]);
    useLibraryStore.setState({ sortBy: 'title' });

    const { result } = renderHook(() => useLibraryData(), { wrapper });

    await waitFor(() => {
      expect(result.current.tracks).toHaveLength(3);
    });
    expect(fetchPageMock).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: null, sortBy: 'title', sortOrder: 'asc' }),
    );
    expect(result.current.getFilteredTracks().map((item) => item.id)).toEqual(['b', 'a', 'c']);
  });

  it('refetches the first page when the sort changes', async () => {
    fetchPageMock.mockResolvedValue([track('a', 'Alpha')]);
    const { result } = renderHook(() => useLibraryData(), { wrapper });
    await waitFor(() => {
      expect(fetchPageMock).toHaveBeenCalledWith(
        expect.objectContaining({ sortBy: 'dateAdded', sortOrder: 'desc' }),
      );
    });

    act(() => {
      result.current.setSortBy('artist');
    });

    await waitFor(() => {
      expect(fetchPageMock).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: null, sortBy: 'artist', sortOrder: 'asc' }),
      );
    });
  });
});
