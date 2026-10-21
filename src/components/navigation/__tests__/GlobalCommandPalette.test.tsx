import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalCommandPalette } from '../GlobalCommandPalette';

const { fetchLibrarySearchMock } = vi.hoisted(() => ({
  fetchLibrarySearchMock: vi.fn(),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('../../../features/library/api', () => ({
  fetchLibrarySearch: fetchLibrarySearchMock,
}));

const matchingTrack = {
  id: '/music/blue-train.flac',
  title: 'Blue Train',
  artist: 'John Coltrane',
  albumArtist: 'John Coltrane',
  album: 'Blue Train',
  year: 1957,
  duration: 640,
  filePath: '/music/blue-train.flac',
  hasCoverArt: true,
  coverArtHash: 'blue-train-cover',
  dateAdded: 1,
};

const renderPalette = () =>
  render(
    <GlobalCommandPalette
      currentView="home"
      onNavigate={vi.fn()}
      onShuffleAll={vi.fn()}
      onTogglePlayback={vi.fn(async () => undefined)}
      onNextTrack={vi.fn(async () => undefined)}
      onPreviousTrack={vi.fn(async () => undefined)}
      onRescanLibrary={vi.fn(async () => undefined)}
      onOpenFullPlayer={vi.fn()}
      hasCurrentTrack
      isPlaying={false}
      isScanning={false}
      theme="liquid-glass"
    />,
  );

describe('GlobalCommandPalette FE-35', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchLibrarySearchMock.mockResolvedValue({ metadata: [matchingTrack], lyrics: [] });
  });

  it('shows matching track and album results while searching the library', async () => {
    renderPalette();
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByPlaceholderText(/command/i), {
      target: { value: 'blue train' },
    });

    expect(await screen.findByText('Blue Train')).toBeInTheDocument();
    expect(await screen.findByText('Albums')).toBeInTheDocument();
  });

  it('uses Control shortcut labels on Windows', async () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, 'platform');
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'Win32',
    });

    try {
      renderPalette();
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
      expect(await screen.findByText('Ctrl+→')).toBeInTheDocument();
    } finally {
      if (previous) {
        Object.defineProperty(navigator, 'platform', previous);
      } else {
        Reflect.deleteProperty(navigator, 'platform');
      }
    }
  });
});
