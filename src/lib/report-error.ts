import { toast } from 'sonner';

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

export const reportError = (
  message: string,
  options?: {
    source?: string;
    error?: unknown;
    detail?: string;
  },
) => {
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
            navigator.clipboard.writeText(detail).catch(console.error);
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
