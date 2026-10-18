import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlaybackInterventionEpoch } from '../../features/app/playback-generation';
import { usePlayerStore } from '../../store/player-store';
import type { Track } from '../../types';
import {
  crossfadeToSource,
  playAdjacentTrack,
  seekToPosition,
  startPlayback,
  stopCurrentPlayback,
  switchAudioOutputDevice,
} from '../playback-actions';

const { playTrackMock } = vi.hoisted(() => ({
  playTrackMock: vi.fn(async () => undefined),
}));

vi.mock('../tauri-commands', () => ({
  pausePlayback: vi.fn(async () => undefined),
  playTrack: playTrackMock,
  resumePlayback: vi.fn(async () => undefined),
  seekPlayback: vi.fn(async () => undefined),
  stopPlayback: vi.fn(async () => undefined),
  setAudioOutputDevice: vi.fn(async () => undefined),
  crossfadeToTrack: vi.fn(async () => 2),
}));

const initialPlayerState = usePlayerStore.getState();

const track = (id: string, overrides: Partial<Track> = {}): Track => ({
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
  ...overrides,
});

describe('startPlayback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlayerStore.setState(initialPlayerState, true);
  });

  it('can replace the queue and explicitly disable shuffle for plain album play', async () => {
    usePlayerStore.setState({ shuffleEnabled: true, shuffleHistory: ['old-track'] });
    const queue = [
      track('first', { trackNumber: 1 }),
      track('second', { trackNumber: 2 }),
      track('third', { trackNumber: 3 }),
    ];

    await startPlayback(queue[0], { queue, queueIndex: 0, shuffleEnabled: false });

    const state = usePlayerStore.getState();
    expect(playTrackMock).toHaveBeenCalledWith('/music/first.mp3', undefined);
    expect(state.currentTrack?.id).toBe('first');
    expect(state.queue.map((item) => item.id)).toEqual(['first', 'second', 'third']);
    expect(state.queueIndex).toBe(0);
    expect(state.shuffleEnabled).toBe(false);
  });
});

describe('playback interventions', () => {
  it('marks commands that replace or stop the source, not seeks, device switches or crossfades', async () => {
    const before = getPlaybackInterventionEpoch();
    await startPlayback(track('first'));
    await stopCurrentPlayback();
    expect(getPlaybackInterventionEpoch()).toBe(before + 2);

    // These apply to the incoming source of a crossfade the backend already started.
    await seekToPosition(30);
    await switchAudioOutputDevice('Speakers');
    await crossfadeToSource('/music/next.mp3', 4);
    expect(getPlaybackInterventionEpoch()).toBe(before + 2);
  });
});

describe('adjacent track transitions (PB-28)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePlayerStore.setState(initialPlayerState, true);

    const queue = [track('first'), track('second'), track('third')];
    usePlayerStore.getState().setQueue(queue);
    usePlayerStore.getState().setQueueIndex(0);
    usePlayerStore.getState().setCurrentTrack(usePlayerStore.getState().queue[0]);
  });

  it('advances twice when Next is pressed before the first track finishes loading', async () => {
    let finishFirst: () => void = () => undefined;
    playTrackMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = () => resolve();
        }),
    );

    const first = playAdjacentTrack('next');
    const second = playAdjacentTrack('next');
    await Promise.resolve();

    expect(playTrackMock).toHaveBeenCalledTimes(1);
    expect(playTrackMock).toHaveBeenCalledWith('/music/second.mp3');
    expect(usePlayerStore.getState().queueIndex).toBe(0);

    finishFirst();
    await Promise.all([first, second]);

    expect(playTrackMock.mock.calls.map(([path]) => path)).toEqual([
      '/music/second.mp3',
      '/music/third.mp3',
    ]);
    expect(usePlayerStore.getState().queueIndex).toBe(2);
    expect(usePlayerStore.getState().currentTrack?.id).toBe('third');
  });

  it('still processes the next request after an adjacent playback failure', async () => {
    playTrackMock.mockRejectedValueOnce(new Error('decoder unavailable'));

    const first = playAdjacentTrack('next');
    const second = playAdjacentTrack('next');

    await expect(first).rejects.toThrow('decoder unavailable');
    await expect(second).resolves.toMatchObject({ id: 'second' });
    expect(playTrackMock).toHaveBeenCalledTimes(2);
    expect(usePlayerStore.getState().queueIndex).toBe(1);
  });
});
