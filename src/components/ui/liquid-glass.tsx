import {
  type CSSProperties,
  createContext,
  forwardRef,
  type HTMLAttributes,
  memo,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Canvas } from '@react-three/fiber';
import { cn } from '@/lib/utils';

import { LiquidBackgroundPlane, type LiquidBgColors } from '@/components/shell/liquid-background-mesh';
import { useDocumentHidden } from '@/components/shell/use-document-hidden';

export { cn };

/* 1. MATERIAL CONSTANTS */

/*
 * FIX [GLASS_NOISE]: Increased canvas from 200x200 to 512x512 and reduced
 * baseFrequency from 0.8 to 0.5 (4 octaves instead of 3). At 200px with 0.8
 * frequency the tile boundary was visible on any surface wider than ~400px.
 * The larger canvas pushes repeat seams off-screen on typical UI surfaces,
 * and the lower frequency produces larger texture features that look less
 * mechanical.
 */
export const GLASS_NOISE = `url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.5' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`;

// Converted OKLCH to standard Hex for safe THREE.Color parsing in WebGL
export const DEFAULT_LIQUID_BG_COLORS = {
  b1: '#1A4D34', // equivalent to oklch(0.38 0.08 145)
  b2: '#123D26',
  b3: '#28593E',
  b4: '#0D331F',
  b5: '#1E4530',
} as const;

/* 2. GLASS SYSTEM CONTEXT */

export interface GlassSystemContextValue {
  /*
   * null  = no GlassSystemProvider present; each component falls back to its
   * own usePrefersReducedMotion check.
   * true  = force all glass effects off (app-level override).
   * false = explicitly allow effects regardless of system preference.
   */
  reducedEffects: boolean | null;
  theme: string;
}

const GlassSystemContext = createContext<GlassSystemContextValue>({
  reducedEffects: null,
  theme: 'default',
});

export interface GlassSystemProviderProps {
  children: ReactNode;
  reducedEffects?: boolean;
  theme?: string;
}

export const GlassSystemProvider = memo(function GlassSystemProvider({
  children,
  reducedEffects,
  theme = 'default',
}: GlassSystemProviderProps) {
  const value = useMemo<GlassSystemContextValue>(
    () => ({ reducedEffects: reducedEffects ?? null, theme }),
    [reducedEffects, theme],
  );

  return <GlassSystemContext.Provider value={value}>{children}</GlassSystemContext.Provider>;
});

GlassSystemProvider.displayName = 'GlassSystemProvider';

export function useGlassSystem(): GlassSystemContextValue {
  return useContext(GlassSystemContext);
}

/* 3. HOOKS */

export function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPrefersReducedMotion(mediaQuery.matches);

    update();

    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', update);
      return () => mediaQuery.removeEventListener('change', update);
    }

    mediaQuery.addListener(update);
    return () => mediaQuery.removeListener(update);
  }, []);

  return prefersReducedMotion;
}

/* 4. SHARED POINTER TRACKER HOOK */

interface PointerTrackerVars {
  x: string;
  y: string;
  size: string;
}

export interface UsePointerTrackerResult<T extends HTMLElement = HTMLElement> {
  ref: React.MutableRefObject<T | null>;
  measure: () => DOMRect | null;
  scheduleUpdate: (clientX: number, clientY: number) => void;
  clearVars: () => void;
  invalidateRect: () => void;
}

