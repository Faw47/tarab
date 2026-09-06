import type { Meta, StoryObj } from '@storybook/react-vite';
import { usePlayerStore } from '../../store/player-store';
import { useSettingsStore } from '../../store/settings-store';
import type { Track } from '../../types';
import { PlayerContent } from './PlayerContent';

const storyTrack: Track = {
  id: 'full-player-visual-track',
  title: 'City to State',
  artist: 'Aries',
  album: 'Welcome Home',
  albumArtist: 'Aries',
  year: 2019,
  duration: 156,
  filePath: '/storybook/music/city-to-state.flac',
  hasCoverArt: false,
  coverArtHash: null,
  blurhash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
  dateAdded: 1_735_689_600_000,
  rating: 4,
  playCount: 12,
  lastPlayed: 1_767_221_200_000,
};

interface PlayerVisualBaselineProps {
  width: number;
  height: number;
  fullscreenLayout: boolean;
}

function PlayerVisualBaseline({ width, height, fullscreenLayout }: PlayerVisualBaselineProps) {
  usePlayerStore.setState({
    currentTrack: storyTrack,
    queue: [storyTrack],
    queueIndex: 0,
    currentTime: 62,
    duration: storyTrack.duration,
    isPlaying: true,
    lyrics: null,
    playbackError: null,
  });
  useSettingsStore.setState({
    fullscreenPlayerLayout: fullscreenLayout,
    fullscreenHideCoverArt: false,
    fullscreenBackgroundAnimation: 'none',
    reducedEffects: true,
    backgroundEnabled: true,
  });

  return (
    <div
      className="relative isolate overflow-hidden bg-[#090907] text-white"
      style={{ width, height }}
      data-visual-baseline={`${fullscreenLayout ? 'two-column' : 'card'}-${width}x${height}`}
    >
      <PlayerContent onClose={() => undefined} />
    </div>
  );
}

const meta = {
  title: 'Player/Full Player Visual Baselines',
  component: PlayerVisualBaseline,
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
  },
} satisfies Meta<typeof PlayerVisualBaseline>;

export default meta;
type Story = StoryObj<typeof meta>;

const baseline = (
  width: number,
  height: number,
  fullscreenLayout: boolean,
  theme: 'liquid-glass' | 'neobrutalism',
): Story => ({
  args: { width, height, fullscreenLayout },
  globals: { theme },
});

export const LiquidTwoColumn800x600 = baseline(800, 600, true, 'liquid-glass');
export const LiquidTwoColumn1200x800 = baseline(1200, 800, true, 'liquid-glass');
export const LiquidTwoColumn1440x900 = baseline(1440, 900, true, 'liquid-glass');
export const LiquidTwoColumnFullscreen = baseline(1728, 1117, true, 'liquid-glass');
export const LiquidCard800x600 = baseline(800, 600, false, 'liquid-glass');
export const LiquidCard1200x800 = baseline(1200, 800, false, 'liquid-glass');
export const LiquidCard1440x900 = baseline(1440, 900, false, 'liquid-glass');
export const LiquidCardFullscreen = baseline(1728, 1117, false, 'liquid-glass');

export const NeoTwoColumn800x600 = baseline(800, 600, true, 'neobrutalism');
export const NeoTwoColumn1200x800 = baseline(1200, 800, true, 'neobrutalism');
export const NeoTwoColumn1440x900 = baseline(1440, 900, true, 'neobrutalism');
export const NeoTwoColumnFullscreen = baseline(1728, 1117, true, 'neobrutalism');
export const NeoCard800x600 = baseline(800, 600, false, 'neobrutalism');
export const NeoCard1200x800 = baseline(1200, 800, false, 'neobrutalism');
export const NeoCard1440x900 = baseline(1440, 900, false, 'neobrutalism');
export const NeoCardFullscreen = baseline(1728, 1117, false, 'neobrutalism');
