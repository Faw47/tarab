import { Slot } from '@radix-ui/react-slot';
import * as React from 'react';
import { cn } from '@/lib/utils';
import { type ButtonProps, buttonVariants, LiquidGlassButton } from './LiquidGlassButton';
import { useGlassSystem } from './liquid-glass';

const LIQUID_VARIANTS = new Set<ButtonProps['variant']>([
  'default',
  'primary',
  'danger',
  'destructive',
]);

const ButtonBase = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      asChild = false,
      children,
      className,
      contentClassName,
      variant = 'default',
      size = 'default',
      type,
      style,
      reducedEffects: _reducedEffects,
      accentColor: _accentColor,
      accentForeground: _accentForeground,
      pressFeedback: _pressFeedback,
      ...props
    },
    forwardedRef,
  ) => {
    const { theme } = useGlassSystem();

    if (!asChild && theme !== 'neobrutalism' && LIQUID_VARIANTS.has(variant)) {
      return (
        <LiquidGlassButton
          {...props}
          ref={forwardedRef}
          className={className}
          contentClassName={contentClassName}
          variant={variant}
          size={size}
          type={type}
          style={style}
          reducedEffects={_reducedEffects}
          accentColor={_accentColor}
          accentForeground={_accentForeground}
          pressFeedback={_pressFeedback}
        >
          {children}
        </LiquidGlassButton>
      );
    }

    const Component = asChild ? Slot : 'button';
    return (
      <Component
        {...props}
        ref={forwardedRef}
        type={asChild ? undefined : (type ?? 'button')}
        className={cn(
          buttonVariants({ variant, size }),
          theme === 'neobrutalism' && 'border-2 border-black',
          className,
        )}
        style={style}
      >
        {asChild ? (
          children
        ) : (
          <span
            className={cn('relative inline-flex items-center justify-center', contentClassName)}
          >
            {children}
          </span>
        )}
      </Component>
    );
  },
);

ButtonBase.displayName = 'Button';

export const Button = React.memo(ButtonBase);
Button.displayName = 'memo(Button)';

export type { ButtonProps };
export { buttonVariants };
