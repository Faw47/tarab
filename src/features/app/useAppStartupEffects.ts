import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect, useRef } from 'react';
import type { NavView } from '../../components/navigation';
import { recordPerfBudget } from '../../lib/performance';
import { reportError } from '../../lib/report-error';

type PreloadCallback = () => void;

interface UseAppStartupEffectsOptions {
  currentView: NavView;
  preloadModules: PreloadCallback;
}

export function useAppStartupEffects({ currentView, preloadModules }: UseAppStartupEffectsOptions) {
  const startupLoggedRef = useRef(false);
  const firstLibraryRenderRef = useRef(false);

  useEffect(() => {
    type IdleWindow = Window & {
      requestIdleCallback?: (callback: () => void) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const idleWindow = window as IdleWindow;
    if (idleWindow.requestIdleCallback) {
      const id = idleWindow.requestIdleCallback(preloadModules);
      return () => idleWindow.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(preloadModules, 1200);
    return () => window.clearTimeout(id);
  }, [preloadModules]);

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

  useEffect(() => {
    const showWindow = async () => {
      await new Promise((res) => setTimeout(res, 100));
      await getCurrentWindow().show();
    };
    void showWindow().catch((error) => {
      reportError('Failed to show the main window', { source: 'app-startup', error });
    });
  }, []);
}
