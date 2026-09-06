import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetCacheMaintenanceForTests, useCacheMaintenance } from './useCacheMaintenance';

const { cacheClearMock, cacheEnforceLimitMock, hydrationListeners, settingsState } = vi.hoisted(
  () => ({
    cacheClearMock: vi.fn(),
    cacheEnforceLimitMock: vi.fn(),
    hydrationListeners: new Set<() => void>(),
    settingsState: {
      cacheSizeLimitMb: 320,
      clearCacheOnStartup: true,
      hydrated: false,
    },
  }),
);

vi.mock('../../lib/tauri-commands', () => ({
  cacheClear: cacheClearMock,
  cacheEnforceLimit: cacheEnforceLimitMock,
}));
vi.mock('../../store/settings-store', () => {
  const store = (selector: (state: typeof settingsState) => unknown) => selector(settingsState);
  store.getState = () => settingsState;
  store.persist = {
    hasHydrated: () => settingsState.hydrated,
    onFinishHydration: (listener: () => void) => {
      hydrationListeners.add(listener);
      return () => hydrationListeners.delete(listener);
    },
  };
  return { useSettingsStore: store };
});

describe('useCacheMaintenance', () => {
  beforeEach(async () => {
    await resetCacheMaintenanceForTests();
    cacheClearMock.mockReset().mockResolvedValue(undefined);
    cacheEnforceLimitMock.mockReset().mockResolvedValue(undefined);
    hydrationListeners.clear();
    settingsState.hydrated = false;
    settingsState.cacheSizeLimitMb = 320;
    settingsState.clearCacheOnStartup = true;
  });

  it('waits for successful settings hydration before destructive startup work', async () => {
    renderHook(() => useCacheMaintenance());

    expect(cacheClearMock).not.toHaveBeenCalled();
    expect(cacheEnforceLimitMock).not.toHaveBeenCalled();

    act(() => {
      settingsState.hydrated = true;
      hydrationListeners.forEach((listener) => listener());
    });

    await waitFor(() => expect(cacheClearMock).toHaveBeenCalledTimes(1));
    expect(cacheEnforceLimitMock).toHaveBeenCalledWith(320);
  });

  it('runs clear-on-start only once across a remount', async () => {
    settingsState.hydrated = true;
    const first = renderHook(() => useCacheMaintenance());
    await waitFor(() => expect(cacheClearMock).toHaveBeenCalledTimes(1));
    first.unmount();

    renderHook(() => useCacheMaintenance());
    await Promise.resolve();

    expect(cacheClearMock).toHaveBeenCalledTimes(1);
    expect(cacheEnforceLimitMock).toHaveBeenCalledTimes(1);
  });
});
