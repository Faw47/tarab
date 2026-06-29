import { Check, Play } from 'lucide-react';
import { ArtistIcon } from '../ui/Icons';
import type { CSSProperties, DragEvent } from 'react';
import { memo, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { usePlayerStore } from '../../store/player-store';
import { getContextMenuPosition } from '../../lib/context-menu-position';
import type { Track } from '../../types';
import { CoverArtImage } from '../shared/CoverArtImage';
import { VirtualizedGrid } from '../shared/VirtualizedGrid';
import { Button } from '../ui/button';
import { LibraryTracksList } from './LibraryTracksList';
import { LibraryAlbumsList } from './LibraryAlbumsList';
import { LibraryArtistsList } from './LibraryArtistsList';
import type { AlbumGroup, ArtistGroup } from './library-view-model';
import type { ResultsOrchestratorProps } from './library-view-types';
import { renderHighlightedText } from './search-highlight';

const DEFAULT_HIGHLIGHT_CLASS = 'rounded-[3px] bg-primary/35 px-0.5 text-inherit';
const NEO_HIGHLIGHT_CLASS = 'rounded-none bg-[#F5C518] px-0.5 text-black';

const ALBUM_ROTATIONS = [
  'rotate-[-0.8deg]',
  'rotate-[0.6deg]',
  'rotate-[-0.4deg]',
  'rotate-[0.8deg]',
];
const ALBUM_TAPE_ROTATIONS = ['rotate-[-4deg]', 'rotate-[3deg]', 'rotate-[-3deg]', 'rotate-[4deg]'];

const NEO_CARD_BASE =
  'group relative border-[1.5px] border-[#1a1a1a] bg-[#fafaf7] p-2 pb-7 shadow-[3px_3px_0_0_#1a1a1a] transition-none hover:bg-[#fcfcf9] hover:shadow-[4px_4px_0_0_#1a1a1a] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none cursor-pointer select-none';
const NEO_CARD_SELECTED =
  'bg-[#F5C518] shadow-none translate-x-[1px] translate-y-[1px] border-[1.5px] border-[#1a1a1a]';
const NEO_CARD_PLAYING = 'border-[#7CC61F] bg-[#7CC61F] shadow-[3px_3px_0_0_#7CC61F]';

const NEO_TAPE_STYLE = 'absolute -top-[9px] left-1/2 -translate-x-1/2 w-12 h-[18px] z-20 pointer-events-none opacity-90';
const TAPE_INNER_STYLE: CSSProperties = {
  background: 'rgba(230, 200, 120, 0.28)',
  border: '1px solid rgba(180, 155, 80, 0.35)',
  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.4)',
};

const NEO_TILE_PLAY_BTN =
  'absolute flex items-center justify-center border-2 border-black bg-[#F5C518] shadow-[4px_4px_0_0_#000] transition-none hover:bg-[#FFE234] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none z-20';

function getAlbumRotationClass(i: number): string {
  return ALBUM_ROTATIONS[i % ALBUM_ROTATIONS.length];
}

function getAlbumTapeRotationClass(i: number): string {
  return ALBUM_TAPE_ROTATIONS[i % ALBUM_TAPE_ROTATIONS.length];
}

function getEntranceClass(index: number): string {
  if (index >= 12) return '';
  return `animate-fade-in-up stagger-${(index % 6) + 1}`;
}

interface TrackTileProps {
  track: Track;
  index: number;
  searchQuery: string;
  isPlaying: boolean;
  isSelected: boolean;
  onPlayTrack: (track: Track) => void;
  onTrackSelect?: (track: Track, isMulti: boolean) => void;
  onTrackContextMenu?: (track: Track, position: { x: number; y: number }) => void;
  onDragStart: (event: DragEvent, track: Track) => void;
  isLyricsMatch: boolean;
  matchedLyricLine: string | null;
  isNeo?: boolean;
}

