import { useCallback, useRef } from 'react';
import type { Track } from '../types';

const PREFETCHED_COVER_ART_LIMIT = 400;

export function useCoverArtPrefetching(
  downloadArtwork: boolean,
  generateCoverArtHashes: (paths: string[]) => Promise<[string, string | null][]>,
  applyCoverArtHashes: (hashes: [string, string | null][]) => void,
) {
  const prefetchedCoverArt = useRef<Set<string>>(new Set());
  const prefetchedCoverArtOrder = useRef<string[]>([]);

  const rememberPrefetchedCoverArt = useCallback((path: string) => {
    if (prefetchedCoverArt.current.has(path)) return;
    prefetchedCoverArt.current.add(path);
    prefetchedCoverArtOrder.current.push(path);
    while (prefetchedCoverArtOrder.current.length > PREFETCHED_COVER_ART_LIMIT) {
      const evicted = prefetchedCoverArtOrder.current.shift();
      if (evicted) {
        prefetchedCoverArt.current.delete(evicted);
      }
    }
  }, []);

  const prefetchCoverArt = useCallback(
    async (tracks: Track[]) => {
      if (!downloadArtwork) return;
      const targets = tracks
        .filter((t) => t.hasCoverArt !== false && !prefetchedCoverArt.current.has(t.filePath))
        .slice(0, 200);
      if (targets.length === 0) return;
      try {
        const hashed = await generateCoverArtHashes(targets.map((t) => t.filePath));
        applyCoverArtHashes(hashed);
        hashed.forEach(([path]) => rememberPrefetchedCoverArt(path));
      } catch (err) {
        console.error('Failed to prepare cover art:', err);
      }
    },
    [applyCoverArtHashes, downloadArtwork, generateCoverArtHashes, rememberPrefetchedCoverArt],
  );

  return {
    prefetchCoverArt,
  };
}