export function usePointerTracker<T extends HTMLElement = HTMLElement>(
  vars: PointerTrackerVars,
  enabled: boolean,
): UsePointerTrackerResult<T> {
  const ref = useRef<T | null>(null);
  const rectRef = useRef<DOMRect | null>(null);
  const rafRef = useRef<number | null>(null);
  const targetPosRef = useRef({ x: 50, y: 50 });
  const currentPosRef = useRef({ x: 50, y: 50 });
  const velEmaRef = useRef({ x: 0, y: 0 });
  const lastTimeRef = useRef(performance.now());
  const activeRef = useRef(false);

  const { x: varX, y: varY, size: varSize } = vars;

  const clearVars = useCallback(() => {
    activeRef.current = false;
    const el = ref.current;
    if (!el) return;
    el.style.removeProperty(varX);
    el.style.removeProperty(varY);
    el.style.removeProperty(varSize);
    el.style.removeProperty('--adl-liquid-stretch-x');
    el.style.removeProperty('--adl-liquid-stretch-y');
  }, [varX, varY, varSize]);

  const invalidateRect = useCallback(() => {
    rectRef.current = null;
  }, []);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    rectRef.current = rect;
    const size = Math.max(rect.width, rect.height, 80) * 1.2;
    el.style.setProperty(varSize, `${Math.max(size, 280).toFixed(0)}px`);
    return rect;
  }, [varSize]);

  const tick = useCallback(() => {
    if (!enabled || !activeRef.current || !ref.current) {
      rafRef.current = null;
      return;
    }

    const now = performance.now();
    const dt = Math.min(0.045, Math.max(1 / 120, (now - lastTimeRef.current) / 1000));
    lastTimeRef.current = now;

    // Spring smoothing (Exponential Decay)
    const k = 18; 
    const alpha = 1 - Math.exp(-k * dt);

    const prevX = currentPosRef.current.x;
    const prevY = currentPosRef.current.y;

    currentPosRef.current.x += (targetPosRef.current.x - currentPosRef.current.x) * alpha;
    currentPosRef.current.y += (targetPosRef.current.y - currentPosRef.current.y) * alpha;

    // Raw velocity in % per second
    const rawVx = (currentPosRef.current.x - prevX) / Math.max(1e-4, dt);
    const rawVy = (currentPosRef.current.y - prevY) / Math.max(1e-4, dt);

    // EMA Velocity
    velEmaRef.current.x = velEmaRef.current.x * 0.82 + rawVx * 0.18;
    velEmaRef.current.y = velEmaRef.current.y * 0.82 + rawVy * 0.18;

    // Map velocity to stretch (-0.15 to 0.15 max)
    const stretchX = Math.max(-0.15, Math.min(0.15, velEmaRef.current.x * 0.0005));
    const stretchY = Math.max(-0.15, Math.min(0.15, velEmaRef.current.y * 0.0005));

    const el = ref.current;
    // Direct DOM Geometry Writing
    el.style.setProperty(varX, `${currentPosRef.current.x.toFixed(2)}%`);
    el.style.setProperty(varY, `${currentPosRef.current.y.toFixed(2)}%`);
    el.style.setProperty('--adl-liquid-stretch-x', stretchX.toFixed(4));
    el.style.setProperty('--adl-liquid-stretch-y', stretchY.toFixed(4));

    // Stop ticking if we are extremely close to target and velocity is near zero
    const distSq =
      (targetPosRef.current.x - currentPosRef.current.x) ** 2 +
      (targetPosRef.current.y - currentPosRef.current.y) ** 2;
    
    if (distSq < 0.01 && Math.abs(velEmaRef.current.x) < 1 && Math.abs(velEmaRef.current.y) < 1) {
       // Snap to exact target to prevent micro-jitters
       el.style.setProperty(varX, `${targetPosRef.current.x.toFixed(2)}%`);
       el.style.setProperty(varY, `${targetPosRef.current.y.toFixed(2)}%`);
       el.style.setProperty('--adl-liquid-stretch-x', '0');
       el.style.setProperty('--adl-liquid-stretch-y', '0');
       activeRef.current = false;
       rafRef.current = null;
       return;
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [enabled, varX, varY]);

  const scheduleUpdate = useCallback(
    (clientX: number, clientY: number) => {
      if (!enabled) return;
      const rect = rectRef.current ?? measure();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      
      const targetX = ((clientX - rect.left) / rect.width) * 100;
      const targetY = ((clientY - rect.top) / rect.height) * 100;
      
      targetPosRef.current = { x: targetX, y: targetY };

      if (!activeRef.current) {
        // If we were idle, snap the current pos to target immediately to avoid 
        // the spotlight flying in from a random previous coordinate
        currentPosRef.current = { x: targetX, y: targetY };
        velEmaRef.current = { x: 0, y: 0 };
        lastTimeRef.current = performance.now();
        activeRef.current = true;
        
        if (rafRef.current == null) {
          rafRef.current = requestAnimationFrame(tick);
        }
      }
    },
    [enabled, measure, tick],
  );

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      clearVars();
      rectRef.current = null;
      return;
    }

    const el = ref.current;
    if (!el) return;

    const ro = new ResizeObserver(() => {
      rectRef.current = null;
    });
    ro.observe(el);

    const onWindowResize = () => {
      rectRef.current = null;
    };
    window.addEventListener('resize', onWindowResize);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onWindowResize);
    };
  }, [enabled, clearVars]);

  return { ref, measure, scheduleUpdate, clearVars, invalidateRect };
}

