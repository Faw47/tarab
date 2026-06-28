import { memo } from 'react';
import { Info, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ArtistIcon } from '../ui/Icons';
import { CoverArtImage } from '../shared/CoverArtImage';
import { VirtualizedList } from '../shared/VirtualizedList';
import { renderHighlightedText } from './search-highlight';
import type { ArtistGroup } from './library-view-model';
import type { Track } from '../../types';
import './library-view.css';

const ARTIST_ROW_HEIGHT = 72;

const NEO_ICON_BTN =
  'flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center border-2 border-black bg-white p-0 text-black shadow-[4px_4px_0_0_#000] transition-none hover:bg-[#F5C518] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none';
const NEO_ICON_BTN_PLAY =
  'flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center border-2 border-black bg-[#F5C518] p-0 text-black shadow-[4px_4px_0_0_#000] transition-none hover:bg-[#FFE234] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none';

interface ArtistRowProps {
  artist: ArtistGroup;
  idx: number;
  searchQuery: string;
  onOpen: (artist: string) => void;
  onPlay: (track: Track) => void;
  isNeo?: boolean;
  isPlayingArtist?: boolean;
}

const ArtistRow = memo(function ArtistRow({
  artist,
  idx,
  searchQuery,
  onOpen,
  onPlay,
  isNeo,
  isPlayingArtist = false,
}: ArtistRowProps) {
  const leadTrack = artist.tracks[0];
  const highlightClass = isNeo
    ? 'rounded-none bg-[#E4C463] px-0.5 text-black'
    : 'rounded-[3px] bg-primary/35 px-0.5 text-inherit';

  return (
    <div className={cn(isNeo ? 'px-0 py-0' : 'px-2 py-0.5 border-b border-transparent')}>
      <div
        className={cn(
          isNeo
            ? 'group -mt-[2px] grid cursor-pointer grid-cols-[58px_4.1fr_1fr_132px] border-y-2 border-r-2 border-black outline-none transition-none focus-visible:border-l-black'
            : 'library-list-row group grid grid-cols-[58px_4.1fr_1fr_132px] cursor-pointer',
          isNeo && isPlayingArtist && 'relative z-10 border-l-4 border-l-black bg-[#7CC61F]',
          isNeo && !isPlayingArtist && 'border-l-4 border-l-transparent bg-white hover:z-10 hover:bg-[#F6F6F6]',
        )}
        role="button"
        tabIndex={0}
        onClick={() => onOpen(artist.artist)}
      >
        <div className="flex items-center justify-center">
          <span
            className={cn(isNeo ? 'text-black font-mono font-black text-[13px] tabular-nums' : 'text-text-subtle font-mono text-xs')}
          >
            {idx + 1}
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-3 py-2">
          {leadTrack ? (
            <CoverArtImage
              track={leadTrack}
              variant={isNeo ? 'artist' : undefined}
              className={cn(isNeo ? 'h-12 w-12' : 'h-12 w-12')}
              imgClassName="h-full w-full object-cover"
              roundedClassName={isNeo ? '' : 'rounded-lg'}
              iconClassName="h-6 w-6"
              alt={artist.artist}
            />
          ) : artist.coverArt ? (
            <div className={cn('neo-artist-avatar h-12 w-12 shrink-0 overflow-hidden bg-[#D1D1D1]', !isNeo && 'rounded-lg')}>
              <img
                src={artist.coverArt}
                alt={artist.artist}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
          ) : (
            <div
              className={cn(
                'flex shrink-0 items-center justify-center',
                isNeo ? 'neo-artist-avatar h-12 w-12 bg-[#D1D1D1] text-black' : 'h-12 w-12 rounded-lg bg-secondary/50 text-text-muted',
              )}
            >
              <ArtistIcon className="h-6 w-6" />
            </div>
          )}
          <div className="min-w-0 pr-2">
            <div
              className={cn(
                'truncate',
                isNeo ? 'font-black uppercase tracking-[0.05em] text-black text-[14px]' : 'font-medium text-text-primary text-[1.05rem]',
              )}
            >
              {renderHighlightedText(artist.artist, searchQuery, highlightClass)}
            </div>
          </div>
        </div>

        <div className="min-w-0 py-2 flex flex-col justify-center">
          <div
            className={cn(
              'uppercase tracking-tight inline-flex self-start',
              isNeo
                ? 'border-2 border-black bg-[#E6E6E6] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] shadow-[4px_4px_0_0_#000]'
                : 'px-2 py-0.5 rounded-md text-[9px] font-bold border border-border/70 text-text-secondary',
            )}
          >
            {artist.tracks.length} {artist.tracks.length === 1 ? 'Track' : 'Tracks'}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pr-4 py-2">
          {leadTrack && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPlay(leadTrack);
              }}
              className={isNeo ? NEO_ICON_BTN_PLAY : 'library-icon-action flex items-center justify-center p-2'}
              aria-label={`Play tracks by ${artist.artist}`}
            >
              <Play size={14} fill="currentColor" strokeWidth={isNeo ? 3 : 2} />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpen(artist.artist);
            }}
            className={isNeo ? NEO_ICON_BTN : 'library-icon-action flex items-center justify-center p-2'}
            aria-label={`Open artist ${artist.artist}`}
          >
            <Info size={16} strokeWidth={isNeo ? 2.5 : 2} />
          </button>
        </div>
      </div>
    </div>
  );
});

export interface LibraryArtistsListProps {
  artists: ArtistGroup[];
  searchQuery: string;
  onOpen: (artist: string) => void;
  onPlay: (track: Track) => void;
  onLoadMore?: () => void;
  isNeo?: boolean;
  currentTrack?: Track | null;
  isPlaying?: boolean;
}

export const LibraryArtistsList = memo(function LibraryArtistsList({
  artists,
  searchQuery,
  onOpen,
  onPlay,
  onLoadMore,
  isNeo,
  currentTrack = null,
  isPlaying = false,
}: LibraryArtistsListProps) {
  return (
    <div className={cn(!isNeo && 'library-list-shell', isNeo && 'h-full flex flex-col')}>
      <div
        className={cn(
          'library-list-head grid-cols-[58px_4.1fr_1fr_132px]',
          isNeo &&
            'sticky top-0 z-20 mx-0 border-b-2 border-black bg-[#E6E6E6] px-2 py-2.5 text-[11px] font-black uppercase tracking-[0.1em] text-black shadow-none',
        )}
      >
        <span className="text-center">#</span>
        <span>Artist</span>
        <span>Stats</span>
        <span className="text-right pr-4">Actions</span>
      </div>

      <VirtualizedList
        items={artists}
        itemHeight={ARTIST_ROW_HEIGHT}
        overscan={8}
        className="relative h-full overflow-y-auto overflow-x-hidden custom-scrollbar pt-2"
        getItemKey={(artist) => artist.artist}
        onScrollNearEnd={onLoadMore}
        renderItem={(artist, idx) => (
          <ArtistRow
            key={artist.artist}
            artist={artist}
            idx={idx}
            searchQuery={searchQuery}
            onOpen={onOpen}
            onPlay={onPlay}
            isNeo={isNeo}
            isPlayingArtist={
              Boolean(isPlaying && currentTrack && currentTrack.artist === artist.artist)
            }
          />
        )}
      />
    </div>
  );
});
