import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLibraryStore } from '../../store/library-store';
import { useSettingsStore } from '../../store/settings-store';
import { useLibraryScan } from './useLibraryScan';

const {
  scanLibraryMock,
  cancelLibraryScanMock,
  finishLibraryScanMock,
  getBatchMetadataMock,
  generateCoverArtHashesMock,
  dbReconcileFolderScanMock,
  syncLyricsIndexMock,
  watchLibraryPathsMock,
  reportErrorMock,
  listenMock,
  eventHandlers,
} = vi.hoisted(() => ({
  scanLibraryMock: vi.fn(),
  cancelLibraryScanMock: vi.fn(async () => undefined),
  finishLibraryScanMock: vi.fn(async () => undefined),
  getBatchMetadataMock: vi.fn(),
  generateCoverArtHashesMock: vi.fn(async () => []),
  dbReconcileFolderScanMock: vi.fn(),
  syncLyricsIndexMock: vi.fn(async () => undefined),
  watchLibraryPathsMock: vi.fn(async () => undefined),
  reportErrorMock: vi.fn(),
  listenMock: vi.fn(),
  eventHandlers: new Map<string, (event: { payload: unknown }) => void>(),
}));

vi.mock('../../lib/tauri-commands', () => ({
  scanLibrary: scanLibraryMock,
  cancelLibraryScan: cancelLibraryScanMock,
  finishLibraryScan: finishLibraryScanMock,
  getBatchMetadata: getBatchMetadataMock,
  generateCoverArtHashes: generateCoverArtHashesMock,
  dbReconcileFolderScan: dbReconcileFolderScanMock,
  syncLyricsIndex: syncLyricsIndexMock,
  watchLibraryPaths: watchLibraryPathsMock,
}));

vi.mock('../../features/library/mutations', () => ({
  invalidateLibraryForMutation: vi.fn(async () => undefined),
}));

vi.mock('../../platform/notifications', () => ({
  notifications: { notifyScanComplete: vi.fn() },
}));

vi.mock('../../lib/report-error', () => ({ reportError: reportErrorMock }));

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

vi.mock('../../platform/tauri-zustand-storage', () => ({
  createTauriZustandStorage: () => ({
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  }),
}));

const metadata = (filePath: string) => ({
  file_path: filePath,
  title: 'Track',
  artist: 'Artist',
  album_artist: null,
  album: 'Album',
  year: 2024,
  track_number: 1,
  disc_number: 1,
  duration_secs: 180,
  has_cover_art: false,
  cover_art_hash: null,
  blurhash: null,
  file_format: 'mp3',
  bitrate: 320,
  sample_rate: 44_100,
  file_size: 1_000,
});

