import {
  attachConsole,
  debug as tauriDebug,
  error as tauriError,
  info as tauriInfo,
  trace as tauriTrace,
  warn as tauriWarn,
} from '@tauri-apps/plugin-log';

const SENSITIVE_KEY_RE = /(token|secret|password|api[_-]?key|access[_-]?key|auth)/i;
const PATH_LIKE_RE = /([A-Za-z]:\\|\\\\|\/[^\s]+\/)/;
const REDACTED = '[redacted]';

export const redactLogValue = (value: unknown, key = ''): unknown => {
  if (SENSITIVE_KEY_RE.test(key)) return REDACTED;
  if (typeof value === 'string') return PATH_LIKE_RE.test(value) ? REDACTED : value;
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        redactLogValue(entryValue, entryKey),
      ]),
    );
  }
  return value;
};

export const safeStringify = (meta?: Record<string, unknown>): string => {
  if (!meta) return '';
  try {
    return JSON.stringify(redactLogValue(meta));
  } catch {
    return REDACTED;
  }
};

const formatMeta = (meta?: Record<string, unknown>) => {
  const serialized = safeStringify(meta);
  return serialized ? ` ${serialized}` : '';
};

export const formatErrorLog = (
  domain: string,
  message: string,
  error?: unknown,
  meta?: Record<string, unknown>,
  includeStack = import.meta.env.DEV,
): string => {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const stack =
    includeStack && error instanceof Error && error.stack ? ` | Stack: ${error.stack}` : '';
  const serializedMeta = safeStringify(meta);
  return `[${domain}] ${message} | Error: ${errorMsg}${stack}${serializedMeta ? ` | Meta: ${serializedMeta}` : ''}`;
};

/**
 * Initialize logging by attaching to the console in development.
 */
export async function initLogger() {
  if (!import.meta.env.DEV) return;

  const attach = async () => {
    try {
      await attachConsole();
    } catch (error) {
      console.error('Failed to attach Tauri console logger:', error);
    }
  };

  const requestIdle = (globalThis as Window & typeof globalThis).requestIdleCallback;
  if (typeof requestIdle === 'function') {
    requestIdle(
      () => {
        void attach();
      },
      { timeout: 1200 },
    );
    return;
  }

  setTimeout(() => {
    void attach();
  }, 400);
}

/**
 * Categorized logger for Tarab.
 */
export const logger = {
  info: (domain: string, message: string, meta?: Record<string, unknown>) => {
    tauriInfo(`[${domain}] ${message}${formatMeta(meta)}`);
  },
  warn: (domain: string, message: string, meta?: Record<string, unknown>) => {
    tauriWarn(`[${domain}] ${message}${formatMeta(meta)}`);
  },
  error: (domain: string, message: string, error?: unknown, meta?: Record<string, unknown>) => {
    tauriError(formatErrorLog(domain, message, error, meta));
  },
  debug: (domain: string, message: string, meta?: Record<string, unknown>) => {
    tauriDebug(`[${domain}] ${message}${formatMeta(meta)}`);
  },
  trace: (domain: string, message: string, meta?: Record<string, unknown>) => {
    tauriTrace(`[${domain}] ${message}${formatMeta(meta)}`);
  },
};
