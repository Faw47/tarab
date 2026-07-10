import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setVolumeRamp } from '../tauri-commands';

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

  it('uses Tauri camelCase argument names for set_volume_ramp', async () => {
    await setVolumeRamp(0.1, 0.8, 124.6);

    expect(invokeMock).toHaveBeenCalledWith('set_volume_ramp', {
      from: 0.1,
      to: 0.8,
      durationMs: 125,
    });
  });
});
