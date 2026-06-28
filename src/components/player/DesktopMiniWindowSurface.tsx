import { emitTo } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { ExternalLink, Minimize2, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  EVENT_DESKTOP_CONTROL_ACTION,
  EVENT_DESKTOP_SEEK,
  EVENT_DESKTOP_PLAYBACK_SNAPSHOT,
  EVENT_DESKTOP_SNAPSHOT_REQUEST,
  MAIN_WINDOW_LABEL,
} from '../../features/app/desktop-events';
import { useCoverArt } from '../../hooks/useCoverArt';
import { useReactivePalette } from '../../hooks/useReactivePalette';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { formatTime } from '../../lib/format-time';
import type { DesktopControlAction, DesktopPlaybackSnapshot } from '../../types';
import { LiquidGlassButton } from '../ui/LiquidGlassButton';
import { cn } from '../ui/liquid-glass';

const EMPTY_SNAPSHOT: DesktopPlaybackSnapshot = {
  track: null,
  isPlaying: false,
  position: 0,
  duration: 0,
  hasPrevious: false,
  hasNext: false,
};

/**
 * Standalone mini window surface (320×92). Loaded only from `mini-player.html`.
 */
export const DesktopMiniWindowSurface = () => {
  const [snapshot, setSnapshot] = useState<DesktopPlaybackSnapshot>(EMPTY_SNAPSHOT);
  const [seekState, setSeekState] = useState<{ isSeeking: boolean; valueSecs: number }>({
    isSeeking: false,
    valueSecs: 0,
  });
  const seekStateRef = useRef(seekState);
  seekStateRef.current = seekState;

  const coverArt = useCoverArt(
    snapshot.track?.filePath,
    snapshot.track?.hasCoverArt,
    true,
    'small',
    snapshot.track?.coverArtHash ?? undefined,
  );
  const palette = useReactivePalette({
    filePath: snapshot.track?.filePath,
    coverArtUrl: coverArt ?? null,
  });

  const displayPositionSecs = seekState.isSeeking ? seekState.valueSecs : snapshot.position;
  const durationSecs = snapshot.duration;

  const progress = useMemo(() => {
    if (!durationSecs || durationSecs <= 0) return 0;
    return Math.max(0, Math.min(displayPositionSecs / durationSecs, 1));
  }, [durationSecs, displayPositionSecs]);

  const remaining = useMemo(() => Math.max(0, durationSecs - displayPositionSecs), [durationSecs, displayPositionSecs]);

  const sendAction = useCallback(async (action: DesktopControlAction) => {
    await emitTo(MAIN_WINDOW_LABEL, EVENT_DESKTOP_CONTROL_ACTION, action);
  }, []);

  const sendSeek = useCallback(async (positionSecs: number) => {
    await emitTo(MAIN_WINDOW_LABEL, EVENT_DESKTOP_SEEK, { positionSecs });
  }, []);

  const minimizeMiniWindow = useCallback(() => {
    void getCurrentWindow()
      .minimize()
      .catch(() => undefined);
  }, []);

  /** CSS `app-region: drag` is flaky on transparent frameless macOS webviews; this matches native titlebar drags. */
  const handleWindowDragPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    void getCurrentWindow().startDragging();
  }, []);

  const finishSeek = useCallback(async () => {
    const current = seekStateRef.current;
    if (!current.isSeeking) return;

    // Guard against duplicate finish events firing before state updates land.
    const seekValue = current.valueSecs;
    seekStateRef.current = { isSeeking: false, valueSecs: 0 };
    setSeekState({ isSeeking: false, valueSecs: 0 });

    try {
      const duration = snapshot.duration;
      if (duration > 0) {
        await sendSeek(Math.max(0, Math.min(seekValue, duration)));
      } else {
        await sendSeek(Math.max(0, seekValue));
      }
    } catch {
      // Best-effort bridge: mini window shouldn't crash if seek fails.
    }
  }, [sendSeek, snapshot.duration]);

  useTauriEvent<DesktopPlaybackSnapshot>(
    EVENT_DESKTOP_PLAYBACK_SNAPSHOT,
    (event) => {
      setSnapshot(event.payload);
    },
    [],
  );

  useEffect(() => {
    void emitTo(MAIN_WINDOW_LABEL, EVENT_DESKTOP_SNAPSHOT_REQUEST);
  }, []);

  useEffect(() => {
    if (!seekState.isSeeking) return;
    const handleGlobalPointerUp = () => {
      void finishSeek();
    };
    window.addEventListener('pointerup', handleGlobalPointerUp);
    return () => window.removeEventListener('pointerup', handleGlobalPointerUp);
  }, [finishSeek, seekState.isSeeking]);

  const trackTitle = snapshot.track?.title ?? 'No track';
  const trackArtist = snapshot.track?.artist ?? 'Tarab';
  const hasTrack = Boolean(snapshot.track);
  const shellVars = useMemo(
    () =>
      ({
        '--mini-shell-a': palette.shellBlobA,
        '--mini-shell-b': palette.shellBlobB,
        '--mini-accent': palette.heroAccent,
        '--mini-glow': palette.heroGlow,
        '--mini-surface-tint': palette.surfaceTint,
        '--mini-primary-rgb': palette.primaryRgb,
      }) as CSSProperties,
    [palette],
  );

  return (
    <div
      className="box-border h-[92px] w-[320px] overflow-hidden text-white antialiased"
      style={shellVars}
    >
      <div
        className="relative h-full w-full rounded-2xl border border-white/12"
        style={{
          background: `
            radial-gradient(circle at 12% 0%, color-mix(in srgb, var(--mini-accent) 18%, white 10%) 0%, transparent 38%),
            linear-gradient(135deg, color-mix(in srgb, var(--mini-shell-a) 55%, black 45%) 0%, rgba(8, 9, 14, 0.96) 100%)
          `,
        }}
      >
        {/* Full-card drag target behind UI; interactive bits opt in with pointer-events-auto + no-drag */}
        <div
          className="absolute inset-0 z-[1]"
          data-tauri-drag-region
          onPointerDown={handleWindowDragPointerDown}
          aria-hidden
        />
        <div className="pointer-events-none absolute inset-0 z-[2] rounded-2xl bg-black/18 backdrop-blur-xl" />

        <div className="relative z-10 flex h-full items-center gap-2 px-2 py-1.5 pointer-events-none">
          <div
            className="relative h-[52px] w-[52px] shrink-0 cursor-grab overflow-hidden rounded-xl border border-white/12 bg-white/6 active:cursor-grabbing pointer-events-auto"
            data-tauri-drag-region
            onPointerDown={handleWindowDragPointerDown}
            onDoubleClick={() => {
              void sendAction('show-main');
            }}
            title="Drag to move"
          >
            {coverArt ? (
              <img src={coverArt} alt="" className="pointer-events-none h-full w-full object-cover" draggable={false} />
            ) : (
              <div className="h-full w-full bg-gradient-to-br from-white/12 to-transparent" />
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
            <div
              className="min-w-0 cursor-grab rounded-md py-0.5 active:cursor-grabbing pointer-events-auto"
              data-tauri-drag-region
              onPointerDown={handleWindowDragPointerDown}
              onDoubleClick={() => {
                void sendAction('show-main');
              }}
              title="Drag to move · double-click for main window"
            >
              <p className="truncate text-[12px] font-semibold leading-tight text-white">
                {trackTitle}
              </p>
              <p className="truncate text-[10px] font-medium text-white/55">{trackArtist}</p>
            </div>
            <div
              className="relative h-1 overflow-hidden rounded-full bg-white/10 pointer-events-auto"
              data-mini-no-drag
            >
              <div
                className="h-full rounded-full transition-[width] duration-200"
                style={{
                  width: `${progress * 100}%`,
                  background:
                    'linear-gradient(90deg, var(--mini-accent) 0%, color-mix(in srgb, var(--mini-accent) 55%, white 45%) 100%)',
                }}
              />
              <input
                type="range"
                min={0}
                max={durationSecs || 1}
                step={0.1}
                value={displayPositionSecs}
                onChange={(e) => {
                  const raw = parseFloat((e.target as HTMLInputElement).value);
                  const duration = durationSecs;
                  const clamped = duration > 0 ? Math.max(0, Math.min(raw, duration)) : Math.max(0, raw);

                  if (seekStateRef.current.isSeeking) {
                    setSeekState({ isSeeking: true, valueSecs: clamped });
                    return;
                  }

                  // Keyboard-driven seek: commit immediately so the app responds quickly.
                  setSeekState({ isSeeking: true, valueSecs: clamped });
                  void (async () => {
                    try {
                      await sendSeek(clamped);
                    } finally {
                      setSeekState({ isSeeking: false, valueSecs: 0 });
                    }
                  })();
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const raw = parseFloat((e.currentTarget as HTMLInputElement).value);
                  const duration = durationSecs;
                  const clamped = duration > 0 ? Math.max(0, Math.min(raw, duration)) : Math.max(0, raw);
                  setSeekState({ isSeeking: true, valueSecs: clamped });
                }}
                onPointerMove={(e) => {
                  if (!seekStateRef.current.isSeeking) return;
                  const raw = parseFloat((e.currentTarget as HTMLInputElement).value);
                  const duration = durationSecs;
                  const clamped = duration > 0 ? Math.max(0, Math.min(raw, duration)) : Math.max(0, raw);
                  setSeekState({ isSeeking: true, valueSecs: clamped });
                }}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  void finishSeek();
                }}
                onPointerCancel={(e) => {
                  e.stopPropagation();
                  void finishSeek();
                }}
                className="absolute inset-0 h-full w-full cursor-pointer touch-none opacity-0"
                aria-label="Seek"
              />
            </div>
            <div className="pointer-events-none flex items-center justify-between text-[9px] font-medium tabular-nums text-white/45">
              <span>{formatTime(displayPositionSecs)}</span>
              <span>-{formatTime(remaining)}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5 pointer-events-auto" data-mini-no-drag>
            <LiquidGlassButton
              onClick={() => {
                void sendAction('previous');
              }}
              disabled={!snapshot.hasPrevious}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full p-0',
                !snapshot.hasPrevious && 'text-white/28',
              )}
              style={
                {
                  '--adl-liquid-bg': snapshot.hasPrevious
                    ? 'rgba(255,255,255,0.10)'
                    : 'rgba(255,255,255,0.05)',
                  '--adl-liquid-bg-hover': 'rgba(255,255,255,0.18)',
                  '--adl-liquid-border': 'rgba(255,255,255,0.10)',
                  '--adl-liquid-text': snapshot.hasPrevious
                    ? 'rgba(255,255,255,0.88)'
                    : 'rgba(255,255,255,0.28)',
                } as CSSProperties
              }
              aria-label="Previous"
            >
              <SkipBack className="h-3 w-3" />
            </LiquidGlassButton>

            <LiquidGlassButton
              onClick={() => {
                void sendAction('toggle-play');
              }}
              disabled={!hasTrack}
              tone="accent"
              accentColor="var(--mini-accent)"
              accentForeground="#060606"
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full p-0 text-black',
                !hasTrack && 'opacity-45',
              )}
              style={
                hasTrack
                  ? ({
                      '--adl-liquid-bg':
                        'linear-gradient(180deg, color-mix(in srgb, var(--mini-accent) 72%, white 28%) 0%, var(--mini-accent) 100%)',
                      '--adl-liquid-border':
                        'color-mix(in srgb, var(--mini-accent) 54%, rgba(255,255,255,0.34) 46%)',
                      '--adl-liquid-shadow':
                        '0 0 18px color-mix(in srgb, var(--mini-glow) 65%, transparent 35%)',
                    } as CSSProperties)
                  : undefined
              }
              aria-label={snapshot.isPlaying ? 'Pause' : 'Play'}
            >
              {snapshot.isPlaying ? (
                <Pause className="h-3.5 w-3.5 fill-current" />
              ) : (
                <Play className="ml-0.5 h-3.5 w-3.5 fill-current" />
              )}
            </LiquidGlassButton>

            <LiquidGlassButton
              onClick={() => {
                void sendAction('next');
              }}
              disabled={!snapshot.hasNext}
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full p-0',
                !snapshot.hasNext && 'text-white/28',
              )}
              style={
                {
                  '--adl-liquid-bg': snapshot.hasNext
                    ? 'rgba(255,255,255,0.10)'
                    : 'rgba(255,255,255,0.05)',
                  '--adl-liquid-bg-hover': 'rgba(255,255,255,0.18)',
                  '--adl-liquid-border': 'rgba(255,255,255,0.10)',
                  '--adl-liquid-text': snapshot.hasNext
                    ? 'rgba(255,255,255,0.88)'
                    : 'rgba(255,255,255,0.28)',
                } as CSSProperties
              }
              aria-label="Next"
            >
              <SkipForward className="h-3 w-3" />
            </LiquidGlassButton>

            <LiquidGlassButton
              onClick={minimizeMiniWindow}
              className="ml-0.5 flex h-6 w-6 items-center justify-center rounded-full p-0"
              style={
                {
                  '--adl-liquid-bg': 'rgba(255,255,255,0.06)',
                  '--adl-liquid-bg-hover': 'rgba(255,255,255,0.12)',
                  '--adl-liquid-border': 'rgba(255,255,255,0.10)',
                  '--adl-liquid-text': 'rgba(255,255,255,0.86)',
                } as CSSProperties
              }
              aria-label="Minimize to dock"
              title="Minimize to dock (restore from Dock or taskbar)"
            >
              <Minimize2 className="h-3 w-3" />
            </LiquidGlassButton>

            <LiquidGlassButton
              onClick={() => {
                void sendAction('show-main');
              }}
              className="flex h-6 w-6 items-center justify-center rounded-full p-0"
              style={
                {
                  '--adl-liquid-bg': 'rgba(255,255,255,0.06)',
                  '--adl-liquid-bg-hover': 'rgba(255,255,255,0.12)',
                  '--adl-liquid-border': 'rgba(255,255,255,0.10)',
                  '--adl-liquid-text': 'rgba(255,255,255,0.86)',
                } as CSSProperties
              }
              aria-label="Show main window"
              title="Show main window"
            >
              <ExternalLink className="h-3 w-3" />
            </LiquidGlassButton>
          </div>
        </div>
      </div>
    </div>
  );
};
