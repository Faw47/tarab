import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../types';
import { useAlbumActions } from './useAlbumActions';

const { shuffleTracksMock, startPlaybackMock, reportErrorMock } = vi.hoisted(() => ({
  shuffleTracksMock: vi.fn(),
  startPlaybackMock: vi.fn(),
  reportErrorMock: vi.fn(),
}));

vi.mock('../features/library/loadTracksForShuffle', () => ({
  shuffleTracks: shuffleTracksMock,
}));

vi.mock('../lib/playback-actions', () => ({
  startPlayback: startPlaybackMock,
}));

vi.mock('../lib/report-error', () => ({
  reportError: reportErrorMock,
}));

const makeTrack = (id: string): Track => ({
  id,
  title: id,
  artist: 'Artist',
  album: 'Album',
  year: 2024,
  duration: 180,
  filePath: '/music/' + id + '.mp3',
  hasCoverArt: false,
  dateAdded: 1,
});

describe('useAlbumActions shuffle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startPlaybackMock.mockResolvedValue(undefined);
  });

  it('uses the shared unbiased shuffle order for album playback', async () => {
    const first = makeTrack('first');
    const second = makeTrack('second');
    const albumDetails = {
      album: 'Album',
      artist: 'Artist',
      tracks: [first, second],
    };
    shuffleTracksMock.mockReturnValue([second, first]);

    const { result } = renderHook(() =>
      useAlbumActions({
        albumDetails,
        setShowFullPlayer: vi.fn(),
        openAlbumDetails: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.handleShuffleAlbum();
    });

    expect(shuffleTracksMock).toHaveBeenCalledWith(albumDetails.tracks);
    expect(startPlaybackMock).toHaveBeenCalledWith(second, {
      queue: [second, first],
      queueIndex: 0,
      shuffleEnabled: true,
    });
    expect(reportErrorMock).not.toHaveBeenCalled();
  });
});
