import { useEffect, useRef, useState } from 'react';
import { reportError } from '../../lib/report-error';
import { setLibraryRoots, syncLyricsIndex } from '../../lib/tauri-commands';
import type { Track } from '../../types';

interface UseLibraryRootSyncOptions {
  libraryFolders: string[];
  libraryTracks: Track[];
  prefetchCoverArt: (tracks: Track[]) => void | Promise<void>;
}

export function useLibraryRootSync({
  libraryFolders,
  libraryTracks,
  prefetchCoverArt,
}: UseLibraryRootSyncOptions) {
  const [libraryRootsReady, setLibraryRootsReady] = useState(false);
  const syncedLyricsRootKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const syncRoots = async () => {
      setLibraryRootsReady(false);
      try {
        await setLibraryRoots(libraryFolders);
        if (cancelled) return;
        setLibraryRootsReady(true);

        if (libraryFolders.length === 0) {
          syncedLyricsRootKeyRef.current = null;
          return;
        }

        const rootKey = libraryFolders.join('\0');
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
        reportError('Failed to sync library root allowlist', { source: 'app', error });
      }
    };

    void syncRoots();
    return () => {
      cancelled = true;
    };
  }, [libraryFolders]);

  useEffect(() => {
    if (!libraryRootsReady || libraryFolders.length === 0 || libraryTracks.length === 0) return;
    void prefetchCoverArt(libraryTracks);
  }, [libraryFolders.length, libraryRootsReady, libraryTracks, prefetchCoverArt]);

  return { libraryRootsReady };
}
