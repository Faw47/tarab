import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { logger } from './logger';

const DOMAIN = 'DeepLinks';

/**
 * Platform deep link wrapper.
 */
export const deepLinks = {
  /**
   * Listen for incoming deep links while the app is running.
   */
  listen: async (onLink: (url: string) => void) => {
    try {
      logger.debug(DOMAIN, 'Subscribing to deep links');
      return await onOpenUrl((urls) => {
        logger.info(DOMAIN, 'Deep link received', { urls });
        urls.forEach(onLink);
      });
    } catch (err) {
      logger.error(DOMAIN, 'Failed to subscribe to deep links', err);
      return () => {};
    }
  },
};
