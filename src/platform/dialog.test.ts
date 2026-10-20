import { open } from '@tauri-apps/plugin-dialog';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('./logger', () => ({ logger: { error: vi.fn() } }));

import { dialog } from './dialog';

describe('audio file chooser', () => {
  it('offers only suffixes supported by the enabled playback stack', async () => {
    vi.mocked(open).mockResolvedValue(null);
    await dialog.openAudioFiles();
    expect(open).toHaveBeenCalledWith({
      multiple: true,
      directory: false,
      title: 'Select Audio Files',
      filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'flac', 'wav', 'ogg', 'aac'] }],
    });
  });
});
