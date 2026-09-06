import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  GaplessCancellationOutcome,
  GaplessPreloadIdentity,
} from '../../../lib/tauri-commands';
import { usePlayerStore } from '../../../store/player-store';
import { useSettingsStore } from '../../../store/settings-store';
import {
  getActivePlaybackGeneration,
  resetPlaybackGenerationForTests,
  setActivePlaybackGeneration,
} from '../playback-generation';
import { usePlaybackLifecycle } from '../usePlaybackLifecycle';

type GaplessCancellationListener = (notice: {
  cause: 'seek' | 'outputDevice';
  outcome: GaplessCancellationOutcome;
  position: number | null;
}) => void;

const {
  listeners,
  gaplessCancellationListeners,
  listenMock,
  crossfadeToTrackMock,
  cancelGaplessPreloadMock,
  dbUpdatePlayStatsMock,
  preloadNextTrackMock,
  playAdjacentTrackMock,
  reportErrorMock,
  subscribeGaplessCancellationMock,
} = vi.hoisted(() => {
  const listeners = new Map<string, (event: { payload: unknown }) => unknown>();
  const gaplessCancellationListeners = new Set<GaplessCancellationListener>();
  return {
    listeners,
    gaplessCancellationListeners,
    listenMock: vi.fn(
      async (eventName: string, handler: (event: { payload: unknown }) => unknown) => {
        listeners.set(eventName, handler);
        return () => {
          listeners.delete(eventName);
        };
      },
    ),
    crossfadeToTrackMock: vi.fn(async () => 2),
    cancelGaplessPreloadMock: vi.fn(
      async (preload: GaplessPreloadIdentity): Promise<GaplessCancellationOutcome> => ({
        status: 'cancelled' as const,
        preload,
      }),
    ),
    dbUpdatePlayStatsMock: vi.fn(async () => undefined),
    preloadNextTrackMock: vi.fn(async (filePath: string) => ({
      preloadId: `preload:${filePath}`,
      generation: 2,
      path: filePath,
    })),
    playAdjacentTrackMock: vi.fn(async () => undefined),
    reportErrorMock: vi.fn(),
    subscribeGaplessCancellationMock: vi.fn((listener: GaplessCancellationListener) => {
      gaplessCancellationListeners.add(listener);
      return () => gaplessCancellationListeners.delete(listener);
    }),
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
  cancelGaplessSource: cancelGaplessPreloadMock,
  crossfadeToSource: crossfadeToTrackMock,
  playAdjacentTrack: playAdjacentTrackMock,
  preloadGaplessSource: preloadNextTrackMock,
  subscribeGaplessCancellation: subscribeGaplessCancellationMock,
}));

