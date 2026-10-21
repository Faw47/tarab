import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../../store/player-store';
import { useSettingsStore } from '../../../store/settings-store';
import playbackEvents from '../../../test/ipc-fixtures/playback-events.json';
import type { Track } from '../../../types';
import {
  getActivePlaybackGeneration,
  notePlaybackIntervention,
  resetPlaybackGenerationForTests,
  setActivePlaybackGeneration,
} from '../playback-generation';
import { usePlaybackLifecycle } from '../usePlaybackLifecycle';

/** The near-end payload Rust emits (see the shared fixture), for the active generation. */
const nearEnd = () => ({
  ...playbackEvents['playback-near-end'],
  generation: getActivePlaybackGeneration(),
});

const {
  listeners,
  listenMock,
  crossfadeToTrackMock,
  hydrateQueueTrackMetadataMock,
  dbUpdatePlayStatsMock,
  preloadNextTrackMock,
  playAdjacentTrackMock,
  reportErrorMock,
  logErrorMock,
} = vi.hoisted(() => {
  const listeners = new Map<string, (event: { payload: unknown }) => unknown>();
  return {
    listeners,
    listenMock: vi.fn(
      async (eventName: string, handler: (event: { payload: unknown }) => unknown) => {
        listeners.set(eventName, handler);
        return () => {
          listeners.delete(eventName);
        };
      },
    ),
    crossfadeToTrackMock: vi.fn(async () => 2),
    hydrateQueueTrackMetadataMock: vi.fn(async (track: Track): Promise<Track> => track),
    dbUpdatePlayStatsMock: vi.fn(async () => undefined),
    preloadNextTrackMock: vi.fn(async () => undefined),
    playAdjacentTrackMock: vi.fn(async (): Promise<unknown> => undefined),
    reportErrorMock: vi.fn(),
    logErrorMock: vi.fn(),
  };
});

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

vi.mock('../../../platform/tauri-zustand-storage', () => ({
  createTauriZustandStorage: () => ({
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  }),
}));

vi.mock('../../../lib/tauri-commands', () => ({
  dbUpdatePlayStats: dbUpdatePlayStatsMock,
}));

vi.mock('../../../lib/playback-actions', () => ({
  crossfadeToSource: crossfadeToTrackMock,
  hydrateQueueTrackMetadata: hydrateQueueTrackMetadataMock,
  playAdjacentTrack: playAdjacentTrackMock,
  preloadGaplessSource: preloadNextTrackMock,
}));

vi.mock('../../../lib/report-error', () => ({
  reportError: reportErrorMock,
  logError: logErrorMock,
}));

const initialPlayerState = usePlayerStore.getState();
const initialSettingsState = useSettingsStore.getState();

const queue = [
  {
    id: 'track-1',
    title: 'Track 1',
    artist: 'Artist',
    album: 'Album',
    year: 2024,
    duration: 180,
    filePath: '/music/track-1.mp3',
    hasCoverArt: false,
    coverArtHash: null,
    dateAdded: 1,
  },
  {
    id: 'track-2',
    title: 'Track 2',
    artist: 'Artist',
    album: 'Album',
    year: 2024,
    duration: 220,
    filePath: '/music/track-2.mp3',
    hasCoverArt: false,
    coverArtHash: null,
    dateAdded: 2,
  },
];

function Harness() {
  usePlaybackLifecycle();
  return null;
}

