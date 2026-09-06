import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { libraryKeys } from '../../features/library/queryKeys';
import type { Track } from '../../types';
import { useTagManagerLibraryTracks } from './useTagManagerLibraryTracks';

const { loadLibraryTrackSnapshotMock, useLibraryDataMock } = vi.hoisted(() => ({
  loadLibraryTrackSnapshotMock: vi.fn(),
  useLibraryDataMock: vi.fn(),
}));

vi.mock('../../features/library/cursorPagination', () => ({
  loadLibraryTrackSnapshot: loadLibraryTrackSnapshotMock,
}));
vi.mock('../../features/library/useLibraryData', () => ({
  useLibraryData: useLibraryDataMock,
}));

const makeTrack = (id: string): Track => ({
  id,
  title: id,
  artist: 'Artist',
  album: 'Album',
  year: null,
  duration: 180,
  filePath: `/music/${id}.mp3`,
  hasCoverArt: false,
  dateAdded: 1,
});

type LibraryState = {
  trackCount: number;
  tracks: Track[];
};

type SnapshotOptions = {
  signal?: AbortSignal;
  onProgress?: (tracks: Track[], restarted: boolean) => void;
};

const makeWrapper = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    wrapper: function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    },
  };
};

describe('useTagManagerLibraryTracks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('drops a hydrated snapshot when the loaded library identity changes', async () => {
    const oldLoadedTrack = makeTrack('old-loaded');
    const oldExtraTrack = makeTrack('old-extra');
    const newLoadedTrack = makeTrack('new-loaded');
    const newExtraTrack = makeTrack('new-extra');
    let libraryState: LibraryState = {
      trackCount: 2,
      tracks: [oldLoadedTrack],
    };
    let snapshotNumber = 0;

    useLibraryDataMock.mockImplementation(() => libraryState);
    loadLibraryTrackSnapshotMock.mockImplementation(async (options: SnapshotOptions) => {
      const tracks =
        snapshotNumber++ === 0 ? [oldLoadedTrack, oldExtraTrack] : [newLoadedTrack, newExtraTrack];
      options.onProgress?.(tracks, false);
      return { tracks, revision: snapshotNumber, totalCount: tracks.length };
    });

    const { wrapper } = makeWrapper();
    const { result, rerender } = renderHook(() => useTagManagerLibraryTracks(), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current.tracks.map((track) => track.id)).toEqual(['old-loaded', 'old-extra']),
    );

    libraryState = {
      trackCount: 2,
      tracks: [newLoadedTrack],
    };
    rerender();

    await waitFor(() =>
      expect(result.current.tracks.map((track) => track.id)).toEqual(['new-loaded', 'new-extra']),
    );
    expect(loadLibraryTrackSnapshotMock).toHaveBeenCalledTimes(2);
  });

  it('merges loaded metadata updates without restarting full hydration', async () => {
    const loadedTrack = makeTrack('loaded');
    const extraTrack = makeTrack('extra');
    const updatedLoadedTrack = { ...loadedTrack, title: 'Updated title' };
    const libraryState: LibraryState = {
      trackCount: 2,
      tracks: [loadedTrack],
    };

    useLibraryDataMock.mockImplementation(() => libraryState);
    loadLibraryTrackSnapshotMock.mockImplementation(async (options: SnapshotOptions) => {
      const tracks = [loadedTrack, extraTrack];
      options.onProgress?.(tracks, false);
      return { tracks, revision: 1, totalCount: tracks.length };
    });

    const { wrapper } = makeWrapper();
    const { result, rerender } = renderHook(() => useTagManagerLibraryTracks(), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current.tracks.map((track) => track.id)).toEqual(['loaded', 'extra']),
    );

    libraryState.tracks = [updatedLoadedTrack];
    rerender();

    await waitFor(() => expect(result.current.tracks[0]?.title).toBe('Updated title'));
    expect(loadLibraryTrackSnapshotMock).toHaveBeenCalledOnce();
  });

  it('surfaces hydration failures and retries the full-library snapshot', async () => {
    const loadedTrack = makeTrack('loaded');
    const extraTrack = makeTrack('extra');
    const libraryState: LibraryState = {
      trackCount: 2,
      tracks: [loadedTrack],
    };

    useLibraryDataMock.mockImplementation(() => libraryState);
    loadLibraryTrackSnapshotMock
      .mockRejectedValueOnce(new Error('Snapshot unavailable'))
      .mockImplementationOnce(async (options: SnapshotOptions) => {
        const tracks = [loadedTrack, extraTrack];
        options.onProgress?.(tracks, false);
        return { tracks, revision: 2, totalCount: tracks.length };
      });

    const { wrapper } = makeWrapper();
    const { result } = renderHook(() => useTagManagerLibraryTracks(), { wrapper });

    await waitFor(() => expect(result.current.hydrationError).toBe('Snapshot unavailable'));
    expect(result.current.isHydrating).toBe(false);
    expect(result.current.tracks).toEqual([loadedTrack]);
    expect(result.current.loadedCount).toBe(1);
    expect(result.current.totalCount).toBe(2);

    act(() => {
      result.current.retryHydration();
    });

    await waitFor(() => expect(result.current.hydrationError).toBeNull());
    expect(result.current.tracks).toEqual([loadedTrack, extraTrack]);
    expect(loadLibraryTrackSnapshotMock).toHaveBeenCalledTimes(2);
  });

  it('refetches the full snapshot when its dedicated query key is invalidated', async () => {
    const loadedTrack = makeTrack('loaded');
    const extraTrack = makeTrack('extra');
    const refreshedExtraTrack = { ...extraTrack, title: 'Refreshed extra' };
    const libraryState: LibraryState = {
      trackCount: 2,
      tracks: [loadedTrack],
    };
    let snapshotNumber = 0;

    useLibraryDataMock.mockImplementation(() => libraryState);
    loadLibraryTrackSnapshotMock.mockImplementation(async (options: SnapshotOptions) => {
      const tracks =
        snapshotNumber++ === 0 ? [loadedTrack, extraTrack] : [loadedTrack, refreshedExtraTrack];
      expect(options.signal).toBeInstanceOf(AbortSignal);
      options.onProgress?.(tracks, false);
      return { tracks, revision: snapshotNumber, totalCount: tracks.length };
    });

    const { queryClient, wrapper } = makeWrapper();
    const { result } = renderHook(() => useTagManagerLibraryTracks(), { wrapper });
    await waitFor(() => expect(result.current.tracks[1]?.title).toBe('extra'));

    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: libraryKeys.tagManagerTracks() });
    });

    await waitFor(() => expect(result.current.tracks[1]?.title).toBe('Refreshed extra'));
    expect(loadLibraryTrackSnapshotMock).toHaveBeenCalledTimes(2);
  });
});
