import { describe, expect, it, vi } from 'vitest';
import { getPathBaseName, isSameOrSubPath } from '../path-utils';

describe('path-utils', () => {
  it('extracts basenames from Windows and POSIX paths', () => {
    expect(getPathBaseName('C:\\Music\\Arab\\Track.mp3')).toBe('Track.mp3');
    expect(getPathBaseName('/Music/Arab/Track.mp3')).toBe('Track.mp3');
    expect(getPathBaseName('/Music/Arab/')).toBe('Arab');
    expect(getPathBaseName('')).toBe('');
  });

  it('matches POSIX paths without matching sibling prefixes', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });

    expect(isSameOrSubPath('/Music/Arab/Track.mp3', '/Music/Arab')).toBe(true);
    expect(isSameOrSubPath('/Music/Arabian/Track.mp3', '/Music/Arab')).toBe(false);

    vi.unstubAllGlobals();
  });

  it('matches Windows paths case-insensitively without matching sibling prefixes', () => {
    vi.stubGlobal('navigator', { platform: 'Win32' });

    expect(isSameOrSubPath('C:\\Music\\Arab\\Track.mp3', 'c:/music/arab')).toBe(true);
    expect(isSameOrSubPath('C:\\Music\\Arabian\\Track.mp3', 'c:/music/arab')).toBe(false);
    expect(isSameOrSubPath('C:\\Music\\Arab', 'c:/music/arab/')).toBe(true);

    vi.unstubAllGlobals();
  });
});
