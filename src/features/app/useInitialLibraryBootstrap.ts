import type { QueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { recordPerfBudget } from '../../lib/performance';
import { reportError } from '../../lib/report-error';
import { playlistKeys } from '../playlists/queryKeys';

interface UseInitialLibraryBootstrapOptions {
  queryClient: QueryClient;
  initialLibraryLoading: boolean;
  libraryLoadError: string | null;
}

export function useInitialLibraryBootstrap({
  queryClient,
  initialLibraryLoading,
  libraryLoadError,
}: UseInitialLibraryBootstrapOptions) {
  const startupBudgetStartRef = useRef(
    typeof performance !== 'undefined' ? performance.now() : Date.now(),
  );
  const startupBudgetRecordedRef = useRef(false);
  const reportedErrorRef = useRef<string | null>(null);

  useEffect(() => {
    void queryClient.invalidateQueries({ queryKey: playlistKeys.all });
  }, [queryClient]);

  useEffect(() => {
    if (!libraryLoadError) {
      reportedErrorRef.current = null;
      return;
    }
    if (reportedErrorRef.current === libraryLoadError) return;
    reportedErrorRef.current = libraryLoadError;
    reportError('Failed to load library from database', {
      source: 'app',
      error: libraryLoadError,
    });
  }, [libraryLoadError]);

  useEffect(() => {
    if (initialLibraryLoading || startupBudgetRecordedRef.current) return;
    startupBudgetRecordedRef.current = true;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    recordPerfBudget('startupInteractiveMs', now - startupBudgetStartRef.current);
  }, [initialLibraryLoading]);
}
