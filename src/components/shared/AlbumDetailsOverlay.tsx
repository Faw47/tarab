import {
  Calendar,
  CheckSquare,
  Clock,
  Edit3,
  FolderOpen,
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
  type ButtonHTMLAttributes,
  type ComponentType,
  type CSSProperties,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useColorExtraction } from '../../hooks/use-color-extraction';
import { getCoverArtBlobFallback, useCoverArt } from '../../hooks/useCoverArt';
import { useEffectiveReducedEffects } from '../../hooks/useEffectiveReducedEffects';
import { formatTime } from '../../lib/format-time';
import { reportError } from '../../lib/report-error';
import type { Track } from '../../types';
import { PlaylistPickerDialog } from '../playlist/PlaylistPickerDialog';
import { Button } from '../ui/button';
import { QueueIcon as ListMusic, TrackIcon } from '../ui/Icons';
import { cn, GlassCard } from '../ui/liquid-glass';
import { useAlbumTrackSelection } from './useAlbumTrackSelection';

// ============================================================================
// CONSTANTS & ANIMATIONS
// ============================================================================

const TRACK_GRID =
  'grid grid-cols-[36px_40px_1fr_64px] md:grid-cols-[40px_48px_1fr_90px] items-center gap-3';

const OVERLAY_KEYFRAMES = `
@keyframes adl-toolbar-up {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes adl-wave {
  0%   { transform: scaleY(0.4); }
  50%  { transform: scaleY(1.0); }
  100% { transform: scaleY(0.7); }
}
`;

const luminanceCache = new Map<string, number>();

// ============================================================================
// HELPERS
// ============================================================================

function withAlpha(color: string, alphaHex: string): string {
  const trimmed = color.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) {
    return `${trimmed.slice(0, 7)}${alphaHex}`;
  }
  const alphaPct = ((parseInt(alphaHex, 16) / 255) * 100).toFixed(1);
  return `color-mix(in srgb, ${trimmed} ${alphaPct}%, transparent)`;
}

function getRelativeLuminance(color: string): number {
  if (luminanceCache.has(color)) return luminanceCache.get(color)!;

  const parseRgbChannel = (value: string): number | null => {
    const token = value.trim();
    if (!token) return null;
    if (token.endsWith('%')) {
      const pct = Number.parseFloat(token.slice(0, -1));
      if (!Number.isFinite(pct)) return null;
      return Math.max(0, Math.min(255, Math.round((pct / 100) * 255)));
    }
    const val = Number.parseInt(token, 10);
    return Number.isFinite(val) ? Math.max(0, Math.min(255, val)) : null;
  };

  const getRgbFromStyle = (colorStr: string): [number, number, number] | null => {
    if (typeof document === 'undefined') return null;
    const probe = document.createElement('div');
    probe.style.color = colorStr;
    probe.style.display = 'none';
    document.body.appendChild(probe);
    const computed = getComputedStyle(probe).color;
    document.body.removeChild(probe);
    const match = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    return match ? [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)] : null;
  };

  let r = 0,
    g = 0,
    b = 0;
  const hexMatch = color.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
  if (hexMatch) {
    r = parseInt(hexMatch[1], 16);
    g = parseInt(hexMatch[2], 16);
    b = parseInt(hexMatch[3], 16);
  } else {
    const rgbMatch = color.match(/rgba?\((\d+%?),?\s*(\d+%?),?\s*(\d+%?)/);
    if (rgbMatch) {
      r = parseRgbChannel(rgbMatch[1]) ?? 0;
      g = parseRgbChannel(rgbMatch[2]) ?? 0;
      b = parseRgbChannel(rgbMatch[3]) ?? 0;
    } else {
      const fallback = getRgbFromStyle(color);
      if (fallback) [r, g, b] = fallback;
    }
  }

  const sR = r / 255,
    sG = g / 255,
    sB = b / 255;
  const L =
    0.2126 * (sR <= 0.03928 ? sR / 12.92 : ((sR + 0.055) / 1.055) ** 2.4) +
    0.7152 * (sG <= 0.03928 ? sG / 12.92 : ((sG + 0.055) / 1.055) ** 2.4) +
    0.0722 * (sB <= 0.03928 ? sB / 12.92 : ((sB + 0.055) / 1.055) ** 2.4);

  luminanceCache.set(color, L);
  return L;
}

function useLongPress(callback: () => void, delay = 500) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onStart = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      callback();
      timerRef.current = null;
    }, delay);
  };
  const onEnd = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  return {
    onMouseDown: onStart,
    onMouseUp: onEnd,
    onMouseLeave: onEnd,
    onTouchStart: onStart,
    onTouchEnd: onEnd,
  };
}

type LongPressHandlers = ReturnType<typeof useLongPress>;

// ============================================================================
// TYPES
// ============================================================================

