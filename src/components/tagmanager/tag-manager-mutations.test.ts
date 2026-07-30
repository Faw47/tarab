import { describe, expect, it } from 'vitest';
import type { TagInfo } from '../../types';
import {
  mapWithConcurrency,
  pickEditableTags,
  tagEditStateToUpdate,
  tagValuesEqual,
} from './tag-manager-mutations';

const tags: TagInfo = {
  title: 'Title',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Album Artist',
  year: 2026,
  trackNumber: 2,
  totalTracks: 9,
  discNumber: 1,
  totalDiscs: 2,
  genre: 'Alternative',
  composer: 'Composer',
  comment: 'Comment',
  hasCoverArt: true,
  filePath: '/music/file.flac',
  fileFormat: 'flac',
  durationSecs: 180,
};

describe('tag manager mutation helpers', () => {
  it('copies only editable fields and preserves explicit clear operations', () => {
    const editable = pickEditableTags(tags);
    editable.album = null;
    editable.comment = undefined;

    expect(tagEditStateToUpdate(editable)).toMatchObject({
      title: 'Title',
      year: 2026,
      album: null,
      comment: null,
      clearFields: expect.arrayContaining(['album', 'comment']),
    });
  });

  it('compares empty values consistently without coercing numbers', () => {
    expect(tagValuesEqual(null, undefined)).toBe(true);
    expect(tagValuesEqual('', null)).toBe(true);
    expect(tagValuesEqual(2, '2')).toBe(false);
  });

  it('keeps output order while bounding concurrent mutations', async () => {
    let active = 0;
    let maximumActive = 0;
    const results = await mapWithConcurrency([30, 5, 20, 1], 2, async (delay) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, delay));
      active -= 1;
      return delay;
    });

    expect(results).toEqual([30, 5, 20, 1]);
    expect(maximumActive).toBe(2);
  });
});
