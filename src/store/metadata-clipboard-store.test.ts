import { describe, expect, it } from 'vitest';
import type { TagInfo } from '../types';
import { useMetadataClipboardStore } from './metadata-clipboard-store';

const baseTagInfo: TagInfo = {
  title: 'Source title',
  artist: 'Source artist',
  album: 'Source album',
  hasCoverArt: false,
  filePath: 'C:/Music/source.flac',
  fileFormat: 'FLAC',
  durationSecs: 120,
};

describe('metadata clipboard store', () => {
  it('preserves missing full-tag fields as clear intent', () => {
    const update = useMetadataClipboardStore.getState().buildTagUpdateFromInfo(baseTagInfo);

    expect(update.title).toBe('Source title');
    expect(update.year).toBeNull();
    expect(update.totalDiscs).toBeNull();
    expect(update.clearFields).toEqual(
      expect.arrayContaining(['year', 'trackNumber', 'totalTracks', 'discNumber', 'totalDiscs']),
    );
  });
});