const TrackTile = memo(function TrackTile({
  track,
  index,
  searchQuery,
  isPlaying,
  isSelected,
  onPlayTrack,
  onTrackSelect,
  onTrackContextMenu,
  onDragStart,
  isLyricsMatch,
  matchedLyricLine,
  isNeo,
}: TrackTileProps) {
  const highlightClass = isNeo ? NEO_HIGHLIGHT_CLASS : DEFAULT_HIGHLIGHT_CLASS;
  if (isNeo) {
    return (
      <article
        role="button"
        tabIndex={0}
        draggable
        aria-selected={isSelected}
        aria-label={`${track.title} by ${track.artist}`}
        className={cn(
          NEO_CARD_BASE,
          'aspect-[4/5] flex flex-col',
          getAlbumRotationClass(index),
          isPlaying && NEO_CARD_PLAYING,
          isSelected && !isPlaying && NEO_CARD_SELECTED,
        )}
        onClick={(event) => {
          const multi = event.metaKey || event.ctrlKey || event.shiftKey;
          onTrackSelect?.(track, multi);
        }}
        onDoubleClick={() => onPlayTrack(track)}
        onContextMenu={(event) => {
          event.preventDefault();
          if (!onTrackContextMenu) return;
          const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
          const { x, y } = getContextMenuPosition(rect, 180, 220);
          onTrackContextMenu(track, { x, y });
        }}
        onDragStart={(event) => onDragStart(event, track)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            const multi = event.metaKey || event.ctrlKey || event.shiftKey;
            if (onTrackSelect) {
              onTrackSelect(track, multi);
              return;
            }
            onPlayTrack(track);
          }
        }}
      >
        <div
          className={cn(NEO_TAPE_STYLE, getAlbumTapeRotationClass(index))}
          style={TAPE_INNER_STYLE}
          aria-hidden="true"
        />
        <div className="relative mb-2 aspect-square overflow-hidden border-2 border-black bg-black">
          <div className="pointer-events-none absolute inset-1 z-10 border-2 border-black" />
          <CoverArtImage
            track={track}
            variant="album"
            size="large"
            className="h-full w-full"
            imgClassName="h-full w-full object-cover"
            roundedClassName="rounded-none"
            iconClassName="w-6 h-6"
            alt={track.album}
          />
          <button
            type="button"
            className={cn(NEO_TILE_PLAY_BTN, 'bottom-1 right-1 h-7 w-7')}
            onClick={(event) => {
              event.stopPropagation();
              onPlayTrack(track);
            }}
            aria-label={`Play ${track.title}`}
          >
            <Play className="h-3 w-3" fill="currentColor" strokeWidth={3} />
          </button>
        </div>
        <div className="text-[11px] font-black uppercase tracking-tight truncate leading-tight">
          {renderHighlightedText(track.title, searchQuery, highlightClass)}
        </div>
        <div className="mt-0.5 truncate text-[9px] font-bold uppercase tracking-wide opacity-60 leading-tight">
          {matchedLyricLine
            ? `“${matchedLyricLine}”`
            : renderHighlightedText(track.artist, searchQuery, highlightClass)}
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1">
          <span className="max-w-full truncate border border-black/20 bg-[#E6E6E6] px-1 py-0.5 text-[8px] font-black uppercase tracking-widest">
            {renderHighlightedText(track.album, searchQuery, highlightClass)}
          </span>
          {isLyricsMatch && (
            <span className="border border-black/20 bg-[#7CC61F] px-1 py-0.5 text-[8px] font-black uppercase tracking-widest text-[#000]">
              LYR
            </span>
          )}
        </div>
      </article>
    );
  }

  return (
    <article
      role="button"
      tabIndex={0}
      draggable
      aria-selected={isSelected}
      aria-label={`${track.title} by ${track.artist}`}
      className={cn('library-v2-track-tile', isSelected && 'is-selected', getEntranceClass(index))}
      onClick={(event) => {
        const multi = event.metaKey || event.ctrlKey || event.shiftKey;
        onTrackSelect?.(track, multi);
      }}
      onDoubleClick={() => onPlayTrack(track)}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!onTrackContextMenu) return;
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const { x, y } = getContextMenuPosition(rect, 180, 220);
        onTrackContextMenu(track, { x, y });
      }}
      onDragStart={(event) => onDragStart(event, track)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onPlayTrack(track);
        }
      }}
    >
      <div className="library-v2-track-media">
        <CoverArtImage
          track={track}
          size="large"
          className="w-full h-full"
          imgClassName="w-full h-full object-cover"
          roundedClassName=""
          iconClassName="w-8 h-8"
          alt={track.album}
        />
        <button
          type="button"
          className="library-v2-play-overlay"
          onClick={(event) => {
            event.stopPropagation();
            onPlayTrack(track);
          }}
          aria-label={`Play ${track.title}`}
        >
          <Play className="h-4 w-4" fill="currentColor" />
        </button>

        <button
          type="button"
          className={cn('library-v2-select-dot', isSelected && 'is-selected')}
          onClick={(event) => {
            event.stopPropagation();
            onTrackSelect?.(track, true);
          }}
          aria-label={isSelected ? `Deselect ${track.title}` : `Select ${track.title}`}
        >
          {isSelected ? (
            <Check className="h-3 w-3" />
          ) : (
            <span className="library-v2-select-inner" />
          )}
        </button>
      </div>

      <div className="library-v2-track-meta">
        <p className={cn('library-v2-track-title truncate', isPlaying && 'is-playing')}>
          {renderHighlightedText(track.title, searchQuery, highlightClass)}
        </p>
        <p className="library-v2-track-subtitle truncate">
          {renderHighlightedText(track.artist, searchQuery, highlightClass)}
        </p>
        <p className="library-v2-track-tertiary truncate">
          {renderHighlightedText(track.album, searchQuery, highlightClass)}
        </p>
        {isLyricsMatch && matchedLyricLine && (
          <p className="library-v2-lyrics-match truncate">
            “{renderHighlightedText(matchedLyricLine, searchQuery, highlightClass)}”
          </p>
        )}
      </div>
    </article>
  );
});

