import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../../types';
import { useLibraryRootSync } from '../useLibraryRootSync';

const setLibraryRootsMock = vi.hoisted(() => vi.fn(async () => undefined));
const syncLyricsIndexMock = vi.hoisted(() => vi.fn(async () => 0));
const reportErrorMock = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/tauri-commands', () => ({
  setLibraryRoots: setLibraryRootsMock,
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
    setLibraryRootsMock.mockResolvedValue(undefined);
    syncLyricsIndexMock.mockResolvedValue(0);
  });

  it('syncs roots before refreshing lyrics and prefetching cover art', async () => {
    const prefetchCoverArt = vi.fn(async () => undefined);

    const { result } = renderHook(() =>
      useLibraryRootSync({
        libraryFolders: ['/music'],
        libraryTracks: [track],
        prefetchCoverArt,
      }),
    );

    await waitFor(() => expect(result.current.libraryRootsReady).toBe(true));

    expect(setLibraryRootsMock).toHaveBeenCalledWith(['/music']);
    expect(syncLyricsIndexMock).toHaveBeenCalledTimes(1);
    expect(prefetchCoverArt).toHaveBeenCalledWith([track]);
  });

  it('does not refresh lyrics or prefetch cover art when no roots are configured', async () => {
    const prefetchCoverArt = vi.fn(async () => undefined);

    const { result } = renderHook(() =>
      useLibraryRootSync({
        libraryFolders: [],
        libraryTracks: [track],
        prefetchCoverArt,
      }),
    );

    await waitFor(() => expect(result.current.libraryRootsReady).toBe(true));

    expect(setLibraryRootsMock).toHaveBeenCalledWith([]);
    expect(syncLyricsIndexMock).not.toHaveBeenCalled();
    expect(prefetchCoverArt).not.toHaveBeenCalled();
  });

  it('does not prefetch cover art when root syncing fails', async () => {
    const error = new Error('permission denied');
    const prefetchCoverArt = vi.fn(async () => undefined);
    setLibraryRootsMock.mockRejectedValueOnce(error);

    const { result } = renderHook(() =>
      useLibraryRootSync({
        libraryFolders: ['/music'],
        libraryTracks: [track],
        prefetchCoverArt,
      }),
    );

    await waitFor(() => expect(reportErrorMock).toHaveBeenCalled());

    expect(result.current.libraryRootsReady).toBe(false);
    expect(syncLyricsIndexMock).not.toHaveBeenCalled();
    expect(prefetchCoverArt).not.toHaveBeenCalled();
    expect(reportErrorMock).toHaveBeenCalledWith('Failed to sync library root allowlist', {
      source: 'app',
      error,
    });
  });

  it('refreshes lyrics only once for the same root set', async () => {
    const prefetchCoverArt = vi.fn(async () => undefined);

    const { rerender } = renderHook(
      ({ tracks }) =>
        useLibraryRootSync({
          libraryFolders: ['/music'],
          libraryTracks: tracks,
          prefetchCoverArt,
        }),
      { initialProps: { tracks: [track] } },
    );

    await waitFor(() => expect(syncLyricsIndexMock).toHaveBeenCalledTimes(1));

    rerender({ tracks: [{ ...track, id: '/music/two.mp3', filePath: '/music/two.mp3' }] });

    await waitFor(() => expect(prefetchCoverArt).toHaveBeenCalledTimes(2));
    expect(syncLyricsIndexMock).toHaveBeenCalledTimes(1);
  });
});
