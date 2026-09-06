import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavView } from '../../../components/navigation';
import { useAppStartupEffects } from '../useAppStartupEffects';

const recordPerfBudgetMock = vi.hoisted(() => vi.fn());

vi.mock('../../../lib/performance', () => ({
  recordPerfBudget: recordPerfBudgetMock,
}));

describe('useAppStartupEffects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('preloads idle modules and leaves native window visibility unchanged', async () => {
    const preloadModules = vi.fn();

    renderHook(() => useAppStartupEffects({ currentView: 'home', preloadModules }));

    expect(performance.mark).toHaveBeenCalledWith('startup:app-mounted');
    expect(recordPerfBudgetMock).toHaveBeenCalledWith('startupInteractiveMs', 100);

    await waitFor(() => expect(preloadModules).toHaveBeenCalledTimes(1), { timeout: 2000 });
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
