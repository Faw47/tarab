import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { startPlayback } from '../../../lib/playback-actions';
import { usePlayerStore } from '../../../store/player-store';
import { useSettingsStore } from '../../../store/settings-store';
import type { Track } from '../../../types';
import { QueueView } from '../QueueView';

vi.mock('../../shared/CoverArtImage', () => ({ CoverArtImage: () => null }));
vi.mock('../../../lib/playback-actions', () => ({
  startPlayback: vi.fn(async () => undefined),
  toggleCurrentPlayback: vi.fn(async () => undefined),
}));

const makeTrack = (id: string, queueId = id): Track => ({
  id,
  _queueId: queueId,
  filePath: `/music/${id}.mp3`,
  title: id,
  artist: 'Artist',
  album: 'Album',
  year: 2026,
  duration: 60,
  hasCoverArt: false,
  dateAdded: 0,
});

describe.each(['liquid-glass', 'neobrutalism'] as const)('queue History controls (%s)', (theme) => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ theme });
    usePlayerStore.setState({
      queue: [],
      queueIndex: -1,
      currentTrack: null,
      isPlaying: false,
      shuffleEnabled: false,
      shufflePass: [],
      shufflePriority: [],
    });
  });

  for (const scenario of ['middle', 'last', 'duplicate'] as const) {
    const prepare = () => {
      const first = makeTrack('first');
      const predecessor = makeTrack('predecessor');
      const playing = makeTrack('playing', 'playing-entry');
      const successor =
        scenario === 'duplicate' ? makeTrack('playing', 'other-entry') : makeTrack('successor');
      const queue =
        scenario === 'last'
          ? [first, predecessor, playing]
          : [first, predecessor, playing, successor];
      usePlayerStore.setState({ queue, queueIndex: 2, currentTrack: playing });
      usePlayerStore.getState().removeFromQueue(2);
      render(<QueueView />);
      return { first, predecessor, playing, successor };
    };

    it(`replays the displayed predecessor after removing the ${scenario} playing entry`, () => {
      const { predecessor } = prepare();
      fireEvent.click(screen.getByRole('button', { name: 'Replay predecessor' }));
      expect(startPlayback).toHaveBeenCalledWith(predecessor, {
        queue: usePlayerStore.getState().queue,
        queueIndex: 1,
      });
    });

    it(`removes the displayed predecessor after removing the ${scenario} playing entry`, () => {
      const { first, playing, successor } = prepare();
      const row = screen.getByRole('button', { name: 'Replay predecessor' }).closest('article');
      expect(row).not.toBeNull();
      fireEvent.click(within(row!).getByRole('button', { name: 'Remove from queue history' }));
      expect(usePlayerStore.getState().queue.map((track) => track._queueId)).toEqual(
        scenario === 'last' ? [first._queueId] : [first._queueId, successor._queueId],
      );
      expect(usePlayerStore.getState().currentTrack).toBe(playing);
      expect(startPlayback).not.toHaveBeenCalled();
    });
  }

  it('replays the selected duplicate History entry at its own index', () => {
    const first = makeTrack('repeated', 'first-copy');
    const second = makeTrack('repeated', 'second-copy');
    const playing = makeTrack('playing');
    usePlayerStore.setState({
      queue: [first, second, playing],
      queueIndex: 2,
      currentTrack: playing,
    });
    usePlayerStore.getState().removeFromQueue(2);
    render(<QueueView />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Replay repeated' })[0]);
    expect(startPlayback).toHaveBeenCalledWith(second, { queue: [first, second], queueIndex: 1 });
  });

  it('removes the selected duplicate History entry without removing its other copy', () => {
    const first = makeTrack('repeated', 'first-copy');
    const second = makeTrack('repeated', 'second-copy');
    const playing = makeTrack('playing');
    usePlayerStore.setState({
      queue: [first, second, playing],
      queueIndex: 2,
      currentTrack: playing,
    });
    usePlayerStore.getState().removeFromQueue(2);
    render(<QueueView />);
    const row = screen.getAllByRole('button', { name: 'Replay repeated' })[0].closest('article');
    expect(row).not.toBeNull();
    fireEvent.click(within(row!).getByRole('button', { name: 'Remove from queue history' }));
    expect(usePlayerStore.getState().queue).toEqual([first]);
    expect(usePlayerStore.getState().currentTrack).toBe(playing);
  });

  it('counts all History entries after removing the playing entry', () => {
    const queue = [makeTrack('first'), makeTrack('second'), makeTrack('playing')];
    usePlayerStore.setState({ queue, queueIndex: 2, currentTrack: queue[2] });
    usePlayerStore.getState().removeFromQueue(2);
    render(<QueueView />);
    const label = screen.getAllByText('Played')[0];
    const summary =
      theme === 'neobrutalism' ? label.parentElement?.parentElement : label.parentElement;
    expect(summary).not.toBeNull();
    expect(within(summary!).getByText(theme === 'neobrutalism' ? '2' : '2 tracks')).toBeVisible();
  });

  it('replays the current queue predecessor at its own index', () => {
    const queue = [makeTrack('first'), makeTrack('current'), makeTrack('next')];
    usePlayerStore.setState({ queue, queueIndex: 1, currentTrack: queue[1] });
    render(<QueueView />);
    fireEvent.click(screen.getByRole('button', { name: 'Replay first' }));
    expect(startPlayback).toHaveBeenCalledWith(queue[0], { queue, queueIndex: 0 });
  });
});
