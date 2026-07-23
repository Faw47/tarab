import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConfirmDialogProps } from '../../components/ui/ConfirmDialog';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { startPlayback } from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import {
  getTrackMetadata,
  type LaunchFileIntent,
  type LaunchFileIntentAction,
  listLaunchFileIntents,
  listLibraryGrants,
  resolveLaunchFileIntent,
} from '../../lib/tauri-commands';
import type { Track } from '../../types';

interface UseLaunchFileIntentsOptions {
  scanFolder: (folderPath: string) => Promise<void>;
  setLibraryFolders: (folders: string[]) => void;
}

const toTrack = (metadata: Awaited<ReturnType<typeof getTrackMetadata>>): Track => ({
  id: metadata.file_path,
  title: metadata.title,
  artist: metadata.artist,
  albumArtist: metadata.album_artist,
  album: metadata.album,
  year: metadata.year,
  duration: metadata.duration_secs,
  filePath: metadata.file_path,
  hasCoverArt: metadata.has_cover_art,
  fileFormat: metadata.file_format,
  bitrate: metadata.bitrate ?? undefined,
  sampleRate: metadata.sample_rate ?? undefined,
  fileSize: metadata.file_size ?? undefined,
  dateAdded: Date.now(),
  playCount: 0,
  lastPlayed: null,
  rating: null,
});

export function useLaunchFileIntents({
  scanFolder,
  setLibraryFolders,
}: UseLaunchFileIntentsOptions): ConfirmDialogProps | null {
  const [pending, setPending] = useState<LaunchFileIntent[]>([]);
  const [resolving, setResolving] = useState(false);
  const resolvingRef = useRef(false);
  const current = pending[0] ?? null;

  const addIntent = useCallback((intent: LaunchFileIntent) => {
    setPending((items) =>
      items.some((item) => item.id === intent.id) ? items : [...items, intent],
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listLaunchFileIntents()
      .then((items) => {
        if (!cancelled) setPending(items);
      })
      .catch((error) => {
        reportError('Failed to load file-open requests', { source: 'file-open', error });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useTauriEvent<LaunchFileIntent>(
    'launch-file-intent',
    (event) => addIntent(event.payload),
    [addIntent],
    (error) => {
      reportError('Failed to listen for file-open requests', { source: 'file-open', error });
    },
  );

  const finishCurrent = useCallback(() => {
    setPending((items) => items.slice(1));
  }, []);

  const resolve = useCallback(
    async (action: LaunchFileIntentAction) => {
      if (!current || resolvingRef.current) return;
      resolvingRef.current = true;
      setResolving(true);
      try {
        const resolved = await resolveLaunchFileIntent(current.id, action);
        if (!resolved) return;
        if (resolved.libraryGrant) {
          const grants = await listLibraryGrants();
          setLibraryFolders(grants.map((grant) => grant.path));
          await scanFolder(resolved.libraryGrant.path);
        }
        const metadata = await getTrackMetadata(resolved.filePath);
        await startPlayback(toTrack(metadata));
      } catch (error) {
        reportError('Failed to open the selected audio file', { source: 'file-open', error });
      } finally {
        resolvingRef.current = false;
        setResolving(false);
        finishCurrent();
      }
    },
    [current, finishCurrent, scanFolder, setLibraryFolders],
  );

  return useMemo(() => {
    if (!current) return null;
    return {
      title: 'Open audio file',
      message: `How should Tarab open “${current.displayName}”?`,
      detail: `Folder: ${current.folderName}`,
      confirmLabel: 'Play once',
      secondaryLabel: 'Import folder',
      cancelLabel: 'Cancel',
      busy: resolving,
      onConfirm: () => void resolve('playOnce'),
      onSecondary: () => void resolve('importFolder'),
      onCancel: () => void resolve('cancel'),
      onDismiss: () => undefined,
    };
  }, [current, resolve, resolving]);
}
