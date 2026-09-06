import { clsx } from 'clsx';
import { ImageOff } from 'lucide-react';
import { formatTime } from '../../lib/format-time';
import type { ContextMenuPosition, Track } from '../../types';
import { CoverArtImage } from '../shared/CoverArtImage';
import { formatQuality } from './tag-manager-model';

interface TagManagerTrackRowProps {
  track: Track;
  index: number;
  height: number;
  isSelected: boolean;
  isFocused: boolean;
  onSelect: (event: React.MouseEvent) => void;
  onContextMenu?: (track: Track, position: ContextMenuPosition) => void;
  onReplaceSelection: (tracks: Track[]) => void;
}

export function TagManagerTrackRow({
  track,
  index,
  height,
  isSelected,
  isFocused,
  onSelect,
  onContextMenu,
  onReplaceSelection,
}: TagManagerTrackRowProps) {
  const { format, isLossless } = formatQuality(track);

  return (
    <div
      id={`tag-manager-track-${track.id}`}
      role="option"
      aria-selected={isSelected}
      onClick={onSelect}
      onContextMenu={(event) => {
        event.preventDefault();
        if (!isSelected) onReplaceSelection([track]);
        onContextMenu?.(track, { x: event.clientX, y: event.clientY });
      }}
      className={clsx(
        'grid grid-cols-[32px_40px_minmax(0,1fr)] sm:grid-cols-[40px_48px_1.5fr_1fr_1fr_60px_70px] gap-2 px-4 border-b border-white/[0.02] cursor-pointer items-center group transition-colors text-sm',
        isSelected ? 'bg-primary/10' : 'hover:bg-white/5',
        isFocused && 'ring-1 ring-inset ring-primary/60',
      )}
      style={{ height }}
    >
      <span
        aria-hidden="true"
        className="mx-auto flex h-7 w-7 items-center justify-center rounded-md text-xs text-text-subtle"
      >
        {index + 1}
      </span>
      <div className="w-9 h-9 rounded bg-white/5 overflow-hidden border border-white/5">
        <CoverArtImage
          track={track}
          className="w-full h-full"
          imgClassName="w-full h-full object-cover"
          roundedClassName=""
          iconClassName="w-4 h-4"
          alt={track.album}
        />
      </div>
      <div className="min-w-0 pr-0 sm:pr-4">
        <div className={clsx('font-medium truncate', 'text-foreground')}>{track.title}</div>
        <div className="flex min-w-0 items-center gap-2 mt-0.5">
          <span
            className="tag-manager-mobile-meta min-w-0 flex-1 truncate text-xs text-text-muted sm:hidden"
            title={[track.artist, track.album].filter(Boolean).join(' / ') || 'Unknown track'}
          >
            {[track.artist, track.album].filter(Boolean).join(' / ') || 'Unknown track'}
          </span>
          {isLossless && (
            <span className="shrink-0 text-xs text-foreground font-bold uppercase">{format}</span>
          )}
          {!track.hasCoverArt && (
            <span className="shrink-0 text-xs text-foreground font-bold uppercase flex items-center gap-1">
              <ImageOff className="w-3 h-3" aria-hidden="true" /> no cover
            </span>
          )}
        </div>
      </div>
      <div className="hidden text-text-secondary truncate pr-4 sm:block">{track.artist}</div>
      <div className="hidden text-text-muted-strong truncate pr-4 sm:block">{track.album}</div>
      <div className="hidden text-text-muted-strong text-right sm:block">{track.year || '-'}</div>
      <div className="hidden text-text-muted-strong text-right font-mono text-xs sm:block">
        {formatTime(track.duration)}
      </div>
    </div>
  );
}
