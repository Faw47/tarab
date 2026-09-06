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
 */

import { clsx } from 'clsx';
import {
  ArrowRight,
  Clock,
  Headphones,
  Maximize2,
  Music2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Users,
} from 'lucide-react';
import { memo, type UIEvent, useCallback, useMemo } from 'react';

import { useEffectiveReducedEffects } from '../../hooks/useEffectiveReducedEffects';
import { getAlbumKey } from '../../lib/album-key';
import { useRenderLog } from '../../lib/performance';

import { CoverArtImage } from '../shared/CoverArtImage';

import { HidingProgressBar } from '../shared/HidingProgressBar';
import { Button } from '../ui/button';
import { AlbumIcon, TrackIcon } from '../ui/Icons';
import { StatePanel } from '../ui/StatePanel';
import {
  AlbumSpotlightCard,
  CardLyricsDisplay,
  HeroStatusBar,
  NowPlayingBars,
  StatTile,
  VolumeControl,
} from './HomeView.parts';
import { useAnimatedCounter, useCoverTilt, useFinePointer } from './home-hooks';
import type { HomeViewProps } from './homeTypes';
import { useHomeAlbumDetailsLoader } from './useHomeAlbumDetails';
import { useHomeViewModel } from './useHomeViewModel';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// HomeView
// ---------------------------------------------------------------------------

