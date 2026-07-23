import * as Tabs from '@radix-ui/react-tabs';
import { ChevronDown, Clock3, Edit2, Grid, List, SortAsc, TrendingUp } from 'lucide-react';
import type {
  ComponentType,
  DragEvent,
  ReactNode,
  PointerEvent as ReactPointerEvent,
  RefObject,
  UIEvent,
  UIEventHandler,
} from 'react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useLiquidControlMotionHorizontal } from '@/hooks/use-liquid-control-motion';
import {
  applyHorizontalPillDom,
  useLiquidSegmentedPillHorizontal,
} from '@/hooks/use-liquid-segmented-pill';
import { cn } from '@/lib/utils';
import { fetchLibraryTracksPage } from '../../features/library/api';
import { useLibraryData } from '../../features/library/useLibraryData';
import { prefetchCoverArtBatch } from '../../hooks/useCoverArt';
import { getAlbumArtist } from '../../lib/album-key';
import { useRenderLog } from '../../lib/performance';
import { startPlayback } from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import { generateCoverArtHashes } from '../../lib/tauri-commands';
import { sortAlbumTracks } from '../../lib/track-order';
import type { LibrarySearchScope } from '../../store/library-store';
import { usePlayerStore } from '../../store/player-store';
import { useSettingsStore } from '../../store/settings-store';
import type { ContextMenuPosition, SortBy, Track } from '../../types';
import { VirtualizedGrid } from '../shared/VirtualizedGrid';
import { AlbumIcon, ArtistIcon, TrackIcon } from '../ui/Icons';

import { LibraryDetailFocusHeader } from './LibraryDetailFocusHeader';
import { LibraryFileInfoModal } from './LibraryFileInfoModal';
import { LibraryNeoLayout } from './LibraryNeoLayout';
import { LibraryResultsOrchestrator } from './LibraryResultsOrchestrator';
import { LibrarySelectionBar } from './LibrarySelectionBar';
import './library-view.css';

// ============================================================================
// Types & Interfaces
// ============================================================================

import {
  type AlbumGroup,
  type ArtistGroup,
  applySmartFilter,
  buildDetailTracks,
  buildFacetCounts,
  buildFacetPayload,
  type FacetCounts,
  type LibraryDetailScope,
  type LibraryFacet,
  type LibrarySmartFilter,
} from './library-view-model';

export type LibraryViewDensity = 'grid' | 'list';

export interface FacetItem {
  id: LibraryFacet;
  label: string;
  subtitle: string;
  count: number;
}

export interface LibraryViewModelSnapshot {
  counts: FacetCounts;
  activeResultCount: number;
}

