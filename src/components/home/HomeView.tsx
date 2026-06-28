/**
 * HomeView.tsx
 * Merged and enhanced from v1 + v2.
 *
 * What comes from v1:
 *   - Stats section concept as icon-card tiles
 *   - Dual-layer ambient background: rendered in app shell under TopBar (`LiquidHomeAmbientBackdrop`)
 *   - Volume popup with explicit close-on-outside-click
 *
 * What comes from v2:
 *   - useCoverTilt (spring-lerp 3D perspective tilt on cover art)
 *   - useFinePointer (device-aware effects gating)
 *   - AlbumSpotlightCard with cursor-tracked radial spotlight
 *   - --hero-accent / --hero-glow reactive CSS var palette
 *   - reducedEffects from settings store
 *   - Loading skeleton, error state, reportError
 *   - Abstracted playback actions (playAdjacentTrack, seekToPosition, etc.)
 *   - rangeProgressStyle for volume fill
 *   - Persistent accent dot on progress bar + full ARIA
 *   - albumTracksByKey Map for O(1) lookup
 *   - VolumeControl inline slide-out UX
 *
 * New additions:
 *   - NowPlayingBars: animated 4-bar equalizer, CSS keyframes, pauses when idle
 *   - HeroProgressBar: floating time tooltip above knob on hover/drag
 *   - HeroStatusBar: compact elapsed/remaining time readout
 *   - StatTile: glass card with colored icon + animated counter + accent strip
 *   - Album card staggered entrance animations
 *   - useGlobalStyles: CSS injection hook (keyframes + tilt + spotlight)
 */

import {
  memo,
  useEffect,
  useMemo,
  useState,
  useCallback,
  useRef,
  type CSSProperties,
} from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Disc3,
  Music2,
  Clock,
  Users,
  ArrowRight,
  Headphones,
  Volume2,
  VolumeX,
  Mic2,
  Maximize2,
} from 'lucide-react';
import { LiquidGlassButton } from '../ui/LiquidGlassButton';
import { AlbumIcon, TrackIcon } from '../ui/Icons';
import { clsx } from 'clsx';
import { Button } from '../ui/button';
import { usePlayerStore } from '../../store/player-store';
import { useShallow } from 'zustand/react/shallow';
import { useLibraryData } from '../../features/library/useLibraryData';
import { useSettingsStore } from '../../store/settings-store';
import { dbGetLibraryStats, setVolume as setAudioVolume } from '../../lib/tauri-commands';
import type { LibraryStats } from '../../lib/tauri-commands';
import type { Track } from '../../types';
import { CoverArtImage } from '../shared/CoverArtImage';
import { useCoverArt } from '../../hooks/useCoverArt';
import { sortAlbumTracks } from '../../lib/track-order';
import { useRenderLog } from '../../lib/performance';
import { reportError } from '../../lib/report-error';
import { rangeProgressStyle } from '../../lib/range-progress-style';
import { getAlbumArtist, getAlbumKey } from '../../lib/album-key';
import { HidingProgressBar } from '../shared/HidingProgressBar';
import {
  playAdjacentTrack,
  startPlayback,
  toggleCurrentPlayback,
} from '../../lib/playback-actions';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HomeViewProps {
  onNavigateToLibrary: () => void;
  onNavigateToFolders: () => void;
  onNavigateToQueue?: () => void;
  onOpenAlbumDetails?: (payload: {
    album: string;
    artist: string;
    coverArt?: string;
    tracks: Track[];
  }) => void;
  onOpenFullPlayer?: () => void;
  isLibraryLoading?: boolean;
  libraryError?: string | null;
  onRetryLoad?: () => void;
}

// ---------------------------------------------------------------------------
// Global CSS injection
// Equalizer keyframes, cover tilt, spotlight overlay.
// Injected once into <head> - safe to call from multiple mounts (idempotent).
// ---------------------------------------------------------------------------

const TARAB_STYLE_ID = 'tarab-home-view-styles';

const GLOBAL_STYLES = `
  /* Equalizer bars */
  @keyframes tarab-eq-1 {
    0%,100% { height: 34%; }
    18%     { height: 88%; }
    42%     { height: 48%; }
    68%     { height: 95%; }
    84%     { height: 36%; }
  }
  @keyframes tarab-eq-2 {
    0%,100% { height: 72%; }
    22%     { height: 24%; }
    48%     { height: 96%; }
    74%     { height: 38%; }
    90%     { height: 80%; }
  }
  @keyframes tarab-eq-3 {
    0%,100% { height: 92%; }
    28%     { height: 50%; }
    55%     { height: 18%; }
    78%     { height: 76%; }
    92%     { height: 58%; }
  }
  @keyframes tarab-eq-4 {
    0%,100% { height: 46%; }
    16%     { height: 98%; }
    44%     { height: 64%; }
    70%     { height: 20%; }
    88%     { height: 82%; }
  }

  /* Entrance stagger */
  @keyframes tarab-fade-up {
    from { opacity: 0; transform: translateY(11px); }
    to   { opacity: 1; transform: translateY(0);    }
  }
  .tarab-fade-up {
    animation: tarab-fade-up 0.38s cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  /* 3-D cover tilt */
  .home-cover-tilt {
    transform:
      perspective(920px)
      rotateX(var(--home-tilt-x, 0deg))
      rotateY(var(--home-tilt-y, 0deg));
    will-change: transform;
    transform-style: preserve-3d;
  }
  .home-cover-tilt-static {
    transform: none !important;
  }

  /* Spotlight overlay on album cards */
  .home-spotlight-card {
    --home-spot-x: 50%;
    --home-spot-y: 50%;
    --home-spot-o: 0;
  }
  .home-spotlight-overlay {
    background: radial-gradient(
      circle at var(--home-spot-x) var(--home-spot-y),
      rgba(255,255,255,0.10) 0%,
      transparent 62%
    );
    opacity: var(--home-spot-o);
    transition: opacity 0.30s ease;
  }
`;

