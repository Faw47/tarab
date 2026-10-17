import { afterEach, describe, expect, it } from 'vitest';
import { coverArtUrl, isCoverArtProtocolUrl } from '../cover-art-url';

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

describe('cover art URLs', () => {
  afterEach(() => {
    delete (window as TauriWindow).__TAURI_INTERNALS__;
  });

  it('uses the scheme form Tauri reports for the platform', () => {
    (window as TauriWindow).__TAURI_INTERNALS__ = {
      convertFileSrc: (path: string, protocol: string) => `http://${protocol}.localhost/${path}`,
    };

    expect(coverArtUrl('abc', 'large')).toBe('http://cover-art.localhost/abc/large');
  });

  it('falls back to the macOS and Linux form outside Tauri', () => {
    expect(coverArtUrl('abc', 'small')).toBe('cover-art://localhost/abc/small');
  });

  it('recognises both protocol forms and nothing else', () => {
    expect(isCoverArtProtocolUrl('cover-art://localhost/abc/small')).toBe(true);
    expect(isCoverArtProtocolUrl('http://cover-art.localhost/abc/small')).toBe(true);
    expect(isCoverArtProtocolUrl('https://cover-art.localhost/abc/small')).toBe(true);
    expect(isCoverArtProtocolUrl('blob:http://localhost/123')).toBe(false);
    expect(isCoverArtProtocolUrl(null)).toBe(false);
  });
});
