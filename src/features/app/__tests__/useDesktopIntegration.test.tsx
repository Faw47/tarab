import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../../store/player-store';
import { useSettingsStore } from '../../../store/settings-store';
import type { DesktopControlAction } from '../../../types';
import {
  EVENT_DESKTOP_CONTROL_ACTION,
  EVENT_DESKTOP_NATIVE_SEEK_TO,
  EVENT_DESKTOP_NATIVE_VOLUME,
  EVENT_DESKTOP_PLAYBACK_SNAPSHOT,
  EVENT_DESKTOP_SEEK,
  EVENT_DESKTOP_SNAPSHOT_REQUEST,
  MINI_WINDOW_LABEL,
} from '../desktop-events';
import {
  resetPlaybackGenerationForTests,
  setActivePlaybackGeneration,
} from '../playback-generation';
import { useDesktopIntegration } from '../useDesktopIntegration';

const {
  listeners,
  emitToMock,
  listenMock,
  desktopSetNativeUiStateMock,
  desktopSyncMediaSessionMock,
  desktopFocusMainWindowMock,
  desktopMarkRendererReadyMock,
  desktopQuitApplicationMock,
  desktopToggleMiniWindowMock,
  desktopCloseMiniWindowMock,
  getCoverArtDataMock,
  pauseCurrentPlaybackMock,
  resumeCurrentPlaybackMock,
  toggleCurrentPlaybackMock,
  playAdjacentTrackMock,
  seekToPositionMock,
  setNativeVolumeMock,
  stopCurrentPlaybackMock,
  flushSessionSaveMock,
  flushPlayerStateWritesMock,
  flushSettingsWritesMock,
} = vi.hoisted(() => {
  const listeners = new Map<string, (event: { payload: unknown }) => unknown>();
  return {
    listeners,
    emitToMock: vi.fn(async () => undefined),
    listenMock: vi.fn(
      async (eventName: string, handler: (event: { payload: unknown }) => unknown) => {
        listeners.set(eventName, handler);
        return () => {
          listeners.delete(eventName);
        };
      },
    ),
    desktopSetNativeUiStateMock: vi.fn(async () => undefined),
    desktopSyncMediaSessionMock: vi.fn(async () => undefined),
    desktopFocusMainWindowMock: vi.fn(async () => undefined),
    desktopMarkRendererReadyMock: vi.fn(async () => undefined),
    desktopQuitApplicationMock: vi.fn(async () => undefined),
    desktopToggleMiniWindowMock: vi.fn(async () => undefined),
    desktopCloseMiniWindowMock: vi.fn(async () => undefined),
    getCoverArtDataMock: vi.fn(async () => null),
    pauseCurrentPlaybackMock: vi.fn(async () => undefined),
    resumeCurrentPlaybackMock: vi.fn(async () => undefined),
    toggleCurrentPlaybackMock: vi.fn(async () => undefined),
    playAdjacentTrackMock: vi.fn(async () => undefined),
    seekToPositionMock: vi.fn(async () => true),
    setNativeVolumeMock: vi.fn(async () => undefined),
    stopCurrentPlaybackMock: vi.fn(async () => undefined),
    flushSessionSaveMock: vi.fn(async () => undefined),
    flushPlayerStateWritesMock: vi.fn(async () => undefined),
    flushSettingsWritesMock: vi.fn(async () => undefined),
  };
});

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: emitToMock,
  listen: listenMock,
}));

vi.mock('../../../platform/tauri-zustand-storage', () => ({
  createTauriZustandStorage: () => ({
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  }),
  flushSettingsWrites: flushSettingsWritesMock,
}));

vi.mock('../player-state-store', () => ({
  flushPlayerStateWrites: flushPlayerStateWritesMock,
}));

