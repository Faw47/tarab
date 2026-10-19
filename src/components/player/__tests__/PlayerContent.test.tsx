import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../../store/player-store';
import { useSettingsStore } from '../../../store/settings-store';
import type { Track } from '../../../types';
import { PlayerContent } from '../PlayerContent';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async () => null),
  convertFileSrc: (path: string) => path,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => undefined) }));
vi.mock('../LyricsDisplay', () => ({ LyricsDisplay: () => null }));
vi.mock('../LyricsSnippet', () => ({ LyricsSnippet: () => null }));

const track: Track = {
  id: 'track-1',
  filePath: '/music/a.flac',
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  year: 2020,
  duration: 200,
  hasCoverArt: false,
  dateAdded: 0,
};

function renderPlayer() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <PlayerContent onClose={vi.fn()} />
    </QueryClientProvider>,
  );
}

const initialSettings = useSettingsStore.getState();

describe('PlayerContent', () => {
  beforeEach(() => {
    useSettingsStore.setState(initialSettings);
    usePlayerStore.setState({ currentTrack: track, duration: 200, isPlaying: false });
  });

  it.each([
    true,
    false,
  ])('isolates mixed Arabic metadata in either layout (%s)', (fullscreenPlayerLayout) => {
    useSettingsStore.setState({ theme: 'neobrutalism', fullscreenPlayerLayout });
    const arabic = { ...track, title: 'أغنية 2026 (Live)', artist: 'فيروز', album: 'ألبوم 2026' };
    usePlayerStore.setState({ currentTrack: arabic });
    renderPlayer();
    expect(screen.getByRole('heading', { name: arabic.title })).toHaveAttribute('dir', 'auto');
    expect(screen.getByText(arabic.artist)).toHaveAttribute('dir', 'auto');
    expect(screen.getByText(arabic.album)).toHaveAttribute('dir', 'auto');
    useSettingsStore.setState({ theme: 'liquid-glass' });
  });

  it('keeps the transport and progress when cover art is hidden', () => {
    // Regression for FE-06: the setting removed the whole left column, transport included.
    useSettingsStore.setState({ fullscreenHideCoverArt: true });
    renderPlayer();

    expect(screen.getByTitle('Play')).toBeInTheDocument();
    expect(screen.getByTitle('Next track')).toBeInTheDocument();
    // HidingProgressBar reveals its seek bar on hover or focus of a `group` ancestor.
    expect(screen.getByTestId('player-progress-without-art')).toHaveClass('group');
    expect(screen.queryByAltText('Album cover')).not.toBeInTheDocument();
  });

  it('shows elapsed and total time and a volume control in the default layout', () => {
    // Regression for FE-12: the two-column layout had neither.
    useSettingsStore.setState({ fullscreenPlayerLayout: true, fullscreenHideCoverArt: false });
    usePlayerStore.setState({ currentTime: 42 });
    renderPlayer();

    expect(screen.getByTestId('player-elapsed')).toHaveTextContent('0:42');
    expect(screen.getByTestId('player-duration')).toHaveTextContent('3:20');
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeInTheDocument();
  });

  it('lets the compact card reveal its seek bar', () => {
    // Regression for FE-11: HidingProgressBar reveals on a group ancestor the card lacked.
    useSettingsStore.setState({ fullscreenPlayerLayout: false });
    const { container } = renderPlayer();

    expect(container.querySelector('.max-w-5xl')).toHaveClass('group');
  });

  it('shows elapsed and total time in the compact card too', () => {
    useSettingsStore.setState({ fullscreenPlayerLayout: false });
    usePlayerStore.setState({ currentTime: 61 });
    renderPlayer();

    expect(screen.getByTestId('player-elapsed')).toHaveTextContent('1:01');
    expect(screen.getByTestId('player-duration')).toHaveTextContent('3:20');
  });

  it.each([
    true,
    false,
  ])('renders no blurred cover backdrop in neobrutalism (two-column: %s)', (fullscreenPlayerLayout) => {
    // Regression for FE-17: the neo full player was dark blurred glass.
    useSettingsStore.setState({ theme: 'neobrutalism', fullscreenPlayerLayout });
    const { container } = renderPlayer();
    const backdrop = container.querySelector('.-z-20');
    expect(backdrop).toHaveAttribute('hidden');

    useSettingsStore.setState({ theme: 'liquid-glass' });
  });
});
