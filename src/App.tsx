import { revealItemInDir } from '@tauri-apps/plugin-opener';
import { clsx } from 'clsx';
import { cn } from './lib/utils';
import {
  X,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ConfettiExplosion from 'react-confetti-explosion';
import { useShallow } from 'zustand/react/shallow';
import { HomeView } from './components/home/HomeView';
import { HomeViewNeo } from './components/home/HomeViewNeo';
import { LibraryView } from './components/library/LibraryView';

import { FloatingDock, type NavView, Sidebar } from './components/navigation';
import { TopBar } from './components/navigation/TopBar';
import { AppShellLiquidWebGL } from './components/shell/AppShellLiquidWebGL';
import { LiquidHomeAmbientBackdrop } from './components/shell/LiquidHomeAmbientBackdrop';
import { TopBarNeo } from './components/navigation/TopBarNeo';
import { MiniPlayer } from './components/player/MiniPlayer';
import { PillMiniPlayer } from './components/player/PillMiniPlayer';
import { PlaylistPickerDialog } from './components/playlist/PlaylistPickerDialog';
import { QueueView } from './components/queue/QueueView';
import { AlbumDetailsOverlay } from './components/shared/AlbumDetailsOverlay';
import { AlbumDetailsOverlayNeo } from './components/shared/AlbumDetailsOverlayNeo';
import { ContextMenu } from './components/shared/ContextMenu';
import { Button } from './components/ui/button';
import { ConfirmDialog, type ConfirmDialogProps } from './components/ui/ConfirmDialog';
import { IconButton } from './components/ui/IconButton';
import { InputDialog, type InputDialogProps } from './components/ui/InputDialog';
// Components

import { GlassSystemProvider } from './components/ui/liquid-glass';
import { useLibraryStore } from './store/library-store';
import { useMetadataClipboardStore } from './store/metadata-clipboard-store';
// Stores
import { usePlayerStore } from './store/player-store';
import { useSettingsStore } from './store/settings-store';

// import { usePlaylistStore } from './store/playlist-store';

import { useQueryClient } from '@tanstack/react-query';
import { SmoothTimeProvider } from './contexts/smooth-time';
import { loadPlayerStateFromStore } from './features/app/player-state-store';
import { invalidateLibraryForMutation } from './features/library/mutations';
import { libraryKeys } from './features/library/queryKeys';
import { playlistKeys } from './features/playlists/queryKeys';
import { useAlbumActions } from './hooks/useAlbumActions';
import { useCoverArt } from './hooks/useCoverArt';
import { useTauriEvent } from './hooks/useTauriEvent';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useReactivePalette } from './hooks/useReactivePalette';
import { useCoverArtPrefetching } from './hooks/useCoverArtPrefetching';
import { useSessionPersistence } from './hooks/useSessionPersistence';
import { useContextMenuBuilder } from './hooks/useContextMenuBuilder';
// Utils
import { normalizeLyricsTiming, parseLyrics } from './lib/lyrics-parser';
import { getPathBaseName, normalizePath } from './lib/path-utils';
import { recordPerfBudget, useRenderLog } from './lib/performance';
import { playAdjacentTrack, startPlayback, toggleCurrentPlayback } from './lib/playback-actions';
import { APP_ERROR_EVENT, type AppErrorPayload, reportError } from './lib/report-error';
import {
  cacheClear,
  cacheEnforceLimit,
  dbDeleteTracks,
  dbGetAllTracks,
  dbGetExistingPaths,
  dbGetTrackCount,
  dbGetTracksByAlbumArtist,
  dbGetTracksByIds,
  dbGetTracksPaginated,
  dbUpsertTracks,
  deleteFiles,
  generateCoverArtHashes,
  getBatchMetadata,
  getCoverArtData,
  getLyricsForTrack,
  getPlaylistsDataPath,
  getSmartShuffleQueue,
  moveFile,
  pausePlayback,
  readFullTags,
  renameFile,
  resetPlaylistsData,
  revealInFileManager,
  scanLibrary,
  scanLibraryParallel,
  setAudioOutputDevice,
  // getPlaybackPosition unused
  setPlaybackSpeed as setAudioPlaybackSpeed,
  setVolume as setAudioVolume,
  setCrossfadeDuration,
  setLibraryRoots,
  stopPlayback,
  syncLyricsIndex,
  writeTagsBatch,
} from './lib/tauri-commands';
import { refreshTracksByFilePaths } from './lib/track-refresh';
import { runBatches } from './lib/batch-utils';

// Types
import type { ContextMenuPosition, TagUpdate, Track } from './types';

const LAST_SCAN_KEY = 'tarab-last-scan-v1';
const SCAN_STALE_MS = 1000 * 60 * 60 * 24 * 7;
const METADATA_BATCH_SIZE = 200;
const ART_BATCH_SIZE = 120;
const UnifiedSettingsView = lazy(() =>
  import('./components/settings/UnifiedSettingsView').then((mod) => ({
    default: mod.UnifiedSettingsView,
  })),
);
const TagManagerView = lazy(() =>
  import('./components/tagmanager/TagManagerView').then((mod) => ({ default: mod.TagManagerView })),
);
const TagEditorModal = lazy(() =>
  import('./components/tageditor/TagEditorModal').then((mod) => ({ default: mod.TagEditorModal })),
);
const GlobalCommandPalette = lazy(() =>
  import('./components/navigation/GlobalCommandPalette').then((mod) => ({
    default: mod.GlobalCommandPalette,
  })),
);
const QueueDrawer = lazy(() =>
  import('./components/queue/QueueDrawer').then((mod) => ({ default: mod.QueueDrawer })),
);
const PlayerView = lazy(() =>
  import('./components/player/PlayerView').then((mod) => ({ default: mod.PlayerView })),
);

const viewFallback = (
  <div className="h-full flex items-center justify-center text-sm text-text-secondary">
    Loading view...
  </div>
);

interface FileWithPath extends File {
  path?: string;
}

import { getCurrentWindow } from '@tauri-apps/api/window';
import { useLibraryScan } from './components/settings/useLibraryScan';
import { useDeepLinkBridge } from './features/app/useDeepLinkBridge';
import { useDesktopIntegration } from './features/app/useDesktopIntegration';
import { usePlaybackLifecycle } from './features/app/usePlaybackLifecycle';
import { useSingleInstanceBridge } from './features/app/useSingleInstanceBridge';
import { HotkeysBootstrap } from './features/hotkeys/HotkeysBootstrap';
import { useLibraryData } from './features/library/useLibraryData';
import { globalShortcutsManager } from './platform/globalShortcutsManager';

