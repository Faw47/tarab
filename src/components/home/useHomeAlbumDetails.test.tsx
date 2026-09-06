import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Track } from '../../types';
import type { HomeAlbumDetails } from './homeTypes';

const fetchCompleteAlbumTracksMock = vi.hoisted(() => vi.fn());
const reportErrorMock = vi.hoisted(() => vi.fn());

vi.mock('./useHomeLibraryModel', () => ({
  fetchCompleteAlbumTracks: fetchCompleteAlbumTracksMock,
}));
vi.mock('../../lib/report-error', () => ({
  reportError: reportErrorMock,
}));

import { useHomeAlbumDetailsLoader } from './useHomeAlbumDetails';

const makeTrack = (id: string): Track => ({
  id,
  title: id,
  artist: 'Artist',
  albumArtist: 'Artist',
  album: 'Album',
  year: 2024,
  duration: 180,
  filePath: '/music/' + id + '.mp3',
  hasCoverArt: false,
  dateAdded: 1,
});

const payload = (album: string, track: Track): HomeAlbumDetails => ({
  album,
  artist: 'Artist',
  tracks: [track],
});

describe('useHomeAlbumDetailsLoader', () => {
  it('opens only the most recently requested album when responses finish out of order', async () => {
    let resolveFirst!: (tracks: Track[]) => void;
    let resolveSecond!: (tracks: Track[]) => void;
    const first = new Promise<Track[]>((resolve) => {
      resolveFirst = resolve;
    });
    const second = new Promise<Track[]>((resolve) => {
      resolveSecond = resolve;
    });
    const firstTrack = makeTrack('first');
    const secondTrack = makeTrack('second');
    fetchCompleteAlbumTracksMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const onOpenAlbumDetails = vi.fn();
    const firstPayload = payload('First album', firstTrack);
    const secondPayload = payload('Second album', secondTrack);

    const { result } = renderHook(() => useHomeAlbumDetailsLoader(onOpenAlbumDetails, 'home-view'));

    let firstRequest!: Promise<void>;
    let secondRequest!: Promise<void>;
    await act(async () => {
      firstRequest = result.current(firstPayload);
      secondRequest = result.current(secondPayload);
      resolveSecond([secondTrack]);
      await secondRequest;
      resolveFirst([firstTrack]);
      await firstRequest;
    });

    expect(onOpenAlbumDetails).toHaveBeenCalledTimes(1);
    expect(onOpenAlbumDetails).toHaveBeenCalledWith({
      ...secondPayload,
      tracks: [secondTrack],
    });
    expect(reportErrorMock).not.toHaveBeenCalled();
  });

  it('does not report an error from a stale album request', async () => {
    let rejectFirst!: (error: Error) => void;
    let resolveSecond!: (tracks: Track[]) => void;
    const first = new Promise<Track[]>((_, reject) => {
      rejectFirst = reject;
    });
    const second = new Promise<Track[]>((resolve) => {
      resolveSecond = resolve;
    });
    const firstTrack = makeTrack('first');
    const secondTrack = makeTrack('second');
    fetchCompleteAlbumTracksMock.mockReturnValueOnce(first).mockReturnValueOnce(second);
    const onOpenAlbumDetails = vi.fn();
    const { result } = renderHook(() => useHomeAlbumDetailsLoader(onOpenAlbumDetails, 'home-neo'));

    let firstRequest!: Promise<void>;
    let secondRequest!: Promise<void>;
    await act(async () => {
      firstRequest = result.current(payload('First album', firstTrack));
      secondRequest = result.current(payload('Second album', secondTrack));
      rejectFirst(new Error('stale failure'));
      await firstRequest;
      resolveSecond([secondTrack]);
      await secondRequest;
    });

    expect(onOpenAlbumDetails).toHaveBeenCalledTimes(1);
    expect(reportErrorMock).not.toHaveBeenCalled();
  });
});
