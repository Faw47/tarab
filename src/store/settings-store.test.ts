import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SHORTCUTS, useSettingsStore } from './settings-store';

describe('settings-store library folders', () => {
  beforeEach(() => {
    useSettingsStore.getState().setLibraryFolders([]);
  });

  it('normalizes separators and replaces watched child folders with a parent', () => {
    useSettingsStore.getState().addLibraryFolder('C:\\Music\\Jazz\\');

    expect(useSettingsStore.getState().libraryFolders).toEqual(['C:/Music/Jazz']);

    useSettingsStore.getState().addLibraryFolder('C:/Music');

    expect(useSettingsStore.getState().libraryFolders).toEqual(['C:/Music']);
  });

  it('deduplicates nested folders when setting the full source list', () => {
    useSettingsStore.getState().setLibraryFolders(['C:/Music/Jazz', 'D:/Albums', 'C:/Music']);

    expect(useSettingsStore.getState().libraryFolders).toEqual(['C:/Music', 'D:/Albums']);
  });

  it('removes normalized folder paths', () => {
    useSettingsStore.getState().setLibraryFolders(['C:/Music']);

    useSettingsStore.getState().removeLibraryFolder('C:\\Music\\');

    expect(useSettingsStore.getState().libraryFolders).toEqual([]);
  });
});
describe('settings-store shortcuts', () => {
  beforeEach(() => {
    useSettingsStore.setState({ shortcuts: { ...DEFAULT_SHORTCUTS } });
  });

  it('normalizes shortcut chord whitespace', () => {
    useSettingsStore.getState().setShortcut('playPause', ' Ctrl + Alt + Space ');

    expect(useSettingsStore.getState().shortcuts.playPause).toBe('Ctrl+Alt+Space');
  });

  it('falls back to defaults for blank shortcuts', () => {
    useSettingsStore.getState().setShortcut('next', '   ');

    expect(useSettingsStore.getState().shortcuts.next).toBe(DEFAULT_SHORTCUTS.next);
  });
});
