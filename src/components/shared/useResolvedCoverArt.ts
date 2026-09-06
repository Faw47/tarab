import { useCallback, useEffect, useRef, useState } from 'react';
import { getCoverArtBlobFallback } from '../../hooks/useCoverArt';
import { reportError } from '../../lib/report-error';
import type { Track } from '../../types';

export function useResolvedCoverArt(src: string | undefined, track: Track | null) {
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(src);
  const [error, setError] = useState(false);
  const resolvedSrcRef = useRef(resolvedSrc);
  const requestIdRef = useRef(0);

  useEffect(() => {
    resolvedSrcRef.current = resolvedSrc;
  }, [resolvedSrc]);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    resolvedSrcRef.current = src;
    setResolvedSrc(src);
    setError(false);

    return () => {
      if (requestIdRef.current === requestId) requestIdRef.current += 1;
    };
  }, [src, track?.id, track?.coverArtHash]);

  const handleError = useCallback(async () => {
    const requestId = requestIdRef.current;
    if (resolvedSrcRef.current?.startsWith('cover-art://') && track?.coverArtHash) {
      try {
        const blobUrl = await getCoverArtBlobFallback(track.coverArtHash, 'large');
        if (requestId !== requestIdRef.current) return;
        if (blobUrl) {
          resolvedSrcRef.current = blobUrl;
          setResolvedSrc(blobUrl);
          return;
        }
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        reportError('Failed to load thumbnail via IPC', {
          source: 'album-details-overlay',
          error: err,
        });
      }
    }
    if (requestId === requestIdRef.current) setError(true);
  }, [track]);

  return { resolvedSrc, error, handleError };
}