const App = () => {
  useRenderLog('App');
  const startupLoggedRef = useRef(false);
  const firstLibraryRenderRef = useRef(false);

  // Setup lifecycle listeners
  useSingleInstanceBridge();
  useDeepLinkBridge();
  useDesktopIntegration();

  useEffect(() => {
    if (startupLoggedRef.current) return;
    startupLoggedRef.current = true;
    performance.mark('startup:app-mounted');
    if (import.meta.env.DEV) {
      const boot = performance.getEntriesByName('startup:boot-script')[0];
      if (boot) {
        const interactiveMs = performance.now() - boot.startTime;
        console.info(`[startup] app-mounted: ${interactiveMs.toFixed(1)}ms`);
        recordPerfBudget('startupInteractiveMs', interactiveMs);
      }
    }
  }, []);

  const [isQueueOpen, setIsQueueOpen] = useState(false);

  // Navigation
  const [currentView, setCurrentView] = useState<NavView>('home');

  useEffect(() => {
    const onLibrarySurface = currentView === 'library' || currentView === 'search';
    if (!onLibrarySurface || firstLibraryRenderRef.current) return;
    firstLibraryRenderRef.current = true;
    performance.mark('startup:first-library-surface');
    if (import.meta.env.DEV) {
      const boot = performance.getEntriesByName('startup:boot-script')[0];
      if (boot) {
        const librarySurfaceMs = performance.now() - boot.startTime;
        console.info(`[startup] first-library-surface: ${librarySurfaceMs.toFixed(1)}ms`);
      }
    }
  }, [currentView]);

  const [searchFocusNonce, setSearchFocusNonce] = useState(0);

  const bumpSearchFocus = useCallback(() => {
    setSearchFocusNonce((n) => n + 1);
  }, []);

  // Global search shortcut (ensures '/' works even when TopBar is hidden)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        const target = e.target instanceof HTMLElement ? e.target : null;
        const isTextEntry = target?.closest('input, textarea, select, [contenteditable]') !== null;
        if (isTextEntry) return;

        e.preventDefault();
        setCurrentView('library');
        setShowSearchShell(true);
        setSearchFocusNonce((n) => n + 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  const globalShortcutsEnabled = useSettingsStore((s) => s.globalShortcutsEnabled);
  const shortcuts = useSettingsStore((s) => s.shortcuts);

  // Global shortcuts
  useEffect(() => {
    if (globalShortcutsEnabled) {
      void globalShortcutsManager.registerAll(shortcuts);
    } else {
      void globalShortcutsManager.unregisterAll();
    }
  }, [globalShortcutsEnabled, shortcuts]);

  // Show window when ready
  useEffect(() => {
    const showWindow = async () => {
      // Small delay to ensure layout is ready and avoiding flash
      await new Promise((res) => setTimeout(res, 100));
      await getCurrentWindow().show();
    };
    showWindow();
  }, []);

  const [isScrolled, setIsScrolled] = useState(false);
  const [showSearchShell, setShowSearchShell] = useState(false);
  const [showFullPlayer, setShowFullPlayer] = useState(false);

  const [appError, setAppError] = useState<AppErrorPayload | null>(null);

  // Selection & context menu
  const [selectedTracks, setSelectedTracks] = useState<Track[]>([]);
  const [contextMenuPosition, setContextMenuPosition] = useState<ContextMenuPosition | null>(null);
  const [contextMenuTrack, setContextMenuTrack] = useState<Track | null>(null);
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
  const [playlistPickerTrackIds, setPlaylistPickerTrackIds] = useState<string[]>([]);

  const [albumDetails, setAlbumDetails] = useState<{
    album: string;
    artist: string;
    coverArt?: string;
    tracks: Track[];
  } | null>(null);

  // Tag editor
  const [tagEditorTracks, setTagEditorTracks] = useState<Track[] | null>(null);

  // Custom dialog state (replaces browser confirm/prompt)
  const [confirmDialog, setConfirmDialog] = useState<Omit<ConfirmDialogProps, 'onCancel'> | null>(
    null,
  );
  const [inputDialog, setInputDialog] = useState<Omit<InputDialogProps, 'onCancel'> | null>(null);
  const sessionRestored = useRef(false);
  const sleepTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wasScanning = useRef(false);
  const headerPointerNormRef = useRef<{ x: number; y: number } | null>(null);
  const [shellSearchFocused, setShellSearchFocused] = useState(false);
  const [shellScanBurstKey, setShellScanBurstKey] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  const lastUiPositionRef = useRef<{ time: number; pos: number }>({ time: 0, pos: 0 });
  const [sleepDeadline, setSleepDeadline] = useState<number | null>(null);
  // Settings modal removed - now using unified settings view
  const [showDropOverlay, setShowDropOverlay] = useState(false);
  const [initialLibraryLoading, setInitialLibraryLoading] = useState(true);
  const [libraryLoadError, setLibraryLoadError] = useState<string | null>(null);
  const [playlistRepair, setPlaylistRepair] = useState<{
    reason: string;
    attemptedRecovery: boolean;
    recoveredFrom?: string | null;
  } | null>(null);
  const startupBudgetStartRef = useRef(
    typeof performance !== 'undefined' ? performance.now() : Date.now(),
  );
  const startupBudgetRecordedRef = useRef(false);

  // Player state (single subscription to avoid unnecessary re-renders)
  const {
    currentTrack,
    isPlaying,

    // hasActivePlayback now read via getState() in handlers
    shuffleEnabled,
    loopMode,
    setLyrics,
    setCurrentTime,
    setIsPlaying,
    setVolume,
    // playPrevious now read via getState() in handlers
    setCurrentTrack,
    setDuration,
    addToQueue,
    stopAfterCurrent,
    setStopAfterCurrent,
    setResumePosition,
    setShuffleHistorySize: syncShuffleHistorySize,
    setHasActivePlayback,
    setShuffleEnabled,
    setLoopMode,
    applyTrackRatings: applyPlayerTrackRatings,
  } = usePlayerStore(
    useShallow((s) => ({
      currentTrack: s.currentTrack,
      isPlaying: s.isPlaying,

      // hasActivePlayback now read via getState() in handlers
      shuffleEnabled: s.shuffleEnabled,
      loopMode: s.loopMode,
      setLyrics: s.setLyrics,
      // currentTime removed to avoid re-renders
      setCurrentTime: s.setCurrentTime,
      setIsPlaying: s.setIsPlaying,
      setVolume: s.setVolume,
      // playPrevious now read via getState() in handlers
      setCurrentTrack: s.setCurrentTrack,
      setDuration: s.setDuration,
      addToQueue: s.addToQueue,
      stopAfterCurrent: s.stopAfterCurrent,
      setStopAfterCurrent: s.setStopAfterCurrent,
      setResumePosition: s.setResumePosition,
      // duration: s.duration, // Removed
      setShuffleHistorySize: s.setShuffleHistorySize,
      setHasActivePlayback: s.setHasActivePlayback,
      setShuffleEnabled: s.setShuffleEnabled,
      setLoopMode: s.setLoopMode,
      applyTrackRatings: s.applyTrackRatings,
    })),
  );
  const {
    setTracks,
    setTrackCount,
    applyCoverArtHashes,
    tracks: libraryTracks,
    searchQuery,
    setSearchQuery,
    isSearching: isSearchingLibrary,
    trackCount: totalTracks,
  } = useLibraryData();

  const {
    setIsScanning,
    setScanProgress,
    processingTasks,
    startProcessing,
    updateProcessing,
    finishProcessing,
    isScanning,
    scanProgress,
  } = useLibraryStore(
    useShallow((s) => ({
      setIsScanning: s.setIsScanning,
      setScanProgress: s.setScanProgress,
      processingTasks: s.processingTasks,
      startProcessing: s.startProcessing,
      updateProcessing: s.updateProcessing,
      finishProcessing: s.finishProcessing,
      isScanning: s.isScanning,
      scanProgress: s.scanProgress,
    })),
  );

  useEffect(() => {
    if (wasScanning.current && !isScanning) {
      if (totalTracks > 0) {
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 3500);
      }
      setShellScanBurstKey((k) => k + 1);
      if (scanProgress >= 100) {
        try {
          localStorage.setItem(LAST_SCAN_KEY, Date.now().toString());
        } catch {
          // ignore storage errors
        }
      }
    }
    wasScanning.current = isScanning;
  }, [isScanning, totalTracks, scanProgress]);

  useEffect(() => {
    const handleAppErrorEvent = (event: Event) => {
      const custom = event as CustomEvent<AppErrorPayload>;
      const payload = custom.detail;
      if (!payload) return;
      setAppError(payload);
    };

    window.addEventListener(APP_ERROR_EVENT, handleAppErrorEvent as EventListener);
    return () => window.removeEventListener(APP_ERROR_EVENT, handleAppErrorEvent as EventListener);
  }, []);

  const queryClient = useQueryClient();
  const libraryScan = useLibraryScan();
  const {
    compactMode,
    reducedEffects,
    downloadArtwork,
    followSymlinks,
    crossfadeSeconds,
    shuffleHistorySize,
    cacheSizeLimitMb,
    libraryFolders,
    miniPlayerCollapsed,
    setMiniPlayerCollapsed,
    navMode,
    theme,
    autoLyrics,
  } = useSettingsStore(
    useShallow((s) => ({
      compactMode: s.compactMode,
      reducedEffects: s.reducedEffects,
      downloadArtwork: s.downloadArtwork,
      followSymlinks: s.followSymlinks,
      crossfadeSeconds: s.crossfadeSeconds,
      shuffleHistorySize: s.shuffleHistorySize,
      cacheSizeLimitMb: s.cacheSizeLimitMb,
      libraryFolders: s.libraryFolders,
      miniPlayerCollapsed: s.miniPlayerCollapsed,
      setMiniPlayerCollapsed: s.setMiniPlayerCollapsed,
      navMode: s.navMode,
      theme: s.theme,
      autoLyrics: s.autoLyrics,
    })),
  );
  const metadataClipboard = useMetadataClipboardStore();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const outputDevice = useSettingsStore((s) => s.outputDevice);

  useEffect(() => {
    void setAudioOutputDevice(outputDevice).catch((err) =>
      console.error('Failed to set audio output device:', err),
    );
  }, [outputDevice]);

  /* ── Dynamic Theme & Background ── */
  const isAlbumView = currentView === 'album' && albumDetails != null;
  const albumFirstTrack = albumDetails?.tracks?.[0] ?? null;

  const currentCoverArt = useCoverArt(
    currentTrack?.filePath,
    currentTrack?.hasCoverArt,
    true,
    'small', // smaller is fine for palette extraction
    currentTrack?.coverArtHash,
  );

  const homeAmbientCoverUrlTrack = isAlbumView ? albumFirstTrack : currentTrack;
  const homeAmbientCoverUrl = useCoverArt(
    homeAmbientCoverUrlTrack?.filePath,
    homeAmbientCoverUrlTrack?.hasCoverArt,
    true,
    'large',
    homeAmbientCoverUrlTrack?.coverArtHash,
  );

  const albumPaletteCoverArt = useCoverArt(
    albumFirstTrack?.filePath,
    albumFirstTrack?.hasCoverArt,
    true,
    'small',
    albumFirstTrack?.coverArtHash,
  );

  const effectiveTrackForPalette = isAlbumView ? albumFirstTrack : currentTrack;
  const effectiveCoverArtForPalette = isAlbumView ? albumPaletteCoverArt : currentCoverArt;

  const reactivePalette = useReactivePalette({
    filePath: effectiveTrackForPalette?.filePath,
    coverArtUrl: effectiveCoverArtForPalette,
  });

  const shellVars = useMemo(
    () =>
      ({
        '--shell-blob-a': reactivePalette.shellBlobA,
        '--shell-blob-b': reactivePalette.shellBlobB,
        '--shell-blob-c': reactivePalette.liquidColors.b3,
        '--hero-accent': reactivePalette.heroAccent,
        '--hero-accent-rgb': reactivePalette.primaryRgb.replace(/,/g, ''),
        '--hero-glow': reactivePalette.heroGlow,
        '--surface-tint': reactivePalette.surfaceTint,
        '--text-contrast-bias': reactivePalette.textContrastBias,
        '--signal-play': reactivePalette.heroAccent,
        '--ring': reactivePalette.heroAccent,
        '--color-primary': reactivePalette.heroAccent,
        '--color-accent': reactivePalette.secondaryAccent,
      }) as CSSProperties,
    [reactivePalette],
  );

  const {
    queue,
    queueVersion,
    queueIndex,
    playbackSpeed,
    setQueue,
    setQueueIndex,
    setPlaybackSpeed,
  } = usePlayerStore(
    useShallow((s) => ({
      queue: s.queue,
      queueVersion: s.queueVersion,
      queueIndex: s.queueIndex,
      // currentTime removed
      playbackSpeed: s.playbackSpeed,
      setQueue: s.setQueue,
      setQueueIndex: s.setQueueIndex,
      setPlaybackSpeed: s.setPlaybackSpeed,
    })),
  );
  const activeProcessing = processingTasks[0];
  const isMac = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent) || 
      // @ts-expect-error
      navigator.userAgentData?.platform === 'macOS';
  }, []);
  // Reserved for future layout adjustments
  // const _titlebarInsetTop = isMac ? 28 : 0; // macOS traffic light vertical space
  const titlebarInsetLeft = isMac ? 80 : 0; // macOS overlay traffic lights + breathing room

  useEffect(() => {
    setLibraryRoots(libraryFolders).catch((error) => {
      reportError('Failed to sync library root allowlist', { source: 'app', error });
    });
  }, [libraryFolders]);


  const { prefetchCoverArt } = useCoverArtPrefetching(
    downloadArtwork,
    generateCoverArtHashes,
    applyCoverArtHashes
  );

  const loadInitialLibrary = useCallback(async () => {
    setInitialLibraryLoading(true);
    setLibraryLoadError(null);
    try {
      const total = await dbGetTrackCount();
      const page = await dbGetTracksPaginated(0, 400, 'dateAdded', 'desc');
      const mapped = page.map((t) => {
        const filePath = normalizePath(t.filePath);
        const id = normalizePath(t.id); // Normalize ID as well since it's a file path
        return {
          id,
          title: t.title,
          artist: t.artist,
          albumArtist: t.albumArtist ?? null,
          album: t.album,
          year: t.year,
          duration: t.duration,
          filePath,
          hasCoverArt: t.hasCoverArt,
          coverArt: undefined,
          coverArtHash: t.coverArtHash ?? null,
          dateAdded: t.dateAdded,
        };
      });
      setTracks(mapped);
      setTrackCount(total);
      prefetchCoverArt(mapped);
      void syncLyricsIndex().catch((error) => {
        reportError('Failed to refresh lyrics index', { source: 'app', error });
      });
      try {
        const lastScanRaw = localStorage.getItem(LAST_SCAN_KEY);
        const lastScan = lastScanRaw ? Number.parseInt(lastScanRaw, 10) : 0;
        if (total > 0 && (!lastScan || Date.now() - lastScan > SCAN_STALE_MS)) {

        }
      } catch {
        // ignore storage errors
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load library tracks';
      setLibraryLoadError(message);
      reportError('Failed to load library from database', { source: 'app', error: err });
    } finally {
      if (!startupBudgetRecordedRef.current) {
        startupBudgetRecordedRef.current = true;
        const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
        recordPerfBudget('startupInteractiveMs', now - startupBudgetStartRef.current);
      }
      setInitialLibraryLoading(false);
    }
  }, [prefetchCoverArt, setTrackCount, setTracks]);

  // Load playlists for context menu and persisted tracks (no auto-rescan)
  useEffect(() => {
    void loadInitialLibrary();
    void (async () => {
      await queryClient.invalidateQueries({ queryKey: playlistKeys.all });
      /* sync dynamic handled internally or not needed */
    })();
  }, [loadInitialLibrary, queryClient]);

  // Restore last session (queue, track, position, speed, flags) from disk
  // This effect is DETERMINISTIC: it fetches all needed data from DB directly,
  // not depending on libraryTracks which may be partially loaded.
  useEffect(() => {
    if (sessionRestored.current) return;
    sessionRestored.current = true;

    let cancelled = false;

    const restoreSession = async () => {
      const session = await loadPlayerStateFromStore();
      if (cancelled) return;
      if (!session || session.version !== 1) {
        return;
      }

      // Collect ALL track IDs we need to fetch from DB
      const queueIds = Array.isArray(session.queueIds) ? session.queueIds : [];
      const allNeededIds = new Set<string>(queueIds);
      if (session.currentTrackId) {
        allNeededIds.add(session.currentTrackId);
      }

      // Fetch all needed tracks from DB in one batch (not from libraryTracks)
      const trackLookup = new Map<string, Track>();
      if (allNeededIds.size > 0) {
        try {
          const fetched = await dbGetTracksByIds(Array.from(allNeededIds));
          if (cancelled) return;
          fetched.forEach((t) => {
            trackLookup.set(t.id, {
              id: t.id,
              title: t.title,
              artist: t.artist,
              albumArtist: t.albumArtist ?? null,
              album: t.album,
              year: t.year,
              duration: t.duration,
              filePath: t.filePath,
              hasCoverArt: t.hasCoverArt,
              coverArt: undefined,
              coverArtHash: t.coverArtHash ?? null,
              dateAdded: t.dateAdded,
            });
          });
        } catch (err) {
          console.error('Failed to load session tracks from DB:', err);
        }
      }

      // Restore queue
      let restoredQueue: Track[] = [];
      if (queueIds.length > 0) {
        restoredQueue = queueIds
          .map((id) => trackLookup.get(id))
          .filter((t): t is Track => Boolean(t));
        if (restoredQueue.length > 0) {
          setQueue(restoredQueue);
          if (typeof session.queueIndex === 'number') {
            const safeIndex = Math.min(restoredQueue.length - 1, Math.max(0, session.queueIndex));
            setQueueIndex(safeIndex);
          }
        }
      }

      // Resolve current track
      let resolvedTrack: Track | undefined;
      if (session.currentTrackId) {
        resolvedTrack = trackLookup.get(session.currentTrackId);
      }
      if (!resolvedTrack && typeof session.queueIndex === 'number' && restoredQueue.length > 0) {
        const safeIndex = Math.min(restoredQueue.length - 1, Math.max(0, session.queueIndex));
        resolvedTrack = restoredQueue[safeIndex];
      }

      if (resolvedTrack && restoredQueue.length === 0) {
        setQueue([resolvedTrack]);
        setQueueIndex(0);
      }

      // Set currentTime early when no track is resolved
      if (!resolvedTrack && typeof session.currentTime === 'number') {
        setCurrentTime(Math.max(0, session.currentTime));
      }

      // Restore playback settings
      if (typeof session.playbackSpeed === 'number' && session.playbackSpeed > 0) {
        setPlaybackSpeed(session.playbackSpeed);
        setAudioPlaybackSpeed(session.playbackSpeed).catch((err) =>
          console.error('Failed to restore speed:', err),
        );
      }

      if (typeof session.volume === 'number' && session.volume >= 0) {
        const clampedVol = Math.max(0, Math.min(1, session.volume));
        setVolume(clampedVol);
        setAudioVolume(clampedVol).catch((err) => console.error('Failed to restore volume:', err));
      }

      setShuffleEnabled(!!session.shuffleEnabled);
      if (session.loopMode === 'all' || session.loopMode === 'one' || session.loopMode === 'off') {
        setLoopMode(session.loopMode);
      } else {
        setLoopMode('all');
      }
      setStopAfterCurrent(!!session.stopAfterCurrent);
      setHasActivePlayback(false);
      setIsPlaying(false);

      // Restore view
      if (session.lastView) {
        const validViews: NavView[] = [
          'home',
          'library',
          'search',
          'queue',
          'tags',
          'settings',
          'album',
        ];
        if ((validViews as string[]).includes(session.lastView) && session.lastView !== 'album') {
          setCurrentView(session.lastView as NavView);
        }
      }

      // Restore album details with an exact database query.
      if (session.lastOpenedAlbum && session.lastOpenedArtist) {
        try {
          const albumTracks = await dbGetTracksByAlbumArtist(
            session.lastOpenedAlbum,
            session.lastOpenedArtist,
          );
          if (cancelled) return;

          if (albumTracks.length > 0) {
            setAlbumDetails({
              album: session.lastOpenedAlbum,
              artist: session.lastOpenedArtist,
              tracks: albumTracks.map((t) => ({
                id: t.id,
                title: t.title,
                artist: t.artist,
                albumArtist: t.albumArtist ?? null,
                album: t.album,
                year: t.year,
                duration: t.duration,
                filePath: t.filePath,
                hasCoverArt: t.hasCoverArt,
                coverArt: undefined,
                coverArtHash: t.coverArtHash ?? null,
                dateAdded: t.dateAdded,
              })),
              coverArt: undefined,
            });
            if (session.lastView === 'album') {
              setCurrentView('album');
            }
          }
        } catch (err) {
          console.error('Failed to restore album details:', err);
        }
      }

      // Restore current track and prepare playback
      if (resolvedTrack) {
        setCurrentTrack(resolvedTrack);
        setDuration(resolvedTrack.duration);
        if (typeof session.currentTime === 'number') {
          const clamped = Math.max(
            0,
            Math.min(
              session.currentTime,
              resolvedTrack.duration > 0
                ? Math.max(0, resolvedTrack.duration - 0.75)
                : session.currentTime,
            ),
          );
          setCurrentTime(clamped);
          setResumePosition(resolvedTrack.id, clamped);
          // Track will be loaded on first play - hasActivePlayback is false
        }
      }
    };

    const restoreSessionWithRetry = async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await restoreSession();
          return;
        } catch (err) {
          if (cancelled) return;
          if (attempt === 1) {
            console.error('Failed to restore session:', err);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 120));
        }
      }
    };

    void restoreSessionWithRetry();

    return () => {
      cancelled = true;
    };
  }, [
    // No libraryTracks dependency - we fetch everything from DB
    setQueue,
    setQueueIndex,
    setCurrentTrack,
    setDuration,
    setCurrentTime,
    setPlaybackSpeed,
    setVolume,
    setShuffleEnabled,
    setLoopMode,
    setStopAfterCurrent,
    setHasActivePlayback,
    setIsPlaying,
    setCurrentView,
    setResumePosition,
  ]);

  const { scheduleSessionSave, lastSavedPositionRef, lastSessionSaveRef } = useSessionPersistence(
    currentView,
    albumDetails
  );

  useEffect(() => {
    // Key state changes: save immediately
    scheduleSessionSave(true);
  }, [
    currentTrack?.id,
    queueVersion,
    queueIndex,
    playbackSpeed,

    shuffleEnabled,
    loopMode,
    stopAfterCurrent,
    currentView,
    isPlaying,
    scheduleSessionSave,
  ]);

  // Subscribe to volume changes for session saving without re-rendering App
  useEffect(() => {
    const unsub = usePlayerStore.subscribe((state, prevState) => {
      if (state.volume !== prevState.volume) {
        scheduleSessionSave(true);
      }
    });
    return unsub;
  }, [scheduleSessionSave]);

  // Load lyrics when track changes
  useEffect(() => {
    let cancelled = false;
    const loadLyrics = async () => {
      if (!currentTrack) {
        setLyrics(null);
        return;
      }

      try {
        const lyricsContent = await getLyricsForTrack(
          currentTrack.filePath,
          autoLyrics,
          currentTrack.artist,
          currentTrack.title,
          currentTrack.album,
          currentTrack.duration,
        );
        if (cancelled) return;
        if (lyricsContent) {
          const parsed = parseLyrics(lyricsContent);
          const normalized = normalizeLyricsTiming(
            parsed,
            currentTrack.duration > 0 ? currentTrack.duration * 1000 : undefined,
          );
          setLyrics(normalized);
        } else {
          setLyrics(null);
        }
      } catch (error) {
        console.error('Failed to load lyrics:', error);
        setLyrics(null);
      }
    };

    loadLyrics();
    return () => {
      cancelled = true;
    };
  }, [autoLyrics, currentTrack, setLyrics]);

  // Event-driven position updates (replaces polling)
  useTauriEvent<number>(
    'playback-position',
    (event) => {
      const pos = event.payload;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const last = lastUiPositionRef.current;

      if (now - last.time >= 250 || Math.abs(pos - last.pos) >= 0.25) {
        setCurrentTime(pos);
        lastUiPositionRef.current = { time: now, pos };
      }

      const lastSaved = lastSavedPositionRef.current;
      const timeSinceSave = Date.now() - lastSessionSaveRef.current;
      if (timeSinceSave >= 5000 || Math.abs(pos - lastSaved) >= 5) {
        scheduleSessionSave(false);
      }
    },
    [setCurrentTime, scheduleSessionSave],
    (error) => console.error('Failed to setup playback position listener:', error),
  );

  useTauriEvent<number>(
    'playback-seeked',
    (event) => {
      const pos = Math.max(0, event.payload);
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      setCurrentTime(pos);
      lastUiPositionRef.current = { time: now, pos };
      scheduleSessionSave(true);
    },
    [setCurrentTime, scheduleSessionSave],
    (error) => console.error('Failed to setup playback seek listener:', error),
  );

  useEffect(() => {
    const syncCrossfade = async () => {
      try {
        await setCrossfadeDuration(crossfadeSeconds);
      } catch (err) {
        console.error('Failed to sync crossfade duration:', err);
      }
    };
    syncCrossfade();
  }, [crossfadeSeconds]);

  useEffect(() => {
    syncShuffleHistorySize(shuffleHistorySize);
  }, [shuffleHistorySize, syncShuffleHistorySize]);

  useEffect(() => {
    const cleanup = async () => {
      try {
        if (useSettingsStore.getState().clearCacheOnStartup) {
          await cacheClear();
        }
        await cacheEnforceLimit(cacheSizeLimitMb);
      } catch (err) {
        console.error('Cache maintenance failed:', err);
      }
    };
    cleanup();
  }, []);

  useEffect(() => {
    const enforce = async () => {
      try {
        await cacheEnforceLimit(cacheSizeLimitMb);
      } catch (err) {
        console.error('Failed to enforce cache limit:', err);
      }
    };
    enforce();
  }, [cacheSizeLimitMb]);



  /* Removed: Crossfade logic handled in polling loop */

  usePlaybackLifecycle();

  useKeyboardShortcuts({
    setContextMenuPosition,
    setTagEditorTracks,
    setShowFullPlayer,
    setSelectedTracks,
    contextMenuPosition,
    tagEditorTracks,
    showFullPlayer,
    selectedTracks,
  });

  const { handleOpenAlbumDetails, handlePlayAlbum, handlePlayAlbumTrack, handleShuffleAlbum } =
    useAlbumActions({
      albumDetails,
      setShowFullPlayer,
      setAlbumDetails,
      setCurrentView,
    });

  // Navigation
  const handleNavigate = useCallback((view: NavView) => {
    setCurrentView(view);
    setSelectedTracks([]);
    setAlbumDetails(null);
    setIsScrolled(false);
    if (view !== 'library' && view !== 'search') {
      setShowSearchShell(false);
    }
  }, []);

  const handleShellSearchFocusChange = useCallback(
    (focused: boolean) => {
      setShellSearchFocused(focused);
      if (focused) return;
      if (navMode !== 'iconRail') return;
      if (searchQuery.trim()) return;
      queueMicrotask(() => {
        const bar = document.querySelector('[data-app-top-bar]');
        const ae = document.activeElement;
        if (bar && ae instanceof Node && bar.contains(ae)) return;
        setShowSearchShell(false);
      });
    },
    [navMode, searchQuery],
  );

  const handleBack = useCallback(() => {
    if (albumDetails) {
      setAlbumDetails(null);
      setCurrentView('library');
    }
  }, [albumDetails]);

  // Context menu
  const handleTrackContextMenu = useCallback((track: Track, position: ContextMenuPosition) => {
    setContextMenuTrack(track);
    setContextMenuPosition(position);
  }, []);

  // Track selection
  const handleTrackSelect = useCallback((track: Track, isMulti: boolean) => {
    if (isMulti) {
      setSelectedTracks((prev) => {
        const isSelected = prev.some((t) => t.id === track.id);
        if (isSelected) {
          return prev.filter((t) => t.id !== track.id);
        } else {
          return [...prev, track];
        }
      });
    } else {
      setSelectedTracks([track]);
    }
  }, []);

  const handleSelectAllTracks = useCallback(() => {
    if (albumDetails && albumDetails.tracks.length > 0) {
      setSelectedTracks(albumDetails.tracks);
    } else {
      setSelectedTracks(libraryTracks);
    }
  }, [albumDetails, libraryTracks]);

  const handleClearSelection = useCallback(() => {
    setSelectedTracks([]);
  }, []);

  const handleSelectionChange = useCallback((tracks: Track[]) => {
    setSelectedTracks(tracks);
  }, []);

  const openPlaylistPicker = useCallback((tracks: Track[]) => {
    if (tracks.length === 0) return;
    const trackIds = Array.from(new Set(tracks.map((track) => track.id)));
    if (trackIds.length === 0) return;
    setPlaylistPickerTrackIds(trackIds);
    setShowPlaylistPicker(true);
    setContextMenuPosition(null);
    setContextMenuTrack(null);
  }, []);

  const closePlaylistPicker = useCallback(() => {
    setShowPlaylistPicker(false);
    setPlaylistPickerTrackIds([]);
  }, []);

  // Shuffle all tracks in library
  const handleShuffleAll = useCallback(async () => {
    if (libraryTracks.length === 0) return;
    let allTracks = libraryTracks;
    if (totalTracks > libraryTracks.length) {
      try {
        const dbTracks = await dbGetAllTracks();
        allTracks = dbTracks.map((t) => ({
          id: t.id,
          title: t.title,
          artist: t.artist,
          albumArtist: t.albumArtist ?? null,
          album: t.album,
          year: t.year,
          duration: t.duration,
          filePath: t.filePath,
          hasCoverArt: t.hasCoverArt,
          coverArt: undefined,
          coverArtHash: t.coverArtHash ?? null,
          dateAdded: t.dateAdded,
        }));
      } catch (err) {
        reportError('Failed to load all tracks for shuffle', { source: 'app', error: err });
      }
    }
    let shuffled: typeof allTracks;
    if (useSettingsStore.getState().smartShuffleEnabled) {
      try {
        const order = await getSmartShuffleQueue(allTracks.map((t) => t.id));
        const byId = new Map(allTracks.map((t) => [t.id, t] as const));
        shuffled = order.map((id) => byId.get(id)).filter(Boolean) as typeof allTracks;
        if (shuffled.length !== allTracks.length) {
          shuffled = [...allTracks];
          for (let i = shuffled.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
        }
      } catch {
        shuffled = [...allTracks];
        for (let i = shuffled.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
      }
    } else {
      shuffled = [...allTracks];
      for (let i = shuffled.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
    }
    if (shuffled.length === 0) return;
    const first = shuffled[0];
    try {
      await startPlayback(first, {
        queue: shuffled,
        queueIndex: 0,
        shuffleEnabled: true,
      });
    } catch (err) {
      reportError('Failed to shuffle all tracks', { source: 'app', error: err });
    }
  }, [libraryTracks, totalTracks]);

  const handleTogglePlaybackFromPalette = useCallback(async () => {
    await toggleCurrentPlayback();
  }, []);

  const handleNextTrackFromPalette = useCallback(async () => {
    await playAdjacentTrack('next');
  }, []);

  const handlePreviousTrackFromPalette = useCallback(async () => {
    await playAdjacentTrack('previous');
  }, []);

  const handleRescanFromPalette = useCallback(async () => {
    if (isScanning) return;
    await libraryScan.rescanAll();
  }, [isScanning, libraryScan]);

  const handleOpenAlbumTagEditor = useCallback((tracks: Track[]) => {
    setTagEditorTracks(tracks);
  }, []);

  const handleAddTracksToQueue = useCallback(
    (tracks: Track[]) => {
      tracks.forEach((t) => addToQueue(t));
    },
    [addToQueue],
  );

  const handleRevealTrackInFinder = useCallback(async (track: Track) => {
    try {
      await revealInFileManager(track.filePath);
    } catch (err) {
      reportError('Failed to reveal track in folder', { source: 'app', error: err });
    }
  }, []);

  const handleCopyMetadata = useCallback(
    async (track: Track) => {
      try {
        const info = await readFullTags(track.filePath);
        const update = metadataClipboard.buildTagUpdateFromInfo(info);
        let coverArt = null;
        try {
          const art = await getCoverArtData(track.filePath);
          if (art) {
            coverArt = { mime: art[0], base64: art[1] };
          }
        } catch (err) {
          console.warn('Cover art copy failed:', err);
        }
        metadataClipboard.setClipboard(update, coverArt, track.filePath);
      } catch (err) {
        reportError('Failed to copy metadata', { source: 'app', error: err });
      }
    },
    [metadataClipboard],
  );

  const handlePasteMetadata = useCallback(
    async (targets: Track[]) => {
      if (!metadataClipboard.canPaste() || !metadataClipboard.data) return;
      try {
        const payload: TagUpdate = { ...metadataClipboard.data };
        if (metadataClipboard.coverArt) {
          payload.coverArtBase64 = metadataClipboard.coverArt.base64;
          payload.coverArtMime = metadataClipboard.coverArt.mime;
        }
        const filePaths = targets.map((t) => t.filePath);
        await writeTagsBatch(filePaths, payload);
        await refreshTracksByFilePaths(filePaths);
      } catch (err) {
        reportError('Failed to paste metadata', { source: 'app', error: err });
      }
    },
    [metadataClipboard],
  );

  const applyTrackPathUpdates = useCallback(
    (replacements: Record<string, string>) => {
      const map = new Map(Object.entries(replacements));
      if (map.size === 0) return;

      const currentTracks =
        queryClient.getQueryData<Track[]>(libraryKeys.tracks()) ?? libraryTracks;
      const updatedTracks = currentTracks.map((t) => {
        const newPath = map.get(t.filePath);
        return newPath ? { ...t, id: newPath, filePath: newPath } : t;
      });
      setTracks(updatedTracks);

      setSelectedTracks((prev) =>
        prev.map((t) => {
          const newPath = map.get(t.filePath);
          return newPath ? { ...t, id: newPath, filePath: newPath } : t;
        }),
      );

      setTagEditorTracks((prev) =>
        prev
          ? prev.map((t) => {
            const newPath = map.get(t.filePath);
            return newPath ? { ...t, id: newPath, filePath: newPath } : t;
          })
          : null,
      );
      setContextMenuTrack((prev) => {
        if (!prev) return prev;
        const newPath = map.get(prev.filePath);
        return newPath ? { ...prev, id: newPath, filePath: newPath } : prev;
      });

      const updatedQueue = queue.map((t) => {
        const newPath = map.get(t.filePath);
        return newPath ? { ...t, id: newPath, filePath: newPath } : t;
      });
      setQueue(updatedQueue);

      if (currentTrack) {
        const newPath = map.get(currentTrack.filePath);
        if (newPath) {
          setCurrentTrack({ ...currentTrack, id: newPath, filePath: newPath });
        }
      }

      void queryClient.invalidateQueries({ queryKey: playlistKeys.all });
    },
    [currentTrack, libraryTracks, queryClient, queue, setCurrentTrack, setQueue, setTracks],
  );

  const applyTrackRatings = useCallback(
    (trackIds: string[], rating: number | null) => {
      if (trackIds.length === 0) return;
      const targetIds = new Set(trackIds);
      const currentTracks =
        queryClient.getQueryData<Track[]>(libraryKeys.tracks()) ?? libraryTracks;

      setTracks(
        currentTracks.map((track) => (targetIds.has(track.id) ? { ...track, rating } : track)),
      );

      setSelectedTracks((prev) =>
        prev.map((track) => (targetIds.has(track.id) ? { ...track, rating } : track)),
      );
      setContextMenuTrack((prev) => (prev && targetIds.has(prev.id) ? null : prev));
      applyPlayerTrackRatings(trackIds, rating);
    },
    [applyPlayerTrackRatings, libraryTracks, queryClient, setTracks],
  );

  const pruneTracks = useCallback(
    async (tracksToRemove: Track[]) => {
      if (!tracksToRemove || tracksToRemove.length === 0) return;
      const ids = new Set(tracksToRemove.map((t) => t.id));
      const remaining = libraryTracks.filter((t) => !ids.has(t.id));
      setTracks(remaining);
      // Don't update trackCount here - it will be refreshed from the DB after deletion
      // This avoids incorrect counts when only a subset of tracks is loaded in memory

      const filteredQueue = queue.filter((t) => !ids.has(t.id));
      setQueue(filteredQueue);
      const newQueueIndex = filteredQueue.length
        ? Math.min(queueIndex, filteredQueue.length - 1)
        : -1;
      setQueueIndex(newQueueIndex);

      if (currentTrack && ids.has(currentTrack.id)) {
        try {
          await pausePlayback();
          await stopPlayback();
        } catch (err) {
          reportError('Failed to stop playback before removal', { source: 'app', error: err });
        }
        setCurrentTrack(null);
        setIsPlaying(false);
        setCurrentTime(0);
        setHasActivePlayback(false);
      }

      setSelectedTracks((prev) => prev.filter((t) => !ids.has(t.id)));
      setContextMenuTrack((prev) => (prev && ids.has(prev.id) ? null : prev));
      setContextMenuPosition(null);
      void queryClient.invalidateQueries({ queryKey: playlistKeys.all });
    },
    [
      currentTrack,
      libraryTracks,
      queue,
      queueIndex,
      setCurrentTrack,
      setCurrentTime,
      setHasActivePlayback,
      setIsPlaying,
      setQueue,
      setQueueIndex,
      setTracks,
      queryClient,
    ],
  );

  const cancelSleepTimer = useCallback(() => {
    if (sleepTimeoutRef.current) {
      clearTimeout(sleepTimeoutRef.current);
      sleepTimeoutRef.current = null;
    }
    setSleepDeadline(null);
  }, []);

  const scheduleSleepTimer = useCallback(
    (minutes: number) => {
      cancelSleepTimer();
      const deadline = Date.now() + minutes * 60 * 1000;
      setSleepDeadline(deadline);
      sleepTimeoutRef.current = setTimeout(
        async () => {
          try {
            await pausePlayback();
          } catch (err) {
            reportError('Failed to pause for sleep timer', { source: 'app', error: err });
          } finally {
            setIsPlaying(false);
            setSleepDeadline(null);
            sleepTimeoutRef.current = null;
          }
        },
        minutes * 60 * 1000,
      );
    },
    [cancelSleepTimer, setIsPlaying],
  );

  const handleRevealTracks = useCallback(async (tracks: Track[]) => {
    if (!tracks || tracks.length === 0) return;
    const first = tracks[0];
    try {
      await revealInFileManager(first.filePath);
    } catch (err) {
      reportError('Failed to reveal track in folder', { source: 'app', error: err });
    }
  }, []);

  const handleRevealInLibrary = useCallback(
    (tracks: Track[]) => {
      if (!tracks || tracks.length === 0) return;
      const first = tracks[0];
      const revealQuery = [first.title, first.artist].filter(Boolean).join(' ').trim();
      setCurrentView('library');
      setSelectedTracks(tracks);
      setSearchQuery(revealQuery);
      setContextMenuPosition(null);
      setContextMenuTrack(null);
    },
    [setSearchQuery],
  );

  const handleRetryPlaylistLoad = useCallback(async () => {
    try {
      await queryClient.invalidateQueries({ queryKey: playlistKeys.all });
      setPlaylistRepair(null);
    } catch (error) {
      reportError('Failed to reload playlists', { source: 'app', error });
    }
  }, [queryClient]);

  const handleResetPlaylistData = useCallback(() => {
    setConfirmDialog({
      title: 'Reset playlists data',
      message: 'This will remove all playlists and playlist stats. A backup will be kept on disk.',
      variant: 'danger',
      confirmLabel: 'Reset',
      onConfirm: async () => {
        try {
          await resetPlaylistsData();
          await queryClient.invalidateQueries({ queryKey: playlistKeys.all });
          setPlaylistRepair(null);
        } catch (error) {
          reportError('Failed to reset playlists data', { source: 'app', error });
        }
      },
    });
  }, [queryClient]);

  const handleOpenPlaylistsDataFolder = useCallback(async () => {
    try {
      const dataPath = await getPlaylistsDataPath();
      await revealItemInDir(dataPath);
    } catch (error) {
      reportError('Failed to open playlists data folder', { source: 'app', error });
    }
  }, []);

  const handleRemoveTracks = useCallback(
    (tracksToRemove: Track[]) => {
      if (tracksToRemove.length === 0) return;
      const confirmMsg =
        tracksToRemove.length === 1
          ? `Remove "${tracksToRemove[0].title}" from your library?`
          : `Remove ${tracksToRemove.length} tracks from your library?`;

      setConfirmDialog({
        title: 'Remove from library',
        message: confirmMsg,
        variant: 'danger',
        confirmLabel: 'Remove',
        onConfirm: async () => {
          try {
            await dbDeleteTracks(tracksToRemove.map((t) => t.id));
            await pruneTracks(tracksToRemove);
            const total = await dbGetTrackCount();
            setTrackCount(total);
            await invalidateLibraryForMutation(queryClient, 'delete');
          } catch (err) {
            reportError('Failed to remove tracks from library', { source: 'app', error: err });
          }
        },
      });
    },
    [pruneTracks, queryClient, setTrackCount],
  );

  const handleDeleteTracksFromAlbum = useCallback(
    (tracks: Track[]) => {
      const confirmMsg =
        tracks.length === 1
          ? `Remove "${tracks[0].title}" from your library?`
          : `Remove ${tracks.length} tracks from your library?`;

      setConfirmDialog({
        title: 'Remove from library',
        message: confirmMsg,
        variant: 'danger',
        confirmLabel: 'Remove',
        onConfirm: async () => {
          try {
            await dbDeleteTracks(tracks.map((t) => t.id));
            await pruneTracks(tracks);
            const total = await dbGetTrackCount();
            setTrackCount(total);
            await invalidateLibraryForMutation(queryClient, 'delete');
            // Refresh album view if still open
            if (albumDetails) {
              const remainingTracks = albumDetails.tracks.filter(
                (t) => !tracks.some((del) => del.id === t.id),
              );
              if (remainingTracks.length > 0) {
                setAlbumDetails({
                  ...albumDetails,
                  tracks: remainingTracks,
                });
              } else {
                setAlbumDetails(null);
              }
            }
            handleClearSelection();
          } catch (err) {
            reportError('Failed to remove tracks from album', { source: 'app', error: err });
          }
        },
      });
    },
    [albumDetails, handleClearSelection, pruneTracks, queryClient, setTrackCount],
  );

  const handleDeleteFiles = useCallback(
    (tracksToDelete: Track[]) => {
      if (!tracksToDelete || tracksToDelete.length === 0) return;
      const first = tracksToDelete[0];
      const message =
        tracksToDelete.length === 1
          ? `Delete "${first.title}" from disk? This cannot be undone.`
          : `Delete ${tracksToDelete.length} files from disk? This cannot be undone.`;
      const detail = tracksToDelete.length === 1 ? first.filePath : undefined;

      setConfirmDialog({
        title: 'Delete files',
        message,
        detail,
        variant: 'danger',
        confirmLabel: 'Delete',
        onConfirm: async () => {
          const filePaths = tracksToDelete.map((t) => t.filePath);
          try {
            await deleteFiles(filePaths);
            await pruneTracks(tracksToDelete);
            const total = await dbGetTrackCount();
            setTrackCount(total);
            await invalidateLibraryForMutation(queryClient, 'delete');
          } catch (err) {


            reportError('Failed to delete files', { source: 'app', error: err });
          }
        },
      });
    },
    [pruneTracks, queryClient, setTrackCount],
  );

  // Rename a track file on disk.
  // IMPORTANT: The Rust `rename_file` command updates the DB record's `file_path` atomically.
  // We only update UI state here; DB consistency is handled by the backend.
  const handleRenameTrack = useCallback(
    async (track: Track, newName: string) => {
      if (!newName || !track) return;
      try {
        const newPath = await renameFile(track.filePath, newName);
        applyTrackPathUpdates({ [track.filePath]: newPath });
        await invalidateLibraryForMutation(queryClient, 'rename');
      } catch (err) {


        reportError('Failed to rename file', { source: 'app', error: err });
      }
    },
    [applyTrackPathUpdates, queryClient],
  );

  // Move track files to a new directory.
  // IMPORTANT: The Rust `move_file` command updates the DB record's `file_path` atomically.
  // We only update UI state here; DB consistency is handled by the backend.
  const handleMoveTracks = useCallback(
    async (tracksToMove: Track[], destination: string) => {
      if (!tracksToMove || tracksToMove.length === 0 || !destination) return;
      const replacements: Record<string, string> = {};
      for (const track of tracksToMove) {
        try {
          const targetPath = await moveFile(track.filePath, destination);
          replacements[track.filePath] = targetPath;
        } catch (err) {


          reportError('Failed to move file', { source: 'app', error: err });
        }
      }
      applyTrackPathUpdates(replacements);
      if (Object.keys(replacements).length > 0) {
        await invalidateLibraryForMutation(queryClient, 'rename');
      }
    },
    [applyTrackPathUpdates, queryClient],
  );

  useEffect(() => {
    return () => {
      if (sleepTimeoutRef.current) {
        clearTimeout(sleepTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const audioExt = new Set(['mp3', 'flac', 'wav', 'ogg', 'm4a', 'aac', 'aiff', 'alac']);
    const normalizeDir = (p: string) => {
      const norm = p.replace(/\\/g, '/');
      const idx = norm.lastIndexOf('/');
      return idx >= 0 ? norm.slice(0, idx) : norm;
    };
    const handleDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        e.preventDefault();
        setShowDropOverlay(true);
      }
    };
    const handleDrop = async (e: DragEvent) => {
      if (!e.dataTransfer?.files) return;
      e.preventDefault();
      setShowDropOverlay(false);
      const files = Array.from(e.dataTransfer.files);
      const dirs = new Set<string>();
      files.forEach((file) => {
        const path = (file as FileWithPath).path;
        if (!path) return;
        const ext = path.split('.').pop()?.toLowerCase();
        if (ext && audioExt.has(ext)) {
          dirs.add(normalizeDir(path));
        }
      });
      if (dirs.size === 0) return;
      setIsScanning(true);
      setScanProgress(0);
      const taskId = startProcessing('Importing audio files');
      let processed = 0;
      const newlyAddedTracks: Track[] = [];
      for (const dir of dirs) {
        try {
          const updateDirProgress = (ratio: number) => {
            const overall = ((processed + ratio) / dirs.size) * 100;
            setScanProgress(Math.round(overall));
            updateProcessing(taskId, overall);
          };

          let filePaths: string[] = [];
          try {
            filePaths = await scanLibraryParallel(dir, followSymlinks);
          } catch {
            filePaths = await scanLibrary(dir, followSymlinks);
          }
          const normalizedFilePaths = filePaths.map((p) => normalizePath(p));
          updateDirProgress(0.1);
          const existingInDb = await dbGetExistingPaths(normalizedFilePaths);
          const existingPaths = new Set(existingInDb.map((p) => normalizePath(p)));
          const newFilePaths = normalizedFilePaths.filter((p) => !existingPaths.has(p));
          if (newFilePaths.length > 0) {
            const metadataBase = 0.1;
            const metadataSpan = downloadArtwork ? 0.5 : 0.7;
            const batchMetadata = await runBatches(
              newFilePaths,
              METADATA_BATCH_SIZE,
              getBatchMetadata,
              (done, total) => {
                updateDirProgress(metadataBase + (metadataSpan * done) / total);
              },
            );
            let coverArtHashes: Record<string, string | null> = {};
            const artTargets = downloadArtwork
              ? batchMetadata.filter((m) => m.has_cover_art).map((m) => m.file_path)
              : [];
            if (downloadArtwork && artTargets.length > 0) {
              const artTask = startProcessing('Preparing cover art');
              try {
                const coverBase = metadataBase + metadataSpan;
                const coverSpan = 0.25;
                const hashed = await runBatches(
                  artTargets,
                  ART_BATCH_SIZE,
                  generateCoverArtHashes,
                  (done, total) => {
                    updateDirProgress(coverBase + (coverSpan * done) / total);
                    updateProcessing(artTask, (done / total) * 100);
                  },
                );
                coverArtHashes = Object.fromEntries(hashed);
              } catch (err) {
                reportError('Failed to precompute cover art hashes', { source: 'app', error: err });
              } finally {
                finishProcessing(artTask);
              }
            }
            const newTracks: Track[] = batchMetadata.map((meta) => ({
              id: meta.file_path,
              title: meta.title || getPathBaseName(meta.file_path) || 'Unknown',
              artist: meta.artist || 'Unknown Artist',
              albumArtist: meta.album_artist ?? null,
              album: meta.album || 'Unknown Album',
              year: meta.year,
              duration: meta.duration_secs,
              filePath: meta.file_path,
              hasCoverArt: !!meta.has_cover_art,
              coverArtHash: coverArtHashes[meta.file_path] ?? null,
              dateAdded: Date.now(),
              fileFormat: meta.file_format,
              bitrate: meta.bitrate ?? undefined,
              sampleRate: meta.sample_rate ?? undefined,
              fileSize: meta.file_size ?? undefined,
            }));
            const existing = queryClient.getQueryData<Track[]>(libraryKeys.tracks()) ?? [];
            const merged = [...existing, ...newTracks];
            setTracks(merged);
            newlyAddedTracks.push(...newTracks);
          }
          processed += 1;
          updateDirProgress(1);
        } catch (err) {
          reportError('Failed to import dropped files', { source: 'app', error: err });
        }
      }
      if (newlyAddedTracks.length > 0) {
        try {
          await dbUpsertTracks(
            newlyAddedTracks.map((track) => ({
              id: track.id,
              title: track.title,
              artist: track.artist,
              albumArtist: track.albumArtist ?? null,
              album: track.album,
              year: track.year,
              duration: track.duration,
              filePath: track.filePath,
              hasCoverArt: track.hasCoverArt,
              coverArtHash: track.coverArtHash ?? null,
              fileFormat: track.fileFormat ?? null,
              bitrate: track.bitrate ?? null,
              sampleRate: track.sampleRate ?? null,
              fileSize: track.fileSize ?? null,
              dateAdded: track.dateAdded,
              playCount: 0,
              lastPlayed: null,
              rating: null,
              blurhash: track.blurhash || null,
            })),
          );
          void syncLyricsIndex().catch((error) => {
            reportError('Failed to refresh lyrics index after import', { source: 'app', error });
          });
          const total = await dbGetTrackCount();
          setTrackCount(total);
          await invalidateLibraryForMutation(queryClient, 'upsert');
        } catch (err) {
          reportError('Failed to persist imported tracks', { source: 'app', error: err });
        }
      }
      setScanProgress(100);
      try {
        localStorage.setItem(LAST_SCAN_KEY, Date.now().toString());
      } catch {
        // ignore storage errors
      }
      setIsScanning(false);
      finishProcessing(taskId);
    };
    const handleDragLeave = (e: DragEvent) => {
      if (e.relatedTarget === null) {
        setShowDropOverlay(false);
      }
    };
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    window.addEventListener('dragleave', handleDragLeave);
    return () => {
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('dragleave', handleDragLeave);
    };
  }, [
    downloadArtwork,
    finishProcessing,
    followSymlinks,
    queryClient,
    setIsScanning,
    setScanProgress,
    setTrackCount,
    setTracks,
    startProcessing,
    updateProcessing,
  ]);

  const { contextMenuItems } = useContextMenuBuilder({
    selectedTracks,
    contextMenuTrack,
    addToQueue,
    setTagEditorTracks,
    handleRevealTracks,
    handleRemoveTracks,
    handleRevealInLibrary,
    applyTrackRatings,
    openPlaylistPicker,
    queryClient,
  });

  useEffect(() => {
    if (currentView === 'album' && !albumDetails) {
      setCurrentView('home');
    }
  }, [albumDetails, currentView]);

  const currentViewContent = useMemo(() => {
    const HomeViewComponent = theme === 'neobrutalism' ? HomeViewNeo : HomeView;
    const renderHomeView = () => (
      <HomeViewComponent
        onNavigateToLibrary={() => handleNavigate('library')}
        onNavigateToFolders={() => handleNavigate('settings')}
        onNavigateToQueue={() => handleNavigate('queue')}
        onOpenAlbumDetails={handleOpenAlbumDetails}
        onOpenFullPlayer={() => setShowFullPlayer(true)}
        isLibraryLoading={initialLibraryLoading}
        libraryError={libraryLoadError}
        onRetryLoad={loadInitialLibrary}
        onScrollChange={setIsScrolled}
      />
    );

    switch (currentView) {
      case 'home':
        return renderHomeView();
      case 'library':
      case 'search':
        return (
          <LibraryView
            onTrackContextMenu={handleTrackContextMenu}
            onTrackSelect={handleTrackSelect}
            selectedTrackIds={selectedTracks.map((t) => t.id)}
            onOpenTagEditor={(tracks) => setTagEditorTracks(tracks)}
            onSelectAll={handleSelectAllTracks}
            onClearSelection={handleClearSelection}
            onOpenAlbumDetails={handleOpenAlbumDetails}
            isLibraryLoading={initialLibraryLoading}
            libraryError={libraryLoadError}
            onRetryLoad={loadInitialLibrary}
            onScrollChange={setIsScrolled}
            iconRailLayout={navMode === 'iconRail' && theme !== 'neobrutalism'}
          />
        );
      case 'queue':
        return (
          <QueueView
            isLibraryLoading={initialLibraryLoading}
            libraryError={libraryLoadError}
            onRetryLoad={loadInitialLibrary}
            onScrollChange={setIsScrolled}
          />
        );

      case 'tags':
        return (
          <Suspense fallback={viewFallback}>
            <TagManagerView
              selectedTracks={selectedTracks}
              onSelectionChange={handleSelectionChange}
              onToggleTrack={handleTrackSelect}
              onOpenTagEditor={(tracks) => setTagEditorTracks(tracks)}
              onRevealFiles={handleRevealTracks}
              onCopyMetadata={handleCopyMetadata}
              onPasteMetadata={handlePasteMetadata}
              onTrackContextMenu={handleTrackContextMenu}
              onRenameTrack={handleRenameTrack}
              onMoveTracks={handleMoveTracks}
              onDeleteFiles={handleDeleteFiles}
              onRemoveTracks={handleRemoveTracks}
              onScrollChange={setIsScrolled}
            />
          </Suspense>
        );
      case 'settings':
        return (
          <Suspense fallback={viewFallback}>
            <UnifiedSettingsView onScrollChange={setIsScrolled} libraryScan={libraryScan} />
          </Suspense>
        );
      case 'album': {
        if (!albumDetails) {
          return renderHomeView();
        }
        const AlbumOverlayComponent =
          theme === 'neobrutalism' ? AlbumDetailsOverlayNeo : AlbumDetailsOverlay;
        return (
          <AlbumOverlayComponent
            album={albumDetails.album}
            artist={albumDetails.artist}
            coverArt={albumDetails.coverArt}
            tracks={albumDetails.tracks}
            onClose={handleBack}
            onPlayAlbum={handlePlayAlbum}
            onPlayTrack={handlePlayAlbumTrack}
            onTrackContextMenu={(e, track) => {
              handleTrackContextMenu(track, { x: e.clientX, y: e.clientY });
            }}
            selectedTrackIds={selectedTracks.map((t) => t.id)}
            onTrackSelect={handleTrackSelect}
            onClearSelection={handleClearSelection}
            onSelectAll={(albumTracks) => setSelectedTracks(albumTracks)}
            onOpenTagEditor={handleOpenAlbumTagEditor}
            onAddToQueue={handleAddTracksToQueue}
            onRevealInFinder={handleRevealTrackInFinder}
            onDeleteTracks={handleDeleteTracksFromAlbum}
            onShuffleAlbum={handleShuffleAlbum}
            currentlyPlayingId={currentTrack?.id}
            isPlaying={isPlaying}
            onScrollChange={setIsScrolled}
          />
        );
      }
      default:
        return renderHomeView();
    }
  }, [
    albumDetails,
    currentTrack?.id,
    currentView,
    handleAddTracksToQueue,
    handleClearSelection,
    handleCopyMetadata,
    handleDeleteFiles,
    handleDeleteTracksFromAlbum,
    handleMoveTracks,
    handleNavigate,
    handleOpenAlbumDetails,
    handleOpenAlbumTagEditor,
    handlePlayAlbum,
    handlePlayAlbumTrack,
    handleRemoveTracks,
    handleRenameTrack,
    handleRevealTrackInFinder,
    handleRevealTracks,
    handleSelectionChange,
    handleSelectAllTracks,
    handleShuffleAlbum,
    handleTrackContextMenu,
    handleTrackSelect,
    handlePasteMetadata,
    initialLibraryLoading,
    isPlaying,
    libraryScan,
    libraryLoadError,
    loadInitialLibrary,
    selectedTracks,
    theme,
  ]);

  const renderOverlayMessages = () =>
    (appError || playlistRepair) && (
      <div className="absolute top-4 left-8 right-8 z-40 flex flex-col gap-3">
        {appError && (
          <div
            className={clsx(
              'p-4 text-sm flex items-start justify-between gap-4',
              theme === 'neobrutalism'
                ? 'rounded-none border-[3px] border-black bg-[#D88274] shadow-[6px_6px_0_0_#000]'
                : 'rounded-2xl border border-red-400/40 bg-red-950/55 backdrop-blur-sm',
            )}
          >
            <div>
              <p
                className={clsx(
                  theme === 'neobrutalism'
                    ? 'font-black uppercase tracking-[0.08em] text-black'
                    : 'font-semibold text-red-100',
                )}
              >
                {appError.message}
              </p>
              {appError.detail && (
                <p
                  className={clsx(
                    'mt-1',
                    theme === 'neobrutalism' ? 'font-bold text-black' : 'text-red-200/85',
                  )}
                >
                  {appError.detail}
                </p>
              )}
            </div>
            <IconButton
              size="sm"
              variant={theme === 'neobrutalism' ? 'default' : 'ghost'}
              className={clsx(
                'shrink-0',
                theme === 'neobrutalism'
                  ? 'rounded-none border-2 border-black bg-white text-black shadow-[2px_2px_0_0_#000] hover:bg-[#E6E6E6] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none'
                  : 'text-red-100 hover:text-white',
              )}
              onClick={() => setAppError(null)}
              aria-label="Dismiss error"
            >
              <X
                className={clsx(
                  'w-4 h-4',
                  theme === 'neobrutalism' ? 'text-black' : 'text-red-100',
                )}
                strokeWidth={theme === 'neobrutalism' ? 3 : undefined}
              />
            </IconButton>
          </div>
        )}

        {playlistRepair && (
          <div
            className={clsx(
              'p-4 text-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3',
              theme === 'neobrutalism'
                ? 'rounded-none border-[3px] border-black bg-[#DAB852] shadow-[6px_6px_0_0_#000]'
                : 'rounded-2xl border border-amber-300/35 bg-amber-950/45 backdrop-blur-sm',
            )}
          >
            <div>
              <p
                className={clsx(
                  theme === 'neobrutalism'
                    ? 'font-black uppercase tracking-[0.08em] text-black'
                    : 'font-semibold text-amber-100',
                )}
              >
                Playlist data needs repair
              </p>
              <p
                className={clsx(
                  'mt-1',
                  theme === 'neobrutalism' ? 'font-bold text-black' : 'text-amber-200/85',
                )}
              >
                {playlistRepair.reason}
              </p>
              <p
                className={clsx(
                  'mt-1 text-xs',
                  theme === 'neobrutalism' ? 'font-bold text-black' : 'text-amber-200/70',
                )}
              >
                {playlistRepair.attemptedRecovery
                  ? playlistRepair.recoveredFrom
                    ? `Recovered from ${playlistRepair.recoveredFrom}.`
                    : 'Automatic recovery was attempted but no valid backup was found.'
                  : 'Automatic recovery has not run yet.'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                className={clsx(
                  theme === 'neobrutalism'
                    ? 'rounded-none border-2 border-black bg-[#A091D0] text-black font-black uppercase shadow-[4px_4px_0_0_#000] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none'
                    : 'rounded-xl',
                )}
                onClick={() => {
                  void handleRetryPlaylistLoad();
                }}
              >
                Retry load
              </Button>
              <Button
                variant="secondary"
                className={clsx(
                  theme === 'neobrutalism'
                    ? 'rounded-none border-2 border-black bg-white text-black font-black uppercase shadow-[4px_4px_0_0_#000] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none'
                    : 'rounded-xl',
                )}
                onClick={handleResetPlaylistData}
              >
                Reset playlists file
              </Button>
              <Button
                variant="secondary"
                className={clsx(
                  theme === 'neobrutalism'
                    ? 'rounded-none border-2 border-black bg-[#A4B680] text-black font-black uppercase shadow-[4px_4px_0_0_#000] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none'
                    : 'rounded-xl',
                )}
                onClick={() => {
                  void handleOpenPlaylistsDataFolder();
                }}
              >
                Open data folder
              </Button>
            </div>
          </div>
        )}


      </div>
    );

  const renderLiquidGlassLayout = () => (
    <div
      className={clsx(
        'app-shell h-screen flex flex-col w-full bg-transparent text-text-primary overflow-hidden relative',
        !reducedEffects && 'app-shell-grain',
        compactMode && 'text-[15px]',
      )}
      style={shellVars}
    >
      {reducedEffects ? (
        <div className="fixed inset-0 z-0 bg-[#07070f] pointer-events-none" />
      ) : (
        <>
          <AppShellLiquidWebGL
            heroAccent={reactivePalette.heroAccent}
            isScrolled={isScrolled}
            searchFocused={shellSearchFocused}
            pointerRef={headerPointerNormRef}
            scanBurstKey={shellScanBurstKey}
            colors={reactivePalette.liquidColors}
          />
          <HotkeysBootstrap />
        </>
      )}

      <LiquidHomeAmbientBackdrop coverUrl={homeAmbientCoverUrl} />

      <div className="flex h-full w-full overflow-hidden relative z-10">
        <Sidebar
          navMode={navMode}
          currentView={currentView}
          onNavigate={handleNavigate}
          onSearchTrigger={() => {
            setShowSearchShell(true);
            bumpSearchFocus();
          }}
          onBrowseLibrary={() => setShowSearchShell(false)}
          searchUiOpen={
            showSearchShell || searchQuery.trim().length > 0 || currentView === 'search'
          }
          theme={theme}
        />

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {(navMode === 'topNav' ||
            showSearchShell ||
            searchQuery.trim().length > 0 ||
            currentView === 'search') && (
            <TopBar
              navMode={navMode}
              currentView={currentView}
              onNavigate={(v) => {
                handleNavigate(v);
                if (v !== 'library' && v !== 'search') setShowSearchShell(false);
              }}
              searchQuery={searchQuery}
              onSearchChange={(query) => {
                setSearchQuery(query);
              }}
              isScanning={isScanning}
              scanProgress={scanProgress}
              activeProcessing={activeProcessing}
              titlebarInsetLeft={titlebarInsetLeft}
              onShuffleAll={handleShuffleAll}
              isSearching={isSearchingLibrary}
              isScrolled={isScrolled}
              heroAccent={reactivePalette.heroAccent}
              onSearchFocusChange={handleShellSearchFocusChange}
              focusSearchNonce={searchFocusNonce}
              headerPointerRef={headerPointerNormRef}
              hideBorder={!!isAlbumView}
              isTransparent={!!isAlbumView}
              canGoBack={!!albumDetails}
              onBack={handleBack}
              className={cn(
                'w-full shrink-0',
                !!isAlbumView && 'absolute top-0 left-0 right-0 z-50',
              )}
            />
          )}

          <div
            className={cn(
              'relative flex min-h-0 min-w-0 flex-1 overflow-hidden',
              !!isAlbumView && 'h-full',
            )}
          >
            {renderOverlayMessages()}
            <main className="h-full min-w-0 flex-1">
              <div className="h-full animate-fade-in">
                {currentView === 'library' || currentView === 'search' ? (
                  <LibraryView
                    onTrackContextMenu={handleTrackContextMenu}
                    onTrackSelect={handleTrackSelect}
                    selectedTrackIds={selectedTracks.map((t) => t.id)}
                    onOpenTagEditor={(tracks) => setTagEditorTracks(tracks)}
                    onSelectAll={handleSelectAllTracks}
                    onClearSelection={handleClearSelection}
                    onOpenAlbumDetails={handleOpenAlbumDetails}
                    isLibraryLoading={initialLibraryLoading}
                    libraryError={libraryLoadError}
                    onRetryLoad={loadInitialLibrary}
                    onScrollChange={setIsScrolled}
                    iconRailLayout={navMode === 'iconRail'}
                  />
                ) : (
                  currentViewContent
                )}
              </div>
            </main>
          </div>
        </div>
      </div>

      {currentView !== 'home' && currentTrack && !showFullPlayer && !miniPlayerCollapsed && (
        <MiniPlayer
          onExpand={() => setShowFullPlayer(true)}
          scheduleSleepTimer={scheduleSleepTimer}
          cancelSleepTimer={cancelSleepTimer}
          sleepDeadline={sleepDeadline}
        />
      )}

      {currentView !== 'home' && currentTrack && !showFullPlayer && miniPlayerCollapsed && (
        <PillMiniPlayer onExpand={() => setMiniPlayerCollapsed(false)} />
      )}
    </div>
  );

  const renderNeobrutalismLayout = () => (
    <div
      className={clsx(
        'app-shell min-h-[100dvh] w-full text-black overflow-hidden flex bg-transparent',
        compactMode && 'text-[15px]',
      )}
    >
      {navMode === 'iconRail' && (
        <aside className="w-20 border-r-3 border-black flex flex-col overflow-hidden shrink-0">
          <Sidebar
            navMode={navMode}
            currentView={currentView}
            onNavigate={handleNavigate}
            onSearchTrigger={bumpSearchFocus}
            onBrowseLibrary={() => {}}
            searchUiOpen={searchQuery.trim().length > 0 || currentView === 'search'}
            theme={theme}
          />
        </aside>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <TopBarNeo
          navMode={navMode}
          currentView={currentView}
          onNavigate={handleNavigate}
          focusSearchNonce={searchFocusNonce}
          searchQuery={searchQuery}
          onSearchChange={(query) => setSearchQuery(query)}
          isScanning={isScanning}
          scanProgress={scanProgress}
          activeProcessing={activeProcessing}
          titlebarInsetLeft={0}
          onShuffleAll={handleShuffleAll}
          isSearching={isSearchingLibrary}
          isScrolled={isScrolled}
        />

        <main className="flex-1 overflow-hidden relative">
          <div
            className="absolute inset-0 overflow-y-auto custom-scrollbar"
            onScroll={(e) => setIsScrolled(e.currentTarget.scrollTop > 8)}
          >
            {renderOverlayMessages()}
            <div className="main-content-view">{currentViewContent}</div>
          </div>
        </main>

        {currentTrack && !showFullPlayer && (
          <div className="h-24 border-t-2 border-black shrink-0 overflow-visible">
            <MiniPlayer
              onExpand={() => setShowFullPlayer(true)}
              scheduleSleepTimer={scheduleSleepTimer}
              cancelSleepTimer={cancelSleepTimer}
              sleepDeadline={sleepDeadline}
            />
          </div>
        )}

        {theme !== 'neobrutalism' && currentTrack && !showFullPlayer && miniPlayerCollapsed && (
          <PillMiniPlayer onExpand={() => setMiniPlayerCollapsed(false)} />
        )}
      </div>
    </div>
  );

  return (
    <GlassSystemProvider reducedEffects={reducedEffects} theme={theme}>
      <SmoothTimeProvider>
        {theme === 'neobrutalism' ? renderNeobrutalismLayout() : renderLiquidGlassLayout()}

        <Suspense fallback={null}>
          <GlobalCommandPalette
            currentView={currentView}
            onNavigate={handleNavigate}
            onShuffleAll={() => void handleShuffleAll()}
            onTogglePlayback={handleTogglePlaybackFromPalette}
            onNextTrack={handleNextTrackFromPalette}
            onPreviousTrack={handlePreviousTrackFromPalette}
            onRescanLibrary={handleRescanFromPalette}
            onOpenFullPlayer={() => setShowFullPlayer(true)}
            hasCurrentTrack={Boolean(currentTrack)}
            isPlaying={isPlaying}
            isScanning={isScanning}
            theme={theme}
          />
        </Suspense>

        {showDropOverlay && (
          <div
            className={clsx(
              'fixed inset-0 z-40 pointer-events-none',
              theme !== 'neobrutalism' && 'transition-all duration-200',
            )}
          >
            <div
              className={clsx(
                'absolute inset-0',
                theme === 'neobrutalism' ? 'bg-black/50' : 'bg-black/60 backdrop-blur-sm',
              )}
            />
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div
                className={clsx(
                  'px-8 py-6 text-center',
                  theme !== 'neobrutalism' && 'animate-fade-in-up',
                  theme === 'neobrutalism'
                    ? 'rounded-none bg-white border-[3px] border-black shadow-[8px_8px_0_0_#000] text-black'
                    : 'rounded-2xl border border-white/20 bg-white/10 text-text-primary shadow-2xl backdrop-blur-md',
                )}
              >
                <p className="text-xl font-black uppercase tracking-widest">
                  Drop audio files to import
                </p>
                <p
                  className={clsx(
                    'text-sm mt-2',
                    theme === 'neobrutalism' ? 'text-black' : 'text-text-muted',
                  )}
                >
                  We’ll scan their folders automatically
                </p>
              </div>
            </div>
          </div>
        )}

        {showFullPlayer && (
          <Suspense fallback={null}>
            <PlayerView onClose={() => setShowFullPlayer(false)} />
          </Suspense>
        )}

        {showConfetti && (
          <div className="fixed inset-0 pointer-events-none z-[999] flex items-center justify-center">
            <ConfettiExplosion
              force={0.8}
              duration={3000}
              particleCount={250}
              width={1600}
              colors={['#A091D0', '#A4B680', '#DAB852', '#D88274', '#000000', '#FFFFFF']}
            />
          </div>
        )}

        <div className="lg:hidden">
          <FloatingDock
            activeView={currentView}
            onNavigate={handleNavigate}
            onQueueToggle={() => setIsQueueOpen(true)}
          />
        </div>

        <Suspense fallback={null}>
          <QueueDrawer open={isQueueOpen} onOpenChange={setIsQueueOpen} />
        </Suspense>

        {tagEditorTracks && (
          <Suspense fallback={null}>
            <TagEditorModal
              tracks={tagEditorTracks}
              onClose={() => setTagEditorTracks(null)}
              onSave={() => {
                if (tagEditorTracks?.length) {
                  const paths = tagEditorTracks.map((t) => t.filePath);
                  refreshTracksByFilePaths(paths);
                }
              }}
            />
          </Suspense>
        )}

        <PlaylistPickerDialog
          open={showPlaylistPicker}
          trackIds={playlistPickerTrackIds}
          onClose={closePlaylistPicker}
        />

        <ContextMenu
          position={contextMenuPosition}
          items={contextMenuItems}
          onClose={() => {
            setContextMenuPosition(null);
            setContextMenuTrack(null);
          }}
        />
      </SmoothTimeProvider>

      {confirmDialog && (
        <ConfirmDialog {...confirmDialog} onCancel={() => setConfirmDialog(null)} />
      )}
      {inputDialog && <InputDialog {...inputDialog} onCancel={() => setInputDialog(null)} />}
    </GlassSystemProvider>
  );
};

export default App;

