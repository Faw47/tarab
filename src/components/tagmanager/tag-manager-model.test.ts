import { describe, expect, it } from 'vitest';
import type { Track } from '../../types';
import { buildFolderTree, filterAndSortTracks, formatQuality } from './tag-manager-model';

const track = (overrides: Partial<Track>): Track => ({
  id: overrides.id ?? overrides.filePath ?? 'id',
  title: overrides.title ?? 'Title',
  artist: overrides.artist ?? 'Artist',
  album: overrides.album ?? 'Album',
  albumArtist: overrides.albumArtist ?? null,
  year: overrides.year ?? null,
  duration: overrides.duration ?? 0,
  filePath: overrides.filePath ?? '/music/track.flac',
  hasCoverArt: overrides.hasCoverArt ?? true,
  coverArtHash: overrides.coverArtHash ?? null,
  dateAdded: overrides.dateAdded ?? 1,
  fileFormat: overrides.fileFormat,
});

describe('tag manager model', () => {
  it('builds folders and filters by folder, query, file state, and sort', () => {
    const tracks = [
      track({
        id: '1',
        title: 'Beta',
        artist: 'Known',
        filePath: 'C:/Music/A/beta.flac',
        hasCoverArt: false,
        duration: 20,
      }),
      track({
        id: '2',
        title: 'Alpha',
        artist: 'Unknown Artist',
        filePath: 'C:/Music/A/alpha.mp3',
        hasCoverArt: true,
        duration: 10,
      }),
      track({
        id: '3',
        title: 'Gamma',
        artist: 'Known',
        filePath: 'C:/Music/B/gamma.wav',
        hasCoverArt: true,
        duration: 30,
      }),
    ];

    expect(buildFolderTree(tracks)).toEqual([
      { path: 'C:/Music/A', name: 'A', trackCount: 2 },
      { path: 'C:/Music/B', name: 'B', trackCount: 1 },
    ]);

    expect(
      filterAndSortTracks({
        tracks,
        selectedFolder: 'C:/Music/A',
        query: '',
        fileFilter: 'missing-art',
        sortColumn: 'title',
        sortDirection: 'asc',
      }).map((item) => item.id),
    ).toEqual(['1']);

    expect(
      filterAndSortTracks({
        tracks,
        selectedFolder: null,
        query: 'alpha',
        fileFilter: 'all',
        sortColumn: 'duration',
        sortDirection: 'desc',
      }).map((item) => item.id),
    ).toEqual(['2']);
  });

  it('detects lossless quality from file format or extension', () => {
    expect(formatQuality(track({ fileFormat: 'flac' }))).toEqual({
      format: 'FLAC',
      isLossless: true,
    });
    expect(formatQuality(track({ filePath: '/music/song.mp3', fileFormat: undefined }))).toEqual({
      format: 'MP3',
      isLossless: false,
    });
  });
});
