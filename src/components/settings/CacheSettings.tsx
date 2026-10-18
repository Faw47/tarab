import { useQueryClient } from '@tanstack/react-query';
import { ArchiveRestore, HardDrive, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';

import { invalidateLibraryForMutation } from '../../features/library/mutations';
import { reportError } from '../../lib/report-error';
import {
  type CacheStats,
  cacheClear,
  cacheEnforceLimit,
  cacheGetStats,
  type FileMutationResult,
  listTrashedFiles,
  purgeTrashedFiles,
  restoreTrashedFiles,
  type TrashedFileSummary,
} from '../../lib/tauri-commands';
import { useSettingsStore } from '../../store/settings-store';
import { ConfirmDialog, type ConfirmDialogProps } from '../ui/ConfirmDialog';
import {
  SettingsActionButton,
  SettingsDangerRow,
  SettingsRow,
  SettingsSection,
  SettingsSlider,
  SettingsSwitch,
} from './primitives';

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / k ** i).toFixed(2))} ${sizes[i]}`;
};

export const CacheSettings = memo(() => {
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const cacheSizeLimitMb = useSettingsStore((s) => s.cacheSizeLimitMb);
  const setCacheSizeLimitMb = useSettingsStore((s) => s.setCacheSizeLimitMb);
  const clearCacheOnStartup = useSettingsStore((s) => s.clearCacheOnStartup);
  const setClearCacheOnStartup = useSettingsStore((s) => s.setClearCacheOnStartup);
  const [confirmDialog, setConfirmDialog] = useState<Omit<ConfirmDialogProps, 'onCancel'> | null>(
    null,
  );

  const loadStats = useCallback(async () => {
    setLoading(true);
    try {
      const data = await cacheGetStats();
      setStats(data);
    } catch (e) {
      reportError('Failed to load cache stats', { source: 'cache-settings', error: e });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const executeClearCache = useCallback(async () => {
    setClearing(true);
    try {
      await cacheClear(0);
      await loadStats();
    } catch (e) {
      reportError('Failed to clear cache', { source: 'cache-settings', error: e });
    } finally {
      setClearing(false);
    }
  }, [loadStats]);

  const handleClearCache = useCallback(() => {
    setConfirmDialog({
      title: 'Clear image cache',
      message:
        'Are you sure you want to clear the image cache? Images will need to be re-downloaded or re-generated.',
      variant: 'danger',
      confirmLabel: 'Clear Cache',
      onConfirm: executeClearCache,
    });
  }, [executeClearCache]);

  const handleEnforceLimit = useCallback(async () => {
    setLoading(true);
    try {
      await cacheEnforceLimit(cacheSizeLimitMb);
      await loadStats();
    } catch (e) {
      reportError('Failed to enforce limit', { source: 'cache-settings', error: e });
    } finally {
      setLoading(false);
    }
  }, [cacheSizeLimitMb, loadStats]);

  return (
    <>
      <SettingsSection
        title="Cache and Cleanup"
        description="Manage generated image assets and disk quota."
        icon={<HardDrive size={16} />}
        actions={
          <SettingsActionButton
            size="sm"
            tone="ghost"
            onClick={loadStats}
            disabled={loading}
            title="Refresh stats"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} /> Refresh
          </SettingsActionButton>
        }
      >
        <SettingsRow
          label="Cover cache"
          description={
            stats ? `${stats.fileCount} files tracked in storage.` : 'Calculating cache usage.'
          }
          control={
            <span className="text-sm font-semibold text-text-primary">
              {stats ? formatBytes(stats.totalSizeBytes) : '...'}
            </span>
          }
        />
        <SettingsRow
          label="Automatic quota"
          description="Maximum allowed disk space for temporary assets."
          control={
            <SettingsSlider
              label="Cache size limit"
              min={100}
              max={5000}
              step={100}
              value={cacheSizeLimitMb}
              valueLabel={`${cacheSizeLimitMb} MB`}
              onChange={setCacheSizeLimitMb}
              onCommit={handleEnforceLimit}
            />
          }
        >
          <div className="flex justify-end">
            <SettingsActionButton
              size="sm"
              tone="ghost"
              onClick={handleEnforceLimit}
              disabled={loading}
            >
              Enforce Limit
            </SettingsActionButton>
          </div>
        </SettingsRow>
        <SettingsSwitch
          label="Clear cache on startup"
          description="If enabled, the image cache is pruned during the next app launch."
          checked={clearCacheOnStartup}
          onChange={setClearCacheOnStartup}
        />
        <SettingsDangerRow
          label="Clear image cache"
          description="Free disk space by removing cached cover assets. Library files are not affected."
          action={
            <SettingsActionButton
              tone="danger"
              onClick={handleClearCache}
              disabled={clearing || !stats?.totalSizeBytes}
            >
              {clearing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Clear Image Cache
            </SettingsActionButton>
          }
        />
      </SettingsSection>

      {confirmDialog && (
        <ConfirmDialog {...confirmDialog} onCancel={() => setConfirmDialog(null)} />
      )}
    </>
  );
});

CacheSettings.displayName = 'CacheSettings';

const fileName = (path: string) => path.split(/[\\/]/).pop() || path;

const reportFailures = (action: string, results: FileMutationResult[]) => {
  const failed = results.filter((result) => result.status !== 'success');
  if (failed.length === 0) return;
  reportError(`${failed.length} ${failed.length === 1 ? 'file' : 'files'} could not be ${action}`, {
    source: 'removed-files',
    detail: failed.map((result) => result.errorMessage ?? result.path).join('\n'),
  });
};

/**
 * Files removed with Remove from disk sit in Tarab's recoverable Trash until restored or deleted
 * here. Before this list, they could only be restored from the one-time undo dialog.
 */
export const RemovedFilesSettings = memo(() => {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<TrashedFileSummary[] | null>(null);
  const [busyToken, setBusyToken] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<Omit<ConfirmDialogProps, 'onCancel'> | null>(
    null,
  );

  const load = useCallback(async () => {
    try {
      setItems(await listTrashedFiles());
    } catch (e) {
      reportError('Failed to load removed files', { source: 'removed-files', error: e });
      setItems([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const restore = useCallback(
    async (tokens: string[]) => {
      setBusyToken(tokens.length === 1 ? tokens[0] : 'all');
      try {
        reportFailures('restored', await restoreTrashedFiles(tokens));
        await invalidateLibraryForMutation(queryClient, 'upsert');
      } catch (e) {
        reportError('Failed to restore files', { source: 'removed-files', error: e });
      } finally {
        setBusyToken(null);
        await load();
      }
    },
    [load, queryClient],
  );

  const purge = useCallback(
    async (tokens: string[]) => {
      setBusyToken(tokens.length === 1 ? tokens[0] : 'all');
      try {
        reportFailures('deleted', await purgeTrashedFiles(tokens));
      } catch (e) {
        reportError('Failed to delete files', { source: 'removed-files', error: e });
      } finally {
        setBusyToken(null);
        await load();
      }
    },
    [load],
  );

  const confirmPurge = useCallback(
    (targets: TrashedFileSummary[]) => {
      const single = targets.length === 1 ? targets[0] : null;
      setConfirmDialog({
        title: single ? 'Delete file permanently' : 'Empty Tarab Trash',
        message: single
          ? `${single.title ?? fileName(single.originalPath)} will be deleted from disk. This cannot be undone.`
          : `${targets.length} files will be deleted from disk. This cannot be undone.`,
        variant: 'danger',
        confirmLabel: single ? 'Delete Permanently' : 'Empty Trash',
        onConfirm: () => purge(targets.map((item) => item.token)),
      });
    },
    [purge],
  );

  const totalBytes = items?.reduce((sum, item) => sum + item.sizeBytes, 0) ?? 0;

  return (
    <>
      <SettingsSection
        title="Removed Files"
        description={
          items && items.length > 0
            ? `${items.length} ${items.length === 1 ? 'file' : 'files'} in Tarab Trash, using ${formatBytes(totalBytes)}.`
            : 'Files removed from disk stay here until you restore or delete them.'
        }
        icon={<ArchiveRestore size={16} />}
        actions={
          items && items.length > 0 ? (
            <SettingsActionButton
              size="sm"
              tone="danger"
              onClick={() => confirmPurge(items)}
              disabled={busyToken !== null}
            >
              <Trash2 size={14} /> Empty Trash
            </SettingsActionButton>
          ) : null
        }
      >
        {items === null ? (
          <SettingsRow label="Loading removed files" description="Reading Tarab Trash." />
        ) : items.length === 0 ? (
          <SettingsRow label="No removed files" description="Tarab Trash is empty." />
        ) : (
          items.map((item) => (
            <SettingsRow
              key={item.token}
              label={item.title ?? fileName(item.originalPath)}
              description={[
                item.artist,
                item.originalPath,
                formatBytes(item.sizeBytes),
                item.trashedAtMs ? new Date(item.trashedAtMs).toLocaleDateString() : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              control={
                <div className="flex gap-2">
                  <SettingsActionButton
                    size="sm"
                    onClick={() => void restore([item.token])}
                    disabled={busyToken !== null}
                  >
                    {busyToken === item.token ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <ArchiveRestore size={14} />
                    )}
                    Restore
                  </SettingsActionButton>
                  <SettingsActionButton
                    size="sm"
                    tone="danger"
                    onClick={() => confirmPurge([item])}
                    disabled={busyToken !== null}
                    aria-label={`Delete ${item.title ?? fileName(item.originalPath)} permanently`}
                  >
                    <Trash2 size={14} />
                  </SettingsActionButton>
                </div>
              }
            />
          ))
        )}
      </SettingsSection>

      {confirmDialog && (
        <ConfirmDialog {...confirmDialog} onCancel={() => setConfirmDialog(null)} />
      )}
    </>
  );
});

RemovedFilesSettings.displayName = 'RemovedFilesSettings';
