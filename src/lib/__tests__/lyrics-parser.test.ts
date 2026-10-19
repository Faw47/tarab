import { describe, expect, it } from 'vitest';
import { getCurrentLineIndex, normalizeLyricsTiming, parseLyrics } from '../lyrics-parser';

describe('LRC timing and instrumental gaps (PB-27)', () => {
  it('supports hundredths, milliseconds, longer fractions and colon-form centiseconds', () => {
    const lyrics = parseLyrics(
      '[00:10.5]Tenth\n[00:11.50]Hundredth\n[00:12.123]Millisecond\n[00:13.1234]Long fraction\n[00:14:25]Colon',
    );

    expect(lyrics.lines.map((line) => line.startTime)).toEqual([10500, 11500, 12123, 13123, 14250]);
    expect(lyrics.lines.map((line) => line.text)).toEqual([
      'Tenth',
      'Hundredth',
      'Millisecond',
      'Long fraction',
      'Colon',
    ]);
  });

  it('advances lyrics for a positive LRC offset and delays them for a negative one', () => {
    expect(parseLyrics('[offset:+250]\n[00:10.00]Sooner').lines[0].startTime).toBe(9750);
    expect(parseLyrics('[offset:-250]\n[00:10.00]Later').lines[0].startTime).toBe(10250);
    expect(parseLyrics('[offset:+500]\n[00:00.10]Clamp').lines[0].startTime).toBe(0);
  });

  it('applies the global offset even when the tag follows timed lyrics', () => {
    const before = parseLyrics('[00:10.00]First\n[offset:+500]\n[00:12.00]Second');
    const after = parseLyrics('[offset:+500]\n[00:10.00]First\n[00:12.00]Second');

    expect(before.lines.map((line) => line.startTime)).toEqual([9500, 11500]);
    expect(before.lines).toEqual(after.lines);
  });

  it('applies a late global offset to enhanced word tags too', () => {
    const lyrics = parseLyrics('[00:10.00]<00:10.10>One <00:10.40>two\n[offset:+250]');
    expect(lyrics.lines[0].startTime).toBe(9750);
    expect(lyrics.lines[0].words.map((word) => word.startTime)).toEqual([9850, 10150]);
  });

  it('applies the same offset to enhanced word timestamps', () => {
    const lyrics = parseLyrics('[offset:+250]\n[00:10.00]<00:10.10>One <00:10:40>two');

    expect(lyrics.isEnhanced).toBe(true);
    expect(lyrics.lines[0].startTime).toBe(9750);
    expect(lyrics.lines[0].words.map((word) => word.startTime)).toEqual([9850, 10150]);
    expect(lyrics.lines[0].text).toBe('One two');
  });

  it('preserves empty timed lines to clear lyrics during instrumental breaks', () => {
    const lyrics = parseLyrics('[00:10.00]Verse\n[00:15.00]\n[00:18.00]Chorus');

    expect(lyrics.lines).toHaveLength(3);
    expect(lyrics.lines[0].endTime).toBe(15000);
    expect(lyrics.lines[1]).toMatchObject({
      text: '',
      startTime: 15000,
      endTime: 18000,
      words: [],
    });
    expect(getCurrentLineIndex(lyrics, 16000)).toBe(1);
    expect(normalizeLyricsTiming(lyrics).lines[1].words).toEqual([]);
  });

  it('retains repeated timestamps while ignoring metadata-only lines', () => {
    const lyrics = parseLyrics('[ti:Song]\n[00:01.00][00:03.00]Again');

    expect(lyrics.lines.map((line) => line.startTime)).toEqual([1000, 3000]);
    expect(lyrics.lines.every((line) => line.text === 'Again')).toBe(true);
  });

  it.each([
    '[00:15.00]<00:15.00>',
    '<00:15.00>',
  ])('keeps the enhanced instrumental marker %s', (marker) => {
    const lyrics = parseLyrics(`[00:10.00]<00:10.00>Verse\n${marker}\n[00:18.00]<00:18.00>Chorus`);
    expect(lyrics.isEnhanced).toBe(true);
    expect(lyrics.lines).toHaveLength(3);
    expect(lyrics.lines[1]).toMatchObject({
      text: '',
      startTime: 15000,
      endTime: 18000,
      words: [],
    });
    expect(getCurrentLineIndex(lyrics, 16000)).toBe(1);
    const normalized = normalizeLyricsTiming(lyrics);
    expect(normalized.lines[1].text).toBe('');
    expect(normalized.lines[1].words).toEqual([]);
    expect(normalized.lines[1].runs).toEqual([]);
    expect(getCurrentLineIndex(normalized, 16000)).toBe(1);
  });

  it('applies late global offsets to whitespace-only enhanced gaps', () => {
    const lyrics = parseLyrics('[00:10.00]Verse\n<00:15.00>  \n[00:18.00]Chorus\n[offset:+250]');
    expect(lyrics.lines.map((line) => line.startTime)).toEqual([9750, 14750, 17750]);
    expect(lyrics.lines[1].words).toEqual([]);
  });

  it('retains repeated enhanced blank markers without inventing empty words', () => {
    const lyrics = parseLyrics('[00:10.00]Verse\n[00:15.00][00:17.00]<00:00.00>\n[00:18.00]Chorus');
    expect(lyrics.lines.map((line) => line.startTime)).toEqual([10000, 15000, 17000, 18000]);
    expect(lyrics.lines.slice(1, 3).map((line) => line.words)).toEqual([[], []]);
  });
});
