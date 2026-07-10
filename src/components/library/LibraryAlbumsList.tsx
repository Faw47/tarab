import { Info, Play } from 'lucide-react';
import { memo } from 'react';
import { cn } from '@/lib/utils';
import type { Track } from '../../types';
import { CoverArtImage } from '../shared/CoverArtImage';
import { VirtualizedList } from '../shared/VirtualizedList';
import { NEO_ICON_BUTTON_CLASS, NEO_PLAY_ICON_BUTTON_CLASS } from './library-neo-classes';
import type { AlbumGroup } from './library-view-model';
import { renderHighlightedText } from './search-highlight';
import './library-view.css';

const ALBUM_ROW_HEIGHT = 72;

interface AlbumRowProps {
  album: AlbumGroup;
  idx: number;
  searchQuery: string;
  onOpen: (track: Track) => void;
  onPlay: (track: Track) => void;
  isNeo?: boolean;
  isPlayingAlbum?: boolean;
}

const AlbumRow = memo(function AlbumRow({
  album,
  idx,
  searchQuery,
  onOpen,
  onPlay,
  isNeo,
  isPlayingAlbum = false,
}: AlbumRowProps) {
  const highlightClass = isNeo
    ? 'rounded-none bg-[var(--neo-utility-hover)] px-0.5 text-black'
    : 'rounded-[3px] bg-primary/35 px-0.5 text-inherit';

  return (
    <div className={cn(isNeo ? 'px-0 py-0' : 'px-2 py-0.5 border-b border-transparent')}>
      <div
        className={cn(
          isNeo
            ? 'group -mt-[2px] grid cursor-pointer grid-cols-[58px_2.4fr_1.7fr_1fr_132px] border-y-2 border-r-2 border-black outline-none transition-none focus-visible:border-l-black'
            : 'library-list-row group grid grid-cols-[58px_2.4fr_1.7fr_1fr_132px] cursor-pointer',
          isNeo &&
            isPlayingAlbum &&
            'relative z-10 border-l-4 border-l-black bg-[var(--signal-play)]',
          isNeo &&
            !isPlayingAlbum &&
            'border-l-4 border-l-transparent bg-white hover:z-10 hover:bg-[var(--neo-panel)]',
        )}
        role="button"
        tabIndex={0}
        onClick={() => onOpen(album.track)}
        onDoubleClick={() => onPlay(album.track)}
      >
        <div className="flex items-center justify-center">
          <span
            className={cn(
              isNeo
                ? 'text-black font-mono font-black text-[13px] tabular-nums'
                : 'text-text-subtle font-mono text-xs',
            )}
          >
            {idx + 1}
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-3 py-2">
          <div className="relative shrink-0">
            <CoverArtImage
              track={album.track}
              variant={isNeo ? 'album' : undefined}
              className={cn(isNeo ? 'h-12 w-12' : 'h-12 w-12')}
              imgClassName="h-full w-full object-cover"
              roundedClassName={isNeo ? '' : 'rounded-lg'}
              iconClassName="h-5 w-5"
              alt={album.track.album}
            />
          </div>
          <div className="min-w-0 pr-2">
            <div
              className={cn(
                'truncate',
                isNeo
                  ? 'font-black uppercase tracking-[0.05em] text-black text-[13px]'
                  : 'font-medium text-text-primary',
              )}
            >
              {renderHighlightedText(album.track.album, searchQuery, highlightClass)}
            </div>
            <div
              className={cn(
                'truncate mt-0.5',
                isNeo
                  ? 'text-[10px] font-bold uppercase tracking-[0.1em] text-black/60'
                  : 'text-xs text-text-muted',
              )}
            >
              {renderHighlightedText(album.track.artist, searchQuery, highlightClass)}
            </div>
          </div>
        </div>

        <div className="min-w-0 pr-4 py-2 flex flex-col justify-center">
          <div
            className={cn(
              'truncate',
              isNeo
                ? 'text-[11px] font-black uppercase tracking-[0.05em] text-black'
                : 'text-sm text-text-secondary',
            )}
          >
            {renderHighlightedText(album.track.artist, searchQuery, highlightClass)}
          </div>
        </div>

        <div className="min-w-0 py-2 flex flex-col justify-center">
          <div
            className={cn(
              'uppercase tracking-tight inline-flex self-start',
              isNeo
                ? 'border-2 border-black bg-[var(--neo-muted)] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] shadow-[4px_4px_0_0_#000]'
                : 'px-2 py-0.5 rounded-md text-[9px] font-bold border border-border/70 text-text-secondary',
            )}
          >
            {album.count} {album.count === 1 ? 'Track' : 'Tracks'}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pr-4 py-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onPlay(album.track);
            }}
            className={
              isNeo
                ? NEO_PLAY_ICON_BUTTON_CLASS
                : 'library-icon-action flex items-center justify-center p-2'
            }
            aria-label={`Play album ${album.track.album}`}
          >
            <Play size={14} fill="currentColor" strokeWidth={isNeo ? 3 : 2} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(album.track);
            }}
            className={
              isNeo
                ? NEO_ICON_BUTTON_CLASS
                : 'library-icon-action flex items-center justify-center p-2'
            }
            aria-label={`Open album ${album.track.album}`}
          >
            <Info size={16} strokeWidth={isNeo ? 2.5 : 2} />
          </button>
        </div>
      </div>
    </div>
  );
});

export interface LibraryAlbumsListProps {
  albums: AlbumGroup[];
  searchQuery: string;
  onOpen: (track: Track) => void;
  onPlay: (track: Track) => void;
  onLoadMore?: () => void;
  isNeo?: boolean;
  currentTrack?: Track | null;
  isPlaying?: boolean;
}

export const LibraryAlbumsList = memo(function LibraryAlbumsList({
  albums,
  searchQuery,
  onOpen,
  onPlay,
  onLoadMore,
  isNeo,
  currentTrack = null,
  isPlaying = false,
}: LibraryAlbumsListProps) {
  return (
    <div className={cn(!isNeo && 'library-list-shell', isNeo && 'h-full flex flex-col')}>
      <div
        className={cn(
          'library-list-head grid-cols-[58px_2.4fr_1.7fr_1fr_132px]',
          isNeo &&
            'sticky top-0 z-20 mx-0 border-b-2 border-black bg-[var(--neo-muted)] px-2 py-2.5 text-[11px] font-black uppercase tracking-[0.1em] text-black shadow-none',
        )}
      >
        <span className="text-center">#</span>
        <span>Album</span>
        <span>Artist</span>
        <span>Stats</span>
        <span className="text-right pr-4">Actions</span>
      </div>

      <VirtualizedList
        items={albums}
        itemHeight={ALBUM_ROW_HEIGHT}
        overscan={8}
        className="relative h-full overflow-y-auto overflow-x-hidden custom-scrollbar pt-2"
        getItemKey={(album) => `${album.track.album}-${album.track.artist}`}
        onScrollNearEnd={onLoadMore}
        renderItem={(album, idx) => (
          <AlbumRow
            key={`${album.track.album}-${album.track.artist}`}
            album={album}
            idx={idx}
            searchQuery={searchQuery}
            onOpen={onOpen}
            onPlay={onPlay}
            isNeo={isNeo}
            isPlayingAlbum={Boolean(
              isPlaying &&
                currentTrack &&
                currentTrack.album === album.track.album &&
                currentTrack.artist === album.track.artist,
            )}
          />
        )}
      />
    </div>
  );
});
