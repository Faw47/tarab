import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadLibraryTrackSnapshot } from '../../features/library/cursorPagination';
import { libraryKeys } from '../../features/library/queryKeys';
import { useLibraryData } from '../../features/library/useLibraryData';
import { Perf } from '../../lib/performance';
import { reportError } from '../../lib/report-error';
import type { Track } from '../../types';

const PAGE_SIZE = 500;

export interface TagManagerLibraryTracksState {
  tracks: Track[];
  loadedCount: number;
  totalCount: number;
  isHydrating: boolean;
  hydrationError: string | null;
  retryHydration: () => void;
}

export function useTagManagerLibraryTracks(): TagManagerLibraryTracksState {
  const { trackCount, tracks: loadedTracks } = useLibraryData();
  const [progressTracks, setProgressTracks] = useState<Track[]>(loadedTracks);
  const [sourceVersion, setSourceVersion] = useState(0);
  const loadedTrackIdentity = useMemo(
    () => loadedTracks.map((track) => `${track.id}\u0000${track.filePath}`).join('\u0001'),
    [loadedTracks],
  );
  const previousLoadedTrackIdentityRef = useRef<string | null>(null);
  const previousTrackCountRef = useRef<number | null>(null);
  const previousLoadedTracksRef = useRef<Track[] | null>(null);
  const loadedTracksRef = useRef(loadedTracks);
  loadedTracksRef.current = loadedTracks;
  const sourceVersionRef = useRef(sourceVersion);
  sourceVersionRef.current = sourceVersion;
  const hydrationMeasureIdRef = useRef(0);

  const snapshotQuery = useQuery({
    queryKey: [...libraryKeys.tagManagerTracks(), sourceVersion],
    queryFn: ({ signal }) => {
      const requestVersion = sourceVersion;
      const measureLabel = `tag-manager-hydration:${hydrationMeasureIdRef.current++}`;
      Perf.startMeasure(measureLabel);
      return loadLibraryTrackSnapshot({
        limit: PAGE_SIZE,
        sortBy: 'dateAdded',
        sortOrder: 'desc',
        signal,
        onProgress: (tracks) => {
          if (sourceVersionRef.current === requestVersion) setProgressTracks(tracks);
        },
      }).finally(() => Perf.endMeasure(measureLabel));
    },
    enabled: loadedTracks.length < trackCount,
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    const identityChanged =
      previousLoadedTrackIdentityRef.current !== null &&
      previousLoadedTrackIdentityRef.current !== loadedTrackIdentity;
    const countChanged =
      previousTrackCountRef.current !== null && previousTrackCountRef.current !== trackCount;
    previousLoadedTrackIdentityRef.current = loadedTrackIdentity;
    previousTrackCountRef.current = trackCount;

    if (identityChanged || countChanged) {
      const previousLoadedTracks = previousLoadedTracksRef.current;
      const isPrefixExtension = Boolean(
        previousLoadedTracks &&
          loadedTracks.length > previousLoadedTracks.length &&
          previousLoadedTracks.every(
            (track, index) =>
              loadedTracks[index]?.id === track.id &&
              loadedTracks[index]?.filePath === track.filePath,
          ),
      );
      if (!isPrefixExtension) {
        setProgressTracks(loadedTracks);
        setSourceVersion((version) => version + 1);
        previousLoadedTracksRef.current = loadedTracks;
        return;
      }
    }

    previousLoadedTracksRef.current = loadedTracks;
    setProgressTracks((current) => {
      if (current.length <= loadedTracks.length) return loadedTracks;

      const loadedById = new Map(loadedTracks.map((track) => [track.id, track]));
      return current.map((track) => loadedById.get(track.id) ?? track);
    });
  }, [loadedTrackIdentity, loadedTracks, trackCount]);

  useEffect(() => {
    const error = snapshotQuery.error;
    if (!error || (error as { name?: string }).name === 'AbortError') return;
    setProgressTracks(loadedTracksRef.current);
    reportError('Failed to load full library for tag manager', {
      source: 'tag-manager',
      error,
    });
  }, [snapshotQuery.error]);

  const snapshotTracks = snapshotQuery.data?.tracks;
  const hasCurrentSnapshot = Boolean(
    snapshotQuery.isSuccess &&
      snapshotQuery.data?.totalCount === trackCount &&
      snapshotTracks &&
      snapshotTracks.length >= trackCount,
  );
  const hydratedTracks = hasCurrentSnapshot && snapshotTracks ? snapshotTracks : progressTracks;
  const allTracks = useMemo(() => {
    if (loadedTracks.length >= trackCount) return loadedTracks;
    const loadedById = new Map(loadedTracks.map((track) => [track.id, track]));
    return hydratedTracks.map((track) => loadedById.get(track.id) ?? track);
  }, [hydratedTracks, loadedTracks, trackCount]);
  const isHydrating = loadedTracks.length < trackCount && snapshotQuery.isFetching;
  const hydrationError =
    !isHydrating &&
    loadedTracks.length < trackCount &&
    snapshotQuery.error &&
    (snapshotQuery.error as { name?: string }).name !== 'AbortError'
      ? snapshotQuery.error instanceof Error
        ? snapshotQuery.error.message
        : 'Tarab could not load the full library for bulk editing.'
      : null;
  const retryHydration = useCallback(() => {
    void snapshotQuery.refetch();
  }, [snapshotQuery.refetch]);

  return {
    tracks: allTracks,
    loadedCount: Math.min(allTracks.length, trackCount),
    totalCount: trackCount,
    isHydrating,
    hydrationError,
    retryHydration,
  };
}
