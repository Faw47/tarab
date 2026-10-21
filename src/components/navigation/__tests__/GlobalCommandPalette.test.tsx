import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalCommandPalette } from '../GlobalCommandPalette';

const { fetchLibrarySearchMock, openLibrarySearchMock, playSearchResultMock } = vi.hoisted(() => ({
  fetchLibrarySearchMock: vi.fn(),
  openLibrarySearchMock: vi.fn(),
  playSearchResultMock: vi.fn(async () => undefined),
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

vi.mock('@/features/library/api', () => ({
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
      onPlaySearchResult={playSearchResultMock}
      onOpenLibrarySearch={openLibrarySearchMock}
    />,
  );

const openAndSearch = (query = 'blue train') => {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  fireEvent.change(screen.getByPlaceholderText(/command/i), {
    target: { value: query },
  });
};

describe('GlobalCommandPalette FE-35', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchLibrarySearchMock.mockResolvedValue({ metadata: [matchingTrack], lyrics: [] });
  });

  it('shows matching track and album results while searching the library', async () => {
    renderPalette();
    openAndSearch();

    expect(await screen.findByText('Tracks')).toBeInTheDocument();
    expect(await screen.findByText('Albums')).toBeInTheDocument();
    expect(await screen.findByText('John Coltrane · Blue Train')).toBeInTheDocument();
    expect(fetchLibrarySearchMock).toHaveBeenCalledWith('blue train', 24, {
      includeMetadata: true,
      includeLyrics: false,
    });
  });

  it('plays a selected track with the matching library results queued', async () => {
    renderPalette();
    openAndSearch();

    const track = await screen.findByText('John Coltrane · Blue Train');
    fireEvent.click(track);

    expect(playSearchResultMock).toHaveBeenCalledWith(matchingTrack, [matchingTrack]);
  });

  it('opens the library filtered to a selected album', async () => {
    renderPalette();
    openAndSearch();

    fireEvent.click(await screen.findByText('Blue Train — John Coltrane'));

    expect(openLibrarySearchMock).toHaveBeenCalledWith('Blue Train John Coltrane');
  });

  it('uses Control shortcuts on Windows', async () => {
    const previous = Object.getOwnPropertyDescriptor(navigator, 'platform');
    Object.defineProperty(navigator, 'platform', {
      configurable: true,
      value: 'Win32',
    });

    try {
      renderPalette();
      fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
      expect(await screen.findByText('Ctrl+→')).toBeInTheDocument();
      expect(await screen.findByText('Ctrl+K')).toBeInTheDocument();
    } finally {
      if (previous) {
        Object.defineProperty(navigator, 'platform', previous);
      } else {
        Reflect.deleteProperty(navigator, 'platform');
      }
    }
  });
});
