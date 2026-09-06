import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { playlistKeys } from '../../features/playlists/queryKeys';
import type { PlaylistDetail, PlaylistEntry, PlaylistSummary } from '../../types';
import { PlaylistsView } from './PlaylistsView';

const makeEntry = (
  trackId: string,
  title: string,
  position: number,
  available = true,
): PlaylistEntry => ({
  trackId,
  position,
  title,
  artist: 'Nour Ensemble',
  album: 'Night Routes',
  duration: 180 + position * 12,
  available,
  filePath: available
    ? '/Music/Nour Ensemble/' + title + '.flac'
    : '/Music/missing/' + title + '.flac',
  hasCoverArt: false,
  coverArtHash: null,
});

const manualSummary: PlaylistSummary = {
  id: 'manual-night-routes',
  name: 'Night Routes',
  playlistType: 'Manual',
  trackCount: 3,
  missingCount: 0,
  updatedAt: 1735689600000,
  createdAt: 1735689600000,
  isPinned: true,
  pinnedAt: 1735689600000,

  lastSyncedAt: null,
  syncError: null,
  smartRules: [],
};

const manualDetail: PlaylistDetail = {
  ...manualSummary,
  entries: [
    makeEntry('night-1', 'Midnight Transit', 0),
    makeEntry('night-2', 'Old City Radio', 1),
    makeEntry('night-3', 'Copper Strings', 2),
  ],
  trackIds: ['night-1', 'night-2', 'night-3'],
};

const smartSummary: PlaylistSummary = {
  ...manualSummary,
  id: 'smart-recent',
  name: 'Recently Added',
  playlistType: 'Smart',
  isPinned: false,
  pinnedAt: null,
  smartRules: [{ RecentlyAdded: { days: 30 } }],
};

const smartDetail: PlaylistDetail = {
  ...smartSummary,
  trackCount: 2,
  entries: [makeEntry('recent-1', 'Desert Signal', 0), makeEntry('recent-2', 'Blue Courtyard', 1)],
  trackIds: ['recent-1', 'recent-2'],
};

const missingSummary: PlaylistSummary = {
  ...manualSummary,
  id: 'manual-missing',
  name: 'Needs Repair',
  trackCount: 3,
  missingCount: 1,
};

const missingDetail: PlaylistDetail = {
  ...missingSummary,
  entries: [
    makeEntry('kept-1', 'Still Here', 0),
    makeEntry('missing-1', 'Lost Recording', 1, false),
    makeEntry('kept-2', 'Another One', 2),
  ],
  trackIds: ['kept-1', 'missing-1', 'kept-2'],
};

const withPlaylistData = (summaries: PlaylistSummary[], details: PlaylistDetail[]): Decorator => {
  return (Story) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
    });
    queryClient.setQueryData(playlistKeys.lists(), summaries);
    for (const detail of details) {
      queryClient.setQueryData(playlistKeys.detail(detail.id), detail);
    }

    return (
      <QueryClientProvider client={queryClient}>
        <div className="h-[760px] min-w-0 overflow-hidden">
          <Story />
        </div>
      </QueryClientProvider>
    );
  };
};

const meta = {
  title: 'Playlists/PlaylistsView',
  component: PlaylistsView,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof PlaylistsView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ManualKeyboardReady: Story = {
  decorators: [withPlaylistData([manualSummary], [manualDetail])],
};

export const SmartReadOnly: Story = {
  decorators: [withPlaylistData([smartSummary], [smartDetail])],
};

export const MissingEntryRepair: Story = {
  decorators: [withPlaylistData([missingSummary], [missingDetail])],
};

export const Empty: Story = {
  decorators: [withPlaylistData([], [])],
};

export const Neobrutalism: Story = {
  decorators: [withPlaylistData([manualSummary], [manualDetail])],
  globals: {
    theme: 'neobrutalism',
  },
};
