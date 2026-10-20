import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.unmock('./tauri-zustand-storage');
vi.mock('../lib/tauri-commands', () => ({
  fixedStoreGet: vi.fn(),
  fixedStoreSet: vi.fn(),
  fixedStoreRemove: vi.fn(),
}));
vi.mock('./logger', () => ({ logger: { error: vi.fn() } }));
vi.mock('../lib/report-error', () => ({ reportError: vi.fn() }));

import { reportError } from '../lib/report-error';
import { fixedStoreRemove, fixedStoreSet } from '../lib/tauri-commands';
import { createTauriZustandStorage, flushSettingsWrites } from './tauri-zustand-storage';

describe('settings persistence failure notification', () => {
  const storage = createTauriZustandStorage('settings.json');

  beforeEach(async () => {
    vi.mocked(fixedStoreSet).mockResolvedValue(undefined);
    vi.mocked(fixedStoreRemove).mockResolvedValue(undefined);
    await storage.setItem('tarab-settings', '{}');
    vi.mocked(reportError).mockClear();
  });

  it('reports a failed write once until a later write succeeds', async () => {
    vi.mocked(fixedStoreSet).mockRejectedValue(new Error('disk full'));
    await storage.setItem('tarab-settings', '{}');
    await storage.setItem('tarab-settings', '{}');
    await flushSettingsWrites();
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(
      'Could not save settings. Your changes may be lost when Tarab closes.',
      expect.objectContaining({ source: 'settings-storage' }),
    );

    vi.mocked(fixedStoreSet).mockResolvedValueOnce(undefined);
    await storage.setItem('tarab-settings', '{}');
    await storage.setItem('tarab-settings', '{}');
    expect(reportError).toHaveBeenCalledTimes(2);
  });

  it('reports failed removal through the same persistence warning', async () => {
    vi.mocked(fixedStoreRemove).mockRejectedValue(new Error('read only'));
    await storage.removeItem('tarab-settings');
    await storage.removeItem('tarab-settings');
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});
