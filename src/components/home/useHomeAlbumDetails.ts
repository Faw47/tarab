import { useCallback, useEffect, useRef } from 'react';
import { reportError } from '../../lib/report-error';
import type { HomeAlbumDetails } from './homeTypes';
import { fetchCompleteAlbumTracks } from './useHomeLibraryModel';

export function useHomeAlbumDetailsLoader(
  onOpenAlbumDetails: ((payload: HomeAlbumDetails) => void) | undefined,
  source: string,
) {
  const requestIdRef = useRef(0);

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
    };
  }, [onOpenAlbumDetails, source]);

  return useCallback(
    async (payload: HomeAlbumDetails) => {
      if (!onOpenAlbumDetails) return;

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      try {
        const albumTracks = await fetchCompleteAlbumTracks(payload.album, payload.artist);
        if (requestId !== requestIdRef.current) return;
        if (albumTracks.length === 0) throw new Error('The album is no longer available.');

        onOpenAlbumDetails({ ...payload, tracks: albumTracks });
      } catch (error) {
        if (requestId === requestIdRef.current) {
          reportError('Failed to open album', { source, error });
        }
      }
    },
    [onOpenAlbumDetails, source],
  );
}
