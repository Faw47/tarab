import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsStore } from '../../../store/settings-store';
import { collapseWatchScanTargets, resolveWatchScanTarget } from '../library-watch-targets';
import { useLibraryScan } from '../useLibraryScan';

const { listeners, scanLibraryMock, reconcileMock } = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => unknown>(),
  scanLibraryMock: vi.fn(),
  reconcileMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => unknown) => {
    listeners.set(name, handler);
    return () => listeners.delete(name);
  }),
}));

vi.mock('../../../platform/tauri-zustand-storage', () => ({
  createTauriZustandStorage: () => ({
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  }),
}));

vi.mock('../../../platform/notifications', () => ({
  notifications: { notifyScanComplete: vi.fn() },
}));

vi.mock('../../../lib/tauri-commands', () => ({
  cancelLibraryScan: vi.fn(async () => undefined),
  dbReconcileFolderScan: reconcileMock,
  generateCoverArtHashes: vi.fn(async () => []),
  getBatchMetadata: vi.fn(async () => []),
  scanLibrary: scanLibraryMock,
  syncLyricsIndex: vi.fn(async () => 0),
  watchLibraryPaths: vi.fn(async () => undefined),
}));

const reconcileResult = (folderPath: string) => ({
  status: 'complete',
  folderPath,
  discoveredCount: 0,
  addedCount: 0,
  updatedCount: 0,
  unchangedCount: 0,
  missingCount: 0,
  preservedCount: 0,
  errors: [],
});

describe('library watch scan targets', () => {
  it('maps a changed file to its folder inside the library root', () => {
    expect(resolveWatchScanTarget('/music/Artist/Album/01.flac', ['/music'])).toEqual({
      root: '/music',
      target: '/music/Artist/Album',
    });
  });

  it('keeps a changed directory and never leaves the root', () => {
    expect(resolveWatchScanTarget('/music/Artist/New Album', ['/music'])).toEqual({
      root: '/music',
      target: '/music/Artist/New Album',
    });
    expect(resolveWatchScanTarget('/music/song.mp3', ['/music'])?.target).toBe('/music');
    expect(resolveWatchScanTarget('/elsewhere/song.mp3', ['/music'])).toBeNull();
  });

  it('collapses nested targets and falls back to the root when too many folders changed', () => {
    expect(collapseWatchScanTargets('/music', ['/music/A', '/music/A/Disc 1', '/music/B'])).toEqual(
      ['/music/A', '/music/B'],
    );
    const many = Array.from({ length: 40 }, (_, index) => `/music/Album ${index}`);
    expect(collapseWatchScanTargets('/music', many)).toEqual(['/music']);
  });
});

describe('useLibraryScan watcher', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    listeners.clear();
    scanLibraryMock.mockReset();
    reconcileMock.mockReset();
    scanLibraryMock.mockResolvedValue({ paths: [], traversalErrors: [], skippedErrorCount: 0 });
    reconcileMock.mockImplementation(async (request: { folderPath: string }) =>
      reconcileResult(request.folderPath),
    );
    useSettingsStore.setState({ autoWatch: true, libraryFolders: ['/music'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
  }

  it('rescans a symlinked library root when the watcher emits its canonical path', async () => {
    useSettingsStore.setState({ autoWatch: true, libraryFolders: ['/music-link'] });
    renderHook(() => useLibraryScan(), { wrapper });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    await act(async () => {
      listeners.get('library-files-changed')?.({
        payload: '/real/music/Artist/Album/01.flac',
      });
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(scanLibraryMock.mock.calls.map((call) => call[0])).toEqual(['/music-link/Artist/Album']);
  });

  it('rescans only the folder that changed, not the whole library root', async () => {
    renderHook(() => useLibraryScan(), { wrapper });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    await act(async () => {
      listeners.get('library-files-changed')?.({ payload: '/music/Artist/Album/01.flac' });
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(scanLibraryMock).toHaveBeenCalledTimes(1);
    expect(scanLibraryMock.mock.calls[0][0]).toBe('/music/Artist/Album');
  });

  it('falls back to the library root when the changed folder cannot be scanned', async () => {
    scanLibraryMock.mockRejectedValueOnce(new Error('Folder does not exist'));
    renderHook(() => useLibraryScan(), { wrapper });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    await act(async () => {
      listeners.get('library-file-removed')?.({ payload: '/music/Gone/01.flac' });
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(scanLibraryMock.mock.calls.map((call) => call[0])).toEqual(['/music/Gone', '/music']);
  });

  it('keeps rows it could not see when the walk skipped unreadable entries', async () => {
    scanLibraryMock.mockResolvedValue({
      paths: [],
      traversalErrors: [{ path: '/music/System Volume Information', message: 'Access is denied' }],
      skippedErrorCount: 0,
    });
    renderHook(() => useLibraryScan(), { wrapper });
    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    await act(async () => {
      listeners.get('library-files-changed')?.({ payload: '/music/song.mp3' });
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(reconcileMock).toHaveBeenCalledWith(
      expect.objectContaining({
        folderPath: '/music',
        traversalComplete: false,
        errors: [expect.objectContaining({ code: 'traversalIncomplete' })],
      }),
    );
  });
});
