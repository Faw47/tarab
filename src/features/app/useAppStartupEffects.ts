import { getCurrentWindow } from '@tauri-apps/api/window';
import { isEnabled } from '@tauri-apps/plugin-autostart';
import { useEffect, useRef } from 'react';
import type { NavView } from '../../components/navigation';
import { recordPerfBudget } from '../../lib/performance';
import { logError, reportError } from '../../lib/report-error';
import { desktopShouldStartMinimized } from '../../lib/tauri-commands';
import { useSettingsStore } from '../../store/settings-store';

const SETTINGS_HYDRATION_TIMEOUT_MS = 3000;

type PreloadCallback = () => void;

interface UseAppStartupEffectsOptions {
  currentView: NavView;
  preloadModules: PreloadCallback;
}

export function useAppStartupEffects({ currentView, preloadModules }: UseAppStartupEffectsOptions) {
  const startupLoggedRef = useRef(false);
  const autostartSyncInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const syncAutostartFromSystem = async () => {
      if (autostartSyncInFlightRef.current) return;
      autostartSyncInFlightRef.current = true;
      try {
        const enabled = await isEnabled();
        if (cancelled) return;
        const settings = useSettingsStore.getState();
        if (settings.autostartEnabled !== enabled) {
          settings.setAutostartEnabled(enabled);
        }
      } catch (error) {
        if (!cancelled) {
          reportError('Failed to read open at login setting', {
            source: 'app-startup',
            error,
          });
        }
      } finally {
        autostartSyncInFlightRef.current = false;
      }
    };

    const onFocus = () => {
      void syncAutostartFromSystem();
    };
    void syncAutostartFromSystem();
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
    };
  }, []);
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
    let cancelled = false;
    const showWindow = async () => {
      let startMinimized = false;
      try {
        startMinimized = await desktopShouldStartMinimized();
      } catch (error) {
        // If startup detection fails, show the window rather than strand the user.
        logError('Failed to read startup window state', { source: 'app-startup', error });
      }

      if (startMinimized) {
        // If the tray is disabled in persisted settings, keep a visible way to open Tarab.
        if (!useSettingsStore.persist.hasHydrated()) {
          await new Promise<void>((resolve) => {
            let finished = false;
            let unsubscribe: () => void = () => undefined;
            const finish = () => {
              if (finished) return;
              finished = true;
              clearTimeout(timeout);
              unsubscribe();
              resolve();
            };
            const timeout = setTimeout(finish, SETTINGS_HYDRATION_TIMEOUT_MS);
            unsubscribe = useSettingsStore.persist.onFinishHydration(finish);
            if (useSettingsStore.persist.hasHydrated()) finish();
          });
        }
        // Do not strand the user if persisted settings never load.
        if (
          !cancelled &&
          useSettingsStore.persist.hasHydrated() &&
          useSettingsStore.getState().desktopStatusIconEnabled
        ) {
          return;
        }
      }

      if (cancelled) return;
      await new Promise((res) => setTimeout(res, 100));
      if (!cancelled) await getCurrentWindow().show();
    };
    void showWindow().catch((error) => {
      if (!cancelled) {
        reportError('Failed to show the main window', { source: 'app-startup', error });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
}
