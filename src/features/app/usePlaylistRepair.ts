import type { QueryClient } from '@tanstack/react-query';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { useCallback, useState } from 'react';
import type { ConfirmDialogProps } from '../../components/ui/ConfirmDialog';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { reportError } from '../../lib/report-error';
import { getPlaylistsDataPath, resetPlaylistsData } from '../../lib/tauri-commands';
import { playlistKeys } from '../playlists/queryKeys';
import type { PlaylistRepairState } from './app-state-types';

interface PlaylistCorruptPayload {
  reason?: string;
  attemptedRecovery?: boolean;
  recoveredFrom?: string | null;
}

interface PlaylistRecoveredPayload {
  source?: string;
  message?: string;
}

interface UsePlaylistRepairOptions {
  queryClient: QueryClient;
  setConfirmDialog: (dialog: Omit<ConfirmDialogProps, 'onCancel'> | null) => void;
}

export function usePlaylistRepair({ queryClient, setConfirmDialog }: UsePlaylistRepairOptions) {
  const [playlistRepair, setPlaylistRepair] = useState<PlaylistRepairState | null>(null);

  useTauriEvent<PlaylistCorruptPayload>(
    'playlists-corrupt',
    (event) => {
      setPlaylistRepair({
        reason: event.payload.reason ?? 'Playlist data could not be loaded.',
        attemptedRecovery: event.payload.attemptedRecovery ?? false,
        recoveredFrom: event.payload.recoveredFrom ?? null,
      });
    },
    [],
    (error) => reportError('Failed to listen for playlist repair events', { source: 'app', error }),
  );

  useTauriEvent<PlaylistRecoveredPayload>(
    'playlists-recovered',
    (event) => {
      setPlaylistRepair({
        reason: event.payload.message ?? 'Playlist data was recovered from a backup.',
        attemptedRecovery: true,
        recoveredFrom: event.payload.source ?? null,
      });
    },
    [],
    (error) =>
      reportError('Failed to listen for playlist recovery events', { source: 'app', error }),
  );

  const handleRetryPlaylistLoad = useCallback(async () => {
    try {
      await queryClient.invalidateQueries({ queryKey: playlistKeys.all });
      setPlaylistRepair(null);
    } catch (error) {
      reportError('Failed to reload playlists', { source: 'app', error });
    }
  }, [queryClient]);

  const handleResetPlaylistData = useCallback(() => {
    setConfirmDialog({
      title: 'Reset playlists data',
      message: 'This will remove all playlists and playlist stats. A backup will be kept on disk.',
      variant: 'danger',
      confirmLabel: 'Reset',
      onConfirm: async () => {
        try {
          await resetPlaylistsData();
          await queryClient.invalidateQueries({ queryKey: playlistKeys.all });
          setPlaylistRepair(null);
        } catch (error) {
          reportError('Failed to reset playlists data', { source: 'app', error });
        }
      },
    });
  }, [queryClient, setConfirmDialog]);

  const handleOpenPlaylistsDataFolder = useCallback(async () => {
    try {
      const dataPath = await getPlaylistsDataPath();
      await revealItemInDir(dataPath);
    } catch (error) {
      reportError('Failed to open playlists data folder', { source: 'app', error });
    }
  }, []);

  return {
    playlistRepair,
    handleRetryPlaylistLoad,
    handleResetPlaylistData,
    handleOpenPlaylistsDataFolder,
  };
}
