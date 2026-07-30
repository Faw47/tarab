import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { NavView } from './components/navigation';
import { ConfirmDialog, type ConfirmDialogProps } from './components/ui/ConfirmDialog';

// Components

import { useQueryClient } from '@tanstack/react-query';
import { GlassSystemProvider, usePrefersReducedMotion } from './components/ui/liquid-glass';
import { SmoothTimeProvider } from './contexts/smooth-time';
import { AppDialogHost } from './features/app/AppDialogHost';
import { AppLayouts } from './features/app/AppLayouts';
import { AppOverlayMessages } from './features/app/AppOverlayMessages';
import {
  AppTransientSurfaces,
  preloadGlobalCommandPalette,
} from './features/app/AppTransientSurfaces';
import { AppViewRenderer } from './features/app/AppViewRenderer';
import { useAppCommandActions } from './features/app/useAppCommandActions';
import { useAppErrorEvent } from './features/app/useAppErrorEvent';
import { useAppSearchShell } from './features/app/useAppSearchShell';
import { useAppSessionPersistence } from './features/app/useAppSessionPersistence';
import { useAppShellPalette } from './features/app/useAppShellPalette';
import { useAppStartupEffects } from './features/app/useAppStartupEffects';
import { useCacheMaintenance } from './features/app/useCacheMaintenance';
import { useCurrentTrackLyrics } from './features/app/useCurrentTrackLyrics';
import { useInitialLibraryBootstrap } from './features/app/useInitialLibraryBootstrap';
import { useLaunchFileIntents } from './features/app/useLaunchFileIntents';
import { useLibraryRootSync } from './features/app/useLibraryRootSync';
import { useNativeMenuActions } from './features/app/useNativeMenuActions';
import { usePlaybackPositionEvents } from './features/app/usePlaybackPositionEvents';
import { usePlaybackSettingsSync } from './features/app/usePlaybackSettingsSync';
import { usePlayerSessionRestore } from './features/app/usePlayerSessionRestore';
import { usePlaylistRepair } from './features/app/usePlaylistRepair';
import { useScanCompletionFeedback } from './features/app/useScanCompletionFeedback';
import { useSleepTimer } from './features/app/useSleepTimer';
import { useTrackOperations } from './features/app/useTrackOperations';
import { useTrackSelection } from './features/app/useTrackSelection';
import { useViewRouter } from './features/app/useViewRouter';
import { useDroppedAudioImport } from './features/library/useDroppedAudioImport';
import { useAlbumActions } from './hooks/useAlbumActions';
import { useContextMenuBuilder } from './hooks/useContextMenuBuilder';
import { useCoverArtPrefetching } from './hooks/useCoverArtPrefetching';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
// Utils
import { useRenderLog } from './lib/performance';
import { reportError } from './lib/report-error';
import { generateCoverArtHashes } from './lib/tauri-commands';
import { refreshTracksByFilePaths } from './lib/track-refresh';
import { useLibraryStore } from './store/library-store';
// Stores
import { usePlayerStore } from './store/player-store';
import { useSettingsStore } from './store/settings-store';

// Types
import type { Track } from './types';

const loadTagEditorModal = () =>
  import('./components/tageditor/TagEditorModal').then((mod) => ({ default: mod.TagEditorModal }));

import { useLibraryScan } from './components/settings/useLibraryScan';
import { useDeepLinkBridge } from './features/app/useDeepLinkBridge';
import { useDesktopIntegration } from './features/app/useDesktopIntegration';
import { usePlaybackLifecycle } from './features/app/usePlaybackLifecycle';
import { useSingleInstanceBridge } from './features/app/useSingleInstanceBridge';
import { HotkeysBootstrap } from './features/hotkeys/HotkeysBootstrap';
import { useGlobalShortcutsRegistration } from './features/hotkeys/useGlobalShortcutsRegistration';
import { useLibraryData } from './features/library/useLibraryData';

