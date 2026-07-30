import { clsx } from 'clsx';
import { Mic2, Play, Volume2, VolumeX } from 'lucide-react';
import type { CSSProperties, ElementType, PointerEvent as ReactPointerEvent } from 'react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getAlbumArtist } from '../../lib/album-key';
import { rangeProgressStyle } from '../../lib/range-progress-style';
import { reportError } from '../../lib/report-error';
import { setVolume as setAudioVolume } from '../../lib/tauri-commands';
import { usePlayerStore } from '../../store/player-store';
import type { Track } from '../../types';
import { CoverArtImage } from '../shared/CoverArtImage';
import { Button } from '../ui/button';

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const formatTime = (sec: number): string => {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};
// ---------------------------------------------------------------------------
// NowPlayingBars
// 4 animated bars that visualize playback. Pure CSS, no audio data needed.
// Pauses the animation when isPlaying is false, freezing the bars in place.
// ---------------------------------------------------------------------------

const NOW_PLAYING_DURATIONS = [0.9, 0.97, 0.84, 1.02] as const;
const NOW_PLAYING_HEIGHTS = [34, 72, 92, 46] as const; // resting heights when paused

export const NowPlayingBars = memo(
  ({ isPlaying, color = 'currentColor' }: { isPlaying: boolean; color?: string }) => (
    <div
      className="inline-flex items-end gap-[2px] overflow-hidden shrink-0"
      style={{ width: 15, height: 13 }}
      aria-hidden="true"
    >
      {([0, 1, 2, 3] as const).map((i) => (
        <div
          key={i}
          className="flex-1 rounded-t-[1.5px] origin-bottom transition-[height] duration-[var(--motion-emphasis)]"
          style={{
            backgroundColor: color,
            opacity: 0.78,
            height: isPlaying ? `${NOW_PLAYING_HEIGHTS[i]}%` : `${NOW_PLAYING_HEIGHTS[i]}%`,
            animation: isPlaying
              ? `tarab-eq-${i + 1} ${NOW_PLAYING_DURATIONS[i]}s ease-in-out infinite alternate`
              : 'none',
          }}
        />
      ))}
    </div>
  ),
);
NowPlayingBars.displayName = 'NowPlayingBars';

// ---------------------------------------------------------------------------
// CardLyricsDisplay
// RAF local clock - only re-renders when the active line changes.
// Smooth interpolation prevents jerky jumps on sparse store updates.
// ---------------------------------------------------------------------------

