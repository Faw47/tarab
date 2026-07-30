import {
  Disc3,
  Maximize2,
  Mic2,
  Music2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { type CSSProperties, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';

import { useCoverArt } from '../../hooks/useCoverArt';
import { getAlbumArtist, getAlbumKey } from '../../lib/album-key';
import { playAdjacentTrack, toggleCurrentPlayback } from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import { setVolume as setAudioVolume } from '../../lib/tauri-commands';

import { usePlayerStore } from '../../store/player-store';
import type { Track } from '../../types';
import { CoverArtImage } from '../shared/CoverArtImage';
import { HidingProgressBar } from '../shared/HidingProgressBar';
import { NeoSectionHeader } from '../ui/NeoSectionHeader';
import type { HomeViewProps } from './homeTypes';
import { useHomeLibraryModel } from './useHomeLibraryModel';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const BORDER = 'border-2 border-black';
const SHADOW_COMP = 'shadow-[4px_4px_0_0_#000]';
const SHADOW_PANEL = 'shadow-[4px_4px_0_0_#000]';
const PRESS_EFFECT = 'active:translate-x-[4px] active:translate-y-[4px] active:shadow-none';
const SNAP = 'transition-none';
const STROKE = 3;

const POLAROID_ROTATIONS = [
  'rotate-[-0.8deg]',
  'rotate-[0.6deg]',
  'rotate-[-0.4deg]',
  'rotate-[0.8deg]',
];
const POLAROID_TAPE_ROTATIONS = [
  'rotate-[-4deg]',
  'rotate-[3deg]',
  'rotate-[-3deg]',
  'rotate-[4deg]',
];

const NEO_POLAROID_CARD =
  'group relative cursor-pointer select-none border-[1.5px] border-[#1a1a1a] bg-[#fafaf7] p-2 pb-7 shadow-[3px_3px_0_0_#1a1a1a] transition-none hover:bg-[#fcfcf9] hover:shadow-[4px_4px_0_0_#1a1a1a] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none';
const NEO_POLAROID_PLAYING =
  'border-[var(--signal-play)] bg-[var(--signal-play)] shadow-[3px_3px_0_0_var(--signal-play)]';

const NEO_TAPE =
  'pointer-events-none absolute -top-[9px] left-1/2 z-20 h-[18px] w-12 -translate-x-1/2 opacity-90';
const TAPE_STYLE: CSSProperties = {
  background: 'rgba(230, 200, 120, 0.28)',
  border: '1px solid rgba(180, 155, 80, 0.35)',
  boxShadow: '0 1px 2px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.4)',
};

function polaroidRotation(i: number): string {
  return POLAROID_ROTATIONS[i % POLAROID_ROTATIONS.length];
}

function polaroidTapeRotation(i: number): string {
  return POLAROID_TAPE_ROTATIONS[i % POLAROID_TAPE_ROTATIONS.length];
}

const NeoVolumeControl = memo(() => {
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
        reportError('Failed to set volume', { source: 'home-neo', error: e });
      }
    },
    [setVolume],
  );

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

  return (
    <div className="inline-flex items-center gap-2" onMouseEnter={onEnter} onMouseLeave={onLeave}>
      <button
        type="button"
        className={cn(
          BORDER,
          'flex h-10 w-10 shrink-0 items-center justify-center bg-white',
          SNAP,
          PRESS_EFFECT,
          SHADOW_COMP,
        )}
        onClick={() => void commit(volume <= 0.001 ? Math.max(restoreRef.current, 0.5) : 0)}
        aria-label={volume <= 0.001 ? 'Unmute' : 'Mute'}
        title="Volume"
      >
        {volume <= 0.001 ? (
          <VolumeX size={16} strokeWidth={STROKE} />
        ) : (
          <Volume2 size={16} strokeWidth={STROKE} />
        )}
      </button>
      <div
        className={cn(
          'flex items-center overflow-hidden ease-out',
          expanded ? 'w-auto opacity-100' : 'w-0 opacity-0',
          'transition-[width,opacity] duration-[var(--motion-standard)]',
        )}
      >
        <div className={cn(BORDER, SHADOW_COMP, 'bg-white px-2 py-1.5')}>
          <div className="neo-volume-wrap">
            {Array.from({ length: 10 }).map((_, i) => {
              const segmentValue = (i + 1) / 10;
              const active = volume >= segmentValue - 0.05;
              return (
                <div
                  key={i}
                  role="button"
                  tabIndex={0}
                  className={cn('neo-volume-segment', active && 'active')}
                  onClick={() => void commit(segmentValue)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void commit(segmentValue);
                    }
                  }}
                  aria-label={`Set volume to ${Math.round(segmentValue * 100)}%`}
                />
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
});
NeoVolumeControl.displayName = 'NeoVolumeControl';

const NowPlayingEqualizer = memo(({ isPlaying }: { isPlaying: boolean }) => {
  return (
    <div className="flex h-8 w-12 items-end gap-[3px] overflow-hidden" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'flex-1 border-t-2 border-black bg-[var(--signal-play)]',
            isPlaying && 'animate-pulse',
          )}
          style={{
            height: isPlaying ? `${20 + ((i * 17) % 60)}%` : '20%',
            animationDelay: `${i * 0.15}s`,
          }}
        />
      ))}
    </div>
  );
});
NowPlayingEqualizer.displayName = 'NowPlayingEqualizer';

