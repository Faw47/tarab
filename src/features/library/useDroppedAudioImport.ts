import type { QueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { runBatches } from '../../lib/batch-utils';
import { getPathBaseName, isSameOrSubPath, normalizePath } from '../../lib/path-utils';
import { reportError } from '../../lib/report-error';
import {
  dbGetExistingPaths,
  dbGetTrackCount,
  dbUpsertTracks,
  generateCoverArtHashes,
  getBatchMetadata,
  scanLibrary,
  scanLibraryParallel,
  syncLyricsIndex,
} from '../../lib/tauri-commands';
import type { Track } from '../../types';
import { invalidateLibraryForMutation } from './mutations';
import { libraryKeys } from './queryKeys';

const LAST_SCAN_KEY = 'tarab-last-scan-v1';
const METADATA_BATCH_SIZE = 200;
const ART_BATCH_SIZE = 120;

const cleanFolderPath = (folder: string): string => normalizePath(folder).replace(/\/+$/, '');

export function mergeDroppedLibraryFolders(
  currentFolders: string[],
  droppedFolders: Iterable<string>,
): string[] {
  const candidates = [...currentFolders, ...droppedFolders]
    .map(cleanFolderPath)
    .filter(Boolean)
    .sort((a, b) => a.length - b.length || a.localeCompare(b));

  const merged: string[] = [];
  for (const folder of candidates) {
    if (merged.some((existing) => isSameOrSubPath(folder, existing))) {
      continue;
    }
    merged.push(folder);
  }

  return merged;
}

interface FileWithPath extends File {
  path?: string;
}

interface UseDroppedAudioImportOptions {
  downloadArtwork: boolean;
  followSymlinks: boolean;
  libraryFolders: string[];
  queryClient: QueryClient;
  setIsScanning: (isScanning: boolean) => void;
  setScanProgress: (progress: number) => void;
  setTrackCount: (count: number) => void;
  setTracks: (tracks: Track[]) => void;
  startProcessing: (label: string) => string;
  updateProcessing: (id: string, progress: number) => void;
  finishProcessing: (id: string) => void;
}

export function useDroppedAudioImport({
  downloadArtwork,
  followSymlinks,
  libraryFolders,
  queryClient,
  setIsScanning,
  setScanProgress,
  setTrackCount,
  setTracks,
  startProcessing,
  updateProcessing,
  finishProcessing,
}: UseDroppedAudioImportOptions) {
  const [showDropOverlay, setShowDropOverlay] = useState(false);

  useEffect(() => {
    const audioExt = new Set(['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'aiff', 'alac']);
    const normalizeDir = (p: string) => {
      const norm = p.replace(/\\/g, '/');
      const idx = norm.lastIndexOf('/');
      return idx >= 0 ? norm.slice(0, idx) : norm;
    };
    const handleDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        e.preventDefault();
        setShowDropOverlay(true);
      }
    };
    const handleDrop = async (e: DragEvent) => {
      if (!e.dataTransfer?.files) return;
      e.preventDefault();
      setShowDropOverlay(false);
      const files = Array.from(e.dataTransfer.files);
      const dirs = new Set<string>();
      files.forEach((file) => {
        const path = (file as FileWithPath).path;
        if (!path) return;
        const ext = path.split('.').pop()?.toLowerCase();
        if (ext && audioExt.has(ext)) {
          dirs.add(normalizeDir(path));
        }
      });
      if (dirs.size === 0) return;
      const droppedFolders = Array.from(dirs);
      const foldersToScan = mergeDroppedLibraryFolders(
        [],
        droppedFolders.filter((folder) =>
          libraryFolders.some((root) => isSameOrSubPath(folder, root)),
        ),
      );
      if (foldersToScan.length === 0) {
        reportError('Dropped files are outside the approved library folders', {
          source: 'app',
          error: new Error('Add the folder in Library settings before you import its files.'),
        });
        return;
      }
      setIsScanning(true);
      setScanProgress(0);
      const taskId = startProcessing('Importing audio files');
      let processed = 0;
      const newlyAddedTracks: Track[] = [];
      try {
        for (const dir of foldersToScan) {
          try {
            const updateDirProgress = (ratio: number) => {
              const overall = ((processed + ratio) / foldersToScan.length) * 100;
              setScanProgress(Math.round(overall));
              updateProcessing(taskId, overall);
            };

            let filePaths: string[] = [];
            try {
              filePaths = await scanLibraryParallel(dir, followSymlinks);
            } catch {
              filePaths = await scanLibrary(dir, followSymlinks);
            }
            const normalizedFilePaths = filePaths.map((p) => normalizePath(p));
            updateDirProgress(0.1);
            const existingInDb = await dbGetExistingPaths(normalizedFilePaths);
            const existingPaths = new Set(existingInDb.map((p) => normalizePath(p)));
            const newFilePaths = normalizedFilePaths.filter((p) => !existingPaths.has(p));
            if (newFilePaths.length > 0) {
              const metadataBase = 0.1;
              const metadataSpan = downloadArtwork ? 0.5 : 0.7;
              const batchMetadata = await runBatches(
                newFilePaths,
                METADATA_BATCH_SIZE,
                getBatchMetadata,
                (done, total) => {
                  updateDirProgress(metadataBase + (metadataSpan * done) / total);
                },
              );
              let coverArtHashes: Record<string, string | null> = {};
              const artTargets = downloadArtwork
                ? batchMetadata.filter((m) => m.has_cover_art).map((m) => m.file_path)
                : [];
              if (downloadArtwork && artTargets.length > 0) {
                const artTask = startProcessing('Preparing cover art');
                try {
                  const coverBase = metadataBase + metadataSpan;
                  const coverSpan = 0.25;
                  const hashed = await runBatches(
                    artTargets,
                    ART_BATCH_SIZE,
                    generateCoverArtHashes,
                    (done, total) => {
                      updateDirProgress(coverBase + (coverSpan * done) / total);
                      updateProcessing(artTask, (done / total) * 100);
                    },
                  );
                  coverArtHashes = Object.fromEntries(hashed);
                } catch (err) {
                  reportError('Failed to precompute cover art hashes', {
                    source: 'app',
                    error: err,
                  });
                } finally {
                  finishProcessing(artTask);
                }
              }
              const newTracks: Track[] = batchMetadata.map((meta) => ({
                id: meta.file_path,
                title: meta.title || getPathBaseName(meta.file_path) || 'Unknown',
                artist: meta.artist || 'Unknown Artist',
                albumArtist: meta.album_artist ?? null,
                album: meta.album || 'Unknown Album',
                year: meta.year,
                duration: meta.duration_secs,
                filePath: meta.file_path,
                hasCoverArt: !!meta.has_cover_art,
                coverArtHash: coverArtHashes[meta.file_path] ?? null,
                dateAdded: Date.now(),
                fileFormat: meta.file_format,
                bitrate: meta.bitrate ?? undefined,
                sampleRate: meta.sample_rate ?? undefined,
                fileSize: meta.file_size ?? undefined,
              }));
              const existing = queryClient.getQueryData<Track[]>(libraryKeys.tracks()) ?? [];
              const merged = [...existing, ...newTracks];
              setTracks(merged);
              newlyAddedTracks.push(...newTracks);
            }
            processed += 1;
            updateDirProgress(1);
          } catch (err) {
            reportError('Failed to import dropped files', { source: 'app', error: err });
          }
        }
        if (newlyAddedTracks.length > 0) {
          try {
            await dbUpsertTracks(
              newlyAddedTracks.map((track) => ({
                id: track.id,
                title: track.title,
                artist: track.artist,
                albumArtist: track.albumArtist ?? null,
                album: track.album,
                year: track.year,
                duration: track.duration,
                filePath: track.filePath,
                hasCoverArt: track.hasCoverArt,
                coverArtHash: track.coverArtHash ?? null,
                fileFormat: track.fileFormat ?? null,
                bitrate: track.bitrate ?? null,
                sampleRate: track.sampleRate ?? null,
                fileSize: track.fileSize ?? null,
                dateAdded: track.dateAdded,
                playCount: 0,
                lastPlayed: null,
                rating: null,
                blurhash: track.blurhash || null,
              })),
            );
            void syncLyricsIndex().catch((error) => {
              reportError('Failed to refresh lyrics index after import', { source: 'app', error });
            });
            const total = await dbGetTrackCount();
            setTrackCount(total);
            await invalidateLibraryForMutation(queryClient, 'upsert');
          } catch (err) {
            reportError('Failed to persist imported tracks', { source: 'app', error: err });
          }
        }
        setScanProgress(100);
        try {
          localStorage.setItem(LAST_SCAN_KEY, Date.now().toString());
        } catch {
          // ignore storage errors
        }
      } finally {
        setIsScanning(false);
        finishProcessing(taskId);
      }
    };
    const handleDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) {
        setShowDropOverlay(false);
      }
    };
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    window.addEventListener('dragleave', handleDragLeave);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('dragleave', handleDragLeave);
    };
  }, [
    downloadArtwork,
    finishProcessing,
    followSymlinks,
    libraryFolders,
    queryClient,
    setIsScanning,
    setScanProgress,
    setTrackCount,
    setTracks,
    startProcessing,
    updateProcessing,
  ]);

  return { showDropOverlay };
}
