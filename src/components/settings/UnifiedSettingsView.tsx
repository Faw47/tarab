import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { memo, useCallback, useState } from 'react';
import { invalidateLibraryForMutation } from '../../features/library/mutations';
import { useLibraryData } from '../../features/library/useLibraryData';
import {
  AppearanceSettingsForm,
  DesktopIntegrationForm,
  PlaybackSettingsForm,
} from '../../features/settings/components/SettingsForms';
import { useRenderLog } from '../../lib/performance';
import { reportError } from '../../lib/report-error';
import {
  dbDeleteTracksByFolder,
  listLibraryGrants,
  revokeLibraryGrant,
  selectLibraryFolder,
} from '../../lib/tauri-commands';
import { cn } from '../../lib/utils';
import { useSettingsStore } from '../../store/settings-store';
import type { SettingsPage } from '../../types';
import { IconButton } from '../ui';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { LibraryIcon } from '../ui/Icons';
import { CacheSettings } from './CacheSettings';
import {
  SettingsActionButton,
  SettingsControlGroup,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from './primitives';
import { SettingsShell } from './SettingsShell';
import { FullscreenPlayerSection } from './sections/FullscreenPlayerSection';
import { LibraryAutomationSection } from './sections/LibraryAutomationSection';
import { MiniPlayerSection } from './sections/MiniPlayerSection';
import type { UseLibraryScanResult } from './useLibraryScan';
import { isSameOrSubPath } from './useLibraryScan';

interface UnifiedSettingsViewProps {
  onScrollChange?: (scrolled: boolean) => void;
  libraryScan: UseLibraryScanResult;
}

const pageCopy: Record<SettingsPage, { eyebrow: string; title: string; description: string }> = {
  library: {
    eyebrow: 'Library',
    title: 'Sources, Indexing, and Watchers',
    description:
      'Manage watched folders and the indexing behavior that keeps the music database current.',
  },
  playback: {
    eyebrow: 'Playback',
    title: 'Transition, Queue, and Shuffle',
    description: 'Tune playback continuity and shuffle behavior without changing library metadata.',
  },
  appearance: {
    eyebrow: 'Appearance',
    title: 'Theme, Effects, and Layout',
    description: 'Keep Settings aligned with the rest of Tarab across both visual themes.',
  },
  desktop: {
    eyebrow: 'Desktop',
    title: 'Tray, Media Keys, Shortcuts, and Mini Player',
    description:
      'Control how Tarab integrates with the operating system and compact player surfaces.',
  },
  storage: {
    eyebrow: 'Storage',
    title: 'Cover Cache, Waveform Cache, and Cleanup',
    description: 'Inspect cached assets, enforce quotas, and clean up generated files.',
  },
};

const formatScanTime = (date?: Date) => {
  if (!date) return 'Not scanned yet';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
};

export const UnifiedSettingsView = memo(
  ({ onScrollChange, libraryScan }: UnifiedSettingsViewProps) => {
    useRenderLog('UnifiedSettingsView');
    const queryClient = useQueryClient();

    const [page, setPage] = useState<SettingsPage>('library');
    const theme = useSettingsStore((s) => s.theme);
    const isNeobrutalism = theme === 'neobrutalism';

    const libraryFolders = useSettingsStore((s) => s.libraryFolders);
    const followSymlinks = useSettingsStore((s) => s.followSymlinks);
    const downloadArtwork = useSettingsStore((s) => s.downloadArtwork);
    const setLibraryFolders = useSettingsStore((s) => s.setLibraryFolders);
    const setFollowSymlinks = useSettingsStore((s) => s.setFollowSymlinks);
    const setDownloadArtwork = useSettingsStore((s) => s.setDownloadArtwork);

    const { libraryStats, tracks, setTracks, setTrackCount } = useLibraryData();
    const { isScanning, folderStatuses, scanFolder, rescanAll } = libraryScan;

    const [folderToRemove, setFolderToRemove] = useState<string | null>(null);

    const trackCount = libraryStats?.trackCount ?? tracks.length;
    const albumsCount = libraryStats?.albumCount ?? 0;

    const getTrackCountForFolder = useCallback(
      (folderPath: string) => tracks.filter((t) => isSameOrSubPath(t.filePath, folderPath)).length,
      [tracks],
    );

    const handleSelectFolder = useCallback(async () => {
      try {
        const grant = await selectLibraryFolder();
        if (grant) {
          const grants = await listLibraryGrants();
          setLibraryFolders(grants.map((item) => item.path));
          if (grant.status === 'available') {
            void scanFolder(grant.path);
          }
        }
      } catch (error) {
        reportError('Failed to select folder', { source: 'settings-view', error });
      }
    }, [scanFolder, setLibraryFolders]);

    const handleRemoveFolder = useCallback(
      async (folder: string) => {
        try {
          const grants = await listLibraryGrants();
          const grant = grants.find((item) => item.path === folder);
          if (!grant) {
            throw new Error('The native library grant no longer exists.');
          }
          await dbDeleteTracksByFolder(folder);
          await revokeLibraryGrant(grant.id);
          setLibraryFolders(grants.filter((item) => item.id !== grant.id).map((item) => item.path));
          const remaining = tracks.filter((t) => !isSameOrSubPath(t.filePath, folder));
          setTracks(remaining);
          setTrackCount(remaining.length);
          await invalidateLibraryForMutation(queryClient, 'delete');
        } catch (error) {
          reportError('Failed to remove folder tracks from database', {
            source: 'settings-view',
            error,
          });
        } finally {
          setFolderToRemove(null);
        }
      },
      [queryClient, setLibraryFolders, setTrackCount, setTracks, tracks],
    );

    const currentCopy = pageCopy[page];

    return (
      <SettingsShell
        page={page}
        setPage={setPage}
        isNeobrutalism={isNeobrutalism}
        onScrollChange={onScrollChange}
      >
        <div
          className={cn(
            'mx-auto space-y-5',
            page === 'desktop' ? 'max-w-6xl' : 'max-w-5xl',
            !isNeobrutalism && 'animate-fade-in',
            isNeobrutalism && 'pb-8',
          )}
        >
          <div
            className={cn('-mx-2 px-2 pb-3 pt-1', isNeobrutalism ? 'text-black' : 'text-white/50')}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em]">
              {currentCopy.eyebrow}
            </p>
            <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold leading-tight text-text-primary">
                  {currentCopy.title}
                </h2>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-muted">
                  {currentCopy.description}
                </p>
              </div>
              {page === 'library' ? (
                <div className="flex flex-wrap gap-2 text-xs text-text-muted">
                  <span>{trackCount.toLocaleString()} tracks</span>
                  <span>{albumsCount.toLocaleString()} albums</span>
                  <span>{libraryFolders.length} sources</span>
                </div>
              ) : null}
            </div>
          </div>

          {page === 'library' && (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <SettingsSection
                title="Sources"
                description="Removing a folder removes indexed records only. Files on disk are not deleted."
                icon={<LibraryIcon size={16} />}
                className="md:col-span-2"
                actions={
                  <SettingsControlGroup>
                    <SettingsActionButton size="sm" onClick={() => void handleSelectFolder()}>
                      <Plus size={14} /> Add Folder
                    </SettingsActionButton>
                    <SettingsActionButton
                      size="sm"
                      tone="ghost"
                      onClick={() => void rescanAll()}
                      disabled={isScanning}
                    >
                      <RefreshCw size={14} className={cn(isScanning && 'animate-spin')} /> Rescan
                    </SettingsActionButton>
                  </SettingsControlGroup>
                }
              >
                {libraryFolders.length === 0 ? (
                  <SettingsRow
                    label="No folders watched"
                    description="Add a source folder to begin indexing music files."
                    control={
                      <SettingsActionButton onClick={() => void handleSelectFolder()}>
                        Add one now
                      </SettingsActionButton>
                    }
                  />
                ) : (
                  libraryFolders.map((folder) => {
                    const folderStatus = folderStatuses[folder];
                    const status = folderStatus?.status ?? 'success';
                    const trackTotal = getTrackCountForFolder(folder);
                    return (
                      <SettingsRow
                        key={folder}
                        label={<span className="block truncate">{folder}</span>}
                        description={
                          <span className="block truncate">
                            {trackTotal.toLocaleString()} indexed tracks · Last scanned{' '}
                            {formatScanTime(folderStatus?.lastScanned)}
                          </span>
                        }
                        meta={
                          <span
                            className={cn(
                              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]',
                              isNeobrutalism
                                ? 'border-2 border-black bg-white text-black'
                                : 'border border-white/[0.08] bg-white/[0.06] text-white/60',
                            )}
                          >
                            {status === 'scanning' ? (
                              <RefreshCw size={11} className="animate-spin" />
                            ) : null}
                            {status === 'success' ? <CheckCircle2 size={11} /> : null}
                            {status === 'error' ? <AlertTriangle size={11} /> : null}
                            {status === 'scanning'
                              ? 'Scanning'
                              : status === 'error'
                                ? 'Error'
                                : 'Watched'}
                          </span>
                        }
                        control={
                          <SettingsControlGroup className="justify-end">
                            <IconButton
                              size="sm"
                              onClick={() => void scanFolder(folder)}
                              disabled={isScanning}
                              title="Refresh folder"
                            >
                              <RefreshCw
                                size={14}
                                className={cn(status === 'scanning' && 'animate-spin')}
                              />
                            </IconButton>
                            <IconButton
                              size="sm"
                              onClick={() => setFolderToRemove(folder)}
                              title="Remove folder"
                              className={
                                isNeobrutalism
                                  ? 'rounded-none border-2 border-black bg-[var(--signal-danger)] text-white shadow-[4px_4px_0_0_#000] transition-none hover:bg-[#C62828] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none'
                                  : 'text-red-400 hover:bg-red-500/10'
                              }
                            >
                              <Trash2 size={14} />
                            </IconButton>
                          </SettingsControlGroup>
                        }
                      />
                    );
                  })
                )}
              </SettingsSection>

              <SettingsSection
                title="Indexing"
                description="These options affect future scans and rescans."
                icon={<RefreshCw size={16} />}
                className="md:col-span-2"
              >
                <SettingsSwitch
                  label="Follow symlinks"
                  checked={followSymlinks}
                  onChange={setFollowSymlinks}
                  description="Advanced and risky: symlinks can point outside the selected source and may cause duplicate indexing."
                />
                <SettingsSwitch
                  label="Download artwork"
                  checked={downloadArtwork}
                  onChange={setDownloadArtwork}
                  description="Fetch missing cover art during metadata indexing when available."
                />
              </SettingsSection>

              <LibraryAutomationSection />
            </div>
          )}

          {page === 'playback' && (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <PlaybackSettingsForm />
            </div>
          )}
          {page === 'appearance' && (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              <AppearanceSettingsForm />
              <FullscreenPlayerSection />
            </div>
          )}
          {page === 'desktop' && (
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.05fr)_minmax(22rem,0.95fr)]">
              <DesktopIntegrationForm />
              <MiniPlayerSection />
            </div>
          )}
          {page === 'storage' && <CacheSettings />}
        </div>

        {folderToRemove && (
          <ConfirmDialog
            title="Remove folder from library"
            message={`Remove "${folderToRemove}" from library?`}
            detail="This only removes indexed tracks from Tarab and does not delete files from disk."
            variant="danger"
            confirmLabel="Remove"
            onConfirm={() => void handleRemoveFolder(folderToRemove)}
            onCancel={() => setFolderToRemove(null)}
          />
        )}
      </SettingsShell>
    );
  },
);

UnifiedSettingsView.displayName = 'UnifiedSettingsView';
