import { useEffect, useState } from 'react';
import { cacheClear, cacheEnforceLimit } from '../../lib/tauri-commands';
import { useSettingsStore } from '../../store/settings-store';

let startupMaintenanceStarted = false;
let lastScheduledLimitMb: number | null = null;
let maintenanceTail: Promise<void> = Promise.resolve();

export const resetCacheMaintenanceForTests = async () => {
  await maintenanceTail;
  startupMaintenanceStarted = false;
  lastScheduledLimitMb = null;
  maintenanceTail = Promise.resolve();
};

const enqueueMaintenance = (operation: () => Promise<void>) => {
  maintenanceTail = maintenanceTail.then(operation, operation);
};

const enforceLimit = async (cacheSizeLimitMb: number) => {
  try {
    await cacheEnforceLimit(cacheSizeLimitMb);
  } catch (err) {
    console.error('Failed to enforce cache limit:', err);
  }
};

const scheduleStartupMaintenance = (clearOnStartup: boolean, cacheSizeLimitMb: number) => {
  if (startupMaintenanceStarted) return;
  startupMaintenanceStarted = true;
  lastScheduledLimitMb = cacheSizeLimitMb;
  enqueueMaintenance(async () => {
    if (clearOnStartup) {
      try {
        await cacheClear();
      } catch (err) {
        console.error('Failed to clear cache on startup:', err);
      }
    }
    await enforceLimit(cacheSizeLimitMb);
  });
};

const scheduleLimitEnforcement = (cacheSizeLimitMb: number) => {
  if (!startupMaintenanceStarted || lastScheduledLimitMb === cacheSizeLimitMb) return;
  lastScheduledLimitMb = cacheSizeLimitMb;
  enqueueMaintenance(() => enforceLimit(cacheSizeLimitMb));
};

export function useCacheMaintenance() {
  const cacheSizeLimitMb = useSettingsStore((state) => state.cacheSizeLimitMb);
  const [settingsHydrated, setSettingsHydrated] = useState(() =>
    useSettingsStore.persist.hasHydrated(),
  );

  useEffect(() => {
    const unsubscribe = useSettingsStore.persist.onFinishHydration(() => {
      setSettingsHydrated(true);
    });
    if (useSettingsStore.persist.hasHydrated()) {
      setSettingsHydrated(true);
    }
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!settingsHydrated) return;
    const settings = useSettingsStore.getState();
    scheduleStartupMaintenance(settings.clearCacheOnStartup, settings.cacheSizeLimitMb);
  }, [settingsHydrated]);

  useEffect(() => {
    if (!settingsHydrated) return;
    scheduleLimitEnforcement(cacheSizeLimitMb);
  }, [cacheSizeLimitMb, settingsHydrated]);
}
