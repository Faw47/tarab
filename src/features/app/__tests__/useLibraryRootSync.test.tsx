import { act, renderHook, waitFor } from '@testing-library/react';
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

  it('does not report a rejected grant lookup after unmount', async () => {
    let rejectList: ((error: unknown) => void) | undefined;
    const error = new Error('late grant failure');
    listLibraryGrantsMock.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectList = reject;
        }),
    );
    const hook = renderHook(() =>
      useLibraryRootSync({
        libraryFolders: ['/music'],
        libraryTracks: [],
        prefetchCoverArt: vi.fn(),
        setLibraryFolders: vi.fn(),
      }),
    );

    hook.unmount();
    await act(async () => {
      rejectList?.(error);
      await Promise.resolve();
    });

    expect(reportErrorMock).not.toHaveBeenCalled();
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

  it('allows a later root sync to retry after lyrics indexing fails', async () => {
    const error = new Error('index temporarily unavailable');
    const prefetchCoverArt = vi.fn(async () => undefined);
    const setLibraryFolders = vi.fn();
    syncLyricsIndexMock.mockRejectedValueOnce(error).mockResolvedValueOnce(0);

    const first = renderHook(() =>
      useLibraryRootSync({
        libraryFolders: ['/music'],
        libraryTracks: [],
        prefetchCoverArt,
        setLibraryFolders,
      }),
    );

    await waitFor(() =>
      expect(reportErrorMock).toHaveBeenCalledWith('Failed to refresh lyrics index', {
        source: 'app',
        error,
      }),
    );
    first.unmount();

    renderHook(() =>
      useLibraryRootSync({
        libraryFolders: ['/music'],
        libraryTracks: [],
        prefetchCoverArt,
        setLibraryFolders,
      }),
    );

    await waitFor(() => expect(syncLyricsIndexMock).toHaveBeenCalledTimes(2));
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

  it('treats Windows grant casing as the same root set', async () => {
    vi.stubGlobal('navigator', { platform: 'Win32' });
    listLibraryGrantsMock.mockResolvedValue([
      { id: 'grant-1', path: 'c:/MUSIC', displayName: 'music', status: 'available' },
    ]);
    const setLibraryFolders = vi.fn();

    const { result } = renderHook(() =>
      useLibraryRootSync({
        libraryFolders: ['C:/Music'],
        libraryTracks: [],
        prefetchCoverArt: vi.fn(),
        setLibraryFolders,
      }),
    );

    await waitFor(() => expect(result.current.libraryRootsReady).toBe(true));
    expect(setLibraryFolders).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('treats differently ordered native and renderer roots as the same set', async () => {
    const setLibraryFolders = vi.fn();
    const rendererFolders = ['/z', '/alpha'];
    listLibraryGrantsMock.mockResolvedValue([
      { id: 'grant-1', path: '/alpha', displayName: 'alpha', status: 'available' },
      { id: 'grant-2', path: '/z', displayName: 'z', status: 'available' },
    ]);

    const { result } = renderHook(() =>
      useLibraryRootSync({
        libraryFolders: rendererFolders,
        libraryTracks: [],
        prefetchCoverArt: vi.fn(),
        setLibraryFolders,
      }),
    );

    await waitFor(() => expect(result.current.libraryRootsReady).toBe(true));
    expect(setLibraryFolders).not.toHaveBeenCalled();
    expect(listLibraryGrantsMock).toHaveBeenCalledTimes(1);
  });
});
