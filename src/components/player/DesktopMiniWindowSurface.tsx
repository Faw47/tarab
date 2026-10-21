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
  EVENT_DESKTOP_PLAYBACK_SNAPSHOT,
  EVENT_DESKTOP_SEEK,
  EVENT_DESKTOP_SNAPSHOT_REQUEST,
  MAIN_WINDOW_LABEL,
} from '../../features/app/desktop-events';
import { useReactivePalette } from '../../hooks/useReactivePalette';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { coverArtUrl } from '../../lib/cover-art-url';
import { formatTime } from '../../lib/format-time';
import { useSettingsStore } from '../../store/settings-store';
import type { DesktopControlAction, DesktopPlaybackSnapshot } from '../../types';
import { Button } from '../ui/button';
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
type DesktopMiniWindowSurfaceProps = {
  initialSnapshot?: DesktopPlaybackSnapshot;
};

export const DesktopMiniWindowSurface = ({
  initialSnapshot = EMPTY_SNAPSHOT,
}: DesktopMiniWindowSurfaceProps) => {
  const [snapshot, setSnapshot] = useState<DesktopPlaybackSnapshot>(initialSnapshot);
  const storedTheme = useSettingsStore((s) => s.theme);
  const theme = snapshot.theme ?? storedTheme;
  const isNeoTheme = theme === 'neobrutalism';
  const [seekState, setSeekState] = useState<{ isSeeking: boolean; valueSecs: number }>({
    isSeeking: false,
    valueSecs: 0,
  });
  const seekStateRef = useRef(seekState);
  seekStateRef.current = seekState;

  const coverArtHash = snapshot.track?.coverArtHash ?? null;
  const coverArt = useMemo(
    () => (coverArtHash ? coverArtUrl(coverArtHash, 'small') : null),
    [coverArtHash],
  );
  const palette = useReactivePalette({
    coverArtUrl: coverArt,
  });

  const displayPositionSecs = seekState.isSeeking ? seekState.valueSecs : snapshot.position;
  const durationSecs = snapshot.duration;

  const progress = useMemo(() => {
    if (!durationSecs || durationSecs <= 0) return 0;
    return Math.max(0, Math.min(displayPositionSecs / durationSecs, 1));
  }, [durationSecs, displayPositionSecs]);

  const remaining = useMemo(
    () => Math.max(0, durationSecs - displayPositionSecs),
    [durationSecs, displayPositionSecs],
  );

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

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const getControlStyle = (enabled: boolean): CSSProperties =>
    ({
      '--adl-liquid-bg': isNeoTheme
        ? 'var(--neo-panel)'
        : enabled
          ? 'rgba(255,255,255,0.10)'
          : 'rgba(255,255,255,0.05)',
      '--adl-liquid-bg-hover': isNeoTheme ? 'var(--neo-utility-hover)' : 'rgba(255,255,255,0.18)',
      '--adl-liquid-border': isNeoTheme ? 'var(--neo-ink)' : 'rgba(255,255,255,0.10)',
      '--adl-liquid-text': isNeoTheme
        ? enabled
          ? 'var(--type-primary)'
          : 'var(--type-subdued)'
        : enabled
          ? 'rgba(255,255,255,0.88)'
          : 'rgba(255,255,255,0.28)',
    }) as CSSProperties;
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
      data-mini-window-surface
      data-theme={theme}
      className={cn(
        'box-border h-[92px] w-[320px] overflow-hidden antialiased',
        isNeoTheme ? 'text-[var(--type-primary)]' : 'text-white',
      )}
      style={shellVars}
    >
      <div
        className={cn(
          'relative h-full w-full',
          isNeoTheme
            ? 'rounded-none border-[3px] border-[var(--neo-ink)] bg-[var(--surface-shell)]'
            : 'rounded-2xl border border-white/12',
        )}
        style={
          isNeoTheme
            ? undefined
            : {
                background: `
                  radial-gradient(circle at 12% 0%, color-mix(in srgb, var(--mini-accent) 18%, white 10%) 0%, transparent 38%),
                  linear-gradient(135deg, color-mix(in srgb, var(--mini-shell-a) 55%, black 45%) 0%, rgba(8, 9, 14, 0.96) 100%)
                `,
              }
        }
      >
        {/* Full-card drag target behind UI; interactive bits opt in with pointer-events-auto + no-drag */}
        <div
          className="absolute inset-0 z-[1]"
          data-tauri-drag-region
          onPointerDown={handleWindowDragPointerDown}
          aria-hidden
        />
        {!isNeoTheme && (
          <div className="pointer-events-none absolute inset-0 z-[2] rounded-2xl bg-black/18 backdrop-blur-xl" />
        )}

        <div className="relative z-10 flex h-full items-center gap-2 px-2 py-1.5 pointer-events-none">
          <div
            className={cn(
              'relative h-[52px] w-[52px] shrink-0 cursor-grab overflow-hidden active:cursor-grabbing pointer-events-auto',
              isNeoTheme
                ? 'rounded-none border-2 border-black bg-[var(--neo-panel)]'
                : 'rounded-xl border border-white/12 bg-white/6',
            )}
            data-tauri-drag-region
            onPointerDown={handleWindowDragPointerDown}
            onDoubleClick={() => {
              void sendAction('show-main');
            }}
            title="Drag to move"
          >
            {coverArt ? (
              <img
                src={coverArt}
                alt=""
                className="pointer-events-none h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <div
                className={cn(
                  'h-full w-full',
                  isNeoTheme
                    ? 'bg-[var(--neo-muted)]'
                    : 'bg-gradient-to-br from-white/12 to-transparent',
                )}
              />
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
              <p
                className={cn(
                  'truncate text-[12px] font-semibold leading-tight',
                  isNeoTheme ? 'text-[var(--type-primary)]' : 'text-white',
                )}
              >
                {trackTitle}
              </p>
              <p
                className={cn(
                  'truncate text-xs font-medium',
                  isNeoTheme ? 'text-[var(--type-secondary)]' : 'text-white/55',
                )}
              >
                {trackArtist}
              </p>
            </div>
            <div className="pointer-events-auto relative h-6 overflow-visible" data-mini-no-drag>
              <div
                className={cn(
                  'absolute inset-x-0 top-1/2 h-1 -translate-y-1/2',
                  isNeoTheme ? 'bg-[var(--neo-muted)]' : 'rounded-full bg-white/10',
                )}
              />
              <div
                className={cn(
                  'absolute left-0 top-1/2 h-1 -translate-y-1/2 transition-[width] duration-[var(--motion-standard)]',
                  !isNeoTheme && 'rounded-full',
                )}
                style={{
                  width: `${progress * 100}%`,
                  background: isNeoTheme
                    ? 'var(--accent)'
                    : 'linear-gradient(90deg, var(--mini-accent) 0%, color-mix(in srgb, var(--mini-accent) 55%, white 45%) 100%)',
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
                  const clamped =
                    duration > 0 ? Math.max(0, Math.min(raw, duration)) : Math.max(0, raw);

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
                  const clamped =
                    duration > 0 ? Math.max(0, Math.min(raw, duration)) : Math.max(0, raw);
                  setSeekState({ isSeeking: true, valueSecs: clamped });
                }}
                onPointerMove={(e) => {
                  if (!seekStateRef.current.isSeeking) return;
                  const raw = parseFloat((e.currentTarget as HTMLInputElement).value);
                  const duration = durationSecs;
                  const clamped =
                    duration > 0 ? Math.max(0, Math.min(raw, duration)) : Math.max(0, raw);
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
                className="absolute inset-0 h-full min-h-6 w-full cursor-pointer touch-none opacity-0"
                aria-label="Seek"
              />
            </div>
            <div
              className={cn(
                'pointer-events-none flex items-center justify-between text-xs font-medium tabular-nums',
                isNeoTheme ? 'text-[var(--type-secondary)]' : 'text-white/45',
              )}
            >
              <span>{formatTime(displayPositionSecs)}</span>
              <span>-{formatTime(remaining)}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5 pointer-events-auto" data-mini-no-drag>
            <Button
              onClick={() => {
                void sendAction('previous');
              }}
              disabled={!snapshot.hasPrevious}
              className={cn(
                'flex h-7 w-7 items-center justify-center p-0',
                isNeoTheme
                  ? 'rounded-none border-2 border-black bg-[var(--neo-panel)] shadow-[2px_2px_0_0_#000]'
                  : 'rounded-full',
                !snapshot.hasPrevious && isNeoTheme && 'opacity-50',
                !snapshot.hasPrevious && !isNeoTheme && 'text-white/28',
              )}
              style={getControlStyle(snapshot.hasPrevious)}
              aria-label="Previous"
            >
              <SkipBack className="h-3 w-3" />
            </Button>

            <Button
              onClick={() => {
                void sendAction('toggle-play');
              }}
              disabled={!hasTrack}
              variant="primary"
              className={cn(
                'flex h-9 w-9 items-center justify-center p-0',
                isNeoTheme
                  ? 'rounded-none border-[3px] border-black bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[3px_3px_0_0_#000]'
                  : 'rounded-full text-black',
                !hasTrack && 'opacity-45',
              )}
              accentColor={isNeoTheme ? 'var(--accent)' : 'var(--mini-accent)'}
              accentForeground={isNeoTheme ? 'var(--accent-foreground)' : '#060606'}
              style={
                hasTrack
                  ? ({
                      '--adl-liquid-bg': isNeoTheme
                        ? 'var(--accent)'
                        : 'linear-gradient(180deg, color-mix(in srgb, var(--mini-accent) 72%, white 28%) 0%, var(--mini-accent) 100%)',
                      '--adl-liquid-border': isNeoTheme
                        ? 'var(--neo-ink)'
                        : 'color-mix(in srgb, var(--mini-accent) 54%, rgba(255,255,255,0.34) 46%)',
                      '--adl-liquid-shadow': isNeoTheme
                        ? 'var(--neo-shadow-sm)'
                        : '0 0 18px color-mix(in srgb, var(--mini-glow) 65%, transparent 35%)',
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
            </Button>

            <Button
              onClick={() => {
                void sendAction('next');
              }}
              disabled={!snapshot.hasNext}
              className={cn(
                'flex h-7 w-7 items-center justify-center p-0',
                isNeoTheme
                  ? 'rounded-none border-2 border-black bg-[var(--neo-panel)] shadow-[2px_2px_0_0_#000]'
                  : 'rounded-full',
                !snapshot.hasNext && isNeoTheme && 'opacity-50',
                !snapshot.hasNext && !isNeoTheme && 'text-white/28',
              )}
              style={getControlStyle(snapshot.hasNext)}
              aria-label="Next"
            >
              <SkipForward className="h-3 w-3" />
            </Button>

            <Button
              onClick={minimizeMiniWindow}
              className={cn(
                'ml-0.5 flex h-6 w-6 items-center justify-center p-0',
                isNeoTheme
                  ? 'rounded-none border-2 border-black bg-[var(--neo-panel)] shadow-[2px_2px_0_0_#000]'
                  : 'rounded-full',
              )}
              style={getControlStyle(true)}
              aria-label="Minimize to dock"
              title="Minimize to dock (restore from Dock or taskbar)"
            >
              <Minimize2 className="h-3 w-3" />
            </Button>

            <Button
              onClick={() => {
                void sendAction('show-main');
              }}
              className={cn(
                'flex h-6 w-6 items-center justify-center p-0',
                isNeoTheme
                  ? 'rounded-none border-2 border-black bg-[var(--neo-panel)] shadow-[2px_2px_0_0_#000]'
                  : 'rounded-full',
              )}
              style={getControlStyle(true)}
              aria-label="Show main window"
              title="Show main window"
            >
              <ExternalLink className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