export const CardLyricsDisplay = memo(() => {
  const { lyrics, isPlaying } = usePlayerStore(
    useShallow((s) => ({ lyrics: s.lyrics, isPlaying: s.isPlaying })),
  );
  const [text, setText] = useState<string | null>(null);
  const rafRef = useRef<number | null>(null);
  const baseTime = useRef(0);
  const baseAt = useRef(0);

  const resync = () => {
    baseTime.current = usePlayerStore.getState().currentTime || 0;
    baseAt.current = performance.now();
  };

  useEffect(() => {
    if (!lyrics?.lines?.length) {
      setText(null);
      return;
    }
    resync();

    const tick = () => {
      const s = usePlayerStore.getState();
      const smooth = s.isPlaying
        ? baseTime.current + (performance.now() - baseAt.current) / 1000
        : s.currentTime || baseTime.current;
      if (Math.abs((s.currentTime || 0) - smooth) > 0.35) resync();

      const ms = smooth * 1000;
      let line: string | null = null;
      for (let i = lyrics.lines.length - 1; i >= 0; i--) {
        if (ms >= lyrics.lines[i].startTime) {
          line = lyrics.lines[i].text;
          break;
        }
      }
      setText((p) => (p !== line ? line : p));
      if (usePlayerStore.getState().isPlaying) rafRef.current = requestAnimationFrame(tick);
    };

    if (isPlaying) rafRef.current = requestAnimationFrame(tick);
    else tick();
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [lyrics, isPlaying]);

  if (!text) return null;

  return (
    <div className="mt-3.5 flex items-start gap-2 w-full select-none tarab-fade-up">
      <Mic2 className="w-3 h-3 mt-[5px] shrink-0 text-white/25" />
      <p
        className={clsx(
          'text-sm italic leading-relaxed line-clamp-2 transition-colors duration-[var(--motion-emphasis)]',
          isPlaying ? 'text-white/50' : 'text-white/28',
        )}
      >
        &ldquo;{text}&rdquo;
      </p>
    </div>
  );
});
CardLyricsDisplay.displayName = 'CardLyricsDisplay';

// ---------------------------------------------------------------------------
// HeroProgressBar
// Pointer-capture drag, ARIA slider, persistent accent dot, hover-reveal bar,
// and a floating time tooltip that appears above the knob while scrubbing.
// ---------------------------------------------------------------------------

// HeroProgressBar removed (now using shared HidingProgressBar)

// ---------------------------------------------------------------------------
// VolumeControl
// Hover-expand inline slide-out slider. Debounced leave timer prevents snap-close.
// Mute toggles between 0 and the last non-zero value.
// ---------------------------------------------------------------------------

export const VolumeControl = memo(
  ({ accentColor = 'var(--hero-accent)' }: { accentColor?: string }) => {
    const { volume, setVolume } = usePlayerStore(
      useShallow((s) => ({ volume: s.volume, setVolume: s.setVolume })),
    );
    const [expanded, setExpanded] = useState(false);
    const restoreRef = useRef(0.55);
    const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
      if (volume > 0.001) restoreRef.current = volume;
    }, [volume]);

    const commit = useCallback(
      async (v: number) => {
        const clamped = clamp01(v);
        setVolume(clamped);
        try {
          await setAudioVolume(clamped);
        } catch (e) {
          reportError('volume commit failed', { source: 'home-volume', error: e });
        }
      },
      [setVolume],
    );

    // Removed toggleMute as per instruction's direct onClick logic

    const onEnter = useCallback(() => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current);
      setExpanded(true);
    }, []);

    const onLeave = useCallback(() => {
      leaveTimer.current = setTimeout(() => setExpanded(false), 300);
    }, []);

    useEffect(
      () => () => {
        if (leaveTimer.current) clearTimeout(leaveTimer.current);
      },
      [],
    );

    // Removed VIcon as per instruction's direct icon logic

    return (
      <div className="inline-flex items-center gap-0" onMouseEnter={onEnter} onMouseLeave={onLeave}>
        <Button
          onClick={() => setVolume(volume === 0 ? Math.max(restoreRef.current, 0.5) : 0)}
          className="h-9 w-9 rounded-full inline-flex items-center justify-center bg-black/40 text-white/55 hover:text-white transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-standard)]"
          aria-label={volume <= 0.001 ? 'Unmute' : 'Mute'}
          title="Volume"
          accentColor={accentColor}
        >
          {volume <= 0.001 ? (
            <VolumeX className="h-[14px] w-[14px]" />
          ) : (
            <Volume2 className="h-[14px] w-[14px]" />
          )}
        </Button>

        {/* Slide-out slider */}
        <div
          className={clsx(
            'overflow-hidden transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-emphasis)] ease-out',
            expanded ? 'ml-2 w-[96px] opacity-100' : 'ml-0 w-0 opacity-0',
          )}
        >
          <label htmlFor="tarab-vol-slider" className="sr-only">
            Volume
          </label>
          <input
            id="tarab-vol-slider"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            onChange={(e) => void commit(parseFloat(e.target.value))}
            className="h-1 w-[96px] cursor-pointer"
            style={
              {
                ...rangeProgressStyle(volume, 0, 1),
                '--range-fill': accentColor,
              } as CSSProperties
            }
          />
        </div>
      </div>
    );
  },
);
VolumeControl.displayName = 'VolumeControl';

// ---------------------------------------------------------------------------
// HeroStatusBar
// Absolute bottom-right elapsed / remaining time display.
// ---------------------------------------------------------------------------

export const HeroStatusBar = memo(() => {
  const duration = usePlayerStore((s) => s.duration);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const remaining = Math.max(0, (duration || 0) - (currentTime || 0));

  return (
    <div className="absolute bottom-6 right-7 z-20 select-none">
      <p className="font-mono text-sm tabular-nums tracking-[0.02em] text-white/[0.52]">
        {formatTime(currentTime || 0)}&nbsp;/&nbsp;-{formatTime(remaining)}
      </p>
    </div>
  );
});
HeroStatusBar.displayName = 'HeroStatusBar';

// ---------------------------------------------------------------------------
// StatTile
// Glass card with colored icon container, animated counter, accent strip.
// Combines v1's icon-circle richness with v2's minimal layout sensibility.
// ---------------------------------------------------------------------------

interface StatTileProps {
  Icon: ElementType<{ className?: string; style?: CSSProperties }>;
  value: number;
  label: string;
  iconColor: string;
  glowColor: string;
  staggerIndex: number;
  reducedEffects: boolean;
}

