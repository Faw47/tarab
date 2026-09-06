import { useEffect, useRef } from 'react';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import {
  cancelGaplessSource,
  crossfadeToSource,
  type GaplessCancellationNotice,
  playAdjacentTrack,
  preloadGaplessSource,
  subscribeGaplessCancellation,
} from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import type {
  GaplessCancellationOutcome,
  GaplessHandoff,
  GaplessPreloadIdentity,
} from '../../lib/tauri-commands';
import { dbUpdatePlayStats } from '../../lib/tauri-commands';
import { resolveQueueTrackIndex, usePlayerStore } from '../../store/player-store';
import { useSettingsStore } from '../../store/settings-store';
import type { Track } from '../../types';
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

interface PendingGaplessTrack {
  outgoingGeneration: number;
  outgoingPath: string;
  incomingTrack: Track;
  preload: GaplessPreloadIdentity | null;
  preloadPromise: Promise<GaplessPreloadIdentity | null>;
  cancellationPromise: Promise<GaplessCancellationOutcome | null> | null;
  refreshAfterCancellation: boolean;
}

interface PendingCrossfadeTrack {
  outgoingGeneration: number;
  generation: number | null;
  outgoingPath: string;
  incomingPath: string;
  incomingTrack: Track;
}

interface DeferredNearEnd {
  generation: number;
  remaining: number;
}

interface PlaybackEndedEventPayload {
  path: string | null;
  generation: number;
  seamless: boolean;
  handoff: GaplessHandoff | null;
}

function isCrossfadeSuperseded(pending: PendingCrossfadeTrack): boolean {
  const player = usePlayerStore.getState();
  if (!player.hasActivePlayback) return true;

  const activeGeneration = getActivePlaybackGeneration();
  if (pending.generation !== null) {
    return activeGeneration > pending.generation;
  }
  if (activeGeneration === pending.outgoingGeneration) {
    return player.currentTrack?.filePath !== pending.outgoingPath;
  }
  return player.currentTrack?.filePath !== pending.incomingPath;
}

function beginGaplessPreload(
  pendingRef: { current: PendingGaplessTrack | null },
  outgoingGeneration: number,
  outgoingPath: string,
  incomingTrack: Track,
): void {
  const pending: PendingGaplessTrack = {
    outgoingGeneration,
    outgoingPath,
    incomingTrack,
    preload: null,
    preloadPromise: Promise.resolve(null),
    cancellationPromise: null,
    refreshAfterCancellation: false,
  };
  pendingRef.current = pending;
  pending.preloadPromise = preloadGaplessSource(incomingTrack.filePath)
    .then((generation) => {
      if (generation.path !== incomingTrack.filePath) {
        throw new Error('Native gapless preload identity returned a different source path');
      }
      pending.preload = generation;
      return generation;
    })
    .catch((error) => {
      if (pendingRef.current === pending) {
        pendingRef.current = null;
      }
      reportError('Failed to preload next track for gapless playback', {
        source: 'app',
        error,
      });
      return null;
    });
}

function samePreload(left: GaplessPreloadIdentity, right: GaplessPreloadIdentity): boolean {
  return (
    left.preloadId === right.preloadId &&
    left.generation === right.generation &&
    left.path === right.path
  );
}

