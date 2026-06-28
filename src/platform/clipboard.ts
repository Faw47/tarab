import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { logger } from './logger';

const DOMAIN = 'Clipboard';

/**
 * Platform clipboard management wrapper.
 */
export const clipboard = {
  /**
   * Write text to the system clipboard.
   */
  writeText: async (text: string): Promise<boolean> => {
    try {
      await writeText(text);
      logger.debug(DOMAIN, 'Text written to clipboard');
      return true;
    } catch (err) {
      logger.error(DOMAIN, 'Failed to write text to clipboard', err);
      return false;
    }
  },

  /**
   * Read text from the system clipboard.
   */
  readText: async (): Promise<string | null> => {
    try {
      const text = await readText();
      logger.debug(DOMAIN, 'Text read from clipboard');
      return text;
    } catch (err) {
      logger.error(DOMAIN, 'Failed to read text from clipboard', err);
      return null;
    }
  },
};
