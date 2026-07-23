import { useEffect, useRef, useState } from 'react';
import { reportError } from '../../lib/report-error';
import { listLibraryGrants, syncLyricsIndex } from '../../lib/tauri-commands';
import type { Track } from '../../types';

interface UseLibraryRootSyncOptions {
  libraryFolders: string[];
  libraryTracks: Track[];
  prefetchCoverArt: (tracks: Track[]) => void | Promise<void>;
  setLibraryFolders: (folders: string[]) => void;
}

export function useLibraryRootSync({
  libraryFolders,
  libraryTracks,
  prefetchCoverArt,
  setLibraryFolders,
}: UseLibraryRootSyncOptions) {
  const [libraryRootsReady, setLibraryRootsReady] = useState(false);
  const syncedLyricsRootKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const syncRoots = async () => {
      setLibraryRootsReady(false);
      try {
        const grants = await listLibraryGrants();
        if (cancelled) return;
        const grantedFolders = grants.map((grant) => grant.path);
        const foldersChanged =
          grantedFolders.length !== libraryFolders.length ||
          grantedFolders.some((folder, index) => folder !== libraryFolders[index]);
        if (foldersChanged) {
          setLibraryFolders(grantedFolders);
        }
        setLibraryRootsReady(true);

        const availableFolders = grants
          .filter((grant) => grant.status === 'available')
          .map((grant) => grant.path);
        if (availableFolders.length === 0) {
          syncedLyricsRootKeyRef.current = null;
          return;
        }

        const rootKey = availableFolders.join('\0');
        if (syncedLyricsRootKeyRef.current !== rootKey) {
          syncedLyricsRootKeyRef.current = rootKey;
          void syncLyricsIndex().catch((error) => {
            reportError('Failed to refresh lyrics index', { source: 'app', error });
          });
        }
      } catch (error) {
        if (!cancelled) {
          setLibraryRootsReady(false);
        }
        reportError('Failed to load native library grants', { source: 'app', error });
      }
    };

    void syncRoots();
    return () => {
      cancelled = true;
    };
  }, [libraryFolders, setLibraryFolders]);

  useEffect(() => {
    if (!libraryRootsReady || libraryFolders.length === 0 || libraryTracks.length === 0) return;
    void prefetchCoverArt(libraryTracks);
  }, [libraryFolders.length, libraryRootsReady, libraryTracks, prefetchCoverArt]);

  return { libraryRootsReady };
}
