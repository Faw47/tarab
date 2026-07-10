import { playAdjacentTrack, toggleCurrentPlayback } from '../lib/playback-actions';
import { globalShortcuts } from './globalShortcuts';
import { logger } from './logger';

const DOMAIN = 'GlobalShortcutsManager';

type ShortcutConfig = { playPause: string; next: string; previous: string };

const runShortcutAction = (action: string, runner: () => Promise<unknown>) => {
  void runner().catch((error) => {
    logger.error(DOMAIN, 'Global shortcut action failed: ' + action, error);
  });
};
/**
 * High-level manager for application global shortcuts.
 */
export const globalShortcutsManager = {
  /**
   * Register all configured global shortcuts.
   */
  registerAll: async (config: ShortcutConfig) => {
    logger.info(DOMAIN, 'Registering all global shortcuts', config);

    await globalShortcuts.unregisterAll();

    const seen = new Set<string>();
    const entries = [
      {
        action: 'playPause',
        shortcut: config.playPause,
        run: () => runShortcutAction('playPause', toggleCurrentPlayback),
      },
      {
        action: 'next',
        shortcut: config.next,
        run: () => runShortcutAction('next', () => playAdjacentTrack('next')),
      },
      {
        action: 'previous',
        shortcut: config.previous,
        run: () => runShortcutAction('previous', () => playAdjacentTrack('previous')),
      },
    ] as const;

    const results = await Promise.all(
      entries.map(({ action, shortcut, run }) => {
        const key = shortcut.trim().toLowerCase();
        if (!key || seen.has(key)) {
          logger.warn(DOMAIN, `Skipping duplicate global shortcut for ${action}: ${shortcut}`);
          return false;
        }
        seen.add(key);
        return globalShortcuts.register(shortcut, (state) => {
          if (state === 'Pressed') {
            logger.debug(DOMAIN, `Global ${action} pressed`);
            run();
          }
        });
      }),
    );

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
