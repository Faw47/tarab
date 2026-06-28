import { useAutoAnimate } from '@formkit/auto-animate/react';
import { FileText, Info, MoreHorizontal, Play } from 'lucide-react';
import { memo, useCallback, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { getContextMenuPosition } from '../../lib/context-menu-position';
import { formatTime } from '../../lib/format-time';
import type { ContextMenuPosition, Track } from '../../types';
import { CoverArtImage } from '../shared/CoverArtImage';
import { VirtualizedList } from '../shared/VirtualizedList';
import { renderHighlightedText } from './search-highlight';
import './library-view.css';

const LIST_ROW_HEIGHT = 90;

const NEO_ICON_BTN =
  'flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center border-2 border-black bg-white p-0 text-black shadow-[4px_4px_0_0_#000] transition-none hover:bg-[#F5C518] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none';
const NEO_ICON_BTN_PLAY =
  'flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center border-2 border-black bg-[#F5C518] p-0 text-black shadow-[4px_4px_0_0_#000] transition-none hover:bg-[#FFE234] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none';

export interface LibraryTracksListProps {
  tracks: Track[];
  searchQuery: string;
  activeTrackId: string | null;
  isPlaying: boolean;
  selectedTrackIds: string[];
  onPlayTrack: (track: Track) => void;
  onRowClick: (track: Track, e: React.MouseEvent) => void;
  onContextMenu?: (track: Track, position: ContextMenuPosition) => void;
  onShowFileInfo: (trackId: string) => void;
  onDragStart: (e: React.DragEvent, track: Track) => void;
  formatSize: (size?: number) => string;
  getFormatLabel: (track: Track) => string;
  isLyricsMatch: ((id: string) => boolean) | boolean;
  getLyricsMatchLine: ((id: string) => string | null) | string | null;
  onRangeChange: (tracks: Track[], start: number, end: number) => void;
  onLoadMore?: () => void;
  isNeo?: boolean;
}

const TrackRow = memo(function TrackRow({
  track,
  idx,
  searchQuery,
  isActive,
  isSelected,
  onRowClick,
  onPlayTrack,
  onContextMenu,
  onDragStart,
  onShowFileInfo,
  getFormatLabel,
  isLyricsMatch,
  getLyricsMatchLine,
  formatSize,
  isNeo,
}: {
  track: Track;
  idx: number;
  searchQuery: string;
  isActive: boolean;
  isSelected: boolean;
  onRowClick: (track: Track, e: React.MouseEvent) => void;
  onPlayTrack: (track: Track) => void;
  onContextMenu?: (track: Track, position: ContextMenuPosition) => void;
  onDragStart: (e: React.DragEvent, track: Track) => void;
  onShowFileInfo: (trackId: string) => void;
  getFormatLabel: (track: Track) => string;
  isLyricsMatch: ((id: string) => boolean) | boolean;
  getLyricsMatchLine: ((id: string) => string | null) | string | null;
  formatSize: (size?: number) => string;
  isNeo?: boolean;
}) {
  const highlightClass = isNeo
    ? 'rounded-none bg-[#E4C463] px-0.5 text-black'
    : 'rounded-[3px] bg-primary/35 px-0.5 text-inherit';

  const safeGetFormatLabel = (() => {
    if (typeof getFormatLabel === 'function') return getFormatLabel(track);
    const fileFormat = track.fileFormat;
    if (fileFormat) return String(fileFormat).toUpperCase();
    const ext = track.filePath?.split('.').pop();
    return ext ? ext.toUpperCase() : 'FILE';
  })();

  const safeFormatSize = (() => {
    if (typeof formatSize === 'function') return formatSize(track.fileSize);
    return '—';
  })();

  const lyricsLineForTrack =
    typeof getLyricsMatchLine === 'function'
      ? getLyricsMatchLine(track.id)
      : (getLyricsMatchLine ?? null);
  const isLyricsMatchForTrack =
    typeof isLyricsMatch === 'function' ? isLyricsMatch(track.id) : Boolean(isLyricsMatch);

  return (
    <div className={cn(isNeo ? 'px-0 py-0' : 'px-2 py-0.5 border-b border-transparent')}>
      <div
        className={cn(
          isNeo
            ? 'group -mt-[2px] grid cursor-pointer grid-cols-[58px_2.4fr_1.7fr_1fr_132px] border-y-2 border-r-2 border-black outline-none transition-none'
            : 'library-list-row group grid grid-cols-[58px_2.4fr_1.7fr_1fr_132px] cursor-pointer',
          !isNeo && isActive && 'is-active',
          !isNeo && isSelected && 'is-selected',
          isNeo && isActive && 'border-l-4 border-l-black bg-[#7CC61F] z-10 relative',
          isNeo &&
            isSelected &&
            !(isActive) &&
            'border-l-4 border-l-black bg-[#F5C518] z-10 relative',
          isNeo && !isActive && !isSelected && 'border-l-4 border-l-transparent bg-white hover:z-10 hover:bg-[#F6F6F6] z-0',
        )}
        role="button"
        tabIndex={0}
        aria-selected={isSelected}
        aria-label={`${track.title} by ${track.artist}`}
        onClick={(e) => onRowClick(track, e)}
        onDoubleClick={() => onPlayTrack(track)}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!onContextMenu) return;
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const { x, y } = getContextMenuPosition(rect, 180, 200);
          onContextMenu(track, { x, y });
        }}
        draggable
        onDragStart={(e) => onDragStart(e, track)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onPlayTrack(track);
            return;
          }

          if (event.key === ' ') {
            event.preventDefault();
            const keyboardSelectionEvent = {
              metaKey: event.metaKey,
              ctrlKey: event.ctrlKey,
              shiftKey: true,
            } as React.MouseEvent;
            onRowClick(track, keyboardSelectionEvent);
          }
        }}
      >
        <div className="flex items-center justify-center">
          {isActive ? (
            isNeo ? (
              <div className="flex items-center gap-1.5 border-2 border-black bg-black p-1 px-2 text-[#7CC61F] shadow-[4px_4px_0_0_#000]">
                <div className="w-1.5 h-1.5 rounded-full bg-[#F87171] animate-pulse shrink-0" />
                <span className="text-[9px] font-black uppercase tracking-widest text-white leading-none">NOW</span>
              </div>
            ) : (
              <div className="flex gap-0.5 items-end h-3">
                <span className="w-0.5 rounded-[1px] h-full origin-bottom animate-[eq-bar_0.8s_ease-in-out_0ms_infinite] bg-primary" />
                <span className="w-0.5 rounded-[1px] h-full origin-bottom animate-[eq-bar_0.8s_ease-in-out_180ms_infinite] bg-primary" />
                <span className="w-0.5 rounded-[1px] h-full origin-bottom animate-[eq-bar_0.8s_ease-in-out_360ms_infinite] bg-primary" />
              </div>
            )
          ) : (
            <span
              className={cn(isNeo ? 'text-black font-mono font-black text-[13px] tabular-nums' : 'text-text-subtle font-mono text-xs')}
            >
              {idx + 1}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 min-w-0 py-1.5">
          <div className="relative shrink-0">
            <CoverArtImage
              track={track}
              variant={isNeo ? 'album' : undefined}
              className={cn(isNeo ? 'h-[44px] w-[44px]' : 'h-10 w-10')}
              imgClassName="h-full w-full object-cover"
              roundedClassName={isNeo ? '' : 'rounded-lg'}
              iconClassName="h-4 w-4"
              alt={track.album}
              viewTransitionName={`cover-${track.id}`}
            />
            {!isNeo && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onPlayTrack(track);
                }}
                className={cn(
                  'absolute inset-0 flex items-center justify-center rounded-lg transition-opacity library-card-overlay',
                  isSelected || isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
                aria-label={`Play ${track.title}`}
              >
                <Play className="w-4 h-4" fill="currentColor" />
              </button>
            )}
          </div>

          <div className="min-w-0 pr-2">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'truncate',
                  isNeo ? 'uppercase tracking-[0.05em] text-black pr-2 text-[13px]' : 'font-medium text-text-primary',
                  isNeo && isActive ? 'font-black' : (isNeo ? 'font-black' : '') 
                )}
              >
                {renderHighlightedText(track.title, searchQuery, highlightClass)}
              </span>
              {isLyricsMatchForTrack && (
                <span
                  className={cn(
                    isNeo
                      ? 'border-2 border-black bg-[#7CC61F] px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] shadow-[4px_4px_0_0_#000]'
                      : 'library-lyrics-chip shrink-0',
                  )}
                >
                  {!isNeo && <FileText className="w-2.5 h-2.5" />}
                  {isNeo ? 'LYR' : 'Lyrics'}
                </span>
              )}
            </div>
            <div
              className={cn('truncate mt-0.5', isNeo ? 'text-[10px] font-bold uppercase tracking-[0.1em] text-black/60' : 'text-xs text-text-muted')}
            >
              {lyricsLineForTrack ? (
                <span className={cn(isNeo ? 'text-black' : 'text-primary/70 italic')}>
                  “{renderHighlightedText(lyricsLineForTrack, searchQuery, highlightClass)}”
                </span>
              ) : (
                renderHighlightedText(track.artist, searchQuery, highlightClass)
              )}
            </div>
          </div>
        </div>

        <div className="min-w-0 pr-4 py-1.5 flex flex-col justify-center">
          <div
            className={cn('truncate', isNeo ? 'text-[11px] font-black uppercase tracking-[0.05em] text-black' : 'text-sm text-text-secondary')}
          >
            {renderHighlightedText(track.album, searchQuery, highlightClass)}
          </div>
          <div
            className={cn('truncate', isNeo ? 'text-[9px] font-bold uppercase tracking-[0.1em] text-black/60 mt-0.5' : 'text-[11px] text-text-muted')}
          >
            {renderHighlightedText(track.artist, searchQuery, highlightClass)}
          </div>
        </div>

        <div className="min-w-0 py-1.5 flex flex-col justify-center">
          <div className="truncate">
            <span
              className={cn(
                'uppercase tracking-tight inline-flex',
                isNeo
                  ? 'border-2 border-black bg-[#E6E6E6] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] shadow-[4px_4px_0_0_#000]'
                  : 'px-2 py-0.5 rounded-md text-[9px] font-bold border border-border/70 text-text-secondary',
              )}
            >
              {safeGetFormatLabel}
            </span>
          </div>
          {isNeo ? (
            <div className="text-[9px] font-mono font-black tracking-widest text-[#555] mt-1.5 truncate uppercase">
              {safeFormatSize} • {track.bitrate} KBPS
            </div>
          ) : (
            <>
              <div className="text-[11px] text-text-muted mt-1 truncate">
                {track.bitrate ? `${track.bitrate} kbps` : 'Unknown bitrate'}
              </div>
              <div className="text-[10px] text-text-muted font-mono truncate">{safeFormatSize}</div>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pr-4 py-2">
          <span
            className={cn(
              'font-mono pr-2',
              isNeo ? 'text-[13px] font-black text-black' : 'text-xs text-text-secondary',
            )}
          >
            {formatTime(track.duration)}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPlayTrack(track);
            }}
            className={isNeo ? NEO_ICON_BTN_PLAY : 'library-icon-action flex items-center justify-center p-2'}
            aria-label={`Play ${track.title}`}
          >
            <Play size={14} fill="currentColor" strokeWidth={isNeo ? 3 : 2} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onShowFileInfo(track.id);
            }}
            className={isNeo ? NEO_ICON_BTN : 'library-icon-action flex items-center justify-center p-2'}
            aria-label={`Open info for ${track.title}`}
          >
            <Info size={16} strokeWidth={isNeo ? 2.5 : 2} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!onContextMenu) return;
              const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
              const { x, y } = getContextMenuPosition(rect, 180, 200);
              onContextMenu(track, { x, y });
            }}
            className={isNeo ? NEO_ICON_BTN : 'library-icon-action flex items-center justify-center p-2'}
            aria-label={`More actions for ${track.title}`}
          >
            <MoreHorizontal size={16} strokeWidth={isNeo ? 3 : 2} />
          </button>
        </div>
      </div>
    </div>
  );
});

