import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  settings: {
    theme: 'liquid',
    libraryFolders: ['/music'],
    followSymlinks: false,
    downloadArtwork: false,
    setLibraryFolders: vi.fn(),
    setFollowSymlinks: vi.fn(),
    setDownloadArtwork: vi.fn(),
  },
  tracks: [{ filePath: '/music/one.flac' }],
  health: {
    nativeGrants: [{ id: 'g1', path: '/music', displayName: 'Music', status: 'available' }],
    cachedSources: [{ grantId: 'g1', indexedTrackCount: 1 }],
  },
  navigation: { settingsPage: null, consumeSettingsPage: vi.fn(() => null) },
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../../../features/library/mutations', () => ({
  invalidateLibraryForMutation: vi.fn(async () => undefined),
}));
vi.mock('../../../features/library/useLibraryData', () => ({
  useLibraryData: () => ({
    libraryStats: { trackCount: 1, albumCount: 1 },
    tracks: fixtures.tracks,
    setTracks: vi.fn(),
    setTrackCount: vi.fn(),
  }),
}));
vi.mock('../../../store/settings-store', () => ({
  useSettingsStore: (selector: (state: typeof fixtures.settings) => unknown) =>
    selector(fixtures.settings),
}));
vi.mock('../../../store/navigation-intent-store', () => ({
  useNavigationIntentStore: Object.assign(
    (selector: (state: typeof fixtures.navigation) => unknown) => selector(fixtures.navigation),
    { getState: () => fixtures.navigation },
  ),
}));
vi.mock('../../../lib/performance', () => ({ useRenderLog: vi.fn() }));
vi.mock('../../../lib/report-error', () => ({ reportError: vi.fn() }));
vi.mock('../../../lib/tauri-commands', () => ({
  dbDeleteTracksByFolder: vi.fn(),
  getLibraryHealth: vi.fn(async () => fixtures.health),
  listLibraryGrants: vi.fn(),
  reauthorizeLibraryGrant: vi.fn(),
  revokeLibraryGrant: vi.fn(),
  selectLibraryFolder: vi.fn(),
}));
vi.mock('../SettingsShell', () => ({
  SettingsShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('../primitives', () => ({
  SettingsActionButton: ({
    children,
    onClick,
    disabled,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  SettingsControlGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SettingsRow: ({
    label,
    description,
    meta,
    control,
  }: {
    label: ReactNode;
    description: ReactNode;
    meta?: ReactNode;
    control?: ReactNode;
  }) => (
    <div>
      <div>{label}</div>
      <div>{description}</div>
      {meta}
      {control}
    </div>
  ),
  SettingsSection: ({
    title,
    description,
    children,
  }: {
    title: string;
    description?: ReactNode;
    children: ReactNode;
  }) => (
    <section>
      <h3>{title}</h3>
      <div>{description}</div>
      {children}
    </section>
  ),
  SettingsSwitch: () => null,
}));
vi.mock('../../../features/settings/components/SettingsForms', () => ({
  AppearanceSettingsForm: () => null,
  DesktopIntegrationForm: () => null,
  PlaybackSettingsForm: () => null,
}));
vi.mock('../CacheSettings', () => ({
  CacheSettings: () => null,
  RemovedFilesSettings: () => null,
}));
vi.mock('../sections/FullscreenPlayerSection', () => ({ FullscreenPlayerSection: () => null }));
vi.mock('../sections/LibraryAutomationSection', () => ({ LibraryAutomationSection: () => null }));
vi.mock('../sections/MiniPlayerSection', () => ({ MiniPlayerSection: () => null }));
vi.mock('../ui', () => ({ IconButton: () => null }));
vi.mock('../ui/ConfirmDialog', () => ({ ConfirmDialog: () => null }));
vi.mock('../ui/Icons', () => ({ LibraryIcon: () => null }));

import { UnifiedSettingsView } from '../UnifiedSettingsView';

describe('UnifiedSettingsView copy (LD-11)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses singular counts and keeps the never-scanned copy natural', async () => {
    const libraryScan = {
      isScanning: false,
      folderStatuses: {},
      scanFolder: vi.fn(async () => undefined),
      rescanAll: vi.fn(async () => undefined),
      cancelScan: vi.fn(async () => undefined),
    };

    render(<UnifiedSettingsView libraryScan={libraryScan as never} />);

    await screen.findByText('Music');
    expect(screen.getByText('1 track')).toBeInTheDocument();
    expect(screen.getByText('1 album')).toBeInTheDocument();
    expect(screen.getByText('1 source')).toBeInTheDocument();
    expect(screen.getByText('1 indexed track. Source access is active.')).toBeInTheDocument();
    expect(screen.getByText('1 indexed track · Not scanned yet')).toBeInTheDocument();
  });
});
