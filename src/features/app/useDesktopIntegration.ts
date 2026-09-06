import { emitTo } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import {
  pauseCurrentPlayback,
  playAdjacentTrack,
  resumeCurrentPlayback,
  seekToPosition,
  stopCurrentPlayback,
  toggleCurrentPlayback,
} from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import {
  desktopCloseMiniWindow,
  desktopFocusMainWindow,
  desktopMarkRendererReady,
  desktopQuitApplication,
  desktopSetNativeUiState,
  desktopSyncMediaSession,
  desktopToggleMiniWindow,
  getCoverArtData,
  setVolume as setNativeVolume,
} from '../../lib/tauri-commands';
import { flushSettingsWrites } from '../../platform/tauri-zustand-storage';
import { usePlayerStore } from '../../store/player-store';
import { useSettingsStore } from '../../store/settings-store';
import type {
  DesktopControlAction,
  DesktopMediaSessionSyncPayload,
  DesktopMiniSeekPayload,
  DesktopNativeUiState,
  DesktopPlaybackSnapshot,
} from '../../types';
import {
  EVENT_DESKTOP_CONTROL_ACTION,
  EVENT_DESKTOP_NATIVE_SEEK_TO,
  EVENT_DESKTOP_NATIVE_VOLUME,
  EVENT_DESKTOP_PLAYBACK_SNAPSHOT,
  EVENT_DESKTOP_SEEK,
  EVENT_DESKTOP_SNAPSHOT_REQUEST,
  MINI_WINDOW_LABEL,
} from './desktop-events';
import { getActivePlaybackGeneration } from './playback-generation';
import { flushPlayerStateWrites } from './player-state-store';

const MEDIA_ARTWORK_CACHE_LIMIT = 200;
const CONTROL_SETTLE_TIMEOUT_MS = 1000;
const QUIT_FLUSH_TIMEOUT_MS = 1800;

const withTimeout = async <T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

/**
 * Canonical desktop bridge owner for main window integration.
 * Handles native sync, snapshot bridge, and control intents.
 */