const useGlobalStyles = () => {
  useEffect(() => {
    if (document.getElementById(TARAB_STYLE_ID)) return;
    const el = document.createElement('style');
    el.id = TARAB_STYLE_ID;
    el.textContent = GLOBAL_STYLES;
    document.head.appendChild(el);
  }, []);
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

const formatTime = (sec: number): string => {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

// ---------------------------------------------------------------------------
// useAnimatedCounter
// Cubic ease-out counter animation. disabled=true skips the RAF and jumps straight
// to target (for reducedEffects mode).
// ---------------------------------------------------------------------------

const useAnimatedCounter = (target: number, duration = 1500, disabled = false): number => {
  const [count, setCount] = useState(0);
  const startVal = useRef(0);
  const countRef = useRef(0);
  const startTime = useRef<number | null>(null);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    countRef.current = count;
  }, [count]);

  useEffect(() => {
    if (raf.current !== null) { cancelAnimationFrame(raf.current); raf.current = null; }

    if (disabled) {
      startTime.current = null;
      startVal.current = target;
      countRef.current = target;
      setCount(target);
      return;
    }

    startVal.current = countRef.current;
    startTime.current = null;

    if (target === 0) { countRef.current = 0; setCount(0); return; }

    const animate = (now: number) => {
      if (!startTime.current) startTime.current = now;
      const progress = Math.min((now - startTime.current) / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      const next = Math.floor(startVal.current + (target - startVal.current) * eased);
      countRef.current = next;
      setCount((prev) => (prev === next ? prev : next));
      if (progress < 1) raf.current = requestAnimationFrame(animate);
      else raf.current = null;
    };

    raf.current = requestAnimationFrame(animate);
    return () => { if (raf.current !== null) { cancelAnimationFrame(raf.current); raf.current = null; } };
  }, [target, duration, disabled]);

  return count;
};

// ---------------------------------------------------------------------------
// useFinePointer
// Returns true on mouse/stylus devices; false on touch. Guards tilt + spotlight.
// ---------------------------------------------------------------------------

const useFinePointer = (): boolean => {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const q = window.matchMedia('(hover: hover) and (pointer: fine)');
    const sync = () => setFine(q.matches);
    sync();
    q.addEventListener('change', sync);
    return () => q.removeEventListener('change', sync);
  }, []);
  return fine;
};

// ---------------------------------------------------------------------------
// useCoverTilt
// Spring-lerp 3D tilt via CSS vars, RAF-based, frame-rate independent.
// Lerp alpha: ~14% per 60fps frame, scaled by actual delta.
// ---------------------------------------------------------------------------

const useCoverTilt = (enabled: boolean, intensity = 9) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const lastAt = useRef<number | null>(null);
  const raf = useRef<number | null>(null);

  const write = useCallback(() => {
    const node = wrapRef.current;
    if (!node) return;
    node.style.setProperty('--home-tilt-x', `${current.current.x.toFixed(2)}deg`);
    node.style.setProperty('--home-tilt-y', `${current.current.y.toFixed(2)}deg`);
  }, []);

  const tick = useCallback((now: number) => {
    raf.current = null;
    const prev = lastAt.current ?? now;
    const delta = Math.max(1, now - prev);
    lastAt.current = now;
    const alpha = 1 - (1 - 0.14) ** (delta / (1000 / 60));
    current.current.x += (target.current.x - current.current.x) * alpha;
    current.current.y += (target.current.y - current.current.y) * alpha;
    write();
    if (
      Math.abs(target.current.x - current.current.x) > 0.02 ||
      Math.abs(target.current.y - current.current.y) > 0.02
    ) {
      raf.current = requestAnimationFrame(tick);
    } else {
      lastAt.current = null;
    }
  }, [write]);

  const schedule = useCallback(() => {
    if (raf.current !== null) return;
    raf.current = requestAnimationFrame(tick);
  }, [tick]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!enabled || e.pointerType === 'touch' || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const nx = clamp01((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = clamp01((e.clientY - rect.top) / rect.height) * 2 - 1;
    target.current.x = -ny * intensity;
    target.current.y = nx * intensity;
    schedule();
  }, [enabled, intensity, schedule]);

  const onPointerLeave = useCallback(() => {
    target.current.x = 0;
    target.current.y = 0;
    schedule();
  }, [schedule]);

  useEffect(() => {
    if (enabled) return;
    if (raf.current !== null) { cancelAnimationFrame(raf.current); raf.current = null; }
    lastAt.current = null;
    target.current = { x: 0, y: 0 };
    current.current = { x: 0, y: 0 };
    write();
  }, [enabled, write]);

  useEffect(() => () => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    lastAt.current = null;
  }, []);

  return { wrapRef, onPointerMove, onPointerLeave };
};

// ---------------------------------------------------------------------------
// NowPlayingBars
// 4 animated bars that visualize playback. Pure CSS, no audio data needed.
// Pauses the animation when isPlaying is false, freezing the bars in place.
// ---------------------------------------------------------------------------

