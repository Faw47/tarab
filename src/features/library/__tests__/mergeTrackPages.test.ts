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

  it.each([500, 5_000, 50_000])('merges a %,i-track library without losing rows', (count) => {
    const pageSize = 300;
    let loaded: Track[] = [];

    for (let offset = 0; offset < count; offset += pageSize) {
      const page = Array.from({ length: Math.min(pageSize, count - offset) }, (_, index) =>
        makeTrack(`track-${offset + index}`),
      );
      loaded = mergeTrackPages(loaded, page);
    }

    expect(loaded).toHaveLength(count);
    expect(loaded[0]?.id).toBe('track-0');
    expect(loaded.at(-1)?.id).toBe(`track-${count - 1}`);
  });
});
