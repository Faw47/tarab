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
        'grid grid-cols-[40px_48px_1.5fr_1fr_1fr_60px_70px] gap-2 px-4 border-b border-white/[0.02] cursor-pointer items-center group transition-colors text-sm',
        isSelected ? 'bg-primary/10' : 'hover:bg-white/5',
        isFocused && 'ring-1 ring-inset ring-primary/60',
      )}
      style={{ height }}
    >
      <button
        type="button"
        className="mx-auto flex h-7 w-7 items-center justify-center rounded-md text-xs text-text-subtle hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`${isSelected ? 'Deselect' : 'Select'} ${track.title}`}
        aria-pressed={isSelected}
        onClick={(event) => {
          event.stopPropagation();
          onSelect(event);
        }}
      >
        {index + 1}
      </button>
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
      <div className="min-w-0 pr-4">
        <div
          className={clsx(
            'font-medium truncate',
            isSelected ? 'text-primary' : 'text-text-primary',
          )}
        >
          {track.title}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {isLossless && <span className="text-xs text-primary font-bold uppercase">{format}</span>}
          {!track.hasCoverArt && (
            <span className="text-xs text-amber-400 font-bold uppercase flex items-center gap-1">
              <ImageOff className="w-3 h-3" aria-hidden="true" /> no cover
            </span>
          )}
        </div>
      </div>
      <div className="text-text-secondary truncate pr-4">{track.artist}</div>
      <div className="text-text-muted truncate pr-4">{track.album}</div>
      <div className="text-text-muted text-right">{track.year || '-'}</div>
      <div className="text-text-muted text-right font-mono text-xs">
        {formatTime(track.duration)}
      </div>
    </div>
  );
}