/* 5. GLASS STYLE GENERATORS */

export function getGlassStyle(
  radius = 18,
  tint = 'var(--glass, rgba(255,255,255,0.03))',
  extra: CSSProperties = {},
): CSSProperties {
  return {
    position: 'relative',
    background: tint,
    backdropFilter: 'blur(40px) saturate(240%)',
    WebkitBackdropFilter: 'blur(40px) saturate(240%)',
    borderRadius: radius,
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.12)',
      'inset 0 0 0 1px rgba(255, 255, 255, 0.05)',
      '0 12px 32px -8px rgba(0, 0, 0, 0.4)',
    ].join(', '),
    overflow: 'hidden',
    ...extra,
  };
}

export function getGlassDeepStyle(
  radius = 22,
  tint = 'color-mix(in oklch, var(--surface-overlay, rgba(0,0,0,0.6)) 85%, rgba(255,255,255,0.02))',
  extra: CSSProperties = {},
): CSSProperties {
  return {
    ...getGlassStyle(radius, tint),
    backdropFilter: 'blur(64px) saturate(180%)',
    WebkitBackdropFilter: 'blur(64px) saturate(180%)',
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.08)',
      'inset 0 0 0 1px rgba(255, 255, 255, 0.03)',
      '0 24px 64px -12px rgba(0, 0, 0, 0.6)',
    ].join(', '),
    ...extra,
  };
}

export function getGlassSubtleStyle(
  radius = 18,
  tint = 'color-mix(in oklch, var(--glass, rgba(255,255,255,0.02)) 50%, transparent)',
  extra: CSSProperties = {},
): CSSProperties {
  return {
    ...getGlassStyle(radius, tint),
    backdropFilter: 'blur(16px) saturate(140%)',
    WebkitBackdropFilter: 'blur(16px) saturate(140%)',
    boxShadow: [
      'inset 0 1px 1px rgba(255, 255, 255, 0.06)',
      'inset 0 0 0 1px rgba(255, 255, 255, 0.02)',
      '0 4px 16px -4px rgba(0, 0, 0, 0.2)',
    ].join(', '),
    ...extra,
  };
}

export const glss = getGlassStyle;
export const glssDeep = getGlassDeepStyle;
export const glssSubtle = getGlassSubtleStyle;

/* 6. SUBCOMPONENTS */

export const MaterialNoise = memo(function MaterialNoise({ opacity = 0.04 }: { opacity?: number }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-0 rounded-[inherit] mix-blend-overlay"
      style={{ backgroundImage: GLASS_NOISE, opacity }}
      aria-hidden="true"
    />
  );
});

MaterialNoise.displayName = 'MaterialNoise';

