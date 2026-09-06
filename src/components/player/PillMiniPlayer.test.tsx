import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../store/player-store';
import type { Track } from '../../types';

const toggleCurrentPlaybackMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/playback-actions', () => ({
  toggleCurrentPlayback: toggleCurrentPlaybackMock,
}));
vi.mock('../shared/CoverArtImage', () => ({
  CoverArtImage: () => <div data-testid="cover-art" />,
}));

import { PillMiniPlayer } from './PillMiniPlayer';

const currentTrack: Track = {
  id: 'track-1',
  title: 'Track One',
  artist: 'Artist',
  album: 'Album',
  year: 2024,
  duration: 180,
  filePath: '/music/track-one.mp3',
  hasCoverArt: false,
  dateAdded: 1,
};

describe('PillMiniPlayer', () => {
  beforeEach(() => {
    toggleCurrentPlaybackMock.mockReset().mockResolvedValue(undefined);
    usePlayerStore.setState({
      currentTrack,
      currentTime: 30,
      duration: currentTrack.duration,
      isPlaying: false,
    });
  });

  afterEach(() => {
    usePlayerStore.setState({
      currentTrack: null,
      currentTime: 0,
      duration: 0,
      isPlaying: false,
    });
  });

  it('keeps layout placement overridable and lets keyboard users open the player', () => {
    const onExpand = vi.fn();
    render(<PillMiniPlayer className="relative" onExpand={onExpand} />);

    const expand = screen.getByRole('button', { name: 'Open full player: Track One' });
    expect(expand.parentElement).toHaveClass('relative');
    fireEvent.keyDown(expand, { key: ' ' });

    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it('keeps play as an independent accessible control', async () => {
    render(<PillMiniPlayer className="relative" onExpand={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));

    await waitFor(() => expect(toggleCurrentPlaybackMock).toHaveBeenCalledTimes(1));
  });
});
