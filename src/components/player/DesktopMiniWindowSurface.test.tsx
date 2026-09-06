import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DesktopPlaybackSnapshot } from '../../types';
import { DesktopMiniWindowSurface } from './DesktopMiniWindowSurface';

const {
  desktopMiniControlMock,
  desktopMiniRequestSnapshotMock,
  desktopMiniSeekMock,
  getCoverArtBlobFallbackMock,
  startDraggingMock,
} = vi.hoisted(() => ({
  desktopMiniControlMock: vi.fn(async () => undefined),
  desktopMiniRequestSnapshotMock: vi.fn(async () => undefined),
  desktopMiniSeekMock: vi.fn(async () => undefined),
  getCoverArtBlobFallbackMock: vi.fn(),
  startDraggingMock: vi.fn(async () => undefined),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ startDragging: startDraggingMock }),
}));
vi.mock('../../hooks/useTauriEvent', () => ({ useTauriEvent: vi.fn() }));
vi.mock('../../lib/tauri-commands', () => ({
  desktopMiniControl: desktopMiniControlMock,
  desktopMiniRequestSnapshot: desktopMiniRequestSnapshotMock,
  desktopMiniSeek: desktopMiniSeekMock,
}));
vi.mock('../../hooks/useCoverArt', () => ({
  getCoverArtBlobFallback: getCoverArtBlobFallbackMock,
}));
vi.mock('../../hooks/useReactivePalette', () => ({
  useReactivePalette: () => ({
    shellBlobA: '#111111',
    shellBlobB: '#222222',
    heroAccent: '#333333',
    heroGlow: '#444444',
    surfaceTint: '#555555',
    primaryRgb: '51 51 51',
  }),
}));

const SNAPSHOT: DesktopPlaybackSnapshot = {
  track: {
    title: 'Song',
    artist: 'Artist',
    coverArtHash: null,
  },
  sourceId: 'source-1',
  isPlaying: false,
  position: 10,
  duration: 200,
  hasPrevious: true,
  hasNext: true,
};

describe('DesktopMiniWindowSurface', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends an idempotent hide intent instead of toggling visibility', async () => {
    render(<DesktopMiniWindowSurface />);

    fireEvent.click(screen.getByRole('button', { name: 'Hide mini player' }));

    await waitFor(() => expect(desktopMiniControlMock).toHaveBeenCalledWith('hide-mini'));
  });

  it('falls back to bounded blob artwork when the protocol image fails', async () => {
    const snapshotWithArt: DesktopPlaybackSnapshot = {
      ...SNAPSHOT,
      track: { ...SNAPSHOT.track!, coverArtHash: 'art-hash' },
    };
    getCoverArtBlobFallbackMock.mockResolvedValue('blob:mini-art');

    const view = render(<DesktopMiniWindowSurface initialSnapshot={snapshotWithArt} />);
    const image = view.container.querySelector('img');
    expect(image).toBeInTheDocument();

    fireEvent.error(image!);

    await waitFor(() =>
      expect(getCoverArtBlobFallbackMock).toHaveBeenCalledWith('art-hash', 'small'),
    );
    await waitFor(() =>
      expect(view.container.querySelector('img')).toHaveAttribute('src', 'blob:mini-art'),
    );
  });

  it('ignores a fallback result after the mini player unmounts', async () => {
    let resolveFallback: ((value: string | null) => void) | undefined;
    getCoverArtBlobFallbackMock.mockImplementation(
      () =>
        new Promise<string | null>((resolve) => {
          resolveFallback = resolve;
        }),
    );

    const snapshotWithArt: DesktopPlaybackSnapshot = {
      ...SNAPSHOT,
      track: { ...SNAPSHOT.track!, coverArtHash: 'late-art-hash' },
    };
    const view = render(<DesktopMiniWindowSurface initialSnapshot={snapshotWithArt} />);
    fireEvent.error(view.container.querySelector('img')!);

    await waitFor(() =>
      expect(getCoverArtBlobFallbackMock).toHaveBeenCalledWith('late-art-hash', 'small'),
    );
    view.unmount();

    await act(async () => {
      resolveFallback?.('blob:late-art');
    });
  });

  it('uses the typed native command for playback controls', async () => {
    render(<DesktopMiniWindowSurface initialSnapshot={SNAPSHOT} />);

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));

    await waitFor(() => expect(desktopMiniControlMock).toHaveBeenCalledWith('toggle-play'));
  });

  it('sends seeks with only the opaque snapshot source identifier', async () => {
    render(<DesktopMiniWindowSurface initialSnapshot={SNAPSHOT} />);

    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), {
      target: { value: '42' },
    });

    await waitFor(() =>
      expect(desktopMiniSeekMock).toHaveBeenCalledWith({
        positionSecs: 42,
        sourceId: 'source-1',
      }),
    );
  });

  it('requests snapshots through the native bridge when focused', async () => {
    render(<DesktopMiniWindowSurface />);
    desktopMiniRequestSnapshotMock.mockClear();

    window.dispatchEvent(new Event('focus'));

    await waitFor(() => expect(desktopMiniRequestSnapshotMock).toHaveBeenCalledTimes(1));
  });

  it('preserves native dragging on the frameless surface', () => {
    render(<DesktopMiniWindowSurface initialSnapshot={SNAPSHOT} />);

    fireEvent(
      screen.getByTitle('Drag to move'),
      new MouseEvent('pointerdown', { bubbles: true, button: 0 }),
    );

    expect(startDraggingMock).toHaveBeenCalledTimes(1);
  });
});
