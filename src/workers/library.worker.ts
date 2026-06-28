import { expose } from 'comlink';
import Fuse from 'fuse.js';

export type SerializedTrack = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  filePath: string;
  hasCoverArt: boolean;
  coverArtHash?: string | null;
  dateAdded: number;
};

export type SearchScope = 'all' | 'tracks' | 'albums' | 'artists' | 'lyrics';

const fuseKeys = (
  searchScope: SearchScope,
): Array<{ name: keyof SerializedTrack; weight: number }> => {
  switch (searchScope) {
    case 'artists':
      return [
        { name: 'artist', weight: 0.85 },
        { name: 'album', weight: 0.15 },
      ];
    case 'albums':
      return [
        { name: 'album', weight: 0.7 },
        { name: 'artist', weight: 0.2 },
        { name: 'title', weight: 0.1 },
      ];
    case 'tracks':
      return [
        { name: 'title', weight: 0.6 },
        { name: 'artist', weight: 0.25 },
        { name: 'album', weight: 0.15 },
      ];
    case 'lyrics':
      return [
        { name: 'title', weight: 0.4 },
        { name: 'artist', weight: 0.35 },
        { name: 'album', weight: 0.25 },
      ];
    default:
      return [
        { name: 'title', weight: 0.45 },
        { name: 'artist', weight: 0.35 },
        { name: 'album', weight: 0.2 },
      ];
  }
};

const worker = {
  rankTracks(tracks: SerializedTrack[], query: string, searchScope: SearchScope): SerializedTrack[] {
    const needle = query.trim();
    if (!needle || tracks.length === 0) {
      return tracks;
    }
    const fuse = new Fuse(tracks, {
      keys: fuseKeys(searchScope),
      includeScore: true,
      threshold: 0.34,
      ignoreLocation: true,
      minMatchCharLength: 2,
    });
    const ranked = fuse.search(needle).map((result) => result.item);
    const seen = new Set(ranked.map((track) => track.id));
    const fallback = tracks.filter((track) => !seen.has(track.id));
    return [...ranked, ...fallback];
  },
};

expose(worker);
export type LibraryWorker = typeof worker;