interface AlbumTileProps {
  album: AlbumGroup;
  index: number;
  searchQuery: string;
  onOpen: (track: Track) => void;
  onPlay: (track: Track) => void;
  isFeatured?: boolean;
  isNeo?: boolean;
  isPlayingAlbum?: boolean;
}

const AlbumTile = memo(function AlbumTile({
  album,
  index,
  searchQuery,
  onOpen,
  onPlay,
  isFeatured = false,
  isNeo,
  isPlayingAlbum = false,
}: AlbumTileProps) {
  const highlightClass = isNeo ? NEO_HIGHLIGHT_CLASS : DEFAULT_HIGHLIGHT_CLASS;
  if (isNeo) {
    return (
      <article
        role="button"
        tabIndex={0}
        className={cn(
          NEO_CARD_BASE,
          'aspect-[4/5] flex flex-col',
          getAlbumRotationClass(index),
          isPlayingAlbum && NEO_CARD_PLAYING,
        )}
        onClick={() => onOpen(album.track)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpen(album.track);
          }
        }}
        aria-label={`Open album ${album.track.album} by ${album.track.artist}`}
      >
        <div
          className={cn(NEO_TAPE_STYLE, getAlbumTapeRotationClass(index))}
          style={TAPE_INNER_STYLE}
          aria-hidden="true"
        />
        <div className="relative mb-3 aspect-square overflow-hidden border-2 border-black bg-black">
          <div className="pointer-events-none absolute inset-1 z-10 border-2 border-black" />
          <CoverArtImage
            track={album.track}
            variant="album"
            size="large"
            className="h-full w-full"
            imgClassName="h-full w-full object-cover"
            roundedClassName="rounded-none"
            iconClassName="w-8 h-8"
            alt={album.track.album}
          />
          <button
            type="button"
            className={cn(NEO_TILE_PLAY_BTN, 'bottom-2 right-2 h-8 w-8')}
            onClick={(event) => {
              event.stopPropagation();
              onPlay(album.track);
            }}
            aria-label={`Play ${album.track.album}`}
          >
            <Play className="h-4 w-4" fill="currentColor" strokeWidth={3} />
          </button>
          <div className="absolute left-2 top-2 z-20 border border-white bg-black px-1 py-0.5 text-[8px] font-black leading-none tracking-widest text-white shadow-[2px_2px_0_0_#000]">
            {album.count} {album.count === 1 ? 'FILE' : 'FILES'}
          </div>
        </div>
        <div className="truncate text-[12px] font-black uppercase tracking-tight leading-tight">
          {renderHighlightedText(album.track.album, searchQuery, highlightClass)}
        </div>
        <div className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-wide opacity-60 leading-tight">
          {renderHighlightedText(album.track.artist, searchQuery, highlightClass)}
        </div>
        {album.track.year && (
          <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
            <span className="border border-black bg-[#E6E6E6] px-1.5 py-0.5 text-[8px] font-black uppercase tracking-[0.05em] text-black/70">
              {String(album.track.year)}
            </span>
          </div>
        )}
      </article>
    );
  }

  if (isFeatured) {
    return (
      <article
        role="button"
        tabIndex={0}
        className={cn(
          'library-v2-album-tile group relative overflow-hidden rounded-[22px] border border-white/10 bg-black/25',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/28',
          'library-v2-album-featured-span',
          getEntranceClass(index),
        )}
        style={{ gridColumn: 'span 2' }}
        onClick={() => onOpen(album.track)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpen(album.track);
          }
        }}
        aria-label={`Open album ${album.track.album} by ${album.track.artist}`}
      >
        <div className="library-v2-album-featured-layout h-full min-h-[160px]">
          <div className="library-v2-album-featured-media relative overflow-hidden aspect-square">
            <CoverArtImage
              track={album.track}
              size="large"
              className="w-full h-full"
              imgClassName="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
              roundedClassName=""
              iconClassName="w-8 h-8"
              alt={album.track.album}
            />
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  'linear-gradient(180deg, transparent 25%, rgba(0,0,0,0.18) 52%, rgba(0,0,0,0.90) 100%)',
              }}
            />
            <button
              type="button"
              className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                onPlay(album.track);
              }}
              aria-label={`Play ${album.track.album}`}
            >
              <Button
                variant="ghost"
                size="icon"
                className="w-11 h-11 rounded-full bg-white text-black shadow-[0_6px_22_rgba(0,0,0,0.42)] transition-all duration-250 hover:scale-[1.12] active:scale-[0.92] pointer-events-none"
                tabIndex={-1}
              >
                <Play className="w-4 h-4 ml-0.5" fill="currentColor" />
              </Button>
            </button>
          </div>

          <div className="flex-1 min-w-0 p-4 flex flex-col justify-between bg-black/25">
            <div>
              <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-white/70">
                Featured album
              </p>
              <p className="font-bold text-white leading-tight truncate text-[1.05rem] mt-1">
                {renderHighlightedText(
                  album.track.album,
                  searchQuery,
                  'rounded-[3px] bg-white/65 px-0.5 text-black',
                )}
              </p>
              <p className="text-white/48 truncate mt-1 text-[0.75rem]">
                {renderHighlightedText(
                  album.track.artist,
                  searchQuery,
                  'rounded-[3px] bg-white/65 px-0.5 text-black',
                )}
              </p>
            </div>
            <p className="text-white/58 text-[0.64rem] uppercase tracking-[0.09em] mt-1.5">
              {album.count} {album.count === 1 ? 'track' : 'tracks'}
            </p>
          </div>
        </div>
      </article>
    );
  }

  return (
    <article
      role="button"
      tabIndex={0}
      className={cn(
        'library-v2-album-tile group relative overflow-hidden rounded-[18px]',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/28',
        getEntranceClass(index),
      )}
      onClick={() => onOpen(album.track)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(album.track);
        }
      }}
      aria-label={`Open album ${album.track.album} by ${album.track.artist}`}
    >
      <div className="library-v2-album-media relative w-full aspect-square">
        <CoverArtImage
          track={album.track}
          size="large"
          className="w-full h-full"
          imgClassName="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
          roundedClassName=""
          iconClassName="w-8 h-8"
          alt={album.track.album}
        />
        <div
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-250 group-hover:opacity-100"
          style={{
            background:
              'linear-gradient(180deg, transparent 25%, rgba(0,0,0,0.18) 52%, rgba(0,0,0,0.90) 100%)',
          }}
        />
        <div className="pointer-events-none absolute z-20 top-2.5 right-2.5 px-2 py-0.5 rounded-full text-[9px] font-semibold uppercase tracking-[0.18em] text-white/70 bg-black/50 backdrop-blur-sm border border-white/[0.10] opacity-0 -translate-y-1 transition-[opacity,transform] duration-200 group-hover:opacity-100 group-hover:translate-y-0">
          {album.count} {album.count === 1 ? 'track' : 'tracks'}
        </div>
        <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 p-3 flex items-end justify-between gap-3 opacity-0 translate-y-1.5 transition-all duration-250 group-hover:opacity-100 group-hover:translate-y-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={(event) => {
              event.stopPropagation();
              onPlay(album.track);
            }}
            className="pointer-events-auto shrink-0 rounded-full bg-white text-black inline-flex items-center justify-center shadow-[0_6px_22_rgba(0,0,0,0.42)] transition-all duration-250 hover:scale-[1.12] active:scale-[0.92] w-9 h-9"
            aria-label={`Play ${album.track.album}`}
          >
            <Play className="w-3.5 h-3.5 ml-0.5" fill="currentColor" />
          </Button>
        </div>
      </div>

      <div className="library-v2-track-meta">
        <div className="library-v2-track-title truncate">
          {renderHighlightedText(album.track.album, searchQuery, highlightClass)}
        </div>
        <div className="library-v2-track-subtitle truncate">
          {renderHighlightedText(album.track.artist, searchQuery, highlightClass)}
        </div>
      </div>
    </article>
  );
});

