import { useEffect, useRef } from 'react';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import {
  crossfadeToSource,
  playAdjacentTrack,
  preloadGaplessSource,
} from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import { dbUpdatePlayStats } from '../../lib/tauri-commands';
import { usePlayerStore } from '../../store/player-store';
import { useSettingsStore } from '../../store/settings-store';
import { invalidateLibraryForMutation } from '../library/mutations';
import { getLibraryQueryClient } from '../library/queryClientBridge';
import {
  getActivePlaybackGeneration,
  isCurrentPlaybackGeneration,
  setActivePlaybackGeneration,
} from './playback-generation';

interface PlaybackErrorEventPayload {
  filePath: string;
  generation: number;
  stage: 'preflight' | 'decode' | 'seek' | 'stream' | 'deviceSwitch';
  message: string;
  recoverable: boolean;
}

interface PlaybackTransitionEventPayload {
  generation: number;
  state:
    | 'loading'
    | 'playing'
    | 'paused'
    | 'crossfadeStarted'
    | 'crossfadeCompleted'
    | 'ended'
    | 'decodeFailed'
    | 'deviceSwitchFailed'
    | 'sourceRenamed';
  filePath: string | null;
  message: string | null;
  recoverable: boolean;
}

interface PlaybackPositionEventPayload {
  generation: number;
  position: number;
}

interface PlaybackNearEndEventPayload {
  generation: number;
  remaining: number;
}

function parsePlaybackEndedPayload(raw: unknown): {
  path: string | null;
  seamless: boolean;
  generation: number | null;
  nextGeneration: number | null;
} {
  if (raw === null || raw === undefined) {
    return { path: null, seamless: false, generation: null, nextGeneration: null };
  }
  if (typeof raw === 'string') {
    return { path: raw, seamless: false, generation: null, nextGeneration: null };
  }
  if (typeof raw === 'object' && raw !== null && 'path' in raw) {
    const o = raw as {
      path?: string | null;
      seamless?: boolean;
      generation?: number;
      nextGeneration?: number | null;
    };
    return {
      path: typeof o.path === 'string' ? o.path : (o.path ?? null),
      seamless: Boolean(o.seamless),
      generation: typeof o.generation === 'number' ? o.generation : null,
      nextGeneration: typeof o.nextGeneration === 'number' ? o.nextGeneration : null,
    };
  }
  return { path: null, seamless: false, generation: null, nextGeneration: null };
}

