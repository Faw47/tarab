import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../../store/player-store';
import type { Track } from '../../../types';
import { appendShuffleQueue } from '../appendShuffleQueue';

const { fetchLibraryTracksByIdsMock } = vi.hoisted(() => ({
  fetchLibraryTracksByIdsMock: vi.fn(),
}));

vi.mock('../api', () => ({
  fetchLibraryTracksByIds: fetchLibraryTracksByIdsMock,
}));

const makeTrack = (id: string): Track => ({
  id,
  title: id,
  artist: 'Artist',
  album: 'Album',
  year: null,
  duration: 180,
  filePath: `/${id}.mp3`,
  hasCoverArt: false,
  coverArtHash: null,
  dateAdded: 1,
});

describe('appendShuffleQueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlayerStore.setState({ currentTrack: null, queue: [], queueIndex: -1, queueVersion: 0 });
  });

  it('appends metadata in order and reports completion', async () => {
    const first = makeTrack('first');
    const second = makeTrack('second');
    usePlayerStore.setState({
      currentTrack: first,
      queue: [first],
      queueIndex: 0,
      queueVersion: 4,
    });
    fetchLibraryTracksByIdsMock.mockResolvedValue([second]);
    const progress: number[] = [];

    const result = await appendShuffleQueue({
      orderedIds: [first.id, second.id],
      firstTrack: first,
      addToQueue: usePlayerStore.getState().addToQueue,
      onProgress: (value) => progress.push(value),
    });

    expect(result).toEqual({ cancelled: false, appended: 1 });
    expect(usePlayerStore.getState().queue.map((track) => track.id)).toEqual(['first', 'second']);
    expect(progress).toEqual([100]);
    expect(fetchLibraryTracksByIdsMock).toHaveBeenCalledWith(['second']);
  });

  it('appends a hydrated metadata batch with one queue mutation', async () => {
    const first = makeTrack('first');
    const second = makeTrack('second');
    const third = makeTrack('third');
    usePlayerStore.setState({
      currentTrack: first,
      queue: [first],
      queueIndex: 0,
      queueVersion: 4,
    });
    fetchLibraryTracksByIdsMock.mockResolvedValue([third, second]);
    const addTracksToQueue = vi.fn((tracks: Track[]) =>
      usePlayerStore.getState().addTracksToQueue(tracks),
    );
    const addToQueue = vi.fn();

    const result = await appendShuffleQueue({
      orderedIds: [first.id, second.id, third.id],
      firstTrack: first,
      addToQueue,
      addTracksToQueue,
    });

    expect(result).toEqual({ cancelled: false, appended: 2 });
    expect(addTracksToQueue).toHaveBeenCalledWith([second, third]);
    expect(addToQueue).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().queue.map((track) => track.id)).toEqual([
      'first',
      'second',
      'third',
    ]);
    expect(usePlayerStore.getState().queueVersion).toBe(5);
  });

  it('cancels before appending when playback changes during a fetch', async () => {
    const first = makeTrack('first');
    const second = makeTrack('second');
    const other = makeTrack('other');
    usePlayerStore.setState({
      currentTrack: first,
      queue: [first],
      queueIndex: 0,
      queueVersion: 4,
    });
    fetchLibraryTracksByIdsMock.mockImplementation(async () => {
      usePlayerStore.setState({ currentTrack: other });
      return [second];
    });

    const result = await appendShuffleQueue({
      orderedIds: [first.id, second.id],
      firstTrack: first,
      addToQueue: usePlayerStore.getState().addToQueue,
    });

    expect(result).toEqual({ cancelled: true, appended: 0 });
    expect(usePlayerStore.getState().queue.map((track) => track.id)).toEqual(['first']);
  });
  it('cancels when a duplicate queue occurrence becomes active during a fetch', async () => {
    const first = { ...makeTrack('first'), _queueId: 'first-occurrence' };
    const duplicate = { ...makeTrack('first'), _queueId: 'duplicate-occurrence' };
    const second = makeTrack('second');
    usePlayerStore.setState({
      currentTrack: first,
      queue: [first, duplicate],
      queueIndex: 0,
      queueVersion: 4,
    });
    fetchLibraryTracksByIdsMock.mockImplementation(async () => {
      usePlayerStore.setState({ currentTrack: duplicate, queueIndex: 1 });
      return [second];
    });

    const result = await appendShuffleQueue({
      orderedIds: [first.id, second.id],
      firstTrack: first,
      addToQueue: usePlayerStore.getState().addToQueue,
    });

    expect(result).toEqual({ cancelled: true, appended: 0 });
    expect(usePlayerStore.getState().queue.map((track) => track.id)).toEqual(['first', 'first']);
  });
});
