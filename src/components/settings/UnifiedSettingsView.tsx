import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Plus,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
} from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';
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
  dbGetTrackCount,
  getLibraryHealth,
  type LibraryGrantSummary,
  type LibraryHealthState,
  listRecoverableTrashEntries,
  purgeTrashedFiles,
  type RecoverableTrashEntry,
  reauthorizeLibraryGrant,
  removeLibrarySource,
  restoreTrashedFiles,
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

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
    const { isScanning, folderStatuses, scanFolder, rescanAll, cancelScan } = libraryScan;

    const [folderToRemove, setFolderToRemove] = useState<string | null>(null);
    const [nativeGrants, setNativeGrants] = useState<LibraryGrantSummary[]>([]);
    const [libraryHealth, setLibraryHealth] = useState<LibraryHealthState | null>(null);
    const [trashEntries, setTrashEntries] = useState<RecoverableTrashEntry[]>([]);
    const [trashBusyToken, setTrashBusyToken] = useState<string | null>(null);
    const [trashToPurge, setTrashToPurge] = useState<RecoverableTrashEntry | null>(null);

    const refreshNativeGrants = useCallback(async () => {
      const health = await getLibraryHealth();
      const grants = health.nativeGrants;
      setLibraryHealth(health);
      setNativeGrants(grants);
      setLibraryFolders(grants.map((item) => item.path));
      return grants;
    }, [setLibraryFolders]);

    useEffect(() => {
      void refreshNativeGrants().catch((error) =>
        reportError('Failed to read library health', { source: 'settings-view', error }),
      );
    }, [refreshNativeGrants]);

    const refreshTrashEntries = useCallback(async () => {
      const entries = await listRecoverableTrashEntries();
      setTrashEntries(entries);
      return entries;
    }, []);

    useEffect(() => {
      if (page !== 'storage') return;
      void refreshTrashEntries().catch((error) =>
        reportError('Failed to read recoverable Trash', { source: 'settings-view', error }),
      );
    }, [page, refreshTrashEntries]);

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
          await refreshNativeGrants();
          if (grant.status === 'available') {
            void scanFolder(grant.path);
          }
        }
      } catch (error) {
        reportError('Failed to select folder', { source: 'settings-view', error });
      }
    }, [refreshNativeGrants, scanFolder]);

    const handleReauthorize = useCallback(
      async (grantId: string) => {
        try {
          const grant = await reauthorizeLibraryGrant(grantId);
          if (!grant) return;
          await refreshNativeGrants();
          await invalidateLibraryForMutation(queryClient, 'rename');
          void scanFolder(grant.path);
        } catch (error) {
          reportError('Failed to reconnect library source', {
            source: 'settings-view',
            error,
          });
          void refreshNativeGrants().catch(() => undefined);
        }
      },
      [queryClient, refreshNativeGrants, scanFolder],
    );

    const handleRemoveFolder = useCallback(
      async (folder: string) => {
        try {
          const grant = nativeGrants.find((item) => item.path === folder);
          if (!grant) {
            throw new Error('The native library grant no longer exists.');
          }
          const removal = await removeLibrarySource(grant.id);
          await refreshNativeGrants();
          const remaining = tracks.filter((t) => !isSameOrSubPath(t.filePath, folder));
          setTracks(remaining);
          if (!removal.databaseCleanupCompleted) {
            setTrackCount(trackCount);
            reportError('Library source revoked; indexed cleanup is pending', {
              source: 'settings-view',
              error: removal.cleanupError ?? 'Tarab will retry cleanup at startup.',
            });
          } else {
            setTrackCount(await dbGetTrackCount());
            await invalidateLibraryForMutation(queryClient, 'delete');
            if (removal.cleanupPending) {
              reportError('Library source removed; recovery journal cleanup is pending', {
                source: 'settings-view',
                error: removal.cleanupError ?? 'Tarab will clear it at startup.',
              });
            }
          }
        } catch (error) {
          reportError('Failed to remove folder tracks from database', {
            source: 'settings-view',
            error,
          });
        } finally {
          setFolderToRemove(null);
        }
      },
      [
        nativeGrants,
        queryClient,
        refreshNativeGrants,
        setTrackCount,
        setTracks,
        trackCount,
        tracks,
      ],
    );

    const handleRestoreTrashEntry = useCallback(
      async (entry: RecoverableTrashEntry) => {
        setTrashBusyToken(entry.undoToken);
        try {
          const [result] = await restoreTrashedFiles([entry.undoToken]);
          if (!result || result.status !== 'success') {
            throw new Error(result?.errorMessage ?? 'The Trash entry could not be restored.');
          }
          setTrackCount(await dbGetTrackCount());
          await invalidateLibraryForMutation(queryClient, 'upsert');
          await refreshTrashEntries();
        } catch (error) {
          reportError('Failed to restore Trash entry', { source: 'settings-view', error });
          await refreshTrashEntries().catch(() => undefined);
        } finally {
          setTrashBusyToken(null);
        }
      },
      [queryClient, refreshTrashEntries, setTrackCount],
    );

    const handlePurgeTrashEntry = useCallback(
      async (entry: RecoverableTrashEntry) => {
        setTrashBusyToken(entry.undoToken);
        try {
          const [result] = await purgeTrashedFiles([entry.undoToken]);
          if (!result || result.status !== 'success') {
            throw new Error(result?.errorMessage ?? 'The Trash entry could not be purged.');
          }
          await refreshTrashEntries();
        } catch (error) {
          reportError('Failed to purge Trash entry', { source: 'settings-view', error });
          await refreshTrashEntries().catch(() => undefined);
        } finally {
          setTrashBusyToken(null);
          setTrashToPurge(null);
        }
      },
      [refreshTrashEntries],
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
            <p className="text-xs font-semibold uppercase tracking-[0.18em]">
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
                title="Library Health"
                description="Indexed music remains available for browsing when a source is disconnected."
                icon={<AlertTriangle size={16} />}
                className="md:col-span-2"
              >
                {nativeGrants.length === 0 ? (
                  <SettingsRow
                    label="No music sources"
                    description="Add a folder to start indexing music."
                    control={
                      <SettingsActionButton onClick={() => void handleSelectFolder()}>
                        <Plus size={14} /> Add Folder
                      </SettingsActionButton>
                    }
                  />
                ) : (
                  nativeGrants.map((grant) => (
                    <SettingsRow
                      key={grant.id}
                      label={grant.displayName}
                      description={
                        grant.status === 'available'
                          ? `${
                              libraryHealth?.cachedSources
                                .find((source) => source.grantId === grant.id)
                                ?.indexedTrackCount.toLocaleString() ?? '0'
                            } indexed tracks. Source access is active.`
                          : `Source access is missing. Indexed metadata and cached artwork remain available. ${grant.path}`
                      }
                      meta={
                        <span
                          className={cn(
                            'text-xs font-semibold',
                            grant.status === 'available'
                              ? 'text-[var(--state-success-ink)]'
                              : 'text-[var(--state-warning-ink)]',
                          )}
                        >
                          {grant.status === 'available' ? 'Available' : 'Needs access'}
                        </span>
                      }
                      control={
                        grant.status === 'missing' ? (
                          <SettingsActionButton onClick={() => void handleReauthorize(grant.id)}>
                            Reauthorize
                          </SettingsActionButton>
                        ) : null
                      }
                    />
                  ))
                )}
              </SettingsSection>

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
                    {isScanning ? (
                      <SettingsActionButton
                        size="sm"
                        tone="ghost"
                        onClick={() => void cancelScan()}
                      >
                        <Square size={13} /> Cancel
                      </SettingsActionButton>
                    ) : null}
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
                              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-[0.08em]',
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
                                  ? 'rounded-none border-2 border-black bg-[var(--signal-danger)] text-white shadow-[var(--neo-shadow-md)] transition-none hover:bg-[var(--neo-danger-hover)] active:translate-x-[4px] active:translate-y-[4px] active:shadow-none'
                                  : 'text-[var(--state-error-ink)] hover:bg-[var(--state-error-surface)]'
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
          {page === 'storage' && (
            <div className="space-y-5">
              <CacheSettings />
              <SettingsSection
                title="Recoverable Trash"
                description={`Files remain here across restarts until restored or purged. Tarab keeps up to 256 entries.`}
                icon={<Trash2 size={16} />}
              >
                {trashEntries.length === 0 ? (
                  <SettingsRow
                    label="Trash is empty"
                    description="Files moved to Tarab Trash will appear here."
                  />
                ) : (
                  trashEntries.map((entry) => (
                    <SettingsRow
                      key={entry.undoToken}
                      label={entry.displayName}
                      description={
                        entry.status === 'missing'
                          ? `Recovery payload is missing. ${entry.originalPath}`
                          : entry.status === 'restorePending'
                            ? `Restore interrupted; retry is safe. ${entry.originalPath}`
                            : entry.originalPath
                      }
                      meta={
                        <span className="text-xs text-text-muted">
                          {entry.sizeBytes > 0 ? formatBytes(entry.sizeBytes) : 'Metadata only'}
                        </span>
                      }
                      control={
                        <SettingsControlGroup className="justify-end">
                          <SettingsActionButton
                            size="sm"
                            onClick={() => void handleRestoreTrashEntry(entry)}
                            disabled={trashBusyToken !== null || entry.status === 'missing'}
                          >
                            <RotateCcw size={13} /> Restore
                          </SettingsActionButton>
                          <SettingsActionButton
                            size="sm"
                            tone="danger"
                            onClick={() => setTrashToPurge(entry)}
                            disabled={trashBusyToken !== null || entry.status === 'restorePending'}
                          >
                            <Trash2 size={13} /> Purge
                          </SettingsActionButton>
                        </SettingsControlGroup>
                      }
                    />
                  ))
                )}
              </SettingsSection>
            </div>
          )}
        </div>

        {folderToRemove && (
          <ConfirmDialog
            title="Remove folder from library"
            message={`Remove "${folderToRemove}" from library?`}
            detail="This only removes indexed tracks from Tarab and does not delete files from disk."
            variant="danger"
            confirmLabel="Remove"
            onConfirm={() => handleRemoveFolder(folderToRemove)}
            onCancel={() => setFolderToRemove(null)}
          />
        )}
        {trashToPurge && (
          <ConfirmDialog
            title="Purge file from Trash"
            message={`Permanently delete "${trashToPurge.displayName}"?`}
            detail="This removes Tarab's recovery copy and cannot be undone."
            variant="danger"
            confirmLabel="Purge permanently"
            onConfirm={() => handlePurgeTrashEntry(trashToPurge)}
            onCancel={() => setTrashToPurge(null)}
          />
        )}
      </SettingsShell>
    );
  },
);

UnifiedSettingsView.displayName = 'UnifiedSettingsView';
