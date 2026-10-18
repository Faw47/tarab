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

describe('PlayerContent', () => {
  beforeEach(() => {
    usePlayerStore.setState({ currentTrack: track, duration: 200, isPlaying: false });
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
});
