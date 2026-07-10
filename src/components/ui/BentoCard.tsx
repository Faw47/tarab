import { memo } from 'react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/store/settings-store';

interface BentoCardProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  icon?: React.ReactNode;
  description?: string;
}

/**
 * A container component for settings sections, following a bento-grid style.
 * Supports both liquid-glass and neobrutalism themes via the global settings store.
 */
export const BentoCard = memo(function BentoCard({
  children,
  className,
  title,
  icon,
  description,
}: BentoCardProps) {
  const isNeobrutalism = useSettingsStore((s) => s.theme === 'neobrutalism');

  return (
    <div
      className={cn(
        'overflow-hidden flex flex-col p-5 transition-all duration-300',
        isNeobrutalism
          ? 'rounded-none bg-white border-3 border-black shadow-[6px_6px_0_0_#000] text-black'
          : 'rounded-2xl border border-white/[0.06] bg-black/20 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_2px_8px_rgba(0,0,0,0.1)] hover:border-white/[0.08] hover:bg-black/[0.28]',
        className,
      )}
    >
      {(title || icon) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            {title && (
              <div className="flex items-center gap-2">
                {isNeobrutalism && <span className="h-2.5 w-2.5 shrink-0 bg-black" aria-hidden />}
                <h3
                  className={cn(
                    isNeobrutalism
                      ? 'text-sm font-black uppercase tracking-[0.18em] text-black'
                      : 'text-base font-semibold tracking-tight text-text-primary',
                  )}
                >
                  {title}
                </h3>
              </div>
            )}
            {description && (
              <p
                className={cn(
                  'text-xs leading-relaxed',
                  isNeobrutalism
                    ? 'font-bold uppercase tracking-[0.08em] text-black/65'
                    : 'text-text-muted',
                )}
              >
                {description}
              </p>
            )}
          </div>
          {icon && (
            <div
              className={cn(
                'shrink-0 p-2 transition-colors',
                isNeobrutalism
                  ? 'border-[3px] border-black bg-[#f2f0e9] text-black shadow-[3px_3px_0_0_#000]'
                  : 'rounded-full border border-white/[0.06] bg-black/30 text-[var(--hero-accent)] backdrop-blur-md',
              )}
            >
              {icon}
            </div>
          )}
        </div>
      )}
      <div className="flex-1 flex flex-col">{children}</div>
    </div>
  );
});

BentoCard.displayName = 'BentoCard';
