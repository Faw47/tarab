import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CacheStats,
  cacheClear,
  cacheEnforceLimit,
  cacheGetStats,
} from '../../../lib/tauri-commands';
import { useSettingsStore } from '../../../store/settings-store';
import { CacheSettings } from '../CacheSettings';

vi.mock('../../../lib/tauri-commands', () => ({
  cacheGetStats: vi.fn(async () => ({
    totalSizeBytes: 1024 * 1024,
    fileCount: 12,
    oldestFile: null,
  })),
  cacheEnforceLimit: vi.fn(async () => 0),
  cacheClear: vi.fn(async () => 0),
}));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
};
describe('CacheSettings', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      theme: 'liquid-glass',
      cacheSizeLimitMb: 200,
      clearCacheOnStartup: false,
    });
    vi.clearAllMocks();
  });

  it('loads stats when effects are replayed by Strict Mode', async () => {
    render(
      <StrictMode>
        <CacheSettings />
      </StrictMode>,
    );

    await waitFor(() =>
      expect(screen.getByText('12 files tracked in storage.')).toBeInTheDocument(),
    );
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

  it('keeps the latest stats when cache operations overlap', async () => {
    const first = deferred<CacheStats>();
    const second = deferred<CacheStats>();
    vi.mocked(cacheGetStats)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    render(<CacheSettings />);
    const slider = screen.getByRole('slider') as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '360' } });
    await waitFor(() => expect(useSettingsStore.getState().cacheSizeLimitMb).toBe(360));
    fireEvent.mouseUp(slider);

    await waitFor(() => expect(cacheEnforceLimit).toHaveBeenCalledWith(360));
    await waitFor(() => expect(cacheGetStats).toHaveBeenCalledTimes(2));

    await act(async () => {
      second.resolve({ totalSizeBytes: 2 * 1024 * 1024, fileCount: 2, oldestFile: null });
      await second.promise;
    });
    await waitFor(() =>
      expect(screen.getByText('2 files tracked in storage.')).toBeInTheDocument(),
    );

    await act(async () => {
      first.resolve({ totalSizeBytes: 999 * 1024 * 1024, fileCount: 999, oldestFile: null });
      await first.promise;
    });

    expect(screen.getByText('2 files tracked in storage.')).toBeInTheDocument();
    expect(screen.queryByText('999 files tracked in storage.')).not.toBeInTheDocument();
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
