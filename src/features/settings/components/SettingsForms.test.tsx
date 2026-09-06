import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listAudioOutputDevices, setAudioOutputDevice } from '../../../lib/tauri-commands';
import { useSettingsStore } from '../../../store/settings-store';
import { DesktopIntegrationForm, PlaybackSettingsForm } from './SettingsForms';

vi.mock('@tauri-apps/plugin-autostart', () => ({
  disable: vi.fn(async () => undefined),
  enable: vi.fn(async () => undefined),
  isEnabled: vi.fn(async () => false),
}));

vi.mock('../../../lib/tauri-commands', () => ({
  listAudioOutputDevices: vi.fn(async () => [
    { id: 'system', name: 'System default', isDefault: true },
    { id: 'cpal-name-v1:4865616470686f6e6573', name: 'Headphones' },
  ]),
  setAudioOutputDevice: vi.fn(async () => undefined),
}));

describe('DesktopIntegrationForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({
      autostartEnabled: false,
      globalShortcutsEnabled: false,
      outputDevice: 'system',
    });
  });

  it('hydrates open-at-login from the OS before applying stored settings', async () => {
    vi.mocked(isEnabled).mockResolvedValue(true);

    render(<DesktopIntegrationForm />);

    await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(true));
    expect(disable).not.toHaveBeenCalled();
    expect(enable).not.toHaveBeenCalled();
  });

  it('waits for successful settings hydration before reconciling open-at-login', async () => {
    let finishHydration: (() => void) | undefined;
    const hasHydrated = vi.spyOn(useSettingsStore.persist, 'hasHydrated').mockReturnValue(false);
    const onFinishHydration = vi
      .spyOn(useSettingsStore.persist, 'onFinishHydration')
      .mockImplementation((listener) => {
        finishHydration = () => listener(useSettingsStore.getState());
        return () => undefined;
      });
    vi.mocked(isEnabled).mockResolvedValue(true);

    const view = render(<DesktopIntegrationForm />);

    expect(isEnabled).not.toHaveBeenCalled();
    expect(screen.getByRole('switch', { name: 'Open at login' })).toBeDisabled();
    expect(useSettingsStore.getState().autostartEnabled).toBe(false);

    hasHydrated.mockReturnValue(true);
    act(() => finishHydration?.());

    await waitFor(() => expect(isEnabled).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(true));
    view.unmount();
    hasHydrated.mockRestore();
    onFinishHydration.mockRestore();
  });

  it('rolls back open-at-login when the OS update fails', async () => {
    vi.mocked(isEnabled).mockResolvedValue(false);
    vi.mocked(enable).mockRejectedValueOnce(new Error('permission denied'));

    render(<DesktopIntegrationForm />);

    await waitFor(() => expect(isEnabled).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('switch', { name: 'Open at login' }));

    await waitFor(() => expect(enable).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(false));
  });

  it('does not let a late hydration read replace a newer user intent', async () => {
    let finishRead: ((enabled: boolean) => void) | undefined;
    vi.mocked(isEnabled).mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          finishRead = resolve;
        }),
    );

    render(<DesktopIntegrationForm />);
    fireEvent.click(screen.getByRole('switch', { name: 'Open at login' }));
    finishRead?.(false);

    await waitFor(() => expect(enable).toHaveBeenCalledTimes(1));
    expect(useSettingsStore.getState().autostartEnabled).toBe(true);
  });

  it('serializes toggles and keeps an older native completion from winning', async () => {
    let finishEnable: (() => void) | undefined;
    vi.mocked(isEnabled).mockResolvedValue(false);
    vi.mocked(enable).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishEnable = resolve;
        }),
    );

    render(<DesktopIntegrationForm />);
    await waitFor(() => expect(isEnabled).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('switch', { name: 'Open at login' }));
    await waitFor(() => expect(enable).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('switch', { name: 'Open at login' }));

    expect(disable).not.toHaveBeenCalled();
    finishEnable?.();
    await waitFor(() => expect(disable).toHaveBeenCalledTimes(1));
    expect(useSettingsStore.getState().autostartEnabled).toBe(false);
  });

  it('cancels shortcut edits with Escape instead of committing the draft', async () => {
    useSettingsStore.setState({
      globalShortcutsEnabled: true,
      shortcuts: { playPause: 'Ctrl+Space', next: 'Ctrl+Right', previous: 'Ctrl+Left' },
    });

    render(<DesktopIntegrationForm />);

    const input = screen.getByRole('textbox', { name: 'Play/Pause shortcut' });
    fireEvent.change(input, { target: { value: 'Alt+P' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => expect(useSettingsStore.getState().shortcuts.playPause).toBe('Ctrl+Space'));
    expect(input).toHaveValue('Ctrl+Space');
  });
});