const NOW_PLAYING_DURATIONS = [0.90, 0.97, 0.84, 1.02] as const;
const NOW_PLAYING_HEIGHTS   = [34, 72, 92, 46] as const; // resting heights when paused

const NowPlayingBars = memo(({ isPlaying, color = 'currentColor' }: {
  isPlaying: boolean;
  color?: string;
}) => (
  <div
    className="inline-flex items-end gap-[2px] overflow-hidden shrink-0"
    style={{ width: 15, height: 13 }}
    aria-hidden="true"
  >
    {([0, 1, 2, 3] as const).map((i) => (
      <div
        key={i}
        className="flex-1 rounded-t-[1.5px] origin-bottom transition-[height] duration-300"
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
));
NowPlayingBars.displayName = 'NowPlayingBars';

// ---------------------------------------------------------------------------
// CardLyricsDisplay
// RAF local clock - only re-renders when the active line changes.
// Smooth interpolation prevents jerky jumps on sparse store updates.
// ---------------------------------------------------------------------------

const CardLyricsDisplay = memo(() => {
  const { lyrics, isPlaying } = usePlayerStore(
    useShallow((s) => ({ lyrics: s.lyrics, isPlaying: s.isPlaying }))
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
    if (!lyrics?.lines?.length) { setText(null); return; }
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
        if (ms >= lyrics.lines[i].startTime) { line = lyrics.lines[i].text; break; }
      }
      setText((p) => (p !== line ? line : p));
      if (usePlayerStore.getState().isPlaying) rafRef.current = requestAnimationFrame(tick);
    };

    if (isPlaying) rafRef.current = requestAnimationFrame(tick);
    else tick();
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [lyrics, isPlaying]);

  if (!text) return null;

  return (
    <div className="mt-3.5 flex items-start gap-2 w-full select-none tarab-fade-up">
      <Mic2 className="w-3 h-3 mt-[5px] shrink-0 text-white/25" />
      <p className={clsx(
        'text-sm italic leading-relaxed line-clamp-2 transition-colors duration-300',
        isPlaying ? 'text-white/50' : 'text-white/28'
      )}>
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

const VolumeControl = memo(({ accentColor = 'var(--hero-accent)' }: { accentColor?: string }) => {
  const { volume, setVolume } = usePlayerStore(
    useShallow((s) => ({ volume: s.volume, setVolume: s.setVolume }))
  );
  const [expanded, setExpanded] = useState(false);
  const restoreRef = useRef(0.55);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { if (volume > 0.001) restoreRef.current = volume; }, [volume]);

  const commit = useCallback(async (v: number) => {
    const clamped = clamp01(v);
    setVolume(clamped);
    try { await setAudioVolume(clamped); }
    catch (e) { reportError('volume commit failed', { source: 'home-volume', error: e }); }
  }, [setVolume]);

  // Removed toggleMute as per instruction's direct onClick logic

  const onEnter = useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setExpanded(true);
  }, []);

  const onLeave = useCallback(() => {
    leaveTimer.current = setTimeout(() => setExpanded(false), 300);
  }, []);

  useEffect(() => () => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }, []);

  // Removed VIcon as per instruction's direct icon logic

  return (
    <div
      className="inline-flex items-center gap-0"
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <LiquidGlassButton
        onClick={() => setVolume(volume === 0 ? Math.max(restoreRef.current, 0.5) : 0)}
        className="h-9 w-9 rounded-full inline-flex items-center justify-center bg-black/40 text-white/55 hover:text-white transition-all duration-200"
        aria-label={volume <= 0.001 ? 'Unmute' : 'Mute'}
        title="Volume"
        accentColor={accentColor}
      >
        {volume <= 0.001 ? (
          <VolumeX className="h-[14px] w-[14px]" />
        ) : (
          <Volume2 className="h-[14px] w-[14px]" />
        )}
      </LiquidGlassButton>

      {/* Slide-out slider */}
      <div
        className={clsx(
          'overflow-hidden transition-all duration-250 ease-out',
          expanded ? 'ml-2 w-[96px] opacity-100' : 'ml-0 w-0 opacity-0'
        )}
      >
        <label htmlFor="tarab-vol-slider" className="sr-only">Volume</label>
        <input
          id="tarab-vol-slider"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => void commit(parseFloat(e.target.value))}
          className="h-1 w-[96px] cursor-pointer"
          style={{
            ...rangeProgressStyle(volume, 0, 1),
            '--range-fill': accentColor,
          } as CSSProperties}
        />
      </div>
    </div>
  );
});
VolumeControl.displayName = 'VolumeControl';

// ---------------------------------------------------------------------------
// HeroStatusBar
// Absolute bottom-right elapsed / remaining time display.
// ---------------------------------------------------------------------------

