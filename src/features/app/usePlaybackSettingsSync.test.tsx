import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettingsStore } from '../../store/settings-store';
import { usePlaybackSettingsSync } from './usePlaybackSettingsSync';

const { reportErrorMock, setCrossfadeDurationMock, switchAudioOutputDeviceMock } = vi.hoisted(
  () => ({
    reportErrorMock: vi.fn(),
    setCrossfadeDurationMock: vi.fn(async () => undefined),
    switchAudioOutputDeviceMock: vi.fn(),
  }),
);

vi.mock('../../lib/playback-actions', () => ({
  switchAudioOutputDevice: switchAudioOutputDeviceMock,
}));
vi.mock('../../lib/report-error', () => ({ reportError: reportErrorMock }));
vi.mock('../../lib/tauri-commands', () => ({
  setCrossfadeDuration: setCrossfadeDurationMock,
}));

describe('usePlaybackSettingsSync output devices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ outputDevice: 'system', crossfadeSeconds: 0 });
    switchAudioOutputDeviceMock.mockImplementation(async (deviceId: string) => ({
      status: 'selected',
      deviceId,
    }));
  });

  it('persists a typed native fallback so UI and the installed endpoint stay aligned', async () => {
    useSettingsStore.setState({ outputDevice: 'cpal-v1:missing:0' });
    switchAudioOutputDeviceMock.mockResolvedValueOnce({
      status: 'fallback',
      deviceId: 'system',
      reason: 'notFound',
    });

    renderHook(() => usePlaybackSettingsSync());

    await waitFor(() => expect(useSettingsStore.getState().outputDevice).toBe('system'));
    expect(switchAudioOutputDeviceMock).toHaveBeenNthCalledWith(1, 'cpal-v1:missing:0');
    expect(switchAudioOutputDeviceMock).toHaveBeenCalledTimes(1);
  });

  it('persists the exact enumerated ID returned for a safe legacy-name migration', async () => {
    useSettingsStore.setState({ outputDevice: 'Headphones' });
    switchAudioOutputDeviceMock.mockResolvedValueOnce({
      status: 'migrated',
      deviceId: 'cpal-name-v1:4865616470686f6e6573',
    });

    renderHook(() => usePlaybackSettingsSync());

    await waitFor(() =>
      expect(useSettingsStore.getState().outputDevice).toBe('cpal-name-v1:4865616470686f6e6573'),
    );
    expect(switchAudioOutputDeviceMock).toHaveBeenCalledTimes(1);
  });

  it('recovers from a transient output-device failure before reporting an error', async () => {
    const error = new Error('device temporarily unavailable');
    switchAudioOutputDeviceMock.mockRejectedValueOnce(error);

    renderHook(() => usePlaybackSettingsSync());

    await waitFor(() => expect(switchAudioOutputDeviceMock).toHaveBeenCalledTimes(2));
    expect(reportErrorMock).not.toHaveBeenCalledWith('Failed to apply audio output device', {
      source: 'playback-settings',
      error,
    });
  });

  it('reports output-device application failures while the sync hook is mounted', async () => {
    const error = new Error('device unavailable');
    switchAudioOutputDeviceMock.mockRejectedValue(error);

    renderHook(() => usePlaybackSettingsSync());

    await waitFor(() =>
      expect(reportErrorMock).toHaveBeenCalledWith('Failed to apply audio output device', {
        source: 'playback-settings',
        error,
      }),
    );
    expect(switchAudioOutputDeviceMock).toHaveBeenCalledTimes(3);
  });

  it('does not let an obsolete fallback overwrite a newer device choice', async () => {
    let resolveOld: ((value: unknown) => void) | undefined;
    useSettingsStore.setState({ outputDevice: 'old-device' });
    switchAudioOutputDeviceMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          }),
      )
      .mockResolvedValueOnce({ status: 'selected', deviceId: 'new-device' });
    renderHook(() => usePlaybackSettingsSync());
    await waitFor(() => expect(switchAudioOutputDeviceMock).toHaveBeenCalledWith('old-device'));

    await act(async () => useSettingsStore.getState().setOutputDevice('new-device'));
    await waitFor(() => expect(switchAudioOutputDeviceMock).toHaveBeenCalledWith('new-device'));
    await act(async () => {
      resolveOld?.({ status: 'fallback', deviceId: 'system', reason: 'notFound' });
    });

    expect(useSettingsStore.getState().outputDevice).toBe('new-device');
  });
});
