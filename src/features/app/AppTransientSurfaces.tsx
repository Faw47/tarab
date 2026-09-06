import { clsx } from 'clsx';
import { AnimatePresence, motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { FloatingDock, type NavView } from '../../components/navigation';
import { ACTIVE_ABOVE_FULL_PLAYER_DIALOG_SELECTOR } from '../../components/ui/dialog';
import type { AppTheme } from '../../store/settings-store';

import { preloadGlobalCommandPalette } from './preloadAppStartup';

export { preloadGlobalCommandPalette } from './preloadAppStartup';

const GlobalCommandPalette = lazy(preloadGlobalCommandPalette);
const PlayerView = lazy(() =>
  import('../../components/player/PlayerView').then((module) => ({ default: module.PlayerView })),
);

interface AppTransientSurfacesProps {
  currentView: NavView;
  theme: AppTheme;
  reducedEffects: boolean;
  showDropOverlay: boolean;
  showFullPlayer: boolean;
  showScanComplete: boolean;
  hasCurrentTrack: boolean;
  miniPlayerCollapsed: boolean;
  isPlaying: boolean;
  isScanning: boolean;
  onNavigate: (view: NavView) => void;
  onShuffleAll: () => Promise<void>;
  onTogglePlayback: () => Promise<void>;
  onNextTrack: () => Promise<void>;
  onPreviousTrack: () => Promise<void>;
  onRescanLibrary: () => Promise<void>;
  onOpenFullPlayer: () => void;
  onCloseFullPlayer: () => void;
}

export function AppTransientSurfaces({
  currentView,
  theme,
  reducedEffects,
  showDropOverlay,
  showFullPlayer,
  showScanComplete,
  hasCurrentTrack,
  miniPlayerCollapsed,
  isPlaying,
  isScanning,
  onNavigate,
  onShuffleAll,
  onTogglePlayback,
  onNextTrack,
  onPreviousTrack,
  onRescanLibrary,
  onOpenFullPlayer,
  onCloseFullPlayer,
}: AppTransientSurfacesProps) {
  const fullPlayerReturnFocusRef = useRef<HTMLElement | null>(null);

  const fullPlayerCloseRef = useRef(onCloseFullPlayer);
  fullPlayerCloseRef.current = onCloseFullPlayer;

  useEffect(() => {
    if (showFullPlayer) {
      fullPlayerReturnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const focusFrame = requestAnimationFrame(() => {
        if (document.querySelector(ACTIVE_ABOVE_FULL_PLAYER_DIALOG_SELECTOR)) return;
        document.querySelector<HTMLElement>('[data-collapse-player]')?.focus();
      });
      const handleKeyDown = (event: KeyboardEvent) => {
        const appDialogOpen = document.querySelector(ACTIVE_ABOVE_FULL_PLAYER_DIALOG_SELECTOR);
        if (appDialogOpen) {
          if (event.key === 'Escape') event.stopPropagation();
          return;
        }

        if (event.key === 'Escape') {
          event.preventDefault();
          fullPlayerCloseRef.current();
          return;
        }
        if (event.key !== 'Tab') return;
        const root = document.querySelector<HTMLElement>('[data-full-player-dialog]');
        const focusable = root?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        );
        if (!focusable?.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };
      document.addEventListener('keydown', handleKeyDown);
      return () => {
        cancelAnimationFrame(focusFrame);
        document.removeEventListener('keydown', handleKeyDown);
      };
    }
    fullPlayerReturnFocusRef.current?.focus();
    fullPlayerReturnFocusRef.current = null;
  }, [showFullPlayer]);

  return (
    <>
      <Suspense fallback={null}>
        <GlobalCommandPalette
          currentView={currentView}
          onNavigate={onNavigate}
          onShuffleAll={() => void onShuffleAll()}
          onTogglePlayback={onTogglePlayback}
          onNextTrack={onNextTrack}
          onPreviousTrack={onPreviousTrack}
          onRescanLibrary={onRescanLibrary}
          onOpenFullPlayer={onOpenFullPlayer}
          hasCurrentTrack={hasCurrentTrack}
          isPlaying={isPlaying}
          isScanning={isScanning}
          theme={theme}
        />
      </Suspense>

      {showDropOverlay && (
        <div
          className={clsx(
            'fixed inset-0 z-40 pointer-events-none',
            theme !== 'neobrutalism' &&
              !reducedEffects &&
              'transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-standard)]',
          )}
        >
          <div
            className={clsx(
              'absolute inset-0',
              theme === 'neobrutalism'
                ? 'bg-black/50'
                : clsx('bg-black/60', !reducedEffects && 'backdrop-blur-sm'),
            )}
          />
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div
              className={clsx(
                'px-8 py-6 text-center',
                theme !== 'neobrutalism' && !reducedEffects && 'animate-fade-in-up',
                theme === 'neobrutalism'
                  ? 'rounded-none bg-white border-[3px] border-black shadow-[8px_8px_0_0_var(--neo-ink)] text-black'
                  : clsx(
                      'rounded-2xl border border-white/20 bg-white/10 text-text-primary shadow-2xl',
                      !reducedEffects && 'backdrop-blur-md',
                    ),
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

      <AnimatePresence initial={false}>
        {showFullPlayer && (
          <Suspense fallback={null}>
            <motion.div
              key="full-player"
              data-full-player-dialog
              role="dialog"
              aria-modal="true"
              aria-label="Full player"
              initial={reducedEffects ? false : { opacity: 0, y: '3%' }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedEffects ? undefined : { opacity: 0, y: '3%' }}
              transition={
                reducedEffects ? { duration: 0 } : { duration: 0.32, ease: [0.32, 0.72, 0, 1] }
              }
              className="fixed inset-0 z-[var(--layer-full-player)]"
            >
              <PlayerView onClose={onCloseFullPlayer} />
            </motion.div>
          </Suspense>
        )}
      </AnimatePresence>

      <AnimatePresence initial={false}>
        {showScanComplete && (
          <motion.div
            key="scan-complete"
            initial={reducedEffects ? false : { opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedEffects ? undefined : { opacity: 0, y: -12 }}
            transition={
              reducedEffects ? { duration: 0 } : { duration: 0.24, ease: [0.32, 0.72, 0, 1] }
            }
            className={clsx(
              'fixed right-6 top-20 z-[999] flex items-center gap-2 rounded-full border border-white/15 bg-black/75 px-3 py-2 text-sm font-semibold text-white shadow-xl',
              !reducedEffects && 'backdrop-blur-md',
            )}
            role="status"
            aria-live="polite"
          >
            <Check className="h-4 w-4 text-[var(--state-success-ink)]" aria-hidden="true" />
            Library scan complete
          </motion.div>
        )}
      </AnimatePresence>

      <div className="lg:hidden">
        <FloatingDock
          activeView={currentView}
          onNavigate={onNavigate}
          avoidBottomPlayer={
            hasCurrentTrack &&
            !showFullPlayer &&
            !miniPlayerCollapsed &&
            (theme === 'neobrutalism' || currentView !== 'home')
          }
        />
      </div>
    </>
  );
}