export const LensArc = memo(function LensArc({
  tinted,
  opacity = 1,
}: {
  tinted?: string | null;
  opacity?: number;
}) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 top-0 z-10 rounded-[inherit]"
      style={{
        height: 'min(60%, 180px)',
        background: tinted
          ? `radial-gradient(ellipse 120% 100% at 50% -20%, color-mix(in oklch, ${tinted} 50%, rgba(255,255,255,0.4)) 0%, rgba(255,255,255,0.05) 40%, transparent 80%)`
          : 'radial-gradient(ellipse 120% 100% at 50% -20%, rgba(255,255,255,0.25) 0%, rgba(255,255,255,0.05) 40%, transparent 80%)',
        opacity,
      }}
    />
  );
});

LensArc.displayName = 'LensArc';

export const BottomRim = memo(function BottomRim() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[30%] rounded-[inherit]"
      style={{
        background:
          'linear-gradient(to top, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.05) 40%, transparent 100%)',
      }}
    />
  );
});

BottomRim.displayName = 'BottomRim';

/* 7. GLASS CARD */

const CARD_TRACKER_VARS: PointerTrackerVars = {
  x: '--glass-light-x',
  y: '--glass-light-y',
  size: '--glass-light-size',
};

export interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  intensity?: 'normal' | 'deep' | 'subtle';
  radius?: number;
  tint?: string;
  noLens?: boolean;
  noRim?: boolean;
  interactive?: boolean;
  reducedEffects?: boolean;
  sheenColor?: string;
  promoteLayer?: boolean;
  children?: ReactNode;
}

const GlassCardBase = forwardRef<HTMLDivElement, GlassCardProps>(
  (
    {
      intensity = 'normal',
      radius = 18,
      tint,
      noLens = false,
      noRim = false,
      interactive = false,
      reducedEffects,
      sheenColor = 'rgba(255,255,255,0.08)',
      promoteLayer = false,
      children,
      className,
      style,
      onPointerEnter,
      onPointerMove,
      onPointerLeave,
      ...props
    },
    forwardedRef,
  ) => {
    const prefersReducedMotion = usePrefersReducedMotion();
    const { reducedEffects: contextReducedEffects } = useGlassSystem();

    const finalReducedEffects = reducedEffects ?? contextReducedEffects ?? prefersReducedMotion;
    const finalInteractive = interactive && !finalReducedEffects;
    const [sheenVisible, setSheenVisible] = useState(false);

    const {
      ref: trackerRef,
      measure,
      scheduleUpdate,
      clearVars,
    } = usePointerTracker<HTMLDivElement>(CARD_TRACKER_VARS, finalInteractive);

    const setRefs = useCallback(
      (node: HTMLDivElement | null) => {
        trackerRef.current = node;
        if (typeof forwardedRef === 'function') {
          forwardedRef(node);
        } else if (forwardedRef) {
          forwardedRef.current = node;
        }
      },
      [forwardedRef, trackerRef],
    );

    useEffect(() => {
      if (finalInteractive) return;
      setSheenVisible(false);
      clearVars();
    }, [clearVars, finalInteractive]);

    const handlePointerEnter = useCallback(
      (e: ReactPointerEvent<HTMLDivElement>) => {
        if (finalInteractive) {
          setSheenVisible(true);
          measure();
          scheduleUpdate(e.clientX, e.clientY);
        }
        onPointerEnter?.(e);
      },
      [finalInteractive, measure, onPointerEnter, scheduleUpdate],
    );

    const handlePointerMove = useCallback(
      (e: ReactPointerEvent<HTMLDivElement>) => {
        if (finalInteractive) scheduleUpdate(e.clientX, e.clientY);
        onPointerMove?.(e);
      },
      [finalInteractive, onPointerMove, scheduleUpdate],
    );

    const handlePointerLeave = useCallback(
      (e: ReactPointerEvent<HTMLDivElement>) => {
        if (finalInteractive) {
          setSheenVisible(false);
          clearVars();
        }
        onPointerLeave?.(e);
      },
      [clearVars, finalInteractive, onPointerLeave],
    );

    const baseStyle = useMemo(() => {
      const layerPromotion = promoteLayer ? { willChange: 'transform' as const } : undefined;

      if (intensity === 'deep') return getGlassDeepStyle(radius, tint, layerPromotion);
      if (intensity === 'subtle') return getGlassSubtleStyle(radius, tint, layerPromotion);
      return getGlassStyle(radius, tint, layerPromotion);
    }, [intensity, promoteLayer, radius, tint]);

    const mergedStyle = useMemo(
      () => ({
        ...baseStyle,
        ...style,
        '--glass-sheen-color': sheenColor,
      }),
      [baseStyle, sheenColor, style],
    );

    return (
      <div
        ref={setRefs}
        className={cn('group relative', className)}
        style={mergedStyle as CSSProperties}
        onPointerEnter={handlePointerEnter}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        {...props}
      >
        {!finalReducedEffects && (
          <MaterialNoise
            opacity={intensity === 'deep' ? 0.06 : intensity === 'subtle' ? 0.025 : 0.04}
          />
        )}

        {!noLens && !finalReducedEffects && <LensArc tinted={tint} />}
        {!noRim && <BottomRim />}

        {finalInteractive && (
          <div
            className="pointer-events-none absolute inset-0 z-10 rounded-[inherit] transition-opacity duration-300 ease-out"
            style={{
              opacity: sheenVisible ? 1 : 0,
              background: `radial-gradient(ellipse calc(var(--glass-light-size, 480px) * (1 + var(--adl-liquid-stretch-x, 0))) calc(var(--glass-light-size, 480px) * (1 + var(--adl-liquid-stretch-y, 0))) at var(--glass-light-x, 50%) var(--glass-light-y, 50%), var(--glass-sheen-color, rgba(255,255,255,0.08)), transparent 42%)`,
            }}
            aria-hidden="true"
          />
        )}

        <div className="relative z-20 h-full w-full">{children}</div>
      </div>
    );
  },
);

