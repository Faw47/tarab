import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SHORTCUTS, useSettingsStore } from '../../store/settings-store';
import { useGlobalShortcutsRegistration } from './useGlobalShortcutsRegistration';

const mocks = vi.hoisted(() => ({
  error: vi.fn(),
  registerAll: vi.fn(async () => true),
  unregisterAll: vi.fn(async () => undefined),
}));

vi.mock('../../platform/globalShortcutsManager', () => ({
  globalShortcutsManager: {
    registerAll: mocks.registerAll,
    unregisterAll: mocks.unregisterAll,
  },
}));

vi.mock('../../platform/logger', () => ({
  logger: {
    error: mocks.error,
  },
}));

describe('useGlobalShortcutsRegistration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.registerAll.mockResolvedValue(true);
    mocks.unregisterAll.mockResolvedValue(undefined);
    useSettingsStore.setState({
      globalShortcutsEnabled: false,
      shortcuts: { ...DEFAULT_SHORTCUTS },
    });
  });

  it('registers configured shortcuts when enabled', async () => {
    const shortcuts = {
      playPause: 'CommandOrControl+Shift+Space',
      next: 'CommandOrControl+Shift+Right',
      previous: 'CommandOrControl+Shift+Left',
    };
    useSettingsStore.setState({ globalShortcutsEnabled: true, shortcuts });

    renderHook(() => useGlobalShortcutsRegistration());

    await waitFor(() => expect(mocks.registerAll).toHaveBeenCalledWith(shortcuts));
    expect(mocks.unregisterAll).not.toHaveBeenCalled();
  });

  it('unregisters configured shortcuts on unmount', async () => {
    useSettingsStore.setState({ globalShortcutsEnabled: true });

    const { unmount } = renderHook(() => useGlobalShortcutsRegistration());

    await waitFor(() =>
      expect(mocks.registerAll).toHaveBeenCalledWith(useSettingsStore.getState().shortcuts),
    );
    unmount();

    await waitFor(() => expect(mocks.unregisterAll).toHaveBeenCalledTimes(1));
  });

  it('unregisters shortcuts when disabled', async () => {
    renderHook(() => useGlobalShortcutsRegistration());

    await waitFor(() => expect(mocks.unregisterAll).toHaveBeenCalled());
    expect(mocks.registerAll).not.toHaveBeenCalled();
  });

  it('logs best-effort registration failures', async () => {
    const failure = new Error('shortcut collision');
    mocks.registerAll.mockRejectedValueOnce(failure);
    useSettingsStore.setState({ globalShortcutsEnabled: true });

    renderHook(() => useGlobalShortcutsRegistration());

    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        'GlobalShortcutsRegistration',
        'Failed to register global shortcuts',
        failure,
      ),
    );
  });

  it('logs best-effort unregistration failures', async () => {
    const failure = new Error('integration unavailable');
    mocks.unregisterAll.mockRejectedValueOnce(failure);

    renderHook(() => useGlobalShortcutsRegistration());

    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith(
        'GlobalShortcutsRegistration',
        'Failed to unregister global shortcuts',
        failure,
      ),
    );
  });
});