export const StatTile = memo(
  ({ Icon, value, label, iconColor, glowColor, staggerIndex, reducedEffects }: StatTileProps) => (
    <div
      className={clsx(
        'relative group flex items-center gap-4 p-5 rounded-[18px] overflow-hidden cursor-default isolate',
        'bg-gradient-to-b from-white/[0.065] to-white/[0.028]',
        'hover:from-white/[0.09] hover:to-white/[0.04]',
        'transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-emphasis)]',
        !reducedEffects && 'tarab-fade-up',
      )}
      style={{ animationDelay: !reducedEffects ? `${staggerIndex * 75 + 50}ms` : undefined }}
    >
      {/* Background glow (appears on hover) */}
      <div
        className="absolute -left-2 top-1/2 -translate-y-1/2 w-16 h-16 rounded-full blur-[22px] pointer-events-none opacity-0 group-hover:opacity-35 transition-opacity duration-[var(--motion-emphasis)]"
        style={{ background: glowColor }}
      />

      {/* Icon container */}
      <div
        className="relative isolate shrink-0 w-11 h-11 rounded-2xl flex items-center justify-center transition-transform duration-[var(--motion-emphasis)] group-hover:scale-[1.07]"
        style={{
          background: `linear-gradient(180deg, color-mix(in oklch, ${glowColor} 28%, rgba(255,255,255,0.08)) 0%, color-mix(in oklch, ${glowColor} 14%, rgba(255,255,255,0.03)) 100%)`,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,0.09), inset 0 -1px 0 rgba(0,0,0,0.12)`,
        }}
      >
        <Icon className="w-5 h-5 shrink-0" style={{ color: iconColor }} />
      </div>

      {/* Number + label */}
      <div className="min-w-0">
        <p
          className="font-display font-extrabold text-white tabular-nums leading-none tracking-tight"
          style={{ fontSize: 'clamp(1.3rem, 2.4vw, 1.7rem)' }}
        >
          {value.toLocaleString()}
        </p>
        <p className="text-[9.5px] font-bold uppercase tracking-[0.24em] text-white/32 mt-[5px]">
          {label}
        </p>
      </div>

      {/* Bottom accent strip */}
      <div
        className="absolute bottom-0 left-4 right-4 h-[1.5px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--motion-emphasis)]"
        style={{ background: `linear-gradient(90deg, transparent, ${glowColor}, transparent)` }}
      />
    </div>
  ),
);
StatTile.displayName = 'StatTile';

// ---------------------------------------------------------------------------
// AlbumSpotlightCard
// Interactive cursor-tracked radial spotlight overlay.
// Featured card takes full height of the left column.
// staggerIndex drives the entrance animation delay.
// ---------------------------------------------------------------------------

interface AlbumSpotlightCardProps {
  track: Track;
  count: number;
  albumTracks: Track[];
  featured: boolean;
  interactiveSpotlight: boolean;
  staggerIndex: number;
  reducedEffects: boolean;
  onOpenAlbumDetails?: (payload: {
    album: string;
    artist: string;
    coverArt?: string;
    tracks: Track[];
  }) => void;
  onPlayAlbum: (track: Track, albumTracks: Track[]) => Promise<void>;
}

export const AlbumSpotlightCard = memo(
  ({
    track,
    count,
    albumTracks,
    featured,
    interactiveSpotlight,
    staggerIndex,
    reducedEffects,
    onOpenAlbumDetails,
    onPlayAlbum,
  }: AlbumSpotlightCardProps) => {
    const cardRef = useRef<HTMLElement>(null);
    const rafRef = useRef<number | null>(null);
    const next = useRef({ x: 50, y: 50, o: 0 });

    const flush = useCallback(() => {
      const node = cardRef.current;
      if (!node) return;
      node.style.setProperty('--home-spot-x', `${next.current.x}%`);
      node.style.setProperty('--home-spot-y', `${next.current.y}%`);
      node.style.setProperty('--home-spot-o', `${next.current.o}`);
    }, []);

    const schedule = useCallback(() => {
      if (rafRef.current !== null) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        flush();
      });
    }, [flush]);

    const onPointerMove = useCallback(
      (e: ReactPointerEvent<HTMLElement>) => {
        if (!interactiveSpotlight || !cardRef.current) return;
        const rect = cardRef.current.getBoundingClientRect();
        next.current.x = clamp01((e.clientX - rect.left) / rect.width) * 100;
        next.current.y = clamp01((e.clientY - rect.top) / rect.height) * 100;
        next.current.o = 1;
        schedule();
      },
      [interactiveSpotlight, schedule],
    );

    const onPointerLeave = useCallback(() => {
      if (!interactiveSpotlight) return;
      next.current.o = 0;
      schedule();
    }, [interactiveSpotlight, schedule]);

    useEffect(
      () => () => {
        if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      },
      [],
    );

    return (
      <article
        ref={cardRef}
        className={clsx(
          'home-spotlight-card group relative overflow-hidden',
          'transition-[transform,box-shadow] duration-[var(--motion-emphasis)]',
          'hover:-translate-y-[2px] active:translate-y-[0px] active:scale-[0.99] hover:shadow-[0_20px_56px_rgba(0,0,0,0.56)]',
          featured ? 'h-full min-h-0 rounded-[22px]' : 'aspect-square rounded-[18px]',
          !reducedEffects && 'tarab-fade-up',
        )}
        style={{ animationDelay: !reducedEffects ? `${staggerIndex * 50}ms` : undefined }}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onClick={() =>
          onOpenAlbumDetails?.({
            album: track.album,
            artist: getAlbumArtist(track),
            coverArt: track.coverArt,
            tracks: albumTracks,
          })
        }
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          onOpenAlbumDetails?.({
            album: track.album,
            artist: getAlbumArtist(track),
            coverArt: track.coverArt,
            tracks: albumTracks,
          });
        }}
        role="button"
        tabIndex={0}
        aria-label={`Open ${track.album} by ${track.artist}`}
      >
        {/* Cursor spotlight overlay */}
        <div
          className={clsx(
            'home-spotlight-overlay absolute inset-0 z-20 rounded-[inherit] pointer-events-none',
            interactiveSpotlight ? 'opacity-100' : 'opacity-0',
          )}
          aria-hidden="true"
        />

        <div className="relative w-full h-full">
          {/* Cover art */}
          <CoverArtImage
            track={track}
            size="large"
            className="w-full h-full"
            imgClassName="w-full h-full object-cover transition-transform duration-[var(--motion-emphasis)] group-hover:scale-[1.05]"
            roundedClassName=""
            iconClassName="w-7 h-7"
          />

          {/* Gradient overlay */}
          <div
            className={clsx(
              'absolute inset-0 transition-opacity duration-[var(--motion-emphasis)]',
              featured ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
            )}
            style={{
              background:
                'linear-gradient(180deg, transparent 25%, rgba(0,0,0,0.18) 52%, rgba(0,0,0,0.90) 100%)',
            }}
          />

          {/* Track count badge (top-right, appears on hover) */}
          <div
            className={clsx(
              'absolute z-20 top-2.5 right-2.5 px-2 py-0.5 rounded-full',
              'text-[12px] font-semibold uppercase tracking-[0.18em] text-white/70',
              'bg-black/50 backdrop-blur-none',
              'transition-[opacity,transform] duration-[var(--motion-standard)]',
              featured
                ? 'opacity-70'
                : 'opacity-0 translate-y-[-4px] group-hover:opacity-100 group-hover:translate-y-0',
            )}
          >
            {count} {count === 1 ? 'track' : 'tracks'}
          </div>

          {/* Album info */}
          <div
            className={clsx(
              'absolute bottom-0 left-0 right-0 z-20 flex items-end justify-between gap-3 transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-emphasis)]',
              featured
                ? 'p-4 opacity-100 translate-y-0'
                : 'p-3 opacity-0 translate-y-1.5 group-hover:opacity-100 group-hover:translate-y-0',
            )}
          >
            <div className="min-w-0 flex-1">
              <p
                className={clsx(
                  'font-bold text-white leading-tight truncate',
                  featured ? 'text-[1.05rem]' : 'text-[0.78rem]',
                )}
              >
                {track.album}
              </p>
              <p
                className={clsx(
                  'text-white/48 truncate mt-0.5',
                  featured ? 'text-[0.75rem]' : 'text-[0.68rem]',
                )}
              >
                {track.artist}
              </p>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                e.stopPropagation();
                void onPlayAlbum(track, albumTracks);
              }}
              className={clsx(
                'shrink-0 rounded-full border border-black/10 bg-white/95 text-black inline-flex items-center justify-center',
                'shadow-[0_4px_12px_rgba(0,0,0,0.20)] transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-standard)]',
                'hover:scale-[1.08] active:scale-[0.95]',
                'focus-visible:outline-none',
                featured ? 'w-11 h-11' : 'w-9 h-9',
              )}
              aria-label={`Play ${track.album}`}
            >
              <Play
                className={clsx(featured ? 'w-4 h-4 ml-0.5' : 'w-3.5 h-3.5 ml-0.5')}
                fill="currentColor"
              />
            </Button>
          </div>
        </div>
      </article>
    );
  },
);
AlbumSpotlightCard.displayName = 'AlbumSpotlightCard';