vi.mock('../../../lib/tauri-commands', () => ({
  desktopSetNativeUiState: desktopSetNativeUiStateMock,
  desktopSyncMediaSession: desktopSyncMediaSessionMock,
  desktopFocusMainWindow: desktopFocusMainWindowMock,
  desktopMarkRendererReady: desktopMarkRendererReadyMock,
  desktopQuitApplication: desktopQuitApplicationMock,
  desktopToggleMiniWindow: desktopToggleMiniWindowMock,
  desktopCloseMiniWindow: desktopCloseMiniWindowMock,
  getCoverArtData: getCoverArtDataMock,
  setVolume: setNativeVolumeMock,
}));

vi.mock('../../../lib/playback-actions', () => ({
  pauseCurrentPlayback: pauseCurrentPlaybackMock,
  resumeCurrentPlayback: resumeCurrentPlaybackMock,
  toggleCurrentPlayback: toggleCurrentPlaybackMock,
  playAdjacentTrack: playAdjacentTrackMock,
  seekToPosition: seekToPositionMock,
  stopCurrentPlayback: stopCurrentPlaybackMock,
}));

vi.mock('../../../lib/report-error', () => ({
  reportError: vi.fn(),
}));

const initialPlayerState = usePlayerStore.getState();
const initialSettingsState = useSettingsStore.getState();

function Harness() {
  useDesktopIntegration({ flushSessionSave: flushSessionSaveMock });
  return null;
}

async function emitDesktopAction(action: DesktopControlAction) {
  const handler = listeners.get(EVENT_DESKTOP_CONTROL_ACTION);
  expect(handler).toBeTruthy();
  await handler?.({ payload: action });
}

async function emitDesktopSeek(positionSecs: number, sourceId = 'source-1') {
  const handler = listeners.get(EVENT_DESKTOP_SEEK);
  expect(handler).toBeTruthy();
  await handler?.({
    payload: {
      positionSecs,
      sourceId,
    },
  });
}