interface ArtistTileProps {
  artist: ArtistGroup;
  index: number;
  searchQuery: string;
  onOpen: (artist: string) => void;
  onPlay: (track: Track) => void;
  isNeo?: boolean;
  isPlayingArtist?: boolean;
}

const ArtistTile = memo(function ArtistTile({
  artist,
  index,
  searchQuery,
  onOpen,
  onPlay,
  isNeo,
  isPlayingArtist = false,
}: ArtistTileProps) {
  const leadTrack = artist.tracks[0];
  const highlightClass = isNeo ? NEO_HIGHLIGHT_CLASS : DEFAULT_HIGHLIGHT_CLASS;

  if (isNeo) {
    return (
      <article
        role="button"
        tabIndex={0}
        className={cn(
          NEO_CARD_BASE,
          'aspect-[4/5] flex flex-col pt-4 pb-7',
          getAlbumRotationClass(index),
          isPlayingArtist && NEO_CARD_PLAYING,
        )}
        onClick={() => onOpen(artist.artist)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onOpen(artist.artist);
          }
        }}
        aria-label={`Open artist ${artist.artist}`}
      >
        <div
          className={cn(NEO_TAPE_STYLE, getAlbumTapeRotationClass(index))}
          style={TAPE_INNER_STYLE}
          aria-hidden="true"
        />
        <div className="relative mb-3 aspect-square w-full overflow-hidden border-2 border-black bg-black">
          {leadTrack ? (
            <CoverArtImage
              track={leadTrack}
              variant="artist"
              size="large"
              className="h-full w-full"
              imgClassName="h-full w-full object-cover"
              iconClassName="h-8 w-8"
              alt={artist.artist}
            />
          ) : artist.coverArt ? (
            <div className="neo-artist-avatar relative h-full w-full overflow-hidden bg-[#D1D1D1]">
              <img
                src={artist.coverArt}
                alt={artist.artist}
                className="h-full w-full object-cover"
                loading="lazy"
                width={320}
                height={320}
              />
            </div>
          ) : (
            <div className="neo-artist-avatar flex h-full w-full items-center justify-center bg-[#D1D1D1] text-black">
              <ArtistIcon className="h-8 w-8" />
            </div>
          )}
          {leadTrack && (
            <button
              type="button"
              className={cn(NEO_TILE_PLAY_BTN, 'bottom-2 right-2 h-8 w-8')}
              onClick={(event) => {
                event.stopPropagation();
                onPlay(leadTrack);
              }}
              aria-label={`Play ${artist.artist}`}
            >
              <Play className="h-4 w-4" fill="currentColor" strokeWidth={3} />
            </button>
          )}
        </div>
        <div className="truncate text-[12px] font-black uppercase tracking-tight leading-tight">
          {renderHighlightedText(artist.artist, searchQuery, highlightClass)}
        </div>
        <div className="mt-0.5 truncate text-[10px] font-bold uppercase tracking-wide opacity-60 leading-tight">
          {artist.tracks.length} {artist.tracks.length === 1 ? 'FILE' : 'FILES'}
        </div>
      </article>
    );
  }

  return (
    <article
      role="button"
      tabIndex={0}
      className={cn('library-v2-track-tile', getEntranceClass(index))}
      onClick={() => onOpen(artist.artist)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(artist.artist);
        }
      }}
      aria-label={`Open artist ${artist.artist}`}
    >
      <div className="library-v2-track-media">
        {artist.coverArt ? (
          <img
            src={artist.coverArt}
            alt={artist.artist}
            className="w-full h-full object-cover"
            loading="lazy"
            width={320}
            height={320}
          />
        ) : (
          <div className="library-v2-artist-fallback">
            <ArtistIcon className="h-8 w-8" />
          </div>
        )}

        {leadTrack && (
          <button
            type="button"
            className="library-v2-play-overlay"
            onClick={(event) => {
              event.stopPropagation();
              onPlay(leadTrack);
            }}
            aria-label={`Play ${artist.artist}`}
          >
            <Play className="h-4 w-4" fill="currentColor" />
          </button>
        )}
      </div>

      <div className="library-v2-track-meta">
        <p className="library-v2-track-title truncate">
          {renderHighlightedText(artist.artist, searchQuery, highlightClass)}
        </p>
        <p className="library-v2-track-subtitle truncate">
          {artist.tracks.length} {artist.tracks.length === 1 ? 'track' : 'tracks'}
        </p>
      </div>
    </article>
  );
});

