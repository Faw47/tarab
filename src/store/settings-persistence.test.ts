import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SHORTCUTS, useSettingsStore } from './settings-store';

describe('persisted settings validation', () => {
  beforeEach(() => {
    useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  });

  const merge = (persisted: unknown) =>
    useSettingsStore.persist.getOptions().merge?.(persisted, useSettingsStore.getState());

  it('keeps valid current-version fields and falls back independently for invalid fields', () => {
    const restored = merge({
      theme: 'neobrutalism',
      lyricsEnabled: 'yes',
      navMode: 'broken',
      crossfadeSeconds: 99,
      shuffleHistorySize: 0,
      cacheSizeLimitMb: -1,
      fullscreenLyricSize: 101,
      fullscreenBackgroundBlur: -1,
      autoLyrics: true,
      setTheme: 'overwritten',
    });

    expect(restored).toMatchObject({
      theme: 'neobrutalism',
      lyricsEnabled: true,
      navMode: 'topNav',
      crossfadeSeconds: 0,
      shuffleHistorySize: 50,
      cacheSizeLimitMb: 200,
      fullscreenLyricSize: 50,
      fullscreenBackgroundBlur: 15,
      autoLyrics: true,
    });
    expect(restored?.setTheme).toBeTypeOf('function');
  });

  it('normalizes valid folders and recovers shortcut fields independently', () => {
    const restored = merge({
      libraryFolders: ['C:\\Music\\Jazz', 'C:/Music'],
      shortcuts: { playPause: ' Ctrl + Alt + Space ', next: 42, previous: '' },
    });
    expect(restored?.libraryFolders).toEqual(['C:/Music']);
    expect(restored?.shortcuts).toEqual({
      playPause: 'Ctrl+Alt+Space',
      next: DEFAULT_SHORTCUTS.next,
      previous: DEFAULT_SHORTCUTS.previous,
    });
  });

  it('rejects malformed containers without losing defaults', () => {
    for (const persisted of [null, 'broken', [], { libraryFolders: [42], shortcuts: null }]) {
      expect(() => merge(persisted)).not.toThrow();
      expect(merge(persisted)).toMatchObject({
        libraryFolders: [],
        shortcuts: DEFAULT_SHORTCUTS,
      });
    }
  });

  it('uses the fresh navigation default for old settings that have no choice', async () => {
    const migrate = useSettingsStore.persist.getOptions().migrate;
    const missing = await migrate?.({}, 2);
    const explicit = await migrate?.({ navMode: 'iconRail' }, 2);
    expect(merge(missing)?.navMode).toBe('topNav');
    expect(merge(explicit)?.navMode).toBe('iconRail');
  });

  it('retains the pre-v7 online-lyrics consent reset', async () => {
    const migrate = useSettingsStore.persist.getOptions().migrate;
    expect(merge(await migrate?.({ autoLyrics: true }, 6))?.autoLyrics).toBe(false);
  });
});
