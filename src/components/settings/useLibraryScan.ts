import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invalidateLibraryForMutation } from '../../features/library/mutations';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { runBatches } from '../../lib/batch-utils';
import { getPathBaseName, isSameOrSubPath } from '../../lib/path-utils';
import { reportError } from '../../lib/report-error';
import {
  cancelLibraryScan,
  dbReconcileFolderScan,
  finishLibraryScan,
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
}

/* ─── INTERNAL PURE FUNCTIONS ────────────────────────────────────────────── */

interface ScanSingleFolderOptions {
  scanId: string;
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
  scanId,
  folderPath,
  followSymlinks,
  downloadArtwork,
  onProgress,
  isCancelled,
}: ScanSingleFolderOptions): Promise<ScanSingleFolderResult> {
  const filePaths = await scanLibrary(folderPath, followSymlinks, scanId);
  if (isCancelled()) throw new Error('Library scan cancelled');
  onProgress(0.1);

  if (filePaths.length === 0) {
    onProgress(1);
    return {
      folderPath,
      discoveredPaths: [],
      tracks: [],
      metadataErrors: [],
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
          (paths) => generateCoverArtHashes(paths, true),
          (done, total) => onProgress(coverBase + 0.25 * (done / total)),
          isCancelled,
        );
        coverArtHashes = Object.fromEntries(hashed);
      } catch (err) {
        if (isCancelled()) throw err;
        reportError('Failed to precompute cover art hashes', {
          source: 'useLibraryScan',
          error: err,
        });
      }
    }
  }

  if (isCancelled()) throw new Error('Library scan cancelled');

  const tracks: Track[] = batchMetadata.map((meta) => ({
    id: meta.file_path,
    title: meta.title || getPathBaseName(meta.file_path) || 'Unknown',
    artist: meta.artist || 'Unknown Artist',
    albumArtist: meta.album_artist ?? null,
    album: meta.album || 'Unknown Album',
    genre: meta.genre ?? null,
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
    tracks,
    metadataErrors,
  };
}

async function persistFolderTracks(
  scan: ScanSingleFolderResult,
  queryClient: QueryClient,
  scanId: string,
  isCancelled: () => boolean,
): Promise<ScanReconcileResult> {
  if (isCancelled()) throw new Error('Library scan cancelled');
  const result = await dbReconcileFolderScan(
    {
      folderPath: scan.folderPath,
      discoveredPaths: scan.discoveredPaths,
      traversalComplete: true,
      errors: scan.metadataErrors,
      tracks: scan.tracks.map((t) => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        albumArtist: t.albumArtist ?? null,
        album: t.album,
        genre: t.genre ?? null,
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
    },
    scanId,
  );

  if (isCancelled()) throw new Error('Library scan cancelled');
  await invalidateLibraryForMutation(queryClient, 'scan');
  return result;
}

/* ─── HOOK ───────────────────────────────────────────────────────────────── */

export interface UseLibraryScanResult {
  isScanning: boolean;
  folderStatuses: Record<string, FolderStatus>;
  scanFolder: (folderPath: string, options?: ScanFolderOptions) => Promise<void>;
  rescanAll: () => Promise<void>;
  cancelScan: () => Promise<void>;
}

interface ScanRun {
  cancelled: boolean;
  nativeScanIds: Set<string>;
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
  const scanQueueRef = useRef<Promise<void>>(Promise.resolve());
  const scanRunsRef = useRef<Set<ScanRun>>(new Set());
  const activeScanRunRef = useRef<ScanRun | null>(null);
  useEffect(() => {
    isScanningRef.current = isScanning;
  }, [isScanning]);
  const autoWatchRef = useRef(autoWatch);
  useEffect(() => {
    autoWatchRef.current = autoWatch;
  }, [autoWatch]);
  const isMountedRef = useRef(true);
  const watchQueueRef = useRef<Set<string>>(new Set());
  const watchQueueProcessingRef = useRef(false);
  const watchDebounceRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const [folderStatuses, setFolderStatuses] = useState<Record<string, FolderStatus>>({});

  const enqueueScan = useCallback(
    (work: (run: ScanRun) => Promise<void>): Promise<void> => {
      const run: ScanRun = { cancelled: false, nativeScanIds: new Set() };
      scanRunsRef.current.add(run);
      setIsScanning(true);

      const syncScanningState = () => {
        setIsScanning(scanRunsRef.current.size > 0);
      };

      const queued = scanQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (run.cancelled) {
            scanRunsRef.current.delete(run);
            syncScanningState();
            return;
          }
          activeScanRunRef.current = run;
          try {
            await work(run);
          } finally {
            if (activeScanRunRef.current === run) activeScanRunRef.current = null;
            scanRunsRef.current.delete(run);
            syncScanningState();
          }
        });
      scanQueueRef.current = queued.catch(() => undefined);
      return queued;
    },
    [setIsScanning],
  );

  const scanFolder = useCallback(
    (folderPath: string, options?: ScanFolderOptions): Promise<void> =>
      enqueueScan(async (run) => {
        const scanId = crypto.randomUUID();
        const isCancelled = () => run.cancelled || activeScanRunRef.current !== run;
        run.nativeScanIds.add(scanId);
        setScanProgress(0);
        setFolderStatuses((prev) => ({ ...prev, [folderPath]: { status: 'scanning' } }));

        try {
          const scan = await scanSingleFolder({
            scanId,
            folderPath,
            followSymlinks,
            downloadArtwork,
            // Map 0-1 ratio to 0-85 display range, leaving 85-100 for DB writes
            onProgress: (ratio) => setScanProgress(clampProgress(ratio * 85)),
            isCancelled,
          });

          if (isCancelled()) throw new Error('Library scan cancelled');
          setScanProgress(90);
          const result = await persistFolderTracks(scan, queryClient, scanId, isCancelled);

          setFolderStatuses((prev) => ({
            ...prev,
            [folderPath]: {
              status: result.status === 'complete' ? 'success' : 'partial',
              lastScanned: new Date(),
            },
          }));
          setScanProgress(100);
          recordLibraryScan();
          if (!options?.silent && result.status === 'complete') {
            notifications.notifyScanComplete(result.discoveredCount);
            window.dispatchEvent(new CustomEvent('tarab:manual-scan-complete'));
          }

          void syncLyricsIndex().catch((err) =>
            reportError('Failed to refresh lyrics index', {
              source: 'useLibraryScan',
              error: err,
            }),
          );
        } catch (e) {
          const cancelled = run.cancelled || activeScanRunRef.current !== run;
          if (!cancelled) {
            reportError(`Failed to scan folder: ${folderPath}`, {
              source: 'useLibraryScan',
              error: e,
            });
          }
          setFolderStatuses((prev) => ({
            ...prev,
            [folderPath]: { status: cancelled ? 'partial' : 'error' },
          }));
        } finally {
          run.nativeScanIds.delete(scanId);
          await finishLibraryScan(scanId).catch(() => undefined);
        }
      }),
    [downloadArtwork, enqueueScan, followSymlinks, queryClient, setScanProgress],
  );

  const rescanAll = useCallback((): Promise<void> => {
    if (libraryFolders.length === 0) return Promise.resolve();

    return enqueueScan(async (run) => {
      setScanProgress(0);
      let discoveredCount = 0;
      let completedFolders = 0;
      const total = libraryFolders.length;

      try {
        for (let i = 0; i < total; i++) {
          const folderPath = libraryFolders[i];
          const sliceStart = i / total;
          const sliceSize = 1 / total;
          const scanId = crypto.randomUUID();
          const isCancelled = () => run.cancelled || activeScanRunRef.current !== run;
          run.nativeScanIds.add(scanId);
          setFolderStatuses((prev) => ({ ...prev, [folderPath]: { status: 'scanning' } }));

          try {
            const scan = await scanSingleFolder({
              scanId,
              folderPath,
              followSymlinks,
              downloadArtwork,
              onProgress: (ratio) =>
                setScanProgress(clampProgress((sliceStart + sliceSize * ratio * 0.85) * 100)),
              isCancelled,
            });

            if (isCancelled()) throw new Error('Library scan cancelled');
            setScanProgress(clampProgress((sliceStart + sliceSize * 0.9) * 100));
            const result = await persistFolderTracks(scan, queryClient, scanId, isCancelled);
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
            const cancelled = run.cancelled || activeScanRunRef.current !== run;
            if (!cancelled) {
              reportError(`Failed to scan folder: ${folderPath}`, {
                source: 'useLibraryScan',
                error: e,
              });
            }
            setFolderStatuses((prev) => ({
              ...prev,
              [folderPath]: { status: cancelled ? 'partial' : 'error' },
            }));
            if (cancelled) break;
          } finally {
            run.nativeScanIds.delete(scanId);
            await finishLibraryScan(scanId).catch(() => undefined);
          }
        }

        if (run.cancelled) return;
        await invalidateLibraryForMutation(queryClient, 'scan');
        setScanProgress(100);
        recordLibraryScan();
        if (completedFolders === total) {
          notifications.notifyScanComplete(discoveredCount);
          window.dispatchEvent(new CustomEvent('tarab:manual-scan-complete'));
        }

        void syncLyricsIndex().catch((err) =>
          reportError('Failed to refresh lyrics index', {
            source: 'useLibraryScan',
            error: err,
          }),
        );
      } catch (error) {
        reportError('Failed to rescan library', {
          source: 'useLibraryScan',
          error,
        });
      }
    });
  }, [downloadArtwork, enqueueScan, followSymlinks, libraryFolders, queryClient, setScanProgress]);

  const cancelScan = useCallback(async () => {
    const runs = Array.from(scanRunsRef.current);
    for (const run of runs) run.cancelled = true;
    await Promise.all(
      runs.flatMap((run) =>
        Array.from(run.nativeScanIds, (scanId) => cancelLibraryScan(scanId).catch(() => undefined)),
      ),
    );
  }, []);

  const watchUpdateQueueRef = useRef<Promise<void>>(Promise.resolve());
  const queueWatchUpdate = useCallback((paths: string[]) => {
    const update = watchUpdateQueueRef.current
      .catch(() => undefined)
      .then(() => watchLibraryPaths(paths));
    watchUpdateQueueRef.current = update.catch(() => undefined);
    return update;
  }, []);

  const clearWatchDebounces = useCallback(() => {
    watchDebounceRef.current.forEach((timeoutId) => clearTimeout(timeoutId));
    watchDebounceRef.current.clear();
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
          const { value: nextFolder, done } = watchQueueRef.current.values().next();
          if (done) {
            break;
          }

          watchQueueRef.current.delete(nextFolder);
          await scanFolder(nextFolder, { silent: true });
        }
      } finally {
        watchQueueProcessingRef.current = false;
        if (isMountedRef.current && autoWatchRef.current && watchQueueRef.current.size > 0) {
          drainWatchQueue();
        }
      }
    })();
  }, [scanFolder]);

  const queueWatchedFolderScan = useCallback(
    (folderPath: string) => {
      watchQueueRef.current.add(folderPath);
      drainWatchQueue();
    },
    [drainWatchQueue],
  );

  const scheduleWatchedFolderScan = useCallback(
    (folderPath: string) => {
      const existingTimeout = watchDebounceRef.current.get(folderPath);
      if (existingTimeout !== undefined) {
        clearTimeout(existingTimeout);
      }

      const timeoutId = setTimeout(() => {
        watchDebounceRef.current.delete(folderPath);
        if (!autoWatchRef.current || !isMountedRef.current) {
          return;
        }
        queueWatchedFolderScan(folderPath);
      }, 1100);

      watchDebounceRef.current.set(folderPath, timeoutId);
    },
    [queueWatchedFolderScan],
  );

  const handleWatchEvent = useCallback(
    (changedPath: string) => {
      if (!autoWatchRef.current) return;
      const folderPath = libraryFolders.find((folder) => isSameOrSubPath(changedPath, folder));
      if (!folderPath) return;
      scheduleWatchedFolderScan(folderPath);
    },
    [libraryFolders, scheduleWatchedFolderScan],
  );

  useTauriEvent<string>(
    'library-files-changed',
    (event) => handleWatchEvent(event.payload),
    [handleWatchEvent],
    (error) =>
      reportError('Failed to listen for library file change events', {
        source: 'library-scan',
        error,
      }),
  );

  useTauriEvent<string>(
    'library-file-removed',
    (event) => handleWatchEvent(event.payload),
    [handleWatchEvent],
    (error) =>
      reportError('Failed to listen for library file removal events', {
        source: 'library-scan',
        error,
      }),
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      watchQueueRef.current.clear();
      clearWatchDebounces();
      void queueWatchUpdate([]).catch(() => undefined);
    };
  }, [clearWatchDebounces, queueWatchUpdate]);

  useEffect(() => {
    watchQueueRef.current.clear();
    clearWatchDebounces();

    if (!autoWatch || libraryFolders.length === 0) {
      void queueWatchUpdate([]).catch(() => undefined);
      return;
    }

    let disposed = false;

    void queueWatchUpdate(libraryFolders).catch((error) => {
      if (!disposed) {
        reportError('Failed to setup filesystem watchers', { source: 'library-scan', error });
      }
    });

    return () => {
      disposed = true;
      void queueWatchUpdate([]).catch(() => undefined);
      watchQueueRef.current.clear();
      clearWatchDebounces();
    };
  }, [autoWatch, clearWatchDebounces, libraryFolders, queueWatchUpdate]);

  return useMemo(
    () => ({ isScanning, folderStatuses, scanFolder, rescanAll, cancelScan }),
    [cancelScan, folderStatuses, isScanning, rescanAll, scanFolder],
  );
}
