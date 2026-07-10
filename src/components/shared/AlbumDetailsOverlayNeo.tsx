import {
  Calendar,
  CheckSquare,
  ChevronLeft,
  Clock,
  Edit3,
  FolderOpen,
  ListMusic,
  ListPlus,
  MoreHorizontal,
  Music2,
  Play,
  Shuffle,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  memo,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/utils';
import { useCoverArt } from '../../hooks/useCoverArt';
import { formatTime } from '../../lib/format-time';
import { toggleCurrentPlayback } from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import type { Track } from '../../types';
import { PlaylistPickerDialog } from '../playlist/PlaylistPickerDialog';
import type { AlbumDetailsOverlayProps } from './AlbumDetailsOverlay';
import { useAlbumTrackSelection } from './useAlbumTrackSelection';

// ---------------------------------------------------------------------------
// Unified Design Constants
// ---------------------------------------------------------------------------

const BUTTON_BASE =
  'inline-flex items-center justify-center gap-2 border-[2px] border-black font-black uppercase tracking-[0.08em] transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--signal-active)] rounded-none cursor-pointer';

const BUTTON_DEFAULT =
  'bg-white text-black shadow-[4px_4px_0_0_#000] hover:bg-[var(--neo-muted)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none';

const BUTTON_PRIMARY =
  'bg-[#9D80E3] text-black shadow-[4px_4px_0_0_#000] hover:bg-[#8A6FCC] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none';

const BUTTON_DANGER =
  'bg-[var(--signal-danger)] text-black shadow-[4px_4px_0_0_#000] hover:bg-[var(--signal-danger)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none';

const TRACK_GRID =
  'grid grid-cols-[36px_40px_1fr_64px] md:grid-cols-[40px_48px_1fr_90px] items-center gap-3';

const neoIconButtonClass = (active = false) =>
  cn(
    BUTTON_BASE,
    active
      ? 'translate-x-[4px] translate-y-[4px] bg-[var(--signal-active)] text-black shadow-none'
      : BUTTON_DEFAULT,
    'h-10 w-10 p-0 shadow-[4px_4px_0_0_#000]',
  );

const neoActionButtonClass = (primary = false, danger = false) =>
  cn(
    BUTTON_BASE,
    danger ? BUTTON_DANGER : primary ? BUTTON_PRIMARY : BUTTON_DEFAULT,
    'h-11 px-4 text-[12px]',
    !primary && !danger && 'shadow-[4px_4px_0_0_#000]',
  );

const extensionFromPath = (filePath: string): string => {
  const base = filePath.split(/[/\\]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  if (dot < 0 || dot === base.length - 1) return 'FILE';
  return base.slice(dot + 1).toUpperCase();
};

const isMultiSelectKey = (event: ReactMouseEvent | ReactKeyboardEvent): boolean =>
  event.shiftKey || event.metaKey || event.ctrlKey;

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

const TrackRow = memo(
  ({
    track,
    index,
    isSelected,
    isCurrentTrack,
    isCurrentlyPlaying,
    selectionActive,
    onTrackSelect,
    onTrackContextMenu,
    handleRowActivate,
    handleTrackKeyDown,
    trackGridClass,
  }: {
    track: Track;
    index: number;
    isSelected: boolean;
    isCurrentTrack: boolean;
    isCurrentlyPlaying: boolean;
    selectionActive: boolean;
    onTrackSelect?: (track: Track, isMulti: boolean) => void;
    onTrackContextMenu?: (e: React.MouseEvent, track: Track) => void;
    handleRowActivate: (track: Track) => void;
    handleTrackKeyDown: (track: Track, e: ReactKeyboardEvent<HTMLDivElement>) => void;
    trackGridClass: string;
  }) => {
    const rowPlaying = isCurrentTrack && isCurrentlyPlaying;
    const rowSelectedOnly = isSelected && !rowPlaying;

    return (
      <div
        role="row"
        tabIndex={0}
        aria-selected={isSelected}
        onClick={(event) => {
          onTrackSelect?.(track, isMultiSelectKey(event));
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          handleRowActivate(track);
        }}
        onKeyDown={(event) => handleTrackKeyDown(track, event)}
        onContextMenu={(event) => {
          event.preventDefault();
          onTrackContextMenu?.(event, track);
        }}
        className={cn(
          trackGridClass,
          'cursor-pointer px-4 py-3 text-sm outline-none transition-none md:px-6 md:py-4',
          'border-y-2 border-r-2 border-black focus-visible:border-l-black',
          rowPlaying && 'border-l-4 border-l-black bg-[var(--signal-play)]',
          rowSelectedOnly && 'border-l-4 border-l-black bg-[var(--signal-active)]',
          !rowPlaying &&
            !rowSelectedOnly &&
            'border-l-4 border-l-transparent bg-white hover:bg-[var(--neo-muted)]',
        )}
      >
        <div role="cell" className="flex justify-center">
          {selectionActive && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onTrackSelect?.(track, true);
              }}
              aria-label={isSelected ? `Deselect ${track.title}` : `Select ${track.title}`}
              className="text-black"
            >
              {isSelected ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            </button>
          )}
        </div>

        <div
          role="cell"
          className="text-center font-mono text-[13px] font-black tabular-nums text-black"
        >
          {String(index + 1).padStart(2, '0')}
        </div>

        <div role="cell" className="min-w-0">
          <div className="truncate font-black uppercase tracking-[0.05em] text-black flex items-center gap-2">
            {isCurrentTrack && isCurrentlyPlaying && (
              <div className="w-2 h-2 rounded-none bg-black animate-pulse shrink-0" />
            )}
            {track.title}
          </div>
          <div className="truncate text-[10px] font-bold uppercase tracking-[0.1em] text-black/60 mt-0.5">
            {track.artist}
          </div>
        </div>

        <div role="cell" className="text-right text-[12px] font-mono font-black text-black">
          {formatTime(track.duration)}
        </div>
      </div>
    );
  },
);
TrackRow.displayName = 'TrackRow';

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export const AlbumDetailsOverlayNeo = memo(function AlbumDetailsOverlayNeo({
  album,
  artist,
  coverArt,
  tracks,
  onPlayAlbum,
  onPlayTrack,
  onTrackContextMenu,
  selectedTrackIds = [],
  onTrackSelect,
  onClearSelection,
  onSelectAll,
  onOpenTagEditor,
  onAddToQueue,
  onAddToPlaylist,
  onRevealInFinder,
  onDeleteTracks,
  onShuffleAlbum,
  onClose,
  currentlyPlayingId,
  isPlaying: isCurrentlyPlaying,
  onScrollChange,
}: AlbumDetailsOverlayProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [playlistPickerIds, setPlaylistPickerIds] = useState<string[] | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);

  const firstTrack = tracks[0] ?? null;
  const coverFromTrack = useCoverArt(
    firstTrack?.filePath ?? '',
    firstTrack?.hasCoverArt ?? false,
    true,
    'large',
    firstTrack?.coverArtHash ?? undefined,
  );
  const resolvedCoverArt = coverArt ?? coverFromTrack;

  const totalDuration = useMemo(
    () => tracks.reduce((sum, track) => sum + (track.duration ?? 0), 0),
    [tracks],
  );

  const releaseYear = useMemo(() => tracks.find((track) => track.year)?.year, [tracks]);

  const coverFormatSticker = firstTrack?.filePath ? extensionFromPath(firstTrack.filePath) : 'FILE';
  const coverMetaSticker = firstTrack?.fileFormat?.trim() || null;

  const {
    selectedSet,
    selectedTracks,
    selectedCount,
    someSelected,
    allSelected,
    selectionActive,
    targetTracks,
    activateSelection,
    clearSelection,
    handleSelectAll,
  } = useAlbumTrackSelection({
    tracks,
    selectedTrackIds,
    onClearSelection,
    onSelectAll,
  });
  const canPlayAlbum = Boolean(onPlayAlbum && tracks.length > 0);
  const canShuffleAlbum = Boolean(onShuffleAlbum && tracks.length > 0);

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutsideClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [menuOpen]);

  const openPlaylistPicker = useCallback(() => {
    if (targetTracks.length === 0) return;
    if (onAddToPlaylist) {
      onAddToPlaylist(targetTracks);
      setMenuOpen(false);
      return;
    }
    setPlaylistPickerIds(targetTracks.map((track) => track.id));
    setMenuOpen(false);
  }, [onAddToPlaylist, targetTracks]);

  const handleRowActivate = useCallback(
    (track: Track) => {
      if (currentlyPlayingId === track.id) {
        void toggleCurrentPlayback().catch((error) => {
          reportError('Failed to toggle track playback in neobrutalism overlay', {
            source: 'album-details-overlay-neo',
            error,
          });
        });
        return;
      }
      onPlayTrack?.(track);
    },
    [currentlyPlayingId, onPlayTrack],
  );

  const handleTrackKeyDown = useCallback(
    (track: Track, event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        handleRowActivate(track);
      }

      if (event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        if (selectionActive) {
          activateSelection();
          onTrackSelect?.(track, true);
          return;
        }
        handleRowActivate(track);
      }
    },
    [handleRowActivate, onTrackSelect, selectionActive],
  );

  return (
    <div className="relative h-full w-full overflow-hidden bg-transparent text-black animate-neo-slide-up">
      <div className="relative flex h-full flex-col">
        <div className="shrink-0 border-b-2 border-black bg-white px-4 md:px-6 py-3 flex items-center justify-between z-30">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className={neoIconButtonClass()}
              aria-label="Back"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.16em] text-black/60">
                Library Archive
              </p>
              <h2 className="truncate text-sm md:text-base font-black uppercase tracking-[0.08em] text-black">
                {album}
              </h2>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-3">
            <button
              type="button"
              onClick={() => onShuffleAlbum?.()}
              className={cn(neoActionButtonClass(), 'hover-neo-wiggle')}
              disabled={!canShuffleAlbum}
            >
              <Shuffle className="h-4 w-4" />
              Shuffle
            </button>
            <button
              type="button"
              onClick={() => onPlayAlbum?.()}
              className={cn(neoActionButtonClass(true), 'hover-neo-wiggle')}
              disabled={!canPlayAlbum}
            >
              <Play className="h-4 w-4 fill-current" />
              Play All
            </button>
          </div>
        </div>

        <div
          className="relative flex-1 overflow-y-auto custom-scrollbar px-4 md:px-6 py-6 md:py-10 z-20"
          onScroll={(event) => onScrollChange?.(event.currentTarget.scrollTop > 8)}
        >
          <div className="mx-auto max-w-6xl space-y-8 md:space-y-12">
            <section className="grid grid-cols-1 gap-6 md:grid-cols-[240px_1fr] md:gap-8">
              <div className="rounded-none border-2 border-black bg-white p-2 shadow-[4px_4px_0_0_#000] animate-neo-pop">
                <div className="neo-album-art-wrap relative aspect-square overflow-hidden bg-[var(--neo-muted)]">
                  <div className="absolute left-2 top-2 z-30 border-2 border-black bg-white px-2 py-1 text-[10px] font-black uppercase text-black">
                    {coverFormatSticker}
                  </div>
                  {coverMetaSticker && (
                    <div className="absolute bottom-2 right-2 z-30 -rotate-2 border-2 border-black bg-[var(--signal-active)] px-2 py-1 text-[10px] font-black uppercase text-black">
                      {coverMetaSticker}
                    </div>
                  )}
                  {resolvedCoverArt ? (
                    <img
                      src={resolvedCoverArt}
                      alt={album}
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center">
                      <Music2 className="h-16 w-16 text-black/45" />
                    </div>
                  )}
                </div>
              </div>
              {/* Info / Metadata */}
              <div
                className="flex flex-col justify-center rounded-none border-2 border-black bg-white p-6 md:p-8 shadow-[4px_4px_0_0_#000] animate-neo-pop"
                style={{ animationDelay: '100ms' }}
              >
                <p className="text-[12px] font-black uppercase tracking-[0.18em] text-black/50">
                  Album Release
                </p>
                <h1 className="mt-2 text-3xl md:text-5xl font-black uppercase leading-tight tracking-tight text-black break-words">
                  {album}
                </h1>

                <div className="mt-4 inline-flex self-start bg-black px-3 py-1.5 shadow-[3px_3px_0_0_var(--signal-play)]">
                  <p className="text-sm md:text-base font-black uppercase tracking-[0.05em] text-[var(--signal-play)]">
                    {artist}
                  </p>
                </div>

                <div className="mt-8 flex flex-wrap items-center gap-3">
                  {releaseYear && (
                    <span className="inline-flex items-center gap-1.5 border-[2px] border-black bg-[var(--neo-muted)] px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.08em] text-black">
                      <Calendar className="h-3.5 w-3.5" />
                      {releaseYear}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5 border-[2px] border-black bg-[var(--neo-muted)] px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.08em] text-black">
                    <ListMusic className="h-3.5 w-3.5" />
                    {tracks.length} {tracks.length === 1 ? 'Track' : 'Tracks'}
                  </span>
                  <span className="inline-flex items-center gap-1.5 border-[2px] border-black bg-[var(--neo-muted)] px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.08em] text-black">
                    <Clock className="h-3.5 w-3.5" />
                    {formatTime(totalDuration)}
                  </span>
                  {firstTrack?.fileFormat && (
                    <span className="inline-flex items-center gap-1.5 border-[2px] border-black bg-[var(--neo-muted)] px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.08em] text-black">
                      {firstTrack.fileFormat}
                    </span>
                  )}
                  {firstTrack?.bitrate && (
                    <span className="inline-flex items-center gap-1.5 border-[2px] border-black bg-[var(--neo-muted)] px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.08em] text-black">
                      {Math.round(firstTrack.bitrate / 1000)} kbps
                    </span>
                  )}
                </div>

                <div className="mt-8 flex md:hidden items-center gap-3">
                  <button
                    type="button"
                    onClick={() => onPlayAlbum?.()}
                    className={cn(neoActionButtonClass(true), 'flex-1')}
                    disabled={!canPlayAlbum}
                  >
                    <Play className="h-4 w-4 fill-current" />
                    Play
                  </button>
                  <button
                    type="button"
                    onClick={() => onShuffleAlbum?.()}
                    className={neoActionButtonClass()}
                    disabled={!canShuffleAlbum}
                  >
                    <Shuffle className="h-4 w-4" />
                    Shuffle
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-none border-2 border-black bg-white shadow-[4px_4px_0_0_#000] overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b-2 border-black px-4 md:px-6 py-4 bg-[var(--neo-panel)]">
                <div className="flex items-center gap-3">
                  <h3 className="text-[13px] font-black uppercase tracking-[0.16em] text-black">
                    Track Roster
                  </h3>
                  <span className="border-[2px] border-black bg-white px-2 py-0.5 text-[11px] font-black uppercase tracking-[0.08em] text-black">
                    {tracks.length}
                  </span>
                </div>

                <div className="flex items-center gap-3" ref={menuRef}>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectionActive) {
                        clearSelection();
                        return;
                      }
                      activateSelection();
                    }}
                    className={neoActionButtonClass()}
                  >
                    {selectionActive ? (
                      <>
                        <X className="h-4 w-4" />
                        Clear
                      </>
                    ) : (
                      <>
                        <CheckSquare className="h-4 w-4" />
                        Select
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setMenuOpen((prev) => !prev)}
                    className={neoIconButtonClass(menuOpen)}
                    aria-label="Open album actions"
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>

                  {menuOpen && (
                    <div
                      role="menu"
                      className="absolute right-0 top-[calc(100%+8px)] z-30 min-w-[220px] rounded-none border-2 border-black bg-white p-3 shadow-[4px_4px_0_0_#000]"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          if (!onOpenTagEditor || targetTracks.length === 0) return;
                          onOpenTagEditor(targetTracks);
                          setMenuOpen(false);
                        }}
                        className={cn(neoActionButtonClass(), 'w-full justify-start')}
                        disabled={!onOpenTagEditor || targetTracks.length === 0}
                      >
                        <Edit3 className="h-4 w-4" />
                        Edit tags
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          if (!onAddToQueue || targetTracks.length === 0) return;
                          onAddToQueue(targetTracks);
                          setMenuOpen(false);
                        }}
                        className={cn(neoActionButtonClass(), 'mt-2 w-full justify-start')}
                        disabled={!onAddToQueue || targetTracks.length === 0}
                      >
                        <ListMusic className="h-4 w-4" />
                        Add to queue
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={openPlaylistPicker}
                        className={cn(neoActionButtonClass(), 'mt-2 w-full justify-start')}
                        disabled={targetTracks.length === 0}
                      >
                        <ListPlus className="h-4 w-4" />
                        Add to playlist
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          const track = targetTracks[0];
                          if (!track || !onRevealInFinder) return;
                          onRevealInFinder(track);
                          setMenuOpen(false);
                        }}
                        className={cn(neoActionButtonClass(), 'mt-2 w-full justify-start')}
                        disabled={!onRevealInFinder || targetTracks.length === 0}
                      >
                        <FolderOpen className="h-4 w-4" />
                        Reveal in OS
                      </button>

                      {someSelected && (
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            if (!onDeleteTracks || selectedTracks.length === 0) return;
                            onDeleteTracks(selectedTracks);
                            setMenuOpen(false);
                          }}
                          className={cn(
                            neoActionButtonClass(false, true),
                            'mt-2 w-full justify-start',
                          )}
                          disabled={!onDeleteTracks || selectedTracks.length === 0}
                        >
                          <Trash2 className="h-4 w-4" />
                          Delete data
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <div role="table" aria-label={`${album} tracklist`}>
                <div role="rowgroup" className="border-b-2 border-black bg-black text-white">
                  <div
                    role="row"
                    className={cn(
                      TRACK_GRID,
                      'px-4 md:px-6 py-3 text-[11px] font-black uppercase tracking-[0.1em]',
                    )}
                  >
                    <div role="columnheader" className="flex justify-center">
                      {selectionActive && (
                        <button
                          type="button"
                          onClick={handleSelectAll}
                          aria-label={allSelected ? 'Deselect all tracks' : 'Select all tracks'}
                          className="text-white hover:text-[var(--signal-active)] transition-none"
                        >
                          {allSelected ? (
                            <CheckSquare className="h-4 w-4" />
                          ) : (
                            <Square className="h-4 w-4" />
                          )}
                        </button>
                      )}
                    </div>
                    <div role="columnheader" className="text-center">
                      #
                    </div>
                    <div role="columnheader">ID _ TITLE</div>
                    <div role="columnheader" className="text-right">
                      DUR
                    </div>
                  </div>
                </div>

                {tracks.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-4 px-6 py-20 bg-white">
                    <Music2 className="h-12 w-12 text-black/50" />
                    <p className="text-[14px] font-black uppercase tracking-[0.1em] text-black">
                      No Assets Found
                    </p>
                  </div>
                ) : (
                  <div role="rowgroup" className="divide-y-[2px] divide-black">
                    {tracks.map((track, index) => (
                      <TrackRow
                        key={track.id}
                        track={track}
                        index={index}
                        isSelected={selectedSet.has(track.id)}
                        isCurrentTrack={currentlyPlayingId === track.id}
                        isCurrentlyPlaying={isCurrentlyPlaying ?? false}
                        selectionActive={selectionActive}
                        onTrackSelect={onTrackSelect}
                        onTrackContextMenu={onTrackContextMenu}
                        handleRowActivate={handleRowActivate}
                        handleTrackKeyDown={handleTrackKeyDown}
                        trackGridClass={TRACK_GRID}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>

        {someSelected && (
          <div className="pointer-events-none fixed bottom-8 left-0 right-0 z-40 flex justify-center px-4">
            <div className="pointer-events-auto flex w-full max-w-[800px] flex-wrap items-center justify-center gap-3 border-2 border-black bg-white p-4 shadow-[4px_4px_0_0_#000]">
              <span className="border-[2px] border-black bg-black text-[var(--signal-active)] px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.08em]">
                {selectedCount} Selected
              </span>

              <button
                type="button"
                onClick={() => onAddToQueue?.(selectedTracks)}
                disabled={!onAddToQueue}
                className={neoActionButtonClass()}
              >
                <ListMusic className="h-4 w-4" />
                Queue
              </button>
              <button type="button" onClick={openPlaylistPicker} className={neoActionButtonClass()}>
                <ListPlus className="h-4 w-4" />
                Playlist
              </button>
              <button
                type="button"
                onClick={() => onOpenTagEditor?.(selectedTracks)}
                disabled={!onOpenTagEditor}
                className={neoActionButtonClass()}
              >
                <Edit3 className="h-4 w-4" />
                Tags
              </button>
              <button
                type="button"
                onClick={() => onDeleteTracks?.(selectedTracks)}
                disabled={!onDeleteTracks}
                className={neoActionButtonClass(false, true)}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
              <button type="button" onClick={clearSelection} className={neoActionButtonClass()}>
                <X className="h-4 w-4" />
                Clear
              </button>
            </div>
          </div>
        )}

        {!onAddToPlaylist && (
          <PlaylistPickerDialog
            open={playlistPickerIds !== null}
            trackIds={playlistPickerIds ?? []}
            onClose={() => setPlaylistPickerIds(null)}
          />
        )}
      </div>
    </div>
  );
});

AlbumDetailsOverlayNeo.displayName = 'AlbumDetailsOverlayNeo';