describe('usePlaybackLifecycle', () => {
  beforeEach(() => {
    listeners.clear();
    vi.clearAllMocks();
    hydrateQueueTrackMetadataMock.mockImplementation(async (track) => track);

    usePlayerStore.setState(initialPlayerState, true);
    useSettingsStore.setState(initialSettingsState, true);
    resetPlaybackGenerationForTests();
    setActivePlaybackGeneration(1);

    usePlayerStore.setState({
      currentTrack: queue[0],
      queue,
      queueIndex: 0,
      queueVersion: 2,
      isPlaying: true,
      hasActivePlayback: true,
      currentTime: 172,
      duration: queue[0].duration,
      stopAfterCurrent: false,
      loopMode: 'all',
      shuffleEnabled: false,
    });

    useSettingsStore.setState({
      crossfadeSeconds: 4,
      gapless: true,
    });
  });

  it('ignores a near-end event from an older playback generation', async () => {
    // Review regression for QA-18: a bare-number payload skipped the generation check, and the
    // tests only ever sent bare numbers.
    render(<Harness />);
    await waitFor(() => {
      expect(listeners.has('playback-near-end')).toBe(true);
    });

    await listeners.get('playback-near-end')?.({
      payload: { ...nearEnd(), generation: getActivePlaybackGeneration() - 1 },
    });

    expect(crossfadeToTrackMock).not.toHaveBeenCalled();
  });

  it('crossfades to the next queue track on near-end', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-near-end')).toBe(true);
    });

    const handler = listeners.get('playback-near-end');
    expect(handler).toBeTruthy();
    await handler?.({ payload: nearEnd() });

    expect(crossfadeToTrackMock).toHaveBeenCalledWith('/music/track-2.mp3', 4);
    expect(usePlayerStore.getState().currentTrack?.id).toBe('track-1');

    await listeners.get('playback-transition')?.({
      payload: {
        generation: 2,
        state: 'crossfadeStarted',
        filePath: '/music/track-2.mp3',
        message: null,
        recoverable: true,
      },
    });

    expect(usePlayerStore.getState().currentTrack?.id).toBe('track-2');
    expect(usePlayerStore.getState().queueIndex).toBe(1);
  });

  it('hydrates a lazy next track before crossfading to its file path', async () => {
    const active = { ...queue[0], _queueId: 'queue-track-1' };
    const lazy = {
      ...queue[1],
      filePath: 'track-2',
      _queueId: 'queue-track-2',
      _lazyQueueEntry: true as const,
    };
    usePlayerStore.setState({
      currentTrack: active,
      queue: [active, lazy],
      queueIndex: 0,
    });
    hydrateQueueTrackMetadataMock.mockResolvedValueOnce(queue[1]);

    render(<Harness />);
    await waitFor(() => {
      expect(listeners.has('playback-near-end')).toBe(true);
    });
    await listeners.get('playback-near-end')?.({ payload: nearEnd() });

    await waitFor(() => {
      expect(crossfadeToTrackMock).toHaveBeenCalledWith('/music/track-2.mp3', 4);
    });
    await listeners.get('playback-transition')?.({
      payload: {
        generation: 2,
        state: 'crossfadeStarted',
        filePath: '/music/track-2.mp3',
        message: null,
        recoverable: true,
      },
    });

    expect(usePlayerStore.getState().currentTrack?.filePath).toBe('/music/track-2.mp3');
    expect(usePlayerStore.getState().queueIndex).toBe(1);
  });

  it('hydrates a lazy next track before gapless preload', async () => {
    const active = { ...queue[0], _queueId: 'queue-track-1' };
    const lazy = {
      ...queue[1],
      filePath: 'track-2',
      _queueId: 'queue-track-2',
      _lazyQueueEntry: true as const,
    };
    usePlayerStore.setState({
      currentTrack: active,
      queue: [active, lazy],
      queueIndex: 0,
    });
    useSettingsStore.setState({ crossfadeSeconds: 0, gapless: true });
    hydrateQueueTrackMetadataMock.mockResolvedValueOnce(queue[1]);

    render(<Harness />);
    await waitFor(() => {
      expect(listeners.has('playback-near-end')).toBe(true);
    });
    await listeners.get('playback-near-end')?.({ payload: nearEnd() });

    await waitFor(() => {
      expect(preloadNextTrackMock).toHaveBeenCalledWith('/music/track-2.mp3');
    });
  });

  it('suppresses auto-next when the outgoing crossfade track emits ended', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-near-end')).toBe(true);
      expect(listeners.has('playback-ended')).toBe(true);
    });

    await listeners.get('playback-near-end')?.({ payload: nearEnd() });
    await listeners.get('playback-ended')?.({
      payload: { path: '/music/track-1.mp3', seamless: false },
    });

    expect(playAdjacentTrackMock).not.toHaveBeenCalled();
    expect(dbUpdatePlayStatsMock).not.toHaveBeenCalled();
  });

  it('advances after a Repeat One crossfade that never reported completion', async () => {
    // The backend drops the crossfade without crossfadeCompleted when the outgoing sink empties
    // first; the incoming copy of the same file must still advance when it ends.
    usePlayerStore.setState({ loopMode: 'one' });
    render(<Harness />);
    await waitFor(() => {
      expect(listeners.has('playback-transition')).toBe(true);
    });

    await listeners.get('playback-near-end')?.({ payload: nearEnd() });
    await listeners.get('playback-transition')?.({
      payload: {
        generation: 2,
        state: 'crossfadeStarted',
        filePath: '/music/track-1.mp3',
        message: null,
        recoverable: true,
      },
    });
    expect(getActivePlaybackGeneration()).toBe(2);

    await listeners.get('playback-ended')?.({
      payload: { path: '/music/track-1.mp3', seamless: false, generation: 2 },
    });

    await waitFor(() => {
      expect(playAdjacentTrackMock).toHaveBeenCalledWith(
        'next',
        expect.objectContaining({ automatic: true }),
      );
    });
  });

  it('ignores a crossfade start after the user changed playback', async () => {
    let resolveCrossfade: (generation: number) => void = () => undefined;
    crossfadeToTrackMock.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          resolveCrossfade = resolve;
        }),
    );
    render(<Harness />);
    await waitFor(() => {
      expect(listeners.has('playback-transition')).toBe(true);
    });

    void listeners.get('playback-near-end')?.({ payload: nearEnd() });
    await waitFor(() => {
      expect(crossfadeToTrackMock).toHaveBeenCalled();
    });
    // The user starts another track; the backend replaces the crossfade it was about to start.
    notePlaybackIntervention();
    setActivePlaybackGeneration(3);
    await listeners.get('playback-transition')?.({
      payload: {
        generation: 2,
        state: 'crossfadeStarted',
        filePath: '/music/track-2.mp3',
        message: null,
        recoverable: true,
      },
    });
    resolveCrossfade(2);

    expect(usePlayerStore.getState().queueIndex).toBe(0);
    expect(getActivePlaybackGeneration()).toBe(3);
  });

  describe('unplayable tracks during automatic advance', () => {
    beforeEach(() => {
      playAdjacentTrackMock.mockReset();
    });

    const endTrackOne = async () => {
      render(<Harness />);
      await waitFor(() => {
        expect(listeners.has('playback-ended')).toBe(true);
      });
      await listeners.get('playback-ended')?.({
        payload: { path: '/music/track-1.mp3', seamless: false, generation: 1 },
      });
    };

    it('does not treat a superseded automatic advance as successfully started', async () => {
      playAdjacentTrackMock.mockResolvedValueOnce(null);
      await endTrackOne();
      await waitFor(() => {
        expect(playAdjacentTrackMock).toHaveBeenCalledTimes(1);
      });

      await listeners.get('playback-error')?.({
        payload: {
          generation: 1,
          filePath: '/music/track-1.mp3',
          stage: 'decode',
          message: 'Stale decoding error',
          recoverable: false,
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(playAdjacentTrackMock).toHaveBeenCalledTimes(1);
    });

    it('skips a track that cannot start and plays the one after it', async () => {
      playAdjacentTrackMock
        .mockImplementationOnce(async () => {
          notePlaybackIntervention();
          throw new Error('File not found');
        })
        .mockImplementationOnce(async () => {
          notePlaybackIntervention();
          setActivePlaybackGeneration(3);
        });

      await endTrackOne();

      await waitFor(() => {
        expect(playAdjacentTrackMock).toHaveBeenCalledTimes(2);
      });
      expect(reportErrorMock).toHaveBeenCalledWith(
        expect.stringContaining('Skipped "Track 2"'),
        expect.anything(),
      );
    });

    it('skips the entry it attempted under shuffle', async () => {
      usePlayerStore.setState({ shuffleEnabled: true, shufflePass: [], shufflePriority: [] });
      playAdjacentTrackMock
        .mockImplementationOnce(async () => {
          notePlaybackIntervention();
          throw new Error('File not found');
        })
        .mockImplementationOnce(async () => {
          notePlaybackIntervention();
        });

      await endTrackOne();

      await waitFor(() => {
        expect(playAdjacentTrackMock).toHaveBeenCalledTimes(2);
      });
      const attempted = (
        playAdjacentTrackMock.mock.calls[0] as unknown as [string, { entry: { track: Track } }]
      )[1].entry.track;
      expect(reportErrorMock).toHaveBeenCalledWith(
        `Skipped "${attempted.title}" because it could not be played`,
        expect.anything(),
      );
      expect(usePlayerStore.getState().currentTrack?.id).toBe(attempted.id);
    });

    it('skips an automatically reached track that fails to decode', async () => {
      playAdjacentTrackMock.mockImplementation(async () => {
        notePlaybackIntervention();
        const state = usePlayerStore.getState();
        const next = state.previewNext();
        if (next) state.activateTrackAtIndex(next.index);
        setActivePlaybackGeneration(getActivePlaybackGeneration() + 1);
      });

      await endTrackOne();
      await waitFor(() => {
        expect(playAdjacentTrackMock).toHaveBeenCalledTimes(1);
      });
      await listeners.get('playback-error')?.({
        payload: {
          generation: 2,
          filePath: '/music/track-2.mp3',
          stage: 'decode',
          message: 'Unsupported format',
          recoverable: false,
        },
      });

      await waitFor(() => {
        expect(playAdjacentTrackMock).toHaveBeenCalledTimes(2);
      });
      expect(usePlayerStore.getState().currentTrack?.id).toBe('track-1');
      expect(reportErrorMock).toHaveBeenCalledWith(
        expect.stringMatching(/^Skipped ".*" because it could not be played$/),
        { source: 'app', detail: 'Unsupported format (/music/track-2.mp3)' },
      );
    });

    it('stops instead of cycling when every remaining track fails', async () => {
      playAdjacentTrackMock.mockImplementation(async () => {
        notePlaybackIntervention();
        throw new Error('File not found');
      });

      await endTrackOne();

      await waitFor(() => {
        expect(usePlayerStore.getState().isPlaying).toBe(false);
      });
      expect(playAdjacentTrackMock).toHaveBeenCalledTimes(2);
    });

    it('does not skip when the user started other playback meanwhile', async () => {
      playAdjacentTrackMock.mockImplementationOnce(async () => {
        notePlaybackIntervention();
        notePlaybackIntervention();
        throw new Error('Superseded');
      });

      await endTrackOne();

      await waitFor(() => {
        expect(reportErrorMock).toHaveBeenCalledWith(
          'Failed to play next track',
          expect.anything(),
        );
      });
      expect(playAdjacentTrackMock).toHaveBeenCalledTimes(1);
    });
  });

  it('preloads the next track for gapless when crossfade is disabled', async () => {
    useSettingsStore.setState({ crossfadeSeconds: 0, gapless: true });
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-near-end')).toBe(true);
    });

    await listeners.get('playback-near-end')?.({ payload: nearEnd() });
    expect(preloadNextTrackMock).toHaveBeenCalledWith('/music/track-2.mp3');
    expect(crossfadeToTrackMock).not.toHaveBeenCalled();
  });

  it('records play stats once after crossing 50% playback', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-position')).toBe(true);
    });

    await listeners.get('playback-position')?.({
      payload: { generation: 1, position: 40 },
    });
    expect(dbUpdatePlayStatsMock).not.toHaveBeenCalled();

    await listeners.get('playback-position')?.({
      payload: { generation: 1, position: 95 },
    });
    expect(dbUpdatePlayStatsMock).toHaveBeenCalledTimes(1);
    expect(dbUpdatePlayStatsMock).toHaveBeenCalledWith('track-1');

    await listeners.get('playback-position')?.({
      payload: { generation: 1, position: 120 },
    });
    expect(dbUpdatePlayStatsMock).toHaveBeenCalledTimes(1);
  });
  it('logs play stats update failures after crossing 50%', async () => {
    const error = new Error('stats failed');
    dbUpdatePlayStatsMock.mockRejectedValueOnce(error);
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-position')).toBe(true);
    });

    await listeners.get('playback-position')?.({
      payload: { generation: 1, position: 95 },
    });

    await waitFor(() => {
      expect(logErrorMock).toHaveBeenCalledWith('Failed to update play stats', {
        source: 'app',
        error,
      });
    });
  });

  it('logs gapless preload failures without notifying', async () => {
    const error = new Error('preload failed');
    preloadNextTrackMock.mockRejectedValueOnce(error);
    useSettingsStore.setState({ crossfadeSeconds: 0, gapless: true });
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-near-end')).toBe(true);
    });

    await listeners.get('playback-near-end')?.({ payload: nearEnd() });

    await waitFor(() => {
      expect(logErrorMock).toHaveBeenCalledWith(
        'Failed to preload next track for gapless playback',
        { source: 'app', error },
      );
    });
  });

  it('keeps an unrecoverable playback error visible for user recovery', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-error')).toBe(true);
    });

    await listeners.get('playback-error')?.({
      payload: {
        filePath: '/music/track-1.mp3',
        stage: 'stream',
        message: 'stream failed',
        recoverable: false,
      },
    });

    // The recovery banner reports it, so there is no second notification (FE-10, FE-31).
    expect(reportErrorMock).not.toHaveBeenCalled();
    expect(logErrorMock).toHaveBeenCalledWith('Playback failed during stream', {
      source: 'audio-backend',
      detail: 'stream failed (/music/track-1.mp3)',
    });
    expect(usePlayerStore.getState().playbackError).toMatchObject({
      filePath: '/music/track-1.mp3',
      stage: 'stream',
      message: 'stream failed',
      recoverable: false,
    });
    expect(playAdjacentTrackMock).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(usePlayerStore.getState().hasActivePlayback).toBe(false);
  });
  it('ignores playback errors for stale non-current tracks', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-error')).toBe(true);
    });

    await listeners.get('playback-error')?.({
      payload: {
        filePath: '/music/not-current.mp3',
        stage: 'stream',
        message: 'old stream failed',
        recoverable: false,
      },
    });

    expect(reportErrorMock).not.toHaveBeenCalled();
    expect(playAdjacentTrackMock).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(usePlayerStore.getState().hasActivePlayback).toBe(true);
  });

  it('activates the preloaded track at a seamless gapless handoff under shuffle', async () => {
    const shuffleQueue = Array.from({ length: 5 }, (_, index) => ({
      ...queue[0],
      id: `shuffle-${index}`,
      title: `Shuffle ${index}`,
      filePath: `/music/shuffle-${index}.mp3`,
      _queueId: `queue-${index}`,
    }));
    usePlayerStore.setState({
      currentTrack: shuffleQueue[0],
      queue: shuffleQueue,
      queueIndex: 0,
      shuffleEnabled: true,
      shuffleHistory: ['shuffle-0'],
      loopMode: 'all',
    });
    useSettingsStore.setState({ crossfadeSeconds: 0, gapless: true });
    preloadNextTrackMock.mockResolvedValueOnce(9 as never);
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-near-end')).toBe(true);
      expect(listeners.has('playback-ended')).toBe(true);
    });

    await listeners.get('playback-near-end')?.({ payload: { generation: 1, remaining: 0.2 } });
    await waitFor(() => {
      expect(preloadNextTrackMock).toHaveBeenCalledWith('/music/shuffle-4.mp3');
    });

    // A second random pick at handoff time would now choose shuffle-1.
    random.mockReturnValue(0);
    await listeners.get('playback-ended')?.({
      payload: {
        generation: 1,
        path: '/music/shuffle-0.mp3',
        seamless: true,
        nextGeneration: 9,
        nextPath: '/music/shuffle-4.mp3',
      },
    });

    await waitFor(() => {
      expect(usePlayerStore.getState().currentTrack?.id).toBe('shuffle-4');
    });
    expect(usePlayerStore.getState().queueIndex).toBe(4);
    random.mockRestore();
  });

  it('follows the preloaded entry after the queue is reordered before the handoff', async () => {
    useSettingsStore.setState({ crossfadeSeconds: 0, gapless: true });
    const tracks = queue.map((track, index) => ({ ...track, _queueId: `queue-${index}` }));
    usePlayerStore.setState({ queue: tracks, currentTrack: tracks[0], queueIndex: 0 });
    preloadNextTrackMock.mockResolvedValueOnce(5 as never);
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-near-end')).toBe(true);
    });
    await listeners.get('playback-near-end')?.({ payload: { generation: 1, remaining: 0.2 } });
    await waitFor(() => {
      expect(preloadNextTrackMock).toHaveBeenCalledWith('/music/track-2.mp3');
    });

    // The user inserts another track ahead of the preloaded one.
    const inserted = {
      ...tracks[0],
      id: 'inserted',
      filePath: '/music/inserted.mp3',
      _queueId: 'x',
    };
    usePlayerStore.setState({ queue: [tracks[0], inserted, tracks[1]] });

    await listeners.get('playback-ended')?.({
      payload: { generation: 1, path: '/music/track-1.mp3', seamless: true, nextGeneration: 5 },
    });

    await waitFor(() => {
      expect(usePlayerStore.getState().currentTrack?.id).toBe('track-2');
    });
    expect(usePlayerStore.getState().queueIndex).toBe(2);
  });

  it('ignores delayed position and ended events from an old generation', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-position')).toBe(true);
      expect(listeners.has('playback-ended')).toBe(true);
    });

    await listeners.get('playback-position')?.({
      payload: { generation: 0, position: 120 },
    });
    await listeners.get('playback-ended')?.({
      payload: {
        generation: 0,
        path: '/music/track-1.mp3',
        seamless: false,
        nextGeneration: null,
      },
    });

    expect(dbUpdatePlayStatsMock).not.toHaveBeenCalled();
    expect(playAdjacentTrackMock).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().currentTrack?.id).toBe('track-1');
    expect(usePlayerStore.getState().isPlaying).toBe(true);
  });

  it('stops after the current track for the active generation', async () => {
    usePlayerStore.setState({ stopAfterCurrent: true });
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-ended')).toBe(true);
    });

    await listeners.get('playback-ended')?.({
      payload: {
        generation: 1,
        path: '/music/track-1.mp3',
        seamless: false,
        nextGeneration: null,
      },
    });

    expect(playAdjacentTrackMock).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().stopAfterCurrent).toBe(false);
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(usePlayerStore.getState().hasActivePlayback).toBe(false);
  });
});
