import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PropsWithChildren, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '../../../types';
import { UnifiedSettingsView } from '../UnifiedSettingsView';

const {
  getLibraryHealthMock,
  removeLibrarySourceMock,
  rootTrack,
  setTracksMock,
  setTrackCountMock,
  settingsState,
} = vi.hoisted(() => {
  const state = {
    theme: 'liquid-glass',
    libraryFolders: ['/'],
    followSymlinks: false,
    downloadArtwork: false,
    setLibraryFolders: vi.fn((folders: string[]) => {
      state.libraryFolders = folders;
    }),
    setFollowSymlinks: vi.fn(),
    setDownloadArtwork: vi.fn(),
  };
  return {
    getLibraryHealthMock: vi.fn(),
    removeLibrarySourceMock: vi.fn(),
    rootTrack: {
      id: '/song.mp3',
      title: 'Song',
      artist: 'Artist',
      albumArtist: null,
      album: 'Album',
      year: 2024,
      duration: 180,
      filePath: '/song.mp3',
      hasCoverArt: false,
      coverArtHash: null,
      dateAdded: 1,
      rating: null,
    } satisfies Track,
    setTracksMock: vi.fn(),
    setTrackCountMock: vi.fn(),
    settingsState: state,
  };
});

vi.mock('../../../store/settings-store', () => ({
  useSettingsStore: (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
}));

vi.mock('../../../features/library/useLibraryData', () => ({
  useLibraryData: () => ({
    libraryStats: { trackCount: 1, albumCount: 1 },
    tracks: [rootTrack],
    setTracks: setTracksMock,
    setTrackCount: setTrackCountMock,
  }),
}));

vi.mock('../../../features/library/mutations', () => ({
  invalidateLibraryForMutation: vi.fn(async () => undefined),
}));

vi.mock('../../../lib/tauri-commands', () => ({
  dbGetTrackCount: vi.fn(async () => 0),
  getLibraryHealth: getLibraryHealthMock,
  listRecoverableTrashEntries: vi.fn(async () => []),
  purgeTrashedFiles: vi.fn(async () => []),
  reauthorizeLibraryGrant: vi.fn(async () => null),
  removeLibrarySource: removeLibrarySourceMock,
  restoreTrashedFiles: vi.fn(async () => []),
  selectLibraryFolder: vi.fn(async () => null),
}));

vi.mock('../../../lib/performance', () => ({ useRenderLog: vi.fn() }));
vi.mock('../../../lib/report-error', () => ({ reportError: vi.fn() }));

vi.mock('../../../features/settings/components/SettingsForms', () => ({
  AppearanceSettingsForm: () => null,
  DesktopIntegrationForm: () => null,
  PlaybackSettingsForm: () => null,
}));

vi.mock('../SettingsShell', () => ({
  SettingsShell: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));

vi.mock('../primitives', () => ({
  SettingsActionButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} />
  ),
  SettingsControlGroup: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SettingsRow: ({
    label,
    description,
    control,
  }: {
    label: ReactNode;
    description?: ReactNode;
    control?: ReactNode;
  }) => (
    <div>
      <div>{label}</div>
      <div>{description}</div>
      <div>{control}</div>
    </div>
  ),
  SettingsSection: ({ children }: PropsWithChildren) => <section>{children}</section>,
  SettingsSwitch: () => null,
}));

vi.mock('../../ui', () => ({
  IconButton: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props} />,
}));

vi.mock('../../ui/ConfirmDialog', () => ({
  ConfirmDialog: ({
    message,
    confirmLabel,
    onConfirm,
    onCancel,
  }: {
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
  }) => (
    <div role="dialog">
      <p>{message}</p>
      <button onClick={onConfirm}>{confirmLabel}</button>
      <button onClick={onCancel}>Cancel</button>
    </div>
  ),
}));

vi.mock('../../ui/Icons', () => ({ LibraryIcon: () => null }));
vi.mock('../CacheSettings', () => ({ CacheSettings: () => null }));
vi.mock('../sections/FullscreenPlayerSection', () => ({ FullscreenPlayerSection: () => null }));
vi.mock('../sections/LibraryAutomationSection', () => ({ LibraryAutomationSection: () => null }));
vi.mock('../sections/MiniPlayerSection', () => ({ MiniPlayerSection: () => null }));

const healthWithRoot = {
  nativeGrants: [
    {
      id: 'grant-root',
      path: '/',
      displayName: '/',
      status: 'available' as const,
    },
  ],
  cachedSources: [{ grantId: 'grant-root', path: '/', indexedTrackCount: 1 }],
  unavailableSources: [],
  watcherState: 'ready' as const,
  repairActions: ['addFolder', 'rescan'] as const,
};

describe('UnifiedSettingsView source removal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsState.libraryFolders = ['/'];
    getLibraryHealthMock.mockResolvedValue(healthWithRoot);
    removeLibrarySourceMock.mockResolvedValue({
      grantId: 'grant-root',
      path: '/',
      removedTrackCount: 1,
      databaseCleanupCompleted: true,
      cleanupPending: false,
      cleanupError: null,
    });
  });

  it('removes a root grant through one native source-removal command', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const libraryScan = {
      isScanning: false,
      folderStatuses: {},
      scanFolder: vi.fn(async () => undefined),
      rescanAll: vi.fn(async () => undefined),
      cancelScan: vi.fn(async () => undefined),
    };

    render(
      <QueryClientProvider client={queryClient}>
        <UnifiedSettingsView libraryScan={libraryScan as never} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByTitle('Remove folder')).toBeInTheDocument());
    fireEvent.click(screen.getByTitle('Remove folder'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(removeLibrarySourceMock).toHaveBeenCalledWith('grant-root'));
    expect(setTracksMock).toHaveBeenCalledWith([]);
    expect(setTrackCountMock).toHaveBeenCalledWith(0);
  });
});
