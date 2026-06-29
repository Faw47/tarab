import { useCallback, useEffect, useRef, useState } from 'react';
import { reportError } from '../../lib/report-error';
import { pausePlayback } from '../../lib/tauri-commands';

interface UseSleepTimerOptions {
  setIsPlaying: (isPlaying: boolean) => void;
}

export function useSleepTimer({ setIsPlaying }: UseSleepTimerOptions) {
  const sleepTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sleepDeadline, setSleepDeadline] = useState<number | null>(null);

  const cancelSleepTimer = useCallback(() => {
    if (sleepTimeoutRef.current) {
      clearTimeout(sleepTimeoutRef.current);
      sleepTimeoutRef.current = null;
    }
    setSleepDeadline(null);
  }, []);

  const scheduleSleepTimer = useCallback(
    (minutes: number) => {
      cancelSleepTimer();
      const delayMs = minutes * 60 * 1000;
      const deadline = Date.now() + delayMs;
      setSleepDeadline(deadline);
      sleepTimeoutRef.current = setTimeout(async () => {
        try {
          await pausePlayback();
        } catch (err) {
          reportError('Failed to pause for sleep timer', { source: 'app', error: err });
        } finally {
          setIsPlaying(false);
          setSleepDeadline(null);
          sleepTimeoutRef.current = null;
        }
      }, delayMs);
    },
    [cancelSleepTimer, setIsPlaying],
  );

  useEffect(() => {
    return () => {
      if (sleepTimeoutRef.current) {
        clearTimeout(sleepTimeoutRef.current);
      }
    };
  }, []);

  return { sleepDeadline, scheduleSleepTimer, cancelSleepTimer };
}
