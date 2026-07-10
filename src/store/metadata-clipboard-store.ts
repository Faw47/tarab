import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TagClearField, TagInfo, TagUpdate, Track } from '../types';

interface ClipboardArt {
  base64: string;
  mime: string;
}

interface MetadataClipboardState {
  data: TagUpdate | null;
  coverArt: ClipboardArt | null;
  copiedFromPath?: string;
  copiedAt?: number;
  setClipboard: (data: TagUpdate, coverArt: ClipboardArt | null, sourcePath?: string) => void;
  clearClipboard: () => void;
  buildTagUpdateFromInfo: (info: TagInfo) => TagUpdate;
  canPaste: () => boolean;
}

const tagFields = [
  'title',
  'artist',
  'album',
  'albumArtist',
  'year',
  'trackNumber',
  'totalTracks',
  'discNumber',
  'totalDiscs',
  'genre',
  'composer',
  'comment',
] as const satisfies readonly TagClearField[];

const buildTagUpdateFromInfo = (info: TagInfo): TagUpdate => {
  const update: TagUpdate = {};
  const editableUpdate = update as Partial<Record<TagClearField, string | number | null>>;
  const clearFields: TagClearField[] = [];

  for (const field of tagFields) {
    const value = info[field];
    if (value === undefined || value === null) {
      editableUpdate[field] = null;
      clearFields.push(field);
    } else {
      editableUpdate[field] = value;
    }
  }

  if (clearFields.length > 0) update.clearFields = clearFields;
  if (info.extraTags) update.extraTags = info.extraTags;

  return update;
};

export const useMetadataClipboardStore = create<MetadataClipboardState>()(
  persist(
    (set, get) => ({
      data: null,
      coverArt: null,
      copiedFromPath: undefined,
      copiedAt: undefined,
      setClipboard: (data, coverArt, sourcePath) =>
        set({
          data,
          coverArt,
          copiedFromPath: sourcePath,
          copiedAt: Date.now(),
        }),
      clearClipboard: () =>
        set({
          data: null,
          coverArt: null,
          copiedFromPath: undefined,
          copiedAt: undefined,
        }),
      buildTagUpdateFromInfo,
      canPaste: () => {
        const { data } = get();
        return !!data;
      },
    }),
    {
      name: 'metadata-clipboard',
      version: 1,
    },
  ),
);

export const tagUpdateFromTrack = (track: Track): TagUpdate => ({
  title: track.title,
  artist: track.artist,
  album: track.album,
  year: track.year ?? undefined,
});
