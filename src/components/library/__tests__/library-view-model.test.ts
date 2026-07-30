import { describe, expect, it } from 'vitest';
import type { Track } from '../../../types';
import {
  applySmartFilter,
  buildDetailTracks,
  buildFacetCounts,
  buildFacetPayload,
  formatLongDuration,
} from '../library-view-model';

const mkTrack = (overrides: Partial<Track>): Track => ({
  id: overrides.id ?? `id-${Math.random()}`,
  title: overrides.title ?? 'Song',
  artist: overrides.artist ?? 'Artist',
  albumArtist: overrides.albumArtist ?? null,
  album: overrides.album ?? 'Album',
  year: overrides.year ?? 2024,
  duration: overrides.duration ?? 180,
  filePath: overrides.filePath ?? '/music/a.mp3',
  hasCoverArt: overrides.hasCoverArt ?? true,
  coverArtHash: overrides.coverArtHash ?? null,
  dateAdded: overrides.dateAdded ?? Date.now(),
  rating: overrides.rating ?? null,
  bitrate: overrides.bitrate,
  sampleRate: overrides.sampleRate,
  fileSize: overrides.fileSize,
  fileFormat: overrides.fileFormat,
  coverArt: overrides.coverArt,
  blurhash: overrides.blurhash,
});

describe('library-view-model', () => {
  it('applies smart filters for missing art and untagged', () => {
    const tracks = [
      mkTrack({ id: 'a', hasCoverArt: true }),
      mkTrack({ id: 'b', hasCoverArt: false }),
      mkTrack({ id: 'c', artist: 'Unknown Artist' }),
      mkTrack({ id: 'd', title: '' }),
    ];

    expect(applySmartFilter(tracks, 'missingArt').map((track) => track.id)).toEqual(['b']);
    expect(applySmartFilter(tracks, 'untagged').map((track) => track.id)).toEqual(['c', 'd']);
    expect(applySmartFilter(tracks, null)).toHaveLength(4);
  });

  it('builds facet counts with unique albums/artists and duration', () => {
    const tracks = [
      mkTrack({ id: 'a', album: 'A', artist: 'X', duration: 100 }),
      mkTrack({ id: 'b', album: 'A', artist: 'X', duration: 200 }),
      mkTrack({ id: 'c', album: 'B', artist: 'Y', duration: 300 }),
    ];

    expect(buildFacetCounts(tracks)).toEqual({
      all: 3,
      albums: 2,
      artists: 2,
      recent: 3,
      mostPlayed: 0,
      duration: 600,
    });
  });

  it('builds detail tracks for album and artist scopes', () => {
    const tracks = [
      mkTrack({ id: 'a', album: 'Alpha', artist: 'Uno' }),
      mkTrack({ id: 'b', album: 'Alpha', artist: 'Uno' }),
      mkTrack({ id: 'c', album: 'Beta', artist: 'Uno' }),
      mkTrack({ id: 'd', album: 'Gamma', artist: 'Dos' }),
    ];

    const albumScope = buildDetailTracks(tracks, {
      type: 'album',
      album: 'Alpha',
      artist: 'Uno',
    });
    const artistScope = buildDetailTracks(tracks, { type: 'artist', artist: 'Uno' });

    expect(albumScope.map((track) => track.id)).toEqual(['a', 'b']);
    expect(artistScope.map((track) => track.id)).toEqual(['a', 'b', 'c']);
    expect(buildDetailTracks(tracks, null)).toEqual([]);
  });

  it('groups album detail tracks by album artist when present', () => {
    const tracks = [
      mkTrack({ id: 'a', album: 'Compilation', artist: 'Singer One', albumArtist: 'Various' }),
      mkTrack({ id: 'b', album: 'Compilation', artist: 'Singer Two', albumArtist: 'Various' }),
      mkTrack({ id: 'c', album: 'Compilation', artist: 'Singer Three', albumArtist: 'Other' }),
    ];

    expect(buildFacetCounts(tracks).albums).toBe(2);
    const albumScope = buildDetailTracks(tracks, {
      type: 'album',
      album: 'Compilation',
      artist: 'Various',
    });

    expect(albumScope.map((track) => track.id)).toEqual(['a', 'b']);
  });

  it('returns recent and artist payloads by facet', () => {
    const tracks = [
      mkTrack({ id: 'old', artist: 'A', dateAdded: 10, coverArtHash: 'x' }),
      mkTrack({ id: 'new', artist: 'A', dateAdded: 99 }),
      mkTrack({ id: 'other', artist: 'B', dateAdded: 50 }),
    ];

    const recent = buildFacetPayload('recent', tracks, () => undefined) as Track[];
    expect(recent.map((track) => track.id)).toEqual(['new', 'other', 'old']);

    const artists = buildFacetPayload('artists', tracks, (hash) =>
      hash ? `cover-art://localhost/${hash}/large` : undefined,
    );

    expect(Array.isArray(artists)).toBe(true);
    expect(
      (artists as Array<{ artist: string; count: number }>).map(({ artist, count }) => ({
        artist,
        count,
      })),
    ).toEqual([
      { artist: 'A', count: 2 },
      { artist: 'B', count: 1 },
    ]);
  });

  it('formats duration in long form', () => {
    expect(formatLongDuration(3599)).toBe('59m');
    expect(formatLongDuration(7260)).toBe('2h 1m');
  });
});
