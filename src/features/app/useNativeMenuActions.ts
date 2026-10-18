import type { QueryClient } from '@tanstack/react-query';
import { openUrl } from '@tauri-apps/plugin-opener';
import { toast } from 'sonner';
import type { NavView } from '../../components/navigation';
import { useTauriEvent } from '../../hooks/useTauriEvent';
import { isSameOrSubPath, normalizePath } from '../../lib/path-utils';
import { seekToPosition } from '../../lib/playback-actions';
import { logError, reportError } from '../../lib/report-error';
import { selectLibraryFolder } from '../../lib/tauri-commands';
import { refreshTracksByFilePaths } from '../../lib/track-refresh';
import { dialog } from '../../platform/dialog';
import { useNavigationIntentStore } from '../../store/navigation-intent-store';
import { usePlayerStore } from '../../store/player-store';
import { useSettingsStore } from '../../store/settings-store';
import { invalidateLibraryForMutation } from '../library/mutations';

interface UseNativeMenuActionsOptions {
  navigate: (view: NavView) => void;
  openSearch: () => void;
  setFullPlayerVisible: (visible: boolean) => void;
  libraryFolders: string[];
  setLibraryFolders: (folders: string[]) => void;
  scanFolder: (folder: string) => Promise<unknown>;
  queryClient: QueryClient;
}

export function useNativeMenuActions({
  navigate,
  openSearch,
  setFullPlayerVisible,
  libraryFolders,
  setLibraryFolders,
  scanFolder,
  queryClient,
}: UseNativeMenuActionsOptions) {
  const addLibraryFolder = () =>
    selectLibraryFolder()
      .then(async (grant) => {
        if (!grant) return;
        // Read the folders now: this also runs from a toast action, possibly long after render.
        const current = useSettingsStore.getState().libraryFolders;
        const folders = Array.from(new Set([...current, grant.path]));
        setLibraryFolders(folders);
        await scanFolder(grant.path);
      })
      .catch((error) =>
        reportError('Failed to add library folder', { source: 'native-menu', error }),
      );

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
        void addLibraryFolder();
        return;
      }
      if (action === 'file.import') {
        void dialog.openAudioFiles('Import Audio Files').then(async (files) => {
          if (!files?.length) return;
          // Import exactly the chosen files; reading their tags needs an approved folder.
          const inside = files.filter((file) =>
            libraryFolders.some((root) => isSameOrSubPath(normalizePath(file), root)),
          );
          const outside = files.length - inside.length;
          if (outside > 0) {
            toast.error(
              outside === files.length
                ? 'The selected files are outside your library folders'
                : `${outside} of the selected files ${outside === 1 ? 'is' : 'are'} outside your library folders`,
              {
                description: 'Add their folder to the library to import them.',
                action: { label: 'Add Folder', onClick: () => void addLibraryFolder() },
              },
            );
          }
          if (inside.length === 0) return;
          await refreshTracksByFilePaths(inside);
          await invalidateLibraryForMutation(queryClient, 'upsert');
        });
        return;
      }
      if (action === 'help.diagnostics') {
        // Library health (grant and folder checks) is on the Library settings page.
        useNavigationIntentStore.getState().requestSettingsPage('library');
        navigate('settings');
        return;
      }
      if (action === 'settings') {
        navigate('settings');
        return;
      }
      if (action === 'file.new-playlist') {
        useNavigationIntentStore.getState().requestCreatePlaylist();
        navigate('playlists');
        return;
      }
      if (action === 'view.playlists') {
        navigate('playlists');
        return;
      }
      if (action === 'view.albums' || action === 'view.artists') {
        useNavigationIntentStore
          .getState()
          .requestLibraryFacet(action === 'view.albums' ? 'albums' : 'artists');
        navigate('library');
        return;
      }
      if (action === 'help.help') {
        void openUrl('https://github.com/Faw47/tarab#readme').catch((error) => {
          reportError('Failed to open Tarab Help', { source: 'native-menu', error });
        });
        return;
      }
      const viewByAction: Record<string, NavView> = {
        'view.home': 'home',
        'view.library': 'library',
        'view.queue': 'queue',
      };
      const view = viewByAction[action];
      if (view) navigate(view);
    },
    [
      libraryFolders,
      navigate,
      openSearch,
      queryClient,
      scanFolder,
      setFullPlayerVisible,
      setLibraryFolders,
    ],
    (error) =>
      logError('Failed to setup native menu listener', {
        source: 'native-menu',
        error,
      }),
  );
}
