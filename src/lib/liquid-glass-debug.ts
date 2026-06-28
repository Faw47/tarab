/**
 * Debug exaggeration for liquid control glass: URL `?debugLiquidGlass=1` or persisted settings flag.
 */
import { useSettingsStore } from '@/store/settings-store';

export function readLiquidGlassDebugExaggerated(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(window.location.search).get('debugLiquidGlass') === '1') return true;
  } catch {
    /* ignore */
  }
  return useSettingsStore.getState().debugLiquidControlGlass === true;
}
