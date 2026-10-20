import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { useEffect } from 'react';
import { reportError } from '../../lib/report-error';
import { useSettingsStore } from '../../store/settings-store';

/** The OS owns login registration; app-wide observation starts after settings hydration. */
export function useAutostartIntegration() {
  useEffect(() => {
    let cancelled = false;
    let started = false;
    let readingOs = false;
    let unsubscribe = () => {};
    let pending = Promise.resolve();

    const updateFromOs = (enabled: boolean) => {
      if (cancelled) return;
      readingOs = true;
      try {
        if (useSettingsStore.getState().autostartEnabled !== enabled) {
          useSettingsStore.getState().setAutostartEnabled(enabled);
        }
      } finally {
        readingOs = false;
      }
    };

    const readOs = async () => {
      try {
        updateFromOs(await isEnabled());
      } catch (error) {
        if (!cancelled) {
          reportError('Failed to read open at login setting', { source: 'app-autostart', error });
        }
      }
    };

    const enqueue = (operation: () => Promise<void>) => {
      pending = pending.then(async () => {
        if (!cancelled) await operation();
      });
    };

    const refresh = () => {
      if (started) enqueue(readOs);
    };

    const start = () => {
      if (started || cancelled) return;
      started = true;
      enqueue(async () => {
        await readOs();
        if (cancelled) return;
        unsubscribe = useSettingsStore.subscribe((state, previous) => {
          if (readingOs || state.autostartEnabled === previous.autostartEnabled) return;
          const enabled = state.autostartEnabled;
          enqueue(async () => {
            try {
              if (enabled) await enable();
              else await disable();
            } catch (error) {
              await readOs();
              if (!cancelled) {
                reportError('Failed to sync open at login', { source: 'app-autostart', error });
              }
            }
          });
        });
      });
    };

    const stopHydration = useSettingsStore.persist.onFinishHydration(start);
    if (useSettingsStore.persist.hasHydrated()) start();
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      stopHydration();
      unsubscribe();
      window.removeEventListener('focus', refresh);
    };
  }, []);
}
