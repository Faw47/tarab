import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getActivePlaybackGeneration,
  resetPlaybackGenerationForTests,
  setActivePlaybackGeneration,
} from '../../features/app/playback-generation';
import { usePlayerStore } from '../../store/player-store';
import type { Track } from '../../types';
import {
  captureActivePlaybackSource,
  playAdjacentTrack,
  seekToPosition,
  startEditorPreview,
  startPlayback,
  stopCurrentPlayback,
  subscribeGaplessCancellation,
  switchAudioOutputDevice,
  toggleCurrentPlayback,
} from '../playback-actions';
import type { AudioOutputSwitchOutcome, SeekPlaybackOutcome } from '../tauri-commands';

const {
  pausePlaybackMock,
  playTrackMock,
  resumePlaybackMock,
  seekPlaybackMock,
  setAudioOutputDeviceMock,
  stopPlaybackMock,
} = vi.hoisted(() => ({
  pausePlaybackMock: vi.fn(async (): Promise<void> => undefined),
  playTrackMock: vi.fn(async (): Promise<number> => 1),
  resumePlaybackMock: vi.fn(async (): Promise<void> => undefined),
  seekPlaybackMock: vi.fn(
    async (): Promise<SeekPlaybackOutcome> => ({
      status: 'applied' as const,
      position: 0,
      gaplessCancellation: null,
    }),
  ),
  setAudioOutputDeviceMock: vi.fn(
    async (deviceId: string): Promise<AudioOutputSwitchOutcome> => ({
      selection: { status: 'selected' as const, deviceId },
      gaplessCancellation: null,
    }),
  ),
  stopPlaybackMock: vi.fn(async () => 2),
}));

