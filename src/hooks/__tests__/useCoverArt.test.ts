import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cacheGetThumbnailBytesMock } = vi.hoisted(() => ({
  cacheGetThumbnailBytesMock: vi.fn(),
}));

vi.mock('../../lib/tauri-commands', () => ({
  cacheGetThumbnailBytes: cacheGetThumbnailBytesMock,
  getCoverArt: vi.fn(),
}));

describe('cover art blob fallback', () => {
  beforeEach(() => {
    vi.resetModules();
    cacheGetThumbnailBytesMock.mockReset();
    cacheGetThumbnailBytesMock.mockResolvedValue([1, 2, 3]);

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

  it('revokes cached blob URLs when cover art cache is invalidated', async () => {
    const { getCoverArtBlobFallback, invalidateCoverArtCache } = await import('../useCoverArt');
    const hash = 'b'.repeat(64);

    await expect(getCoverArtBlobFallback(hash, 'large')).resolves.toBe('blob:cover-1');
    invalidateCoverArtCache('/music/song.mp3', hash);

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cover-1');
  });
});
