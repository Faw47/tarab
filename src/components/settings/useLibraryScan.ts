import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invalidateLibraryForMutation } from '../../features/library/mutations';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { getPathBaseName, isSameOrSubPath } from '../../lib/path-utils';
import { logError, reportError } from '../../lib/report-error';
import {
  cancelLibraryScan,
  dbReconcileFolderScan,
  generateCoverArtHashes,
  getBatchMetadata,
  type ScanReconcileResult,
  scanLibrary,
  syncLyricsIndex,
  watchLibraryPaths,
} from '../../lib/tauri-commands';
import { notifications } from '../../platform/notifications';
import { useLibraryStore } from '../../store/library-store';
import { useSettingsStore } from '../../store/settings-store';
import type { Track } from '../../types';
import {
  collapseWatchScanTargets,
  resolveWatchEventScanTarget,
  type LibraryWatchEventPayload,
} from './library-watch-targets';

/* ─── CONSTANTS ─────────────────────────────────────────────────────────── */

const LAST_SCAN_KEY = 'tarab-last-scan-v1';
const METADATA_BATCH_SIZE = 200;
const ART_BATCH_SIZE = 120;
const WATCH_RETRY_MS = 300;

/* ─── MODULE-LEVEL HELPERS ───────────────────────────────────────────────── */

function recordLibraryScan(): void {
  try {
    localStorage.setItem(LAST_SCAN_KEY, Date.now().toString());
  } catch {
    /* storage unavailable, non-fatal */
  }
}

export { isSameOrSubPath };

