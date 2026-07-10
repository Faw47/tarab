import { open } from '@tauri-apps/plugin-dialog';
import { logger } from './logger';

const DOMAIN = 'Dialog';
type DialogSelection = string | string[] | null;

const firstSelection = (selected: DialogSelection): string | null =>
  Array.isArray(selected) ? (selected[0] ?? null) : selected;

const selectionList = (selected: DialogSelection): string[] | null => {
  if (Array.isArray(selected)) return selected;
  return selected ? [selected] : null;
};

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
      return firstSelection(selected);
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
      return selectionList(selected);
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
      return selectionList(selected);
    } catch (err) {
      logger.error(DOMAIN, 'Failed to open image dialog', err);
      return null;
    }
  },
};
