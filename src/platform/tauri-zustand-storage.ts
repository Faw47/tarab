import { load } from '@tauri-apps/plugin-store';
import type { StateStorage } from 'zustand/middleware';
import { logger } from './logger';

const DOMAIN = 'TauriZustandStorage';
const STORE_OPTIONS = { defaults: {}, autoSave: true } as const;

/**
 * Custom Zustand storage implementation that uses Tauri's persistent store plugin.
 * This ensures settings are persisted to a file in the app data directory
 * rather than relying on the browser's localStorage.
 */
export const createTauriZustandStorage = (storePath: string): StateStorage => ({
  getItem: async (name: string): Promise<string | null> => {
    try {
      const store = await load(storePath, STORE_OPTIONS);
      const value = await store.get(name);
      return value ? JSON.stringify(value) : null;
    } catch (err) {
      logger.error(DOMAIN, `Failed to get item "${name}"`, err);
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      const store = await load(storePath, STORE_OPTIONS);
      await store.set(name, JSON.parse(value));
      // autoSave is enabled, so we don't need to call store.save()
    } catch (err) {
      logger.error(DOMAIN, `Failed to set item "${name}"`, err);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      const store = await load(storePath, STORE_OPTIONS);
      await store.delete(name);
    } catch (err) {
      logger.error(DOMAIN, `Failed to remove item "${name}"`, err);
    }
  },
});
