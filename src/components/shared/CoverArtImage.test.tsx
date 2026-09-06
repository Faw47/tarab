import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fallbackMock, useCoverArtMock } = vi.hoisted(() => ({
  fallbackMock: vi.fn(),
  useCoverArtMock: vi.fn(),
}));

vi.mock('../../hooks/useCoverArt', () => ({
  clearCoverArtProtocolFailed: vi.fn(),
  getCoverArtBlobFallback: fallbackMock,
  markCoverArtProtocolFailed: vi.fn(),
  repairCoverArt: vi.fn(async () => null),
  useCoverArt: useCoverArtMock,
}));

vi.mock('../../lib/tauri-commands', () => ({
  getCoverArt: vi.fn(async () => null),
}));

vi.mock('../../store/settings-store', () => ({
  useSettingsStore: (selector: (state: { theme: string }) => unknown) =>
    selector({ theme: 'liquid-glass' }),
}));

import { CoverArtImage } from './CoverArtImage';

const track = (id: string) => ({
  filePath: '/music/' + id + '.mp3',
  hasCoverArt: true,
  album: 'Album ' + id,
  coverArtHash: 'hash-' + id,
  blurhash: null,
});

describe('CoverArtImage async fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCoverArtMock.mockImplementation(
      (_filePath: string, _hasCoverArt: boolean, _load: boolean, size: string, hash: string) =>
        'cover-art://localhost/' + hash + '/' + size,
    );
  });

  it('shows the music placeholder after all cover-art fallbacks fail', async () => {
    fallbackMock.mockResolvedValue(null);

    const { container } = render(
      <CoverArtImage track={track('a')} lazy={false} alt="Album a" size="medium" />,
    );
    fireEvent.error(screen.getByAltText('Album a'));

    await waitFor(() => expect(container.querySelector('img')).not.toBeInTheDocument());
    expect(container.querySelector('svg')).toBeTruthy();
  });
  it('does not apply a stale fallback after a virtualized tile changes track identity', async () => {
    let resolveFallback!: (value: string | null) => void;
    fallbackMock.mockReturnValueOnce(
      new Promise<string | null>((resolve) => {
        resolveFallback = resolve;
      }),
    );

    const view = render(
      <CoverArtImage track={track('a')} lazy={false} alt="Album a" size="medium" />,
    );
    fireEvent.error(screen.getByAltText('Album a'));

    view.rerender(<CoverArtImage track={track('b')} lazy={false} alt="Album b" size="medium" />);
    resolveFallback('blob:a');

    await waitFor(() =>
      expect(screen.getByAltText('Album b')).toHaveAttribute(
        'src',
        'cover-art://localhost/hash-b/medium',
      ),
    );
    expect(screen.getByAltText('Album b')).not.toHaveAttribute('src', 'blob:a');
  });
});
