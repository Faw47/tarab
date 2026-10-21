import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { fetchLibraryTrackById } from '../../../features/library/api';
import { usePlayerStore } from '../../../store/player-store';
import { useSettingsStore } from '../../../store/settings-store';
import type { Track } from '../../../types';
import { QueueView } from '../QueueView';

vi.mock('../../../features/library/api', () => ({ fetchLibraryTrackById: vi.fn() }));
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
describe.each(['liquid-glass', 'neobrutalism'] as const)('queue bidi metadata (%s)', (theme) => {
  it('isolates values with opposite reading directions in current, upcoming and history rows', () => {
    const queue = [0, 1, 2].map((n) => ({ ...track, id: `t${n}`, title: `${track.title} ${n}` }));
    useSettingsStore.setState({ theme });
    usePlayerStore.setState({ queue, queueIndex: 1, currentTrack: queue[1], isPlaying: false });
    render(<QueueView />);
    for (const item of queue) expect(screen.getByText(item.title)).toHaveAttribute('dir', 'auto');
    const artists = screen.getAllByText(track.artist);
    const albums = screen.getAllByText(track.album);
    expect(artists.length).toBeGreaterThan(1);
    expect(albums.length).toBeGreaterThan(1);
    for (const label of [...artists, ...albums])
      expect(label.closest('[dir="auto"]')).not.toBeNull();
    expect(artists.some((label) => label.tagName === 'BDI')).toBe(true);
    expect(albums.every((label) => label.tagName === 'BDI')).toBe(true);

  it('hydrates restored lazy history metadata in each theme', async () => {
    const historyEntry: Track = {
      ...track,
      id: 'history-path',
      filePath: '',
      title: '',
      artist: '',
      album: '',
      _lazyQueueEntry: true,
      _queueId: 'history-entry',
    };
    const activeTrack = { ...track, id: 'active', title: 'Active track' };
    const hydratedTrack: Track = {
      ...track,
      id: 'history-path',
      title: 'Loaded history title',
      artist: 'Loaded history artist',
      album: 'Loaded history album',
      _queueId: 'history-entry',
    };
    vi.mocked(fetchLibraryTrackById).mockResolvedValue(hydratedTrack);
    useSettingsStore.setState({ theme });
    usePlayerStore.setState({
      queue: [historyEntry, activeTrack],
      queueIndex: 1,
      currentTrack: activeTrack,
      isPlaying: false,
    });

    render(<QueueView />);

    expect(await screen.findByText('Loaded history title')).toBeInTheDocument();
    expect(fetchLibraryTrackById).toHaveBeenCalledWith('history-path');
  });
  });
});
