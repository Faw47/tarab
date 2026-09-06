import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORTED_AUDIO_EXTENSIONS } from '../lib/media-formats';
import { dialog } from './dialog';

const openMock = vi.hoisted(() => vi.fn(async () => null));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: openMock,
}));

describe('audio file dialog formats', () => {
  beforeEach(() => {
    openMock.mockClear();
  });

  it('exposes only the canonical formats backed by compiled decoders', () => {
    expect(SUPPORTED_AUDIO_EXTENSIONS).toEqual([
      'mp3',
      'flac',
      'wav',
      'ogg',
      'm4a',
      'aac',
      'aiff',
      'alac',
    ]);
  });

  it('passes the canonical formats to the native audio picker', async () => {
    await dialog.openAudioFiles();

    expect(openMock).toHaveBeenCalledWith({
      multiple: true,
      directory: false,
      title: 'Select Audio Files',
      filters: [{ name: 'Audio', extensions: [...SUPPORTED_AUDIO_EXTENSIONS] }],
    });
  });
});
