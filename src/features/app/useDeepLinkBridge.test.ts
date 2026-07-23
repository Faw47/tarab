import { describe, expect, it } from 'vitest';
import { parseDeepLink } from './useDeepLinkBridge';

describe('parseDeepLink', () => {
  it('accepts a bounded search intent', () => {
    expect(parseDeepLink('tarab://open/search?q=Fairuz')).toEqual({
      kind: 'search',
      query: 'Fairuz',
    });
  });

  it('accepts an opaque track identifier', () => {
    const id = 'a'.repeat(64);
    expect(parseDeepLink(`tarab://open/play?id=${id}`)).toEqual({
      kind: 'play',
      publicId: id,
    });
  });

  it.each([
    'https://open/search?q=Fairuz',
    'tarab://other/search?q=Fairuz',
    'tarab://open/search',
    `tarab://open/search?q=${'x'.repeat(201)}`,
    'tarab://open/play?id=/Users/alice/Music/song.mp3',
    'tarab://open/unknown',
  ])('rejects unsupported or unsafe input: %s', (url) => {
    expect(parseDeepLink(url)).toBeNull();
  });
});
