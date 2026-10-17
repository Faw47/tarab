import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../../store/player-store';
import { useSettingsStore } from '../../../store/settings-store';
import type { DesktopControlAction } from '../../../types';
import {
  EVENT_DESKTOP_CONTROL_ACTION,
  EVENT_DESKTOP_PLAYBACK_SNAPSHOT,
  EVENT_DESKTOP_SEEK,
  EVENT_DESKTOP_SNAPSHOT_REQUEST,
  MINI_WINDOW_LABEL,
} from '../desktop-events';
import { useDesktopIntegration } from '../useDesktopIntegration';

const {
  listeners,
  emitToMock,
  listenMock,
  desktopSetNativeUiStateMock,
  desktopSyncMediaSessionMock,
  desktopFocusMainWindowMock,
  desktopQuitApplicationMock,
  desktopToggleMiniWindowMock,
  desktopCloseMiniWindowMock,
  getCoverArtDataMock,
  pauseCurrentPlaybackMock,
  resumeCurrentPlaybackMock,
  toggleCurrentPlaybackMock,
  playAdjacentTrackMock,
  seekToPositionMock,
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
    desktopSyncMediaSessionMock: vi.fn(async (_payload: unknown) => true),
    desktopFocusMainWindowMock: vi.fn(async () => undefined),
    desktopQuitApplicationMock: vi.fn(async () => undefined),
    desktopToggleMiniWindowMock: vi.fn(async () => undefined),
    desktopCloseMiniWindowMock: vi.fn(async () => undefined),
    getCoverArtDataMock: vi.fn(async () => null),
    pauseCurrentPlaybackMock: vi.fn(async () => undefined),
    resumeCurrentPlaybackMock: vi.fn(async () => undefined),
    toggleCurrentPlaybackMock: vi.fn(async () => undefined),
    playAdjacentTrackMock: vi.fn(async () => undefined),
    seekToPositionMock: vi.fn(async () => undefined),
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
}));

vi.mock('../../../lib/tauri-commands', () => ({
  desktopSetNativeUiState: desktopSetNativeUiStateMock,
  desktopSyncMediaSession: desktopSyncMediaSessionMock,
  desktopFocusMainWindow: desktopFocusMainWindowMock,
  desktopQuitApplication: desktopQuitApplicationMock,
  desktopToggleMiniWindow: desktopToggleMiniWindowMock,
  desktopCloseMiniWindow: desktopCloseMiniWindowMock,
  getCoverArtData: getCoverArtDataMock,
}));

vi.mock('../../../lib/playback-actions', () => ({
  pauseCurrentPlayback: pauseCurrentPlaybackMock,
  resumeCurrentPlayback: resumeCurrentPlaybackMock,
  toggleCurrentPlayback: toggleCurrentPlaybackMock,
  playAdjacentTrack: playAdjacentTrackMock,
  seekToPosition: seekToPositionMock,
}));

vi.mock('../../../lib/report-error', () => ({
  reportError: vi.fn(),
}));

const initialPlayerState = usePlayerStore.getState();
const initialSettingsState = useSettingsStore.getState();

function Harness() {
  useDesktopIntegration();
  return null;
}

async function emitDesktopAction(action: DesktopControlAction) {
  const handler = listeners.get(EVENT_DESKTOP_CONTROL_ACTION);
  expect(handler).toBeTruthy();
  await handler?.({ payload: action });
}

async function emitDesktopSeek(positionSecs: number) {
  const handler = listeners.get(EVENT_DESKTOP_SEEK);
  expect(handler).toBeTruthy();
  await handler?.({ payload: { positionSecs } });
}

