import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

import { cn } from '@/lib/utils';
import {
  useGlassSystem,
  usePointerTracker,
  usePrefersReducedMotion,
} from './liquid-glass';

type LiquidGlassButtonTone = 'neutral' | 'accent' | 'danger';

export type LiquidGlassPressFeedback = 'scale' | 'inset';

export interface LiquidGlassButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  tone?: LiquidGlassButtonTone;
  reducedEffects?: boolean;
  contentClassName?: string;
  accentColor?: string;
  accentForeground?: string;
  /** `scale` shrinks when pressed; `inset` keeps size and uses inner shadow (e.g. hero play). */
  pressFeedback?: LiquidGlassPressFeedback;
}

const DEFAULT_SCALE = 1;
const PRESSED_SCALE = 0.92;

interface Ripple {
  id: number;
  x: number;
  y: number;
}

const BUTTON_TRACKER_VARS = {
  x: '--adl-liquid-x',
  y: '--adl-liquid-y',
  size: '--adl-liquid-spotlight-size',
} as const;

function getLiquidToneVars({
  tone,
  accentColor,
  accentForeground,
}: {
  tone: LiquidGlassButtonTone;
  accentColor?: string;
  accentForeground?: string;
}): CSSProperties {
  if (tone === 'accent') {
    const base = accentColor ?? 'rgba(255, 255, 255, 0.86)';
    const ink = accentForeground ?? '#0a0a0a';

    return {
      '--adl-liquid-bg': `linear-gradient(180deg, color-mix(in oklch, ${base} 34%, rgba(255,255,255,0.14)) 0%, color-mix(in oklch, ${base} 22%, rgba(255,255,255,0.08)) 38%, color-mix(in oklch, ${base} 7%, rgba(255,255,255,0.02)) 100%)`,
      '--adl-liquid-bg-hover': `linear-gradient(180deg, color-mix(in oklch, ${base} 42%, rgba(255,255,255,0.16)) 0%, color-mix(in oklch, ${base} 28%, rgba(255,255,255,0.10)) 40%, color-mix(in oklch, ${base} 12%, rgba(255,255,255,0.04)) 100%)`,
      '--adl-liquid-bg-active': `linear-gradient(180deg, color-mix(in oklch, ${base} 14%, rgba(255,255,255,0.05)) 0%, color-mix(in oklch, ${base} 5%, transparent) 100%)`,
      '--adl-liquid-text': ink,
      '--adl-liquid-highlight': `color-mix(in oklch, ${base} 80%, rgba(255,255,255,0.7))`,
      '--adl-liquid-spotlight': `color-mix(in oklch, ${base} 32%, rgba(255,255,255,0.2))`,
      '--adl-liquid-ripple': `color-mix(in oklch, ${base} 60%, rgba(255,255,255,0.6))`,
    } as CSSProperties;
  }

  if (tone === 'danger') {
    return {
      '--adl-liquid-bg':
        'linear-gradient(180deg, rgba(255, 59, 48, 0.26) 0%, rgba(255, 59, 48, 0.14) 40%, rgba(255, 59, 48, 0.045) 100%)',
      '--adl-liquid-bg-hover':
        'linear-gradient(180deg, rgba(255, 59, 48, 0.34) 0%, rgba(255, 59, 48, 0.20) 42%, rgba(255, 59, 48, 0.09) 100%)',
      '--adl-liquid-bg-active':
        'linear-gradient(180deg, rgba(255, 59, 48, 0.14) 0%, rgba(255, 59, 48, 0.03) 100%)',
      '--adl-liquid-text': 'rgba(255, 236, 236, 0.98)',
      '--adl-liquid-highlight': 'rgba(255, 160, 160, 0.60)',
      '--adl-liquid-spotlight': 'rgba(255, 100, 100, 0.22)',
      '--adl-liquid-ripple': 'rgba(255, 59, 48, 0.55)',
    } as CSSProperties;
  }

  return {
    '--adl-liquid-bg':
      'linear-gradient(180deg, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0.09) 40%, rgba(255, 255, 255, 0.018) 100%)',
    '--adl-liquid-bg-hover':
      'linear-gradient(180deg, rgba(255, 255, 255, 0.21) 0%, rgba(255, 255, 255, 0.13) 42%, rgba(255, 255, 255, 0.04) 100%)',
    '--adl-liquid-bg-active':
      'linear-gradient(180deg, rgba(255, 255, 255, 0.07) 0%, rgba(255, 255, 255, 0.02) 100%)',
    '--adl-liquid-text': 'rgba(255, 255, 255, 0.92)',
    '--adl-liquid-highlight': 'rgba(255, 255, 255, 0.45)',
    '--adl-liquid-spotlight': 'rgba(255, 255, 255, 0.16)',
    '--adl-liquid-ripple': 'rgba(255, 255, 255, 0.45)',
  } as CSSProperties;
}

