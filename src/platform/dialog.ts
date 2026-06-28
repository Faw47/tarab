import { ask, confirm, message, open, save } from '@tauri-apps/plugin-dialog';
import { logger } from './logger';

const DOMAIN = 'Dialog';

/**
 * Platform native dialog wrapper.
 */
export const dialog = {
  /**
   * Open a folder selection dialog.
   */
  openFolder: async (title = 'Select Folder'): Promise<string | null> => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title,
      });
      return selected as string | null;
    } catch (err) {
      logger.error(DOMAIN, 'Failed to open folder dialog', err);
      return null;
    }
  },

  /**
   * Open a file selection dialog for audio files.
   */
  openAudioFiles: async (title = 'Select Audio Files'): Promise<string[] | null> => {
    try {
      const selected = await open({
        multiple: true,
        directory: false,
        title,
        filters: [
          {
            name: 'Audio',
            extensions: ['mp3', 'm4a', 'flac', 'wav', 'ogg', 'opus'],
          },
        ],
      });
      return selected as string[] | null;
    } catch (err) {
      logger.error(DOMAIN, 'Failed to open file dialog', err);
      return null;
    }
  },

  /**
   * Open a file selection dialog for images.
   */
  openImageFiles: async (
    title = 'Select Image Files',
    multiple = false,
  ): Promise<string[] | null> => {
    try {
      const selected = await open({
        multiple,
        directory: false,
        title,
        filters: [
          {
            name: 'Images',
            extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
          },
        ],
      });
      return selected as string[] | null;
    } catch (err) {
      logger.error(DOMAIN, 'Failed to open image dialog', err);
      return null;
    }
  },

  /**
   * Open a save file dialog for playlist export.
   */
  savePlaylist: async (defaultPath: string): Promise<string | null> => {
    try {
      return await save({
        title: 'Export Playlist',
        defaultPath,
        filters: [
          {
            name: 'Tarab Playlist',
            extensions: ['json'],
          },
        ],
      });
    } catch (err) {
      logger.error(DOMAIN, 'Failed to open save dialog', err);
      return null;
    }
  },

  /**
   * Show a native message dialog.
   */
  showMessage: async (msg: string, title?: string) => {
    await message(msg, { title, kind: 'info' });
  },

  /**
   * Show a native confirm dialog.
   */
  showConfirm: async (msg: string, title?: string): Promise<boolean> => {
    return await confirm(msg, { title, kind: 'warning' });
  },

  /**
   * Show a native ask dialog (Yes/No).
   */
  showAsk: async (msg: string, title?: string): Promise<boolean> => {
    return await ask(msg, { title, kind: 'info' });
  },
};
