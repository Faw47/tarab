import { playAdjacentTrack, toggleCurrentPlayback } from '../lib/playback-actions';
import { globalShortcuts } from './globalShortcuts';
import { logger } from './logger';

const DOMAIN = 'GlobalShortcutsManager';

/**
 * High-level manager for application global shortcuts.
 */
export const globalShortcutsManager = {
  /**
   * Register all configured global shortcuts.
   */
  registerAll: async (config: { playPause: string; next: string; previous: string }) => {
    logger.info(DOMAIN, 'Registering all global shortcuts', config);

    await globalShortcuts.unregisterAll();

    const results = await Promise.all([
      globalShortcuts.register(config.playPause, (state) => {
        if (state === 'Pressed') {
          logger.debug(DOMAIN, 'Global Play/Pause pressed');
          void toggleCurrentPlayback();
        }
      }),
      globalShortcuts.register(config.next, (state) => {
        if (state === 'Pressed') {
          logger.debug(DOMAIN, 'Global Next pressed');
          void playAdjacentTrack('next');
        }
      }),
      globalShortcuts.register(config.previous, (state) => {
        if (state === 'Pressed') {
          logger.debug(DOMAIN, 'Global Previous pressed');
          void playAdjacentTrack('previous');
        }
      }),
    ]);

    const failures = results.filter((r) => !r).length;
    if (failures > 0) {
      logger.warn(DOMAIN, `${failures} shortcuts failed to register (likely due to collisions)`);
    }

    return failures === 0;
  },

  /**
   * Unregister all global shortcuts.
   */
  unregisterAll: async () => {
    await globalShortcuts.unregisterAll();
  },
};
