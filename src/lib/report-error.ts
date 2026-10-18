import { toast } from 'sonner';
import { clipboard } from '../platform/clipboard';

export const APP_ERROR_EVENT = 'tarab:error';

export interface AppErrorPayload {
  message: string;
  detail?: string;
  source?: string;
}

const toMessage = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  return undefined;
};

const describeUnknown = (value: unknown): string => {
  const text = toMessage(value);
  if (text) return text;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

interface ErrorOptions {
  source?: string;
  error?: unknown;
  detail?: string;
}

const normalize = (rawMessage: unknown, options?: ErrorOptions) => ({
  // Callers sometimes pass reportError straight to .catch, so the rejection value arrives here as
  // the message. A non-string message would otherwise reach the UI as an object.
  message: typeof rawMessage === 'string' ? rawMessage : describeUnknown(rawMessage),
  detail: options?.detail ?? toMessage(options?.error),
});

/**
 * Records a failure in the console only. Use it for background work the user did not ask for
 * (listeners, prefetching, caches), where a notification would only be noise.
 */
export const logError = (rawMessage: unknown, options?: ErrorOptions) => {
  const { message, detail } = normalize(rawMessage, options);
  const source = options?.source ? `[${options.source}] ` : '';
  if (options?.error !== undefined) {
    console.error(`${source}${message}`, options.error);
  } else if (detail) {
    console.error(`${source}${message}: ${detail}`);
  } else {
    console.error(`${source}${message}`);
  }
};

/**
 * Logs a failure and tells the user once, with a toast. The persistent banner is reserved for
 * the error boundary (`APP_ERROR_EVENT`), so one failure no longer shows up twice.
 */
export const reportError = (rawMessage: unknown, options?: ErrorOptions) => {
  logError(rawMessage, options);
  const { message, detail } = normalize(rawMessage, options);
  toast.error(message, {
    // The same failure repeated (a seek drag, a held volume key) replaces its toast.
    id: `error:${message}`,
    description: detail,
    duration: 5000,
    action: detail
      ? {
          label: 'Copy Details',
          onClick: () => {
            void clipboard.writeText(detail);
          },
        }
      : undefined,
  });
};
