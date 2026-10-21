import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dbGetTracksPaginated, setVolumeRamp, watchLibraryPaths } from '../tauri-commands';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async () => undefined),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('../performance', () => ({
  Perf: {
    measureIPC: (cmd: string, args: unknown, invoke: (cmd: string, args?: unknown) => unknown) =>
      invoke(cmd, args),
  },
}));

describe('tauri command wrappers', () => {
  beforeEach(() => {
    invokeMock.mockClear();
  });

  it('sends a keyset cursor with camelCase database arguments', async () => {
    const cursor = { id: '/music/next.flac', value: 'Next' };
    await dbGetTracksPaginated(cursor, 200, 'title', 'asc');

    expect(invokeMock).toHaveBeenCalledWith('db_get_tracks_paginated', {
      cursor,
      limit: 200,
      sortBy: 'title',
      sortOrder: 'asc',
    });
  });

  it('uses Tauri camelCase argument names for set_volume_ramp', async () => {
    await setVolumeRamp(0.1, 0.8, 124.6);

    expect(invokeMock).toHaveBeenCalledWith('set_volume_ramp', {
      from: 0.1,
      to: 0.8,
      durationMs: 125,
    });
  });

  it('sends watch requests one at a time in call order', async () => {
    let finishFirst: () => void = () => undefined;
    invokeMock.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          finishFirst = () => resolve(undefined);
        }),
    );

    const cleanup = watchLibraryPaths([]);
    const next = watchLibraryPaths(['/music']);
    await Promise.resolve();
    await Promise.resolve();

    // Regression for AR-19: the second request must not reach the native side first.
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenLastCalledWith('watch_library_paths', { paths: [] });
    finishFirst();
    await Promise.all([cleanup, next]);
    expect(invokeMock).toHaveBeenLastCalledWith('watch_library_paths', { paths: ['/music'] });
  });
});
