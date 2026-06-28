import { memo } from 'react';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface SettingsBentoCardProps {
  children: ReactNode;
  className?: string;
  title?: string;
  description?: string;
  icon?: ReactNode;
  isNeobrutalism?: boolean;
}

export const SettingsBentoCard = memo(function SettingsBentoCard({
  children,
  className,
  title,
  description,
  icon,
  isNeobrutalism = false,
}: SettingsBentoCardProps) {
  return (
    <div
      className={cn(
        'overflow-hidden flex flex-col p-5',
        isNeobrutalism
          ? 'rounded-none bg-white border-3 border-black shadow-[6px_6px_0_0_#000] text-black'
          : 'rounded-2xl border border-white/[0.06] bg-black/20 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_2px_8px_rgba(0,0,0,0.1)]',
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
                    'text-base font-semibold text-text-primary',
                    isNeobrutalism && 'text-sm font-black uppercase tracking-[0.18em] text-black',
                  )}
                >
                  {title}
                </h3>
              </div>
            )}
            {description && (
              <p
                className={cn(
                  'text-xs text-text-muted',
                  isNeobrutalism && 'font-bold uppercase tracking-[0.08em] text-black/65',
                )}
              >
                {description}
              </p>
            )}
          </div>
          {icon && (
            <div
              className={cn(
                'shrink-0',
                isNeobrutalism &&
                  'border-[3px] border-black bg-[#f2f0e9] p-2 text-black shadow-[3px_3px_0_0_#000]',
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

SettingsBentoCard.displayName = 'SettingsBentoCard';

