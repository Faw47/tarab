import type { NavView } from '../../components/navigation';
import type { Track } from '../../types';

export interface AlbumDetailsState {
  album: string;
  artist: string;
  coverArt?: string;
  tracks: Track[];
}

export interface PlaylistRepairState {
  reason: string;
  attemptedRecovery: boolean;
  recoveredFrom?: string | null;
}

export type SetAlbumDetails = (details: AlbumDetailsState | null) => void;
export type SetCurrentView = (view: NavView) => void;
