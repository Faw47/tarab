import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../types';
import { useHomeLibraryModel } from './useHomeLibraryModel';

const startPlayback = vi.fn();
const reportError = vi.fn();
const fetchAlbumTracksMock = vi.hoisted(() => vi.fn());
let tracks: Track[] = [];
let albumAggregates: Array<{ count: number; track: Track }> = [];

vi.mock('../../features/library/useLibraryData', () => ({
  useLibraryData: () => ({ tracks, libraryStats: null, albumAggregates }),
}));
vi.mock('../../features/library/api', () => ({
  fetchAlbumTracks: fetchAlbumTracksMock,
}));

vi.mock('../../lib/playback-actions', () => ({
  startPlayback: (...args: unknown[]) => startPlayback(...args),
}));

vi.mock('../../lib/report-error', () => ({
  reportError: (...args: unknown[]) => reportError(...args),
}));

const makeTrack = (id: string, overrides: Partial<Track> = {}): Track => ({
  id,
  title: overrides.title ?? id,
  artist: overrides.artist ?? 'Track artist',
  albumArtist: overrides.albumArtist ?? 'Album artist',
  album: overrides.album ?? 'Album',
  year: overrides.year ?? 2024,
  duration: overrides.duration ?? 180,
  filePath: overrides.filePath ?? `/music/${id}.mp3`,
  hasCoverArt: overrides.hasCoverArt ?? false,
  dateAdded: overrides.dateAdded ?? 1,
  trackNumber: overrides.trackNumber,
});

describe('useHomeLibraryModel', () => {
  beforeEach(() => {
    tracks = [];
    albumAggregates = [];
    vi.clearAllMocks();
    startPlayback.mockResolvedValue(undefined);
    fetchAlbumTracksMock.mockImplementation(async () => tracks);
  });

  it('groups tracks with the canonical album artist and preserves each album track list', () => {
    tracks = [
      makeTrack('one', { artist: 'Guest', albumArtist: 'Band' }),
      makeTrack('two', { artist: 'Band', albumArtist: 'Band' }),
      makeTrack('three', { album: 'Other album', albumArtist: 'Band' }),
    ];

    const { result } = renderHook(() => useHomeLibraryModel());

    expect(result.current.albums).toHaveLength(2);
    expect(result.current.albums[0]).toMatchObject({
      count: 2,
      tracks: [tracks[0], tracks[1]],
    });
    expect(result.current.albumTracksByKey.get(result.current.albums[0].key)).toEqual([
      tracks[0],
      tracks[1],
    ]);
  });

  it('uses full database album aggregates for Home counts and representatives', () => {
    const representative = makeTrack('representative', {
      album: 'Older album',
      albumArtist: 'Album artist',
    });
    tracks = [
      makeTrack('loaded', {
        album: 'Older album',
        albumArtist: 'Album artist',
      }),
    ];
    albumAggregates = [{ count: 12, track: representative }];

    const { result } = renderHook(() => useHomeLibraryModel());

    expect(result.current.albums).toEqual([
      {
        key: result.current.albums[0]?.key,
        track: representative,
        count: 12,
        tracks,
      },
    ]);
  });

  it('sorts album tracks before playback and reports playback failures', async () => {
    const second = makeTrack('second', { trackNumber: 2 });
    const first = makeTrack('first', { trackNumber: 1 });
    tracks = [second, first];
    const failure = new Error('backend unavailable');
    startPlayback.mockRejectedValueOnce(failure);

    const { result } = renderHook(() => useHomeLibraryModel());

    await act(async () => {
      await result.current.playAlbum(second, tracks);
    });

    expect(fetchAlbumTracksMock).toHaveBeenCalledWith('Album', 'Album artist');
    expect(startPlayback).toHaveBeenCalledWith(first, {
      queue: [first, second],
      queueIndex: 0,
      shuffleEnabled: false,
    });
    expect(reportError).toHaveBeenCalledWith('play album failed', {
      source: 'home-view',
      error: failure,
    });
  });
});
