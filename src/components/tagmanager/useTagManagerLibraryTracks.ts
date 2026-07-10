import { useEffect, useState } from 'react';
import { fetchLibraryTracksPage } from '../../features/library/api';
import { useLibraryData } from '../../features/library/useLibraryData';
import { reportError } from '../../lib/report-error';
import type { Track } from '../../types';

const PAGE_SIZE = 500;

export interface TagManagerLibraryTracksState {
  tracks: Track[];
  loadedCount: number;
  totalCount: number;
  isHydrating: boolean;
}

export function useTagManagerLibraryTracks(): TagManagerLibraryTracksState {
  const { trackCount, tracks: loadedTracks } = useLibraryData();
  const [allTracks, setAllTracks] = useState<Track[]>(loadedTracks);
  const [isHydrating, setIsHydrating] = useState(false);

  useEffect(() => {
    setAllTracks((current) => (current.length > loadedTracks.length ? current : loadedTracks));
  }, [loadedTracks]);

  useEffect(() => {
    if (loadedTracks.length >= trackCount) {
      setIsHydrating(false);
      return;
    }

    let cancelled = false;
    setIsHydrating(true);

    async function loadRemainingTracks() {
      const pages: Track[] = [];
      try {
        for (let offset = loadedTracks.length; offset < trackCount; offset += PAGE_SIZE) {
          const page = await fetchLibraryTracksPage({
            offset,
            limit: PAGE_SIZE,
            sortBy: 'dateAdded',
            sortOrder: 'desc',
          });
          if (cancelled || page.length === 0) return;
          pages.push(...page);
          setAllTracks([...loadedTracks, ...pages]);
          if (page.length < PAGE_SIZE) return;
        }
      } catch (error) {
        reportError('Failed to load full library for tag manager', {
          source: 'tag-manager',
          error,
        });
      } finally {
        if (!cancelled) setIsHydrating(false);
      }
    }

    void loadRemainingTracks();

    return () => {
      cancelled = true;
    };
  }, [loadedTracks, trackCount]);

  return {
    tracks: allTracks,
    loadedCount: Math.min(allTracks.length, trackCount),
    totalCount: trackCount,
    isHydrating,
  };
}
