import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../../store/player-store';
import type { Track } from '../../../types';
import { PillMiniPlayer } from '../PillMiniPlayer';

const toggleCurrentPlaybackMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../../../lib/playback-actions', () => ({
  toggleCurrentPlayback: toggleCurrentPlaybackMock,
}));

vi.mock('../../shared/CoverArtImage', () => ({
  CoverArtImage: () => null,
}));

const track: Track = {
  id: 'track-1',
  filePath: '/music/a.flac',
  title: 'Song',
  artist: 'Artist',
  album: 'Album',
  year: 2020,
  duration: 200,
  hasCoverArt: false,
  dateAdded: 0,
};

describe('PillMiniPlayer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlayerStore.setState({
      currentTrack: track,
      currentTime: 20,
      duration: track.duration,
      isPlaying: false,
    });
  });

  it('exposes expansion as a keyboard-operable button', () => {
    const onExpand = vi.fn();

    render(<PillMiniPlayer onExpand={onExpand} />);

    const expandButton = screen.getByRole('button', { name: `Expand player for ${track.title}` });
    expect(expandButton.tagName).toBe('BUTTON');
    expandButton.focus();
    expect(expandButton).toHaveFocus();

    fireEvent.click(expandButton);

    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it('lets the layout container position the collapsed player', () => {
    const { container } = render(<PillMiniPlayer onExpand={vi.fn()} />);

    const root = container.firstElementChild;
    expect(root).not.toHaveClass('fixed');
    expect(root).not.toHaveClass('bottom-6');
    expect(root).not.toHaveClass('left-6');
  });

  it('does not breathe when reduced effects are enabled', () => {
    usePlayerStore.setState({ isPlaying: true });
    const props = { onExpand: vi.fn(), reducedEffects: true };

    const { container } = render(<PillMiniPlayer {...props} />);

    expect(container.querySelector('.animate-breathe')).not.toBeInTheDocument();
  });
});
