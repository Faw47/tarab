import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from '../../store/player-store';
import { useSessionPersistence } from '../useSessionPersistence';

const { hydrated, save } = vi.hoisted(() => ({
  hydrated: vi.fn(() => true),
  save: vi.fn(async (_value: unknown) => undefined),
}));
vi.mock('../../features/app/player-state-store', () => ({
  isPlayerStateHydrated: hydrated,
  savePlayerStateToStore: save,
}));
vi.mock('../../platform/tauri-zustand-storage', () => ({
  createTauriZustandStorage: () => ({
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
  }),
}));
const initial = usePlayerStore.getState();

describe('session save lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    hydrated.mockReturnValue(true);
    save.mockResolvedValue(undefined);
    usePlayerStore.setState(initial, true);
  });
  afterEach(() => vi.useRealTimers());

  it('cancels the pending debounce after an explicit fresh save', async () => {
    const { result } = renderHook(() => useSessionPersistence('home', null));
    await act(async () => result.current.flushSessionSave());
    act(() => result.current.scheduleSessionSave());
    usePlayerStore.setState({ currentTime: 42 });
    await act(async () => result.current.flushSessionSave());
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ currentTime: 42 }));
  });

  it('does not run a stale save timer after unmount', async () => {
    const { result, unmount } = renderHook(() => useSessionPersistence('home', null));
    await act(async () => result.current.flushSessionSave());
    act(() => result.current.scheduleSessionSave());
    unmount();
    await act(async () => vi.advanceTimersByTimeAsync(6000));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('propagates explicit save failures so quit can be cancelled', async () => {
    save.mockRejectedValueOnce(new Error('disk full'));
    const { result } = renderHook(() => useSessionPersistence('home', null));
    await expect(result.current.flushSessionSave()).rejects.toThrow('disk full');
    expect(result.current.lastSessionSaveRef.current).toBe(0);
  });

  it('does not build a default-state write before hydration', async () => {
    hydrated.mockReturnValue(false);
    const { result } = renderHook(() => useSessionPersistence('home', null));
    await result.current.flushSessionSave();
    expect(save).not.toHaveBeenCalled();
  });
});
