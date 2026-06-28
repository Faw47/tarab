import { HardDrive, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { memo, useCallback, useEffect, useState } from 'react';

import { reportError } from '../../lib/report-error';
import {
  type CacheStats,
  cacheClear,
  cacheEnforceLimit,
  cacheGetStats,
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
  const [confirmDialog, setConfirmDialog] = useState<Omit<ConfirmDialogProps, 'onCancel'> | null>(null);

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
      message: 'Are you sure you want to clear the image cache? Images will need to be re-downloaded or re-generated.',
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
          <SettingsActionButton size="sm" tone="ghost" onClick={loadStats} disabled={loading} title="Refresh stats">
            <RefreshCw size={14} className={loading ? 'animate-spin' : undefined} /> Refresh
          </SettingsActionButton>
        }
      >
        <SettingsRow
          label="Cover cache"
          description={stats ? `${stats.fileCount} files tracked in storage.` : 'Calculating cache usage.'}
          control={<span className="text-sm font-semibold text-text-primary">{stats ? formatBytes(stats.totalSizeBytes) : '...'}</span>}
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
            <SettingsActionButton size="sm" tone="ghost" onClick={handleEnforceLimit} disabled={loading}>
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
            <SettingsActionButton tone="danger" onClick={handleClearCache} disabled={clearing || !stats?.totalSizeBytes}>
              {clearing ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Clear Image Cache
            </SettingsActionButton>
          }
        />
      </SettingsSection>

      {confirmDialog && <ConfirmDialog {...confirmDialog} onCancel={() => setConfirmDialog(null)} />}
    </>
  );
});

CacheSettings.displayName = 'CacheSettings';

