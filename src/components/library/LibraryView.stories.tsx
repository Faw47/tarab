import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fn } from 'storybook/test';
import { libraryKeys } from '../../features/library/queryKeys';
import type { Track } from '../../types';
import { LibraryView } from './LibraryView';

const makeTrack = (
  id: string,
  title: string,
  artist: string,
  album: string,
  trackNumber: number,
): Track => ({
  id,
  title,
  artist,
  albumArtist: artist,
  album,
  year: 2024,
  trackNumber,
  duration: 180 + trackNumber * 13,
  filePath: `C:/Music/${artist}/${album}/${String(trackNumber).padStart(2, '0')} - ${title}.flac`,
  hasCoverArt: false,
  coverArtHash: null,
  dateAdded: 1_735_689_600_000 - trackNumber * 60_000,
  rating: trackNumber % 2 === 0 ? 4 : null,
  playCount: trackNumber * 3,
  lastPlayed: null,
  fileFormat: 'FLAC',
});

const populatedTracks = [
  makeTrack('one', 'Midnight Transit', 'Nour Ensemble', 'Night Routes', 1),
  makeTrack('two', 'Old City Radio', 'Nour Ensemble', 'Night Routes', 2),
  makeTrack('three', 'Copper Strings', 'Nour Ensemble', 'Night Routes', 3),
  makeTrack('four', 'Desert Signal', 'Atlas Electric', 'Open Frequencies', 1),
  makeTrack('five', 'Blue Courtyard', 'Atlas Electric', 'Open Frequencies', 2),
  makeTrack('six', 'First Light', 'Mina & The Waves', 'Morning Archive', 1),
];

const withLibraryData = (tracks: Track[]): Decorator => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  queryClient.setQueryData(libraryKeys.tracks(), tracks);
  queryClient.setQueryData(libraryKeys.trackCount(), tracks.length);
  queryClient.setQueryData(libraryKeys.stats(), {
    trackCount: tracks.length,
    totalDuration: tracks.reduce((sum, track) => sum + track.duration, 0),
    artistCount: new Set(tracks.map((track) => track.artist)).size,
    albumCount: new Set(tracks.map((track) => `${track.albumArtist}::${track.album}`)).size,
    totalPlays: tracks.reduce((sum, track) => sum + (track.playCount ?? 0), 0),
  });

  return (Story) => (
    <QueryClientProvider client={queryClient}>
      <div className="h-[760px] min-w-0 overflow-hidden">
        <Story />
      </div>
    </QueryClientProvider>
  );
};

const meta = {
  title: 'Library/LibraryView',
  component: LibraryView,
  args: {
    selectedTrackIds: [],
    onNavigateToFolders: fn(),
    onRetryLoad: fn(),
  },
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof LibraryView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  decorators: [withLibraryData(populatedTracks)],
};

export const Empty: Story = {
  decorators: [withLibraryData([])],
};

export const Loading: Story = {
  decorators: [withLibraryData([])],
  args: {
    isLibraryLoading: true,
  },
};

export const ErrorWithRetry: Story = {
  decorators: [withLibraryData([])],
  args: {
    libraryError: 'The local library database could not be opened.',
  },
};

export const NeobrutalismPopulated: Story = {
  decorators: [withLibraryData(populatedTracks)],
  globals: {
    theme: 'neobrutalism',
  },
};

export const NeobrutalismError: Story = {
  decorators: [withLibraryData([])],
  globals: {
    theme: 'neobrutalism',
  },
  args: {
    libraryError: 'The local library database could not be opened.',
  },
};
