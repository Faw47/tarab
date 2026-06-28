import { useEffect, useRef } from 'react';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { playAdjacentTrack } from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import { crossfadeToTrack, dbUpdatePlayStats, preloadNextTrack } from '../../lib/tauri-commands';
import { usePlayerStore } from '../../store/player-store';
import { useSettingsStore } from '../../store/settings-store';

interface PlaybackErrorEventPayload {
  filePath: string;
  stage: 'preflight' | 'decode' | 'seek' | 'stream';
  message: string;
  recoverable: boolean;
}

function parsePlaybackEndedPayload(raw: unknown): { path: string | null; seamless: boolean } {
  if (raw === null || raw === undefined) {
    return { path: null, seamless: false };
  }
  if (typeof raw === 'string') {
    return { path: raw, seamless: false };
  }
  if (typeof raw === 'object' && raw !== null && 'path' in raw) {
    const o = raw as { path?: string | null; seamless?: boolean };
    return {
      path: typeof o.path === 'string' ? o.path : (o.path ?? null),
      seamless: Boolean(o.seamless),
    };
  }
  return { path: null, seamless: false };
}

export function usePlaybackLifecycle() {
  const isCrossfadingRef = useRef(false);
  const pendingOutgoingPathRef = useRef<string | null>(null);
  const halfPlayRecordedForTrackIdRef = useRef<string | null>(null);

  useEffect(() => {
    return usePlayerStore.subscribe((state, prev) => {
      if (state.currentTrack?.id !== prev.currentTrack?.id) {
        halfPlayRecordedForTrackIdRef.current = null;
      }
    });
  }, []);

  useTauriEvent<number>(
    'playback-position',
    (event) => {
      const pos = event.payload;
      const { currentTrack, duration } = usePlayerStore.getState();
      if (!currentTrack || duration <= 0) {
        return;
      }
      if (halfPlayRecordedForTrackIdRef.current === currentTrack.id) {
        return;
      }
      if (pos < duration * 0.5) {
        return;
      }
      halfPlayRecordedForTrackIdRef.current = currentTrack.id;
      void dbUpdatePlayStats(currentTrack.id).catch(() => undefined);
    },
    [],
    (error) => reportError('Failed to setup playback position listener', { source: 'app', error }),
  );

  useTauriEvent<number>(
    'playback-near-end',
    () => {
      void (async () => {
        const { crossfadeSeconds, gapless } = useSettingsStore.getState();
        const { stopAfterCurrent } = usePlayerStore.getState();

        if (crossfadeSeconds <= 0) {
          if (gapless && !stopAfterCurrent && !isCrossfadingRef.current) {
            const playerState = usePlayerStore.getState();
            const next = playerState.previewNext();
            if (next) {
              void preloadNextTrack(next.track.filePath).catch(() => undefined);
            }
          }
          return;
        }

        if (stopAfterCurrent || isCrossfadingRef.current) return;

        const playerState = usePlayerStore.getState();
        const next = playerState.previewNext();
        const outgoingTrack = playerState.currentTrack;
        if (!next || !outgoingTrack) return;

        isCrossfadingRef.current = true;

        try {
          await crossfadeToTrack(next.track.filePath, crossfadeSeconds);
          const freshState = usePlayerStore.getState();
          freshState.activateTrackAtIndex(next.index);
          freshState.setDuration(next.track.duration);
          freshState.setIsPlaying(true);
          freshState.setHasActivePlayback(true);
          pendingOutgoingPathRef.current = outgoingTrack.filePath;
        } catch (err) {
          pendingOutgoingPathRef.current = null;
          reportError('Crossfade transition failed', { source: 'app', error: err });
        } finally {
          isCrossfadingRef.current = false;
        }
      })();
    },
    [],
    (error) => reportError('Failed to setup near-end listener', { source: 'app', error }),
  );

  useTauriEvent<unknown>(
    'playback-ended',
    (event) => {
      void (async () => {
        const { path: endedPath, seamless } = parsePlaybackEndedPayload(event.payload);
        const pendingOutgoingPath = pendingOutgoingPathRef.current;
        if (endedPath && pendingOutgoingPath && endedPath === pendingOutgoingPath) {
          pendingOutgoingPathRef.current = null;
          return;
        }

        const playerState = usePlayerStore.getState();
        const activeTrack = playerState.currentTrack;

        if (seamless) {
          if (endedPath && activeTrack && endedPath !== activeTrack.filePath) {
            return;
          }
          const next = playerState.previewNext();
          if (next) {
            playerState.activateTrackAtIndex(next.index);
            playerState.setDuration(next.track.duration);
            playerState.setCurrentTime(0);
            playerState.setIsPlaying(true);
            playerState.setHasActivePlayback(true);
          }
          return;
        }

        if (endedPath && activeTrack && endedPath !== activeTrack.filePath) {
          return;
        }

        if (playerState.stopAfterCurrent) {
          playerState.setStopAfterCurrent(false);
          playerState.setIsPlaying(false);
          playerState.setCurrentTime(0);
          playerState.setHasActivePlayback(false);
          return;
        }

        const nextTrack = playerState.previewNext()?.track ?? null;
        if (nextTrack) {
          try {
            if (!useSettingsStore.getState().gapless) {
              await new Promise((res) => setTimeout(res, 200));
            }
            await playAdjacentTrack('next');
          } catch (error) {
            reportError('Failed to play next track', { source: 'app', error });
            const state = usePlayerStore.getState();
            state.setIsPlaying(false);
            state.setHasActivePlayback(false);
          }
        } else {
          const state = usePlayerStore.getState();
          state.setIsPlaying(false);
          state.setCurrentTime(0);
          state.setHasActivePlayback(false);
        }
      })();
    },
    [],
    (error) => reportError('Failed to setup playback-ended listener', { source: 'app', error }),
  );

  useTauriEvent<PlaybackErrorEventPayload>(
    'playback-error',
    (event) => {
      void (async () => {
        const payload = event.payload;
        const stageLabel = payload.stage ? `${payload.stage}` : 'playback';
        const detail = payload.filePath
          ? `${payload.message} (${payload.filePath})`
          : payload.message;

        reportError(`Playback failed at ${stageLabel}`, {
          source: 'audio-backend',
          detail,
        });

        if (!payload.recoverable && !usePlayerStore.getState().stopAfterCurrent) {
          const nextTrack = usePlayerStore.getState().previewNext()?.track ?? null;
          if (nextTrack) {
            try {
              if (!useSettingsStore.getState().gapless) {
                await new Promise((res) => setTimeout(res, 200));
              }
              await playAdjacentTrack('next');
              return;
            } catch {
              // Ignore and stop playback below.
            }
          }
        }

        const state = usePlayerStore.getState();
        state.setIsPlaying(false);
        state.setHasActivePlayback(false);
      })();
    },
    [],
    (error) => reportError('Failed to setup playback-error listener', { source: 'app', error }),
  );
}
