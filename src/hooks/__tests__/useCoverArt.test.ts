import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cacheGetThumbnailBytesMock, getCoverArtMock } = vi.hoisted(() => ({
  cacheGetThumbnailBytesMock: vi.fn(),
  getCoverArtMock: vi.fn(),
}));

vi.mock('../../lib/tauri-commands', () => ({
  cacheGetThumbnailBytes: cacheGetThumbnailBytesMock,
  getCoverArt: getCoverArtMock,
  resolveCoverArt: vi.fn(),
}));

describe('cover art blob fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    cacheGetThumbnailBytesMock.mockReset();
    cacheGetThumbnailBytesMock.mockResolvedValue([1, 2, 3]);
    getCoverArtMock.mockReset();

    let next = 0;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => `blob:cover-${++next}`),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
    sessionStorage.clear();
  });

  it('creates and reuses a blob URL for IPC fallback bytes', async () => {
    const { getCoverArtBlobFallback } = await import('../useCoverArt');

    await expect(getCoverArtBlobFallback('a'.repeat(64), 'small')).resolves.toBe('blob:cover-1');
    await expect(getCoverArtBlobFallback('a'.repeat(64), 'small')).resolves.toBe('blob:cover-1');

    expect(cacheGetThumbnailBytesMock).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('does not probe tracks that are known to have no cover art', async () => {
    const { useCoverArt } = await import('../useCoverArt');

    const { result } = renderHook(() => useCoverArt('/music/no-art.mp3', false, true, 'small'));

    expect(result.current).toBeNull();
    expect(getCoverArtMock).not.toHaveBeenCalled();
  });
  it('revokes cached blob URLs when cover art cache is invalidated', async () => {
    const { getCoverArtBlobFallback, invalidateCoverArtCache } = await import('../useCoverArt');
    const hash = 'b'.repeat(64);

    await expect(getCoverArtBlobFallback(hash, 'large')).resolves.toBe('blob:cover-1');
    invalidateCoverArtCache('/music/song.mp3', hash);

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cover-1');
  });

  it('prefetches at the shared concurrency limit without deadlocking', async () => {
    const resolvers = new Map<string, (hash: string | null) => void>();
    getCoverArtMock.mockImplementation(
      (filePath: string) =>
        new Promise<string | null>((resolve) => {
          resolvers.set(filePath, resolve);
        }),
    );
    const { prefetchCoverArtBatch } = await import('../useCoverArt');
    const entries = Array.from({ length: 9 }, (_, index) => ({
      filePath: `/music/prefetch-${index}.mp3`,
      hasCoverArt: true,
    }));

    const prefetch = prefetchCoverArtBatch(entries, 'small');
    await vi.waitFor(() => expect(getCoverArtMock).toHaveBeenCalledTimes(8));
    expect(resolvers.size).toBe(8);

    resolvers.get(entries[0].filePath)?.('first-hash');
    await vi.waitFor(() => expect(getCoverArtMock).toHaveBeenCalledTimes(9));
    resolvers.forEach((resolve, filePath) => resolve(`hash:${filePath}`));

    await expect(prefetch).resolves.toBeUndefined();
  });
});
