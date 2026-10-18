import { beforeEach, describe, expect, it } from 'vitest';
import {
  getActivePlaybackGeneration,
  isCurrentPlaybackGeneration,
  resetPlaybackGenerationForTests,
  setActivePlaybackGeneration,
} from '../playback-generation';

describe('playback generation guard', () => {
  beforeEach(() => resetPlaybackGenerationForTests());

  it('accepts only events from the active source generation', () => {
    setActivePlaybackGeneration(12);

    expect(getActivePlaybackGeneration()).toBe(12);
    expect(isCurrentPlaybackGeneration({ generation: 12 })).toBe(true);
    expect(isCurrentPlaybackGeneration({ generation: 11 })).toBe(false);
    expect(isCurrentPlaybackGeneration({ generation: 13 })).toBe(false);
  });

  it('does not regress to an older generation after out-of-order native responses', () => {
    setActivePlaybackGeneration(12);
    setActivePlaybackGeneration(8);

    expect(getActivePlaybackGeneration()).toBe(12);
    expect(isCurrentPlaybackGeneration({ generation: 8 })).toBe(false);

    setActivePlaybackGeneration(13);
    expect(getActivePlaybackGeneration()).toBe(13);
  });

  it('ignores invalid generation assignments', () => {
    setActivePlaybackGeneration(4);
    setActivePlaybackGeneration(Number.NaN);
    setActivePlaybackGeneration(-1);

    expect(getActivePlaybackGeneration()).toBe(4);
  });
});
