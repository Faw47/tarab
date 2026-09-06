import type { StateStorage } from 'zustand/middleware';
import { fixedStoreGet, fixedStoreRemove, fixedStoreSet } from '../lib/tauri-commands';
import { logger } from './logger';

const DOMAIN = 'TauriZustandStorage';
let settingsWriteTail: Promise<void> = Promise.resolve();
let settingsWriteError: unknown = null;

function queueSettingsWrite(operation: () => Promise<void>, label: string): Promise<void> {
  settingsWriteTail = settingsWriteTail.then(operation).catch((error) => {
    settingsWriteError = error;
    logger.error(DOMAIN, label, error);
  });
  return settingsWriteTail;
}

export async function flushSettingsWrites(): Promise<void> {
  let observed: Promise<void>;
  do {
    observed = settingsWriteTail;
    await observed;
  } while (observed !== settingsWriteTail);

  if (settingsWriteError) {
    const error = settingsWriteError;
    settingsWriteError = null;
    throw error;
  }
}

/**
 * Custom Zustand storage implementation that uses Tauri's persistent store plugin.
 * This ensures settings are persisted to a file in the app data directory
 * rather than relying on the browser's localStorage.
 */
export const createTauriZustandStorage = (_storePath: 'settings.json'): StateStorage => {
  let latestRead: Promise<unknown> | null = null;
  let readSucceeded = false;

  const requireSuccessfulRead = async () => {
    while (true) {
      const read = latestRead;
      if (!read) throw new Error('Settings storage cannot be written before hydration');
      await read;
      if (read === latestRead) break;
    }
    if (!readSucceeded) throw new Error('Settings storage hydration did not succeed');
  };

  return {
    getItem: async (name: string): Promise<string | null> => {
      const read = fixedStoreGet('settings', name);
      latestRead = read;
      readSucceeded = false;
      try {
        const value = await read;
        if (latestRead === read) readSucceeded = true;
        return value ? JSON.stringify(value) : null;
      } catch (err) {
        if (latestRead === read) readSucceeded = false;
        logger.error(DOMAIN, `Failed to get item "${name}"`, err);
        throw err;
      }
    },
    setItem: async (name: string, value: string): Promise<void> => {
      const parsed = JSON.parse(value);
      await queueSettingsWrite(async () => {
        await requireSuccessfulRead();
        await fixedStoreSet('settings', name, parsed);
      }, `Failed to set item "${name}"`);
    },
    removeItem: async (name: string): Promise<void> => {
      await queueSettingsWrite(async () => {
        await requireSuccessfulRead();
        await fixedStoreRemove('settings', name);
      }, `Failed to remove item "${name}"`);
    },
  };
};