const reconcileResult = {
  status: 'complete',
  folderPath: '/music',
  discoveredCount: 1,
  addedCount: 1,
  updatedCount: 0,
  unchangedCount: 0,
  missingCount: 0,
  preservedCount: 0,
  errors: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

describe('useLibraryScan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventHandlers.clear();
    listenMock.mockImplementation(
      async (eventName: string, handler: (event: { payload: unknown }) => void) => {
        eventHandlers.set(eventName, handler);
        return () => eventHandlers.delete(eventName);
      },
    );
    useSettingsStore.setState({
      autoWatch: false,
      followSymlinks: false,
      downloadArtwork: false,
      libraryFolders: ['/music'],
    });
    useLibraryStore.setState({ isScanning: false, scanProgress: 0 });
    scanLibraryMock.mockResolvedValue(['/music/track.mp3']);
    getBatchMetadataMock.mockResolvedValue([metadata('/music/track.mp3')]);
    dbReconcileFolderScanMock.mockResolvedValue(reconcileResult);
  });

  it('does not reconcile when cancellation arrives during the final metadata batch', async () => {
    const metadataResult = deferred<ReturnType<typeof metadata>[]>();
    getBatchMetadataMock.mockReturnValueOnce(metadataResult.promise);
    const { result } = renderHook(() => useLibraryScan(), { wrapper: createWrapper() });

    let scanPromise!: Promise<void>;
    act(() => {
      scanPromise = result.current.scanFolder('/music');
    });
    await waitFor(() => expect(getBatchMetadataMock).toHaveBeenCalledTimes(1));
    const scanId = scanLibraryMock.mock.calls[0][2] as string;

    await act(async () => result.current.cancelScan());
    metadataResult.resolve([metadata('/music/track.mp3')]);
    await act(async () => scanPromise);

    expect(cancelLibraryScanMock).toHaveBeenCalledWith(scanId);
    expect(dbReconcileFolderScanMock).not.toHaveBeenCalled();
    expect(finishLibraryScanMock).toHaveBeenCalledWith(scanId);
  });

  it('serializes overlapping scans so an older reconcile cannot follow a newer one', async () => {
    const firstTraversal = deferred<string[]>();
    const secondTraversal = deferred<string[]>();
    scanLibraryMock
      .mockReturnValueOnce(firstTraversal.promise)
      .mockReturnValueOnce(secondTraversal.promise);
    getBatchMetadataMock.mockImplementation(async (paths: string[]) => [metadata(paths[0])]);
    const { result } = renderHook(() => useLibraryScan(), { wrapper: createWrapper() });

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.scanFolder('/music');
      second = result.current.scanFolder('/other');
    });
    await waitFor(() => expect(scanLibraryMock).toHaveBeenCalledTimes(1));
    expect(useLibraryStore.getState().isScanning).toBe(true);

    firstTraversal.resolve(['/music/track.mp3']);
    await waitFor(() => expect(scanLibraryMock).toHaveBeenCalledTimes(2));
    expect(useLibraryStore.getState().isScanning).toBe(true);

    secondTraversal.resolve(['/other/track.mp3']);
    await act(async () => Promise.all([first, second]));
    expect(useLibraryStore.getState().isScanning).toBe(false);

    expect(scanLibraryMock.mock.calls.map((call) => call[0])).toEqual(['/music', '/other']);
    expect(dbReconcileFolderScanMock.mock.calls.map((call) => call[0].folderPath)).toEqual([
      '/music',
      '/other',
    ]);
  });
  it('reports an unrelated device error instead of treating its wording as cancellation', async () => {
    const error = new Error('Unable to cancel the output device');
    scanLibraryMock.mockRejectedValueOnce(error);
    const { result } = renderHook(() => useLibraryScan(), { wrapper: createWrapper() });

    await act(async () => {
      await result.current.scanFolder('/music');
    });

    await waitFor(() => expect(result.current.folderStatuses['/music']?.status).toBe('error'));
    expect(reportErrorMock).toHaveBeenCalledWith(
      'Failed to scan folder: /music',
      expect.objectContaining({ source: 'useLibraryScan', error }),
    );
  });

  it('cancels a zero-valued watcher debounce when the same folder changes again', async () => {
    useSettingsStore.setState({ autoWatch: true, libraryFolders: ['/music'] });
    const { unmount } = renderHook(() => useLibraryScan(), { wrapper: createWrapper() });
    await waitFor(() => expect(eventHandlers.has('library-files-changed')).toBe(true));

    const timeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockReturnValue(0 as unknown as ReturnType<typeof setTimeout>);
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    try {
      const handler = eventHandlers.get('library-files-changed');
      handler?.({ payload: '/music/song.mp3' });
      handler?.({ payload: '/music/song.mp3' });

      expect(timeoutSpy).toHaveBeenCalledTimes(2);
      expect(clearTimeoutSpy).toHaveBeenCalledWith(0);
    } finally {
      unmount();
      timeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    }
  });

  it('serializes watcher replacement so a stale clear cannot finish after new roots', async () => {
    const initialWatch = deferred<undefined>();
    const clearWatch = deferred<undefined>();
    const replacementWatch = deferred<undefined>();
    watchLibraryPathsMock
      .mockImplementationOnce(() => initialWatch.promise)
      .mockImplementationOnce(() => clearWatch.promise)
      .mockImplementationOnce(() => replacementWatch.promise);
    useSettingsStore.setState({ autoWatch: true, libraryFolders: ['/music'] });
    const { unmount } = renderHook(() => useLibraryScan(), { wrapper: createWrapper() });

    await waitFor(() => expect(watchLibraryPathsMock).toHaveBeenNthCalledWith(1, ['/music']));
    act(() => useSettingsStore.setState({ libraryFolders: ['/other'] }));
    expect(watchLibraryPathsMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      initialWatch.resolve(undefined);
    });
    await waitFor(() => expect(watchLibraryPathsMock).toHaveBeenNthCalledWith(2, []));

    await act(async () => {
      clearWatch.resolve(undefined);
    });
    await waitFor(() => expect(watchLibraryPathsMock).toHaveBeenNthCalledWith(3, ['/other']));

    await act(async () => {
      replacementWatch.resolve(undefined);
    });
    unmount();
  });
});
