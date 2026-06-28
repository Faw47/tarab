import type { DragEvent, ReactNode, RefObject, UIEventHandler } from 'react';
import type { SortBy, Track } from '../../types';
import type {
  AlbumGroup,
  ArtistGroup,
  FacetCounts,
  LibraryDetailScope,
  LibraryFacet,
} from './library-view-model';

export type LibraryViewDensity = 'grid' | 'list';

export interface FacetItem {
  id: LibraryFacet;
  label: string;
  subtitle: string;
  count: number;
}

export interface CommandDeckProps {
  facets: FacetItem[];
  onFacetChange: (facet: LibraryFacet) => void;
  activeFacet: LibraryFacet;
  isScrolled: boolean;
  selectedCount: number;
  viewMode: LibraryViewDensity;
  onViewModeChange: (mode: LibraryViewDensity) => void;
  sortBy: SortBy;
  onSortByChange: (sortBy: SortBy) => void;
  onEditSelected: () => void;
}

export interface DetailFocusHeaderProps {
  detailScope: Exclude<LibraryDetailScope, null>;
  trackCount: number;
  onBack: () => void;
  onPlayAll: () => void;
  isScrolled: boolean;
  viewMode: LibraryViewDensity;
  onViewModeChange: (mode: LibraryViewDensity) => void;
}

export interface SelectionBarProps {
  selectedCount: number;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  isNeo?: boolean;
}

export interface ResultsOrchestratorProps {
  activeFacet: LibraryFacet;
  viewMode: LibraryViewDensity;
  searchQuery: string;
  groupedData: Track[] | AlbumGroup[] | ArtistGroup[];
  activeTrackId: string | null;
  isPlaying: boolean;
  selectedTrackIds: string[];
  onPlayTrack: (track: Track) => void;
  onPlayAlbum: (track: Track) => void;
  onTrackSelect?: (track: Track, isMulti: boolean) => void;
  onTrackContextMenu?: (track: Track, position: { x: number; y: number }) => void;
  onShowFileInfo: (trackId: string) => void;
  onAlbumOpen: (track: Track) => void;
  onArtistOpen: (artist: string) => void;
  onDragStart: (event: DragEvent, track: Track) => void;
  onRangeChange: (tracks: Track[], start: number, end: number) => void;
  onTrackGridRangeChange: (tracks: Track[], start: number, end: number) => void;
  onAlbumGridRangeChange: (albums: AlbumGroup[], start: number, end: number) => void;
  onArtistGridRangeChange: (artists: ArtistGroup[], start: number, end: number) => void;
  onLoadMore?: () => void;
  hasMore: boolean;
  formatSize: (size?: number) => string;
  getFormatLabel: (track: Track) => string;
  isLyricsMatch: (id: string) => boolean;
  getLyricsMatchLine: (id: string) => string | null;
  isNeo?: boolean;
}

export interface LibraryShellProps {
  isScrolled: boolean;
  onScroll: UIEventHandler<HTMLDivElement>;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  isNeo?: boolean;
}

export interface LibraryViewModelSnapshot {
  counts: FacetCounts;
  activeResultCount: number;
}
