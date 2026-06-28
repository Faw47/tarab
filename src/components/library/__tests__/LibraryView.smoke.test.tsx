import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
    setSortBy: vi.fn(),
    getFilteredTracks: () => [],
    trackCount: 0,
    tracks: [],
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

vi.mock('../../../lib/tauri-commands', () => ({
  dbGetTracksPaginated: vi.fn(async () => []),
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
  it('renders empty library state when there are no tracks', () => {
    render(<LibraryView selectedTrackIds={[]} />);

    expect(screen.getByText('No tracks found')).toBeInTheDocument();
  });
});