describe('useDesktopIntegration', () => {
  beforeEach(() => {
    listeners.clear();
    vi.clearAllMocks();

    usePlayerStore.setState(initialPlayerState, true);
    useSettingsStore.setState(initialSettingsState, true);
    resetPlaybackGenerationForTests();
    setActivePlaybackGeneration(1);

    usePlayerStore.setState({
      currentTrack: {
        id: 'track-1',
        title: 'Song',
        artist: 'Artist',
        album: 'Album',
        year: 2024,
        duration: 200,
        filePath: '/music/song.mp3',
        hasCoverArt: false,
        coverArtHash: null,
        dateAdded: 1,
      },
      queue: [
        {
          id: 'track-1',
          title: 'Song',
          artist: 'Artist',
          album: 'Album',
          year: 2024,
          duration: 200,
          filePath: '/music/song.mp3',
          hasCoverArt: false,
          coverArtHash: null,
          dateAdded: 1,
        },
      ],
      queueIndex: 0,
      queueVersion: 1,
      isPlaying: false,
      hasActivePlayback: true,
      currentTime: 10,
      duration: 200,
      shuffleEnabled: false,
      loopMode: 'all',
      playbackSpeed: 1,
    });

    useSettingsStore.setState({
      desktopStatusIconEnabled: true,
      desktopMediaKeysEnabled: true,
      desktopMiniWindowEnabled: true,
      hideToStatusIconOnClose: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('routes desktop control actions to playback handlers', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has(EVENT_DESKTOP_CONTROL_ACTION)).toBe(true);
    });

    await emitDesktopAction('next');

    await waitFor(() => expect(playAdjacentTrackMock).toHaveBeenCalledWith('next'));
    await emitDesktopAction('stop');
    await waitFor(() => expect(stopCurrentPlaybackMock).toHaveBeenCalledTimes(1));
  });

  it('handles idempotent desktop play and pause actions', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has(EVENT_DESKTOP_CONTROL_ACTION)).toBe(true);
    });

    await emitDesktopAction('play');
    await waitFor(() => expect(resumeCurrentPlaybackMock).toHaveBeenCalledTimes(1));
    expect(pauseCurrentPlaybackMock).not.toHaveBeenCalled();

    usePlayerStore.setState({ isPlaying: true });
    await emitDesktopAction('pause');
    await waitFor(() => expect(pauseCurrentPlaybackMock).toHaveBeenCalledTimes(1));
  });

  it('serializes distinct repeated desktop actions without dropping them', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has(EVENT_DESKTOP_CONTROL_ACTION)).toBe(true);
    });

    await emitDesktopAction('next');
    await emitDesktopAction('next');

    await waitFor(() => expect(playAdjacentTrackMock).toHaveBeenCalledTimes(2));
  });

  it('does not toggle mini window when feature is disabled', async () => {
    useSettingsStore.setState({ desktopMiniWindowEnabled: false });

    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has(EVENT_DESKTOP_CONTROL_ACTION)).toBe(true);
    });

    await emitDesktopAction('toggle-mini');

    await waitFor(() => expect(desktopToggleMiniWindowMock).not.toHaveBeenCalled());
  });

  it('always honors the idempotent mini hide intent', async () => {
    useSettingsStore.setState({ desktopMiniWindowEnabled: false });
    render(<Harness />);
    await waitFor(() => expect(listeners.has(EVENT_DESKTOP_CONTROL_ACTION)).toBe(true));

    await emitDesktopAction('hide-mini');

    await waitFor(() => expect(desktopCloseMiniWindowMock).toHaveBeenCalledTimes(1));
  });

  it('responds to desktop snapshot requests with a main-window snapshot', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has(EVENT_DESKTOP_SNAPSHOT_REQUEST)).toBe(true);
    });

    emitToMock.mockClear();
    const snapshotReqHandler = listeners.get(EVENT_DESKTOP_SNAPSHOT_REQUEST);
    expect(snapshotReqHandler).toBeTruthy();

    await snapshotReqHandler?.({ payload: null });

    expect(emitToMock).toHaveBeenCalledWith(
      MINI_WINDOW_LABEL,
      EVENT_DESKTOP_PLAYBACK_SNAPSHOT,
      expect.objectContaining({
        track: {
          title: 'Song',
          artist: 'Artist',
          coverArtHash: null,
        },
        sourceId: 'source-1',
        isPlaying: false,
        position: 10,
      }),
    );
    const emittedSnapshot = (
      emitToMock.mock.calls as unknown as Array<
        [string, string, { track?: Record<string, unknown> }]
      >
    )[0]?.[2];
    expect(emittedSnapshot?.track).not.toHaveProperty('filePath');
    expect(emittedSnapshot?.track).not.toHaveProperty('id');
  });

  it('routes desktop seek events to seek handler', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has(EVENT_DESKTOP_SEEK)).toBe(true);
    });

    await emitDesktopSeek(42);
    await waitFor(() =>
      expect(seekToPositionMock).toHaveBeenCalledWith(42, {
        trackId: 'track-1',
        generation: 1,
      }),
    );
  });

  it('rejects mini seeks after the active backend source has stopped', async () => {
    render(<Harness />);
    await waitFor(() => expect(listeners.has(EVENT_DESKTOP_SEEK)).toBe(true));
    usePlayerStore.setState({ hasActivePlayback: false });
    emitToMock.mockClear();

    await emitDesktopSeek(42);

    await waitFor(() =>
      expect(emitToMock).toHaveBeenCalledWith(
        MINI_WINDOW_LABEL,
        EVENT_DESKTOP_PLAYBACK_SNAPSHOT,
        expect.any(Object),
      ),
    );
    expect(seekToPositionMock).not.toHaveBeenCalled();
  });

  it('rejects stale mini source identifiers and returns the current snapshot', async () => {
    render(<Harness />);
    await waitFor(() => expect(listeners.has(EVENT_DESKTOP_SEEK)).toBe(true));
    emitToMock.mockClear();

    await emitDesktopSeek(42, 'source-stale');

    await waitFor(() =>
      expect(emitToMock).toHaveBeenCalledWith(
        MINI_WINDOW_LABEL,
        EVENT_DESKTOP_PLAYBACK_SNAPSHOT,
        expect.objectContaining({ sourceId: 'source-1' }),
      ),
    );
    expect(seekToPositionMock).not.toHaveBeenCalled();
  });

  it('clamps mini seek positions using main-window playback state', async () => {
    render(<Harness />);
    await waitFor(() => expect(listeners.has(EVENT_DESKTOP_SEEK)).toBe(true));

    await emitDesktopSeek(999);

    await waitFor(() =>
      expect(seekToPositionMock).toHaveBeenCalledWith(200, {
        trackId: 'track-1',
        generation: 1,
      }),
    );
  });

  it('routes native media timeline seeks through the active source guard', async () => {
    render(<Harness />);
    await waitFor(() => expect(listeners.has(EVENT_DESKTOP_NATIVE_SEEK_TO)).toBe(true));

    await listeners.get(EVENT_DESKTOP_NATIVE_SEEK_TO)?.({ payload: 42 });

    await waitFor(() =>
      expect(seekToPositionMock).toHaveBeenCalledWith(42, {
        trackId: 'track-1',
        generation: 1,
      }),
    );
  });

  it('applies native media volume changes to the backend and renderer state', async () => {
    render(<Harness />);
    await waitFor(() => expect(listeners.has(EVENT_DESKTOP_NATIVE_VOLUME)).toBe(true));

    await listeners.get(EVENT_DESKTOP_NATIVE_VOLUME)?.({ payload: 0.35 });

    await waitFor(() => expect(setNativeVolumeMock).toHaveBeenCalledWith(0.35));
    expect(usePlayerStore.getState().volume).toBe(0.35);
  });

  it('marks the native bridge ready only after the action listener is installed', async () => {
    render(<Harness />);

    await waitFor(() => expect(listeners.has(EVENT_DESKTOP_CONTROL_ACTION)).toBe(true));
    expect(desktopMarkRendererReadyMock).toHaveBeenCalledTimes(1);
  });

  it('settles an in-flight control before flushing and quitting', async () => {
    let resolveNext: (() => void) | undefined;
    playAdjacentTrackMock.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          resolveNext = () => resolve(undefined);
        }),
    );
    render(<Harness />);
    await waitFor(() => expect(listeners.has(EVENT_DESKTOP_CONTROL_ACTION)).toBe(true));

    await emitDesktopAction('next');
    await waitFor(() => expect(playAdjacentTrackMock).toHaveBeenCalledTimes(1));
    await emitDesktopAction('quit');
    await Promise.resolve();
    expect(flushSessionSaveMock).not.toHaveBeenCalled();

    resolveNext?.();
    await waitFor(() => expect(desktopQuitApplicationMock).toHaveBeenCalledTimes(1));
    expect(flushSessionSaveMock).toHaveBeenCalledTimes(1);
  });

  it('flushes the latest session before desktop quit', async () => {
    render(<Harness />);
    await waitFor(() => expect(listeners.has(EVENT_DESKTOP_CONTROL_ACTION)).toBe(true));

    await emitDesktopAction('quit');

    await waitFor(() => expect(desktopQuitApplicationMock).toHaveBeenCalledTimes(1));
    expect(flushSessionSaveMock).toHaveBeenCalledTimes(1);
    expect(flushPlayerStateWritesMock).toHaveBeenCalledTimes(1);
    expect(flushSettingsWritesMock).toHaveBeenCalledTimes(1);
    expect(flushSessionSaveMock.mock.invocationCallOrder[0]).toBeLessThan(
      desktopQuitApplicationMock.mock.invocationCallOrder[0],
    );
  });

  it('still quits when the final session save fails', async () => {
    flushSessionSaveMock.mockRejectedValueOnce(new Error('disk full'));
    render(<Harness />);
    await waitFor(() => expect(listeners.has(EVENT_DESKTOP_CONTROL_ACTION)).toBe(true));

    await emitDesktopAction('quit');

    await waitFor(() => expect(desktopQuitApplicationMock).toHaveBeenCalledTimes(1));
  });
});
