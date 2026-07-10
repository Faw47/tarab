import type { QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { recordPerfBudget } from '../../lib/performance';
import { reportError } from '../../lib/report-error';
import type { Track } from '../../types';
import { fetchLibraryTrackCount, fetchLibraryTracksPage } from '../library/api';
import { playlistKeys } from '../playlists/queryKeys';

interface UseInitialLibraryBootstrapOptions {
  queryClient: QueryClient;
  setTrackCount: (count: number) => void;
  setTracks: (tracks: Track[]) => void;
}

export function useInitialLibraryBootstrap({
  queryClient,
  setTrackCount,
  setTracks,
}: UseInitialLibraryBootstrapOptions) {
  const [initialLibraryLoading, setInitialLibraryLoading] = useState(true);
  const [libraryLoadError, setLibraryLoadError] = useState<string | null>(null);
  const startupBudgetStartRef = useRef(
    typeof performance !== 'undefined' ? performance.now() : Date.now(),
  );
  const startupBudgetRecordedRef = useRef(false);

  const loadInitialLibrary = useCallback(async () => {
    setInitialLibraryLoading(true);
    setLibraryLoadError(null);
    try {
      const [total, tracks] = await Promise.all([
        fetchLibraryTrackCount(),
        fetchLibraryTracksPage({ offset: 0, limit: 400, sortBy: 'dateAdded', sortOrder: 'desc' }),
      ]);
      setTracks(tracks);
      setTrackCount(total);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load library tracks';
      setLibraryLoadError(message);
      reportError('Failed to load library from database', { source: 'app', error });
    } finally {
      if (!startupBudgetRecordedRef.current) {
        startupBudgetRecordedRef.current = true;
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        recordPerfBudget('startupInteractiveMs', now - startupBudgetStartRef.current);
      }
      setInitialLibraryLoading(false);
    }
  }, [setTrackCount, setTracks]);

  useEffect(() => {
    void loadInitialLibrary();
    void queryClient.invalidateQueries({ queryKey: playlistKeys.all });
  }, [loadInitialLibrary, queryClient]);

  return { initialLibraryLoading, libraryLoadError, loadInitialLibrary };
}
