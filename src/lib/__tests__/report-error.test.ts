import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { logError, reportError } from '../report-error';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('../../platform/clipboard', () => ({ clipboard: { writeText: vi.fn() } }));

describe('reportError', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('turns a rejection value passed as the message into text', () => {
    // Regression for FE-03: `.catch(reportError)` put an Error object in the banner message,
    // and rendering it replaced the app with the error boundary.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    reportError(new Error('IPC failed') as unknown as string);
    reportError({ code: 42 } as unknown as string);

    expect(vi.mocked(toast.error).mock.calls.map(([message]) => message)).toEqual([
      'IPC failed',
      '{"code":42}',
    ]);
  });

  it('notifies once, with a toast that repeats replace (FE-31)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    reportError('Could not seek', { error: new Error('stream closed') });

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledWith(
      'Could not seek',
      expect.objectContaining({ id: 'error:Could not seek', description: 'stream closed' }),
    );
  });

  it('logError writes to the console without notifying', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logError('Failed to set up a listener', { source: 'app', error: new Error('x') });
    expect(toast.error).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});