const NeoLyricsConsole = memo(() => {
  const { lyrics, currentTime } = usePlayerStore(
    useShallow((s) => ({ lyrics: s.lyrics, currentTime: s.currentTime })),
  );

  const activeLine = useMemo(() => {
    if (!lyrics?.lines) return null;
    let found = lyrics.lines[0];
    for (const line of lyrics.lines) {
      if (currentTime * 1000 >= line.startTime) {
        found = line;
      } else {
        break;
      }
    }
    return found;
  }, [lyrics, currentTime]);

  if (!lyrics?.lines?.length) return null;

  const words = activeLine?.words;
  const displayWords =
    typeof words === 'string'
      ? words
      : words?.map((w: { text: string }) => w.text).join('') || '...';

  return (
    <div className={cn(BORDER, SHADOW_COMP, 'flex flex-col gap-1.5 bg-white p-3 md:p-4')}>
      <div className="mb-0.5 flex items-center gap-2">
        <Mic2 size={14} strokeWidth={STROKE} />
        <span className="neo-type-level-3">Active Lyrics</span>
      </div>
      <p className="neo-type-level-4 line-clamp-3 uppercase italic leading-snug text-black">
        &ldquo;{displayWords}&rdquo;
      </p>
    </div>
  );
});
NeoLyricsConsole.displayName = 'NeoLyricsConsole';

interface NeoAlbumCardProps {
  track: Track;
  albumTracks: Track[];
  isPlayingAlbum: boolean;
  index: number;
  onOpenAlbumDetails?: (payload: {
    album: string;
    artist: string;
    coverArt?: string;
    tracks: Track[];
  }) => void;
  onPlayAlbum: (track: Track, albumTracks: Track[]) => Promise<void>;
}

const NeoAlbumCard = memo(
  ({
    track,
    albumTracks,
    isPlayingAlbum,
    index,
    onOpenAlbumDetails,
    onPlayAlbum,
  }: NeoAlbumCardProps) => {
    const open = useCallback(() => {
      onOpenAlbumDetails?.({
        album: track.album,
        artist: getAlbumArtist(track),
        coverArt: track.coverArt,
        tracks: albumTracks,
      });
    }, [onOpenAlbumDetails, track, albumTracks]);

    return (
      <div
        className={cn(
          NEO_POLAROID_CARD,
          'flex aspect-[4/5] flex-col',
          polaroidRotation(index),
          isPlayingAlbum && NEO_POLAROID_PLAYING,
        )}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div
          className={cn(NEO_TAPE, polaroidTapeRotation(index))}
          style={TAPE_STYLE}
          aria-hidden="true"
        />
        <div className="relative mb-3 aspect-square w-full overflow-hidden border-2 border-black bg-black">
          <div className="pointer-events-none absolute inset-1 z-10 border-2 border-black" />
          <CoverArtImage
            track={track}
            variant="album"
            size="medium"
            className="h-full w-full"
            imgClassName="h-full w-full object-cover"
            roundedClassName="rounded-none"
          />
          <button
            type="button"
            className={cn(
              BORDER,
              'absolute bottom-2 right-2 z-20 flex h-11 w-11 items-center justify-center bg-[#9D80E3]',
              SNAP,
              PRESS_EFFECT,
              'shadow-[3px_3px_0_0_#000] hover:bg-[var(--signal-active)]',
              'opacity-0 group-hover:opacity-100',
            )}
            onClick={(e) => {
              e.stopPropagation();
              void onPlayAlbum(track, albumTracks);
            }}
            aria-label={`Play ${track.album}`}
          >
            <Play size={18} fill="currentColor" strokeWidth={STROKE} />
          </button>
        </div>
        <p className="truncate text-center text-[12px] font-black uppercase tracking-[0.1em] text-black">
          {track.album}
        </p>
        <p className="mt-1 truncate text-center text-[12px] font-bold uppercase tracking-[0.15em] text-black/50">
          {track.artist}
        </p>
      </div>
    );
  },
);
NeoAlbumCard.displayName = 'NeoAlbumCard';

