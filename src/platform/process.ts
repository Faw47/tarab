import { relaunch } from '@tauri-apps/plugin-process';
import { logger } from './logger';

const DOMAIN = 'Process';

/**
 * Platform process management wrapper.
 */
export const process = {
  /**
   * Restart the application.
   */
  restart: async (reason?: string) => {
    logger.info(DOMAIN, 'Relaunching application', { reason });
    await relaunch();
  },

};
