import { getAlbumArtist, getAlbumKey } from '../../lib/album-key';
import type { Track } from '../../types';

export type LibraryFacet = 'all' | 'albums' | 'artists' | 'recent' | 'mostPlayed';
export type LibrarySmartFilter = 'missingArt' | 'untagged' | null;

export type LibraryDetailScope =
  | { type: 'album'; album: string; artist: string }
  | { type: 'artist'; artist: string }
  | null;

export interface AlbumGroup {
  track: Track;
  count: number;
}

export interface ArtistGroup {
  artist: string;
  tracks: Track[];
  count: number;
  coverArt?: string;
}

export interface FacetCounts {
  all: number;
  albums: number;
  artists: number;
  recent: number;
  mostPlayed: number;
  duration: number;
}

const RECENT_LIMIT = 50;
const MOST_PLAYED_LIMIT = 100;

export function applySmartFilter(tracks: Track[], smartFilter: LibrarySmartFilter): Track[] {
  if (smartFilter === 'missingArt') {
    return tracks.filter((track) => !track.hasCoverArt);
  }

  if (smartFilter === 'untagged') {
    return tracks.filter(
      (track) => !track.artist || track.artist.toLowerCase() === 'unknown artist' || !track.title,
    );
  }

  return tracks;
}

export function buildFacetCounts(tracks: Track[]): FacetCounts {
  const albumKeys = new Set<string>();
  const artistKeys = new Set<string>();
  let duration = 0;

  const playedCount = tracks.filter((t) => (t.playCount ?? 0) > 0).length;

  tracks.forEach((track) => {
    albumKeys.add(getAlbumKey(track));
    artistKeys.add(track.artist);
    duration += track.duration;
  });

  return {
    all: tracks.length,
    albums: albumKeys.size,
    artists: artistKeys.size,
    recent: Math.min(RECENT_LIMIT, tracks.length),
    mostPlayed: Math.min(MOST_PLAYED_LIMIT, playedCount),
    duration,
  };
}

export function buildAlbumGroups(tracks: Track[]): AlbumGroup[] {
  const albumMap = new Map<string, AlbumGroup>();

  tracks.forEach((track) => {
    const key = getAlbumKey(track);
    const existing = albumMap.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }

    albumMap.set(key, { track, count: 1 });
  });

  return Array.from(albumMap.values());
}

export function buildArtistGroups(
  tracks: Track[],
  resolveCover: (hash?: string | null, size?: 'small' | 'medium' | 'large') => string | undefined,
): ArtistGroup[] {
  const artistMap = new Map<string, ArtistGroup>();

  tracks.forEach((track) => {
    const existing = artistMap.get(track.artist);

    if (existing) {
      existing.tracks.push(track);
      existing.count += 1;
      if (!existing.coverArt) {
        existing.coverArt = track.coverArt ?? resolveCover(track.coverArtHash, 'large');
      }
      return;
    }

    artistMap.set(track.artist, {
      artist: track.artist,
      tracks: [track],
      count: 1,
      coverArt: track.coverArt ?? resolveCover(track.coverArtHash, 'large'),
    });
  });

  return Array.from(artistMap.values());
}

export function buildRecentTracks(tracks: Track[]): Track[] {
  return [...tracks].sort((left, right) => right.dateAdded - left.dateAdded).slice(0, RECENT_LIMIT);
}

export function buildMostPlayedTracks(tracks: Track[]): Track[] {
  return [...tracks]
    .filter((t) => (t.playCount ?? 0) > 0)
    .sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0))
    .slice(0, MOST_PLAYED_LIMIT);
}

export function buildDetailTracks(allTracks: Track[], detailScope: LibraryDetailScope): Track[] {
  if (!detailScope) {
    return [];
  }

  if (detailScope.type === 'album') {
    return allTracks.filter(
      (track) => track.album === detailScope.album && getAlbumArtist(track) === detailScope.artist,
    );
  }

  return allTracks.filter((track) => track.artist === detailScope.artist);
}

export function buildFacetPayload(
  facet: LibraryFacet,
  tracks: Track[],
  resolveCover: (hash?: string | null, size?: 'small' | 'medium' | 'large') => string | undefined,
): Track[] | AlbumGroup[] | ArtistGroup[] {
  if (facet === 'albums') {
    return buildAlbumGroups(tracks);
  }

  if (facet === 'artists') {
    return buildArtistGroups(tracks, resolveCover);
  }

  if (facet === 'recent') {
    return buildRecentTracks(tracks);
  }

  if (facet === 'mostPlayed') {
    return buildMostPlayedTracks(tracks);
  }

  return tracks;
}

export function formatLongDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);

  if (hours <= 0) {
    return `${minutes}m`;
  }

  return `${hours}h ${minutes}m`;
}
