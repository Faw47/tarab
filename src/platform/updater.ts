import { check } from '@tauri-apps/plugin-updater';
import { logger } from './logger';
import { process as platformProcess } from './process';

const DOMAIN = 'Updater';

/**
 * Platform updater wrapper.
 */
export const updater = {
  /**
   * Check for application updates.
   */
  checkForUpdate: async () => {
    try {
      logger.info(DOMAIN, 'Checking for updates...');
      const update = await check();

      if (update) {
        logger.info(DOMAIN, `Update found: v${update.version}`, { date: update.date });
        return update;
      }

      logger.info(DOMAIN, 'No updates found');
      return null;
    } catch (err) {
      logger.error(DOMAIN, 'Update check failed', err);
      return null;
    }
  },

  /**
   * Download and install an update, then relaunch.
   */
  installUpdate: async (update: any) => {
    try {
      logger.info(DOMAIN, `Downloading and installing update v${update.version}`);

      await update.downloadAndInstall();

      logger.info(DOMAIN, 'Update installed. Relaunching...');
      await platformProcess.restart('Update installed');
    } catch (err) {
      logger.error(DOMAIN, 'Failed to install update', err);
      throw err;
    }
  },
};
