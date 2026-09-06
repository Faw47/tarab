import { openUrl } from '@tauri-apps/plugin-opener';
import { useCallback, useRef } from 'react';
import type { NavView } from '../../components/navigation';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { getPathDirectory, isSameOrSubPath } from '../../lib/path-utils';
import { reportError } from '../../lib/report-error';
import {
  desktopFocusMainWindow,
  listLibraryGrants,
  selectLibraryFolder,
} from '../../lib/tauri-commands';
import { dialog } from '../../platform/dialog';
import { usePlayerStore } from '../../store/player-store';
import { useSettingsStore } from '../../store/settings-store';

interface UseNativeMenuActionsOptions {
  navigate: (view: NavView) => void;
  openSearch: () => void;
  setFullPlayerVisible: (visible: boolean) => void;
  setLibraryFolders: (folders: string[]) => void;
  scanFolder: (folder: string) => Promise<unknown>;
}

export function useNativeMenuActions({
  navigate,
  openSearch,
  setFullPlayerVisible,
  setLibraryFolders,
  scanFolder,
}: UseNativeMenuActionsOptions) {
  const operationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const runInMainWindow = useCallback((operation: () => void | Promise<void>) => {
    const queued = operationQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        await desktopFocusMainWindow();
        await operation();
      });
    operationQueueRef.current = queued.catch((error) => {
      reportError('Failed to handle native menu action', { source: 'native-menu', error });
    });
  }, []);

  useTauriEvent<string>(
    'native-menu-action',
    (event) => {
      const action = event.payload;
      if (action === 'view.full-player') {
        runInMainWindow(() => {
          if (usePlayerStore.getState().currentTrack) setFullPlayerVisible(true);
        });
        return;
      }
      if (action === 'command-palette') {
        runInMainWindow(() => {
          window.dispatchEvent(new CustomEvent('tarab:open-command-palette'));
        });
        return;
      }
      if (action === 'find') {
        runInMainWindow(openSearch);
        return;
      }
      if (action === 'file.add-folder') {
        runInMainWindow(async () => {
          const grant = await selectLibraryFolder();
          if (!grant) return;
          const grants = await listLibraryGrants();
          setLibraryFolders(grants.map((entry) => entry.path));
          await scanFolder(grant.path);
        });
        return;
      }
      if (action === 'file.import') {
        runInMainWindow(async () => {
          const files = await dialog.openAudioFiles('Import Audio Files');
          if (!files?.length) return;
          const approvedRoots = useSettingsStore.getState().libraryFolders;
          const folders = Array.from(new Set(files.map((file) => getPathDirectory(file)))).filter(
            (folder) => approvedRoots.some((root) => isSameOrSubPath(folder, root)),
          );
          if (folders.length === 0) {
            reportError('Selected files are outside the approved library folders', {
              source: 'native-menu',
              error: new Error('Add the containing folder to Library settings first.'),
            });
            return;
          }
          for (const folder of folders) await scanFolder(folder);
        });
        return;
      }
      if (action === 'settings' || action === 'help.diagnostics') {
        runInMainWindow(() => navigate('settings'));
        return;
      }
      if (action === 'file.new-playlist' || action === 'view.playlists') {
        runInMainWindow(() => navigate('playlists'));
        return;
      }
      if (action === 'help.help') {
        runInMainWindow(async () => {
          await openUrl('https://github.com/Faw47/tarab#readme');
        });
        return;
      }
      const viewByAction: Record<string, NavView> = {
        'view.home': 'home',
        'view.library': 'library',
        'view.albums': 'library',
        'view.artists': 'library',
        'view.queue': 'queue',
      };
      const view = viewByAction[action];
      if (view) runInMainWindow(() => navigate(view));
    },
    [navigate, openSearch, runInMainWindow, scanFolder, setFullPlayerVisible, setLibraryFolders],
    (error) =>
      reportError('Failed to setup native menu listener', {
        source: 'native-menu',
        error,
      }),
  );
}