export const HomeView = memo(
  ({
    onNavigateToLibrary,
    onNavigateToFolders,
    onOpenAlbumDetails,
    onOpenFullPlayer,
    isLibraryLoading = false,
    libraryError = null,
    onRetryLoad,
    onScrollChange,
  }: HomeViewProps) => {
    useRenderLog('HomeView');

    const {
      currentTrack,
      isPlaying,
      currentCoverUrl,
      tracks,
      libraryStats,
      librarySecondaryError,
      isLibrarySecondaryLoading,
      retryLibrarySecondaryData,
      albumTracksByKey,
      albums,
      playAlbum,
      handleTogglePlay,
      handlePrevious,
      handleNext,
    } = useHomeViewModel('home-view');

    const heroAccent = 'var(--hero-accent)';
    const heroGlow = 'var(--hero-glow)';

    const reducedEffects = useEffectiveReducedEffects();
    const handleScroll = useCallback(
      (event: UIEvent<HTMLDivElement>) => onScrollChange?.(event.currentTarget.scrollTop > 8),
      [onScrollChange],
    );
    const hasFinePointer = useFinePointer();
    const interactiveOn = !reducedEffects && hasFinePointer;
    const coverTilt = useCoverTilt(interactiveOn);
    const handleOpenAlbumDetails = useHomeAlbumDetailsLoader(onOpenAlbumDetails, 'home-view');

    const stats = useMemo(() => {
      if (libraryStats)
        return {
          totalTracks: libraryStats.trackCount,
          totalHours: Math.floor(libraryStats.totalDuration / 3600),
          uniqueArtists: libraryStats.artistCount,
          albumCount: libraryStats.albumCount || albums.length,
        };
      return {
        totalTracks: tracks.length,
        totalHours: Math.floor(tracks.reduce((a, t) => a + t.duration, 0) / 3600),
        uniqueArtists: new Set(tracks.map((t) => t.artist)).size,
        albumCount: albums.length,
      };
    }, [libraryStats, tracks, albums.length]);

    const animTracks = useAnimatedCounter(stats.totalTracks, 1500, reducedEffects);
    const animHours = useAnimatedCounter(stats.totalHours, 1500, reducedEffects);
    const animArtists = useAnimatedCounter(stats.uniqueArtists, 1500, reducedEffects);
    const animAlbums = useAnimatedCounter(stats.albumCount, 1500, reducedEffects);

    // -------------------------------------------------------------------------
    // Loading skeleton
    // -------------------------------------------------------------------------

    if (isLibraryLoading) {
      return (
        <div className="h-full overflow-y-auto pb-32 custom-scrollbar" onScroll={handleScroll}>
          <div
            className="max-w-7xl mx-auto px-6 py-8 space-y-6 animate-pulse"
            role="status"
            aria-label="Loading home"
          >
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
        <div className="h-full overflow-y-auto pb-32 custom-scrollbar" onScroll={handleScroll}>
          <div className="max-w-2xl mx-auto px-6 py-20 text-center" role="alert">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-5 shadow-[0_0_24px_-8px_rgba(239,68,68,0.35)]">
              <Music2 className="w-7 h-7 text-red-400/70" />
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">Library failed to load</h2>
            <p className="text-white/45 mb-6 text-sm">{libraryError}</p>
            {onRetryLoad && (
              <Button
                onClick={onRetryLoad}
                className="rounded-full bg-gradient-to-b from-white/14 to-white/8 text-white hover:from-white/18 hover:to-white/10 active:scale-[0.97] h-10 px-5 font-medium transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-standard)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]"
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
      <div
        className="h-full overflow-y-auto pb-32 custom-scrollbar relative"
        onScroll={handleScroll}
      >
        {/* Full-viewport ambient: `LiquidHomeAmbientBackdrop` in App (under TopBar). */}

        <div className="max-w-7xl mx-auto px-6 py-8 relative z-10">
          {librarySecondaryError && (
            <StatePanel
              tone="warning"
              role="alert"
              title="Some library data is unavailable."
              description={librarySecondaryError}
              action={{
                label: isLibrarySecondaryLoading ? 'Retrying...' : 'Retry library data',
                onClick: retryLibrarySecondaryData,
                disabled: isLibrarySecondaryLoading,
              }}
              className="mb-6 rounded-xl p-3"
            />
          )}

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
                            : 'scale-[1.10] blur-[4px] saturate-[1.6] opacity-[0.34]',
                        )}
                        draggable={false}
                      />
                    )}
                    {/* Readability overlay */}
                    <div
                      className="absolute inset-0"
                      style={{
                        background:
                          'linear-gradient(115deg, rgba(5,3,2,0.88) 0%, rgba(7,5,3,0.72) 42%, rgba(5,4,3,0.40) 100%)',
                      }}
                    />
                    {/* Accent radial - warms the cover art side */}
                    <div
                      className="absolute inset-0 transition-[background] duration-700"
                      style={{
                        background: `radial-gradient(circle at 20% 56%, ${heroGlow} 0%, transparent 54%)`,
                      }}
                    />
                  </div>

                  {/* Progress bar (top edge, hover-reveal) */}
                  <HidingProgressBar accentColor={heroAccent} />

                  {/* Volume + Expand (absolute top-right) */}
                  <div className="absolute top-5 right-5 z-30 flex items-center gap-2">
                    <VolumeControl accentColor={heroAccent} />
                    {onOpenFullPlayer && (
                      <Button
                        onClick={onOpenFullPlayer}
                        className="h-9 w-9 rounded-full inline-flex items-center justify-center bg-black/40 text-white/55 hover:text-white transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-standard)]"
                        aria-label="Fullscreen player"
                        title="Fullscreen"
                        accentColor={heroAccent}
                      >
                        <Maximize2 className="h-[14px] w-[14px]" />
                      </Button>
                    )}
                  </div>

                  {/* Status bar (absolute bottom-right) */}
                  <HeroStatusBar />

                  {/* Main layout */}
                  <div className="relative z-10 flex flex-col items-stretch gap-5 p-5 sm:flex-row sm:items-start sm:gap-7 sm:p-7 lg:gap-8 lg:p-8">
                    {/* Cover art with 3D tilt and ambient bloom */}
                    <div className="relative mx-auto shrink-0 isolate sm:mx-0">
                      {/* Ambient bloom behind the cover */}
                      <div
                        className="pointer-events-none absolute left-1/2 top-1/2 h-[130%] w-[130%] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[8px] -z-10 transition-[background,opacity] duration-700"
                        style={{
                          opacity: reducedEffects ? 0.2 : 0.36,
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
                          !interactiveOn && 'home-cover-tilt-static',
                        )}
                        style={{
                          width: 'clamp(174px, 19.5vw, 256px)',
                          height: 'clamp(174px, 19.5vw, 256px)',
                          boxShadow: `
                          0 20px 58px rgba(0,0,0,0.58),
                          0 0 0 0 rgba(255,255,255,0.08)`,
                        }}
                      >
                        <CoverArtImage
                          track={currentTrack}
                          className="h-full w-full"
                          imgClassName="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                          roundedClassName="rounded-[20px]"
                          iconClassName="h-12 w-12"
                          alt={currentTrack.album}
                          lazy={false}
                          size="large"
                        />
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-x-2 top-0 z-[20] h-px rounded-full opacity-70"
                          style={{
                            background:
                              'linear-gradient(90deg, transparent, rgba(255,255,255,0.45), transparent)',
                          }}
                        />
                      </div>
                    </div>

                    {/* Track info + transport */}
                    <div
                      className="flex w-full min-w-0 flex-1 flex-col py-0.5"
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
                        className="font-display font-extrabold uppercase text-white line-clamp-2 leading-[0.88] tracking-normal text-[1.85rem] md:text-[3rem] lg:text-[3.75rem]"
                        title={currentTrack.title}
                      >
                        {currentTrack.title}
                      </h1>

                      {/* Artist */}
                      <p className="mt-2 font-display font-semibold text-white/90 truncate text-[1.05rem] md:text-[1.25rem] lg:text-[1.42rem]">
                        {currentTrack.artist}
                      </p>

                      {/* Album */}
                      <p className="mt-0.5 font-medium text-white/34 truncate text-[0.82rem] md:text-[0.9rem] lg:text-[0.97rem]">
                        {currentTrack.album}
                      </p>

                      {/* Lyrics */}
                      <CardLyricsDisplay />

                      <div className="flex-1" />

                      {/* Transport controls */}
                      <div className="flex items-center gap-[18px] mt-5">
                        {/* Previous */}
                        <Button
                          onClick={handlePrevious}
                          className="h-11 w-11 rounded-full inline-flex items-center justify-center shrink-0 bg-black/38 text-white/65 hover:text-white transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-standard)]"
                          aria-label="Previous track"
                          accentColor={heroAccent}
                        >
                          <SkipBack className="h-[16px] w-[16px] fill-current" />
                        </Button>

                        {/* Play / Pause */}
                        <Button
                          onClick={handleTogglePlay}
                          className="h-[60px] w-[60px] rounded-full inline-flex items-center justify-center shrink-0 bg-white text-black transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-emphasis)]"
                          style={{
                            boxShadow: `
                            0 12px 40px -10px color-mix(in oklch, var(--hero-accent) 40%, transparent),
                            0 8px 28px rgba(0,0,0,0.28)`,
                          }}
                          aria-label={isPlaying ? 'Pause' : 'Play'}
                          variant="primary"
                          accentColor="#ffffff"
                          accentForeground="#000000"
                          pressFeedback="inset"
                        >
                          {isPlaying ? (
                            <Pause className="h-[22px] w-[22px] fill-black" />
                          ) : (
                            <Play className="ml-[3px] h-[22px] w-[22px] fill-black" />
                          )}
                        </Button>

                        {/* Next */}
                        <Button
                          onClick={handleNext}
                          className="h-11 w-11 rounded-full inline-flex items-center justify-center shrink-0 bg-black/38 text-white/65 hover:text-white transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-standard)]"
                          aria-label="Next track"
                          accentColor={heroAccent}
                        >
                          <SkipForward className="h-[16px] w-[16px] fill-current" />
                        </Button>
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
                      style={{ background: heroAccent, opacity: 0.8 }}
                    />
                  </span>
                  <h2 className="text-[17px] font-semibold text-white tracking-normal">Albums</h2>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onNavigateToLibrary}
                  className="flex items-center gap-1.5 text-sm text-white/35 hover:text-white/72 active:scale-[0.97] transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-standard)]"
                >
                  View all <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </div>

              {/* Desktop / tablet layout: one grid row so featured + 4-col grid share height */}
              <div
                className="hidden sm:grid gap-4 min-h-0"
                style={{
                  gridTemplateColumns:
                    albums.length > 1 ? 'minmax(160px, min(320px, 38%)) minmax(0, 1fr)' : '1fr',
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
                      onOpenAlbumDetails={handleOpenAlbumDetails}
                      onPlayAlbum={playAlbum}
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
                        onOpenAlbumDetails={handleOpenAlbumDetails}
                        onPlayAlbum={playAlbum}
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
                    onOpenAlbumDetails={handleOpenAlbumDetails}
                    onPlayAlbum={playAlbum}
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
              <p className="text-white/40 mb-6 text-sm">
                Add some folders to start building your library
              </p>
              <Button
                onClick={onNavigateToFolders}
                className="rounded-full bg-white text-black hover:bg-white/90 active:scale-[0.97] font-semibold h-12 px-6 inline-flex items-center gap-2 transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-standard)]"
              >
                Add Folders <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  },
);

HomeView.displayName = 'HomeView';
