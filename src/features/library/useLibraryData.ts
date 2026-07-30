import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLibraryStore } from '../../store/library-store';
import type { SortBy, Track } from '../../types';
import type { SearchScope } from '../../workers/library.worker';
import { rankTracksWithFuseWorker } from '../../workers/librarySearchFuseClient';
import {
  fetchAlbumAggregates,
  fetchArtistAggregates,
  fetchLibrarySearch,
  fetchLibraryStats,
  fetchLibraryTrackCount,
  fetchLibraryTracksPage,
  fetchMostPlayedTracks,
  fetchRecentlyAddedTracks,
  mapSearchResultToTrack,
} from './api';
import { mergeTrackPages } from './mergeTrackPages';
import { libraryKeys } from './queryKeys';

const SEARCH_DEBOUNCE_MS = 160;

const sortTracks = (tracks: Track[], sortBy: SortBy): Track[] => {
  return [...tracks].sort((a, b) => {
    switch (sortBy) {
      case 'title':
        return a.title.localeCompare(b.title);
      case 'artist':
        return a.artist.localeCompare(b.artist);
      case 'album':
        return a.album.localeCompare(b.album);
      case 'dateAdded':
        return b.dateAdded - a.dateAdded;
      default:
        return 0;
    }
  });
};

const localFilterTracks = (
  tracks: Track[],
  query: string,
  searchScope: 'all' | 'tracks' | 'albums' | 'artists' | 'lyrics',
) => {
  const needle = query.trim().toLowerCase();
  if (!needle) return tracks;

  if (searchScope === 'lyrics') {
    return [];
  }

  return tracks.filter((track) =>
    searchScope === 'artists'
      ? track.artist.toLowerCase().includes(needle)
      : searchScope === 'albums'
        ? track.album.toLowerCase().includes(needle) || track.artist.toLowerCase().includes(needle)
        : track.title.toLowerCase().includes(needle) ||
          track.artist.toLowerCase().includes(needle) ||
          track.album.toLowerCase().includes(needle),
  );
};

const toSerializedTrack = (track: Track) => ({
  id: track.id,
  title: track.title,
  artist: track.artist,
  albumArtist: track.albumArtist ?? null,
  album: track.album,
  duration: track.duration,
  filePath: track.filePath,
  hasCoverArt: track.hasCoverArt,
  coverArtHash: track.coverArtHash ?? null,
  blurhash: track.blurhash ?? null,
  dateAdded: track.dateAdded,
});

