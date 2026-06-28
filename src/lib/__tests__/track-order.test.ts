import { describe, expect, it } from 'vitest';
import type { Track } from '../../types';
import { sortAlbumTracks } from '../track-order';

const track = (id: string, overrides: Partial<Track>): Track => ({
  id,
  title: id,
  artist: 'Artist',
  album: 'Album',
  year: 2024,
  duration: 180,
  filePath: `/music/${id}.mp3`,
  hasCoverArt: false,
  coverArtHash: null,
  dateAdded: 1,
  ...overrides,
});

describe('sortAlbumTracks', () => {
  it('uses disc and track metadata before title fallback', () => {
    const sorted = sortAlbumTracks([
      track('title-a', { title: 'A Song', trackNumber: 3, discNumber: 1 }),
      track('disc-2', { title: 'Second Disc Opener', trackNumber: 1, discNumber: 2 }),
      track('title-z', { title: 'Z Song', trackNumber: 1, discNumber: 1 }),
      track('title-b', { title: 'B Song', trackNumber: 2, discNumber: 1 }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(['title-z', 'title-b', 'title-a', 'disc-2']);
  });

  it('falls back to leading filename numbers when metadata is missing', () => {
    const sorted = sortAlbumTracks([
      track('third', { title: 'Finale', filePath: '/music/03 Finale.mp3' }),
      track('first', { title: 'Intro', filePath: '/music/01 Intro.mp3' }),
      track('second', { title: 'Middle', filePath: '/music/02 Middle.mp3' }),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(['first', 'second', 'third']);
  });
});
