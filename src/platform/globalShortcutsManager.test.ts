import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  errorMock,
  playAdjacentTrackMock,
  registerMock,
  toggleCurrentPlaybackMock,
  unregisterAllMock,
  warnMock,
} = vi.hoisted(() => ({
  errorMock: vi.fn(),
  playAdjacentTrackMock: vi.fn(async () => null),
  registerMock: vi.fn(async () => true),
  toggleCurrentPlaybackMock: vi.fn(async () => undefined),
  unregisterAllMock: vi.fn(async () => undefined),
  warnMock: vi.fn(),
}));

vi.mock('./globalShortcuts', () => ({
  globalShortcuts: {
    register: registerMock,
    unregisterAll: unregisterAllMock,
  },
}));

vi.mock('./logger', () => ({
  logger: {
    debug: vi.fn(),
    error: errorMock,
    info: vi.fn(),
    warn: warnMock,
  },
}));

vi.mock('../lib/playback-actions', () => ({
  playAdjacentTrack: playAdjacentTrackMock,
  toggleCurrentPlayback: toggleCurrentPlaybackMock,
}));

import { globalShortcutsManager } from './globalShortcutsManager';

describe('globalShortcutsManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    playAdjacentTrackMock.mockResolvedValue(null);
    toggleCurrentPlaybackMock.mockResolvedValue(undefined);
  });

  it('skips duplicate shortcut bindings instead of registering collisions', async () => {
    const result = await globalShortcutsManager.registerAll({
      playPause: 'CommandOrControl+Alt+Space',
      next: 'CommandOrControl+Alt+Space',
      previous: 'CommandOrControl+Alt+Left',
    });

    expect(result).toBe(false);
    expect(unregisterAllMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledTimes(2);
    expect(registerMock).toHaveBeenNthCalledWith(
      1,
      'CommandOrControl+Alt+Space',
      expect.any(Function),
    );
    expect(registerMock).toHaveBeenNthCalledWith(
      2,
      'CommandOrControl+Alt+Left',
      expect.any(Function),
    );
    expect(warnMock).toHaveBeenCalledWith(
      'GlobalShortcutsManager',
      'Skipping duplicate global shortcut for next: CommandOrControl+Alt+Space',
    );
  });

  it('logs playback action failures raised by registered shortcut callbacks', async () => {
    const failure = new Error('audio backend unavailable');
    toggleCurrentPlaybackMock.mockRejectedValueOnce(failure);

    await globalShortcutsManager.registerAll({
      playPause: 'CommandOrControl+Alt+Space',
      next: 'CommandOrControl+Alt+Right',
      previous: 'CommandOrControl+Alt+Left',
    });

    const calls = registerMock.mock.calls as unknown as Array<[string, (state: string) => void]>;
    calls[0][1]('Pressed');
    await Promise.resolve();

    expect(errorMock).toHaveBeenCalledWith(
      'GlobalShortcutsManager',
      'Global shortcut action failed: playPause',
      failure,
    );
  });
});
