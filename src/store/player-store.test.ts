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
