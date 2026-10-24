import type { StateStorage } from 'zustand/middleware';
import { reportError } from '../lib/report-error';
import { fixedStoreGet, fixedStoreRemove, fixedStoreSet } from '../lib/tauri-commands';
import { logger } from './logger';

const DOMAIN = 'TauriZustandStorage';
const pendingWrites = new Set<Promise<void>>();
let writeFailureReported = false;

function reportWriteFailure(error: unknown) {
  if (writeFailureReported) return;
  writeFailureReported = true;
  reportError('Could not save settings. Your changes may be lost when Tarab closes.', {
    source: 'settings-storage',
    error,
  });
}

async function trackSettingsWrite(write: Promise<void>): Promise<void> {
  pendingWrites.add(write);
  try {
    await write;
  } finally {
    pendingWrites.delete(write);
  }
}

/** Wait until consent changes, including writes queued during the drain, reach native storage. */
export async function flushSettingsWrites(): Promise<void> {
  while (pendingWrites.size > 0) {
    await Promise.allSettled([...pendingWrites]);
  }
}

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
      await trackSettingsWrite(fixedStoreSet('settings', name, JSON.parse(value)));
      writeFailureReported = false;
    } catch (err) {
      reportWriteFailure(err);
      logger.error(DOMAIN, `Failed to set item "${name}"`, err);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    try {
      await trackSettingsWrite(fixedStoreRemove('settings', name));
      writeFailureReported = false;
    } catch (err) {
      reportWriteFailure(err);
      logger.error(DOMAIN, `Failed to remove item "${name}"`, err);
    }
  },
});
