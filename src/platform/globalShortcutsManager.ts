import { emitTo } from '@tauri-apps/api/event';
import { EVENT_DESKTOP_CONTROL_ACTION, MAIN_WINDOW_LABEL } from '../features/app/desktop-events';
import type { DesktopControlAction } from '../types';
import { globalShortcuts } from './globalShortcuts';
import { logger } from './logger';

const DOMAIN = 'GlobalShortcutsManager';

type ShortcutConfig = { playPause: string; next: string; previous: string };

// Keep these aligned with the native Linux menu accelerators in desktop_integration.rs.
const LINUX_MENU_OWNED_SHORTCUTS = ['CmdOrCtrl+Alt+Right', 'CmdOrCtrl+Alt+Left'] as const;

const canonicalizeLinuxShortcut = (shortcut: string) => {
  const aliases: Record<string, string> = {
    arrowleft: 'left',
    arrowright: 'right',
    cmdorctrl: 'control',
    commandorcontrol: 'control',
    ctrl: 'control',
    option: 'alt',
  };

  return shortcut
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((part) => aliases[part] ?? part)
    .sort()
    .join('+');
};

const linuxMenuOwnedShortcutKeys = new Set(
  LINUX_MENU_OWNED_SHORTCUTS.map(canonicalizeLinuxShortcut),
);

export const getGlobalShortcutOwner = (
  shortcut: string,
  platform: string,
): 'linux-menu' | 'renderer-global' =>
  /linux/i.test(platform) && linuxMenuOwnedShortcutKeys.has(canonicalizeLinuxShortcut(shortcut))
    ? 'linux-menu'
    : 'renderer-global';

const currentPlatform = () => (typeof navigator === 'undefined' ? '' : navigator.platform);

const ownedShortcuts = new Set<string>();
let registrationQueue: Promise<unknown> = Promise.resolve();

const runShortcutAction = (action: DesktopControlAction) => {
  void emitTo(MAIN_WINDOW_LABEL, EVENT_DESKTOP_CONTROL_ACTION, action).catch((error) => {
    logger.error(DOMAIN, 'Global shortcut action failed: ' + action, error);
  });
};

const unregisterOwned = async () => {
  const shortcuts = Array.from(ownedShortcuts);
  const results = await Promise.all(
    shortcuts.map(async (shortcut) => ({
      shortcut,
      removed: await globalShortcuts.unregister(shortcut),
    })),
  );
  for (const result of results) {
    if (result.removed) ownedShortcuts.delete(result.shortcut);
  }
  const failures = results.filter((result) => !result.removed);
  if (failures.length > 0) {
    throw new Error(`Failed to unregister ${failures.length} owned global shortcut(s)`);
  }
};

const serializeRegistration = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = registrationQueue.catch(() => undefined).then(operation);
  registrationQueue = result;
  return result;
};
/**
 * High-level manager for application global shortcuts.
 */
export const globalShortcutsManager = {
  /**
   * Register all configured global shortcuts.
   */
  registerAll: (config: ShortcutConfig) =>
    serializeRegistration(async () => {
      logger.info(DOMAIN, 'Registering all global shortcuts', config);

      await unregisterOwned();

      const seen = new Set<string>();
      const platform = currentPlatform();
      const entries = [
        {
          action: 'playPause',
          shortcut: config.playPause,
          run: () => runShortcutAction('toggle-play'),
        },
        {
          action: 'next',
          shortcut: config.next,
          run: () => runShortcutAction('next'),
        },
        {
          action: 'previous',
          shortcut: config.previous,
          run: () => runShortcutAction('previous'),
        },
      ] as const;

      const results = await Promise.all(
        entries.map(({ action, shortcut, run }) => {
          if (getGlobalShortcutOwner(shortcut, platform) === 'linux-menu') {
            logger.info(
              DOMAIN,
              `Linux app menu owns this reserved shortcut; skipping ${action}: ${shortcut}`,
            );
            return true;
          }

          const key = shortcut.trim().toLowerCase();
          if (!key || seen.has(key)) {
            logger.warn(DOMAIN, `Skipping duplicate global shortcut for ${action}: ${shortcut}`);
            return false;
          }
          seen.add(key);
          return globalShortcuts
            .register(shortcut, (state) => {
              if (state === 'Pressed') {
                logger.debug(DOMAIN, `Global ${action} pressed`);
                run();
              }
            })
            .then((registered) => {
              if (registered) ownedShortcuts.add(shortcut);
              return registered;
            });
        }),
      );

      const failures = results.filter((r) => !r).length;
      if (failures > 0) {
        logger.warn(DOMAIN, `${failures} shortcuts failed to register (likely due to collisions)`);
      }

      return failures === 0;
    }),

  /**
   * Unregister all global shortcuts.
   */
  unregisterAll: () => serializeRegistration(unregisterOwned),
};
