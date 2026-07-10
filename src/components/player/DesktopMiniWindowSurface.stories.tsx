import type { Meta, StoryObj } from '@storybook/react-vite';
import type { DesktopPlaybackSnapshot, Track } from '../../types';
import { DesktopMiniWindowSurface } from './DesktopMiniWindowSurface';

const track: Track = {
  id: 'story-track',
  title: 'Ya Rayah',
  artist: 'Rachid Taha',
  album: 'Carte Blanche',
  albumArtist: 'Rachid Taha',
  year: 1997,
  duration: 302,
  filePath: 'C:/Music/Rachid Taha/Ya Rayah.flac',
  hasCoverArt: false,
  coverArtHash: null,
  dateAdded: 1_735_689_600_000,
  rating: 4,
  playCount: 12,
  lastPlayed: 1_767_221_200_000,
};

const snapshot = (overrides: Partial<DesktopPlaybackSnapshot>): DesktopPlaybackSnapshot => ({
  track,
  isPlaying: true,
  position: 84,
  duration: track.duration,
  hasPrevious: true,
  hasNext: true,
  ...overrides,
});

const meta = {
  title: 'Player/DesktopMiniWindowSurface',
  component: DesktopMiniWindowSurface,
  decorators: [
    (Story) => (
      <div className="min-h-[180px] bg-[#090907] p-8">
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: 'centered',
  },
} satisfies Meta<typeof DesktopMiniWindowSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playing: Story = {
  args: {
    initialSnapshot: snapshot({}),
  },
};

export const Paused: Story = {
  args: {
    initialSnapshot: snapshot({ isPlaying: false, position: 176 }),
  },
};

export const Empty: Story = {
  args: {
    initialSnapshot: snapshot({
      track: null,
      isPlaying: false,
      position: 0,
      duration: 0,
      hasPrevious: false,
      hasNext: false,
    }),
  },
};

export const LongMetadata: Story = {
  args: {
    initialSnapshot: snapshot({
      track: {
        ...track,
        id: 'story-track-long',
        title:
          'A Very Long Track Title That Must Truncate Inside The Mini Player Without Pushing Controls',
        artist: 'A Very Long Artist Name Featuring Several Collaborators And A Remix Credit',
      },
      position: 241,
    }),
  },
};
