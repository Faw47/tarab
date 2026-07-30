import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../../store/player-store';
import { useSettingsStore } from '../../../store/settings-store';
import {
  resetPlaybackGenerationForTests,
  setActivePlaybackGeneration,
} from '../playback-generation';
import { usePlaybackLifecycle } from '../usePlaybackLifecycle';

const {
  listeners,
  listenMock,
  crossfadeToTrackMock,
  dbUpdatePlayStatsMock,
  preloadNextTrackMock,
  playAdjacentTrackMock,
  reportErrorMock,
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
    dbUpdatePlayStatsMock: vi.fn(async () => undefined),
    preloadNextTrackMock: vi.fn(async () => undefined),
    playAdjacentTrackMock: vi.fn(async () => undefined),
    reportErrorMock: vi.fn(),
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
  playAdjacentTrack: playAdjacentTrackMock,
  preloadGaplessSource: preloadNextTrackMock,
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
    vi.clearAllMocks();

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
    await handler?.({ payload: 0.2 });

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

  it('suppresses auto-next when the outgoing crossfade track emits ended', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-near-end')).toBe(true);
      expect(listeners.has('playback-ended')).toBe(true);
    });

    await listeners.get('playback-near-end')?.({ payload: 0.3 });
    await listeners.get('playback-ended')?.({
      payload: { path: '/music/track-1.mp3', seamless: false },
    });

    expect(playAdjacentTrackMock).not.toHaveBeenCalled();
    expect(dbUpdatePlayStatsMock).not.toHaveBeenCalled();
  });

  it('preloads the next track for gapless when crossfade is disabled', async () => {
    useSettingsStore.setState({ crossfadeSeconds: 0, gapless: true });
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-near-end')).toBe(true);
    });

    await listeners.get('playback-near-end')?.({ payload: 0.2 });
    expect(preloadNextTrackMock).toHaveBeenCalledWith('/music/track-2.mp3');
    expect(crossfadeToTrackMock).not.toHaveBeenCalled();
  });

  it('records play stats once after crossing 50% playback', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-position')).toBe(true);
    });

    await listeners.get('playback-position')?.({ payload: 40 });
    expect(dbUpdatePlayStatsMock).not.toHaveBeenCalled();

    await listeners.get('playback-position')?.({ payload: 95 });
    expect(dbUpdatePlayStatsMock).toHaveBeenCalledTimes(1);
    expect(dbUpdatePlayStatsMock).toHaveBeenCalledWith('track-1');

    await listeners.get('playback-position')?.({ payload: 120 });
    expect(dbUpdatePlayStatsMock).toHaveBeenCalledTimes(1);
  });
  it('reports play stats update failures after crossing 50%', async () => {
    const error = new Error('stats failed');
    dbUpdatePlayStatsMock.mockRejectedValueOnce(error);
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-position')).toBe(true);
    });

    await listeners.get('playback-position')?.({ payload: 95 });

    await waitFor(() => {
      expect(reportErrorMock).toHaveBeenCalledWith('Failed to update play stats', {
        source: 'app',
        error,
      });
    });
  });

  it('reports gapless preload failures', async () => {
    const error = new Error('preload failed');
    preloadNextTrackMock.mockRejectedValueOnce(error);
    useSettingsStore.setState({ crossfadeSeconds: 0, gapless: true });
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has('playback-near-end')).toBe(true);
    });

    await listeners.get('playback-near-end')?.({ payload: 0.2 });

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
