import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../../types';
import { useAppCommandActions } from '../useAppCommandActions';

const {
  getSmartShuffleQueueMock,
  loadTracksForShuffleMock,
  playAdjacentTrackMock,
  startPlaybackMock,
  toggleCurrentPlaybackMock,
  reportErrorMock,
} = vi.hoisted(() => ({
  getSmartShuffleQueueMock: vi.fn(),
  loadTracksForShuffleMock: vi.fn(),
  playAdjacentTrackMock: vi.fn(),
  startPlaybackMock: vi.fn(),
  toggleCurrentPlaybackMock: vi.fn(),
  reportErrorMock: vi.fn(),
}));
const loadLargeShufflePlanMock = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/playback-actions', () => ({
  startPlayback: startPlaybackMock,
  playAdjacentTrack: playAdjacentTrackMock,
  toggleCurrentPlayback: toggleCurrentPlaybackMock,
}));

vi.mock('../../../lib/report-error', () => ({
  reportError: reportErrorMock,
}));

vi.mock('../../../lib/tauri-commands', () => ({
  getSmartShuffleQueue: getSmartShuffleQueueMock,
  revealInFileManager: vi.fn(),
}));

vi.mock('../../../store/settings-store', () => ({
  useSettingsStore: {
    getState: () => ({ smartShuffleEnabled: true }),
  },
}));

vi.mock('../../library/loadTracksForShuffle', () => ({
  loadTracksForShuffle: loadTracksForShuffleMock,
  SHUFFLE_PAGE_SIZE: 1000,
  shuffleTracks: (tracks: Track[]) => tracks,
}));

vi.mock('../../library/loadLargeShufflePlan', () => ({
  loadLargeShufflePlan: loadLargeShufflePlanMock,
}));

const track: Track = {
  id: 'track-1',
  title: 'Track 1',
  artist: 'Artist',
  album: 'Album',
  year: null,
  duration: 180,
  filePath: '/music/track-1.mp3',
  hasCoverArt: false,
  dateAdded: 1,
};

const createOptions = (totalTracks = 2) => ({
  libraryTracks: [track],
  totalTracks,
  isScanning: false,
  rescanAll: vi.fn(async () => undefined),
  addToQueue: vi.fn(),
  addTracksToQueue: vi.fn(),
  openTagEditor: vi.fn(),
  startProcessing: vi.fn(() => 'shuffle-task'),
  updateProcessing: vi.fn(),
  finishProcessing: vi.fn(),
});

describe('useAppCommandActions shuffle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadTracksForShuffleMock.mockResolvedValue([track]);
    getSmartShuffleQueueMock.mockResolvedValue([track.id]);
    startPlaybackMock.mockResolvedValue(undefined);
    loadLargeShufflePlanMock.mockResolvedValue({ orderedIds: [track.id], firstTrack: track });
    playAdjacentTrackMock.mockResolvedValue(null);
    toggleCurrentPlaybackMock.mockResolvedValue(undefined);
    reportErrorMock.mockReset();
  });

  it('reports snapshot progress and keeps shuffle enabled for Smart Shuffle', async () => {
    const options = createOptions();
    const { result } = renderHook(() =>
      useAppCommandActions(options as unknown as Parameters<typeof useAppCommandActions>[0]),
    );

    await act(async () => {
      await result.current.handleShuffleAll();
    });

    expect(options.startProcessing).toHaveBeenCalledWith('Preparing library shuffle');
    expect(startPlaybackMock).toHaveBeenCalledWith(
      track,
      expect.objectContaining({ queue: [track], shuffleEnabled: true }),
    );
    expect(options.finishProcessing).toHaveBeenCalledWith('shuffle-task');
  });

  it('does not start a second snapshot while the first is in flight', async () => {
    let resolveSnapshot!: (tracks: Track[]) => void;
    loadTracksForShuffleMock.mockReturnValueOnce(
      new Promise<Track[]>((resolve) => {
        resolveSnapshot = resolve;
      }),
    );
    const options = createOptions(1);
    const { result } = renderHook(() =>
      useAppCommandActions(options as unknown as Parameters<typeof useAppCommandActions>[0]),
    );

    let firstPromise!: Promise<void>;
    act(() => {
      firstPromise = result.current.handleShuffleAll();
      void result.current.handleShuffleAll();
    });

    expect(loadTracksForShuffleMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveSnapshot([track]);
      await firstPromise;
    });
  });

  it('adds selected tracks through one batch queue action', () => {
    const options = createOptions(1);
    const secondTrack = { ...track, id: 'track-2', filePath: '/music/track-2.mp3' };
    const { result } = renderHook(() =>
      useAppCommandActions(options as unknown as Parameters<typeof useAppCommandActions>[0]),
    );

    act(() => {
      result.current.handleAddTracksToQueue([track, secondTrack]);
    });

    expect(options.addTracksToQueue).toHaveBeenCalledOnce();
    expect(options.addTracksToQueue).toHaveBeenCalledWith([track, secondTrack]);
    expect(options.addToQueue).not.toHaveBeenCalled();
  });

  it('absorbs playback command failures and reports them', async () => {
    const options = createOptions(1);
    const { result } = renderHook(() =>
      useAppCommandActions(options as unknown as Parameters<typeof useAppCommandActions>[0]),
    );
    const error = new Error('audio unavailable');
    playAdjacentTrackMock.mockRejectedValueOnce(error);
    toggleCurrentPlaybackMock.mockRejectedValueOnce(error);

    await act(async () => {
      await result.current.handleNextTrack();
      await result.current.handleTogglePlayback();
    });

    expect(reportErrorMock).toHaveBeenNthCalledWith(
      1,
      'Failed to play next track',
      expect.objectContaining({ source: 'app-command-actions', error }),
    );
    expect(reportErrorMock).toHaveBeenNthCalledWith(
      2,
      'Playback toggle failed',
      expect.objectContaining({ source: 'app-command-actions', error }),
    );
  });
});
