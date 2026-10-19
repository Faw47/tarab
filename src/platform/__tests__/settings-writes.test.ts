import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTauriZustandStorage, flushSettingsWrites } from '../tauri-zustand-storage';

vi.unmock('../tauri-zustand-storage');

const mocks = vi.hoisted(() => ({ set: vi.fn(), remove: vi.fn(), error: vi.fn() }));
vi.mock('../../lib/tauri-commands', () => ({
  fixedStoreGet: vi.fn(async () => null),
  fixedStoreSet: mocks.set,
  fixedStoreRemove: mocks.remove,
}));
vi.mock('../logger', () => ({ logger: { error: mocks.error } }));
const storage = createTauriZustandStorage('settings.json');

describe('pending settings writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.set.mockResolvedValue(undefined);
    mocks.remove.mockResolvedValue(undefined);
  });

  it('waits for consent writes and writes added during a drain', async () => {
    let finishFirst: () => void = () => undefined;
    let finishSecond: () => void = () => undefined;
    mocks.set.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    mocks.set.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishSecond = resolve;
        }),
    );
    const first = storage.setItem(
      'tarab-settings',
      JSON.stringify({ state: { autoLyrics: true } }),
    );
    let drained = false;
    const draining = flushSettingsWrites().then(() => {
      drained = true;
    });
    const second = storage.setItem(
      'tarab-settings',
      JSON.stringify({ state: { autoLyrics: false } }),
    );
    finishFirst();
    await first;
    await Promise.resolve();
    expect(drained).toBe(false);
    finishSecond();
    await Promise.all([second, draining]);
    expect(drained).toBe(true);
  });

  it('does not poison later drains after a failed write', async () => {
    mocks.set.mockRejectedValueOnce(new Error('disk full'));
    const write = storage.setItem('tarab-settings', '{}');
    await flushSettingsWrites();
    await write;
    expect(mocks.error).toHaveBeenCalled();
    await expect(flushSettingsWrites()).resolves.toBeUndefined();
  });

  it('waits for settings removal as well as updates', async () => {
    let finish: () => void = () => undefined;
    mocks.remove.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const removal = storage.removeItem('tarab-settings');
    let drained = false;
    const draining = flushSettingsWrites().then(() => {
      drained = true;
    });
    await Promise.resolve();
    expect(drained).toBe(false);
    finish();
    await Promise.all([removal, draining]);
    expect(drained).toBe(true);
  });
});