export interface AlbumDetailsOverlayProps {
  album: string;
  artist: string;
  coverArt?: string;
  tracks: Track[];
  onClose: () => void;
  onPlayAlbum?: () => Promise<void> | void;
  onPlayTrack?: (track: Track) => Promise<void> | void;
  onOpenTrackDetails?: (track: Track, onPlay?: () => Promise<void> | void) => void;
  onTrackContextMenu?: (e: React.MouseEvent, track: Track) => void;
  selectedTrackIds?: string[];
  onTrackSelect?: (track: Track, isMulti: boolean) => void;
  onClearSelection?: () => void;
  onSelectAll?: (tracks: Track[]) => void;
  onOpenTagEditor?: (tracks: Track[]) => void;
  onAddToQueue?: (tracks: Track[]) => void;
  onAddToPlaylist?: (tracks: Track[]) => void;
  onRevealInFinder?: (track: Track) => void;
  onDeleteTracks?: (tracks: Track[]) => void;
  onShuffleAlbum?: () => void;
  currentlyPlayingId?: string;
  isPlaying?: boolean;
  onScrollChange?: (scrolled: boolean) => void;
}

// ============================================================================
// SUBCOMPONENTS
// ============================================================================

const useResolvedCoverArt = (src: string | undefined, track: Track | null) => {
  const [resolvedSrc, setResolvedSrc] = useState<string | undefined>(src);
  const [error, setError] = useState(false);

  const resolvedSrcRef = useRef(resolvedSrc);
  useEffect(() => {
    resolvedSrcRef.current = resolvedSrc;
  }, [resolvedSrc]);

  useEffect(() => {
    setResolvedSrc(src);
    setError(false);
  }, [src]);

  const handleError = useCallback(async () => {
    if (resolvedSrcRef.current?.startsWith('cover-art://') && track?.coverArtHash) {
      try {
        const blobUrl = await getCoverArtBlobFallback(track.coverArtHash, 'large');
        if (blobUrl) {
          setResolvedSrc(blobUrl);
          return;
        }
      } catch (err) {
        reportError('Failed to load thumbnail via IPC', {
          source: 'album-details-overlay',
          error: err,
        });
      }
    }
    setError(true);
  }, [track]);

  return { resolvedSrc, error, handleError };
};

const WAVE_BARS = [
  { h: 7, dur: '0.72s', delay: '0ms' },
  { h: 13, dur: '0.96s', delay: '110ms' },
  { h: 5, dur: '0.64s', delay: '52ms' },
] as const;

const WaveformBars = memo(
  ({ color, reducedEffects }: { color: string; reducedEffects: boolean }) => (
    <div role="status" aria-label="Now playing" className="flex gap-0.5 items-end h-3.5">
      {WAVE_BARS.map((bar, i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{
            width: 2.5,
            height: bar.h,
            backgroundColor: color,
            borderRadius: 1.5,
            transformOrigin: 'bottom center',
            ...(reducedEffects
              ? { transform: `scaleY(${[0.65, 0.9, 0.55][i]})` }
              : {
                  animation: `adl-wave ${bar.dur} ease-in-out ${bar.delay} infinite alternate`,
                }),
          }}
        />
      ))}
    </div>
  ),
);
WaveformBars.displayName = 'WaveformBars';

const MetadataPill = memo(function MetadataPill({
  icon: Icon,
  label,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  label: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium text-white/85"
      style={{
        backgroundColor: 'rgba(0,0,0,0.35)',
        border: '1px solid rgba(255,255,255,0.14)',
        backdropFilter: 'blur(4px)',
      }}
    >
      <Icon className="w-3 h-3" strokeWidth={1.75} />
      {label}
    </span>
  );
});
MetadataPill.displayName = 'MetadataPill';

