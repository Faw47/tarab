import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavView } from '../../../components/navigation';
import { useAppStartupEffects } from '../useAppStartupEffects';

const showMock = vi.hoisted(() => vi.fn(async () => undefined));
const recordPerfBudgetMock = vi.hoisted(() => vi.fn());
const reportErrorMock = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ show: showMock }),
}));

vi.mock('../../../lib/performance', () => ({
  recordPerfBudget: recordPerfBudgetMock,
}));

vi.mock('../../../lib/report-error', () => ({
  reportError: reportErrorMock,
}));

describe('useAppStartupEffects', () => {
  let originalRequestIdleCallback: typeof window.requestIdleCallback | undefined;
  let originalCancelIdleCallback: typeof window.cancelIdleCallback | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    showMock.mockResolvedValue(undefined);
    originalRequestIdleCallback = window.requestIdleCallback;
    originalCancelIdleCallback = window.cancelIdleCallback;
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

  afterEach(() => {
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: originalRequestIdleCallback,
    });
    Object.defineProperty(window, 'cancelIdleCallback', {
      configurable: true,
      value: originalCancelIdleCallback,
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('preloads idle modules, marks startup, and shows the window', async () => {
    const preloadModules = vi.fn();

    renderHook(() => useAppStartupEffects({ currentView: 'home', preloadModules }));

    expect(performance.mark).toHaveBeenCalledWith('startup:app-mounted');
    expect(recordPerfBudgetMock).toHaveBeenCalledWith('startupInteractiveMs', 100);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(showMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(preloadModules).toHaveBeenCalledTimes(1);
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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(reportErrorMock).toHaveBeenCalledWith('Failed to show the main window', {
      source: 'app-startup',
      error: failure,
    });
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
