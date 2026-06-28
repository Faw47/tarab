import { emitTo } from '@tauri-apps/api/event';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import {
  pauseCurrentPlayback,
  playAdjacentTrack,
  resumeCurrentPlayback,
  seekToPosition,
  toggleCurrentPlayback,
} from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import {
  desktopCloseMiniWindow,
  desktopFocusMainWindow,
  desktopQuitApplication,
  desktopSetNativeUiState,
  desktopSyncMediaSession,
  desktopToggleMiniWindow,
  getCoverArtData,
} from '../../lib/tauri-commands';
import { usePlayerStore } from '../../store/player-store';
import { useSettingsStore } from '../../store/settings-store';
import type {
  DesktopControlAction,
  DesktopMediaSessionSyncPayload,
  DesktopNativeUiState,
  DesktopPlaybackSnapshot,
  DesktopSeekPayload,
} from '../../types';
import {
  DESKTOP_ACTION_DEDUP_WINDOW_MS,
  EVENT_DESKTOP_CONTROL_ACTION,
  EVENT_DESKTOP_SEEK,
  EVENT_DESKTOP_PLAYBACK_SNAPSHOT,
  EVENT_DESKTOP_SNAPSHOT_REQUEST,
  MINI_WINDOW_LABEL,
} from './desktop-events';

const MEDIA_ARTWORK_CACHE_LIMIT = 200;

/**
 * Canonical desktop bridge owner for main window integration.
 * Handles native sync, snapshot bridge, and control intents.
 */
export function useDesktopIntegration() {
  const [startupReady, setStartupReady] = useState(false);
  const currentTrack = usePlayerStore((s) => s.currentTrack);
  const isPlaying = usePlayerStore((s) => s.isPlaying);
  const queueIndex = usePlayerStore((s) => s.queueIndex);
  const queueVersion = usePlayerStore((s) => s.queueVersion);
  const playbackSpeed = usePlayerStore((s) => s.playbackSpeed);
  const shuffleEnabled = usePlayerStore((s) => s.shuffleEnabled);
  const loopMode = usePlayerStore((s) => s.loopMode);

  const statusIconEnabled = useSettingsStore((s) => s.desktopStatusIconEnabled);
  const mediaKeysEnabled = useSettingsStore((s) => s.desktopMediaKeysEnabled);
  const miniWindowEnabled = useSettingsStore((s) => s.desktopMiniWindowEnabled);
  const hideToStatusIconOnClose = useSettingsStore((s) => s.hideToStatusIconOnClose);

  const lastActionRef = useRef<{ action: DesktopControlAction; at: number } | null>(null);
  const mediaArtworkCacheRef = useRef<Map<string, string | null>>(new Map());

  useEffect(() => {
    const timer = window.setTimeout(() => setStartupReady(true), 800);
    return () => window.clearTimeout(timer);
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

  const getDesktopSnapshot = useCallback((): DesktopPlaybackSnapshot => {
    const player = usePlayerStore.getState();
    return {
      track: player.currentTrack,
      isPlaying: player.isPlaying,
      position: player.currentTime,
      duration: player.duration > 0 ? player.duration : (player.currentTrack?.duration ?? 0),
      hasPrevious: Boolean(player.previewPrevious()),
      hasNext: Boolean(player.previewNext()),
    };
  }, []);

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

    if (!miniWindowEnabled) {
      void desktopCloseMiniWindow().catch(() => undefined);
    }
  }, [hideToStatusIconOnClose, mediaKeysEnabled, miniWindowEnabled, statusIconEnabled]);

  const syncDesktopMediaSessionNow = useCallback(async () => {
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
      duration: track?.duration ?? player.duration ?? null,
      shuffle: player.shuffleEnabled,
      repeatMode: player.loopMode,
      playbackRate: player.playbackSpeed,
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
      payload.artworkDataBase64 = artwork;
    }

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
    (error) => reportError('Failed to setup desktop snapshot listener', { source: 'desktop-bridge', error }),
  );

  useEffect(() => {
    if (!startupReady) return;
    void emitDesktopSnapshotToMini();
  }, [emitDesktopSnapshotToMini, startupReady, currentTrack?.id, isPlaying, queueIndex, queueVersion]);

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
    shuffleEnabled,
    loopMode,
    mediaKeysEnabled,
  ]);

  useEffect(() => {
    if (!startupReady) return;
    if (!isPlaying) return;
    if (!miniWindowEnabled && !mediaKeysEnabled) return;

    const timer = setInterval(() => {
      if (miniWindowEnabled) {
        void emitDesktopSnapshotToMini();
      }
      if (mediaKeysEnabled) {
        void syncDesktopMediaSessionNow();
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [
    emitDesktopSnapshotToMini,
    isPlaying,
    mediaKeysEnabled,
    miniWindowEnabled,
    startupReady,
    syncDesktopMediaSessionNow,
  ]);

  useTauriEvent<DesktopControlAction>(
    EVENT_DESKTOP_CONTROL_ACTION,
    (event) => {
      void (async () => {
        try {
          const now = Date.now();
          const previous = lastActionRef.current;
          if (
            previous &&
            previous.action === event.payload &&
            now - previous.at < DESKTOP_ACTION_DEDUP_WINDOW_MS
          ) {
            return;
          }

          lastActionRef.current = { action: event.payload, at: now };

          switch (event.payload) {
            case 'toggle-play':
              await toggleCurrentPlayback();
              return;
            case 'play':
              if (!usePlayerStore.getState().isPlaying) {
                await resumeCurrentPlayback();
              }
              return;
            case 'pause':
              if (usePlayerStore.getState().isPlaying) {
                await pauseCurrentPlayback();
              }
              return;
            case 'next':
              await playAdjacentTrack('next');
              return;
            case 'previous':
              await playAdjacentTrack('previous');
              return;
            case 'show-main':
              await desktopFocusMainWindow();
              return;
            case 'toggle-mini':
              if (miniWindowEnabled) {
                await desktopToggleMiniWindow();
              }
              return;
            case 'quit':
              await desktopQuitApplication();
              return;
            default:
              return;
          }
        } catch (error) {
          reportError('Failed to handle desktop action event', {
            source: 'desktop-bridge',
            detail: event.payload,
            error,
          });
        }
      })();
    },
    [miniWindowEnabled],
    (error) => reportError('Failed to setup desktop action listener', { source: 'desktop-bridge', error }),
  );

  useTauriEvent<DesktopSeekPayload>(
    EVENT_DESKTOP_SEEK,
    (event) => {
      if (!miniWindowEnabled) return;
      void seekToPosition(event.payload.positionSecs).catch((error) => {
        reportError('Failed to seek from mini window', {
          source: 'desktop-bridge',
          error,
        });
      });
    },
    [miniWindowEnabled],
    (error) => reportError('Failed to setup desktop seek listener', { source: 'desktop-bridge', error }),
  );

  useTauriEvent<void>(
    'menu-quit',
    () => {
      void desktopQuitApplication().catch((error) => {
        reportError('Failed to quit from menu', {
          source: 'desktop-bridge',
          error,
        });
      });
    },
    [],
    (error) => reportError('Failed to setup menu-quit listener', { source: 'desktop-bridge', error }),
  );
}
