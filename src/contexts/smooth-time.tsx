import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useSmoothTime } from '../hooks/useSmoothTime';
import { usePlayerStore } from '../store/player-store';

type SmoothTimeContextValue = {
  getTimeSec: () => number;
  subscribe: (callback: (timeSec: number) => void) => () => void;
};

const defaultSmoothTimeContext: SmoothTimeContextValue = {
  // Components rendered outside the application provider (for example, isolated
  // Storybook stories) still receive coarse playback updates.
  getTimeSec: () => usePlayerStore.getState().currentTime,
  subscribe: (callback) => {
    let previous = usePlayerStore.getState().currentTime;
    return usePlayerStore.subscribe((state) => {
      if (state.currentTime === previous) return;
      previous = state.currentTime;
      callback(state.currentTime);
    });
  },
};

const SmoothTimeContext = createContext<SmoothTimeContextValue>(defaultSmoothTimeContext);

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
  // Keep the object stable while reading the latest clock value through its getter.
  return useMemo(
    () => ({
      get timeSec() {
        return ctx.getTimeSec();
      },
    }),
    [ctx],
  );
};

const DEFAULT_TIME_STATE_THROTTLE_MS = 80;

// React state is appropriate for small text/progress surfaces, but the hot
// playback clock itself stays imperative so currentTime updates do not fan out
// through the entire component tree.
export const useSmoothTimeState = (throttleMs = DEFAULT_TIME_STATE_THROTTLE_MS): number => {
  const ctx = useContext(SmoothTimeContext);
  const [timeSec, setTimeSec] = useState(() => ctx.getTimeSec());
  const lastUpdateRef = useRef({ timeSec, at: Number.NEGATIVE_INFINITY });

  useEffect(() => {
    const minimumInterval = Math.max(0, throttleMs);
    const initialTime = ctx.getTimeSec();
    lastUpdateRef.current = { timeSec: initialTime, at: Number.NEGATIVE_INFINITY };
    setTimeSec(initialTime);

    const unsubscribe = ctx.subscribe((nextTimeSec) => {
      const at = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const previous = lastUpdateRef.current;
      const jumped = Math.abs(nextTimeSec - previous.timeSec) > 0.25;
      if (!jumped && at - previous.at < minimumInterval) return;
      lastUpdateRef.current = { timeSec: nextTimeSec, at };
      setTimeSec(nextTimeSec);
    });

    return unsubscribe;
  }, [ctx, throttleMs]);

  return timeSec;
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
