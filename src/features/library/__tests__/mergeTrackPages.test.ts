import { describe, expect, it } from 'vitest';
import type { Track } from '../../../types';
import { mergeTrackPages } from '../mergeTrackPages';

const makeTrack = (id: string): Track => ({
  id,
  title: id,
  artist: 'Artist',
  album: 'Album',
  year: 2024,
  duration: 180,
  filePath: '/music/' + id + '.flac',
  hasCoverArt: false,
  dateAdded: 1,
});

describe('mergeTrackPages', () => {
  it('preserves loaded order and appends only unseen IDs', () => {
    const first = makeTrack('first');
    const second = makeTrack('second');
    const third = makeTrack('third');

    expect(mergeTrackPages([first, second], [second, third])).toEqual([first, second, third]);
  });

  it('deduplicates repeated IDs within an incoming page', () => {
    const first = makeTrack('first');
    const duplicate = { ...first, title: 'duplicate row' };

    expect(mergeTrackPages([], [first, duplicate])).toEqual([first]);
  });

  it('returns the existing array when a page adds nothing', () => {
    const previous = [makeTrack('first')];

    expect(mergeTrackPages(previous, [makeTrack('first')])).toBe(previous);
  });
});
