import { describe, expect, it, vi } from 'vitest';

const { settingsStorage } = vi.hoisted(() => ({
  settingsStorage: {
    getItem: vi.fn(async (_key: string): Promise<string | null> => null),
    setItem: vi.fn(async (_key: string, _value: string): Promise<void> => undefined),
    removeItem: vi.fn(async (_key: string): Promise<void> => undefined),
  },
}));

vi.mock('../platform/tauri-zustand-storage', () => ({
  createTauriZustandStorage: () => settingsStorage,
}));

import { useSettingsStore } from './settings-store';

describe('settings navigation migration', () => {
  it('uses the fresh-install navigation default for older settings without navMode', async () => {
    settingsStorage.getItem.mockResolvedValueOnce(JSON.stringify({ state: {}, version: 2 }));

    await useSettingsStore.persist.rehydrate();

    expect(useSettingsStore.getState().navMode).toBe('topNav');
  });
});
