import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppOverlayMessages } from './AppOverlayMessages';

const noop = () => {};

const meta = {
  title: 'App/OverlayMessages',
  component: AppOverlayMessages,
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    theme: 'liquid-glass',
    appError: null,
    playlistRepair: null,
    onDismissError: noop,
    onRetryPlaylistLoad: noop,
    onResetPlaylistData: noop,
    onOpenPlaylistsDataFolder: noop,
  },
  render: (args) => (
    <div className="relative min-h-72 bg-[var(--background)] p-8 text-[var(--foreground)]">
      <AppOverlayMessages {...args} />
    </div>
  ),
} satisfies Meta<typeof AppOverlayMessages>;

export default meta;

type Story = StoryObj<typeof meta>;

export const AppError: Story = {
  args: {
    appError: {
      message: 'Library scan failed',
      detail: 'The selected folder is no longer available.',
    },
  },
};

export const PlaylistCorrupt: Story = {
  args: {
    playlistRepair: {
      reason: 'Failed to parse playlists file playlists.json.',
      attemptedRecovery: true,
      recoveredFrom: null,
    },
  },
};

export const PlaylistRecovered: Story = {
  args: {
    playlistRepair: {
      reason: 'Recovered playlists from backup after failure.',
      attemptedRecovery: true,
      recoveredFrom: 'playlists.json.bak.1',
    },
  },
};

export const CombinedNeobrutalism: Story = {
  globals: {
    theme: 'neobrutalism',
  },
  args: {
    theme: 'neobrutalism',
    appError: {
      message: 'Audio output unavailable',
      detail: 'Tarab fell back to the system default device.',
    },
    playlistRepair: {
      reason: 'Automatic recovery was attempted but no valid backup was found.',
      attemptedRecovery: true,
      recoveredFrom: null,
    },
  },
};
