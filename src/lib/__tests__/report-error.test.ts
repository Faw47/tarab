import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_ERROR_EVENT, type AppErrorPayload, reportError } from '../report-error';

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('../../platform/clipboard', () => ({ clipboard: { writeText: vi.fn() } }));

describe('reportError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('turns a rejection value passed as the message into text', () => {
    // Regression for FE-03: `.catch(reportError)` put an Error object in the banner message,
    // and rendering it replaced the app with the error boundary.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const messages: unknown[] = [];
    const listener = (event: Event) =>
      messages.push((event as CustomEvent<AppErrorPayload>).detail.message);
    window.addEventListener(APP_ERROR_EVENT, listener);

    reportError(new Error('IPC failed') as unknown as string);
    reportError({ code: 42 } as unknown as string);
    window.removeEventListener(APP_ERROR_EVENT, listener);

    expect(messages).toEqual(['IPC failed', '{"code":42}']);
  });
});