const MenuButton = ({
  icon: Icon,
  label,
  onClick,
  danger,
  disabled,
  badge,
  flash,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  badge?: string;
  flash?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={cn(
      'w-full flex items-center gap-3 px-3 py-2.5 text-sm transition-colors text-left rounded-lg',
      disabled && 'opacity-50 cursor-not-allowed',
      flash
        ? 'bg-emerald-500/10 text-emerald-400'
        : danger
          ? 'text-red-400 hover:bg-red-400/10 hover:text-red-300'
          : 'text-text-secondary hover:text-white hover:bg-white/10',
    )}
  >
    <Icon className="w-4 h-4 shrink-0" />
    <span className="flex-1 leading-none">{label}</span>
    {badge && (
      <span className="text-[12px] font-bold tabular-nums px-1.5 py-0.5 rounded-full bg-white/[0.08] text-white/40">
        {badge}
      </span>
    )}
  </button>
);

const ToolbarButton = ({
  icon: Icon,
  label,
  onClick,
  danger,
  disabled,
  reducedEffects,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  reducedEffects: boolean;
}) => (
  <Button
    onClick={onClick}
    disabled={disabled}
    reducedEffects={reducedEffects}
    variant={danger ? 'danger' : 'default'}
    className={cn(
      'min-w-[64px] sm:min-w-[70px] rounded-[1.25rem] px-2 sm:px-3 py-2.5 sm:py-2',
      disabled && 'opacity-55',
    )}
    contentClassName="flex flex-col items-center gap-1 text-[12px] font-semibold tracking-[0.12em] uppercase"
    aria-label={label}
    title={label}
  >
    <Icon className="w-5 h-5 sm:w-4 sm:h-4" />
    <span className="hidden sm:inline-block">{label}</span>
  </Button>
);

const OverlayIconButton = ({
  icon: Icon,
  label,
  reducedEffects,
  size = 'lg',
  className,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  icon: ComponentType<{ className?: string }>;
  label: string;
  reducedEffects: boolean;
  size?: 'sm' | 'md' | 'lg';
}) => (
  <Button
    reducedEffects={reducedEffects}
    className={cn(
      'rounded-full shrink-0',
      size === 'sm' ? 'h-10 w-10' : size === 'md' ? 'h-11 w-11' : 'h-14 w-14',
      className,
    )}
    contentClassName="flex items-center justify-center"
    aria-label={label}
    title={label}
    {...props}
  >
    <Icon className={cn(size === 'lg' ? 'w-6 h-6' : 'w-5 h-5')} />
  </Button>
);

const OverlayPlayButton = ({
  label,
  reducedEffects,
  accentColor,
  accentForeground,
  compact = false,
  className,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: string;
  reducedEffects: boolean;
  accentColor: string;
  accentForeground: string;
  compact?: boolean;
}) => (
  <Button
    reducedEffects={reducedEffects}
    variant="primary"
    accentColor={accentColor}
    accentForeground={accentForeground}
    className={cn('rounded-full shrink-0', compact ? 'h-11 px-5' : 'h-14 px-8', className)}
    contentClassName={cn(
      'flex items-center',
      compact
        ? 'gap-2 text-sm font-semibold tracking-[0.03em]'
        : 'gap-3 text-base sm:text-lg font-bold tracking-[0.01em]',
    )}
    {...props}
  >
    <Play className={cn(compact ? 'w-4 h-4' : 'w-5 h-5', 'fill-current')} />
    <span>{label}</span>
  </Button>
);

const TrackRow = memo(
  ({
    track,
    idx,
    isSelected,
    isCurrentTrack,
    isPlayingNow,
    selectionActive,
    reducedEffects,
    albumInk,
    onTrackSelect,
    onPlayTrack,
    onOpenTrackDetails,
    onTrackContextMenu,
    longPressHandlers,
    longPressTrackRef,
    inkTextColor,
    trackGridClass,
  }: {
    track: Track;
    idx: number;
    isSelected: boolean;
    isCurrentTrack: boolean;
    isPlayingNow: boolean;
    selectionActive: boolean;
    reducedEffects: boolean;
    albumInk: string;
    onTrackSelect?: (track: Track, isMulti: boolean) => void;
    onPlayTrack?: (track: Track) => void;
    onOpenTrackDetails?: (track: Track, onPlay?: () => Promise<void> | void) => void;
    onTrackContextMenu?: (e: React.MouseEvent, track: Track) => void;
    longPressHandlers: LongPressHandlers;
    longPressTrackRef: React.MutableRefObject<Track | null>;
    inkTextColor: string;
    trackGridClass: string;
  }) => {
    return (
      <div
        role="row"
        tabIndex={0}
        aria-selected={isSelected}
        aria-label={`${track.title} by ${track.artist}${isPlayingNow ? ', now playing' : ''}`}
        onClick={(e) => {
          if (e.shiftKey || e.metaKey || e.ctrlKey) {
            onTrackSelect?.(track, true);
          } else if (onOpenTrackDetails) {
            onOpenTrackDetails?.(track, () => onPlayTrack?.(track));
          }
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          onPlayTrack?.(track);
        }}
        onMouseDown={() => {
          longPressTrackRef.current = track;
          longPressHandlers.onMouseDown();
        }}
        onMouseUp={longPressHandlers.onMouseUp}
        onMouseLeave={longPressHandlers.onMouseLeave}
        onTouchStart={() => {
          longPressTrackRef.current = track;
          longPressHandlers.onTouchStart();
        }}
        onTouchEnd={longPressHandlers.onTouchEnd}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onPlayTrack?.(track);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onTrackContextMenu?.(e, track);
        }}
        className={cn(
          trackGridClass,
          'px-4 sm:px-6 py-3 group relative cursor-pointer',
          'transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-emphasis)] ease-out',
          !reducedEffects && 'adl-track-row',
          isSelected ? 'bg-[var(--adl-ink)]/[0.2]' : '',
          isCurrentTrack
            ? 'rounded-xl border border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)] my-0.5 mx-2'
            : 'hover:bg-white/[0.06]',
          !isCurrentTrack && 'border-b border-white/[0.08] last:border-0',
          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset',
        )}
        style={{
          ...(isCurrentTrack
            ? {
                backgroundColor: withAlpha(albumInk, '20'),
                backdropFilter: reducedEffects ? 'blur(8px)' : 'blur(16px)',
                ['--tw-ring-color' as string]: albumInk,
              }
            : {}),
          ...(!reducedEffects && !isCurrentTrack
            ? { animationDelay: `${Math.min(idx * 16, 280)}ms` }
            : undefined),
        }}
      >
        <div role="cell" className="flex justify-center h-4 w-4">
          {selectionActive && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTrackSelect?.(track, true);
              }}
              aria-label={isSelected ? `Deselect ${track.title}` : `Select ${track.title}`}
              className={cn(
                'transition-colors',
                isSelected ? 'text-primary' : 'text-text-muted/70 hover:text-white',
              )}
              style={isSelected ? { color: inkTextColor } : undefined}
            >
              {isSelected ? <CheckSquare className="w-4 h-4" /> : <Square className="h-4 w-4" />}
            </button>
          )}
        </div>

        <div
          role="cell"
          className="relative flex items-center justify-center w-full h-full text-sm font-medium text-white/60"
        >
          {isPlayingNow ? (
            <WaveformBars color={inkTextColor} reducedEffects={reducedEffects} />
          ) : (
            <>
              <span
                className={cn(
                  'font-mono tabular-nums transition-opacity duration-[var(--motion-fast)]',
                  isCurrentTrack ? 'opacity-0' : 'group-hover:opacity-0',
                )}
                style={{ color: isCurrentTrack ? inkTextColor : undefined }}
                aria-hidden="true"
              >
                {idx + 1}
              </span>
              <div
                className={cn(
                  'absolute inset-0 flex items-center justify-center transition-opacity duration-[var(--motion-fast)]',
                  isCurrentTrack ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
                )}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onPlayTrack?.(track);
                  }}
                  aria-label={`Play ${track.title}`}
                  className="flex h-7 w-7 items-center justify-center rounded-full shadow-md transition-[transform,box-shadow] duration-[var(--motion-fast)] hover:scale-110 active:scale-90"
                  style={
                    isCurrentTrack
                      ? {
                          backgroundColor: albumInk,
                          color: 'black',
                          boxShadow: `0 0 18px ${withAlpha(albumInk, '50')}`,
                        }
                      : {
                          backgroundColor: 'white',
                          color: 'black',
                          boxShadow: '0 2px 14px rgba(0,0,0,0.35)',
                        }
                  }
                >
                  <Play className="w-3.5 h-3.5 ml-0.5 fill-current" />
                </button>
              </div>
            </>
          )}
        </div>

        <div role="cell" className="flex flex-col min-w-0 pr-4">
          <span
            className={cn(
              'text-[0.9375rem] font-bold truncate tracking-tight mb-0.5',
              isCurrentTrack ? 'text-white' : 'text-text-primary',
            )}
          >
            {track.title}
          </span>
          <span className="text-[0.8125rem] text-text-muted/80 truncate font-semibold tracking-normal">
            {track.artist}
          </span>
        </div>

        <div role="cell" className="flex items-center justify-end gap-3 text-right">
          <span className="text-[0.8125rem] font-mono font-medium text-text-muted/60 tabular-nums">
            {formatTime(track.duration)}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTrackContextMenu?.(e, track);
            }}
            className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-white/10 rounded-lg transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom]"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  },
);
TrackRow.displayName = 'TrackRow';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const AlbumDetailsOverlay = memo(
  ({
    album,
    artist,
    coverArt,
    tracks,
    onClose: _onClose,
    onPlayAlbum,
    onPlayTrack,
    onOpenTrackDetails,
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
    currentlyPlayingId,
    isPlaying: isCurrentlyPlaying,
    onScrollChange,
  }: AlbumDetailsOverlayProps) => {
    const totalDuration = useMemo(
      () => tracks.reduce((acc, t) => acc + (t.duration || 0), 0),
      [tracks],
    );

    const coverTrack = useMemo(() => tracks[0] ?? null, [tracks]);
    const releaseYear = useMemo(() => tracks.find((t) => t.year)?.year ?? null, [tracks]);

    const hookResolvedCoverArt = useCoverArt(
      coverTrack?.filePath ?? '',
      coverTrack?.hasCoverArt ?? false,
      true,
      'large',
      coverTrack?.coverArtHash ?? undefined,
    );

    const initialCover = coverArt ?? hookResolvedCoverArt ?? undefined;
    const {
      resolvedSrc: heroArt,
      error: heroArtError,
      handleError,
    } = useResolvedCoverArt(initialCover, coverTrack);
    const hasHeroArt = Boolean(heroArt && !heroArtError);

    const colors = useColorExtraction(coverTrack?.filePath ?? null);
    const reducedEffects = useEffectiveReducedEffects();

    const albumInk = colors.primary || 'rgba(255,255,255,0.88)';
    const albumBg = colors.background || '#0c0c0c';
    const inkTextColor = getRelativeLuminance(albumInk) > 0.5 ? '#0a0a0a' : '#ffffff';

    const bgLuminance = useMemo(() => getRelativeLuminance(albumBg), [albumBg]);
    const gradientDarkStop = bgLuminance > 0.5 ? 0.85 : 0.56;

    const cssVars = useMemo<CSSProperties>(
      () =>
        ({
          '--adl-ink': colors.primary || 'rgba(255,255,255,0.88)',
          '--adl-soft': colors.secondary || 'rgba(255,255,255,0.5)',
          '--adl-surface': colors.background || '#0c0c0c',
        }) as CSSProperties,
      [colors.primary, colors.secondary, colors.background],
    );

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
    useEffect(() => {
      const id = 'adl-overlay-kf';
      if (document.getElementById(id)) return;
      const style = document.createElement('style');
      style.id = id;
      style.textContent = OVERLAY_KEYFRAMES;
      document.head.appendChild(style);
    }, []);

    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const heroSectionRef = useRef<HTMLDivElement>(null);
    const stickyHeaderRef = useRef<HTMLDivElement>(null);
    const stickyHeaderInnerRef = useRef<HTMLDivElement>(null);
    const heroHeightRef = useRef(320);
    const rafRef = useRef<number | null>(null);

    useEffect(() => {
      const el = heroSectionRef.current;
      if (!el) return;
      const ro = new ResizeObserver(([entry]) => {
        heroHeightRef.current = entry.contentRect.height || 320;
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, []);

    useEffect(() => {
      const container = scrollContainerRef.current;
      if (!container) return;

      const handleScroll = () => {
        if (rafRef.current !== null) return;
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null;
          const progress = Math.min(container.scrollTop / Math.max(heroHeightRef.current, 1), 1);
          const headerOpacity = Math.min(Math.max((progress - 0.55) / 0.35, 0), 1);
          const headerVisible = headerOpacity > 0.85;

          if (stickyHeaderRef.current) {
            stickyHeaderRef.current.style.opacity = headerOpacity.toString();
            stickyHeaderRef.current.style.pointerEvents = headerVisible ? 'auto' : 'none';
            stickyHeaderRef.current.style.backgroundColor = headerVisible
              ? 'rgba(8,8,8,0.45)'
              : 'transparent';
            stickyHeaderRef.current.style.borderColor = headerVisible
              ? 'rgba(255,255,255,0.1)'
              : 'transparent';
            stickyHeaderRef.current.style.backdropFilter = headerVisible
              ? reducedEffects
                ? 'blur(6px)'
                : 'blur(16px)'
              : 'none';
          }

          if (stickyHeaderInnerRef.current) {
            stickyHeaderInnerRef.current.style.opacity = headerVisible ? '1' : '0';
            stickyHeaderInnerRef.current.style.transform = headerVisible
              ? 'translateY(0)'
              : 'translateY(8px)';
          }
          onScrollChange?.(container.scrollTop > 8);
        });
      };

      handleScroll();
      container.addEventListener('scroll', handleScroll, { passive: true });
      return () => {
        container.removeEventListener('scroll', handleScroll);
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      };
    }, [reducedEffects, onScrollChange]);

    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);
    const [flashedAction, setFlashedAction] = useState<string | null>(null);
    const flashTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const isMountedRef = useRef(true);
    useEffect(() => {
      return () => {
        isMountedRef.current = false;
        if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
      };
    }, []);

    const [playlistPickerIds, setPlaylistPickerIds] = useState<string[] | null>(null);

    const flashAction = useCallback((action: string) => {
      setFlashedAction(action);
      if (flashTimeoutRef.current) clearTimeout(flashTimeoutRef.current);
      flashTimeoutRef.current = setTimeout(() => {
        if (isMountedRef.current) setFlashedAction(null);
      }, 600);
    }, []);

    const openPlaylistPicker = useCallback(
      (target: Track[]) => {
        if (target.length === 0) return;
        if (onAddToPlaylist) {
          onAddToPlaylist(target);
          setMenuOpen(false);
          flashAction('playlist');
          return;
        }
        setPlaylistPickerIds(target.map((t) => t.id));
        setMenuOpen(false);
        flashAction('playlist');
      },
      [flashAction, onAddToPlaylist],
    );

    const closePlaylistPicker = useCallback(() => setPlaylistPickerIds(null), []);

    useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
      };
      if (menuOpen) document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [menuOpen]);

    const longPressTrackRef = useRef<Track | null>(null);
    const longPressHandlers = useLongPress(() => {
      const track = longPressTrackRef.current;
      if (track) {
        activateSelection();
        onTrackSelect?.(track, false);
      }
    });

    const handleAddToQueueAction = useCallback(() => {
      if (targetTracks.length > 0 && onAddToQueue) {
        onAddToQueue(targetTracks);
        setMenuOpen(false);
        flashAction('queue');
      }
    }, [flashAction, targetTracks, onAddToQueue]);

    const handleOpenTagsAction = useCallback(() => {
      if (targetTracks.length > 0 && onOpenTagEditor) {
        onOpenTagEditor(targetTracks);
        setMenuOpen(false);
      }
    }, [targetTracks, onOpenTagEditor]);

    const handleOpenLyricsAction = useCallback(() => {
      if (targetTracks.length > 0 && onOpenTagEditor) {
        onOpenTagEditor([targetTracks[0]]);
        setMenuOpen(false);
      }
    }, [targetTracks, onOpenTagEditor]);

    const handleRevealAction = useCallback(() => {
      if (targetTracks[0] && onRevealInFinder) {
        onRevealInFinder(targetTracks[0]);
        setMenuOpen(false);
      }
    }, [targetTracks, onRevealInFinder]);

    const handleDeleteSelected = useCallback(() => {
      if (selectedTracks.length > 0 && onDeleteTracks) {
        onDeleteTracks(selectedTracks);
        setMenuOpen(false);
      }
    }, [selectedTracks, onDeleteTracks]);

    const canPlayAlbum = Boolean(onPlayAlbum && tracks.length > 0);
    const canShuffleAlbum = Boolean(onShuffleAlbum && tracks.length > 0);

    return (
      <div
        className={cn(
          'relative h-full w-full text-text-primary overflow-hidden bg-transparent',
          !reducedEffects && 'animate-fade-in',
        )}
        style={cssVars}
      >
        <div
          className="absolute inset-0 pointer-events-none overflow-hidden"
          style={{ backgroundColor: albumBg }}
        >
          {hasHeroArt && (
            <>
              <img
                src={heroArt}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 w-full h-full object-cover object-center"
                style={{
                  transform: reducedEffects ? 'scale(1.03)' : 'scale(1.08)',
                  opacity: reducedEffects ? 0.44 : 0.58,
                }}
              />
              {!reducedEffects && (
                <img
                  src={heroArt}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full object-cover object-center opacity-10"
                  style={{ transform: 'scale(1.10)', filter: 'blur(50px)' }}
                />
              )}
            </>
          )}
          <div
            className="absolute inset-0 mix-blend-screen opacity-40"
            style={{
              background: `radial-gradient(120% 70% at 18% 0%, rgba(255,255,255,0.2) 0%, transparent 64%), radial-gradient(100% 100% at 50% 50%, ${withAlpha(albumInk, '12')} 0%, transparent 70%)`,
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(180deg, rgba(0,0,0,0.2) 0%, rgba(0,0,0,${gradientDarkStop}) 100%)`,
            }}
          />
        </div>

        <div
          ref={stickyHeaderRef}
          className="absolute top-0 left-0 right-0 z-30 border-b border-transparent h-16 md:h-20 transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-standard)] opacity-0 pointer-events-none"
        >
          <div className="flex items-center justify-between px-6 h-full">
            <div className="flex items-center gap-4 pointer-events-auto w-full">
              <span className="h-10 w-10 shrink-0" aria-hidden="true" />
              {hasHeroArt && (
                <div className="hidden sm:block w-8 h-8 rounded-lg overflow-hidden shrink-0 shadow-md">
                  <img src={heroArt} alt="" className="w-full h-full object-cover" />
                </div>
              )}
              <div
                ref={stickyHeaderInnerRef}
                className="transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-emphasis)] opacity-0 translate-y-2 flex items-center justify-between flex-1 gap-4"
              >
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-lg leading-tight truncate max-w-sm">{album}</h3>
                  <p className="text-xs text-text-muted/90 truncate">{artist}</p>
                </div>
                <div className="hidden md:flex items-center gap-2">
                  <OverlayIconButton
                    icon={Shuffle}
                    label="Shuffle"
                    onClick={onShuffleAlbum}
                    disabled={!canShuffleAlbum}
                    reducedEffects={reducedEffects}
                    size="sm"
                  />
                  <OverlayPlayButton
                    label="Play"
                    onClick={() => onPlayAlbum?.()}
                    disabled={!canPlayAlbum}
                    reducedEffects={reducedEffects}
                    accentColor={albumInk}
                    accentForeground={inkTextColor}
                    compact
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          ref={scrollContainerRef}
          className="relative h-full overflow-y-auto custom-scrollbar pt-6 pb-44"
        >
          <div className="max-w-7xl mx-auto px-4 sm:px-8">
            <div className="pointer-events-none mb-4">
              <span className="block h-10 w-10" aria-hidden="true" />
            </div>

            <div
              ref={heroSectionRef}
              className="flex flex-col md:flex-row gap-8 md:gap-10 items-start md:items-end mb-12"
            >
              <div className="relative group shrink-0 mx-auto md:mx-0">
                <GlassCard
                  intensity="deep"
                  radius={24}
                  className="w-48 h-48 sm:w-56 sm:h-56 md:w-60 md:h-60 lg:w-72 lg:h-72 shadow-2xl relative z-10"
                >
                  {heroArt ? (
                    <img
                      src={heroArt}
                      alt={album}
                      onError={handleError}
                      className="w-full h-full object-cover"
                    />
                  ) : !heroArtError ? (
                    <div className="w-full h-full bg-white/[0.06] animate-pulse rounded-[inherit]" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-white/5">
                      <TrackIcon className="w-20 h-20 text-white/20" />
                    </div>
                  )}
                </GlassCard>
                {!reducedEffects && (
                  <div
                    className="absolute inset-0 rounded-[2rem] blur-3xl opacity-55 translate-y-4 scale-[0.92] -z-10"
                    style={{ background: albumInk }}
                  />
                )}
              </div>
              <div className="flex-1 min-w-0 pb-2 text-center md:text-left">
                <span className="text-xs font-bold tracking-[0.2em] uppercase text-white/80 mb-2 block">
                  Album
                </span>
                <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-7xl font-bold text-white leading-tight mb-2 font-display drop-shadow-lg truncate">
                  {album}
                </h1>
                <div className="flex items-center justify-center md:justify-start gap-2 mb-3 text-sm">
                  <span className="font-semibold text-white/90 truncate">{artist}</span>
                </div>
                <div className="flex flex-wrap items-center justify-center md:justify-start gap-1.5 mb-5">
                  {releaseYear && <MetadataPill icon={Calendar} label={String(releaseYear)} />}
                  <MetadataPill icon={ListMusic} label={`${tracks.length} songs`} />
                  <MetadataPill icon={Clock} label={formatTime(totalDuration)} />
                </div>
                <div className="flex items-center justify-center md:justify-start gap-3 sm:gap-4">
                  <OverlayPlayButton
                    label="Play"
                    onClick={() => onPlayAlbum?.()}
                    disabled={!canPlayAlbum}
                    reducedEffects={reducedEffects}
                    accentColor={albumInk}
                    accentForeground={inkTextColor}
                  />
                  <OverlayIconButton
                    icon={Shuffle}
                    label="Shuffle"
                    onClick={onShuffleAlbum}
                    disabled={!canShuffleAlbum}
                    reducedEffects={reducedEffects}
                    size="lg"
                  />
                  <div className="relative" ref={menuRef}>
                    <OverlayIconButton
                      icon={MoreHorizontal}
                      label="Actions"
                      onClick={() => setMenuOpen(!menuOpen)}
                      reducedEffects={reducedEffects}
                      size="lg"
                    />
                    {menuOpen && (
                      <div className="absolute right-0 md:left-0 md:right-auto top-full mt-4 w-64 bg-[#121212]/90 backdrop-blur-2xl rounded-2xl border border-white/10 shadow-2xl p-1 z-50 animate-fade-in origin-top">
                        {selectionActive && (
                          <div className="px-3 py-2 text-xs font-bold text-white/50 uppercase tracking-wider">
                            {selectedCount} Selected
                          </div>
                        )}
                        {!selectionActive && (
                          <MenuButton
                            icon={CheckSquare}
                            label="Select Tracks"
                            onClick={() => {
                              setMenuOpen(false);
                              activateSelection();
                            }}
                          />
                        )}
                        <MenuButton
                          icon={Edit3}
                          label="Edit Tags"
                          onClick={handleOpenTagsAction}
                          disabled={!onOpenTagEditor}
                          badge={someSelected ? String(selectedCount) : undefined}
                        />
                        <MenuButton
                          icon={Music2}
                          label="Edit Lyrics"
                          onClick={handleOpenLyricsAction}
                          disabled={!onOpenTagEditor}
                        />
                        <div className="h-px mx-1.5 my-1 bg-white/10" />
                        <MenuButton
                          icon={ListMusic}
                          label="Add to Queue"
                          onClick={handleAddToQueueAction}
                          disabled={!onAddToQueue}
                          badge={someSelected ? String(selectedCount) : undefined}
                          flash={flashedAction === 'queue'}
                        />
                        <MenuButton
                          icon={ListPlus}
                          label="Add to Playlist"
                          onClick={() => openPlaylistPicker(targetTracks)}
                          badge={someSelected ? String(selectedCount) : undefined}
                          flash={flashedAction === 'playlist'}
                        />
                        <div className="h-px mx-1.5 my-1 bg-white/10" />
                        <MenuButton
                          icon={CheckSquare}
                          label={allSelected ? 'Deselect All' : 'Select All'}
                          onClick={handleSelectAll}
                        />
                        <MenuButton
                          icon={FolderOpen}
                          label="Reveal in Finder"
                          onClick={handleRevealAction}
                          disabled={!onRevealInFinder}
                        />
                        {someSelected && (
                          <>
                            <div className="h-px mx-1.5 my-1 bg-white/10" />
                            <MenuButton
                              icon={Trash2}
                              label="Delete Selected"
                              onClick={handleDeleteSelected}
                              disabled={!onDeleteTracks}
                              danger
                            />
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="relative" role="table">
              <div
                className="absolute inset-0 rounded-3xl overflow-hidden -z-10 bg-black/40 border border-white/10"
                style={{ backdropFilter: reducedEffects ? 'blur(4px)' : 'blur(12px)' }}
              />
              <div className="flex items-center justify-between px-4 sm:px-6 pt-4 pb-2">
                <span className="text-[12px] font-bold tracking-[0.22em] uppercase text-white/80">
                  Tracklist
                </span>
                {selectionActive && (
                  <button
                    type="button"
                    onClick={clearSelection}
                    className="text-[12px] font-semibold px-3 py-1 rounded-full"
                    style={{ color: inkTextColor, backgroundColor: withAlpha(albumInk, '18') }}
                  >
                    {someSelected ? 'Clear' : 'Done'}
                  </button>
                )}
              </div>
              <div role="rowgroup">
                <div
                  role="row"
                  className={cn(
                    TRACK_GRID,
                    'px-4 sm:px-6 py-2.5 text-xs font-bold text-white/85 uppercase tracking-wider border-b border-white/10',
                  )}
                >
                  <div role="columnheader" className="flex justify-center">
                    {selectionActive && (
                      <button onClick={handleSelectAll} aria-label="Select all">
                        {allSelected ? (
                          <CheckSquare className="w-4 h-4" style={{ color: inkTextColor }} />
                        ) : (
                          <Square className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </div>
                  <div role="columnheader" className="text-center">
                    #
                  </div>
                  <div role="columnheader">Title</div>
                  <div
                    role="columnheader"
                    className="text-right flex items-center justify-end gap-2"
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Time</span>
                  </div>
                </div>
              </div>
              <div role="rowgroup" className="flex flex-col pb-2">
                {tracks.length === 0 ? (
                  <div className="py-16 flex flex-col items-center justify-center gap-3 text-white/60">
                    <TrackIcon className="w-10 h-10 opacity-70" />
                    <p className="text-sm">No tracks in this album</p>
                  </div>
                ) : (
                  tracks.map((track, idx) => (
                    <TrackRow
                      key={track.id}
                      track={track}
                      idx={idx}
                      isSelected={selectedSet.has(track.id)}
                      isCurrentTrack={currentlyPlayingId === track.id}
                      isPlayingNow={
                        currentlyPlayingId === track.id && (isCurrentlyPlaying ?? false)
                      }
                      selectionActive={selectionActive}
                      reducedEffects={reducedEffects}
                      albumInk={albumInk}
                      onTrackSelect={onTrackSelect}
                      onPlayTrack={onPlayTrack}
                      onOpenTrackDetails={onOpenTrackDetails}
                      onTrackContextMenu={onTrackContextMenu}
                      longPressHandlers={longPressHandlers}
                      longPressTrackRef={longPressTrackRef}
                      inkTextColor={inkTextColor}
                      trackGridClass={TRACK_GRID}
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {selectionActive && (
          <div
            className="fixed md:absolute bottom-6 md:bottom-8 left-4 right-4 md:left-1/2 md:right-auto md:-translate-x-1/2 z-40 pointer-events-auto flex justify-center"
            style={{ animation: 'adl-toolbar-up 220ms cubic-bezier(0.16, 1, 0.3, 1) forwards' }}
          >
            <div
              className="flex w-full md:w-auto items-center gap-1.5 rounded-[1.75rem] px-2 py-2 border border-white/10 shadow-2xl bg-black/90"
              style={{ backdropFilter: 'blur(24px)' }}
            >
              <span
                className="px-4 py-2 rounded-2xl text-xs font-bold tabular-nums text-black shrink-0 shadow-sm"
                style={{ backgroundColor: albumInk }}
              >
                {selectedCount}
              </span>
              <ToolbarButton
                icon={ListMusic}
                label="Queue"
                onClick={handleAddToQueueAction}
                disabled={!onAddToQueue}
                reducedEffects={reducedEffects}
              />
              <ToolbarButton
                icon={ListPlus}
                label="Playlist"
                onClick={() => openPlaylistPicker(selectedTracks)}
                reducedEffects={reducedEffects}
              />
              <ToolbarButton
                icon={Edit3}
                label="Tags"
                onClick={handleOpenTagsAction}
                disabled={!onOpenTagEditor}
                reducedEffects={reducedEffects}
              />
              <div className="w-px h-8 mx-1 bg-white/10 shrink-0" />
              <ToolbarButton
                icon={Trash2}
                label="Delete"
                onClick={handleDeleteSelected}
                danger
                disabled={!onDeleteTracks}
                reducedEffects={reducedEffects}
              />
              <ToolbarButton
                icon={X}
                label="Clear"
                onClick={clearSelection}
                reducedEffects={reducedEffects}
              />
            </div>
          </div>
        )}
        {playlistPickerIds && (
          <PlaylistPickerDialog
            open={playlistPickerIds !== null}
            trackIds={playlistPickerIds}
            onClose={closePlaylistPicker}
          />
        )}
      </div>
    );
  },
);
AlbumDetailsOverlay.displayName = 'AlbumDetailsOverlay';
