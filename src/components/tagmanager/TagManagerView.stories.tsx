import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { fn } from 'storybook/test';
import { libraryKeys } from '../../features/library/queryKeys';
import { getAlbumKey, getArtistKey } from '../../lib/album-key';
import type { Track } from '../../types';
import { TagManagerView } from './TagManagerView';

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
];

const withLibraryData = (tracks: Track[]) => (Story: React.ComponentType) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  queryClient.setQueryData(libraryKeys.tracks(), tracks);
  queryClient.setQueryData(libraryKeys.trackCount(), tracks.length);
  queryClient.setQueryData(libraryKeys.stats(), {
    trackCount: tracks.length,
    totalDuration: tracks.reduce((sum, track) => sum + track.duration, 0),
    artistCount: new Set(tracks.map((track) => getArtistKey(track.artist))).size,
    albumCount: new Set(tracks.map((track) => getAlbumKey(track))).size,
    totalPlays: tracks.reduce((sum, track) => sum + (track.playCount ?? 0), 0),
  });
  queryClient.setQueryData(libraryKeys.albums(), []);
  queryClient.setQueryData(libraryKeys.artists(), []);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-[760px] w-full overflow-hidden">
        <Story />
      </div>
    </QueryClientProvider>
  );
};

function TagManagerStoryHarness({ initialSelectedIds = [] }: { initialSelectedIds?: string[] }) {
  const [selectedTracks, setSelectedTracks] = useState(() =>
    populatedTracks.filter((track) => initialSelectedIds.includes(track.id)),
  );

  const handleToggleTrack = useCallback((track: Track, isMulti: boolean) => {
    setSelectedTracks((current) => {
      if (!isMulti) return [track];
      return current.some((selected) => selected.id === track.id)
        ? current.filter((selected) => selected.id !== track.id)
        : [...current, track];
    });
  }, []);

  return (
    <TagManagerView
      selectedTracks={selectedTracks}
      onSelectionChange={setSelectedTracks}
      onToggleTrack={handleToggleTrack}
      onOpenTagEditor={fn()}
      onRevealFiles={fn()}
      onCopyMetadata={fn()}
      onPasteMetadata={fn()}
      onTrackContextMenu={fn()}
      onRenameTrack={fn(async () => undefined)}
      onMoveTracks={fn(async () => undefined)}
      onDeleteFiles={fn(async () => undefined)}
      onRemoveTracks={fn()}
      onScrollChange={fn()}
    />
  );
}

const meta = {
  title: 'Tag Manager/TagManagerView',
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  render: () => <TagManagerStoryHarness />,
  decorators: [withLibraryData(populatedTracks)],
};

export const Empty: Story = {
  render: () => <TagManagerStoryHarness />,
  decorators: [withLibraryData([])],
};

export const SelectedEditor: Story = {
  render: () => <TagManagerStoryHarness initialSelectedIds={['one']} />,
  decorators: [withLibraryData(populatedTracks)],
};

export const Neobrutalism: Story = {
  render: () => <TagManagerStoryHarness />,
  decorators: [withLibraryData(populatedTracks)],
  globals: {
    theme: 'neobrutalism',
  },
};