describe('PlaybackSettingsForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.setState({ outputDevice: 'system' });
  });

  it('stores output-device selection without directly applying it twice', async () => {
    render(<PlaybackSettingsForm />);

    fireEvent.click(screen.getByRole('combobox', { name: 'Select audio output device' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Headphones' }));

    expect(useSettingsStore.getState().outputDevice).toBe('cpal-name-v1:4865616470686f6e6573');
    expect(setAudioOutputDevice).not.toHaveBeenCalled();
  });
  it('keeps system default available when output-device enumeration fails', async () => {
    vi.mocked(listAudioOutputDevices).mockRejectedValueOnce(new Error('no devices'));

    render(<PlaybackSettingsForm />);

    fireEvent.click(screen.getByRole('combobox', { name: 'Select audio output device' }));

    expect(await screen.findByRole('option', { name: 'System default' })).toBeInTheDocument();
    expect(screen.getByText('no devices')).toBeInTheDocument();
  });

  it('shows a saved device when enumeration fails before any device list is available', async () => {
    const savedDevice = 'cpal-v1:saved-device';
    useSettingsStore.setState({ outputDevice: savedDevice });
    vi.mocked(listAudioOutputDevices).mockRejectedValueOnce(
      new Error('device service unavailable'),
    );

    render(<PlaybackSettingsForm />);

    fireEvent.click(screen.getByRole('combobox', { name: 'Select audio output device' }));
    await waitFor(() => expect(screen.getByText('device service unavailable')).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Saved device (unavailable)' })).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    );
    expect(screen.getByRole('option', { name: 'Saved device (unavailable)' })).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'Select audio output device' })).toHaveTextContent(
      'Saved device (unavailable)',
    );
  });
  it('migrates a legacy plain name only when it identifies one enumerated device', async () => {
    useSettingsStore.setState({ outputDevice: 'Headphones' });

    render(<PlaybackSettingsForm />);

    await waitFor(() =>
      expect(useSettingsStore.getState().outputDevice).toBe('cpal-name-v1:4865616470686f6e6573'),
    );
  });

  it('resets a missing persisted ID to system default', async () => {
    useSettingsStore.setState({ outputDevice: 'cpal-v1:missing:0' });

    render(<PlaybackSettingsForm />);

    await waitFor(() => expect(useSettingsStore.getState().outputDevice).toBe('system'));
  });

  it('falls back safely when an old duplicate ordinal alias is no longer selectable', async () => {
    vi.mocked(listAudioOutputDevices).mockResolvedValueOnce([
      { id: 'system', name: 'System default' },
    ]);
    useSettingsStore.setState({ outputDevice: 'cpal-v1:537065616b657273:1' });

    render(<PlaybackSettingsForm />);
    fireEvent.click(screen.getByRole('combobox', { name: 'Select audio output device' }));

    await waitFor(() => expect(useSettingsStore.getState().outputDevice).toBe('system'));
    expect(screen.queryByRole('option', { name: /Speakers/ })).not.toBeInTheDocument();
  });
  it('can refresh output devices after an enumeration failure', async () => {
    vi.mocked(listAudioOutputDevices)
      .mockRejectedValueOnce(new Error('device service unavailable'))
      .mockResolvedValueOnce([
        { id: 'system', name: 'System default' },
        { id: 'cpal-name-v1:537065616b657273', name: 'Speakers' },
      ]);

    render(<PlaybackSettingsForm />);

    await waitFor(() => expect(screen.getByText('device service unavailable')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Refresh audio output devices' }));

    await waitFor(() => expect(listAudioOutputDevices).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('combobox', { name: 'Select audio output device' }));
    expect(await screen.findByRole('option', { name: 'Speakers' })).toBeInTheDocument();
    expect(screen.queryByText('device service unavailable')).not.toBeInTheDocument();
  });
});
