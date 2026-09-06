import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConfirmDialogProps } from '../../components/ui/ConfirmDialog';
import { startPlayback } from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import {
  getTrackMetadata,
  type LaunchFileIntent,
  type LaunchFileIntentAction,
  listLaunchFileIntents,
  listLibraryGrants,
  resolveLaunchFileIntent,
  revokeLaunchFileAuthority,
} from '../../lib/tauri-commands';
import type { Track } from '../../types';

interface UseLaunchFileIntentsOptions {
  scanFolder: (folderPath: string) => Promise<void>;
  setLibraryFolders: (folders: string[]) => void;
}

const RESOLVED_INTENT_TOMBSTONE_LIMIT = 100;

const mergeIntents = (...groups: LaunchFileIntent[][]): LaunchFileIntent[] => {
  const merged = new Map<string, LaunchFileIntent>();
  for (const group of groups) {
    for (const intent of group) {
      if (!merged.has(intent.id)) merged.set(intent.id, intent);
    }
  }
  return [...merged.values()];
};

const toTrack = (metadata: Awaited<ReturnType<typeof getTrackMetadata>>): Track => ({
  id: metadata.file_path,
  title: metadata.title,
  artist: metadata.artist,
  albumArtist: metadata.album_artist,
  album: metadata.album,
  genre: metadata.genre ?? null,
  year: metadata.year,
  trackNumber: metadata.track_number,
  discNumber: metadata.disc_number,
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
  const mountedRef = useRef(false);
  const eventRevisionRef = useRef(0);
  const resolvedIntentIdsRef = useRef(new Set<string>());
  const current = pending[0] ?? null;

  const addIntent = useCallback((intent: LaunchFileIntent) => {
    if (resolvedIntentIdsRef.current.has(intent.id)) return;
    setPending((items) =>
      items.some((item) => item.id === intent.id) ? items : [...items, intent],
    );
  }, []);

  const refreshPending = useCallback(async () => {
    const revisionBeforeList = eventRevisionRef.current;
    const listed = await listLaunchFileIntents();
    if (!mountedRef.current) return;

    const listedIds = new Set(listed.map((intent) => intent.id));
    for (const id of resolvedIntentIdsRef.current) {
      if (!listedIds.has(id)) resolvedIntentIdsRef.current.delete(id);
    }
    const unresolved = listed.filter((intent) => !resolvedIntentIdsRef.current.has(intent.id));
    setPending((existing) => {
      const currentUnresolved = existing.filter(
        (intent) => !resolvedIntentIdsRef.current.has(intent.id),
      );
      return eventRevisionRef.current === revisionBeforeList
        ? unresolved
        : mergeIntents(unresolved, currentUnresolved);
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    mountedRef.current = true;

    const setup = async () => {
      try {
        unlisten = await listen<LaunchFileIntent>('launch-file-intent', (event) => {
          if (disposed) return;
          eventRevisionRef.current += 1;
          addIntent(event.payload);
        });
      } catch (error) {
        reportError('Failed to listen for file-open requests', { source: 'file-open', error });
      }

      if (disposed) {
        unlisten?.();
        return;
      }
      try {
        await refreshPending();
      } catch (error) {
        reportError('Failed to load file-open requests', { source: 'file-open', error });
      }
    };
    void setup();

    return () => {
      disposed = true;
      mountedRef.current = false;
      unlisten?.();
    };
  }, [addIntent, refreshPending]);

  const finishIntent = useCallback((intentId: string) => {
    const tombstones = resolvedIntentIdsRef.current;
    tombstones.add(intentId);
    while (tombstones.size > RESOLVED_INTENT_TOMBSTONE_LIMIT) {
      const oldest = tombstones.values().next().value;
      if (!oldest) break;
      tombstones.delete(oldest);
    }
    setPending((items) => items.filter((item) => item.id !== intentId));
  }, []);

  const resolve = useCallback(
    async (action: LaunchFileIntentAction) => {
      if (!current || resolvingRef.current) return;
      const intentId = current.id;
      resolvingRef.current = true;
      setResolving(true);
      try {
        let resolved;
        try {
          resolved = await resolveLaunchFileIntent(intentId, action);
        } catch (error) {
          reportError('Failed to resolve the file-open request', { source: 'file-open', error });
          try {
            await refreshPending();
          } catch (refreshError) {
            reportError('Failed to reload file-open requests', {
              source: 'file-open',
              error: refreshError,
            });
          }
          return;
        }

        finishIntent(intentId);
        if (!resolved) return;
        try {
          if (resolved.libraryGrant) {
            const grants = await listLibraryGrants();
            setLibraryFolders(grants.map((grant) => grant.path));
            await scanFolder(resolved.libraryGrant.path);
          }
          const metadata = await getTrackMetadata(
            resolved.filePath,
            resolved.authorityId ?? undefined,
          );
          await startPlayback(toTrack(metadata), {
            authorityId: resolved.authorityId ?? undefined,
          });
        } catch (error) {
          if (resolved.authorityId) {
            try {
              await revokeLaunchFileAuthority(resolved.authorityId);
            } catch (revokeError) {
              reportError('Failed to revoke the Play Once file authority', {
                source: 'file-open',
                error: revokeError,
              });
            }
          }
          reportError('Failed to open the selected audio file', { source: 'file-open', error });
        }
      } finally {
        resolvingRef.current = false;
        if (mountedRef.current) setResolving(false);
      }
    },
    [current, finishIntent, refreshPending, scanFolder, setLibraryFolders],
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
      onConfirm: () => resolve('playOnce'),
      onSecondary: () => resolve('importFolder'),
      onCancel: () => void resolve('cancel'),
      onDismiss: () => undefined,
    };
  }, [current, resolve, resolving]);
}
