import clsx from 'clsx';
// CSSProperties removed
import { PlaybackCoordinator } from '../../lib/playback-actions';
import { rangeProgressStyle } from '../../lib/range-progress-style';
import { reportError } from '../../lib/report-error';
import { applyVolume, isMuted, toggleMute } from '../../lib/volume';
import { usePlayerStore } from '../../store/player-store';
import { useSettingsStore } from '../../store/settings-store';
import { CoverArtImage } from '../shared/CoverArtImage';
import { HidingProgressBar } from '../shared/HidingProgressBar';
import { IconButton } from '../ui/IconButton';
import { NeoVolumeSegments } from './NeoVolumeSegments';
import { PlayerProgressBar, PlayerTimeDisplay } from './PlayerProgressBar';
import { SleepTimerButton } from './SleepTimerButton';

/** Index of the line playing at `timeMs`, or -1 before the first line. */
export function activeLyricIndex(lines: ReadonlyArray<{ startTime: number }>, timeMs: number) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (timeMs >= lines[i].startTime) return i;
  }
  return -1;
}

// Isolated Lyrics Component to prevent parent re-renders. It re-renders only when the active line
// changes; reading the smooth-time value during render never updated it during playback.
export const MiniPlayerLyrics = memo(() => {
  const { lyrics, isPlaying } = usePlayerStore(
    useShallow((s) => ({
      lyrics: s.lyrics,
      isPlaying: s.isPlaying,
    })),
  );
  const { timeSec } = useSmoothTimeValue();
  const [lineIndex, setLineIndex] = useState(() =>
    lyrics ? activeLyricIndex(lyrics.lines, timeSec * 1000) : -1,
  );

  useSmoothTimeSubscription((nextTimeSec) => {
    const next = lyrics ? activeLyricIndex(lyrics.lines, nextTimeSec * 1000) : -1;
    setLineIndex((current) => (current === next ? current : next));
  });

  // New lyrics (another track, or lyrics loaded while paused) re-resolve the line at once.
  useEffect(() => {
    const timeMs = usePlayerStore.getState().currentTime * 1000;
    setLineIndex(lyrics ? activeLyricIndex(lyrics.lines, timeMs) : -1);
  }, [lyrics]);

  const currentLyricLine = lyrics?.lines[lineIndex]?.text ?? null;

  if (!currentLyricLine) return null;

  return (
    <div className="mt-1.5 flex items-center gap-2 overflow-hidden">
      <Mic2 className="w-3 h-3 text-primary shrink-0" />
      <p
        className={clsx(
          'text-xs truncate transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-emphasis)]',
          isPlaying ? 'text-primary/[0.9]' : 'text-text-muted',
        )}
        title={currentLyricLine}
      >
        {currentLyricLine}
      </p>
    </div>
  );
});

interface MiniPlayerProps {
  onExpand: () => void;
  scheduleSleepTimer: (minutes: number) => void;
  cancelSleepTimer: () => void;
  sleepDeadline: number | null;
}

