import { forwardRef, memo } from 'react';
import { BottomRim, cn, glss, glssDeep, LensArc } from '../ui/liquid-glass';

type GlassIntensity = 'subtle' | 'normal' | 'strong' | 'deep';

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  intensity?: GlassIntensity;
  hover?: boolean;
  glow?: boolean;
  shine?: boolean;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  rounded?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
  children?: React.ReactNode;
}

const paddingClasses = {
  none: '',
  sm: 'p-2',
  md: 'p-4',
  lg: 'p-6',
};

const roundedMap: Record<string, number> = {
  sm: 4,
  md: 6,
  lg: 8,
  xl: 12,
  '2xl': 16,
  full: 9999,
};

export const GlassCard = memo(
  forwardRef<HTMLDivElement, GlassCardProps>(
    (
      {
        intensity = 'normal',
        hover = false,
        glow = false,
        shine = false,
        padding = 'md',
        rounded = 'xl',
        className,
        children,
        style,
        ...props
      },
      ref,
    ) => {
      // Resolve radius
      const r = roundedMap[rounded] || 16;

      // Get base liquid glass styles
      const glassStyle = intensity === 'strong' || intensity === 'deep' ? glssDeep(r) : glss(r);

      return (
        <div
          ref={ref}
          className={cn(
            'relative transition-all duration-200',
            paddingClasses[padding],
            hover && 'hover:-translate-y-1 hover:brightness-110 cursor-pointer',
            glow && 'shadow-[0_0_20px_var(--hero-glow)]',
            className,
          )}
          style={{
            ...glassStyle,
            // Allow overriding radius if provided in style (e.g. from className if processed, but here strict style override)
            ...style,
          }}
          {...props}
        >
          {/* Liquid Glass Effects */}
          <LensArc opacity={intensity === 'subtle' ? 0.4 : 0.8} />
          <BottomRim />

          {/* Shine effect overlay if requested */}
          {shine && (
            <div className="absolute inset-0 bg-gradient-to-tr from-transparent via-white/5 to-transparent opacity-0 hover:opacity-100 transition-opacity duration-500 pointer-events-none rounded-[inherit]" />
          )}

          {/* Content */}
          <div className="relative z-10 h-full">{children}</div>
        </div>
      );
    },
  ),
);

GlassCard.displayName = 'GlassCard';

// Skeleton loading card (kept for compatibility)
interface SkeletonCardProps {
  className?: string;
  height?: string;
}

export const SkeletonCard = memo(({ className, height = 'h-20' }: SkeletonCardProps) => (
  <div className={cn('rounded-xl skeleton-shimmer', height, className)} />
));

SkeletonCard.displayName = 'SkeletonCard';
