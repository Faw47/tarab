import {
  ChevronDown,
  ChevronLeft,
  Clock3,
  Disc3,
  LayoutGrid,
  List,
  type LucideIcon,
  Music2,
  TrendingUp,
  User,
} from 'lucide-react';
import { memo, type UIEvent, useCallback, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { LibrarySearchScope } from '../../store/library-store';
import type { SortBy } from '../../types';
import { NeoSectionHeader } from '../ui/NeoSectionHeader';
import { LibraryResultsOrchestrator } from './LibraryResultsOrchestrator';
import { LibrarySelectionBar } from './LibrarySelectionBar';
import {
  type FacetCounts,
  formatLongDuration,
  type LibraryDetailScope,
  type LibraryFacet,
} from './library-view-model';
import type { FacetItem, LibraryViewDensity, ResultsOrchestratorProps } from './library-view-types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type DetailProps =
  | { detailScope: LibraryDetailScope; onBackFromDetail: () => void }
  | { detailScope?: undefined; onBackFromDetail?: undefined };

interface LibraryNeoLayoutBaseProps extends ResultsOrchestratorProps {
  facets: FacetItem[];
  onFacetChange: (facet: LibraryFacet) => void;
  activeFacet: LibraryFacet;
  selectedCount: number;
  viewMode: LibraryViewDensity;
  onViewModeChange: (mode: LibraryViewDensity) => void;
  sortBy: SortBy;
  onSortByChange: (sortBy: SortBy) => void;
  searchQuery: string;
  facetCounts: FacetCounts;
  onEditSelected?: () => void;
  searchScope?: LibrarySearchScope;
  onSearchScopeChange?: (scope: LibrarySearchScope) => void;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
}

type LibraryNeoLayoutProps = LibraryNeoLayoutBaseProps & DetailProps;

// ---------------------------------------------------------------------------
// Constants & Styles
// ---------------------------------------------------------------------------

const FACET_ICONS: Record<LibraryFacet, LucideIcon> = {
  all: Music2,
  albums: Disc3,
  artists: User,
  recent: Clock3,
  mostPlayed: TrendingUp,
};

const SORT_LABELS: Record<SortBy, string> = {
  dateAdded: 'DATE ADDED',
  title: 'TITLE',
  artist: 'ARTIST',
  album: 'ALBUM',
};

const PIXEL_PATTERN = new Set([0, 1, 4, 5, 6, 9, 10, 14, 15]);

// Base button styles for Neo Brutalism
const NEO_BUTTON_BASE =
  'inline-flex shrink-0 items-center justify-center gap-2 border-2 border-black text-black font-black uppercase tracking-[0.08em] transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal-active)] rounded-none cursor-pointer';

const NEO_BUTTON_DEFAULT =
  'bg-[var(--neo-panel)] shadow-[4px_4px_0_0_#000] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none hover:bg-[var(--signal-active)]';

const NEO_BUTTON_ACTIVE = 'bg-black text-white shadow-none';

// ---------------------------------------------------------------------------
// Pure derivation helpers
// ---------------------------------------------------------------------------

function getCommandTitle(detail: LibraryDetailScope | null, activeFacet: LibraryFacet): string {
  if (detail) {
    return detail.type === 'album' ? detail.album : detail.artist;
  }
  if (activeFacet === 'albums') return 'ALBUM ARCHIVE';
  if (activeFacet === 'artists') return 'ARTIST INDEX';
  if (activeFacet === 'recent') return 'RECENT INTAKE';
  if (activeFacet === 'mostPlayed') return 'TOP SPINS';
  return 'LIBRARY ARCHIVE';
}

function getResultsTitle(
  isDetail: boolean,
  activeFacet: LibraryFacet,
  viewMode: LibraryViewDensity,
): { emoji: string; label: string } {
  if (isDetail) return { emoji: '📋', label: 'TRACK DOSSIER' };
  if (activeFacet === 'albums') return { emoji: '💿', label: 'ALBUMS' };
  if (activeFacet === 'artists') return { emoji: '🎤', label: 'ARTISTS' };
  if (activeFacet === 'recent') return { emoji: '🕐', label: 'RECENTLY PLAYED' };
  if (activeFacet === 'mostPlayed') return { emoji: '📈', label: 'TOP SPINS' };
  return { emoji: '🎵', label: viewMode === 'list' ? 'TRACK REGISTER' : 'TRACK FILES' };
}

function buildMetrics(
  isDetail: boolean,
  visibleCount: number,
  facetCounts: FacetCounts,
  activeFacet: LibraryFacet,
  selectedCount: number,
): Array<{ label: string; value: string; tone: 'default' | 'olive' | 'yellow' }> {
  return [
    {
      label: isDetail ? 'TRACKS IN DOSSIER' : 'TRACK FILES',
      value: (isDetail ? visibleCount : facetCounts.all).toLocaleString(),
      tone: 'default',
    },
    {
      label: 'ALBUMS',
      value: facetCounts.albums.toLocaleString(),
      tone: activeFacet === 'albums' ? 'olive' : 'default',
    },
    {
      label: 'ARTISTS',
      value: facetCounts.artists.toLocaleString(),
      tone: activeFacet === 'artists' ? 'olive' : 'default',
    },
    {
      label: selectedCount > 0 ? 'SELECTION' : 'DURATION',
      value:
        selectedCount > 0
          ? selectedCount.toLocaleString()
          : formatLongDuration(facetCounts.duration),
      tone: selectedCount > 0 ? 'yellow' : 'default',
    },
  ];
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function NeoPixelStamp() {
  return (
    <div className="grid grid-cols-4 gap-[3px] w-6 h-6" aria-hidden="true">
      {Array.from({ length: 16 }, (_, index) => (
        <span
          key={index}
          className={cn(
            'border border-[#000]',
            PIXEL_PATTERN.has(index) ? 'bg-[#000]' : 'bg-transparent',
          )}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LibraryNeoLayout
// ---------------------------------------------------------------------------

export const LibraryNeoLayout = memo(function LibraryNeoLayout(props: LibraryNeoLayoutProps) {
  const {
    facets,
    onFacetChange,
    activeFacet,
    selectedCount,
    viewMode,
    onViewModeChange,
    sortBy,
    onSortByChange,
    searchQuery,
    facetCounts,
    onSelectAll,
    onClearSelection,
    detailScope,
    onBackFromDetail,
    groupedData,
    hasMore,
    onLoadMore,
    onPlayTrack,
    onTrackSelect,
    onAlbumOpen,
    onArtistOpen,
    ...restOrchestratorProps
  } = props;

  const isLoadingMoreRef = useRef(false);

  const detail = detailScope ?? null;
  const isDetail = detail !== null;

  const rawData: unknown[] = Array.isArray(groupedData) ? groupedData : [];
  const trimmedSearchQuery = searchQuery.trim();

  const ActiveFacetIcon = FACET_ICONS[activeFacet];
  const canChangeViewMode =
    isDetail || activeFacet === 'all' || activeFacet === 'recent' || activeFacet === 'mostPlayed';

  const commandTitle = getCommandTitle(detail, activeFacet);
  const resultsTitle = getResultsTitle(isDetail, activeFacet, viewMode);
  const metrics = buildMetrics(isDetail, rawData.length, facetCounts, activeFacet, selectedCount);

  const handleResultsScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (!hasMore || !onLoadMore || isLoadingMoreRef.current) return;

      const { scrollTop, clientHeight, scrollHeight } = event.currentTarget;
      if (scrollHeight <= 0) return;

      if (scrollTop + clientHeight >= scrollHeight * 0.9) {
        isLoadingMoreRef.current = true;
        onLoadMore();
        requestAnimationFrame(() => {
          isLoadingMoreRef.current = false;
        });
      }
    },
    [hasMore, onLoadMore],
  );

  return (
    <div className="relative flex h-full flex-col p-3 md:p-4 pb-6 text-black overflow-hidden bg-transparent">
      <div className="relative z-10 flex h-full flex-col gap-4 md:gap-5 overflow-hidden">
        {/* ------------------------------------------------------------------ */}
        {/* COMMAND CENTER                                                       */}
        {/* ------------------------------------------------------------------ */}
        <section
          className="flex shrink-0 flex-col gap-3 border-2 border-black bg-[var(--neo-panel)] p-3 md:p-4 shadow-[4px_4px_0_0_#000]"
          aria-label="Library command deck"
        >
          {/* Title row */}
          <div className="flex items-center gap-3">
            {isDetail ? (
              <button
                type="button"
                className={cn(NEO_BUTTON_BASE, NEO_BUTTON_DEFAULT, 'h-11 w-11 shrink-0 p-0')}
                onClick={onBackFromDetail}
                aria-label="Back from detail view"
              >
                <ChevronLeft className="h-5 w-5" strokeWidth={3} />
              </button>
            ) : (
              <div className="flex h-11 w-11 shrink-0 items-center justify-center border-2 border-black bg-[var(--neo-panel)] shadow-[4px_4px_0_0_#000]">
                <ActiveFacetIcon className="h-5 w-5" strokeWidth={3} />
              </div>
            )}

            <div className="flex min-w-0 flex-col justify-center">
              <h1 className="text-xl md:text-2xl lg:text-[1.75rem] font-black uppercase leading-none tracking-tight text-black truncate">
                {commandTitle}
              </h1>
            </div>
          </div>

          {/* One horizontal flow: facets + view + sort share a row until true wrap is needed (no forced column below xl). */}
          <div className="mt-1 flex w-full flex-wrap items-center justify-between gap-x-2 gap-y-2">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
              {!isDetail && (
                <div
                  className="flex w-fit max-w-full min-w-0 flex-wrap items-center gap-2"
                  role="tablist"
                  aria-label="Library facets"
                >
                  {facets.map((facet) => {
                    const Icon = FACET_ICONS[facet.id];
                    const isActive = facet.id === activeFacet;

                    return (
                      <button
                        key={facet.id}
                        id={`library-v2-facet-${facet.id}`}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        aria-controls="library-v2-panel"
                        className={cn(
                          NEO_BUTTON_BASE,
                          'h-10 px-2.5 pl-1.5',
                          isActive ? NEO_BUTTON_ACTIVE : NEO_BUTTON_DEFAULT,
                        )}
                        onClick={() => onFacetChange(facet.id)}
                      >
                        <div
                          className={cn(
                            'flex h-6 w-6 items-center justify-center border-2 border-inherit',
                            isActive
                              ? 'bg-[var(--signal-active)] text-black shadow-none translate-x-[1px] translate-y-[1px]'
                              : 'bg-[#D1D1D1] text-black',
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" strokeWidth={3} />
                        </div>
                        <div className="flex flex-col items-start pr-1">
                          <strong className="text-[12px] leading-tight font-black tracking-[0.05em]">
                            {facet.label}
                          </strong>
                          <span className="font-mono text-[12px] leading-none font-black opacity-70">
                            {facet.count > 999 ? `${Math.floor(facet.count / 1000)}K` : facet.count}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {canChangeViewMode && (
                <div className="flex items-center gap-2" role="group" aria-label="View mode">
                  <button
                    type="button"
                    className={cn(
                      NEO_BUTTON_BASE,
                      'h-10 px-2.5 text-[12px]',
                      viewMode === 'grid' ? NEO_BUTTON_ACTIVE : NEO_BUTTON_DEFAULT,
                    )}
                    onClick={() => onViewModeChange('grid')}
                    aria-pressed={viewMode === 'grid'}
                  >
                    <div
                      className={cn(
                        'flex h-5 w-5 items-center justify-center border-2 border-inherit',
                        viewMode === 'grid'
                          ? 'bg-[var(--signal-active)] text-black'
                          : 'bg-[#D1D1D1] text-black',
                      )}
                    >
                      <LayoutGrid className="h-2.5 w-2.5" strokeWidth={3} />
                    </div>
                    {viewMode === 'grid' && (
                      <span className="ml-1.5 uppercase font-black">GRID</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      NEO_BUTTON_BASE,
                      'h-10 px-2.5 text-[12px]',
                      viewMode === 'list' ? NEO_BUTTON_ACTIVE : NEO_BUTTON_DEFAULT,
                    )}
                    onClick={() => onViewModeChange('list')}
                    aria-pressed={viewMode === 'list'}
                  >
                    <div
                      className={cn(
                        'flex h-5 w-5 items-center justify-center border-2 border-inherit',
                        viewMode === 'list'
                          ? 'bg-[var(--signal-active)] text-black'
                          : 'bg-[#D1D1D1] text-black',
                      )}
                    >
                      <List className="h-2.5 w-2.5" strokeWidth={3} />
                    </div>
                    {viewMode === 'list' && (
                      <span className="ml-1.5 uppercase font-black">LIST</span>
                    )}
                  </button>
                </div>
              )}
            </div>

            <label
              className="relative flex h-10 shrink-0 cursor-pointer items-stretch border-2 border-black bg-[var(--neo-panel)] shadow-[4px_4px_0_0_#000] focus-within:ring-2 focus-within:ring-[var(--signal-active)] hover:bg-[var(--signal-active)]"
              aria-label="Sort order"
            >
              <div className="flex px-3 items-center gap-2">
                <span className="text-[12px] font-black uppercase leading-tight tracking-[0.05em] whitespace-nowrap">
                  SORT: {SORT_LABELS[sortBy]}
                </span>
                <ChevronDown className="h-3.5 w-3.5" strokeWidth={3} />
              </div>
              <select
                className="absolute inset-0 w-full cursor-pointer text-base opacity-0"
                value={sortBy}
                onChange={(event) => onSortByChange(event.target.value as SortBy)}
                aria-label="Sort by"
              >
                {Object.entries(SORT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {/* ------------------------------------------------------------------ */}
        {/* RESULTS                                                              */}
        {/* ------------------------------------------------------------------ */}
        <section className="flex min-h-[260px] flex-1 flex-col gap-3 border-2 border-black bg-[var(--neo-panel)] p-3 md:p-4 shadow-[4px_4px_0_0_#000]">
          <header className="flex flex-wrap items-center gap-3 shrink-0 mb-2">
            <NeoSectionHeader emoji={resultsTitle.emoji} label={resultsTitle.label} />
          </header>

          <LibrarySelectionBar
            selectedCount={selectedCount}
            onSelectAll={onSelectAll}
            onClearSelection={onClearSelection}
            isNeo={true}
          />

          <div
            className="flex-1 overflow-y-auto pr-1 pb-3 custom-scrollbar"
            onScroll={handleResultsScroll}
            id="library-v2-panel"
            role="tabpanel"
          >
            {rawData.length > 0 ? (
              <LibraryResultsOrchestrator
                groupedData={groupedData}
                hasMore={hasMore}
                onLoadMore={onLoadMore}
                onPlayTrack={onPlayTrack}
                onTrackSelect={onTrackSelect}
                onAlbumOpen={onAlbumOpen}
                onArtistOpen={onArtistOpen}
                {...restOrchestratorProps}
                activeFacet={activeFacet}
                viewMode={viewMode}
                searchQuery={searchQuery}
                isNeo={true}
              />
            ) : trimmedSearchQuery ? (
              <div className="neo-empty-state" role="status" aria-live="polite">
                <p className="neo-empty-state-primary">NO RESULTS / TRY A DIFFERENT SEARCH</p>
              </div>
            ) : (
              <div className="neo-empty-state" role="status" aria-live="polite">
                <div className="mb-8 flex h-[80px] w-[80px] shrink-0 items-center justify-center border-2 border-black bg-[var(--signal-play)] shadow-[4px_4px_0_0_#000]">
                  <NeoPixelStamp />
                </div>
                <div className="grid gap-2 text-center">
                  <h3 className="neo-empty-state-primary">NO FILES MATCH THIS CUT.</h3>
                  <p className="neo-empty-state-secondary">
                    This section is empty right now. Try another facet or import more music.
                  </p>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ------------------------------------------------------------------ */}
        {/* METRICS FOOTER                                                       */}
        {/* ------------------------------------------------------------------ */}
        <div
          className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4 shrink-0"
          aria-label="Library metrics"
        >
          {metrics.map((metric) => (
            <div
              key={metric.label}
              className={cn(
                'flex min-h-[72px] flex-col justify-center gap-1.5 border-2 border-black p-2.5 md:p-3 shadow-[4px_4px_0_0_#000] min-w-0 transition-colors',
                metric.tone === 'olive'
                  ? 'bg-[var(--signal-play)]'
                  : metric.tone === 'yellow'
                    ? 'bg-[var(--signal-active)]'
                    : 'bg-[var(--neo-panel)]',
              )}
            >
              <span className="text-[12px] font-black uppercase tracking-[0.1em] truncate">
                {metric.label}
              </span>
              <strong className="font-mono text-xl md:text-[min(1.8vw,1.65rem)] font-black leading-none truncate block">
                {metric.value}
              </strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
