import { describe, expect, it } from 'vitest';
import { toBackendRule } from './playlistEditor.defaults';

describe('toBackendRule', () => {
  it('falls back to finite integers for invalid numeric smart rule values', () => {
    expect(toBackendRule('RecentlyAdded', { days: 'not-a-number' })).toEqual([
      { RecentlyAdded: { days: 30 } },
    ]);
    expect(toBackendRule('MostPlayed', { minPlays: 'Infinity' })).toEqual([
      { MostPlayed: { min_plays: 1 } },
    ]);
    expect(toBackendRule('ByYear', { startYear: 'abc', endYear: 'NaN' })).toEqual([
      { ByYear: { start_year: 0, end_year: 9999 } },
    ]);
  });

  it('clamps numeric smart rule values to backend-safe ranges', () => {
    expect(toBackendRule('RecentlyAdded', { days: '-5' })).toEqual([
      { RecentlyAdded: { days: 1 } },
    ]);
    expect(toBackendRule('TopRated', { minRating: '9' })).toEqual([
      { TopRated: { min_rating: 5 } },
    ]);
    expect(toBackendRule('ShorterThan', { seconds: '-1' })).toEqual([
      { ShorterThan: { seconds: 0 } },
    ]);
  });
});