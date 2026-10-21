import { clsx } from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import { type CSSProperties, lazy, type ReactNode, type RefObject, Suspense } from 'react';
import { type NavView, Sidebar } from '../../components/navigation';
import { type ProcessingTask, TopBar } from '../../components/navigation/TopBar';
import { TopBarNeo } from '../../components/navigation/TopBarNeo';
import { MiniPlayer } from '../../components/player/MiniPlayer';
import { PillMiniPlayer } from '../../components/player/PillMiniPlayer';
import { LiquidHomeAmbientBackdrop } from '../../components/shell/LiquidHomeAmbientBackdrop';
import { Button } from '../../components/ui/button';
import type { ReactivePalette } from '../../hooks/useReactivePalette';
import { cn } from '../../lib/utils';
import type { AppTheme, NavMode } from '../../store/settings-store';
import type { Track } from '../../types';

const AppShellLiquidWebGL = lazy(() =>
  import('../../components/shell/AppShellLiquidWebGL').then((module) => ({
    default: module.AppShellLiquidWebGL,
  })),
);

// MotionConfig's reducedMotion only drops transform and layout animations; the player bar animates
// height and opacity, so Reduced Effects (or the OS setting) makes those instant here.
const INSTANT = { duration: 0 } as const;
const BAR_TRANSITION = { duration: 0.25, ease: [0.32, 0.72, 0, 1] } as const;

export interface AppLayoutsProps {
  theme: AppTheme;
  navMode: NavMode;
  currentView: NavView;
  currentViewContent: ReactNode;
  overlayMessages: ReactNode;
  compactMode: boolean;
  reducedEffects: boolean;
  backgroundEnabled: boolean;
  shellVars: CSSProperties;
  palette: ReactivePalette;
  isScrolled: boolean;
  searchFocused: boolean;
  headerPointerRef: RefObject<{ x: number; y: number } | null>;
  shellScanBurstKey: number;
  homeAmbientCoverUrl: string | null;
  showSearchShell: boolean;
  searchQuery: string;
  isScanning: boolean;
  scanProgress: number;
  activeProcessing?: ProcessingTask;
  titlebarInsetLeft: number;
  isSearching: boolean;
  focusSearchNonce: number;
  isAlbumView: boolean;
  canGoBack: boolean;
  currentTrack: Track | null;
  showFullPlayer: boolean;
  miniPlayerCollapsed: boolean;
  sleepDeadline: number | null;
  onNavigate: (view: NavView) => void;
  onOpenSearchShell: () => void;
  onFocusSearch: () => void;
  onBrowseLibrary: () => void;
  onSearchChange: (query: string) => void;
  onSearchFocusChange: (focused: boolean) => void;
  onShuffleAll: () => void | Promise<void>;
  onBack: () => void;
  onScrollChange: (scrolled: boolean) => void;
  onOpenFullPlayer: () => void;
  onExpandCollapsedPlayer: () => void;
  scheduleSleepTimer: (minutes: number) => void;
  cancelSleepTimer: () => void;
}

