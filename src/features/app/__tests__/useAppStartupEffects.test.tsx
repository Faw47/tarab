import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavView } from '../../../components/navigation';
import { useAppStartupEffects } from '../useAppStartupEffects';

const showMock = vi.hoisted(() => vi.fn(async () => undefined));
const { minimizedMock, iconEnabledMock, hydratedMock } = vi.hoisted(() => ({
  minimizedMock: vi.fn(async () => false),
  iconEnabledMock: vi.fn(() => true),
  hydratedMock: vi.fn(() => true),
}));
const recordPerfBudgetMock = vi.hoisted(() => vi.fn());
const reportErrorMock = vi.hoisted(() => vi.fn());
const logErrorMock = vi.hoisted(() => vi.fn());
const hydrationListeners = vi.hoisted(() => new Set<() => void>());
const { autostartState, setAutostartMock } = vi.hoisted(() => {
  const autostartState = { enabled: false };
  return {
    autostartState,
    setAutostartMock: vi.fn((enabled: boolean) => {
      autostartState.enabled = enabled;
    }),
  };
});
const isEnabledMock = vi.hoisted(() => vi.fn(async () => false));

vi.mock('@tauri-apps/plugin-autostart', () => ({
  isEnabled: isEnabledMock,
  enable: vi.fn(async () => undefined),
  disable: vi.fn(async () => undefined),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ show: showMock }),
}));

vi.mock('../../../lib/tauri-commands', () => ({
  desktopShouldStartMinimized: minimizedMock,
}));

vi.mock('../../../store/settings-store', () => ({
  useSettingsStore: {
    persist: {
      hasHydrated: hydratedMock,
      onFinishHydration: (listener: () => void) => {
        hydrationListeners.add(listener);
        return () => hydrationListeners.delete(listener);
      },
    },
    getState: () => ({
      desktopStatusIconEnabled: iconEnabledMock(),
      autostartEnabled: autostartState.enabled,
      setAutostartEnabled: setAutostartMock,
    }),
  },
}));

vi.mock('../../../lib/performance', () => ({
  recordPerfBudget: recordPerfBudgetMock,
}));

vi.mock('../../../lib/report-error', () => ({
  reportError: reportErrorMock,
  logError: logErrorMock,
}));

