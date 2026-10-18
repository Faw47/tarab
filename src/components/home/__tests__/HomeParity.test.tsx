import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../../store/player-store';
import type { Track } from '../../../types';
import { HomeView } from '../HomeView';
import { HomeViewNeo } from '../HomeViewNeo';

const { playAdjacentTrackMock, reportErrorMock, model } = vi.hoisted(() => ({
  playAdjacentTrackMock: vi.fn(async () => undefined),
  reportErrorMock: vi.fn(),
  model: { albums: [] as unknown[], libraryStats: null as unknown },
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => null),
  convertFileSrc: (path: string) => path,
}));
vi.mock('../../../lib/playback-actions', () => ({
  playAdjacentTrack: playAdjacentTrackMock,
  toggleCurrentPlayback: vi.fn(async () => undefined),
  startPlayback: vi.fn(async () => 1),
}));
vi.mock('../../../lib/report-error', () => ({ reportError: reportErrorMock, logError: vi.fn() }));
vi.mock('../../../hooks/useCoverArt', () => ({ useCoverArt: () => null }));
vi.mock('../useHomeLibraryModel', () => ({
  useHomeLibraryModel: () => ({
    tracks: [],
    libraryStats: model.libraryStats,
    albumTracksByKey: new Map(),
    albums: model.albums,
    playAlbum: vi.fn(),
  }),
}));

const track = (n: number): Track => ({
  id: `t${n}`,
  filePath: `/music/${n}.flac`,
  title: `Song ${n}`,
  artist: 'Artist',
  album: `Album ${n}`,
  year: 2020,
  duration: 200,
  hasCoverArt: false,
  dateAdded: 0,
});

const props = () => ({
  onNavigateToLibrary: vi.fn(),
  onNavigateToFolders: vi.fn(),
  onScrollChange: vi.fn(),
});

describe('Home parity between themes (FE-18)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    model.albums = Array.from({ length: 30 }, (_, n) => ({ track: track(n), count: 1 }));
    model.libraryStats = { trackCount: 30, totalDuration: 7200, artistCount: 1, albumCount: 30 };
    usePlayerStore.setState({ currentTrack: null, isPlaying: false });
  });

  it('neo Home hides the player hero while nothing is loaded, like liquid', () => {
    render(<HomeViewNeo {...props()} />);
    expect(screen.queryByText('Console Standby')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Previous track' })).toBeNull();
  });

  it('neo Home card overlays opt out of the global neo button chrome', () => {
    render(<HomeViewNeo {...props()} />);
    expect(screen.getByRole('button', { name: 'Open Album 0 by Artist' })).toHaveClass(
      'ghost',
      'bg-transparent',
    );
    // FE-22: neo metadata resolves its own direction, so RTL titles drop the label tracking.
    expect(screen.getByText('Album 0')).toHaveAttribute('dir', 'auto');
  });

  it('neo Home offers View all and library stats', () => {
    const p = props();
    render(<HomeViewNeo {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /View all/ }));
    expect(p.onNavigateToLibrary).toHaveBeenCalledTimes(1);
    const stats = screen.getByRole('region', { name: 'Library stats' });
    expect(stats).toHaveTextContent('Tracks30');
    expect(stats).toHaveTextContent('Hours2');
  });

  it('neo Home reports a failed transport command', async () => {
    usePlayerStore.setState({ currentTrack: track(1) });
    playAdjacentTrackMock.mockRejectedValueOnce(new Error('no next'));
    render(<HomeViewNeo {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Next track' }));
    await waitFor(() =>
      expect(reportErrorMock).toHaveBeenCalledWith('Could not play the next track', {
        source: 'home-neo',
        error: expect.any(Error),
      }),
    );
  });

  it('liquid Home reports scrolling to the shell', () => {
    const p = props();
    const { container } = render(<HomeView {...p} />);
    const scroller = container.querySelector('.overflow-y-auto') as HTMLElement;
    scroller.scrollTop = 120;
    fireEvent.scroll(scroller);
    expect(p.onScrollChange).toHaveBeenCalledWith(true);
  });
});
