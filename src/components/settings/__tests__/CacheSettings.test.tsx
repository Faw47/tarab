import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { CacheSettings } from '../CacheSettings';
import { useSettingsStore } from '../../../store/settings-store';

import { cacheClear, cacheEnforceLimit } from '../../../lib/tauri-commands';

vi.mock('../../../lib/tauri-commands', () => ({
  cacheGetStats: vi.fn(async () => ({
    totalSizeBytes: 1024 * 1024,
    fileCount: 12,
    oldestFile: null,
  })),
  cacheEnforceLimit: vi.fn(async () => 0),
  cacheClear: vi.fn(async () => 0),
}));

describe('CacheSettings', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      theme: 'liquid-glass',
      cacheSizeLimitMb: 200,
      clearCacheOnStartup: false,
    });
    vi.clearAllMocks();
  });

  it('updates zustand cacheSizeLimitMb when the slider changes', () => {
    render(<CacheSettings />);

    const slider = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '350' } });

    expect(useSettingsStore.getState().cacheSizeLimitMb).toBe(350);
  });

  it('calls cacheEnforceLimit on slider mouse up', async () => {
    render(<CacheSettings />);

    const slider = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '360' } });

    await waitFor(() => {
      expect(useSettingsStore.getState().cacheSizeLimitMb).toBe(360);
    });

    fireEvent.mouseUp(slider);

    await waitFor(() => {
      expect(cacheEnforceLimit).toHaveBeenLastCalledWith(360);
    });
  });

  it('invokes cacheClear when confirming “Clear Cache”', async () => {
    render(<CacheSettings />);

    const clearButton = await screen.findByRole('button', { name: /Clear Image Cache/i });

    await waitFor(() => expect(clearButton).toBeEnabled());
    fireEvent.click(clearButton);

    const confirmButton = await screen.findByRole('button', { name: /Clear Cache/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(cacheClear).toHaveBeenCalledWith(0);
    });
  });
});

