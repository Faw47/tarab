import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { fn } from 'storybook/test';
import { libraryKeys } from '../../features/library/queryKeys';
import { getAlbumArtist, getAlbumKey, getArtistKey } from '../../lib/album-key';
import { usePlayerStore } from '../../store/player-store';
import type { Track } from '../../types';
import { HomeView } from './HomeView';
import { HomeViewNeo } from './HomeViewNeo';

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
  filePath:
    'C:/Music/' +
    artist +
    '/' +
    album +
    '/' +
    String(trackNumber).padStart(2, '0') +
    ' - ' +
    title +
    '.flac',
  hasCoverArt: false,
  coverArtHash: null,
  blurhash: null,
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
  makeTrack('six', 'First Light', 'Mina Waves', 'Morning Archive', 1),
];

const nowPlaying = populatedTracks[1];

const baseArgs = {
  onNavigateToLibrary: fn(),
  onNavigateToFolders: fn(),
  onOpenAlbumDetails: fn(),
  onOpenFullPlayer: fn(),
  onRetryLoad: fn(),
  onScrollChange: fn(),
};

const withHomeData = (tracks: Track[], currentTrack: Track | null = null): Decorator => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  const aggregates = Array.from(
    tracks.reduce((groups, track) => {
      const key = getAlbumKey(track);
      const group = groups.get(key) ?? [];
      group.push(track);
      groups.set(key, group);
      return groups;
    }, new Map<string, Track[]>()),
  ).map(([, albumTracks]) => ({
    album: albumTracks[0].album,
    artist: getAlbumArtist(albumTracks[0]),
    count: albumTracks.length,
    track: albumTracks[0],
  }));

  queryClient.setQueryData(libraryKeys.tracks(), tracks);
  queryClient.setQueryData(libraryKeys.trackCount(), tracks.length);
  queryClient.setQueryData(libraryKeys.stats(), {
    trackCount: tracks.length,
    totalDuration: tracks.reduce((sum, track) => sum + track.duration, 0),
    artistCount: new Set(tracks.map((track) => getArtistKey(track.artist))).size,
    albumCount: aggregates.length,
    totalPlays: tracks.reduce((sum, track) => sum + (track.playCount ?? 0), 0),
  });
  queryClient.setQueryData(libraryKeys.albums(), aggregates);
  queryClient.setQueryData(libraryKeys.artists(), []);

  return (Story) => {
    const [previousPlayerState] = useState(() => {
      const state = usePlayerStore.getState();
      return {
        currentTrack: state.currentTrack,
        isPlaying: state.isPlaying,
        currentTime: state.currentTime,
        duration: state.duration,
        hasActivePlayback: state.hasActivePlayback,
      };
    });

    useEffect(() => {
      usePlayerStore.setState({
        currentTrack,
        isPlaying: currentTrack !== null,
        currentTime: currentTrack ? 74 : 0,
        duration: currentTrack?.duration ?? 0,
        hasActivePlayback: currentTrack !== null,
      });
      return () => usePlayerStore.setState(previousPlayerState);
    }, [currentTrack, previousPlayerState]);

    return (
      <QueryClientProvider client={queryClient}>
        <div className="h-[820px] w-full overflow-hidden">
          <Story />
        </div>
      </QueryClientProvider>
    );
  };
};

const meta = {
  title: 'Home/HomeView',
  component: HomeView,
  parameters: {
    layout: 'fullscreen',
  },
  args: baseArgs,
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  render: (args) => <HomeView {...args} />,
  decorators: [withHomeData(populatedTracks, nowPlaying)],
};

export const Empty: Story = {
  render: (args) => <HomeView {...args} />,
  decorators: [withHomeData([])],
};

export const Loading: Story = {
  render: (args) => <HomeView {...args} />,
  decorators: [withHomeData([])],
  args: {
    isLibraryLoading: true,
  },
};

export const ErrorWithRetry: Story = {
  render: (args) => <HomeView {...args} />,
  decorators: [withHomeData([])],
  args: {
    libraryError: 'The local library database could not be opened.',
  },
};

export const NeobrutalismPopulated: Story = {
  render: (args) => <HomeViewNeo {...args} />,
  decorators: [withHomeData(populatedTracks, nowPlaying)],
  globals: {
    theme: 'neobrutalism',
  },
};

export const NeobrutalismEmpty: Story = {
  render: (args) => <HomeViewNeo {...args} />,
  decorators: [withHomeData([])],
  globals: {
    theme: 'neobrutalism',
  },
};

export const NeobrutalismError: Story = {
  render: (args) => <HomeViewNeo {...args} />,
  decorators: [withHomeData([])],
  globals: {
    theme: 'neobrutalism',
  },
  args: {
    libraryError: 'The local library database could not be opened.',
  },
};
