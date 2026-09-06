import { describe, expect, it } from 'vitest';
import { getLyricsUtf8ByteLength, MAX_LYRICS_SIDECAR_BYTES } from './LyricsEditor';

describe('lyrics sidecar byte limit', () => {
  it('measures the UTF-8 boundary rather than JavaScript character count', () => {
    const exactLimit = 'é'.repeat(MAX_LYRICS_SIDECAR_BYTES / 2);

    expect(exactLimit.length).toBe(MAX_LYRICS_SIDECAR_BYTES / 2);
    expect(getLyricsUtf8ByteLength(exactLimit)).toBe(MAX_LYRICS_SIDECAR_BYTES);
    expect(getLyricsUtf8ByteLength(`${exactLimit}x`)).toBe(MAX_LYRICS_SIDECAR_BYTES + 1);
  });
});
