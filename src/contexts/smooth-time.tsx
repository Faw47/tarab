import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useSmoothTime } from '../hooks/useSmoothTime';
import { usePlayerStore } from '../store/player-store';

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
  const isPlaying = usePlayerStore((state) => state.isPlaying);
  const currentTime = usePlayerStore((state) => state.currentTime);
  const [hasSubscribers, setHasSubscribers] = useState(false);
  const subscribersRef = useRef<Set<(timeSec: number) => void>>(new Set());
  const rafIdRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number>(0);
  const getTimeMsRef = useRef(getTimeMs);
  getTimeMsRef.current = getTimeMs;

  // Notify subscribers without React state updates. No frame loop when paused or unused.
  useEffect(() => {
    if (!hasSubscribers) return;

    const notify = () => {
      const timeSec = getTimeMs() / 1000;
      // Only notify if time changed meaningfully (> 10ms).
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
    };

    // A pause or seek may still change the timestamp; publish once without another frame.
    if (!isPlaying) {
      notify();
      return;
    }

    let running = true;
    const tick = () => {
      if (!running) return;
      notify();
      rafIdRef.current = requestAnimationFrame(tick);
    };
    rafIdRef.current = requestAnimationFrame(tick);

    return () => {
      running = false;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [getTimeMs, hasSubscribers, isPlaying, currentTime]);

  const value = useRef<SmoothTimeContextValue>({
    // Imperative readers do not need a subscription or a running frame loop.
    getTimeSec: () => getTimeMsRef.current() / 1000,
    subscribe: (callback) => {
      subscribersRef.current.add(callback);
      setHasSubscribers(true);
      return () => {
        subscribersRef.current.delete(callback);
        if (subscribersRef.current.size === 0) setHasSubscribers(false);
      };
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