export const MiniPlayer = memo(
  ({ onExpand, scheduleSleepTimer, cancelSleepTimer, sleepDeadline }: MiniPlayerProps) => {
    useRenderLog('MiniPlayer');
    const currentTrack = usePlayerStore((s) => s.currentTrack);
    const { theme } = useSettingsStore(useShallow((s) => ({ theme: s.theme })));
    const isNeobrutalism = theme === 'neobrutalism';
    const { isPlaying, volume, loopMode, cycleLoopMode } = usePlayerStore(
      useShallow((s) => ({
        isPlaying: s.isPlaying,
        volume: s.volume,
        loopMode: s.loopMode,
        cycleLoopMode: s.cycleLoopMode,
      })),
    );

    const { miniPlayerCollapsed, setMiniPlayerCollapsed, miniVolumeVisible, setMiniVolumeVisible } =
      useSettingsStore(
        useShallow((s) => ({
          miniPlayerCollapsed: s.miniPlayerCollapsed,
          setMiniPlayerCollapsed: s.setMiniPlayerCollapsed,
          miniVolumeVisible: s.miniPlayerVolumeVisible,
          setMiniVolumeVisible: s.setMiniPlayerVolumeVisible,
        })),
      );

    const handleTogglePlay = useCallback(() => {
      PlaybackCoordinator.toggle().catch((error) =>
        reportError('Failed to toggle playback', { source: 'mini-player', error }),
      );
    }, []);

    const handleNext = useCallback(() => {
      PlaybackCoordinator.next().catch((error) =>
        reportError('Failed to play the next track', { source: 'mini-player', error }),
      );
    }, []);

    const handlePrevious = useCallback(() => {
      PlaybackCoordinator.previous().catch((error) =>
        reportError('Failed to play the previous track', { source: 'mini-player', error }),
      );
    }, []);

    const handleVolumeChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
      void applyVolume(parseFloat(e.target.value), 'mini-player');
    }, []);
    const commitNeoVolume = useCallback((value: number) => {
      void applyVolume(value, 'mini-player');
    }, []);
    const handleToggleMute = useCallback(() => {
      void toggleMute('mini-player');
    }, []);

    const [neoVolOpen, setNeoVolOpen] = useState(false);
    const neoVolumeRef = useRef<HTMLDivElement>(null);
    const neoVolumeToggleRef = useRef<HTMLButtonElement>(null);
    // The neo volume popover closes on Escape and on a click outside it (FE-16).
    useDismissable(neoVolOpen, neoVolumeRef, () => setNeoVolOpen(false), neoVolumeToggleRef);

    if (!currentTrack) return null;
    // The collapsed pill exists only in the liquid layout; neobrutalism always shows the bar.
    if (miniPlayerCollapsed && !isNeobrutalism) return null;

    if (isNeobrutalism) {
      return (
        <div className="group h-full w-full flex flex-col bg-[var(--surface-shell)] overflow-visible relative font-display animate-neo-slide-up">
          <HidingProgressBar accentColor="var(--signal-play)" />

          {/* Main Content Area */}
          <div className="flex-1 flex items-center justify-between px-4 sm:px-6 gap-4 bg-[var(--surface-interactive)] border-t-2 border-transparent">
            {/* Left: Artwork & Info */}
            <div className="flex items-center gap-4 flex-1 min-w-0">
              <button
                onClick={onExpand}
                className="relative shrink-0 group hover:-translate-y-1 hover:translate-x-1 hover:shadow-[-4px_4px_0_0_#000] transition-[transform,box-shadow] duration-[var(--motion-fast)]"
                aria-label="Expand player"
              >
                <CoverArtImage
                  track={currentTrack}
                  variant="album"
                  className="w-14 h-14 border-2 border-black shadow-[4px_4px_0_0_#000] group-hover:shadow-none transition-shadow duration-[var(--motion-fast)]"
                  imgClassName="w-full h-full object-cover"
                  roundedClassName="rounded-none"
                  alt={currentTrack.album}
                  lazy={false}
                />
              </button>

              <button onClick={onExpand} className="flex flex-col text-left truncate group flex-1">
                <span
                  dir="auto"
                  className="font-black text-lg text-black uppercase tracking-widest truncate group-hover:underline decoration-2 underline-offset-4"
                >
                  {currentTrack.title}
                </span>
                <span
                  dir="auto"
                  className="font-bold text-xs text-black/70 uppercase tracking-[0.1em] truncate"
                >
                  {currentTrack.artist}
                </span>
              </button>
            </div>

            {/* Center: Playback Controls */}
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-black bg-white shadow-[4px_4px_0_0_#000] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none hover:-translate-y-0.5 transition-[transform,box-shadow] duration-[var(--motion-fast)]"
                onClick={handlePrevious}
                aria-label="Previous track"
              >
                <SkipBack className="w-5 h-5 text-black" fill="currentColor" />
              </button>

              <button
                type="button"
                className={clsx(
                  'flex h-14 w-14 shrink-0 items-center justify-center border-2 border-black shadow-[4px_4px_0_0_#000] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none hover:-translate-y-1 transition-[transform,box-shadow] duration-[var(--motion-fast)]',
                  isPlaying ? 'bg-[var(--signal-active)]' : 'bg-[var(--signal-play)]',
                )}
                onClick={handleTogglePlay}
                aria-label={isPlaying ? 'Pause' : 'Play'}
              >
                {isPlaying ? (
                  <Pause className="w-7 h-7 text-black" fill="currentColor" />
                ) : (
                  <Play className="w-7 h-7 text-black ml-1" fill="currentColor" />
                )}
              </button>

              <button
                type="button"
                className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-black bg-white shadow-[4px_4px_0_0_#000] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none hover:-translate-y-0.5 transition-[transform,box-shadow] duration-[var(--motion-fast)]"
                onClick={handleNext}
                aria-label="Next track"
              >
                <SkipForward className="w-5 h-5 text-black" fill="currentColor" />
              </button>
            </div>

            {/* Right: Extra Controls */}
            <div className="hidden md:flex items-center gap-4 shrink-0 justify-end flex-1">
              <div className="text-black font-black text-sm tracking-widest bg-white border-2 border-black px-3 py-1.5 shadow-[4px_4px_0_0_#000]">
                <PlayerTimeDisplay format="slash" className="font-black" />
              </div>

              <button
                type="button"
                className={clsx(
                  'flex h-10 px-3 shrink-0 items-center justify-center border-2 border-black shadow-[4px_4px_0_0_#000] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none hover:-translate-y-0.5 transition-[transform,box-shadow] duration-[var(--motion-fast)] font-black text-xs tracking-widest',
                  loopMode !== 'off'
                    ? 'bg-[var(--signal-secondary)] text-white'
                    : 'bg-white text-black',
                )}
                onClick={() => cycleLoopMode()}
                aria-label={`Loop mode: ${loopMode}`}
              >
                {loopMode === 'one' ? 'LOOP: 1' : loopMode === 'all' ? 'LOOP: ALL' : 'LOOP: OFF'}
              </button>

              <div ref={neoVolumeRef} className="flex items-center gap-2 relative">
                <button
                  type="button"
                  className="flex h-10 w-10 shrink-0 items-center justify-center border-2 border-black bg-white shadow-[4px_4px_0_0_#000] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none hover:-translate-y-0.5 transition-[transform,box-shadow] duration-[var(--motion-fast)]"
                  onClick={handleToggleMute}
                  aria-label={isMuted(volume) ? 'Unmute' : 'Mute'}
                >
                  {isMuted(volume) ? (
                    <VolumeX className="w-5 h-5 text-black" strokeWidth={2.5} />
                  ) : (
                    <Volume2 className="w-5 h-5 text-black" strokeWidth={2.5} />
                  )}
                </button>
                <button
                  type="button"
                  className={clsx(
                    'flex h-10 px-3 items-center justify-center border-2 border-black text-xs font-black uppercase shadow-[4px_4px_0_0_#000] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none hover:-translate-y-0.5 transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom]',
                    neoVolOpen ? 'bg-[var(--signal-active)] text-black' : 'bg-white text-black',
                  )}
                  ref={neoVolumeToggleRef}
                  onClick={() => setNeoVolOpen((o) => !o)}
                  aria-expanded={neoVolOpen}
                  aria-label="Toggle volume segments"
                >
                  VOL
                </button>

                {neoVolOpen && (
                  <div className="absolute bottom-[calc(100%+1.5rem)] right-0 bg-white border-2 border-black p-3 shadow-[8px_8px_0_0_#000] flex flex-col gap-2 z-50 animate-fade-in-up">
                    <div className="text-black font-black uppercase text-xs border-b-2 border-black pb-1 tracking-widest">
                      Volume
                    </div>
                    <NeoVolumeSegments
                      volume={volume}
                      onChange={commitNeoVolume}
                      variant="popover"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    const content = (
      <div
        className={clsx(
          'relative',
          !isNeobrutalism &&
            'overflow-hidden rounded-[2rem] border border-white/10 backdrop-blur-[28px]',
          isNeobrutalism && 'h-full w-full flex items-center overflow-visible',
        )}
        style={
          !isNeobrutalism
            ? {
                background:
                  'linear-gradient(180deg, rgba(24,18,14,0.84) 0%, rgba(12,11,11,0.95) 100%)',
                boxShadow:
                  '0 24px 64px rgba(0,0,0,0.5), 0 10px 28px rgba(0,0,0,0.28), inset 0 1px 0 rgba(255,255,255,0.12)',
              }
            : {}
        }
      >
        {!isNeobrutalism && (
          <>
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'radial-gradient(ellipse 80% 100% at 10% 50%, var(--surface-tint) 0%, transparent 58%), radial-gradient(circle at 82% 0%, var(--hero-glow) 0%, transparent 34%)',
                opacity: 0.9,
              }}
            />
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(255,255,255,0.12),transparent_40%)] opacity-60 pointer-events-none" />
          </>
        )}

        <div className={clsx('relative w-full', isNeobrutalism && 'pt-7')}>
          <PlayerProgressBar variant="mini" />

          <div
            className={clsx(
              'flex items-center gap-4 overflow-visible',
              !isNeobrutalism ? 'px-5 py-3.5' : 'px-4',
            )}
          >
            {!isNeobrutalism && (
              <IconButton
                onClick={() => setMiniPlayerCollapsed(true)}
                className="p-2 rounded-full bg-white/[0.04] border border-white/[0.08] text-text-muted hover:text-white hover:bg-white/[0.08] transition"
                aria-label="Collapse to sidebar"
                title="Collapse to sidebar"
              >
                <ChevronLeft className="w-4 h-4" />
              </IconButton>
            )}

            <button
              onClick={onExpand}
              className="relative shrink-0 group"
              aria-label="Expand player"
            >
              <CoverArtImage
                track={currentTrack}
                variant="album"
                className={isNeobrutalism ? 'w-12 h-12' : 'w-14 h-14'}
                imgClassName={clsx(
                  'w-full h-full',
                  !isNeobrutalism && 'shadow-[0_18px_36px_rgba(0,0,0,0.35)]',
                )}
                roundedClassName={isNeobrutalism ? 'rounded-none' : 'rounded-xl'}
                iconClassName="w-6 h-6"
                alt={currentTrack.album}
                lazy={false}
              />
              {!isNeobrutalism && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-md rounded-xl opacity-0 group-hover:opacity-100 transition-opacity">
                  <ChevronUp className="w-6 h-6 text-white" />
                </div>
              )}
            </button>

            <div className="flex-1 min-w-0">
              <button onClick={onExpand} className="w-full text-left group">
                <p
                  className={clsx(
                    'font-semibold truncate font-display',
                    isNeobrutalism
                      ? 'text-sm text-black font-black uppercase tracking-[0.05em]'
                      : 'text-sm text-white group-hover:text-primary transition-colors',
                  )}
                >
                  {currentTrack.title}
                </p>
                <p
                  className={clsx(
                    'text-xs truncate tracking-[0.02em]',
                    isNeobrutalism
                      ? 'text-black/60 font-black uppercase tracking-[0.05em]'
                      : 'text-white/[0.54]',
                  )}
                >
                  {currentTrack.artist}
                </p>
              </button>

              {!isNeobrutalism && <MiniPlayerLyrics />}
            </div>

            <div
              className={clsx(
                'hidden md:block shrink-0',
                !isNeobrutalism
                  ? 'rounded-full border border-white/[0.08] bg-black/[0.15] px-3 py-2'
                  : 'text-black/60',
              )}
            >
              <PlayerTimeDisplay
                format="slash"
                className={clsx(
                  'text-xs',
                  !isNeobrutalism ? 'text-white/[0.58]' : 'text-black/60 font-black',
                )}
              />
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {!isNeobrutalism && (
                <SleepTimerButton
                  scheduleSleepTimer={scheduleSleepTimer}
                  cancelSleepTimer={cancelSleepTimer}
                  sleepDeadline={sleepDeadline}
                />
              )}
              {isNeobrutalism ? (
                <div
                  className="neo-toggle scale-[0.85] origin-center"
                  role="switch"
                  aria-checked={loopMode !== 'off'}
                  tabIndex={0}
                  onClick={() => cycleLoopMode()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      cycleLoopMode();
                    }
                  }}
                  data-active={loopMode !== 'off'}
                >
                  <div className="neo-toggle-on">{loopMode === 'one' ? '1' : 'ON'}</div>
                  <div className="neo-toggle-off">OFF</div>
                </div>
              ) : (
                <IconButton
                  onClick={cycleLoopMode}
                  className={clsx(
                    'p-2 rounded-full transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] relative',
                    'bg-white/[0.04] border border-white/[0.08] text-text-secondary hover:text-white hover:bg-white/[0.08]',
                    loopMode !== 'off' &&
                      'text-primary hover:text-primary shadow-[0_0_18px_var(--hero-glow)]',
                  )}
                  aria-label={`Loop mode: ${loopMode}`}
                >
                  {loopMode === 'one' ? (
                    <Repeat1 className="w-4 h-4" />
                  ) : (
                    <Repeat className="w-4 h-4" />
                  )}
                  {loopMode !== 'off' && (
                    <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-primary" />
                  )}
                </IconButton>
              )}

              <IconButton
                onClick={handlePrevious}
                className={clsx(
                  'p-2 rounded-full',
                  !isNeobrutalism &&
                    'bg-white/[0.04] border border-white/[0.08] text-text-secondary hover:text-white hover:bg-white/[0.08]',
                  isNeobrutalism && 'text-black hover:bg-black/5',
                )}
                aria-label="Previous track"
              >
                <SkipBack className="w-4 h-4" fill="currentColor" />
              </IconButton>

              {isNeobrutalism ? (
                <button
                  type="button"
                  className="neo-play-pause disabled:opacity-50"
                  onClick={handleTogglePlay}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <Pause className="w-7 h-7" fill="currentColor" />
                  ) : (
                    <Play className="w-7 h-7 ml-1" fill="currentColor" />
                  )}
                </button>
              ) : (
                <IconButton
                  onClick={handleTogglePlay}
                  className={clsx(
                    'w-12 h-12 flex items-center justify-center p-0 transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-standard)]',
                    'bg-white text-black rounded-full hover:scale-105 active:scale-[0.95]',
                    isPlaying
                      ? 'shadow-[0_0_30px_var(--hero-glow)]'
                      : 'shadow-[0_0_20px_var(--hero-glow)]',
                  )}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                >
                  {isPlaying ? (
                    <Pause className="w-5 h-5" fill="currentColor" />
                  ) : (
                    <Play className="w-5 h-5 ml-0.5" fill="currentColor" />
                  )}
                </IconButton>
              )}

              <IconButton
                onClick={handleNext}
                className={clsx(
                  'p-2 rounded-full',
                  !isNeobrutalism &&
                    'bg-white/[0.04] border border-white/[0.08] text-text-secondary hover:text-white hover:bg-white/[0.08]',
                  isNeobrutalism && 'text-black hover:bg-black/5',
                )}
                aria-label="Next track"
              >
                <SkipForward className="w-4 h-4" fill="currentColor" />
              </IconButton>
            </div>

            {isNeobrutalism ? (
              <div ref={neoVolumeRef} className="hidden sm:flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  className="flex h-9 w-9 shrink-0 items-center justify-center border-2 border-black bg-white shadow-[4px_4px_0_0_#000] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none"
                  onClick={handleToggleMute}
                  aria-label={isMuted(volume) ? 'Unmute' : 'Mute'}
                >
                  {isMuted(volume) ? (
                    <VolumeX className="w-4 h-4 text-black" strokeWidth={2.5} />
                  ) : (
                    <Volume2 className="w-4 h-4 text-black" strokeWidth={2.5} />
                  )}
                </button>
                <button
                  type="button"
                  className="border-2 border-black bg-[var(--neo-panel)] px-2 py-1 text-xs font-black uppercase shadow-[4px_4px_0_0_#000] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none"
                  ref={neoVolumeToggleRef}
                  onClick={() => setNeoVolOpen((o) => !o)}
                  aria-expanded={neoVolOpen}
                  aria-label="Toggle volume segments"
                >
                  Vol
                </button>
                {neoVolOpen && <NeoVolumeSegments volume={volume} onChange={commitNeoVolume} />}
              </div>
            ) : (
              <div className="hidden lg:flex items-center gap-2 shrink-0 rounded-full border border-white/[0.08] bg-black/[0.15] px-2.5 py-1.5">
                <IconButton
                  onClick={() => setMiniVolumeVisible(!miniVolumeVisible)}
                  className="p-2 rounded-full text-text-secondary hover:text-white hover:bg-white/[0.08] transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom]"
                  aria-label="Toggle volume"
                >
                  {isMuted(volume) ? (
                    <VolumeX className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </IconButton>

                {miniVolumeVisible && (
                  <div className="flex items-center gap-2 animate-fade-in">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={volume}
                      onChange={handleVolumeChange}
                      className="w-20 h-1.5 rounded-full cursor-pointer accent-primary"
                      style={rangeProgressStyle(volume, 0, 1)}
                      aria-label="Volume"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );

    if (isNeobrutalism) {
      return content;
    }

    return (
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 w-[min(960px,calc(100%-2rem))] animate-fade-in-up">
        {content}
      </div>
    );
  },
);

MiniPlayer.displayName = 'MiniPlayer';
