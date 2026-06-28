import type { Track } from '../../types';

export interface HomeViewProps {
  onNavigateToLibrary: () => void;
  onNavigateToFolders: () => void;
  onNavigateToQueue?: () => void;
  onOpenAlbumDetails?: (payload: {
    album: string;
    artist: string;
    coverArt?: string;
    tracks: Track[];
  }) => void;
  onOpenFullPlayer?: () => void;
  isLibraryLoading?: boolean;
  libraryError?: string | null;
  onRetryLoad?: () => void;
  onScrollChange?: (scrolled: boolean) => void;
}

export interface HomeAlbum {
  key: string;
  track: Track;
  count: number;
  tracks: Track[];
}

export interface HomeStats {
  totalTracks: number;
  totalHours: number;
  uniqueArtists: number;
  albumCount: number;
}
