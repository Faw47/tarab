import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlaybackInterventionEpoch } from '../../features/app/playback-generation';
import { usePlayerStore } from '../../store/player-store';
import type { Track } from '../../types';
import {
  crossfadeToSource,
  pauseCurrentPlayback,
  playAdjacentTrack,
  seekToPosition,
  startEditorPreview,
  startPlayback,
  stopCurrentPlayback,
  switchAudioOutputDevice,
} from '../playback-actions';

const { playTrackMock, stopPlaybackMock, pausePlaybackMock, seekPlaybackMock } = vi.hoisted(() => ({
  playTrackMock: vi.fn(async (_filePath: string, _startPos?: number): Promise<number> => 1),
  stopPlaybackMock: vi.fn(async (): Promise<void> => undefined),
  pausePlaybackMock: vi.fn(async (): Promise<void> => undefined),
  seekPlaybackMock: vi.fn(async (_position: number): Promise<void> => undefined),
}));

vi.mock('../tauri-commands', () => ({
  pausePlayback: pausePlaybackMock,
  playTrack: playTrackMock,
  resumePlayback: vi.fn(async () => undefined),
  seekPlayback: seekPlaybackMock,
  stopPlayback: stopPlaybackMock,
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
    playTrackMock.mockReset();
    playTrackMock.mockResolvedValue(1);
    stopPlaybackMock.mockReset();
    stopPlaybackMock.mockResolvedValue(undefined);
    pausePlaybackMock.mockReset();
    pausePlaybackMock.mockResolvedValue(undefined);
    seekPlaybackMock.mockReset();
    seekPlaybackMock.mockResolvedValue(undefined);
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

describe('overlapping source requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    playTrackMock.mockReset();
    playTrackMock.mockResolvedValue(1);
    stopPlaybackMock.mockReset();
    stopPlaybackMock.mockResolvedValue(undefined);
    pausePlaybackMock.mockReset();
    pausePlaybackMock.mockResolvedValue(undefined);
    seekPlaybackMock.mockReset();
    seekPlaybackMock.mockResolvedValue(undefined);
    usePlayerStore.setState(initialPlayerState, true);
  });

  it('keeps the newer track when an earlier start completes late', async () => {
    let resolveOlder: (generation: number) => void = () => undefined;
    playTrackMock.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          resolveOlder = resolve;
        }),
    );
    playTrackMock.mockResolvedValueOnce(91);

    const older = startPlayback(track('older'));
    await startPlayback(track('newer'));
    resolveOlder(90);
    await older;

    expect(usePlayerStore.getState().currentTrack?.id).toBe('newer');
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  it('does not overwrite a newer selected track when a Next request completes late', async () => {
    const queue = [track('first'), track('second'), track('third')];
    usePlayerStore.getState().setQueue(queue);
    usePlayerStore.getState().setQueueIndex(0);
    usePlayerStore.getState().setCurrentTrack(usePlayerStore.getState().queue[0]);

    let resolveNext: (generation: number) => void = () => undefined;
    playTrackMock.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          resolveNext = resolve;
        }),
    );
    playTrackMock.mockResolvedValueOnce(93);

    const next = playAdjacentTrack('next');
    await Promise.resolve();
    await startPlayback(track('new-selection'));
    resolveNext(92);
    await expect(next).resolves.toBeNull();

    expect(usePlayerStore.getState().currentTrack?.id).toBe('new-selection');
    expect(usePlayerStore.getState().queueIndex).toBe(0);
  });

  it('does not reset a newer track when an editor preview finishes late', async () => {
    let finishPreview: (generation: number) => void = () => undefined;
    playTrackMock.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          finishPreview = resolve;
        }),
    );

    const preview = startEditorPreview('/music/preview.mp3');
    await startPlayback(track('newer'));
    finishPreview(8);
    await preview;

    expect(usePlayerStore.getState().currentTrack?.id).toBe('newer');
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  it('does not commit a stale seek position after selecting another track', async () => {
    let finishSeek: () => void = () => undefined;
    seekPlaybackMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSeek = resolve;
        }),
    );

    const seek = seekToPosition(75);
    await startPlayback(track('newer'));
    finishSeek();
    await seek;

    expect(usePlayerStore.getState().currentTime).toBe(0);
  });

  it('does not pause a newer source when a previous pause resolves late', async () => {
    let finishPause: () => void = () => undefined;
    pausePlaybackMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishPause = resolve;
        }),
    );

    const pause = pauseCurrentPlayback();
    await startPlayback(track('newer'));
    finishPause();
    await pause;

    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  it('does not mark newer playback stopped when an older stop completes late', async () => {
    let finishStop: () => void = () => undefined;
    stopPlaybackMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishStop = resolve;
        }),
    );

    const oldStop = stopCurrentPlayback();
    await startPlayback(track('newer'));
    finishStop();
    await oldStop;

    expect(usePlayerStore.getState().currentTrack?.id).toBe('newer');
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(usePlayerStore.getState().hasActivePlayback).toBe(true);
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
    playTrackMock.mockReset();
    playTrackMock.mockResolvedValue(1);
    stopPlaybackMock.mockReset();
    stopPlaybackMock.mockResolvedValue(undefined);
    pausePlaybackMock.mockReset();
    pausePlaybackMock.mockResolvedValue(undefined);
    seekPlaybackMock.mockReset();
    seekPlaybackMock.mockResolvedValue(undefined);
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
        new Promise<number>((resolve) => {
          finishFirst = () => resolve(2);
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
