import type { QueryClient } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { playlistKeys } from '../../playlists/queryKeys';
import { useInitialLibraryBootstrap } from '../useInitialLibraryBootstrap';

const recordPerfBudgetMock = vi.hoisted(() => vi.fn());
const reportErrorMock = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/performance', () => ({
  recordPerfBudget: recordPerfBudgetMock,
}));

vi.mock('../../../lib/report-error', () => ({
  reportError: reportErrorMock,
}));

describe('useInitialLibraryBootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates playlist data and reports each library load error once', async () => {
    const invalidateQueries = vi.fn(async () => undefined);
    const queryClient = { invalidateQueries } as unknown as QueryClient;
    const { rerender } = renderHook(
      ({ error }: { error: string | null }) =>
        useInitialLibraryBootstrap({
          queryClient,
          initialLibraryLoading: false,
          libraryLoadError: error,
        }),
      { initialProps: { error: 'database unavailable' } },
    );

    await waitFor(() => expect(invalidateQueries).toHaveBeenCalledTimes(1));
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: playlistKeys.all });
    expect(reportErrorMock).toHaveBeenCalledWith('Failed to load library from database', {
      source: 'app',
      error: 'database unavailable',
    });

    rerender({ error: 'database unavailable' });
    expect(reportErrorMock).toHaveBeenCalledTimes(1);

    rerender({ error: 'database recovered then failed' });
    await waitFor(() => expect(reportErrorMock).toHaveBeenCalledTimes(2));
  });

  it('records startup interactivity once after the initial query settles', async () => {
    const queryClient = {
      invalidateQueries: vi.fn(async () => undefined),
    } as unknown as QueryClient;
    const { rerender } = renderHook(
      ({ loading }: { loading: boolean }) =>
        useInitialLibraryBootstrap({
          queryClient,
          initialLibraryLoading: loading,
          libraryLoadError: null,
        }),
      { initialProps: { loading: true } },
    );

    expect(recordPerfBudgetMock).not.toHaveBeenCalled();
    rerender({ loading: false });
    await waitFor(() => expect(recordPerfBudgetMock).toHaveBeenCalledTimes(1));
    expect(recordPerfBudgetMock).toHaveBeenCalledWith('startupInteractiveMs', expect.any(Number));

    rerender({ loading: true });
    rerender({ loading: false });
    expect(recordPerfBudgetMock).toHaveBeenCalledTimes(1);
  });
});
