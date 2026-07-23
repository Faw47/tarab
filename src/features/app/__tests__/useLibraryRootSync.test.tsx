import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../../types';
import { useLibraryRootSync } from '../useLibraryRootSync';

const listLibraryGrantsMock = vi.hoisted(() =>
  vi.fn(async () => [
    { id: 'grant-1', path: '/music', displayName: 'music', status: 'available' as const },
  ]),
);
const syncLyricsIndexMock = vi.hoisted(() => vi.fn(async () => 0));
const reportErrorMock = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/tauri-commands', () => ({
  listLibraryGrants: listLibraryGrantsMock,
  syncLyricsIndex: syncLyricsIndexMock,
}));

vi.mock('../../../lib/report-error', () => ({
  reportError: reportErrorMock,
}));

const track: Track = {
  id: '/music/one.mp3',
  title: 'One',
  artist: 'Artist',
  albumArtist: null,
  album: 'Album',
  year: 2024,
  duration: 180,
  filePath: '/music/one.mp3',
  hasCoverArt: true,
  coverArtHash: null,
  dateAdded: 1,
};

describe('useLibraryRootSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listLibraryGrantsMock.mockResolvedValue([
      { id: 'grant-1', path: '/music', displayName: 'music', status: 'available' },
    ]);
    syncLyricsIndexMock.mockResolvedValue(0);
  });

  it('syncs roots before refreshing lyrics and prefetching cover art', async () => {
    const prefetchCoverArt = vi.fn(async () => undefined);
    const setLibraryFolders = vi.fn();

    const { result } = renderHook(() =>
      useLibraryRootSync({
        libraryFolders: ['/music'],
        libraryTracks: [track],
        prefetchCoverArt,
        setLibraryFolders,
      }),
    );

    await waitFor(() => expect(result.current.libraryRootsReady).toBe(true));

    expect(listLibraryGrantsMock).toHaveBeenCalled();
    expect(setLibraryFolders).not.toHaveBeenCalled();
    expect(syncLyricsIndexMock).toHaveBeenCalledTimes(1);
    expect(prefetchCoverArt).toHaveBeenCalledWith([track]);
  });

  it('does not refresh lyrics or prefetch cover art when no roots are configured', async () => {
    const prefetchCoverArt = vi.fn(async () => undefined);
    const setLibraryFolders = vi.fn();
    listLibraryGrantsMock.mockResolvedValue([]);

    const { result } = renderHook(() =>
      useLibraryRootSync({
        libraryFolders: [],
        libraryTracks: [track],
        prefetchCoverArt,
        setLibraryFolders,
      }),
    );

    await waitFor(() => expect(result.current.libraryRootsReady).toBe(true));

    expect(setLibraryFolders).not.toHaveBeenCalled();
    expect(syncLyricsIndexMock).not.toHaveBeenCalled();
    expect(prefetchCoverArt).not.toHaveBeenCalled();
  });

  it('does not prefetch cover art when root syncing fails', async () => {
    const error = new Error('permission denied');
    const prefetchCoverArt = vi.fn(async () => undefined);
    const setLibraryFolders = vi.fn();
    listLibraryGrantsMock.mockRejectedValueOnce(error);

    const { result } = renderHook(() =>
      useLibraryRootSync({
        libraryFolders: ['/music'],
        libraryTracks: [track],
        prefetchCoverArt,
        setLibraryFolders,
      }),
    );

    await waitFor(() => expect(reportErrorMock).toHaveBeenCalled());

    expect(result.current.libraryRootsReady).toBe(false);
    expect(syncLyricsIndexMock).not.toHaveBeenCalled();
    expect(prefetchCoverArt).not.toHaveBeenCalled();
    expect(reportErrorMock).toHaveBeenCalledWith('Failed to load native library grants', {
      source: 'app',
      error,
    });
  });

  it('refreshes lyrics only once for the same root set', async () => {
    const prefetchCoverArt = vi.fn(async () => undefined);
    const setLibraryFolders = vi.fn();

    const { rerender } = renderHook(
      ({ tracks }) =>
        useLibraryRootSync({
          libraryFolders: ['/music'],
          libraryTracks: tracks,
          prefetchCoverArt,
          setLibraryFolders,
        }),
      { initialProps: { tracks: [track] } },
    );

    await waitFor(() => expect(syncLyricsIndexMock).toHaveBeenCalledTimes(1));

    rerender({ tracks: [{ ...track, id: '/music/two.mp3', filePath: '/music/two.mp3' }] });

    await waitFor(() => expect(prefetchCoverArt).toHaveBeenCalledTimes(2));
    expect(syncLyricsIndexMock).toHaveBeenCalledTimes(1);
  });

  it('replaces stale renderer paths with native grant paths', async () => {
    const setLibraryFolders = vi.fn();

    renderHook(() =>
      useLibraryRootSync({
        libraryFolders: ['/stale'],
        libraryTracks: [],
        prefetchCoverArt: vi.fn(),
        setLibraryFolders,
      }),
    );

    await waitFor(() => expect(setLibraryFolders).toHaveBeenCalledWith(['/music']));
  });
});
