import { useEffect, useState } from 'react';
import { APP_ERROR_EVENT, type AppErrorPayload } from '../../lib/report-error';

export function useAppErrorEvent() {
  const [appError, setAppError] = useState<AppErrorPayload | null>(null);

  useEffect(() => {
    const handleAppErrorEvent = (event: Event) => {
      const payload = (event as CustomEvent<AppErrorPayload>).detail;
      if (payload) setAppError(payload);
    };

    window.addEventListener(APP_ERROR_EVENT, handleAppErrorEvent as EventListener);
    return () => window.removeEventListener(APP_ERROR_EVENT, handleAppErrorEvent as EventListener);
  }, []);

  return { appError, setAppError };
}
