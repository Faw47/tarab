import { describe, expect, it, vi } from 'vitest';

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

import { isSupportedDroppedAudioPath, mergeDroppedLibraryFolders } from '../useDroppedAudioImport';

describe('isSupportedDroppedAudioPath', () => {
  it('accepts decoder-supported formats and rejects unsupported extensions', () => {
    for (const extension of ['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'aiff', 'opus']) {
      expect(isSupportedDroppedAudioPath(`/music/track.${extension}`)).toBe(true);
    }
    for (const extension of ['alac', 'wma']) {
      expect(isSupportedDroppedAudioPath(`/music/track.${extension}`)).toBe(false);
    }
  });
});

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
