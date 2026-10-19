import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import type { Track } from '../../types';
import { AlbumDetailsOverlay } from './AlbumDetailsOverlay';
import { AlbumDetailsOverlayNeo } from './AlbumDetailsOverlayNeo';

const tracks: Track[] = [1, 2, 3].map((number) => ({
  id: `album-hold-${number}`,
  title: `Song ${number}`,
  artist: 'Fixture artist',
  album: 'Hold selection fixture',
  year: 2026,
  duration: 180,
  filePath: `/storybook/album-hold-${number}.flac`,
  hasCoverArt: false,
  dateAdded: 0,
}));

function AlbumSelectionDemo({ neo }: { neo: boolean }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [lastAction, setLastAction] = useState('No playback requested');
  const Overlay = neo ? AlbumDetailsOverlayNeo : AlbumDetailsOverlay;
  return (
    <div className="relative h-screen overflow-y-auto">
      <p role="status" className="p-4 text-sm">
        Hold a row for 500 ms to select it. {lastAction}
      </p>
      <Overlay
        album="Hold selection fixture"
        artist="Fixture artist"
        tracks={tracks}
        selectedTrackIds={selected}
        onTrackSelect={(track, multi) => {
          setSelected((previous) =>
            multi
              ? previous.includes(track.id)
                ? previous.filter((id) => id !== track.id)
                : [...previous, track.id]
              : [track.id],
          );
        }}
        onClearSelection={() => setSelected([])}
        onSelectAll={(items) => setSelected(items.map((track) => track.id))}
        onPlayTrack={(track) => setLastAction(`Play ${track.title}`)}
        onPlayAlbum={() => setLastAction('Play album')}
        onClose={() => setLastAction('Back')}
      />
    </div>
  );
}

const meta = {
  title: 'Album/Hold selection',
  component: AlbumSelectionDemo,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AlbumSelectionDemo>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Liquid: Story = { args: { neo: false }, globals: { theme: 'liquid-glass' } };
export const Neo: Story = { args: { neo: true }, globals: { theme: 'neobrutalism' } };
