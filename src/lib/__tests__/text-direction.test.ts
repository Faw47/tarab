import { describe, expect, it } from 'vitest';
import { textDirection } from '../text-direction';

describe('textDirection (FE-22)', () => {
  it('follows the first letter, like dir="auto"', () => {
    expect(textDirection('عمرو دياب - تملي معاك')).toBe('rtl');
    expect(textDirection('(Live) أهواك')).toBe('ltr');
    expect(textDirection('1. أهواك')).toBe('rtl');
    expect(textDirection('שלום')).toBe('rtl');
    expect(textDirection('Hello')).toBe('ltr');
    expect(textDirection('3:20')).toBeNull();
    expect(textDirection('')).toBeNull();
  });
});
