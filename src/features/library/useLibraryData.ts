import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Perf, recordPerfBudget } from '../../lib/performance';
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
  fetchLibraryTracksCursorPage,
  fetchMostPlayedTracks,
  fetchRecentlyAddedTracks,
  type LibraryTrackCursorPage,
  mapSearchResultToTrack,
} from './api';
import { loadLibraryTrackContinuation } from './cursorPagination';
import { mergeTrackPages } from './mergeTrackPages';
import { libraryKeys } from './queryKeys';

const SEARCH_DEBOUNCE_MS = 160;
const MAX_TRAVERSAL_COMMIT_RESTARTS = 3;
type CachedAlbumGroup = {
  track: Track;
};

type CachedArtistGroup = {
  tracks: Track[];
};

const EMPTY_TRACKS: Track[] = [];

const measurePerfAsync = async <T>(label: string, operation: () => Promise<T>): Promise<T> => {
  Perf.startMeasure(label);
  try {
    return await operation();
  } finally {
    Perf.endMeasure(label);
  }
};

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
  const perfMeasureIdRef = useRef(0);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [searchQuery]);

  const tracksQuery = useQuery({
    queryKey: libraryKeys.tracks(),
    queryFn: async () => {
      const page = await fetchLibraryTracksCursorPage({
        limit: 400,
        sortBy: 'dateAdded',
        sortOrder: 'desc',
      });
      if (page.status !== 'ready') {
        throw new Error('The initial library cursor unexpectedly required a restart.');
      }
      queryClient.setQueryData(libraryKeys.traversal(), page);
      queryClient.setQueryData(libraryKeys.trackCount(), page.totalCount);
      return page.tracks;
    },
    staleTime: 60_000,
  });

  const trackCountQuery = useQuery({
    queryKey: libraryKeys.trackCount(),
    queryFn: fetchLibraryTrackCount,
    enabled: false,
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

  const secondaryQueryErrors = [
    statsQuery.error ? 'library statistics' : null,
    albumAggregatesQuery.error ? 'album groups' : null,
    artistAggregatesQuery.error ? 'artist groups' : null,
    options.includeLibraryShelves === true && recentTracksQuery.error ? 'recent tracks' : null,
    options.includeLibraryShelves === true && mostPlayedTracksQuery.error
      ? 'most-played tracks'
      : null,
  ].filter((value): value is string => value !== null);
  const librarySecondaryError =
    secondaryQueryErrors.length > 0
      ? 'Some library data is unavailable: ' + secondaryQueryErrors.join(', ') + '.'
      : null;
  const isLibrarySecondaryLoading =
    statsQuery.isFetching ||
    albumAggregatesQuery.isFetching ||
    artistAggregatesQuery.isFetching ||
    (options.includeLibraryShelves === true &&
      (recentTracksQuery.isFetching || mostPlayedTracksQuery.isFetching));
  const retryLibrarySecondaryData = useCallback(async () => {
    const results = await Promise.all([
      statsQuery.refetch(),
      albumAggregatesQuery.refetch(),
      artistAggregatesQuery.refetch(),
      ...(options.includeLibraryShelves === true
        ? [recentTracksQuery.refetch(), mostPlayedTracksQuery.refetch()]
        : []),
    ]);
    const failed = results.find((result) => result.isError);
    if (failed?.error) throw failed.error;
  }, [
    albumAggregatesQuery.refetch,
    artistAggregatesQuery.refetch,
    mostPlayedTracksQuery.refetch,
    options.includeLibraryShelves,
    recentTracksQuery.refetch,
    statsQuery.refetch,
  ]);

  const tracks = tracksQuery.data ?? EMPTY_TRACKS;
  const libraryStats = statsQuery.data ?? null;
  const albumAggregates = albumAggregatesQuery.data ?? [];
  const artistAggregates = artistAggregatesQuery.data ?? [];
  const recentTracks = recentTracksQuery.data ?? [];
  const mostPlayedTracks = mostPlayedTracksQuery.data ?? [];
  const trackCount = trackCountQuery.data ?? libraryStats?.trackCount ?? tracks.length;
  const initialLibraryLoading = tracksQuery.isPending;
  const initialLibraryError = tracksQuery.error;
  const libraryLoadError =
    initialLibraryError instanceof Error
      ? initialLibraryError.message
      : initialLibraryError
        ? String(initialLibraryError)
        : null;
  const loadInitialLibrary = useCallback(async () => {
    await tracksQuery.refetch();
  }, [tracksQuery.refetch]);

  const trimmedSearch = debouncedSearchQuery.trim();
  const shouldSearchMetadata = trimmedSearch.length > 0 && searchScope !== 'lyrics';
  const shouldSearchLyrics =
    trimmedSearch.length >= 3 && (searchScope === 'all' || searchScope === 'lyrics');

  const searchQueryResult = useQuery({
    queryKey: libraryKeys.search(trimmedSearch, searchScope),
    queryFn: async () => {
      const measureLabel = `library-search-ipc:${perfMeasureIdRef.current++}`;
      const startedAt = performance.now();
      Perf.startMeasure(measureLabel);
      try {
        return await fetchLibrarySearch(trimmedSearch, 120, {
          includeMetadata: shouldSearchMetadata,
          includeLyrics: shouldSearchLyrics,
        });
      } finally {
        Perf.endMeasure(measureLabel);
        recordPerfBudget(
          shouldSearchLyrics ? 'searchLyricsMs' : 'searchMetadataMs',
          performance.now() - startedAt,
        );
      }
    },
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
  const [fuseRankingKey, setFuseRankingKey] = useState<string | null>(null);
  const searchRankingKey = trimmedSearch
    ? `${searchScope}\u0000${trimmedSearch}\u0001${mergedSearchTracks.map((track) => track.id).join('\u0002')}`
    : null;

  useEffect(() => {
    let cancelled = false;
    if (!searchRankingKey) {
      setFuseRankedTracks([]);
      setFuseRankingKey(null);
      return;
    }

    const requestKey = searchRankingKey;
    setFuseRankingKey(null);
    const serialized = mergedSearchTracks.map(toSerializedTrack);
    const measureLabel = `library-search-ranking:${perfMeasureIdRef.current++}`;
    Perf.startMeasure(measureLabel);
    void rankTracksWithFuseWorker(serialized, trimmedSearch, searchScope as SearchScope)
      .then((out) => {
        if (cancelled) return;
        const byId = new Map(mergedSearchTracks.map((track) => [track.id, track]));
        setFuseRankedTracks(
          out.map((row) => byId.get(row.id)).filter((track): track is Track => Boolean(track)),
        );
        setFuseRankingKey(requestKey);
      })
      .catch(() => {
        if (cancelled) return;
        setFuseRankedTracks(mergedSearchTracks);
        setFuseRankingKey(requestKey);
      })
      .finally(() => Perf.endMeasure(measureLabel));

    return () => {
      cancelled = true;
    };
  }, [mergedSearchTracks, searchRankingKey, searchScope, trimmedSearch]);

  const searchResultTracks = useMemo(() => {
    if (!trimmedSearch || mergedSearchTracks.length === 0) return [];
    if (fuseRankingKey !== searchRankingKey || fuseRankedTracks.length === 0) {
      return mergedSearchTracks;
    }

    const currentTracksById = new Map(mergedSearchTracks.map((track) => [track.id, track]));
    return fuseRankedTracks
      .map((track) => currentTracksById.get(track.id))
      .filter((track): track is Track => Boolean(track));
  }, [fuseRankedTracks, fuseRankingKey, mergedSearchTracks, searchRankingKey, trimmedSearch]);

  const filteredTracks = useMemo(() => {
    if (trimmedSearch) {
      if (searchResultTracks.length > 0 || searchQueryResult.data) {
        return searchResultTracks;
      }
      return sortTracks(localFilterTracks(tracks, trimmedSearch, searchScope), sortBy);
    }

    return sortTracks(tracks, sortBy);
  }, [searchQueryResult.data, searchResultTracks, searchScope, sortBy, tracks, trimmedSearch]);

  const searchError =
    searchQueryResult.error instanceof Error
      ? searchQueryResult.error.message
      : searchQueryResult.error
        ? String(searchQueryResult.error)
        : null;
  const searchPartialError = useMemo(() => {
    const unavailableBranches = searchQueryResult.data?.unavailableBranches ?? [];
    if (unavailableBranches.length === 0) return null;
    const labels = unavailableBranches.map((branch) =>
      branch === 'metadata' ? 'track metadata' : 'lyrics index',
    );
    return (
      'Some search sources are unavailable (' + labels.join(', ') + '). Results may be incomplete.'
    );
  }, [searchQueryResult.data]);

  const retrySearch = useCallback(async () => {
    await searchQueryResult.refetch();
  }, [searchQueryResult.refetch]);

  const setTracks = useCallback(
    (nextTracks: Track[], traversal?: LibraryTrackCursorPage) => {
      queryClient.setQueryData(libraryKeys.tracks(), nextTracks);
      if (traversal?.status === 'ready') {
        queryClient.setQueryData(libraryKeys.traversal(), traversal);
      } else {
        queryClient.removeQueries({ queryKey: libraryKeys.traversal(), exact: true });
      }
    },
    [queryClient],
  );

  const loadMoreTracks = useCallback(
    (limit: number) =>
      measurePerfAsync(`library-load-more:${perfMeasureIdRef.current++}`, async () => {
        for (let attempt = 0; attempt <= MAX_TRAVERSAL_COMMIT_RESTARTS; attempt += 1) {
          const traversal = queryClient.getQueryData<LibraryTrackCursorPage>(
            libraryKeys.traversal(),
          );
          const traversalRevision = traversal?.revision;
          const tracksSnapshot = queryClient.getQueryData<Track[]>(libraryKeys.tracks());
          const trackCountSnapshot = queryClient.getQueryData<number>(libraryKeys.trackCount());
          const cachedTracks = tracksSnapshot ?? [];
          const cachedTrackCount = trackCountSnapshot ?? trackCount;
          if (traversal?.status === 'ready' && !traversal.nextCursor) {
            if (cachedTracks.length >= cachedTrackCount) {
              return { tracks: [] as Track[], restarted: false, hasMore: false };
            }
          }

          let page: LibraryTrackCursorPage;
          let restarted = false;
          if (traversal?.status === 'ready' && traversal.nextCursor) {
            const continuation = await loadLibraryTrackContinuation(traversal.nextCursor, {
              limit,
              sortBy: 'dateAdded',
              sortOrder: 'desc',
            });
            page = continuation.page;
            restarted = continuation.restarted;
          } else {
            page = await fetchLibraryTracksCursorPage({
              cursor: null,
              limit,
              sortBy: 'dateAdded',
              sortOrder: 'desc',
            });
            if (page.status !== 'ready') {
              throw new Error('The restarted library cursor was rejected.');
            }
            restarted = true;
          }

          const currentTraversal = queryClient.getQueryData<LibraryTrackCursorPage>(
            libraryKeys.traversal(),
          );
          const currentTracks = queryClient.getQueryData<Track[]>(libraryKeys.tracks());
          const currentTrackCount = queryClient.getQueryData<number>(libraryKeys.trackCount());
          if (
            currentTraversal !== traversal ||
            currentTraversal?.revision !== traversalRevision ||
            currentTracks !== tracksSnapshot ||
            currentTrackCount !== trackCountSnapshot
          ) {
            continue;
          }

          queryClient.setQueryData<Track[]>(libraryKeys.tracks(), (previous = []) =>
            restarted ? page.tracks : mergeTrackPages(previous, page.tracks),
          );
          queryClient.setQueryData(libraryKeys.traversal(), page);
          queryClient.setQueryData(libraryKeys.trackCount(), page.totalCount);
          return { tracks: page.tracks, restarted, hasMore: page.nextCursor !== null };
        }

        throw new Error('Library traversal kept changing while more tracks were being loaded.');
      }),
    [queryClient, trackCount],
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

      const updateTrack = (track: Track): Track => {
        if (!lookup.has(track.filePath)) return track;
        const hash = lookup.get(track.filePath) ?? null;
        return {
          ...track,
          hasCoverArt: hash !== null,
          coverArtHash: hash,
        };
      };

      const updateTrackCollection = (previous: Track[] | undefined) => previous?.map(updateTrack);

      queryClient.setQueryData(libraryKeys.tracks(), updateTrackCollection);
      queryClient.setQueryData(libraryKeys.recent(30, 50), updateTrackCollection);
      queryClient.setQueryData(libraryKeys.mostPlayed(100), updateTrackCollection);
      queryClient.setQueryData<CachedAlbumGroup[]>(libraryKeys.albums(), (previous) =>
        previous?.map((album) => ({
          ...album,
          track: updateTrack(album.track),
        })),
      );
      queryClient.setQueryData<CachedArtistGroup[]>(libraryKeys.artists(), (previous) =>
        previous?.map((artist) => ({
          ...artist,
          tracks: artist.tracks.map(updateTrack),
        })),
      );
    },
    [queryClient],
  );
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
    initialLibraryLoading,
    libraryLoadError,
    librarySecondaryError,
    isLibrarySecondaryLoading,
    retryLibrarySecondaryData,
    loadInitialLibrary,
    searchQuery,
    searchScope,
    setSearchQuery,
    setSearchScope,
    sortBy,
    setSortBy,
    isSearching: searchQueryResult.isFetching,
    searchError,
    searchPartialError,
    retrySearch,
    setTracks,
    loadMoreTracks,
    setTrackCount,
    applyCoverArtHashes,
    getFilteredTracks,
    isLyricsMatch,
    getLyricsMatchLine,
  };
}
