import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../../store/player-store';
import { useSettingsStore } from '../../../store/settings-store';
import type { Track } from '../../../types';
import { HomeView } from '../HomeView';
import { HomeViewNeo } from '../HomeViewNeo';

const { playAdjacentTrackMock, toggleCurrentPlaybackMock, reportErrorMock, model } = vi.hoisted(
  () => ({
    playAdjacentTrackMock: vi.fn(async () => undefined),
    toggleCurrentPlaybackMock: vi.fn(async () => undefined),
    reportErrorMock: vi.fn(),
    model: { albums: [] as unknown[], tracks: [] as Track[], libraryStats: null as unknown },
  }),
);

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => null),
  convertFileSrc: (path: string) => path,
}));
vi.mock('../../../lib/playback-actions', () => ({
  playAdjacentTrack: playAdjacentTrackMock,
  toggleCurrentPlayback: toggleCurrentPlaybackMock,
  startPlayback: vi.fn(async () => 1),
}));
vi.mock('../../../lib/report-error', () => ({ reportError: reportErrorMock, logError: vi.fn() }));
vi.mock('../../../hooks/useCoverArt', () => ({ useCoverArt: () => null }));
vi.mock('../useHomeLibraryModel', () => ({
  useHomeLibraryModel: () => ({
    tracks: model.tracks,
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
    model.tracks = [];
    usePlayerStore.setState({ currentTrack: null, isPlaying: false });
    useSettingsStore.setState({ reducedEffects: true });
  });

  it('keeps the focused neo volume slider visible after the pointer leaves', () => {
    vi.useFakeTimers();
    try {
      usePlayerStore.setState({ currentTrack: track(1) });
      render(<HomeViewNeo {...props()} />);
      const slider = screen.getByRole('slider', { name: 'Volume' });
      const wrapper = screen.getByRole('button', { name: /mute/i }).parentElement as HTMLElement;
      const sliding = slider.closest('.overflow-hidden');
      act(() => slider.focus());
      fireEvent.mouseLeave(wrapper);
      act(() => vi.advanceTimersByTime(350));
      expect(slider).toHaveFocus();
      expect(sliding).toHaveClass('w-auto', 'opacity-100');
      fireEvent.blur(slider, { relatedTarget: document.body });
      act(() => vi.advanceTimersByTime(350));
      expect(sliding).toHaveClass('w-0', 'opacity-0');
    } finally {
      vi.useRealTimers();
    }
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

  describe('Neo Home copy and motion (FE-40)', () => {
    it('uses plain language for an empty library', () => {
      model.albums = [];
      model.tracks = [];
      model.libraryStats = null;
      render(<HomeViewNeo {...props()} />);

      expect(
        screen.getByRole('heading', { name: 'Your music library is empty' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Add a music folder to see your albums and tracks here.'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Add music folder' })).toBeInTheDocument();
    });

    it('keeps album polaroids static when active', () => {
      render(<HomeViewNeo {...props()} />);

      const card = screen.getByRole('button', { name: 'Open Album 0 by Artist' }).parentElement;
      expect(card?.className).not.toMatch(/(?:hover|active):translate-/);
    });

    it('suppresses the playing equalizer pulse when reduced effects are enabled', () => {
      usePlayerStore.setState({ currentTrack: track(1), isPlaying: true });
      const { container } = render(<HomeViewNeo {...props()} />);

      expect(container.querySelector('.animate-pulse')).toBeNull();
    });

    it('suppresses the loading pulse when reduced effects are enabled', () => {
      render(<HomeViewNeo {...props()} isLibraryLoading />);

      expect(screen.getByRole('status', { name: 'Loading home' })).not.toHaveClass('animate-pulse');
    });
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

  it.each([
    HomeView,
    HomeViewNeo,
  ])('shows stats from loaded tracks before aggregates arrive (%#)', (Home) => {
    model.libraryStats = null;
    model.tracks = [track(1), track(2)];
    render(<Home {...props()} />);
    const stats = screen.getByRole('region', { name: 'Library stats' });
    expect(stats).toHaveTextContent('Tracks');
    expect(stats).toHaveTextContent('Artists');
    expect(within(stats).getByText('2')).toBeInTheDocument();
  });

  describe.each([
    ['liquid', HomeView, 'home-view'],
    ['neo', HomeViewNeo, 'home-neo'],
  ] as const)('%s shared Home controller', (_theme, Home, source) => {
    it.each([
      ['Previous track', 'Could not play the previous track', 'previous'],
      ['Next track', 'Could not play the next track', 'next'],
      ['Pause', 'Could not play or pause', 'toggle'],
    ])('reports a rejected %s action once', async (label, message, action) => {
      usePlayerStore.setState({ currentTrack: track(1), isPlaying: true });
      const failure = new Error('output unavailable');
      if (action === 'toggle') toggleCurrentPlaybackMock.mockRejectedValueOnce(failure);
      else playAdjacentTrackMock.mockRejectedValueOnce(failure);
      render(<Home {...props()} />);
      fireEvent.click(screen.getByRole('button', { name: label }));
      await waitFor(() =>
        expect(reportErrorMock).toHaveBeenCalledExactlyOnceWith(message, {
          source,
          error: failure,
        }),
      );
      if (action === 'toggle') expect(toggleCurrentPlaybackMock).toHaveBeenCalledTimes(1);
      else expect(playAdjacentTrackMock).toHaveBeenCalledExactlyOnceWith(action);
    });

    it('hides stats and playback controls while loading', () => {
      usePlayerStore.setState({ currentTrack: track(1) });
      render(<Home {...props()} isLibraryLoading />);
      expect(screen.getByRole('status', { name: 'Loading home' })).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'Library stats' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Next track' })).toBeNull();
    });

    it('does not invent stats for an empty library', () => {
      model.tracks = [];
      model.albums = [];
      model.libraryStats = null;
      render(<Home {...props()} />);
      expect(screen.queryByRole('region', { name: 'Library stats' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Next track' })).toBeNull();
    });
  });
});