GlassCardBase.displayName = 'GlassCard';

export const GlassCard = memo(GlassCardBase);
GlassCard.displayName = 'memo(GlassCard)';

/* 8. THREE.JS FLUID BACKGROUND */

export type { LiquidBgColors };

interface LiquidBgProps extends HTMLAttributes<HTMLDivElement> {
  colors?: Partial<LiquidBgColors>;
  fixed?: boolean;
  reducedEffects?: boolean;
}

/**
 * Standalone full-viewport liquid metaball layer (own WebGL context).
 * The main liquid window uses `AppShellLiquidWebGL` so background and header aurora share one canvas.
 */
export const LiquidBg = memo(function LiquidBg({
  colors,
  fixed = true,
  reducedEffects,
  className,
  style,
  ...props
}: LiquidBgProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const { reducedEffects: contextReducedEffects } = useGlassSystem();
  const finalReducedEffects = reducedEffects ?? contextReducedEffects ?? prefersReducedMotion;
  const documentHidden = useDocumentHidden();

  const mergedColors = useMemo(
    () => ({ ...DEFAULT_LIQUID_BG_COLORS, ...colors }) as LiquidBgColors,
    [colors],
  );

  const pauseAnimation = finalReducedEffects || documentHidden;

  return (
    <div
      className={cn(
        fixed ? 'fixed inset-0' : 'absolute inset-0',
        'z-0 overflow-hidden pointer-events-none bg-[#040408]',
        className,
      )}
      style={style}
      {...props}
    >
      <Canvas
        className="absolute inset-0 z-0"
        camera={{ position: [0, 0, 1] }}
        orthographic
      >
        <LiquidBackgroundPlane colors={mergedColors} pauseAnimation={pauseAnimation} />
      </Canvas>

      <div
        className="absolute inset-0 z-10"
        style={{ background: 'oklch(0.08 0.005 140 / 0.55)' }}
      />

      {!finalReducedEffects && (
        <div
          className="pointer-events-none absolute inset-0 z-20 mix-blend-overlay opacity-[0.03]"
          style={{ backgroundImage: GLASS_NOISE }}
        />
      )}
    </div>
  );
});

LiquidBg.displayName = 'LiquidBg';
