import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@tauri-apps/plugin-autostart', () => ({
  isEnabled: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ show: vi.fn(async () => undefined) }),
}));
vi.mock('../../lib/tauri-commands', () => ({
  desktopShouldStartMinimized: vi.fn(async () => false),
}));
vi.mock('../../lib/report-error', () => ({
  logError: vi.fn(),
  reportError: vi.fn(),
}));

import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { reportError } from '../../lib/report-error';
import { useSettingsStore } from '../../store/settings-store';
import { useAppStartupEffects } from './useAppStartupEffects';

describe('app autostart lifecycle', () => {
  beforeEach(async () => {
    await useSettingsStore.persist.rehydrate();
    useSettingsStore.setState({ autostartEnabled: false });
    vi.mocked(isEnabled).mockReset().mockResolvedValue(true);
    vi.mocked(enable).mockReset().mockResolvedValue(undefined);
    vi.mocked(disable).mockReset().mockResolvedValue(undefined);
    vi.stubGlobal('performance', {
      mark: vi.fn(),
      now: () => 0,
      getEntriesByName: () => [],
    });
  });

  const mount = () =>
    renderHook(() => useAppStartupEffects({ currentView: 'home', preloadModules: vi.fn() }));

  it('reads OS state at app startup without mounting the settings page', async () => {
    mount();
    await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(true));
    expect(enable).not.toHaveBeenCalled();
    expect(disable).not.toHaveBeenCalled();
  });

  it('refreshes external changes on window focus without reverting the OS', async () => {
    mount();
    await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(true));
    vi.mocked(isEnabled).mockResolvedValue(false);
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(false));
    expect(enable).not.toHaveBeenCalled();
    expect(disable).not.toHaveBeenCalled();
  });

  it('applies changes while the settings page is absent and reconciles failures', async () => {
    mount();
    await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(true));
    vi.mocked(disable).mockRejectedValue(new Error('permission denied'));
    act(() => useSettingsStore.getState().setAutostartEnabled(false));
    await waitFor(() =>
      expect(reportError).toHaveBeenCalledWith(
        'Failed to sync open at login',
        expect.objectContaining({ source: 'app-autostart' }),
      ),
    );
    expect(useSettingsStore.getState().autostartEnabled).toBe(true);
    expect(enable).not.toHaveBeenCalled();
  });

  it('does not reconcile before settings hydration finishes', async () => {
    let finishHydration: (() => void) | undefined;
    vi.spyOn(useSettingsStore.persist, 'hasHydrated').mockReturnValue(false);
    vi.spyOn(useSettingsStore.persist, 'onFinishHydration').mockImplementation((callback) => {
      finishHydration = () => callback(useSettingsStore.getState());
      return () => undefined;
    });
    mount();
    expect(isEnabled).not.toHaveBeenCalled();
    act(() => finishHydration?.());
    await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(true));
  });
  it('keeps a user toggle made while the initial OS read is pending', async () => {
    let finish: (enabled: boolean) => void = () => undefined;
    vi.mocked(isEnabled).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    mount();
    await waitFor(() => expect(isEnabled).toHaveBeenCalledTimes(1));
    act(() => useSettingsStore.getState().setAutostartEnabled(true));
    await act(async () => finish(false));
    await waitFor(() => expect(enable).toHaveBeenCalledTimes(1));
    expect(useSettingsStore.getState().autostartEnabled).toBe(true);
  });

  it('keeps a user toggle made while a focus refresh is pending', async () => {
    mount();
    await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(true));
    let finish: (enabled: boolean) => void = () => undefined;
    vi.mocked(isEnabled).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(isEnabled).toHaveBeenCalledTimes(2));
    act(() => useSettingsStore.getState().setAutostartEnabled(false));
    await act(async () => finish(true));
    await waitFor(() => expect(disable).toHaveBeenCalledTimes(1));
    expect(useSettingsStore.getState().autostartEnabled).toBe(false);
  });
});
