import { useCallback } from 'react';
import { reportError } from '../../lib/report-error';

type StartupModuleLoader = () => Promise<unknown>;

export const preloadGlobalCommandPalette = () =>
  import('../../components/navigation/GlobalCommandPalette').then((module) => ({
    default: module.GlobalCommandPalette,
  }));

const preloadTagEditorModal: StartupModuleLoader = () =>
  import('../../components/tageditor/TagEditorModal').then((module) => ({
    default: module.TagEditorModal,
  }));

export async function preloadAppStartupModules(
  loaders: StartupModuleLoader[] = [preloadTagEditorModal, preloadGlobalCommandPalette],
): Promise<void> {
  const results = await Promise.allSettled(loaders.map((loader) => Promise.resolve().then(loader)));
  for (const result of results) {
    if (result.status === 'rejected') {
      reportError('Optional startup module preload failed', {
        source: 'app-startup',
        error: result.reason,
      });
    }
  }
}

export function useAppStartupPreload(): () => void {
  return useCallback(() => {
    void preloadAppStartupModules();
  }, []);
}