const clampProgress = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const chunkArray = <T>(items: T[], size: number): T[][] => {
  if (items.length <= size) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const runBatches = async <T, R>(
  items: T[],
  batchSize: number,
  worker: (batch: T[]) => Promise<R[]>,
  onProgress?: (done: number, total: number) => void,
  isCancelled?: () => boolean,
): Promise<R[]> => {
  if (items.length === 0) return [];
  const results: R[] = [];
  let done = 0;
  for (const batch of chunkArray(items, batchSize)) {
    if (isCancelled?.()) throw new Error('Library scan cancelled');
    const batchResult = await worker(batch);
    results.push(...batchResult);
    done += batch.length;
    onProgress?.(done, items.length);
  }
  return results;
};

/* ─── TYPES ──────────────────────────────────────────────────────────────── */

/*
 * FIX [IDLE_STATUS]: Removed 'idle' from the union. folderStatuses initializes
 * as {} and only ever transitioned to 'scanning', 'success', or 'error' in the
 * original code. 'idle' was declared but never assigned anywhere.
 */
export type FolderScanStatus = 'scanning' | 'success' | 'partial' | 'error';

export interface FolderStatus {
  status: FolderScanStatus;
  lastScanned?: Date;
}

interface ScanFolderOptions {
  silent?: boolean;
  /** Folder whose status row reflects this scan; defaults to the scanned folder. */
  statusKey?: string;
  /** Report failures to the user; watcher subfolder scans fall back to the root instead. */
  reportErrors?: boolean;
}

/* ─── INTERNAL PURE FUNCTIONS ────────────────────────────────────────────── */

interface ScanSingleFolderOptions {
  folderPath: string;
  followSymlinks: boolean;
  downloadArtwork: boolean;
  /*
   * FIX [PROGRESS_MATH]: Both handlers now operate on a unified 0-1 ratio.
   * The original had absolute percentages (10, 50, 70) in handleScanFolder
   * and 0-1 ratios (0.1, 0.5, 0.7) in handleRescanAll for the same
   * operations. Callers map this ratio to their own display scale.
   */
  onProgress: (ratio: number) => void;
  isCancelled: () => boolean;
}

interface ScanSingleFolderResult {
  folderPath: string;
  discoveredPaths: string[];
  /** False when the walk skipped unreadable entries; reconcile then keeps rows it did not see. */
  traversalComplete: boolean;
  tracks: Track[];
  metadataErrors: {
    path: string | null;
    code: string;
    message: string;
    recoverable: boolean;
  }[];
}

/**
 * FIX [DUPLICATE_LOGIC]: The ~80-line scan core that was copy-pasted between
 * handleScanFolder and handleRescanAll is now a single pure async function.
 * Returns the Track[] for the scanned folder only. Merging into the full
 * library and DB persistence are separate concerns handled by the hook.
 */
async function scanSingleFolder({
  folderPath,
  followSymlinks,
  downloadArtwork,
  onProgress,
  isCancelled,
}: ScanSingleFolderOptions): Promise<ScanSingleFolderResult> {
  const scan = await scanLibrary(folderPath, followSymlinks);
  const filePaths = scan.paths;
  if (isCancelled()) throw new Error('Library scan cancelled');
  onProgress(0.1);

  const traversalComplete = scan.traversalErrors.length === 0 && scan.skippedErrorCount === 0;
  const traversalErrors = scan.traversalErrors.map((error) => ({
    path: error.path,
    code: 'traversalIncomplete',
    message: error.message,
    recoverable: true,
  }));

  if (filePaths.length === 0) {
    onProgress(1);
    return {
      folderPath,
      discoveredPaths: [],
      traversalComplete,
      tracks: [],
      metadataErrors: traversalErrors,
    };
  }

  // Metadata phase: 10-60% (with artwork) or 10-80% (without)
  const metadataSpan = downloadArtwork ? 0.5 : 0.7;

  const batchMetadata = await runBatches(
    filePaths,
    METADATA_BATCH_SIZE,
    getBatchMetadata,
    (done, total) => onProgress(0.1 + metadataSpan * (done / total)),
    isCancelled,
  );

  // Cover art phase: 60-85% (only when downloadArtwork is on)
  let coverArtHashes: Record<string, string | null> = {};

  if (downloadArtwork) {
    const artTargets = batchMetadata.filter((m) => m.has_cover_art).map((m) => m.file_path);

    if (artTargets.length > 0) {
      try {
        const coverBase = 0.1 + metadataSpan;
        const hashed = await runBatches(
          artTargets,
          ART_BATCH_SIZE,
          generateCoverArtHashes,
          (done, total) => onProgress(coverBase + 0.25 * (done / total)),
          isCancelled,
        );
        coverArtHashes = Object.fromEntries(hashed);
      } catch (err) {
        logError('Failed to precompute cover art hashes', {
          source: 'useLibraryScan',
          error: err,
        });
      }
    }
  }

  const tracks: Track[] = batchMetadata.map((meta) => ({
    id: meta.file_path,
    title: meta.title || getPathBaseName(meta.file_path) || 'Unknown',
    artist: meta.artist || 'Unknown Artist',
    albumArtist: meta.album_artist ?? null,
    album: meta.album || 'Unknown Album',
    year: meta.year,
    trackNumber: meta.track_number,
    discNumber: meta.disc_number,
    duration: meta.duration_secs,
    filePath: meta.file_path,
    hasCoverArt: !!meta.has_cover_art,
    coverArtHash: coverArtHashes[meta.file_path] ?? null,
    blurhash: meta.blurhash ?? null,
    fileFormat: meta.file_format,
    bitrate: meta.bitrate ?? undefined,
    sampleRate: meta.sample_rate ?? undefined,
    fileSize: meta.file_size ?? undefined,
    dateAdded: Date.now(),
  }));
  const metadataPaths = new Set(batchMetadata.map((metadata) => metadata.file_path));
  const metadataErrors = filePaths
    .filter((path) => !metadataPaths.has(path))
    .map((path) => ({
      path,
      code: 'metadataReadFailed',
      message: 'Tarab found the file but could not read its metadata.',
      recoverable: true,
    }));

  onProgress(0.85);
  return {
    folderPath,
    discoveredPaths: filePaths,
    traversalComplete,
    tracks,
    metadataErrors: [...traversalErrors, ...metadataErrors],
  };
}

async function persistFolderTracks(
  scan: ScanSingleFolderResult,
  queryClient: QueryClient,
): Promise<ScanReconcileResult> {
  const result = await dbReconcileFolderScan({
    folderPath: scan.folderPath,
    discoveredPaths: scan.discoveredPaths,
    traversalComplete: scan.traversalComplete,
    errors: scan.metadataErrors,
    tracks: scan.tracks.map((t) => ({
      id: t.id,
      title: t.title,
      artist: t.artist,
      albumArtist: t.albumArtist ?? null,
      album: t.album,
      year: t.year,
      trackNumber: t.trackNumber ?? null,
      discNumber: t.discNumber ?? null,
      duration: t.duration,
      filePath: t.filePath,
      hasCoverArt: t.hasCoverArt,
      coverArtHash: t.coverArtHash ?? null,
      blurhash: t.blurhash ?? null,
      fileFormat: t.fileFormat ?? null,
      bitrate: t.bitrate ?? null,
      sampleRate: t.sampleRate ?? null,
      fileSize: t.fileSize ?? null,
      dateAdded: t.dateAdded,
      playCount: 0,
      lastPlayed: null,
      rating: null,
    })),
  });

  await invalidateLibraryForMutation(queryClient, 'scan');
  return result;
}

/* ─── HOOK ───────────────────────────────────────────────────────────────── */

export interface UseLibraryScanResult {
  isScanning: boolean;
  folderStatuses: Record<string, FolderStatus>;
  scanFolder: (folderPath: string, options?: ScanFolderOptions) => Promise<FolderScanStatus>;
  rescanAll: () => Promise<void>;
  cancelScan: () => Promise<void>;
}

export function useLibraryScan(): UseLibraryScanResult {
  const queryClient = useQueryClient();

  const autoWatch = useSettingsStore((s) => s.autoWatch);
  const followSymlinks = useSettingsStore((s) => s.followSymlinks);
  const downloadArtwork = useSettingsStore((s) => s.downloadArtwork);
  const libraryFolders = useSettingsStore((s) => s.libraryFolders);

  const isScanning = useLibraryStore((s) => s.isScanning);
  const setIsScanning = useLibraryStore((s) => s.setIsScanning);
  const setScanProgress = useLibraryStore((s) => s.setScanProgress);

  const isScanningRef = useRef(isScanning);
  const scanCancelledRef = useRef(false);
  useEffect(() => {
    isScanningRef.current = isScanning;
  }, [isScanning]);
  const autoWatchRef = useRef(autoWatch);
  useEffect(() => {
    autoWatchRef.current = autoWatch;
  }, [autoWatch]);
  const isMountedRef = useRef(true);
  // Folder to rescan -> the library root it belongs to.
  const watchQueueRef = useRef<Map<string, string>>(new Map());
  const watchQueueProcessingRef = useRef(false);
  const watchDebounceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Library root -> changed folders collected during the current debounce window.
  const watchPendingTargetsRef = useRef<Map<string, Set<string>>>(new Map());

  const [folderStatuses, setFolderStatuses] = useState<Record<string, FolderStatus>>({});

  const scanFolder = useCallback(
    async (folderPath: string, options?: ScanFolderOptions): Promise<FolderScanStatus> => {
      const statusKey = options?.statusKey ?? folderPath;
      scanCancelledRef.current = false;
      setIsScanning(true);
      setScanProgress(0);
      setFolderStatuses((prev) => ({ ...prev, [statusKey]: { status: 'scanning' } }));

      try {
        const scan = await scanSingleFolder({
          folderPath,
          followSymlinks,
          downloadArtwork,
          // Map 0-1 ratio to 0-85 display range, leaving 85-100 for DB writes
          onProgress: (ratio) => setScanProgress(clampProgress(ratio * 85)),
          isCancelled: () => scanCancelledRef.current,
        });

        setScanProgress(90);

        const result = await persistFolderTracks(scan, queryClient);

        const status: FolderScanStatus = result.status === 'complete' ? 'success' : 'partial';
        setFolderStatuses((prev) => ({
          ...prev,
          [statusKey]: { status, lastScanned: new Date() },
        }));
        setScanProgress(100);
        recordLibraryScan();
        if (!options?.silent && result.status === 'complete') {
          notifications.notifyScanComplete(result.discoveredCount);
          window.dispatchEvent(new CustomEvent('tarab:manual-scan-complete'));
        }

        void syncLyricsIndex().catch((err) =>
          logError('Failed to refresh lyrics index', {
            source: 'useLibraryScan',
            error: err,
          }),
        );
        return status;
      } catch (e) {
        const cancelled = e instanceof Error && e.message.toLowerCase().includes('cancel');
        if (options?.reportErrors !== false) {
          reportError(`Failed to scan folder: ${folderPath}`, {
            source: 'useLibraryScan',
            error: e,
          });
        }
        const status: FolderScanStatus = cancelled ? 'partial' : 'error';
        setFolderStatuses((prev) => ({ ...prev, [statusKey]: { status } }));
        return status;
      } finally {
        setIsScanning(false);
      }
    },
    [downloadArtwork, followSymlinks, libraryFolders, queryClient, setIsScanning, setScanProgress],
  );

  const rescanAll = useCallback(async (): Promise<void> => {
    if (libraryFolders.length === 0) return;

    setIsScanning(true);
    scanCancelledRef.current = false;
    setScanProgress(0);

    let discoveredCount = 0;
    let completedFolders = 0;
    const total = libraryFolders.length;

    for (let i = 0; i < total; i++) {
      const folderPath = libraryFolders[i];
      // Each folder owns an equal slice of the 0-100 progress range
      const sliceStart = i / total;
      const sliceSize = 1 / total;

      setFolderStatuses((prev) => ({ ...prev, [folderPath]: { status: 'scanning' } }));

      try {
        const scan = await scanSingleFolder({
          folderPath,
          followSymlinks,
          downloadArtwork,
          // Map folder's internal 0-1 ratio into its progress slice (85% of slice = scan, 15% = DB)
          onProgress: (ratio) =>
            setScanProgress(clampProgress((sliceStart + sliceSize * ratio * 0.85) * 100)),
          isCancelled: () => scanCancelledRef.current,
        });

        setScanProgress(clampProgress((sliceStart + sliceSize * 0.9) * 100));

        const result = await persistFolderTracks(scan, queryClient);
        discoveredCount += result.discoveredCount;
        if (result.status === 'complete') completedFolders += 1;

        setFolderStatuses((prev) => ({
          ...prev,
          [folderPath]: {
            status: result.status === 'complete' ? 'success' : 'partial',
            lastScanned: new Date(),
          },
        }));
      } catch (e) {
        const cancelled = e instanceof Error && e.message.toLowerCase().includes('cancel');
        reportError(`Failed to scan folder: ${folderPath}`, {
          source: 'useLibraryScan',
          error: e,
        });
        setFolderStatuses((prev) => ({
          ...prev,
          [folderPath]: { status: cancelled ? 'partial' : 'error' },
        }));
        if (cancelled) break;
      }
    }

    await invalidateLibraryForMutation(queryClient, 'scan');
    setIsScanning(false);
    setScanProgress(100);
    recordLibraryScan();
    if (completedFolders === total) {
      notifications.notifyScanComplete(discoveredCount);
      window.dispatchEvent(new CustomEvent('tarab:manual-scan-complete'));
    }

    void syncLyricsIndex().catch((err) =>
      logError('Failed to refresh lyrics index', {
        source: 'useLibraryScan',
        error: err,
      }),
    );
  }, [
    downloadArtwork,
    followSymlinks,
    libraryFolders,
    queryClient,
    setIsScanning,
    setScanProgress,
  ]);

  const cancelScan = useCallback(async () => {
    scanCancelledRef.current = true;
    await cancelLibraryScan();
  }, []);

  const clearWatchDebounces = useCallback(() => {
    watchDebounceRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    watchDebounceRef.current.clear();
    watchPendingTargetsRef.current.clear();
  }, []);

  const drainWatchQueue = useCallback(() => {
    if (watchQueueProcessingRef.current) return;
    watchQueueProcessingRef.current = true;

    void (async () => {
      try {
        while (isMountedRef.current && autoWatchRef.current && watchQueueRef.current.size > 0) {
          if (isScanningRef.current) {
            await sleep(WATCH_RETRY_MS);
            continue;
          }
          const { value: next, done } = watchQueueRef.current.entries().next();
          if (done) {
            break;
          }

          const [nextFolder, root] = next;
          watchQueueRef.current.delete(nextFolder);
          const isRoot = nextFolder === root;
          const status = await scanFolder(nextFolder, {
            silent: true,
            statusKey: root,
            reportErrors: isRoot,
          });
          if (status === 'error' && !isRoot) {
            // The changed folder may have been removed or renamed; reconcile the whole root.
            watchQueueRef.current.set(root, root);
          }
        }
      } finally {
        watchQueueProcessingRef.current = false;
        if (isMountedRef.current && autoWatchRef.current && watchQueueRef.current.size > 0) {
          drainWatchQueue();
        }
      }
    })();
  }, [scanFolder]);

  const queueWatchedFolderScans = useCallback(
    (root: string, folders: string[]) => {
      for (const folder of folders) {
        watchQueueRef.current.set(folder, root);
      }
      drainWatchQueue();
    },
    [drainWatchQueue],
  );

  const scheduleWatchedFolderScan = useCallback(
    (root: string, target: string) => {
      // Rescan only the folders that changed (PB-18): a whole-root rescan re-read every file in
      // the library for each edit, including Tarab's own tag and lyrics writes.
      const pending = watchPendingTargetsRef.current.get(root) ?? new Set<string>();
      pending.add(target);
      watchPendingTargetsRef.current.set(root, pending);

      const existingTimeout = watchDebounceRef.current.get(root);
      if (existingTimeout) {
        clearTimeout(existingTimeout);
      }

      const timeoutId = setTimeout(() => {
        watchDebounceRef.current.delete(root);
        const targets = watchPendingTargetsRef.current.get(root) ?? new Set<string>();
        watchPendingTargetsRef.current.delete(root);
        if (!autoWatchRef.current || !isMountedRef.current) {
          return;
        }
        queueWatchedFolderScans(root, collapseWatchScanTargets(root, targets));
      }, 1100);

      watchDebounceRef.current.set(root, timeoutId);
    },
    [queueWatchedFolderScans],
  );

  const handleWatchEvent = useCallback(
    (event: LibraryWatchEventPayload) => {
      if (!autoWatchRef.current) return;
      const resolved = resolveWatchEventScanTarget(event, libraryFolders);
      if (!resolved) return;
      scheduleWatchedFolderScan(resolved.root, resolved.target);
    },
    [libraryFolders, scheduleWatchedFolderScan],
  );

  useTauriEvent<LibraryWatchEventPayload>(
    'library-files-changed',
    (event) => handleWatchEvent(event.payload),
    [handleWatchEvent],
    (error) =>
      logError('Failed to listen for library file change events', {
        source: 'library-scan',
        error,
      }),
  );

  useTauriEvent<LibraryWatchEventPayload>(
    'library-file-removed',
    (event) => handleWatchEvent(event.payload),
    [handleWatchEvent],
    (error) =>
      logError('Failed to listen for library file removal events', {
        source: 'library-scan',
        error,
      }),
  );

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      watchQueueRef.current.clear();
      clearWatchDebounces();
      void watchLibraryPaths([]).catch(() => undefined);
    };
  }, [clearWatchDebounces]);

  useEffect(() => {
    watchQueueRef.current.clear();
    clearWatchDebounces();

    if (!autoWatch || libraryFolders.length === 0) {
      void watchLibraryPaths([]).catch(() => undefined);
      return;
    }

    let disposed = false;

    void watchLibraryPaths(libraryFolders).catch((error) => {
      if (!disposed) {
        // The library still works without watchers, but stops updating on its own.
        reportError('Tarab cannot watch your music folders for changes', {
          source: 'library-scan',
          detail: 'New and changed files appear after the next rescan.',
          error,
        });
      }
    });

    return () => {
      disposed = true;
      void watchLibraryPaths([]).catch(() => undefined);
      watchQueueRef.current.clear();
      clearWatchDebounces();
    };
  }, [autoWatch, clearWatchDebounces, libraryFolders]);

  return useMemo(
    () => ({ isScanning, folderStatuses, scanFolder, rescanAll, cancelScan }),
    [cancelScan, folderStatuses, isScanning, rescanAll, scanFolder],
  );
}