export function useDesktopIntegration({
  flushSessionSave,
}: {
  flushSessionSave: () => Promise<void>;
}) {
  const [startupReady, setStartupReady] = useState(() => useSettingsStore.persist.hasHydrated());
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const queueVersion = usePlayerStore((s) => s.queueVersion);
  const playbackSpeed = usePlayerStore((s) => s.playbackSpeed);
  const volume = usePlayerStore((s) => s.volume);
  const shuffleEnabled = usePlayerStore((s) => s.shuffleEnabled);
  const loopMode = usePlayerStore((s) => s.loopMode);

  const statusIconEnabled = useSettingsStore((s) => s.desktopStatusIconEnabled);
  const mediaKeysEnabled = useSettingsStore((s) => s.desktopMediaKeysEnabled);
  const miniWindowEnabled = useSettingsStore((s) => s.desktopMiniWindowEnabled);
  const hideToStatusIconOnClose = useSettingsStore((s) => s.hideToStatusIconOnClose);

  const mediaArtworkCacheRef = useRef<Map<string, string | null>>(new Map());
  const mediaSyncRevisionRef = useRef(0);
  const desktopActionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const quitPromiseRef = useRef<Promise<void> | null>(null);
  const pendingSeekAcknowledgementRef = useRef(false);
  const miniSourceRef = useRef<{
    trackId: string;
    generation: number;
    sourceId: string;
  } | null>(null);
  const miniSourceSequenceRef = useRef(0);

  useEffect(() => {
    if (useSettingsStore.persist.hasHydrated()) {
      setStartupReady(true);
    }
    return useSettingsStore.persist.onFinishHydration(() => setStartupReady(true));
  }, []);

  const getMediaArtworkCacheEntry = useCallback((trackKey: string): string | null | undefined => {
    const cache = mediaArtworkCacheRef.current;
    const entry = cache.get(trackKey);
    if (entry === undefined) return undefined;

    cache.delete(trackKey);
    cache.set(trackKey, entry);
    return entry;
  }, []);

  const upsertMediaArtworkCacheEntry = useCallback((trackKey: string, artwork: string | null) => {
    const cache = mediaArtworkCacheRef.current;
    if (cache.has(trackKey)) {
      cache.delete(trackKey);
    }

    cache.set(trackKey, artwork);
    while (cache.size > MEDIA_ARTWORK_CACHE_LIMIT) {
      const oldest = cache.keys().next().value;
      if (!oldest) break;
      cache.delete(oldest);
    }
  }, []);

  const getDesktopSourceId = useCallback((trackId: string, generation: number) => {
    const current = miniSourceRef.current;
    if (current?.trackId === trackId && current.generation === generation) {
      return current.sourceId;
    }

    miniSourceSequenceRef.current += 1;
    const sourceId = `source-${miniSourceSequenceRef.current.toString(36)}`;
    miniSourceRef.current = { trackId, generation, sourceId };
    return sourceId;
  }, []);

  const getDesktopSnapshot = useCallback((): DesktopPlaybackSnapshot => {
    const player = usePlayerStore.getState();
    const track = player.currentTrack;
    const generation = getActivePlaybackGeneration();
    if (!track || !player.hasActivePlayback) {
      miniSourceRef.current = null;
    }
    return {
      track: track
        ? {
            title: track.title,
            artist: track.artist,
            coverArtHash: track.coverArtHash ?? null,
          }
        : null,
      sourceId: track && player.hasActivePlayback ? getDesktopSourceId(track.id, generation) : null,
      isPlaying: player.isPlaying,
      position: player.currentTime,
      duration: player.duration > 0 ? player.duration : (track?.duration ?? 0),
      hasPrevious: Boolean(player.previewPrevious()),
      hasNext: Boolean(player.previewNext()),
    };
  }, [getDesktopSourceId]);

  const emitDesktopSnapshotToMini = useCallback(async () => {
    if (!miniWindowEnabled) return;

    try {
      await emitTo(MINI_WINDOW_LABEL, EVENT_DESKTOP_PLAYBACK_SNAPSHOT, getDesktopSnapshot());
    } catch {
      // Mini surface may not be open.
    }
  }, [getDesktopSnapshot, miniWindowEnabled]);

  const syncDesktopNativeUi = useCallback(async () => {
    const player = usePlayerStore.getState();
    const nativeState: DesktopNativeUiState = {
      trackLabel: player.currentTrack
        ? `${player.currentTrack.title} - ${player.currentTrack.artist}`
        : null,
      isPlaying: player.isPlaying,
      hasTrack: Boolean(player.currentTrack),
      hasPrevious: Boolean(player.previewPrevious()),
      hasNext: Boolean(player.previewNext()),
      statusIconEnabled,
      mediaKeysEnabled,
      miniWindowEnabled,
      hideToStatusIconOnClose,
    };

    try {
      await desktopSetNativeUiState(nativeState);
    } catch (error) {
      reportError('Failed to sync desktop native UI state', {
        source: 'desktop-bridge',
        error,
      });
    }
  }, [hideToStatusIconOnClose, mediaKeysEnabled, miniWindowEnabled, statusIconEnabled]);

  const syncDesktopMediaSessionNow = useCallback(async () => {
    const revision = ++mediaSyncRevisionRef.current;
    const player = usePlayerStore.getState();
    const track = player.currentTrack;

    const payload: DesktopMediaSessionSyncPayload = {
      enabled: mediaKeysEnabled,
      title: track?.title ?? null,
      artist: track?.artist ?? null,
      album: track?.album ?? null,
      albumArtist: null,
      artworkDataBase64: null,
      isPlaying: player.isPlaying,
      position: player.currentTime,
      duration: player.duration > 0 ? player.duration : (track?.duration ?? null),
      shuffle: player.shuffleEnabled,
      repeatMode: player.loopMode,
      playbackRate: player.playbackSpeed,
      volume: player.volume,
    };

    if (mediaKeysEnabled && track?.hasCoverArt && track.filePath) {
      const artworkKey = `${track.id}:${track.coverArtHash ?? 'nohash'}`;
      let artwork = getMediaArtworkCacheEntry(artworkKey);
      if (artwork === undefined) {
        try {
          const art = await getCoverArtData(track.filePath);
          artwork = art?.[1] ?? null;
        } catch {
          artwork = null;
        }
        upsertMediaArtworkCacheEntry(artworkKey, artwork);
      }
      if (revision !== mediaSyncRevisionRef.current) return;
      payload.artworkDataBase64 = artwork;
    }

    if (revision !== mediaSyncRevisionRef.current) return;

    try {
      await desktopSyncMediaSession(payload);
    } catch (error) {
      reportError('Failed to sync desktop media session', {
        source: 'desktop-bridge',
        error,
      });
    }
  }, [getMediaArtworkCacheEntry, mediaKeysEnabled, upsertMediaArtworkCacheEntry]);

  useTauriEvent(
    EVENT_DESKTOP_SNAPSHOT_REQUEST,
    () => {
      void emitDesktopSnapshotToMini();
    },
    [emitDesktopSnapshotToMini],
    (error) =>
      reportError('Failed to setup desktop snapshot listener', { source: 'desktop-bridge', error }),
  );

  useEffect(() => {
    if (!startupReady) return;
    void emitDesktopSnapshotToMini();
  }, [
    emitDesktopSnapshotToMini,
    startupReady,
    currentTrack,
    isPlaying,
    loopMode,
    queueIndex,
    queueVersion,
  ]);

  useEffect(() => {
    if (!startupReady) return;
    void syncDesktopNativeUi();
  }, [
    startupReady,
    syncDesktopNativeUi,
    currentTrack?.id,
    currentTrack?.title,
    currentTrack?.artist,
    isPlaying,
    loopMode,
    queueIndex,
    queueVersion,
  ]);

  useEffect(() => {
    if (!startupReady) return;
    void syncDesktopMediaSessionNow();
  }, [
    startupReady,
    syncDesktopMediaSessionNow,
    currentTrack?.id,
    currentTrack?.title,
    currentTrack?.artist,
    currentTrack?.album,
    currentTrack?.coverArtHash,
    isPlaying,
    playbackSpeed,
    volume,
    shuffleEnabled,
    loopMode,
    mediaKeysEnabled,
  ]);

  useEffect(() => {
    if (!startupReady) return;
    if (!isPlaying) return;
    if (!miniWindowEnabled && !mediaKeysEnabled) return;

    // 2 s is sufficient for macOS Now Playing position updates and
    // mini-window snapshots. 1 s was needlessly chatty over IPC.
    const timer = setInterval(() => {
      if (miniWindowEnabled) {
        void emitDesktopSnapshotToMini();
      }
      if (mediaKeysEnabled) {
        void syncDesktopMediaSessionNow();
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [
    emitDesktopSnapshotToMini,
    isPlaying,
    mediaKeysEnabled,
    miniWindowEnabled,
    startupReady,
    syncDesktopMediaSessionNow,
  ]);

  useEffect(() => {
    if (!startupReady) return;
    return usePlayerStore.subscribe((state, previous) => {
      const positionChanged = state.currentTime !== previous.currentTime;
      const durationChanged = state.duration !== previous.duration;
      const acknowledgeSeek = pendingSeekAcknowledgementRef.current && positionChanged;
      if (acknowledgeSeek) pendingSeekAcknowledgementRef.current = false;

      if (durationChanged || acknowledgeSeek || (positionChanged && !state.isPlaying)) {
        if (miniWindowEnabled) void emitDesktopSnapshotToMini();
        if (mediaKeysEnabled) void syncDesktopMediaSessionNow();
      }
    });
  }, [
    emitDesktopSnapshotToMini,
    mediaKeysEnabled,
    miniWindowEnabled,
    startupReady,
    syncDesktopMediaSessionNow,
  ]);

  const requestQuit = useCallback((): Promise<void> => {
    if (quitPromiseRef.current) return quitPromiseRef.current;

    const quit = (async () => {
      try {
        await withTimeout(
          desktopActionQueueRef.current.catch(() => undefined),
          CONTROL_SETTLE_TIMEOUT_MS,
          'Desktop controls',
        );
      } catch (error) {
        reportError('Timed out waiting for desktop controls before quit', {
          source: 'desktop-bridge',
          error,
        });
      }

      const flushes: Array<[string, () => Promise<void>]> = [
        ['session', flushSessionSave],
        ['player state', flushPlayerStateWrites],
        ['settings', flushSettingsWrites],
      ];
      for (const [label, flush] of flushes) {
        try {
          await withTimeout(flush(), QUIT_FLUSH_TIMEOUT_MS, `${label} flush`);
        } catch (error) {
          reportError(`Failed to flush ${label} before quit`, {
            source: 'desktop-bridge',
            error,
          });
        }
      }

      try {
        await desktopQuitApplication();
      } catch (error) {
        quitPromiseRef.current = null;
        throw error;
      }
    })();
    quitPromiseRef.current = quit;
    return quit;
  }, [flushSessionSave]);

  const handleDesktopAction = useCallback(
    async (action: DesktopControlAction) => {
      switch (action) {
        case 'toggle-play':
          await toggleCurrentPlayback();
          return;
        case 'play':
          if (!usePlayerStore.getState().isPlaying) await resumeCurrentPlayback();
          return;
        case 'pause':
          if (usePlayerStore.getState().isPlaying) await pauseCurrentPlayback();
          return;
        case 'stop':
          await stopCurrentPlayback();
          return;
        case 'next':
          await playAdjacentTrack('next');
          return;
        case 'previous':
          await playAdjacentTrack('previous');
          return;
        case 'seek-backward':
        case 'seek-forward': {
          const player = usePlayerStore.getState();
          if (!player.currentTrack || !player.hasActivePlayback) return;
          const delta = action === 'seek-forward' ? 10 : -10;
          await seekToPosition(Math.max(0, Math.min(player.duration, player.currentTime + delta)), {
            trackId: player.currentTrack.id,
            generation: getActivePlaybackGeneration(),
          });
          return;
        }
        case 'toggle-shuffle':
          usePlayerStore.getState().toggleShuffle();
          return;
        case 'cycle-repeat':
          usePlayerStore.getState().cycleLoopMode();
          return;
        case 'show-main':
          await desktopFocusMainWindow();
          return;
        case 'toggle-mini':
          if (useSettingsStore.getState().desktopMiniWindowEnabled) {
            await desktopToggleMiniWindow();
          }
          return;
        case 'hide-mini':
          await desktopCloseMiniWindow();
          return;
        case 'quit':
          return;
      }
    },
    [requestQuit],
  );

  const enqueueDesktopTask = useCallback((detail: string, task: () => Promise<void>) => {
    const queued = desktopActionQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        if (quitPromiseRef.current && detail !== 'quit') return;
        await task();
      });
    desktopActionQueueRef.current = queued.catch((error) => {
      reportError('Failed to handle desktop control intent', {
        source: 'desktop-bridge',
        detail,
        error,
      });
    });
    return queued;
  }, []);

  useTauriEvent<DesktopControlAction>(
    EVENT_DESKTOP_CONTROL_ACTION,
    (event) => {
      if (event.payload === 'quit') {
        void requestQuit().catch((error) => {
          reportError('Failed to complete desktop quit', { source: 'desktop-bridge', error });
        });
        return;
      }
      void enqueueDesktopTask(event.payload, () => handleDesktopAction(event.payload));
    },
    [enqueueDesktopTask, handleDesktopAction],
    (error) =>
      reportError('Failed to setup desktop action listener', { source: 'desktop-bridge', error }),
    () => {
      void desktopMarkRendererReady().catch((error) =>
        reportError('Failed to mark desktop renderer ready', {
          source: 'desktop-bridge',
          error,
        }),
      );
    },
  );

  useTauriEvent<DesktopMiniSeekPayload>(
    EVENT_DESKTOP_SEEK,
    (event) => {
      void enqueueDesktopTask('seek', async () => {
        if (!useSettingsStore.getState().desktopMiniWindowEnabled) return;
        const player = usePlayerStore.getState();
        const generation = getActivePlaybackGeneration();
        if (
          !Number.isFinite(event.payload.positionSecs) ||
          !player.currentTrack ||
          !player.hasActivePlayback ||
          event.payload.sourceId !== getDesktopSourceId(player.currentTrack.id, generation)
        ) {
          await emitDesktopSnapshotToMini();
          return;
        }
        const position =
          player.duration > 0
            ? Math.min(Math.max(0, event.payload.positionSecs), player.duration)
            : Math.max(0, event.payload.positionSecs);
        const expectedSource = {
          trackId: player.currentTrack.id,
          generation,
        };
        pendingSeekAcknowledgementRef.current = true;
        try {
          const applied = await seekToPosition(position, expectedSource);
          if (!applied) {
            pendingSeekAcknowledgementRef.current = false;
            await emitDesktopSnapshotToMini();
          }
        } catch (error) {
          pendingSeekAcknowledgementRef.current = false;
          throw error;
        }
      });
    },
    [emitDesktopSnapshotToMini, enqueueDesktopTask, getDesktopSourceId],
    (error) =>
      reportError('Failed to setup desktop seek listener', { source: 'desktop-bridge', error }),
  );

  useTauriEvent<number>(
    EVENT_DESKTOP_NATIVE_SEEK_TO,
    (event) => {
      if (!Number.isFinite(event.payload)) return;
      void enqueueDesktopTask('native-seek', async () => {
        if (!useSettingsStore.getState().desktopMediaKeysEnabled) return;
        const player = usePlayerStore.getState();
        if (!player.currentTrack || !player.hasActivePlayback) return;
        const expectedSource = {
          trackId: player.currentTrack.id,
          generation: getActivePlaybackGeneration(),
        };
        const position =
          player.duration > 0
            ? Math.min(Math.max(0, event.payload), player.duration)
            : Math.max(0, event.payload);
        pendingSeekAcknowledgementRef.current = true;
        try {
          const applied = await seekToPosition(position, expectedSource);
          if (!applied) pendingSeekAcknowledgementRef.current = false;
        } catch (error) {
          pendingSeekAcknowledgementRef.current = false;
          throw error;
        }
      });
    },
    [enqueueDesktopTask],
    (error) =>
      reportError('Failed to setup native media seek listener', {
        source: 'desktop-bridge',
        error,
      }),
  );

  useTauriEvent<number>(
    EVENT_DESKTOP_NATIVE_VOLUME,
    (event) => {
      if (!Number.isFinite(event.payload)) return;
      void enqueueDesktopTask('native-volume', async () => {
        if (!useSettingsStore.getState().desktopMediaKeysEnabled) return;
        const volume = Math.max(0, Math.min(1, event.payload));
        await setNativeVolume(volume);
        usePlayerStore.getState().setVolume(volume);
      });
    },
    [enqueueDesktopTask],
    (error) =>
      reportError('Failed to setup native media volume listener', {
        source: 'desktop-bridge',
        error,
      }),
  );
}
