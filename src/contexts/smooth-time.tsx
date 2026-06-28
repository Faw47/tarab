import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useRef } from 'react';
import { useSmoothTime } from '../hooks/useSmoothTime';

type SmoothTimeContextValue = {
  getTimeSec: () => number;
  subscribe: (callback: (timeSec: number) => void) => () => void;
};

const SmoothTimeContext = createContext<SmoothTimeContextValue>({
  getTimeSec: () => 0,
  subscribe: () => () => {},
});

export const SmoothTimeProvider = ({ children }: { children: ReactNode }) => {
  const getTimeMs = useSmoothTime();
  const subscribersRef = useRef<Set<(timeSec: number) => void>>(new Set());
  const rafIdRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);

  // RAF loop that notifies subscribers without React state updates
  useEffect(() => {
    let running = true;

    const tick = () => {
      if (!running) return;

      const timeSec = getTimeMs() / 1000;
      // Only notify if time changed meaningfully (> 16ms = ~60fps)
      if (Math.abs(timeSec - lastTimeRef.current) > 0.01) {
        lastTimeRef.current = timeSec;
        subscribersRef.current.forEach((cb) => {
          try {
            cb(timeSec);
          } catch (err) {
            console.error('[SmoothTime] Subscriber error:', err);
          }
        });
      }

      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [getTimeMs]);

  const value = useRef<SmoothTimeContextValue>({
    getTimeSec: () => lastTimeRef.current,
    subscribe: (callback) => {
      subscribersRef.current.add(callback);
      return () => subscribersRef.current.delete(callback);
    },
  });

  return <SmoothTimeContext.Provider value={value.current}>{children}</SmoothTimeContext.Provider>;
};

// Hook to get current time imperatively (doesn't cause re-renders)
export const useSmoothTimeValue = () => {
  const ctx = useContext(SmoothTimeContext);
  // Return object with timeSec getter for backwards compatibility
  // This is a stable reference that reads the current time on access
  return {
    get timeSec() {
      return ctx.getTimeSec();
    },
  };
};

// Hook to subscribe to time updates (for components that need to animate)
export const useSmoothTimeSubscription = (callback: (timeSec: number) => void) => {
  const ctx = useContext(SmoothTimeContext);
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!ctx || typeof ctx.subscribe !== 'function') return;
    return ctx.subscribe((timeSec) => {
      if (typeof callbackRef.current === 'function') {
        callbackRef.current(timeSec);
      }
    });
  }, [ctx]);
};
