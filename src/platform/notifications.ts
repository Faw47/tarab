import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from '@tauri-apps/plugin-notification';
import { logger } from './logger';

const DOMAIN = 'Notifications';

/**
 * Platform native notifications wrapper.
 */
export const notifications = {
  /**
   * Send a native notification.
   */
  send: async (title: string, body?: string, icon?: string): Promise<void> => {
    try {
      let permissionGranted = await isPermissionGranted();

      if (!permissionGranted) {
        const permission = await requestPermission();
        permissionGranted = permission === 'granted';
      }

      if (permissionGranted) {
        sendNotification({ title, body, icon });
      } else {
        logger.warn(DOMAIN, 'Notification permission denied');
      }
    } catch (err) {
      logger.error(DOMAIN, 'Failed to send notification', err);
    }
  },

  /**
   * Specifically for library scan completion.
   */
  notifyScanComplete: (count: number) => {
    notifications.send('Library Scan Complete', `Added ${count} new tracks to your library.`);
  },

  /**
   * Specifically for update availability.
   */
  notifyUpdateReady: (version: string) => {
    notifications.send('Update Ready', `Tarab v${version} is ready to install. Restart to apply.`);
  },
};
