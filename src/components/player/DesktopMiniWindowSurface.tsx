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
  type DesktopMiniControlAction,
  type DesktopPlaybackSnapshot,
  EVENT_DESKTOP_PLAYBACK_SNAPSHOT,
} from '../../features/app/desktop-events';
import { getCoverArtBlobFallback } from '../../hooks/useCoverArt';
import { useReactivePalette } from '../../hooks/useReactivePalette';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { formatTime } from '../../lib/format-time';
import {
  desktopMiniControl,
  desktopMiniRequestSnapshot,
  desktopMiniSeek,
} from '../../lib/tauri-commands';
import { Button } from '../ui/button';
import { cn } from '../ui/liquid-glass';

const EMPTY_SNAPSHOT: DesktopPlaybackSnapshot = {
  track: null,
  sourceId: null,
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
  const [seekState, setSeekState] = useState<{ isSeeking: boolean; valueSecs: number }>({
    isSeeking: false,
    valueSecs: 0,
  });
  const seekStateRef = useRef(seekState);
  const seekOriginRef = useRef<string | null>(null);
  seekStateRef.current = seekState;

  const coverArtHash = snapshot.track?.coverArtHash ?? null;
  const [coverArtFallback, setCoverArtFallback] = useState<string | null>(null);
  const [coverArtFailed, setCoverArtFailed] = useState(false);
  const coverArtRequestRef = useRef(0);
  const fallbackAttemptedRef = useRef(false);
  const coverArt = useMemo(
    () => (coverArtHash ? `cover-art://localhost/${coverArtHash}/small` : null),
    [coverArtHash],
  );

  useEffect(() => {
    coverArtRequestRef.current += 1;
    fallbackAttemptedRef.current = false;
    setCoverArtFallback(null);
    setCoverArtFailed(false);

    return () => {
      coverArtRequestRef.current += 1;
    };
  }, [coverArtHash]);

  const displayCoverArt = coverArtFailed ? null : (coverArtFallback ?? coverArt);

  const handleCoverArtError = useCallback(async () => {
    if (!coverArtHash || fallbackAttemptedRef.current) {
      setCoverArtFailed(true);
      return;
    }

    fallbackAttemptedRef.current = true;
    const requestId = coverArtRequestRef.current;
    try {
      const blobUrl = await getCoverArtBlobFallback(coverArtHash, 'small');
      if (requestId !== coverArtRequestRef.current) return;
      if (blobUrl) {
        setCoverArtFallback(blobUrl);
      } else {
        setCoverArtFailed(true);
      }
    } catch {
      if (requestId === coverArtRequestRef.current) setCoverArtFailed(true);
    }
  }, [coverArtHash]);
  const palette = useReactivePalette({
    coverArtUrl: displayCoverArt,
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

  const sendAction = useCallback(async (action: DesktopMiniControlAction) => {
    await desktopMiniControl(action);
  }, []);

  const sendSeek = useCallback(async (positionSecs: number, sourceId: string) => {
    await desktopMiniSeek({ positionSecs, sourceId });
  }, []);

  const captureSeekOrigin = useCallback(() => {
    if (!snapshot.sourceId) return null;
    seekOriginRef.current = snapshot.sourceId;
    return snapshot.sourceId;
  }, [snapshot.sourceId]);

  const hideMiniWindow = useCallback(() => {
    void sendAction('hide-mini').catch(() => undefined);
  }, [sendAction]);

  const requestSnapshot = useCallback(() => {
    void desktopMiniRequestSnapshot().catch(() => undefined);
  }, []);

  /** CSS `app-region: drag` is flaky on transparent frameless macOS webviews; this matches native titlebar drags. */
  const handleWindowDragPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    void getCurrentWindow()
      .startDragging()
      .catch(() => undefined);
  }, []);

  const finishSeek = useCallback(async () => {
    const current = seekStateRef.current;
    if (!current.isSeeking) return;

    // Guard against duplicate finish events firing before state updates land.
    const seekValue = current.valueSecs;
    const seekOrigin = seekOriginRef.current;
    seekOriginRef.current = null;
    seekStateRef.current = { isSeeking: false, valueSecs: 0 };
    setSeekState({ isSeeking: false, valueSecs: 0 });

    try {
      if (!seekOrigin) return;
      const duration = snapshot.duration;
      if (duration > 0) {
        await sendSeek(Math.max(0, Math.min(seekValue, duration)), seekOrigin);
      } else {
        await sendSeek(Math.max(0, seekValue), seekOrigin);
      }
    } catch {
      // Best-effort bridge: mini window shouldn't crash if seek fails.
    }
  }, [sendSeek, snapshot.duration]);

  useTauriEvent<DesktopPlaybackSnapshot>(
    EVENT_DESKTOP_PLAYBACK_SNAPSHOT,
    (event) => {
      const origin = seekOriginRef.current;
      if (origin && event.payload.sourceId !== origin) {
        seekOriginRef.current = null;
        seekStateRef.current = { isSeeking: false, valueSecs: 0 };
        setSeekState({ isSeeking: false, valueSecs: 0 });
      }
      setSnapshot(event.payload);
    },
    [],
    undefined,
    requestSnapshot,
  );

  useEffect(() => {
    const retry = window.setTimeout(requestSnapshot, 250);
    const handleVisibility = () => {
      if (!document.hidden) requestSnapshot();
    };
    window.addEventListener('focus', requestSnapshot);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearTimeout(retry);
      window.removeEventListener('focus', requestSnapshot);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [requestSnapshot]);

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
              void sendAction('show-main').catch(() => undefined);
            }}
            title="Drag to move"
          >
            {displayCoverArt ? (
              <img
                key={displayCoverArt}
                src={displayCoverArt}
                alt=""
                className="pointer-events-none h-full w-full object-cover"
                draggable={false}
                onError={() => void handleCoverArtError()}
              />
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
                void sendAction('show-main').catch(() => undefined);
              }}
              title="Drag to move · double-click for main window"
            >
              <p className="truncate text-[12px] font-semibold leading-tight text-white">
                {trackTitle}
              </p>
              <p className="truncate text-xs font-medium text-white/55">{trackArtist}</p>
            </div>
            <div
              className="relative h-1 overflow-hidden rounded-full bg-white/10 pointer-events-auto"
              data-mini-no-drag
            >
              <div
                className="h-full rounded-full transition-[width] duration-[var(--motion-standard)]"
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
                  const clamped =
                    duration > 0 ? Math.max(0, Math.min(raw, duration)) : Math.max(0, raw);

                  if (seekStateRef.current.isSeeking) {
                    seekStateRef.current = { isSeeking: true, valueSecs: clamped };
                    setSeekState({ isSeeking: true, valueSecs: clamped });
                    return;
                  }

                  // Keyboard-driven seek: commit immediately so the app responds quickly.
                  const origin = captureSeekOrigin();
                  if (!origin) return;
                  seekStateRef.current = { isSeeking: true, valueSecs: clamped };
                  setSeekState({ isSeeking: true, valueSecs: clamped });
                  void (async () => {
                    try {
                      await sendSeek(clamped, origin);
                    } finally {
                      seekOriginRef.current = null;
                      seekStateRef.current = { isSeeking: false, valueSecs: 0 };
                      setSeekState({ isSeeking: false, valueSecs: 0 });
                    }
                  })().catch(() => undefined);
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  const raw = parseFloat((e.currentTarget as HTMLInputElement).value);
                  const duration = durationSecs;
                  const clamped =
                    duration > 0 ? Math.max(0, Math.min(raw, duration)) : Math.max(0, raw);
                  if (!captureSeekOrigin()) return;
                  seekStateRef.current = { isSeeking: true, valueSecs: clamped };
                  setSeekState({ isSeeking: true, valueSecs: clamped });
                }}
                onPointerMove={(e) => {
                  if (!seekStateRef.current.isSeeking) return;
                  const raw = parseFloat((e.currentTarget as HTMLInputElement).value);
                  const duration = durationSecs;
                  const clamped =
                    duration > 0 ? Math.max(0, Math.min(raw, duration)) : Math.max(0, raw);
                  seekStateRef.current = { isSeeking: true, valueSecs: clamped };
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
            <div className="pointer-events-none flex items-center justify-between text-xs font-medium tabular-nums text-white/45">
              <span>{formatTime(displayPositionSecs)}</span>
              <span>-{formatTime(remaining)}</span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-0.5 pointer-events-auto" data-mini-no-drag>
            <Button
              onClick={() => {
                void sendAction('previous').catch(() => undefined);
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
            </Button>

            <Button
              onClick={() => {
                void sendAction('toggle-play').catch(() => undefined);
              }}
              disabled={!hasTrack}
              variant="primary"
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
            </Button>

            <Button
              onClick={() => {
                void sendAction('next').catch(() => undefined);
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
            </Button>

            <Button
              onClick={hideMiniWindow}
              className="ml-0.5 flex h-6 w-6 items-center justify-center rounded-full p-0"
              style={
                {
                  '--adl-liquid-bg': 'rgba(255,255,255,0.06)',
                  '--adl-liquid-bg-hover': 'rgba(255,255,255,0.12)',
                  '--adl-liquid-border': 'rgba(255,255,255,0.10)',
                  '--adl-liquid-text': 'rgba(255,255,255,0.86)',
                } as CSSProperties
              }
              aria-label="Hide mini player"
              title="Hide mini player"
            >
              <Minimize2 className="h-3 w-3" />
            </Button>

            <Button
              onClick={() => {
                void sendAction('show-main').catch(() => undefined);
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
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
