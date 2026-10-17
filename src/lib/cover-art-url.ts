import { convertFileSrc } from '@tauri-apps/api/core';

export type CoverArtSize = 'small' | 'medium' | 'large';

const COVER_ART_SCHEME = 'cover-art';

/**
 * URL of a cached thumbnail served by the `cover-art` protocol. Tauri exposes custom schemes as
 * `cover-art://localhost/…` on macOS and Linux but as `http://cover-art.localhost/…` on Windows
 * (WebView2), so the base comes from `convertFileSrc`. Outside Tauri (tests, Storybook) it falls
 * back to the macOS and Linux form.
 */
export const coverArtUrl = (hash: string, size: CoverArtSize): string => {
  let base = `${COVER_ART_SCHEME}://localhost/${hash}`;
  try {
    base = convertFileSrc(hash, COVER_ART_SCHEME);
  } catch {
    // Not running inside Tauri.
  }
  return `${base}/${size}`;
};

/** True for URLs served by the cover-art protocol in either platform form. */
export const isCoverArtProtocolUrl = (value: string | null | undefined): boolean =>
  typeof value === 'string' &&
  (value.startsWith(`${COVER_ART_SCHEME}://`) || /^https?:\/\/cover-art\.localhost\//.test(value));
