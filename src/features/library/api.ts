import { normalizePath } from '../../lib/path-utils';
import {
  dbGetLibraryStats,
  dbGetMostPlayed,
  dbGetRecentlyAdded,
  dbGetTrackCount,
  dbGetTracksPaginated,
  dbSearchTracks,
  searchLyrics,
} from '../../lib/tauri-commands';
import {
  DbTrackArraySchema,
  LibraryStatsSchema,
  TrackCountSchema,
} from '../../lib/validation/library';
import {
  LyricsSearchResultArraySchema,
  SearchResultArraySchema,
} from '../../lib/validation/search';
import type { SortBy, Track } from '../../types';

interface SearchLike {
  id: string;
  title: string;
  artist: string;
  albumArtist?: string | null;
  album: string;
  duration: number;
  filePath: string;
  coverArtHash: string | null;
  blurhash?: string | null;
}

export interface LibrarySearchPayload {
  metadata: SearchLike[];
  lyrics: Array<SearchLike & { matchedLine: string; matchedLineIndex: number }>;
}

export const mapDbTrackToTrack = (track: {
  id: string;
  title: string;
  artist: string;
  albumArtist?: string | null;
  album: string;
  year: number | null;
  duration: number;
  filePath: string;
  hasCoverArt: boolean;
  coverArtHash: string | null;
  dateAdded: number;
  playCount?: number;
  lastPlayed?: number | null;
  rating?: number | null;
  blurhash?: string | null;
  fileFormat?: string | null;
  bitrate?: number | null;
  sampleRate?: number | null;
  fileSize?: number | null;
}): Track => {
  const filePath = normalizePath(track.filePath);
  return {
    id: normalizePath(track.id),
    title: track.title,
    artist: track.artist,
    albumArtist: track.albumArtist ?? null,
    album: track.album,
    year: track.year,
    duration: track.duration,
    filePath,
    hasCoverArt: track.hasCoverArt,
    coverArtHash: track.coverArtHash ?? null,
    fileFormat: track.fileFormat ?? undefined,
    bitrate: track.bitrate ?? undefined,
    sampleRate: track.sampleRate ?? undefined,
    fileSize: track.fileSize ?? undefined,
    blurhash: track.blurhash ?? null,
    rating: track.rating ?? null,
    dateAdded: track.dateAdded,
    playCount: track.playCount ?? 0,
    lastPlayed: track.lastPlayed ?? null,
  };
};

export const mapSearchResultToTrack = (result: SearchLike): Track => ({
  id: normalizePath(result.id),
  title: result.title,
  artist: result.artist,
  album: result.album,
  year: null,
  duration: result.duration,
  filePath: normalizePath(result.filePath),
  hasCoverArt: result.coverArtHash !== null,
  coverArtHash: result.coverArtHash,
  blurhash: result.blurhash,
  dateAdded: Date.now(),
});

export async function fetchLibraryTrackCount(): Promise<number> {
  const raw = await dbGetTrackCount();
  return TrackCountSchema.parse(raw);
}

export async function fetchLibraryStats() {
  const raw = await dbGetLibraryStats();
  return LibraryStatsSchema.parse(raw);
}

export async function fetchLibraryTracksPage(params: {
  offset: number;
  limit: number;
  sortBy?: SortBy;
  sortOrder?: 'asc' | 'desc';
}): Promise<Track[]> {
  const raw = await dbGetTracksPaginated(
    params.offset,
    params.limit,
    params.sortBy ?? 'dateAdded',
    params.sortOrder ?? 'desc',
  );
  const parsed = DbTrackArraySchema.parse(raw);
  return parsed.map(mapDbTrackToTrack);
}
export async function fetchRecentlyAddedTracks(days = 30, limit = 50): Promise<Track[]> {
  const raw = await dbGetRecentlyAdded(days, limit);
  const parsed = DbTrackArraySchema.parse(raw);
  return parsed.map(mapDbTrackToTrack);
}

export async function fetchMostPlayedTracks(limit = 100): Promise<Track[]> {
  const raw = await dbGetMostPlayed(limit);
  const parsed = DbTrackArraySchema.parse(raw);
  return parsed.map(mapDbTrackToTrack);
}

export async function fetchLibrarySearch(
  query: string,
  limit: number = 100,
  options: {
    includeMetadata?: boolean;
    includeLyrics?: boolean;
  } = {},
): Promise<LibrarySearchPayload> {
  const { includeMetadata = true, includeLyrics = true } = options;
  const metadataPromise = includeMetadata ? dbSearchTracks(query, limit) : Promise.resolve([]);
  const lyricsPromise = includeLyrics ? searchLyrics(query, limit) : Promise.resolve([]);
  const [metadataRaw, lyricsRaw] = await Promise.all([metadataPromise, lyricsPromise]);

  return {
    metadata: SearchResultArraySchema.parse(metadataRaw),
    lyrics: LyricsSearchResultArraySchema.parse(lyricsRaw),
  };
}
