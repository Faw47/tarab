import {
  attachConsole,
  debug as tauriDebug,
  error as tauriError,
  info as tauriInfo,
  trace as tauriTrace,
  warn as tauriWarn,
} from '@tauri-apps/plugin-log';

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
    requestIdle(() => {
      void attach();
    }, { timeout: 1200 });
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
    tauriInfo(`[${domain}] ${message} ${meta ? JSON.stringify(meta) : ''}`);
  },
  warn: (domain: string, message: string, meta?: Record<string, unknown>) => {
    tauriWarn(`[${domain}] ${message} ${meta ? JSON.stringify(meta) : ''}`);
  },
  error: (domain: string, message: string, error?: unknown, meta?: Record<string, unknown>) => {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : '';
    tauriError(
      `[${domain}] ${message} | Error: ${errorMsg} | Stack: ${stack} | Meta: ${meta ? JSON.stringify(meta) : ''}`,
    );
  },
  debug: (domain: string, message: string, meta?: Record<string, unknown>) => {
    tauriDebug(`[${domain}] ${message} ${meta ? JSON.stringify(meta) : ''}`);
  },
  trace: (domain: string, message: string, meta?: Record<string, unknown>) => {
    tauriTrace(`[${domain}] ${message} ${meta ? JSON.stringify(meta) : ''}`);
  },
};
