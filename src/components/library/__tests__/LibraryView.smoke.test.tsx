import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../../types';

const mocks = vi.hoisted(() => ({ tracks: [] as Track[] }));

const makeTrack = (id: string, album: string, artist: string): Track => ({
  id,
  title: `${album} song`,
  artist,
  albumArtist: null,
  album,
  year: 2026,
  duration: 180,
  filePath: `/music/${id}.mp3`,
  hasCoverArt: true,
  coverArtHash: null,
  dateAdded: Date.now(),
  rating: null,
});

vi.mock('../../../store/settings-store', () => ({
  useSettingsStore: (
    selector: (state: { downloadArtwork: boolean; reducedEffects: boolean }) => unknown,
  ) => selector({ downloadArtwork: false, reducedEffects: true }),
}));

vi.mock('../../../store/player-store', () => ({
  usePlayerStore: (selector: (state: { currentTrack: null; isPlaying: boolean }) => unknown) =>
    selector({ currentTrack: null, isPlaying: false }),
}));

vi.mock('../../../features/library/useLibraryData', () => ({
  useLibraryData: () => ({
    searchQuery: '',
    sortBy: 'dateAdded',
    libraryStats: null,
    recentTracks: [],
    mostPlayedTracks: [],
    searchScope: 'all',
    setSearchScope: vi.fn(),
    setSortBy: vi.fn(),
    getFilteredTracks: () => mocks.tracks,
    trackCount: mocks.tracks.length,
    tracks: mocks.tracks,
    appendTracks: vi.fn(),
    applyCoverArtHashes: vi.fn(),
    isLyricsMatch: () => false,
    getLyricsMatchLine: () => null,
  }),
}));

vi.mock('../../../hooks/useCoverArt', () => ({
  useCoverArt: () => null,
  prefetchCoverArtBatch: vi.fn(async () => undefined),
}));

vi.mock('../../../hooks/useDominantColor', () => ({
  useDominantColor: () => null,
}));

vi.mock('../../../features/library/api', () => ({
  fetchLibraryTracksPage: vi.fn(async () => []),
}));

vi.mock('../../../lib/tauri-commands', () => ({
  generateCoverArtHashes: vi.fn(async () => []),
}));

vi.mock('../../../lib/playback-actions', () => ({
  startPlayback: vi.fn(),
}));

vi.mock('../../../lib/report-error', () => ({
  reportError: vi.fn(),
}));

import { LibraryView } from '../LibraryView';

describe('LibraryView', () => {
  beforeEach(() => {
    mocks.tracks = [];
  });

  it('renders empty library state when there are no tracks', () => {
    render(<LibraryView selectedTrackIds={[]} />);

    expect(screen.getByText('No music yet')).toBeInTheDocument();
  });

  it('routes true empty libraries to folder setup', () => {
    const onNavigateToFolders = vi.fn();
    render(<LibraryView selectedTrackIds={[]} onNavigateToFolders={onNavigateToFolders} />);

    fireEvent.click(screen.getByRole('button', { name: /add folders/i }));

    expect(onNavigateToFolders).toHaveBeenCalledTimes(1);
  });

  it('restores the featured-first album showcase', () => {
    mocks.tracks = [
      makeTrack('lead', 'Featured record', 'Lead artist'),
      makeTrack('second', 'Second record', 'Second artist'),
    ];

    render(<LibraryView selectedTrackIds={[]} />);

    const showcase = screen.getByRole('grid', { name: 'Featured albums' });
    expect(showcase).toBeInTheDocument();
    expect(screen.getByText('Featured album').closest('article')).toHaveClass(
      'library-v2-album-featured-span',
    );
    expect(screen.getByText('Second record')).toBeInTheDocument();
  });
});
