import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { errorMock, emitToMock, registerMock, unregisterMock, warnMock } = vi.hoisted(() => ({
  errorMock: vi.fn(),
  emitToMock: vi.fn(async () => undefined),
  registerMock: vi.fn(async () => true),
  unregisterMock: vi.fn(async () => true),
  warnMock: vi.fn(),
}));

vi.mock('./globalShortcuts', () => ({
  globalShortcuts: {
    register: registerMock,
    unregister: unregisterMock,
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

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: emitToMock,
}));

import { getGlobalShortcutOwner, globalShortcutsManager } from './globalShortcutsManager';

describe('global shortcut platform policy', () => {
  it.each([
    ['Linux x86_64', 'CommandOrControl+Alt+Right'],
    ['Linux aarch64', 'Alt+Ctrl+ArrowLeft'],
    ['linux', 'cmdorctrl + alt + arrowright'],
  ])('assigns the Linux menu-owned chords to the native menu on %s', (platform, shortcut) => {
    expect(getGlobalShortcutOwner(shortcut, platform)).toBe('linux-menu');
  });

  it.each(['Win32', 'MacIntel'])('leaves default chords renderer-owned on %s', (platform) => {
    expect(getGlobalShortcutOwner('CommandOrControl+Alt+Right', platform)).toBe('renderer-global');
    expect(getGlobalShortcutOwner('CommandOrControl+Alt+Left', platform)).toBe('renderer-global');
  });

  it('leaves user-custom Linux chords renderer-owned', () => {
    expect(getGlobalShortcutOwner('CommandOrControl+Shift+Right', 'Linux x86_64')).toBe(
      'renderer-global',
    );
    expect(getGlobalShortcutOwner('CommandOrControl+Shift+Left', 'Linux x86_64')).toBe(
      'renderer-global',
    );
  });
});

describe('globalShortcutsManager', () => {
  beforeEach(async () => {
    await globalShortcutsManager.unregisterAll();
    vi.clearAllMocks();
    emitToMock.mockResolvedValue(undefined);
    registerMock.mockResolvedValue(true);
    unregisterMock.mockResolvedValue(true);
    vi.stubGlobal('navigator', { platform: 'Win32' });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('leaves default Next and Previous chords to the Linux app menu', async () => {
    vi.stubGlobal('navigator', { platform: 'Linux x86_64' });

    const result = await globalShortcutsManager.registerAll({
      playPause: 'CommandOrControl+Alt+Space',
      next: 'CommandOrControl+Alt+Right',
      previous: 'CommandOrControl+Alt+Left',
    });

    expect(result).toBe(true);
    expect(registerMock).toHaveBeenCalledTimes(1);
    expect(registerMock).toHaveBeenCalledWith('CommandOrControl+Alt+Space', expect.any(Function));
  });

  it('registers user-custom Next and Previous chords on Linux', async () => {
    vi.stubGlobal('navigator', { platform: 'Linux x86_64' });

    const result = await globalShortcutsManager.registerAll({
      playPause: 'CommandOrControl+Alt+Space',
      next: 'CommandOrControl+Shift+Right',
      previous: 'CommandOrControl+Shift+Left',
    });

    expect(result).toBe(true);
    expect(registerMock).toHaveBeenCalledTimes(3);
    expect(registerMock).toHaveBeenNthCalledWith(
      2,
      'CommandOrControl+Shift+Right',
      expect.any(Function),
    );
    expect(registerMock).toHaveBeenNthCalledWith(
      3,
      'CommandOrControl+Shift+Left',
      expect.any(Function),
    );
  });

  it('registers the default chords through the renderer off Linux', async () => {
    const result = await globalShortcutsManager.registerAll({
      playPause: 'CommandOrControl+Alt+Space',
      next: 'CommandOrControl+Alt+Right',
      previous: 'CommandOrControl+Alt+Left',
    });

    expect(result).toBe(true);
    expect(registerMock).toHaveBeenCalledTimes(3);
  });

  it('skips duplicate shortcut bindings instead of registering collisions', async () => {
    const result = await globalShortcutsManager.registerAll({
      playPause: 'CommandOrControl+Alt+Space',
      next: 'CommandOrControl+Alt+Space',
      previous: 'CommandOrControl+Alt+Left',
    });

    expect(result).toBe(false);
    expect(unregisterMock).not.toHaveBeenCalled();
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

  it('routes callbacks through the canonical desktop action event', async () => {
    const failure = new Error('audio backend unavailable');
    emitToMock.mockRejectedValueOnce(failure);

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
      'Global shortcut action failed: toggle-play',
      failure,
    );
  });

  it('retains ownership when unregistration fails so cleanup can retry', async () => {
    await globalShortcutsManager.registerAll({
      playPause: 'CommandOrControl+Alt+Space',
      next: 'CommandOrControl+Alt+Right',
      previous: 'CommandOrControl+Alt+Left',
    });
    unregisterMock.mockResolvedValueOnce(false);

    await expect(globalShortcutsManager.unregisterAll()).rejects.toThrow(
      'Failed to unregister 1 owned global shortcut',
    );
    unregisterMock.mockClear();
    await globalShortcutsManager.unregisterAll();

    expect(unregisterMock).toHaveBeenCalledTimes(1);
    expect(unregisterMock).toHaveBeenCalledWith('CommandOrControl+Alt+Space');
  });
});
