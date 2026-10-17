import { useCallback, useEffect, useRef } from 'react';
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
import { type PreloadedGaplessEntry, resolveGaplessHandoffIndex } from './gapless-handoff';
import { parsePlaybackPositionPayload } from './playback-events';
import {
  getActivePlaybackGeneration,
  getPlaybackInterventionEpoch,
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

interface PlaybackNearEndEventPayload {
  generation: number;
  remaining: number;
}

interface ParsedPlaybackEnded {
  path: string | null;
  seamless: boolean;
  generation: number | null;
  nextGeneration: number | null;
  nextPath: string | null;
}

const EMPTY_ENDED: ParsedPlaybackEnded = {
  path: null,
  seamless: false,
  generation: null,
  nextGeneration: null,
  nextPath: null,
};

function parsePlaybackEndedPayload(raw: unknown): ParsedPlaybackEnded {
  if (raw === null || raw === undefined) {
    return EMPTY_ENDED;
  }
  if (typeof raw === 'string') {
    return { ...EMPTY_ENDED, path: raw };
  }
  if (typeof raw === 'object' && raw !== null && 'path' in raw) {
    const o = raw as {
      path?: string | null;
      seamless?: boolean;
      generation?: number;
      nextGeneration?: number | null;
      nextPath?: string | null;
    };
    return {
      path: typeof o.path === 'string' ? o.path : (o.path ?? null),
      seamless: Boolean(o.seamless),
      generation: typeof o.generation === 'number' ? o.generation : null,
      nextGeneration: typeof o.nextGeneration === 'number' ? o.nextGeneration : null,
      nextPath: typeof o.nextPath === 'string' ? o.nextPath : null,
    };
  }
  return EMPTY_ENDED;
}

/** Most tracks skipped in a row when automatic queue advance hits unplayable files. */
const MAX_AUTO_SKIPS = 5;

/** The track the queue advanced to on its own, and how many unplayable tracks preceded it. */
interface AutoAdvance {
  generation: number;
  skipped: number;
}

const canAutoSkip = (skipped: number, queueLength: number): boolean =>
  skipped < Math.min(MAX_AUTO_SKIPS, Math.max(0, queueLength - 1));

const stopQueuePlayback = (): void => {
  const state = usePlayerStore.getState();
  state.setIsPlaying(false);
  state.setCurrentTime(0);
  state.setHasActivePlayback(false);
};

/**
 * Plays the next queue entry after a track ended. A track that cannot start (missing, corrupt or
 * unsupported) is skipped with a notice, up to MAX_AUTO_SKIPS in a row, unless the user changed
 * playback meanwhile.
 */
async function advanceQueueAutomatically(
  autoAdvanceRef: { current: AutoAdvance | null },
  skipped: number,
): Promise<void> {
  // After a skip, Repeat One must not retry the file that just failed.
  const next = usePlayerStore.getState().previewNext({ ignoreRepeatOne: skipped > 0 });
  if (!next) {
    autoAdvanceRef.current = null;
    stopQueuePlayback();
    return;
  }

  const epoch = getPlaybackInterventionEpoch();
  try {
    await playAdjacentTrack('next', { automatic: true, entry: next });
    autoAdvanceRef.current = { generation: getActivePlaybackGeneration(), skipped };
  } catch (error) {
    autoAdvanceRef.current = null;
    // playAdjacentTrack marks one intervention itself; any other means the user acted.
    const userActed = getPlaybackInterventionEpoch() !== epoch + 1;
    const state = usePlayerStore.getState();
    if (!userActed && canAutoSkip(skipped, state.queue.length)) {
      reportError(`Skipped "${next.track.title}" because it could not be played`, {
        source: 'app',
        error,
      });
      // Move past the failed entry so the next preview picks the track after it.
      state.activateTrackAtIndex(next.index);
      await advanceQueueAutomatically(autoAdvanceRef, skipped + 1);
      return;
    }
    reportError('Failed to play next track', { source: 'app', error });
    if (!userActed) {
      state.setIsPlaying(false);
      state.setHasActivePlayback(false);
    }
  }
}

export function usePlaybackLifecycle() {
  const isCrossfadingRef = useRef(false);
  const pendingCrossfadeRef = useRef<{
    epoch: number;
    generation: number | null;
    outgoingPath: string;
    incomingPath: string;
    incomingIndex: number;
  } | null>(null);
  const halfPlayRecordedForTrackIdRef = useRef<string | null>(null);
  const preloadedGaplessRef = useRef<PreloadedGaplessEntry | null>(null);
  const autoAdvanceRef = useRef<AutoAdvance | null>(null);

  // A crossfade the renderer requested is pending until the backend reports it started. User
  // play, seek, stop and device commands cancel it in the backend without a transition event.
  const takeLivePendingCrossfade = useCallback(() => {
    const pending = pendingCrossfadeRef.current;
    if (pending && pending.epoch !== getPlaybackInterventionEpoch()) {
      pendingCrossfadeRef.current = null;
      return null;
    }
    return pending;
  }, []);

  useEffect(() => {
    return usePlayerStore.subscribe((state, prev) => {
      if (state.currentTrack?.id !== prev.currentTrack?.id) {
        halfPlayRecordedForTrackIdRef.current = null;
      }
    });
  }, []);

  useTauriEvent<unknown>(
    'playback-position',
    (event) => {
      const parsed = parsePlaybackPositionPayload(event.payload);
      if (!parsed) return;
      if (
        parsed.generation !== null &&
        !isCurrentPlaybackGeneration({ generation: parsed.generation })
      ) {
        return;
      }
      const pos = parsed.position;
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
              const entry: PreloadedGaplessEntry = { track: next.track, index: next.index };
              preloadedGaplessRef.current = entry;
              void preloadGaplessSource(next.track.filePath).catch((error) => {
                if (preloadedGaplessRef.current === entry) {
                  preloadedGaplessRef.current = null;
                }
                reportError('Failed to preload next track for gapless playback', {
                  source: 'app',
                  error,
                });
              });
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
          epoch: getPlaybackInterventionEpoch(),
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
      const pending = takeLivePendingCrossfade();

      if (
        pending &&
        (payload.generation === pending.generation ||
          (pending.generation === null && payload.filePath === pending.incomingPath)) &&
        (payload.state === 'crossfadeStarted' || payload.state === 'playing')
      ) {
        // The backend owns the crossfade from here; later events carry its generation.
        pendingCrossfadeRef.current = null;
        const player = usePlayerStore.getState();
        const incoming = player.queue[pending.incomingIndex];
        if (!incoming) return;
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
          nextPath,
        } = parsePlaybackEndedPayload(event.payload);
        const pending = takeLivePendingCrossfade();
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
          const preloaded = preloadedGaplessRef.current;
          preloadedGaplessRef.current = null;
          if (nextGeneration !== null) {
            setActivePlaybackGeneration(nextGeneration);
          }
          const index = resolveGaplessHandoffIndex(playerState.queue, preloaded, nextPath);
          const incoming =
            index >= 0
              ? playerState.activateTrackAtIndex(index)
              : preloaded && (nextPath === null || preloaded.track.filePath === nextPath)
                ? preloaded.track
                : null;
          if (index < 0 && incoming) {
            // The preloaded entry left the queue; still show what is actually playing.
            playerState.setCurrentTrack(incoming);
          }
          if (incoming) {
            playerState.setDuration(incoming.duration);
          }
          playerState.setCurrentTime(0);
          playerState.setIsPlaying(true);
          playerState.setHasActivePlayback(true);
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

        if (playerState.previewNext()) {
          if (!useSettingsStore.getState().gapless) {
            await new Promise((res) => setTimeout(res, 200));
          }
          await advanceQueueAutomatically(autoAdvanceRef, 0);
        } else {
          autoAdvanceRef.current = null;
          stopQueuePlayback();
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
        const pendingCrossfade = takeLivePendingCrossfade();
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

        // A file the queue reached on its own that fails to decode is skipped; device and
        // stream failures are not, since every following track would fail the same way.
        const autoAdvance = autoAdvanceRef.current;
        if (
          payload.stage === 'decode' &&
          autoAdvance?.generation === payload.generation &&
          canAutoSkip(autoAdvance.skipped, state.queue.length)
        ) {
          await advanceQueueAutomatically(autoAdvanceRef, autoAdvance.skipped + 1);
        }
      })();
    },
    [],
    (error) => reportError('Failed to setup playback-error listener', { source: 'app', error }),
  );
}
