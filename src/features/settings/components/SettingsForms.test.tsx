import { disable, enable, isEnabled } from '@tauri-apps/plugin-autostart';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    { id: 'headphones', name: 'Headphones' },
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

  it('rolls back open-at-login when the OS update fails', async () => {
    vi.mocked(isEnabled).mockResolvedValue(false);
    vi.mocked(enable).mockRejectedValueOnce(new Error('permission denied'));

    render(<DesktopIntegrationForm />);

    await waitFor(() => expect(isEnabled).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('switch', { name: 'Open at login' }));

    await waitFor(() => expect(enable).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useSettingsStore.getState().autostartEnabled).toBe(false));
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

    expect(useSettingsStore.getState().outputDevice).toBe('headphones');
    expect(setAudioOutputDevice).not.toHaveBeenCalled();
  });
  it('keeps system default available when output-device enumeration fails', async () => {
    vi.mocked(listAudioOutputDevices).mockRejectedValueOnce(new Error('no devices'));

    render(<PlaybackSettingsForm />);

    fireEvent.click(screen.getByRole('combobox', { name: 'Select audio output device' }));

    expect(await screen.findByRole('option', { name: 'System default' })).toBeInTheDocument();
    expect(screen.getByText('no devices')).toBeInTheDocument();
  });
});
