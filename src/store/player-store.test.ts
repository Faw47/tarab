import { beforeEach, describe, expect, it } from 'vitest';
import type { Track } from '../types';
import { usePlayerStore } from './player-store';

const initialPlayerState = usePlayerStore.getState();

const track = (id: string): Track => ({
  id,
  title: id,
  artist: 'Artist',
  album: 'Album',
  year: 2024,
  duration: 180,
  filePath: `/music/${id}.mp3`,
  hasCoverArt: false,
  coverArtHash: null,
  dateAdded: 1,
});

describe('player-store queue index', () => {
  beforeEach(() => {
    usePlayerStore.setState(initialPlayerState, true);
  });

  it('keeps empty queues at the sentinel index', () => {
    usePlayerStore.getState().setQueueIndex(4);

    expect(usePlayerStore.getState().queueIndex).toBe(-1);
  });

  it('uses the current track when queueIndex is stale', () => {
    const queue = [track('one'), track('two'), track('three')];
    const player = usePlayerStore.getState();

    player.setQueue(queue);
    player.setQueueIndex(0);
    player.setCurrentTrack(queue[2]);

    expect(usePlayerStore.getState().previewNext()?.track.id).toBe('one');
    expect(usePlayerStore.getState().previewPrevious()?.track.id).toBe('two');
  });
});

describe('player-store shuffle passes', () => {
  beforeEach(() => {
    usePlayerStore.setState(initialPlayerState, true);
  });

  const startShuffled = (ids: string[], loopMode: 'off' | 'all' | 'one') => {
    const player = usePlayerStore.getState();
    player.setQueue(ids.map(track));
    player.setLoopMode(loopMode);
    const first = usePlayerStore.getState().queue[0];
    player.setQueueIndex(0);
    player.setCurrentTrack(first);
    player.setShuffleEnabled(true);
  };

  const playAll = (limit: number): string[] => {
    const played: string[] = [];
    for (let i = 0; i < limit; i += 1) {
      const next = usePlayerStore.getState().playNext();
      if (!next) break;
      played.push(next.id);
    }
    return played;
  };

  it('ends after every track played once when repeat is off', () => {
    startShuffled(['a', 'b', 'c'], 'off');

    const played = playAll(20);

    expect(played).toHaveLength(2);
    expect(new Set(['a', ...played])).toEqual(new Set(['a', 'b', 'c']));
    expect(usePlayerStore.getState().previewNext()).toBeNull();
  });

  it('plays a long queue without repeats, beyond the recent-history size', () => {
    const ids = Array.from({ length: 120 }, (_, index) => `t${index}`);
    startShuffled(ids, 'off');

    const played = playAll(500);

    expect(played).toHaveLength(119);
    expect(new Set(played).size).toBe(119);
    expect(played).not.toContain('t0');
  });

  it('plays duplicated queue entries once each', () => {
    startShuffled(['a', 'b', 'a'], 'off');

    expect(playAll(10)).toHaveLength(2);
  });

  it('starts a new pass with repeat all', () => {
    startShuffled(['a', 'b', 'c'], 'all');

    const played = playAll(9);

    expect(played).toHaveLength(9);
    expect(new Set(played.slice(0, 2))).toEqual(new Set(['b', 'c']));
  });

  it('goes back through the shuffle order on Previous', () => {
    startShuffled(['a', 'b', 'c', 'd', 'e'], 'off');
    const played = ['a', ...playAll(2)];

    const previous = usePlayerStore.getState().previewPrevious();

    expect(previous).toMatchObject({ restartCurrent: false });
    expect(previous?.track.id).toBe(played[1]);
    usePlayerStore.getState().playPrevious();
    expect(usePlayerStore.getState().previewPrevious()?.track.id).toBe('a');
  });

  it('keeps the pass when going back from the last track of a complete pass', () => {
    startShuffled(['a', 'b', 'c'], 'off');
    const played = ['a', ...playAll(5)];
    expect(played).toHaveLength(3);

    usePlayerStore.getState().playPrevious();
    expect(usePlayerStore.getState().currentTrack?.id).toBe(played[1]);
    expect(usePlayerStore.getState().previewPrevious()?.track.id).toBe('a');
    usePlayerStore.getState().playNext();
    expect(usePlayerStore.getState().previewNext()).toBeNull();
  });

  it('keeps the pass when Repeat One replays a track reached with Previous', () => {
    startShuffled(['a', 'b', 'c'], 'off');
    const played = ['a', ...playAll(5)];
    usePlayerStore.getState().playPrevious();
    usePlayerStore.getState().setLoopMode('one');

    // The automatic Repeat One advance activates the same entry again.
    usePlayerStore.getState().playNext();

    expect(usePlayerStore.getState().currentTrack?.id).toBe(played[1]);
    expect(usePlayerStore.getState().previewPrevious()?.track.id).toBe('a');
  });

  it('plays several Play Next tracks in list order while shuffling', () => {
    startShuffled(['a', 'b', 'c', 'd', 'e'], 'off');
    // The context menu inserts a selection in reverse, each right after the current track.
    for (const id of ['z', 'y', 'x']) usePlayerStore.getState().addToQueue(track(id), 'next');

    expect(playAll(3)).toEqual(['x', 'y', 'z']);
  });

  it('clears a playback error when another entry is activated', () => {
    startShuffled(['a', 'b'], 'all');
    usePlayerStore.getState().setPlaybackError({
      generation: 1,
      filePath: '/music/a.mp3',
      stage: 'decode',
      message: 'bad',
      recoverable: false,
    });

    usePlayerStore.getState().activateTrackAtIndex(1);

    expect(usePlayerStore.getState().playbackError).toBeNull();
  });

  it('plays a Play Next track next while shuffling', () => {
    startShuffled(['a', 'b', 'c', 'd', 'e'], 'off');
    usePlayerStore.getState().addToQueue(track('urgent'), 'next');

    expect(usePlayerStore.getState().previewNext()?.track.id).toBe('urgent');
    usePlayerStore.getState().playNext();
    expect(usePlayerStore.getState().previewNext()?.track.id).not.toBe('urgent');
  });

  it('repeats one track automatically but moves on for a user Next', () => {
    const player = usePlayerStore.getState();
    player.setQueue([track('a'), track('b')]);
    player.setQueueIndex(0);
    player.setCurrentTrack(usePlayerStore.getState().queue[0]);
    player.setLoopMode('one');

    expect(usePlayerStore.getState().previewNext()?.track.id).toBe('a');
    expect(usePlayerStore.getState().previewNext({ ignoreRepeatOne: true })?.track.id).toBe('b');
  });

  it('restores a cleared queue for undo, but not over a newer queue', () => {
    // Regression for FE-20: Clear queue had no confirmation or undo.
    const queue = [track('a'), track('b'), track('c')];
    usePlayerStore.setState({ queue, queueIndex: 1, currentTrack: queue[1] });
    const snapshot = { queue, queueIndex: 1, shufflePass: [], shufflePriority: [] };

    usePlayerStore.getState().clearQueue();
    expect(usePlayerStore.getState().queue).toHaveLength(0);
    expect(usePlayerStore.getState().restoreQueue(snapshot)).toBe(true);
    expect(usePlayerStore.getState().queue.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(usePlayerStore.getState().queueIndex).toBe(1);

    usePlayerStore.getState().clearQueue();
    usePlayerStore.setState({ queue: [track('z')], queueIndex: 0 });
    expect(usePlayerStore.getState().restoreQueue(snapshot)).toBe(false);
    expect(usePlayerStore.getState().queue.map((entry) => entry.id)).toEqual(['z']);
  });
});
