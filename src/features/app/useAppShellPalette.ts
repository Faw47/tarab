import type { CSSProperties } from 'react';
import { useMemo } from 'react';
import { useCoverArt } from '../../hooks/useCoverArt';
import { useReactivePalette } from '../../hooks/useReactivePalette';
import type { Track } from '../../types';
import type { AlbumDetailsState } from './app-state-types';

interface AppShellPaletteOptions {
  currentTrack: Track | null;
  currentView: string;
  albumDetails: AlbumDetailsState | null;
}

export function useAppShellPalette({
  currentTrack,
  currentView,
  albumDetails,
}: AppShellPaletteOptions) {
  const isAlbumView = currentView === 'album' && albumDetails != null;
  const albumFirstTrack = albumDetails?.tracks[0] ?? null;

  const currentCoverArt = useCoverArt(
    currentTrack?.filePath,
    currentTrack?.hasCoverArt,
    true,
    'small',
    currentTrack?.coverArtHash,
  );

  const ambientTrack = isAlbumView ? albumFirstTrack : currentTrack;
  const homeAmbientCoverUrl = useCoverArt(
    ambientTrack?.filePath,
    ambientTrack?.hasCoverArt,
    true,
    'large',
    ambientTrack?.coverArtHash,
  );

  const albumPaletteCoverArt = useCoverArt(
    albumFirstTrack?.filePath,
    albumFirstTrack?.hasCoverArt,
    true,
    'small',
    albumFirstTrack?.coverArtHash,
  );

  const paletteTrack = isAlbumView ? albumFirstTrack : currentTrack;
  const paletteCoverArt = isAlbumView ? albumPaletteCoverArt : currentCoverArt;
  const palette = useReactivePalette({
    filePath: paletteTrack?.filePath,
    coverArtUrl: paletteCoverArt,
  });

  const shellVars = useMemo(
    () =>
      ({
        '--shell-blob-a': palette.shellBlobA,
        '--shell-blob-b': palette.shellBlobB,
        '--shell-blob-c': palette.liquidColors.b3,
        '--hero-accent': palette.heroAccent,
        '--hero-accent-rgb': palette.primaryRgb.replace(/,/g, ''),
        '--hero-glow': palette.heroGlow,
        '--surface-tint': palette.surfaceTint,
        '--text-contrast-bias': palette.textContrastBias,
        '--signal-play': palette.heroAccent,
        '--ring': palette.heroAccent,
        '--color-primary': palette.heroAccent,
        '--color-accent': palette.secondaryAccent,
      }) as CSSProperties,
    [palette],
  );

  return { isAlbumView, homeAmbientCoverUrl, palette, shellVars };
}
