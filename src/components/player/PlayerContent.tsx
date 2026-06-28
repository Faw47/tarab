import { clsx } from 'clsx';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ChevronDown,
  ChevronRight,
  Edit3,
  Eye,
  EyeOff,
  FolderOpen,
  Headphones,
  ListPlus,
  Mic2,
  MoreHorizontal,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Sliders,
  User,
} from 'lucide-react';
import { VinylIcon, TrackIcon, QueueIcon as ListMusic } from '../ui/Icons';
import { memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSmoothTimeSubscription } from '../../contexts/smooth-time';
import { useCoverArt } from '../../hooks/useCoverArt';
import { useRenderLog } from '../../lib/performance';
import { lazyWithRetry } from '../../lib/lazy-with-retry';
import {
  playAdjacentTrack,
  seekToPosition,
  toggleCurrentPlayback,
} from '../../lib/playback-actions';
import { rangeProgressStyle } from '../../lib/range-progress-style';
import { reportError } from '../../lib/report-error';
import {
  revealInFileManager,
  setAudioBooster,
  setPlaybackSpeed as setAudioPlaybackSpeed,
} from '../../lib/tauri-commands';
import { refreshTracksByFilePaths } from '../../lib/track-refresh';
import { usePlayerStore } from '../../store/player-store';
import { useSettingsStore } from '../../store/settings-store';
import { PlaylistPickerDialog } from '../playlist/PlaylistPickerDialog';
import { IconButton } from '../ui/IconButton';
import { LyricsDisplay } from './LyricsDisplay';
import { LyricsSnippet } from './LyricsSnippet';
import { ParallaxCoverArt } from './ParallaxCoverArt';
import { PlayerProgressBar } from './PlayerProgressBar';
import { PlayerVolume } from './PlayerVolume';
import { TiltAlbumArt } from './TiltAlbumArt';

interface PlayerContentProps {
  onClose: () => void;
}

const TagEditorModal = lazyWithRetry(() =>
  import('../tageditor/TagEditorModal').then((mod) => ({ default: mod.TagEditorModal })),
);

