import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { settingsStoreMock, resetMockSettingsStore } = vi.hoisted(() => {
  type SettingsState = {
    autostartEnabled: boolean;
    desktopStatusIconEnabled: boolean;
    setAutostartEnabled: (enabled: boolean) => void;
  };
  type Listener = (state: SettingsState, previous: SettingsState) => void;

  let state: SettingsState;
  let hydrated = true;
  const listeners = new Set<Listener>();
  const hydrationListeners = new Set<() => void>();
  const setState = (partial: Partial<SettingsState>) => {
    const previous = state;
    state = { ...state, ...partial };
    for (const listener of listeners) listener(state, previous);
  };
  const createState = (): SettingsState => ({
    autostartEnabled: false,
    desktopStatusIconEnabled: true,
    setAutostartEnabled: (enabled) => setState({ autostartEnabled: enabled }),
  });
  state = createState();

  const settingsStoreMock = {
    getState: () => state,
    setState,
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    persist: {
      hasHydrated: () => hydrated,
      onFinishHydration: (listener: () => void) => {
        hydrationListeners.add(listener);
        return () => hydrationListeners.delete(listener);
      },
      rehydrate: async () => {
        hydrated = true;
        for (const listener of [...hydrationListeners]) listener();
        return state;
      },
    },
  };
  const resetMockSettingsStore = () => {
    hydrated = true;
    listeners.clear();
    hydrationListeners.clear();
    state = createState();
  };

  return { settingsStoreMock, resetMockSettingsStore };
});

vi.mock('../../store/settings-store', () => ({ useSettingsStore: settingsStoreMock }));

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
let readOs = async () => true;
let enableOs = async () => undefined;
let disableOs = async () => undefined;
const autostartApi: AutostartApi = {
  isEnabled: async () => {
    autostartCalls.isEnabled += 1;
    return readOs();
  },
  enable: async () => {
    autostartCalls.enable += 1;
    await enableOs();
  },
  disable: async () => {
    autostartCalls.disable += 1;
    await disableOs();
  },
};

describe('app autostart lifecycle', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    resetMockSettingsStore();
    autostartCalls.isEnabled = 0;
    autostartCalls.enable = 0;
    autostartCalls.disable = 0;
    readOs = async () => true;
    enableOs = async () => undefined;
    disableOs = async () => undefined;
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
    readOs = async () => false;
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(false));
    expect(autostartCalls.enable).toBe(0);
    expect(autostartCalls.disable).toBe(0);
  });

  it('applies changes while the settings page is absent and reconciles failures', async () => {
    mount();
    await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(true));
    disableOs = async () => {
      throw new Error('permission denied');
    };
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
    expect(useSettingsStore.persist.hasHydrated()).toBe(true);
    let finish: (enabled: boolean) => void = () => undefined;
    readOs = () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      });
    mount();
    await waitFor(() => expect(autostartCalls.isEnabled).toBe(1));
    act(() => useSettingsStore.getState().setAutostartEnabled(true));
    await waitFor(() => expect(autostartCalls.enable).toBe(1));
    await act(async () => finish(false));
    expect(useSettingsStore.getState().autostartEnabled).toBe(true);
  });

  it('keeps a user toggle made while a focus refresh is pending', async () => {
    expect(useSettingsStore.persist.hasHydrated()).toBe(true);
    mount();
    await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(true));
    let finish: (enabled: boolean) => void = () => undefined;
    readOs = () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      });
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(autostartCalls.isEnabled).toBe(2));
    act(() => useSettingsStore.getState().setAutostartEnabled(false));
    await waitFor(() => expect(autostartCalls.disable).toBe(1));
    await act(async () => finish(true));
    expect(useSettingsStore.getState().autostartEnabled).toBe(false);
  });
});
