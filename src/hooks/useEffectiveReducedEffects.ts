import { usePrefersReducedMotion } from '../components/ui/liquid-glass';
import { useSettingsStore } from '../store/settings-store';

export function useEffectiveReducedEffects(): boolean {
  const reducedEffects = useSettingsStore((state) => state.reducedEffects);
  const prefersReducedMotion = usePrefersReducedMotion();
  return reducedEffects || prefersReducedMotion;
}
