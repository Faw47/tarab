import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { useGlassSystem, usePointerTracker, usePrefersReducedMotion } from './liquid-glass';

const DEFAULT_SCALE = 1;
const PRESSED_SCALE = 0.95;

const INSET_SUBMERGE_SHADOW =
  'inset 0 5px 16px color-mix(in oklch, var(--glass-shadow) 100%, transparent), inset 0 2px 8px color-mix(in oklch, var(--glass-shadow) 80%, transparent), inset 0 1px 0 color-mix(in oklch, var(--type-primary) 5%, transparent)';

const BUTTON_TRACKER_VARS = {
  x: '--adl-liquid-x',
  y: '--adl-liquid-y',
  size: '--adl-liquid-spotlight-size',
} as const;

interface Ripple {
  id: number;
  x: number;
  y: number;
}

const buttonVariants = cva(
  [
    'relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium',
    'isolate overflow-hidden select-none touch-manipulation outline-none',
    'transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-emphasis)] ease-[cubic-bezier(0.16,1,0.3,1)]',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
    'shrink-0',
    'focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
  ].join(' '),
  {
    variants: {
      variant: {
        default: 'text-text-primary',
        primary: 'font-semibold',
        danger: 'text-[var(--signal-danger-ink)]',
        destructive: 'text-[var(--signal-danger-ink)]',
        outline:
          'border border-border bg-transparent text-text-primary hover:bg-[var(--button-ghost-hover)]',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'text-text-secondary hover:text-[var(--type-primary)]',
        link: 'bg-transparent text-primary underline-offset-4 hover:underline !shadow-none !backdrop-blur-none !backdrop-saturate-100',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 px-3 py-1.5',
        md: 'h-9 px-4 py-2',
        lg: 'h-10 px-6 py-3 text-base',
        icon: 'size-9 p-0',
        'icon-sm': 'size-8 p-0',
        'icon-lg': 'size-10 p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  reducedEffects?: boolean;
  contentClassName?: string;
  accentColor?: string;
  accentForeground?: string;
  pressFeedback?: 'scale' | 'inset';
}

function getMergedLiquidVars(
  variant: ButtonProps['variant'],
  accentColor?: string,
  accentForeground?: string,
): React.CSSProperties {
  const safeVariant = variant ?? 'default';
  const baseHighlight =
    'inset 0 1px 1px color-mix(in oklch, var(--type-primary) 20%, transparent), inset 0 -1px 1px color-mix(in oklch, var(--glass-shadow) 12%, transparent)';

  let vars: Record<string, string> = {
    '--adl-liquid-highlight': baseHighlight,
    '--adl-liquid-shadow':
      '0 8px 24px -8px color-mix(in oklch, var(--glass-shadow) 38%, transparent)',
    '--adl-liquid-shadow-hover':
      '0 12px 32px -6px color-mix(in oklch, var(--glass-shadow) 62%, transparent)',
    '--adl-liquid-bg':
      'linear-gradient(180deg, color-mix(in oklch, var(--type-primary) 15%, transparent) 0%, color-mix(in oklch, var(--type-primary) 9%, transparent) 40%, color-mix(in oklch, var(--type-primary) 2%, transparent) 100%)',
    '--adl-liquid-bg-hover':
      'linear-gradient(180deg, color-mix(in oklch, var(--type-primary) 21%, transparent) 0%, color-mix(in oklch, var(--type-primary) 13%, transparent) 42%, color-mix(in oklch, var(--type-primary) 4%, transparent) 100%)',
    '--adl-liquid-bg-active':
      'linear-gradient(180deg, color-mix(in oklch, var(--type-primary) 7%, transparent) 0%, color-mix(in oklch, var(--type-primary) 2%, transparent) 100%)',
    '--adl-liquid-text': 'color-mix(in oklch, var(--type-primary) 92%, transparent)',
    '--adl-liquid-spotlight': 'color-mix(in oklch, var(--type-primary) 16%, transparent)',
    '--adl-liquid-ripple': 'color-mix(in oklch, var(--type-primary) 45%, transparent)',
  };

  if (safeVariant === 'primary') {
    const base = accentColor ?? 'var(--type-primary)';
    const ink = accentForeground ?? 'var(--signal-play-ink)';
    vars = {
      ...vars,
      '--adl-liquid-bg': `linear-gradient(180deg, color-mix(in oklch, ${base} 34%, color-mix(in oklch, var(--button-liquid-light) 14%, transparent)) 0%, color-mix(in oklch, ${base} 22%, color-mix(in oklch, var(--button-liquid-light) 8%, transparent)) 38%, color-mix(in oklch, ${base} 7%, color-mix(in oklch, var(--button-liquid-light) 2%, transparent)) 100%)`,
      '--adl-liquid-bg-hover': `linear-gradient(180deg, color-mix(in oklch, ${base} 42%, color-mix(in oklch, var(--button-liquid-light) 16%, transparent)) 0%, color-mix(in oklch, ${base} 28%, color-mix(in oklch, var(--button-liquid-light) 10%, transparent)) 40%, color-mix(in oklch, ${base} 12%, color-mix(in oklch, var(--button-liquid-light) 4%, transparent)) 100%)`,
      '--adl-liquid-bg-active': `linear-gradient(180deg, color-mix(in oklch, ${base} 14%, color-mix(in oklch, var(--button-liquid-light) 5%, transparent)) 0%, color-mix(in oklch, ${base} 5%, transparent) 100%)`,
      '--adl-liquid-text': ink,
      '--adl-liquid-highlight': `inset 0 1px 1px color-mix(in oklch, ${base} 80%, color-mix(in oklch, var(--button-liquid-light) 70%, transparent)), inset 0 -1px 1px color-mix(in oklch, var(--button-liquid-shadow) 10%, transparent)`,
      '--adl-liquid-spotlight': `color-mix(in oklch, ${base} 32%, color-mix(in oklch, var(--button-liquid-light) 20%, transparent))`,
      '--adl-liquid-ripple': `color-mix(in oklch, ${base} 60%, color-mix(in oklch, var(--button-liquid-light) 60%, transparent))`,
      '--adl-liquid-shadow':
        '0 12px 32px -12px color-mix(in oklch, var(--button-liquid-shadow) 25%, transparent)',
      '--adl-liquid-shadow-hover':
        '0 16px 40px -10px color-mix(in oklch, var(--button-liquid-shadow) 35%, transparent)',
    };
  } else if (safeVariant === 'danger' || safeVariant === 'destructive') {
    vars = {
      ...vars,
      '--adl-liquid-bg':
        'linear-gradient(180deg, color-mix(in oklch, var(--signal-danger) 26%, transparent) 0%, color-mix(in oklch, var(--signal-danger) 14%, transparent) 40%, color-mix(in oklch, var(--signal-danger) 5%, transparent) 100%)',
      '--adl-liquid-bg-hover':
        'linear-gradient(180deg, color-mix(in oklch, var(--signal-danger) 34%, transparent) 0%, color-mix(in oklch, var(--signal-danger) 20%, transparent) 42%, color-mix(in oklch, var(--signal-danger) 9%, transparent) 100%)',
      '--adl-liquid-bg-active':
        'linear-gradient(180deg, color-mix(in oklch, var(--signal-danger) 14%, transparent) 0%, color-mix(in oklch, var(--signal-danger) 3%, transparent) 100%)',
      '--adl-liquid-text': 'var(--signal-danger-ink)',
      '--adl-liquid-highlight':
        'inset 0 1px 1px color-mix(in oklch, var(--signal-danger) 60%, var(--type-primary)), inset 0 -1px 1px color-mix(in oklch, var(--glass-shadow) 12%, transparent)',
      '--adl-liquid-spotlight': 'color-mix(in oklch, var(--signal-danger) 22%, transparent)',
      '--adl-liquid-ripple': 'color-mix(in oklch, var(--signal-danger) 55%, transparent)',
      '--adl-liquid-shadow':
        '0 8px 24px -8px color-mix(in oklch, var(--signal-danger) 30%, transparent)',
      '--adl-liquid-shadow-hover':
        '0 12px 32px -6px color-mix(in oklch, var(--signal-danger) 40%, transparent)',
    };
  } else if (safeVariant === 'ghost') {
    vars = {
      ...vars,
      '--adl-liquid-bg': 'color-mix(in oklch, var(--button-liquid-light) 1%, transparent)',
      '--adl-liquid-bg-hover': 'color-mix(in oklch, var(--button-liquid-light) 5%, transparent)',
      '--adl-liquid-bg-active': 'color-mix(in oklch, var(--button-liquid-light) 2%, transparent)',
      '--adl-liquid-text': 'inherit',
      '--adl-liquid-highlight':
        'inset 0 1px 1px color-mix(in oklch, var(--button-liquid-light) 10%, transparent)',
      '--adl-liquid-spotlight': 'color-mix(in oklch, var(--button-liquid-light) 9%, transparent)',
      '--adl-liquid-ripple': 'color-mix(in oklch, var(--button-liquid-light) 25%, transparent)',
      '--adl-liquid-shadow': 'none',
      '--adl-liquid-shadow-hover': 'none',
    };
  } else if (safeVariant === 'outline') {
    vars = {
      ...vars,
      '--adl-liquid-bg': 'color-mix(in oklch, var(--button-liquid-light) 2%, transparent)',
      '--adl-liquid-bg-hover': 'color-mix(in oklch, var(--button-liquid-light) 6%, transparent)',
      '--adl-liquid-bg-active': 'color-mix(in oklch, var(--button-liquid-light) 1%, transparent)',
      '--adl-liquid-border': 'color-mix(in oklch, var(--button-liquid-light) 20%, transparent)',
      '--adl-liquid-border-hover':
        'color-mix(in oklch, var(--button-liquid-light) 30%, transparent)',
      '--adl-liquid-text': 'inherit',
      '--adl-liquid-highlight': baseHighlight,
      '--adl-liquid-spotlight': 'color-mix(in oklch, var(--button-liquid-light) 9%, transparent)',
      '--adl-liquid-ripple': 'color-mix(in oklch, var(--button-liquid-light) 25%, transparent)',
      '--adl-liquid-shadow':
        '0 4px 16px -4px color-mix(in oklch, var(--button-liquid-shadow) 10%, transparent)',
      '--adl-liquid-shadow-hover':
        '0 8px 24px -4px color-mix(in oklch, var(--button-liquid-shadow) 15%, transparent)',
    };
  }

  return vars as React.CSSProperties;
}

function composeTransform(
  baseTransform: React.CSSProperties['transform'],
  scale: number,
): React.CSSProperties['transform'] {
  const scaleTransform = `scale(${scale})`;
  if (!baseTransform || baseTransform === 'none') return scaleTransform;
  return `${baseTransform} ${scaleTransform}`;
}

const LiquidGlassButtonBase = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      className,
      contentClassName,
      variant = 'default',
      size = 'default',
      asChild = false,
      type,
      style,
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
      ...props
    },
    forwardedRef,
  ) => {
    const prefersReducedMotion = usePrefersReducedMotion();
    const { theme, reducedEffects: contextReducedEffects } = useGlassSystem();

    const finalReducedEffects =
      Boolean(reducedEffects) || Boolean(contextReducedEffects) || prefersReducedMotion;
    const isNeobrutalism = theme === 'neobrutalism';

    const [hovered, setHovered] = React.useState(false);
    const [pressed, setPressed] = React.useState(false);
    const [ripples, setRipples] = React.useState<Ripple[]>([]);
    const nextRippleIdRef = React.useRef(0);
    const rippleTimersRef = React.useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

    // We still call the hook, but disable it if it's a link or child to save work
    const bypassEffects = asChild || variant === 'link';
    const trackerEnabled = !bypassEffects && !finalReducedEffects && !isNeobrutalism && !disabled;

    const {
      ref: trackerRef,
      measure,
      scheduleUpdate,
      clearVars,
      invalidateRect,
    } = usePointerTracker<HTMLButtonElement>(BUTTON_TRACKER_VARS, trackerEnabled);

    const setRefs = React.useCallback(
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

    React.useEffect(() => {
      if (!disabled) return;
      setHovered(false);
      setPressed(false);
      for (const timer of rippleTimersRef.current.values()) clearTimeout(timer);
      rippleTimersRef.current.clear();
      setRipples([]);
      clearVars();
      invalidateRect();
    }, [clearVars, disabled, invalidateRect]);

    React.useEffect(
      () => () => {
        for (const timer of rippleTimersRef.current.values()) clearTimeout(timer);
        rippleTimersRef.current.clear();
      },
      [],
    );

    const handlePointerEnter = React.useCallback(
      (event: React.PointerEvent<HTMLButtonElement>) => {
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

    const handlePointerMove = React.useCallback(
      (event: React.PointerEvent<HTMLButtonElement>) => {
        if (!disabled && event.pointerType === 'mouse' && (hovered || pressed) && trackerEnabled) {
          scheduleUpdate(event.clientX, event.clientY);
        }
        onPointerMove?.(event);
      },
      [disabled, hovered, onPointerMove, pressed, scheduleUpdate, trackerEnabled],
    );

    const handlePointerLeave = React.useCallback(
      (event: React.PointerEvent<HTMLButtonElement>) => {
        setHovered(false);
        setPressed(false);
        invalidateRect();
        clearVars();
        onPointerLeave?.(event);
      },
      [clearVars, invalidateRect, onPointerLeave],
    );

    const handlePointerDown = React.useCallback(
      (event: React.PointerEvent<HTMLButtonElement>) => {
        if (!disabled) {
          setPressed(true);

          if (!finalReducedEffects && !bypassEffects) {
            const rect = event.currentTarget.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;

            const newRipple = { id: nextRippleIdRef.current++, x, y };
            setRipples((prev) => [...prev, newRipple]);

            const timer = setTimeout(() => {
              rippleTimersRef.current.delete(newRipple.id);
              setRipples((prev) => prev.filter((r) => r.id !== newRipple.id));
            }, 650);
            rippleTimersRef.current.set(newRipple.id, timer);
          }

          if (trackerEnabled) {
            measure();
            scheduleUpdate(event.clientX, event.clientY);
          }
        }
        onPointerDown?.(event);
      },
      [
        disabled,
        finalReducedEffects,
        bypassEffects,
        measure,
        onPointerDown,
        scheduleUpdate,
        trackerEnabled,
      ],
    );

    const handlePointerUp = React.useCallback(
      (event: React.PointerEvent<HTMLButtonElement>) => {
        if (!disabled) setPressed(false);
        onPointerUp?.(event);
      },
      [disabled, onPointerUp],
    );

    const handlePointerCancel = React.useCallback(
      (event: React.PointerEvent<HTMLButtonElement>) => {
        if (!disabled) setPressed(false);
        onPointerCancel?.(event);
      },
      [disabled, onPointerCancel],
    );

    const handleKeyDown = React.useCallback(
      (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (!disabled && (event.key === ' ' || event.key === 'Enter')) {
          setPressed(true);
        }
        onKeyDown?.(event);
      },
      [disabled, onKeyDown],
    );

    const handleKeyUp = React.useCallback(
      (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (!disabled && (event.key === ' ' || event.key === 'Enter')) {
          setPressed(false);
        }
        onKeyUp?.(event);
      },
      [disabled, onKeyUp],
    );

    const handleBlur = React.useCallback(
      (event: React.FocusEvent<HTMLButtonElement>) => {
        setPressed(false);
        onBlur?.(event);
      },
      [onBlur],
    );

    const toneVars = React.useMemo(
      () => getMergedLiquidVars(variant, accentColor, accentForeground),
      [accentColor, accentForeground, variant],
    );

    const useInsetPress = !isNeobrutalism && pressFeedback === 'inset';

    const targetScale =
      pressed && !finalReducedEffects && !isNeobrutalism && !useInsetPress && !bypassEffects
        ? PRESSED_SCALE
        : DEFAULT_SCALE;

    const mergedStyle = React.useMemo(() => {
      const baseTransform = style?.transform;
      const mergedTransform = isNeobrutalism
        ? baseTransform
        : composeTransform(baseTransform, targetScale);

      const toneVarsRecord = toneVars as Record<string, string>;

      const currentBg = pressed
        ? toneVarsRecord['--adl-liquid-bg-active']
        : hovered
          ? toneVarsRecord['--adl-liquid-bg-hover']
          : toneVarsRecord['--adl-liquid-bg'];

      let boxShadow: React.CSSProperties['boxShadow'] = style?.boxShadow;

      if (!isNeobrutalism && !boxShadow) {
        if (useInsetPress && pressed) {
          boxShadow = INSET_SUBMERGE_SHADOW;
        } else if (pressed) {
          boxShadow =
            'inset 0 1px 1px color-mix(in oklch, var(--glass-shadow) 38%, transparent), inset 0 2px 8px color-mix(in oklch, var(--glass-shadow) 50%, transparent)';
        } else if (hovered) {
          boxShadow =
            toneVarsRecord['--adl-liquid-shadow-hover'] !== 'none'
              ? `${toneVarsRecord['--adl-liquid-highlight']}, ${toneVarsRecord['--adl-liquid-shadow-hover']}`
              : toneVarsRecord['--adl-liquid-highlight'];
        } else {
          boxShadow =
            toneVarsRecord['--adl-liquid-shadow'] !== 'none'
              ? `${toneVarsRecord['--adl-liquid-highlight']}, ${toneVarsRecord['--adl-liquid-shadow']}`
              : toneVarsRecord['--adl-liquid-highlight'];
        }
      }

      return {
        ...(isNeobrutalism ? {} : toneVars),
        ...style,
        background: isNeobrutalism ? style?.background : (style?.background ?? currentBg),
        color: isNeobrutalism
          ? style?.color
          : (style?.color ?? toneVarsRecord['--adl-liquid-text']),
        transform: mergedTransform,
        transitionTimingFunction:
          !isNeobrutalism && !pressed && !useInsetPress
            ? 'cubic-bezier(0.34, 1.56, 0.64, 1)'
            : undefined,
        transitionDuration:
          !isNeobrutalism && !pressed && !useInsetPress ? 'var(--motion-standard)' : undefined,
        willChange:
          !finalReducedEffects && !isNeobrutalism && (hovered || pressed) && !useInsetPress
            ? 'transform'
            : 'auto',
        boxShadow,
      } as React.CSSProperties;
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

    // If the button is rendered as a child (e.g. standard Radix Slot) or is purely a text link,
    // we bypass the heavy glass computation and just utilize standard Tailwind classes to save performance.
    if (bypassEffects) {
      const Comp = asChild ? Slot : 'button';
      return (
        <Comp
          className={cn(buttonVariants({ variant, size, className }))}
          ref={setRefs}
          type={asChild ? undefined : (type ?? 'button')}
          style={style}
          {...props}
        >
          {children}
        </Comp>
      );
    }

    const baseClasses = cn(
      buttonVariants({ variant, size }),
      !isNeobrutalism && 'backdrop-blur-[10px] backdrop-saturate-[1.35] border-0',
      isNeobrutalism && 'border-2 border-black',
      className,
    );

    return (
      <button
        {...props}
        ref={setRefs}
        type={type ?? 'button'}
        disabled={disabled}
        data-hovered={hovered ? 'true' : undefined}
        data-pressed={pressed ? 'true' : undefined}
        className={baseClasses}
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
                'transition-opacity duration-[var(--motion-emphasis)]',
                pressed ? 'opacity-40' : 'opacity-80',
              )}
              style={{
                background:
                  'linear-gradient(90deg, transparent, color-mix(in oklch, var(--type-primary) 50%, transparent), transparent)',
              }}
              aria-hidden="true"
            />

            {!finalReducedEffects && (
              <>
                <span
                  className="pointer-events-none absolute inset-0 z-[1] rounded-[inherit] transition-opacity duration-[var(--motion-emphasis)]"
                  aria-hidden="true"
                  style={{
                    opacity: hovered && !pressed ? 0.55 : 0,
                    background: `radial-gradient(ellipse calc(var(--adl-liquid-spotlight-size, 84px) * (1 + var(--adl-liquid-stretch-x, 0))) calc(var(--adl-liquid-spotlight-size, 84px) * (1 + var(--adl-liquid-stretch-y, 0))) at var(--adl-liquid-x, 50%) var(--adl-liquid-y, 50%), var(--adl-liquid-spotlight) 0%, transparent 58%)`,
                  }}
                />

                {ripples.map((ripple) => (
                  <span
                    key={ripple.id}
                    className="pointer-events-none absolute z-[2] box-border rounded-full"
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

export const LiquidGlassButton = React.memo(LiquidGlassButtonBase);
LiquidGlassButton.displayName = 'memo(LiquidGlassButton)';

export { buttonVariants };
