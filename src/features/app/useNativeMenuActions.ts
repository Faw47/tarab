import { openUrl } from '@tauri-apps/plugin-opener';
import type { NavView } from '../../components/navigation';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { isSameOrSubPath, normalizePath } from '../../lib/path-utils';
import { seekToPosition } from '../../lib/playback-actions';
import { reportError } from '../../lib/report-error';
import { selectLibraryFolder } from '../../lib/tauri-commands';
import { dialog } from '../../platform/dialog';
import { usePlayerStore } from '../../store/player-store';

interface UseNativeMenuActionsOptions {
  navigate: (view: NavView) => void;
  openSearch: () => void;
  setFullPlayerVisible: (visible: boolean) => void;
  libraryFolders: string[];
  setLibraryFolders: (folders: string[]) => void;
  scanFolder: (folder: string) => Promise<unknown>;
}

export function useNativeMenuActions({
  navigate,
  openSearch,
  setFullPlayerVisible,
  libraryFolders,
  setLibraryFolders,
  scanFolder,
}: UseNativeMenuActionsOptions) {
  useTauriEvent<string>(
    'native-menu-action',
    (event) => {
      const action = event.payload;
      if (action === 'view.full-player') {
        if (usePlayerStore.getState().currentTrack) setFullPlayerVisible(true);
        return;
      }
      if (action === 'command-palette') {
        window.dispatchEvent(new CustomEvent('tarab:open-command-palette'));
        return;
      }
      if (action === 'find') {
        openSearch();
        return;
      }
      if (action === 'playback.seek-backward' || action === 'playback.seek-forward') {
        const state = usePlayerStore.getState();
        const delta = action === 'playback.seek-forward' ? 10 : -10;
        void seekToPosition(Math.max(0, Math.min(state.duration, state.currentTime + delta)));
        return;
      }
      if (action === 'file.add-folder') {
        void selectLibraryFolder()
          .then(async (grant) => {
            if (!grant) return;
            const folders = Array.from(new Set([...libraryFolders, grant.path]));
            setLibraryFolders(folders);
            await scanFolder(grant.path);
          })
          .catch((error) =>
            reportError('Failed to add library folder', { source: 'native-menu', error }),
          );
        return;
      }
      if (action === 'file.import') {
        void dialog.openAudioFiles('Import Audio Files').then(async (files) => {
          if (!files?.length) return;
          const folders = Array.from(
            new Set(
              files.map((file) => {
                const normalized = normalizePath(file);
                return normalized.slice(0, normalized.lastIndexOf('/'));
              }),
            ),
          ).filter((folder) => libraryFolders.some((root) => isSameOrSubPath(folder, root)));
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
        navigate('settings');
        return;
      }
      if (action === 'file.new-playlist' || action === 'view.playlists') {
        navigate('playlists');
        return;
      }
      if (action === 'help.help') {
        void openUrl('https://github.com/Faw47/tarab#readme');
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
      if (view) navigate(view);
    },
    [libraryFolders, navigate, openSearch, scanFolder, setFullPlayerVisible, setLibraryFolders],
    (error) =>
      reportError('Failed to setup native menu listener', {
        source: 'native-menu',
        error,
      }),
  );
}