export const LibraryResultsOrchestrator = memo(function LibraryResultsOrchestrator({
  activeFacet,
  viewMode,
  searchQuery,
  groupedData,
  activeTrackId,
  isPlaying,
  selectedTrackIds,
  onPlayTrack,
  onPlayAlbum,
  onTrackSelect,
  onTrackContextMenu,
  onShowFileInfo,
  onAlbumOpen,
  onArtistOpen,
  onDragStart,
  onRangeChange,
  onTrackGridRangeChange,
  onAlbumGridRangeChange,
  onArtistGridRangeChange,
  onLoadMore,
  hasMore,
  formatSize,
  getFormatLabel,
  isLyricsMatch,
  getLyricsMatchLine,
  isNeo,
}: ResultsOrchestratorProps) {
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const selectedTrackSet = useMemo(() => new Set(selectedTrackIds), [selectedTrackIds]);

  if (activeFacet === 'all' || activeFacet === 'recent' || activeFacet === 'mostPlayed') {
    const tracks = groupedData as Track[];

    if (viewMode === 'list') {
      return (
        <LibraryTracksList
          tracks={tracks}
          searchQuery={searchQuery}
          activeTrackId={activeTrackId}
          isPlaying={isPlaying}
          selectedTrackIds={selectedTrackIds}
          onPlayTrack={onPlayTrack}
          onRowClick={(track, event) => {
            const isMulti = event.metaKey || event.ctrlKey || event.shiftKey;
            onTrackSelect?.(track, isMulti);
          }}
          onContextMenu={onTrackContextMenu}
          onShowFileInfo={onShowFileInfo}
          onDragStart={onDragStart}
          formatSize={formatSize}
          getFormatLabel={getFormatLabel}
          isLyricsMatch={isLyricsMatch}
          getLyricsMatchLine={getLyricsMatchLine}
          onRangeChange={onRangeChange}
          onLoadMore={hasMore ? onLoadMore : undefined}
          isNeo={isNeo}
        />
      );
    }

    return (
      <VirtualizedGrid
        items={tracks}
        minColumnWidth={isNeo ? 150 : 160}
        rowHeight={isNeo ? 250 : 245}
        className={cn(isNeo ? 'px-1 pt-4 pb-8' : 'pb-8')}
        getItemKey={(track) => track.id}
        onRangeChange={(start, end) => onTrackGridRangeChange(tracks, start, end)}
        onScrollNearEnd={hasMore ? onLoadMore : undefined}
        renderItem={(track, index) => (
          <TrackTile
            track={track}
            index={index}
            searchQuery={searchQuery}
            isPlaying={Boolean(activeTrackId && activeTrackId === track.id && isPlaying)}
            isSelected={selectedTrackSet.has(track.id)}
            onPlayTrack={onPlayTrack}
            onTrackSelect={onTrackSelect}
            onTrackContextMenu={onTrackContextMenu}
            onDragStart={onDragStart}
            isLyricsMatch={isLyricsMatch(track.id)}
            matchedLyricLine={getLyricsMatchLine(track.id)}
            isNeo={isNeo}
          />
        )}
      />
    );
  }

  if (activeFacet === 'albums') {
    const albums = groupedData as AlbumGroup[];

    if (viewMode === 'list') {
      return (
        <LibraryAlbumsList
          albums={albums}
          searchQuery={searchQuery}
          onOpen={onAlbumOpen}
          onPlay={onPlayAlbum}
          onLoadMore={hasMore ? onLoadMore : undefined}
          isNeo={isNeo}
          currentTrack={currentTrack}
          isPlaying={isPlaying}
        />
      );
    }

    return (
      <VirtualizedGrid
        items={albums}
        minColumnWidth={isNeo ? 165 : 155}
        rowHeight={isNeo ? 270 : 245}
        className={cn(isNeo ? 'px-1 pt-6 pb-12' : 'pb-10')}
        getItemKey={(album) => `${album.track.album}-${album.track.artist}`}
        onRangeChange={(start, end) => onAlbumGridRangeChange(albums, start, end)}
        onScrollNearEnd={hasMore ? onLoadMore : undefined}
        renderItem={(album, index) => (
          <AlbumTile
            album={album}
            index={index}
            searchQuery={searchQuery}
            onOpen={onAlbumOpen}
            onPlay={onPlayAlbum}
            isNeo={isNeo}
            isPlayingAlbum={
              Boolean(
                isPlaying &&
                currentTrack &&
                currentTrack.album === album.track.album &&
                currentTrack.artist === album.track.artist,
              )
            }
          />
        )}
      />
    );
  }


  if (activeFacet === 'artists') {
    const artists = groupedData as ArtistGroup[];

    if (viewMode === 'list') {
      return (
        <LibraryArtistsList
          artists={artists}
          searchQuery={searchQuery}
          onOpen={onArtistOpen}
          onPlay={onPlayTrack}
          onLoadMore={hasMore ? onLoadMore : undefined}
          isNeo={isNeo}
          currentTrack={currentTrack}
          isPlaying={isPlaying}
        />
      );
    }

    return (
      <VirtualizedGrid
        items={artists}
        minColumnWidth={isNeo ? 165 : 155}
        rowHeight={isNeo ? 270 : 245}
        className={cn(isNeo ? 'px-1 pt-6 pb-12' : 'pb-10')}
        getItemKey={(artist) => artist.artist}
        onRangeChange={(start, end) => onArtistGridRangeChange(artists, start, end)}
        onScrollNearEnd={hasMore ? onLoadMore : undefined}
        renderItem={(artist, index) => (
          <ArtistTile
            artist={artist}
            index={index}
            searchQuery={searchQuery}
            onOpen={onArtistOpen}
            onPlay={onPlayTrack}
            isNeo={isNeo}
            isPlayingArtist={Boolean(isPlaying && currentTrack && currentTrack.artist === artist.artist)}
          />
        )}
      />
    );
  }


  return null;
});
