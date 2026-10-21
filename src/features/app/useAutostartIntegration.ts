import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { useEffect } from 'react';
import { reportError } from '../../lib/report-error';
import { useSettingsStore } from '../../store/settings-store';

/** The OS owns login registration; app-wide observation starts after settings hydration. */
export function useAutostartIntegration() {
  useEffect(() => {
    let cancelled = false;
    let started = false;
    let syncingFromOs = false;
    let intentRevision = 0;
    let appliedIntentRevision = 0;
    let unsubscribe = () => {};
    let pending = Promise.resolve();

    const updateFromOs = (enabled: boolean, expectedRevision: number) => {
      if (
        cancelled ||
        intentRevision !== expectedRevision ||
        appliedIntentRevision !== expectedRevision
      ) {
        return;
      }
      syncingFromOs = true;
      try {
        if (useSettingsStore.getState().autostartEnabled !== enabled) {
          useSettingsStore.getState().setAutostartEnabled(enabled);
        }
      } finally {
        syncingFromOs = false;
      }
    };

    const readOs = async (expectedRevision: number) => {
      try {
        updateFromOs(await isEnabled(), expectedRevision);
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

    const applyUserSetting = (enabled: boolean, revision: number) => {
      enqueue(async () => {
        if (revision !== intentRevision) return;
        try {
          if (enabled) await enable();
          else await disable();
          if (revision === intentRevision) appliedIntentRevision = revision;
        } catch (error) {
          // A newer user choice wins over a slow result from either the OS read or this write.
          if (revision === intentRevision) appliedIntentRevision = revision;
          await readOs(revision);
          if (!cancelled && revision === intentRevision) {
            reportError('Failed to sync open at login', { source: 'app-autostart', error });
          }
        }
      });
    };

    const refresh = () => {
      if (!started) return;
      const revision = intentRevision;
      void readOs(revision);
    };

    const start = () => {
      console.info('[autostart-debug] start callback');
      if (started || cancelled) return;
      started = true;

      // Subscribe before the first asynchronous OS read so a user toggle cannot be lost.
      unsubscribe = useSettingsStore.subscribe((state, previous) => {
        if (syncingFromOs || state.autostartEnabled === previous.autostartEnabled) return;
        const enabled = state.autostartEnabled;
        const revision = ++intentRevision;
        applyUserSetting(enabled, revision);
      });

      const revision = intentRevision;
      void readOs(revision);
    };

    const hydrated = useSettingsStore.persist.hasHydrated();
    console.info('[autostart-debug] effect hydration check', hydrated);
    const stopHydration = useSettingsStore.persist.onFinishHydration(start);
    if (hydrated) start();
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      stopHydration();
      unsubscribe();
      window.removeEventListener('focus', refresh);
    };
  }, []);
}