vi.mock('../../../lib/report-error', () => ({
  reportError: reportErrorMock,
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
    gaplessCancellationListeners.clear();
    vi.clearAllMocks();
    crossfadeToTrackMock.mockResolvedValue(2);
    preloadNextTrackMock.mockImplementation(async (filePath: string) => ({
      preloadId: `preload:${filePath}`,
      generation: 2,
      path: filePath,
    }));
    cancelGaplessPreloadMock.mockImplementation(
      async (preload: GaplessPreloadIdentity): Promise<GaplessCancellationOutcome> => ({
        status: 'cancelled' as const,
        preload,
      }),
    );

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

  it('crossfades to the next queue track on near-end', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-near-end')).toBe(true);
    });

    const handler = listeners.get('playback-near-end');
    expect(handler).toBeTruthy();
    await handler?.({ payload: { generation: 1, remaining: 0.2 } });

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

  it('keeps the crossfade locked and replays one near-end for the short incoming track', async () => {
    crossfadeToTrackMock.mockResolvedValueOnce(2).mockResolvedValueOnce(3);
    render(<Harness />);

    await waitFor(() => expect(listeners.has('playback-near-end')).toBe(true));
    await listeners.get('playback-near-end')?.({
      payload: { generation: 1, remaining: 0.2 },
    });
    await waitFor(() => expect(crossfadeToTrackMock).toHaveBeenCalledTimes(1));

    await listeners.get('playback-transition')?.({
      payload: {
        generation: 2,
        state: 'crossfadeStarted',
        filePath: '/music/track-2.mp3',
        message: null,
        recoverable: true,
      },
    });
    await listeners.get('playback-near-end')?.({
      payload: { generation: 2, remaining: 0.2 },
    });
    await listeners.get('playback-near-end')?.({
      payload: { generation: 2, remaining: 0.1 },
    });
    expect(crossfadeToTrackMock).toHaveBeenCalledTimes(1);

    await listeners.get('playback-transition')?.({
      payload: {
        generation: 2,
        state: 'crossfadeCompleted',
        filePath: '/music/track-2.mp3',
        message: null,
        recoverable: true,
      },
    });

    await waitFor(() => expect(crossfadeToTrackMock).toHaveBeenCalledTimes(2));
    expect(crossfadeToTrackMock).toHaveBeenNthCalledWith(2, '/music/track-1.mp3', 4);
  });

  it('releases the crossfade lock only after decode failure', async () => {
    render(<Harness />);

    await waitFor(() => expect(listeners.has('playback-near-end')).toBe(true));
    await listeners.get('playback-near-end')?.({
      payload: { generation: 1, remaining: 0.2 },
    });
    await waitFor(() => expect(crossfadeToTrackMock).toHaveBeenCalledTimes(1));
    await listeners.get('playback-near-end')?.({
      payload: { generation: 1, remaining: 0.1 },
    });
    expect(crossfadeToTrackMock).toHaveBeenCalledTimes(1);

    await listeners.get('playback-transition')?.({
      payload: {
        generation: 2,
        state: 'decodeFailed',
        filePath: '/music/track-2.mp3',
        message: 'decode failed',
        recoverable: true,
      },
    });
    await listeners.get('playback-near-end')?.({
      payload: { generation: 1, remaining: 0.05 },
    });

    await waitFor(() => expect(crossfadeToTrackMock).toHaveBeenCalledTimes(2));
  });

  it('starts a fast-playback crossfade early while preserving its wall-clock duration', async () => {
    usePlayerStore.setState({ playbackSpeed: 2 });
    render(<Harness />);

    await waitFor(() => expect(listeners.has('playback-position')).toBe(true));
    await listeners.get('playback-position')?.({
      payload: { generation: 1, position: 172 },
    });

    await waitFor(() => expect(crossfadeToTrackMock).toHaveBeenCalledWith('/music/track-2.mp3', 4));
  });

  it('ignores an early native near-end at slow speed and starts at the scaled threshold', async () => {
    usePlayerStore.setState({ playbackSpeed: 0.5 });
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-near-end')).toBe(true);
      expect(listeners.has('playback-position')).toBe(true);
    });
    await listeners.get('playback-near-end')?.({
      payload: { generation: 1, remaining: 4 },
    });
    expect(crossfadeToTrackMock).not.toHaveBeenCalled();

    await listeners.get('playback-position')?.({
      payload: { generation: 1, position: 178 },
    });
    await waitFor(() => expect(crossfadeToTrackMock).toHaveBeenCalledWith('/music/track-2.mp3', 4));
  });

  it('does not let a delayed crossfade overwrite a newer stop generation', async () => {
    render(<Harness />);

    await waitFor(() => expect(listeners.has('playback-near-end')).toBe(true));
    await listeners.get('playback-near-end')?.({
      payload: { generation: 1, remaining: 0.2 },
    });
    await waitFor(() => expect(crossfadeToTrackMock).toHaveBeenCalledTimes(1));

    setActivePlaybackGeneration(3);
    usePlayerStore.setState({
      isPlaying: false,
      hasActivePlayback: false,
      currentTime: 0,
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

    expect(getActivePlaybackGeneration()).toBe(3);
    expect(usePlayerStore.getState().currentTrack?.id).toBe('track-1');
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(usePlayerStore.getState().hasActivePlayback).toBe(false);
  });

  it('suppresses auto-next when the outgoing crossfade track emits ended', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-near-end')).toBe(true);
      expect(listeners.has('playback-ended')).toBe(true);
    });

    await listeners.get('playback-near-end')?.({
      payload: { generation: 1, remaining: 0.3 },
    });
    await listeners.get('playback-ended')?.({
      payload: {
        generation: 1,
        path: '/music/track-1.mp3',
        seamless: false,
        handoff: null,
      },
    });

    expect(playAdjacentTrackMock).not.toHaveBeenCalled();
    expect(dbUpdatePlayStatsMock).not.toHaveBeenCalled();
  });

  it('releases a pending crossfade after a stream error so the outgoing end can advance', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-near-end')).toBe(true);
      expect(listeners.has('playback-error')).toBe(true);
      expect(listeners.has('playback-ended')).toBe(true);
    });
    await listeners.get('playback-near-end')?.({
      payload: { generation: 1, remaining: 0.3 },
    });
    await listeners.get('playback-near-end')?.({
      payload: { generation: 1, remaining: 0.2 },
    });
    await waitFor(() => expect(crossfadeToTrackMock).toHaveBeenCalledTimes(1));

    await listeners.get('playback-error')?.({
      payload: {
        generation: 2,
        filePath: '/music/track-2.mp3',
        stage: 'stream',
        message: 'incoming stream failed before transition',
        recoverable: true,
      },
    });
    await listeners.get('playback-ended')?.({
      payload: {
        generation: 1,
        path: '/music/track-1.mp3',
        seamless: false,
        handoff: null,
      },
    });

    await waitFor(() =>
      expect(playAdjacentTrackMock).toHaveBeenCalledWith('next', { respectRepeatOne: true }),
    );
    expect(crossfadeToTrackMock).toHaveBeenCalledTimes(1);
  });

  it('preloads the next track for gapless when crossfade is disabled', async () => {
    useSettingsStore.setState({ crossfadeSeconds: 0, gapless: true });
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-near-end')).toBe(true);
    });

    await listeners.get('playback-near-end')?.({
      payload: { generation: 1, remaining: 0.2 },
    });
    expect(preloadNextTrackMock).toHaveBeenCalledWith('/music/track-2.mp3');
    expect(crossfadeToTrackMock).not.toHaveBeenCalled();
  });

  it('re-arms gapless preload after a typed output-device cancellation', async () => {
    useSettingsStore.setState({ crossfadeSeconds: 0, gapless: true });
    render(<Harness />);

    await waitFor(() => expect(listeners.has('playback-near-end')).toBe(true));
    await listeners.get('playback-near-end')?.({
      payload: { generation: 1, remaining: 0.2 },
    });
    await waitFor(() => expect(preloadNextTrackMock).toHaveBeenCalledTimes(1));

    for (const listener of gaplessCancellationListeners) {
      listener({
        cause: 'outputDevice',
        outcome: {
          status: 'cancelled',
          preload: {
            preloadId: 'preload:/music/track-2.mp3',
            generation: 2,
            path: '/music/track-2.mp3',
          },
        },
        position: null,
      });
    }

    await waitFor(() => expect(preloadNextTrackMock).toHaveBeenCalledTimes(2));
  });

  it('clears a seek-cancelled preload and waits for the new near-end boundary', async () => {
    useSettingsStore.setState({ crossfadeSeconds: 0, gapless: true });
    render(<Harness />);

    await waitFor(() => expect(listeners.has('playback-near-end')).toBe(true));
    await listeners.get('playback-near-end')?.({
      payload: { generation: 1, remaining: 0.2 },
    });
    await waitFor(() => expect(preloadNextTrackMock).toHaveBeenCalledTimes(1));

    for (const listener of gaplessCancellationListeners) {
      listener({
        cause: 'seek',
        outcome: {
          status: 'cancelled',
          preload: {
            preloadId: 'preload:/music/track-2.mp3',
            generation: 2,
            path: '/music/track-2.mp3',
          },
        },
        position: 30,
      });
    }
    await Promise.resolve();
    expect(preloadNextTrackMock).toHaveBeenCalledTimes(1);

    await listeners.get('playback-near-end')?.({
      payload: { generation: 1, remaining: 0.2 },
    });
    await waitFor(() => expect(preloadNextTrackMock).toHaveBeenCalledTimes(2));
  });

  it('activates the exact track selected for a shuffled gapless preload', async () => {
    const thirdTrack = {
      ...queue[1],
      id: 'track-3',
      title: 'Track 3',
      filePath: '/music/track-3.mp3',
    };
    usePlayerStore.setState({
      queue: [...queue, thirdTrack],
      shuffleEnabled: true,
      shuffleHistory: ['track-1'],
    });
    useSettingsStore.setState({ crossfadeSeconds: 0, gapless: true });
    const random = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(0.99);
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-near-end')).toBe(true);
      expect(listeners.has('playback-ended')).toBe(true);
    });
    await listeners.get('playback-near-end')?.({
      payload: { generation: 1, remaining: 0.2 },
    });
    expect(preloadNextTrackMock).toHaveBeenCalledWith('/music/track-2.mp3');
    expect(cancelGaplessPreloadMock).not.toHaveBeenCalled();
    expect(getActivePlaybackGeneration()).toBe(1);

    await listeners.get('playback-ended')?.({
      payload: {
        generation: 1,
        path: '/music/track-1.mp3',
        seamless: true,
        handoff: {
          outgoingGeneration: 1,
          outgoingPath: '/music/track-1.mp3',
          preload: {
            preloadId: 'preload:/music/track-2.mp3',
            generation: 2,
            path: '/music/track-2.mp3',
          },
        },
      },
    });

    expect(getActivePlaybackGeneration()).toBe(2);
    await waitFor(() => expect(usePlayerStore.getState().currentTrack?.id).toBe('track-2'));
    expect(random).toHaveBeenCalledTimes(1);
    random.mockRestore();
  });

  it('promotes the exact duplicate occurrence selected for gapless playback', async () => {
    const outgoing = { ...queue[0], _queueId: 'outgoing-occurrence' };
    const firstDuplicate = {
      ...queue[1],
      id: 'duplicate-track',
      _queueId: 'duplicate-first',
    };
    const selectedDuplicate = {
      ...firstDuplicate,
      _queueId: 'duplicate-selected',
    };
    usePlayerStore.setState({
      currentTrack: outgoing,
      queue: [outgoing, firstDuplicate, selectedDuplicate],
      queueIndex: 0,
      shuffleEnabled: true,
      shuffleHistory: [outgoing._queueId],
      duration: outgoing.duration,
    });
    useSettingsStore.setState({ crossfadeSeconds: 0, gapless: true });
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.99);
    render(<Harness />);

    await waitFor(() => expect(listeners.has('playback-near-end')).toBe(true));
    await listeners.get('playback-near-end')?.({
      payload: { generation: 1, remaining: 0.2 },
    });
    await waitFor(() => expect(preloadNextTrackMock).toHaveBeenCalledTimes(1));

    await listeners.get('playback-ended')?.({
      payload: {
        generation: 1,
        path: outgoing.filePath,
        seamless: true,
        handoff: {
          outgoingGeneration: 1,
          outgoingPath: outgoing.filePath,
          preload: {
            preloadId: `preload:${selectedDuplicate.filePath}`,
            generation: 2,
            path: selectedDuplicate.filePath,
          },
        },
      },
    });

    expect(usePlayerStore.getState().currentTrack?._queueId).toBe('duplicate-selected');
    expect(usePlayerStore.getState().queueIndex).toBe(2);
    random.mockRestore();
  });

  it('waits for native cancellation acknowledgement before replacing a reordered preload', async () => {
    const thirdTrack = {
      ...queue[1],
      id: 'track-3',
      title: 'Track 3',
      filePath: '/music/track-3.mp3',
    };
    let resolveCancellation!: (outcome: GaplessCancellationOutcome) => void;
    cancelGaplessPreloadMock.mockImplementationOnce(
      () =>
        new Promise<GaplessCancellationOutcome>((resolve) => {
          resolveCancellation = resolve;
        }),
    );
    usePlayerStore.setState({ queue: [...queue, thirdTrack] });
    useSettingsStore.setState({ crossfadeSeconds: 0, gapless: true });
    render(<Harness />);

    await waitFor(() => expect(listeners.has('playback-near-end')).toBe(true));
    await listeners.get('playback-near-end')?.({
      payload: { generation: 1, remaining: 0.2 },
    });
    expect(preloadNextTrackMock).toHaveBeenCalledWith('/music/track-2.mp3');

    usePlayerStore.getState().reorderQueue(2, 1);

    await waitFor(() => {
      expect(cancelGaplessPreloadMock).toHaveBeenCalledWith({
        preloadId: 'preload:/music/track-2.mp3',
        generation: 2,
        path: '/music/track-2.mp3',
      });
    });
    expect(preloadNextTrackMock).toHaveBeenCalledTimes(1);

    resolveCancellation({
      status: 'cancelled',
      preload: {
        preloadId: 'preload:/music/track-2.mp3',
        generation: 2,
        path: '/music/track-2.mp3',
      },
    });

    await waitFor(() => {
      expect(preloadNextTrackMock).toHaveBeenCalledWith('/music/track-3.mp3');
    });
  });

  it('commits the authoritative handoff when queue removal loses the cancellation race', async () => {
    let resolveCancellation!: (outcome: GaplessCancellationOutcome) => void;
    cancelGaplessPreloadMock.mockImplementationOnce(
      () =>
        new Promise<GaplessCancellationOutcome>((resolve) => {
          resolveCancellation = resolve;
        }),
    );
    useSettingsStore.setState({ crossfadeSeconds: 0, gapless: true });
    render(<Harness />);

    await waitFor(() => expect(listeners.has('playback-near-end')).toBe(true));
    await listeners.get('playback-near-end')?.({
      payload: { generation: 1, remaining: 0.2 },
    });
    await waitFor(() => expect(preloadNextTrackMock).toHaveBeenCalledTimes(1));

    usePlayerStore.getState().removeFromQueue(1);
    await waitFor(() => expect(cancelGaplessPreloadMock).toHaveBeenCalledTimes(1));

    const handoff = {
      outgoingGeneration: 1,
      outgoingPath: '/music/track-1.mp3',
      preload: {
        preloadId: 'preload:/music/track-2.mp3',
        generation: 2,
        path: '/music/track-2.mp3',
      },
    };
    await listeners.get('playback-ended')?.({
      payload: {
        generation: 1,
        path: '/music/track-1.mp3',
        seamless: true,
        handoff,
      },
    });
    resolveCancellation({ status: 'handedOff', handoff });

    await waitFor(() => expect(usePlayerStore.getState().currentTrack?.id).toBe('track-2'));
    expect(getActivePlaybackGeneration()).toBe(2);
    expect(usePlayerStore.getState().queueIndex).toBe(-1);
    expect(preloadNextTrackMock).toHaveBeenCalledTimes(1);
  });

  it('applies a started preload returned by settings cancellation acknowledgement', async () => {
    useSettingsStore.setState({ crossfadeSeconds: 0, gapless: true });
    render(<Harness />);

    await waitFor(() => expect(listeners.has('playback-near-end')).toBe(true));
    await listeners.get('playback-near-end')?.({
      payload: { generation: 1, remaining: 0.2 },
    });
    await waitFor(() => expect(preloadNextTrackMock).toHaveBeenCalledTimes(1));

    const handoff = {
      outgoingGeneration: 1,
      outgoingPath: '/music/track-1.mp3',
      preload: {
        preloadId: 'preload:/music/track-2.mp3',
        generation: 2,
        path: '/music/track-2.mp3',
      },
    };
    cancelGaplessPreloadMock.mockResolvedValueOnce({ status: 'handedOff', handoff });
    useSettingsStore.setState({ gapless: false });

    await waitFor(() => expect(usePlayerStore.getState().currentTrack?.id).toBe('track-2'));
    expect(getActivePlaybackGeneration()).toBe(2);
    expect(cancelGaplessPreloadMock).toHaveBeenCalledWith(handoff.preload);
  });

  it('records play stats once after crossing 50% playback', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-position')).toBe(true);
    });

    await listeners.get('playback-position')?.({ payload: { generation: 1, position: 40 } });
    expect(dbUpdatePlayStatsMock).not.toHaveBeenCalled();

    await listeners.get('playback-position')?.({ payload: { generation: 1, position: 95 } });
    expect(dbUpdatePlayStatsMock).toHaveBeenCalledTimes(1);
    expect(dbUpdatePlayStatsMock).toHaveBeenCalledWith('track-1');

    await listeners.get('playback-position')?.({ payload: { generation: 1, position: 120 } });
    expect(dbUpdatePlayStatsMock).toHaveBeenCalledTimes(1);
  });
  it('records the same track again after a new playback generation', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-position')).toBe(true);
    });

    await listeners.get('playback-position')?.({ payload: { generation: 1, position: 95 } });
    setActivePlaybackGeneration(2);
    await listeners.get('playback-position')?.({ payload: { generation: 2, position: 95 } });

    expect(dbUpdatePlayStatsMock).toHaveBeenCalledTimes(2);
    expect(dbUpdatePlayStatsMock).toHaveBeenNthCalledWith(1, 'track-1');
    expect(dbUpdatePlayStatsMock).toHaveBeenNthCalledWith(2, 'track-1');
  });
  it('reports play stats update failures after crossing 50%', async () => {
    const error = new Error('stats failed');
    dbUpdatePlayStatsMock.mockRejectedValueOnce(error);
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-position')).toBe(true);
    });

    await listeners.get('playback-position')?.({ payload: { generation: 1, position: 95 } });

    await waitFor(() => {
      expect(reportErrorMock).toHaveBeenCalledWith('Failed to update play stats', {
        source: 'app',
        error,
      });
    });

    await listeners.get('playback-position')?.({ payload: { generation: 1, position: 96 } });
    expect(dbUpdatePlayStatsMock).toHaveBeenCalledTimes(2);
  });

  it('reports gapless preload failures', async () => {
    const error = new Error('preload failed');
    preloadNextTrackMock.mockRejectedValueOnce(error);
    useSettingsStore.setState({ crossfadeSeconds: 0, gapless: true });
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-near-end')).toBe(true);
    });

    await listeners.get('playback-near-end')?.({
      payload: { generation: 1, remaining: 0.2 },
    });

    await waitFor(() => {
      expect(reportErrorMock).toHaveBeenCalledWith(
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
        generation: 1,
        filePath: '/music/track-1.mp3',
        stage: 'stream',
        message: 'stream failed',
        recoverable: false,
      },
    });

    expect(reportErrorMock).toHaveBeenCalledWith('Playback failed at stream', {
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
        generation: 0,
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

  it('keeps playback active after a recoverable output-device failure', async () => {
    render(<Harness />);
    await waitFor(() => expect(listeners.has('playback-error')).toBe(true));

    await listeners.get('playback-error')?.({
      payload: {
        generation: 1,
        filePath: '/music/track-1.mp3',
        stage: 'deviceSwitch',
        message: 'device unavailable',
        recoverable: true,
      },
    });

    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(usePlayerStore.getState().hasActivePlayback).toBe(true);
    expect(usePlayerStore.getState().playbackError?.stage).toBe('deviceSwitch');
  });

  it('does not advance after a newer source starts during delayed end handling', async () => {
    useSettingsStore.setState({ gapless: false, crossfadeSeconds: 0 });
    render(<Harness />);
    await waitFor(() => expect(listeners.has('playback-ended')).toBe(true));

    await listeners.get('playback-ended')?.({
      payload: {
        generation: 1,
        path: '/music/track-1.mp3',
        seamless: false,
        handoff: null,
      },
    });
    setActivePlaybackGeneration(2);
    usePlayerStore.setState({ currentTrack: queue[1] });
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(playAdjacentTrackMock).not.toHaveBeenCalled();
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
        handoff: null,
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
        handoff: null,
      },
    });

    expect(playAdjacentTrackMock).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().stopAfterCurrent).toBe(false);
    expect(usePlayerStore.getState().isPlaying).toBe(false);
    expect(usePlayerStore.getState().hasActivePlayback).toBe(false);
  });

  it('honors repeat-one when a track completes naturally', async () => {
    usePlayerStore.setState({ loopMode: 'one' });
    useSettingsStore.setState({ crossfadeSeconds: 0, gapless: true });
    render(<Harness />);

    await waitFor(() => expect(listeners.has('playback-ended')).toBe(true));
    await listeners.get('playback-ended')?.({
      payload: {
        generation: 1,
        path: '/music/track-1.mp3',
        seamless: false,
        handoff: null,
      },
    });

    await waitFor(() =>
      expect(playAdjacentTrackMock).toHaveBeenCalledWith('next', { respectRepeatOne: true }),
    );
  });
});
