import {
  isRegistered,
  register,
  unregister,
  unregisterAll,
} from '@tauri-apps/plugin-global-shortcut';
import { logger } from './logger';

const DOMAIN = 'GlobalShortcuts';

/**
 * Platform global shortcuts wrapper.
 */
export const globalShortcuts = {
  /**
   * Register a new global shortcut.
   */
  register: async (
    shortcut: string,
    handler: (state: 'Pressed' | 'Released') => void,
  ): Promise<boolean> => {
    try {
      const alreadyRegistered = await isRegistered(shortcut);
      if (alreadyRegistered) {
        logger.warn(DOMAIN, `Shortcut "${shortcut}" is already registered. Re-registering...`);
        await unregister(shortcut);
      }

      await register(shortcut, (event) => {
        handler(event.state);
      });

      logger.info(DOMAIN, `Registered shortcut: ${shortcut}`);
      return true;
    } catch (err) {
      logger.error(DOMAIN, `Failed to register shortcut: ${shortcut}`, err);
      return false;
    }
  },

  /**
   * Unregister a global shortcut.
   */
  unregister: async (shortcut: string): Promise<void> => {
    try {
      await unregister(shortcut);
      logger.info(DOMAIN, `Unregistered shortcut: ${shortcut}`);
    } catch (err) {
      logger.error(DOMAIN, `Failed to unregister shortcut: ${shortcut}`, err);
    }
  },

  /**
   * Unregister all global shortcuts registered by this app.
   */
  unregisterAll: async (): Promise<void> => {
    try {
      await unregisterAll();
      logger.info(DOMAIN, 'Unregistered all shortcuts');
    } catch (err) {
      logger.error(DOMAIN, 'Failed to unregister all shortcuts', err);
    }
  },

  /**
   * Check if a shortcut is already registered.
   */
  isRegistered: async (shortcut: string): Promise<boolean> => {
    try {
      return await isRegistered(shortcut);
    } catch (err) {
      return false;
    }
  },
};