const App = () => {
  useRenderLog('App');
  // Setup lifecycle listeners
  useSingleInstanceBridge();
  useDesktopIntegration();

  // Navigation
  const {
    currentView,
    albumDetails,
    canGoBack,
    navigate,
    replace: replaceView,
    goBack,
    setAlbumDetailsForCurrentView: setAlbumDetails,
  } = useViewRouter('home');

  const preloadStartupModules = useCallback(() => {
    void Promise.allSettled([loadTagEditorModal(), preloadGlobalCommandPalette()]).then(
      (results) => {
        for (const result of results) {
          if (result.status === 'rejected') {
            reportError('Optional startup module preload failed', {
              source: 'app-startup',
              error: result.reason,
            });
          }
        }
      },
    );
  }, []);

  useAppStartupEffects({ currentView, preloadModules: preloadStartupModules });

  useGlobalShortcutsRegistration();

  const [isScrolled, setIsScrolled] = useState(false);
  const [showFullPlayer, setShowFullPlayer] = useState(false);

  const { appError, setAppError } = useAppErrorEvent();

  // Tag editor

  const [tagEditorTracks, setTagEditorTracks] = useState<Track[] | null>(null);

  // Custom dialog state (replaces browser confirm/prompt)
  const [confirmDialog, setConfirmDialog] = useState<Omit<ConfirmDialogProps, 'onCancel'> | null>(
    null,
  );
  const headerPointerNormRef = useRef<{ x: number; y: number } | null>(null);
  // Settings modal removed - now using unified settings view

  // Player state (single subscription to avoid unnecessary re-renders)
  const {
    currentTrack,
    isPlaying,
    setIsPlaying,
    // playPrevious now read via getState() in handlers
    addToQueue,
  } = usePlayerStore(
    useShallow((s) => ({
      currentTrack: s.currentTrack,
      isPlaying: s.isPlaying,
      setIsPlaying: s.setIsPlaying,
      // currentTime removed to avoid re-renders
      // playPrevious now read via getState() in handlers
      addToQueue: s.addToQueue,
      // duration: s.duration, // Removed
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
    selectedTracks,
    setSelectedTracks,
    contextMenuPosition,
    setContextMenuPosition,
    contextMenuTrack,
    setContextMenuTrack,
    showPlaylistPicker,
    playlistPickerTrackIds,
    handleTrackContextMenu,
    handleTrackSelect,
    handleSelectAllTracks,
    handleClearSelection,
    handleSelectionChange,
    openPlaylistPicker,
    closePlaylistPicker,
    closeContextMenu,
    handleRevealInLibrary,
  } = useTrackSelection({ albumDetails, libraryTracks, navigate, setSearchQuery });

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

  const { shellScanBurstKey, showScanComplete } = useScanCompletionFeedback();
  const { sleepDeadline, scheduleSleepTimer, cancelSleepTimer } = useSleepTimer({ setIsPlaying });

  const queryClient = useQueryClient();

  const {
    playlistRepair,
    handleRetryPlaylistLoad,
    handleResetPlaylistData,
    handleOpenPlaylistsDataFolder,
  } = usePlaylistRepair({ queryClient, setConfirmDialog });
  const libraryScan = useLibraryScan();
  const {
    compactMode,
    reducedEffects,
    backgroundEnabled,
    downloadArtwork,
    followSymlinks,
    libraryFolders,
    miniPlayerCollapsed,
    setLibraryFolders,
    setMiniPlayerCollapsed,
    navMode,
    theme,
    autoLyrics,
  } = useSettingsStore(
    useShallow((s) => ({
      compactMode: s.compactMode,
      reducedEffects: s.reducedEffects,
      backgroundEnabled: s.backgroundEnabled,
      downloadArtwork: s.downloadArtwork,
      followSymlinks: s.followSymlinks,
      libraryFolders: s.libraryFolders,
      miniPlayerCollapsed: s.miniPlayerCollapsed,
      setLibraryFolders: s.setLibraryFolders,
      setMiniPlayerCollapsed: s.setMiniPlayerCollapsed,
      navMode: s.navMode,
      theme: s.theme,
      autoLyrics: s.autoLyrics,
    })),
  );
  const systemReducedMotion = usePrefersReducedMotion();
  const effectiveReducedEffects = reducedEffects || systemReducedMotion;
  const {
    showSearchShell,
    searchFocusNonce,
    shellSearchFocused,
    focusSearch,
    openSearchShell,
    closeSearchShell,
    openGlobalSearch,
    handleSearchFocusChange,
  } = useAppSearchShell({ navigate, navMode, searchQuery });
  const handleDeepLinkSearch = useCallback(
    (query: string) => {
      setSearchQuery(query);
      openGlobalSearch();
    },
    [openGlobalSearch, setSearchQuery],
  );
  useDeepLinkBridge({ onSearch: handleDeepLinkSearch });
  const { showDropOverlay } = useDroppedAudioImport({
    downloadArtwork,
    followSymlinks,
    libraryFolders,
    queryClient,
    setIsScanning,
    setScanProgress,
    setTrackCount,
    setTracks,
    startProcessing,
    updateProcessing,
    finishProcessing,
  });
  const launchFileDialog = useLaunchFileIntents({
    scanFolder: libraryScan.scanFolder,
    setLibraryFolders,
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const {
    isAlbumView,
    homeAmbientCoverUrl,
    palette: reactivePalette,
    shellVars,
  } = useAppShellPalette({
    currentTrack,
    currentView,
    albumDetails,
  });
  const activeProcessing = processingTasks[0];
  const isMac = useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    return (
      /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
      // @ts-expect-error
      navigator.userAgentData?.platform === 'macOS'
    );
  }, []);
  // Reserved for future layout adjustments
  // const _titlebarInsetTop = isMac ? 28 : 0; // macOS traffic light vertical space
  const titlebarInsetLeft = isMac ? 80 : 0; // macOS overlay traffic lights + breathing room

  const { prefetchCoverArt } = useCoverArtPrefetching(
    downloadArtwork,
    generateCoverArtHashes,
    applyCoverArtHashes,
  );
  useLibraryRootSync({
    libraryFolders,
    libraryTracks,
    prefetchCoverArt,
    setLibraryFolders,
  });

  const { initialLibraryLoading, libraryLoadError, loadInitialLibrary } =
    useInitialLibraryBootstrap({
      queryClient,
      setTrackCount,
      setTracks,
    });

  usePlayerSessionRestore({ replaceView });

  const { scheduleSessionSave, lastSavedPositionRef, lastSessionSaveRef } =
    useAppSessionPersistence({ currentView, albumDetails });

  useCurrentTrackLyrics(autoLyrics);
  usePlaybackPositionEvents({
    scheduleSessionSave,
    lastSavedPositionRef,
    lastSessionSaveRef,
  });
  usePlaybackSettingsSync();
  useCacheMaintenance();
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
    canGoBack,
    onBack: goBack,
  });

  const openAlbumDetails = useCallback(
    (details: NonNullable<typeof albumDetails>) => {
      navigate('album', { albumDetails: details });
    },
    [navigate],
  );

  const { handleOpenAlbumDetails, handlePlayAlbum, handlePlayAlbumTrack, handleShuffleAlbum } =
    useAlbumActions({
      albumDetails,
      setShowFullPlayer,
      openAlbumDetails,
    });

  // Navigation
  const handleNavigate = useCallback(
    (view: NavView) => {
      navigate(view);
      setSelectedTracks([]);
      setIsScrolled(false);
      if (view !== 'library' && view !== 'search') {
        closeSearchShell();
      }
    },
    [closeSearchShell, navigate],
  );

  useNativeMenuActions({
    navigate: handleNavigate,
    openSearch: openSearchShell,
    setFullPlayerVisible: setShowFullPlayer,
    libraryFolders,
    setLibraryFolders,
    scanFolder: libraryScan.scanFolder,
  });

  const handleBack = useCallback(() => {
    goBack();
  }, [goBack]);

  const {
    handleShuffleAll,
    handleTogglePlayback: handleTogglePlaybackFromPalette,
    handleNextTrack: handleNextTrackFromPalette,
    handlePreviousTrack: handlePreviousTrackFromPalette,
    handleRescan: handleRescanFromPalette,
    handleOpenTagEditor: handleOpenAlbumTagEditor,
    handleAddTracksToQueue,
    handleRevealTrack: handleRevealTrackInFinder,
    handleRevealTracks,
  } = useAppCommandActions({
    libraryTracks,
    totalTracks,
    isScanning,
    rescanAll: libraryScan.rescanAll,
    addToQueue,
    openTagEditor: setTagEditorTracks,
  });

  const {
    handleRemoveTracks,
    handleDeleteFiles,
    handleRenameTrack,
    handleMoveTracks,
    handleCopyMetadata,
    handlePasteMetadata,
    applyTrackRatings,
  } = useTrackOperations({
    queryClient,
    libraryTracks,
    albumDetails,
    setAlbumDetails,
    setTracks,
    setTrackCount,
    setSelectedTracks,
    setTagEditorTracks,
    setContextMenuTrack,
    setContextMenuPosition,
    setConfirmDialog,
    handleClearSelection,
  });

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
      replaceView('home');
    }
  }, [albumDetails, currentView, replaceView]);

  const currentViewContent = (
    <AppViewRenderer
      currentView={currentView}
      theme={theme}
      navMode={navMode}
      albumDetails={albumDetails}
      currentTrackId={currentTrack?.id}
      isPlaying={isPlaying}
      selectedTracks={selectedTracks}
      initialLibraryLoading={initialLibraryLoading}
      libraryLoadError={libraryLoadError}
      libraryScan={libraryScan}
      onNavigate={handleNavigate}
      onBack={handleBack}
      onOpenAlbumDetails={handleOpenAlbumDetails}
      onOpenFullPlayer={() => setShowFullPlayer(true)}
      onRetryLoad={loadInitialLibrary}
      onScrollChange={setIsScrolled}
      onTrackContextMenu={handleTrackContextMenu}
      onTrackSelect={handleTrackSelect}
      onSelectionChange={handleSelectionChange}
      onSelectAllTracks={handleSelectAllTracks}
      onClearSelection={handleClearSelection}
      onSetSelectedTracks={setSelectedTracks}
      onOpenTagEditor={setTagEditorTracks}
      onOpenAlbumTagEditor={handleOpenAlbumTagEditor}
      onRevealTracks={handleRevealTracks}
      onCopyMetadata={handleCopyMetadata}
      onPasteMetadata={handlePasteMetadata}
      onRenameTrack={handleRenameTrack}
      onMoveTracks={handleMoveTracks}
      onDeleteFiles={handleDeleteFiles}
      onRemoveTracks={handleRemoveTracks}
      onRevealTrackInFinder={handleRevealTrackInFinder}
      onAddTracksToQueue={handleAddTracksToQueue}
      onPlayAlbum={handlePlayAlbum}
      onPlayAlbumTrack={handlePlayAlbumTrack}
      onShuffleAlbum={handleShuffleAlbum}
    />
  );

  const overlayMessages = (
    <AppOverlayMessages
      appError={appError}
      playlistRepair={playlistRepair}
      theme={theme}
      onDismissError={() => setAppError(null)}
      onRetryPlaylistLoad={() => void handleRetryPlaylistLoad()}
      onResetPlaylistData={handleResetPlaylistData}
      onOpenPlaylistsDataFolder={() => void handleOpenPlaylistsDataFolder()}
    />
  );

  const appLayout = (
    <AppLayouts
      theme={theme}
      navMode={navMode}
      currentView={currentView}
      currentViewContent={currentViewContent}
      overlayMessages={overlayMessages}
      compactMode={compactMode}
      reducedEffects={effectiveReducedEffects}
      backgroundEnabled={backgroundEnabled}
      shellVars={shellVars}
      palette={reactivePalette}
      isScrolled={isScrolled}
      searchFocused={shellSearchFocused}
      headerPointerRef={headerPointerNormRef}
      shellScanBurstKey={shellScanBurstKey}
      homeAmbientCoverUrl={homeAmbientCoverUrl}
      showSearchShell={showSearchShell}
      searchQuery={searchQuery}
      isScanning={isScanning}
      scanProgress={scanProgress}
      activeProcessing={activeProcessing}
      titlebarInsetLeft={titlebarInsetLeft}
      isSearching={isSearchingLibrary}
      focusSearchNonce={searchFocusNonce}
      isAlbumView={isAlbumView}
      canGoBack={canGoBack}
      currentTrack={currentTrack}
      showFullPlayer={showFullPlayer}
      miniPlayerCollapsed={miniPlayerCollapsed}
      sleepDeadline={sleepDeadline}
      onNavigate={handleNavigate}
      onOpenSearchShell={openSearchShell}
      onFocusSearch={focusSearch}
      onBrowseLibrary={closeSearchShell}
      onSearchChange={setSearchQuery}
      onSearchFocusChange={handleSearchFocusChange}
      onShuffleAll={handleShuffleAll}
      onBack={handleBack}
      onScrollChange={setIsScrolled}
      onOpenFullPlayer={() => setShowFullPlayer(true)}
      onExpandCollapsedPlayer={() => setMiniPlayerCollapsed(false)}
      scheduleSleepTimer={scheduleSleepTimer}
      cancelSleepTimer={cancelSleepTimer}
    />
  );
  return (
    <GlassSystemProvider reducedEffects={effectiveReducedEffects} theme={theme}>
      <SmoothTimeProvider>
        <HotkeysBootstrap onSearch={openGlobalSearch} />
        {appLayout}

        <AppTransientSurfaces
          currentView={currentView}
          theme={theme}
          showDropOverlay={showDropOverlay}
          showFullPlayer={showFullPlayer}
          showScanComplete={showScanComplete}
          hasCurrentTrack={Boolean(currentTrack)}
          isPlaying={isPlaying}
          isScanning={isScanning}
          onNavigate={handleNavigate}
          onShuffleAll={handleShuffleAll}
          onTogglePlayback={handleTogglePlaybackFromPalette}
          onNextTrack={handleNextTrackFromPalette}
          onPreviousTrack={handlePreviousTrackFromPalette}
          onRescanLibrary={handleRescanFromPalette}
          onOpenFullPlayer={() => setShowFullPlayer(true)}
          onCloseFullPlayer={() => setShowFullPlayer(false)}
        />
        <AppDialogHost
          tagEditorTracks={tagEditorTracks}
          onCloseTagEditor={() => setTagEditorTracks(null)}
          onSaveTagEditor={() => {
            if (tagEditorTracks?.length) {
              const paths = tagEditorTracks.map((t) => t.filePath);
              refreshTracksByFilePaths(paths);
            }
          }}
          playlistPickerOpen={showPlaylistPicker}
          playlistPickerTrackIds={playlistPickerTrackIds}
          onClosePlaylistPicker={closePlaylistPicker}
          contextMenuPosition={contextMenuPosition}
          contextMenuItems={contextMenuItems}
          onCloseContextMenu={closeContextMenu}
          confirmDialog={confirmDialog}
          onCancelConfirmDialog={() => setConfirmDialog(null)}
        />
        {launchFileDialog ? <ConfirmDialog {...launchFileDialog} /> : null}
      </SmoothTimeProvider>
    </GlassSystemProvider>
  );
};

export default App;