export function useLibraryData(options: { includeLibraryShelves?: boolean } = {}) {
  const queryClient = useQueryClient();

  const searchQuery = useLibraryStore((s) => s.searchQuery);
  const searchScope = useLibraryStore((s) => s.searchScope);
  const setSearchQuery = useLibraryStore((s) => s.setSearchQuery);
  const setSearchScope = useLibraryStore((s) => s.setSearchScope);
  const sortBy = useLibraryStore((s) => s.sortBy);
  const setSortBy = useLibraryStore((s) => s.setSortBy);
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [searchQuery]);

  const tracksQuery = useQuery({
    queryKey: libraryKeys.tracks(),
    queryFn: () =>
      fetchLibraryTracksPage({
        offset: 0,
        limit: 400,
        sortBy: 'dateAdded',
        sortOrder: 'desc',
      }),
    staleTime: 60_000,
  });

  const trackCountQuery = useQuery({
    queryKey: libraryKeys.trackCount(),
    queryFn: fetchLibraryTrackCount,
    staleTime: 60_000,
  });

  const statsQuery = useQuery({
    queryKey: libraryKeys.stats(),
    queryFn: fetchLibraryStats,
    staleTime: 60_000,
  });

  const albumAggregatesQuery = useQuery({
    queryKey: libraryKeys.albums(),
    queryFn: fetchAlbumAggregates,
    staleTime: 60_000,
  });

  const artistAggregatesQuery = useQuery({
    queryKey: libraryKeys.artists(),
    queryFn: fetchArtistAggregates,
    staleTime: 60_000,
  });

  const recentTracksQuery = useQuery({
    queryKey: libraryKeys.recent(30, 50),
    queryFn: () => fetchRecentlyAddedTracks(30, 50),
    enabled: options.includeLibraryShelves === true,
    staleTime: 60_000,
  });

  const mostPlayedTracksQuery = useQuery({
    queryKey: libraryKeys.mostPlayed(100),
    queryFn: () => fetchMostPlayedTracks(100),
    enabled: options.includeLibraryShelves === true,
    staleTime: 60_000,
  });

  const tracks = tracksQuery.data ?? [];
  const libraryStats = statsQuery.data ?? null;
  const albumAggregates = albumAggregatesQuery.data ?? [];
  const artistAggregates = artistAggregatesQuery.data ?? [];
  const recentTracks = recentTracksQuery.data ?? [];
  const mostPlayedTracks = mostPlayedTracksQuery.data ?? [];
  const trackCount = libraryStats?.trackCount ?? trackCountQuery.data ?? tracks.length;

  const trimmedSearch = debouncedSearchQuery.trim();
  const shouldSearchMetadata = trimmedSearch.length > 0 && searchScope !== 'lyrics';
  const shouldSearchLyrics =
    trimmedSearch.length >= 3 && (searchScope === 'all' || searchScope === 'lyrics');

  const searchQueryResult = useQuery({
    queryKey: libraryKeys.search(trimmedSearch, searchScope),
    queryFn: () =>
      fetchLibrarySearch(trimmedSearch, 120, {
        includeMetadata: shouldSearchMetadata,
        includeLyrics: shouldSearchLyrics,
      }),
    enabled: trimmedSearch.length > 0 && (shouldSearchMetadata || shouldSearchLyrics),
    staleTime: 20_000,
  });

  const lyricsMatchLineMap = useMemo(() => {
    const map = new Map<string, string>();
    const lyrics = searchQueryResult.data?.lyrics ?? [];
    for (const result of lyrics) {
      map.set(result.id, result.matchedLine);
    }
    return map;
  }, [searchQueryResult.data?.lyrics]);

  const mergedSearchTracks = useMemo(() => {
    if (!trimmedSearch) return [];

    const payload = searchQueryResult.data;
    if (!payload) return [];

    const metadataResults = shouldSearchMetadata ? payload.metadata : [];
    const lyricsResults = shouldSearchLyrics ? payload.lyrics : [];
    const candidateResults =
      searchScope === 'lyrics'
        ? lyricsResults
        : searchScope === 'all'
          ? [...metadataResults, ...lyricsResults]
          : metadataResults;

    const byId = new Map(tracks.map((track) => [track.id, track]));
    const merged = new Map<string, Track>();

    for (const result of candidateResults) {
      merged.set(result.id, byId.get(result.id) ?? mapSearchResultToTrack(result));
    }

    return Array.from(merged.values());
  }, [
    searchQueryResult.data,
    searchScope,
    shouldSearchLyrics,
    shouldSearchMetadata,
    tracks,
    trimmedSearch,
  ]);

  const [fuseRankedTracks, setFuseRankedTracks] = useState<Track[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!trimmedSearch || mergedSearchTracks.length === 0) {
      setFuseRankedTracks([]);
      return;
    }

    const serialized = mergedSearchTracks.map(toSerializedTrack);
    void rankTracksWithFuseWorker(serialized, trimmedSearch, searchScope as SearchScope).then(
      (out) => {
        if (cancelled) return;
        const byId = new Map(mergedSearchTracks.map((t) => [t.id, t]));
        setFuseRankedTracks(
          out.map((row) => byId.get(row.id)).filter((t): t is Track => Boolean(t)),
        );
      },
    );

    return () => {
      cancelled = true;
    };
  }, [mergedSearchTracks, searchScope, trimmedSearch]);

  const searchResultTracks = useMemo(() => {
    if (!trimmedSearch) return [];
    if (mergedSearchTracks.length === 0) return [];
    if (fuseRankedTracks.length === 0) {
      return mergedSearchTracks;
    }
    return fuseRankedTracks;
  }, [fuseRankedTracks, mergedSearchTracks, trimmedSearch]);

  const filteredTracks = useMemo(() => {
    if (trimmedSearch) {
      if (searchResultTracks.length > 0 || searchQueryResult.data) {
        return searchResultTracks;
      }
      return sortTracks(localFilterTracks(tracks, trimmedSearch, searchScope), sortBy);
    }

    return sortTracks(tracks, sortBy);
  }, [searchQueryResult.data, searchResultTracks, searchScope, sortBy, tracks, trimmedSearch]);

  const setTracks = useCallback(
    (nextTracks: Track[]) => {
      queryClient.setQueryData(libraryKeys.tracks(), nextTracks);
    },
    [queryClient],
  );

  const appendTracks = useCallback(
    (newTracks: Track[]) => {
      queryClient.setQueryData<Track[]>(libraryKeys.tracks(), (previous = []) =>
        mergeTrackPages(previous, newTracks),
      );
    },
    [queryClient],
  );

  const setTrackCount = useCallback(
    (count: number) => {
      queryClient.setQueryData(libraryKeys.trackCount(), Math.max(0, count));
    },
    [queryClient],
  );

  const applyCoverArtHashes = useCallback(
    (entries: [string, string | null][]) => {
      if (entries.length === 0) return;
      const lookup = new Map(entries);
      queryClient.setQueryData<Track[]>(libraryKeys.tracks(), (previous = []) =>
        previous.map((track) => {
          if (!lookup.has(track.filePath)) return track;
          const hash = lookup.get(track.filePath) ?? null;
          return {
            ...track,
            hasCoverArt: hash !== null,
            coverArtHash: hash,
          };
        }),
      );
    },
    [queryClient],
  );

  const performSearch = useCallback(async (_query: string) => {
    // Query-driven search runs automatically from searchQuery state.
  }, []);

  const isLyricsMatch = useCallback(
    (trackId: string) => lyricsMatchLineMap.has(trackId),
    [lyricsMatchLineMap],
  );

  const getLyricsMatchLine = useCallback(
    (trackId: string) => lyricsMatchLineMap.get(trackId) ?? null,
    [lyricsMatchLineMap],
  );

  const getFilteredTracks = useCallback(() => filteredTracks, [filteredTracks]);

  return {
    tracks,
    libraryStats,
    albumAggregates,
    artistAggregates,
    recentTracks,
    mostPlayedTracks,
    trackCount,
    searchQuery,
    searchScope,
    setSearchQuery,
    setSearchScope,
    sortBy,
    setSortBy,
    performSearch,
    isSearching: searchQueryResult.isFetching,
    setTracks,
    appendTracks,
    setTrackCount,
    applyCoverArtHashes,
    getFilteredTracks,
    isLyricsMatch,
    getLyricsMatchLine,
  };
}
