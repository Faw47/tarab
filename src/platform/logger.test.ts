import { describe, expect, it, vi } from 'vitest';
import { formatErrorLog, safeStringify } from './logger';

vi.mock('@tauri-apps/plugin-log', () => ({
  attachConsole: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  trace: vi.fn(),
  warn: vi.fn(),
}));

describe('logger redaction', () => {
  it('redacts path-like metadata values', () => {
    expect(safeStringify({ filePath: 'C:\\Users\\me\\Music\\track.mp3' })).toBe(
      '{"filePath":"[redacted]"}',
    );
  });

  it('redacts sensitive metadata keys', () => {
    expect(
      safeStringify({ nested: { accessToken: 'secret-token', api_key: 'secret-key' } }),
    ).toBe('{"nested":{"accessToken":"[redacted]","api_key":"[redacted]"}}');
  });

  it('omits stack traces when stack inclusion is disabled', () => {
    const error = new Error('failed');
    error.stack = 'stack with C:\\Users\\me\\secret.txt';

    const formatted = formatErrorLog('app', 'Something failed', error, { token: 'secret' }, false);

    expect(formatted).toContain('Something failed');
    expect(formatted).toContain('"token":"[redacted]"');
    expect(formatted).not.toContain('Stack:');
    expect(formatted).not.toContain('secret.txt');
  });
});
