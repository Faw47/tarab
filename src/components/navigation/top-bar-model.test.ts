import { describe, expect, it } from 'vitest';
import {
  getTopBarLabel,
  getTopBarStatus,
  shouldShowShuffle,
  TOP_BAR_PRIMARY_VIEWS,
  TOP_BAR_SECONDARY_VIEWS,
  TOP_BAR_SHORTCUT,
} from './top-bar-model';

describe('top-bar-model', () => {
  it('keeps primary and secondary navigation labels in one shared contract', () => {
    expect(TOP_BAR_PRIMARY_VIEWS.map((item) => item.view)).toEqual([
      'home',
      'library',
      'queue',
      'playlists',
    ]);
    expect(TOP_BAR_SECONDARY_VIEWS.map((item) => item.view)).toEqual(['tags', 'settings']);
    expect(getTopBarLabel('queue')).toBe('Queue');
    expect(getTopBarLabel('album')).toBeNull();
  });
  it('normalizes scanning and processing status for both themes', () => {
    expect(
      getTopBarStatus({ isScanning: true, scanProgress: 101, activeProcessing: undefined }),
    ).toEqual({
      label: 'Scanning library',
      shortLabel: 'Scanning',
      progressText: '100%',
      progressValue: 100,
    });

    expect(
      getTopBarStatus({
        isScanning: false,
        scanProgress: 0,
        activeProcessing: { label: 'Writing tags', progress: -5 },
      }),
    ).toMatchObject({ label: 'Writing tags', shortLabel: 'Working', progressText: '0%' });
  });

  it('keeps the shortcut and shuffle visibility contracts stable', () => {
    expect(TOP_BAR_SHORTCUT).toEqual({ shortcutLabel: '/', ariaShortcut: 'Slash' });
    expect(shouldShowShuffle('library', () => undefined)).toBe(true);
    expect(shouldShowShuffle('settings', () => undefined)).toBe(false);
    expect(shouldShowShuffle('search')).toBe(false);
  });

  it('returns no status when no desktop work is active', () => {
    expect(getTopBarStatus({ isScanning: false, scanProgress: 0 })).toBeNull();
  });
});