export const HomeViewNeo = memo(function HomeViewNeo({
  onNavigateToFolders,
  onOpenAlbumDetails,
  onOpenFullPlayer,
  isLibraryLoading = false,
  libraryError = null,
  onRetryLoad,
  onScrollChange,
}: HomeViewProps) {
  const { currentTrack, isPlaying } = usePlayerStore(
    useShallow((s) => ({
      currentTrack: s.currentTrack,
      isPlaying: s.isPlaying,
    })),
  );

  const currentCoverUrl =
    useCoverArt(
      currentTrack?.filePath,
      currentTrack?.hasCoverArt,
      true,
      'large',
      currentTrack?.coverArtHash,
    ) ?? null;

  const { albumTracksByKey, albums: allAlbums, playAlbum } = useHomeLibraryModel();
  const albums = allAlbums.slice(0, 24);

  if (isLibraryLoading) {
    return (
      <div className="h-full overflow-y-auto bg-transparent custom-scrollbar">
        <div
          className="mx-auto flex max-w-[1600px] animate-pulse flex-col gap-8 p-6 md:p-8 lg:p-10"
          role="status"
          aria-label="Loading home"
        >
          <div className={cn(BORDER, SHADOW_PANEL, 'h-[340px] bg-white')} />
          <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className={cn(BORDER, SHADOW_COMP, 'aspect-[4/5] bg-white')} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (libraryError) {
    return (
      <div className="flex h-full items-start justify-center overflow-y-auto bg-transparent p-8 custom-scrollbar">
        <section
          className={cn(BORDER, SHADOW_PANEL, 'mt-12 max-w-xl bg-white p-8 text-center')}
          role="alert"
        >
          <Music2 className="mx-auto mb-4" size={48} strokeWidth={STROKE} aria-hidden="true" />
          <h2 className="neo-type-level-1 text-black">Library failed to load</h2>
          <p className="mt-3 break-words font-bold text-black/65">{libraryError}</p>
          {onRetryLoad && (
            <button
              type="button"
              className={cn(
                BORDER,
                SHADOW_COMP,
                PRESS_EFFECT,
                SNAP,
                'mt-6 bg-[var(--signal-play)] px-5 py-3 font-black uppercase text-black',
              )}
              onClick={onRetryLoad}
            >
              Retry
            </button>
          )}
        </section>
      </div>
    );
  }

  return (
    <div
      className="h-full w-full overflow-y-auto bg-transparent custom-scrollbar"
      onScroll={(e) => onScrollChange?.(e.currentTarget.scrollTop > 20)}
    >
      <div className="mx-auto flex max-w-[1600px] flex-col gap-8 p-6 md:p-8 lg:p-10">
        <section
          className={cn(
            BORDER,
            SHADOW_PANEL,
            'group relative flex flex-col items-stretch gap-6 overflow-visible bg-white p-6 lg:flex-row lg:gap-8',
          )}
        >
          <HidingProgressBar accentColor="var(--signal-play)" />

          <div className="mx-auto flex w-full max-w-[240px] shrink-0 flex-col gap-3 sm:max-w-[260px] lg:mx-0">
            <div
              className={cn(
                BORDER,
                SHADOW_COMP,
                'relative aspect-square w-full overflow-hidden bg-[var(--neo-muted)]',
              )}
            >
              {currentCoverUrl ? (
                <img
                  src={currentCoverUrl}
                  alt="Now Playing"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Disc3 size={88} strokeWidth={1} className="text-black/10" />
                </div>
              )}
              <div className="absolute right-3 top-3">
                <NowPlayingEqualizer isPlaying={isPlaying} />
              </div>
            </div>

            <NeoLyricsConsole />
          </div>

          <div className="flex min-w-0 flex-1 flex-col justify-between gap-4">
            <div className="flex flex-col gap-3">
              {currentTrack ? (
                <>
                  <h1 className="neo-type-level-1 break-words py-1 text-black">
                    {currentTrack.title}
                  </h1>
                  <div className={cn(BORDER, SHADOW_COMP, 'self-start bg-[#FFE234] px-3 py-1.5')}>
                    <span className="neo-type-level-2 text-black">{currentTrack.artist}</span>
                  </div>
                </>
              ) : (
                <div className="py-4">
                  <h1 className="neo-type-level-1 text-black/20">Console Standby</h1>
                </div>
              )}
            </div>

            <div className="mt-2 lg:mt-0">
              <div className="mb-4 flex flex-wrap items-end justify-between gap-4 overflow-visible">
                <div className="flex items-end gap-3 overflow-visible">
                  <button
                    type="button"
                    onClick={() => playAdjacentTrack('previous')}
                    className={cn(
                      BORDER,
                      'flex h-14 w-14 items-center justify-center bg-white',
                      SNAP,
                      PRESS_EFFECT,
                      SHADOW_COMP,
                    )}
                    aria-label="Previous track"
                  >
                    <SkipBack size={24} fill="currentColor" strokeWidth={STROKE} />
                  </button>
                  <button
                    type="button"
                    className="neo-play-pause"
                    onClick={() => toggleCurrentPlayback()}
                    aria-label={isPlaying ? 'Pause' : 'Play'}
                  >
                    {isPlaying ? (
                      <Pause className="h-7 w-7" fill="currentColor" strokeWidth={STROKE} />
                    ) : (
                      <Play className="ml-1 h-7 w-7" fill="currentColor" strokeWidth={STROKE} />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => playAdjacentTrack('next')}
                    className={cn(
                      BORDER,
                      'flex h-14 w-14 items-center justify-center bg-white',
                      SNAP,
                      PRESS_EFFECT,
                      SHADOW_COMP,
                    )}
                    aria-label="Next track"
                  >
                    <SkipForward size={24} fill="currentColor" strokeWidth={STROKE} />
                  </button>
                </div>

                <div className="flex shrink-0 items-center justify-end gap-3">
                  {onOpenFullPlayer && (
                    <button
                      type="button"
                      onClick={onOpenFullPlayer}
                      className={cn(
                        BORDER,
                        'flex h-10 w-10 items-center justify-center bg-white',
                        SNAP,
                        PRESS_EFFECT,
                        SHADOW_COMP,
                      )}
                      aria-label="Fullscreen"
                      title="Fullscreen"
                    >
                      <Maximize2 size={16} strokeWidth={STROKE} />
                    </button>
                  )}
                  <NeoVolumeControl />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="pb-20">
          <div className="mb-8">
            <NeoSectionHeader emoji="💿" label="ALBUMS" />
          </div>

          {albums.length > 0 ? (
            <div className="grid grid-cols-2 gap-6 pt-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 lg:gap-8">
              {albums.map((item, albumIndex) => {
                const key = getAlbumKey(item.track);
                const albumTracks = albumTracksByKey.get(key) ?? [];
                const isPlayingAlbum =
                  !!currentTrack &&
                  currentTrack.album === item.track.album &&
                  getAlbumArtist(currentTrack) === getAlbumArtist(item.track) &&
                  isPlaying;
                return (
                  <NeoAlbumCard
                    key={key}
                    track={item.track}
                    albumTracks={albumTracks}
                    index={albumIndex}
                    isPlayingAlbum={isPlayingAlbum}
                    onOpenAlbumDetails={onOpenAlbumDetails}
                    onPlayAlbum={playAlbum}
                  />
                );
              })}
            </div>
          ) : (
            <div className="neo-empty-state mt-6">
              <Music2 size={80} strokeWidth={STROKE} className="mx-auto mb-8 text-black/10" />
              <h3 className="neo-empty-state-primary">COLD STORAGE / NO RECORDS FOUND</h3>
              <p className="neo-empty-state-secondary">
                The local entity database is currently empty. Initialize a source mapping to begin
                records ingestion.
              </p>
              <button
                type="button"
                onClick={onNavigateToFolders}
                className={cn(
                  BORDER,
                  'mt-6 h-16 bg-[#FFE234] px-10 font-black uppercase tracking-[0.2em]',
                  SNAP,
                  PRESS_EFFECT,
                  SHADOW_COMP,
                )}
              >
                MAP FOLDERS
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
});

HomeViewNeo.displayName = 'HomeViewNeo';