describe('useAppStartupEffects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hydrationListeners.clear();
    autostartState.enabled = false;
    isEnabledMock.mockResolvedValue(false);
    showMock.mockResolvedValue(undefined);
    minimizedMock.mockResolvedValue(false);
    iconEnabledMock.mockReturnValue(true);
    hydratedMock.mockReturnValue(true);
    Object.defineProperty(window, 'requestIdleCallback', { configurable: true, value: undefined });
    Object.defineProperty(window, 'cancelIdleCallback', { configurable: true, value: undefined });
    vi.spyOn(performance, 'mark').mockImplementation(
      (name) =>
        ({
          name: String(name),
          entryType: 'mark',
          startTime: 0,
          duration: 0,
          detail: null,
          toJSON: () => ({}),
        }) as PerformanceMark,
    );
    vi.spyOn(performance, 'getEntriesByName').mockReturnValue([
      { startTime: 10 } as PerformanceEntry,
    ]);
    vi.spyOn(performance, 'now').mockReturnValue(110);
  });

  it('preloads idle modules, marks startup, and shows the window', async () => {
    const preloadModules = vi.fn();

    renderHook(() => useAppStartupEffects({ currentView: 'home', preloadModules }));

    expect(performance.mark).toHaveBeenCalledWith('startup:app-mounted');
    expect(recordPerfBudgetMock).toHaveBeenCalledWith('startupInteractiveMs', 100);

    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(preloadModules).toHaveBeenCalledTimes(1), { timeout: 2000 });
  });

  it('syncs the system login setting while the app is on Home', async () => {
    isEnabledMock.mockResolvedValue(true);

    renderHook(() => useAppStartupEffects({ currentView: 'home', preloadModules: vi.fn() }));

    await waitFor(() => expect(setAutostartMock).toHaveBeenCalledWith(true), { timeout: 1000 });
  });

  it('refreshes the system login setting when the app regains focus', async () => {
    isEnabledMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    renderHook(() => useAppStartupEffects({ currentView: 'home', preloadModules: vi.fn() }));
    await waitFor(() => expect(isEnabledMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      await Promise.resolve();
    });

    await waitFor(() => expect(setAutostartMock).toHaveBeenCalledWith(true), { timeout: 1000 });
  });

  it('rechecks the system login setting after settings hydration completes', async () => {
    hydratedMock.mockReturnValue(false);
    let resolveInitial: ((enabled: boolean) => void) | undefined;
    isEnabledMock
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            resolveInitial = resolve;
          }),
      )
      .mockResolvedValueOnce(true);

    renderHook(() => useAppStartupEffects({ currentView: 'home', preloadModules: vi.fn() }));
    await waitFor(() => expect(isEnabledMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      hydratedMock.mockReturnValue(true);
      for (const listener of [...hydrationListeners]) listener();
      resolveInitial?.(false);
    });

    await waitFor(() => expect(isEnabledMock).toHaveBeenCalledTimes(2));
    expect(setAutostartMock).toHaveBeenLastCalledWith(true);
  });

  it('keeps the main window hidden on autostart with an enabled status icon', async () => {
    minimizedMock.mockResolvedValue(true);

    renderHook(() => useAppStartupEffects({ currentView: 'home', preloadModules: vi.fn() }));
    await waitFor(() => expect(minimizedMock).toHaveBeenCalledTimes(1));

    expect(showMock).not.toHaveBeenCalled();
  });

  it('shows the window on autostart when the status icon is disabled', async () => {
    minimizedMock.mockResolvedValue(true);
    iconEnabledMock.mockReturnValue(false);

    renderHook(() => useAppStartupEffects({ currentView: 'home', preloadModules: vi.fn() }));

    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));
  });

  it('shows the window if settings never finish hydrating on a minimized launch', async () => {
    minimizedMock.mockResolvedValue(true);
    hydratedMock.mockReturnValue(false);
    vi.useFakeTimers();
    try {
      renderHook(() => useAppStartupEffects({ currentView: 'home', preloadModules: vi.fn() }));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3200);
      });
      expect(showMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not show a window after startup effects unmount', async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderHook(() =>
        useAppStartupEffects({ currentView: 'home', preloadModules: vi.fn() }),
      );
      unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(showMock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    'timeout',
    'hydration',
  ] as const)('does not show an unmounted minimized window after settings %s', async (completion) => {
    minimizedMock.mockResolvedValue(true);
    hydratedMock.mockReturnValue(false);
    iconEnabledMock.mockReturnValue(false);
    vi.useFakeTimers();
    try {
      const { unmount } = renderHook(() =>
        useAppStartupEffects({ currentView: 'home', preloadModules: vi.fn() }),
      );
      await act(async () => {
        await Promise.resolve();
      });
      expect(hydrationListeners.size).toBe(1);
      unmount();

      await act(async () => {
        if (completion === 'hydration') {
          hydratedMock.mockReturnValue(true);
          for (const listener of [...hydrationListeners]) listener();
        }
        await vi.advanceTimersByTimeAsync(3200);
      });

      expect(showMock).not.toHaveBeenCalled();
      expect(reportErrorMock).not.toHaveBeenCalled();
      expect(hydrationListeners.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    true,
    false,
  ])('uses the hydrated status-icon setting (%s) before the timeout', async (enabled) => {
    minimizedMock.mockResolvedValue(true);
    hydratedMock.mockReturnValue(false);
    iconEnabledMock.mockReturnValue(enabled);
    vi.useFakeTimers();
    try {
      renderHook(() => useAppStartupEffects({ currentView: 'home', preloadModules: vi.fn() }));
      await act(async () => {
        await Promise.resolve();
      });
      await act(async () => {
        hydratedMock.mockReturnValue(true);
        for (const listener of [...hydrationListeners]) listener();
        await vi.advanceTimersByTimeAsync(3200);
      });

      expect(showMock).toHaveBeenCalledTimes(enabled ? 0 : 1);
      expect(hydrationListeners.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows only the active StrictMode startup after stalled hydration', async () => {
    minimizedMock.mockResolvedValue(true);
    hydratedMock.mockReturnValue(false);
    vi.useFakeTimers();
    try {
      renderHook(() => useAppStartupEffects({ currentView: 'home', preloadModules: vi.fn() }), {
        wrapper: StrictMode,
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3200);
      });

      expect(showMock).toHaveBeenCalledTimes(1);
      expect(hydrationListeners.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the window if the autostart check fails', async () => {
    const failure = new Error('command unavailable');
    minimizedMock.mockRejectedValueOnce(failure);

    renderHook(() => useAppStartupEffects({ currentView: 'home', preloadModules: vi.fn() }));

    await waitFor(() => expect(showMock).toHaveBeenCalledTimes(1));
    expect(logErrorMock).toHaveBeenCalledWith('Failed to read startup window state', {
      source: 'app-startup',
      error: failure,
    });
  });

  it('reports a window-show failure without rejecting startup', async () => {
    const failure = new Error('window unavailable');
    showMock.mockRejectedValueOnce(failure);

    renderHook(() =>
      useAppStartupEffects({
        currentView: 'home',
        preloadModules: vi.fn(),
      }),
    );

    await waitFor(() =>
      expect(reportErrorMock).toHaveBeenCalledWith('Failed to show the main window', {
        source: 'app-startup',
        error: failure,
      }),
    );
  });
  it('marks the first library surface once', () => {
    const preloadModules = vi.fn();
    const { rerender } = renderHook(
      ({ currentView }: { currentView: NavView }) =>
        useAppStartupEffects({ currentView, preloadModules }),
      { initialProps: { currentView: 'home' } },
    );

    rerender({ currentView: 'library' });
    rerender({ currentView: 'search' });

    expect(performance.mark).toHaveBeenCalledWith('startup:first-library-surface');
    expect(
      vi
        .mocked(performance.mark)
        .mock.calls.filter(([markName]) => markName === 'startup:first-library-surface'),
    ).toHaveLength(1);
  });
});
