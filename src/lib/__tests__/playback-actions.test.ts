import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getPlaybackInterventionEpoch } from '../../features/app/playback-generation';
import { usePlayerStore } from '../../store/player-store';
import type { Track } from '../../types';
import {
  crossfadeToSource,
  pauseCurrentPlayback,
  playAdjacentTrack,
  resumeCurrentPlayback,
  seekToPosition,
  startEditorPreview,
  startPlayback,
  stopCurrentPlayback,
  switchAudioOutputDevice,
} from '../playback-actions';

const {
  fetchLibraryTrackByIdMock,
  playTrackMock,
  stopPlaybackMock,
  pausePlaybackMock,
  seekPlaybackMock,
  resumePlaybackMock,
} = vi.hoisted(() => ({
  fetchLibraryTrackByIdMock: vi.fn(async (_id: string): Promise<Track | null> => null),
  playTrackMock: vi.fn(async (_filePath: string, _startPos?: number): Promise<number> => 1),
  stopPlaybackMock: vi.fn(async (): Promise<void> => undefined),
  pausePlaybackMock: vi.fn(async (): Promise<void> => undefined),
  seekPlaybackMock: vi.fn(async (_position: number): Promise<void> => undefined),
  resumePlaybackMock: vi.fn(async (): Promise<void> => undefined),
}));

vi.mock('../../features/library/api', () => ({
  fetchLibraryTrackById: fetchLibraryTrackByIdMock,
}));

