import { useEffect } from 'react';
import { cacheClear, cacheEnforceLimit } from '../../lib/tauri-commands';
import { useSettingsStore } from '../../store/settings-store';

export function useCacheMaintenance() {
  const cacheSizeLimitMb = useSettingsStore((state) => state.cacheSizeLimitMb);

  useEffect(() => {
    const cleanup = async () => {
      try {
        if (useSettingsStore.getState().clearCacheOnStartup) {
          await cacheClear();
        }
        await cacheEnforceLimit(cacheSizeLimitMb);
      } catch (err) {
        console.error('Cache maintenance failed:', err);
      }
    };
    void cleanup();
  }, []);

  useEffect(() => {
    const enforce = async () => {
      try {
        await cacheEnforceLimit(cacheSizeLimitMb);
      } catch (err) {
        console.error('Failed to enforce cache limit:', err);
      }
    };
    void enforce();
  }, [cacheSizeLimitMb]);
}
