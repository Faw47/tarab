import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTauriZustandStorage, flushSettingsWrites } from './tauri-zustand-storage';

vi.unmock('./tauri-zustand-storage');

const { fixedStoreGetMock, fixedStoreRemoveMock, fixedStoreSetMock } = vi.hoisted(() => ({
  fixedStoreGetMock: vi.fn(),
  fixedStoreRemoveMock: vi.fn(),
  fixedStoreSetMock: vi.fn(),
}));

vi.mock('../lib/tauri-commands', () => ({
  fixedStoreGet: fixedStoreGetMock,
  fixedStoreRemove: fixedStoreRemoveMock,
  fixedStoreSet: fixedStoreSetMock,
}));

vi.mock('./logger', () => ({
  logger: { error: vi.fn() },
}));

describe('Tauri Zustand settings storage', () => {
  beforeEach(async () => {
    fixedStoreGetMock.mockReset();
    fixedStoreRemoveMock.mockReset();
    fixedStoreSetMock.mockReset();
    await flushSettingsWrites().catch(() => undefined);
  });

  it('rejects settings hydration when the native read fails', async () => {
    fixedStoreGetMock.mockRejectedValueOnce(new Error('corrupt store'));
    const storage = createTauriZustandStorage('settings.json');

    await expect(storage.getItem('tarab-settings')).rejects.toThrow('corrupt store');
  });

  it('does not overwrite settings after a failed hydration read', async () => {
    fixedStoreGetMock.mockRejectedValueOnce(new Error('corrupt store'));
    const storage = createTauriZustandStorage('settings.json');

    await expect(storage.getItem('tarab-settings')).rejects.toThrow('corrupt store');
    await storage.setItem('tarab-settings', JSON.stringify({ value: 'defaults' }));

    expect(fixedStoreSetMock).not.toHaveBeenCalled();
    await expect(flushSettingsWrites()).rejects.toThrow('corrupt store');
  });

  it('serializes writes and lets quit wait for the latest write', async () => {
    let releaseFirst: (() => void) | undefined;
    fixedStoreSetMock
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            releaseFirst = resolve;
          }),
      )
      .mockResolvedValueOnce(undefined);
    const storage = createTauriZustandStorage('settings.json');
    fixedStoreGetMock.mockResolvedValueOnce(null);
    await storage.getItem('tarab-settings');

    const first = storage.setItem('tarab-settings', JSON.stringify({ value: 1 }));
    const second = storage.setItem('tarab-settings', JSON.stringify({ value: 2 }));

    await vi.waitFor(() => expect(fixedStoreSetMock).toHaveBeenCalledTimes(1));
    let flushed = false;
    const flush = flushSettingsWrites().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);

    releaseFirst?.();
    await Promise.all([first, second, flush]);
    expect(fixedStoreSetMock).toHaveBeenCalledTimes(2);
    expect(flushed).toBe(true);
  });

  it('reports a failed write at flush and accepts later writes', async () => {
    fixedStoreSetMock.mockRejectedValueOnce(new Error('disk full'));
    const storage = createTauriZustandStorage('settings.json');
    fixedStoreGetMock.mockResolvedValueOnce(null);
    await storage.getItem('tarab-settings');

    await storage.setItem('tarab-settings', JSON.stringify({ value: 1 }));
    await expect(flushSettingsWrites()).rejects.toThrow('disk full');

    fixedStoreSetMock.mockResolvedValueOnce(undefined);
    await storage.setItem('tarab-settings', JSON.stringify({ value: 2 }));
    await expect(flushSettingsWrites()).resolves.toBeUndefined();
  });
});
