import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { reportError } from '../../lib/report-error';
import { useSettingsStore } from '../../store/settings-store';
import { useAppStartupEffects } from './useAppStartupEffects';
import type { AutostartApi } from './useAutostartIntegration';

const autostartCalls = { isEnabled: 0, enable: 0, disable: 0 };
const autostartApi: AutostartApi = {
  isEnabled: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
};

describe('app autostart lifecycle', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(async () => {
    await useSettingsStore.persist.rehydrate();
    await waitFor(() => expect(useSettingsStore.persist.hasHydrated()).toBe(true));
    useSettingsStore.setState({ autostartEnabled: false });
    autostartCalls.isEnabled = 0;
    autostartCalls.enable = 0;
    autostartCalls.disable = 0;
    vi.mocked(autostartApi.isEnabled)
      .mockReset()
      .mockImplementation(async () => {
        autostartCalls.isEnabled += 1;
        return true;
      });
    vi.mocked(autostartApi.enable)
      .mockReset()
      .mockImplementation(async () => {
        autostartCalls.enable += 1;
      });
    vi.mocked(autostartApi.disable)
      .mockReset()
      .mockImplementation(async () => {
        autostartCalls.disable += 1;
      });
    vi.mocked(reportError).mockClear();
    vi.stubGlobal('performance', {
      mark: vi.fn(),
      now: () => 0,
      getEntriesByName: () => [],
    });
  });

  const mount = () =>
    renderHook(() =>
      useAppStartupEffects({ currentView: 'home', preloadModules: vi.fn(), autostartApi }),
    );

  it('reads OS state at app startup without mounting the settings page', async () => {
    mount();
    await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(true));
    expect(autostartCalls.enable).toBe(0);
    expect(autostartCalls.disable).toBe(0);
  });

  it('refreshes external changes on window focus without reverting the OS', async () => {
    mount();
    await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(true));
    vi.mocked(autostartApi.isEnabled).mockImplementation(async () => {
      autostartCalls.isEnabled += 1;
      return false;
    });
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(false));
    expect(autostartCalls.enable).toBe(0);
    expect(autostartCalls.disable).toBe(0);
  });

  it('applies changes while the settings page is absent and reconciles failures', async () => {
    mount();
    await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(true));
    vi.mocked(autostartApi.disable).mockImplementation(async () => {
      autostartCalls.disable += 1;
      throw new Error('permission denied');
    });
    act(() => useSettingsStore.getState().setAutostartEnabled(false));
    await waitFor(() =>
      expect(reportError).toHaveBeenCalledWith(
        'Failed to sync open at login',
        expect.objectContaining({ source: 'app-autostart' }),
      ),
    );
    expect(useSettingsStore.getState().autostartEnabled).toBe(true);
    expect(autostartCalls.enable).toBe(0);
  });

  it('keeps a user toggle made while the initial OS read is pending', async () => {
    let finish: (enabled: boolean) => void = () => undefined;
    vi.mocked(autostartApi.isEnabled).mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          autostartCalls.isEnabled += 1;
          finish = resolve;
        }),
    );
    mount();
    await waitFor(() => expect(autostartCalls.isEnabled).toBe(1));
    act(() => useSettingsStore.getState().setAutostartEnabled(true));
    await waitFor(() => expect(autostartCalls.enable).toBe(1));
    await act(async () => finish(false));
    expect(useSettingsStore.getState().autostartEnabled).toBe(true);
  });

  it('keeps a user toggle made while a focus refresh is pending', async () => {
    mount();
    await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(true));
    let finish: (enabled: boolean) => void = () => undefined;
    vi.mocked(autostartApi.isEnabled).mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          autostartCalls.isEnabled += 1;
          finish = resolve;
        }),
    );
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(autostartCalls.isEnabled).toBe(2));
    act(() => useSettingsStore.getState().setAutostartEnabled(false));
    await waitFor(() => expect(autostartCalls.disable).toBe(1));
    await act(async () => finish(true));
    expect(useSettingsStore.getState().autostartEnabled).toBe(false);
  });
});
