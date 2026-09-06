import { useEffect, useState } from 'react';
import { SUPPORTED_AUDIO_EXTENSION_SET } from '../../lib/media-formats';
import { getPathDirectory, isSameOrSubPath, normalizeFolderPath } from '../../lib/path-utils';
import { reportError } from '../../lib/report-error';

const cleanFolderPath = (folder: string): string => normalizeFolderPath(folder);

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

type ScanFolder = (folderPath: string, options?: { silent?: boolean }) => Promise<void>;

interface UseDroppedAudioImportOptions {
  libraryFolders: string[];
  scanFolder: ScanFolder;
}

export function useDroppedAudioImport({
  libraryFolders,
  scanFolder,
}: UseDroppedAudioImportOptions) {
  const [showDropOverlay, setShowDropOverlay] = useState(false);

  useEffect(() => {
    const handleDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
        event.preventDefault();
        setShowDropOverlay(true);
      }
    };

    const handleDrop = async (event: DragEvent) => {
      if (!event.dataTransfer?.files) return;
      event.preventDefault();
      setShowDropOverlay(false);

      const droppedFolders = Array.from(event.dataTransfer.files)
        .map((file) => (file as FileWithPath).path)
        .filter((path): path is string => {
          if (!path) return false;
          const extension = path.split('.').pop()?.toLowerCase();
          return Boolean(extension && SUPPORTED_AUDIO_EXTENSION_SET.has(extension));
        })
        .map(getPathDirectory);

      if (droppedFolders.length === 0) return;

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

      try {
        for (const folder of foldersToScan) {
          await scanFolder(folder, { silent: true });
        }
      } catch (error) {
        reportError('Failed to queue dropped files for import', { source: 'app', error });
      }
    };

    const handleDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) {
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
  }, [libraryFolders, scanFolder]);

  return { showDropOverlay };
}