const HeroStatusBar = memo(() => {
  const duration    = usePlayerStore((s) => s.duration);
  const currentTime = usePlayerStore((s) => s.currentTime);
  const remaining   = Math.max(0, (duration || 0) - (currentTime || 0));

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
  Icon: React.ElementType<{ className?: string; style?: React.CSSProperties }>;
  value: number;
  label: string;
  iconColor: string;
  glowColor: string;
  staggerIndex: number;
  reducedEffects: boolean;
}

const StatTile = memo(({
  Icon, value, label, iconColor, glowColor, staggerIndex, reducedEffects,
}: StatTileProps) => (
  <div
    className={clsx(
      'relative group flex items-center gap-4 p-5 rounded-[18px] overflow-hidden cursor-default isolate',
      'bg-gradient-to-b from-white/[0.065] to-white/[0.028]',
      'hover:from-white/[0.09] hover:to-white/[0.04]',
      'transition-all duration-300',
      !reducedEffects && 'tarab-fade-up'
    )}
    style={{ animationDelay: !reducedEffects ? `${staggerIndex * 75 + 50}ms` : undefined }}
  >
    {/* Background glow (appears on hover) */}
    <div
      className="absolute -left-2 top-1/2 -translate-y-1/2 w-16 h-16 rounded-full blur-[22px] pointer-events-none opacity-0 group-hover:opacity-35 transition-opacity duration-500"
      style={{ background: glowColor }}
    />

    {/* Icon container */}
    <div
      className="relative isolate shrink-0 w-11 h-11 rounded-2xl flex items-center justify-center transition-transform duration-300 group-hover:scale-[1.07]"
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
      className="absolute bottom-0 left-4 right-4 h-[1.5px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
      style={{ background: `linear-gradient(90deg, transparent, ${glowColor}, transparent)` }}
    />
  </div>
));
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

const AlbumSpotlightCard = memo(({
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
  const rafRef  = useRef<number | null>(null);
  const next    = useRef({ x: 50, y: 50, o: 0 });

  const flush = useCallback(() => {
    const node = cardRef.current;
    if (!node) return;
    node.style.setProperty('--home-spot-x', `${next.current.x}%`);
    node.style.setProperty('--home-spot-y', `${next.current.y}%`);
    node.style.setProperty('--home-spot-o', `${next.current.o}`);
  }, []);

  const schedule = useCallback(() => {
    if (rafRef.current !== null) return;
    rafRef.current = requestAnimationFrame(() => { rafRef.current = null; flush(); });
  }, [flush]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!interactiveSpotlight || !cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    next.current.x = clamp01((e.clientX - rect.left) / rect.width) * 100;
    next.current.y = clamp01((e.clientY - rect.top) / rect.height) * 100;
    next.current.o = 1;
    schedule();
  }, [interactiveSpotlight, schedule]);

  const onPointerLeave = useCallback(() => {
    if (!interactiveSpotlight) return;
    next.current.o = 0;
    schedule();
  }, [interactiveSpotlight, schedule]);

  useEffect(() => () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); }, []);

  return (
    <article
      ref={cardRef}
      className={clsx(
        'home-spotlight-card group relative overflow-hidden',
        'transition-[transform,box-shadow] duration-300',
        'hover:-translate-y-[3px] hover:shadow-[0_20px_56px_rgba(0,0,0,0.56)]',
        featured ? 'h-full min-h-0 rounded-[22px]' : 'aspect-square rounded-[18px]',
        !reducedEffects && 'tarab-fade-up'
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
          interactiveSpotlight ? 'opacity-100' : 'opacity-0'
        )}
        aria-hidden="true"
      />

      <div className="relative w-full h-full">
        {/* Cover art */}
        <CoverArtImage
          track={track}
          size="large"
          className="w-full h-full"
          imgClassName="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
          roundedClassName=""
          iconClassName="w-7 h-7"
        />

        {/* Gradient overlay */}
        <div
          className={clsx(
            'absolute inset-0 transition-opacity duration-250',
            featured ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
          style={{ background: 'linear-gradient(180deg, transparent 25%, rgba(0,0,0,0.18) 52%, rgba(0,0,0,0.90) 100%)' }}
        />

        {/* Track count badge (top-right, appears on hover) */}
        <div
          className={clsx(
            'absolute z-20 top-2.5 right-2.5 px-2 py-0.5 rounded-full',
            'text-[9px] font-semibold uppercase tracking-[0.18em] text-white/70',
            'bg-black/50 backdrop-blur-none',
            'transition-[opacity,transform] duration-200',
            featured ? 'opacity-70' : 'opacity-0 translate-y-[-4px] group-hover:opacity-100 group-hover:translate-y-0'
          )}
        >
          {count} {count === 1 ? 'track' : 'tracks'}
        </div>

        {/* Album info */}
        <div
          className={clsx(
            'absolute bottom-0 left-0 right-0 z-20 flex items-end justify-between gap-3 transition-all duration-250',
            featured ? 'p-4 opacity-100 translate-y-0' : 'p-3 opacity-0 translate-y-1.5 group-hover:opacity-100 group-hover:translate-y-0'
          )}
        >
          <div className="min-w-0 flex-1">
            <p className={clsx(
              'font-bold text-white leading-tight truncate',
              featured ? 'text-[1.05rem]' : 'text-[0.78rem]'
            )}>
              {track.album}
            </p>
            <p className={clsx(
              'text-white/48 truncate mt-0.5',
              featured ? 'text-[0.75rem]' : 'text-[0.68rem]'
            )}>
              {track.artist}
            </p>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => { e.stopPropagation(); void onPlayAlbum(track, albumTracks); }}
            className={clsx(
              'shrink-0 rounded-full border border-black/10 bg-white/95 text-black inline-flex items-center justify-center',
              'shadow-[0_4px_12px_rgba(0,0,0,0.20)] transition-all duration-200',
              'hover:scale-[1.08] active:scale-[0.95]',
              'focus-visible:outline-none',
              featured ? 'w-11 h-11' : 'w-9 h-9'
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
});
AlbumSpotlightCard.displayName = 'AlbumSpotlightCard';

// ---------------------------------------------------------------------------
// HomeView
// ---------------------------------------------------------------------------

export const HomeView = memo(({
  onNavigateToLibrary,
  onNavigateToFolders,
  onOpenAlbumDetails,
  onOpenFullPlayer,
  isLibraryLoading = false,
  libraryError = null,
  onRetryLoad,
}: HomeViewProps) => {
  useRenderLog('HomeView');
  useGlobalStyles();

  const { currentTrack, isPlaying } = usePlayerStore(
    useShallow((s) => ({ currentTrack: s.currentTrack, isPlaying: s.isPlaying }))
  );

  const currentCoverArt = useCoverArt(
    currentTrack?.filePath,
    currentTrack?.hasCoverArt,
    true,
    'large',
    currentTrack?.coverArtHash
  );
  const currentCoverUrl = currentCoverArt ?? null;

  const heroAccent  = 'var(--hero-accent)';
  const heroGlow    = 'var(--hero-glow)';

  const { tracks, trackCount } = useLibraryData();
  const reducedEffects   = useSettingsStore((s) => s.reducedEffects);
  const hasFinePointer  = useFinePointer();
  const interactiveOn   = !reducedEffects && hasFinePointer;
  const coverTilt       = useCoverTilt(interactiveOn);

  const [libraryStats, setLibraryStats] = useState<LibraryStats | null>(null);

  useEffect(() => {
    let dead = false;
    const timer = setTimeout(() => {
      dbGetLibraryStats()
        .then((s) => { if (!dead) setLibraryStats(s); })
        .catch((e) => reportError('stats load failed', { source: 'home-view', error: e }));
    }, 280);
    return () => { dead = true; clearTimeout(timer); };
  }, [trackCount]);

  // O(1) lookup map for album tracks
  const albumTracksByKey = useMemo(() => {
    const map = new Map<string, Track[]>();
    for (const track of tracks) {
      const key = getAlbumKey(track);
      const existing = map.get(key);
      if (existing) existing.push(track);
      else map.set(key, [track]);
    }
    return map;
  }, [tracks]);

  const albums = useMemo(
    () =>
      Array.from(albumTracksByKey.values())
        .filter((a) => a.length > 0)
        .map((a) => ({ track: a[0], count: a.length })),
    [albumTracksByKey]
  );

  const stats = useMemo(() => {
    if (libraryStats) return {
      totalTracks:  libraryStats.trackCount,
      totalHours:   Math.floor(libraryStats.totalDuration / 3600),
      uniqueArtists: libraryStats.artistCount,
      albumCount:   libraryStats.albumCount || albums.length,
    };
    return {
      totalTracks:  tracks.length,
      totalHours:   Math.floor(tracks.reduce((a, t) => a + t.duration, 0) / 3600),
      uniqueArtists: new Set(tracks.map((t) => t.artist)).size,
      albumCount:   albums.length,
    };
  }, [libraryStats, tracks, albums.length]);

  const animTracks  = useAnimatedCounter(stats.totalTracks,  1500, reducedEffects);
  const animHours   = useAnimatedCounter(stats.totalHours,   1500, reducedEffects);
  const animArtists = useAnimatedCounter(stats.uniqueArtists, 1500, reducedEffects);
  const animAlbums  = useAnimatedCounter(stats.albumCount,   1500, reducedEffects);

  const handleTogglePlay = useCallback(async () => {
    if (!currentTrack) return;
    try { await toggleCurrentPlayback(); }
    catch (e) { reportError('toggle failed', { source: 'home-view', error: e }); }
  }, [currentTrack]);

  const handlePrevious = useCallback(async () => {
    try { await playAdjacentTrack('previous'); }
    catch (e) { reportError('previous failed', { source: 'home-view', error: e }); }
  }, []);

  const handleNext = useCallback(async () => {
    try { await playAdjacentTrack('next'); }
    catch (e) { reportError('next failed', { source: 'home-view', error: e }); }
  }, []);

  const handlePlayAlbum = useCallback(async (_track: Track, albumTracks: Track[]) => {
    const ordered = sortAlbumTracks(albumTracks);
    if (!ordered.length) return;
    try { await startPlayback(ordered[0], { queue: ordered, queueIndex: 0, shuffleEnabled: false }); }
    catch (e) { reportError('play album failed', { source: 'home-view', error: e }); }
  }, []);

  // -------------------------------------------------------------------------
  // Loading skeleton
  // -------------------------------------------------------------------------

  if (isLibraryLoading) {
    return (
      <div className="h-full overflow-y-auto pb-32 custom-scrollbar">
        <div className="max-w-7xl mx-auto px-6 py-8 space-y-6 animate-pulse">
          <div className="h-[300px] rounded-[28px] bg-white/[0.06]" />
          <div className="h-5 w-16 rounded-lg bg-white/[0.05]" />
          <div
            className="hidden sm:grid gap-4 min-h-0"
            style={{
              gridTemplateColumns: 'minmax(160px, min(320px, 38%)) minmax(0, 1fr)',
            }}
          >
            <div className="min-h-0 min-w-0 h-full rounded-[22px] bg-white/[0.05]" />
            <div className="min-h-0 min-w-0 grid grid-cols-4 gap-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="rounded-[18px] bg-white/[0.04] aspect-square" />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[88px] rounded-[18px] bg-white/[0.04]" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Error state
  // -------------------------------------------------------------------------

  if (libraryError) {
    return (
      <div className="h-full overflow-y-auto pb-32 custom-scrollbar">
        <div className="max-w-2xl mx-auto px-6 py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-5 shadow-[0_0_24px_-8px_rgba(239,68,68,0.35)]">
            <Music2 className="w-7 h-7 text-red-400/70" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">Library failed to load</h2>
          <p className="text-white/45 mb-6 text-sm">{libraryError}</p>
          {onRetryLoad && (
            <Button
              onClick={onRetryLoad}
              className="rounded-full bg-gradient-to-b from-white/14 to-white/8 text-white hover:from-white/18 hover:to-white/10 active:scale-[0.97] h-10 px-5 font-medium transition-all duration-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
            >
              Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------

  return (
    <div className="h-full overflow-y-auto pb-32 custom-scrollbar relative">
      {/* Full-viewport ambient: `LiquidHomeAmbientBackdrop` in App (under TopBar). */}

      <div className="max-w-7xl mx-auto px-6 py-8 relative z-10">

        {/* ===============================================================
            HERO PLAYER CARD
            Layout: cover art | track info + transport
            Absolute: volume+expand (top-right), status bar (bottom-right)
        =============================================================== */}
        {currentTrack && (
          <section
            key={currentTrack.filePath}
            className={clsx('mb-12', !reducedEffects && 'tarab-fade-up')}
          >
            <div className="group relative w-full select-none">
              <div
                className="relative overflow-hidden rounded-[28px]"
                style={{
                  background: `linear-gradient(
                    130deg,
                    color-mix(in oklch, var(--hero-accent) 16%, oklch(0.10 0.008 90 / 0.97)) 0%,
                    color-mix(in oklch, var(--hero-accent) 24%, oklch(0.10 0.008 90 / 0.94)) 100%
                  )`,
                  boxShadow: `
                    0 32px 80px rgba(0,0,0,0.54),
                    0 0 0 0 rgba(255,255,255,0.055),
                    inset 0 1px 0 rgba(255,255,255,0.065)`,
                  WebkitMaskImage: `
                    linear-gradient(to right, transparent, black 4px, black calc(100% - 4px), transparent),
                    linear-gradient(to bottom, transparent, black 4px, black calc(100% - 4px), transparent)`,
                  WebkitMaskComposite: 'source-in',
                  maskImage: `
                    linear-gradient(to right, transparent, black 4px, black calc(100% - 4px), transparent),
                    linear-gradient(to bottom, transparent, black 4px, black calc(100% - 4px), transparent)`,
                  maskComposite: 'intersect',
                }}
              >
                {/* Decorative layers (clipped to rounded corners) */}
                <div className="absolute inset-0 z-0 overflow-hidden rounded-[inherit] pointer-events-none">
                  {currentCoverUrl && (
                    <img
                      src={currentCoverUrl}
                      alt=""
                      aria-hidden="true"
                      className={clsx(
                        'absolute inset-0 h-full w-full object-cover rounded-[inherit]',
                        reducedEffects
                          ? 'scale-[1.03] blur-[8px] saturate-[1.1] opacity-[0.14]'
                          : 'scale-[1.10] blur-[4px] saturate-[1.6] opacity-[0.34]'
                      )}
                      draggable={false}
                    />
                  )}
                  {/* Readability overlay */}
                  <div
                    className="absolute inset-0"
                    style={{ background: 'linear-gradient(115deg, rgba(5,3,2,0.88) 0%, rgba(7,5,3,0.72) 42%, rgba(5,4,3,0.40) 100%)' }}
                  />
                  {/* Accent radial - warms the cover art side */}
                  <div
                    className="absolute inset-0 transition-[background] duration-700"
                    style={{ background: `radial-gradient(circle at 20% 56%, ${heroGlow} 0%, transparent 54%)` }}
                  />
                </div>

                {/* Progress bar (top edge, hover-reveal) */}
                <HidingProgressBar accentColor={heroAccent} />

                {/* Volume + Expand (absolute top-right) */}
                <div className="absolute top-5 right-5 z-30 flex items-center gap-2">
                  <VolumeControl accentColor={heroAccent} />
                  {onOpenFullPlayer && (
                    <LiquidGlassButton
                      onClick={onOpenFullPlayer}
                      className="h-9 w-9 rounded-full inline-flex items-center justify-center bg-black/40 text-white/55 hover:text-white transition-all duration-200"
                      aria-label="Fullscreen player"
                      title="Fullscreen"
                      accentColor={heroAccent}
                    >
                      <Maximize2 className="h-[14px] w-[14px]" />
                    </LiquidGlassButton>
                  )}
                </div>

                {/* Status bar (absolute bottom-right) */}
                <HeroStatusBar />

                {/* Main layout */}
                <div className="relative z-10 flex items-start gap-6 p-6 sm:gap-7 sm:p-7 lg:gap-8 lg:p-8">

                  {/* Cover art with 3D tilt and ambient bloom */}
                  <div className="relative shrink-0 isolate">
                    {/* Ambient bloom behind the cover */}
                    <div
                      className="pointer-events-none absolute left-1/2 top-1/2 h-[130%] w-[130%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[8px] -z-10 transition-[background,opacity] duration-700"
                      style={{
                        opacity: reducedEffects ? 0.20 : 0.36,
                        background: `radial-gradient(circle at 50% 52%,
                          color-mix(in oklch, var(--hero-accent) 56%, transparent) 0%,
                          color-mix(in oklch, var(--hero-accent) 24%, transparent) 38%,
                          color-mix(in oklch, var(--hero-accent) 10%, transparent) 58%,
                          transparent 76%)`,
                      }}
                    />

                    {/* Tilt wrapper */}
                    <div
                      ref={coverTilt.wrapRef}
                      onPointerMove={coverTilt.onPointerMove}
                      onPointerLeave={coverTilt.onPointerLeave}
                      className={clsx(
                        'home-cover-tilt relative overflow-hidden rounded-[20px]',
                        !interactiveOn && 'home-cover-tilt-static'
                      )}
                      style={{
                        width: 'clamp(174px, 19.5vw, 256px)',
                        height: 'clamp(174px, 19.5vw, 256px)',
                        boxShadow: `
                          0 20px 58px rgba(0,0,0,0.58),
                          0 0 0 0 rgba(255,255,255,0.08)`,
                      }}
                    >
                      {currentCoverUrl ? (
                        <>
                          <img
                            src={currentCoverUrl}
                            alt={currentTrack.album}
                            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                            draggable={false}
                          />
                          <span
                            aria-hidden
                            className="pointer-events-none absolute inset-x-2 top-0 z-[1] h-px rounded-full opacity-70"
                            style={{
                              background:
                                'linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)',
                            }}
                          />
                        </>
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-white/[0.04] text-white/20">
                          <Disc3 className="h-12 w-12" />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Track info + transport */}
                  <div
                    className="flex flex-col min-w-0 flex-1 py-0.5"
                    style={{ minHeight: 'clamp(174px, 19.5vw, 256px)' }}
                  >
                    {/* NOW PLAYING label with equalizer bars */}
                    <div
                      className="flex items-center gap-2 mb-2.5"
                      style={{ color: heroAccent, opacity: 0.75 }}
                    >
                      <Headphones className="h-[11px] w-[11px] shrink-0" />
                      <span className="text-[9.5px] font-bold uppercase tracking-[0.34em]">
                        Now Playing
                      </span>
                      <div className="ml-1">
                        <NowPlayingBars isPlaying={isPlaying} color={heroAccent} />
                      </div>
                    </div>

                    {/* Title */}
                    <h1
                      className="font-display font-extrabold uppercase text-white line-clamp-2 leading-[0.88] tracking-[-0.015em]"
                      style={{ fontSize: 'clamp(1.85rem, 4.1vw, 3.75rem)' }}
                      title={currentTrack.title}
                    >
                      {currentTrack.title}
                    </h1>

                    {/* Artist */}
                    <p
                      className="mt-2 font-display font-semibold text-white/90 truncate"
                      style={{ fontSize: 'clamp(1.05rem, 1.75vw, 1.42rem)' }}
                    >
                      {currentTrack.artist}
                    </p>

                    {/* Album */}
                    <p
                      className="mt-0.5 font-medium text-white/34 truncate"
                      style={{ fontSize: 'clamp(0.82rem, 1.05vw, 0.97rem)' }}
                    >
                      {currentTrack.album}
                    </p>

                    {/* Lyrics */}
                    <CardLyricsDisplay />

                    <div className="flex-1" />

                    {/* Transport controls */}
                    <div className="flex items-center gap-[18px] mt-5">
                      {/* Previous */}
                      <LiquidGlassButton
                        onClick={handlePrevious}
                        className="h-11 w-11 rounded-full inline-flex items-center justify-center shrink-0 bg-black/38 text-white/65 hover:text-white transition-all duration-200"
                        aria-label="Previous track"
                        accentColor={heroAccent}
                      >
                        <SkipBack className="h-[16px] w-[16px] fill-current" />
                      </LiquidGlassButton>

                      {/* Play / Pause */}
                      <LiquidGlassButton
                        onClick={handleTogglePlay}
                        className="h-[60px] w-[60px] rounded-full inline-flex items-center justify-center shrink-0 bg-white text-black transition-all duration-300"
                        style={{
                          boxShadow: `
                            0 12px 40px -10px color-mix(in oklch, var(--hero-accent) 40%, transparent),
                            0 8px 28px rgba(0,0,0,0.28)`,
                        }}
                        aria-label={isPlaying ? 'Pause' : 'Play'}
                        tone="accent"
                        accentColor="#ffffff"
                        accentForeground="#000000"
                        pressFeedback="inset"
                      >
                        {isPlaying
                          ? <Pause className="h-[22px] w-[22px] fill-black" />
                          : <Play className="ml-[3px] h-[22px] w-[22px] fill-black" />}
                      </LiquidGlassButton>

                      {/* Next */}
                      <LiquidGlassButton
                        onClick={handleNext}
                        className="h-11 w-11 rounded-full inline-flex items-center justify-center shrink-0 bg-black/38 text-white/65 hover:text-white transition-all duration-200"
                        aria-label="Next track"
                        accentColor={heroAccent}
                      >
                        <SkipForward className="h-[16px] w-[16px] fill-current" />
                      </LiquidGlassButton>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ===============================================================
            ALBUMS
            Desktop: CSS Grid row so the featured tile matches the small grid height;
            four columns of smaller tiles on the right.
            Mobile: 2-column grid.
            All cards use AlbumSpotlightCard with staggered entrance.
        =============================================================== */}
        {albums.length > 0 && (
          <section className="mb-10">
            {/* Section header */}
            <div className="flex items-center justify-between mb-5 px-0.5">
              <div className="flex items-center gap-3">
                <span
                  className="flex h-[22px] w-[22px] items-center justify-center rounded-full transition-[box-shadow] duration-700"
                  style={{
                    background: 'rgba(0,0,0,0.30)',
                    boxShadow: `0 0 14px color-mix(in oklch, var(--hero-glow) 160%, transparent), inset 0 1px 0 rgba(255,255,255,0.06)`,
                  }}
                >
                  <span
                    className="h-[10px] w-[10px] rounded-full transition-[background] duration-700"
                    style={{ background: heroAccent, opacity: 0.80 }}
                  />
                </span>
                <h2 className="text-[17px] font-semibold text-white tracking-[-0.01em]">
                  Albums
                </h2>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={onNavigateToLibrary}
                className="flex items-center gap-1.5 text-sm text-white/35 hover:text-white/72 active:scale-[0.97] transition-all duration-200"
              >
                View all <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </div>

            {/* Desktop / tablet layout: one grid row so featured + 4-col grid share height */}
            <div
              className="hidden sm:grid gap-4 min-h-0"
              style={{
                gridTemplateColumns:
                  albums.length > 1
                    ? 'minmax(160px, min(320px, 38%)) minmax(0, 1fr)'
                    : '1fr',
              }}
            >
              {albums[0] && (
                <div className="min-h-0 min-w-0 h-full">
                  <AlbumSpotlightCard
                    track={albums[0].track}
                    count={albums[0].count}
                    albumTracks={albumTracksByKey.get(getAlbumKey(albums[0].track)) ?? []}
                    featured
                    interactiveSpotlight={interactiveOn}
                    staggerIndex={0}
                    reducedEffects={reducedEffects}
                    onOpenAlbumDetails={onOpenAlbumDetails}
                    onPlayAlbum={handlePlayAlbum}
                  />
                </div>
              )}

              {albums.length > 1 && (
                <div className="min-h-0 min-w-0 grid grid-cols-4 gap-4">
                  {albums.slice(1, 9).map(({ track, count }, idx) => (
                    <AlbumSpotlightCard
                      key={getAlbumKey(track)}
                      track={track}
                      count={count}
                      albumTracks={albumTracksByKey.get(getAlbumKey(track)) ?? []}
                      featured={false}
                      interactiveSpotlight={interactiveOn}
                      staggerIndex={idx + 1}
                      reducedEffects={reducedEffects}
                      onOpenAlbumDetails={onOpenAlbumDetails}
                      onPlayAlbum={handlePlayAlbum}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Mobile layout */}
            <div className="grid grid-cols-2 gap-4 sm:hidden">
              {albums.slice(0, 6).map(({ track, count }, idx) => (
                <AlbumSpotlightCard
                  key={`${getAlbumKey(track)}-m`}
                  track={track}
                  count={count}
                  albumTracks={albumTracksByKey.get(getAlbumKey(track)) ?? []}
                  featured={false}
                  interactiveSpotlight={interactiveOn}
                  staggerIndex={idx}
                  reducedEffects={reducedEffects}
                  onOpenAlbumDetails={onOpenAlbumDetails}
                  onPlayAlbum={handlePlayAlbum}
                />
              ))}
            </div>
          </section>
        )}

        {/* ===============================================================
            STATS
            4 StatTile components in a 2x2 mobile / 4x1 desktop grid.
            Blends v1's icon-card richness with v2's minimal elegance.
        =============================================================== */}
        {tracks.length > 0 && (
          <section className="mb-10">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatTile
                Icon={TrackIcon}
                value={animTracks}
                label="Tracks"
                iconColor="var(--hero-accent)"
                glowColor="var(--hero-glow)"
                staggerIndex={0}
                reducedEffects={reducedEffects}
              />
              <StatTile
                Icon={Clock}
                value={animHours}
                label="Hours"
                iconColor="rgb(251,146,60)"
                glowColor="rgba(251,146,60,0.6)"
                staggerIndex={1}
                reducedEffects={reducedEffects}
              />
              <StatTile
                Icon={Users}
                value={animArtists}
                label="Artists"
                iconColor="rgb(52,211,153)"
                glowColor="rgba(52,211,153,0.6)"
                staggerIndex={2}
                reducedEffects={reducedEffects}
              />
              <StatTile
                Icon={AlbumIcon}
                value={animAlbums}
                label="Albums"
                iconColor="rgb(167,139,250)"
                glowColor="rgba(167,139,250,0.6)"
                staggerIndex={3}
                reducedEffects={reducedEffects}
              />
            </div>
          </section>
        )}

        {/* ===============================================================
            EMPTY LIBRARY STATE
        =============================================================== */}
        {tracks.length === 0 && (
          <div className="text-center py-20 tarab-fade-up">
            <div className="w-20 h-20 rounded-full bg-gradient-to-b from-white/[0.07] to-white/[0.03] flex items-center justify-center mx-auto mb-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]">
              <Music2 className="w-9 h-9 text-white/20" />
            </div>
            <h3 className="text-xl font-semibold text-white mb-2">No music yet</h3>
            <p className="text-white/40 mb-6 text-sm">Add some folders to start building your library</p>
            <Button
              onClick={onNavigateToFolders}
              className="rounded-full bg-white text-black hover:bg-white/90 active:scale-[0.97] font-semibold h-12 px-6 inline-flex items-center gap-2 transition-all duration-200"
            >
              Add Folders <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        )}

      </div>
    </div>
  );
});

HomeView.displayName = 'HomeView';