export const LibraryTracksList = memo(function LibraryTracksList({
  tracks,
  searchQuery,
  activeTrackId,
  isPlaying,
  selectedTrackIds,
  onPlayTrack,
  onRowClick,
  onContextMenu,
  onShowFileInfo,
  onDragStart,
  formatSize,
  getFormatLabel,
  isLyricsMatch,
  getLyricsMatchLine,
  onRangeChange,
  onLoadMore,
  isNeo,
}: LibraryTracksListProps) {
  const [parent] = useAutoAnimate();
  const selectedSet = useMemo(() => new Set(selectedTrackIds), [selectedTrackIds]);

  const handleRangeChange = useCallback(
    (start: number, end: number) => {
      onRangeChange(tracks, start, end);
    },
    [tracks, onRangeChange],
  );

  return (
    <div
      ref={parent}
      className={cn(!isNeo && 'library-list-shell', isNeo && 'h-full flex flex-col')}
    >
      <div
        className={cn(
          'library-list-head grid-cols-[58px_2.4fr_1.7fr_1fr_132px]',
          isNeo &&
            'sticky top-0 z-20 mx-0 border-b-2 border-black bg-[#E6E6E6] px-2 py-2.5 text-[11px] font-black uppercase tracking-[0.1em] text-black shadow-none',
        )}
      >
        <span className="text-center">#</span>
        <span>Song</span>
        <span>Album</span>
        <span>Quality</span>
        <span className="text-right pr-4">Actions</span>
      </div>

      <VirtualizedList
        items={tracks}
        itemHeight={isNeo ? 72 : LIST_ROW_HEIGHT}
        overscan={8}
        className="relative h-full overflow-y-auto overflow-x-hidden custom-scrollbar pt-2"
        getItemKey={(track) => track.id}
        onRangeChange={handleRangeChange}
        onScrollNearEnd={onLoadMore}
        enableRovingFocus
        renderItem={(track, idx) => (
          <TrackRow
            key={track.id}
            track={track}
            idx={idx}
            searchQuery={searchQuery}
            isActive={activeTrackId === track.id && isPlaying}
            isSelected={selectedSet.has(track.id)}
            onRowClick={onRowClick}
            onPlayTrack={onPlayTrack}
            onContextMenu={onContextMenu}
            onDragStart={onDragStart}
            onShowFileInfo={onShowFileInfo}
            getFormatLabel={getFormatLabel}
            isLyricsMatch={isLyricsMatch}
            getLyricsMatchLine={getLyricsMatchLine}
            formatSize={formatSize}
            isNeo={isNeo}
          />
        )}
      />
    </div>
  );
});