describe('useDesktopIntegration', () => {
  beforeEach(() => {
    listeners.clear();
    vi.clearAllMocks();

    usePlayerStore.setState(initialPlayerState, true);
    useSettingsStore.setState(initialSettingsState, true);

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

  it('sends media metadata and artwork once per track, then only playback state', async () => {
    vi.useFakeTimers();
    getCoverArtDataMock.mockResolvedValue(['image/jpeg', 'BASE64-ART'] as never);
    const track = usePlayerStore.getState().currentTrack;
    usePlayerStore.setState({
      currentTrack: track ? { ...track, hasCoverArt: true, coverArtHash: 'hash-1' } : null,
      isPlaying: true,
    });

    render(<Harness />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });

    const payloads = desktopSyncMediaSessionMock.mock.calls.map(
      (call) => (call as unknown as [Record<string, unknown>])[0],
    );
    expect(payloads.length).toBeGreaterThanOrEqual(3);
    expect(payloads[0]).toMatchObject({
      artworkDataBase64: 'BASE64-ART',
      metadataUnchanged: false,
    });
    for (const later of payloads.slice(1)) {
      expect(later).toMatchObject({ artworkDataBase64: null, metadataUnchanged: true });
    }
  });

  it('resends media metadata when the OS media session did not accept it', async () => {
    vi.useFakeTimers();
    desktopSyncMediaSessionMock.mockResolvedValueOnce(false);
    usePlayerStore.setState({ isPlaying: true });

    render(<Harness />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });

    const payloads = desktopSyncMediaSessionMock.mock.calls.map(
      (call) => (call as unknown as [Record<string, unknown>])[0],
    );
    expect(payloads.length).toBeGreaterThanOrEqual(2);
    expect(payloads[0]).toMatchObject({ metadataUnchanged: false });
    expect(payloads[1]).toMatchObject({ metadataUnchanged: false, title: 'Song' });
  });

  it('leaves closing a disabled mini window to the native UI state sync', async () => {
    useSettingsStore.setState({ desktopMiniWindowEnabled: false });

    render(<Harness />);
    await waitFor(() => {
      expect(desktopSetNativeUiStateMock).toHaveBeenCalled();
    });
    await act(async () => {
      usePlayerStore.setState({ isPlaying: true });
    });
    await waitFor(() => {
      expect(desktopSetNativeUiStateMock).toHaveBeenCalledTimes(2);
    });

    expect(desktopSetNativeUiStateMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ miniWindowEnabled: false }),
    );
    expect(desktopCloseMiniWindowMock).not.toHaveBeenCalled();
  });

  it('sends artwork again when a track gains cover art without a hash', async () => {
    vi.useFakeTimers();
    getCoverArtDataMock.mockResolvedValue(['image/jpeg', 'NEW-ART'] as never);
    usePlayerStore.setState({ isPlaying: true });

    render(<Harness />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    const track = usePlayerStore.getState().currentTrack;
    await act(async () => {
      usePlayerStore.setState({
        currentTrack: track ? { ...track, hasCoverArt: true, coverArtHash: null } : null,
      });
      await vi.advanceTimersByTimeAsync(2100);
    });

    const payloads = desktopSyncMediaSessionMock.mock.calls.map(
      (call) => (call as unknown as [Record<string, unknown>])[0],
    );
    expect(payloads).toContainEqual(
      expect.objectContaining({ artworkDataBase64: 'NEW-ART', metadataUnchanged: false }),
    );
  });

  it('drops a media sync whose artwork arrives after a newer track was synced', async () => {
    vi.useFakeTimers();
    let resolveSlowArt: (value: [string, string]) => void = () => undefined;
    getCoverArtDataMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSlowArt = resolve;
        }) as never,
    );
    const track = usePlayerStore.getState().currentTrack;
    if (!track) throw new Error('missing track');
    usePlayerStore.setState({
      currentTrack: { ...track, hasCoverArt: true, coverArtHash: 'hash-1' },
    });

    render(<Harness />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(900);
    });
    await act(async () => {
      usePlayerStore.setState({
        currentTrack: { ...track, id: 'track-2', title: 'Second', filePath: '/music/two.mp3' },
      });
      await vi.advanceTimersByTimeAsync(10);
    });
    await act(async () => {
      resolveSlowArt(['image/jpeg', 'OLD-ART']);
      await vi.advanceTimersByTimeAsync(10);
    });

    const titles = desktopSyncMediaSessionMock.mock.calls.map(
      (call) => (call as unknown as [Record<string, unknown>])[0].title,
    );
    expect(titles).toEqual(['Second']);
  });

  it('routes desktop control actions to playback handlers', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has(EVENT_DESKTOP_CONTROL_ACTION)).toBe(true);
    });

    await emitDesktopAction('next');

    expect(playAdjacentTrackMock).toHaveBeenCalledWith('next');
  });

  it('handles idempotent desktop play and pause actions', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has(EVENT_DESKTOP_CONTROL_ACTION)).toBe(true);
    });

    await emitDesktopAction('play');
    expect(resumeCurrentPlaybackMock).toHaveBeenCalledTimes(1);
    expect(pauseCurrentPlaybackMock).not.toHaveBeenCalled();

    usePlayerStore.setState({ isPlaying: true });
    await emitDesktopAction('pause');
    expect(pauseCurrentPlaybackMock).toHaveBeenCalledTimes(1);
  });

  it('deduplicates burst duplicate desktop actions', async () => {
    const nowSpy = vi
      .spyOn(Date, 'now')
      .mockReturnValue(new Date('2026-01-01T00:00:00.000Z').getTime());

    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has(EVENT_DESKTOP_CONTROL_ACTION)).toBe(true);
    });

    await emitDesktopAction('next');
    await emitDesktopAction('next');

    expect(playAdjacentTrackMock).toHaveBeenCalledTimes(1);
    nowSpy.mockRestore();
  });

  it('does not toggle mini window when feature is disabled', async () => {
    useSettingsStore.setState({ desktopMiniWindowEnabled: false });

    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has(EVENT_DESKTOP_CONTROL_ACTION)).toBe(true);
    });

    await emitDesktopAction('toggle-mini');

    expect(desktopToggleMiniWindowMock).not.toHaveBeenCalled();
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
        track: expect.objectContaining({ id: 'track-1' }),
        isPlaying: false,
        position: 10,
      }),
    );
  });

  it('routes desktop seek events to seek handler', async () => {
    render(<Harness />);

    await waitFor(() => {
      expect(listeners.has(EVENT_DESKTOP_SEEK)).toBe(true);
    });

    await emitDesktopSeek(42);
    expect(seekToPositionMock).toHaveBeenCalledWith(42);
  });
});
