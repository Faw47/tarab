import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';
import { useGlassSystem } from './liquid-glass';

export type InputTheme = 'liquid-glass' | 'neobrutalism';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Override the surrounding GlassSystemProvider theme for isolated surfaces. */
  theme?: InputTheme;
}

const LIQUID_INPUT_CLASSES =
  'rounded-lg border border-zinc-700 bg-surface-light text-text-primary focus:ring-2 focus:ring-primary placeholder:text-text-muted';

const NEO_INPUT_CLASSES =
  'rounded-none border-2 border-black bg-white font-bold text-black placeholder:text-black/40 focus:-translate-x-0.5 focus:-translate-y-0.5 focus:shadow-[6px_6px_0_0_#000]';

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, theme, ...props }, ref) => {
    const contextTheme = useGlassSystem().theme;
    const resolvedTheme =
      theme ?? (contextTheme === 'neobrutalism' ? 'neobrutalism' : 'liquid-glass');

    return (
      <input
        {...props}
        ref={ref}
        className={cn(
          'outline-none transition-[color,background-color,border-color,opacity,box-shadow,transform,width,height,left,right,top,bottom] duration-[var(--motion-standard)] disabled:cursor-not-allowed disabled:opacity-50',
          resolvedTheme === 'neobrutalism' ? NEO_INPUT_CLASSES : LIQUID_INPUT_CLASSES,
          className,
        )}
      />
    );
  },
);
