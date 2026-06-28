import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { TagInfo, TagUpdate, Track } from '../types';

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
      buildTagUpdateFromInfo: (info) => ({
        title: info.title ?? undefined,
        artist: info.artist ?? undefined,
        album: info.album ?? undefined,
        albumArtist: info.albumArtist ?? undefined,
        year: info.year ?? undefined,
        trackNumber: info.trackNumber ?? undefined,
        totalTracks: info.totalTracks ?? undefined,
        discNumber: info.discNumber ?? undefined,
        totalDiscs: info.totalDiscs ?? undefined,
        genre: info.genre ?? undefined,
        composer: info.composer ?? undefined,
        comment: info.comment ?? undefined,
        extraTags: info.extraTags ?? undefined,
      }),
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
