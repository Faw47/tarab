import { act, renderHook, waitFor } from '@testing-library/react';

import { describe, expect, it, vi } from 'vitest';

import { mergeDroppedLibraryFolders, useDroppedAudioImport } from '../useDroppedAudioImport';

const createDropEvent = (path: string): DragEvent => {
  const file = new File(['audio'], 'track.mp3', { type: 'audio/mpeg' });
  Object.defineProperty(file, 'path', { value: path });
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } });
  return event as DragEvent;
};

describe('useDroppedAudioImport', () => {
  it('routes approved dropped audio through the shared scan queue', async () => {
    const scanFolder = vi.fn(async () => undefined);

    renderHook(() =>
      useDroppedAudioImport({
        libraryFolders: ['C:/Music'],
        scanFolder,
      }),
    );

    act(() => {
      window.dispatchEvent(createDropEvent('C:\\Music\\Jazz\\track.mp3'));
    });

    await waitFor(() => {
      expect(scanFolder).toHaveBeenCalledWith('C:/Music/Jazz', { silent: true });
    });
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
  it('preserves filesystem roots while normalizing dropped folders', () => {
    expect(mergeDroppedLibraryFolders([], ['C:/'])).toEqual(['C:/']);
    expect(mergeDroppedLibraryFolders([], ['/'])).toEqual(['/']);
  });
});
