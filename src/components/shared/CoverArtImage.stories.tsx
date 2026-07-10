import type { Meta, StoryObj } from '@storybook/react-vite';
import { CoverArtImage } from './CoverArtImage';

const baseTrack = {
  filePath: '/music/story-track.mp3',
  album: 'Story Album',
  hasCoverArt: false,
  coverArtHash: null,
  blurhash: undefined,
};

const meta = {
  title: 'Shared/CoverArtImage',
  component: CoverArtImage,
  args: {
    track: baseTrack,
    className: 'h-40 w-40',
    iconClassName: 'h-10 w-10',
    lazy: false,
    size: 'medium',
    variant: 'album',
  },
  render: (args) => (
    <div className="flex min-h-72 items-center justify-center gap-6 bg-[var(--background)] p-8 text-[var(--foreground)]">
      <CoverArtImage {...args} />
    </div>
  ),
} satisfies Meta<typeof CoverArtImage>;

export default meta;

type Story = StoryObj<typeof meta>;

export const EmptyFallback: Story = {};

export const BlurhashPlaceholder: Story = {
  args: {
    track: {
      ...baseTrack,
      blurhash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
    },
  },
};

export const HashedCoverUrl: Story = {
  args: {
    track: {
      ...baseTrack,
      hasCoverArt: true,
      coverArtHash: 'storybook-cover-hash',
    },
  },
};

export const ArtistAvatarNeobrutalism: Story = {
  globals: {
    theme: 'neobrutalism',
  },
  args: {
    track: {
      ...baseTrack,
      album: 'Story Artist',
    },
    variant: 'artist',
    className: 'h-40 w-40',
  },
};
