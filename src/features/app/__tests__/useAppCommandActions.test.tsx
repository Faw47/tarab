import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../../types';
import { useAppCommandActions } from '../useAppCommandActions';

const { fetchLibraryTrackByIdMock, getShuffleAllQueueMock, startPlaybackMock } = vi.hoisted(() => ({
  fetchLibraryTrackByIdMock: vi.fn(),
  getShuffleAllQueueMock: vi.fn(),
  startPlaybackMock: vi.fn(async () => undefined),
}));

vi.mock('../../library/api', () => ({
  fetchLibraryTrackById: fetchLibraryTrackByIdMock,
}));

vi.mock('../../../lib/tauri-commands', () => ({
  dbGetShuffleAllQueue: getShuffleAllQueueMock,
  revealInFileManager: vi.fn(async () => undefined),
}));

vi.mock('../../../lib/playback-actions', () => ({
  playAdjacentTrack: vi.fn(async () => null),
  startPlayback: startPlaybackMock,
  toggleCurrentPlayback: vi.fn(async () => undefined),
}));

vi.mock('../../../lib/report-error', () => ({
  reportError: vi.fn(),
}));

vi.mock('../../../store/settings-store', () => ({
  useSettingsStore: {
    getState: () => ({ smartShuffleEnabled: true }),
  },
}));

const firstTrack: Track = {
  id: '/music/a.flac',
  title: 'A',
  artist: 'Artist',
  album: 'Album',
  year: 2024,
  duration: 180,
  filePath: '/music/a.flac',
  hasCoverArt: true,
  coverArtHash: 'cover-a',
  dateAdded: 1,
};

describe('useAppCommandActions shuffle all', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getShuffleAllQueueMock.mockResolvedValue([
      { id: '/music/a.flac', duration: 180 },
      { id: '/music/b.flac', duration: 210 },
    ]);
    fetchLibraryTrackByIdMock.mockResolvedValue(firstTrack);
  });

  it('requests a server-side shuffle and hydrates only the first track', async () => {
    let shuffleAll: (() => Promise<void>) | null = null;
    function Harness() {
      const actions = useAppCommandActions({
        totalTracks: 2,
        isScanning: false,
        rescanAll: async () => undefined,
        addToQueue: () => undefined,
        openTagEditor: () => undefined,
      });
      shuffleAll = actions.handleShuffleAll;
      return null;
    }

    render(<Harness />);
    await act(async () => {
      await shuffleAll?.();
    });

    expect(getShuffleAllQueueMock).toHaveBeenCalledWith(true);
    expect(fetchLibraryTrackByIdMock).toHaveBeenCalledTimes(1);
    expect(fetchLibraryTrackByIdMock).toHaveBeenCalledWith('/music/a.flac');
    const [track, options] = startPlaybackMock.mock.calls[0];
    expect(track).toEqual(firstTrack);
    expect(options.queue).toHaveLength(2);
    expect(options.queue[0]).toEqual(firstTrack);
    expect(options.queue[1]).toMatchObject({
      id: '/music/b.flac',
      duration: 210,
      filePath: '/music/b.flac',
      _lazyQueueEntry: true,
    });
    expect(options).toMatchObject({ queueIndex: 0, shuffleEnabled: true });
  });
});