export function usePlaybackLifecycle() {
  const isCrossfadingRef = useRef(false);
  const pendingCrossfadeRef = useRef<{
    generation: number | null;
    outgoingPath: string;
    incomingPath: string;
    incomingIndex: number;
  } | null>(null);
  const halfPlayRecordedForTrackIdRef = useRef<string | null>(null);

  useEffect(() => {
    return usePlayerStore.subscribe((state, prev) => {
      if (state.currentTrack?.id !== prev.currentTrack?.id) {
        halfPlayRecordedForTrackIdRef.current = null;
      }
    });
  }, []);

  useTauriEvent<PlaybackPositionEventPayload | number>(
    'playback-position',
    (event) => {
      const payload = event.payload;
      const pos = typeof payload === 'number' ? payload : payload.position;
      if (typeof payload !== 'number' && !isCurrentPlaybackGeneration(payload)) return;
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
      void dbUpdatePlayStats(currentTrack.id)
        .then(async () => {
          const queryClient = getLibraryQueryClient();
          if (!queryClient) return;
          await invalidateLibraryForMutation(queryClient, 'play-stats');
        })
        .catch((error) => reportError('Failed to update play stats', { source: 'app', error }));
    },
    [],
    (error) => reportError('Failed to setup playback position listener', { source: 'app', error }),
  );

  useTauriEvent<PlaybackNearEndEventPayload | number>(
    'playback-near-end',
    (event) => {
      if (typeof event.payload !== 'number' && !isCurrentPlaybackGeneration(event.payload)) {
        return;
      }
      void (async () => {
        const { crossfadeSeconds, gapless } = useSettingsStore.getState();
        const { stopAfterCurrent } = usePlayerStore.getState();

        if (crossfadeSeconds <= 0) {
          if (gapless && !stopAfterCurrent && !isCrossfadingRef.current) {
            const playerState = usePlayerStore.getState();
            const next = playerState.previewNext();
            if (next) {
              void preloadGaplessSource(next.track.filePath).catch((error) =>
                reportError('Failed to preload next track for gapless playback', {
                  source: 'app',
                  error,
                }),
              );
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
        pendingCrossfadeRef.current = {
          generation: null,
          outgoingPath: outgoingTrack.filePath,
          incomingPath: next.track.filePath,
          incomingIndex: next.index,
        };

        try {
          const generation = await crossfadeToSource(next.track.filePath, crossfadeSeconds);
          if (pendingCrossfadeRef.current) {
            pendingCrossfadeRef.current.generation = generation;
          }
        } catch (err) {
          pendingCrossfadeRef.current = null;
          reportError('Crossfade transition failed', { source: 'app', error: err });
        } finally {
          isCrossfadingRef.current = false;
        }
      })();
    },
    [],
    (error) => reportError('Failed to setup near-end listener', { source: 'app', error }),
  );

  useTauriEvent<PlaybackTransitionEventPayload>(
    'playback-transition',
    (event) => {
      const payload = event.payload;
      const pending = pendingCrossfadeRef.current;

      if (
        pending &&
        (payload.generation === pending.generation ||
          (pending.generation === null && payload.filePath === pending.incomingPath)) &&
        (payload.state === 'crossfadeStarted' || payload.state === 'playing')
      ) {
        const player = usePlayerStore.getState();
        const incoming = player.queue[pending.incomingIndex];
        if (!incoming) {
          pendingCrossfadeRef.current = null;
          return;
        }
        setActivePlaybackGeneration(payload.generation);
        player.activateTrackAtIndex(pending.incomingIndex);
        player.setDuration(incoming.duration);
        player.setCurrentTime(0);
        player.setIsPlaying(true);
        player.setHasActivePlayback(true);
        return;
      }

      if (
        pending &&
        (payload.generation === pending.generation ||
          (pending.generation === null && payload.filePath === pending.incomingPath))
      ) {
        if (payload.state === 'crossfadeCompleted' || payload.state === 'decodeFailed') {
          pendingCrossfadeRef.current = null;
        }
        return;
      }

      if (!isCurrentPlaybackGeneration(payload)) return;
      if (payload.state === 'paused') {
        usePlayerStore.getState().setIsPlaying(false);
      } else if (payload.state === 'playing') {
        usePlayerStore.getState().setIsPlaying(true);
      }
    },
    [],
    (error) =>
      reportError('Failed to setup playback transition listener', { source: 'app', error }),
  );

  useTauriEvent<unknown>(
    'playback-ended',
    (event) => {
      void (async () => {
        const {
          path: endedPath,
          seamless,
          generation,
          nextGeneration,
        } = parsePlaybackEndedPayload(event.payload);
        const pending = pendingCrossfadeRef.current;
        if (endedPath && pending && endedPath === pending.outgoingPath) {
          return;
        }
        if (generation !== null && generation !== getActivePlaybackGeneration()) return;

        const playerState = usePlayerStore.getState();
        const activeTrack = playerState.currentTrack;

        if (seamless) {
          if (endedPath && activeTrack && endedPath !== activeTrack.filePath) {
            return;
          }
          const next = playerState.previewNext();
          if (next) {
            if (nextGeneration !== null) {
              setActivePlaybackGeneration(nextGeneration);
            }
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
        const pendingCrossfade = pendingCrossfadeRef.current;
        const isPendingCrossfadeError =
          pendingCrossfade?.generation === payload.generation ||
          (pendingCrossfade?.generation === null &&
            pendingCrossfade.incomingPath === payload.filePath);
        if (
          Number.isSafeInteger(payload.generation) &&
          payload.generation !== getActivePlaybackGeneration() &&
          !isPendingCrossfadeError
        ) {
          return;
        }
        if (isPendingCrossfadeError) {
          pendingCrossfadeRef.current = null;
        }
        const activeTrack = usePlayerStore.getState().currentTrack;
        if (payload.filePath && activeTrack && payload.filePath !== activeTrack.filePath) {
          return;
        }

        const stageLabel = payload.stage ? `${payload.stage}` : 'playback';
        const detail = payload.filePath
          ? `${payload.message} (${payload.filePath})`
          : payload.message;

        reportError(`Playback failed at ${stageLabel}`, {
          source: 'audio-backend',
          detail,
        });

        const state = usePlayerStore.getState();
        state.setPlaybackError({
          generation: payload.generation,
          filePath: payload.filePath,
          stage: payload.stage,
          message: payload.message,
          recoverable: payload.recoverable,
        });
        state.setIsPlaying(false);
        state.setHasActivePlayback(false);
      })();
    },
    [],
    (error) => reportError('Failed to setup playback-error listener', { source: 'app', error }),
  );
}