vi.mock('../tauri-commands', () => ({
  pausePlayback: pausePlaybackMock,
  playTrack: playTrackMock,
  resumePlayback: resumePlaybackMock,
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
    fetchLibraryTrackByIdMock.mockResolvedValue(null);
    playTrackMock.mockReset();
    playTrackMock.mockResolvedValue(1);
    stopPlaybackMock.mockReset();
    stopPlaybackMock.mockResolvedValue(undefined);
    pausePlaybackMock.mockReset();
    pausePlaybackMock.mockResolvedValue(undefined);
    seekPlaybackMock.mockReset();
    seekPlaybackMock.mockResolvedValue(undefined);
    resumePlaybackMock.mockReset();
    resumePlaybackMock.mockResolvedValue(undefined);
    usePlayerStore.setState(initialPlayerState, true);
  });

  it('hydrates a lazy next entry before passing its real path to native playback', async () => {
    const queue = [
      track('first'),
      track('second', {
        filePath: 'second',
        _lazyQueueEntry: true,
        _queueId: 'queue-second',
      }),
    ];
    const hydrated = track('second', { filePath: '/music/second.mp3' });
    fetchLibraryTrackByIdMock.mockResolvedValueOnce(hydrated);
    usePlayerStore.getState().setQueue(queue);
    usePlayerStore.getState().setQueueIndex(0);
    usePlayerStore.getState().setCurrentTrack(usePlayerStore.getState().queue[0]);

    await expect(playAdjacentTrack('next')).resolves.toMatchObject({ id: 'second' });

    expect(fetchLibraryTrackByIdMock).toHaveBeenCalledWith('second');
    expect(playTrackMock).toHaveBeenCalledWith('/music/second.mp3', undefined);
    expect(usePlayerStore.getState().queue[1]).toMatchObject({
      filePath: '/music/second.mp3',
      _lazyQueueEntry: undefined,
      _queueId: 'queue-second',
    });
    expect(usePlayerStore.getState().queueIndex).toBe(1);
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

  it('rechecks an intervention between command settlement and the UI commit', async () => {
    let finishOlder: (generation: number) => void = () => undefined;
    let finishNewer: (generation: number) => void = () => undefined;
    playTrackMock
      .mockImplementationOnce(
        () =>
          new Promise<number>((resolve) => {
            finishOlder = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<number>((resolve) => {
            finishNewer = resolve;
          }),
      );

    const older = startPlayback(track('older'));
    finishOlder(90);
    await Promise.resolve();
    const newer = startPlayback(track('newer'));
    await older;
    const committedTrack = usePlayerStore.getState().currentTrack;
    finishNewer(91);
    await newer;

    expect(committedTrack).toBeNull();
    expect(usePlayerStore.getState().currentTrack?.id).toBe('newer');
  });

  it('rechecks an intervention before reporting a settled command failure', async () => {
    let failOlder: (error: Error) => void = () => undefined;
    playTrackMock.mockImplementationOnce(
      () =>
        new Promise<number>((_resolve, reject) => {
          failOlder = reject;
        }),
    );

    const older = startPlayback(track('older'));
    failOlder(new Error('Obsolete failure'));
    await Promise.resolve();
    await startPlayback(track('newer'));

    await expect(older).resolves.toBeUndefined();
    expect(usePlayerStore.getState().currentTrack?.id).toBe('newer');
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

  it.each([
    'stop',
    'play',
  ] as const)('cancels queued Next requests after a newer %s intervention', async (intervention) => {
    const queue = [track('first'), track('second'), track('third')];
    usePlayerStore.getState().setQueue(queue);
    usePlayerStore.getState().setQueueIndex(0);
    usePlayerStore.getState().setCurrentTrack(usePlayerStore.getState().queue[0]);

    let finishNext: (generation: number) => void = () => undefined;
    playTrackMock.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          finishNext = resolve;
        }),
    );

    const first = playAdjacentTrack('next');
    const second = playAdjacentTrack('next');
    await Promise.resolve();
    if (intervention === 'stop') {
      await stopCurrentPlayback();
    } else {
      await startPlayback(track('new-selection'));
    }
    finishNext(92);

    await expect(first).resolves.toBeNull();
    await expect(second).resolves.toBeNull();
    expect(playTrackMock).toHaveBeenCalledTimes(intervention === 'stop' ? 1 : 2);
    expect(usePlayerStore.getState().currentTrack?.id).toBe(
      intervention === 'stop' ? 'first' : 'new-selection',
    );
    expect(usePlayerStore.getState().isPlaying).toBe(intervention === 'play');
    expect(usePlayerStore.getState().hasActivePlayback).toBe(intervention === 'play');
  });

  it('cancels an adjacent request superseded before its queued callback starts', async () => {
    usePlayerStore.getState().setQueue([track('first'), track('second')]);
    usePlayerStore.getState().setQueueIndex(0);
    usePlayerStore.getState().setCurrentTrack(usePlayerStore.getState().queue[0]);

    const next = playAdjacentTrack('next');
    await stopCurrentPlayback();

    await expect(next).resolves.toBeNull();
    expect(playTrackMock).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
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

  it.each([
    'start',
    'next',
    'preview',
    'pause',
    'resume',
    'seek',
    'stop',
  ] as const)('ignores a late %s failure after newer playback succeeds', async (action) => {
    usePlayerStore.getState().setQueue([track('first'), track('second')]);
    usePlayerStore.getState().setQueueIndex(0);
    usePlayerStore.getState().setCurrentTrack(usePlayerStore.getState().queue[0]);
    usePlayerStore.getState().setHasActivePlayback(true);

    let failOlder: (error: Error) => void = () => undefined;
    const pending = new Promise<never>((_resolve, reject) => {
      failOlder = reject;
    });
    const operations = {
      start: () => startPlayback(track('older')),
      next: () => playAdjacentTrack('next'),
      preview: () => startEditorPreview('/music/preview.mp3'),
      pause: pauseCurrentPlayback,
      resume: resumeCurrentPlayback,
      seek: () => seekToPosition(75),
      stop: stopCurrentPlayback,
    };
    if (action === 'pause') pausePlaybackMock.mockReturnValueOnce(pending);
    else if (action === 'resume') resumePlaybackMock.mockReturnValueOnce(pending);
    else if (action === 'seek') seekPlaybackMock.mockReturnValueOnce(pending);
    else if (action === 'stop') stopPlaybackMock.mockReturnValueOnce(pending);
    else playTrackMock.mockReturnValueOnce(pending);

    const older = operations[action]();
    await Promise.resolve();
    await startPlayback(track('newer'));
    failOlder(new Error('Superseded decoder/device failure'));

    await expect(older).resolves.not.toThrow();
    expect(usePlayerStore.getState().currentTrack?.id).toBe('newer');
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(usePlayerStore.getState().currentTime).toBe(0);
  });

  it('still reports a current playback failure to its caller', async () => {
    playTrackMock.mockRejectedValueOnce(new Error('File not found'));

    await expect(startPlayback(track('missing'))).rejects.toThrow('File not found');
    expect(usePlayerStore.getState().isPlaying).toBe(false);
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

  it('accepts a new Next after Stop while canceling older queued requests', async () => {
    let finishFirst: (generation: number) => void = () => undefined;
    playTrackMock.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          finishFirst = resolve;
        }),
    );

    const first = playAdjacentTrack('next');
    const staleQueued = playAdjacentTrack('next');
    await Promise.resolve();
    await stopCurrentPlayback();
    const freshNext = playAdjacentTrack('next');
    finishFirst(2);

    await expect(first).resolves.toBeNull();
    await expect(staleQueued).resolves.toBeNull();
    await expect(freshNext).resolves.toMatchObject({ id: 'second' });
    expect(playTrackMock).toHaveBeenCalledTimes(2);
    expect(usePlayerStore.getState().currentTrack?.id).toBe('second');
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });
});
