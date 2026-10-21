import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../../store/player-store';
import { useSettingsStore } from '../../../store/settings-store';
import type { Track } from '../../../types';
import { QueueView } from '../QueueView';

vi.mock('../../shared/CoverArtImage', () => ({ CoverArtImage: () => null }));
vi.mock('../../../lib/playback-actions', () => ({
  startPlayback: vi.fn(),
  toggleCurrentPlayback: vi.fn(),
}));
const track: Track = {
  id: 'arabic',
  filePath: '/music/song.mp3',
  title: 'أغنية 2026 (Live)',
  artist: 'فيروز (Live)',
  album: 'Live أهواك (2026)',
  year: 2026,
  duration: 60,
  hasCoverArt: false,
  dateAdded: 0,
};
describe.each([
  'liquid-glass',
  'neobrutalism',
] as const)('queue empty state action (%s)', (theme) => {
  it('offers a button to browse the library when the queue is empty', () => {
    useSettingsStore.setState({ theme });
    usePlayerStore.setState({ queue: [], queueIndex: 0, currentTrack: null, isPlaying: false });

    const onNavigateToLibrary = vi.fn();
    render(<QueueView onNavigateToLibrary={onNavigateToLibrary} />);

    const browseButton = screen.getByRole('button', { name: 'Browse library' });
    expect(browseButton).toBeInTheDocument();
    fireEvent.click(browseButton);
    expect(onNavigateToLibrary).toHaveBeenCalledTimes(1);
  });
});

describe.each(['liquid-glass', 'neobrutalism'] as const)('queue bidi metadata (%s)', (theme) => {
  it('isolates values with opposite reading directions in current, upcoming and history rows', () => {
    const queue = [0, 1, 2].map((n) => ({ ...track, id: `t${n}`, title: `${track.title} ${n}` }));
    useSettingsStore.setState({ theme });
    usePlayerStore.setState({ queue, queueIndex: 1, currentTrack: queue[1], isPlaying: false });
    render(<QueueView onNavigateToLibrary={vi.fn()} />);
    for (const item of queue) expect(screen.getByText(item.title)).toHaveAttribute('dir', 'auto');
    const artists = screen.getAllByText(track.artist);
    const albums = screen.getAllByText(track.album);
    expect(artists.length).toBeGreaterThan(1);
    expect(albums.length).toBeGreaterThan(1);
    for (const label of [...artists, ...albums])
      expect(label.closest('[dir="auto"]')).not.toBeNull();
    expect(artists.some((label) => label.tagName === 'BDI')).toBe(true);
    expect(albums.every((label) => label.tagName === 'BDI')).toBe(true);
  });
});
