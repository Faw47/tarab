import { beforeEach, describe, expect, it } from 'vitest';
import type { Track } from '../types';
import { resolveQueueTrackIndex, usePlayerStore } from './player-store';

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

  it('resolves a stale queue index by queue occurrence instead of duplicate track identity', () => {
    const first = track('duplicate');
    const middle = track('middle');
    const second = track('duplicate');
    const tail = track('tail');
    first._queueId = 'duplicate-first';
    second._queueId = 'duplicate-second';
    middle._queueId = 'middle';
    tail._queueId = 'tail';
    usePlayerStore.setState({
      queue: [first, middle, second, tail],
      queueIndex: 0,
      currentTrack: second,
      loopMode: 'all',
    });

    expect(usePlayerStore.getState().previewNext(false)?.track._queueId).toBe('tail');
    expect(usePlayerStore.getState().previewPrevious()?.track._queueId).toBe('middle');
  });

  it('does not fall back to another duplicate when the active queue occurrence is gone', () => {
    const queued = { ...track('duplicate'), _queueId: 'still-queued' };
    const removed = { ...track('duplicate'), _queueId: 'removed-occurrence' };
    usePlayerStore.setState({ queue: [queued], queueIndex: 0, currentTrack: removed });

    expect(usePlayerStore.getState().previewNext()).toBeNull();
    expect(usePlayerStore.getState().previewPrevious()).toBeNull();
  });

  it('assigns a new queue id when an existing occurrence is queued again', () => {
    const occurrence = { ...track('duplicate'), _queueId: 'existing-occurrence' };
    const player = usePlayerStore.getState();
    player.setQueue([occurrence]);
    player.addToQueue(usePlayerStore.getState().queue[0]);

    const queueIds = usePlayerStore.getState().queue.map((item) => item._queueId);
    expect(queueIds[0]).toBe('existing-occurrence');
    expect(queueIds[1]).not.toBe(queueIds[0]);
  });

  it('resolves failed-track removal by queue occurrence instead of duplicate id', () => {
    const first = { ...track('duplicate'), _queueId: 'first-occurrence' };
    const failed = { ...track('duplicate'), _queueId: 'failed-occurrence' };
    const third = { ...track('duplicate'), _queueId: 'third-occurrence' };

    expect(resolveQueueTrackIndex([first, failed, third], failed)).toBe(1);
    expect(resolveQueueTrackIndex([first, third], failed)).toBe(-1);
  });
  it('appends multiple tracks in one queue mutation', () => {
    const player = usePlayerStore.getState();
    player.setQueue([track('first')]);
    player.setQueueIndex(0);
    const versionBefore = usePlayerStore.getState().queueVersion;

    player.addTracksToQueue([track('second'), track('third')]);

    const state = usePlayerStore.getState();
    expect(state.queue.map((item) => item.id)).toEqual(['first', 'second', 'third']);
    expect(state.queueVersion).toBe(versionBefore + 1);
    expect(new Set(state.queue.map((item) => item._queueId)).size).toBe(3);
  });

  it('does not treat an unrelated queue item as active', () => {
    const queue = [track('one'), track('two')];
    const player = usePlayerStore.getState();
    player.setQueue(queue);
    player.setCurrentTrack(track('outside'));
    player.setQueueIndex(-1);

    expect(usePlayerStore.getState().queueIndex).toBe(-1);
    expect(usePlayerStore.getState().previewNext()).toBeNull();
    expect(usePlayerStore.getState().previewPrevious()).toBeNull();
  });

  it('stops shuffled playback after unseen tracks are exhausted when repeat is off', () => {
    const queue = [track('one'), track('two')];
    usePlayerStore.setState({
      queue,
      queueIndex: 1,
      currentTrack: queue[1],
      shuffleEnabled: true,
      shuffleHistory: ['one', 'two'],
      loopMode: 'off',
    });

    expect(usePlayerStore.getState().previewNext()).toBeNull();
  });

  it('lets explicit next escape repeat-one mode', () => {
    const queue = [track('one'), track('two')];
    usePlayerStore.setState({ queue, queueIndex: 0, currentTrack: queue[0], loopMode: 'one' });

    expect(usePlayerStore.getState().previewNext()?.track.id).toBe('one');
    expect(usePlayerStore.getState().previewNext(false)?.track.id).toBe('two');
    expect(usePlayerStore.getState().playNext()?.id).toBe('two');
  });

  it('walks actual playback history when going previous under shuffle', () => {
    const first = { ...track('first'), _queueId: 'first-occurrence' };
    const second = { ...track('second'), _queueId: 'second-occurrence' };
    const third = { ...track('third'), _queueId: 'third-occurrence' };
    usePlayerStore.setState({
      queue: [first, second, third],
      queueIndex: 1,
      currentTrack: second,
      currentTime: 0,
      shuffleEnabled: true,
      shuffleHistory: [first._queueId, third._queueId, second._queueId],
    });

    expect(usePlayerStore.getState().previewPrevious()?.track._queueId).toBe(third._queueId);
    expect(usePlayerStore.getState().playPrevious()?._queueId).toBe(third._queueId);
    expect(usePlayerStore.getState().shuffleHistory).toEqual([first._queueId, third._queueId]);

    expect(usePlayerStore.getState().playPrevious()?._queueId).toBe(first._queueId);
    expect(usePlayerStore.getState().shuffleHistory).toEqual([first._queueId]);
  });
});
