import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/tauri-commands', () => ({
  dbGetExistingPaths: vi.fn(),
  dbGetTrackCount: vi.fn(),
  dbUpsertTracks: vi.fn(),
  generateCoverArtHashes: vi.fn(),
  getBatchMetadata: vi.fn(),
  scanLibrary: vi.fn(),
  scanLibraryParallel: vi.fn(),
  syncLyricsIndex: vi.fn(),
}));

import { scanLibraryParallel } from '../../../lib/tauri-commands';
import { mergeDroppedLibraryFolders, useDroppedAudioImport } from '../useDroppedAudioImport';

describe('mergeDroppedLibraryFolders', () => {
  it('adds dropped folders that are not already watched', () => {
    expect(mergeDroppedLibraryFolders(['C:/Music'], ['D:/Albums'])).toEqual([
      'C:/Music',
      'D:/Albums',
    ]);
  });

  it('skips dropped folders already covered by a watched parent', () => {
    expect(mergeDroppedLibraryFolders(['C:/Music'], ['C:/Music/Jazz'])).toEqual(['C:/Music']);
  });

  it('keeps the parent when the same drop contains nested folders', () => {
    expect(mergeDroppedLibraryFolders([], ['C:/Music/Jazz', 'C:/Music'])).toEqual(['C:/Music']);
  });

  it('replaces a watched child folder when a dropped parent covers it', () => {
    expect(mergeDroppedLibraryFolders(['C:/Music/Jazz'], ['C:/Music'])).toEqual(['C:/Music']);
  });

  it('normalizes separators and trailing slashes before adding folders', () => {
    expect(mergeDroppedLibraryFolders([], ['C:\\Music\\Jazz\\'])).toEqual(['C:/Music/Jazz']);
  });
});

describe('dropped audio formats', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it.each(['aiff', 'alac', 'wma', 'opus'])('ignores unsupported .%s drops', async (extension) => {
    vi.mocked(scanLibraryParallel).mockResolvedValue({
      paths: [],
      traversalErrors: [],
      skippedErrorCount: 0,
    });
    const setIsScanning = vi.fn();
    renderHook(() =>
      useDroppedAudioImport({
        downloadArtwork: false,
        followSymlinks: false,
        libraryFolders: ['/Music'],
        queryClient: new QueryClient(),
        setIsScanning,
        setScanProgress: vi.fn(),
        setTrackCount: vi.fn(),
        setTracks: vi.fn(),
        startProcessing: vi.fn(() => 'import'),
        updateProcessing: vi.fn(),
        finishProcessing: vi.fn(),
      }),
    );
    const event = new Event('drop', { cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: { files: [{ path: `/Music/track.${extension}` }] },
    });
    await act(async () => {
      window.dispatchEvent(event);
    });
    expect(setIsScanning).not.toHaveBeenCalled();
    expect(scanLibraryParallel).not.toHaveBeenCalled();
  });
});