export const PlayerContent = memo(({ onClose }: PlayerContentProps) => {
  useRenderLog('PlayerContent');
  const {
    currentTrack,
    isPlaying,
    duration,
    playbackSpeed,
    shuffleEnabled,
    loopMode,
    lyrics,
    boosterLevel,
    toggleShuffle,
    toggleLoop,
    addToQueue: addTrackToQueue,
  } = usePlayerStore(
    useShallow((s) => ({
      currentTrack: s.currentTrack,
      isPlaying: s.isPlaying,
      duration: s.duration,
      playbackSpeed: s.playbackSpeed,
      shuffleEnabled: s.shuffleEnabled,
      loopMode: s.loopMode,
      lyrics: s.lyrics,
      boosterLevel: s.boosterLevel,
      toggleShuffle: s.toggleShuffle,
      toggleLoop: s.toggleLoop,
      addToQueue: s.addToQueue,
    })),
  );

  const coverArt = useCoverArt(
    currentTrack?.filePath,
    currentTrack?.hasCoverArt,
    true,
    'large',
    currentTrack?.coverArtHash,
  );

  const lyricsEnabled = useSettingsStore((s) => s.lyricsEnabled);
  const reducedEffects = useSettingsStore((s) => s.reducedEffects);
  const fullscreenPlayerLayout = useSettingsStore((s) => s.fullscreenPlayerLayout);
  const fullscreenHideCoverArt = useSettingsStore((s) => s.fullscreenHideCoverArt);
  const fullscreenLyricSize = useSettingsStore((s) => s.fullscreenLyricSize);
  const fullscreenLyricAlignment = useSettingsStore((s) => s.fullscreenLyricAlignment);
  const fullscreenBackgroundAnimation = useSettingsStore((s) => s.fullscreenBackgroundAnimation);
  const fullscreenBackgroundBlur = useSettingsStore((s) => s.fullscreenBackgroundBlur);
  const setFullscreenHideCoverArt = useSettingsStore((s) => s.setFullscreenHideCoverArt);
  const setFullscreenLyricSize = useSettingsStore((s) => s.setFullscreenLyricSize);
  const setFullscreenLyricAlignment = useSettingsStore((s) => s.setFullscreenLyricAlignment);
  const setFullscreenBackgroundAnimation = useSettingsStore(
    (s) => s.setFullscreenBackgroundAnimation,
  );
  const setFullscreenBackgroundBlur = useSettingsStore((s) => s.setFullscreenBackgroundBlur);
  const hasLyrics = lyricsEnabled && !!lyrics && lyrics.lines.length > 0;

  const [viewMode, setViewMode] = useState<'card' | 'lyrics'>('card');
  const [showActions, setShowActions] = useState(false);
  const [showTagEditor, setShowTagEditor] = useState(false);
  const [tagEditorInitialTab, setTagEditorInitialTab] = useState<
    'standard' | 'extended' | 'lyrics' | undefined
  >(undefined);
  const [showPlaylistSelector, setShowPlaylistSelector] = useState(false);
  const [showViewOptions, setShowViewOptions] = useState(false);
  const [showBackgroundOptions, setShowBackgroundOptions] = useState(false);
  const tagEditorTracks = useMemo(() => (currentTrack ? [currentTrack] : []), [currentTrack]);
  const reduceBlur = reducedEffects;

  const actionsRef = useRef<HTMLButtonElement>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  // Fullscreen cover-art progress bar (updated imperatively to avoid 60fps re-renders)
  const progressRef = useRef<HTMLDivElement>(null);

  const setCoverProgress = useCallback(
    (timeSec: number) => {
      if (!progressRef.current) return;
      const clamped = Math.max(0, Math.min(timeSec, duration || 0));
      const progress = duration > 0 ? (clamped / duration) * 100 : 0;
      progressRef.current.style.background = `linear-gradient(to right,
            rgba(255,255,255,0.9) ${progress}%,
            rgba(255,255,255,0.2) ${progress}%)`;
    },
    [duration],
  );

  useSmoothTimeSubscription((timeSec) => {
    setCoverProgress(timeSec);
  });

  useEffect(() => {
    setCoverProgress(usePlayerStore.getState().currentTime || 0);
  }, [currentTrack?.id, duration, setCoverProgress]);

  useEffect(() => {
    if (!showActions) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node;
      const isOutsideButton = actionsRef.current && !actionsRef.current.contains(target);
      const isOutsideMenu = actionsMenuRef.current && !actionsMenuRef.current.contains(target);
      if (isOutsideButton && isOutsideMenu) {
        setShowActions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showActions]);

  useEffect(() => {
    const applySpeed = async () => {
      try {
        await setAudioPlaybackSpeed(playbackSpeed);
      } catch (err) {
        reportError('Failed to sync playback speed', { source: 'player-content', error: err });
      }
    };
    applySpeed();
  }, [playbackSpeed]);

  useEffect(() => {
    const applyBooster = async () => {
      try {
        await setAudioBooster(boosterLevel);
      } catch (err) {
        reportError('Failed to sync audio booster', { source: 'player-content', error: err });
      }
    };
    applyBooster();
  }, [boosterLevel]);

  const handleTogglePlay = useCallback(async () => {
    try {
      if (!currentTrack) return;
      await toggleCurrentPlayback();
    } catch (e) {
      reportError('Failed to toggle playback', { source: 'player-content', error: e });
    }
  }, [currentTrack]);

  const handlePrevious = useCallback(async () => {
    try {
      await playAdjacentTrack('previous');
    } catch (e) {
      reportError('Failed to play previous track', { source: 'player-content', error: e });
    }
  }, []);

  const handleNext = useCallback(async () => {
    try {
      await playAdjacentTrack('next');
    } catch (e) {
      reportError('Failed to play next track', { source: 'player-content', error: e });
    }
  }, []);

  const handleSeekClick = useCallback(
    async (e: React.MouseEvent<HTMLDivElement>) => {
      if (!progressRef.current || duration === 0) return;
      const rect = progressRef.current.getBoundingClientRect();
      const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const newTime = percent * duration;
      setCoverProgress(newTime);
      try {
        await seekToPosition(newTime);
      } catch (err) {
        reportError('Failed to seek playback', { source: 'player-content', error: err });
      }
    },
    [duration, setCoverProgress],
  );

  const handleEditTags = useCallback(() => {
    setTagEditorInitialTab(undefined);
    setShowTagEditor(true);
    setShowActions(false);
  }, []);

  const handleEditLyrics = useCallback(() => {
    setTagEditorInitialTab('lyrics');
    setShowTagEditor(true);
    setShowActions(false);
  }, []);

  const handleAddToQueue = useCallback(() => {
    if (currentTrack) {
      addTrackToQueue(currentTrack, 'last');
      setShowActions(false);
    }
  }, [currentTrack, addTrackToQueue]);

  const handleRevealInFinder = useCallback(async () => {
    if (currentTrack) {
      try {
        await revealInFileManager(currentTrack.filePath);
        setShowActions(false);
      } catch (err) {
        reportError('Failed to reveal in folder', { source: 'player-content', error: err });
      }
    }
  }, [currentTrack]);

  const handleAddToPlaylist = useCallback(() => {
    setShowPlaylistSelector(true);
    setShowActions(false);
  }, []);

  const handleToggleCoverArt = useCallback(() => {
    setFullscreenHideCoverArt(!fullscreenHideCoverArt);
  }, [fullscreenHideCoverArt, setFullscreenHideCoverArt]);

  const handleSetLyricSize = useCallback(
    (size: number) => {
      setFullscreenLyricSize(size);
    },
    [setFullscreenLyricSize],
  );

  const handleSetLyricAlignment = useCallback(
    (alignment: 'left' | 'center' | 'right') => {
      setFullscreenLyricAlignment(alignment);
    },
    [setFullscreenLyricAlignment],
  );

  const handleSetBackgroundAnimation = useCallback(
    (animation: 'pan' | 'pulse' | 'none') => {
      setFullscreenBackgroundAnimation(animation);
    },
    [setFullscreenBackgroundAnimation],
  );

  const handleSetBackgroundBlur = useCallback(
    (blur: number) => {
      setFullscreenBackgroundBlur(blur);
    },
    [setFullscreenBackgroundBlur],
  );

  const isLyricsView = viewMode === 'lyrics' && hasLyrics;

  if (!currentTrack) return null;

  // ============================================
  // FULLSCREEN LAYOUT (Two-column with animated background)
  // ============================================
  if (fullscreenPlayerLayout) {
    return (
      <>
        {/* Animated Cover Art Background */}
        <div className="absolute inset-0 -z-20 overflow-hidden">
          {coverArt && (
            <div className="absolute inset-0">
              <div
                className={clsx(
                  'absolute w-[200%] h-[200%] top-1/2 left-1/2',
                  !reduceBlur && fullscreenBackgroundAnimation === 'pan' && 'animate-pan-slow',
                  !reduceBlur && fullscreenBackgroundAnimation === 'pulse' && 'animate-flow-slow',
                )}
                style={{
                  transform: 'translate(-50%, -50%)',
                  filter: reduceBlur
                    ? `blur(30px) saturate(1.2)`
                    : `blur(${fullscreenBackgroundBlur}px) saturate(1.3)`,
                }}
              >
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage: `url(${coverArt})`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                />
              </div>
            </div>
          )}
          <div className="absolute inset-0 bg-black/50" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/40 via-transparent to-black/60" />
        </div>

        {/* Top Right Buttons */}
        <div className="absolute top-6 left-6 right-6 z-40 flex items-center justify-between">
          {/* Close Button */}
          <IconButton
            onClick={onClose}
            className="w-10 h-10 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white backdrop-blur-md"
          >
            <ChevronDown className="w-5 h-5" />
          </IconButton>

          {/* More Actions */}
          <IconButton
            onClick={() => setShowActions(!showActions)}
            ref={actionsRef}
            className="w-10 h-10 bg-white/10 text-white/70 hover:bg-white/20 hover:text-white backdrop-blur-md"
          >
            <MoreHorizontal className="w-4 h-4" />
          </IconButton>
        </div>

        {/* Main Two-Column Layout */}
        <div className="flex-1 w-full h-full flex flex-col md:flex-row items-stretch overflow-y-auto p-6 sm:p-8 md:p-12 gap-6 md:gap-8 relative">
          {/* LEFT COLUMN: Album Art + Controls */}
          {!fullscreenHideCoverArt && (
            <div className="w-full md:w-[45%] flex flex-col justify-center items-center gap-5 md:gap-6 shrink-0">
              {/* Album Art with Integrated Progress Bar */}
              <div className="relative w-full max-w-md aspect-square group">
                {/* Cover Art Container */}
                <div className="w-full h-full rounded-2xl relative">
                  {coverArt ? (
                    <TiltAlbumArt src={coverArt} className="w-full h-full" />
                  ) : (
                    <div className="w-full h-full bg-zinc-800 flex items-center justify-center rounded-2xl shadow-2xl shadow-black/50">
                      <VinylIcon className="w-24 h-24 text-zinc-600" />
                    </div>
                  )}

                  {/* Progress Bar - Integrated at bottom of cover art, expands on hover */}
                  <div
                    ref={progressRef}
                    onClick={handleSeekClick}
                    className="absolute bottom-0 left-0 right-0 h-1 group-hover:h-2.5 cursor-pointer transition-all duration-200 z-10"
                    style={{
                      background:
                        'linear-gradient(to right, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.2) 0%)',
                    }}
                  />
                </div>
              </div>

              {/* Track Info */}
              <div className="w-full max-w-md text-center space-y-2">
                <div className="flex items-center justify-center gap-2">
                  <TrackIcon className="w-4 h-4 text-white/60" />
                  <h1 className="text-2xl md:text-3xl font-bold text-white truncate">
                    {currentTrack.title}
                  </h1>
                </div>
                <div className="flex items-center justify-center gap-2 text-zinc-300">
                  <User className="w-3.5 h-3.5" />
                  <p className="text-lg text-zinc-300 truncate">{currentTrack.artist}</p>
                </div>
                <div className="flex items-center justify-center gap-2 text-zinc-400">
                  <VinylIcon className="w-3.5 h-3.5" />
                  <p className="text-sm text-zinc-400 truncate">{currentTrack.album}</p>
                </div>
              </div>

              {/* Controls Row - Buttons styled with cover art accent */}
              <div className="flex items-center gap-3">
                {/* Shuffle */}
                <div className="relative">
                  <IconButton
                    onClick={toggleShuffle}
                    className={clsx(
                      'w-10 h-10',
                      shuffleEnabled
                        ? 'bg-white/20 text-white shadow-lg ring-1 ring-white/50'
                        : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white',
                    )}
                  >
                    <Shuffle className="w-4 h-4" />
                  </IconButton>
                  {shuffleEnabled && (
                    <div className="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white shadow-[0_0_8px_2px_rgba(255,255,255,0.5)]" />
                  )}
                </div>

                {/* Previous */}
                <IconButton
                  onClick={handlePrevious}
                  className="w-11 h-11 bg-white/15 text-white hover:bg-white/25 active:scale-95"
                >
                  <SkipBack className="w-5 h-5" fill="currentColor" />
                </IconButton>

                {/* Play/Pause - Main Button */}
                <IconButton
                  onClick={handleTogglePlay}
                  className="w-14 h-14 bg-white text-black hover:scale-105 active:scale-95 shadow-lg shadow-white/30"
                >
                  {isPlaying ? (
                    <Pause className="w-6 h-6" fill="currentColor" />
                  ) : (
                    <Play className="w-6 h-6 ml-1" fill="currentColor" />
                  )}
                </IconButton>

                {/* Next */}
                <IconButton
                  onClick={handleNext}
                  className="w-11 h-11 bg-white/15 text-white hover:bg-white/25 active:scale-95"
                >
                  <SkipForward className="w-5 h-5" fill="currentColor" />
                </IconButton>

                {/* Loop */}
                <div className="relative">
                  <IconButton
                    onClick={toggleLoop}
                    className={clsx(
                      'w-10 h-10',
                      loopMode !== 'off'
                        ? 'bg-white/20 text-white shadow-lg ring-1 ring-white/50'
                        : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white',
                    )}
                  >
                    {loopMode === 'one' ? (
                      <Repeat1 className="w-4 h-4" />
                    ) : (
                      <Repeat className="w-4 h-4" />
                    )}
                  </IconButton>
                  {loopMode !== 'off' && (
                    <div className="absolute -bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-white shadow-[0_0_8px_2px_rgba(255,255,255,0.5)]" />
                  )}
                </div>
              </div>
            </div>
          )}

          {/* RIGHT COLUMN: Lyrics */}
          <div
            className={clsx(
              'flex flex-1 flex-col justify-center items-center relative min-h-[45vh]',
              fullscreenHideCoverArt ? 'w-full min-h-full' : 'w-full md:flex',
            )}
          >
            {hasLyrics ? (
              <div className="w-full h-[70vh] max-h-[600px]">
                <LyricsDisplay
                  lyricSize={fullscreenLyricSize}
                  lyricAlignment={fullscreenLyricAlignment}
                />
              </div>
            ) : (
              <div className="text-center text-zinc-500">
                <Mic2 className="w-16 h-16 mx-auto mb-4 opacity-30" />
                <p className="text-lg">No lyrics available</p>
              </div>
            )}
          </div>
        </div>

        {/* Actions Menu */}
        {showActions && (
          <div
            ref={actionsMenuRef}
            className="absolute top-16 right-6 w-64 bg-zinc-900/95 backdrop-blur-xl rounded-xl border border-white/10 shadow-2xl py-2 z-50 animate-fade-in max-h-[80vh] overflow-y-auto"
          >
            <div className="px-3 py-2 text-xs text-text-muted border-b border-white/5 mb-1">
              Playback Options
            </div>
            <button
              onClick={handleEditTags}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text-primary hover:bg-white/10 transition-colors"
            >
              <Edit3 className="w-4 h-4" />
              Edit Tags
            </button>
            <button
              onClick={handleEditLyrics}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text-primary hover:bg-white/10 transition-colors"
            >
              <TrackIcon className="w-4 h-4" />
              Edit Lyrics
            </button>
            <div className="h-px bg-white/5 my-1" />
            <button
              onClick={handleAddToQueue}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text-primary hover:bg-white/10 transition-colors"
            >
              <ListMusic className="w-4 h-4" />
              Add to Queue
            </button>
            <button
              onClick={handleAddToPlaylist}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text-primary hover:bg-white/10 transition-colors"
            >
              <ListPlus className="w-4 h-4" />
              Add to Playlist
            </button>
            <div className="h-px bg-white/5 my-1" />
            <button
              onClick={handleRevealInFinder}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text-primary hover:bg-white/10 transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              Reveal in Finder
            </button>
            <div className="h-px bg-white/5 my-1" />

            {/* View Options Section */}
            <div>
              <button
                onClick={() => setShowViewOptions(!showViewOptions)}
                className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-sm text-text-primary hover:bg-white/10 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Eye className="w-4 h-4" />
                  View Options
                </div>
                <ChevronRight
                  className={clsx('w-4 h-4 transition-transform', showViewOptions && 'rotate-90')}
                />
              </button>
              {showViewOptions && (
                <div className="pl-4 pr-2 py-1 space-y-1">
                  <button
                    onClick={handleToggleCoverArt}
                    className="w-full flex items-center gap-3 px-3 py-2 text-xs text-text-secondary hover:text-white hover:bg-white/10 transition-colors rounded"
                  >
                    {fullscreenHideCoverArt ? (
                      <>
                        <EyeOff className="w-3.5 h-3.5" />
                        Show Cover Art
                      </>
                    ) : (
                      <>
                        <Eye className="w-3.5 h-3.5" />
                        Hide Cover Art
                      </>
                    )}
                  </button>
                  <div className="px-3 py-1.5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs text-text-muted">Lyric Size</div>
                      <div className="text-[10px] text-zinc-400 font-mono bg-white/5 px-1.5 py-0.5 rounded">
                        {fullscreenLyricSize}
                      </div>
                    </div>
                    <input
                      type="range"
                      min="1"
                      max="100"
                      value={fullscreenLyricSize}
                      onChange={(e) => handleSetLyricSize(Number(e.target.value))}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-white hover:accent-primary/80"
                      style={rangeProgressStyle(fullscreenLyricSize, 1, 100)}
                    />
                  </div>
                  <div className="px-3 py-1.5">
                    <div className="text-xs text-text-muted mb-1.5">Alignment</div>
                    <div className="flex gap-1">
                      {(['left', 'center', 'right'] as const).map((alignment) => (
                        <button
                          key={alignment}
                          onClick={() => handleSetLyricAlignment(alignment)}
                          className={clsx(
                            'flex-1 px-2 py-1.5 text-xs rounded transition-colors flex items-center justify-center',
                            fullscreenLyricAlignment === alignment
                              ? 'bg-primary/20 text-primary'
                              : 'bg-white/5 text-text-secondary hover:bg-white/10 hover:text-white',
                          )}
                        >
                          {alignment === 'left' && <AlignLeft className="w-3 h-3" />}
                          {alignment === 'center' && <AlignCenter className="w-3 h-3" />}
                          {alignment === 'right' && <AlignRight className="w-3 h-3" />}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Background Section */}
            <div>
              <button
                onClick={() => setShowBackgroundOptions(!showBackgroundOptions)}
                className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-sm text-text-primary hover:bg-white/10 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Sliders className="w-4 h-4" />
                  Background
                </div>
                <ChevronRight
                  className={clsx(
                    'w-4 h-4 transition-transform',
                    showBackgroundOptions && 'rotate-90',
                  )}
                />
              </button>
              {showBackgroundOptions && (
                <div className="pl-4 pr-2 py-1 space-y-1">
                  <div className="px-3 py-1.5">
                    <div className="text-xs text-text-muted mb-1.5">Animation</div>
                    <div className="flex gap-1">
                      {(['pan', 'pulse', 'none'] as const).map((animation) => (
                        <button
                          key={animation}
                          onClick={() => handleSetBackgroundAnimation(animation)}
                          className={clsx(
                            'flex-1 px-2 py-1.5 text-xs rounded transition-colors',
                            fullscreenBackgroundAnimation === animation
                              ? 'bg-primary/20 text-primary'
                              : 'bg-white/5 text-text-secondary hover:bg-white/10 hover:text-white',
                          )}
                        >
                          {animation === 'pulse'
                            ? 'Flow'
                            : animation.charAt(0).toUpperCase() + animation.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="px-3 py-1.5">
                    <div className="text-xs text-text-muted mb-1.5">Blur</div>
                    <div className="flex gap-1">
                      {(
                        [
                          { label: 'Light', value: 8 },
                          { label: 'Medium', value: 15 },
                          { label: 'Heavy', value: 30 },
                        ] as const
                      ).map((preset) => (
                        <button
                          key={preset.value}
                          onClick={() => handleSetBackgroundBlur(preset.value)}
                          className={clsx(
                            'flex-1 px-2 py-1.5 text-xs rounded transition-colors',
                            fullscreenBackgroundBlur === preset.value
                              ? 'bg-primary/20 text-primary'
                              : 'bg-white/5 text-text-secondary hover:bg-white/10 hover:text-white',
                          )}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {showTagEditor && (
          <div className="fixed inset-0 z-[100]">
            <Suspense fallback={null}>
              <TagEditorModal
                tracks={tagEditorTracks}
                onClose={() => {
                  setShowTagEditor(false);
                  setTagEditorInitialTab(undefined);
                }}
                onSave={() => {
                  if (currentTrack) {
                    refreshTracksByFilePaths([currentTrack.filePath]);
                  }
                }}
                initialTab={tagEditorInitialTab}
              />
            </Suspense>
          </div>
        )}

        <PlaylistPickerDialog
          open={showPlaylistSelector}
          trackIds={currentTrack ? [currentTrack.id] : []}
          onClose={() => setShowPlaylistSelector(false)}
        />
      </>
    );
  }

  // ============================================
  // COMPACT LAYOUT (Original card design)
  // ============================================
  return (
    <>
      {/* Ambient Background (Reduced Blur) */}
      <div className="absolute inset-0 -z-20 overflow-hidden">
        {coverArt && !reduceBlur ? (
          <>
            <div
              className="absolute top-[-40%] left-[-40%] w-[180%] h-[180%] rounded-full opacity-60 animate-blob-spin"
              style={{
                backgroundImage: `url(${coverArt})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                filter: 'blur(9px) saturate(1.4)',
              }}
            />
            <div
              className="absolute top-[-40%] left-[-40%] w-[180%] h-[180%] rounded-full opacity-40 mix-blend-overlay animate-blob-flow"
              style={{
                backgroundImage: `url(${coverArt})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                filter: 'blur(3px) saturate(1.5)',
              }}
            />
          </>
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background: 'radial-gradient(circle at top, rgba(56,189,248,0.2), transparent 60%)',
            }}
          />
        )}
        <div className="absolute inset-0 bg-black/70" />
        <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-transparent to-black/85" />
      </div>

      {/* Back / Close Button */}
      <IconButton
        onClick={onClose}
        className="absolute top-6 left-6 z-40 p-2 text-white/70 hover:text-white transition-colors"
      >
        <ChevronDown className="w-5 h-5" />
      </IconButton>

      {/* Main Center Layout */}
      <div className="flex-1 w-full h-full flex items-center justify-center p-6 sm:p-12 relative">
        {/* The "Card" Container */}
        <div className="relative w-full max-w-5xl bg-black/40 backdrop-blur-2xl border border-white/5 rounded-3xl overflow-hidden shadow-2xl flex flex-col md:flex-row h-[500px] md:h-[400px] animate-fade-in-up">
          {/* Top Progress Bar */}
          <div className="absolute top-0 left-0 right-0 z-50 h-1 hover:h-4 group transition-all duration-300">
            <PlayerProgressBar showLabels={false} variant="mini" className="h-full" />
          </div>

          {/* Left: Cover Art */}
          <div className="w-full md:w-[400px] h-[300px] md:h-full relative shrink-0">
            <ParallaxCoverArt
              src={coverArt || undefined}
              isPlaying={isPlaying}
              style={{ width: '100%', height: '100%' }}
              className="rounded-none md:rounded-l-3xl h-full w-full object-cover"
              coverArtHash={currentTrack.coverArtHash}
            />
            <div className="absolute inset-0 ring-1 ring-inset ring-white/5 md:rounded-l-3xl pointer-events-none" />
          </div>

          {/* Right: Content & Controls */}
          <div className="flex-1 flex flex-col justify-between p-6 md:p-8 relative min-w-0 bg-gradient-to-b from-white/[0.02] to-transparent">
            {/* Top: Header & Metadata */}
            <div className="space-y-6">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-text-muted/80">
                <Headphones className="w-3 h-3" />
                <span>Now Playing</span>
              </div>

              <div className="space-y-1">
                <h1 className="text-3xl md:text-5xl font-bold text-white truncate leading-tight tracking-tight">
                  {currentTrack.title}
                </h1>
                <div className="flex flex-col">
                  <p className="text-lg md:text-xl text-text-secondary truncate font-medium">
                    {currentTrack.artist}
                  </p>
                  <p className="text-xs md:text-sm text-text-muted truncate mt-0.5">
                    {currentTrack.album}
                  </p>
                </div>
              </div>
            </div>

            {/* Middle: Lyrics Snippet */}
            <div className="py-4">
              <LyricsSnippet />
            </div>

            {/* Bottom: Controls */}
            {/* Bottom: Controls */}
            <div className="flex items-center justify-between gap-4 mt-auto">
              <div className="flex items-center gap-4">
                <IconButton
                  onClick={handlePrevious}
                  className="w-10 h-10 p-2 text-white hover:bg-white/10"
                >
                  <SkipBack className="w-5 h-5" fill="currentColor" />
                </IconButton>
                <IconButton
                  onClick={handleTogglePlay}
                  className="w-14 h-14 bg-white text-black hover:scale-105 active:scale-95 shadow-lg shadow-white/10 p-0"
                >
                  {isPlaying ? (
                    <Pause className="w-6 h-6" fill="currentColor" />
                  ) : (
                    <Play className="w-6 h-6 ml-0.5" fill="currentColor" />
                  )}
                </IconButton>
                <IconButton
                  onClick={handleNext}
                  className="w-10 h-10 p-2 text-white hover:bg-white/10"
                >
                  <SkipForward className="w-5 h-5" fill="currentColor" />
                </IconButton>
                <div className="hidden sm:block ml-2">
                  <PlayerVolume />
                </div>
              </div>

              <div className="flex items-center gap-3">
                {hasLyrics && (
                  <IconButton
                    onClick={() => setViewMode((v) => (v === 'lyrics' ? 'card' : 'lyrics'))}
                    className={clsx(
                      'w-10 h-10 p-2 transition-all',
                      viewMode === 'lyrics' ? 'text-primary' : 'text-text-muted hover:text-white',
                    )}
                  >
                    <Mic2 className="w-5 h-5" />
                  </IconButton>
                )}
                <IconButton
                  onClick={() => setShowActions(!showActions)}
                  ref={actionsRef}
                  className="w-10 h-10 p-2 text-text-muted hover:text-white transition-all"
                >
                  <MoreHorizontal className="w-5 h-5" />
                </IconButton>
              </div>
            </div>

            {/* Actions Menu */}
            {showActions && (
              <div
                ref={actionsMenuRef}
                className="absolute right-8 bottom-20 w-56 bg-zinc-900/95 backdrop-blur-xl rounded-xl border border-white/10 shadow-2xl py-2 z-50 animate-fade-in origin-bottom-right"
              >
                <div className="px-3 py-2 text-xs text-text-muted border-b border-white/5 mb-1">
                  Playback Options
                </div>
                <button
                  onClick={toggleShuffle}
                  className={clsx(
                    'w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                    shuffleEnabled
                      ? 'text-primary bg-white/5'
                      : 'text-text-primary hover:bg-white/10',
                  )}
                >
                  <Shuffle className="w-4 h-4" />
                  Shuffle {shuffleEnabled ? 'On' : 'Off'}
                </button>
                <button
                  onClick={toggleLoop}
                  className={clsx(
                    'w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors',
                    loopMode !== 'off'
                      ? 'text-primary bg-white/5'
                      : 'text-text-primary hover:bg-white/10',
                  )}
                >
                  {loopMode === 'one' ? (
                    <Repeat1 className="w-4 h-4" />
                  ) : (
                    <Repeat className="w-4 h-4" />
                  )}
                  Repeat {loopMode === 'off' ? 'Off' : loopMode === 'all' ? 'All' : 'One'}
                </button>
                <div className="h-px bg-white/5 my-1" />
                <button
                  onClick={handleEditTags}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text-primary hover:bg-white/10 transition-colors"
                >
                  <Edit3 className="w-4 h-4" />
                  Edit Tags
                </button>
                <button
                  onClick={handleEditLyrics}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text-primary hover:bg-white/10 transition-colors"
                >
                  <TrackIcon className="w-4 h-4" />
                  Edit Lyrics
                </button>
                <div className="h-px bg-white/5 my-1" />
                <button
                  onClick={handleAddToQueue}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text-primary hover:bg-white/10 transition-colors"
                >
                  <ListMusic className="w-4 h-4" />
                  Add to Queue
                </button>
                <button
                  onClick={handleAddToPlaylist}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text-primary hover:bg-white/10 transition-colors"
                >
                  <ListPlus className="w-4 h-4" />
                  Add to Playlist
                </button>
                <div className="h-px bg-white/5 my-1" />
                <button
                  onClick={handleRevealInFinder}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-text-primary hover:bg-white/10 transition-colors"
                >
                  <FolderOpen className="w-4 h-4" />
                  Reveal in Finder
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Lyrics Overlay View */}
        {isLyricsView && (
          <div className="absolute inset-0 z-[60] bg-black/60 backdrop-blur-3xl flex items-center justify-center p-8 animate-fade-in">
            <IconButton
              onClick={() => setViewMode('card')}
              className="absolute top-6 right-6 p-2 text-white hover:text-white"
            >
              <ChevronDown className="w-6 h-6 rotate-180" />
            </IconButton>
            <div className="w-full max-w-4xl h-[80vh]">
              <LyricsDisplay />
            </div>
          </div>
        )}
      </div>

      {showTagEditor && (
        <Suspense fallback={null}>
          <TagEditorModal
            tracks={tagEditorTracks}
            onClose={() => {
              setShowTagEditor(false);
              setTagEditorInitialTab(undefined);
            }}
            onSave={() => {
              if (currentTrack) {
                refreshTracksByFilePaths([currentTrack.filePath]);
              }
            }}
            initialTab={tagEditorInitialTab}
          />
        </Suspense>
      )}

      <PlaylistPickerDialog
        open={showPlaylistSelector}
        trackIds={currentTrack ? [currentTrack.id] : []}
        onClose={() => setShowPlaylistSelector(false)}
      />
    </>
  );
});

PlayerContent.displayName = 'PlayerContent';