function applyGaplessHandoff(
  pendingRef: { current: PendingGaplessTrack | null },
  handoff: GaplessHandoff,
): boolean {
  const incoming = handoff.preload;
  if (
    !handoff.outgoingPath ||
    !Number.isSafeInteger(handoff.outgoingGeneration) ||
    !incoming.preloadId ||
    !incoming.path ||
    !Number.isSafeInteger(incoming.generation) ||
    incoming.generation <= handoff.outgoingGeneration
  ) {
    return false;
  }

  const player = usePlayerStore.getState();
  const activeGeneration = getActivePlaybackGeneration();
  if (activeGeneration === incoming.generation && player.currentTrack?.filePath === incoming.path) {
    const currentPending = pendingRef.current;
    if (
      currentPending?.outgoingGeneration === handoff.outgoingGeneration &&
      currentPending.outgoingPath === handoff.outgoingPath &&
      currentPending.incomingTrack.filePath === incoming.path &&
      (currentPending.preload === null || samePreload(currentPending.preload, incoming))
    ) {
      currentPending.preload = incoming;
      pendingRef.current = null;
    }
    return true;
  }

  const pending = pendingRef.current;
  if (
    !pending ||
    pending.outgoingGeneration !== handoff.outgoingGeneration ||
    pending.outgoingPath !== handoff.outgoingPath ||
    pending.incomingTrack.filePath !== incoming.path ||
    (pending.preload !== null && !samePreload(pending.preload, incoming)) ||
    activeGeneration !== handoff.outgoingGeneration ||
    player.currentTrack?.filePath !== handoff.outgoingPath
  ) {
    return false;
  }

  pending.preload = incoming;
  pendingRef.current = null;
  setActivePlaybackGeneration(incoming.generation);
  const queueIndex = resolveQueueTrackIndex(player.queue, pending.incomingTrack);
  const incomingTrack = queueIndex >= 0 ? player.queue[queueIndex] : pending.incomingTrack;
  if (queueIndex >= 0) {
    player.activateTrackAtIndex(queueIndex);
  } else {
    player.setQueueIndex(-1);
    player.setCurrentTrack(incomingTrack);
  }
  player.setDuration(incomingTrack.duration);
  player.setCurrentTime(0);
  player.setIsPlaying(true);
  player.setHasActivePlayback(true);
  return true;
}

function requestGaplessCancellation(
  pendingRef: { current: PendingGaplessTrack | null },
  pending: PendingGaplessTrack,
): Promise<GaplessCancellationOutcome | null> {
  if (pending.cancellationPromise) return pending.cancellationPromise;

  pending.cancellationPromise = (async () => {
    const preload = await pending.preloadPromise;
    if (!preload) return null;

    try {
      const outcome = await cancelGaplessSource(preload);
      if (outcome.status === 'handedOff') {
        applyGaplessHandoff(pendingRef, outcome.handoff);
      } else if (pendingRef.current === pending) {
        pendingRef.current = null;
      }
      return outcome;
    } catch (error) {
      pending.cancellationPromise = null;
      reportError('Failed to cancel gapless preload', { source: 'app', error });
      return null;
    }
  })();
  return pending.cancellationPromise;
}

function cancellationMatchesPending(
  pending: PendingGaplessTrack,
  notice: GaplessCancellationNotice,
): boolean {
  const preload =
    notice.outcome.status === 'handedOff' ? notice.outcome.handoff.preload : notice.outcome.preload;
  return (
    preload.path === pending.incomingTrack.filePath &&
    (pending.preload === null || samePreload(pending.preload, preload))
  );
}