vi.mock('../tauri-commands', () => ({
  pausePlayback: pausePlaybackMock,
  playTrack: playTrackMock,
  resumePlayback: resumePlaybackMock,
  seekPlayback: seekPlaybackMock,
  setAudioOutputDevice: setAudioOutputDeviceMock,
  stopPlayback: stopPlaybackMock,
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
    pausePlaybackMock.mockResolvedValue(undefined);
    playTrackMock.mockResolvedValue(1);
    resumePlaybackMock.mockResolvedValue(undefined);
    stopPlaybackMock.mockResolvedValue(2);
    seekPlaybackMock.mockResolvedValue({
      status: 'applied',
      position: 0,
      gaplessCancellation: null,
    });
    setAudioOutputDeviceMock.mockImplementation(async (deviceId: string) => ({
      selection: { status: 'selected' as const, deviceId },
      gaplessCancellation: null,
    }));
    resetPlaybackGenerationForTests();
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

  it('detaches one-off playback from an unrelated queue', async () => {
    const queued = [track('first'), track('second')];
    const player = usePlayerStore.getState();
    player.setQueue(queued);
    player.setQueueIndex(0);
    player.setCurrentTrack(queued[0]);

    await startPlayback(track('outside'));

    const state = usePlayerStore.getState();
    expect(state.currentTrack?.id).toBe('outside');
    expect(state.queueIndex).toBe(-1);
    expect(state.previewNext()).toBeNull();
  });

  it('passes an opaque Play Once authority to exactly the requested playback command', async () => {
    await startPlayback(track('outside'), { authorityId: 'authority-1' });

    expect(playTrackMock).toHaveBeenCalledWith('/music/outside.mp3', undefined, 'authority-1');
  });

  it('updates source identity for editor previews', async () => {
    const preview = track('editor-preview');

    await startEditorPreview(preview);

    expect(usePlayerStore.getState()).toMatchObject({
      currentTrack: preview,
      currentTime: 0,
      isPlaying: true,
      hasActivePlayback: true,
    });
  });

  it('serializes rapid toggles against the state committed by the prior toggle', async () => {
    const current = track('current');
    usePlayerStore.setState({
      currentTrack: current,
      currentTime: 0,
      duration: current.duration,
      isPlaying: true,
      hasActivePlayback: true,
    });

    let finishPause!: () => void;
    pausePlaybackMock.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishPause = resolve;
        }),
    );

    const firstToggle = toggleCurrentPlayback();
    const secondToggle = toggleCurrentPlayback();
    await vi.waitFor(() => expect(pausePlaybackMock).toHaveBeenCalledTimes(1));
    expect(resumePlaybackMock).not.toHaveBeenCalled();

    finishPause();
    await Promise.all([firstToggle, secondToggle]);

    expect(pausePlaybackMock).toHaveBeenCalledTimes(1);
    expect(resumePlaybackMock).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });
  it('serializes concurrent source intents and commits them in command order', async () => {
    let resolveFirst!: (generation: number) => void;
    let resolveSecond!: (generation: number) => void;
    playTrackMock
      .mockImplementationOnce(
        () =>
          new Promise<number>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<number>((resolve) => {
            resolveSecond = resolve;
          }),
      );

    const first = startPlayback(track('first'));
    const second = startPlayback(track('second'));
    await vi.waitFor(() => expect(playTrackMock).toHaveBeenCalledTimes(1));

    resolveFirst(1);
    await vi.waitFor(() => expect(playTrackMock).toHaveBeenCalledTimes(2));
    expect(usePlayerStore.getState().currentTrack?.id).toBe('first');

    resolveSecond(2);
    await Promise.all([first, second]);
    expect(usePlayerStore.getState().currentTrack?.id).toBe('second');
  });

  it('selects an adjacent track only after an earlier queue replacement commits', async () => {
    let resolveStart!: (generation: number) => void;
    playTrackMock
      .mockImplementationOnce(
        () =>
          new Promise<number>((resolve) => {
            resolveStart = resolve;
          }),
      )
      .mockResolvedValueOnce(2);
    const queue = [track('first'), track('second')];

    const start = startPlayback(queue[0], { queue, queueIndex: 0 });
    const next = playAdjacentTrack('next');
    await vi.waitFor(() => expect(playTrackMock).toHaveBeenCalledTimes(1));
    resolveStart(1);

    await expect(next).resolves.toMatchObject({ id: 'second' });
    await start;
    expect(playTrackMock).toHaveBeenNthCalledWith(2, '/music/second.mp3');
    expect(usePlayerStore.getState().currentTrack?.id).toBe('second');
  });

  it('resolves the selected duplicate by queue id after the queue is reordered in flight', async () => {
    let resolvePlay!: (generation: number) => void;
    playTrackMock.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          resolvePlay = resolve;
        }),
    );
    const current = track('current', { _queueId: 'current-occurrence' });
    const selected = track('duplicate', { _queueId: 'selected-occurrence' });
    const other = track('duplicate', { _queueId: 'other-occurrence' });
    const player = usePlayerStore.getState();
    player.setQueue([current, selected, other]);
    player.setQueueIndex(0);
    player.setCurrentTrack(usePlayerStore.getState().queue[0]);

    const next = playAdjacentTrack('next');
    await vi.waitFor(() => expect(playTrackMock).toHaveBeenCalledTimes(1));
    usePlayerStore.getState().reorderQueue(1, 2);
    resolvePlay(2);
    await next;

    expect(usePlayerStore.getState().currentTrack?._queueId).toBe('selected-occurrence');
    expect(usePlayerStore.getState().queueIndex).toBe(2);
  });

  it('makes explicit next escape repeat-one mode', async () => {
    const queue = [track('first'), track('second')];
    usePlayerStore.setState({
      queue,
      queueIndex: 0,
      currentTrack: queue[0],
      loopMode: 'one',
    });

    await expect(playAdjacentTrack('next')).resolves.toMatchObject({ id: 'second' });
    expect(playTrackMock).toHaveBeenCalledWith('/music/second.mp3');
  });

  it('uses shuffle playback history for consecutive previous actions', async () => {
    const first = track('first', { _queueId: 'first-occurrence' });
    const second = track('second', { _queueId: 'second-occurrence' });
    const third = track('third', { _queueId: 'third-occurrence' });
    usePlayerStore.setState({
      queue: [first, second, third],
      queueIndex: 1,
      currentTrack: second,
      currentTime: 0,
      shuffleEnabled: true,
      shuffleHistory: [first._queueId!, third._queueId!, second._queueId!],
    });

    await expect(playAdjacentTrack('previous')).resolves.toMatchObject({
      _queueId: third._queueId,
    });
    await expect(playAdjacentTrack('previous')).resolves.toMatchObject({
      _queueId: first._queueId,
    });

    expect(playTrackMock).toHaveBeenNthCalledWith(1, '/music/third.mp3');
    expect(playTrackMock).toHaveBeenNthCalledWith(2, '/music/first.mp3');
  });

  it('rejects a captured seek after a replacement source commits first', async () => {
    const current = track('current');
    usePlayerStore.setState({ currentTrack: current, hasActivePlayback: true, isPlaying: true });
    setActivePlaybackGeneration(1);
    const expectedSource = captureActivePlaybackSource();
    expect(expectedSource).toEqual({ trackId: current.id, generation: 1 });
    playTrackMock.mockResolvedValueOnce(2);

    const replacement = startPlayback(track('replacement'));
    const seek = seekToPosition(30, expectedSource!);
    const [, seekApplied] = await Promise.all([replacement, seek]);

    expect(usePlayerStore.getState().currentTrack?.id).toBe('replacement');
    expect(seekApplied).toBe(false);
    expect(seekPlaybackMock).not.toHaveBeenCalled();
  });

  it('carries the expected generation and source path into an accepted seek', async () => {
    const current = track('current');
    usePlayerStore.setState({ currentTrack: current, hasActivePlayback: true, isPlaying: true });
    setActivePlaybackGeneration(4);

    await seekToPosition(30, { trackId: current.id, generation: 4 });

    expect(seekPlaybackMock).toHaveBeenCalledWith(30, {
      generation: 4,
      path: current.filePath,
    });
  });

  it('rejects a seek when native gapless handoff wins before command dispatch', async () => {
    const current = track('current');
    const handoff = {
      outgoingPath: current.filePath,
      outgoingGeneration: 4,
      preload: {
        preloadId: 'gapless-0000000000000005',
        generation: 5,
        path: '/music/next.mp3',
      },
    };
    const notices: unknown[] = [];
    const unsubscribe = subscribeGaplessCancellation((notice) => notices.push(notice));
    usePlayerStore.setState({ currentTrack: current, hasActivePlayback: true, isPlaying: true });
    setActivePlaybackGeneration(4);
    seekPlaybackMock.mockResolvedValueOnce({
      status: 'stale',
      expectedSource: { generation: 4, path: current.filePath },
      activeSource: { generation: 5, path: handoff.preload.path },
      gaplessCancellation: { status: 'handedOff', handoff },
    });

    const applied = await seekToPosition(30, { trackId: current.id, generation: 4 });
    unsubscribe();

    expect(applied).toBe(false);
    expect(notices).toEqual([
      {
        cause: 'seek',
        outcome: { status: 'handedOff', handoff },
        position: null,
      },
    ]);
  });

  it('publishes typed implicit cancellation from seek and output switching', async () => {
    const current = track('current');
    const preload = {
      preloadId: 'gapless-0000000000000002',
      generation: 2,
      path: '/music/next.mp3',
    };
    const notices: unknown[] = [];
    const unsubscribe = subscribeGaplessCancellation((notice) => notices.push(notice));
    usePlayerStore.setState({ currentTrack: current, hasActivePlayback: true, isPlaying: true });
    setActivePlaybackGeneration(1);
    seekPlaybackMock.mockResolvedValueOnce({
      status: 'applied',
      position: 12,
      gaplessCancellation: { status: 'cancelled', preload },
    });
    setAudioOutputDeviceMock.mockResolvedValueOnce({
      selection: { status: 'selected', deviceId: 'system' },
      gaplessCancellation: { status: 'cancelled', preload },
    });

    await seekToPosition(12, { trackId: current.id, generation: 1 });
    await switchAudioOutputDevice('system');
    unsubscribe();

    expect(notices).toEqual([
      {
        cause: 'seek',
        outcome: { status: 'cancelled', preload },
        position: 12,
      },
      {
        cause: 'outputDevice',
        outcome: { status: 'cancelled', preload },
        position: null,
      },
    ]);
  });

  it('uses the backend stop generation and rejects seeks without an active source', async () => {
    const current = track('current');
    usePlayerStore.setState({
      currentTrack: current,
      hasActivePlayback: true,
      isPlaying: true,
    });
    setActivePlaybackGeneration(1);

    await stopCurrentPlayback();
    await seekToPosition(20, { trackId: current.id, generation: 2 });

    expect(getActivePlaybackGeneration()).toBe(2);
    expect(usePlayerStore.getState().hasActivePlayback).toBe(false);
    expect(seekPlaybackMock).not.toHaveBeenCalled();
  });
});
