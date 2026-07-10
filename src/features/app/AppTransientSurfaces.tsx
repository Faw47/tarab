import { clsx } from 'clsx';
import { lazy, Suspense } from 'react';
import ConfettiExplosion from 'react-confetti-explosion';
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
  showConfetti: boolean;
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
  showConfetti,
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
          <PlayerView onClose={onCloseFullPlayer} />
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
        <FloatingDock activeView={currentView} onNavigate={onNavigate} />
      </div>
    </>
  );
}
