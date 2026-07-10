import { useEffect } from 'react';
import { globalShortcutsManager } from '../../platform/globalShortcutsManager';
import { logger } from '../../platform/logger';
import { useSettingsStore } from '../../store/settings-store';

const DOMAIN = 'GlobalShortcutsRegistration';

const logFailure = (operation: string) => (error: unknown) => {
  logger.error(DOMAIN, 'Failed to ' + operation + ' global shortcuts', error);
};
export function useGlobalShortcutsRegistration() {
  const globalShortcutsEnabled = useSettingsStore((s) => s.globalShortcutsEnabled);
  const shortcuts = useSettingsStore((s) => s.shortcuts);

  useEffect(() => {
    if (!globalShortcutsEnabled) {
      void globalShortcutsManager.unregisterAll().catch(logFailure('unregister'));
      return;
    }

    void globalShortcutsManager.registerAll(shortcuts).catch(logFailure('register'));
    return () => {
      void globalShortcutsManager.unregisterAll().catch(logFailure('unregister'));
    };
  }, [globalShortcutsEnabled, shortcuts]);
}
