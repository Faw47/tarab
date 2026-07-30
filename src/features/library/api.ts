import { normalizePath } from '../../lib/path-utils';
import {
  dbGetAlbumAggregates,
  dbGetArtistAggregates,
  dbGetLibraryStats,
  dbGetMostPlayed,
  dbGetRecentlyAdded,
  dbGetTrackCount,
  dbGetTracksByAlbumArtist,
  dbGetTracksByArtist,
  dbGetTracksByIds,
  dbGetTracksPaginated,
  dbSearchTracks,
  searchLyrics,
} from '../../lib/tauri-commands';
import {
  DbAlbumAggregateArraySchema,
  DbArtistAggregateArraySchema,
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
  coverArtHash?: string | null;
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
  trackNumber?: number | null;
  discNumber?: number | null;
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
    trackNumber: track.trackNumber ?? null,
    discNumber: track.discNumber ?? null,
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
  hasCoverArt: Boolean(result.coverArtHash),
  coverArtHash: result.coverArtHash ?? null,
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

export async function fetchAlbumTracks(album: string, artist: string): Promise<Track[]> {
  const raw = await dbGetTracksByAlbumArtist(album, artist);
  return DbTrackArraySchema.parse(raw).map(mapDbTrackToTrack);
}

export async function fetchArtistTracks(artist: string): Promise<Track[]> {
  const raw = await dbGetTracksByArtist(artist);
  return DbTrackArraySchema.parse(raw).map(mapDbTrackToTrack);
}

export async function fetchAlbumAggregates() {
  const raw = DbAlbumAggregateArraySchema.parse(await dbGetAlbumAggregates());
  return raw.map((aggregate) => ({
    album: aggregate.album,
    artist: aggregate.artist,
    count: aggregate.trackCount,
    track: mapDbTrackToTrack(aggregate.representative),
  }));
}

export async function fetchArtistAggregates() {
  const raw = DbArtistAggregateArraySchema.parse(await dbGetArtistAggregates());
  return raw.map((aggregate) => ({
    artist: aggregate.artist,
    count: aggregate.trackCount,
    tracks: [mapDbTrackToTrack(aggregate.representative)],
  }));
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
  const metadataResults = SearchResultArraySchema.parse(metadataRaw);
  const lyricsResults = LyricsSearchResultArraySchema.parse(lyricsRaw);
  const ids = Array.from(
    new Set([
      ...metadataResults.map((result) => result.id),
      ...lyricsResults.map((result) => result.id),
    ]),
  );
  const hydratedRaw = ids.length > 0 ? await dbGetTracksByIds(ids) : [];
  const hydrated = DbTrackArraySchema.parse(hydratedRaw).map(mapDbTrackToTrack);
  const hydratedById = new Map(hydrated.map((track) => [track.id, track]));

  return {
    metadata: metadataResults.map(
      (result) => hydratedById.get(normalizePath(result.id)) ?? mapSearchResultToTrack(result),
    ),
    lyrics: lyricsResults.map((result) => ({
      ...(hydratedById.get(normalizePath(result.id)) ?? mapSearchResultToTrack(result)),
      matchedLine: result.matchedLine,
      matchedLineIndex: result.matchedLineIndex,
    })),
  };
}
