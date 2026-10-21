import { describe, expect, it } from 'vitest';
import { formatCountLabel } from '../format-count';

describe('formatCountLabel', () => {
  it.each([
    [0, 'track', undefined, '0 tracks'],
    [1, 'track', undefined, '1 track'],
    [2, 'track', undefined, '2 tracks'],
    [2, 'person', 'people', '2 people'],
  ] as const)('formats %i %s', (count, singular, plural, expected) => {
    expect(formatCountLabel(count, singular, plural)).toBe(expected);
  });
});
