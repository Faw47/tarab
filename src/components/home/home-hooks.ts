import type { PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Global CSS injection
// Equalizer keyframes, cover tilt, spotlight overlay.
// Injected once into <head> - safe to call from multiple mounts (idempotent).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// ---------------------------------------------------------------------------
// useAnimatedCounter
// Cubic ease-out counter animation. disabled=true skips the RAF and jumps straight
// to target (for reducedEffects mode).
// ---------------------------------------------------------------------------

export const useAnimatedCounter = (target: number, duration = 1500, disabled = false): number => {
  const [count, setCount] = useState(0);
  const startVal = useRef(0);
  const countRef = useRef(0);
  const startTime = useRef<number | null>(null);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    countRef.current = count;
  }, [count]);

  useEffect(() => {
    if (raf.current !== null) {
      cancelAnimationFrame(raf.current);
      raf.current = null;
    }

    if (disabled) {
      startTime.current = null;
      startVal.current = target;
      countRef.current = target;
      setCount(target);
      return;
    }

    startVal.current = countRef.current;
    startTime.current = null;

    if (target === 0) {
      countRef.current = 0;
      setCount(0);
      return;
    }

    const animate = (now: number) => {
      if (!startTime.current) startTime.current = now;
      const progress = Math.min((now - startTime.current) / duration, 1);
      const eased = 1 - (1 - progress) ** 3;
      const next = Math.floor(startVal.current + (target - startVal.current) * eased);
      countRef.current = next;
      setCount((prev) => (prev === next ? prev : next));
      if (progress < 1) raf.current = requestAnimationFrame(animate);
      else raf.current = null;
    };

    raf.current = requestAnimationFrame(animate);
    return () => {
      if (raf.current !== null) {
        cancelAnimationFrame(raf.current);
        raf.current = null;
      }
    };
  }, [target, duration, disabled]);

  return count;
};

// ---------------------------------------------------------------------------
// useFinePointer
// Returns true on mouse/stylus devices; false on touch. Guards tilt + spotlight.
// ---------------------------------------------------------------------------

export const useFinePointer = (): boolean => {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const q = window.matchMedia('(hover: hover) and (pointer: fine)');
    const sync = () => setFine(q.matches);
    sync();
    q.addEventListener('change', sync);
    return () => q.removeEventListener('change', sync);
  }, []);
  return fine;
};

// ---------------------------------------------------------------------------
// useCoverTilt
// Spring-lerp 3D tilt via CSS vars, RAF-based, frame-rate independent.
// Lerp alpha: ~14% per 60fps frame, scaled by actual delta.
// ---------------------------------------------------------------------------

export const useCoverTilt = (enabled: boolean, intensity = 9) => {
  const wrapRef = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const lastAt = useRef<number | null>(null);
  const raf = useRef<number | null>(null);

  const write = useCallback(() => {
    const node = wrapRef.current;
    if (!node) return;
    node.style.setProperty('--home-tilt-x', `${current.current.x.toFixed(2)}deg`);
    node.style.setProperty('--home-tilt-y', `${current.current.y.toFixed(2)}deg`);
  }, []);

  const tick = useCallback(
    (now: number) => {
      raf.current = null;
      const prev = lastAt.current ?? now;
      const delta = Math.max(1, now - prev);
      lastAt.current = now;
      const alpha = 1 - (1 - 0.14) ** (delta / (1000 / 60));
      current.current.x += (target.current.x - current.current.x) * alpha;
      current.current.y += (target.current.y - current.current.y) * alpha;
      write();
      if (
        Math.abs(target.current.x - current.current.x) > 0.02 ||
        Math.abs(target.current.y - current.current.y) > 0.02
      ) {
        raf.current = requestAnimationFrame(tick);
      } else {
        lastAt.current = null;
      }
    },
    [write],
  );

  const schedule = useCallback(() => {
    if (raf.current !== null) return;
    raf.current = requestAnimationFrame(tick);
  }, [tick]);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!enabled || e.pointerType === 'touch' || !wrapRef.current) return;
      const rect = wrapRef.current.getBoundingClientRect();
      const nx = clamp01((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = clamp01((e.clientY - rect.top) / rect.height) * 2 - 1;
      target.current.x = -ny * intensity;
      target.current.y = nx * intensity;
      schedule();
    },
    [enabled, intensity, schedule],
  );

  const onPointerLeave = useCallback(() => {
    target.current.x = 0;
    target.current.y = 0;
    schedule();
  }, [schedule]);

  useEffect(() => {
    if (enabled) return;
    if (raf.current !== null) {
      cancelAnimationFrame(raf.current);
      raf.current = null;
    }
    lastAt.current = null;
    target.current = { x: 0, y: 0 };
    current.current = { x: 0, y: 0 };
    write();
  }, [enabled, write]);

  useEffect(
    () => () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
      lastAt.current = null;
    },
    [],
  );

  return { wrapRef, onPointerMove, onPointerLeave };
};
