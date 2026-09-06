import { beforeEach, describe, expect, it, vi } from 'vitest';

const { dbGetTracksByIdsMock, dbSearchTracksMock, searchLyricsMock } = vi.hoisted(() => ({
  dbGetTracksByIdsMock: vi.fn(),
  dbSearchTracksMock: vi.fn(),
  searchLyricsMock: vi.fn(),
}));

vi.mock('../../../lib/tauri-commands', () => ({
  dbGetTracksByIds: dbGetTracksByIdsMock,
  dbSearchTracks: dbSearchTracksMock,
  searchLyrics: searchLyricsMock,
}));

import { fetchLibrarySearch, mapDbTrackToTrack } from '../api';

const metadataResult = {
  id: 'track-metadata',
  title: 'Metadata result',
  artist: 'Artist',
  album: 'Album',
  duration: 180,
  filePath: '/music/metadata.mp3',
  coverArtHash: null,
  blurhash: null,
};

const lyricsResult = {
  id: 'track-lyrics',
  title: 'Lyrics result',
  artist: 'Artist',
  album: 'Album',
  duration: 200,
  filePath: '/music/lyrics.mp3',
  coverArtHash: null,
  blurhash: null,
  matchedLine: 'the matching line',
  matchedLineIndex: 3,
};

const hydratedTrack = (id: string, title: string, filePath: string) => ({
  id,
  title,
  artist: 'Artist',
  albumArtist: null,
  album: 'Album',
  year: 2024,
  trackNumber: 1,
  discNumber: 1,
  duration: 180,
  filePath,
  hasCoverArt: false,
  coverArtHash: null,
  dateAdded: 1,
  playCount: 0,
  lastPlayed: null,
  rating: null,
  blurhash: null,
});

describe('library track mapping', () => {
  it('preserves an indexed genre on the frontend track', () => {
    const track = mapDbTrackToTrack({
      id: '/music/classical.mp3',
      title: 'Classical',
      artist: 'Artist',
      albumArtist: null,
      album: 'Album',
      genre: 'Classical',
      year: 2024,
      trackNumber: 1,
      discNumber: 1,
      duration: 180,
      filePath: '/music/classical.mp3',
      hasCoverArt: false,
      coverArtHash: null,
      dateAdded: 1,
      playCount: 0,
      lastPlayed: null,
      rating: null,
      blurhash: null,
      fileFormat: 'MP3',
      bitrate: null,
      sampleRate: null,
      fileSize: null,
    });

    expect(track.genre).toBe('Classical');
  });
});

describe('fetchLibrarySearch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbGetTracksByIdsMock.mockResolvedValue([]);
  });

  it('keeps metadata results when the lyrics index is unavailable', async () => {
    dbSearchTracksMock.mockResolvedValue([metadataResult]);
    searchLyricsMock.mockRejectedValue(new Error('lyrics index unavailable'));
    dbGetTracksByIdsMock.mockResolvedValue([
      hydratedTrack('track-metadata', 'Metadata result', '/music/metadata.mp3'),
    ]);

    await expect(fetchLibrarySearch('metadata')).resolves.toMatchObject({
      unavailableBranches: ['lyrics'],
      metadata: [expect.objectContaining({ id: 'track-metadata', title: 'Metadata result' })],
      lyrics: [],
    });
    expect(dbGetTracksByIdsMock).toHaveBeenCalledWith(['track-metadata']);
  });

  it('keeps lyrics results when the metadata query is unavailable', async () => {
    dbSearchTracksMock.mockRejectedValue(new Error('metadata query unavailable'));
    searchLyricsMock.mockResolvedValue([lyricsResult]);
    dbGetTracksByIdsMock.mockResolvedValue([
      hydratedTrack('track-lyrics', 'Lyrics result', '/music/lyrics.mp3'),
    ]);

    await expect(fetchLibrarySearch('lyrics')).resolves.toMatchObject({
      unavailableBranches: ['metadata'],
      metadata: [],
      lyrics: [
        expect.objectContaining({
          id: 'track-lyrics',
          matchedLine: 'the matching line',
          matchedLineIndex: 3,
        }),
      ],
    });
    expect(dbGetTracksByIdsMock).toHaveBeenCalledWith(['track-lyrics']);
  });

  it('keeps validated search rows when detail hydration fails', async () => {
    dbSearchTracksMock.mockResolvedValue([metadataResult]);
    searchLyricsMock.mockResolvedValue([]);
    dbGetTracksByIdsMock.mockRejectedValue(new Error('details temporarily unavailable'));

    await expect(fetchLibrarySearch('metadata')).resolves.toMatchObject({
      unavailableBranches: [],
      metadata: [expect.objectContaining({ id: 'track-metadata', title: 'Metadata result' })],
      lyrics: [],
    });
  });

  it('still rejects when every requested search branch fails', async () => {
    const metadataError = new Error('metadata query unavailable');
    dbSearchTracksMock.mockRejectedValue(metadataError);
    searchLyricsMock.mockRejectedValue(new Error('lyrics index unavailable'));

    await expect(fetchLibrarySearch('broken')).rejects.toBe(metadataError);
    expect(dbGetTracksByIdsMock).not.toHaveBeenCalled();
  });
});
