import type { StateStorage } from 'zustand/middleware';
import { fixedStoreGet, fixedStoreRemove, fixedStoreSet } from '../lib/tauri-commands';
import { logger } from './logger';

const DOMAIN = 'TauriZustandStorage';

/**
 * Custom Zustand storage implementation that uses Tauri's persistent store plugin.
 * This ensures settings are persisted to a file in the app data directory
 * rather than relying on the browser's localStorage.
 */
export const createTauriZustandStorage = (_storePath: 'settings.json'): StateStorage => ({
  getItem: async (name: string): Promise<string | null> => {
    try {
      const value = await fixedStoreGet('settings', name);
      return value ? JSON.stringify(value) : null;
    } catch (err) {
      logger.error(DOMAIN, `Failed to get item "${name}"`, err);
      return null;
    }
  },
  setItem: async (name: string, value: string): Promise<void> => {
    try {
      await fixedStoreSet('settings', name, JSON.parse(value));
    } catch (err) {
      logger.error(DOMAIN, `Failed to set item "${name}"`, err);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      await fixedStoreRemove('settings', name);
    } catch (err) {
      logger.error(DOMAIN, `Failed to remove item "${name}"`, err);
    }
  },
});
