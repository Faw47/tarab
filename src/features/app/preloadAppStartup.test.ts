import { beforeEach, describe, expect, it, vi } from 'vitest';

const reportErrorMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/report-error', () => ({
  reportError: reportErrorMock,
}));

import { preloadAppStartupModules } from './preloadAppStartup';

describe('preloadAppStartupModules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports rejected optional modules without rejecting startup', async () => {
    const first = vi.fn(async () => undefined);
    const failure = new Error('optional module failed');
    const second = vi.fn(async () => {
      throw failure;
    });

    await expect(preloadAppStartupModules([first, second])).resolves.toBeUndefined();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(reportErrorMock).toHaveBeenCalledWith('Optional startup module preload failed', {
      source: 'app-startup',
      error: failure,
    });
  });

  it('captures synchronous loader failures as optional failures', async () => {
    const failure = new Error('sync optional failure');
    const loader = vi.fn(() => {
      throw failure;
    });

    await expect(preloadAppStartupModules([loader])).resolves.toBeUndefined();

    expect(reportErrorMock).toHaveBeenCalledWith('Optional startup module preload failed', {
      source: 'app-startup',
      error: failure,
    });
  });
});