export function AppLayouts({
  theme,
  navMode,
  currentView,
  currentViewContent,
  overlayMessages,
  compactMode,
  reducedEffects,
  backgroundEnabled,
  shellVars,
  palette,
  isScrolled,
  searchFocused,
  headerPointerRef,
  shellScanBurstKey,
  homeAmbientCoverUrl,
  showSearchShell,
  searchQuery,
  isScanning,
  scanProgress,
  activeProcessing,
  titlebarInsetLeft,
  isSearching,
  focusSearchNonce,
  isAlbumView,
  canGoBack,
  currentTrack,
  showFullPlayer,
  miniPlayerCollapsed,
  sleepDeadline,
  onNavigate,
  onOpenSearchShell,
  onFocusSearch,
  onBrowseLibrary,
  onSearchChange,
  onSearchFocusChange,
  onShuffleAll,
  onBack,
  onScrollChange,
  onOpenFullPlayer,
  onExpandCollapsedPlayer,
  scheduleSleepTimer,
  cancelSleepTimer,
}: AppLayoutsProps) {
  if (theme === 'neobrutalism') {
    return (
      <div
        data-compact={compactMode || undefined}
        className={clsx(
          'app-shell min-h-[100dvh] w-full text-black overflow-hidden flex bg-transparent',
          compactMode && 'text-[15px]',
        )}
      >
        {navMode === 'iconRail' && (
          // Sidebar hides itself below md; the bordered wrapper must too, or it leaves an empty strip.
          <aside className="hidden w-20 shrink-0 flex-col overflow-hidden border-r-3 border-black md:flex">
            <Sidebar
              navMode={navMode}
              currentView={currentView}
              onNavigate={onNavigate}
              onSearchTrigger={onFocusSearch}
              onBrowseLibrary={onBrowseLibrary}
              searchUiOpen={searchQuery.trim().length > 0 || currentView === 'search'}
              theme={theme}
            />
          </aside>
        )}

        <div className="flex-1 flex flex-col min-w-0">
          <TopBarNeo
            navMode={navMode}
            currentView={currentView}
            onNavigate={onNavigate}
            focusSearchNonce={focusSearchNonce}
            searchQuery={searchQuery}
            onSearchChange={onSearchChange}
            isScanning={isScanning}
            scanProgress={scanProgress}
            activeProcessing={activeProcessing}
            titlebarInsetLeft={0}
            onShuffleAll={onShuffleAll}
            isSearching={isSearching}
            isScrolled={isScrolled}
            canGoBack={canGoBack}
            onBack={onBack}
          />

          <main className="flex-1 overflow-hidden relative">
            {/* Outside the scroll container so the banner stays in view while the page scrolls. */}
            {overlayMessages}
            <div
              className="absolute inset-0 overflow-y-auto custom-scrollbar"
              onScroll={(event) => onScrollChange(event.currentTarget.scrollTop > 8)}
            >
              <div key={currentView} className="main-content-view">
                {currentViewContent}
              </div>
            </div>
          </main>

          <AnimatePresence mode="popLayout">
            {currentTrack && !showFullPlayer && (
              <motion.div
                key="neo-mini-player"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: '6rem', opacity: 1 }} // h-24 = 6rem
                exit={{ height: 0, opacity: 0 }}
                transition={reducedEffects ? INSTANT : BAR_TRANSITION}
                className="border-t-2 border-black shrink-0 overflow-visible"
              >
                <MiniPlayer
                  onExpand={onOpenFullPlayer}
                  scheduleSleepTimer={scheduleSleepTimer}
                  cancelSleepTimer={cancelSleepTimer}
                  sleepDeadline={sleepDeadline}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  const searchUiOpen = showSearchShell || searchQuery.trim().length > 0 || currentView === 'search';

  return (
    <div
      data-compact={compactMode || undefined}
      className={clsx(
        'app-shell h-screen flex flex-col w-full bg-transparent text-text-primary overflow-hidden relative',
        !reducedEffects && 'app-shell-grain',
        compactMode && 'text-[15px]',
      )}
      style={shellVars}
    >
      {reducedEffects || !backgroundEnabled ? (
        <div className="fixed inset-0 z-0 bg-[#07070f] pointer-events-none" />
      ) : (
        <Suspense fallback={<div className="fixed inset-0 z-0 bg-[#07070f] pointer-events-none" />}>
          <AppShellLiquidWebGL
            heroAccent={palette.heroAccent}
            isScrolled={isScrolled}
            searchFocused={searchFocused}
            pointerRef={headerPointerRef}
            scanBurstKey={shellScanBurstKey}
            colors={palette.liquidColors}
          />
        </Suspense>
      )}

      {backgroundEnabled ? (
        <LiquidHomeAmbientBackdrop coverUrl={homeAmbientCoverUrl} overShell={!reducedEffects} />
      ) : null}

      <div className="flex h-full w-full overflow-hidden relative z-10">
        <Sidebar
          navMode={navMode}
          currentView={currentView}
          onNavigate={onNavigate}
          onSearchTrigger={onOpenSearchShell}
          onBrowseLibrary={onBrowseLibrary}
          searchUiOpen={searchUiOpen}
          theme={theme}
        />

        {/* relative: the album view's overlaid header and title strip span this column, not the rail. */}
        <div className="relative flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* In icon-rail mode the top bar appears only while searching; this strip keeps a window
              drag region and Back available the rest of the time (FE-08). */}
          {navMode !== 'topNav' && !searchUiOpen && (
            <div
              data-tauri-drag-region
              data-testid="rail-title-strip"
              className={cn(
                'z-50 flex shrink-0 items-center',
                // Album view: only the slot the album's sticky header leaves for Back (px-6,
                // 40 px, vertically centred in h-16/h-20), so the strip covers none of its
                // controls or the scroll area.
                isAlbumView ? 'absolute top-0 left-0 h-16 w-[4.5rem] md:h-20' : 'h-12 w-full pr-3',
              )}
              style={{ paddingLeft: isAlbumView ? 24 : Math.max(12, titlebarInsetLeft) }}
            >
              {canGoBack ? (
                <Button
                  onClick={onBack}
                  className={cn(
                    'rounded-full bg-black/20 shadow-md',
                    isAlbumView ? 'h-10 w-10' : 'h-9 w-9',
                  )}
                  contentClassName="flex items-center justify-center p-0"
                  aria-label="Go back"
                  title="Back"
                  reducedEffects={reducedEffects}
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
              ) : null}
            </div>
          )}

          {(navMode === 'topNav' || searchUiOpen) && (
            <TopBar
              navMode={navMode}
              currentView={currentView}
              onNavigate={onNavigate}
              searchQuery={searchQuery}
              onSearchChange={onSearchChange}
              isScanning={isScanning}
              scanProgress={scanProgress}
              activeProcessing={activeProcessing}
              titlebarInsetLeft={titlebarInsetLeft}
              onShuffleAll={onShuffleAll}
              isSearching={isSearching}
              isScrolled={isScrolled}
              heroAccent={palette.heroAccent}
              onSearchFocusChange={onSearchFocusChange}
              focusSearchNonce={focusSearchNonce}
              headerPointerRef={headerPointerRef}
              hideBorder={isAlbumView}
              isTransparent={isAlbumView}
              canGoBack={canGoBack}
              onBack={onBack}
              className={cn('w-full shrink-0', isAlbumView && 'absolute top-0 left-0 right-0 z-50')}
            />
          )}

          <div
            className={cn(
              'relative flex min-h-0 min-w-0 flex-1 overflow-hidden',
              isAlbumView && 'h-full',
            )}
          >
            {overlayMessages}
            <main className="h-full min-w-0 flex-1">
              <div
                key={currentView}
                className={clsx('h-full', !reducedEffects && 'animate-fade-in')}
              >
                {currentViewContent}
              </div>
            </main>
          </div>
        </div>
      </div>

      <AnimatePresence mode="popLayout">
        {currentView !== 'home' && currentTrack && !showFullPlayer && !miniPlayerCollapsed && (
          <motion.div
            key="mini-player"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={reducedEffects ? INSTANT : BAR_TRANSITION}
            className="shrink-0 overflow-hidden"
          >
            <MiniPlayer
              onExpand={onOpenFullPlayer}
              scheduleSleepTimer={scheduleSleepTimer}
              cancelSleepTimer={cancelSleepTimer}
              sleepDeadline={sleepDeadline}
            />
          </motion.div>
        )}

        {currentView !== 'home' && currentTrack && !showFullPlayer && miniPlayerCollapsed && (
          <motion.div
            key="pill-player"
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 20, opacity: 0, transition: reducedEffects ? INSTANT : { duration: 0.15 } }}
            transition={reducedEffects ? INSTANT : { ...BAR_TRANSITION, delay: 0.1 }}
            className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 pointer-events-auto"
          >
            <PillMiniPlayer onExpand={onExpandCollapsedPlayer} reducedEffects={reducedEffects} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
