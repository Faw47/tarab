import { useMemo } from 'react';
import { useCoverArt } from '../../hooks/useCoverArt';
import type { Track } from '../../types';

export function useAlbumOverviewModel(tracks: Track[], coverArt?: string) {
  const firstTrack = useMemo(() => tracks[0] ?? null, [tracks]);
  const coverFromTrack = useCoverArt(
    firstTrack?.filePath ?? '',
    firstTrack?.hasCoverArt ?? false,
    true,
    'large',
    firstTrack?.coverArtHash ?? undefined,
  );

  const totalDuration = useMemo(
    () => tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0),
    [tracks],
  );
  const releaseYear = useMemo(() => tracks.find((track) => track.year)?.year ?? null, [tracks]);

  return {
    firstTrack,
    coverFromTrack,
    resolvedCoverArt: coverArt ?? coverFromTrack ?? undefined,
    totalDuration,
    releaseYear,
  };
}
