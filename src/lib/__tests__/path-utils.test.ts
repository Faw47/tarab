import { describe, expect, it, vi } from 'vitest';
import {
  getPathBaseName,
  getPathDirectory,
  isSameOrSubPath,
  isSamePath,
  normalizeFolderPath,
} from '../path-utils';

describe('path-utils', () => {
  it('extracts basenames from Windows and POSIX paths', () => {
    expect(getPathBaseName('C:\\Music\\Arab\\Track.mp3')).toBe('Track.mp3');
    expect(getPathBaseName('/Music/Arab/Track.mp3')).toBe('Track.mp3');
    expect(getPathBaseName('/Music/Arab/')).toBe('Arab');
    expect(getPathBaseName('')).toBe('');
  });

  it('derives root-aware containing directories', () => {
    expect(getPathDirectory('/file.mp3')).toBe('/');
    expect(getPathDirectory('C:/file.mp3')).toBe('C:/');
    expect(getPathDirectory('C:/Music/file.mp3')).toBe('C:/Music');
    expect(getPathDirectory('file.mp3')).toBe('');
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

  it('preserves filesystem roots and matches their descendants', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    expect(normalizeFolderPath('///')).toBe('/');
    expect(isSameOrSubPath('/Music/Track.mp3', '/')).toBe(true);

    vi.stubGlobal('navigator', { platform: 'Win32' });
    expect(normalizeFolderPath('C:\\')).toBe('C:/');
    expect(isSameOrSubPath('c:\\Music\\Track.mp3', 'C:/')).toBe(true);
    expect(isSamePath('c:\\Music\\', 'C:/MUSIC')).toBe(true);
    vi.unstubAllGlobals();
  });

  it('normalizes Windows extended-length prefixes to public paths', () => {
    vi.stubGlobal('navigator', { platform: 'Win32' });
    expect(normalizeFolderPath('//?/C:/Users/fawaz/Documents/Music')).toBe(
      'C:/Users/fawaz/Documents/Music',
    );
    expect(normalizeFolderPath('\\\\?\\C:\\Users\\fawaz\\Music\\')).toBe('C:/Users/fawaz/Music');
    expect(normalizeFolderPath('//?/UNC/server/Music')).toBe('//server/Music');
    expect(isSamePath('//?/C:/Users/fawaz/Documents/Music', 'C:/Users/fawaz/Documents/Music')).toBe(
      true,
    );
    expect(isSameOrSubPath('//?/C:/Music/Track.mp3', 'C:/Music')).toBe(true);
    vi.unstubAllGlobals();
  });
});