function composeTransform(
  baseTransform: CSSProperties['transform'],
  scale: number,
): CSSProperties['transform'] {
  const scaleTransform = `scale(${scale})`;
  if (!baseTransform || baseTransform === 'none') return scaleTransform;
  return `${baseTransform} ${scaleTransform}`;
}

const INSET_SUBMERGE_SHADOW =
  'inset 0 5px 16px rgba(0, 0, 0, 0.42), inset 0 2px 8px rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.05)';

const LiquidGlassButtonBase = forwardRef<HTMLButtonElement, LiquidGlassButtonProps>(
  (
    {
      children,
      className,
      contentClassName,
      tone = 'neutral',
      reducedEffects,
      accentColor,
      accentForeground,
      pressFeedback = 'scale',
      disabled,
      onPointerEnter,
      onPointerMove,
      onPointerLeave,
      onPointerDown,
      onPointerUp,
      onPointerCancel,
      onKeyDown,
      onKeyUp,
      onBlur,
      style,
      type,
      ...props
    },
    forwardedRef,
  ) => {
    const prefersReducedMotion = usePrefersReducedMotion();
    const { theme, reducedEffects: contextReducedEffects } = useGlassSystem();

    const finalReducedEffects =
      reducedEffects ?? contextReducedEffects ?? prefersReducedMotion;

    const isNeobrutalism = theme === 'neobrutalism';

    const [hovered, setHovered] = useState(false);
    const [pressed, setPressed] = useState(false);
    const [ripples, setRipples] = useState<Ripple[]>([]);

    const trackerEnabled = !finalReducedEffects && !isNeobrutalism && !disabled;

    const { ref: trackerRef, measure, scheduleUpdate, clearVars, invalidateRect } =
      usePointerTracker<HTMLButtonElement>(BUTTON_TRACKER_VARS, trackerEnabled);

    const setRefs = useCallback(
      (node: HTMLButtonElement | null) => {
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
      if (!disabled) return;
      setHovered(false);
      setPressed(false);
      setRipples([]);
      clearVars();
      invalidateRect();
    }, [clearVars, disabled, invalidateRect]);

    const handlePointerEnter = useCallback(
      (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (!disabled && event.pointerType === 'mouse') {
          setHovered(true);
          if (trackerEnabled) {
            measure();
            scheduleUpdate(event.clientX, event.clientY);
          }
        }
        onPointerEnter?.(event);
      },
      [disabled, measure, onPointerEnter, scheduleUpdate, trackerEnabled],
    );

    const handlePointerMove = useCallback(
      (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (
          !disabled &&
          event.pointerType === 'mouse' &&
          (hovered || pressed) &&
          trackerEnabled
        ) {
          scheduleUpdate(event.clientX, event.clientY);
        }
        onPointerMove?.(event);
      }, [disabled, hovered, onPointerMove, pressed, scheduleUpdate, trackerEnabled],
    );

    const handlePointerLeave = useCallback(
      (event: ReactPointerEvent<HTMLButtonElement>) => {
        setHovered(false);
        setPressed(false);
        invalidateRect();
        clearVars();
        onPointerLeave?.(event);
      },
      [clearVars, invalidateRect, onPointerLeave],
    );

    const handlePointerDown = useCallback(
      (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (!disabled) {
          setPressed(true);

          if (!finalReducedEffects) {
            const rect = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;

            const newRipple = { id: Date.now(), x, y };
            setRipples((prev) => [...prev, newRipple]);

            setTimeout(() => {
              setRipples((prev) => prev.filter((r) => r.id !== newRipple.id));
            }, 650);
          }

          if (trackerEnabled) {
            measure();
            scheduleUpdate(event.clientX, event.clientY);
          }
        }
        onPointerDown?.(event);
      }, [disabled, finalReducedEffects, measure, onPointerDown, scheduleUpdate, trackerEnabled],
    );

    const handlePointerUp = useCallback(
      (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (!disabled) setPressed(false);
        onPointerUp?.(event);
      },
      [disabled, onPointerUp],
    );

    const handlePointerCancel = useCallback(
      (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (!disabled) setPressed(false);
        onPointerCancel?.(event);
      },
      [disabled, onPointerCancel],
    );

    const handleKeyDown = useCallback(
      (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (!disabled && (event.key === ' ' || event.key === 'Enter')) {
          setPressed(true);
        }
        onKeyDown?.(event);
      },
      [disabled, onKeyDown],
    );

    const handleKeyUp = useCallback(
      (event: ReactKeyboardEvent<HTMLButtonElement>) => {
        if (!disabled && (event.key === ' ' || event.key === 'Enter')) {
          setPressed(false);
        }
        onKeyUp?.(event);
      },
      [disabled, onKeyUp],
    );

    const handleBlur = useCallback(
      (event: React.FocusEvent<HTMLButtonElement>) => {
        setPressed(false);
        onBlur?.(event);
      },
      [onBlur],
    );

    const toneVars = useMemo(
      () => getLiquidToneVars({ tone, accentColor, accentForeground }),
      [accentColor, accentForeground, tone],
    );

    const useInsetPress = !isNeobrutalism && pressFeedback === 'inset';

    const targetScale =
      pressed && !finalReducedEffects && !isNeobrutalism && !useInsetPress
        ? PRESSED_SCALE
        : DEFAULT_SCALE;

    const mergedStyle = useMemo(() => {
      const baseTransform = style?.transform;
      const mergedTransform = isNeobrutalism
        ? baseTransform
        : composeTransform(baseTransform, targetScale);

      const currentBg = pressed
        ? (toneVars as Record<string, string>)['--adl-liquid-bg-active']
        : hovered
          ? (toneVars as Record<string, string>)['--adl-liquid-bg-hover']
          : (toneVars as Record<string, string>)['--adl-liquid-bg'];

      const scaleShadowDefault =
        'inset 0 1px 1px rgba(255, 255, 255, 0.15), inset 0 -1px 1px rgba(0, 0, 0, 0.05), 0 4px 16px -4px rgba(0, 0, 0, 0.35)';
      const scaleShadowHover =
        'inset 0 1px 1px rgba(255, 255, 255, 0.25), inset 0 -1px 1px rgba(0, 0, 0, 0.1), 0 8px 24px -6px rgba(0, 0, 0, 0.45)';
      const scaleShadowPressed =
        'inset 0 1px 1px rgba(0, 0, 0, 0.15), inset 0 2px 8px rgba(0, 0, 0, 0.2)';

      let boxShadow: CSSProperties['boxShadow'];
      if (isNeobrutalism) {
        boxShadow = style?.boxShadow;
      } else if (useInsetPress) {
        if (pressed) {
          boxShadow = INSET_SUBMERGE_SHADOW;
        } else if (style?.boxShadow != null) {
          boxShadow = style.boxShadow;
        } else {
          boxShadow = hovered ? scaleShadowHover : scaleShadowDefault;
        }
      } else {
        boxShadow =
          style?.boxShadow ??
          (pressed
            ? scaleShadowPressed
            : hovered
              ? scaleShadowHover
              : scaleShadowDefault);
      }

      return {
        ...(isNeobrutalism ? {} : toneVars),
        ...style,
        background: isNeobrutalism ? style?.background : (style?.background ?? currentBg),
        color: isNeobrutalism
          ? style?.color
          : (style?.color ?? (toneVars as Record<string, string>)['--adl-liquid-text']),
        transform: mergedTransform,
        transitionTimingFunction: !isNeobrutalism && !pressed && !useInsetPress ? 'cubic-bezier(0.34, 1.56, 0.64, 1)' : undefined,
        transitionDuration: !isNeobrutalism && !pressed && !useInsetPress ? '400ms' : undefined,
        willChange:
          !finalReducedEffects && !isNeobrutalism && (hovered || pressed) && !useInsetPress
            ? 'transform'
            : 'auto',
        boxShadow,
      } as CSSProperties;
    }, [
      finalReducedEffects,
      hovered,
      isNeobrutalism,
      pressed,
      style,
      targetScale,
      toneVars,
      useInsetPress,
    ]);

    return (
      <button
        {...props}
        ref={setRefs}
        type={type ?? 'button'}
        disabled={disabled}
        data-hovered={hovered ? 'true' : undefined}
        data-pressed={pressed ? 'true' : undefined}
        className={cn(
          'relative inline-flex items-center justify-center overflow-hidden isolate cursor-pointer select-none touch-manipulation',
          'outline-none transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          isNeobrutalism && 'border-2 border-black',
          !isNeobrutalism && 'border-0',
          !isNeobrutalism && 'backdrop-blur-[10px] backdrop-saturate-[1.35]',
          className,
        )}
        style={mergedStyle}
        onPointerEnter={handlePointerEnter}
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onBlur={handleBlur}
      >
        {!isNeobrutalism && (
          <>
            <span
              className={cn(
                'pointer-events-none absolute inset-x-2 top-0 z-[1] h-px rounded-full',
                'transition-opacity duration-300',
                pressed ? 'opacity-40' : 'opacity-80',
              )}
              style={{
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent)',
              }}
              aria-hidden="true"
            />

            {!finalReducedEffects && (
              <>
                <span
                  className="pointer-events-none absolute inset-0 z-[1] rounded-[inherit] transition-opacity duration-300"
                  aria-hidden="true"
                  style={{
                    opacity: hovered && !pressed ? 0.55 : 0,
                    background: `radial-gradient(ellipse calc(var(--adl-liquid-spotlight-size, 84px) * (1 + var(--adl-liquid-stretch-x, 0))) calc(var(--adl-liquid-spotlight-size, 84px) * (1 + var(--adl-liquid-stretch-y, 0))) at var(--adl-liquid-x, 50%) var(--adl-liquid-y, 50%), var(--adl-liquid-spotlight) 0%, transparent 58%)`,
                  }}
                />

                {ripples.map((ripple) => (
                  <span
                    key={ripple.id}
                    className="pointer-events-none absolute z-[2] rounded-full box-border"
                    style={{
                      left: ripple.x,
                      top: ripple.y,
                      width: 24,
                      height: 24,
                      transform: 'translate(-50%, -50%)',
                      border: `1px solid ${(toneVars as Record<string, string>)['--adl-liquid-ripple']}`,
                      background: 'transparent',
                      animation: 'adl-liquid-ripple 600ms cubic-bezier(0.16, 1, 0.3, 1) forwards',
                    }}
                    aria-hidden="true"
                  />
                ))}
              </>
            )}
          </>
        )}

        <span
          className={cn(
            'relative z-[5] inline-flex items-center justify-center drop-shadow-sm',
            contentClassName,
          )}
        >
          {children}
        </span>

      </button>
    );
  },
);

LiquidGlassButtonBase.displayName = 'LiquidGlassButton';

export const LiquidGlassButton = memo(LiquidGlassButtonBase);
LiquidGlassButton.displayName = 'memo(LiquidGlassButton)';
