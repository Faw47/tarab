import { act, render, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../../store/player-store';
import type { Track } from '../../../types';
import { resetPlaybackGenerationForTests } from '../playback-generation';
import { usePlayerSessionRestore } from '../usePlayerSessionRestore';

const {
  loadPlayerStateFromStoreMock,
  markPlayerStateHydratedMock,
  reportErrorMock,
  dbGetTracksByIdsMock,
  dbGetTracksByAlbumArtistMock,
  setAudioPlaybackSpeedMock,
  setAudioVolumeMock,
  replaceViewMock,
  navigateViewMock,
} = vi.hoisted(() => ({
  loadPlayerStateFromStoreMock: vi.fn(),
  markPlayerStateHydratedMock: vi.fn(),
  reportErrorMock: vi.fn(),
  dbGetTracksByIdsMock: vi.fn(),
  dbGetTracksByAlbumArtistMock: vi.fn(),
  setAudioPlaybackSpeedMock: vi.fn(async () => undefined),
  setAudioVolumeMock: vi.fn(async () => undefined),
  replaceViewMock: vi.fn(),
  navigateViewMock: vi.fn(),
}));

vi.mock('../player-state-store', () => ({
  loadPlayerStateFromStore: loadPlayerStateFromStoreMock,
  markPlayerStateHydrated: markPlayerStateHydratedMock,
}));

vi.mock('../../../lib/report-error', () => ({ reportError: reportErrorMock }));

vi.mock('../../../lib/tauri-commands', () => ({
  dbGetTracksByIds: dbGetTracksByIdsMock,
  dbGetTracksByAlbumArtist: dbGetTracksByAlbumArtistMock,
  setPlaybackSpeed: setAudioPlaybackSpeedMock,
  setVolume: setAudioVolumeMock,
}));

const restoredTrack: Track = {
  id: 'restored-track',
  title: 'Restored',
  artist: 'Artist',
  album: 'Album',
  year: 2024,
  duration: 180,
  filePath: '/music/restored.mp3',
  hasCoverArt: false,
  coverArtHash: null,
  blurhash: 'session-blurhash',
  fileFormat: 'FLAC',
  bitrate: 1411,
  sampleRate: 96000,
  fileSize: 1234,
  dateAdded: 1,
};

const liveTrack: Track = {
  ...restoredTrack,
  id: 'live-track',
  title: 'Live',
  filePath: '/music/live.mp3',
};

const session = {
  version: 2,
  revision: 1,
  currentTrackId: restoredTrack.id,
  queueIds: [restoredTrack.id],
  queueIndex: 0,
  currentTime: 45,
  playbackSpeed: 1.25,
  volume: 0.6,
  wasPlaying: true,
  shuffleEnabled: false,
  loopMode: 'all' as const,
  stopAfterCurrent: false,
  lastView: 'home' as const,
  lastOpenedAlbum: null,
  lastOpenedArtist: null,
  timestamp: 1,
};

const initialPlayerState = usePlayerStore.getState();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function Harness({ currentView = 'home' }: { currentView?: 'home' | 'search' }) {
  usePlayerSessionRestore({
    replaceView: replaceViewMock,
    navigateView: navigateViewMock,
    currentView,
  });
  return null;
}

describe('usePlayerSessionRestore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetPlaybackGenerationForTests();
    usePlayerStore.setState(initialPlayerState, true);
    loadPlayerStateFromStoreMock.mockResolvedValue(session);
    dbGetTracksByIdsMock.mockResolvedValue([restoredTrack]);
    dbGetTracksByAlbumArtistMock.mockResolvedValue([]);
  });

  it('restores and marks hydration under React StrictMode', async () => {
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );

    await waitFor(() => expect(usePlayerStore.getState().currentTrack?.id).toBe(restoredTrack.id));
    expect(usePlayerStore.getState().currentTime).toBe(45);
    expect(usePlayerStore.getState().currentTrack).toEqual(
      expect.objectContaining({
        blurhash: 'session-blurhash',
        fileFormat: 'FLAC',
        bitrate: 1411,
        sampleRate: 96000,
        fileSize: 1234,
      }),
    );
    expect(markPlayerStateHydratedMock).toHaveBeenCalledTimes(1);
  });

  it('does not overwrite playback that starts while restore data is loading', async () => {
    const tracks = deferred<Track[]>();
    dbGetTracksByIdsMock.mockReturnValueOnce(tracks.promise);
    render(<Harness />);
    await waitFor(() => expect(dbGetTracksByIdsMock).toHaveBeenCalledTimes(1));

    act(() => {
      usePlayerStore.setState({
        currentTrack: liveTrack,
        queue: [liveTrack],
        queueIndex: 0,
        isPlaying: true,
        hasActivePlayback: true,
      });
      usePlayerStore.getState().setLyrics(null);
    });
    tracks.resolve([restoredTrack]);

    await waitFor(() => expect(markPlayerStateHydratedMock).toHaveBeenCalledTimes(1));
    expect(usePlayerStore.getState().currentTrack?.id).toBe(liveTrack.id);
    expect(usePlayerStore.getState().isPlaying).toBe(true);
    expect(usePlayerStore.getState().hasActivePlayback).toBe(true);
  });

  it('ignores mount-only player writes while restore data is loading', async () => {
    const tracks = deferred<Track[]>();
    dbGetTracksByIdsMock.mockReturnValueOnce(tracks.promise);
    render(<Harness />);
    await waitFor(() => expect(dbGetTracksByIdsMock).toHaveBeenCalledTimes(1));

    act(() => {
      const player = usePlayerStore.getState();
      player.setLyrics(null);
      player.setShuffleHistorySize(80);
    });
    tracks.resolve([restoredTrack]);

    await waitFor(() => expect(usePlayerStore.getState().currentTrack?.id).toBe(restoredTrack.id));
    expect(usePlayerStore.getState().shuffleHistorySize).toBe(80);
    expect(markPlayerStateHydratedMock).toHaveBeenCalledTimes(1);
  });

  it('restores the current duplicate as the exact queued occurrence', async () => {
    loadPlayerStateFromStoreMock.mockResolvedValue({
      ...session,
      queueIds: [restoredTrack.id, restoredTrack.id],
      queueIndex: 1,
    });

    render(<Harness />);

    await waitFor(() => expect(usePlayerStore.getState().queue).toHaveLength(2));
    const state = usePlayerStore.getState();
    expect(state.queue[0]._queueId).not.toBe(state.queue[1]._queueId);
    expect(state.currentTrack).toBe(state.queue[1]);
    expect(state.currentTrack?._queueId).toBe(state.queue[1]._queueId);
    expect(state.queueIndex).toBe(1);
  });

  it('preserves hydration safety when the session track lookup fails', async () => {
    const error = new Error('database unavailable');
    dbGetTracksByIdsMock.mockRejectedValue(error);
    render(<Harness />);

    await waitFor(() => expect(dbGetTracksByIdsMock).toHaveBeenCalledTimes(2));
    expect(markPlayerStateHydratedMock).not.toHaveBeenCalled();
    expect(reportErrorMock).toHaveBeenCalledWith('Failed to restore playback session', {
      source: 'app-startup',
      error,
    });
    expect(usePlayerStore.getState().currentTrack).toBeNull();
  });
  it('restores an album on top of the startup view so Back remains available', async () => {
    loadPlayerStateFromStoreMock.mockResolvedValue({
      ...session,
      lastView: 'album',
      lastOpenedAlbum: restoredTrack.album,
      lastOpenedArtist: restoredTrack.artist,
    });
    dbGetTracksByAlbumArtistMock.mockResolvedValue([restoredTrack]);

    render(<Harness />);

    await waitFor(() =>
      expect(navigateViewMock).toHaveBeenCalledWith(
        'album',
        expect.objectContaining({
          albumDetails: expect.objectContaining({
            album: restoredTrack.album,
            artist: restoredTrack.artist,
            tracks: [
              expect.objectContaining({
                id: restoredTrack.id,
                title: restoredTrack.title,
                filePath: restoredTrack.filePath,
              }),
            ],
          }),
        }),
      ),
    );
    expect(replaceViewMock).not.toHaveBeenCalledWith('album', expect.anything());
  });

  it('does not replace navigation that changes while restore data is loading', async () => {
    const tracks = deferred<Track[]>();
    dbGetTracksByIdsMock.mockReturnValueOnce(tracks.promise);
    const view = render(<Harness />);
    await waitFor(() => expect(dbGetTracksByIdsMock).toHaveBeenCalledTimes(1));

    view.rerender(<Harness currentView="search" />);
    tracks.resolve([restoredTrack]);

    await waitFor(() => expect(markPlayerStateHydratedMock).toHaveBeenCalledTimes(1));
    expect(replaceViewMock).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().currentTrack).toBeNull();
  });
});
