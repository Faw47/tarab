import { clsx } from 'clsx';
import { Check } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { FloatingDock, type NavView } from '../../components/navigation';
import type { AppTheme } from '../../store/settings-store';

export const preloadGlobalCommandPalette = () =>
  import('../../components/navigation/GlobalCommandPalette').then((module) => ({
    default: module.GlobalCommandPalette,
  }));

const GlobalCommandPalette = lazy(preloadGlobalCommandPalette);
const PlayerView = lazy(() =>
  import('../../components/player/PlayerView').then((module) => ({ default: module.PlayerView })),
);

interface AppTransientSurfacesProps {
  currentView: NavView;
  theme: AppTheme;
  showDropOverlay: boolean;
  showFullPlayer: boolean;
  showScanComplete: boolean;
  hasCurrentTrack: boolean;
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
  showDropOverlay,
  showFullPlayer,
  showScanComplete,
  hasCurrentTrack,
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

  useEffect(() => {
    if (showFullPlayer) {
      fullPlayerReturnFocusRef.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('[data-collapse-player]')?.focus();
      });
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onCloseFullPlayer();
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
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
    fullPlayerReturnFocusRef.current?.focus();
    fullPlayerReturnFocusRef.current = null;
  }, [onCloseFullPlayer, showFullPlayer]);

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
              'transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-standard)]',
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
          <div data-full-player-dialog role="dialog" aria-modal="true" aria-label="Full player">
            <PlayerView onClose={onCloseFullPlayer} />
          </div>
        </Suspense>
      )}

      {showScanComplete && (
        <div
          className="fixed right-6 top-20 z-[999] flex items-center gap-2 rounded-full border border-white/15 bg-black/75 px-3 py-2 text-sm font-semibold text-white shadow-xl backdrop-blur-md motion-safe:animate-fade-in-up"
          role="status"
          aria-live="polite"
        >
          <Check className="h-4 w-4 text-emerald-300" aria-hidden="true" />
          Library scan complete
        </div>
      )}

      <div className="lg:hidden">
        <FloatingDock activeView={currentView} onNavigate={onNavigate} />
      </div>
    </>
  );
}