export interface LibraryViewProps {
  onTrackContextMenu?: (track: Track, position: ContextMenuPosition) => void;
  onTrackSelect?: (track: Track, isMulti: boolean) => void;
  selectedTrackIds?: string[];
  onOpenTagEditor?: (tracks: Track[]) => void;
  smartFilter?: LibrarySmartFilter;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  onOpenAlbumDetails?: (payload: {
    album: string;
    artist: string;
    coverArt?: string;
    tracks: Track[];
  }) => void;
  isLibraryLoading?: boolean;
  libraryError?: string | null;
  onRetryLoad?: () => void;
  onNavigateToFolders?: () => void;
  onScrollChange?: (isScrolled: boolean) => void;
  /** Liquid icon rail: nudge library chrome so the first glass edge does not stack on the rail seam. */
  iconRailLayout?: boolean;
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

export interface LibraryShellProps {
  isScrolled: boolean;
  onScroll: UIEventHandler<HTMLDivElement>;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  children: ReactNode;
  isNeo?: boolean;
  iconRailLayout?: boolean;
}

export type ArtistGroupItem = { artist: string; tracks: Track[]; coverArt?: string };
export interface LibraryArtistsGridProps {
  items: ArtistGroupItem[];
  onRangeChange: (start: number, end: number) => void;
  renderItem: (item: ArtistGroupItem, index: number) => ReactNode;
  onLoadMore?: () => void;
}

export type AlbumGroupItem = { track: Track; count: number };
export interface LibraryAlbumsGridProps {
  items: AlbumGroupItem[];
  onRangeChange: (start: number, end: number) => void;
  renderItem: (item: AlbumGroupItem, index: number) => ReactNode;
  onLoadMore?: () => void;
}

// ============================================================================
// Constants & View Model Helpers
// ============================================================================

const LIBRARY_V2_VIEW_MODE_KEY = 'library-v2-view-mode';
const ARTIST_ALBUM_GRID_MIN_COLUMN = 160;

const facetIcon = {
  albums: AlbumIcon,
  all: TrackIcon,
  artists: ArtistIcon,
  recent: Clock3,
  mostPlayed: TrendingUp,
} as const satisfies Record<LibraryFacet, ComponentType<{ className?: string }>>;

function getPersistedViewMode(): LibraryViewDensity {
  try {
    const value = localStorage.getItem(LIBRARY_V2_VIEW_MODE_KEY);
    if (value === 'grid' || value === 'list') {
      return value;
    }
  } catch {
    // no-op
  }
  return 'grid';
}

function persistViewMode(mode: LibraryViewDensity): void {
  try {
    localStorage.setItem(LIBRARY_V2_VIEW_MODE_KEY, mode);
  } catch {
    // no-op
  }
}

// ============================================================================
// Sub-Components
// ============================================================================

export const LibraryShell = memo(function LibraryShell({
  isScrolled,
  onScroll,
  scrollContainerRef,
  children,
  isNeo,
  iconRailLayout = false,
}: LibraryShellProps) {
  return (
    <div
      ref={scrollContainerRef}
      onScroll={onScroll}
      className={cn(
        'library-v2-root custom-scrollbar',
        isScrolled && 'is-scrolled',
        isNeo && 'library-neo-shell',
        iconRailLayout && !isNeo && 'library-v2-root--icon-rail',
      )}
    >
      <div className={cn('library-v2-content', isNeo && 'neo-layout-active')}>{children}</div>
    </div>
  );
});

export const LibraryCommandDeck = memo(function LibraryCommandDeck({
  facets,
  onFacetChange,
  activeFacet,
  isScrolled,
  selectedCount,
  viewMode,
  onViewModeChange,
  sortBy,
  onSortByChange,
  onEditSelected,
}: CommandDeckProps) {
  const tabsListRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const viewModeListRef = useRef<HTMLDivElement>(null);
  const viewModePillRef = useRef<HTMLDivElement>(null);
  const viewModeHoveringRef = useRef(false);
  const viewModePressingRef = useRef(false);

  const sortDropdownRef = useRef<HTMLDivElement>(null);
  const [showSortDropdown, setShowSortDropdown] = useState(false);

  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      if (
        showSortDropdown &&
        sortDropdownRef.current &&
        !sortDropdownRef.current.contains(e.target as Node)
      ) {
        setShowSortDropdown(false);
      }
    };
    window.addEventListener('click', handleGlobalClick);
    return () => window.removeEventListener('click', handleGlobalClick);
  }, [showSortDropdown]);

  const activeIndex = useMemo(
    () =>
      Math.max(
        0,
        facets.findIndex((f) => f.id === activeFacet),
      ),
    [facets, activeFacet],
  );

  const onCommitIndex = useCallback(
    (index: number) => {
      const facet = facets[index];
      if (facet) onFacetChange(facet.id);
    },
    [facets, onFacetChange],
  );

  const {
    pillStyle,
    isDragging,
    pillLayoutFromDom,
    dragPreviewIndex,
    pillGeometryRef,
    suppressNextTabClickRef,
    listProps,
  } = useLiquidSegmentedPillHorizontal({
    rootRef: tabsListRef,
    pillElementRef: pillRef,
    tabSelector: '[role="tab"]',
    activeIndex,
    onCommitIndex,
    syncDependencies: [activeFacet, facets],
  });

  const {
    pillStyle: vmPillStyle,
    isDragging: vmIsDragging,
    pillLayoutFromDom: vmPillLayoutFromDom,
    pillGeometryRef: vmPillGeometryRef,
    listProps: vmListProps,
  } = useLiquidSegmentedPillHorizontal({
    rootRef: viewModeListRef,
    pillElementRef: viewModePillRef,
    tabSelector: 'button',
    activeIndex: viewMode === 'grid' ? 0 : 1,
    onCommitIndex: (idx) => onViewModeChange(idx === 0 ? 'grid' : 'list'),
    syncDependencies: [viewMode],
  });

  const vmListPropsWrapped = useMemo(
    () => ({
      ...vmListProps,
      onPointerDownCapture: (e: ReactPointerEvent<HTMLElement>) => {
        viewModePressingRef.current = true;
        vmListProps.onPointerDownCapture(e);
      },
      onPointerUpCapture: (e: ReactPointerEvent<HTMLElement>) => {
        vmListProps.onPointerUpCapture(e);
        viewModePressingRef.current = false;
      },
      onPointerCancelCapture: (e: ReactPointerEvent<HTMLElement>) => {
        vmListProps.onPointerCancelCapture(e);
        viewModePressingRef.current = false;
      },
      onLostPointerCapture: (e: ReactPointerEvent<HTMLElement>) => {
        vmListProps.onLostPointerCapture(e);
        viewModePressingRef.current = false;
      },
    }),
    [vmListProps],
  );

  useLayoutEffect(() => {
    if (!pillLayoutFromDom) return;
    const el = pillRef.current;
    const g = pillGeometryRef.current;
    if (el && g) applyHorizontalPillDom(el, g.left, g.width);
  }, [pillLayoutFromDom, dragPreviewIndex, isDragging, pillGeometryRef]);

  useLayoutEffect(() => {
    if (!vmPillLayoutFromDom) return;
    const el = viewModePillRef.current;
    const g = vmPillGeometryRef.current;
    if (el && g) applyHorizontalPillDom(el, g.left, g.width);
  }, [vmPillLayoutFromDom, vmIsDragging, vmPillGeometryRef]);

  useLiquidControlMotionHorizontal({
    enabled: true,
    rootRef: viewModeListRef,
    pillStyle: vmPillStyle,
    pillLayoutFromDom: vmPillLayoutFromDom,
    pillGeometryRef: vmPillGeometryRef,
    isDragging: vmIsDragging,
    hoveringRef: viewModeHoveringRef,
    pressingRef: viewModePressingRef,
    activeIndex: viewMode === 'grid' ? 0 : 1,
  });

  return (
    <section className={cn('library-v2-command-deck', isScrolled && 'is-scrolled')}>
      <div className="library-v2-command-bottom">
        <Tabs.Root
          value={activeFacet}
          onValueChange={(value) => onFacetChange(value as LibraryFacet)}
          className="contents"
        >
          <Tabs.List
            ref={tabsListRef}
            className="library-v2-tablist"
            aria-label="Library facets"
            {...listProps}
          >
            <div
              ref={pillRef}
              className={cn(
                'library-v2-tabs-pill',
                (isDragging || pillLayoutFromDom) && 'is-dragging',
              )}
              style={
                pillLayoutFromDom
                  ? undefined
                  : {
                      left: pillStyle.left,
                      width: pillStyle.width,
                      opacity: pillStyle.opacity,
                    }
              }
            />
            {facets.map((facet, facetIndex) => {
              const Icon = facetIcon[facet.id];
              const isCommitted = facet.id === activeFacet;
              const isPreviewed = dragPreviewIndex === facetIndex;
              const isActive = dragPreviewIndex !== null ? isPreviewed : isCommitted;

              return (
                <Tabs.Trigger
                  key={facet.id}
                  value={facet.id}
                  id={`library-v2-facet-${facet.id}`}
                  type="button"
                  aria-selected={isActive}
                  className={cn('library-v2-tab', isActive && 'is-active')}
                  onClick={(e) => {
                    if (suppressNextTabClickRef.current) {
                      suppressNextTabClickRef.current = false;
                      e.preventDefault();
                      e.stopPropagation();
                    }
                  }}
                >
                  <span className="library-v2-tab-label">
                    <Icon className="library-v2-tab-icon h-3.5 w-3.5" />
                    {facet.label}
                  </span>
                  <span className="library-v2-tab-count">
                    {facet.count > 999 ? `${Math.floor(facet.count / 1000)}k` : facet.count}
                  </span>
                </Tabs.Trigger>
              );
            })}
          </Tabs.List>

          {facets.map((facet) => (
            <Tabs.Content key={facet.id} value={facet.id} hidden className="hidden" aria-hidden>
              <span className="sr-only">{facet.label}</span>
            </Tabs.Content>
          ))}
        </Tabs.Root>

        <div className="library-v2-toolbar">
          <div className="library-v2-tablist">
            <button
              type="button"
              className={cn('library-v2-tab is-icon-only', selectedCount > 0 && 'is-active')}
              onClick={onEditSelected}
              disabled={selectedCount === 0}
              title={selectedCount > 0 ? `Edit ${selectedCount} selected` : 'Edit tags'}
              aria-label={selectedCount > 0 ? `Edit ${selectedCount} selected` : 'Edit tags'}
            >
              <Edit2 className="library-v2-tab-icon h-4 w-4" />
            </button>
          </div>

          <div className="library-v2-tablist overflow-visible">
            <div className="library-v2-tab relative" ref={sortDropdownRef}>
              <button
                type="button"
                className="library-v2-tab-label cursor-pointer bg-transparent border-0 outline-none flex items-center gap-2"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowSortDropdown((v) => !v);
                }}
                aria-label="Sort library"
              >
                <SortAsc className="library-v2-tab-icon h-3.5 w-3.5" />
                <span className="text-[0.81rem] font-medium text-inherit opacity-70 hover:opacity-100 transition-opacity">
                  {sortBy === 'dateAdded'
                    ? 'Date added'
                    : sortBy === 'title'
                      ? 'Title'
                      : sortBy === 'artist'
                        ? 'Artist'
                        : 'Album'}
                </span>
                <ChevronDown className="w-3 h-3 opacity-50" />
              </button>

              {showSortDropdown && (
                <div className="library-v2-sort-dropdown">
                  {[
                    { id: 'dateAdded', label: 'Date added' },
                    { id: 'title', label: 'Title' },
                    { id: 'artist', label: 'Artist' },
                    { id: 'album', label: 'Album' },
                  ].map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => {
                        onSortByChange(option.id as CommandDeckProps['sortBy']);
                        setShowSortDropdown(false);
                      }}
                      className={cn(
                        'library-v2-sort-option',
                        sortBy === option.id && 'is-selected',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div
            ref={viewModeListRef}
            className="library-view-mode-selector"
            role="group"
            aria-label="View mode"
            onPointerEnter={() => {
              viewModeHoveringRef.current = true;
            }}
            onPointerLeave={() => {
              viewModeHoveringRef.current = false;
            }}
            {...vmListPropsWrapped}
          >
            <div
              ref={viewModePillRef}
              className={cn(
                'library-v2-tabs-pill',
                (vmIsDragging || vmPillLayoutFromDom) && 'is-dragging',
              )}
              style={
                vmPillLayoutFromDom
                  ? undefined
                  : {
                      left: vmPillStyle.left,
                      width: vmPillStyle.width,
                      opacity: vmPillStyle.opacity,
                    }
              }
            />
            <button
              type="button"
              className={cn('library-v2-tab is-icon-only', viewMode === 'grid' && 'is-active')}
              onClick={() => onViewModeChange('grid')}
              aria-label="Grid view"
            >
              <Grid className="library-v2-tab-icon h-4 w-4" />
            </button>
            <button
              type="button"
              className={cn('library-v2-tab is-icon-only', viewMode === 'list' && 'is-active')}
              onClick={() => onViewModeChange('list')}
              aria-label="List view"
            >
              <List className="library-v2-tab-icon h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
});

export const LibraryArtistsGrid = memo(function LibraryArtistsGrid({
  items,
  onRangeChange,
  renderItem,
  onLoadMore,
}: LibraryArtistsGridProps) {
  return (
    <VirtualizedGrid
      items={items}
      minColumnWidth={ARTIST_ALBUM_GRID_MIN_COLUMN}
      overscan={2}
      className="h-[70vh]"
      onRangeChange={onRangeChange}
      onScrollNearEnd={onLoadMore}
      renderItem={renderItem}
    />
  );
});

export const LibraryAlbumsGrid = memo(function LibraryAlbumsGrid({
  items,
  onRangeChange,
  renderItem,
  onLoadMore,
}: LibraryAlbumsGridProps) {
  return (
    <VirtualizedGrid
      items={items}
      minColumnWidth={ARTIST_ALBUM_GRID_MIN_COLUMN}
      overscan={2}
      className="h-[70vh]"
      onRangeChange={onRangeChange}
      onScrollNearEnd={onLoadMore}
      renderItem={renderItem}
    />
  );
});

// ============================================================================
// Main LibraryView Component
// ============================================================================

export const LibraryView = memo(function LibraryView({
  onTrackContextMenu,
  onTrackSelect,
  selectedTrackIds = [],
  onOpenTagEditor,
  smartFilter = null,
  onSelectAll,
  onClearSelection,
  onOpenAlbumDetails,
  isLibraryLoading = false,
  libraryError = null,
  onRetryLoad,
  onNavigateToFolders,
  onScrollChange,
  iconRailLayout = false,
}: LibraryViewProps) {
  useRenderLog('LibraryView');

  const coverUrlFromHash = useCallback(
    (hash?: string | null, size: 'small' | 'medium' | 'large' = 'medium') =>
      hash ? `cover-art://localhost/${hash}/${size}` : undefined,
    [],
  );

  const [viewMode, setViewMode] = useState<LibraryViewDensity>(getPersistedViewMode);
  const [activeFacet, setActiveFacet] = useState<LibraryFacet>('albums');
  const [detailScope, setDetailScopeState] = useState<LibraryDetailScope>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isScrolled, setIsScrolled] = useState(false);
  const [showFileInfo, setShowFileInfo] = useState<string | null>(null);
  const libraryScrollRef = useRef<HTMLDivElement | null>(null);
  const loadMoreThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    searchQuery,
    searchScope,
    setSearchScope,
    sortBy,
    setSortBy,
    getFilteredTracks,
    libraryStats,
    recentTracks = [],
    mostPlayedTracks = [],
    trackCount,
    tracks: allTracks,
    appendTracks,
    applyCoverArtHashes,
    isLyricsMatch,
    getLyricsMatchLine,
  } = useLibraryData({ includeLibraryShelves: true });

  const { downloadArtwork, theme } = useSettingsStore(
    useShallow((state) => ({
      downloadArtwork: state.downloadArtwork,
      theme: state.theme,
    })),
  );

  const isNeo = theme === 'neobrutalism';

  const { activeTrackId, isPlaying } = usePlayerStore(
    useShallow((state) => ({
      activeTrackId: state.currentTrack?.id,
      isPlaying: state.isPlaying,
    })),
  );

  useEffect(() => {
    if (searchQuery.trim()) {
      setActiveFacet('all');
    }
  }, [searchQuery]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handlePopState = () => {
      setDetailScopeState((current) => {
        if (current) {
          return null;
        }

        return current;
      });
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const setDetailScope = useCallback((next: LibraryDetailScope) => {
    if (typeof window !== 'undefined' && next) {
      window.history.pushState({ libraryDetailV2: true }, '');
    }

    setDetailScopeState(next);
  }, []);

  const handleViewModeChange = useCallback((next: LibraryViewDensity) => {
    const apply = () => {
      setViewMode(next);
      persistViewMode(next);
    };

    if (typeof document !== 'undefined' && 'startViewTransition' in document) {
      (
        document as Document & {
          startViewTransition: (callback: () => void) => void;
        }
      ).startViewTransition(apply);
      return;
    }

    apply();
  }, []);

  const filteredTracks = getFilteredTracks();

  const visibleTracks = useMemo(
    () => applySmartFilter(filteredTracks, smartFilter),
    [filteredTracks, smartFilter],
  );

  const detailTracks = useMemo(
    () => buildDetailTracks(allTracks, detailScope),
    [allTracks, detailScope],
  );

  const usesFullLibraryFacetData = searchQuery.trim().length === 0 && smartFilter === null;

  const facetCounts = useMemo(() => {
    const counts = buildFacetCounts(visibleTracks);
    if (!usesFullLibraryFacetData) return counts;

    return {
      ...counts,
      all: trackCount,
      albums: libraryStats?.albumCount ?? counts.albums,
      artists: libraryStats?.artistCount ?? counts.artists,
      recent: recentTracks.length,
      mostPlayed: mostPlayedTracks.length,
      duration: libraryStats?.totalDuration ?? counts.duration,
    } satisfies FacetCounts;
  }, [
    libraryStats,
    mostPlayedTracks.length,
    recentTracks.length,
    trackCount,
    usesFullLibraryFacetData,
    visibleTracks,
  ]);

  const facetTracks = useMemo(() => {
    if (!usesFullLibraryFacetData) return visibleTracks;
    if (activeFacet === 'recent') return recentTracks;
    if (activeFacet === 'mostPlayed') return mostPlayedTracks;
    return visibleTracks;
  }, [activeFacet, mostPlayedTracks, recentTracks, usesFullLibraryFacetData, visibleTracks]);

  const groupedData = useMemo(
    () => buildFacetPayload(activeFacet, facetTracks, coverUrlFromHash),
    [activeFacet, coverUrlFromHash, facetTracks],
  );

  const resultFacet: LibraryFacet = detailScope ? 'all' : activeFacet;
  const resultRows = detailScope ? detailTracks : groupedData;
  const resultLength = resultRows.length;

  const facets = useMemo(
    () => [
      {
        id: 'albums' as const,
        label: 'Albums',
        subtitle: 'Collection groups',
        count: facetCounts.albums,
      },
      {
        id: 'all' as const,
        label: 'Songs',
        subtitle: 'Track-level browsing',
        count: facetCounts.all,
      },
      {
        id: 'artists' as const,
        label: 'Artists',
        subtitle: 'Artist clusters',
        count: facetCounts.artists,
      },
      {
        id: 'recent' as const,
        label: 'Recent',
        subtitle: 'Latest additions',
        count: facetCounts.recent,
      },
      {
        id: 'mostPlayed' as const,
        label: 'Most Played',
        subtitle: 'By play count',
        count: facetCounts.mostPlayed,
      },
    ],
    [facetCounts],
  );

  const selectedTrackSet = useMemo(() => new Set(selectedTrackIds), [selectedTrackIds]);
  const selectedTracks = useMemo(
    () => allTracks.filter((track) => selectedTrackSet.has(track.id)),
    [allTracks, selectedTrackSet],
  );

  const prefetchedCoverArt = useRef<Set<string>>(new Set());

  const prefetchCoverArt = useCallback(
    async (tracks: Track[]) => {
      if (!downloadArtwork) {
        return;
      }

      const targets = tracks
        .filter(
          (track) =>
            track.hasCoverArt !== false &&
            !track.coverArtHash &&
            !prefetchedCoverArt.current.has(track.filePath),
        )
        .slice(0, 200);

      if (targets.length === 0) {
        return;
      }

      try {
        const hashes = await generateCoverArtHashes(targets.map((track) => track.filePath));
        applyCoverArtHashes(hashes);
        hashes.forEach(([path]) => prefetchedCoverArt.current.add(path));
      } catch (error) {
        reportError('Failed to precompute cover art', {
          source: 'library-view',
          error,
        });
      }
    },
    [applyCoverArtHashes, downloadArtwork],
  );

  const loadedCount = allTracks.length;

  useEffect(() => {
    setHasMore(loadedCount < trackCount);
  }, [loadedCount, trackCount]);

  const handleLoadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) {
      return;
    }

    setIsLoadingMore(true);

    try {
      const offset = loadedCount;
      const limit = 300;

      if (offset >= trackCount) {
        setHasMore(false);
        return;
      }

      const nextTracks = await fetchLibraryTracksPage({
        offset,
        limit,
        sortBy: 'dateAdded',
        sortOrder: 'desc',
      });

      appendTracks(nextTracks);
      prefetchCoverArt(nextTracks);

      if (offset + nextTracks.length >= trackCount || nextTracks.length < limit) {
        setHasMore(false);
      }
    } catch (error) {
      reportError('Failed to load more tracks', {
        source: 'library-view',
        error,
      });
    } finally {
      setIsLoadingMore(false);
    }
  }, [appendTracks, hasMore, isLoadingMore, loadedCount, prefetchCoverArt, trackCount]);

  const triggerLoadMoreThrottled = useCallback(() => {
    if (loadMoreThrottleRef.current) {
      return;
    }

    void handleLoadMore();
    loadMoreThrottleRef.current = setTimeout(() => {
      loadMoreThrottleRef.current = null;
    }, 400);
  }, [handleLoadMore]);

  const checkLoadMoreFromContainer = useCallback(
    (container: HTMLDivElement) => {
      if (!hasMore) {
        return;
      }

      const { scrollTop, clientHeight, scrollHeight } = container;
      if (scrollHeight <= 0) {
        return;
      }

      if (scrollTop + clientHeight >= 0.9 * scrollHeight) {
        triggerLoadMoreThrottled();
      }
    },
    [hasMore, triggerLoadMoreThrottled],
  );

  const handleLibraryScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const container = event.currentTarget;
      setIsScrolled(container.scrollTop > 8);
      if (!isNeo) {
        checkLoadMoreFromContainer(container);
      }
    },
    [checkLoadMoreFromContainer, isNeo],
  );

  useEffect(() => {
    if (isNeo) {
      return;
    }

    const container = libraryScrollRef.current;
    if (!container) {
      return;
    }

    setIsScrolled(container.scrollTop > 8);
    checkLoadMoreFromContainer(container);
  }, [checkLoadMoreFromContainer, isNeo, resultLength]);

  useEffect(() => {
    onScrollChange?.(isScrolled);
  }, [isScrolled, onScrollChange]);

  useEffect(
    () => () => {
      if (loadMoreThrottleRef.current) {
        clearTimeout(loadMoreThrottleRef.current);
        loadMoreThrottleRef.current = null;
      }
    },
    [],
  );

  const handlePlayTrack = useCallback(
    async (track: Track) => {
      try {
        const queue = detailScope ? detailTracks : visibleTracks;
        const queueIndex = queue.findIndex((entry) => entry.id === track.id);

        await startPlayback(track, {
          queue,
          queueIndex: queueIndex >= 0 ? queueIndex : 0,
        });
      } catch (error) {
        reportError('Failed to play track', {
          source: 'library-view',
          error,
        });
      }
    },
    [detailScope, detailTracks, visibleTracks],
  );

  const handlePlayAlbum = useCallback(
    async (track: Track) => {
      try {
        const albumArtist = getAlbumArtist(track);
        const albumTracks = sortAlbumTracks(
          allTracks.filter(
            (entry) => entry.album === track.album && getAlbumArtist(entry) === albumArtist,
          ),
        );
        if (albumTracks.length === 0) return;

        await startPlayback(albumTracks[0], {
          queue: albumTracks,
          queueIndex: 0,
          shuffleEnabled: false,
        });
      } catch (error) {
        reportError('Failed to play album', {
          source: 'library-view',
          error,
        });
      }
    },
    [allTracks],
  );

  const handleAlbumOpen = useCallback(
    (track: Track) => {
      const albumArtist = getAlbumArtist(track);
      const albumTracks = allTracks.filter(
        (entry) => entry.album === track.album && getAlbumArtist(entry) === albumArtist,
      );

      const coverArt =
        track.coverArt ??
        (track.coverArtHash ? `cover-art://localhost/${track.coverArtHash}/large` : undefined);

      if (onOpenAlbumDetails) {
        onOpenAlbumDetails({
          album: track.album,
          artist: albumArtist,
          coverArt,
          tracks: albumTracks,
        });
        return;
      }

      setDetailScope({ type: 'album', album: track.album, artist: albumArtist });
    },
    [allTracks, onOpenAlbumDetails, setDetailScope],
  );

  const handleArtistOpen = useCallback(
    (artist: string) => {
      setDetailScope({ type: 'artist', artist });
    },
    [setDetailScope],
  );

  const handleBackFromDetail = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.history.back();
    }
  }, []);

  const handleDragStart = useCallback(
    (event: DragEvent, track: Track) => {
      const ids = selectedTrackSet.size > 0 ? Array.from(selectedTrackSet) : [track.id];
      try {
        event.dataTransfer?.setData('application/json', JSON.stringify({ type: 'tracks', ids }));
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'copyMove';
        }
      } catch {
        // ignore
      }
    },
    [selectedTrackSet],
  );

  const handleRangeChange = useCallback((tracks: Track[], start: number, end: number) => {
    const preload = tracks.slice(start, Math.min(tracks.length, end + 8));
    if (preload.length === 0) return;

    prefetchCoverArtBatch(
      preload.map((track) => ({
        filePath: track.filePath,
        coverArtHash: track.coverArtHash,
        hasCoverArt: track.hasCoverArt,
      })),
      'small',
    );
  }, []);

  const handleTrackGridRangeChange = useCallback((tracks: Track[], start: number, end: number) => {
    const preload = tracks.slice(start, Math.min(tracks.length, end + 14));
    if (preload.length === 0) return;

    prefetchCoverArtBatch(
      preload.map((track) => ({
        filePath: track.filePath,
        coverArtHash: track.coverArtHash,
        hasCoverArt: track.hasCoverArt,
      })),
      'small',
    );
  }, []);

  const handleAlbumGridRangeChange = useCallback(
    (albums: AlbumGroup[], start: number, end: number) => {
      const preload = albums.slice(start, Math.min(albums.length, end + 10));
      if (preload.length === 0) return;

      prefetchCoverArtBatch(
        preload.map(({ track }) => ({
          filePath: track.filePath,
          coverArtHash: track.coverArtHash,
          hasCoverArt: track.hasCoverArt,
        })),
        'small',
      );
    },
    [],
  );

  const handleArtistGridRangeChange = useCallback(
    (artists: ArtistGroup[], start: number, end: number) => {
      const preload = artists.slice(start, Math.min(artists.length, end + 10));
      if (preload.length === 0) return;

      prefetchCoverArtBatch(
        preload
          .map((artist) => artist.tracks[0])
          .filter((track): track is Track => Boolean(track))
          .map((track) => ({
            filePath: track.filePath,
            coverArtHash: track.coverArtHash,
            hasCoverArt: track.hasCoverArt,
          })),
        'small',
      );
    },
    [],
  );

  const formatSize = useCallback((size?: number) => {
    if (!size) return '-';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = size;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
      value /= 1024;
      index += 1;
    }
    return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }, []);

  const getFormatLabel = useCallback((track: Track) => {
    if (track.fileFormat) {
      return track.fileFormat.toUpperCase();
    }

    const ext = track.filePath.split('.').pop();
    return ext ? ext.toUpperCase() : 'FILE';
  }, []);

  const getScopeLabel = useCallback((scope: LibrarySearchScope): string => {
    switch (scope) {
      case 'tracks':
        return 'tracks';
      case 'albums':
        return 'albums';
      case 'artists':
        return 'artists';
      case 'lyrics':
        return 'lyrics';
      default:
        return 'library';
    }
  }, []);

  const resultSectionLabel = detailScope
    ? detailScope.type === 'album'
      ? 'Tracks'
      : 'Artist tracks'
    : resultFacet === 'albums'
      ? 'Albums'
      : resultFacet === 'artists'
        ? 'Artists'
        : resultFacet === 'recent'
          ? 'Recently added'
          : resultFacet === 'mostPlayed'
            ? 'Most played'
            : 'Songs';

  const resultSectionCount = detailScope
    ? detailTracks.length
    : resultFacet === 'albums'
      ? facetCounts.albums
      : resultFacet === 'artists'
        ? facetCounts.artists
        : resultLength;

  const trimmedSearchQuery = searchQuery.trim();
  const needsLongerLyricsQuery =
    searchScope === 'lyrics' && trimmedSearchQuery.length > 0 && trimmedSearchQuery.length < 3;
  const isTrueEmptyLibrary = trimmedSearchQuery.length === 0 && trackCount === 0;

  if (isLibraryLoading) {
    return (
      <div className="library-v2-state-wrap">
        <div className="library-v2-loading-shell" role="status" aria-label="Loading library">
          <div className="library-v2-loading-line" />
          <div className="library-v2-loading-line" />
          <div className="library-v2-loading-line" />
        </div>
      </div>
    );
  }

  if (libraryError) {
    return (
      <div className="library-v2-state-wrap">
        <div className="library-v2-error-shell">
          <h2>Could not load library</h2>
          <p>{libraryError}</p>
          {onRetryLoad && (
            <button type="button" onClick={onRetryLoad}>
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  const resolvedModalTrack = showFileInfo
    ? (allTracks.find((track) => track.id === showFileInfo) ?? null)
    : null;

  return (
    <LibraryShell
      isScrolled={isScrolled}
      onScroll={handleLibraryScroll}
      scrollContainerRef={libraryScrollRef}
      isNeo={isNeo}
      iconRailLayout={iconRailLayout}
    >
      {isNeo ? (
        <LibraryNeoLayout
          activeFacet={resultFacet}
          viewMode={viewMode}
          groupedData={resultRows}
          activeTrackId={activeTrackId ?? null}
          isPlaying={isPlaying}
          selectedTrackIds={selectedTrackIds}
          onPlayTrack={(track) => void handlePlayTrack(track)}
          onPlayAlbum={(track) => void handlePlayAlbum(track)}
          onTrackSelect={onTrackSelect}
          onTrackContextMenu={onTrackContextMenu}
          onShowFileInfo={setShowFileInfo}
          onAlbumOpen={handleAlbumOpen}
          onArtistOpen={handleArtistOpen}
          onDragStart={handleDragStart}
          onRangeChange={handleRangeChange}
          onTrackGridRangeChange={handleTrackGridRangeChange}
          onAlbumGridRangeChange={handleAlbumGridRangeChange}
          onArtistGridRangeChange={handleArtistGridRangeChange}
          onLoadMore={handleLoadMore}
          hasMore={hasMore}
          formatSize={formatSize}
          getFormatLabel={getFormatLabel}
          isLyricsMatch={isLyricsMatch}
          getLyricsMatchLine={getLyricsMatchLine}
          facets={facets}
          onFacetChange={setActiveFacet}
          selectedCount={selectedTrackSet.size}
          onViewModeChange={handleViewModeChange}
          sortBy={sortBy}
          onSortByChange={(next: SortBy) => setSortBy(next)}
          onEditSelected={() => onOpenTagEditor?.(selectedTracks)}
          searchQuery={searchQuery}
          searchScope={searchScope}
          onSearchScopeChange={setSearchScope}
          facetCounts={facetCounts}
          onSelectAll={onSelectAll}
          onClearSelection={onClearSelection}
          detailScope={detailScope}
          onBackFromDetail={handleBackFromDetail}
        />
      ) : (
        <div className="library-v2-page">
          {detailScope ? (
            <LibraryDetailFocusHeader
              detailScope={detailScope}
              trackCount={detailTracks.length}
              onBack={handleBackFromDetail}
              onPlayAll={() => {
                if (detailTracks.length > 0) {
                  void handlePlayTrack(detailTracks[0]);
                }
              }}
              isScrolled={isScrolled}
              viewMode={viewMode}
              onViewModeChange={handleViewModeChange}
            />
          ) : (
            <LibraryCommandDeck
              facets={facets}
              onFacetChange={setActiveFacet}
              activeFacet={activeFacet}
              isScrolled={isScrolled}
              selectedCount={selectedTrackSet.size}
              viewMode={viewMode}
              onViewModeChange={handleViewModeChange}
              sortBy={sortBy}
              onSortByChange={(next: SortBy) => setSortBy(next)}
              onEditSelected={() => onOpenTagEditor?.(selectedTracks)}
            />
          )}

          <section
            className="library-v2-results-pane"
            id="library-v2-panel"
            role="tabpanel"
            aria-labelledby={detailScope ? undefined : `library-v2-facet-${activeFacet}`}
          >
            <LibrarySelectionBar
              selectedCount={selectedTrackSet.size}
              onSelectAll={onSelectAll}
              onClearSelection={onClearSelection}
            />

            <div className="library-v2-section-label">
              <span className="library-v2-section-label-text">{resultSectionLabel}</span>
              <span className="library-v2-section-label-count">{resultSectionCount}</span>
            </div>

            {resultLength > 0 ? (
              <LibraryResultsOrchestrator
                activeFacet={resultFacet}
                viewMode={viewMode}
                searchQuery={searchQuery}
                groupedData={resultRows}
                activeTrackId={activeTrackId ?? null}
                isPlaying={isPlaying}
                selectedTrackIds={selectedTrackIds}
                onPlayTrack={(track) => void handlePlayTrack(track)}
                onPlayAlbum={(track) => void handlePlayAlbum(track)}
                onTrackSelect={onTrackSelect}
                onTrackContextMenu={onTrackContextMenu}
                onShowFileInfo={setShowFileInfo}
                onAlbumOpen={handleAlbumOpen}
                onArtistOpen={handleArtistOpen}
                onDragStart={handleDragStart}
                onRangeChange={handleRangeChange}
                onTrackGridRangeChange={handleTrackGridRangeChange}
                onAlbumGridRangeChange={handleAlbumGridRangeChange}
                onArtistGridRangeChange={handleArtistGridRangeChange}
                onLoadMore={handleLoadMore}
                hasMore={hasMore}
                formatSize={formatSize}
                getFormatLabel={getFormatLabel}
                isLyricsMatch={isLyricsMatch}
                getLyricsMatchLine={getLyricsMatchLine}
              />
            ) : (
              <div className="library-v2-empty-wrap">
                <div className="library-v2-empty-icon" aria-hidden="true">
                  <TrackIcon className="h-10 w-10 text-primary" />
                </div>
                <div className="library-v2-empty-copy">
                  <h3>{isTrueEmptyLibrary ? 'No music yet' : 'No tracks found'}</h3>
                  <p>
                    {searchQuery
                      ? needsLongerLyricsQuery
                        ? 'Type at least 3 characters to search lyrics.'
                        : `No ${getScopeLabel(searchScope)} match "${searchQuery}". Try a different search term.`
                      : 'Your library is empty. Add folders to start building your music collection.'}
                  </p>
                  {isTrueEmptyLibrary && onNavigateToFolders && (
                    <button
                      type="button"
                      className="library-v2-empty-action"
                      onClick={onNavigateToFolders}
                    >
                      Add Folders
                    </button>
                  )}
                </div>
              </div>
            )}

            {isLoadingMore && (
              <div className="library-v2-loading-more" role="status" aria-live="polite">
                Loading more...
              </div>
            )}
          </section>
        </div>
      )}

      {resolvedModalTrack && (
        <LibraryFileInfoModal
          track={resolvedModalTrack}
          isOpen={true}
          onClose={() => setShowFileInfo(null)}
          onEditTags={(track) => onOpenTagEditor?.([track])}
          formatSize={formatSize}
          getFormatLabel={getFormatLabel}
        />
      )}
    </LibraryShell>
  );
});
