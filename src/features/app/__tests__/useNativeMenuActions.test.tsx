import { QueryClient } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNavigationIntentStore } from '../../../store/navigation-intent-store';
import { useNativeMenuActions } from '../useNativeMenuActions';

const {
  listeners,
  openAudioFilesMock,
  openUrlMock,
  refreshMock,
  toastErrorMock,
  reportErrorMock,
} = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => unknown>(),
  openAudioFilesMock: vi.fn(),
  openUrlMock: vi.fn(async () => undefined),
  refreshMock: vi.fn(async () => undefined),
  toastErrorMock: vi.fn(),
  reportErrorMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: unknown }) => unknown) => {
    listeners.set(name, handler);
    return () => listeners.delete(name);
  }),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: openUrlMock }));
vi.mock('sonner', () => ({ toast: { error: toastErrorMock } }));
vi.mock('../../../platform/dialog', () => ({ dialog: { openAudioFiles: openAudioFilesMock } }));
vi.mock('../../../lib/track-refresh', () => ({ refreshTracksByFilePaths: refreshMock }));
vi.mock('../../../lib/tauri-commands', () => ({ selectLibraryFolder: vi.fn(async () => null) }));
vi.mock('../../../lib/playback-actions', () => ({ seekToPosition: vi.fn() }));
vi.mock('../../../lib/report-error', () => ({
  reportError: reportErrorMock,
  logError: vi.fn(),
}));
vi.mock('../../../platform/tauri-zustand-storage', () => ({
  createTauriZustandStorage: () => ({
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  }),
}));

const navigate = vi.fn();

function Harness() {
  useNativeMenuActions({
    navigate,
    openSearch: vi.fn(),
    setFullPlayerVisible: vi.fn(),
    libraryFolders: ['/music'],
    setLibraryFolders: vi.fn(),
    scanFolder: vi.fn(async () => undefined),
    queryClient: new QueryClient(),
  });
  return null;
}

async function menuAction(action: string) {
  await waitFor(() => {
    expect(listeners.has('native-menu-action')).toBe(true);
  });
  await listeners.get('native-menu-action')?.({ payload: action });
}

describe('native menu actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    openUrlMock.mockReset();
    openUrlMock.mockResolvedValue(undefined);
    listeners.clear();
    useNavigationIntentStore.setState({
      libraryFacet: null,
      createPlaylist: false,
      settingsPage: null,
    });
  });

  it('opens the Albums and Artists facets, not just the library', async () => {
    // Regression for FE-24: both items only navigated to the library.
    render(<Harness />);
    await menuAction('view.artists');

    expect(navigate).toHaveBeenCalledWith('library');
    expect(useNavigationIntentStore.getState().consumeLibraryFacet()).toBe('artists');
    expect(useNavigationIntentStore.getState().consumeLibraryFacet()).toBeNull();
  });

  it('opens the README from the native Help menu', async () => {
    // Regression for QA-10: Help was disabled on Windows and Linux.
    render(<Harness />);
    await menuAction('help.help');

    expect(openUrlMock).toHaveBeenCalledWith('https://github.com/Faw47/tarab#readme');
  });

  it('reports a denied Help URL instead of silently ignoring the failure', async () => {
    const error = new Error('URL is not allowed by opener scope');
    openUrlMock.mockRejectedValueOnce(error);
    render(<Harness />);
    await menuAction('help.help');

    await waitFor(() => {
      expect(reportErrorMock).toHaveBeenCalledWith('Failed to open Tarab Help', {
        source: 'native-menu',
        error,
      });
    });
  });

  it('asks the playlists view to open the create dialog', async () => {
    render(<Harness />);
    await menuAction('file.new-playlist');

    expect(navigate).toHaveBeenCalledWith('playlists');
    expect(useNavigationIntentStore.getState().createPlaylist).toBe(true);
  });

  it('imports exactly the chosen files and offers to add folders for the rest', async () => {
    openAudioFilesMock.mockResolvedValue(['/music/a/one.flac', '/elsewhere/two.flac']);
    render(<Harness />);
    await menuAction('file.import');

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalledWith(['/music/a/one.flac']);
    });
    expect(toastErrorMock).toHaveBeenCalledWith(
      '1 of the selected files is outside your library folders',
      expect.objectContaining({ action: expect.objectContaining({ label: 'Add Folder' }) }),
    );
  });
});
