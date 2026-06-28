import {
  type DebouncedWatchOptions,
  type UnwatchFn,
  type WatchEvent,
  watch,
} from '@tauri-apps/plugin-fs';
import { logger } from './logger';

const DOMAIN = 'FileSystem';

export type FsWatchEvent = WatchEvent;
export type FsUnwatchFn = UnwatchFn;

/**
 * Renderer filesystem wrapper. File reads and mutations should go through
 * Rust commands that validate the selected library roots before touching disk.
 */
export const fs = {
  /**
   * Watch a directory or file path for changes.
   */
  watchPath: async (
    path: string,
    onEvent: (event: FsWatchEvent) => void,
    options: DebouncedWatchOptions = { recursive: true, delayMs: 800 },
  ): Promise<FsUnwatchFn | null> => {
    try {
      return await watch(path, onEvent, options);
    } catch (err) {
      logger.error(DOMAIN, `Failed to watch path: ${path}`, err);
      return null;
    }
  },

  /**
   * Stop an active watcher.
   */
  unwatchPath: (unwatch: FsUnwatchFn | null | undefined): void => {
    if (!unwatch) return;
    try {
      unwatch();
    } catch (err) {
      logger.error(DOMAIN, 'Failed to unwatch path', err);
    }
  },
};
