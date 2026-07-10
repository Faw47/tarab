import { QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmDialogProps } from '../../../components/ui/ConfirmDialog';
import { usePlaylistRepair } from '../usePlaylistRepair';

const eventListeners = vi.hoisted(() => new Map<string, (event: { payload: unknown }) => void>());
const listenMock = vi.hoisted(() => vi.fn());
const revealItemInDirMock = vi.hoisted(() => vi.fn(async () => undefined));
const getPlaylistsDataPathMock = vi.hoisted(() => vi.fn(async () => '/data/playlists.json'));
const resetPlaylistsDataMock = vi.hoisted(() => vi.fn(async () => undefined));
const reportErrorMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/event', () => ({
  listen: listenMock,
}));

vi.mock('@tauri-apps/plugin-opener', () => ({
  revealItemInDir: revealItemInDirMock,
}));

vi.mock('../../../lib/tauri-commands', () => ({
  getPlaylistsDataPath: getPlaylistsDataPathMock,
  resetPlaylistsData: resetPlaylistsDataMock,
}));

vi.mock('../../../lib/report-error', () => ({
  reportError: reportErrorMock,
}));

function renderPlaylistRepair() {
  const queryClient = new QueryClient();
  const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');
  const setConfirmDialog = vi.fn(
    (_dialog: Omit<ConfirmDialogProps, 'onCancel'> | null) => undefined,
  );

  const hook = renderHook(() => usePlaylistRepair({ queryClient, setConfirmDialog }));

  return { ...hook, queryClient, invalidateQueries, setConfirmDialog };
}

describe('usePlaylistRepair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventListeners.clear();
    listenMock.mockImplementation(
      async (eventName: string, handler: (event: { payload: unknown }) => void) => {
        eventListeners.set(eventName, handler);
        return vi.fn();
      },
    );
  });

  it('shows repair state from playlist corruption events', async () => {
    const { result } = renderPlaylistRepair();
    await act(async () => undefined);

    act(() => {
      eventListeners.get('playlists-corrupt')?.({
        payload: {
          reason: 'Failed to parse playlists file',
          attemptedRecovery: true,
          recoveredFrom: null,
        },
      });
    });

    expect(result.current.playlistRepair).toEqual({
      reason: 'Failed to parse playlists file',
      attemptedRecovery: true,
      recoveredFrom: null,
    });
  });

  it('shows recovered backup details from playlist recovery events', async () => {
    const { result } = renderPlaylistRepair();
    await act(async () => undefined);

    act(() => {
      eventListeners.get('playlists-recovered')?.({
        payload: {
          source: 'playlists.json.bak.1',
          message: 'Recovered playlists from backup after failure',
        },
      });
    });

    expect(result.current.playlistRepair).toEqual({
      reason: 'Recovered playlists from backup after failure',
      attemptedRecovery: true,
      recoveredFrom: 'playlists.json.bak.1',
    });
  });

  it('retries playlist queries and clears the repair state', async () => {
    const { result, invalidateQueries } = renderPlaylistRepair();
    await act(async () => undefined);

    act(() => {
      eventListeners.get('playlists-corrupt')?.({ payload: { reason: 'bad data' } });
    });

    await act(async () => {
      await result.current.handleRetryPlaylistLoad();
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['playlists'] });
    expect(result.current.playlistRepair).toBeNull();
  });

  it('confirms reset before clearing playlist data', async () => {
    const { result, invalidateQueries, setConfirmDialog } = renderPlaylistRepair();

    act(() => {
      result.current.handleResetPlaylistData();
    });

    const dialog = setConfirmDialog.mock.calls[0]?.[0];
    expect(dialog).toMatchObject({
      title: 'Reset playlists data',
      variant: 'danger',
      confirmLabel: 'Reset',
    });

    await act(async () => {
      await dialog?.onConfirm?.();
    });

    expect(resetPlaylistsDataMock).toHaveBeenCalled();
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['playlists'] });
  });

  it('opens the playlists data path in the file manager', async () => {
    const { result } = renderPlaylistRepair();

    await act(async () => {
      await result.current.handleOpenPlaylistsDataFolder();
    });

    expect(getPlaylistsDataPathMock).toHaveBeenCalled();
    expect(revealItemInDirMock).toHaveBeenCalledWith('/data/playlists.json');
  });
});
