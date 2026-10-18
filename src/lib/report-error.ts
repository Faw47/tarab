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

export const reportError = (
  rawMessage: unknown,
  options?: {
    source?: string;
    error?: unknown;
    detail?: string;
  },
) => {
  // Callers sometimes pass reportError straight to .catch, so the rejection value arrives here as
  // the message. Rendering a non-string message would crash the error banner and the whole app.
  const message = typeof rawMessage === 'string' ? rawMessage : describeUnknown(rawMessage);
  const source = options?.source ? `[${options.source}] ` : '';
  const detail = options?.detail ?? toMessage(options?.error);

  if (options?.error !== undefined) {
    console.error(`${source}${message}`, options.error);
  } else if (detail) {
    console.error(`${source}${message}: ${detail}`);
  } else {
    console.error(`${source}${message}`);
  }

  // Use sonner for UI notifications
  toast.error(message, {
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

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<AppErrorPayload>(APP_ERROR_EVENT, {
        detail: {
          message,
          detail,
          source: options?.source,
        },
      }),
    );
  }
};
