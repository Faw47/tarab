import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../types';
import { useLongPress } from './AlbumDetailsOverlay';
import { useResolvedCoverArt } from './useResolvedCoverArt';

const { getCoverArtBlobFallbackMock } = vi.hoisted(() => ({
  getCoverArtBlobFallbackMock: vi.fn(),
}));

vi.mock('../../hooks/useCoverArt', () => ({
  getCoverArtBlobFallback: getCoverArtBlobFallbackMock,
  useCoverArt: vi.fn(() => null),
}));

const makeTrack = (id: string, coverArtHash: string): Track => ({
  id,
  title: id,
  artist: 'Artist',
  album: 'Album',
  year: null,
  duration: 120,
  filePath: `C:/music/${id}.mp3`,
  hasCoverArt: true,
  coverArtHash,
  dateAdded: 0,
});

describe('useLongPress', () => {
  it('cancels a pending selection callback when the hook unmounts', () => {
    vi.useFakeTimers();
    try {
      const callback = vi.fn();
      const { result, unmount } = renderHook(() => useLongPress(callback, 500));

      act(() => result.current.onMouseDown());
      unmount();
      act(() => vi.advanceTimersByTime(500));

      expect(callback).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('useResolvedCoverArt', () => {
  beforeEach(() => {
    getCoverArtBlobFallbackMock.mockReset();
  });

  it('marks the artwork unavailable when the fallback also fails', async () => {
    getCoverArtBlobFallbackMock.mockResolvedValue(null);
    const { result } = renderHook(() =>
      useResolvedCoverArt('cover-art://broken', makeTrack('broken', 'broken-hash')),
    );

    await act(async () => {
      await result.current.handleError();
    });

    expect(result.current.resolvedSrc).toBe('cover-art://broken');
    expect(result.current.error).toBe(true);
  });

  it('ignores fallback bytes that resolve after the album changes', async () => {
    let resolveFirst: ((value: string | null) => void) | undefined;
    getCoverArtBlobFallbackMock.mockImplementation((hash: string) => {
      if (hash === 'first-hash') {
        return new Promise<string | null>((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve('blob:second');
    });

    const firstTrack = makeTrack('first', 'first-hash');
    const secondTrack = makeTrack('second', 'second-hash');
    const { result, rerender } = renderHook(
      ({ src, track }: { src: string; track: Track }) => useResolvedCoverArt(src, track),
      { initialProps: { src: 'cover-art://first', track: firstTrack } },
    );

    const firstRequest = result.current.handleError();
    await waitFor(() => expect(resolveFirst).toEqual(expect.any(Function)));

    rerender({ src: 'cover-art://second', track: secondTrack });
    await act(async () => {
      await result.current.handleError();
    });

    expect(result.current.resolvedSrc).toBe('blob:second');
    expect(result.current.error).toBe(false);

    await act(async () => {
      resolveFirst?.('blob:first');
      await firstRequest;
    });

    expect(result.current.resolvedSrc).toBe('blob:second');
    expect(result.current.error).toBe(false);
  });
});