export function usePlaybackLifecycle() {
  const pendingGaplessRef = useRef<PendingGaplessTrack | null>(null);
  const pendingCrossfadeRef = useRef<PendingCrossfadeTrack | null>(null);
  const deferredNearEndRef = useRef<DeferredNearEnd | null>(null);
  const processNearEndRef = useRef<(attempt: DeferredNearEnd) => Promise<void>>(async () => {});
  const halfPlayRecordedForTrackIdRef = useRef<string | null>(null);

  useEffect(() => {
    return usePlayerStore.subscribe((state, prev) => {
      if (state.currentTrack?.id !== prev.currentTrack?.id) {
        halfPlayRecordedForTrackIdRef.current = null;
      }
    });
  }, []);

  useEffect(() => {
    const unsubscribeGaplessCancellation = subscribeGaplessCancellation((notice) => {
      const pending = pendingGaplessRef.current;
      if (!pending || !cancellationMatchesPending(pending, notice)) return;

      if (notice.outcome.status === 'handedOff') {
        applyGaplessHandoff(pendingGaplessRef, notice.outcome.handoff);
        return;
      }

      pendingGaplessRef.current = null;
      if (notice.outcome.status !== 'cancelled') return;

      const player = usePlayerStore.getState();
      if (
        getActivePlaybackGeneration() !== pending.outgoingGeneration ||
        player.currentTrack?.filePath !== pending.outgoingPath
      ) {
        return;
      }
      if (notice.cause === 'outputDevice') {
        void processNearEndRef.current({
          generation: pending.outgoingGeneration,
          remaining: 0,
        });
        return;
      }
      if (notice.position === null) return;
      const remaining = Math.max(0, player.duration - notice.position);
      if (remaining <= 0.25) {
        void processNearEndRef.current({
          generation: pending.outgoingGeneration,
          remaining,
        });
      }
    });

    const unsubscribePlayer = usePlayerStore.subscribe((state, previous) => {
      const pendingCrossfade = pendingCrossfadeRef.current;
      if (pendingCrossfade && isCrossfadeSuperseded(pendingCrossfade)) {
        pendingCrossfadeRef.current = null;
        deferredNearEndRef.current = null;
      }

      const pending = pendingGaplessRef.current;
      if (!pending) return;

      if (
        state.currentTrack?.filePath !== pending.outgoingPath ||
        getActivePlaybackGeneration() !== pending.outgoingGeneration
      ) {
        void requestGaplessCancellation(pendingGaplessRef, pending);
        return;
      }

      const queueChanged = state.queueVersion !== previous.queueVersion;
      const policyChanged =
        state.stopAfterCurrent !== previous.stopAfterCurrent ||
        state.shuffleEnabled !== previous.shuffleEnabled ||
        state.loopMode !== previous.loopMode;
      if (!queueChanged && !policyChanged) return;

      if (pending.refreshAfterCancellation) return;
      pending.refreshAfterCancellation = true;
      void requestGaplessCancellation(pendingGaplessRef, pending).then((outcome) => {
        if (!outcome) {
          pending.refreshAfterCancellation = false;
          return;
        }
        if (outcome.status === 'handedOff' || pendingGaplessRef.current !== null) return;

        const latest = usePlayerStore.getState();
        const settings = useSettingsStore.getState();
        if (
          latest.currentTrack?.filePath !== pending.outgoingPath ||
          getActivePlaybackGeneration() !== pending.outgoingGeneration ||
          latest.stopAfterCurrent ||
          !settings.gapless ||
          settings.crossfadeSeconds > 0
        ) {
          return;
        }
        const next = latest.previewNext();
        if (next) {
          beginGaplessPreload(
            pendingGaplessRef,
            pending.outgoingGeneration,
            pending.outgoingPath,
            next.track,
          );
        }
      });
    });

    const unsubscribeSettings = useSettingsStore.subscribe((state, previous) => {
      if (
        pendingGaplessRef.current &&
        (state.gapless !== previous.gapless ||
          state.crossfadeSeconds !== previous.crossfadeSeconds) &&
        (!state.gapless || state.crossfadeSeconds > 0)
      ) {
        void requestGaplessCancellation(pendingGaplessRef, pendingGaplessRef.current);
      }
    });

    return () => {
      unsubscribeGaplessCancellation();
      unsubscribePlayer();
      unsubscribeSettings();
      pendingCrossfadeRef.current = null;
      deferredNearEndRef.current = null;
      const pending = pendingGaplessRef.current;
      if (pending) void requestGaplessCancellation(pendingGaplessRef, pending);
    };
  }, []);

  useTauriEvent<PlaybackPositionEventPayload>(
    'playback-position',
    (event) => {
      const payload = event.payload;
      const pos = payload.position;
      if (!isCurrentPlaybackGeneration(payload)) return;
      const player = usePlayerStore.getState();
      const { currentTrack, duration } = player;
      if (!currentTrack || duration <= 0) {
        return;
      }

      const crossfadeSeconds = useSettingsStore.getState().crossfadeSeconds;
      if (crossfadeSeconds > 0 && player.hasActivePlayback && !player.stopAfterCurrent) {
        // Positions are media time, while the configured fade duration is wall-clock time.
        const playbackSpeed =
          Number.isFinite(player.playbackSpeed) && player.playbackSpeed > 0
            ? player.playbackSpeed
            : 1;
        const remaining = Math.max(0, duration - pos);
        if (remaining <= crossfadeSeconds * playbackSpeed) {
          void processNearEndRef.current({
            generation: payload.generation,
            remaining,
          });
        }
      }

      const playStatsKey = String(payload.generation) + ':' + currentTrack.id;
      if (halfPlayRecordedForTrackIdRef.current === playStatsKey) {
        return;
      }
      if (pos < duration * 0.5) {
        return;
      }
      halfPlayRecordedForTrackIdRef.current = playStatsKey;
      void dbUpdatePlayStats(currentTrack.id)
        .then(async () => {
          const queryClient = getLibraryQueryClient();
          if (!queryClient) return;
          await invalidateLibraryForMutation(queryClient, 'play-stats');
        })
        .catch((error) => {
          if (halfPlayRecordedForTrackIdRef.current === playStatsKey) {
            halfPlayRecordedForTrackIdRef.current = null;
          }
          reportError('Failed to update play stats', { source: 'app', error });
        });
    },
    [],
    (error) => reportError('Failed to setup playback position listener', { source: 'app', error }),
  );

  const processNearEnd = async (attempt: DeferredNearEnd): Promise<void> => {
    let pending = pendingCrossfadeRef.current;
    if (pending && isCrossfadeSuperseded(pending)) {
      pendingCrossfadeRef.current = null;
      deferredNearEndRef.current = null;
      pending = null;
    }

    const activeGeneration = getActivePlaybackGeneration();
    if (attempt.generation !== activeGeneration && pending?.generation !== attempt.generation) {
      return;
    }

    const { crossfadeSeconds, gapless } = useSettingsStore.getState();
    const playerState = usePlayerStore.getState();
    const playbackSpeed =
      Number.isFinite(playerState.playbackSpeed) && playerState.playbackSpeed > 0
        ? playerState.playbackSpeed
        : 1;
    if (crossfadeSeconds > 0 && attempt.remaining > crossfadeSeconds * playbackSpeed) {
      return;
    }

    if (pending) {
      const deferred = deferredNearEndRef.current;
      if (
        !deferred ||
        attempt.generation > deferred.generation ||
        (attempt.generation === deferred.generation && attempt.remaining < deferred.remaining)
      ) {
        deferredNearEndRef.current = attempt;
      }
      return;
    }

    if (!playerState.hasActivePlayback || playerState.stopAfterCurrent) return;

    if (crossfadeSeconds <= 0) {
      if (gapless && !pendingGaplessRef.current) {
        const next = playerState.previewNext();
        const outgoingTrack = playerState.currentTrack;
        if (next && outgoingTrack) {
          beginGaplessPreload(
            pendingGaplessRef,
            activeGeneration,
            outgoingTrack.filePath,
            next.track,
          );
        }
      }
      return;
    }

    const next = playerState.previewNext();
    const outgoingTrack = playerState.currentTrack;
    if (!next || !outgoingTrack) return;

    const pendingCrossfade: PendingCrossfadeTrack = {
      outgoingGeneration: activeGeneration,
      generation: null,
      outgoingPath: outgoingTrack.filePath,
      incomingPath: next.track.filePath,
      incomingTrack: next.track,
    };
    pendingCrossfadeRef.current = pendingCrossfade;

    try {
      const generation = await crossfadeToSource(next.track.filePath, crossfadeSeconds);
      if (pendingCrossfadeRef.current === pendingCrossfade) {
        pendingCrossfade.generation = generation;
      }
    } catch (err) {
      if (pendingCrossfadeRef.current === pendingCrossfade) {
        pendingCrossfadeRef.current = null;
        deferredNearEndRef.current = null;
      }
      reportError('Crossfade transition failed', { source: 'app', error: err });
    }
  };
  processNearEndRef.current = processNearEnd;

  useTauriEvent<PlaybackNearEndEventPayload>(
    'playback-near-end',
    (event) => {
      void processNearEnd(event.payload);
    },
    [],
    (error) => reportError('Failed to setup near-end listener', { source: 'app', error }),
  );

  useTauriEvent<PlaybackTransitionEventPayload>(
    'playback-transition',
    (event) => {
      const payload = event.payload;
      let pending = pendingCrossfadeRef.current;
      if (pending && isCrossfadeSuperseded(pending)) {
        pendingCrossfadeRef.current = null;
        deferredNearEndRef.current = null;
        pending = null;
      }
      const matchesPending = Boolean(
        pending &&
          (payload.generation === pending.generation ||
            (pending.generation === null && payload.filePath === pending.incomingPath)),
      );

      if (payload.generation < getActivePlaybackGeneration()) {
        if (matchesPending) {
          pendingCrossfadeRef.current = null;
          deferredNearEndRef.current = null;
        }
        return;
      }

      if (
        pending &&
        matchesPending &&
        (payload.state === 'crossfadeStarted' || payload.state === 'playing')
      ) {
        const player = usePlayerStore.getState();
        const incomingIndex = resolveQueueTrackIndex(player.queue, pending.incomingTrack);
        const incoming = incomingIndex >= 0 ? player.queue[incomingIndex] : pending.incomingTrack;
        setActivePlaybackGeneration(payload.generation);
        if (incomingIndex >= 0) player.activateTrackAtIndex(incomingIndex);
        else player.setCurrentTrack(incoming);
        player.setDuration(incoming.duration);
        player.setCurrentTime(0);
        player.setIsPlaying(true);
        player.setHasActivePlayback(true);
        return;
      }

      if (pending && matchesPending) {
        if (payload.state === 'crossfadeCompleted') {
          const deferred = deferredNearEndRef.current;
          pendingCrossfadeRef.current = null;
          deferredNearEndRef.current = null;
          if (
            deferred &&
            deferred.generation === payload.generation &&
            isCurrentPlaybackGeneration(payload)
          ) {
            void processNearEnd(deferred);
          }
        } else if (payload.state === 'decodeFailed') {
          pendingCrossfadeRef.current = null;
          deferredNearEndRef.current = null;
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

  useTauriEvent<PlaybackEndedEventPayload>(
    'playback-ended',
    (event) => {
      void (async () => {
        const { path: endedPath, seamless, generation, handoff } = event.payload;
        const pending = pendingCrossfadeRef.current;
        if (
          endedPath &&
          pending &&
          endedPath === pending.outgoingPath &&
          generation === pending.outgoingGeneration
        ) {
          return;
        }

        if (seamless) {
          if (
            handoff &&
            handoff.outgoingGeneration === generation &&
            handoff.outgoingPath === endedPath
          ) {
            applyGaplessHandoff(pendingGaplessRef, handoff);
          }
          return;
        }

        if (generation !== getActivePlaybackGeneration()) return;
        const playerState = usePlayerStore.getState();
        const activeTrack = playerState.currentTrack;

        if (endedPath && activeTrack && endedPath !== activeTrack.filePath) {
          return;
        }
        pendingGaplessRef.current = null;

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
            const endedGeneration = generation;
            const expectedPath = activeTrack?.filePath ?? endedPath;
            if (!useSettingsStore.getState().gapless) {
              await new Promise((res) => setTimeout(res, 200));
            }
            const latest = usePlayerStore.getState();
            if (
              getActivePlaybackGeneration() !== endedGeneration ||
              (expectedPath && latest.currentTrack?.filePath !== expectedPath)
            ) {
              return;
            }
            const advanced = await playAdjacentTrack('next', { respectRepeatOne: true });
            if (!advanced) {
              const state = usePlayerStore.getState();
              state.setIsPlaying(false);
              state.setCurrentTime(0);
              state.setHasActivePlayback(false);
            }
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
        const isPendingCrossfadeError = Boolean(
          pendingCrossfade &&
            (pendingCrossfade.generation === payload.generation ||
              (pendingCrossfade.generation === null &&
                pendingCrossfade.incomingPath === payload.filePath)),
        );
        if (payload.generation !== getActivePlaybackGeneration() && !isPendingCrossfadeError) {
          return;
        }
        const stageLabel = payload.stage ? `${payload.stage}` : 'playback';
        const detail = payload.filePath
          ? `${payload.message} (${payload.filePath})`
          : payload.message;
        if (isPendingCrossfadeError) {
          pendingCrossfadeRef.current = null;
          deferredNearEndRef.current = null;
          reportError(`Playback failed at ${stageLabel}`, {
            source: 'audio-backend',
            detail,
          });
          return;
        }
        const activeTrack = usePlayerStore.getState().currentTrack;
        if (payload.filePath && activeTrack && payload.filePath !== activeTrack.filePath) {
          return;
        }

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
        if (payload.stage === 'deviceSwitch' && payload.recoverable) return;
        state.setIsPlaying(false);
        state.setHasActivePlayback(false);
      })();
    },
    [],
    (error) => reportError('Failed to setup playback-error listener', { source: 'app', error }),
  );
}
